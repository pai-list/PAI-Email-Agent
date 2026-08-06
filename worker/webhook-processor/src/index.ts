/**
 * PAI Webhook Processor - Background worker for webhook delivery
 * 
 * Processes webhook delivery queue, handles retries, batching, and dead letter queue
 */

import { Router, type IRequest } from 'itty-router';
import type { CloudflareEnv, WebhookEventType, StoredEmail, ScheduledController } from '../../shared/src/types.js';
import { generateCorrelationId } from '../../shared/src/crypto.js';

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

interface QueuedWebhook {
  id: string;
  agentName: string;
  event: WebhookEventType;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  nextRetryAt: number;
  lastError?: string;
}

interface WebhookConfig {
  url: string;
  secret: string;
  events: WebhookEventType[];
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
}

interface StoredWebhookConfig {
  webhookUrl: string;
  webhookSecret: string;
  webhookEvents?: WebhookEventType[];
  webhookTimeoutMs?: number;
  webhookMaxRetries?: number;
  webhookRetryDelayMs?: number;
}

// ──────────────────────────────────────────────────────────────
// Main Handler
// ──────────────────────────────────────────────────────────────

const router = Router<IRequest, [CloudflareEnv, ExecutionContext]>();

router.get('/health', () => new Response('OK', { status: 200 }));

// Process webhook queue (called via cron trigger)
router.post('/process', async (request, env) => {
  const correlationId = generateCorrelationId();
  const startTime = Date.now();

  try {
    const batchSize = parseInt(env.WEBHOOK_BATCH_SIZE || '10', 10);
    const processed = await processWebhookQueue(env, batchSize, correlationId);

    const latency = Date.now() - startTime;
    console.log(`[${correlationId}] Processed ${processed} webhooks in ${latency}ms`);

    return new Response(JSON.stringify({ processed, latencyMs: latency }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error(`[${correlationId}] Queue processing error:`, error);
    return new Response('Internal Server Error', { status: 500 });
  }
});

// Get queue stats
router.get('/stats', async (request, env) => {
  try {
    const stats = await getQueueStats(env);
    return new Response(JSON.stringify(stats), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Stats error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
});

// Retry failed webhooks
router.post('/retry-failed', async (request, env) => {
  const correlationId = generateCorrelationId();
  try {
    const retried = await retryFailedWebhooks(env, correlationId);
    return new Response(JSON.stringify({ retried }), { status: 200 });
  } catch (error) {
    console.error(`[${correlationId}] Retry failed error:`, error);
    return new Response('Internal Server Error', { status: 500 });
  }
});

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
    return router.handle(request, env, ctx) || new Response('Not Found', { status: 404 });
  },

  // Cron trigger handler
  async scheduled(controller: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext): Promise<void> {
    const correlationId = generateCorrelationId();
    const batchSize = parseInt(env.WEBHOOK_BATCH_SIZE || '10', 10);
    await processWebhookQueue(env, batchSize, correlationId);
  },
} satisfies ExportedHandler<CloudflareEnv>;

// ──────────────────────────────────────────────────────────────
// Queue Processing
// ──────────────────────────────────────────────────────────────

const QUEUE_KEY = 'webhook:queue';
const PROCESSING_KEY = 'webhook:processing';
const DEAD_LETTER_KEY = 'webhook:dead-letter';
const CONFIG_KEY = (agentName: string) => `agent:webhook:${agentName}`;

async function processWebhookQueue(
  env: CloudflareEnv,
  batchSize: number,
  correlationId: string
): Promise<number> {
  const now = Date.now();
  let processed = 0;

  // Get queue
  const queue = await env.WEBHOOK_KV.get<QueuedWebhook[]>(QUEUE_KEY, 'json') || [];
  
  // Filter ready-to-process items
  const ready = queue.filter(item => item.nextRetryAt <= now && item.attempts < item.maxAttempts);
  const batch = ready.slice(0, batchSize);

  if (batch.length === 0) {
    return 0;
  }

  // Move batch to processing
  const remaining = queue.filter(item => !batch.includes(item));
  await env.WEBHOOK_KV.put(QUEUE_KEY, JSON.stringify(remaining));

  // Process each webhook
  for (const webhook of batch) {
    const success = await deliverWebhook(env, webhook, correlationId);
    
    if (success) {
      processed++;
    } else {
      // Re-queue with incremented attempts
      webhook.attempts++;
      webhook.nextRetryAt = now + calculateBackoff(webhook.attempts);
      webhook.lastError = 'Delivery failed';
      
      if (webhook.attempts >= webhook.maxAttempts) {
        // Move to dead letter queue
        await addToDeadLetter(env, webhook, correlationId);
      } else {
        remaining.push(webhook);
      }
    }
  }

  // Update queue
  await env.WEBHOOK_KV.put(QUEUE_KEY, JSON.stringify(remaining));
  return processed;
}

async function deliverWebhook(
  env: CloudflareEnv,
  webhook: QueuedWebhook,
  correlationId: string
): Promise<boolean> {
  const config = await getWebhookConfig(env, webhook.agentName);
  if (!config) {
    console.warn(`[${correlationId}] No webhook config for agent ${webhook.agentName}`);
    return false;
  }

  // Check if agent wants this event
  if (!config.events.includes(webhook.event)) {
    return true; // Skip silently
  }

  const timestamp = Date.now();
  // Generate signature for payload
  // Note: In production, use the shared crypto module
  const payload = {
    ...(webhook.payload as Record<string, unknown>),
    _meta: {
      correlationId,
      timestamp,
      attempt: webhook.attempts + 1,
    },
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'PAI-Email-Agent/1.0',
        'X-PAI-Correlation-ID': correlationId,
        'X-PAI-Delivery-Attempt': (webhook.attempts + 1).toString(),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
      // Success or non-retryable error
      return true;
    }

    // Retryable error
    return false;
  } catch {
    return false;
  }
}

export function calculateBackoff(attempt: number): number {
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, 64s... max 5 minutes
  const base = 1000;
  const max = 5 * 60 * 1000;
  const effective = Math.max(attempt, 1);
  return Math.min(base * Math.pow(2, effective - 1), max);
}

async function getWebhookConfig(env: CloudflareEnv, agentName: string): Promise<WebhookConfig | null> {
  const data = await env.AGENT_KV.get<StoredWebhookConfig>(CONFIG_KEY(agentName), 'json');
  if (!data) return null;

  return {
    url: data.webhookUrl,
    secret: data.webhookSecret,
    events: data.webhookEvents || ['email.received', 'email.delivered', 'email.bounced', 'email.complained'],
    timeoutMs: data.webhookTimeoutMs || 5000,
    maxRetries: data.webhookMaxRetries || 5,
    retryDelayMs: data.webhookRetryDelayMs || 1000,
  };
}

async function addToDeadLetter(
  env: CloudflareEnv,
  webhook: QueuedWebhook,
  correlationId: string
): Promise<void> {
  const deadLetter = await env.WEBHOOK_KV.get<QueuedWebhook[]>(DEAD_LETTER_KEY, 'json') || [];
  deadLetter.push({
    ...webhook,
    lastError: webhook.lastError || 'Max retries exceeded',
  });
  await env.WEBHOOK_KV.put(DEAD_LETTER_KEY, JSON.stringify(deadLetter));
  console.error(`[${correlationId}] Webhook moved to dead letter queue: ${webhook.id}`);
}

async function retryFailedWebhooks(env: CloudflareEnv, correlationId: string): Promise<number> {
  const deadLetter = await env.WEBHOOK_KV.get<QueuedWebhook[]>(DEAD_LETTER_KEY, 'json') || [];
  const now = Date.now();
  
  const toRetry = deadLetter.filter(item => item.nextRetryAt <= now);
  const remaining = deadLetter.filter(item => item.nextRetryAt > now);

  for (const webhook of toRetry) {
    webhook.attempts = 0;
    webhook.nextRetryAt = now;
    webhook.lastError = undefined;
  }

  const queue = await env.WEBHOOK_KV.get<QueuedWebhook[]>(QUEUE_KEY, 'json') || [];
  await env.WEBHOOK_KV.put(QUEUE_KEY, JSON.stringify([...queue, ...toRetry]));
  await env.WEBHOOK_KV.put(DEAD_LETTER_KEY, JSON.stringify(remaining));

  console.log(`[${correlationId}] Retried ${toRetry.length} failed webhooks`);
  return toRetry.length;
}

async function getQueueStats(env: CloudflareEnv): Promise<{
  pending: number;
  processing: number;
  deadLetter: number;
  oldestPending?: number;
}> {
  const queue = await env.WEBHOOK_KV.get<QueuedWebhook[]>(QUEUE_KEY, 'json') || [];
  const deadLetter = await env.WEBHOOK_KV.get<QueuedWebhook[]>(DEAD_LETTER_KEY, 'json') || [];

  const pending = queue.filter(item => item.nextRetryAt <= Date.now()).length;
  const scheduled = queue.filter(item => item.nextRetryAt > Date.now()).length;

  let oldestPending: number | undefined;
  if (pending > 0) {
    const timestamps = queue
      .filter(item => item.nextRetryAt <= Date.now())
      .map(item => item.createdAt)
      .sort((a, b) => a - b);
    oldestPending = timestamps[0];
  }

  return {
    pending,
    processing: scheduled,
    deadLetter: deadLetter.length,
    oldestPending,
  };
}