type ModulePermission = {
  module?: string;
  screen?: string;
  view?: boolean;
  create?: boolean;
  edit?: boolean;
  delete?: boolean;
  approve?: boolean;
  download?: boolean;
};

type PermissionActionKey = keyof Omit<ModulePermission, "module" | "screen">;

const MODULE_RESOURCE_MAP: Record<string, string[]> = {
  "Purchase Management": [
    "vendors",
    "purchase_requisitions",
    "purchase_orders",
    "grns",
    "debit_notes",
  ],
  "Sales Management": ["sales", "crm"],
  "Field Sales": ["fsm"],
  Inventory: ["items", "uid", "grns"],
  Production: ["job_orders", "projects"],
  "Quality Control": ["quality"],
  "HR Management": ["hr"],
  "Service Management": ["service"],
  "BOM & Engineering": ["bom"],
  Documents: ["documents"],
  Reports: ["reports", "transformation"],
  Settings: ["users", "roles", "activity_logs"],
  Accounts: ["accounting"],
  Projects: ["projects"],
};

const SCREEN_RESOURCE_MAP: Record<string, string[]> = {
  "purchase-vendors": ["vendors"],
  "purchase-requisitions": ["purchase_requisitions"],
  "purchase-orders": ["purchase_orders"],
  "purchase-service-entries": ["purchase_orders"],
  "purchase-grn": ["grns"],
  "purchase-debit-notes": ["debit_notes"],
  "accounts-payables": ["debit_notes"],
  "crm-overview": ["crm"],
  "crm-field-sales": ["fsm"],
  "inventory-siv": ["job_orders"],
  "inventory-srv": ["job_orders"],
  "inventory-items": ["items"],
  "inventory-low-stock": ["items", "purchase_requisitions"],
  "inventory-store-vouchers": ["items"],
  "uid-overview": ["uid"],
  "uid-deployment": ["uid"],
  "uid-traceability": ["uid"],
  "production-job-orders": ["job_orders"],
  "production-projects": ["projects"],
  "production-create-job-order": ["job_orders"],
  "production-smart-job-order": ["job_orders"],
  "production-job-order-vouchers": ["job_orders"],
  "production-work-stations": ["job_orders"],
  "production-shop-floor": ["job_orders"],
  "hr-overview": ["hr"],
  "hr-self-service": ["hr"],
  "hr-management": ["hr"],
  "bom-overview": ["bom"],
  "bom-routing": ["bom"],
  "settings-overview": ["users", "roles"],
  "audit-trails": ["activity_logs"],
  "debug-tools": ["users", "roles"],
  "business-transformation": ["transformation"],
};

const MODULE_ACTION_TO_RESOURCE_ACTIONS: Record<PermissionActionKey, string[]> =
  {
    view: ["read", "view"],
    create: ["create"],
    edit: ["update", "edit"],
    delete: ["delete"],
    approve: ["approve"],
    download: ["download"],
  };

const MODULE_ACTION_RESOURCE_OVERRIDES: Partial<
  Record<PermissionActionKey, Record<string, string[]>>
> = {
  approve: {
    Inventory: ["job_orders"],
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toModulePermission = (value: unknown): ModulePermission | null => {
  if (!isRecord(value)) return null;
  const hasModule = typeof value.module === "string" && !!value.module.trim();
  const hasScreen = typeof value.screen === "string" && !!value.screen.trim();
  if (!hasModule && !hasScreen) return null;

  return {
    module: hasModule ? String(value.module) : undefined,
    screen: hasScreen ? String(value.screen) : undefined,
    view: !!value.view,
    create: !!value.create,
    edit: !!value.edit,
    delete: !!value.delete,
    approve: !!value.approve,
    download: !!value.download,
  };
};

const pushModulePermissions = (
  permissions: string[],
  rawPermissions: unknown,
) => {
  if (!Array.isArray(rawPermissions)) return;

  rawPermissions.forEach((entry) => {
    if (typeof entry === "string") {
      permissions.push(entry);
      return;
    }

    const modulePermission = toModulePermission(entry);
    if (!modulePermission?.module || modulePermission.screen) return;
    const moduleName = modulePermission.module;

    (
      Object.keys(MODULE_ACTION_TO_RESOURCE_ACTIONS) as PermissionActionKey[]
    ).forEach((actionKey) => {
      const resources = Array.from(
        new Set([
          ...(MODULE_RESOURCE_MAP[moduleName] || []),
          ...(MODULE_ACTION_RESOURCE_OVERRIDES[actionKey]?.[moduleName] || []),
        ]),
      );
      resources.forEach((resource) => {
        if (!modulePermission[actionKey]) return;
        MODULE_ACTION_TO_RESOURCE_ACTIONS[actionKey].forEach(
          (resourceAction) => {
            permissions.push(`${resource}:${resourceAction}`);
          },
        );
      });
    });
  });
};

const pushScreenPermissions = (
  permissions: string[],
  rawPermissions: unknown,
) => {
  if (!Array.isArray(rawPermissions)) return;

  rawPermissions.forEach((entry) => {
    const screenPermission = toModulePermission(entry);
    if (!screenPermission?.screen) return;

    const resources = SCREEN_RESOURCE_MAP[screenPermission.screen] || [];
    resources.forEach((resource) => {
      (
        Object.keys(MODULE_ACTION_TO_RESOURCE_ACTIONS) as PermissionActionKey[]
      ).forEach((actionKey) => {
        if (!screenPermission[actionKey]) return;
        MODULE_ACTION_TO_RESOURCE_ACTIONS[actionKey].forEach(
          (resourceAction) => {
            permissions.push(`${resource}:${resourceAction}`);
          },
        );
      });
    });
  });
};

const pushLegacyObjectPermissions = (
  permissions: string[],
  rawPermissions: unknown,
) => {
  if (!isRecord(rawPermissions)) return;

  Object.entries(rawPermissions).forEach(([resource, actions]) => {
    if (Array.isArray(actions)) {
      actions.forEach((action) => {
        permissions.push(`${resource}:${action}`);
      });
    }
  });
};

const pushRolePermissions = (
  permissions: string[],
  rawPermissions: unknown,
) => {
  pushModulePermissions(permissions, rawPermissions);
  pushScreenPermissions(permissions, rawPermissions);
  pushLegacyObjectPermissions(permissions, rawPermissions);
};

const hasAnyEnabledAction = (permission: ModulePermission | null) => {
  if (!permission) return false;
  return !!(
    permission.view ||
    permission.create ||
    permission.edit ||
    permission.delete ||
    permission.approve ||
    permission.download
  );
};

const getRawPermissionEntries = (user: any): unknown[] => {
  const entries: unknown[] = [];

  if (Array.isArray(user?.permissions)) {
    entries.push(...user.permissions);
  }

  if (
    user?.role &&
    typeof user.role === "object" &&
    Array.isArray(user.role.permissions)
  ) {
    entries.push(...user.role.permissions);
  }

  if (Array.isArray(user?.roles)) {
    user.roles.forEach((entry: any) => {
      const role = entry?.role || entry;
      if (role && typeof role === "object" && Array.isArray(role.permissions)) {
        entries.push(...role.permissions);
      }
    });
  }

  if (user?.metadata && Array.isArray(user.metadata.permissions)) {
    entries.push(...user.metadata.permissions);
  }

  return entries;
};

export const hasAdminBypass = (user: any): boolean => {
  const normalize = (value: unknown) =>
    String(value || "")
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_")
      .replace(/[^A-Z0-9_]/g, "");
  const adminRoleNames = new Set(["SUPER_ADMIN", "ADMIN", "ADMINISTRATOR"]);

  const directRole = user?.role;
  if (
    typeof directRole === "string" &&
    adminRoleNames.has(normalize(directRole))
  )
    return true;
  if (
    directRole &&
    typeof directRole === "object" &&
    adminRoleNames.has(normalize(directRole.name))
  )
    return true;

  const roleEntries = Array.isArray(user?.roles) ? user.roles : [];
  for (const entry of roleEntries) {
    const roleObj = entry?.role || entry;
    if (adminRoleNames.has(normalize(roleObj?.name))) return true;
  }

  return false;
};

export const hasSuperAdminBypass = (user: any): boolean => {
  const normalize = (value: unknown) =>
    String(value || "")
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_")
      .replace(/[^A-Z0-9_]/g, "");
  const directRole = user?.role;
  if (typeof directRole === "string" && normalize(directRole) === "SUPER_ADMIN")
    return true;
  if (
    directRole &&
    typeof directRole === "object" &&
    normalize(directRole.name) === "SUPER_ADMIN"
  )
    return true;

  const roleEntries = Array.isArray(user?.roles) ? user.roles : [];
  return roleEntries.some((entry: any) => {
    const roleObj = entry?.role || entry;
    return normalize(roleObj?.name) === "SUPER_ADMIN";
  });
};

export const getUserPermissions = (user: any): string[] => {
  if (!user) return [];
  const permissions: string[] = [];

  if (Array.isArray(user.permissions)) {
    pushRolePermissions(permissions, user.permissions);
  }

  if (user.role && typeof user.role === "object") {
    pushRolePermissions(permissions, user.role.permissions || {});
  }

  if (Array.isArray(user.roles)) {
    user.roles.forEach((entry: any) => {
      const role = entry?.role || entry;
      if (role && typeof role === "object") {
        pushRolePermissions(permissions, role.permissions || {});
      }
    });
  }

  if (user.metadata && user.metadata.permissions) {
    pushRolePermissions(permissions, user.metadata.permissions);
  }

  return [...new Set(permissions)];
};

export const hasPermission = (user: any, permission: string): boolean => {
  if (hasAdminBypass(user)) return true;
  return getUserPermissions(user).includes(permission);
};

export const hasAnyPermissionForResource = (
  user: any,
  resource: string,
): boolean => {
  if (hasAdminBypass(user)) return true;
  const prefix = `${resource}:`;
  return getUserPermissions(user).some((permission) =>
    permission.startsWith(prefix),
  );
};

export const hasModuleAccess = (user: any, moduleName: string): boolean => {
  if (hasAdminBypass(user)) return true;

  return getRawPermissionEntries(user).some((entry) => {
    const permission = toModulePermission(entry);
    return (
      permission?.module === moduleName &&
      !permission.screen &&
      hasAnyEnabledAction(permission)
    );
  });
};

export const hasScreenAccess = (user: any, screenName: string): boolean => {
  if (hasAdminBypass(user)) return true;

  return getRawPermissionEntries(user).some((entry) => {
    const permission = toModulePermission(entry);
    return permission?.screen === screenName && hasAnyEnabledAction(permission);
  });
};
