/**
 * Resend Webhook Handler
 * Processes delivery status updates from Resend
 */

import type { CloudflareEnv, ResendWebhookEvent, EmailStatusPayload } from '../../shared/types.js';
import { verifyHMAC } from '../../shared/crypto.js';
import { updateEmailStatus, notifyAgentWebhook } from './status-tracker.js';

// ──────────────────────────────────────────────────────────────
// Main Handler
// ──────────────────────────────────────────────────────────────

export async function handleResendWebhook(
  env: CloudflareEnv,
  payload: string,
  signature: string,
  correlationId: string
): Promise<{ success: boolean; processed: number; errors: string[] }> {
  const errors: string[] = [];
  let processed = 0;

  try {
    // Verify webhook signature
    const isValid = verifyHMAC(payload, signature, env.RESEND_WEBHOOK_SECRET);
    if (!isValid) {
      console.error(`[${correlationId}] Invalid Resend webhook signature`);
      return { success: false, processed: 0, errors: ['Invalid signature'] };
    }

    // Parse event
    const event = JSON.parse(payload) as ResendWebhookEvent;
    console.log(`[${correlationId}] Resend webhook: ${event.type} for ${event.data.email_id}`);

    // Convert to internal status payload
    const statusPayload = convertResendEvent(event);

    // Update email status in KV
    await updateEmailStatus(env, event.data.email_id, statusPayload);

    // Notify agent webhook (if agent is registered)
    await notifyAgentWebhook(env, event.data.email_id, statusPayload, correlationId);

    processed = 1;
    return { success: true, processed, errors: [] };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[${correlationId}] Resend webhook processing error:`, error);
    errors.push(errorMessage);
    return { success: false, processed, errors };
  }
}

// ──────────────────────────────────────────────────────────────
// Event Conversion
// ──────────────────────────────────────────────────────────────

function convertResendEvent(event: ResendWebhookEvent): EmailStatusPayload {
  const base: EmailStatusPayload = {
    messageId: event.data.email_id,
    status: mapResendStatus(event.type),
    timestamp: new Date(event.created_at).getTime(),
    recipient: event.data.to[0] || '',
    metadata: {
      from: event.data.from,
      subject: event.data.subject,
      resendEventType: event.type,
    },
  };

  // Add event-specific details
  switch (event.type) {
    case 'email.bounced':
      base.metadata.bounceType = event.data.bounce_type;
      base.metadata.bounceCode = event.data.bounce_code;
      base.metadata.bounceDescription = event.data.bounce_description;
      break;
    case 'email.complained':
      base.metadata.complaintFeedbackType = event.data.complaint_feedback_type;
      break;
    case 'email.clicked':
      base.metadata.clickLocation = event.data.click_location;
      break;
    case 'email.opened':
      base.metadata.userAgent = event.data.user_agent;
      base.metadata.ip = event.data.ip;
      break;
  }

  return base;
}

function mapResendStatus(type: ResendWebhookEvent['type']): EmailStatusPayload['status'] {
  switch (type) {
    case 'email.sent': return 'delivered'; // Resend "sent" means accepted for delivery
    case 'email.delivered': return 'delivered';
    case 'email.delivery_delayed': return 'delivered'; // Still delivered, just delayed
    case 'email.bounced': return 'bounced';
    case 'email.complained': return 'complained';
    case 'email.opened': return 'opened';
    case 'email.clicked': return 'clicked';
    case 'email.unsubscribed': return 'unsubscribed';
    default: return 'delivered';
  }
}