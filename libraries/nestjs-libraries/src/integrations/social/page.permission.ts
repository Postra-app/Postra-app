// A Facebook Page the login can see but not manage (reached through a
// business the user has no role on) comes back without a page token. Said to
// the customer as it is, so the page-choice route answers 400 with it
// instead of a bare 500.
export const NO_PAGE_PERMISSION =
  'Your Facebook user has no permission to manage this page. Ask a page admin for full content access, then reconnect the channel';
