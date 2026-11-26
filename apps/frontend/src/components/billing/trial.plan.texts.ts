// Billing during the free trial: what the buttons and the cancel question say.

// The app's translate function (i18next's TFunction is wider than this).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Translate = (key: string, text: string) => any;

const day = (at: number) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(at));

// Cancelling a trial ends nothing today: it runs to its last day and no
// payment is taken, with a card or without.
export const cancelTrialQuestion = (endsAt?: number) =>
  endsAt
    ? `Cancel your free trial? It stays until ${day(endsAt)} and nothing is charged.`
    : 'Cancel your free trial? It stays until its last day and nothing is charged.';

// Another plan's button during the trial changes the plan being tried and
// takes no payment; outside a trial it buys the plan.
export const planButtonLabel = (onTrial: boolean, t: Translate): string =>
  onTrial
    ? t('switch_to_this_plan', 'Switch to this plan')
    : t('purchase', 'Purchase plan');
