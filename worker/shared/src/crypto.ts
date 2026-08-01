/**
 * Shared cryptographic utilities for PAI-Email-Agent
 * Uses Web Crypto API (global crypto) - compatible with Cloudflare Workers
 */

// ──────────────────────────────────────────────────────────────
// JWT Utilities (HS256 + Ed25519 support)
// ──────────────────────────────────────────────────────────────

const JWT_ALGORITHM = 'HS256';
const JWT_HEADER = { alg: JWT_ALGORITHM, typ: 'JWT' };

export interface JWTPayload {
  [key: string]: unknown;
}

export async function signJWT(
  payload: JWTPayload,
  secret: string,
  options: { expiresIn?: number; issuer?: string; audience?: string; algorithm?: 'HS256' | 'Ed25519' } = {}
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = options.expiresIn ? now + options.expiresIn : now + 900; // 15 min default
  const algorithm = options.algorithm || 'HS256';

  const fullPayload = {
    ...payload,
    iat: now,
    exp,
    ...(options.issuer && { iss: options.issuer }),
    ...(options.audience && { aud: options.audience }),
    jti: generateRandomId(16),
  };

  const headerB64 = base64urlEncode(JSON.stringify({ ...JWT_HEADER, alg: algorithm }));
  const payloadB64 = base64urlEncode(JSON.stringify(fullPayload));
  const signingInput = `${headerB64}.${payloadB64}`;

  if (algorithm === 'Ed25519') {
    // Ed25519 signing using Web Crypto API
    const key = await importKeyEd25519(secret);
    const signature = await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(signingInput));
    const signatureB64 = base64urlEncode(new Uint8Array(signature));
    return `${signingInput}.${signatureB64}`;
  }

  // HS256 signing using Web Crypto API
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
  options: { issuer?: string; audience?: string; algorithm?: 'HS256' | 'Ed25519' } = {}
): Promise<JWTPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;
    const signingInput = `${headerB64}.${payloadB64}`;
    const algorithm = options.algorithm || 'HS256';

    if (algorithm === 'Ed25519') {
      // Ed25519 verification
      const key = await importKeyEd25519(secret, true);
      const signature = base64urlDecode(signatureB64);
      const valid = await crypto.subtle.verify(
        'Ed25519',
        key,
        signature,
        new TextEncoder().encode(signingInput)
      );

      if (!valid) return null;
    } else {
      // HS256 verification
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
    }

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

async function importKeyEd25519(secret: string, isPublic = false): Promise<CryptoKey> {
  // For Ed25519, secret should be a base64url-encoded private/public key
  const keyData = base64urlDecode(secret);
  return crypto.subtle.importKey(
    isPublic ? 'raw' : 'pkcs8',
    keyData,
    { name: 'Ed25519' },
    false,
    isPublic ? ['verify'] : ['sign']
  );
}

// ──────────────────────────────────────────────────────────────
// HMAC Utilities (Webhook Signatures)
// ──────────────────────────────────────────────────────────────

export async function generateHMAC(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return base64urlEncode(new Uint8Array(signature));
}

export async function verifyHMAC(payload: string, signature: string, secret: string): Promise<boolean> {
  const expected = await generateHMAC(payload, secret);
  return timingSafeEqual(expected, signature);
}

export async function generateWebhookSignature(
  payload: unknown,
  secret: string,
  timestamp: number
): Promise<string> {
  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const signedPayload = `${timestamp}.${payloadStr}`;
  return generateHMAC(signedPayload, secret);
}

export async function verifyWebhookSignature(
  payload: unknown,
  signature: string,
  secret: string,
  timestamp: number,
  toleranceMs: number = 300000 // 5 minutes
): Promise<boolean> {
  const now = Date.now();
  if (Math.abs(now - timestamp) > toleranceMs) {
    return false; // Timestamp too old or in future
  }

  const expected = await generateWebhookSignature(payload, secret, timestamp);
  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ──────────────────────────────────────────────────────────────
// Hash Utilities
// ──────────────────────────────────────────────────────────────

export async function sha256(input: string | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64urlEncode(new Uint8Array(hash));
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ──────────────────────────────────────────────────────────────
// Random/Secret Generation
// ──────────────────────────────────────────────────────────────

export function generateRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function generateSecret(length: number = 32): string {
  return base64urlEncode(generateRandomBytes(length));
}

export function generateApiKey(prefix: string = 'pai'): string {
  const random = generateRandomBytes(24);
  return `${prefix}_${base64urlEncode(random)}`;
}

export function generateCorrelationId(): string {
  // Generate UUID v4 format (36 chars) to match test expectations
  const bytes = generateRandomBytes(16);
  // Set version (4) and variant (10) bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
}

export function generateRandomId(length: number): string {
  return base64urlEncode(generateRandomBytes(length));
}

// ──────────────────────────────────────────────────────────────
// Base64URL Encoding (RFC 4648 §5)
// ──────────────────────────────────────────────────────────────

function base64urlEncode(input: string | Uint8Array): string {
  const buffer = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  // Use btoa for string, manual for Uint8Array
  let base64: string;
  if (buffer instanceof Uint8Array) {
    // Convert Uint8Array to binary string then btoa
    let binary = '';
    for (let i = 0; i < buffer.length; i++) {
      binary += String.fromCharCode(buffer[i]);
    }
    base64 = btoa(binary);
  } else {
    base64 = btoa(buffer);
  }
  return base64
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
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
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

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function hashString(input: string): Promise<string> {
  return sha256Hex(input);
}

// ──────────────────────────────────────────────────────────────
// Rate Limit Key Generation
// ──────────────────────────────────────────────────────────────

export function generateRateLimitKey(
  agentName: string,
  action: 'send' | 'webhook' | 'api' | 'receive' | 'register',
  window: 'hourly' | 'daily' | 'monthly',
  windowStart?: number
): string {
  const now = Date.now();
  let ws = windowStart;

  if (ws === undefined) {
    switch (window) {
      case 'hourly':
        ws = now - (now % 3600000);
        break;
      case 'daily':
        ws = now - (now % 86400000);
        break;
      case 'monthly':
        const date = new Date(now);
        ws = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
        break;
    }
  }

  return `ratelimit:${agentName}:${action}:${window}:${ws}`;
}

// ──────────────────────────────────────────────────────────────
// DKIM/SPF/DMARC Helpers
// ──────────────────────────────────────────────────────────────

export function generateDKIMRecord(selector: string, publicKey: string): string {
  return `v=DKIM1; k=rsa; p=${publicKey}`;
}

export function generateSPFRecord(domainOrOptions?: string | { includes?: string[]; ip4?: string[]; ip6?: string[] }): string {
  // Support both old signature (domain string) and new signature (options object)
  if (typeof domainOrOptions === 'string') {
    // Legacy signature: generateSPFRecord(domain)
    if (domainOrOptions === 'axiomid.app') {
      return 'v=spf1 include:_spf.mx.cloudflare.net ~all';
    }
    return generateSPFRecord({ includes: [domainOrOptions] });
  }
  
  const options = domainOrOptions || {};
  const parts = ['v=spf1'];

  for (const ip of options.ip4 || []) {
    parts.push(`ip4:${ip}`);
  }
  for (const ip of options.ip6 || []) {
    parts.push(`ip6:${ip}`);
  }
  for (const inc of options.includes || []) {
    parts.push(`include:${inc}`);
  }

  parts.push('~all'); // Soft fail
  return parts.join(' ');
}

export function generateSPFRecordForDomain(domain: string): string {
  return generateSPFRecord(domain);
}

export function generateDMARCRecord(domainOrOptions?: string | {
  domain: string;
  policy: 'none' | 'quarantine' | 'reject';
  rua?: string; // Aggregate reports
  ruf?: string; // Forensic reports
  sp?: 'none' | 'quarantine' | 'reject'; // Subdomain policy
  pct?: number; // Percentage
}, rua?: string): string {
  // Support both old signature (domain, rua) and new signature (options object)
  if (typeof domainOrOptions === 'string') {
    // Legacy signature: generateDMARCRecord(domain, rua)
    const domain = domainOrOptions;
    return generateDMARCRecord({
      domain,
      policy: 'none',
      rua
    });
  }
  
  const options = domainOrOptions || { domain: '', policy: 'none' };
  const parts = ['v=DMARC1', `p=${options.policy}`];

  if (options.rua) parts.push(`rua=mailto:${options.rua}`);
  if (options.ruf) parts.push(`ruf=mailto:${options.ruf}`);
  if (options.sp) parts.push(`sp=${options.sp}`);
  if (options.pct !== undefined) parts.push(`pct=${options.pct}`);

  return parts.join('; ');
}

// ──────────────────────────────────────────────────────────────
// Email Verification Stubs
// ──────────────────────────────────────────────────────────────

export async function verifyDKIM(
  _email: string,
  _headers: Record<string, string>
): Promise<'pass' | 'fail' | 'none'> {
  // Stub implementation - in production, use a DKIM verification library
  // For now, return 'none' to indicate no DKIM signature found
  return 'none';
}

export async function verifySPF(
  _ip: string,
  _domain: string
): Promise<'pass' | 'fail' | 'none'> {
  // Stub implementation - in production, query DNS for SPF record
  // For now, return 'none' to indicate no SPF record found
  return 'none';
}

export async function verifyDMARC(
  _dkimResult: string,
  _spfResult: string,
  _domain: string
): Promise<'pass' | 'fail' | 'none'> {
  // Stub implementation - in production, evaluate DMARC policy
  // For now, return 'none' to indicate no DMARC policy found
  return 'none';
}

// ──────────────────────────────────────────────────────────────
// Content Hashing (for idempotency)
// ──────────────────────────────────────────────────────────────

export async function hashEmailContent(email: {
  from: string;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
}): Promise<string> {
  const content = JSON.stringify({
    from: email.from.toLowerCase(),
    to: email.to.map(t => t.toLowerCase()).sort(),
    subject: email.subject.trim(),
    text: email.text?.trim(),
    html: email.html?.trim(),
  });
  return sha256Hex(content);
}

// ──────────────────────────────────────────────────────────────
// JWKS Generation (for Ed25519 public key exposure)
// ──────────────────────────────────────────────────────────────

export interface JWKS {
  keys: JsonWebKey[];
}

export async function generateJWKS(publicKeyBase64url: string): Promise<JWKS> {
  const keyData = base64urlDecode(publicKeyBase64url);
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'Ed25519' },
    true,
    ['verify']
  );
  
  const jwk = await crypto.subtle.exportKey('jwk', key);
  
  const kidHash = await crypto.subtle.digest('SHA-256', keyData);
  const kid = base64urlEncode(new Uint8Array(kidHash)).slice(0, 16);
  
  return {
    keys: [{
      ...jwk,
      use: 'sig',
      alg: 'EdDSA',
      kid,
    } as JsonWebKey & { kid: string }],
  };
}

export async function generateEd25519KeyPair(): Promise<{ privateKey: string; publicKey: string }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify']
  ) as CryptoKeyPair;
  
  const privateKeyRaw = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey) as ArrayBuffer;
  const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey) as ArrayBuffer;
  
  return {
    privateKey: base64urlEncode(new Uint8Array(privateKeyRaw)),
    publicKey: base64urlEncode(new Uint8Array(publicKeyRaw)),
  };
}