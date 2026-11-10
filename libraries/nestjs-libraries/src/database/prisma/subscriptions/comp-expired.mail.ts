const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface ExpiredCompRow {
  organizationId: string;
  subscriptionTier: string;
  compReason: string | null;
  compEndsAt: Date | null;
  organization: { name: string };
}

/** Housekeeping's mail to Postra administrators when comps run out (internal, English). */
export const compExpiredMail = (rows: ExpiredCompRow[]) => {
  const subject = `Postra: ${rows.length} comp${rows.length === 1 ? '' : 's'} ended, back on Free`;
  const lines = rows
    .map(
      (r) =>
        `<tr><td>${escape(r.organization.name)}</td><td>${escape(r.subscriptionTier)}</td><td>${escape(r.compReason ?? '')}</td><td>${r.compEndsAt ? r.compEndsAt.toISOString().slice(0, 10) : ''}</td></tr>`
    )
    .join('');
  const html = `<p>These comps reached their end date and were taken back. The organizations are on Free; posts and media stay. To extend one, comp it again in Admin → Users.</p>
<table cellpadding="6" border="1" style="border-collapse:collapse"><tr><th>Organisation</th><th>Plan</th><th>Reason</th><th>Ended</th></tr>${lines}</table>`;
  return { subject, html };
};
