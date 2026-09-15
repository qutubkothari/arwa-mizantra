import { ForbiddenException } from '@nestjs/common';
import { FeatureEntitlementGuard } from './feature-entitlement.guard';

const context = (request: any) => ({
  switchToHttp: () => ({ getRequest: () => request }),
}) as any;

describe('FeatureEntitlementGuard', () => {
  it('preserves access when no catalogue route matches', async () => {
    const features = { featureForApiPath: jest.fn().mockResolvedValue(null) } as any;
    const guard = new FeatureEntitlementGuard(features);
    await expect(guard.canActivate(context({ user: { tenantId: 't1' }, originalUrl: '/api/v1/health' }))).resolves.toBe(true);
  });

  it('blocks a disabled tenant feature even for an authenticated user', async () => {
    const features = {
      featureForApiPath: jest.fn().mockResolvedValue({ feature_name: 'Subcontracting', is_enabled: false }),
    } as any;
    const guard = new FeatureEntitlementGuard(features);
    await expect(guard.canActivate(context({
      user: { tenantId: 't1', role: { name: 'SUPER_ADMIN' } },
      originalUrl: '/api/v1/production/subcontracting/orders',
    }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('always allows the entitlement control endpoint', async () => {
    const features = { featureForApiPath: jest.fn() } as any;
    const guard = new FeatureEntitlementGuard(features);
    await expect(guard.canActivate(context({ user: { tenantId: 't1' }, originalUrl: '/api/v1/features/admin' }))).resolves.toBe(true);
    expect(features.featureForApiPath).not.toHaveBeenCalled();
  });
});
