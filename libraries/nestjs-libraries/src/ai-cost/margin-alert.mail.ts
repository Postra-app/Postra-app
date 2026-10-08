import { MarginRow } from '@gitroom/nestjs-libraries/ai-cost/ai-cost';

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The margin guard's mail to Postra administrators (internal, English). */
export const marginAlertMail = (
  rows: MarginRow[],
  report: { days: number; usdPerGbp: number; threshold: number; unknownModels: string[] }
) => {
  const subject = `Postra margin guard: ${rows.length} organisation${rows.length === 1 ? '' : 's'} over ${Math.round(report.threshold * 100)}% of plan price`;
  const lines = rows
    .map(
      (r) =>
        `<tr><td>${escape(r.name)}</td><td>${r.tier}${r.trial ? ' (trial)' : ''}</td><td>£${r.planGbp.toFixed(2)}</td><td>$${r.costUsd.toFixed(2)}</td><td><b>${Math.round(r.share * 100)}%</b></td></tr>`
    )
    .join('');
  const unknown = report.unknownModels.length
    ? `<p>Models without a price (counted as the dearest): ${report.unknownModels.map(escape).join(', ')}.</p>`
    : '';
  const html = `<p>AI cost over the last ${report.days} days against the plan price (at $${report.usdPerGbp} to £1):</p>
<table cellpadding="6" border="1" style="border-collapse:collapse"><tr><th>Organisation</th><th>Plan</th><th>Price / month</th><th>AI cost</th><th>Share</th></tr>${lines}</table>${unknown}
<p>Full report: Admin → GET /api/admin/ai-costs.</p>`;
  return { subject, html };
};
