import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

// LinkedIn Pages run on the Community Management Development Tier: 500 API
// calls a day for the whole app, reset at midnight UTC. Nothing showed how
// much of it a day had used until LinkedIn refused calls. Every call the
// LinkedIn Page provider makes to api.linkedin.com is counted here, in Redis,
// so the backend and the orchestrator on every instance add to one number;
// /metrics reports it, for an alert at 75 % of the budget.

/** API calls the app may make in a UTC day on Development Tier. */
export const LINKEDIN_PAGES_DAILY_CALLS = 500;

export const LINKEDIN_PAGE_CALLS_METRIC = 'postra_linkedin_page_api_calls_today';

const KEEP_SECONDS = 3 * 24 * 60 * 60;

export const linkedinPageCallsKey = (now: Date) =>
  `linkedin-page:api-calls:${now.toISOString().slice(0, 10)}`;

/** Whether a request goes to LinkedIn's API, the host the daily budget counts. */
export const isLinkedinApiCall = (url: unknown) => {
  try {
    const href =
      typeof url === 'string'
        ? url
        : url instanceof URL
          ? url.href
          : (url as { url?: string })?.url;
    return new URL(String(href)).host === 'api.linkedin.com';
  } catch {
    return false;
  }
};

// Observational: a counter must never be why a post fails.
export const countLinkedinPageCall = async (now: Date = new Date()) => {
  try {
    const key = linkedinPageCallsKey(now);
    const calls = await ioRedis.incr(key);
    if (calls === 1) {
      await ioRedis.expire(key, KEEP_SECONDS);
    }
  } catch {
    /* never break the call */
  }
};

export const linkedinPageCallsToday = async (now: Date = new Date()) => {
  const value = Number(await ioRedis.get(linkedinPageCallsKey(now)));
  return Number.isFinite(value) ? value : 0;
};
