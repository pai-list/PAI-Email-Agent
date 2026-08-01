/**
 * Unit tests for Email Sender
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateSendRequest,
  sendEmailViaResend,
  checkRateLimit,
  recordEmailSent,
  generateIdempotencyKey,
} from '../src/sender.js';
import type { SendEmailRequest, CloudflareEnv, AgentPassportClaims, KVNamespace } from '../../shared/src/types.js';

function createMockEnv(overrides: Partial<CloudflareEnv> = {}): CloudflareEnv {
  return {
    RESEND_API_KEY: 're_test_key',
    RESEND_API_URL: 'https://api.resend.com',
    RESEND_WEBHOOK_SECRET: 'whsec_test',
    CF_API_TOKEN: 'cf_test_token',
    JWT_SECRET: 'jwt_test_secret',
    WEBHOOK_SECRET: 'wh_test_secret',
    ENVIRONMENT: 'development',
    JWT_ISSUER: 'pai-email-agent',
    JWT_AUDIENCE: 'pai-agents',
    DOMAIN: 'axiomid.app',
    EMAIL_KV: {} as KVNamespace,
    AGENT_KV: {} as KVNamespace,
    RATE_LIMIT_KV: {} as KVNamespace,
    WEBHOOK_KV: {} as KVNamespace,
    AGENT_INBOX_DO: {} as CloudflareEnv['AGENT_INBOX_DO'],
    ...overrides,
  };
}

const validClaims: AgentPassportClaims = {
  agentName: 'alice',
  agentDomain: 'alice.axiomid.app',
  permissions: ['email:send', 'email:receive'],
  emailQuota: { hourly: 100, daily: 1000, monthly: 10000 },
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
  iss: 'pai-email-agent',
  aud: 'pai-agents',
  jti: 'test-jti',
  sub: 'alice',
};

const validRequest: SendEmailRequest = {
  to: 'recipient@example.com',
  subject: 'Test',
  text: 'Hello',
};

describe('Email Sender', () => {
  describe('validateSendRequest', () => {
    it('accepts valid request', () => {
      const result = validateSendRequest(validRequest);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('rejects request with empty to field', () => {
      const request = { ...validRequest, to: '' };
      const result = validateSendRequest(request);
      expect(result.valid).toBe(false);
      expect(result.errors.join(', ')).toContain('Recipient (to)');
    });

    it('rejects request with empty to array', () => {
      const request = { ...validRequest, to: [] };
      const result = validateSendRequest(request);
      expect(result.valid).toBe(false);
      expect(result.errors.join(', ')).toContain('Recipient (to)');
    });

    it('rejects request with empty subject', () => {
      const request = { ...validRequest, subject: '' };
      const result = validateSendRequest(request);
      expect(result.valid).toBe(false);
      expect(result.errors.join(', ')).toContain('Subject');
    });

    it('rejects request with empty text and html', () => {
      const request = { ...validRequest, text: '', html: '' };
      const result = validateSendRequest(request);
      expect(result.valid).toBe(false);
      expect(result.errors.join(', ')).toContain('text or html');
    });

    it('accepts request with only html', () => {
      const request = { ...validRequest, text: '', html: '<p>Hello</p>' };
      const result = validateSendRequest(request);
      expect(result.valid).toBe(true);
    });

    it('accepts request with only text', () => {
      const request = { ...validRequest, html: '', text: 'Hello' };
      const result = validateSendRequest(request);
      expect(result.valid).toBe(true);
    });

    it('validates email format in to field', () => {
      const request = { ...validRequest, to: 'invalid-email' };
      const result = validateSendRequest(request);
      expect(result.valid).toBe(false);
      expect(result.errors.join(', ')).toContain('Invalid email');
    });

    it('validates email format in cc field', () => {
      const request = { ...validRequest, cc: 'invalid-email' };
      const result = validateSendRequest(request);
      expect(result.valid).toBe(false);
      expect(result.errors.join(', ')).toContain('CC');
    });

    it('validates email format in bcc field', () => {
      const request = { ...validRequest, bcc: 'invalid-email' };
      const result = validateSendRequest(request);
      expect(result.valid).toBe(false);
      expect(result.errors.join(', ')).toContain('BCC');
    });

    it('accepts multiple valid emails in to', () => {
      const request = { ...validRequest, to: ['a@example.com', 'b@example.com'] };
      const result = validateSendRequest(request);
      expect(result.valid).toBe(true);
    });

    it('rejects attachment without filename', () => {
      const request = {
        ...validRequest,
        attachments: [{ content: 'dGVzdA==' } as SendEmailRequest['attachments'][number]],
      };
      const result = validateSendRequest(request);
      expect(result.valid).toBe(false);
      expect(result.errors.join(', ')).toContain('Attachment');
    });

    it('rejects attachment over 25MB', () => {
      const request = {
        ...validRequest,
        attachments: [{ filename: 'big.bin', content: 'x', size: 30 * 1024 * 1024 }],
      };
      const result = validateSendRequest(request);
      expect(result.valid).toBe(false);
      expect(result.errors.join(', ')).toContain('too large');
    });
  });

  describe('sendEmailViaResend', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('sends basic email payload to Resend API', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ id: 're_123' }), { status: 200 })
      );

      const result = await sendEmailViaResend(createMockEnv(), validClaims, validRequest);

      expect(result.messageId).toBe('re_123');
      expect(result.status).toBe('queued');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.resend.com/emails');
      expect(init.headers.Authorization).toBe('Bearer re_test_key');

      const payload = JSON.parse(init.body);
      expect(payload.from).toBe('alice <noreply@alice.axiomid.app>');
      expect(payload.to).toEqual(['recipient@example.com']);
      expect(payload.subject).toBe('Test');
      expect(payload.text).toBe('Hello');
      expect(payload.tags).toEqual(
        expect.arrayContaining([
          { name: 'agent', value: 'alice' },
          { name: 'domain', value: 'alice.axiomid.app' },
          { name: 'environment', value: 'development' },
        ])
      );
      expect(payload.metadata.agentName).toBe('alice');
    });

    it('includes html, cc, bcc, reply_to and attachments when provided', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ id: 're_456' }), { status: 200 })
      );

      const request: SendEmailRequest = {
        to: 'recipient@example.com',
        cc: 'cc@example.com',
        bcc: 'bcc@example.com',
        replyTo: 'reply@example.com',
        subject: 'Test',
        text: 'Hello',
        html: '<p>Hello</p>',
        attachments: [{
          filename: 'test.txt',
          content: 'dGVzdA==',
          contentType: 'text/plain',
        }],
        headers: { 'X-Custom': 'value' },
      };

      const result = await sendEmailViaResend(createMockEnv(), validClaims, request);
      expect(result.messageId).toBe('re_456');

      const [, init] = fetchMock.mock.calls[0];
      const payload = JSON.parse(init.body);
      expect(payload.html).toBe('<p>Hello</p>');
      expect(payload.cc).toEqual(['cc@example.com']);
      expect(payload.bcc).toEqual(['bcc@example.com']);
      expect(payload.reply_to).toBe('reply@example.com');
      expect(payload.attachments).toHaveLength(1);
      expect(payload.attachments[0].filename).toBe('test.txt');
      expect(payload.attachments[0].content_type).toBe('text/plain');
      expect(payload.headers).toEqual({ 'X-Custom': 'value' });
    });

    it('throws on Resend API error response', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ error: 'invalid_api_key' }), { status: 401 })
      );

      await expect(sendEmailViaResend(createMockEnv(), validClaims, validRequest))
        .rejects.toThrow('Resend API error: 401');
    });

    it('throws when Resend returns invalid JSON', async () => {
      fetchMock.mockResolvedValue(new Response('not-json', { status: 200 }));

      await expect(sendEmailViaResend(createMockEnv(), validClaims, validRequest))
        .rejects.toThrow('invalid JSON');
    });

    it('throws when Resend does not return a message id', async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      await expect(sendEmailViaResend(createMockEnv(), validClaims, validRequest))
        .rejects.toThrow('message ID');
    });
  });

  describe('checkRateLimit', () => {
    it('allows request when under limit', async () => {
      const kv: KVNamespace = {
        get: vi.fn().mockResolvedValue('5'),
        put: vi.fn().mockResolvedValue(undefined),
      } as unknown as KVNamespace;
      const env = createMockEnv({ RATE_LIMIT_KV: kv });

      const result = await checkRateLimit(env, 'alice', 'send', 'hourly');
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(100);
      expect(result.remaining).toBe(95);
    });

    it('denies request when over limit and sets retryAfterMs', async () => {
      const kv: KVNamespace = {
        get: vi.fn().mockResolvedValue('100'),
        put: vi.fn().mockResolvedValue(undefined),
      } as unknown as KVNamespace;
      const env = createMockEnv({ RATE_LIMIT_KV: kv });

      const result = await checkRateLimit(env, 'alice', 'send', 'hourly');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it('returns full limit when no usage recorded yet', async () => {
      const kv: KVNamespace = {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
      } as unknown as KVNamespace;
      const env = createMockEnv({ RATE_LIMIT_KV: kv });

      const result = await checkRateLimit(env, 'alice', 'send', 'daily');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1000);
      expect(kv.get).toHaveBeenCalledWith(
        expect.stringContaining('ratelimit:alice:send:daily:')
      );
    });
  });

  describe('recordEmailSent', () => {
    it('increments usage count and sets window TTL', async () => {
      const kv: KVNamespace = {
        get: vi.fn().mockResolvedValue('3'),
        put: vi.fn().mockResolvedValue(undefined),
      } as unknown as KVNamespace;
      const env = createMockEnv({ RATE_LIMIT_KV: kv });

      await recordEmailSent(env, 'alice', 'send', 'hourly');

      expect(kv.put).toHaveBeenCalledWith(
        expect.stringContaining('ratelimit:alice:send:hourly:'),
        '4',
        expect.objectContaining({ expirationTtl: expect.any(Number) })
      );
    });

    it('starts from 1 when no usage recorded yet', async () => {
      const kv: KVNamespace = {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
      } as unknown as KVNamespace;
      const env = createMockEnv({ RATE_LIMIT_KV: kv });

      await recordEmailSent(env, 'alice', 'send', 'hourly');

      expect(kv.put).toHaveBeenCalledWith(
        expect.stringContaining('ratelimit:alice:send:hourly:'),
        '1',
        expect.anything()
      );
    });
  });

  describe('generateIdempotencyKey', () => {
    it('generates stable key for identical requests', async () => {
      const key1 = await generateIdempotencyKey('alice', validRequest);
      const key2 = await generateIdempotencyKey('alice', validRequest);
      expect(key1).toBe(key2);
      expect(key1).toContain('alice:');
    });

    it('generates different keys for different content', async () => {
      const key1 = await generateIdempotencyKey('alice', validRequest);
      const key2 = await generateIdempotencyKey('alice', { ...validRequest, subject: 'Other' });
      expect(key1).not.toBe(key2);
    });
  });
});
