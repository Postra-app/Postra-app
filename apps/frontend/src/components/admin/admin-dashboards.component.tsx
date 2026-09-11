'use client';

import { FC, useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const REGION = 'eu-west-2';
const CW = `https://${REGION}.console.aws.amazon.com/cloudwatch/home?region=${REGION}`;

const links: { name: string; desc: string; href: string }[] = [
  { name: 'CloudWatch', desc: 'RAM, disk, CPU, RDS, ALB · dashboard postra-dev', href: `${CW}#dashboards/dashboard/postra-dev` },
  { name: 'Alarms', desc: '7 alarms → email (5xx, RAM, disk, RDS, recovery)', href: `${CW}#alarmsV2:` },
  { name: 'Status page', desc: 'status.postra.pl · uptime + response time', href: 'https://status.postra.pl' },
  { name: 'Sentry', desc: 'errors + traces (FE + BE)', href: 'https://bk-company-9c.sentry.io/issues/' },
];

const GRAFANA_URL = 'https://postra.grafana.net';

interface AppMetrics {
  enabled: boolean;
  unavailable?: boolean;
  error?: string;
  requestRate?: [number, number][];
  latencyP95?: [number, number][];
  publish24h?: { completed: number; failed: number };
  aiCalls24h: number;
}

const Sparkline: FC<{ points: [number, number][] }> = ({ points }) => {
  if (points.length < 2) {
    return <div className="h-[46px] mt-[10px] rounded-[8px] bg-gradient-to-b from-[rgba(56,189,248,0.10)] to-transparent" />;
  }
  const vals = points.map((p) => p[1]);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const poly = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * 100;
      const y = 44 - ((p[1] - min) / span) * 40;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox="0 0 100 46" preserveAspectRatio="none" className="w-full h-[46px] mt-[10px]">
      <polyline points={poly} fill="none" stroke="#38bdf8" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

const MetricCard: FC<{
  label: string;
  value: string;
  sub?: string;
  subClass?: string;
  spark?: [number, number][];
}> = ({ label, value, sub, subClass, spark }) => (
  <div className="bg-white/[0.03] border border-white/10 rounded-[16px] p-[16px]">
    <div className="text-[12px] text-newTextColor/60">{label}</div>
    <div className="text-[20px] font-[650] mt-[4px]">{value}</div>
    {sub && <div className={`text-[11px] mt-[2px] ${subClass ?? 'text-newTextColor/70'}`}>{sub}</div>}
    {spark && <Sparkline points={spark} />}
  </div>
);

const AppMetricsSection: FC = () => {
  const fetch = useFetch();
  const t = useT();

  const { data, isLoading, error } = useSWR<AppMetrics>(
    '/admin/metrics',
    useCallback(
      async (url: string) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to load metrics');
        return res.json();
      },
      [fetch]
    ),
    { revalidateOnFocus: false, refreshInterval: 60000 }
  );

  if (isLoading && !data) {
    return <div className="text-[13px] opacity-50">Loading...</div>;
  }
  if (error || !data) {
    return (
      <div className="text-[13px] text-red-400">
        {t('admin_metrics_failed', 'Failed to load metrics.')}
      </div>
    );
  }
  if (!data.enabled) {
    return (
      <div className="text-[13px] text-newTextColor/70">
        {t('admin_metrics_disabled', 'Metrics are not configured')} · AI calls
        (24h): {data.aiCalls24h}
      </div>
    );
  }

  // Configured but not answering right now, after three tries — different from
  // not configured at all, and no longer a card of raw error text (E2E-09-31).
  if (data.unavailable) {
    return (
      <div className="text-[13px] text-newTextColor/70">
        {t(
          'admin_metrics_unavailable',
          'Grafana is not responding — try again in a moment'
        )}{' '}
        · AI calls (24h): {data.aiCalls24h}
      </div>
    );
  }

  const lastOf = (s?: [number, number][]) =>
    s && s.length ? s[s.length - 1][1] : 0;
  const failed = data.publish24h?.failed ?? 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[12px]">
      <MetricCard
        label={t('admin_metrics_request_rate', 'Request rate')}
        value={`${lastOf(data.requestRate).toFixed(2)} req/s`}
        sub={t('admin_metrics_last_24h', 'last 24h')}
        spark={data.requestRate}
      />
      <MetricCard
        label={t('admin_metrics_latency', 'Latency p95')}
        value={`${Math.round(lastOf(data.latencyP95) * 1000)} ms`}
        sub={t('admin_metrics_slo', 'SLO < 200 ms')}
        subClass={lastOf(data.latencyP95) > 0.2 ? 'text-amber-400' : 'text-green-400'}
        spark={data.latencyP95}
      />
      <MetricCard
        label={t('admin_metrics_publish', 'Publish (Temporal, 24h)')}
        value={`${data.publish24h?.completed ?? 0} ok`}
        sub={failed > 0 ? `${failed} failed` : t('admin_metrics_no_failures', 'no failures')}
        subClass={failed > 0 ? 'text-red-400' : 'text-green-400'}
      />
      <MetricCard
        label={t('admin_metrics_ai', 'AI calls (24h)')}
        value={String(data.aiCalls24h)}
        sub={t('admin_metrics_ai_sub', 'credit-metered generations')}
      />
    </div>
  );
};

const Section: FC<{ title: string; hint?: string }> = ({ title, hint }) => (
  <div className="flex items-baseline gap-[9px] mt-[26px] mb-[2px]">
    <span className="text-[13px] font-[600] text-newTextColor">{title}</span>
    {hint && <span className="text-[11.5px] text-newTextColor/50">{hint}</span>}
  </div>
);

export const AdminDashboardsComponent: FC = () => {
  const t = useT();

  return (
    <div className="flex flex-col gap-[4px] text-newTextColor">
      <div>
        <h2 className="text-[22px] font-[650] tracking-[-0.2px]">
          {t('admin_dashboards', 'Dashboards')}
        </h2>
        <p className="text-[12.5px] text-newTextColor/55 mt-[3px]">
          {t('admin_dashboards_sub', 'Monitoring & observability — one place for every dashboard')}
        </p>
      </div>

      {/* Launch cards */}
      <Section title={t('admin_dashboards_open', 'Open dashboard')} hint={t('admin_dashboards_open_hint', '— links to full dashboards')} />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[12px]">
        {links.map((l) => (
          <a
            key={l.name}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col gap-[6px] bg-white/[0.03] border border-white/10 rounded-[16px] p-[16px] backdrop-blur-[8px] transition-all duration-150 hover:border-[rgba(56,189,248,0.4)] hover:bg-white/[0.06] hover:-translate-y-[1px]"
          >
            <div className="flex items-center justify-between">
              <span className="font-[600] text-[14px]">{l.name}</span>
              <span className="text-[#38bdf8] text-[12px]">↗</span>
            </div>
            <span className="text-newTextColor/55 text-[12px]">{l.desc}</span>
          </a>
        ))}
      </div>

      {/* App metrics — live Tier 1 numbers from Grafana Cloud */}
      <Section
        title={t('admin_dashboards_metrics', 'App metrics')}
        hint={t('admin_dashboards_metrics_hint_live', '— live from Grafana Cloud (Tier 1)')}
      />
      <AppMetricsSection />

      {/* Live uptime — embedded status page */}
      <Section title={t('admin_dashboards_uptime', 'Live uptime')} hint={t('admin_dashboards_uptime_hint', '— built-in status.postra.pl')} />
      <div className="bg-white/[0.03] border border-white/10 rounded-[16px] overflow-hidden backdrop-blur-[8px]">
        <iframe
          src="https://status.postra.pl"
          title="Postra status"
          className="w-full h-[420px] border-0"
          loading="lazy"
        />
      </div>

      {/* Full Grafana */}
      <Section title={t('admin_dashboards_grafana', 'Grafana')} hint={t('admin_dashboards_grafana_hint', '— full dashboards (Publishing, App RED, Host)')} />
      <a
        href={`${GRAFANA_URL}/dashboards`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-[8px] text-[13px] text-[#38bdf8] hover:underline"
      >
        {t('admin_dashboards_grafana_open', 'Open postra.grafana.net')} ↗
      </a>
    </div>
  );
};
