import {
  Body,
  Controller,
  Get,
  HttpException,
  Post,
  Query,
} from '@nestjs/common';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { User } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { ErrorsService } from '@gitroom/nestjs-libraries/database/prisma/errors/errors.service';
import { AdminStatsService } from '@gitroom/nestjs-libraries/database/prisma/admin-stats/admin-stats.service';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';
import { AiUsageService } from '@gitroom/nestjs-libraries/database/prisma/ai-usage/ai-usage.service';
import dayjs from 'dayjs';
import { fetch } from 'undici';
// Static import — a dynamic import('@gitroom/...') keeps the alias verbatim in
// the compiled dist and crashes at runtime (Cannot find module).
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { bustAuthContextCache } from '@gitroom/nestjs-libraries/redis/auth-context.cache';

@ApiTags('Admin')
@Controller('/admin')
export class AdminController {
  constructor(
    private _errorsService: ErrorsService,
    private _adminStatsService: AdminStatsService,
    private _prisma: PrismaService,
    private _subscriptionService: SubscriptionService,
    private _auditService: AuditService,
    private _aiUsageService: AiUsageService
  ) {}

  private assertSuperAdmin(user: User) {
    if (!user?.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }
  }

  @Get('/errors')
  async listErrors(
    @GetUserFromRequest() user: User,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('platform') platform?: string,
    @Query('email') email?: string,
    @Query('unknownFirst') unknownFirst?: string,
    @Query('days') days?: string
  ) {
    this.assertSuperAdmin(user);
    const parsedDays = days ? parseInt(days, 10) : 0;
    return this._errorsService.listErrors({
      page: page ? parseInt(page, 10) : 0,
      limit: limit ? parseInt(limit, 10) : 20,
      platform: platform || undefined,
      email: email || undefined,
      unknownFirst: unknownFirst === 'true' || unknownFirst === '1',
      // 0 / missing / NaN = all time
      days: Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : undefined,
    });
  }

  @Get('/errors/platforms')
  async listPlatforms(@GetUserFromRequest() user: User) {
    this.assertSuperAdmin(user);
    return this._errorsService.listPlatforms();
  }

  @Get('/stats')
  async getStats(
    @GetUserFromRequest() user: User,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('unknownOnly') unknownOnly?: string
  ) {
    this.assertSuperAdmin(user);

    const fromDate = from ? dayjs(from) : dayjs().subtract(30, 'day');
    const toDate = to ? dayjs(to) : dayjs();

    return this._adminStatsService.getStats({
      from: fromDate.startOf('day').toDate(),
      to: toDate.endOf('day').toDate(),
      unknownOnly: unknownOnly === 'true' || unknownOnly === '1',
    });
  }

  @Get('/organizations')
  async listOrganizations(
    @GetUserFromRequest() user: User,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string
  ) {
    this.assertSuperAdmin(user);
    const take = limit ? parseInt(limit, 10) : 20;
    const skip = page ? parseInt(page, 10) * take : 0;

    const where = search
      ? { name: { contains: search, mode: 'insensitive' as const } }
      : {};

    const [items, total] = await Promise.all([
      this._prisma.organization.findMany({
        where,
        take,
        skip,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          createdAt: true,
          subscription: {
            select: {
              subscriptionTier: true,
              period: true,
              totalChannels: true,
              isLifetime: true,
              cancelAt: true,
            },
          },
          _count: {
            select: {
              users: true,
              Integration: { where: { deletedAt: null } },
              post: { where: { deletedAt: null, parentPostId: null } },
            },
          },
        },
      }),
      this._prisma.organization.count({ where }),
    ]);

    return { items, total, page: page ? parseInt(page, 10) : 0, limit: take };
  }

  @Get('/users')
  async listUsers(
    @GetUserFromRequest() user: User,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string
  ) {
    this.assertSuperAdmin(user);
    const take = limit ? parseInt(limit, 10) : 20;
    const skip = page ? parseInt(page, 10) * take : 0;

    const where = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' as const } },
            { name: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [items, total] = await Promise.all([
      this._prisma.user.findMany({
        where,
        take,
        skip,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          lastName: true,
          providerName: true,
          activated: true,
          isSuperAdmin: true,
          createdAt: true,
          lastOnline: true,
          organizations: {
            // UserOrganization id — it is what POST /user/impersonate expects
            select: {
              id: true,
              role: true,
              organization: {
                select: {
                  id: true,
                  name: true,
                  subscription: {
                    select: { subscriptionTier: true, isLifetime: true },
                  },
                },
              },
            },
          },
        },
      }),
      this._prisma.user.count({ where }),
    ]);

    return { items, total, page: page ? parseInt(page, 10) : 0, limit: take };
  }

  @Post('/grant-lifetime')
  async grantLifetime(
    @GetUserFromRequest() user: User,
    @Body('email') email: string,
    @Body('apply') apply: boolean
  ) {
    this.assertSuperAdmin(user);
    if (!email?.trim()) {
      throw new HttpException('Missing email', 400);
    }

    // Same engine as the grant-lifetime CLI (#142): lifetime Business for
    // every org the email OWNS; dry-run unless apply=true.
    const report = await this._subscriptionService.grantLifetimeByEmail(
      email,
      apply === true
    );

    if (apply === true) {
      this._auditService.record({
        action: 'admin.grant-lifetime',
        userId: user.id,
        metadata: {
          email,
          granted: report.granted.map((g) => g.id),
          skipped: report.skipped.length,
        },
      });
    }

    return report;
  }

  // God-mode toggle, deliberately separate from grant-lifetime: lifetime is
  // an ULTIMATE subscription (full product, no admin panel), whereas this flips
  // the global isSuperAdmin flag that gates /admin. isSuperAdmin is re-read from
  // the DB on every request (sessions v2, not carried in the JWT), so busting
  // the authctx cache makes the change take effect on the target's next request
  // without a forced re-login.
  @Post('/grant-admin')
  async setAdmin(
    @GetUserFromRequest() user: User,
    @Body('userId') userId: string,
    @Body('value') value: boolean
  ) {
    this.assertSuperAdmin(user);
    if (!userId?.trim()) {
      throw new HttpException('Missing userId', 400);
    }
    const next = value === true;
    // Never let an admin strip their own access — that is the only way to lock
    // the last person out of the panel. Revoking others is fine.
    if (userId === user.id && !next) {
      throw new HttpException('You cannot revoke your own admin access', 400);
    }

    const target = await this._prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, isSuperAdmin: true },
    });
    if (!target) {
      throw new HttpException('User not found', 400);
    }

    if (target.isSuperAdmin !== next) {
      await this._prisma.user.update({
        where: { id: userId },
        data: { isSuperAdmin: next },
      });
      await bustAuthContextCache(userId);
      this._auditService.record({
        action: next ? 'admin.grant-admin' : 'admin.revoke-admin',
        userId: user.id,
        metadata: { targetUserId: userId, email: target.email },
      });
    }

    return { id: userId, isSuperAdmin: next };
  }

  @Get('/metrics')
  async getAppMetrics(@GetUserFromRequest() user: User) {
    this.assertSuperAdmin(user);

    const aiCalls24h = await this._prisma.credits.count({
      where: { createdAt: { gte: dayjs().subtract(24, 'hour').toDate() } },
    });

    const token = process.env.GRAFANA_SA_TOKEN;
    const grafanaUrl = process.env.GRAFANA_URL || 'https://postra.grafana.net';
    if (!token) {
      return { enabled: false, aiCalls24h };
    }

    // Same PromQL as the Tier 1 dashboards (observability/dashboards/generate.py)
    const prom = { type: 'prometheus', uid: 'grafanacloud-prom' };
    const range = (refId: string, expr: string) => ({
      refId,
      datasource: prom,
      expr,
      range: true,
      intervalMs: 1800000,
      maxDataPoints: 48,
    });
    const instant = (refId: string, expr: string) => ({
      refId,
      datasource: prom,
      expr,
      instant: true,
      range: false,
    });

    try {
      const res = await fetch(`${grafanaUrl}/api/ds/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'now-24h',
          to: 'now',
          queries: [
            range('A', 'sum(rate(http_request_duration_seconds_count[5m]))'),
            range(
              'B',
              'histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))'
            ),
            instant('C', 'sum(increase(temporal_workflow_completed[24h]))'),
            instant('D', 'sum(increase(temporal_workflow_failed[24h]))'),
          ],
        }),
      });
      if (!res.ok) {
        throw new Error(`Grafana responded ${res.status}`);
      }
      const data: any = await res.json();

      const series = (refId: string): [number, number][] => {
        const values = data?.results?.[refId]?.frames?.[0]?.data?.values;
        if (!values?.length) return [];
        const [times, vals] = values;
        return times
          .map((t: number, i: number) => [t, vals[i]] as [number, number])
          .filter((p: [number, number]) => p[1] != null);
      };
      const last = (refId: string) => {
        const s = series(refId);
        return s.length ? s[s.length - 1][1] : 0;
      };

      return {
        enabled: true,
        requestRate: series('A'),
        latencyP95: series('B'),
        publish24h: {
          completed: Math.round(last('C')),
          failed: Math.round(last('D')),
        },
        aiCalls24h,
      };
    } catch (e: any) {
      return { enabled: false, error: e.message, aiCalls24h };
    }
  }

  @Get('/health')
  async getSystemHealth(@GetUserFromRequest() user: User) {
    this.assertSuperAdmin(user);

    const checks: Record<string, { status: string; latencyMs?: number; detail?: string }> = {};

    const dbStart = Date.now();
    try {
      await this._prisma.$queryRaw`SELECT 1`;
      checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
    } catch (e: any) {
      checks.database = { status: 'error', latencyMs: Date.now() - dbStart, detail: e.message };
    }

    // Real PING through the app's own client — proves Redis answers commands,
    // not just that the port accepts TCP.
    const redisStart = Date.now();
    try {
      if (!ioRedis) throw new Error('REDIS_URL not configured');
      await ioRedis.ping();
      checks.redis = { status: 'ok', latencyMs: Date.now() - redisStart };
    } catch (e: any) {
      checks.redis = { status: 'error', latencyMs: Date.now() - redisStart, detail: e.message };
    }

    const temporalAddress = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
    const temporalStart = Date.now();
    try {
      const net = await import('net');
      const [host, port] = temporalAddress.split(':');
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection(
          { host, port: parseInt(port || '7233'), timeout: 3000 },
          () => { socket.destroy(); resolve(); }
        );
        socket.on('error', reject);
        socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
      });
      checks.temporal = { status: 'ok', latencyMs: Date.now() - temporalStart };
    } catch (e: any) {
      checks.temporal = { status: 'error', latencyMs: Date.now() - temporalStart, detail: e.message };
    }

    const [userCount, orgCount, postCount, errorCount, errors24h, lastPublished] =
      await Promise.all([
        this._prisma.user.count(),
        this._prisma.organization.count(),
        this._prisma.post.count({ where: { deletedAt: null } }),
        this._prisma.errors.count(),
        this._prisma.errors.count({
          where: { createdAt: { gte: dayjs().subtract(24, 'hour').toDate() } },
        }),
        this._prisma.post.findFirst({
          where: { state: 'PUBLISHED', deletedAt: null },
          orderBy: { publishDate: 'desc' },
          select: { publishDate: true },
        }),
      ]);

    // Container / is an overlay on the host root disk, so statfs reflects the
    // real 30GB volume (the one that historically filled up with old images).
    let disk: { totalGB: number; usedPercent: number } | null = null;
    try {
      const { statfs } = await import('fs/promises');
      const s = await statfs('/');
      const total = s.blocks * s.bsize;
      const free = s.bavail * s.bsize;
      disk = {
        totalGB: Math.round(total / 1024 / 1024 / 1024),
        usedPercent: Math.round((1 - free / total) * 100),
      };
    } catch {
      // fs.statfs unavailable — leave the card empty rather than fail health
    }

    // Docker does not namespace /proc/meminfo — these are HOST numbers.
    let hostMemory: { totalMB: number; availableMB: number; swapUsedMB: number } | null =
      null;
    try {
      const { readFile } = await import('fs/promises');
      const meminfo = await readFile('/proc/meminfo', 'utf8');
      const grab = (key: string) =>
        parseInt(meminfo.match(new RegExp(`${key}:\\s+(\\d+)`))?.[1] || '0', 10);
      hostMemory = {
        totalMB: Math.round(grab('MemTotal') / 1024),
        availableMB: Math.round(grab('MemAvailable') / 1024),
        swapUsedMB: Math.round((grab('SwapTotal') - grab('SwapFree')) / 1024),
      };
    } catch {
      // non-Linux dev machines — skip
    }

    return {
      overall: Object.values(checks).every((c) => c.status === 'ok') ? 'healthy' : 'degraded',
      services: checks,
      counts: { users: userCount, organizations: orgCount, posts: postCount, errors: errorCount },
      errors24h,
      lastPublishedAt: lastPublished?.publishDate ?? null,
      disk,
      hostMemory,
      uptime: process.uptime(),
      memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      nodeVersion: process.version,
    };
  }

  @Get('/ai-usage')
  async getAiUsage(
    @GetUserFromRequest() user: User,
    @Query('from') from?: string,
    @Query('to') to?: string
  ) {
    this.assertSuperAdmin(user);

    const fromDate = from ? dayjs(from).toDate() : dayjs().subtract(30, 'day').toDate();
    const toDate = to ? dayjs(to).toDate() : new Date();

    // NOTE: AI usage is reported from `credits` (real, billable usage). Mastra's
    // own span tables (mastra_ai_spans) are @@ignore'd in the Prisma schema (no @id),
    // so they are NOT in the generated client and cannot be queried via this._prisma.
    const [creditsByType, creditsByOrg, creditsByHour] = await Promise.all([
      this._prisma.credits.groupBy({
        by: ['type'],
        where: { createdAt: { gte: fromDate, lte: toDate } },
        _sum: { credits: true },
        _count: { _all: true },
      }),
      this._prisma.credits.groupBy({
        by: ['organizationId'],
        where: { createdAt: { gte: fromDate, lte: toDate } },
        _sum: { credits: true },
        orderBy: { _sum: { credits: 'desc' } },
        take: 10,
      }),
      // Hourly buckets (UTC timestamps). The frontend folds these into local
      // days and an hour-of-day breakdown, so a daily spike can be attributed
      // to a morning/evening instead of just a date.
      this._prisma.$queryRaw<Array<{ hour: Date; count: bigint }>>`
        SELECT date_trunc('hour', "createdAt") as hour, SUM("credits")::bigint as count
        FROM "Credits"
        WHERE "createdAt" >= ${fromDate} AND "createdAt" <= ${toDate}
        GROUP BY 1
        ORDER BY 1
      `,
    ]);

    // Observational token metering (AiUsage) — separate from billable credits.
    const [textByEngine, textTopOrgs] = await this._aiUsageService.summary(
      fromDate,
      toDate
    );

    const orgIds = Array.from(
      new Set([
        ...creditsByOrg.map((c) => c.organizationId),
        ...textTopOrgs
          .map((t) => t.organizationId)
          .filter((id): id is string => !!id),
      ])
    );
    const orgs = orgIds.length
      ? await this._prisma.organization.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, name: true },
        })
      : [];
    const orgMap = new Map(orgs.map((o) => [o.id, o.name]));

    return {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      byType: creditsByType.map((c) => ({
        type: c.type,
        totalCredits: c._sum.credits || 0,
        count: c._count._all,
      })),
      topOrgs: creditsByOrg.map((c) => ({
        orgId: c.organizationId,
        orgName: orgMap.get(c.organizationId) || 'Unknown',
        totalCredits: c._sum.credits || 0,
      })),
      byHour: creditsByHour.map((r) => ({
        hour: new Date(r.hour).toISOString(),
        count: Number(r.count),
      })),
      text: {
        byEngine: textByEngine.map((t) => ({
          engine: t.engine,
          model: t.model,
          unit: t.unit,
          inputAmount: t._sum.inputAmount || 0,
          outputAmount: t._sum.outputAmount || 0,
          calls: t._count._all,
        })),
        topOrgs: textTopOrgs.map((t) => ({
          orgId: t.organizationId,
          orgName: t.organizationId
            ? orgMap.get(t.organizationId) || 'Unknown'
            : '(no org)',
          inputTokens: t._sum.inputAmount || 0,
          outputTokens: t._sum.outputAmount || 0,
        })),
      },
    };
  }

  @Get('/growth')
  async getGrowth(
    @GetUserFromRequest() user: User,
    @Query('days') days?: string,
    @Query('from') from?: string,
    @Query('to') to?: string
  ) {
    this.assertSuperAdmin(user);

    const untilDay = to ? dayjs(to).endOf('day') : dayjs().endOf('day');
    const sinceDay = from
      ? dayjs(from).startOf('day')
      : untilDay
          .subtract(days ? parseInt(days, 10) : 30, 'day')
          .startOf('day');
    const numDays = untilDay.diff(sinceDay, 'day') + 1;
    const since = sinceDay.toDate();
    const until = untilDay.toDate();

    const [
      totalUsers,
      totalOrgs,
      newUsers,
      newOrgs,
      usersByDay,
      postsByDay,
      activeToday,
      activeWeek,
      activeMonth,
    ] = await Promise.all([
      this._prisma.user.count(),
      this._prisma.organization.count(),
      this._prisma.user.count({
        where: { createdAt: { gte: since, lte: until } },
      }),
      this._prisma.organization.count({
        where: { createdAt: { gte: since, lte: until } },
      }),
      this._prisma.$queryRaw<Array<{ day: string; count: bigint }>>`
        SELECT DATE("createdAt") as day, COUNT(*)::bigint as count
        FROM "User"
        WHERE "createdAt" >= ${since} AND "createdAt" <= ${until}
        GROUP BY DATE("createdAt")
        ORDER BY day
      `,
      this._prisma.$queryRaw<Array<{ day: string; count: bigint }>>`
        SELECT DATE("publishDate") as day, COUNT(*)::bigint as count
        FROM "Post"
        WHERE "publishDate" >= ${since} AND "publishDate" <= ${until}
          AND "deletedAt" IS NULL
          AND "parentPostId" IS NULL
          AND "state" = 'PUBLISHED'
        GROUP BY DATE("publishDate")
        ORDER BY day
      `,
      this._prisma.user.count({
        where: { lastOnline: { gte: dayjs().startOf('day').toDate() } },
      }),
      this._prisma.user.count({
        where: { lastOnline: { gte: dayjs().subtract(7, 'day').toDate() } },
      }),
      this._prisma.user.count({
        where: { lastOnline: { gte: dayjs().subtract(30, 'day').toDate() } },
      }),
    ]);

    // Prisma deserialises a `date` column into a Date object, so `String(...)`
    // gave "Wed Sep 09 2026 00:00:00 GMT+0000" and slicing ten characters left
    // "Wed Sep 09". The front end reads this as ISO, so the twelve-month chart
    // ended up labelled with bare day numbers — no month, no year (E2E-09-04).
    const serialize = (rows: Array<{ day: string; count: bigint }>) =>
      rows.map((r) => ({
        day: dayjs(r.day).format('YYYY-MM-DD'),
        count: Number(r.count),
      }));

    return {
      totals: { users: totalUsers, organizations: totalOrgs },
      period: { days: numDays, newUsers, newOrgs },
      activity: { dau: activeToday, wau: activeWeek, mau: activeMonth },
      charts: {
        signups: serialize(usersByDay),
        posts: serialize(postsByDay),
      },
    };
  }

  @Get('/subscriptions')
  async getSubscriptions(@GetUserFromRequest() user: User) {
    this.assertSuperAdmin(user);

    const [byTier, byPeriod, lifetimeCount, totalActive, cancelPending, recentSubs] =
      await Promise.all([
        this._prisma.subscription.groupBy({
          by: ['subscriptionTier'],
          where: { deletedAt: null },
          _count: { _all: true },
        }),
        this._prisma.subscription.groupBy({
          by: ['period'],
          where: { deletedAt: null },
          _count: { _all: true },
        }),
        this._prisma.subscription.count({
          where: { isLifetime: true, deletedAt: null },
        }),
        this._prisma.subscription.count({ where: { deletedAt: null } }),
        this._prisma.subscription.count({
          where: { cancelAt: { not: null }, deletedAt: null },
        }),
        this._prisma.subscription.findMany({
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            subscriptionTier: true,
            period: true,
            totalChannels: true,
            isLifetime: true,
            cancelAt: true,
            createdAt: true,
            organization: {
              select: { id: true, name: true, paymentId: true },
            },
          },
        }),
      ]);

    const noSubscription = await this._prisma.organization.count({
      where: { subscription: null },
    });

    return {
      totalActive,
      cancelPending,
      noSubscription,
      byTier: byTier.map((t) => ({ tier: t.subscriptionTier, count: t._count._all })),
      byPeriod: byPeriod.map((p) => ({ period: p.period, count: p._count._all })),
      lifetime: lifetimeCount,
      recent: recentSubs,
    };
  }
}
