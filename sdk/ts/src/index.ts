export * from './email.js';
export * from './resend.js';
export * from './templates/index.js';

import { createResendClient, ResendEmailClient } from './resend.js';
import type { EmailAgentConfig, PassportClaims } from './email.js';

export { createResendClient, ResendEmailClient };

/**
 * Quick start: Create a configured email client
 */
export function createEmailAgent(config: EmailAgentConfig): ResendEmailClient {
  return createResendClient(config);
}

/**
 * Create passport for agent (requires Ed25519 private key)
 * In production, use @pai/agent-passport SDK
 */
export async function createAgentPassport(params: {
  agentId: string;
  agentName: string;
  emailAddress: string;
  ownerDid: string;
  subdomain: string;
  privateKey: Uint8Array; // Ed25519 private key (32 bytes)
  audience: string | string[];
  expiresInSeconds?: number;
}): Promise<PassportClaims> {
  const { agentId, agentName, emailAddress, ownerDid, subdomain, privateKey, audience, expiresInSeconds = 3600 } = params;
  
  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(audience) ? audience : [audience];
  
  // In production, sign with Ed25519 private key
  // This is a placeholder - use @noble/ed25519 or similar
  const unsignedClaims = {
    iss: 'https://passport.pai.agent',
    sub: `did:axiom:agent:${agentId}`,
    aud,
    iat: now,
    exp: now + expiresInSeconds,
    nonce: crypto.getRandomValues(new Uint8Array(32)).toString(),
    email: {
      address: emailAddress,
      verified: true,
      domain: emailAddress.split('@')[1],
      localPart: emailAddress.split('@')[0],
      routing: 'cloudflare-email-worker' as const,
    },
    agent: {
      id: agentId,
      name: agentName,
      subdomain,
      owner: ownerDid,
      status: 'active' as const,
      mode: 'autonomous' as const,
    },
    capabilities: {
      sendEmail: {
        enabled: true,
        provider: 'resend' as const,
        dailyLimit: 100,
        monthlyLimit: 3000,
        templates: ['welcome', 'notification', 'verification'],
      },
      receiveEmail: {
        enabled: true,
        routing: 'cloudflare-catch-all' as const,
        maxSizeKB: 64,
      },
    },
    permissions: {
      scopes: ['email:send', 'email:receive', 'email:templates'],
      delegatedFrom: [ownerDid],
      delegatedTo: [],
    },
  };
  
  // TODO: Sign with privateKey using Ed25519
  // const signature = await nobleEd25519.sign(JSON.stringify(unsignedClaims), privateKey);
  // return { ...unsignedClaims, signature };
  
  return unsignedClaims as PassportClaims;
}