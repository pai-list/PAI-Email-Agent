/**
 * PAI Email Router - Inbound Email Handler
 * 
 * Triggered by Cloudflare Email Routing catch-all rule for *@agents.axiomid.app
 * Parses emails, stores in Durable Object, delivers webhook to agent
 */

import { Router } from 'itty-router';
import { AgentInboxDO } from './storage.js';
import { parseEmail, extractAgentName } from './router.js';
import { deliverWebhook } from './webhook.js';
import { generateCorrelationId } from '../shared/crypto.js';
import type { CloudflareEnv, StoredEmail, EmailHeaders } from '../shared/types.js';

// ──────────────────────────────────────────────────────────────
// Type Definitions
// ──────────────────────────────────────────────────────────────

interface EmailMessage {
  from: string;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  headers: Record<string, string>;
  attachments: Array<{
    filename: string;
    contentType: string;
    content: string; // base64
    size: number;
  }>;
  rawSize: number;
}

// ──────────────────────────────────────────────────────────────
// Main Handler
// ──────────────────────────────────────────────────────────────

const router = Router<Request, CloudflareEnv>();

// Health check
router.get('/health', () => new Response('OK', { status: 200 }));

// Email Routing trigger endpoint
router.post('/email', async (request, env) => {
  const correlationId = generateCorrelationId();
  const startTime = Date.now();
  
  try {
    // Parse the email from Cloudflare Email Routing
    const emailMessage = await parseEmailMessage(request);
    
    // Extract agent name from recipient
    const agentName = extractAgentName(emailMessage.to);
    if (!agentName) {
      console.warn(`[${correlationId}] No valid agent found in recipients: ${emailMessage.to.join(', ')}`);
      return new Response('No valid agent recipient', { status: 400 });
    }
    
    // Get or create Durable Object for this agent's inbox
    const doId = env.AGENT_INBOX_DO.idFromName(agentName);
    const stub = env.AGENT_INBOX_DO.get(doId);
    
    // Store email in Durable Object
    const storedEmail = await storeEmail(stub, emailMessage, agentName, correlationId);
    
    // Deliver webhook to agent (async, don't block)
    deliverWebhookAsync(stub, env, agentName, storedEmail, correlationId);
    
    const latency = Date.now() - startTime;
    console.log(`[${correlationId}] Email routed to ${agentName} in ${latency}ms`);
    
    return new Response('Accepted', { status: 202 });
    
  } catch (error) {
    console.error(`[${correlationId}] Email routing error:`, error);
    return new Response('Internal Server Error', { status: 500 });
  }
});

// Admin endpoints for debugging
router.get('/admin/inbox/:agentName', async (request, env) => {
  const agentName = request.params.agentName!;
  const doId = env.AGENT_INBOX_DO.idFromName(agentName);
  const stub = env.AGENT_INBOX_DO.get(doId);
  
  const response = await stub.fetch(new Request('https://internal/admin/list'));
  return response;
});

router.get('/admin/inbox/:agentName/:emailId', async (request, env) => {
  const agentName = request.params.agentName!;
  const emailId = request.params.emailId!;
  const doId = env.AGENT_INBOX_DO.idFromName(agentName);
  const stub = env.AGENT_INBOX_DO.get(doId);
  
  const response = await stub.fetch(new Request(`https://internal/admin/get/${emailId}`));
  return response;
});

// ──────────────────────────────────────────────────────────────
// Helper Functions
// ──────────────────────────────────────────────────────────────

async function parseEmailMessage(request: Request): Promise<EmailMessage> {
  const contentType = request.headers.get('content-type') || '';
  
  if (contentType.includes('multipart/form-data')) {
    // Cloudflare Email Routing sends as multipart/form-data
    const formData = await request.formData();
    
    // Extract fields
    const from = formData.get('from') as string || '';
    const to = (formData.get('to') as string || '').split(',').map(s => s.trim());
    const subject = formData.get('subject') as string || '';
    const text = formData.get('text') as string || undefined;
    const html = formData.get('html') as string || undefined;
    const headersJson = formData.get('headers') as string || '{}';
    const attachmentsJson = formData.get('attachments') as string || '[]';
    
    let headers: Record<string, string> = {};
    let attachments: EmailMessage['attachments'] = [];
    
    try { headers = JSON.parse(headersJson); } catch {}
    try { attachments = JSON.parse(attachmentsJson); } catch {}
    
    // Calculate raw size
    const rawSize = Buffer.byteLength(JSON.stringify({
      from, to, subject, text, html, headers, attachments
    }));
    
    return { from, to, subject, text, html, headers, attachments, rawSize };
  }
  
  // Fallback: try JSON
  try {
    return await request.json();
  } catch {
    throw new Error('Unable to parse email message');
  }
}

async function storeEmail(
  stub: DurableObjectStub<AgentInboxDO>,
  emailMessage: EmailMessage,
  agentName: string,
  correlationId: string
): Promise<StoredEmail> {
  const response = await stub.fetch(new Request('https://internal/store', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      correlationId,
      agentName,
      email: emailMessage,
    }),
  }));
  
  if (!response.ok) {
    throw new Error(`Failed to store email: ${response.statusText}`);
  }
  
  return response.json();
}

function deliverWebhookAsync(
  stub: DurableObjectStub<AgentInboxDO>,
  env: CloudflareEnv,
  agentName: string,
  storedEmail: StoredEmail,
  correlationId: string
): void {
  // Fire and forget - don't await
  (async () => {
    try {
      const response = await stub.fetch(new Request('https://internal/deliver-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          correlationId,
          agentName,
          emailId: storedEmail.id,
          env: {
            WEBHOOK_SECRET: env.WEBHOOK_SECRET,
          },
        }),
      }));
      
      if (!response.ok) {
        console.warn(`[${correlationId}] Webhook delivery failed: ${response.statusText}`);
      }
    } catch (error) {
      console.error(`[${correlationId}] Webhook delivery error:`, error);
    }
  })();
}

// ──────────────────────────────────────────────────────────────
// Export
// ──────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
    return router.handle(request, env, ctx) || new Response('Not Found', { status: 404 });
  },
} satisfies ExportedHandler<CloudflareEnv>;