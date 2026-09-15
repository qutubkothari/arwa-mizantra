import { Body, Controller, ForbiddenException, Get, Put, Request } from '@nestjs/common';
import { FeatureAccessService } from './feature-access.service';

@Controller('features')
export class FeatureAccessController {
  constructor(private readonly features: FeatureAccessService) {}

  private isMasterAdmin(user: any): boolean {
    const names: string[] = [];
    const add = (value: unknown) => names.push(String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_'));
    if (typeof user?.role === 'string') add(user.role);
    else add(user?.role?.name);
    for (const entry of Array.isArray(user?.roles) ? user.roles : []) add(entry?.role?.name || entry?.name || entry);
    return names.some((name) => ['SUPER_ADMIN', 'SUPERADMIN', 'OWNER', 'PLATFORM_OWNER'].includes(name));
  }

  private assertMasterAdmin(user: any) {
    if (!this.isMasterAdmin(user)) {
      throw new ForbiddenException('Only the Master Admin can change client feature entitlements.');
    }
  }

  @Get('me')
  async me(@Request() req: any) {
    const catalogue = await this.features.catalogueForTenant(req.user.tenantId);
    return {
      configured: catalogue.length > 0,
      enabled_features: catalogue.filter((entry) => entry.is_enabled !== false).map((entry) => entry.feature_key),
    };
  }

  @Get('admin')
  async admin(@Request() req: any) {
    this.assertMasterAdmin(req.user);
    return this.features.catalogueForTenant(req.user.tenantId);
  }

  @Put('admin')
  async update(@Request() req: any, @Body() body: any) {
    this.assertMasterAdmin(req.user);
    return this.features.updateEntitlements(
      req.user.tenantId,
      req.user.userId || req.user.id,
      Array.isArray(body?.features) ? body.features : [],
    );
  }
}
