import { Mastra } from '@mastra/core/mastra';
import { ConsoleLogger } from '@mastra/core/logger';
import { pStore } from '@gitroom/nestjs-libraries/chat/mastra.store';
import { Injectable, Logger } from '@nestjs/common';
import { LoadToolsService } from '@gitroom/nestjs-libraries/chat/load.tools.service';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

// Mastra's Postgres observability store owns `mastra_ai_spans`, whose physical
// column count creeps up over time. Postgres caps a table at 1600 columns and
// keeps counting dropped columns until the table is rewritten, so the table
// eventually trips the limit — and PostgresStore.init then throws on startup,
// crash-looping the whole backend (outages 2026-05-31 and 2026-07-04). The
// spans are telemetry we don't consume, so before Mastra initialises we drop
// the table if it is nearing the limit and let Mastra recreate it fresh.
const SPANS_TABLE = 'mastra_ai_spans';
const RESOURCES_TABLE = 'mastra_resources';
const SPANS_COLUMN_HARD_LIMIT = 1600; // Postgres hard cap per table
const SPANS_COLUMN_RESET_AT = 1000; // reset with generous headroom below the cap

@Injectable()
export class MastraService {
  static mastra: Mastra;
  private readonly _logger = new Logger(MastraService.name);

  constructor(
    private _loadToolsService: LoadToolsService,
    private _prisma: PrismaService
  ) {}

  async mastra() {
    if (!MastraService.mastra) {
      // Must run before anything touches pStore (the agent below also uses it).
      await this.resetObservabilityTableIfBloated();
      await this.clearLegacyWorkingMemory();

      MastraService.mastra = new Mastra({
        storage: pStore,
        agents: {
          postra: await this._loadToolsService.agent(),
        },
        logger: new ConsoleLogger({
          level: 'info',
        }),
      });
    }

    return MastraService.mastra;
  }

  /**
   * The agent's working memory used to be the Mastra starter's schema, whose
   * only field was `proverbs`, and the model used it as a scratchpad for real
   * data. Those rows would otherwise keep being read back into every prompt
   * under a field that no longer exists. Working memory is a convenience, not
   * user data, so the stale shape is simply cleared once.
   */
  private async clearLegacyWorkingMemory() {
    try {
      const cleared = await this._prisma.$executeRawUnsafe(
        `UPDATE ${RESOURCES_TABLE}
            SET "workingMemory" = NULL
          WHERE "workingMemory" LIKE '%"proverbs"%'`
      );
      if (cleared) {
        this._logger.log(
          `Cleared ${cleared} working-memory row(s) still holding the old proverbs schema.`
        );
      }
    } catch (err) {
      // The table may not exist yet on a fresh database - that is fine.
      this._logger.debug(
        `Skipped working-memory cleanup: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  // Drop the unused telemetry spans table before Mastra initialises it if it has
  // bloated toward Postgres's 1600-column limit. Best-effort: any failure here
  // must never block Mastra from starting.
  private async resetObservabilityTableIfBloated() {
    try {
      // pg_attribute counts dropped columns too — that is exactly what accrues
      // toward the 1600 limit, so this is the number that actually matters.
      const rows = await this._prisma.$queryRawUnsafe<Array<{ columns: number }>>(
        `SELECT count(*)::int AS columns
           FROM pg_attribute
          WHERE attrelid = to_regclass($1) AND attnum > 0`,
        SPANS_TABLE
      );

      const columns = rows?.[0]?.columns ?? 0;
      if (columns >= SPANS_COLUMN_RESET_AT) {
        this._logger.warn(
          `${SPANS_TABLE} has ${columns}/${SPANS_COLUMN_HARD_LIMIT} columns — dropping this unused telemetry table before Mastra init to avoid a startup crash-loop.`
        );
        await this._prisma.$executeRawUnsafe(
          `DROP TABLE IF EXISTS ${SPANS_TABLE} CASCADE`
        );
      }
    } catch (err) {
      this._logger.error(
        `Could not check/reset ${SPANS_TABLE}; continuing with Mastra init.`,
        err instanceof Error ? err.stack : String(err)
      );
    }
  }
}
