import { Injectable } from '@nestjs/common';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import {
  AiUsageEvent,
  setAiUsageSink,
} from '@gitroom/nestjs-libraries/services/ai-usage.record';

import {
  costOfUsage,
  marginReport,
  marginSettings,
  UsageRow,
} from '@gitroom/nestjs-libraries/ai-cost/ai-cost';

@Injectable()
export class AiUsageService {
  constructor(private _prisma: PrismaService) {
    // Plug the module-level recorder into Prisma. Fire-and-forget: metering
    // must never slow down or fail an AI call.
    setAiUsageSink((event: AiUsageEvent) => {
      this._prisma.aiUsage
        .create({
          data: {
            organizationId: event.organizationId ?? null,
            engine: event.engine,
            model: event.model,
            unit: event.unit ?? 'tokens',
            inputAmount: Math.max(0, Math.round(event.inputAmount ?? 0)),
            outputAmount: Math.max(0, Math.round(event.outputAmount ?? 0)),
            cachedAmount: Math.max(0, Math.round(event.cachedAmount ?? 0)),
          },
        })
        .catch(() => {});
    });
  }

  // Questions asked to the assistant since `from` — the unit of its monthly
  // fair use (pricing.agent_messages).
  async agentMessagesSince(organizationId: string, from: Date) {
    // A row can count several questions (an MCP batch).
    const sum = await this._prisma.aiUsage.aggregate({
      where: {
        organizationId,
        engine: 'agent',
        unit: 'messages',
        createdAt: { gte: from },
      },
      _sum: { inputAmount: true },
    });
    return sum._sum.inputAmount ?? 0;
  }

  // The margin guard: each paying organisation's AI cost over the last 30
  // days against its plan price (ai-cost.ts).
  async marginReport(days = 30) {
    const from = new Date(Date.now() - days * 86_400_000);
    const rows = await this._prisma.aiUsage.groupBy({
      by: ['organizationId', 'model', 'unit'],
      where: { createdAt: { gte: from }, organizationId: { not: null } },
      _sum: { inputAmount: true, cachedAmount: true, outputAmount: true },
    });
    const byOrg: Record<string, UsageRow[]> = {};
    for (const r of rows) {
      (byOrg[r.organizationId!] ||= []).push({
        model: r.model,
        unit: r.unit,
        inputAmount: r._sum.inputAmount,
        cachedAmount: r._sum.cachedAmount,
        outputAmount: r._sum.outputAmount,
      });
    }
    const unknownModels = new Set<string>();
    const costUsdByOrg: Record<string, number> = {};
    for (const [org, usage] of Object.entries(byOrg)) {
      const cost = costOfUsage(usage);
      costUsdByOrg[org] = cost.usd;
      cost.unknownModels.forEach((m) => unknownModels.add(m));
    }
    const subscriptions = await this._prisma.subscription.findMany({
      where: { deletedAt: null, organizationId: { in: Object.keys(byOrg) } },
      select: {
        subscriptionTier: true,
        period: true,
        isLifetime: true,
        organization: { select: { id: true, name: true, isTrailing: true } },
      },
    });
    const settings = marginSettings();
    return {
      days,
      ...settings,
      unknownModels: [...unknownModels],
      organizations: marginReport(
        subscriptions.map((s) => ({
          id: s.organization.id,
          name: s.organization.name,
          tier: s.subscriptionTier,
          period: s.period,
          isLifetime: s.isLifetime,
          isTrailing: !!s.organization.isTrailing,
        })),
        costUsdByOrg,
        settings
      ),
    };
  }

  summary(from: Date, to: Date) {
    return Promise.all([
      this._prisma.aiUsage.groupBy({
        by: ['engine', 'model', 'unit'],
        where: { createdAt: { gte: from, lte: to } },
        _sum: { inputAmount: true, outputAmount: true, cachedAmount: true },
        _count: { _all: true },
      }),
      this._prisma.aiUsage.groupBy({
        by: ['organizationId'],
        where: { createdAt: { gte: from, lte: to }, unit: 'tokens' },
        _sum: { inputAmount: true, outputAmount: true },
        orderBy: [{ _sum: { outputAmount: 'desc' } }],
        take: 10,
      }),
    ]);
  }
}
