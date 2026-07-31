export { WelcomeTemplate } from './welcome.js';
export { NotificationTemplate } from './notification.js';
export { VerificationTemplate } from './verification.js';

export const templates = {
  welcome: WelcomeTemplate,
  notification: NotificationTemplate,
  verification: VerificationTemplate,
} as const;

export type TemplateName = keyof typeof templates;