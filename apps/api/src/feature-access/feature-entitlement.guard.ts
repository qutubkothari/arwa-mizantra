import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { FeatureAccessService } from './feature-access.service';

@Injectable()
export class FeatureEntitlementGuard implements CanActivate {
  constructor(private readonly features: FeatureAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request?.user;
    if (!user?.tenantId) return true;

    const path = String(request.originalUrl || request.url || '');
    if (/\/api\/v1\/(auth|features)(\/|\?|$)/.test(path)) return true;

    const feature = await this.features.featureForApiPath(user.tenantId, path);
    if (!feature || feature.is_enabled !== false) return true;
    throw new ForbiddenException(`${feature.feature_name} is not enabled for this client account.`);
  }
}
