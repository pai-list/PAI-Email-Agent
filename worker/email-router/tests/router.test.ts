/**
 * Unit tests for Email Router
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseEmailMessage, extractAgentName, validateEmailForRouting } from '../src/router.js';
import type { EmailMessage } from '../../shared/src/types.js';

describe('Email Router', () => {
  describe('parseEmailMessage', () => {
    it('parses basic email with text content', () => {
      const email: EmailMessage = {
        from: 'sender@example.com',
        to: ['alice@agents.axiomid.app'],
        subject: 'Test Subject',
        text: 'Hello World!',
        html: undefined,
        headers: { 'message-id': '<test@123>' },
        attachments: [],
        rawSize: 100,
      };

      const result = parseEmailMessage(email);

      expect(result.from.email).toBe('sender@example.com');
      expect(result.to).toHaveLength(1);
      expect(result.to[0].email).toBe('alice@agents.axiomid.app');
      expect(result.subject).toBe('Test Subject');
      expect(result.text).toBe('Hello World!');
      expect(result.html).toBeUndefined();
      expect(result.headers['message-id']).toBe('<test@123>');
      expect(result.attachments).toEqual([]);
    });

    it('parses email with HTML content', () => {
      const email: EmailMessage = {
        from: 'sender@example.com',
        to: ['alice@agents.axiomid.app'],
        subject: 'HTML Email',
        text: undefined,
        html: '<h1>Hello</h1>',
        headers: {},
        attachments: [],
        rawSize: 100,
      };

      const result = parseEmailMessage(email);
      expect(result.html).toBe('<h1>Hello</h1>');
      expect(result.text).toBeUndefined();
    });

    it('parses email with both text and HTML', () => {
      const email: EmailMessage = {
        from: 'sender@example.com',
        to: ['alice@agents.axiomid.app'],
        subject: 'Both',
        text: 'Plain text',
        html: '<p>HTML</p>',
        headers: {},
        attachments: [],
        rawSize: 100,
      };

      const result = parseEmailMessage(email);
      expect(result.text).toBe('Plain text');
      expect(result.html).toBe('<p>HTML</p>');
    });

    it('parses multiple recipients', () => {
      const email: EmailMessage = {
        from: 'sender@example.com',
        to: ['alice@agents.axiomid.app', 'bob@agents.axiomid.app'],
        subject: 'Multiple',
        text: 'test',
        headers: {},
        attachments: [],
        rawSize: 100,
      };

      const result = parseEmailMessage(email);
      expect(result.to).toHaveLength(2);
      expect(result.to[0].email).toBe('alice@agents.axiomid.app');
      expect(result.to[1].email).toBe('bob@agents.axiomid.app');
    });

    it('handles CC recipients', () => {
      const email: EmailMessage = {
        from: 'sender@example.com',
        to: ['alice@agents.axiomid.app'],
        subject: 'CC test',
        text: 'test',
        headers: { cc: 'cc@example.com' },
        attachments: [],
        rawSize: 100,
      };

      const result = parseEmailMessage(email);
      expect(result.cc).toHaveLength(1);
      expect(result.cc[0].email).toBe('cc@example.com');
    });

    it('parses attachments', () => {
      const email: EmailMessage = {
        from: 'sender@example.com',
        to: ['alice@agents.axiomid.app'],
        subject: 'Attachment test',
        text: 'test',
        headers: {},
        attachments: [
          {
            filename: 'test.txt',
            contentType: 'text/plain',
            content: 'dGVzdA==', // base64 "test"
            size: 4,
          },
        ],
        rawSize: 100,
      };

      const result = parseEmailMessage(email);
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].filename).toBe('test.txt');
    });

    it('handles name with email format', () => {
      const email: EmailMessage = {
        from: 'John Doe <john@example.com>',
        to: ['alice@agents.axiomid.app'],
        subject: 'Name format',
        text: 'test',
        headers: {},
        attachments: [],
        rawSize: 100,
      };

      const result = parseEmailMessage(email);
      expect(result.from.name).toBe('John Doe');
      expect(result.from.email).toBe('john@example.com');
    });
  });

  describe('extractAgentName', () => {
    it('extracts agent name from agents.axiomid.app', () => {
      expect(extractAgentName(['alice@agents.axiomid.app'])).toBe('alice');
      expect(extractAgentName(['bob-smith@agents.axiomid.app'])).toBe('bob-smith');
      expect(extractAgentName(['agent123@agents.axiomid.app'])).toBe('agent123');
    });

    it('returns null for non-agent domains', () => {
      expect(extractAgentName(['user@gmail.com'])).toBeNull();
      expect(extractAgentName(['test@axiomid.app'])).toBeNull();
      expect(extractAgentName(['admin@sub.axiomid.app'])).toBeNull();
    });

    it('handles case insensitivity', () => {
      expect(extractAgentName(['ALICE@agents.axiomid.app'])).toBe('alice');
      expect(extractAgentName(['Alice@agents.axiomid.app'])).toBe('alice');
    });

    it('returns first valid agent in multiple recipients', () => {
      expect(extractAgentName(['user@gmail.com', 'alice@agents.axiomid.app'])).toBe('alice');
    });
  });

  describe('validateEmailForRouting', () => {
    it('validates correct agent email', () => {
      const email = {
        from: { email: 'sender@example.com', name: '' },
        to: [{ email: 'alice@agents.axiomid.app', name: '' }],
        subject: 'Test',
        text: 'test',
        headers: {},
        attachments: [],
      } as ReturnType<typeof parseEmailMessage>;

      const result = validateEmailForRouting(email);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects missing sender', () => {
      const email = {
        from: { email: '', name: '' },
        to: [{ email: 'alice@agents.axiomid.app', name: '' }],
        subject: 'Test',
        text: 'test',
        headers: {},
        attachments: [],
      } as ReturnType<typeof parseEmailMessage>;

      const result = validateEmailForRouting(email);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing sender email');
    });

    it('rejects no recipients', () => {
      const email = {
        from: { email: 'sender@example.com', name: '' },
        to: [],
        subject: 'Test',
        text: 'test',
        headers: {},
        attachments: [],
      } as ReturnType<typeof parseEmailMessage>;

      const result = validateEmailForRouting(email);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('No recipients');
    });

    it('rejects no agent recipient', () => {
      const email = {
        from: { email: 'sender@example.com', name: '' },
        to: [{ email: 'user@gmail.com', name: '' }],
        subject: 'Test',
        text: 'test',
        headers: {},
        attachments: [],
      } as ReturnType<typeof parseEmailMessage>;

      const result = validateEmailForRouting(email);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('No valid agent recipient found');
    });
  });
});