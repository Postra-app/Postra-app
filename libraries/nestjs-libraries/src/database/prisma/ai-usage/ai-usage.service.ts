import { Injectable } from '@nestjs/common';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import {
  AiUsageEvent,
  setAiUsageSink,
} from '@gitroom/nestjs-libraries/services/ai-usage.record';

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

  // Weighted agent usage since `from`: input + 6×output — the same unit as the
  // pricing.agent_tokens budget (gpt-5.5 output costs 6× input).
  async weightedAgentUsageSince(organizationId: string, from: Date) {
    const sum = await this._prisma.aiUsage.aggregate({
      where: {
        organizationId,
        engine: 'agent',
        unit: 'tokens',
        createdAt: { gte: from },
      },
      _sum: { inputAmount: true, outputAmount: true },
    });
    return (sum._sum.inputAmount ?? 0) + 6 * (sum._sum.outputAmount ?? 0);
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
