import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';

@Injectable()
@Activity()
export class EmailActivity {
  constructor(
    private _emailService: EmailService,
    private _organizationService: OrganizationService
  ) {}

  @ActivityMethod()
  async sendEmail(to: string, subject: string, html: string, replyTo?: string) {
    const outcome = await this._emailService.deliver(
      to,
      subject,
      html,
      replyTo
    );
    // The mail has already left the queue (send.email.workflow). Answering
    // "done" for one the provider could not take right now dropped it: an
    // outage of the mail provider longer than the ~1.4 s of tries in
    // EmailService lost every notification queued in that time. Failing the
    // activity has Temporal try it again later; a mail the provider refused
    // for good is not retried.
    if (!outcome.sent && outcome.transient) {
      throw new Error('The mail provider is unavailable');
    }
    return outcome.sent;
  }

  @ActivityMethod()
  async sendEmailAsync(
    to: string,
    subject: string,
    html: string,
    sendTo: 'top' | 'bottom',
    replyTo?: string
  ) {
    return await this._emailService.sendEmail(
      to,
      subject,
      html,
      sendTo,
      replyTo
    );
  }

  @ActivityMethod()
  async getUserOrgs(id: string) {
    // The digest goes to the same people as every other mail of the
    // organisation: not to disabled seats or suspended accounts.
    return this._organizationService.getMailRecipients(id);
  }

  @ActivityMethod()
  async setStreak(organizationId: string, type: 'start' | 'end') {
    return this._organizationService.setStreak(organizationId, type);
  }

  @ActivityMethod()
  async getLastPublishDate(organizationId: string) {
    return this._organizationService.getLastPublishDate(organizationId);
  }
}
