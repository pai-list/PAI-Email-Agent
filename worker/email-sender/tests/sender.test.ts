/**
 * Unit tests for Email Sender
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateSendRequest, formatResendPayload, calculateRateLimitUsage } from '../src/sender.js';
import type { SendEmailRequest, CloudflareEnv, AgentPassportClaims } from '../../shared/types.js';

describe('Email Sender', () => {
  describe('validateSendRequest', () => {
    const validClaims: AgentPassportClaims = {
      agentName: 'alice',
      agentDomain: 'alice.axiomid.app',
      permissions: ['email:send', 'email:receive'],
      emailQuota: { hourly: 100, daily: 1000, monthly: 10000 },
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      iss: 'pai-email-agent',
      aud: 'pai-agents',
    };

    const validRequest: SendEmailRequest = {
      to: 'recipient@example.com',
      subject: 'Test',
      text: 'Hello',
    };

    it('accepts valid request with all permissions', () => {
      const result = validateSendRequest(validRequest, validClaims);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('rejects request without email:send permission', () => {
      const claims = { ...validClaims, permissions: ['email:receive'] };
      const result = validateSendRequest(validRequest, claims);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('email:send');
    });

    it('rejects request with empty to field', () => {
      const request = { ...validRequest, to: '' };
      const result = validateSendRequest(request, validClaims);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('to');
    });

    it('rejects request with empty subject', () => {
      const request = { ...validRequest, subject: '' };
      const result = validateSendRequest(request, validClaims);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('subject');
    });

    it('rejects request with empty text and html', () => {
      const request = { ...validRequest, text: '', html: '' };
      const result = validateSendRequest(request, validClaims);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('text or html');
    });

    it('accepts request with only html', () => {
      const request = { ...validRequest, text: '', html: '<p>Hello</p>' };
      const result = validateSendRequest(request, validClaims);
      expect(result.valid).toBe(true);
    });

    it('accepts request with only text', () => {
      const request = { ...validRequest, html: '', text: 'Hello' };
      const result = validateSendRequest(request, validClaims);
      expect(result.valid).toBe(true);
    });

    it('validates email format in to field', () => {
      const request = { ...validRequest, to: 'invalid-email' };
      const result = validateSendRequest(request, validClaims);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('email');
    });

    it('validates email format in cc field', () => {
      const request = { ...validRequest, cc: 'invalid-email' };
      const result = validateSendRequest(request, validClaims);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cc');
    });

    it('validates email format in bcc field', () => {
      const request = { ...validRequest, bcc: 'invalid-email' };
      const result = validateSendRequest(request, validClaims);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('bcc');
    });

    it('accepts multiple valid emails in to', () => {
      const request = { ...validRequest, to: 'a@b.com, c@d.com' };
      const result = validateSendRequest(request, validClaims);
      expect(result.valid).toBe(true);
    });
  });

  describe('formatResendPayload', () => {
    it('formats basic email payload', () => {
      const request: SendEmailRequest = {
        to: 'recipient@example.com',
        subject: 'Test',
        text: 'Hello',
      };

      const payload = formatResendPayload(request, 'alice', 'alice.axiomid.app');

      expect(payload).toEqual({
        from: 'alice@agents.axiomid.app',
        to: ['recipient@example.com'],
        subject: 'Test',
        text: 'Hello',
        tags: expect.arrayContaining([
          { name: 'agent', value: 'alice' },
          { name: 'agent_domain', value: 'alice.axiomid.app' },
        ]),
      });
    });

    it('includes html when provided', () => {
      const request: SendEmailRequest = {
        to: 'recipient@example.com',
        subject: 'Test',
        text: 'Hello',
        html: '<p>Hello</p>',
      };

      const payload = formatResendPayload(request, 'alice', 'alice.axiomid.app');
      expect(payload.html).toBe('<p>Hello</p>');
    });

    it('includes cc when provided', () => {
      const request: SendEmailRequest = {
        to: 'recipient@example.com',
        cc: 'cc@example.com',
        subject: 'Test',
        text: 'Hello',
      };

      const payload = formatResendPayload(request, 'alice', 'alice.axiomid.app');
      expect(payload.cc).toEqual(['cc@example.com']);
    });

    it('includes bcc when provided', () => {
      const request: SendEmailRequest = {
        to: 'recipient@example.com',
        bcc: 'bcc@example.com',
        subject: 'Test',
        text: 'Hello',
      };

      const payload = formatResendPayload(request, 'alice', 'alice.axiomid.app');
      expect(payload.bcc).toEqual(['bcc@example.com']);
    });

    it('includes reply_to when provided', () => {
      const request: SendEmailRequest = {
        to: 'recipient@example.com',
        subject: 'Test',
        text: 'Hello',
        replyTo: 'reply@example.com',
      };

      const payload = formatResendPayload(request, 'alice', 'alice.axiomid.app');
      expect(payload.reply_to).toBe('reply@example.com');
    });

    it('includes attachments when provided', () => {
      const request: SendEmailRequest = {
        to: 'recipient@example.com',
        subject: 'Test',
        text: 'Hello',
        attachments: [{
          filename: 'test.txt',
          content: 'dGVzdA==', // base64 "test"
          contentType: 'text/plain',
        }],
      };

      const payload = formatResendPayload(request, 'alice', 'alice.axiomid.app');
      expect(payload.attachments).toHaveLength(1);
      expect(payload.attachments[0].filename).toBe('test.txt');
    });
  });

  describe('calculateRateLimitUsage', () => {
    it('calculates correct usage for hourly window', () => {
      const now = Date.now();
      const windowStart = now - (now % 3600000); // Start of current hour
      
      const usage = calculateRateLimitUsage([
        { window: 'hourly', count: 10, windowStart },
        { window: 'hourly', count: 5, windowStart - 3600000 }, // Previous hour
        { window: 'daily', count: 50, windowStart: now - (now % 86400000) },
      ], 'hourly', windowStart);

      expect(usage).toBe(10); // Only current hour counts
    });

    it('calculates correct usage for daily window', () => {
      const now = Date.now();
      const dailyStart = now - (now % 86400000);
      
      const usage = calculateRateLimitUsage([
        { window: 'hourly', count: 10, windowStart: now - (now % 3600000) },
        { window: 'daily', count: 50, windowStart: dailyStart },
        { window: 'daily', count: 20, windowStart: dailyStart - 86400000 }, // Previous day
      ], 'daily', dailyStart);

      expect(usage).toBe(50);
    });

    it('returns 0 for no matching windows', () => {
      const usage = calculateRateLimitUsage([
        { window: 'hourly', count: 10, windowStart: 1000 },
      ], 'monthly', 2000);
      expect(usage).toBe(0);
    });

    it('handles empty array', () => {
      const usage = calculateRateLimitUsage([], 'hourly', Date.now());
      expect(usage).toBe(0);
    });
  });
});