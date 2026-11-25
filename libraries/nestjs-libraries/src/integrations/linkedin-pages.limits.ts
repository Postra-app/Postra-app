// LinkedIn Pages run on LinkedIn's Community Management Development Tier,
// which allows the whole app 500 API calls a day and each member 100. A post
// with a picture costs 3-4 calls, so Pages are offered in early access within
// limits that keep every customer inside that budget: a cap on Pages across
// Postra, a cap per workspace, and one post a day on each Page.

export const LINKEDIN_PAGE = 'linkedin-page';

/** Pages connected across every workspace. */
export const LINKEDIN_PAGES_TOTAL = 100;

/** Pages one workspace may connect. */
export const LINKEDIN_PAGES_PER_WORKSPACE = 5;

/** Posts (not comments) one Page may publish on a calendar day, UTC. */
export const LINKEDIN_PAGE_POSTS_PER_DAY = 1;

/**
 * Whether the day's post limit holds for a workspace. It does for every
 * workspace except those named in LINKEDIN_PAGES_UNLIMITED_ORGANIZATIONS
 * (comma-separated ids), which a deployment sets for workspaces of its own
 * that need more than one post a day on a Page; their posts still count
 * against the app's API budget. The other limits (Pages per workspace, no
 * repeating posts) hold for everyone.
 */
export const linkedinPageDailyLimitApplies = (orgId: string) =>
  !orgId ||
  !(process.env.LINKEDIN_PAGES_UNLIMITED_ORGANIZATIONS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(orgId);

export const LINKEDIN_PAGES_LIMITS_MESSAGE =
  'LinkedIn Pages are in early access: one post a day per Page, up to 5 Pages per workspace.';

export const LINKEDIN_PAGES_NO_REPEAT_MESSAGE =
  'Repeating posts are not available for LinkedIn Pages during early access.';

export const LINKEDIN_PAGES_FULL_MESSAGE =
  'LinkedIn Pages are in early access and all places are taken for now. Please try again later.';

/**
 * Why a new Page may not be connected, or null when it may. `inWorkspace` and
 * `total` count the Pages already connected (deleted ones excluded).
 */
export const linkedinPageConnectRefusal = (
  inWorkspace: number,
  total: number
): string | null => {
  if (inWorkspace >= LINKEDIN_PAGES_PER_WORKSPACE) {
    return LINKEDIN_PAGES_LIMITS_MESSAGE;
  }
  if (total >= LINKEDIN_PAGES_TOTAL) {
    return LINKEDIN_PAGES_FULL_MESSAGE;
  }
  return null;
};

/** The UTC calendar day a post goes out on, as [start, end). */
export const linkedinPageDay = (date: Date): [Date, Date] => {
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  return [start, new Date(start.getTime() + 24 * 60 * 60 * 1000)];
};

/**
 * A refusal that only tells the customer about a limit of their plan or of
 * early access. The app shows it as it is, not as "Could not save: ...".
 */
export const isLinkedinPagesNotice = (message: unknown): message is string =>
  message === LINKEDIN_PAGES_LIMITS_MESSAGE ||
  message === LINKEDIN_PAGES_FULL_MESSAGE ||
  message === LINKEDIN_PAGES_NO_REPEAT_MESSAGE;
