import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { APIConnectionError, InternalServerError, RateLimitError } from 'openai';
import { AI_OUTAGE_ERRORS } from '@gitroom/nestjs-libraries/openai/ai-outage';

export const AI_UNAVAILABLE = 'AI is unavailable right now. Please try again in a few minutes.';

// OpenAI down, overloaded or out of quota, after the SDK's own retries. Without
// this the user got "Internal server error" and nothing to act on. A refused
// prompt (400) is not an outage and keeps its own handling.
@Catch(...AI_OUTAGE_ERRORS)
export class AiUnavailableExceptionFilter implements ExceptionFilter {
  catch(exception: InternalServerError | RateLimitError | APIConnectionError, host: ArgumentsHost) {
    Logger.warn(`OpenAI unavailable: ${exception.constructor.name} ${exception.status ?? ''} ${exception.message}`);
    host.switchToHttp().getResponse().status(503).json({ statusCode: 503, message: AI_UNAVAILABLE });
  }
}
