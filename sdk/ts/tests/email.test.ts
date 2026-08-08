import { describe, it, expect } from 'vitest';
import {
  validateAgentEmail,
  validatePassportClaims,
  isValidAgentId,
  extractAgentIdFromEmail,
  AgentEmailSchema,
  PassportClaimsSchema,
} from '../src/email.js';

describe('SDK Email Utilities & Schemas', () => {
  describe('validateAgentEmail & AgentEmailSchema', () => {
    it('validates a correct AgentEmail payload', () => {
      const validPayload = {
        to: 'bob@agents.axiomid.app',
        from: 'alice@agents.axiomid.app',
        subject: 'Hello World',
        body: 'This is a test email message content.',
        agentId: 'alice-agent-1',
        timestamp: '2026-08-07T05:00:00.000Z',
        headers: { 'X-Priority': 'High' },
        attachments: [
          {
            filename: 'doc.pdf',
            contentType: 'application/pdf',
            size: 1024,
            contentId: 'cid-1',
          },
        ],
      };

      const result = validateAgentEmail(validPayload);
      expect(result.to).toBe('bob@agents.axiomid.app');
      expect(result.from).toBe('alice@agents.axiomid.app');
      expect(result.subject).toBe('Hello World');
      expect(result.agentId).toBe('alice-agent-1');
      expect(result.attachments).toHaveLength(1);
    });

    it('throws validation error for invalid email formats', () => {
      const invalidPayload = {
        to: 'not-an-email',
        from: 'alice@agents.axiomid.app',
        subject: 'Subject',
        body: 'Body',
        agentId: 'alice-agent',
        timestamp: '2026-08-07T05:00:00.000Z',
      };

      expect(() => validateAgentEmail(invalidPayload)).toThrow();
    });

    it('throws validation error if subject exceeds 200 characters', () => {
      const longSubjectPayload = {
        to: 'bob@agents.axiomid.app',
        from: 'alice@agents.axiomid.app',
        subject: 'A'.repeat(201),
        body: 'Body',
        agentId: 'alice-agent',
        timestamp: '2026-08-07T05:00:00.000Z',
      };

      expect(() => validateAgentEmail(longSubjectPayload)).toThrow();
    });

    it('throws validation error if body exceeds 65536 characters', () => {
      const longBodyPayload = {
        to: 'bob@agents.axiomid.app',
        from: 'alice@agents.axiomid.app',
        subject: 'Subject',
        body: 'B'.repeat(65537),
        agentId: 'alice-agent',
        timestamp: '2026-08-07T05:00:00.000Z',
      };

      expect(() => validateAgentEmail(longBodyPayload)).toThrow();
    });

    it('throws validation error if attachments count exceeds 10', () => {
      const attachments = Array.from({ length: 11 }, (_, i) => ({
        filename: `file${i}.txt`,
        contentType: 'text/plain',
        size: 10,
      }));

      const payload = {
        to: 'bob@agents.axiomid.app',
        from: 'alice@agents.axiomid.app',
        subject: 'Subject',
        body: 'Body',
        agentId: 'alice-agent',
        timestamp: '2026-08-07T05:00:00.000Z',
        attachments,
      };

      expect(() => validateAgentEmail(payload)).toThrow();
    });
  });

  describe('validatePassportClaims & PassportClaimsSchema', () => {
    const validPassport = {
      iss: 'https://passport.pai.agent',
      sub: 'did:axiom:agent:alice123',
      aud: ['https://api.pai.agent'],
      iat: 1770000000,
      exp: 1780000000,
      nonce: 'a'.repeat(32),
      email: {
        address: 'alice@agents.axiomid.app',
        verified: true,
        domain: 'agents.axiomid.app',
        localPart: 'alice',
        routing: 'cloudflare-email-worker',
      },
      agent: {
        id: 'ag_alice123',
        name: 'Alice Agent',
        subdomain: 'alice.axiomid.app',
        owner: 'user_123',
        status: 'active',
        mode: 'autonomous',
      },
      capabilities: {
        sendEmail: {
          enabled: true,
          provider: 'resend',
          dailyLimit: 100,
          monthlyLimit: 3000,
          templates: ['welcome', 'notification'],
        },
        receiveEmail: {
          enabled: true,
          routing: 'cloudflare-catch-all',
          maxSizeKB: 10240,
        },
      },
      permissions: {
        scopes: ['email:send', 'email:read'],
        delegatedFrom: [],
        delegatedTo: [],
      },
    };

    it('validates a correct PassportClaims structure', () => {
      const result = validatePassportClaims(validPassport);
      expect(result.iss).toBe('https://passport.pai.agent');
      expect(result.sub).toBe('did:axiom:agent:alice123');
      expect(result.agent.id).toBe('ag_alice123');
      expect(result.capabilities.sendEmail.provider).toBe('resend');
    });

    it('rejects passport with invalid DID subject format', () => {
      const invalidPassport = {
        ...validPassport,
        sub: 'invalid-subject-format',
      };
      expect(() => validatePassportClaims(invalidPassport)).toThrow();
    });

    it('rejects passport with nonce shorter than 32 characters', () => {
      const invalidPassport = {
        ...validPassport,
        nonce: 'too-short',
      };
      expect(() => validatePassportClaims(invalidPassport)).toThrow();
    });

    it('rejects passport with unsupported email provider', () => {
      const invalidPassport = {
        ...validPassport,
        capabilities: {
          ...validPassport.capabilities,
          sendEmail: {
            ...validPassport.capabilities.sendEmail,
            provider: 'smtp' as any,
          },
        },
      };
      expect(() => validatePassportClaims(invalidPassport)).toThrow();
    });
  });

  describe('isValidAgentId', () => {
    it('returns true for valid ag_ formatted IDs', () => {
      expect(isValidAgentId('ag_alice123')).toBe(true);
      expect(isValidAgentId('ag_agent99')).toBe(true);
    });

    it('returns false for invalid formats', () => {
      expect(isValidAgentId('alice123')).toBe(false);
      expect(isValidAgentId('AG_ALICE')).toBe(false);
      expect(isValidAgentId('ag_alice-123')).toBe(false);
      expect(isValidAgentId('')).toBe(false);
    });
  });

  describe('extractAgentIdFromEmail', () => {
    it('extracts valid agent local part from email', () => {
      expect(extractAgentIdFromEmail('alice@agents.axiomid.app')).toBe('alice');
      expect(extractAgentIdFromEmail('bot-99@domain.com')).toBe('bot-99');
    });

    it('returns null for invalid or missing local part', () => {
      expect(extractAgentIdFromEmail('a@domain.com')).toBeNull(); // <3 chars
      expect(extractAgentIdFromEmail('invalidemail.com')).toBeNull();
      expect(extractAgentIdFromEmail('@domain.com')).toBeNull();
    });
  });
});
