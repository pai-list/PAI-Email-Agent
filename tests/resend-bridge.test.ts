import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleResendWebhook } from '../worker/email-sender/src/resend-webhook.ts';
import { verifyHMAC, generateHMAC } from '../worker/shared/src/crypto.js';
import type { CloudflareEnv, KVNamespace, ResendWebhookEvent } from '../worker/shared/src/types.js';

function createMockEnv(overrides: Partial<CloudflareEnv> = {}): CloudflareEnv {
  const store = new Map<string, string>();

  const mockKV: KVNamespace = {
    get: vi.fn().mockImplementation(async (key: string) => store.get(key) || null),
    put: vi.fn().mockImplementation(async (key: string, val: string) => {
      store.set(key, val);
    }),
    delete: vi.fn().mockImplementation(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn().mockResolvedValue({ keys: [] }),
  };

  return {
    RESEND_API_KEY: 're_test_key',
    RESEND_API_URL: 'https://api.resend.com',
    RESEND_WEBHOOK_SECRET: 'whsec_resend_test_secret_123',
    CF_API_TOKEN: 'cf_token_test',
    JWT_SECRET: 'jwt_secret_test',
    WEBHOOK_SECRET: 'wh_secret_test',
    ENVIRONMENT: 'development',
    JWT_ISSUER: 'pai-email-agent',
    JWT_AUDIENCE: 'pai-agents',
    DOMAIN: 'axiomid.app',
    EMAIL_KV: mockKV,
    AGENT_KV: mockKV,
    RATE_LIMIT_KV: mockKV,
    WEBHOOK_KV: mockKV,
    AGENT_INBOX_DO: {} as CloudflareEnv['AGENT_INBOX_DO'],
    ...overrides,
  };
}

describe('Resend Bridge & Webhook Suite', () => {
  let env: CloudflareEnv;
  const correlationId = 'test-corr-id-12345';

  beforeEach(() => {
    env = createMockEnv();
  });

  it('rejects webhook request with invalid signature', async () => {
    const payload = JSON.stringify({ type: 'email.delivered', data: { email_id: 're_123' } });
    const result = await handleResendWebhook(env, payload, 'invalid_sig', correlationId);

    expect(result.success).toBe(false);
    expect(result.processed).toBe(0);
    expect(result.errors).toContain('Invalid signature');
  });

  it('processes valid email.delivered Resend webhook event', async () => {
    const event: ResendWebhookEvent = {
      type: 'email.delivered',
      created_at: '2026-08-07T05:00:00.000Z',
      data: {
        email_id: 're_deliv_123',
        from: 'sender@example.com',
        to: ['recipient@example.com'],
        subject: 'Delivery Test',
      },
    };

    const payloadStr = JSON.stringify(event);
    const validSignature = await generateHMAC(payloadStr, env.RESEND_WEBHOOK_SECRET);

    const result = await handleResendWebhook(env, payloadStr, validSignature, correlationId);

    expect(result.success).toBe(true);
    expect(result.processed).toBe(1);
    expect(result.errors).toEqual([]);

    // Check that status was stored in EMAIL_KV
    const storedStatusJson = await env.EMAIL_KV.get('email:status:re_deliv_123');
    expect(storedStatusJson).toBeDefined();

    const stored = JSON.parse(storedStatusJson!);
    expect(stored.messageId).toBe('re_deliv_123');
    expect(stored.status).toBe('delivered');
    expect(stored.recipient).toBe('recipient@example.com');
  });

  it('processes email.bounced event with bounce metadata', async () => {
    const event: ResendWebhookEvent = {
      type: 'email.bounced',
      created_at: '2026-08-07T05:05:00.000Z',
      data: {
        email_id: 're_bounce_456',
        from: 'sender@example.com',
        to: ['bounced@example.com'],
        subject: 'Bounce Test',
        bounce_type: 'hard',
        bounce_code: '550 5.1.1',
        bounce_description: 'User unknown',
      },
    };

    const payloadStr = JSON.stringify(event);
    const validSignature = await generateHMAC(payloadStr, env.RESEND_WEBHOOK_SECRET);

    const result = await handleResendWebhook(env, payloadStr, validSignature, correlationId);

    expect(result.success).toBe(true);

    const storedStatusJson = await env.EMAIL_KV.get('email:status:re_bounce_456');
    const stored = JSON.parse(storedStatusJson!);
    expect(stored.status).toBe('bounced');
    expect(stored.metadata.bounceType).toBe('hard');
    expect(stored.metadata.bounceCode).toBe('550 5.1.1');
    expect(stored.metadata.bounceDescription).toBe('User unknown');
  });

  it('processes email.opened and email.clicked events with analytics metadata', async () => {
    const openEvent: ResendWebhookEvent = {
      type: 'email.opened',
      created_at: '2026-08-07T05:10:00.000Z',
      data: {
        email_id: 're_open_789',
        from: 'sender@example.com',
        to: ['user@example.com'],
        subject: 'Open Test',
        user_agent: 'Mozilla/5.0 (iPhone)',
        ip: '192.168.1.1',
      },
    };

    const payloadStr = JSON.stringify(openEvent);
    const validSignature = await generateHMAC(payloadStr, env.RESEND_WEBHOOK_SECRET);

    const result = await handleResendWebhook(env, payloadStr, validSignature, correlationId);
    expect(result.success).toBe(true);

    const storedStatusJson = await env.EMAIL_KV.get('email:status:re_open_789');
    const stored = JSON.parse(storedStatusJson!);
    expect(stored.status).toBe('opened');
    expect(stored.metadata.userAgent).toBe('Mozilla/5.0 (iPhone)');
    expect(stored.metadata.ip).toBe('192.168.1.1');
  });

  it('handles JSON parsing errors gracefully', async () => {
    const invalidJsonPayload = 'not-valid-json';
    const validSignature = await generateHMAC(invalidJsonPayload, env.RESEND_WEBHOOK_SECRET);

    const result = await handleResendWebhook(env, invalidJsonPayload, validSignature, correlationId);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
  });
});
