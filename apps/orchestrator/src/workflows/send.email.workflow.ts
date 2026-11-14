import {
  log,
  proxyActivities,
  setHandler,
  condition,
  sleep,
  continueAsNew,
} from '@temporalio/workflow';
import { EmailActivity } from '@gitroom/orchestrator/activities/email.activity';
import {
  SendEmail,
  sendEmailSignal,
} from '@gitroom/orchestrator/signals/send.email.signal';

// sendEmail fails only when the mail provider cannot be reached
// (email.activity): tried again after 30 s, 1, 2, 4, 8 and 16 minutes, about
// half an hour in all, then given up on and logged below. The mails behind
// it wait meanwhile, which is right: they would fail the same way.
const { sendEmail } = proxyActivities<EmailActivity>({
  startToCloseTimeout: '10 minute',
  taskQueue: 'main',
  cancellationType: 'ABANDON',
  retry: {
    initialInterval: '30 seconds',
    backoffCoefficient: 2,
    maximumAttempts: 7,
  },
});

const RATE_LIMIT_MS = 700;

export async function sendEmailWorkflow({
  queue = [],
}: {
  queue: SendEmail[];
}) {
  let processedThisRun = 0;
  // Handle incoming email signals
  setHandler(sendEmailSignal, (addEmail: SendEmail) => {
    if (addEmail.to && addEmail.subject) {
      if (addEmail.addTo === 'top') {
        queue.unshift(addEmail);
      } else {
        queue.push(addEmail);
      }
    }
  });

  // Process emails with rate limiting
  while (true) {
    // Wait until there's an email in the queue or timeout after 1 hour of inactivity
    await condition(() => queue.length > 0);

    try {
      const email = queue.shift()!;
      if (!email) {
        continue;
      }
      await sendEmail(email.to, email.subject, email.html, email.replyTo);
      processedThisRun++;
    } catch (err) {
      log.error('sendEmail activity failed', {
        error: (err as Error)?.message,
      });
    }

    await sleep(RATE_LIMIT_MS);

    if (processedThisRun >= 30) {
      return await continueAsNew({ queue });
    }
  }
}
