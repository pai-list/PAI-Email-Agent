/**
 * Shared types for PAI-Email-Agent
 * Used across email-router, email-sender, and webhook-processor workers
 */

// ──────────────────────────────────────────────────────────────
// Email Core Types
// ──────────────────────────────────────────────────────────────

export interface EmailAddress {
  name?: string;
  email: string;
}

export interface Attachment {
  filename: string;
  contentType: string;
  content: string; // base64 encoded
  size: number;
  contentId?: string; // for inline attachments
}

export interface EmailMessage {
  from: string;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  headers: EmailHeaders;
  attachments: Attachment[];
  rawSize: number;
}

export interface EmailHeaders {
  'message-id': string;
  'date': string;
  'from': string;
  'to': string;
  'cc'?: string;
  'bcc'?: string;
  'subject': string;
  'reply-to'?: string;
  'in-reply-to'?: string;
  references?: string;
  'content-type': string;
  'mime-version'?: string;
  'dkim-signature'?: string;
  'received-spf'?: string;
  'authentication-results'?: string;
  [key: string]: string | undefined;
}

export interface StoredEmail {
  id: string;                    // Message-ID header
  agentName: string;             // "alice" from alice@agents.axiomid.app
  from: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  subject: string;
  text?: string;
  html?: string;
  headers: EmailHeaders;
  attachments: Attachment[];
  receivedAt: number;            // Unix timestamp (ms)
  size: number;                  // Bytes
  spamScore?: number;            // Cloudflare spam score (0-100)
  dkimResult?: 'pass' | 'fail' | 'none' | 'neutral' | 'temperror' | 'permerror';
  spfResult?: 'pass' | 'fail' | 'none' | 'neutral' | 'temperror' | 'permerror';
  dmarcResult?: 'pass' | 'fail' | 'none' | 'neutral' | 'temperror' | 'permerror';
  processed: boolean;            // Whether webhook was delivered
  webhookDeliveredAt?: number;
  webhookAttempts: number;
}

// ──────────────────────────────────────────────────────────────
// Agent Identity & Authentication
// ──────────────────────────────────────────────────────────────

export interface AgentPassportClaims {
  // Standard JWT claims
  iss: string;           // Issuer: "pai-email-agent"
  sub: string;           // Subject: agent name (e.g., "alice")
  aud: string;           // Audience: "pai-agents"
  exp: number;           // Expiration timestamp (ms)
  iat: number;           // Issued at timestamp (ms)
  jti: string;           // JWT ID (nonce)
  
  // PAI-specific claims
  agentName: string;     // Agent identifier
  agentDomain: string;   // e.g., "alice.axiomid.app"
  permissions: AgentPermission[];
  emailQuota: EmailQuota;
  metadata?: Record<string, unknown>;
}

export type AgentPermission = 
  | 'email:send' 
  | 'email:receive' 
  | 'email:read' 
  | 'email:delete'
  | 'webhook:register'
  | 'webhook:receive'
  | 'subdomain:manage'
  | 'identity:verify';

export interface EmailQuota {
  hourly: number;        // Max emails per hour
  daily: number;         // Max emails per day
  monthly: number;       // Max emails per month
  burst?: number;        // Burst allowance
}

export interface AgentRegistration {
  agentName: string;
  agentDomain: string;   // Subdomain: agent.axiomid.app
  emailAddress: string;  // agent@agents.axiomid.app
  webhookUrl: string;    // https://agent.axiomid.app/webhook/email
  statusEndpoint: string; // https://agent.axiomid.app/webhook/email/status
  publicKey?: string;    // For future: webhook signature verification
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'suspended' | 'pending_verification';
  metadata?: Record<string, unknown>;
}

// ──────────────────────────────────────────────────────────────
// Outbound Email Types
// ──────────────────────────────────────────────────────────────

export interface SendEmailRequest {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: Attachment[];
  tags?: Record<string, string>; // For tracking/categorization
  metadata?: Record<string, unknown>;
}

export interface SendEmailResponse {
  messageId: string;           // Resend message ID (re_...)
  status: 'queued' | 'sent' | 'failed';
  timestamp: number;
}

export interface ResendEmailPayload {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  reply_to?: string;
  headers?: Record<string, string>;
  attachments?: ResendAttachment[];
  tags?: ResendTag[];
  metadata?: Record<string, unknown>;
}

export interface ResendAttachment {
  filename: string;
  content: string; // base64
  content_type?: string;
  content_id?: string;
}

export interface ResendTag {
  name: string;
  value: string;
}

export interface ResendResponse {
  id: string; // re_...
  object: 'email';
}

// ──────────────────────────────────────────────────────────────
// Webhook Types
// ──────────────────────────────────────────────────────────────

export interface WebhookPayload<T = unknown> {
  event: WebhookEventType;
  timestamp: number;
  correlationId: string;
  payload: T;
  signature: string; // HMAC-SHA256 of payload
}

export type WebhookEventType = 
  | 'email.received'
  | 'email.delivered'
  | 'email.bounced'
  | 'email.complained'
  | 'email.opened'
  | 'email.clicked'
  | 'email.unsubscribed';

export interface EmailReceivedPayload {
  email: StoredEmail;
}

export interface EmailStatusPayload {
  messageId: string;           // Resend message ID
  status: 'delivered' | 'bounced' | 'complained' | 'opened' | 'clicked' | 'unsubscribed';
  timestamp: number;
  recipient: string;
  metadata?: Record<string, unknown>;
  // Bounce/complaint details
  bounceType?: 'hard' | 'soft' | 'block';
  bounceCode?: string;
  bounceDescription?: string;
  complaintFeedbackType?: string;
  history?: Array<{ status: EmailStatusPayload['status']; timestamp: number }>;
}

export interface WebhookRegistration {
  id: string;
  agentName: string;
  url: string;
  events: WebhookEventType[];
  secret: string; // HMAC secret for this webhook
  active: boolean;
  createdAt: number;
  updatedAt: number;
  lastDeliveryAt?: number;
  lastDeliveryStatus?: number;
  failureCount: number;
}

// ──────────────────────────────────────────────────────────────
// Rate Limiting Types
// ──────────────────────────────────────────────────────────────

export interface RateLimitConfig {
  windowMs: number;        // Time window in milliseconds
  maxRequests: number;     // Max requests per window
  burstAllowance?: number; // Additional burst requests
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetAt: number;         // Unix timestamp (ms) when window resets
  retryAfterMs?: number;   // If limited, ms until retry allowed
}

export interface RateLimitKey {
  agentName: string;
  action: 'send' | 'webhook' | 'api';
  window: 'hourly' | 'daily' | 'monthly';
}

// ──────────────────────────────────────────────────────────────
// Cloudflare Bindings Types
// ──────────────────────────────────────────────────────────────

export interface CloudflareEnv {
  // Secrets (set via wrangler secret put)
  RESEND_API_KEY: string;
  RESEND_API_URL: string;
  RESEND_WEBHOOK_SECRET: string;
  CF_API_TOKEN: string;
  JWT_SECRET: string;
  WEBHOOK_SECRET: string;
  
  // Vars (set in wrangler.toml [vars])
  ENVIRONMENT: 'development' | 'staging' | 'production';
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  DOMAIN: string; // e.g., "axiomid.app"
  WEBHOOK_TIMEOUT_MS?: string;
  WEBHOOK_MAX_RETRIES?: string;
  WEBHOOK_RETRY_DELAY_MS?: string;
  WEBHOOK_BATCH_SIZE?: string;
  
  // KV Namespaces
  EMAIL_KV: KVNamespace;
  AGENT_KV: KVNamespace;
  RATE_LIMIT_KV: KVNamespace;
  WEBHOOK_KV: KVNamespace;
  
  // Durable Objects
  AGENT_INBOX_DO: DurableObjectNamespace<unknown>;
  
  // Service Bindings (for worker-to-worker communication)
  EMAIL_SENDER?: Fetcher;
  WEBHOOK_PROCESSOR?: Fetcher;
}

export interface KVNamespace {
  get<T = string>(key: string, type?: 'text' | 'json' | 'arrayBuffer' | 'stream'): Promise<T | null>;
  put(key: string, value: string | ReadableStream | ArrayBuffer, options?: { expirationTtl?: number; metadata?: unknown }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{ keys: { name: string; expiration?: number; metadata?: unknown }[]; cursor?: string }>;
}

export interface DurableObjectNamespace<T> {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub<T>;
  newUniqueId(): DurableObjectId;
}

export interface DurableObjectId {
  toString(): string;
}

export interface DurableObjectStub<T> {
  fetch(request: Request): Promise<Response>;
  // For RPC-style calls if using Durable Objects RPC
  [key: string]: unknown;
}

export interface Fetcher {
  fetch(request: Request | string, init?: RequestInit): Promise<Response>;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface ExportedHandler<Env = unknown> {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> | Response;
  email?(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> | void;
  scheduled?(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> | void;
}

export interface ScheduledController {
  cron: string;
  scheduledTime: number;
}

// ──────────────────────────────────────────────────────────────
// Cloudflare Email Routing Types
// ──────────────────────────────────────────────────────────────

export interface ForwardableEmailMessage {
  from: string;
  to: string;
  subject?: string;
  text?: string;
  html?: string;
  headers: Headers;
  attachments?: ForwardableAttachment[];
  rawSize: number;
}

export interface ForwardableAttachment {
  filename: string;
  contentType: string;
  content: string; // base64
}

// ──────────────────────────────────────────────────────────────
// Error Types
// ──────────────────────────────────────────────────────────────

export interface ResendWebhookEvent {
  type: 'email.sent' | 'email.delivered' | 'email.delivery_delayed' | 'email.bounced' | 'email.complained' | 'email.opened' | 'email.clicked' | 'email.unsubscribed';
  created_at: string; // ISO 8601
  data: {
    email_id: string; // re_...
    from: string;
    to: string[];
    subject: string;
    // Event-specific fields
    bounce_type?: 'hard' | 'soft' | 'block';
    bounce_code?: string;
    bounce_description?: string;
    complaint_feedback_type?: string;
    click_location?: string;
    user_agent?: string;
    ip?: string;
  };
}

// ──────────────────────────────────────────────────────────────
// DNS & Domain Types
// ──────────────────────────────────────────────────────────────

export interface DNSRecord {
  type: 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'MX' | 'SPF' | 'DKIM' | 'DMARC';
  name: string;
  content: string;
  ttl: number;
  priority?: number; // For MX
  proxied?: boolean; // Cloudflare proxy
  comment?: string;
}

export interface DomainConfig {
  domain: string;           // e.g., "axiomid.app"
  subdomain: string;        // e.g., "agents"
  wildcard: boolean;        // true for *.agents.axiomid.app
  emailRouting: boolean;    // Enable Cloudflare Email Routing
  dnssec: boolean;          // Enable DNSSEC
}

// ──────────────────────────────────────────────────────────────
// Error Types
// ──────────────────────────────────────────────────────────────

export class PAIEmailError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: unknown
  ) {
    super(message);
    this.name = 'PAIEmailError';
  }
}

export class ValidationError extends PAIEmailError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends PAIEmailError {
  constructor(message: string = 'Authentication failed') {
    super(message, 'AUTHENTICATION_ERROR', 401);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends PAIEmailError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 'AUTHORIZATION_ERROR', 403);
    this.name = 'AuthorizationError';
  }
}

export class RateLimitError extends PAIEmailError {
  constructor(message: string, public retryAfterMs: number) {
    super(message, 'RATE_LIMIT_EXCEEDED', 429);
    this.name = 'RateLimitError';
  }
}

export class NotFoundError extends PAIEmailError {
  constructor(resource: string) {
    super(`${resource} not found`, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

export class UpstreamError extends PAIEmailError {
  constructor(service: string, message: string) {
    super(`${service} error: ${message}`, 'UPSTREAM_ERROR', 502);
    this.name = 'UpstreamError';
  }
}