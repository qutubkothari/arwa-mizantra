import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { PurchaseRequisitionsService } from '../services/purchase-requisitions.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequireApprove, RequireDelete, RequireCreate, RequireUpdate } from '../../auth/decorators/permissions.decorator';
import { getUserPermissions } from '../../auth/utils/permission-utils';

type ModulePermission = {
  module?: string;
  screen?: string;
  view?: boolean;
  create?: boolean;
  edit?: boolean;
  delete?: boolean;
  approve?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toModulePermission(value: unknown): ModulePermission | null {
  if (!isRecord(value)) return null;

  const hasModule = typeof value.module === 'string' && value.module.trim().length > 0;
  const hasScreen = typeof value.screen === 'string' && value.screen.trim().length > 0;

  if (!hasModule && !hasScreen) {
    return null;
  }

  return {
    module: hasModule ? String(value.module) : undefined,
    screen: hasScreen ? String(value.screen) : undefined,
    view: !!value.view,
    create: !!value.create,
    edit: !!value.edit,
    delete: !!value.delete,
    approve: !!value.approve,
  };
}

function normalizeRoleName(value: unknown): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^A-Z0-9_]/g, '');
}

function normalizePermissionKey(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function normalizeScopeKey(value: unknown): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function isPurchaseRequisitionScope(permission: ModulePermission): boolean {
  const moduleKey = normalizeScopeKey(permission.module);
  const screenKey = normalizeScopeKey(permission.screen);
  return moduleKey === 'PURCHASEMANAGEMENT' || screenKey === 'PURCHASEREQUISITIONS';
}

function getNormalizedStringPermissions(user: any): string[] {
  return getUserPermissions(user)
    .map((permission: any) => normalizePermissionKey(permission))
    .filter(Boolean);
}

function hasPurchaseRequisitionStringPermission(user: any, action?: string): boolean {
  const permissions = getNormalizedStringPermissions(user);
  const actionKey = normalizePermissionKey(action);
  return permissions.some((permission) => {
    if (permission === 'purchase_requisitions:*' || permission === 'purchase-requisitions:*') return true;
    if (actionKey) {
      return permission === `purchase_requisitions:${actionKey}` || permission === `purchase-requisitions:${actionKey}`;
    }
    return permission.startsWith('purchase_requisitions:') || permission.startsWith('purchase-requisitions:');
  });
}

function hasAdminBypass(user: any): boolean {
  const adminRoleNames = new Set(['SUPER_ADMIN', 'ADMIN', 'ADMINISTRATOR']);

  const directRole = user?.role;
  if (typeof directRole === 'string' && adminRoleNames.has(normalizeRoleName(directRole))) {
    return true;
  }

  if (isRecord(directRole) && adminRoleNames.has(normalizeRoleName(directRole.name))) {
    return true;
  }

  const roleEntries = Array.isArray(user?.roles) ? user.roles : [];
  return roleEntries.some((entry: any) => {
    const roleObj = entry?.role || entry;
    return adminRoleNames.has(normalizeRoleName(roleObj?.name));
  });
}

function hasSuperAdminBypass(user: any): boolean {
  const directRole = user?.role;
  if (typeof directRole === 'string' && normalizeRoleName(directRole) === 'SUPER_ADMIN') {
    return true;
  }

  if (isRecord(directRole) && normalizeRoleName(directRole.name) === 'SUPER_ADMIN') {
    return true;
  }

  const roleEntries = Array.isArray(user?.roles) ? user.roles : [];
  return roleEntries.some((entry: any) => {
    const roleObj = entry?.role || entry;
    return normalizeRoleName(roleObj?.name) === 'SUPER_ADMIN';
  });
}

function hasManagerVisibility(user: any): boolean {
  if (hasAdminBypass(user)) return true;

  const roleNames: string[] = [];
  const directRole = user?.role;
  if (typeof directRole === 'string') roleNames.push(normalizeRoleName(directRole));
  if (isRecord(directRole)) roleNames.push(normalizeRoleName(directRole.name));

  const roleEntries = Array.isArray(user?.roles) ? user.roles : [];
  roleEntries.forEach((entry: any) => {
    const roleObj = entry?.role || entry;
    roleNames.push(normalizeRoleName(roleObj?.name));
  });

  return roleNames.some((name) =>
    name.includes('MANAGER') ||
    name.includes('DEPARTMENT_HEAD') ||
    name === 'TEAM_LEAD' ||
    name === 'SUPERVISOR',
  );
}

function hasPurchaseApproveAccess(user: any): boolean {
  if (!user) return false;
  if (hasAdminBypass(user)) return true;
  if (hasPurchaseRequisitionStringPermission(user, 'approve')) return true;

  const rawPermissions: unknown[] = [];

  if (Array.isArray(user?.roles)) {
    user.roles.forEach((entry: any) => {
      const roleObj = entry?.role || entry;
      if (Array.isArray(roleObj?.permissions)) {
        rawPermissions.push(...roleObj.permissions);
      }
    });
  }

  if (Array.isArray(user?.role?.permissions)) {
    rawPermissions.push(...user.role.permissions);
  }

  return rawPermissions.some((entry) => {
    const permission = toModulePermission(entry);
    if (!permission?.approve) return false;

    return isPurchaseRequisitionScope(permission);
  });
}

function hasPurchaseRegisterAccess(user: any): boolean {
  if (!user) return false;
  if (hasAdminBypass(user)) return true;
  if (hasPurchaseRequisitionStringPermission(user)) return true;

  const rawPermissions: unknown[] = [];

  if (Array.isArray(user?.permissions)) {
    rawPermissions.push(...user.permissions);
  }

  if (Array.isArray(user?.roles)) {
    user.roles.forEach((entry: any) => {
      const roleObj = entry?.role || entry;
      if (Array.isArray(roleObj?.permissions)) {
        rawPermissions.push(...roleObj.permissions);
      }
    });
  }

  if (Array.isArray(user?.role?.permissions)) {
    rawPermissions.push(...user.role.permissions);
  }

  return rawPermissions.some((entry) => {
    const permission = toModulePermission(entry);
    if (!permission) return false;

    if (!isPurchaseRequisitionScope(permission)) return false;

    return Boolean(permission.view || permission.create || permission.edit || permission.delete || permission.approve);
  });
}

function normalizeDepartmentVisibility(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const upper = raw.toUpperCase().replace(/\s+/g, ' ');
  if (upper === 'RND' || upper === 'R & D' || upper === 'R AND D' || upper === 'RESEARCH AND DEVELOPMENT') {
    return 'R&D';
  }
  return upper;
}

function collectDepartmentRights(user: any): string[] {
  const departments = new Set<string>();

  const push = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    const normalized = normalizeDepartmentVisibility(value);
    if (normalized) departments.add(normalized);
  };

  const scanObject = (value: unknown) => {
    if (!isRecord(value)) return;
    push(value.department);
    push(value.departments);
    push(value.department_rights);
    push(value.departmentRights);
    push(value.department_access);
    push(value.departmentAccess);
    push(value.assigned_departments);
    push(value.assignedDepartments);
    push(value.allowed_departments);
    push(value.allowedDepartments);
  };

  scanObject(user);
  scanObject(user?.metadata);
  scanObject(user?.profile);

  const scanPermissionEntry = (entry: unknown) => {
    scanObject(entry);
    if (isRecord(entry) && isRecord(entry.scope)) scanObject(entry.scope);
  };

  if (Array.isArray(user?.permissions)) user.permissions.forEach(scanPermissionEntry);
  if (Array.isArray(user?.role?.permissions)) user.role.permissions.forEach(scanPermissionEntry);
  if (Array.isArray(user?.roles)) {
    user.roles.forEach((entry: any) => {
      const roleObj = entry?.role || entry;
      scanObject(roleObj);
      if (Array.isArray(roleObj?.permissions)) roleObj.permissions.forEach(scanPermissionEntry);
    });
  }

  return Array.from(departments);
}

@Controller('purchase/requisitions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PurchaseRequisitionsController {
  constructor(
    private readonly prService: PurchaseRequisitionsService,
  ) {}

  @Post('check-duplicates')
  async checkDuplicates(@Request() req: any, @Body() prData: any) {
    return this.prService.checkDuplicates(req.user.tenantId, prData?.items || []);
  }

  @Get('item-availability/:itemId')
  async getItemAvailability(@Request() req: any, @Param('itemId') itemId: string) {
    return this.prService.getItemAvailability(req.user.tenantId, itemId);
  }

  @Post()
  @RequireCreate('purchase_requisitions')
  async create(@Request() req: any, @Body() body: any) {
    return this.prService.create(req.user.tenantId, req.user.userId, body);
  }

  @Get()
  async findAll(@Request() req: any, @Query() query: any) {
    const canViewAll = hasPurchaseRegisterAccess(req.user) || hasPurchaseApproveAccess(req.user) || hasManagerVisibility(req.user);
    const userId = String(req.user.userId || req.user.id || '').trim();
    const ownDepartment = canViewAll
      ? null
      : await this.prService.findUserDepartment(req.user.tenantId, userId);
    const departments = canViewAll
      ? []
      : Array.from(new Set([
          normalizeDepartmentVisibility(ownDepartment),
          ...collectDepartmentRights(req.user),
        ].filter(Boolean)));
    const effectiveQuery = canViewAll
      ? query
      : {
          ...query,
          visibility: {
            requestedBy: userId,
            department: ownDepartment,
            departments,
          },
        };

    return this.prService.findAll(req.user.tenantId, effectiveQuery);
  }

  @Get(':id')
  async findOne(@Request() req: any, @Param('id') id: string) {
    return this.prService.findOne(req.user.tenantId, id);
  }

  @Get(':id/available-for-po')
  async findOneAvailableForPO(@Request() req: any, @Param('id') id: string) {
    return this.prService.findOneAvailableForPO(req.user.tenantId, id);
  }

  @Get(':id/approval-history')
  async findApprovalHistory(@Request() req: any, @Param('id') id: string) {
    return this.prService.findApprovalHistory(req.user.tenantId, id);
  }

  @Put(':id')
  @RequireUpdate('purchase_requisitions')
  async update(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.prService.update(req.user.tenantId, id, body, req.user.userId, {
      overrideLifecycleLock: hasSuperAdminBypass(req.user),
    });
  }

  @Post(':id/submit')
  async submit(@Request() req: any, @Param('id') id: string) {
    return this.prService.submit(req.user.tenantId, id, req.user.userId);
  }

  @Post(':id/approve')
  @RequireApprove('purchase_requisitions')
  async approve(@Request() req: any, @Param('id') id: string) {
    return this.prService.approve(req.user.tenantId, id, req.user.userId, {
      overrideMakerChecker: hasSuperAdminBypass(req.user),
    });
  }

  @Post(':id/reject')
  @RequireApprove('purchase_requisitions')
  async reject(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.prService.reject(req.user.tenantId, id, req.user.userId, body?.reason, {
      overrideMakerChecker: hasSuperAdminBypass(req.user),
    });
  }

  @Post(':id/rfq/send')
  async sendRFQ(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.prService.sendRFQ(req.user.tenantId, id, req.user.userId, body);
  }

  @Post(':id/rfq/preview')
  async previewRFQ(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.prService.previewRFQ(req.user.tenantId, id, body);
  }

  @Get(':id/rfqs')
  async findRFQs(@Request() req: any, @Param('id') id: string) {
    return this.prService.findRFQs(req.user.tenantId, id);
  }

  @Post(':id/rfqs/:rfqId/response')
  @RequireUpdate('purchase_requisitions')
  async recordRFQResponse(
    @Request() req: any,
    @Param('id') id: string,
    @Param('rfqId') rfqId: string,
    @Body() body: any,
  ) {
    return this.prService.recordRFQResponse(req.user.tenantId, id, rfqId, req.user.userId, body);
  }

  @Delete(':id')
  @RequireDelete('purchase_requisitions')
  async delete(@Request() req: any, @Param('id') id: string) {
    return this.prService.delete(req.user.tenantId, id);
  }
}
