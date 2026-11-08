import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SuperAdminGuard } from './super-admin.guard';

const contextFor = (user: unknown) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as any;

describe('SuperAdminGuard', () => {
  const guard = new SuperAdminGuard();
  it('lets Postra staff through', () => {
    expect(guard.canActivate(contextFor({ id: 'u', isSuperAdmin: true }))).toBe(true);
  });
  it('refuses an organisation owner, a pending two-factor admin and no user with 403', () => {
    for (const user of [{ id: 'u', isSuperAdmin: false }, { id: 'u', isSuperAdmin: false, adminMfaPending: true }, undefined]) {
      expect(() => guard.canActivate(contextFor(user))).toThrow(ForbiddenException);
    }
  });
});

// Every route of the admin controller sits behind the guard, including
// routes added after this test was written.
describe('the admin controller', () => {
  it('is guarded as a whole', () => {
    jest.isolateModules(() => {
      // Loaded lazily: the controller pulls in the app's services.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { AdminController } = require('@gitroom/backend/api/routes/admin.controller');
      const guards = (Reflect.getMetadata(GUARDS_METADATA, AdminController) ?? []) as { name: string }[];
      expect(guards.map((g) => g.name)).toContain('SuperAdminGuard');
    });
  });
});
