# PAI-Email-Agent Setup Guide

> **Step-by-step guide to deploy and configure the PAI Email Infrastructure**

## 📋 Prerequisites

Before starting, ensure you have:

- [ ] **Cloudflare Account** with Workers paid plan ($5/mo) or free tier
- [ ] **Resend Account** (3,000 emails/month free)
- [ ] **Domain** configured on Cloudflare (we use `axiomid.app`)
- [ ] **GitHub Account** with access to `pai-list` organization
- [ ] **Node.js 20+** and **pnpm 9+** installed locally
- [ ] **Wrangler CLI** installed (`npm i -g wrangler`)

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        PAI-Email-Agent                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │ Email Router │    │Email Sender  │    │Webhook Processor │  │
│  │  (Inbound)   │    │  (Outbound)  │    │  (Background)    │  │
│  └──────┬───────┘    └──────┬───────┘    └────────┬─────────┘  │
│         │                   │                       │            │
│         ▼                   ▼                       ▼            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Cloudflare Workers Runtime                   │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────────────┐  │   │
│  │  │EMAIL_KV │ │AGENT_KV │ │RATE_LMT │ │  WEBHOOK_KV   │  │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └───────────────┘  │   │
│  │  ┌─────────────────────────────────────────────────────┐  │   │
│  │  │           AGENT_INBOX_DO (Durable Objects)          │  │   │
│  │  └─────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│         │                   │                       │            │
│         ▼                   ▼                       ▼            │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │ Cloudflare   │    │    Resend    │    │  Agent Webhooks  │  │
│  │ Email Route  │    │   API        │    │  (PAI Agents)    │  │
│  └──────────────┘    └──────────────┘    └──────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start (5 Minutes)

### 1. Clone & Install

```bash
git clone https://github.com/pai-list/PAI-Email-Agent.git
cd PAI-Email-Agent
pnpm install
```

### 2. Configure Environment

```bash
# Copy example configs
cp worker/email-router/wrangler.toml.example worker/email-router/wrangler.toml
cp worker/email-sender/wrangler.toml.example worker/email-sender/wrangler.toml
cp worker/webhook-processor/wrangler.toml.example worker/webhook-processor/wrangler.toml
```

### 3. Create KV Namespaces

```bash
# Create production KV namespaces
wrangler kv:namespace create EMAIL_KV
wrangler kv:namespace create AGENT_KV
wrangler kv:namespace create RATE_LIMIT_KV
wrangler kv:namespace create WEBHOOK_KV

# Create preview (staging) KV namespaces
wrangler kv:namespace create EMAIL_KV --preview
wrangler kv:namespace create AGENT_KV --preview
wrangler kv:namespace create RATE_LIMIT_KV --preview
wrangler kv:namespace create WEBHOOK_KV --preview
```

Update `wrangler.toml` files with the returned IDs.

### 4. Set Secrets

```bash
# Email Router secrets
wrangler secret put RESEND_API_KEY --env production
wrangler secret put RESEND_WEBHOOK_SECRET --env production
wrangler secret put JWT_SECRET --env production
wrangler secret put CF_API_TOKEN --env production
wrangler secret put WEBHOOK_SECRET --env production

# Email Sender secrets
wrangler secret put RESEND_API_KEY --env production
wrangler secret put JWT_SECRET --env production

# Webhook Processor secrets
wrangler secret put JWT_SECRET --env production
```

### 5. Configure Cloudflare Email Routing

1. Go to **Cloudflare Dashboard** → **Email** → **Email Routing**
2. Enable Email Routing for `axiomid.app`
3. Create catch-all rule:
   - **Match**: `*@agents.axiomid.app`
   - **Action**: Send to Worker → `pai-email-router`
4. Verify DNS records are created automatically

### 6. Configure Resend

1. Go to **Resend Dashboard** → **API Keys**
2. Create API key with **Sending access**
3. Add domain `axiomid.app` in **Domains**
4. Configure webhook:
   - URL: `https://email-sender.your-subdomain.workers.dev/webhook/resend`
   - Events: `email.sent`, `email.delivered`, `email.bounced`, `email.complained`, `email.opened`, `email.clicked`
   - Signing secret: Generate and save as `RESEND_WEBHOOK_SECRET`

### 7. Deploy Workers

```bash
# Deploy all workers to production
for worker in email-router email-sender webhook-processor; do
  cd worker/$worker
  wrangler deploy --env production
  cd ../..
done
```

### 8. Verify Deployment

```bash
# Test email router
curl https://email-router.your-subdomain.workers.dev/health

# Test email sender
curl https://email-sender.your-subdomain.workers.dev/health

# Test webhook processor
curl https://webhook-processor.your-subdomain.workers.dev/health
```

---

## 🔧 Detailed Configuration

### Cloudflare Email Routing Setup

#### Step 1: Enable Email Routing
1. Navigate to **Email** → **Email Routing** in Cloudflare Dashboard
2. Click **Enable Email Routing** for `axiomid.app`
3. Cloudflare will automatically add required DNS records:
   - `MX` record pointing to Cloudflare's mail servers
   - `TXT` records for SPF/DKIM/DMARC

#### Step 2: Create Catch-All Rule
1. Go to **Email Routing** → **Rules**
2. Click **Create Rule**
3. Configure:
   - **Rule name**: `PAI Agent Inbound`
   - **Match**: `Custom` → `*@agents.axiomid.app`
   - **Action**: `Send to Worker` → Select `pai-email-router`
4. Save rule

#### Step 3: Verify DNS Records
Cloudflare automatically creates:
```
Type    Name                    Content
MX      agents.axiomid.app      mx.cloudflare.net
TXT     agents.axiomid.app      v=spf1 include:_spf.mx.cloudflare.net ~all
TXT     _dmarc.agents           v=DMARC1; p=none; rua=mailto:amrikyy@gmail.com
```

### Resend Configuration

#### Domain Setup
1. In Resend Dashboard, go to **Domains** → **Add Domain**
2. Enter `axiomid.app`
3. Add DNS records provided by Resend:
   - `MX` record for sending
   - `TXT` record for DKIM
   - `TXT` record for SPF
   - `TXT` record for DMARC
4. Verify domain (green checkmark)

#### Webhook Configuration
1. Go to **Webhooks** → **Create Webhook**
2. **URL**: `https://email-sender.<your-subdomain>.workers.dev/webhook/resend`
3. **Events**: Select all email events
4. **Signing Secret**: Generate a secure random string (32+ chars)
5. Save the secret - you'll need it for `RESEND_WEBHOOK_SECRET`

#### API Key
1. Go to **API Keys** → **Create API Key**
2. **Name**: `PAI Email Agent`
3. **Permissions**: Sending access
4. Copy the key (starts with `re_`) - this is your `RESEND_API_KEY`

### Agent Registration

Agents register themselves to receive emails and send emails:

```bash
# Register an agent (requires admin token)
curl -X POST https://email-router.your-subdomain.workers.dev/admin/agents/register \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "agentName": "alice",
    "agentDomain": "alice.axiomid.app",
    "webhookUrl": "https://alice.axiomid.app/webhook/email",
    "statusEndpoint": "https://alice.axiomid.app/webhook/email/status",
    "permissions": ["email:send", "email:receive", "webhook:receive"],
    "emailQuota": {
      "hourly": 100,
      "daily": 1000,
      "monthly": 10000
    }
  }'
```

This creates:
- Email address: `alice@agents.axiomid.app`
- Webhook delivery to agent's endpoint
- Rate limits per quota

### JWT Token Generation (for agents)

Agents get JWT tokens from AxiomID (Agent Passport):

```typescript
// In AxiomID / Agent Passport service
import { signJWT } from '@pai/email-shared/crypto';

const token = await signJWT({
  agentName: 'alice',
  agentDomain: 'alice.axiomid.app',
  permissions: ['email:send', 'email:receive', 'webhook:receive'],
  emailQuota: { hourly: 100, daily: 1000, monthly: 10000 },
}, process.env.JWT_SECRET!, {
  expiresIn: 3600, // 1 hour
  issuer: 'pai-email-agent',
  audience: 'pai-agents',
});

// Agent uses this token for all API calls
```

---

## 🧪 Testing

### Send Test Email

```bash
# Get agent token first (from AxiomID)
AGENT_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Send email
curl -X POST https://email-sender.your-subdomain.workers.dev/send \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "test@example.com",
    "subject": "Test from PAI Email Agent",
    "text": "Hello! This is a test email from alice@agents.axiomid.app",
    "html": "<h1>Hello!</h1><p>This is a test email from <strong>alice@agents.axiomid.app</strong></p>"
  }'
```

### Receive Test Email

Send an email to `alice@agents.axiomid.app` from any email client. The agent's webhook should receive:

```json
{
  "event": "email.received",
  "timestamp": 1700000000000,
  "correlationId": "abc123",
  "payload": {
    "email": {
      "id": "<message-id@domain.com>",
      "agentName": "alice",
      "from": { "name": "Test User", "email": "test@example.com" },
      "to": [{ "name": "Alice", "email": "alice@agents.axiomid.app" }],
      "subject": "Test email",
      "text": "Hello Alice!",
      "receivedAt": 1700000000000,
      "processed": false
    }
  },
  "signature": "hmac-sha256-signature"
}
```

### Check Email Status

```bash
curl -X GET https://email-sender.your-subdomain.workers.dev/quota \
  -H "Authorization: Bearer $AGENT_TOKEN"
```

---

## 📊 Monitoring & Debugging

### Worker Logs

```bash
# Stream logs in real-time
wrangler tail email-router --env production
wrangler tail email-sender --env production
wrangler tail webhook-processor --env production
```

### Metrics to Watch

| Metric | Healthy Range | Alert Threshold |
|--------|---------------|-----------------|
| Email delivery latency | < 500ms | > 2s |
| Webhook delivery success | > 99% | < 95% |
| Rate limit rejections | < 1% | > 5% |
| Resend API errors | 0 | > 0 |
| Dead letter queue size | 0 | > 10 |

### Cloudflare Dashboard

Monitor in **Workers & Pages** → Select each worker:
- **Requests**: Total requests, errors, success rate
- **Duration**: P50, P95, P99 latency
- **CPU Time**: Should be minimal for email routing

### Resend Dashboard

Monitor in **Resend** → **Logs**:
- Delivery rates
- Bounce/complaint rates
- Open/click tracking

---

## 🔒 Security Checklist

- [ ] **JWT_SECRET**: 256-bit random string, rotated quarterly
- [ ] **RESEND_API_KEY**: Stored only in Cloudflare secrets, never in code
- [ ] **RESEND_WEBHOOK_SECRET**: Unique per environment, verify on each webhook
- [ ] **WEBHOOK_SECRET**: HMAC secret for agent webhooks, unique per agent
- [ ] **CF_API_TOKEN**: Scoped to Workers Scripts:Edit, Account:Read only
- [ ] **Rate limits**: Enforced on all endpoints
- [ ] **CORS**: Configured to only allow `axiomid.app` subdomains
- [ ] **TLS**: All endpoints HTTPS only (enforced by Cloudflare)
- [ ] **DKIM/SPF/DMARC**: Configured for `axiomid.app` and `agents.axiomid.app`

---

## 🚨 Troubleshooting

### Email Not Received

1. **Check Email Routing rule**: Is `*@agents.axiomid.app` pointing to `pai-email-router`?
2. **Check worker logs**: `wrangler tail email-router` - any errors?
3. **Check DNS**: `dig MX agents.axiomid.app` - should point to Cloudflare
4. **Check KV**: Is agent registered in `AGENT_KV`?

### Email Not Sent

1. **Check Resend API key**: Valid and has sending permission?
2. **Check domain verification**: `axiomid.app` verified in Resend?
3. **Check rate limits**: Agent exceeded quota?
4. **Check JWT**: Token valid, not expired, correct permissions?

### Webhook Not Delivered

1. **Check agent webhook URL**: Accessible from internet?
2. **Check webhook secret**: Matches what agent expects?
3. **Check webhook processor logs**: `wrangler tail webhook-processor`
4. **Check dead letter queue**: `GET /stats` on webhook-processor

### High Latency

1. **Check Resend API status**: Any incidents?
2. **Check Cloudflare Workers status**: Any regional issues?
3. **Check KV latency**: Consider upgrading to paid plan for lower latency

---

## 📈 Scaling Considerations

### Current Limits (Free Tier)
- **Cloudflare Workers**: 100,000 requests/day
- **KV Operations**: 100,000 reads/day, 1,000 writes/day
- **Durable Objects**: 1M requests/month
- **Resend**: 3,000 emails/month

### Upgrade Path

| Component | Free Tier | Paid Upgrade |
|-----------|-----------|--------------|
| Cloudflare Workers | 100K req/day | $5/mo → 10M req/month |
| KV | 100K reads/day | $0.50/million reads |
| Durable Objects | 1M req/month | Included in Workers paid |
| Resend | 3K emails/month | $20/month → 50K emails |

### Horizontal Scaling

- **Email Router**: Stateless, auto-scales with Cloudflare
- **Email Sender**: Stateless, auto-scales with Cloudflare  
- **Webhook Processor**: Single instance (cron), can shard by agent name
- **Durable Objects**: Automatically sharded by agent name

---

## 🔄 CI/CD Pipeline

The repository includes GitHub Actions workflow (`.github/workflows/ci.yml`):

1. **Lint & TypeCheck** - Every PR
2. **Unit Tests** - Every PR
3. **Build Workers** - After tests pass
4. **Deploy Staging** - Push to `develop` branch
5. **Deploy Production** - Push to `main` branch
6. **Security Scan** - Weekly + on PR

### Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `CF_API_TOKEN` | Cloudflare API token with Workers Scripts:Edit |
| `CF_ACCOUNT_ID` | Cloudflare Account ID |
| `SNYK_TOKEN` | (Optional) Snyk token for security scanning |

---

## 📚 Additional Resources

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/)
- [Resend API Documentation](https://resend.com/docs)
- [Durable Objects Documentation](https://developers.cloudflare.com/durable-objects/)
- [PAI Universe Architecture](../ARCHITECTURE.md)

---

## 🆘 Support

- **Issues**: [GitHub Issues](https://github.com/pai-list/PAI-Email-Agent/issues)
- **Discussions**: [GitHub Discussions](https://github.com/pai-list/PAI-Email-Agent/discussions)
- **Email**: `support@axiomid.app`

---

*Last updated: 2026-07-31*
*Version: 0.1.0*