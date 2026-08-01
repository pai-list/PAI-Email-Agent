/**
 * Unit tests for Webhook Processor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { calculateBackoff } from '../src/index.js';
import { mapStatusToEvent } from '../../shared/src/status.js';
import type { WebhookEventType, EmailStatusPayload } from '../../shared/src/types.js';

describe('Webhook Processor', () => {
  describe('calculateBackoff', () => {
    it('returns 1000ms for first attempt', () => {
      expect(calculateBackoff(1)).toBe(1000);
    });

    it('doubles each attempt', () => {
      expect(calculateBackoff(2)).toBe(2000);
      expect(calculateBackoff(3)).toBe(4000);
      expect(calculateBackoff(4)).toBe(8000);
      expect(calculateBackoff(5)).toBe(16000);
      expect(calculateBackoff(6)).toBe(32000);
    });

    it('caps at 5 minutes (300000ms)', () => {
      expect(calculateBackoff(10)).toBe(300000);
      expect(calculateBackoff(20)).toBe(300000);
      expect(calculateBackoff(100)).toBe(300000);
    });

    it('handles edge cases', () => {
      expect(calculateBackoff(0)).toBe(1000); // Treat 0 as 1
      expect(calculateBackoff(-1)).toBe(1000); // Negative treated as 1
    });
  });

  describe('mapStatusToEvent', () => {
    const testCases: Array<[EmailStatusPayload['status'], WebhookEventType]> = [
      ['delivered', 'email.delivered'],
      ['bounced', 'email.bounced'],
      ['complained', 'email.complained'],
      ['opened', 'email.opened'],
      ['clicked', 'email.clicked'],
      ['unsubscribed', 'email.unsubscribed'],
      ['queued', 'email.delivered'], // default
      ['failed', 'email.delivered'], // default
      ['unknown' as any, 'email.delivered'], // default for unknown
    ];

    testCases.forEach(([status, expectedEvent]) => {
      it(`maps ${status} to ${expectedEvent}`, () => {
        expect(mapStatusToEvent(status)).toBe(expectedEvent);
      });
    });
  });
});