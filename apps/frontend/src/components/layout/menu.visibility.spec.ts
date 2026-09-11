import { canSeeMenuEntry } from '@gitroom/frontend/components/layout/menu.visibility';

// E2E-09-05: the mobile drawer never checked superAdminOnly, so "Admin" was in
// the menu of every signed-in user — FREE accounts included — and stayed there
// while an admin was impersonating, which is the opposite of what the desktop
// menu does. The rule existed in three copies and the drawer's had drifted.

const admin = { path: '/admin', superAdminOnly: true };
const billing = { path: '/billing', requireBilling: true };
const posts = { path: '/launches' };

const superAdmin = { isSuperAdmin: true, role: 'SUPERADMIN' };
const customer = { isSuperAdmin: false, role: 'ADMIN' };

describe('the admin entry', () => {
  it('is hidden from an ordinary user', () => {
    expect(canSeeMenuEntry(admin, customer, true)).toBe(false);
  });

  it('is shown to a superadmin', () => {
    expect(canSeeMenuEntry(admin, superAdmin, true)).toBe(true);
  });

  it('is hidden while that superadmin is impersonating', () => {
    expect(
      canSeeMenuEntry(admin, { ...superAdmin, impersonate: true }, true)
    ).toBe(false);
  });

  it('is hidden from a session with no user at all', () => {
    expect(canSeeMenuEntry(admin, undefined, true)).toBe(false);
  });
});

describe('the billing entry', () => {
  it('goes away for a lifetime account', () => {
    expect(
      canSeeMenuEntry(billing, { ...customer, isLifetime: true }, true)
    ).toBe(false);
  });

  it('is matched by path, so a translated name cannot break it', () => {
    // The drawer used to compare the rendered name against 'Billing'.
    expect(
      canSeeMenuEntry(
        { path: '/billing' },
        { ...customer, isLifetime: true },
        true
      )
    ).toBe(false);
  });

  it('goes away when billing is switched off entirely', () => {
    expect(canSeeMenuEntry(billing, customer, false)).toBe(false);
  });
});

describe('the ordinary rules', () => {
  it('respects an explicit hide', () => {
    expect(canSeeMenuEntry({ ...posts, hide: true }, superAdmin, true)).toBe(
      false
    );
  });

  it('respects a role list', () => {
    expect(
      canSeeMenuEntry({ ...posts, role: ['SUPERADMIN'] }, customer, true)
    ).toBe(false);
    expect(
      canSeeMenuEntry({ ...posts, role: ['ADMIN'] }, customer, true)
    ).toBe(true);
  });

  it('shows a plain entry to anyone signed in', () => {
    expect(canSeeMenuEntry(posts, customer, true)).toBe(true);
  });
});
