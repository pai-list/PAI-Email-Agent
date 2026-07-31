import { Resend } from 'resend';
import type { PassportClaims, EmailAgentConfig } from './email.js';

export class ResendEmailClient {
  private resend: Resend;
  private config: EmailAgentConfig;

  constructor(config: EmailAgentConfig) {
    this.config = config;
    this.resend = new Resend(config.resendApiKey);
  }

  /**
   * Send an email with passport authorization
   */
  async sendEmail(params: {
    to: string | string[];
    subject: string;
    react: React.ReactElement;
    templateName?: string;
    passport: PassportClaims;
    headers?: Record<string, string>;
    replyTo?: string;
  }): Promise<{ id: string }> {
    const { to, subject, react, templateName, passport, headers = {}, replyTo } = params;

    // Validate passport
    this.validatePassportForSend(passport, templateName);

    // Build from address from passport
    const from = `${passport.agent.name} <${passport.email.address}>`;

    // Add passport authorization header
    const authHeaders = {
      'Authorization': `Bearer ${passport}`,
      'X-Passport-Version': '1',
      ...headers,
    };

    const result = await this.resend.emails.send({
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      react,
      replyTo,
      headers: authHeaders,
    });

    // Log for audit (in production, send to worker for KV storage)
    console.log(`📧 Sent email: ${result.id} to ${to} via ${passport.email.address}`);

    return result;
  }

  /**
   * Send using a named template
   */
  async sendTemplate(params: {
    to: string | string[];
    templateName: 'welcome' | 'notification' | 'verification' | 'alert';
    data: Record<string, unknown>;
    passport: PassportClaims;
    headers?: Record<string, string>;
  }) {
    const template = await this.getTemplate(params.templateName);
    const reactElement = template(params.data);

    return this.sendEmail({
      ...params,
      react: reactElement,
      templateName: params.templateName,
    });
  }

  /**
   * Validate passport has send permissions
   */
  private validatePassportForSend(passport: PassportClaims, templateName?: string): void {
    if (!passport.capabilities.sendEmail.enabled) {
      throw new Error('SEND_DISABLED: Agent does not have email send capability');
    }

    if (passport.capabilities.sendEmail.provider !== 'resend') {
      throw new Error('INVALID_PROVIDER: Only Resend is supported');
    }

    if (templateName && passport.capabilities.sendEmail.templates) {
      if (!passport.capabilities.sendEmail.templates.includes(templateName)) {
        throw new Error(`TEMPLATE_NOT_ALLOWED: Template "${templateName}" not in allowed list`);
      }
    }

    if (!passport.email.verified) {
      throw new Error('DOMAIN_NOT_VERIFIED: Email domain not verified');
    }

    if (passport.exp < Date.now() / 1000) {
      throw new Error('PASSPORT_EXPIRED: Passport has expired');
    }
  }

  /**
   * Get template by name (dynamic import)
   */
  private async getTemplate(name: string) {
    const { templates } = await import('./templates/index.js');
    const template = templates[name];
    if (!template) {
      throw new Error(`TEMPLATE_NOT_FOUND: Template "${name}" not found`);
    }
    return template;
  }

  /**
   * Get send statistics (from Resend API)
   */
  async getStats(): Promise<{
    sent: number;
    delivered: number;
    bounced: number;
    complained: number;
    opened: number;
    clicked: number;
  }> {
    // Resend doesn't have a stats endpoint yet, return zeros
    // In production, track via webhooks + KV
    return {
      sent: 0,
      delivered: 0,
      bounced: 0,
      complained: 0,
      opened: 0,
      clicked: 0,
    };
  }
}

/**
 * Create a configured client from environment
 */
export function createResendClient(config: EmailAgentConfig): ResendEmailClient {
  return new ResendEmailClient(config);
}