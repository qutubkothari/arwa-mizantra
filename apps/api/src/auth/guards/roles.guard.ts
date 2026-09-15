import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    
    if (!user) {
      return false;
    }

    const normalize = (value: unknown) => String(value ?? '').trim().toUpperCase();

    const userRoleNames: string[] = Array.isArray(user.roles)
      ? user.roles
          .map((entry: any) => entry?.role?.name ?? entry?.name ?? entry)
          .map(normalize)
          .filter(Boolean)
      : user.role?.name
        ? [normalize(user.role.name)]
        : [];

    const required = requiredRoles.map(normalize);
    return required.some((role) => userRoleNames.includes(role));
  }
}
