import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { ResendEmailClient, createResendClient } from '../src/resend.js';
import type { PassportClaims, EmailAgentConfig } from '../src/email.js';

// Mock Resend SDK
vi.mock('resend', () => {
  return {
    Resend: vi.fn().mockImplementation(() => ({
      emails: {
        send: vi.fn().mockResolvedValue({ id: 're_mock_12345' }),
      },
    })),
  };
});

describe('SDK ResendEmailClient', () => {
  const config: EmailAgentConfig = {
    resendApiKey: 're_test_key_123',
    fromDomain: 'axiomid.app',
    defaultFromName: 'PAI Agent',
    passportIssuer: 'https://passport.pai.agent',
    passportPrivateKey: 'mockPrivateKeyBase64',
    passportKeyId: 'pai-passport-2026-01',
  };

  const validPassport: PassportClaims = {
    iss: 'https://passport.pai.agent',
    sub: 'did:axiom:agent:alice123',
    aud: ['https://api.pai.agent'],
    iat: Math.floor(Date.now() / 1000) - 60,
    exp: Math.floor(Date.now() / 1000) + 3600,
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
        templates: ['welcome', 'notification', 'verification'],
      },
      receiveEmail: {
        enabled: true,
        routing: 'cloudflare-catch-all',
        maxSizeKB: 10240,
      },
    },
    permissions: {
      scopes: ['email:send', 'email:read'],
    },
  };

  let client: ResendEmailClient;

  beforeEach(() => {
    client = createResendClient(config);
  });

  describe('createResendClient & Constructor', () => {
    it('instantiates ResendEmailClient with config', () => {
      expect(client).toBeInstanceOf(ResendEmailClient);
    });
  });

  describe('Passport Validation during send', () => {
    it('throws error if email send capability is disabled', async () => {
      const passport: PassportClaims = {
        ...validPassport,
        capabilities: {
          ...validPassport.capabilities,
          sendEmail: { ...validPassport.capabilities.sendEmail, enabled: false },
        },
      };

      await expect(
        client.sendEmail({
          to: 'user@example.com',
          subject: 'Test',
          react: React.createElement('div', null, 'Hello'),
          passport,
        })
      ).rejects.toThrow('SEND_DISABLED');
    });

    it('throws error if provider is not resend', async () => {
      const passport: PassportClaims = {
        ...validPassport,
        capabilities: {
          ...validPassport.capabilities,
          sendEmail: { ...validPassport.capabilities.sendEmail, provider: 'smtp' as any },
        },
      };

      await expect(
        client.sendEmail({
          to: 'user@example.com',
          subject: 'Test',
          react: React.createElement('div', null, 'Hello'),
          passport,
        })
      ).rejects.toThrow('INVALID_PROVIDER');
    });

    it('throws error if template is not in allowed list', async () => {
      await expect(
        client.sendEmail({
          to: 'user@example.com',
          subject: 'Test',
          react: React.createElement('div', null, 'Hello'),
          templateName: 'unapproved_template',
          passport: validPassport,
        })
      ).rejects.toThrow('TEMPLATE_NOT_ALLOWED');
    });

    it('throws error if email domain is not verified', async () => {
      const passport: PassportClaims = {
        ...validPassport,
        email: { ...validPassport.email, verified: false },
      };

      await expect(
        client.sendEmail({
          to: 'user@example.com',
          subject: 'Test',
          react: React.createElement('div', null, 'Hello'),
          passport,
        })
      ).rejects.toThrow('DOMAIN_NOT_VERIFIED');
    });

    it('throws error if passport is expired', async () => {
      const passport: PassportClaims = {
        ...validPassport,
        exp: Math.floor(Date.now() / 1000) - 3600, // expired 1h ago
      };

      await expect(
        client.sendEmail({
          to: 'user@example.com',
          subject: 'Test',
          react: React.createElement('div', null, 'Hello'),
          passport,
        })
      ).rejects.toThrow('PASSPORT_EXPIRED');
    });
  });

  describe('sendEmail & sendTemplate', () => {
    it('sends email successfully with valid passport', async () => {
      const result = await client.sendEmail({
        to: 'user@example.com',
        subject: 'Welcome to PAI',
        react: React.createElement('p', null, 'Welcome aboard'),
        passport: validPassport,
      });

      expect(result).toHaveProperty('id');
      expect(result.id).toBe('re_mock_12345');
    });

    it('sends email with template successfully', async () => {
      const result = await client.sendTemplate({
        to: 'user@example.com',
        templateName: 'welcome',
        data: { name: 'Bob', actionUrl: 'https://example.com' },
        passport: validPassport,
      });

      expect(result.id).toBe('re_mock_12345');
    });

    it('throws error for unknown template name', async () => {
      await expect(
        client.sendTemplate({
          to: 'user@example.com',
          templateName: 'non_existent' as any,
          data: {},
          passport: validPassport,
        })
      ).rejects.toThrow('TEMPLATE_NOT_FOUND');
    });
  });

  describe('getStats', () => {
    it('returns send statistics object', async () => {
      const stats = await client.getStats();
      expect(stats).toEqual({
        sent: 0,
        delivered: 0,
        bounced: 0,
        complained: 0,
        opened: 0,
        clicked: 0,
      });
    });
  });
});
