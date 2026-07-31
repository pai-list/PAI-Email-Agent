/**
 * Webhook delivery for inbound emails
 * Delivers emails to agent's webhook endpoint with HMAC signature
 */

import type { CloudflareEnv, StoredEmail, AgentRegistration } from '../../shared/types.js';
import { generateCorrelationId, generateWebhookSignature } from '../../shared/crypto.js';

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

interface WebhookDeliveryResult {
  success: boolean;
  statusCode?: number;
  error?: string;
  latencyMs: number;
}

interface AgentWebhookConfig {
  url: string;
  secret: string;
  events: string[];
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
}

// ──────────────────────────────────────────────────────────────
// Agent Registration Storage (KV)
// ──────────────────────────────────────────────────────────────

const AGENT_REGISTRATION_KEY = (agentName: string) => `agent:registration:${agentName}`;
const AGENT_WEBHOOK_KEY = (agentName: string) => `agent:webhook:${agentName}`;

export async function getAgentRegistration(env: CloudflareEnv, agentName: string): Promise<AgentRegistration | null> {
  return env.AGENT_KV.get<AgentRegistration>(AGENT_REGISTRATION_KEY(agentName), 'json');
}

export async function setAgentRegistration(env: CloudflareEnv, registration: AgentRegistration): Promise<void> {
  await env.AGENT_KV.put(AGENT_REGISTRATION_KEY(registration.agentName), JSON.stringify(registration));
}

export async function getAgentWebhookConfig(env: CloudflareEnv, agentName: string): Promise<AgentWebhookConfig | null> {
  const registration = await getAgentRegistration(env, agentName);
  if (!registration) return null;

  // Get webhook secret from KV (or generate from registration secret)
  const webhookSecret = await env.WEBHOOK_KV.get(AGENT_WEBHOOK_KEY(agentName));
  if (!webhookSecret) return null;

  return {
    url: registration.webhookUrl,
    secret: webhookSecret,
    events: ['email.received'],
    timeoutMs: parseInt(env.WEBHOOK_TIMEOUT_MS || '5000'),
    maxRetries: parseInt(env.WEBHOOK_MAX_RETRIES || '3'),
    retryDelayMs: parseInt(env.WEBHOOK_RETRY_DELAY_MS || '1000'),
  };
}

export async function setAgentWebhookSecret(env: CloudflareEnv, agentName: string, secret: string): Promise<void> {
  await env.WEBHOOK_KV.put(AGENT_WEBHOOK_KEY(agentName), secret);
}

// ──────────────────────────────────────────────────────────────
// Webhook Delivery
// ──────────────────────────────────────────────────────────────

export async function deliverInboundEmailWebhook(
  env: CloudflareEnv,
  agentName: string,
  email: StoredEmail,
  correlationId: string
): Promise<WebhookDeliveryResult> {
  const config = await getAgentWebhookConfig(env, agentName);
  if (!config) {
    return {
      success: false,
      error: `No webhook configured for agent ${agentName}`,
      latencyMs: 0,
    };
  }

  const timestamp = Date.now();
  const payload = {
    event: 'email.received' as const,
    timestamp,
    correlationId,
    payload: { email },
  };

  const signature = generateWebhookSignature(payload, config.secret, timestamp);

  const webhookPayload = {
    ...payload,
    signature,
  };

  return deliverWithRetry(config, webhookPayload, correlationId);
}

async function deliverWithRetry(
  config: AgentWebhookConfig,
  payload: object,
  correlationId: string,
  attempt: number = 1
): Promise<WebhookDeliveryResult> {
  const startTime = Date.now();

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
    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      console.log(`[${correlationId}] Webhook delivered successfully to ${config.url} (attempt ${attempt}, ${latencyMs}ms)`);
      return { success: true, statusCode: response.status, latencyMs };
    }

    // Non-retryable errors (4xx except 429)
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.warn(`[${correlationId}] Webhook non-retryable error: ${response.status} - ${errorText}`);
      return {
        success: false,
        statusCode: response.status,
        error: `HTTP ${response.status}: ${errorText}`,
        latencyMs,
      };
    }

    // Retryable error (5xx or 429)
    throw new Error(`HTTP ${response.status}`);

  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    console.warn(`[${correlationId}] Webhook delivery failed (attempt ${attempt}/${config.maxRetries}): ${errorMessage}`);

    if (attempt >= config.maxRetries) {
      return {
        success: false,
        error: `Max retries exceeded: ${errorMessage}`,
        latencyMs,
      };
    }

    // Wait before retry with exponential backoff
    const delay = config.retryDelayMs * Math.pow(2, attempt - 1);
    await new Promise(resolve => setTimeout(resolve, delay));

    return deliverWithRetry(config, payload, correlationId, attempt + 1);
  }
}

// ──────────────────────────────────────────────────────────────
// Batch Webhook Delivery (for multiple emails)
// ──────────────────────────────────────────────────────────────

export async function deliverBatchWebhook(
  env: CloudflareEnv,
  agentName: string,
  emails: StoredEmail[],
  correlationId: string
): Promise<WebhookDeliveryResult[]> {
  const config = await getAgentWebhookConfig(env, agentName);
  if (!config) {
    return emails.map(() => ({
      success: false,
      error: `No webhook configured for agent ${agentName}`,
      latencyMs: 0,
    }));
  }

  const timestamp = Date.now();
  const payload = {
    event: 'email.batch_received' as const,
    timestamp,
    correlationId,
    payload: { emails },
  };

  const signature = generateWebhookSignature(payload, config.secret, timestamp);
  const webhookPayload = { ...payload, signature };

  const result = await deliverWithRetry(config, webhookPayload, correlationId);
  return emails.map(() => result);
}

// ──────────────────────────────────────────────────────────────
// Webhook Registration API (for agents to register themselves)
// ──────────────────────────────────────────────────────────────

export interface RegisterWebhookRequest {
  agentName: string;
  webhookUrl: string;
  events?: string[];
  jwt: string; // Agent Passport JWT for authentication
}

export interface RegisterWebhookResponse {
  success: boolean;
  webhookSecret?: string;
  error?: string;
}

export async function handleWebhookRegistration(
  env: CloudflareEnv,
  request: RegisterWebhookRequest
): Promise<RegisterWebhookResponse> {
  // Verify JWT (Agent Passport)
  // TODO: Import and use verifyJWT from shared/crypto
  // const claims = await verifyJWT(request.jwt, env.JWT_SECRET, {
  //   issuer: env.JWT_ISSUER,
  //   audience: env.JWT_AUDIENCE,
  // });
  // if (!claims || claims.agentName !== request.agentName) {
  //   return { success: false, error: 'Invalid agent identity' };
  // }

  // Check if agent exists
  const registration = await getAgentRegistration(env, request.agentName);
  if (!registration) {
    return { success: false, error: 'Agent not found' };
  }

  // Generate webhook secret
  const webhookSecret = generateWebhookSecret();

  // Store webhook config
  await setAgentWebhookSecret(env, request.agentName, webhookSecret);

  // Update registration with webhook URL
  registration.webhookUrl = request.webhookUrl;
  registration.updatedAt = Date.now();
  await setAgentRegistration(env, registration);

  console.log(`Webhook registered for agent ${request.agentName}: ${request.webhookUrl}`);

  return {
    success: true,
    webhookSecret,
  };
}

function generateWebhookSecret(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}