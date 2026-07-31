/**
 * PAI Email Sender - Outbound Email Handler
 * 
 * Sends emails via Resend API with agent authentication, rate limiting, and webhook tracking
 */

import { Router } from 'itty-router';
import { verifyJWT } from '../../shared/crypto.js';
import { sendEmailViaResend, validateSendRequest, checkRateLimit, recordEmailSent } from './sender.js';
import { handleResendWebhook } from './resend-webhook.js';
import type { CloudflareEnv, SendEmailRequest, SendEmailResponse, AgentPassportClaims } from '../../shared/types.js';

// ──────────────────────────────────────────────────────────────
// Main Handler
// ──────────────────────────────────────────────────────────────

const router = Router<Request, CloudflareEnv>();

// Health check
router.get('/health', () => new Response('OK', { status: 200 }));

// Send email endpoint (requires Agent Passport JWT)
router.post('/send', async (request, env) => {
  const correlationId = crypto.randomUUID();
  const startTime = Date.now();

  try {
    // Verify Agent Passport JWT
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Missing or invalid Authorization header' }, 401);
    }

    const jwt = authHeader.slice(7);
    const claims = await verifyJWT(jwt, env.JWT_SECRET, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    }) as AgentPassportClaims | null;

    if (!claims) {
      return jsonResponse({ error: 'Invalid or expired token' }, 401);
    }

    // Check permissions
    if (!claims.permissions.includes('email:send')) {
      return jsonResponse({ error: 'Insufficient permissions: email:send required' }, 403);
    }

    // Parse and validate request
    const body = await request.json() as SendEmailRequest;
    const validation = validateSendRequest(body);
    if (!validation.valid) {
      return jsonResponse({ error: 'Validation failed', details: validation.errors }, 400);
    }

    // Check rate limits
    const rateLimit = await checkRateLimit(env, claims.agentName, 'send', 'hourly');
    if (!rateLimit.allowed) {
      return jsonResponse(
        { error: 'Rate limit exceeded', retryAfterMs: rateLimit.retryAfterMs },
        429,
        { 'Retry-After': Math.ceil((rateLimit.retryAfterMs || 0) / 1000).toString() }
      );
    }

    // Send email via Resend
    const result = await sendEmailViaResend(env, claims, body);

    // Record for rate limiting
    await recordEmailSent(env, claims.agentName, 'send', 'hourly');

    const latency = Date.now() - startTime;
    console.log(`[${correlationId}] Email sent by ${claims.agentName}: ${result.messageId} (${latency}ms)`);

    return jsonResponse({
      ...result,
      rateLimit: {
        limit: rateLimit.limit,
        remaining: rateLimit.remaining - 1,
        resetAt: rateLimit.resetAt,
      },
    }, 200);

  } catch (error) {
    console.error(`[${correlationId}] Send email error:`, error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});

// Resend webhook endpoint (public, verified by signature)
router.post('/webhook/resend', async (request, env) => {
  const correlationId = crypto.randomUUID();
  
  try {
    const signature = request.headers.get('Resend-Signature');
    if (!signature) {
      return jsonResponse({ error: 'Missing Resend-Signature header' }, 400);
    }

    const payload = await request.text();
    const result = await handleResendWebhook(env, payload, signature, correlationId);
    
    return jsonResponse(result, result.success ? 200 : 400);
  } catch (error) {
    console.error(`[${correlationId}] Resend webhook error:`, error);
    return jsonResponse({ error: 'Webhook processing failed' }, 500);
  }
});

// Get agent's email quota and usage
router.get('/quota', async (request, env) => {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Missing or invalid Authorization header' }, 401);
    }

    const jwt = authHeader.slice(7);
    const claims = await verifyJWT(jwt, env.JWT_SECRET, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    }) as AgentPassportClaims | null;

    if (!claims) {
      return jsonResponse({ error: 'Invalid or expired token' }, 401);
    }

    // Get current usage from rate limit KV
    const hourly = await checkRateLimit(env, claims.agentName, 'send', 'hourly');
    const daily = await checkRateLimit(env, claims.agentName, 'send', 'daily');
    const monthly = await checkRateLimit(env, claims.agentName, 'send', 'monthly');

    return jsonResponse({
      quota: claims.emailQuota,
      usage: {
        hourly: { used: hourly.limit - hourly.remaining, limit: hourly.limit, resetAt: hourly.resetAt },
        daily: { used: daily.limit - daily.remaining, limit: daily.limit, resetAt: daily.resetAt },
        monthly: { used: monthly.limit - monthly.remaining, limit: monthly.limit, resetAt: monthly.resetAt },
      },
    });

  } catch (error) {
    console.error('Quota check error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function jsonResponse(data: unknown, status: number = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

// ──────────────────────────────────────────────────────────────
// Export
// ──────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
    return router.handle(request, env, ctx) || new Response('Not Found', { status: 404 });
  },
} satisfies ExportedHandler<CloudflareEnv>;