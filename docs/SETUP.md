# PAI Email Agent — Detailed Setup Guide

This guide walks you through setting up the complete zero-cost email infrastructure for AI agents using Cloudflare (receive) + Resend (send).

---

## Prerequisites Checklist

- [ ] Cloudflare account with `axiomid.app` domain added
- [ ] Nameservers pointing to Cloudflare (verified)
- [ ] Resend account created
- [ ] Node.js 20+ installed
- [ ] Wrangler CLI installed (`npm i -g wrangler`)
- [ ] Git installed

---

## Phase 1: Cloudflare Setup

### 1.1 Add Domain to Cloudflare

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com)
2. Click **Add a site** → enter `axiomid.app`
3. Choose **Free plan**
4. Cloudflare will scan DNS records — review and continue
5. **Change nameservers** at your registrar to Cloudflare's:
   ```
   ns1.cloudflare.com
   ns2.cloudflare.com
   ```
6. Wait for propagation (5-30 minutes)

### 1.2 Verify DNS Propagation

```bash
# Check nameservers
dig axiomid.app NS

# Should return Cloudflare nameservers
# axiomid.app.  3600  IN  NS  ns1.cloudflare.com.
# axiomid.app.  3600  IN  NS  ns2.cloudflare.com.
```

### 1.3 Enable Email Routing

1. In Cloudflare Dashboard → **Email** → **Email Routing**
2. Click **Get started**
3. Cloudflare will add required DNS records automatically:
   - MX records for inbound
   - SPF/DKIM for authentication

### 1.4 Create Catch-all Routing Rule

1. Email Routing → **Rules** → **Create rule**
2. Configure:
   ```
   Rule name:     Agent Catch-all
   Custom address: *
   Action:        Send to a Worker
   Worker:        agent-email-router (deploy first, then select)
   ```
3. Save

> **Note**: Deploy the worker first (Phase 3), then come back to select it.

### 1.5 Create KV Namespace

```bash
# Production KV
npx wrangler kv namespace create PAI_RECEIPTS
# Output: binding = "PAI_RECEIPTS", id = "abc123..."

# Preview KV (for local dev)
npx wrangler kv namespace create PAI_RECEIPTS --preview
# Output: preview_id = "xyz789..."
```

Update `worker/wrangler.toml` with the returned IDs.

### 1.6 Note Your Account & Zone IDs

```bash
# Account ID
npx wrangler whoami
# Account ID: abc123...

# Zone ID (for axiomid.app)
npx wrangler zones list
# Find axiomid.app → copy Zone ID
```

---

## Phase 2: Resend Setup

### 2.1 Create Resend Account

1. Go to [resend.com](https://resend.com/) → Sign up
2. Verify your email

### 2.2 Add Domain

1. Resend Dashboard → **Domains** → **Add Domain**
2. Enter `axiomid.app`
3. Resend will provide DNS records to add:

| Type | Name | Value |
|------|------|-------|
| TXT | `resend._domainkey` | `v=DKIM1; k=rsa; p=...` |
| CNAME | `resend` | `send.resend.com` |
| MX | `@` | `feedback-smtp.region.amazonaws.com` |

### 2.3 Add DNS Records in Cloudflare

1. Cloudflare Dashboard → `axiomid.app` → **DNS** → **Records**
2. Add each record from Resend:
   - **Type**: TXT / CNAME / MX
   - **Name**: As provided
   - **Content**: As provided
   - **Proxy**: **DNS Only** (gray cloud) — critical for email!
   - **TTL**: Auto

### 2.4 Verify Domain

1. Back in Resend → **Domains** → Click **Verify**
2. Wait for "Verified" status (usually 1-5 minutes)
3. Green checkmark = ready to send

### 2.5 Create API Key

1. Resend → **API Keys** → **Create API Key**
2. Name: `PAI-Email-Agent`
3. Permissions: **Sending access**
4. **Copy the key** — starts with `re_`
5. **Store securely** — you won't see it again!

---

## Phase 3: Deploy Worker

### 3.1 Clone & Configure

```bash
git clone https://github.com/pai-list/PAI-Email-Agent.git
cd PAI-Email-Agent
npm install
```

### 3.2 Configure wrangler.toml

Edit `worker/wrangler.toml`:

```toml
# Replace with your actual values
account_id = "your-account-id-from-wrangler-whoami"
zone_id = "your-zone-id-from-wrangler-zones-list"

[[kv_namespaces]]
binding = "PAI_RECEIPTS"
id = "your-production-kv-id"
preview_id = "your-preview-kv-id"
```

### 3.3 Set Secrets (NEVER commit these!)

```bash
# Resend API Key
npx wrangler secret put RESEND_API_KEY
# Paste: re_xxxxxxxxxxxxx

# Passport Private Key (Ed25519, base64)
# Generate with: openssl genpkey -algorithm ED25519 -out key.pem && base64 -w0 key.pem
npx wrangler secret put PASSPORT_PRIVATE_KEY
# Paste base64 key

# Passport Key ID
npx wrangler secret put PASSPORT_KEY_ID
# Paste: pai-passport-2026-01
```

### 3.4 Deploy

```bash
cd worker
npm install
npx wrangler deploy
```

Expected output:
```
✨ Successfully deployed to https://agent-email-router.your-subdomain.workers.dev
```

### 3.5 Link Worker to Email Routing

1. Cloudflare Dashboard → **Email** → **Email Routing** → **Rules**
2. Edit your catch-all rule
3. **Worker**: Select `agent-email-router`
4. Save

---

## Phase 4: Test End-to-End

### 4.1 Test Inbound

```bash
# Send test email to agent@axiomid.app
# From any email client or:
echo "Test body" | mail -s "Test Subject" agent@axiomid.app

# Watch logs
npx wrangler tail agent-email-router
```

Expected log:
```
📧 Routed email to agent:agent from:sender@example.com subj:"Test Subject"
```

### 4.2 Test Outbound (via Resend API)

```bash
curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer re_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "PAI Agent <agent@axiomid.app>",
    "to": "your-email@example.com",
    "subject": "Test from PAI Agent",
    "html": "<p>Zero-cost email works!</p>"
  }'
```

Expected: `{"id":"email_id"}`

### 4.3 Verify KV Audit Log

```bash
# List keys
npx wrangler kv key list --binding PAI_RECEIPTS

# Get specific email
npx wrangler kv key get "email:hash..." --binding PAI_RECEIPTS
```

---

## Phase 5: Add More Agent Emails

For each agent, just add a routing rule in Cloudflare:

```
Custom address: agent-name
Action: Send to Worker
Worker: agent-email-router
```

The worker extracts `agent-name` from `agent-name@axiomid.app` and routes to the correct Durable Object.

---

## Protected Addresses (DO NOT MODIFY)

| Address | Routes To | Note |
|---------|-----------|------|
| `rita@axiomid.app` | `retajabdul3zizfahmy@gmail.com` | **Hardcoded in worker — never change** |

The worker has a `PROTECTED_ADDRESSES` set that preserves existing routing for these.

---

## Troubleshooting

### "Worker not found" in Email Routing
- Deploy worker first, then refresh Email Routing page
- Worker must be in same Cloudflare account

### "Domain not verified" in Resend
- Check DNS records in Cloudflare are **DNS Only** (gray cloud)
- Wait 5 minutes, click Verify again
- MX record must point to Resend's feedback endpoint

### Emails not arriving at agent DO
- Check `wrangler tail` for errors
- Verify `AGENT_STATE` DO binding matches AxiomID backend script name
- Check Durable Object namespace exists

### "Unauthorized" sending via Resend
- Verify `from` address matches verified domain
- Check API key has sending permissions
- Ensure passport JWT includes `aud: ["https://api.resend.com"]`

### KV writes failing
- Check KV namespace ID in wrangler.toml matches deployed worker
- Verify worker has `PAI_RECEIPTS` binding

---

## Cost Monitoring

| Service | Free Limit | Check Usage |
|---------|------------|-------------|
| Cloudflare Workers | 100k req/day | Workers Dashboard → Usage |
| Cloudflare KV | 100k reads/day | KV Dashboard → Metrics |
| Cloudflare Durable Objects | 1M req/day | DO Dashboard |
| Email Routing | Unlimited | Email Routing → Analytics |
| Resend | 3,000 emails/mo | Resend Dashboard → Usage |

**All $0/month at current scale.**

---

## Next Steps

1. **Customize templates** in `sdk/ts/src/templates/`
2. **Add passport issuance** endpoint to worker
3. **Build passport viewer** at `agent.axiomid.app`
4. **Integrate with PAI-Agent-Passport** SDK
5. **Add webhook handling** for Resend events (bounce, complaint, open)

---

## Support

- [GitHub Issues](https://github.com/pai-list/PAI-Email-Agent/issues)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Resend Docs](https://resend.com/docs)
- [PAI Universe Discussions](https://github.com/pai-list/PAI-Email-Agent/discussions)