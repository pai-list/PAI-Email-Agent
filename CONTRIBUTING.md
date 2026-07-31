# Contributing to PAI-Email-Agent

Thank you for contributing to the PAI Email Infrastructure! This document outlines our development workflow, coding standards, and contribution process.

## 🏗️ Development Workflow

### Branching Strategy

```
main (production)
  ↑
  │   develop (staging)
  │     ↑
  │     │   feature/* (new features)
  │     │   fix/* (bug fixes)
  │     │   chore/* (maintenance)
  │     │   docs/* (documentation)
  └─────┴─────────────────
```

### Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

[optional body]

[optional footer]
```

**Types:**
- `feat` - New feature
- `fix` - Bug fix
- `chore` - Maintenance (deps, config, etc.)
- `docs` - Documentation only
- `refactor` - Code restructuring without behavior change
- `test` - Adding/updating tests
- `perf` - Performance improvement
- `security` - Security fix

**Examples:**
```
feat(email-sender): add attachment support
fix(email-router): handle missing DKIM header
docs: update SETUP_GUIDE with Resend webhook config
test(shared): add crypto utility tests
security: rotate JWT_SECRET in CI
```

### Pull Request Process

1. **Create feature branch** from `develop`
2. **Make changes** with tests
3. **Run CI locally**: `pnpm lint && pnpm typecheck && pnpm test`
4. **Open PR** to `develop` branch
5. **CI must pass**: Lint, TypeCheck, Tests, Build
6. **Code review** by maintainer
7. **Squash merge** to `develop`
8. **Deploy to staging** (auto on push to develop)
9. **Promote to main** via release PR

## 🧪 Testing Requirements

- **Unit tests** for all new functions (>80% coverage)
- **Integration tests** for worker endpoints
- **Edge cases** documented in test names
- **Run tests**: `pnpm test`
- **Watch mode**: `pnpm test:watch`

## 📝 Code Standards

### TypeScript

- **Strict mode** enabled
- **No `any`** - use proper types
- **Explicit return types** for exported functions
- **Interfaces** over types for object shapes
- **JSDoc** for public APIs

### File Organization

```
worker/
├── email-router/
│   ├── src/
│   │   ├── index.ts       # Entry point
│   │   ├── router.ts      # Core logic
│   │   ├── storage.ts     # DO logic
│   │   └── webhook.ts     # Webhook delivery
│   ├── tests/
│   │   └── router.test.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── wrangler.toml
├── email-sender/
└── webhook-processor/
```

### Naming Conventions

- **Files**: kebab-case (`email-router.ts`)
- **Classes**: PascalCase (`AgentInboxDO`)
- **Functions**: camelCase (`parseEmailMessage`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_RETRIES`)
- **Types/Interfaces**: PascalCase (`EmailMessage`)
- **KV Keys**: `namespace:entity:action:window`

## 🔒 Security Guidelines

### Secrets Management

- **NEVER** commit secrets to git
- Use **Cloudflare Workers secrets** for production
- Use **`.env.local`** for local development (gitignored)
- Rotate secrets quarterly

### Code Security

- Validate all inputs (JWT, email, webhook payloads)
- Use constant-time comparison for secrets
- Rate limit all public endpoints
- Sanitize HTML output
- Use CSP headers

### Dependencies

- Pin exact versions in `package.json`
- Run `pnpm audit` before merging
- Use `pnpm audit fix --force` for fixes
- Prefer established packages over new ones

## 📦 Release Process

### Versioning

We use [Semantic Versioning](https://semver.org/):

- **Major**: Breaking changes (API, config, database schema)
- **Minor**: New features (backward compatible)
- **Patch**: Bug fixes (backward compatible)

### Release Steps

1. **Create release PR**: `develop` → `main`
2. **Update version**: `pnpm version patch|minor|major`
3. **Generate changelog**: Auto from conventional commits
4. **Merge to main**: Triggers production deploy
5. **Tag release**: `git tag v0.x.x`
6. **GitHub Release**: Auto-created from tag

## 🛠️ Local Development Setup

### Prerequisites

```bash
# Required
Node.js 20+
pnpm 9+
Wrangler CLI 3.80+
Python 3.8+ (for diagrams)

# Optional
Docker (for local Resend mock)
```

### Quick Start

```bash
# 1. Clone
git clone https://github.com/pai-list/PAI-Email-Agent.git
cd PAI-Email-Agent

# 2. Install
pnpm install

# 3. Setup environment
cp worker/email-router/wrangler.toml.example worker/email-router/wrangler.toml
# ... edit with your config

# 4. Create KV namespaces (local)
wrangler kv:namespace create EMAIL_KV --preview
wrangler kv:namespace create AGENT_KV --preview
# ... etc

# 5. Set local secrets
wrangler secret put RESEND_API_KEY --env development
# ... etc

# 6. Start dev servers (3 terminals)
cd worker/email-router && wrangler dev
cd worker/email-sender && wrangler dev
cd worker/webhook-processor && wrangler dev

# 7. Test
pnpm test
```

### Diagram Generation

```bash
# Install mermaid-cli
npm i -g @mermaid-js/mermaid-cli

# Generate diagrams
pnpm generate:diagrams
```

## 📚 Documentation

- **README.md** - Project overview, quick start
- **SETUP_GUIDE.md** - Step-by-step deployment
- **ARCHITECTURE.md** - Technical architecture
- **SECURITY.md** - Security policy & reporting
- **Code comments** - JSDoc for all public APIs

## 🐛 Bug Reports

Use GitHub Issues with:

1. **Clear title**: `[Component] Brief description`
2. **Reproduction steps**
3. **Expected vs actual behavior**
4. **Environment** (local/staging/prod)
5. **Logs/error messages**
6. **Screenshots** if UI-related

## 💡 Feature Requests

Use GitHub Issues with:

1. **Use case**: What problem does this solve?
2. **Proposed solution**: How should it work?
3. **Alternatives considered**
4. **Impact**: Who benefits?
5. **Implementation hints** (optional)

## 🤝 Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- No harassment or discrimination
- Follow the [Contributor Covenant](https://www.contributor-covenant.org/)

## 📞 Getting Help

- **GitHub Discussions**: General questions
- **GitHub Issues**: Bugs & feature requests
- **Discord**: `#pai-email-agent` (PAI Universe server)
- **Email**: `dev@pai-list.org`

---

*Thank you for making PAI-Email-Agent better!*