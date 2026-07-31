# PAI Email Agent — Quickstart

Get zero-cost email for your AI agents in 15 minutes.

---

## 🚀 One-Command Setup

```bash
# Clone and enter
git clone https://github.com/pai-list/PAI-Email-Agent.git
cd PAI-Email-Agent

# Install everything
bun install
cd worker && bun install && cd ..
cd sdk/ts && bun install && cd ../..

# Configure (edit with your values)
cp worker/wrangler.toml.example worker/wrangler.toml
# Edit worker/wrangler.toml with your KV IDs, account ID, zone ID

# Set secrets (NEVER commit these!)
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put PASSPORT_PRIVATE_KEY
npx wrangler secret put PASSPORT_KEY_ID

# Deploy
cd worker && npx wrangler deploy
```

---

## 📋 Prerequisites Checklist

| Requirement | Status | How to Verify |
|-------------|--------|---------------|
| Cloudflare account | ☐ | `npx wrangler whoami` |
| `axiomid.app` on Cloudflare | ☐ | `npx wrangler zones list` |
| Nameservers → Cloudflare | ☐ | `dig axiomid.app NS` |
| Email Routing enabled | ☐ | Dashboard → Email → Email Routing |
| Resend account | ☐ | [resend.com](https://resend.com) |
| Domain verified in Resend | ☐ | Resend Dashboard → Domains |
| Resend API key created | ☐ | Resend Dashboard → API Keys |
| DNS records for Resend added | ☐ | Cloudflare DNS → Records |

---

## ⚡ 5-Minute Test

```bash
# 1. Watch logs
npx wrangler tail agent-email-router

# 2. Send test email (from another terminal)
echo "Hello from PAI!" | mail -s "Test" pai-agent@axiomid.app

# 3. Check logs show:
# 📧 Routed email to agent:pai-agent from:you@example.com subj:"Test"

# 4. Verify KV audit
npx wrangler kv key list --binding PAI_RECEIPTS
npx wrangler kv key get "email:<hash>" --binding PAI_RECEIPTS
```

---

## 📧 Add Your First Agent Email

1. Cloudflare Dashboard → Email → Email Routing → Rules
2. Create Rule:
   ```
   Rule name:     My Agent
   Custom address: my-agent
   Action:        Send to Worker
   Worker:        agent-email-router
   ```
3. Done! `my-agent@axiomid.app` now routes to your agent.

---

## 📤 Send Email from Code

```typescript
import { createEmailAgent, WelcomeTemplate } from '@pai/email-agent';

const email = createEmailAgent({
  resendApiKey: process.env.RESEND_API_KEY!,
  fromDomain: 'axiomid.app',
  defaultFromName: 'My Agent',
});

await email.sendEmail({
  to: 'user@example.com',
  subject: 'Welcome!',
  react: WelcomeTemplate({ 
    agentName: 'My Agent',
    userName: 'Developer',
    passportUrl: 'https://my-agent.axiomid.app',
  }),
});
```

---

## 🔐 Protected Addresses (Do Not Touch)

| Address | Routes To | Note |
|---------|-----------|------|
| `rita@axiomid.app` | `retajabdul3zizfahmy@gmail.com` | Hardcoded in worker |

---

## 📚 Full Documentation

- [Complete Setup Guide](docs/SETUP.md) — Step-by-step with screenshots
- [Architecture Deep Dive](docs/ARCHITECTURE.md) — Data flows, security, scaling
- [SDK Reference](sdk/ts/src/index.ts) — TypeScript API
- [Rust SDK](sdk/rust/src/lib.rs) — Rust/WASM API

---

## 💰 Cost at Scale

| Agents | Emails/Day | Monthly Cost |
|--------|------------|--------------|
| 10 | 100 | $0 |
| 100 | 1,000 | $0 |
| 1,000 | 10,000 | $20 (Resend Pro) |
| 10,000 | 100,000 | $80 (Resend Pro) |

**All Cloudflare services stay free.**

---

## 🆘 Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Worker not found" | Deploy worker first, then refresh Email Routing page |
| "Domain not verified" | DNS records must be **DNS Only** (gray cloud) in Cloudflare |
| Emails not arriving | Check `wrangler tail` for errors; verify DO binding |
| Resend "Unauthorized" | `from` must match verified domain; check API key |
| KV writes fail | Verify KV namespace ID in `wrangler.toml` |

---

## 🤝 Contributing

```bash
# Run tests
cd conformance && npx tsx test.ts

# Type-check
cd sdk/ts && bun run type-check

# Lint
bun run lint
```

---

## 📄 License

MIT — Built with ❤️ by PAI Universe