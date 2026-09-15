import { SetMetadata } from '@nestjs/common';

/**
 * Decorator to require specific permissions for an endpoint
 * Usage: @RequirePermissions('items:delete', 'vendors:delete')
 */
export const RequirePermissions = (...permissions: string[]) => 
  SetMetadata('permissions', permissions);

/**
 * Decorator to require specific roles for an endpoint
 * Usage: @Roles('Admin', 'Manager')
 */
export const Roles = (...roles: string[]) => SetMetadata('roles', roles);

/**
 * Decorator to mark an endpoint as requiring delete permission
 * This is a convenience wrapper around RequirePermissions
 * Usage: @RequireDelete('vendors') - checks if user has 'vendors:delete' permission
 */
export const RequireDelete = (resource: string) => 
  SetMetadata('permissions', [`${resource}:delete`]);

/**
 * Decorator to mark an endpoint as requiring create permission
 */
export const RequireCreate = (resource: string) => 
  SetMetadata('permissions', [`${resource}:create`]);

/**
 * Decorator to mark an endpoint as requiring read/view permission
 */
export const RequireRead = (resource: string) =>
  SetMetadata('permissions', [`${resource}:read`]);

/**
 * Decorator to mark an endpoint as requiring update permission
 */
export const RequireUpdate = (resource: string) => 
  SetMetadata('permissions', [`${resource}:update`]);

/**
 * Decorator to mark an endpoint as requiring approve permission
 */
export const RequireApprove = (resource: string) =>
  SetMetadata('permissions', [`${resource}:approve`]);

/**
 * Decorator to mark an endpoint as audit-logged
 * This will automatically log the action to activity_logs table
 */  
export const AuditLog = (action: string, resourceType: string) =>
  SetMetadata('audit', { action, resourceType });
