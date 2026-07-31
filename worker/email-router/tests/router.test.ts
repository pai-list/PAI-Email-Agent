/**
 * Unit tests for Email Router
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseEmailMessage, extractAgentName, validateAgentEmail } from '../src/router.js';
import type { EmailMessage } from '../shared/types.js';

describe('Email Router', () => {
  describe('parseEmailMessage', () => {
    it('parses basic email with text content', () => {
      const formData = new FormData();
      formData.append('from', 'sender@example.com');
      formData.append('to', 'alice@agents.axiomid.app');
      formData.append('subject', 'Test Subject');
      formData.append('text', 'Hello World!');
      formData.append('headers', JSON.stringify({ 'message-id': '<test@123>' }));

      const result = parseEmailMessage(formData);

      expect(result).toEqual({
        from: { email: 'sender@example.com', name: '' },
        to: [{ email: 'alice@agents.axiomid.app', name: '' }],
        subject: 'Test Subject',
        text: 'Hello World!',
        html: undefined,
        headers: { 'message-id': '<test@123>' },
        attachments: [],
      });
    });

    it('parses email with HTML content', () => {
      const formData = new FormData();
      formData.append('from', 'sender@example.com');
      formData.append('to', 'alice@agents.axiomid.app');
      formData.append('subject', 'HTML Email');
      formData.append('html', '<h1>Hello</h1>');

      const result = parseEmailMessage(formData);
      expect(result.html).toBe('<h1>Hello</h1>');
      expect(result.text).toBeUndefined();
    });

    it('parses email with both text and HTML', () => {
      const formData = new FormData();
      formData.append('from', 'sender@example.com');
      formData.append('to', 'alice@agents.axiomid.app');
      formData.append('subject', 'Both');
      formData.append('text', 'Plain text');
      formData.append('html', '<p>HTML</p>');

      const result = parseEmailMessage(formData);
      expect(result.text).toBe('Plain text');
      expect(result.html).toBe('<p>HTML</p>');
    });

    it('parses multiple recipients', () => {
      const formData = new FormData();
      formData.append('to', 'alice@agents.axiomid.app,bob@agents.axiomid.app');

      const result = parseEmailMessage(formData);
      expect(result.to).toHaveLength(2);
      expect(result.to[0].email).toBe('alice@agents.axiomid.app');
      expect(result.to[1].email).toBe('bob@agents.axiomid.app');
    });

    it('handles CC recipients', () => {
      const formData = new FormData();
      formData.append('cc', 'cc@example.com');

      const result = parseEmailMessage(formData);
      expect(result.cc).toHaveLength(1);
      expect(result.cc[0].email).toBe('cc@example.com');
    });

    it('parses attachments', () => {
      const formData = new FormData();
      formData.append('attachment-count', '1');
      formData.append('attachment-1', new Blob(['test'], { type: 'text/plain' }), 'test.txt');
      formData.append('attachment-info-1', JSON.stringify({
        filename: 'test.txt',
        contentType: 'text/plain',
        size: 4,
        disposition: 'attachment',
      }));

      const result = parseEmailMessage(formData);
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].filename).toBe('test.txt');
    });
  });

  describe('extractAgentName', () => {
    it('extracts agent name from agents.axiomid.app', () => {
      expect(extractAgentName('alice@agents.axiomid.app')).toBe('alice');
      expect(extractAgentName('bob-smith@agents.axiomid.app')).toBe('bob-smith');
      expect(extractAgentName('agent123@agents.axiomid.app')).toBe('agent123');
    });

    it('returns null for non-agent domains', () => {
      expect(extractAgentName('user@gmail.com')).toBeNull();
      expect(extractAgentName('test@axiomid.app')).toBeNull();
      expect(extractAgentName('admin@sub.axiomid.app')).toBeNull();
    });

    it('handles case insensitivity', () => {
      expect(extractAgentName('ALICE@agents.axiomid.app')).toBe('ALICE');
      expect(extractAgentName('Alice@agents.axiomid.app')).toBe('Alice');
    });
  });

  describe('validateAgentEmail', () => {
    it('validates correct agent email', () => {
      expect(validateAgentEmail('alice@agents.axiomid.app')).toBe(true);
      expect(validateAgentEmail('bob@agents.axiomid.app')).toBe(true);
      expect(validateAgentEmail('agent-name@agents.axiomid.app')).toBe(true);
    });

    it('rejects invalid formats', () => {
      expect(validateAgentEmail('alice@agents.axiomid.app.extra')).toBe(false);
      expect(validateAgentEmail('@agents.axiomid.app')).toBe(false);
      expect(validateAgentEmail('alice@')).toBe(false);
      expect(validateAgentEmail('')).toBe(false);
    });
  });
});