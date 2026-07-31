/**
 * Shared cryptographic utilities for PAI-Email-Agent
 */

import { createHash, createHmac, timingSafeEqual, randomBytes } from 'crypto';
import { PAIEmailError } from './types.js';

// ──────────────────────────────────────────────────────────────
// JWT Utilities (HS256)
// ──────────────────────────────────────────────────────────────

const JWT_ALGORITHM = 'HS256';
const JWT_HEADER = { alg: JWT_ALGORITHM, typ: 'JWT' };

export interface JWTPayload {
  [key: string]: unknown;
}

export async function signJWT(
  payload: JWTPayload,
  secret: string,
  options: { expiresIn?: number; issuer?: string; audience?: string } = {}
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = options.expiresIn ? now + options.expiresIn : now + 900; // 15 min default
  
  const fullPayload = {
    ...payload,
    iat: now,
    exp,
    ...(options.issuer && { iss: options.issuer }),
    ...(options.audience && { aud: options.audience }),
    jti: randomBytes(16).toString('hex'),
  };
  
  const headerB64 = base64urlEncode(JSON.stringify(JWT_HEADER));
  const payloadB64 = base64urlEncode(JSON.stringify(fullPayload));
  const signingInput = `${headerB64}.${payloadB64}`;
  
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
  const signatureB64 = base64urlEncode(new Uint8Array(signature));
  
  return `${signingInput}.${signatureB64}`;
}

export async function verifyJWT(
  token: string,
  secret: string,
  options: { issuer?: string; audience?: string } = {}
): Promise<JWTPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const [headerB64, payloadB64, signatureB64] = parts;
    const signingInput = `${headerB64}.${payloadB64}`;
    
    // Verify signature
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    
    const signature = base64urlDecode(signatureB64);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signature,
      new TextEncoder().encode(signingInput)
    );
    
    if (!valid) return null;
    
    // Decode and validate payload
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64))) as JWTPayload;
    const now = Math.floor(Date.now() / 1000);
    
    // Check expiration
    if (typeof payload.exp === 'number' && payload.exp < now) {
      return null; // Expired
    }
    
    // Check not before
    if (typeof payload.nbf === 'number' && payload.nbf > now) {
      return null; // Not yet valid
    }
    
    // Check issuer
    if (options.issuer && payload.iss !== options.issuer) {
      return null;
    }
    
    // Check audience
    if (options.audience && payload.aud !== options.audience) {
      return null;
    }
    
    return payload;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────
// HMAC Utilities (Webhook Signatures)
// ──────────────────────────────────────────────────────────────

export function generateHMAC(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function verifyHMAC(payload: string, signature: string, secret: string): boolean {
  const expected = generateHMAC(payload, secret);
  // Use timing-safe comparison to prevent timing attacks
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export function generateWebhookSignature(
  payload: unknown,
  secret: string,
  timestamp: number
): string {
  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const signedPayload = `${timestamp}.${payloadStr}`;
  return generateHMAC(signedPayload, secret);
}

export function verifyWebhookSignature(
  payload: unknown,
  signature: string,
  secret: string,
  timestamp: number,
  toleranceMs: number = 300000 // 5 minutes
): boolean {
  const now = Date.now();
  if (Math.abs(now - timestamp) > toleranceMs) {
    return false; // Timestamp too old or in future
  }
  
  const expected = generateWebhookSignature(payload, secret, timestamp);
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// ──────────────────────────────────────────────────────────────
// Hash Utilities
// ──────────────────────────────────────────────────────────────

export function sha256(input: string | Uint8Array): string {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return createHash('sha256').update(data).digest('hex');
}

export function sha256Base64(input: string | Uint8Array): string {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return createHash('sha256').update(data).digest('base64');
}

// ──────────────────────────────────────────────────────────────
// Random/Secret Generation
// ──────────────────────────────────────────────────────────────

export function generateSecret(length: number = 32): string {
  return randomBytes(length).toString('base64url');
}

export function generateApiKey(prefix: string = 'pai'): string {
  const random = randomBytes(24).toString('base64url');
  return `${prefix}_${random}`;
}

export function generateCorrelationId(): string {
  return `${Date.now().toString(36)}-${randomBytes(8).toString('base64url')}`;
}

// ──────────────────────────────────────────────────────────────
// Base64URL Encoding (RFC 4648 §5)
// ──────────────────────────────────────────────────────────────

function base64urlEncode(input: string | Uint8Array): string {
  const buffer = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return Buffer.from(buffer).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function base64urlDecode(input: string): Uint8Array {
  // Add padding back
  let padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = padded.length % 4;
  if (padding) {
    padded += '='.repeat(4 - padding);
  }
  return Uint8Array.from(Buffer.from(padded, 'base64'));
}

// ──────────────────────────────────────────────────────────────
// Email Validation
// ──────────────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  if (!email || email.length > 254) return false;
  return EMAIL_REGEX.test(email);
}

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

export function extractEmailDomain(email: string): string | null {
  const atIndex = email.lastIndexOf('@');
  if (atIndex === -1) return null;
  return email.slice(atIndex + 1).toLowerCase();
}

// ──────────────────────────────────────────────────────────────
// Rate Limit Key Generation
// ──────────────────────────────────────────────────────────────

export function generateRateLimitKey(
  agentName: string,
  action: 'send' | 'webhook' | 'api',
  window: 'hourly' | 'daily' | 'monthly'
): string {
  const now = Date.now();
  let windowStart: number;
  
  switch (window) {
    case 'hourly':
      windowStart = now - (now % 3600000);
      break;
    case 'daily':
      windowStart = now - (now % 86400000);
      break;
    case 'monthly':
      const date = new Date(now);
      windowStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
      break;
  }
  
  return `ratelimit:${agentName}:${action}:${window}:${windowStart}`;
}

// ──────────────────────────────────────────────────────────────
// DKIM/SPF/DMARC Helpers
// ──────────────────────────────────────────────────────────────

export function generateDKIMRecord(selector: string, publicKey: string): string {
  return `v=DKIM1; k=rsa; p=${publicKey}`;
}

export function generateSPFRecord(include: string[] = [], ip4: string[] = [], ip6: string[] = []): string {
  const parts = ['v=spf1'];
  
  for (const ip of ip4) {
    parts.push(`ip4:${ip}`);
  }
  for (const ip of ip6) {
    parts.push(`ip6:${ip}`);
  }
  for (const inc of include) {
    parts.push(`include:${inc}`);
  }
  
  parts.push('~all'); // Soft fail
  return parts.join(' ');
}

export function generateDMARCRecord(options: {
  policy: 'none' | 'quarantine' | 'reject';
  rua?: string; // Aggregate reports
  ruf?: string; // Forensic reports
  sp?: 'none' | 'quarantine' | 'reject'; // Subdomain policy
  pct?: number; // Percentage
}): string {
  const parts = ['v=DMARC1', `p=${options.policy}`];
  
  if (options.rua) parts.push(`rua=mailto:${options.rua}`);
  if (options.ruf) parts.push(`ruf=mailto:${options.ruf}`);
  if (options.sp) parts.push(`sp=${options.sp}`);
  if (options.pct !== undefined) parts.push(`pct=${options.pct}`);
  
  return parts.join('; ');
}

// ──────────────────────────────────────────────────────────────
// Content Hashing (for idempotency)
// ──────────────────────────────────────────────────────────────

export function hashEmailContent(email: {
  from: string;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
}): string {
  const content = JSON.stringify({
    from: email.from.toLowerCase(),
    to: email.to.map(t => t.toLowerCase()).sort(),
    subject: email.subject.trim(),
    text: email.text?.trim(),
    html: email.html?.trim(),
  });
  return sha256(content);
}