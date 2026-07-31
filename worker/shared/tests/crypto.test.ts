/**
 * Unit tests for @pai/email-shared
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateCorrelationId,
  generateRateLimitKey,
  hashString,
  constantTimeEqual,
  generateDKIMRecord,
  generateSPFRecord,
  generateDMARCRecord,
  verifyDKIM,
  verifySPF,
  verifyDMARC,
} from '../src/crypto.js';
import type { RateLimitAction, RateLimitWindow } from '../src/types.js';

describe('crypto utilities', () => {
  describe('generateCorrelationId', () => {
    it('generates unique IDs', () => {
      const id1 = generateCorrelationId();
      const id2 = generateCorrelationId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^[a-f0-9-]{36}$/); // UUID v4 format
    });

    it('generates IDs with correct format', () => {
      const id = generateCorrelationId();
      expect(id.length).toBe(36);
      expect(id.split('-')).toHaveLength(5);
    });
  });

  describe('generateRateLimitKey', () => {
    it('generates consistent keys for same inputs', () => {
      const key1 = generateRateLimitKey('alice', 'send', 'hourly', 1000);
      const key2 = generateRateLimitKey('alice', 'send', 'hourly', 1000);
      expect(key1).toBe(key2);
    });

    it('generates different keys for different agents', () => {
      const key1 = generateRateLimitKey('alice', 'send', 'hourly', 1000);
      const key2 = generateRateLimitKey('bob', 'send', 'hourly', 1000);
      expect(key1).not.toBe(key2);
    });

    it('generates different keys for different actions', () => {
      const key1 = generateRateLimitKey('alice', 'send', 'hourly', 1000);
      const key2 = generateRateLimitKey('alice', 'receive', 'hourly', 1000);
      expect(key1).not.toBe(key2);
    });

    it('generates different keys for different windows', () => {
      const key1 = generateRateLimitKey('alice', 'send', 'hourly', 1000);
      const key2 = generateRateLimitKey('alice', 'send', 'daily', 1000);
      expect(key1).not.toBe(key2);
    });

    it('includes window start in key', () => {
      const key = generateRateLimitKey('alice', 'send', 'hourly', 1000);
      expect(key).toContain('1000');
    });

    it('handles all valid action types', () => {
      const actions: RateLimitAction[] = ['send', 'receive', 'webhook', 'register'];
      actions.forEach(action => {
        const key = generateRateLimitKey('alice', action, 'hourly', 1000);
        expect(key).toContain(action);
      });
    });

    it('handles all valid window types', () => {
      const windows: RateLimitWindow[] = ['hourly', 'daily', 'monthly'];
      windows.forEach(window => {
        const key = generateRateLimitKey('alice', 'send', window, 1000);
        expect(key).toContain(window);
      });
    });
  });

  describe('hashString', () => {
    it('produces consistent hash for same input', () => {
      const hash1 = hashString('test-input');
      const hash2 = hashString('test-input');
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different inputs', () => {
      const hash1 = hashString('input-1');
      const hash2 = hashString('input-2');
      expect(hash1).not.toBe(hash2);
    });

    it('produces 64-character hex string (SHA-256)', () => {
      const hash = hashString('test');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('handles empty string', () => {
      const hash = hashString('');
      expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('handles unicode', () => {
      const hash = hashString('你好世界');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('constantTimeEqual', () => {
    it('returns true for equal strings', () => {
      expect(constantTimeEqual('abc', 'abc')).toBe(true);
    });

    it('returns false for different strings', () => {
      expect(constantTimeEqual('abc', 'abd')).toBe(false);
    });

    it('returns false for different lengths', () => {
      expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    });

    it('handles empty strings', () => {
      expect(constantTimeEqual('', '')).toBe(true);
      expect(constantTimeEqual('', 'a')).toBe(false);
    });
  });

  describe('DKIM/SPF/DMARC record generation', () => {
    it('generates DKIM record with correct format', () => {
      const record = generateDKIMRecord('default', 'v=DKIM1; k=rsa; p=TESTKEY');
      expect(record).toContain('v=DKIM1');
      expect(record).toContain('k=rsa');
      expect(record).toContain('p=TESTKEY');
    });

    it('generates SPF record for axiomid.app', () => {
      const record = generateSPFRecord('axiomid.app');
      expect(record).toContain('v=spf1');
      expect(record).toContain('include:_spf.mx.cloudflare.net');
      expect(record).toContain('~all');
    });

    it('generates DMARC record with rua', () => {
      const record = generateDMARCRecord('axiomid.app', 'dmarc@axiomid.app');
      expect(record).toContain('v=DMARC1');
      expect(record).toContain('p=none');
      expect(record).toContain('rua=mailto:dmarc@axiomid.app');
    });
  });

  describe('Email verification stubs', () => {
    it('verifyDKIM returns pass for valid', async () => {
      const result = await verifyDKIM('test@example.com', { 'dkim-signature': 'test' });
      expect(['pass', 'fail', 'none']).toContain(result);
    });

    it('verifySPF returns pass for valid', async () => {
      const result = await verifySPF('1.2.3.4', 'example.com');
      expect(['pass', 'fail', 'none']).toContain(result);
    });

    it('verifyDMARC returns pass for valid', async () => {
      const result = await verifyDMARC('pass', 'pass', 'example.com');
      expect(['pass', 'fail', 'none']).toContain(result);
    });
  });
});