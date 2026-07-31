# Security Policy

## 🔐 Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | ✅ Current         |

## 🚨 Reporting a Vulnerability

**Do NOT create a public GitHub issue for security vulnerabilities.**

Instead, report privately via:

1. **Email**: `security@axiomid.app` (PGP key available on request)
2. **GitHub Security Advisories**: Use "Report a vulnerability" tab
3. **Direct message**: @amrikyy on GitHub

We aim to:
- **Acknowledge** within 24 hours
- **Triage** within 72 hours
- **Fix** critical issues within 7 days
- **Disclose** responsibly after fix is deployed

## 🛡️ Security Architecture

### Authentication & Authorization

- **JWT (HS256)** for agent authentication (1-hour expiry)
- **Per-agent permissions** (`email:send`, `email:receive`, `webhook:receive`)
- **Rate limiting** per agent per action per time window
- **HMAC-SHA256** signatures on all webhook payloads
- **Per-agent webhook secrets** (rotated quarterly)

### Data Protection

- **Encryption at rest**: Cloudflare KV (AES-256)
- **Encryption in transit**: TLS 1.3 (Cloudflare edge)
- **No PII in logs**: Email content never logged
- **Message retention**: 30 days max (configurable)
- **Durable Objects**: Isolated per-agent storage

### Network Security

- **Cloudflare WAF** enabled on all Workers
- **CORS** restricted to `*.axiomid.app`
- **CSP headers** on all responses
- **No direct Worker-to-Worker calls** (via KV/queue)
- **Resend webhook verification** via signing secret

### Secrets Management

| Secret | Scope | Rotation |
|--------|-------|----------|
| `JWT_SECRET` | All workers | 90 days |
| `RESEND_API_KEY` | email-sender, email-router | 90 days |
| `RESEND_WEBHOOK_SECRET` | email-router, email-sender | 90 days |
| `CF_API_TOKEN` | CI/CD only | 180 days |
| `WEBHOOK_SECRET` | Per-agent | 90 days |
| Agent webhook secrets | Per-agent | 90 days |

**Secrets are stored ONLY in Cloudflare Workers secrets** — never in:
- Source code
- Git history
- CI/CD logs
- Docker images
- Documentation

## 🔍 Security Checklist (Pre-Deploy)

### Code Review
- [ ] No hardcoded secrets or tokens
- [ ] All inputs validated and sanitized
- [ ] JWT verification on all protected endpoints
- [ ] Rate limits enforced
- [ ] Constant-time comparison for secrets
- [ ] Error messages don't leak internals
- [ ] Dependencies scanned (`pnpm audit`)

### Configuration
- [ ] `wrangler.toml` has no secrets
- [ ] KV namespaces created per environment
- [ ] Durable Objects configured correctly
- [ ] Cron triggers secured (webhook-processor)
- [ ] CORS origins restricted
- [ ] CSP headers present

### Infrastructure
- [ ] Cloudflare WAF rules enabled
- [ ] Email Routing rules verified
- [ ] Resend domain verified (DKIM/SPF/DMARC)
- [ ] DNSSEC enabled on `axiomid.app`
- [ ] CAA records for certificate control
- [ ] Subdomain takeover prevention

### Monitoring
- [ ] Alert on 429 rate limit spikes
- [ ] Alert on webhook delivery failures
- [ ] Alert on Resend API errors
- [ ] Alert on dead letter queue growth
- [ ] Log retention configured (30 days)

## 🐛 Known Security Considerations

### JWT Algorithm (HS256)
**Current**: HS256 (symmetric)
**Planned**: Ed25519 (asymmetric) — see ROADMAP.md
**Mitigation**: Short expiry (1 hour), secret rotation, per-agent scopes

### Email Content Storage
**Current**: Stored in Durable Objects (30 days)
**Risk**: Email content accessible to Worker code
**Mitigation**: No logging, isolated per-agent DO, encryption at rest

### Webhook Delivery
**Current**: Retry with exponential backoff
**Risk**: Potential DoS if agent endpoint misbehaves
**Mitigation**: Max 5 retries, 5-min cap, dead letter queue, circuit breaker

### Rate Limiting
**Current**: KV-based (eventually consistent)
**Risk**: Race conditions under high load
**Mitigation**: Generous burst allowance, atomic increment where possible

## 📋 Incident Response Plan

### Severity Levels

| Level | Description | Response Time |
|-------|-------------|---------------|
| **P0** | Active exploitation, data breach | 1 hour |
| **P1** | Auth bypass, RCE, data leak | 4 hours |
| **P2** | DoS, logic flaw, info disclosure | 24 hours |
| **P3** | Low-risk, hardening needed | 1 week |

### Response Steps

1. **Contain**: Revoke secrets, disable affected Workers, block IPs
2. **Assess**: Determine scope, affected data, attack vector
3. **Fix**: Deploy patch, rotate all related secrets
4. **Verify**: Test fix, monitor for regression
5. **Notify**: Affected parties (if data exposed)
6. **Document**: Post-mortem within 72 hours
7. **Improve**: Update security controls, run drills

## 🔄 Security Maintenance

### Quarterly
- [ ] Rotate all secrets
- [ ] Review access logs
- [ ] Update dependencies (`pnpm update`)
- [ ] Run penetration test (staging)
- [ ] Review WAF rules

### Monthly
- [ ] Review dead letter queue
- [ ] Check rate limit patterns
- [ ] Verify Resend domain health
- [ ] Audit agent permissions

### Weekly
- [ ] Dependency scan (`pnpm audit`)
- [ ] Security advisory review (GitHub, npm)
- [ ] Log anomaly detection

## 🏗️ Secure Development Lifecycle

1. **Threat Model** — Before new features
2. **Secure Design** — Review by maintainer
3. **Code Review** — Required for all PRs
4. **Static Analysis** — CodeQL in CI
5. **Dependency Scan** — Snyk + npm audit
6. **Pen Test** — Staging before prod
7. **Monitor** — Continuous in production

## 📜 Compliance

- **GDPR**: No EU personal data processed without consent
- **SOC 2**: Cloudflare Workers certified
- **Email Standards**: DKIM, SPF, DMARC, BIMI ready

## 🔗 Related Documents

- [SETUP_GUIDE.md](./docs/SETUP_GUIDE.md) — Deployment with security
- [ARCHITECTURE.md](./docs/ARCHITECTURE.md) — Security architecture
- [CONTRIBUTING.md](./CONTRIBUTING.md) — Secure contribution guidelines

---

**Last security review**: 2026-07-31
**Next scheduled review**: 2026-10-31
**Security contact**: `security@axiomid.app`