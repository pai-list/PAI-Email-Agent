// agent-email-router — Cloudflare Email Worker
// Catch-all: *@axiomid.app → route to agent Durable Object
// Free, unlimited inbound email. No per-mailbox provisioning.
//
// Deploy: npx wrangler deploy
// Route:  Cloudflare Dashboard → Email → Email Routing → catch-all → this Worker

import { AgentEmail } from '../sdk/ts/src/email.js';

export interface Env {
  AGENT_STATE: DurableObjectNamespace;
  PAI_RECEIPTS: KVNamespace;
  RESEND_API_KEY: string;
  PASSPORT_PRIVATE_KEY: string;
  PASSPORT_KEY_ID: string;
  PASSPORT_ISSUER: string;
  EMAIL_DOMAIN: string;
}

async function streamToText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const MAX = 65536; // 64KB max body
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.length > MAX) break;
    chunks.push(value);
    total += value.length;
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function hashEmail(email: AgentEmail): Promise<string> {
  const data = new TextEncoder().encode(
    `${email.to}:${email.from}:${email.subject}:${email.timestamp}`
  );
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function extractAgentId(to: string): string | null {
  const localPart = to.split('@')[0]?.toLowerCase();
  if (!localPart) return null;
  if (!/^[a-z0-9][a-z0-9-]{2,29}$/.test(localPart)) return null;
  return localPart;
}

// Protected email addresses that should never be modified
const PROTECTED_ADDRESSES = new Set([
  'rita@axiomid.app', // Routes to retajabdul3zizfahmy@gmail.com — DO NOT TOUCH
]);

export default {
  async email(
    message: ForwardableEmailMessage,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const to = message.to;
    const from = message.from;
    const subject = message.headers.get('subject') ?? '(no subject)';

    // Check protected addresses
    if (PROTECTED_ADDRESSES.has(to.toLowerCase())) {
      console.log(`🔒 Protected address: ${to} — routing preserved`);
      // The routing rule in Cloudflare Dashboard handles this
      return;
    }

    const agentId = extractAgentId(to);

    if (!agentId) {
      console.error('No valid agent ID in recipient:', to);
      return;
    }

    const email: AgentEmail = {
      to,
      from,
      subject,
      body: await streamToText(message.raw),
      agentId,
      timestamp: new Date().toISOString(),
      headers: {
        'message-id': message.headers.get('message-id') || '',
        'references': message.headers.get('references') || '',
        'in-reply-to': message.headers.get('in-reply-to') || '',
        'content-type': message.headers.get('content-type') || '',
      },
    };

    // Route to agent's Durable Object
    try {
      const agentNamespace = env.AGENT_STATE.idFromName(agentId);
      const agentStub = env.AGENT_STATE.get(agentNamespace);

      await agentStub.fetch('https://internal/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(email),
      });
    } catch (err) {
      console.error(`Failed to route to agent ${agentId}:`, err);
    }

    // Log to PAI_RECEIPTS KV for audit
    const emailHash = await hashEmail(email);
    await env.PAI_RECEIPTS.put(
      `email:${emailHash}`,
      JSON.stringify({ ...email, hash: emailHash }),
      { expirationTtl: 86400 * 30 } // 30 days
    );

    console.log(`📧 Routed email to agent:${agentId} from:${from} subj:"${subject}"`);
  },
} satisfies ExportedHandler<Env>;