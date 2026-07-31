/**
 * Email Status Tracker
 * Tracks delivery status and notifies agent webhooks
 */

import type { CloudflareEnv, EmailStatusPayload, WebhookEventType } from '../../shared/types.js';
import { generateWebhookSignature } from '../../shared/crypto.js';

// ──────────────────────────────────────────────────────────────
// KV Keys
// ──────────────────────────────────────────────────────────────

const EMAIL_STATUS_KEY = (messageId: string) => `email:status:${messageId}`;
const EMAIL_AGENT_KEY = (messageId: string) => `email:agent:${messageId}`;
const AGENT_WEBHOOK_CONFIG_KEY = (agentName: string) => `agent:webhook:${agentName}`;

// ──────────────────────────────────────────────────────────────
// Status Storage
// ──────────────────────────────────────────────────────────────

export async function updateEmailStatus(
  env: CloudflareEnv,
  messageId: string,
  status: EmailStatusPayload
): Promise<void> {
  const key = EMAIL_STATUS_KEY(messageId);
  const existing = await env.EMAIL_KV.get<EmailStatusPayload>(key, 'json');
  
  const updated = {
    ...existing,
    ...status,
    updatedAt: Date.now(),
    history: [...(existing?.history || []), { status: status.status, timestamp: status.timestamp }],
  };
  
  await env.EMAIL_KV.put(key, JSON.stringify(updated), { expirationTtl: 2592000 }); // 30 days
}

export async function getEmailStatus(
  env: CloudflareEnv,
  messageId: string
): Promise<EmailStatusPayload | null> {
  return env.EMAIL_KV.get<EmailStatusPayload>(EMAIL_STATUS_KEY(messageId), 'json');
}

export async function linkEmailToAgent(
  env: CloudflareEnv,
  messageId: string,
  agentName: string
): Promise<void> {
  await env.EMAIL_KV.put(EMAIL_AGENT_KEY(messageId), agentName, { expirationTtl: 2592000 });
}

export async function getAgentForEmail(
  env: CloudflareEnv,
  messageId: string
): Promise<string | null> {
  return env.EMAIL_KV.get(EMAIL_AGENT_KEY(messageId));
}

// ──────────────────────────────────────────────────────────────
// Agent Webhook Notification
// ──────────────────────────────────────────────────────────────

interface AgentWebhookConfig {
  url: string;
  secret: string;
  events: WebhookEventType[];
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
}

export async function notifyAgentWebhook(
  env: CloudflareEnv,
  messageId: string,
  status: EmailStatusPayload,
  correlationId: string
): Promise<void> {
  const agentName = await getAgentForEmail(env, messageId);
  if (!agentName) {
    console.log(`[${correlationId}] No agent linked to email ${messageId}`);
    return;
  }

  const config = await getAgentWebhookConfig(env, agentName);
  if (!config) {
    console.log(`[${correlationId}] No webhook config for agent ${agentName}`);
    return;
  }

  // Check if agent wants this event type
  const eventType = mapStatusToEvent(status.status);
  if (!config.events.includes(eventType)) {
    return;
  }

  const timestamp = Date.now();
  const payload = {
    event: eventType,
    timestamp,
    correlationId,
    payload: { messageId, ...status },
  };

  const signature = generateWebhookSignature(payload, config.secret, timestamp);
  const webhookPayload = { ...payload, signature };

  await deliverWithRetry(config, webhookPayload, correlationId);
}

async function getAgentWebhookConfig(
  env: CloudflareEnv,
  agentName: string
): Promise<AgentWebhookConfig | null> {
  const data = await env.AGENT_KV.get(AGENT_WEBHOOK_CONFIG_KEY(agentName), 'json');
  if (!data) return null;
  
  return {
    url: data.webhookUrl,
    secret: data.webhookSecret,
    events: data.webhookEvents || ['email.received', 'email.delivered', 'email.bounced', 'email.complained'],
    timeoutMs: data.webhookTimeoutMs || 5000,
    maxRetries: data.webhookMaxRetries || 3,
    retryDelayMs: data.webhookRetryDelayMs || 1000,
  };
}

async function deliverWithRetry(
  config: AgentWebhookConfig,
  payload: object,
  correlationId: string,
  attempt: number = 1
): Promise<void> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'PAI-Email-Agent/1.0',
        'X-PAI-Correlation-ID': correlationId,
        'X-PAI-Delivery-Attempt': attempt.toString(),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok && response.status !== 429 && (response.status < 400 || response.status >= 500)) {
      throw new Error(`HTTP ${response.status}`);
    }

    if (response.status === 429 || response.status >= 500) {
      throw new Error(`HTTP ${response.status}`);
    }

    console.log(`[${correlationId}] Webhook delivered to ${config.url} (attempt ${attempt})`);

  } catch (error) {
    if (attempt >= config.maxRetries) {
      console.error(`[${correlationId}] Webhook delivery failed after ${config.maxRetries} attempts:`, error);
      return;
    }

    const delay = config.retryDelayMs * Math.pow(2, attempt - 1);
    await new Promise(resolve => setTimeout(resolve, delay));
    return deliverWithRetry(config, payload, correlationId, attempt + 1);
  }
}

function mapStatusToEvent(status: EmailStatusPayload['status']): WebhookEventType {
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