import { describe, it, expect, vi } from 'vitest';
import { validateSendRequest, generateIdempotencyKey } from '../worker/email-sender/src/sender.js';
import {
  PAIEmailError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  RateLimitError,
  NotFoundError,
  UpstreamError,
} from '../worker/shared/src/types.js';
import type { SendEmailRequest } from '../worker/shared/src/types.js';

describe('Payload Validation & Custom Errors Suite', () => {
  describe('validateSendRequest', () => {
    it('validates a complete and valid SendEmailRequest', () => {
      const request: SendEmailRequest = {
        to: 'user@example.com',
        cc: ['cc1@example.com', 'cc2@example.com'],
        bcc: 'bcc@example.com',
        subject: 'Monthly Report',
        text: 'Report attached.',
        html: '<p>Report attached.</p>',
        replyTo: 'reply@agent.com',
        attachments: [
          {
            filename: 'report.pdf',
            contentType: 'application/pdf',
            content: 'YmFzZTY0',
            size: 1024,
          },
        ],
        tags: { category: 'reports' },
      };

      const validation = validateSendRequest(request);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
    });

    it('collects errors for missing recipient, subject, and content', () => {
      const invalidRequest = {
        to: '',
        subject: ' ',
        text: '',
        html: '',
      } as SendEmailRequest;

      const validation = validateSendRequest(invalidRequest);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toEqual(
        expect.arrayContaining([
          'Recipient (to) is required',
          'Subject is required',
          'Either text or html content is required',
        ])
      );
    });

    it('collects errors for malformed recipient email addresses', () => {
      const invalidEmailsRequest: SendEmailRequest = {
        to: ['valid@example.com', 'not-valid-email'],
        cc: 'invalid-cc@',
        bcc: '@invalid-bcc',
        subject: 'Test Subject',
        text: 'Test Content',
      };

      const validation = validateSendRequest(invalidEmailsRequest);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toEqual(
        expect.arrayContaining([
          'Invalid email address: not-valid-email',
          'Invalid CC email address: invalid-cc@',
          'Invalid BCC email address: @invalid-bcc',
        ])
      );
    });

    it('collects errors for invalid attachments', () => {
      const invalidAttachmentRequest: SendEmailRequest = {
        to: 'user@example.com',
        subject: 'Attachment Test',
        text: 'See attached.',
        attachments: [
          {
            filename: '',
            contentType: 'text/plain',
            content: '',
            size: 100,
          },
          {
            filename: 'oversized.zip',
            contentType: 'application/zip',
            content: 'data',
            size: 30 * 1024 * 1024, // 30MB (> 25MB limit)
          },
        ],
      };

      const validation = validateSendRequest(invalidAttachmentRequest);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toEqual(
        expect.arrayContaining([
          'Attachment missing filename or content',
          expect.stringContaining('Attachment too large: oversized.zip'),
        ])
      );
    });
  });

  describe('generateIdempotencyKey', () => {
    it('produces deterministic key based on agentName and email content', async () => {
      const req: SendEmailRequest = {
        to: ['user1@example.com', 'user2@example.com'],
        subject: 'Idempotency Test',
        text: 'Deterministic body content.',
      };

      const key1 = await generateIdempotencyKey('agent-alice', req);
      const key2 = await generateIdempotencyKey('agent-alice', req);

      expect(key1).toBe(key2);
      expect(key1.startsWith('agent-alice:')).toBe(true);
      expect(key1.length).toBeGreaterThan(12);
    });

    it('produces different keys when sender or contents differ', async () => {
      const req1: SendEmailRequest = {
        to: 'user@example.com',
        subject: 'Subject 1',
        text: 'Body',
      };
      const req2: SendEmailRequest = {
        to: 'user@example.com',
        subject: 'Subject 2',
        text: 'Body',
      };

      const keyAlice = await generateIdempotencyKey('agent-alice', req1);
      const keyBob = await generateIdempotencyKey('agent-bob', req1);
      const keyDiffSubject = await generateIdempotencyKey('agent-alice', req2);

      expect(keyAlice).not.toBe(keyBob);
      expect(keyAlice).not.toBe(keyDiffSubject);
    });
  });

  describe('Custom PAI Email Errors', () => {
    it('instantiates PAIEmailError with correct defaults', () => {
      const err = new PAIEmailError('System error', 'SYS_ERR', 500, { detail: 'info' });
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('PAIEmailError');
      expect(err.code).toBe('SYS_ERR');
      expect(err.statusCode).toBe(500);
      expect(err.details).toEqual({ detail: 'info' });
    });

    it('instantiates ValidationError with 400 status', () => {
      const err = new ValidationError('Invalid input');
      expect(err.name).toBe('ValidationError');
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.statusCode).toBe(400);
    });

    it('instantiates AuthenticationError with 401 status', () => {
      const err = new AuthenticationError();
      expect(err.name).toBe('AuthenticationError');
      expect(err.code).toBe('AUTHENTICATION_ERROR');
      expect(err.statusCode).toBe(401);
    });

    it('instantiates AuthorizationError with 403 status', () => {
      const err = new AuthorizationError();
      expect(err.name).toBe('AuthorizationError');
      expect(err.code).toBe('AUTHORIZATION_ERROR');
      expect(err.statusCode).toBe(403);
    });

    it('instantiates RateLimitError with 429 status and retryAfterMs', () => {
      const err = new RateLimitError('Too many requests', 5000);
      expect(err.name).toBe('RateLimitError');
      expect(err.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(err.statusCode).toBe(429);
      expect(err.retryAfterMs).toBe(5000);
    });

    it('instantiates NotFoundError with 404 status', () => {
      const err = new NotFoundError('Agent');
      expect(err.name).toBe('NotFoundError');
      expect(err.code).toBe('NOT_FOUND');
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('Agent not found');
    });

    it('instantiates UpstreamError with 502 status', () => {
      const err = new UpstreamError('Resend API', 'Connection timeout');
      expect(err.name).toBe('UpstreamError');
      expect(err.code).toBe('UPSTREAM_ERROR');
      expect(err.statusCode).toBe(502);
      expect(err.message).toBe('Resend API error: Connection timeout');
    });
  });
});
