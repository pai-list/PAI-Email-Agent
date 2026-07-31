import { z } from 'zod';

// ============================================
// Core Email Schema (matches spec/email-schema.json)
// ============================================

export const AgentEmailSchema = z.object({
  to: z.string().email(),
  from: z.string().email(),
  subject: z.string().max(200),
  body: z.string().max(65536),
  agentId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,29}$/),
  timestamp: z.string().datetime(),
  headers: z.record(z.string()).optional(),
  attachments: z.array(z.object({
    filename: z.string(),
    contentType: z.string(),
    size: z.number().int().nonnegative(),
    contentId: z.string().optional(),
  })).max(10).optional(),
});

export type AgentEmail = z.infer<typeof AgentEmailSchema>;

// ============================================
// Passport Claims Schema
// ============================================

export const EmailCapabilitiesSchema = z.object({
  sendEmail: z.object({
    enabled: z.boolean(),
    provider: z.literal('resend'),
    dailyLimit: z.number().int().positive(),
    monthlyLimit: z.number().int().positive(),
    templates: z.array(z.string()).optional(),
  }),
  receiveEmail: z.object({
    enabled: z.boolean(),
    routing: z.literal('cloudflare-catch-all'),
    maxSizeKB: z.number().int().positive(),
  }),
});

export const AgentIdentitySchema = z.object({
  id: z.string().regex(/^ag_[a-z0-9]+$/),
  name: z.string(),
  subdomain: z.string(),
  owner: z.string(),
  status: z.enum(['active', 'paused', 'sleeping']),
  mode: z.enum(['autonomous', 'supervised', 'manual']),
});

export const EmailIdentitySchema = z.object({
  address: z.string().email(),
  verified: z.boolean(),
  domain: z.string(),
  localPart: z.string(),
  routing: z.literal('cloudflare-email-worker'),
});

export const PermissionsSchema = z.object({
  scopes: z.array(z.string()),
  delegatedFrom: z.array(z.string()).optional(),
  delegatedTo: z.array(z.string()).optional(),
});

export const PassportClaimsSchema = z.object({
  iss: z.string().url(),
  sub: z.string().regex(/^did:axiom:agent:/),
  aud: z.array(z.string().url()),
  iat: z.number().int().positive(),
  exp: z.number().int().positive(),
  nonce: z.string().min(32),
  email: EmailIdentitySchema,
  agent: AgentIdentitySchema,
  capabilities: EmailCapabilitiesSchema,
  permissions: PermissionsSchema,
});

export type PassportClaims = z.infer<typeof PassportClaimsSchema>;
export type EmailCapabilities = z.infer<typeof EmailCapabilitiesSchema>;
export type AgentIdentity = z.infer<typeof AgentIdentitySchema>;
export type EmailIdentity = z.infer<typeof EmailIdentitySchema>;
export type Permissions = z.infer<typeof PermissionsSchema>;

// ============================================
// Configuration
// ============================================

export interface EmailAgentConfig {
  resendApiKey: string;
  fromDomain: string; // e.g., 'axiomid.app'
  defaultFromName: string;
  passportIssuer: string; // e.g., 'https://passport.pai.agent'
  passportPrivateKey: string; // Ed25519 private key (base64)
  passportKeyId: string; // e.g., 'pai-passport-2026-01'
}

// ============================================
// Validation Helpers
// ============================================

export function validateAgentEmail(data: unknown): AgentEmail {
  return AgentEmailSchema.parse(data);
}

export function validatePassportClaims(data: unknown): PassportClaims {
  return PassportClaimsSchema.parse(data);
}

export function isValidAgentId(id: string): boolean {
  return /^ag_[a-z0-9]+$/.test(id);
}

export function extractAgentIdFromEmail(email: string): string | null {
  const match = email.match(/^([^@]+)@/);
  if (!match) return null;
  const localPart = match[1].toLowerCase();
  return /^[a-z0-9][a-z0-9-]{2,29}$/.test(localPart) ? localPart : null;
}