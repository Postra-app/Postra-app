import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common';
import { Response } from 'express';
import { NotEnoughScopes } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { HttpStatusCode } from 'axios';

@Catch(NotEnoughScopes)
export class NotEnoughScopesFilter implements ExceptionFilter {
  catch(exception: NotEnoughScopes, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    response
      .status(HttpStatusCode.Conflict)
      // `code` lets a client put the sentence in its own words and language.
      .json({ msg: exception.message, code: 'not_enough_scopes' });
  }
}
