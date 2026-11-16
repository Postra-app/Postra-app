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
  // The second step of deleting an account without its password (Google or
  // Apple accounts, the mobile app). The page the link opens asks once more.
  deleteAccount: {
    en: {
      subject: 'Confirm deleting your Postra account',
      html: (url: string) =>
        `We received a request to delete your Postra account. Deleting it erases your data, connected channels, scheduled posts and media, and cancels any subscription. It cannot be undone. The link expires in 1 hour.<br /><br />${button(url, 'Delete my account')}<br /><br />${linkLine(url, 'If the button does not work, paste this link into your browser:')}<br /><br />If you did not ask for this, ignore this email and your account stays as it is. Someone signed in to your account made the request, so sign out of devices you do not recognise.`,
    },
    pl: {
      subject: 'Potwierdź usunięcie konta w Postrze',
      html: (url: string) =>
        `Otrzymaliśmy prośbę o usunięcie Twojego konta w Postrze. Usunięcie kasuje Twoje dane, podłączone kanały, zaplanowane posty i media oraz anuluje subskrypcję. Nie da się tego cofnąć. Link wygaśnie za 1 godzinę.<br /><br />${button(url, 'Usuń moje konto')}<br /><br />${linkLine(url, 'Jeśli przycisk nie działa, wklej ten link do przeglądarki:')}<br /><br />Jeśli to nie Ty, zignoruj tę wiadomość, a konto zostanie bez zmian. Prośbę wysłał ktoś zalogowany na Twoje konto, więc wyloguj urządzenia, których nie znasz.`,
    },
  },
};
