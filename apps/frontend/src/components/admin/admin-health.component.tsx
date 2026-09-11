'use client';

import { FC, useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface ServiceStatus {
  status: 'ok' | 'error';
  latencyMs: number;
  detail?: string;
}

interface HealthResponse {
  overall: 'healthy' | 'degraded';
  services: {
    database: ServiceStatus;
    redis: ServiceStatus;
    temporal: ServiceStatus;
  };
  counts: {
    users: number;
    organizations: number;
    posts: number;
    errors: number;
  };
  errors24h: number;
  lastPublishedAt: string | null;
  disk: { totalGB: number; usedPercent: number } | null;
  hostMemory: {
    totalMB: number;
    availableMB: number;
    swapUsedMB: number;
  } | null;
  uptime: number;
  memoryMB: number;
  nodeVersion: string;
}

const formatUptime = (seconds: number): string => {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
};

const StatusDot: FC<{ ok: boolean }> = ({ ok }) => (
  <span
    className={`inline-block w-[10px] h-[10px] rounded-full ${
      ok ? 'bg-green-500' : 'bg-red-500'
    }`}
  />
);

export const AdminHealthComponent: FC = () => {
  const fetch = useFetch();
  const t = useT();

  const fetcher = useCallback(
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch health');
      return res.json();
    },
    [fetch]
  );

  const { data, isLoading, error } = useSWR<HealthResponse>(
    '/admin/health',
    fetcher,
    { refreshInterval: 30_000, revalidateOnFocus: false }
  );

  if (isLoading) {
    return (
      <div className="text-textColor p-[20px] opacity-70">
        {t('admin_health_loading', 'Loading health data...')}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-red-400 p-[20px]">
        {t('admin_health_error', 'Failed to load system health.')}
      </div>
    );
  }

  const isHealthy = data.overall === 'healthy';
  const services: { key: keyof HealthResponse['services']; label: string }[] = [
    { key: 'database', label: t('admin_health_service_database', 'Database') },
    { key: 'redis', label: t('admin_health_service_redis', 'Redis') },
    { key: 'temporal', label: t('admin_health_service_temporal', 'Temporal') },
  ];

  const metrics: { label: string; value: string; warn?: boolean }[] = [
    {
      label: t('admin_health_metric_users', 'Users'),
      value: data.counts.users.toLocaleString(),
    },
    {
      label: t('admin_health_metric_orgs', 'Organizations'),
      value: data.counts.organizations.toLocaleString(),
    },
    {
      label: t('admin_health_metric_posts', 'Posts'),
      value: data.counts.posts.toLocaleString(),
    },
    {
      label: t('admin_health_metric_errors_24h', 'Errors (24h / total)'),
      value: `${data.errors24h.toLocaleString()} / ${data.counts.errors.toLocaleString()}`,
      warn: data.errors24h > 0,
    },
  ];

  return (
    <div className="flex flex-col gap-[16px] text-textColor">
      <h2 className="text-[20px] font-[600]">System Health</h2>
      {/* Overall status banner */}
      <div
        className={`flex items-center gap-[12px] px-[20px] py-[14px] rounded-[12px] border ${
          isHealthy
            ? 'border-green-500/30 bg-green-500/10'
            : 'border-amber-500/30 bg-amber-500/10'
        }`}
      >
        <span
          className={`inline-block w-[12px] h-[12px] rounded-full ${
            isHealthy ? 'bg-green-500' : 'bg-amber-500'
          }`}
        />
        <span className="text-[18px] font-[600]">
          {isHealthy
            ? t('admin_health_status_healthy', 'Healthy')
            : t('admin_health_status_degraded', 'Degraded')}
        </span>
      </div>

      {/* Service cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-[12px]">
        {services.map(({ key, label }) => {
          const svc = data.services[key];
          const ok = svc.status === 'ok';
          return (
            <div
              key={key}
              className="bg-white/[0.03] border border-white/10 rounded-[12px] p-[16px] flex flex-col gap-[8px]"
            >
              <div className="flex items-center gap-[8px]">
                <StatusDot ok={ok} />
                <span className="text-[14px] font-[600]">{label}</span>
              </div>
              <div className="text-[24px] font-[600]">
                {svc.latencyMs}
                <span className="text-[13px] font-[400] opacity-60 ml-[4px]">ms</span>
              </div>
              {svc.detail && (
                <div className="text-[12px] opacity-50 break-all">{svc.detail}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px]">
        {metrics.map(({ label, value, warn }) => (
          <div
            key={label}
            className="bg-white/[0.03] border border-white/10 rounded-[12px] p-[16px]"
          >
            <div className="text-[12px] opacity-60">{label}</div>
            <div
              className={`text-[28px] font-[600] ${warn ? 'text-amber-400' : ''}`}
            >
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Host resources + publishing pulse */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-[12px]">
        <div className="bg-white/[0.03] border border-white/10 rounded-[12px] p-[16px]">
          <div className="text-[12px] opacity-60">
            {t('admin_health_disk', 'Host disk')}
          </div>
          {data.disk ? (
            <div
              className={`text-[20px] font-[600] ${
                data.disk.usedPercent > 80 ? 'text-amber-400' : ''
              }`}
            >
              {data.disk.usedPercent}%
              <span className="text-[13px] font-[400] opacity-60 ml-[4px]">
                of {data.disk.totalGB} GB
              </span>
            </div>
          ) : (
            <div className="text-[20px] font-[600] opacity-70">-</div>
          )}
        </div>
        <div className="bg-white/[0.03] border border-white/10 rounded-[12px] p-[16px]">
          <div className="text-[12px] opacity-60">
            {t('admin_health_host_ram', 'Host RAM free / swap used')}
          </div>
          {data.hostMemory ? (
            <div className="text-[20px] font-[600]">
              {Math.round(data.hostMemory.availableMB / 102.4) / 10} GB
              <span className="text-[13px] font-[400] opacity-60 ml-[4px]">
                / swap {data.hostMemory.swapUsedMB} MB
              </span>
            </div>
          ) : (
            <div className="text-[20px] font-[600] opacity-70">-</div>
          )}
        </div>
        <div className="bg-white/[0.03] border border-white/10 rounded-[12px] p-[16px]">
          <div className="text-[12px] opacity-60">
            {t('admin_health_last_publish', 'Last published post')}
          </div>
          <div className="text-[20px] font-[600]">
            {data.lastPublishedAt
              ? new Date(data.lastPublishedAt).toLocaleString()
              : t('admin_health_never', 'never')}
          </div>
        </div>
      </div>

      {/* System info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-[12px]">
        <div className="bg-white/[0.03] border border-white/10 rounded-[12px] p-[16px]">
          <div className="text-[12px] opacity-60">{t('admin_health_uptime', 'Uptime')}</div>
          <div className="text-[20px] font-[600]">{formatUptime(data.uptime)}</div>
        </div>
        <div className="bg-white/[0.03] border border-white/10 rounded-[12px] p-[16px]">
          <div className="text-[12px] opacity-60">{t('admin_health_memory', 'Memory')}</div>
          <div className="text-[20px] font-[600]">
            {data.memoryMB}
            <span className="text-[13px] font-[400] opacity-60 ml-[4px]">MB</span>
          </div>
        </div>
        <div className="bg-white/[0.03] border border-white/10 rounded-[12px] p-[16px]">
          <div className="text-[12px] opacity-60">{t('admin_health_node', 'Node Version')}</div>
          <div className="text-[20px] font-[600]">{data.nodeVersion}</div>
        </div>
      </div>
    </div>
  );
};
