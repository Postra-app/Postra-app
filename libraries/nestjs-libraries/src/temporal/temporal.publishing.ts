// Shared by the publishing activities (temporal.heartbeat.ts) and the post
// workflow (post.workflow.v1.0.9.ts), which may not import @temporalio/activity.
// Heartbeat details starting with this mean the platform may have the post.
export const PUBLISHING_PREFIX = 'publish:';
