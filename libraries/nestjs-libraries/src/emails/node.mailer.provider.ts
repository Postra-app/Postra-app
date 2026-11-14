import nodemailer from 'nodemailer';
import { EmailInterface } from '@gitroom/nestjs-libraries/emails/email.interface';
import { htmlToText } from '@gitroom/helpers/utils/html.to.text';

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: +process.env.EMAIL_PORT!,
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  // nodemailer waits 2 minutes for a connection and 10 for a silent socket by
  // default. Activation and password-reset mails are sent inside the request
  // (auth.service), three tries each: a mail server that stopped answering
  // held those requests for minutes.
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 30000,
});

export class NodeMailerProvider implements EmailInterface {
  name = 'nodemailer';
  validateEnvKeys = [
    'EMAIL_HOST',
    'EMAIL_PORT',
    'EMAIL_SECURE',
    'EMAIL_USER',
    'EMAIL_PASS',
  ];
  async sendEmail(
    to: string,
    subject: string,
    html: string,
    emailFromName: string,
    emailFromAddress: string,
    replyTo?: string
  ) {
    const sends = await transporter.sendMail({
      from: `${emailFromName} <${emailFromAddress}>`, // sender address
      to: to, // list of receivers
      // Without this, replying to an operator notification goes to
      // EMAIL_FROM_ADDRESS (no-reply@, on the SES suppression list) instead of
      // to the customer the notification is about.
      ...(replyTo && { replyTo }),
      subject: subject, // Subject line
      // Never the markup itself: whatever prefers text/plain (the SES inbound
      // forwarder, notification previews, text-only clients) would render the
      // raw HTML source, and a plain part that mismatches the html one scores
      // as spam.
      text: htmlToText(html), // plain text body
      html: html, // html body
    });

    return sends;
  }
}
