import { Controller, Get, HttpException, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

// Long enough for a busy database, short enough that the deploy gate and
// Upptime get an answer instead of a hung request.
const CHECK_TIMEOUT_MS = 3000;

const check = async (work: () => Promise<unknown>) => {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
      }),
    ]);
    return 'ok';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
};

@ApiTags('Monitor')
@Controller('/monitor')
export class MonitorController {
  constructor(private _prisma: PrismaService) {}

  /**
   * The deploy gate and Upptime both read this. It used to answer "healthy"
   * without checking anything, so a deploy passed as long as NestJS served a
   * request, with the database or Redis gone (E2E-01-07).
   *
   * The timeout matters for Redis: its client retries forever
   * (`maxRetriesPerRequest: null`), so a dead Redis would otherwise hang this
   * request instead of failing it.
   */
  @Get('/queue/:name')
  async getMessagesGroup(@Param('name') name: string) {
    const [database, redis] = await Promise.all([
      check(() => this._prisma.$queryRaw`SELECT 1`),
      check(() => ioRedis.ping()),
    ]);
    const checks = { database, redis };

    if (database !== 'ok' || redis !== 'ok') {
      throw new HttpException(
        { status: 'error', message: `Queue ${name} is unhealthy.`, checks },
        503
      );
    }

    return {
      status: 'success',
      message: `Queue ${name} is healthy.`,
      checks,
    };
  }
}
