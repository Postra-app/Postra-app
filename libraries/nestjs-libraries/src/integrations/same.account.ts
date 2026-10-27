// One Instagram account can be connected two ways: through a Facebook Page
// (`instagram`) or with Instagram login (`instagram-standalone`). Both report
// the same Instagram account id, and a channel is unique per provider
// (schema.prisma `@@unique([organizationId, providerIdentifier, internalId])`),
// so the same account could become two channels: every post went out twice
// and the account took two of the plan's channels.
export const SAME_ACCOUNT_PROVIDERS: Record<string, string[]> = {
  instagram: ['instagram-standalone'],
  'instagram-standalone': ['instagram'],
};

// The platform an identifier belongs to, for counting platforms rather than
// tiles: both Instagram logins are Instagram.
export const platformOf = (identifier: string) =>
  identifier === 'instagram-standalone' ? 'instagram' : identifier;

// What the customer reads when the account is already a channel the other
// way. `existing` is the provider of the channel they already have.
export const sameAccountMessage = (existing: string) =>
  existing === 'instagram-standalone'
    ? 'This Instagram account is already connected in Postra without a Facebook Page. Keep using that channel, or remove it first to connect the account through your Facebook Page.'
    : 'This Instagram account is already connected in Postra through a Facebook Page. Keep using that channel, or remove it first to connect the account without a Facebook Page.';
