/**
 * Email sending logic via Resend API
 */

import type { CloudflareEnv, SendEmailRequest, SendEmailResponse, AgentPassportClaims, ResendEmailPayload, ResendResponse } from '../../shared/types.js';
import { generateCorrelationId, hashEmailContent } from '../../shared/crypto.js';

// ──────────────────────────────────────────────────────────────
// Rate Limiting
// ──────────────────────────────────────────────────────────────

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterMs?: number;
}

const RATE_LIMIT_WINDOWS = {
  hourly: 3600000,
  daily: 86400000,
  monthly: 2592000000, // 30 days
};

export async function checkRateLimit(
  env: CloudflareEnv,
  agentName: string,
  action: 'send' | 'webhook' | 'api',
  window: 'hourly' | 'daily' | 'monthly'
): Promise<RateLimitResult> {
  const key = `ratelimit:${agentName}:${action}:${window}`;
  const windowMs = RATE_LIMIT_WINDOWS[window];
  const now = Date.now();
  const windowStart = now - (now % windowMs);
  const windowKey = `${key}:${windowStart}`;

  // Get current count
  const current = await env.RATE_LIMIT_KV.get(windowKey);
  const count = current ? parseInt(current, 10) : 0;

  // Get limit from env or use defaults
  const limit = getLimitForAgent(env, agentName, window);

  const remaining = Math.max(0, limit - count);
  const resetAt = windowStart + windowMs;

  return {
    allowed: count < limit,
    limit,
    remaining,
    resetAt,
    retryAfterMs: count >= limit ? resetAt - now : undefined,
  };
}

function getLimitForAgent(env: CloudflareEnv, agentName: string, window: 'hourly' | 'daily' | 'monthly'): number {
  // In production, fetch from agent registration or config
  // For now, use env vars with defaults
  const envVar = `RATE_LIMIT_${window.toUpperCase()}_MAX`;
  const defaultLimits = { hourly: 100, daily: 1000, monthly: 10000 };
  return parseInt((env as any)[envVar] || String(defaultLimits[window]), 10);
}

export async function recordEmailSent(
  env: CloudflareEnv,
  agentName: string,
  action: 'send' | 'webhook' | 'api',
  window: 'hourly' | 'daily' | 'monthly'
): Promise<void> {
  const key = `ratelimit:${agentName}:${action}:${window}`;
  const windowMs = RATE_LIMIT_WINDOWS[window];
  const now = Date.now();
  const windowStart = now - (now % windowMs);
  const windowKey = `${key}:${windowStart}`;

  const current = await env.RATE_LIMIT_KV.get(windowKey);
  const count = current ? parseInt(current, 10) : 0;

  await env.RATE_LIMIT_KV.put(windowKey, String(count + 1), {
    expirationTtl: Math.ceil(windowMs / 1000) + 60, // Window + 1 minute buffer
  });
}

// ──────────────────────────────────────────────────────────────
// Request Validation
// ──────────────────────────────────────────────────────────────

export function validateSendRequest(body: SendEmailRequest): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Required fields
  if (!body.to || (Array.isArray(body.to) && body.to.length === 0) || (!Array.isArray(body.to) && !body.to)) {
    errors.push('Recipient (to) is required');
  }

  if (!body.subject || body.subject.trim().length === 0) {
    errors.push('Subject is required');
  }

  if (!body.text && !body.html) {
    errors.push('Either text or html content is required');
  }

  // Validate email addresses
  const recipients = Array.isArray(body.to) ? body.to : [body.to];
  for (const recipient of recipients) {
    if (!isValidEmailFormat(recipient)) {
      errors.push(`Invalid email address: ${recipient}`);
    }
  }

  if (body.cc) {
    const ccRecipients = Array.isArray(body.cc) ? body.cc : [body.cc];
    for (const recipient of ccRecipients) {
      if (!isValidEmailFormat(recipient)) {
        errors.push(`Invalid CC email address: ${recipient}`);
      }
    }
  }

  if (body.bcc) {
    const bccRecipients = Array.isArray(body.bcc) ? body.bcc : [body.bcc];
    for (const recipient of bccRecipients) {
      if (!isValidEmailFormat(recipient)) {
        errors.push(`Invalid BCC email address: ${recipient}`);
      }
    }
  }

  // Validate attachments
  if (body.attachments) {
    for (const attachment of body.attachments) {
      if (!attachment.filename || !attachment.content) {
        errors.push('Attachment missing filename or content');
      }
      if (attachment.size > 25 * 1024 * 1024) { // 25MB limit
        errors.push(`Attachment too large: ${attachment.filename} (${attachment.size} bytes)`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function isValidEmailFormat(email: string): boolean {
  // Basic email validation - RFC 5322 compliant regex would be too complex
  // This covers 99% of cases
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ──────────────────────────────────────────────────────────────
// Resend API Integration
// ──────────────────────────────────────────────────────────────

export async function sendEmailViaResend(
  env: CloudflareEnv,
  claims: AgentPassportClaims,
  request: SendEmailRequest
): Promise<SendEmailResponse> {
  const correlationId = generateCorrelationId();

  // Build Resend payload
  const fromEmail = request.replyTo || `noreply@${claims.agentDomain}`;
  const fromName = claims.agentName;

  const payload: ResendEmailPayload = {
    from: `${fromName} <${fromEmail}>`,
    to: Array.isArray(request.to) ? request.to : [request.to],
    subject: request.subject,
    text: request.text,
    html: request.html,
    reply_to: request.replyTo,
    headers: request.headers,
    attachments: request.attachments?.map(a => ({
      filename: a.filename,
      content: a.content,
      content_type: a.contentType,
      content_id: a.contentId,
    })),
    tags: [
      { name: 'agent', value: claims.agentName },
      { name: 'domain', value: claims.agentDomain },
      { name: 'environment', value: env.ENVIRONMENT },
      ...(request.tags ? Object.entries(request.tags).map(([name, value]) => ({ name, value })) : []),
    ],
    metadata: {
      agentName: claims.agentName,
      agentDomain: claims.agentDomain,
      correlationId,
      ...request.metadata,
    },
  };

  // Call Resend API
  const resendUrl = `${env.RESEND_API_URL}/emails`;
  const response = await fetch(resendUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'User-Agent': 'PAI-Email-Agent/1.0',
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  let resendResponse: ResendResponse;

  try {
    resendResponse = JSON.parse(responseText);
  } catch {
    throw new Error(`Resend API returned invalid JSON: ${responseText}`);
  }

  if (!response.ok) {
    console.error(`[${correlationId}] Resend API error: ${response.status} - ${responseText}`);
    throw new Error(`Resend API error: ${response.status} - ${resendResponse?.id || responseText}`);
  }

  if (!resendResponse.id) {
    throw new Error('Resend API did not return message ID');
  }

  return {
    messageId: resendResponse.id,
    status: 'queued', // Resend returns 'queued' initially
    timestamp: Date.now(),
  };
}

// ──────────────────────────────────────────────────────────────
// Idempotency Key Generation
// ──────────────────────────────────────────────────────────────

export function generateIdempotencyKey(
  agentName: string,
  request: SendEmailRequest
): string {
  const contentHash = hashEmailContent({
    from: agentName,
    to: Array.isArray(request.to) ? request.to : [request.to],
    subject: request.subject,
    text: request.text,
    html: request.html,
  });
  return `${agentName}:${contentHash}`;
}