/**
 * AgentInboxDO - Durable Object for storing agent emails
 * Each agent gets their own Durable Object instance (sharded by agentName)
 */

import { DurableObject } from 'cloudflare:workers';
import type { StoredEmail, CloudflareEnv } from '../../shared/types.js';
import { generateCorrelationId, hashEmailContent } from '../../shared/crypto.js';

// ──────────────────────────────────────────────────────────────
// Durable Object Class
// ──────────────────────────────────────────────────────────────

export class AgentInboxDO extends DurableObject<CloudflareEnv> {
  private readonly STORAGE_KEY_PREFIX = 'email:';
  private readonly INDEX_KEY = 'index';
  private readonly MAX_EMAILS_PER_AGENT = 10000;
  private readonly MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB

  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    super(ctx, env);
    // Ensure index exists
    this.ctx.blockConcurrencyWhile(async () => {
      const index = await this.ctx.storage.get<string[]>(this.INDEX_KEY);
      if (!index) {
        await this.ctx.storage.put(this.INDEX_KEY, []);
      }
    });
  }

  // ──────────────────────────────────────────────────────────────
  // RPC Methods (called via stub.fetch with internal routes)
  // ──────────────────────────────────────────────────────────────

  async storeEmail(data: {
    correlationId: string;
    agentName: string;
    email: {
      from: { name?: string; email: string };
      to: { name?: string; email: string }[];
      cc?: { name?: string; email: string }[];
      subject: string;
      text?: string;
      html?: string;
      headers: Record<string, string>;
      attachments: Array<{
        filename: string;
        contentType: string;
        content: string;
        size: number;
      }>;
      rawSize: number;
    };
  }): Promise<StoredEmail> {
    const { correlationId, agentName, email } = data;

    // Check storage quota
    const index = await this.getIndex();
    if (index.length >= this.MAX_EMAILS_PER_AGENT) {
      // Remove oldest email (FIFO)
      const oldestId = index[0];
      await this.deleteEmail(oldestId);
      index.shift();
    }

    // Generate email ID from Message-ID header or content hash
    const messageId = email.headers['message-id'] || hashEmailContent({
      from: email.from.email,
      to: email.to.map(t => t.email),
      subject: email.subject,
      text: email.text,
      html: email.html,
    });

    // Check for duplicate (idempotency)
    const existing = await this.ctx.storage.get<StoredEmail>(`${this.STORAGE_KEY_PREFIX}${messageId}`);
    if (existing) {
      console.log(`[${correlationId}] Duplicate email ignored: ${messageId}`);
      return existing;
    }

    // Build stored email object
    const storedEmail: StoredEmail = {
      id: messageId,
      agentName,
      from: email.from,
      to: email.to,
      cc: email.cc || [],
      subject: email.subject,
      text: email.text,
      html: email.html,
      headers: email.headers as StoredEmail['headers'],
      attachments: email.attachments.map(a => ({
        filename: a.filename,
        contentType: a.contentType,
        content: a.content,
        size: a.size,
      })),
      receivedAt: Date.now(),
      size: email.rawSize,
      spamScore: this.parseSpamScore(email.headers),
      dkimResult: this.parseDKIMResult(email.headers),
      spfResult: this.parseSPFResult(email.headers),
      dmarcResult: this.parseDMARCResult(email.headers),
      processed: false,
      webhookAttempts: 0,
    };

    // Store email
    await this.ctx.storage.put(`${this.STORAGE_KEY_PREFIX}${messageId}`, storedEmail);

    // Update index (newest first)
    index.unshift(messageId);
    await this.ctx.storage.put(this.INDEX_KEY, index);

    console.log(`[${correlationId}] Email stored for ${agentName}: ${messageId}`);
    return storedEmail;
  }

  async listEmails(params: {
    limit?: number;
    offset?: number;
    since?: number;
    unreadOnly?: boolean;
  } = {}): Promise<{ emails: StoredEmail[]; total: number }> {
    const index = await this.getIndex();
    const { limit = 50, offset = 0, since, unreadOnly = false } = params;

    let filtered = index;

    if (since) {
      filtered = filtered.filter(id => {
        const email = this.ctx.storage.get<StoredEmail>(`${this.STORAGE_KEY_PREFIX}${id}`);
        return email.then(e => e && e.receivedAt > since);
      });
      // Wait for all promises
      const results = await Promise.all(filtered.map(id => 
        this.ctx.storage.get<StoredEmail>(`${this.STORAGE_KEY_PREFIX}${id}`)
      ));
      filtered = filtered.filter((_, i) => results[i] && (!since || results[i]!.receivedAt > since));
    }

    if (unreadOnly) {
      const results = await Promise.all(filtered.map(id => 
        this.ctx.storage.get<StoredEmail>(`${this.STORAGE_KEY_PREFIX}${id}`)
      ));
      filtered = filtered.filter((_, i) => results[i] && !results[i]!.processed);
    }

    const total = filtered.length;
    const paginated = filtered.slice(offset, offset + limit);

    const emails = await Promise.all(
      paginated.map(id => this.ctx.storage.get<StoredEmail>(`${this.STORAGE_KEY_PREFIX}${id}`))
    );

    return {
      emails: emails.filter((e): e is StoredEmail => e !== null && e !== undefined),
      total,
    };
  }

  async getEmail(emailId: string): Promise<StoredEmail | null> {
    return this.ctx.storage.get<StoredEmail>(`${this.STORAGE_KEY_PREFIX}${emailId}`) || null;
  }

  async markWebhookDelivered(emailId: string): Promise<boolean> {
    const email = await this.getEmail(emailId);
    if (!email) return false;

    email.processed = true;
    email.webhookDeliveredAt = Date.now();
    await this.ctx.storage.put(`${this.STORAGE_KEY_PREFIX}${emailId}`, email);
    return true;
  }

  async incrementWebhookAttempts(emailId: string): Promise<number> {
    const email = await this.getEmail(emailId);
    if (!email) return 0;

    email.webhookAttempts += 1;
    await this.ctx.storage.put(`${this.STORAGE_KEY_PREFIX}${emailId}`, email);
    return email.webhookAttempts;
  }

  async deleteEmail(emailId: string): Promise<boolean> {
    const deleted = await this.ctx.storage.delete(`${this.STORAGE_KEY_PREFIX}${emailId}`);
    if (deleted) {
      const index = await this.getIndex();
      const filtered = index.filter(id => id !== emailId);
      await this.ctx.storage.put(this.INDEX_KEY, filtered);
    }
    return deleted;
  }

  async getStats(): Promise<{
    totalEmails: number;
    unreadEmails: number;
    totalSize: number;
    oldestEmail?: number;
    newestEmail?: number;
  }> {
    const index = await this.getIndex();
    if (index.length === 0) {
      return { totalEmails: 0, unreadEmails: 0, totalSize: 0 };
    }

    const emails = await Promise.all(
      index.map(id => this.ctx.storage.get<StoredEmail>(`${this.STORAGE_KEY_PREFIX}${id}`))
    );

    const validEmails = emails.filter((e): e is StoredEmail => e !== null && e !== undefined);
    const unread = validEmails.filter(e => !e.processed).length;
    const totalSize = validEmails.reduce((sum, e) => sum + e.size, 0);
    const timestamps = validEmails.map(e => e.receivedAt).sort((a, b) => a - b);

    return {
      totalEmails: validEmails.length,
      unreadEmails: unread,
      totalSize,
      oldestEmail: timestamps[0],
      newestEmail: timestamps[timestamps.length - 1],
    };
  }

  // ──────────────────────────────────────────────────────────────
  // HTTP Handler (for internal RPC-style calls)
  // ──────────────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/internal/store' && request.method === 'POST') {
        const data = await request.json();
        const result = await this.storeEmail(data);
        return Response.json(result);
      }

      if (path === '/internal/deliver-webhook' && request.method === 'POST') {
        const data = await request.json();
        // This is handled by the main worker, not the DO
        return Response.json({ ok: true });
      }

      if (path === '/internal/admin/list' && request.method === 'GET') {
        const { searchParams } = url;
        const limit = parseInt(searchParams.get('limit') || '50');
        const offset = parseInt(searchParams.get('offset') || '0');
        const result = await this.listEmails({ limit, offset });
        return Response.json(result);
      }

      if (path.startsWith('/internal/admin/get/') && request.method === 'GET') {
        const emailId = path.split('/').pop()!;
        const email = await this.getEmail(emailId);
        if (!email) return new Response('Not Found', { status: 404 });
        return Response.json(email);
      }

      if (path === '/internal/admin/stats' && request.method === 'GET') {
        const stats = await this.getStats();
        return Response.json(stats);
      }

      return new Response('Not Found', { status: 404 });
    } catch (error) {
      console.error('AgentInboxDO error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Private Helpers
  // ──────────────────────────────────────────────────────────────

  private async getIndex(): Promise<string[]> {
    return (await this.ctx.storage.get<string[]>(this.INDEX_KEY)) || [];
  }

  private parseSpamScore(headers: Record<string, string>): number | undefined {
    // Cloudflare adds X-Spam-Score header
    const spamHeader = headers['x-spam-score'] || headers['x-cloudflare-spam-score'];
    if (spamHeader) {
      const score = parseFloat(spamHeader);
      if (!isNaN(score)) return score;
    }
    return undefined;
  }

  private parseDKIMResult(headers: Record<string, string>): StoredEmail['dkimResult'] {
    const authResults = headers['authentication-results'] || '';
    if (authResults.includes('dkim=pass')) return 'pass';
    if (authResults.includes('dkim=fail')) return 'fail';
    if (authResults.includes('dkim=none')) return 'none';
    return 'none';
  }

  private parseSPFResult(headers: Record<string, string>): StoredEmail['spfResult'] {
    const authResults = headers['authentication-results'] || '';
    const receivedSpf = headers['received-spf'] || '';
    const combined = authResults + ' ' + receivedSpf;
    if (combined.includes('spf=pass')) return 'pass';
    if (combined.includes('spf=fail')) return 'fail';
    if (combined.includes('spf=none')) return 'none';
    return 'none';
  }

  private parseDMARCResult(headers: Record<string, string>): StoredEmail['dmarcResult'] {
    const authResults = headers['authentication-results'] || '';
    if (authResults.includes('dmarc=pass')) return 'pass';
    if (authResults.includes('dmarc=fail')) return 'fail';
    if (authResults.includes('dmarc=none')) return 'none';
    return 'none';
  }
}