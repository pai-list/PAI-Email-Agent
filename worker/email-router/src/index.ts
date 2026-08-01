/**
 * PAI Email Router - Inbound Email Handler
 * 
 * Triggered by Cloudflare Email Routing catch-all rule for *@agents.axiomid.app
 * Parses emails, stores in Durable Object, delivers webhook to agent
 */

import { Router, type IRequest } from 'itty-router';
import { AgentInboxDO } from './storage.js';
import { extractAgentName } from './router.js';
import { generateCorrelationId } from '../../shared/src/crypto.js';
import type { CloudflareEnv, StoredEmail, EmailHeaders, EmailMessage, ForwardableEmailMessage } from '../../shared/src/types.js';

// ──────────────────────────────────────────────────────────────
// Main Handler
// ──────────────────────────────────────────────────────────────

const router = Router<IRequest, [CloudflareEnv, ExecutionContext]>();

// Health check
router.get('/health', () => new Response('OK', { status: 200 }));

// Email Routing trigger endpoint (HTTP fallback)
router.post('/email', async (request, env, ctx) => {
  const correlationId = generateCorrelationId();
  const startTime = Date.now();
  
  try {
    // Parse the email from Cloudflare Email Routing (HTTP fallback)
    const emailMessage = await parseHttpEmail(request);
    
    // Extract agent name from recipient
    const agentName = extractAgentName(emailMessage.to);
    if (!agentName) {
      console.warn(`[${correlationId}] No valid agent found in recipients: ${emailMessage.to.join(', ')}`);
      return new Response('No valid agent recipient', { status: 400 });
    }
    
    // Get or create Durable Object for this agent's inbox
    const stub = getAgentInboxStub(env, agentName);
    
    // Store email in Durable Object
    const storedEmail = await storeEmail(stub, emailMessage, agentName, correlationId);
    
    // Deliver webhook to agent (async, don't block) - wrapped in waitUntil
    ctx.waitUntil(
      deliverWebhookAsync(stub, env, agentName, storedEmail, correlationId)
        .catch(err => console.error(`[${correlationId}] Webhook failed:`, err))
    );
    
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
  const stub = getAgentInboxStub(env, agentName);
  
  const response = await stub.fetch(new Request('https://internal/admin/list'));
  return response;
});

router.get('/admin/inbox/:agentName/:emailId', async (request, env) => {
  const agentName = request.params.agentName!;
  const emailId = request.params.emailId!;
  const stub = getAgentInboxStub(env, agentName);
  
  const response = await stub.fetch(new Request(`https://internal/admin/get/${emailId}`));
  return response;
});

function getAgentInboxStub(env: CloudflareEnv, agentName: string): DurableObjectStub<AgentInboxDO> {
  const namespace = env.AGENT_INBOX_DO as unknown as DurableObjectNamespace<AgentInboxDO>;
  return namespace.get(namespace.idFromName(agentName));
}

// ──────────────────────────────────────────────────────────────
// Helper Functions
// ──────────────────────────────────────────────────────────────

async function parseHttpEmail(request: Request): Promise<EmailMessage> {
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
    
    let headers: EmailMessage['headers'] = {} as EmailMessage['headers'];
    let attachments: EmailMessage['attachments'] = [];
    
    try { headers = JSON.parse(headersJson); } catch {}
    try { attachments = JSON.parse(attachmentsJson); } catch {}
    
    // Calculate raw size
    const rawSize = new TextEncoder().encode(JSON.stringify({
      from, to, subject, text, html, headers, attachments
    })).length;
    
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
): Promise<void> {
  return (async () => {
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

  // Cloudflare Email Routing "Send to Worker" handler
  async email(message: ForwardableEmailMessage, env: CloudflareEnv, ctx: ExecutionContext): Promise<void> {
    const correlationId = generateCorrelationId();
    // Convert ForwardableEmailMessage to internal format
    const emailMessage = {
      from: message.from,
      to: [message.to],
      subject: message.subject || '',
      text: message.text,
      html: message.html,
      headers: Object.fromEntries(message.headers.entries()) as EmailHeaders,
      attachments: message.attachments?.map(a => ({
        filename: a.filename,
        contentType: a.contentType,
        content: a.content, // already base64
        size: a.content.length,
      })) || [],
      rawSize: message.rawSize,
    };

    const agentName = extractAgentName(emailMessage.to);
    if (!agentName) return;

    const stub = getAgentInboxStub(env, agentName);

    const storedEmail = await storeEmail(stub, emailMessage, agentName, correlationId);

    ctx.waitUntil(
      deliverWebhookAsync(stub, env, agentName, storedEmail, correlationId)
        .catch(err => console.error(`[${correlationId}] Webhook failed:`, err))
    );
  },
} satisfies ExportedHandler<CloudflareEnv>;