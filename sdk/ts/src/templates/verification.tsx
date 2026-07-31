import { ReactElement } from 'react';

interface VerificationProps {
  agentName: string;
  userName?: string;
  code: string;
  expiresInMinutes: number;
  passportUrl?: string;
}

export function VerificationTemplate({
  agentName,
  userName,
  code,
  expiresInMinutes,
  passportUrl,
}: VerificationProps): ReactElement {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Verify your email — {agentName}</title>
      </head>
      <body style={styles.body}>
        <div style={styles.container}>
          {/* Header */}
          <div style={styles.header}>
            <div style={styles.logo}>
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="24" cy="24" r="22" stroke="#22c55e" strokeWidth="2"/>
                <path d="M16 24L22 30L32 18" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h1 style={styles.title}>Verify Your Email</h1>
          </div>

          {/* Greeting */}
          <div style={styles.greeting}>
            <p style={styles.text}>
              Hi {userName || 'there'},<br />
              Please verify your email address to complete the connection with <strong>{agentName}</strong>.
            </p>
          </div>

          {/* Code Card */}
          <div style={styles.codeCard}>
            <p style={styles.codeLabel}>Your verification code</p>
            <div style={styles.codeValue}>{code}</div>
            <p style={styles.codeExpiry}>
              Expires in {expiresInMinutes} minutes
            </p>
          </div>

          {/* Instructions */}
          <div style={styles.instructions}>
            <h3 style={styles.instructionsTitle}>How to use this code</h3>
            <ol style={styles.instructionsList}>
              <li style={styles.instructionItem}>
                Open the <strong>{agentName}</strong> dashboard or passport page
              </li>
              <li style={styles.instructionItem}>
                Navigate to <strong>Settings → Email Verification</strong>
              </li>
              <li style={styles.instructionItem}>
                Enter the 6-digit code above
              </li>
              <li style={styles.instructionItem}>
                Click <strong>Verify</strong> — you're done!
              </li>
            </ol>
          </div>

          {/* CTA */}
          {passportUrl && (
            <div style={styles.ctaWrapper}>
              <a href={passportUrl} style={styles.ctaButton}>
                Open {agentName} Passport →
              </a>
            </div>
          )}

          {/* Security Notice */}
          <div style={styles.securityNotice}>
            <div style={styles.securityIcon}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
              </svg>
            </div>
            <div>
              <h4 style={styles.securityTitle}>Security Notice</h4>
              <p style={styles.securityText}>
                Never share this code with anyone. {agentName} will never ask for it via email.
                If you didn't request this verification, ignore this email.
              </p>
            </div>
          </div>

          {/* Footer */}
          <hr style={styles.divider} />
          <div style={styles.footer}>
            <p style={styles.footerText}>
              Sent by <strong>{agentName}</strong> via PAI Email Agent
            </p>
            <p style={styles.footerMuted}>
              <a href="https://pai.agent" style={styles.link}>PAI Network</a> •
              <a href="https://axiomid.app" style={styles.link}>AxiomID</a>
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
    background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  },
  greeting: {
    marginBottom: '32px',
    padding: '24px',
    background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
    borderRadius: '12px',
    borderLeft: '4px solid #22c55e',
  },
  text: {
    margin: 0,
    fontSize: '16px',
    color: '#334155',
  },
  codeCard: {
    textAlign: 'center' as const,
    padding: '32px',
    background: '#f8fafc',
    borderRadius: '16px',
    border: '2px dashed #cbd5e1',
    marginBottom: '32px',
  },
  codeLabel: {
    margin: '0 0 16px 0',
    fontSize: '14px',
    fontWeight: 500,
    color: '#64748b',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
  },
  codeValue: {
    display: 'inline-block',
    fontSize: '48px',
    fontWeight: 800,
    fontFamily: 'monospace',
    letterSpacing: '8px',
    color: '#0f172a',
    background: 'white',
    padding: '16px 32px',
    borderRadius: '12px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
    marginBottom: '12px',
  },
  codeExpiry: {
    margin: 0,
    fontSize: '13px',
    color: '#94a3b8',
  },
  instructions: {
    marginBottom: '32px',
  },
  instructionsTitle: {
    margin: '0 0 16px 0',
    fontSize: '15px',
    fontWeight: 600,
    color: '#1e293b',
  },
  instructionsList: {
    margin: 0,
    paddingLeft: '20px',
  },
  instructionItem: {
    marginBottom: '10px',
    fontSize: '14px',
    color: '#334155',
    lineHeight: 1.5,
  },
  ctaWrapper: {
    textAlign: 'center' as const,
    marginBottom: '32px',
  },
  ctaButton: {
    display: 'inline-block',
    padding: '14px 28px',
    background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
    color: 'white',
    textDecoration: 'none',
    borderRadius: '10px',
    fontWeight: 600,
    fontSize: '15px',
    boxShadow: '0 4px 16px rgba(34, 197, 94, 0.3)',
  },
  securityNotice: {
    display: 'flex',
    gap: '12px',
    padding: '16px',
    background: '#fffbeb',
    borderRadius: '10px',
    border: '1px solid #fde68a',
    marginBottom: '24px',
  },
  securityIcon: {
    flexShrink: 0,
    color: '#f59e0b',
    marginTop: '2px',
  },
  securityTitle: {
    margin: '0 0 4px 0',
    fontSize: '14px',
    fontWeight: 600,
    color: '#92400e',
  },
  securityText: {
    margin: 0,
    fontSize: '13px',
    color: '#78350f',
    lineHeight: 1.5,
  },
  divider: {
    border: 'none',
    borderTop: '1px solid #e2e8f0',
    margin: '24px 0',
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
    margin: '0 8px',
  },
};