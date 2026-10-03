// Email body for "Report a problem" (users.controller /user/problem-report).
// Everything the reporter typed is escaped: the mail is HTML.
const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const problemReportHtml = (r: {
  message: string;
  name?: string;
  email: string;
  organization: string;
  page?: string;
  eventId?: string;
  screenshotUrl?: string;
  // The reporter attached a screenshot, but it was refused or not stored.
  screenshotLost?: boolean;
}) =>
  [
    `<p><strong>From:</strong> ${escapeHtml(r.name || '-')} &lt;${escapeHtml(r.email)}&gt;</p>`,
    `<p><strong>Organization:</strong> ${escapeHtml(r.organization)}</p>`,
    r.page ? `<p><strong>Page:</strong> ${escapeHtml(r.page)}</p>` : '',
    r.eventId ? `<p><strong>Sentry event:</strong> ${escapeHtml(r.eventId)} (screenshot, if any, is there)</p>` : '',
    r.screenshotUrl
      ? `<p><strong>Screenshot:</strong> <a href="${escapeHtml(r.screenshotUrl)}">open</a> (sign in to Postra as an administrator; kept 30 days, the original stays in Sentry)</p>`
      : r.screenshotLost
        ? `<p><strong>Screenshot:</strong> attached but not kept here; open it in the Sentry event</p>`
        : '',
    `<p style="white-space:pre-wrap">${escapeHtml(r.message)}</p>`,
  ].join('');
