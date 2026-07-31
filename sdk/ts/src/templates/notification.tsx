import { ReactElement } from 'react';

interface NotificationProps {
  agentName: string;
  title: string;
  message: string;
  actionUrl?: string;
  actionLabel?: string;
  severity?: 'info' | 'warning' | 'success' | 'error';
  metadata?: Record<string, string>;
}

const severityStyles: Record<string, { bg: string; border: string; icon: string; color: string }> = {
  info: {
    bg: '#eff6ff',
    border: '#3b82f6',
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>`,
    color: '#1e40af',
  },
  warning: {
    bg: '#fffbeb',
    border: '#f59e0b',
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>`,
    color: '#92400e',
  },
  success: {
    bg: '#f0fdf4',
    border: '#22c55e',
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>`,
    color: '#166534',
  },
  error: {
    bg: '#fef2f2',
    border: '#ef4444',
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>`,
    color: '#991b1b',
  },
};

export function NotificationTemplate({
  agentName,
  title,
  message,
  actionUrl,
  actionLabel,
  severity = 'info',
  metadata,
}: NotificationProps): ReactElement {
  const style = severityStyles[severity] || severityStyles.info;

  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} — {agentName}</title>
      </head>
      <body style={styles.body}>
        <div style={styles.container}>
          {/* Header */}
          <div style={styles.header}>
            <div style={styles.logo}>
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="20" cy="20" r="18" stroke="#6366f1" strokeWidth="2"/>
                <path d="M13 20L18 25L27 15" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h1 style={styles.title}>{agentName}</h1>
          </div>

          {/* Alert Card */}
          <div style={{ ...styles.alertCard, backgroundColor: style.bg, borderColor: style.border }}>
            <div style={styles.alertHeader}>
              <div style={{ ...styles.alertIcon, color: style.color }} dangerouslySetInnerHTML={{ __html: style.icon }} />
              <div>
                <h2 style={{ ...styles.alertTitle, color: style.color }}>{title}</h2>
                <p style={{ ...styles.alertMessage, color: style.color }}>{message}</p>
              </div>
            </div>

            {/* Metadata */}
            {metadata && Object.keys(metadata).length > 0 && (
              <div style={styles.metadata}>
                {Object.entries(metadata).map(([key, value]) => (
                  <div key={key} style={styles.metaItem}>
                    <span style={styles.metaKey}>{key}</span>
                    <span style={styles.metaValue}>{value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Action Button */}
            {actionUrl && actionLabel && (
              <div style={styles.actionWrapper}>
                <a href={actionUrl} style={{ ...styles.actionButton, backgroundColor: style.border, borderColor: style.border }}>
                  {actionLabel}
                </a>
              </div>
            )}
          </div>

          {/* Divider */}
          <hr style={styles.divider} />

          {/* Footer */}
          <div style={styles.footer}>
            <p style={styles.footerText}>
              This notification was sent by <strong>{agentName}</strong> via PAI Email Agent.
            </p>
            <p style={styles.footerMuted}>
              <a href="https://axiomid.app" style={styles.link}>Manage notifications</a> •
              <a href="https://pai.agent" style={styles.link}>PAI Network</a>
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
    fontSize: '24px',
    fontWeight: 700,
    color: '#0f172a',
  },
  alertCard: {
    padding: '24px',
    borderRadius: '12px',
    borderWidth: '2px',
    borderStyle: 'solid',
    marginBottom: '24px',
  },
  alertHeader: {
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-start',
  },
  alertIcon: {
    flexShrink: 0,
    marginTop: '2px',
  },
  alertTitle: {
    margin: '0 0 8px 0',
    fontSize: '18px',
    fontWeight: 600,
  },
  alertMessage: {
    margin: 0,
    fontSize: '15px',
    lineHeight: 1.5,
  },
  metadata: {
    marginTop: '20px',
    paddingTop: '20px',
    borderTop: '1px solid rgba(0,0,0,0.08)',
  },
  metaItem: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '8px 0',
    fontSize: '14px',
  },
  metaKey: {
    color: '#64748b',
    fontWeight: 500,
  },
  metaValue: {
    color: '#1e293b',
    fontFamily: 'monospace',
    fontSize: '13px',
  },
  actionWrapper: {
    marginTop: '20px',
    textAlign: 'center' as const,
  },
  actionButton: {
    display: 'inline-block',
    padding: '12px 24px',
    color: 'white',
    textDecoration: 'none',
    borderRadius: '8px',
    fontWeight: 600,
    fontSize: '14px',
    borderWidth: '2px',
    borderStyle: 'solid',
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