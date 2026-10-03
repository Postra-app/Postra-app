// Whether the viewer's plan includes Auto Post and how many RSS feeds are
// left. The backend enforces the same (permissions.service, Sections.AUTOPOST);
// this only lets the page say so before anyone fills in the form.
export interface AutopostTier {
  autoPost?: boolean;
  autoPostLimit?: number;
}

export const autopostAccess = (tier: AutopostTier | undefined, used: number) => {
  const limit = tier?.autoPost ? tier.autoPostLimit ?? 0 : 0;
  return {
    included: limit > 0,
    limit,
    used,
    atLimit: limit > 0 && used >= limit,
  };
};
