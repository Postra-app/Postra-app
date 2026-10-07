import { Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { EmailInterface } from '@gitroom/nestjs-libraries/emails/email.interface';
import { htmlToText } from '@gitroom/helpers/utils/html.to.text';

const resend = new Resend(process.env.RESEND_API_KEY || 're_132');

export class ResendProvider implements EmailInterface {
  private readonly _logger = new Logger(ResendProvider.name);
  name = 'resend';
  validateEnvKeys = ['RESEND_API_KEY'];
  async sendEmail(
    to: string,
    subject: string,
    html: string,
    emailFromName: string,
    emailFromAddress: string,
    replyTo?: string
  ) {
    try {
      const sends = await resend.emails.send({
        from: `${emailFromName} <${emailFromAddress}>`,
        to,
        subject,
        html,
        text: htmlToText(html),
        ...(replyTo && { replyTo }),
      });

      return sends;
    } catch (err) {
      this._logger.error(
        `Resend send failed: ${(err as Error)?.message ?? err}`
      );
    }

    return { sent: false };
  }
}
