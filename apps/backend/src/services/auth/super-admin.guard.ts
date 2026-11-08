import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

// The admin panel is for Postra staff (User.isSuperAdmin), not for the owner
// of an organisation. Put on a whole controller, a route added later is
// refused by default instead of relying on its own check (each admin method
// still makes it too). An admin whose two-factor step is pending reaches the
// API with isSuperAdmin off (auth.middleware), so this refuses them as well.
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest()?.user;
    if (!user?.isSuperAdmin) {
      throw new ForbiddenException('Only Postra administrators can do this');
    }
    return true;
  }
}
