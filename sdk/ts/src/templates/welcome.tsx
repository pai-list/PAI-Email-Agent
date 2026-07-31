import { ReactElement } from 'react';

interface WelcomeProps {
  agentName: string;
  userName?: string;
  passportUrl?: string;
  dashboardUrl?: string;
}

export function WelcomeTemplate({ agentName, userName, passportUrl, dashboardUrl }: WelcomeProps): ReactElement {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Welcome to {agentName}</title>
      </head>
      <body style={styles.body}>
        <div style={styles.container}>
          {/* Header */}
          <div style={styles.header}>
            <div style={styles.logo}>
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="24" cy="24" r="22" stroke="#6366f1" strokeWidth="2"/>
                <path d="M16 24L22 30L32 18" stroke="#6366f1" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h1 style={styles.title}>Welcome to {agentName}</h1>
          </div>

          {/* Greeting */}
          <div style={styles.greeting}>
            <p style={styles.text}>
              Hi {userName || 'there'},<br />
              You've been connected with <strong>{agentName}</strong> — your autonomous AI agent on the PAI network.
            </p>
          </div>

          {/* Feature Cards */}
          <div style={styles.features}>
            <div style={styles.featureCard}>
              <div style={styles.featureIcon}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12V7H5V7M3 18V20.179C3 21.363 3.977 22.34 5.161 22.564L12 24L18.839 22.564C20.023 22.34 21 21.363 21 20.179V18"/>
                  <path d="M14 9V12M10 12H14"/>
                </svg>
              </div>
              <h3 style={styles.featureTitle}>Autonomous Tasks</h3>
              <p style={styles.featureText}>{agentName} runs 24/7, executing skills and workflows on your behalf.</p>
            </div>

            <div style={styles.featureCard}>
              <div style={styles.featureIcon}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2"/>
                  <path d="M8 21H16M12 17V21"/>
                </svg>
              </div>
              <h3 style={styles.featureTitle}>Email Identity</h3>
              <p style={styles.featureText}>Send & receive emails as {agentName}@axiomid.app with full audit trail.</p>
            </div>

            <div style={styles.featureCard}>
              <div style={styles.featureIcon}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 6V12L16 14"/>
                </svg>
              </div>
              <h3 style={styles.featureTitle}>Subdomain Passport</h3>
              <p style={styles.featureText}>Your agent lives at <code style={styles.code}>{agentName.toLowerCase()}.axiomid.app</code> — shareable, verifiable identity.</p>
            </div>
          </div>

          {/* CTA Buttons */}
          <div style={styles.ctaSection}>
            {passportUrl && (
              <a href={passportUrl} style={styles.primaryButton}>
                View Passport →
              </a>
            )}
            {dashboardUrl && (
              <a href={dashboardUrl} style={styles.secondaryButton}>
                Open Dashboard
              </a>
            )}
          </div>

          {/* Divider */}
          <hr style={styles.divider} />

          {/* Footer */}
          <div style={styles.footer}>
            <p style={styles.footerText}>
              This email was sent by <strong>{agentName}</strong> via PAI Email Agent.<br />
              <a href="https://pai.agent" style={styles.link}>Learn more about PAI</a> •
              <a href="https://axiomid.app" style={styles.link}>AxiomID</a>
            </p>
            <p style={styles.footerMuted}>
              You received this because {agentName} was authorized to contact you.<br />
              To stop emails from this agent, contact the agent owner.
            </p>
          </div>
        </div>
      </body>
    </html>
  );
}

const styles: Record<string, React.CSSProperties> = {
  body: {
    margin: 0,
    padding: 0,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    backgroundColor: '#f8fafc',
    lineHeight: 1.6,
    color: '#1e293b',
  },
  container: {
    maxWidth: '600px',
    margin: '0 auto',
    padding: '40px 20px',
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
    marginTop: '40px',
    marginBottom: '40px',
  },
  header: {
    textAlign: 'center' as const,
    marginBottom: '32px',
  },
  logo: {
    display: 'inline-block',
    marginBottom: '16px',
  },
  title: {
    margin: 0,
    fontSize: '28px',
    fontWeight: 700,
    color: '#0f172a',
    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  },
  greeting: {
    marginBottom: '32px',
    padding: '24px',
    background: 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)',
    borderRadius: '12px',
    borderLeft: '4px solid #6366f1',
  },
  text: {
    margin: 0,
    fontSize: '16px',
    color: '#334155',
  },
  features: {
    display: 'flex',
    gap: '16px',
    marginBottom: '32px',
    flexWrap: 'wrap' as const,
  },
  featureCard: {
    flex: '1 1 160px',
    padding: '20px',
    background: '#f8fafc',
    borderRadius: '12px',
    border: '1px solid #e2e8f0',
    transition: 'transform 0.2s, box-shadow 0.2s',
  },
  featureIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
    color: 'white',
    marginBottom: '12px',
  },
  featureTitle: {
    margin: '0 0 8px 0',
    fontSize: '14px',
    fontWeight: 600,
    color: '#1e293b',
  },
  featureText: {
    margin: 0,
    fontSize: '13px',
    color: '#64748b',
    lineHeight: 1.5,
  },
  code: {
    fontFamily: 'monospace',
    background: '#e2e8f0',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '12px',
  },
  ctaSection: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'center',
    marginBottom: '32px',
    flexWrap: 'wrap' as const,
  },
  primaryButton: {
    display: 'inline-block',
    padding: '14px 28px',
    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
    color: 'white',
    textDecoration: 'none',
    borderRadius: '10px',
    fontWeight: 600,
    fontSize: '15px',
    boxShadow: '0 4px 16px rgba(99, 102, 241, 0.3)',
  },
  secondaryButton: {
    display: 'inline-block',
    padding: '14px 28px',
    background: 'white',
    color: '#6366f1',
    textDecoration: 'none',
    borderRadius: '10px',
    fontWeight: 600,
    fontSize: '15px',
    border: '2px solid #6366f1',
  },
  divider: {
    border: 'none',
    borderTop: '1px solid #e2e8f0',
    margin: '32px 0',
  },
  footer: {
    textAlign: 'center' as const,
  },
  footerText: {
    margin: '0 0 8px 0',
    fontSize: '13px',
    color: '#64748b',
  },
  footerMuted: {
    margin: 0,
    fontSize: '12px',
    color: '#94a3b8',
  },
  link: {
    color: '#6366f1',
    textDecoration: 'none',
  },
};