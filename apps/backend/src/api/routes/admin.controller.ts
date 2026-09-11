import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
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
import {
  parseDay,
  parseDayCount,
  parsePaging,
} from '@gitroom/backend/api/routes/admin.query';
import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import {
  channelState,
  isActionable,
  expiresInSeconds,
  CHANNEL_STATES,
  ChannelState,
} from '@gitroom/nestjs-libraries/database/prisma/integrations/channel.state';
import {
  channelStateWhere,
  notScheduledWhere,
} from '@gitroom/nestjs-libraries/database/prisma/integrations/channel.state.query';
import { canPostComments, grantedScopesOf } from '@gitroom/nestjs-libraries/integrations/social/comment.capability';

@ApiTags('Admin')
@Controller('/admin')
export class AdminController {
  constructor(
    private _errorsService: ErrorsService,
    private _adminStatsService: AdminStatsService,
    private _prisma: PrismaService,
    private _subscriptionService: SubscriptionService,
    private _auditService: AuditService,
    private _aiUsageService: AiUsageService,
    private _stripeService: StripeService,
    private _userService: UsersService,
    private _integrationManager: IntegrationManager
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
    const paging = parsePaging(page, limit);
    const parsedDays = parseDayCount(days, 'days');
    return this._errorsService.listErrors({
      page: paging.page,
      limit: paging.limit,
      platform: platform || undefined,
      email: email || undefined,
      unknownFirst: unknownFirst === 'true' || unknownFirst === '1',
      // 0 / missing = all time
      days: parsedDays && parsedDays > 0 ? parsedDays : undefined,
    });
  }

  @Get('/errors/platforms')
  async listPlatforms(@GetUserFromRequest() user: User) {
    this.assertSuperAdmin(user);
    return this._errorsService.listPlatforms();
  }

  /**
   * One error in full. The list stopped shipping `body`, which was most of its
   * 151 KB per twenty rows and is only ever looked at one row at a time
   * (E2E-09-30).
   */
  @Get('/errors/:id')
  async getError(@GetUserFromRequest() user: User, @Param('id') id: string) {
    this.assertSuperAdmin(user);
    const row = await this._errorsService.getError(id);
    if (!row) {
      throw new HttpException('Error not found', 404);
    }
    return row;
  }

  @Get('/stats')
  async getStats(
    @GetUserFromRequest() user: User,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('unknownOnly') unknownOnly?: string
  ) {
    this.assertSuperAdmin(user);

    const fromDate = parseDay(from, 'from') ?? dayjs().subtract(30, 'day');
    const toDate = parseDay(to, 'to') ?? dayjs();

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
    const { limit: take, skip } = parsePaging(page, limit);

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
    const { limit: take, skip } = parsePaging(page, limit);

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

  /**
   * Put an organization on a paid tier without a payment — a test account, a
   * compensation, an account we owe a plan to.
   *
   * The only thing an admin could grant was lifetime Business; there was no way
   * to seat an org on Starter or Pro, which is an ordinary request. The control
   * that existed rendered only while impersonating, inside a panel that is
   * hidden while impersonating, so it could never be reached — and that was the
   * only thing standing between a click and E2E-09-09 (E2E-09-02). The endpoint
   * behind it is safe now, and this one names the organization outright instead
   * of inferring it from whoever the session is wearing.
   */
  @Post('/comp-subscription')
  async compSubscription(
    @GetUserFromRequest() user: User,
    @Body('organizationId') organizationId: string,
    @Body('subscription') subscription: string
  ) {
    this.assertSuperAdmin(user);
    if (!organizationId?.trim()) {
      throw new HttpException('Missing organizationId', 400);
    }

    const org = await this._prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!org) {
      throw new HttpException('Organization not found', 400);
    }

    await this._subscriptionService.addSubscription(
      organizationId,
      user.id,
      subscription
    );

    return { organizationId, subscription };
  }

  /**
   * Take a comp or a lifetime grant back.
   *
   * Until now, comping an account was a one-way street: the only route out was
   * POST /billing/cancel-subscription, which needs a resolvable Stripe customer
   * and a live subscription, and which bails on any lifetime row before it
   * deletes anything. A grant for a tester, or the wrong tier on the wrong org,
   * could only be undone in the database (E2E-09-41).
   */
  @Post('/revoke-subscription')
  async revokeSubscription(
    @GetUserFromRequest() user: User,
    @Body('organizationId') organizationId: string
  ) {
    this.assertSuperAdmin(user);
    if (!organizationId?.trim()) {
      throw new HttpException('Missing organizationId', 400);
    }

    const org = await this._prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true },
    });
    if (!org) {
      throw new HttpException('Organization not found', 400);
    }

    return this._subscriptionService.revokeSubscription(
      organizationId,
      user.id
    );
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

    // Grafana Cloud answers 502/503/504 now and then, and a single attempt
    // turned that into a card of raw error text on a page an admin refreshes
    // all day (E2E-09-31).
    const queryGrafana = async (body: string) => {
      let lastError: Error | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, 250 * attempt));
        }
        try {
          const res = await fetch(`${grafanaUrl}/api/ds/query`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body,
          });
          if (res.ok) {
            return res;
          }
          lastError = new Error(`Grafana responded ${res.status}`);
          // Only a transient status is worth another go; 401 or 403 will
          // answer the same way every time.
          if (res.status < 500 && res.status !== 429) {
            break;
          }
        } catch (e: any) {
          lastError = e;
        }
      }
      throw lastError ?? new Error('Grafana did not respond');
    };

    try {
      const res = await queryGrafana(
        JSON.stringify({
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
        })
      );
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
      // `enabled: false` is the "not configured" answer; this is "configured
      // and currently unreachable", which reads differently on the card.
      return {
        enabled: true,
        unavailable: true,
        error: e?.message ?? 'Grafana is not responding',
        aiCalls24h,
      };
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

    const fromDate = (parseDay(from, 'from') ?? dayjs().subtract(30, 'day')).toDate();
    const toDate = (parseDay(to, 'to') ?? dayjs()).toDate();

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

    const untilDay = (parseDay(to, 'to') ?? dayjs()).endOf('day');
    const sinceDay =
      parseDay(from, 'from')?.startOf('day') ??
      untilDay.subtract(parseDayCount(days, 'days') ?? 30, 'day').startOf('day');
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
    //
    // Days with no rows are filled in with zero. GROUP BY only returns the days
    // that have something, so the axis was not linear in time: two bars side by
    // side could be a month apart, and a range with no activity at all drew
    // nothing rather than a flat line (E2E-09-19).
    const serialize = (rows: Array<{ day: string; count: bigint }>) => {
      const counts = new Map(
        rows.map((r) => [dayjs(r.day).format('YYYY-MM-DD'), Number(r.count)])
      );

      const out: Array<{ day: string; count: number }> = [];
      // Guard the span: a hand-typed range could otherwise ask for a series of
      // hundreds of thousands of points.
      const span = Math.min(Math.max(numDays, 1), 1100);
      for (let i = 0; i < span; i++) {
        const day = sinceDay.add(i, 'day').format('YYYY-MM-DD');
        out.push({ day, count: counts.get(day) ?? 0 });
      }
      return out;
    };

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
      // The panel built every "open in Stripe" link against the live
      // dashboard, so on test keys each one led to a customer that does not
      // exist there (E2E-09-21). Only the server knows which mode we are in.
      stripeTestMode: (process.env.STRIPE_SECRET_KEY || '').startsWith(
        'sk_test_'
      ),
    };
  }

  /**
   * An organization named outright, or a 400.
   *
   * Every action below used to be reachable only from inside an impersonated
   * session, which meant the organization was whoever the session happened to
   * be wearing — the pattern that made E2E-09-09 possible. comp-subscription
   * and revoke-subscription already take the id in the body; these do the
   * same.
   */
  private async requireOrganization(organizationId: string) {
    if (!organizationId?.trim()) {
      throw new HttpException('Missing organizationId', 400);
    }
    const org = await this._prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, paymentId: true },
    });
    if (!org) {
      throw new HttpException('Organization not found', 400);
    }
    return org;
  }

  /**
   * The audit trail, readable.
   *
   * Paging and dates go through the shared parsers, so a bad parameter here
   * answers 400 or clamps rather than handing the string to Prisma
   * (E2E-09-36/37/38).
   */
  @Get('/audit')
  async listAudit(
    @GetUserFromRequest() user: User,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('action') action?: string,
    @Query('userId') userId?: string,
    @Query('organizationId') organizationId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string
  ) {
    this.assertSuperAdmin(user);
    const paging = parsePaging(page, limit);
    const fromDay = parseDay(from, 'from');
    const toDay = parseDay(to, 'to');

    const result = await this._auditService.list({
      skip: paging.skip,
      limit: paging.limit,
      action: action || undefined,
      userId: userId || undefined,
      organizationId: organizationId || undefined,
      from: fromDay?.startOf('day').toDate(),
      to: toDay?.endOf('day').toDate(),
    });

    return {
      ...result,
      page: paging.page,
      limit: paging.limit,
      hasMore: paging.skip + result.items.length < result.total,
    };
  }

  /** The actions actually present, for the filter. */
  @Get('/audit/actions')
  async listAuditActions(@GetUserFromRequest() user: User) {
    this.assertSuperAdmin(user);
    return this._auditService.listActions();
  }

  /**
   * Successful charges for one organization, with links to the invoice PDFs.
   *
   * The service behind this was written, tested and then orphaned: its only
   * caller was the impersonation panel Postra replaced during a layout
   * rebuild, so the first thing a paying customer can ask for — "what have I
   * been charged, and can I have some of it back" — had no answer anywhere in
   * the product (05-gaps §1b, §2). Nothing about the service needed changing;
   * it always took an organization id.
   */
  @Get('/charges')
  async listCharges(
    @GetUserFromRequest() user: User,
    @Query('organizationId') organizationId: string
  ) {
    this.assertSuperAdmin(user);
    const org = await this.requireOrganization(organizationId);
    const charges = await this._stripeService.getCharges(org.id);
    return {
      organizationId: org.id,
      organizationName: org.name,
      hasStripeCustomer: !!org.paymentId,
      charges,
    };
  }

  /**
   * Refund selected charges.
   *
   * The service verifies every charge belongs to this organization's Stripe
   * customer before refunding it, so an id that came from the page cannot be
   * used to refund somebody else's payment. Money moves here, so the result
   * says which ones went through and which did not, and the trail records it.
   */
  @Post('/refund-charges')
  async refundCharges(
    @GetUserFromRequest() user: User,
    @Body('organizationId') organizationId: string,
    @Body('chargeIds') chargeIds: string[]
  ) {
    this.assertSuperAdmin(user);
    const org = await this.requireOrganization(organizationId);

    if (!Array.isArray(chargeIds) || !chargeIds.length) {
      throw new HttpException('No charges selected', 400);
    }
    if (chargeIds.some((id) => typeof id !== 'string' || !id.trim())) {
      throw new HttpException('Invalid charge id', 400);
    }
    if (!org.paymentId) {
      throw new HttpException(
        'This organization has no Stripe customer, so it has no charges to refund.',
        400
      );
    }

    const result = await this._stripeService.refundCharges(org.id, chargeIds);

    this._auditService.record({
      action: 'billing.refund',
      userId: user.id,
      organizationId: org.id,
      metadata: {
        requested: chargeIds.length,
        refunded: result.refunded,
        failed: result.failed,
      },
    });

    return result;
  }

  /**
   * Cancel an organization's subscription immediately.
   *
   * Distinct from revoke-subscription, which takes back a comp or a lifetime
   * grant and never touches Stripe. This one is for a paying customer who
   * wants out now.
   */
  @Post('/cancel-subscription')
  async cancelSubscriptionForOrg(
    @GetUserFromRequest() user: User,
    @Body('organizationId') organizationId: string
  ) {
    this.assertSuperAdmin(user);
    const org = await this.requireOrganization(organizationId);

    if (!org.paymentId) {
      throw new HttpException(
        'This organization has no Stripe customer. Use Revoke subscription for a comp or a lifetime grant.',
        400
      );
    }

    let result: { cancelled: boolean };
    try {
      result = await this._stripeService.cancelSubscription(org.id);
    } catch (e) {
      // The service throws plain Errors for "no customer" and "no active
      // subscription"; both are answers an operator needs to see, not 500s.
      throw new HttpException(
        e instanceof Error ? e.message : 'Could not cancel the subscription',
        400
      );
    }

    this._auditService.record({
      action: 'subscription.cancel',
      userId: user.id,
      organizationId: org.id,
      metadata: { organizationName: org.name },
    });

    return result;
  }

  /**
   * Erase a user on their behalf.
   *
   * The right to erasure had exactly one route: the customer clicking Delete
   * in their own settings. When the request arrives by email — which is how it
   * arrives — the operator had to impersonate the account and press the button
   * as them, which is both a worse audit record and a worse failure mode
   * (05-gaps §1c). Same engine as the self-serve path, including the S3 sweep
   * added in E2E-09-58, with Stripe cancelled first while the customer can
   * still be looked up.
   */
  @Post('/delete-user')
  async deleteUser(
    @GetUserFromRequest() user: User,
    @Body('userId') userId: string
  ) {
    this.assertSuperAdmin(user);
    if (!userId?.trim()) {
      throw new HttpException('Missing userId', 400);
    }
    if (userId === user.id) {
      throw new HttpException(
        'Delete your own account from Settings, not from here.',
        400
      );
    }

    const target = await this._prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (!target) {
      throw new HttpException('User not found', 400);
    }

    const soleOrgIds = await this._userService.getSoleOwnedOrganizations(
      userId
    );
    for (const organizationId of soleOrgIds) {
      await this._stripeService.cancelAllSubscriptionsForDeletedAccount(
        organizationId
      );
    }

    // Written before the delete: afterwards the id resolves to nobody, and an
    // audit row naming an account that no longer exists is the only record
    // there will ever be of this.
    this._auditService.record({
      action: 'admin.delete-user',
      userId: user.id,
      metadata: {
        targetUserId: userId,
        email: target.email,
        organizationsDeleted: soleOrgIds,
      },
    });

    await this._userService.deleteAccount(userId);

    return { deleted: true, organizationsDeleted: soleOrgIds.length };
  }

  /**
   * Delete one organization, leaving its members' accounts alone.
   *
   * Cascades take the integrations, posts and media rows with it; the objects
   * behind those media rows are removed here for the same reason they are
   * removed on account deletion — a deleted org's uploads stayed public on the
   * CDN (E2E-09-58).
   */
  @Post('/delete-organization')
  async deleteOrganization(
    @GetUserFromRequest() user: User,
    @Body('organizationId') organizationId: string
  ) {
    this.assertSuperAdmin(user);
    const org = await this.requireOrganization(organizationId);

    const members = await this._prisma.userOrganization.count({
      where: { organizationId: org.id },
    });

    await this._stripeService.cancelAllSubscriptionsForDeletedAccount(org.id);

    this._auditService.record({
      action: 'admin.delete-organization',
      userId: user.id,
      organizationId: org.id,
      metadata: { organizationName: org.name, members },
    });

    const result = await this._userService.deleteOrganization(org.id);

    return { deleted: true, ...result };
  }

  /**
   * Which providers put a channel under a scheduled refresh workflow.
   *
   * Read off the providers rather than listed here, so `refreshCron = true` on
   * a new provider is enough — today it is instagram-standalone, threads and
   * whop, and a list in a comment would be wrong the first time that changes.
   */
  private scheduledProviders(): string[] {
    return this._integrationManager
      .getAllowedSocialsIntegrations()
      .filter(
        (identifier) =>
          !!this._integrationManager.getSocialIntegration(identifier)
            ?.refreshCron
      );
  }

  /**
   * Every channel, with the state of its token — and none of its token.
   *
   * The one customer request out of six the panel still could not answer:
   * "my channel keeps disconnecting" (05-gaps §1e). The panel showed no token
   * state at all — not `tokenExpiration`, not `refreshNeeded`, not `disabled`
   * — so the only way to see it was running the refresh command over SSM, and
   * that output conflated a short-lived token with a dead one (E2E-09-59).
   *
   * ⛔ `token` and `refreshToken` are absent from the select, not selected and
   * then deleted. There is no code path here that could leak one by being
   * edited carelessly later, and `admin.integrations.spec.ts` asserts it on
   * the serialised response.
   */
  @Get('/integrations')
  async listIntegrations(
    @GetUserFromRequest() user: User,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('organizationId') organizationId?: string,
    @Query('provider') provider?: string,
    @Query('state') state?: string,
    @Query('search') search?: string,
    @Query('includeDeleted') includeDeleted?: string
  ) {
    this.assertSuperAdmin(user);
    const paging = parsePaging(page, limit);
    const now = new Date();
    const withDeleted = includeDeleted === 'true';

    if (state && !CHANNEL_STATES.includes(state as ChannelState)) {
      throw new HttpException(`Unknown state: ${state}`, 400);
    }

    const base: Record<string, unknown> = {
      ...(withDeleted ? {} : { deletedAt: null }),
      ...(organizationId ? { organizationId } : {}),
      ...(provider ? { providerIdentifier: provider } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              {
                organization: {
                  name: { contains: search, mode: 'insensitive' as const },
                },
              },
            ],
          }
        : {}),
    };

    // The state filter carries its own `deletedAt`, and two `OR` keys in one
    // object would overwrite each other — so the pieces are ANDed rather than
    // spread together.
    const where = {
      AND: [base, ...(state ? [channelStateWhere(state as ChannelState, now)] : [])],
    };

    const [rows, total, summary] = await Promise.all([
      this._prisma.integration.findMany({
        where,
        take: paging.limit,
        skip: paging.skip,
        // Worst first: a channel the customer is complaining about should not
        // be on page three.
        orderBy: [{ refreshNeeded: 'desc' }, { tokenExpiration: 'asc' }],
        select: {
          id: true,
          internalId: true,
          name: true,
          picture: true,
          providerIdentifier: true,
          profile: true,
          disabled: true,
          inBetweenSteps: true,
          refreshNeeded: true,
          tokenExpiration: true,
          grantedScopes: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
          customer: { select: { id: true, name: true } },
          organization: { select: { id: true, name: true } },
        },
      }),
      this._prisma.integration.count({ where }),
      this.channelSummary(base, now),
    ]);

    const scheduled = new Set(this.scheduledProviders());

    return {
      items: rows.map((row) => {
        const rowState = channelState(row, now.getTime());
        const isScheduled = scheduled.has(row.providerIdentifier);
        const socialProvider = (() => {
          try {
            return this._integrationManager.getSocialIntegration(
              row.providerIdentifier
            );
          } catch {
            return null;
          }
        })();

        return {
          id: row.id,
          internalId: row.internalId,
          name: row.name,
          picture: row.picture,
          provider: row.providerIdentifier,
          profile: row.profile,
          state: rowState,
          scheduled: isScheduled,
          actionable: isActionable(rowState, isScheduled),
          tokenExpiration: row.tokenExpiration,
          expiresInSeconds: expiresInSeconds(row.tokenExpiration, now.getTime()),
          // null means the column predates this channel, which is not the same
          // as a platform that granted nothing — the difference decides
          // whether a reconnect would actually help (05-gaps §8.1).
          grantedScopes: row.grantedScopes ? grantedScopesOf(row) : null,
          commentScope: socialProvider?.commentScope ?? null,
          commentCapable: canPostComments(socialProvider, row),
          customer: row.customer,
          organization: row.organization,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          deletedAt: row.deletedAt,
        };
      }),
      total,
      page: paging.page,
      limit: paging.limit,
      hasMore: paging.skip + rows.length < total,
      summary,
    };
  }

  /**
   * The headline counts, over the whole filtered set rather than the page.
   *
   * Counting the page is how a header ends up saying "3 need a reconnect"
   * while page two holds a fourth — the same class of mistake as the scrub
   * report and the refresh counter, both of which summarised the part they
   * happened to be holding.
   */
  private async channelSummary(
    base: Record<string, unknown>,
    now: Date
  ): Promise<Record<string, number>> {
    const notScheduled = notScheduledWhere(this.scheduledProviders());

    const counts = await Promise.all(
      CHANNEL_STATES.map((state) =>
        this._prisma.integration.count({
          where: { AND: [base, channelStateWhere(state, now)] },
        })
      )
    );

    const byState = CHANNEL_STATES.reduce<Record<string, number>>(
      (all, state, index) => ({ ...all, [state]: counts[index] }),
      {}
    );

    // The only count an operator should act on, and the one the CLI prints:
    // a reconnect, an unfinished setup, or a token already dead on a channel
    // no workflow is watching.
    const expiredUnwatched = await this._prisma.integration.count({
      where: {
        AND: [base, channelStateWhere('expired', now), notScheduled],
      },
    });

    return {
      ...byState,
      actionable:
        byState['needs-reconnect'] +
        byState['setup-incomplete'] +
        expiredUnwatched,
      expiredUnwatched,
    };
  }

  /** The providers actually connected, so the filter cannot offer an empty result. */
  @Get('/integrations/providers')
  async listIntegrationProviders(@GetUserFromRequest() user: User) {
    this.assertSuperAdmin(user);
    const rows = await this._prisma.integration.groupBy({
      by: ['providerIdentifier'],
      _count: { _all: true },
      orderBy: { providerIdentifier: 'asc' },
    });

    const scheduled = new Set(this.scheduledProviders());

    return rows.map((row) => ({
      provider: row.providerIdentifier,
      channels: row._count._all,
      scheduled: scheduled.has(row.providerIdentifier),
    }));
  }

}
