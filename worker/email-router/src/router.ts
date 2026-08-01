/**
 * Email parsing and routing utilities
 */

import type { EmailMessage, EmailHeaders, EmailAddress } from '../../shared/src/types.js';

// ──────────────────────────────────────────────────────────────
// Agent Name Extraction
// ──────────────────────────────────────────────────────────────

const AGENT_EMAIL_DOMAIN = 'agents.axiomid.app';

export function extractAgentName(recipients: string[]): string | null {
  for (const recipient of recipients) {
    const email = extractEmailAddress(recipient);
    if (email && email.endsWith(`@${AGENT_EMAIL_DOMAIN}`)) {
      const agentName = email.slice(0, -(`@${AGENT_EMAIL_DOMAIN}`.length));
      if (isValidAgentName(agentName)) {
        return agentName;
      }
    }
  }
  return null;
}

export function validateAgentEmail(email: string): boolean {
  const agentName = extractAgentName([email]);
  return agentName !== null;
}

function extractEmailAddress(input: string): string | null {
  // Handle "Name <email@domain.com>" format
  const match = input.match(/<([^>]+)>/);
  if (match) return match[1].toLowerCase().trim();

  // Handle plain email
  const trimmed = input.trim().toLowerCase();
  if (trimmed.includes('@')) return trimmed;

  return null;
}

function isValidAgentName(name: string): boolean {
  // Agent names: alphanumeric, hyphens, underscores, 1-63 chars
  return /^[a-z0-9][a-z0-9_-]{0,62}$/i.test(name);
}

// ──────────────────────────────────────────────────────────────
// Email Parsing
// ──────────────────────────────────────────────────────────────

export function parseEmailMessage(raw: EmailMessage): {
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  text?: string;
  html?: string;
  headers: EmailHeaders;
  attachments: Array<{
    filename: string;
    contentType: string;
    content: string;
    size: number;
    contentId?: string;
  }>;
} {
  // Parse From
  const from = parseEmailAddress(raw.from) || { email: raw.from };
  
  // Parse To
  const to = raw.to.map(parseEmailAddress).filter(Boolean) as EmailAddress[];
  
  // Parse CC from headers
  const ccHeader = raw.headers['cc'] || '';
  const cc = ccHeader.split(',').map(parseEmailAddress).filter(Boolean) as EmailAddress[];
  
  // Normalize headers
  const headers: EmailHeaders = {} as EmailHeaders;
  for (const [key, value] of Object.entries(raw.headers)) {
    headers[key.toLowerCase()] = value;
  }
  
  // Ensure required headers
  headers['message-id'] = headers['message-id'] || generateMessageId();
  headers['date'] = headers['date'] || new Date().toUTCString();
  
  return {
    from,
    to,
    cc,
    subject: raw.subject || '(no subject)',
    text: raw.text,
    html: raw.html,
    headers,
    attachments: raw.attachments.map(a => ({
      filename: a.filename,
      contentType: a.contentType,
      content: a.content,
      size: a.size,
    })),
  };
}

function parseEmailAddress(input: string): EmailAddress | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  
  // "Name <email@domain.com>" format
  const match = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) {
    return {
      name: match[1].trim().replace(/^["']|["']$/g, ''),
      email: match[2].toLowerCase().trim(),
    };
  }
  
  // Plain email
  if (trimmed.includes('@')) {
    return { email: trimmed.toLowerCase() };
  }
  
  return null;
}

function generateMessageId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `<${timestamp}.${random}@axiomid.app>`;
}

// ──────────────────────────────────────────────────────────────
// Email Validation
// ──────────────────────────────────────────────────────────────

export function validateEmailForRouting(parsed: ReturnType<typeof parseEmailMessage>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  if (!parsed.from?.email) {
    errors.push('Missing sender email');
  }
  
  if (parsed.to.length === 0) {
    errors.push('No recipients');
  }
  
  // Check for valid agent recipient
  const hasAgentRecipient = parsed.to.some(
    r => r.email.endsWith(`@${AGENT_EMAIL_DOMAIN}`)
  );
  
  if (!hasAgentRecipient) {
    errors.push('No valid agent recipient found');
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

// ──────────────────────────────────────────────────────────────
// Email Normalization
// ──────────────────────────────────────────────────────────────

export function normalizeEmailForStorage(parsed: ReturnType<typeof parseEmailMessage>) {
  return {
    ...parsed,
    from: {
      ...parsed.from,
      email: parsed.from.email.toLowerCase(),
    },
    to: parsed.to.map(r => ({
      ...r,
      email: r.email.toLowerCase(),
    })),
    cc: parsed.cc.map(r => ({
      ...r,
      email: r.email.toLowerCase(),
    })),
    subject: parsed.subject.trim(),
    text: parsed.text?.trim(),
    html: parsed.html?.trim(),
  };
}