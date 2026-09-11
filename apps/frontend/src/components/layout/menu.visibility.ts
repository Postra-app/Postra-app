/**
 * Which menu entries a given session may see.
 *
 * There were three copies of this rule — two in the desktop menu, one in the
 * mobile drawer — and the drawer's copy had drifted: it never checked
 * `superAdminOnly`, so "Admin" sat in the menu of every signed-in user, FREE
 * accounts included, and stayed there while an admin was impersonating, which
 * is precisely what the desktop menu hides. Tapping it only ever answered "You
 * do not have access", so it advertised a panel rather than opening one
 * (E2E-09-05). It also compared the entry's *translated* name against the
 * literal 'Billing', a check the desktop copies had already fixed by comparing
 * the path instead.
 *
 * One rule, in one place, so a fix cannot land on two of three again.
 */

export interface MenuEntry {
  hide?: boolean;
  requireBilling?: boolean;
  superAdminOnly?: boolean;
  role?: string[];
  path?: string;
}

export interface MenuViewer {
  isSuperAdmin?: boolean;
  impersonate?: boolean;
  isLifetime?: boolean;
  role?: string;
}

export const canSeeMenuEntry = (
  entry: MenuEntry,
  viewer: MenuViewer | undefined,
  billingEnabled: boolean
): boolean => {
  if (entry.hide) {
    return false;
  }

  // Impersonation leaves the admin able to step back out, but the point of it
  // is to see the app as the customer does — so the admin-only entries go.
  if (entry.superAdminOnly && (!viewer?.isSuperAdmin || viewer?.impersonate)) {
    return false;
  }

  if (entry.requireBilling && !billingEnabled) {
    return false;
  }

  // By path, never by name: the name is translated, so a name check silently
  // stops working outside the English locale.
  if (entry.path === '/billing' && viewer?.isLifetime) {
    return false;
  }

  if (entry.role) {
    return entry.role.includes(viewer?.role!);
  }

  return true;
};
