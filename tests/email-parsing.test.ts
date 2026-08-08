import { describe, it, expect } from 'vitest';
import {
  extractAgentName,
  parseEmailMessage,
  validateAgentEmail,
  validateEmailForRouting,
  normalizeEmailForStorage,
} from '../worker/email-router/src/router.js';
import type { EmailMessage } from '../worker/shared/src/types.js';

describe('Email Parsing & Routing Suite', () => {
  describe('extractAgentName', () => {
    it('extracts valid agent name from recipient address', () => {
      expect(extractAgentName(['alice@agents.axiomid.app'])).toBe('alice');
      expect(extractAgentName(['agent-007@agents.axiomid.app'])).toBe('agent-007');
      expect(extractAgentName(['sub_agent_1@agents.axiomid.app'])).toBe('sub_agent_1');
    });

    it('handles formatted recipient name with angle brackets', () => {
      expect(extractAgentName(['Alice Agent <alice@agents.axiomid.app>'])).toBe('alice');
    });

    it('returns null for non-matching domains', () => {
      expect(extractAgentName(['alice@otherdomain.com'])).toBeNull();
      expect(extractAgentName(['alice@axiomid.app'])).toBeNull();
      expect(extractAgentName(['alice@sub.agents.axiomid.app'])).toBeNull();
    });

    it('returns null for invalid agent name characters or lengths', () => {
      // Must start with alphanumeric, max 63 chars
      expect(extractAgentName(['-invalid@agents.axiomid.app'])).toBeNull();
      expect(extractAgentName(['_invalid@agents.axiomid.app'])).toBeNull();
      expect(extractAgentName([`${'a'.repeat(64)}@agents.axiomid.app`])).toBeNull();
    });

    it('finds the first valid agent in a multi-recipient list', () => {
      const recipients = ['user@gmail.com', 'support@company.com', 'charlie@agents.axiomid.app'];
      expect(extractAgentName(recipients)).toBe('charlie');
    });
  });

  describe('validateAgentEmail', () => {
    it('returns true for valid agent email addresses', () => {
      expect(validateAgentEmail('alice@agents.axiomid.app')).toBe(true);
      expect(validateAgentEmail('Bob <bob@agents.axiomid.app>')).toBe(true);
    });

    it('returns false for non-agent email addresses', () => {
      expect(validateAgentEmail('alice@gmail.com')).toBe(false);
      expect(validateAgentEmail('invalid-format')).toBe(false);
    });
  });

  describe('parseEmailMessage', () => {
    it('parses complete raw email message into structured email object', () => {
      const rawMsg: EmailMessage = {
        from: 'Alice Sender <alice@sender.org>',
        to: ['Bob Agent <bob@agents.axiomid.app>', 'carol@agents.axiomid.app'],
        subject: 'Project Update ',
        text: ' Here is the latest status. ',
        html: '<p> Here is the latest status. </p>',
        headers: {
          'Message-ID': '<msg-12345@sender.org>',
          'Date': 'Fri, 07 Aug 2026 05:00:00 GMT',
          'CC': 'Dave <dave@sender.org>, Eve <eve@sender.org>',
          'Content-Type': 'multipart/mixed',
        },
        attachments: [
          {
            filename: 'report.pdf',
            contentType: 'application/pdf',
            content: 'JVBERi0xLjQK...',
            size: 2048,
          },
        ],
        rawSize: 3000,
      };

      const parsed = parseEmailMessage(rawMsg);

      expect(parsed.from).toEqual({ name: 'Alice Sender', email: 'alice@sender.org' });
      expect(parsed.to).toHaveLength(2);
      expect(parsed.to[0]).toEqual({ name: 'Bob Agent', email: 'bob@agents.axiomid.app' });
      expect(parsed.to[1]).toEqual({ email: 'carol@agents.axiomid.app' });
      expect(parsed.cc).toHaveLength(2);
      expect(parsed.cc[0]).toEqual({ name: 'Dave', email: 'dave@sender.org' });
      expect(parsed.cc[1]).toEqual({ email: 'eve@sender.org' });
      expect(parsed.subject).toBe('Project Update ');
      expect(parsed.text).toBe(' Here is the latest status. ');
      expect(parsed.html).toBe('<p> Here is the latest status. </p>');
      expect(parsed.headers['message-id']).toBe('<msg-12345@sender.org>');
      expect(parsed.headers['content-type']).toBe('multipart/mixed');
      expect(parsed.attachments).toHaveLength(1);
    });

    it('generates message-id header and default subject if missing', () => {
      const rawMsg: EmailMessage = {
        from: 'sender@example.com',
        to: ['alice@agents.axiomid.app'],
        subject: '',
        headers: {},
        attachments: [],
        rawSize: 500,
      };

      const parsed = parseEmailMessage(rawMsg);
      expect(parsed.subject).toBe('(no subject)');
      expect(parsed.headers['message-id']).toMatch(/^<[a-z0-9.]*@axiomid\.app>$/);
      expect(parsed.headers['date']).toBeDefined();
    });
  });

  describe('validateEmailForRouting', () => {
    it('approves emails with valid sender and agent recipient', () => {
      const parsed = parseEmailMessage({
        from: 'user@example.com',
        to: ['agent@agents.axiomid.app'],
        subject: 'Hi',
        headers: {},
        attachments: [],
        rawSize: 100,
      });

      const validation = validateEmailForRouting(parsed);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('fails when sender is missing or empty', () => {
      const parsed = parseEmailMessage({
        from: '',
        to: ['agent@agents.axiomid.app'],
        subject: 'Hi',
        headers: {},
        attachments: [],
        rawSize: 100,
      });
      parsed.from = { email: '' };

      const validation = validateEmailForRouting(parsed);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Missing sender email');
    });

    it('fails when no agent recipient exists in the destination list', () => {
      const parsed = parseEmailMessage({
        from: 'user@example.com',
        to: ['user2@example.com'],
        subject: 'Hi',
        headers: {},
        attachments: [],
        rawSize: 100,
      });

      const validation = validateEmailForRouting(parsed);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('No valid agent recipient found');
    });
  });

  describe('normalizeEmailForStorage', () => {
    it('normalizes email addresses, subject, and text bodies', () => {
      const parsed = parseEmailMessage({
        from: 'Alice.Sender@EXAMPLE.com',
        to: ['BOB@AGENTS.AXIOMID.APP'],
        subject: '  Urgent Request  ',
        text: '  Please reply ASAP.  ',
        html: '  <div>Please reply ASAP.</div>  ',
        headers: {},
        attachments: [],
        rawSize: 200,
      });

      const normalized = normalizeEmailForStorage(parsed);
      expect(normalized.from.email).toBe('alice.sender@example.com');
      expect(normalized.to[0].email).toBe('bob@agents.axiomid.app');
      expect(normalized.subject).toBe('Urgent Request');
      expect(normalized.text).toBe('Please reply ASAP.');
      expect(normalized.html).toBe('<div>Please reply ASAP.</div>');
    });
  });
});
