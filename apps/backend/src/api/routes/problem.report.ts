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
}) =>
  [
    `<p><strong>From:</strong> ${escapeHtml(r.name || '-')} &lt;${escapeHtml(r.email)}&gt;</p>`,
    `<p><strong>Organization:</strong> ${escapeHtml(r.organization)}</p>`,
    r.page ? `<p><strong>Page:</strong> ${escapeHtml(r.page)}</p>` : '',
    r.eventId ? `<p><strong>Sentry event:</strong> ${escapeHtml(r.eventId)} (screenshot, if any, is there)</p>` : '',
    `<p style="white-space:pre-wrap">${escapeHtml(r.message)}</p>`,
  ].join('');
