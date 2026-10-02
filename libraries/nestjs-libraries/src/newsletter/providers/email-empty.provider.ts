import { Logger } from '@nestjs/common';
import { NewsletterInterface } from '@gitroom/nestjs-libraries/newsletter/newsletter.interface';

export class EmailEmptyProvider implements NewsletterInterface {
  private readonly _logger = new Logger(EmailEmptyProvider.name);
  name = 'empty';
  async register(_email: string) {
    this._logger.debug('No newsletter provider configured, skipping sign-up');
  }
}
