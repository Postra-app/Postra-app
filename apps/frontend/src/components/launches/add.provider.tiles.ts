// Which platform tiles the Add Channel window shows, and in what order.
//
// Customers see only the platforms they can connect: a grey "Soon" tile read
// as a promise. A super admin sees every tile, "Soon" ones included, to test
// a platform before it is offered. A preview organisation (the login a
// platform's reviewer signs in with, PREVIEW_ORGANIZATIONS) sees the offered
// platforms plus the preview ones it may connect, and no other "Soon" tile.
// Platforms outside the customer's plan stay: they work, and a click offers
// the upgrade.
export interface ProviderTile {
  identifier: string;
  enabled?: boolean;
  preview?: boolean;
  adminOnly?: boolean;
}

export interface TileViewer {
  isSuperAdmin?: boolean;
  // A super admin's or a preview organisation's (users.controller /self).
  previewChannels?: boolean;
}

export const visibleProviderTiles = <T extends ProviderTile>(
  social: T[],
  viewer: TileViewer | undefined,
  invite?: boolean
): T[] => {
  const superAdmin = !!viewer?.isSuperAdmin;
  const preview = !!viewer?.previewChannels;
  return social
    .filter((item) => !item.adminOnly || preview)
    .filter(
      (item) =>
        item.enabled !== false ||
        superAdmin ||
        (!!item.preview && preview && !invite)
    )
    .sort(
      (a, b) => (b.enabled !== false ? 1 : 0) - (a.enabled !== false ? 1 : 0)
    );
};
