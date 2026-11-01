// The big number on an analytics card. Counts add up over the days; a rate or
// an average does not: the channel says `average`, and gives the period's value
// in `summary` when it is not the plain mean (clicks / impressions over the
// period, an average weighted by views).
export interface AnalyticsTotalSource {
  data?: Array<{ total: number | string }>;
  average?: boolean;
  summary?: number;
  unit?: 'percent' | 'seconds';
}

const twoDecimals = (value: number) => Math.round(value * 100) / 100;

const seconds = (value: number) => {
  const whole = Math.round(value);
  if (whole < 60) return `${whole}s`;
  const rest = whole % 60;
  return `${Math.floor(whole / 60)}m ${rest < 10 ? '0' : ''}${rest}s`;
};

export const analyticsTotal = (item: AnalyticsTotalSource): string => {
  const values = (item?.data || [])
    .map((d) => Number(d.total))
    .filter((v) => Number.isFinite(v));
  const sum = values.reduce((acc, v) => acc + v, 0);
  const rate = item?.average || !!item?.unit;
  const value =
    typeof item?.summary === 'number' && Number.isFinite(item.summary)
      ? item.summary
      : rate
      ? values.length
        ? sum / values.length
        : 0
      : sum;

  if (item?.unit === 'seconds') return seconds(value);
  // A channel from before `unit` sends `average` alone for percentages.
  if (item?.unit === 'percent' || rate) return `${twoDecimals(value)}%`;
  return new Intl.NumberFormat().format(Math.round(value));
};
