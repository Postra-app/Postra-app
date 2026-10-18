/**
 * Transactional auth emails in the user's language. UK-first launch means the
 * default is English; Polish only when the client explicitly says so (i18next
 * cookie set by the frontend, or a Polish Accept-Language).
 */
export type EmailLang = 'en' | 'pl';

export const pickEmailLang = (req?: {
  cookies?: Record<string, string>;
  headers?: Record<string, unknown>;
}): EmailLang => {
  const cookie = req?.cookies?.i18next;
  if (cookie === 'pl' || cookie === 'en') {
    return cookie;
  }
  const header = String(req?.headers?.['accept-language'] || '');
  return header.toLowerCase().startsWith('pl') ? 'pl' : 'en';
};

// A button and the link written out: a mail that is only "click here" reads
// as spam (Yahoo, 18 Oct), and some clients drop the button.
const button = (url: string, label: string) =>
  `<a href="${url}" style="display:inline-block;background:#0a0e1a;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:6px">${label}</a>`;

const linkLine = (url: string, text: string) =>
  `${text}<br /><a href="${url}" style="word-break:break-all">${url}</a>`;

// Who sends these mails, in place of the notification-settings line.
export const authEmailFooter: Record<EmailLang, string> = {
  en: 'Postra is operated by B K Company, Suite RA01, 195-197 Wood Street, London E17 3NU.',
  pl: 'Postrę prowadzi B K Company, Suite RA01, 195-197 Wood Street, London E17 3NU.',
};

export const authEmails = {
  activation: {
    en: {
      subject: 'Confirm your email address for Postra',
      html: (url: string) =>
        `Hi, thanks for signing up to Postra. Please confirm your email address to finish creating your account.<br /><br />${button(url, 'Confirm email address')}<br /><br />${linkLine(url, 'If the button does not work, paste this link into your browser:')}<br /><br />If you did not create a Postra account, you can ignore this email.`,
    },
    pl: {
      subject: 'Potwierdź swój adres e-mail w Postrze',
      html: (url: string) =>
        `Cześć, dziękujemy za rejestrację w Postrze. Potwierdź swój adres e-mail, aby dokończyć zakładanie konta.<br /><br />${button(url, 'Potwierdź adres e-mail')}<br /><br />${linkLine(url, 'Jeśli przycisk nie działa, wklej ten link do przeglądarki:')}<br /><br />Jeśli nie zakładałeś konta w Postrze, zignoruj tę wiadomość.`,
    },
  },
  resetPassword: {
    en: {
      subject: 'Reset your Postra password',
      html: (url: string) =>
        `We received a request to reset the password for your Postra account. The link expires in 20 minutes.<br /><br />${button(url, 'Set a new password')}<br /><br />${linkLine(url, 'If the button does not work, paste this link into your browser:')}<br /><br />If you did not ask to reset your password, you can ignore this email. Your password stays the same.`,
    },
    pl: {
      subject: 'Zresetuj hasło do Postry',
      html: (url: string) =>
        `Otrzymaliśmy prośbę o zresetowanie hasła do Twojego konta w Postrze. Link wygaśnie za 20 minut.<br /><br />${button(url, 'Ustaw nowe hasło')}<br /><br />${linkLine(url, 'Jeśli przycisk nie działa, wklej ten link do przeglądarki:')}<br /><br />Jeśli nie prosiłeś o reset hasła, zignoruj tę wiadomość. Twoje hasło się nie zmieni.`,
    },
  },
};
