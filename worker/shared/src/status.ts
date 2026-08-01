/**
 * Shared email status mapping utilities for PAI-Email-Agent
 */

import type { EmailStatusPayload, WebhookEventType } from './types.js';

export function mapStatusToEvent(status: EmailStatusPayload['status']): WebhookEventType {
  switch (status) {
    case 'delivered': return 'email.delivered';
    case 'bounced': return 'email.bounced';
    case 'complained': return 'email.complained';
    case 'opened': return 'email.opened';
    case 'clicked': return 'email.clicked';
    case 'unsubscribed': return 'email.unsubscribed';
    default: return 'email.delivered';
  }
}
