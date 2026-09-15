import {
  findScreenDefinition,
  type PermissionEntry,
  type PermissionAction,
  SCREEN_DEFINITIONS,
} from "./permission-config";

export type StoredUser = {
  roles?: string[] | Array<{ role: { name: string; permissions?: unknown } }>;
  role?: { name: string; permissions?: unknown };
  username?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  firstName?: string;
  lastName?: string;
  enabledFeatures?: string[];
  featureAccessConfigured?: boolean;
};

export type Permission = PermissionEntry;

// Some workspaces are an integral drill-down of a parent screen. Tenants and
// roles configured before the child key was introduced must not lose access
// to the workflow they already had. Explicit child permissions still take
// precedence when present.
const SCREEN_PERMISSION_FALLBACKS: Record<string, string[]> = {
  "bom-routing": ["bom-overview"],
};

const PRODUCTION_MANAGEMENT_DENYLIST = new Set([
  "production@mizantra.ae",
]);

function getNormalizedEmail(user: StoredUser | null): string {
  const raw = user?.email;
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

function isProductionManagementDenied(user: StoredUser | null): boolean {
  const email = getNormalizedEmail(user);
  return !!email && PRODUCTION_MANAGEMENT_DENYLIST.has(email);
}

function mergePermission(a: Permission, b: Permission): Permission {
  return {
    module: a.module || b.module,
    screen: a.screen || b.screen,
    view: !!(a.view || b.view),
    create: !!(a.create || b.create),
    edit: !!(a.edit || b.edit),
    delete: !!(a.delete || b.delete),
    approve: !!(a.approve || b.approve),
    download: !!(a.download || b.download),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readStoredUser(): StoredUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("user");
    return raw ? (JSON.parse(raw) as StoredUser) : null;
  } catch {
    return null;
  }
}

export function getUserRoleNames(user: StoredUser | null): string[] {
  if (!user) return [];
  const names: string[] = [];

  const rawRoles = (user as { roles?: unknown }).roles;
  if (Array.isArray(rawRoles)) {
    rawRoles.forEach((entry) => {
      if (typeof entry === "string") {
        names.push(entry);
        return;
      }
      if (
        isRecord(entry) &&
        isRecord(entry.role) &&
        typeof entry.role.name === "string"
      ) {
        names.push(entry.role.name);
      }
    });
  }

  const single = (user as { role?: { name?: unknown } }).role;
  if (single && typeof single.name === "string") names.push(single.name);
  return names;
}

export function isAdminLike(user: StoredUser | null): boolean {
  const roleNames = getUserRoleNames(user)
    .map((n) =>
      String(n)
        .toUpperCase()
        .replace(/[_\-]+/g, " "),
    )
    .map((n) => n.trim())
    .filter(Boolean);

  return roleNames.some(
    (n) => n.includes("ADMIN") || n.includes("SUPER") || n.includes("OWNER"),
  );
}

/**
 * Command Center is the management landing surface, not a back-door to every
 * ERP module.  Keep frontline/mobile users on their task-specific landing
 * pages, while recognised functional leaders get their role-filtered decision
 * view at sign-in.
 */
export function isManagementLeader(user: StoredUser | null): boolean {
  const roleNames = getUserRoleNames(user).map((name) =>
    String(name)
      .toUpperCase()
      .replace(/[\s-]+/g, "_"),
  );
  return roleNames.some((role) =>
    [
      "CEO",
      "MD",
      "MANAGING_DIRECTOR",
      "DIRECTOR",
      "CFO",
      "FINANCE_MANAGER",
      "OPERATIONS_MANAGER",
      "PRODUCTION_MANAGER",
      "PURCHASE_MANAGER",
      "PROCUREMENT_MANAGER",
      "QUALITY_MANAGER",
      "MAINTENANCE_MANAGER",
      "SALES_MANAGER",
      "COMMERCIAL_MANAGER",
    ].includes(role),
  );
}

/** Strict maker-checker override: only Admin and Super Admin roles qualify. */
export function hasMakerCheckerOverride(user: StoredUser | null): boolean {
  const directRole = (user as any)?.role;
  const rawNames = [
    ...getUserRoleNames(user),
    typeof directRole === "string" ? directRole : "",
    typeof (user as any)?.roleName === "string" ? (user as any).roleName : "",
    typeof (user as any)?.role_name === "string" ? (user as any).role_name : "",
  ];
  const roleNames = rawNames.map((name) =>
    String(name || "")
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_")
      .replace(/[^A-Z0-9_]/g, ""),
  );
  return roleNames.some((name) =>
    ["ADMIN", "ADMINISTRATOR", "SUPER_ADMIN"].includes(name),
  );
}

function toPermission(value: unknown): Permission {
  if (!isRecord(value)) return {};
  return {
    module: typeof value.module === "string" ? value.module : undefined,
    screen: typeof value.screen === "string" ? value.screen : undefined,
    view: !!value.view,
    create: !!value.create,
    edit: !!value.edit,
    delete: !!value.delete,
    approve: !!value.approve,
    download: !!value.download,
  };
}

function normalizePermissions(value: unknown): Permission[] {
  if (Array.isArray(value)) return value.map(toPermission);
  if (isRecord(value)) {
    if (typeof value.module === "string" || typeof value.screen === "string")
      return [toPermission(value)];
    return Object.keys(value).map((module) => {
      const entry = value[module];
      const perm = toPermission(entry);
      return { ...perm, module };
    });
  }
  return [];
}

function isPermissionEnabled(permission: Permission): boolean {
  return !!(
    permission.view ||
    permission.create ||
    permission.edit ||
    permission.delete ||
    permission.approve ||
    permission.download
  );
}

function getUserPermissionsRaw(user: StoredUser | null): unknown {
  if (!user) return [];
  const raw = (user as { roles?: unknown }).roles;

  if (Array.isArray(raw) && raw.length > 0 && isRecord(raw[0])) {
    const flattened = raw.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const role = entry.role;
      if (!isRecord(role)) return [];
      const perms = role.permissions;
      return Array.isArray(perms) ? perms : [];
    });
    if (flattened.length > 0) return flattened;

    const firstWithPerms = raw.find((entry) => {
      if (!isRecord(entry)) return false;
      const role = entry.role;
      return (
        isRecord(role) &&
        Array.isArray(role.permissions) &&
        role.permissions.length > 0
      );
    });

    if (
      firstWithPerms &&
      isRecord(firstWithPerms) &&
      isRecord(firstWithPerms.role)
    ) {
      return firstWithPerms.role.permissions ?? [];
    }

    return [];
  }

  const singleRolePerms = (user as { role?: { permissions?: unknown } }).role
    ?.permissions;
  if (singleRolePerms) return singleRolePerms;
  return [];
}

export function shouldEnforcePermissions(user: StoredUser | null): boolean {
  if (!user) return false;
  const raw = getUserPermissionsRaw(user);
  if (!Array.isArray(raw)) return false;
  return normalizePermissions(raw).some((p) => isPermissionEnabled(p));
}

export function getEnabledModules(user: StoredUser | null): Set<string> {
  const enabled = new Set<string>();
  const raw = getUserPermissionsRaw(user);
  if (!Array.isArray(raw)) return enabled;

  normalizePermissions(raw)
    .filter(
      (p) =>
        isPermissionEnabled(p) && typeof p.module === "string" && !p.screen,
    )
    .forEach((p) => {
      if (typeof p.module === "string" && p.module.trim().length > 0)
        enabled.add(p.module);
    });

  return enabled;
}

export function getEnabledScreens(user: StoredUser | null): Set<string> {
  const enabled = new Set<string>();
  const raw = getUserPermissionsRaw(user);
  if (!Array.isArray(raw)) return enabled;

  normalizePermissions(raw)
    .filter((p) => isPermissionEnabled(p) && typeof p.screen === "string")
    .forEach((p) => {
      if (typeof p.screen === "string" && p.screen.trim().length > 0)
        enabled.add(p.screen);
    });

  return enabled;
}

export function getMergedPermissionsByModule(
  user: StoredUser | null,
): Map<string, Permission> {
  const map = new Map<string, Permission>();
  const raw = getUserPermissionsRaw(user);
  if (!Array.isArray(raw)) return map;

  normalizePermissions(raw).forEach((p) => {
    const key = typeof p.module === "string" && !p.screen ? p.module : "";
    if (!key) return;
    const existing = map.get(key) ?? { module: key };
    map.set(key, mergePermission(existing, { ...p, module: key }));
  });

  return map;
}

export function getMergedPermissionsByScreen(
  user: StoredUser | null,
): Map<string, Permission> {
  const map = new Map<string, Permission>();
  const raw = getUserPermissionsRaw(user);
  if (!Array.isArray(raw)) return map;

  normalizePermissions(raw).forEach((p) => {
    const key = typeof p.screen === "string" ? p.screen : "";
    if (!key) return;
    const existing = map.get(key) ?? { screen: key };
    map.set(key, mergePermission(existing, { ...p, screen: key }));
  });

  return map;
}

function getCurrentPathname(): string | null {
  if (typeof window === "undefined") return null;
  return window.location.pathname || null;
}

function getScreenOverrideForPath(
  user: StoredUser | null,
  pathname: string | null,
): Permission | null {
  if (!pathname) return null;
  const screenDefinition = findScreenDefinition(pathname);
  if (!screenDefinition) return null;

  const screenPermissions = getMergedPermissionsByScreen(user);
  const moduleScreenDefinitions = SCREEN_DEFINITIONS.filter(
    (screen) => screen.module === screenDefinition.module,
  );
  const hasScreenOverridesForModule = moduleScreenDefinitions.some((screen) =>
    screenPermissions.has(screen.key),
  );
  if (!hasScreenOverridesForModule) return null;

  const directPermission = screenPermissions.get(screenDefinition.key);
  if (directPermission) return directPermission;

  for (const fallbackKey of
    SCREEN_PERMISSION_FALLBACKS[screenDefinition.key] ?? []) {
    const fallbackPermission = screenPermissions.get(fallbackKey);
    if (fallbackPermission) return fallbackPermission;
  }

  return { screen: screenDefinition.key };
}

export function hasScreenPermission(
  user: StoredUser | null,
  pathname: string,
  action: PermissionAction,
): boolean {
  if (isAdminLike(user)) return true;
  const override = getScreenOverrideForPath(user, pathname);
  return !!override?.[action];
}

export function hasModulePermission(
  user: StoredUser | null,
  moduleName: string,
  action: PermissionAction,
): boolean {
  // Special-case: this account should not have access to Production Management
  // even if the role permissions are misconfigured.
  if (
    moduleName === "Production" &&
    action === "approve" &&
    isProductionManagementDenied(user)
  ) {
    return false;
  }

  // Admin / Super Admin / Owner gets all permissions by default
  if (isAdminLike(user)) return true;

  const screenOverride = getScreenOverrideForPath(user, getCurrentPathname());
  if (
    screenOverride &&
    (screenOverride.screen || screenOverride.module === moduleName)
  ) {
    return !!screenOverride[action];
  }

  const merged = getMergedPermissionsByModule(user);
  const perm = merged.get(moduleName);
  return !!perm?.[action];
}

const MODULE_TO_ROUTE_PREFIXES: Record<string, string[]> = {
  "Purchase Management": ["/dashboard/purchase", "/dashboard/accounts"],
  "Sales Management": ["/dashboard/sales", "/dashboard/crm"],
  Inventory: [
    "/dashboard/inventory",
    "/dashboard/uid",
    "/dashboard/purchase/grn",
  ],
  Production: [
    "/dashboard/production",
    "/dashboard/bom",
    "/dashboard/work-stations",
    "/dashboard/shop-floor",
  ],
  "Quality Control": [
    "/dashboard/quality",
    "/dashboard/quality/capa",
    "/dashboard/quality/ehs-sustainability",
    "/dashboard/quality/cost-of-quality",
  ],
  "HR Management": ["/dashboard/hr"],
  "Service Management": ["/dashboard/service"],
  // Engineering should not implicitly grant access to Production Management.
  "BOM & Engineering": ["/dashboard/bom"],
  Documents: ["/dashboard/documents"],
  Reports: ["/dashboard/reports", "/dashboard/manager"],
  Settings: [
    "/dashboard/settings",
    "/dashboard/audit-trails",
    "/dashboard/debug",
  ],
  Accounts: ["/dashboard/accounts"],
  Projects: ["/dashboard/projects"],
};

export function getAllowedRoutePrefixes(user: StoredUser | null): string[] {
  const screenPermissions = getMergedPermissionsByScreen(user);
  const enabledScreens = SCREEN_DEFINITIONS.filter((screen) => {
    const override = screenPermissions.get(screen.key);
    return !!override && isPermissionEnabled(override);
  }).map((screen) => screen.route);

  if (enabledScreens.length > 0) {
    return Array.from(new Set(enabledScreens));
  }

  const enabledModules = getEnabledModules(user);
  const prefixes: string[] = [];

  enabledModules.forEach((module) => {
    const mapped = MODULE_TO_ROUTE_PREFIXES[module];
    if (Array.isArray(mapped)) prefixes.push(...mapped);
  });

  // De-duplicate while preserving order
  return Array.from(new Set(prefixes));
}

// Override the default landing page for specific route prefixes.
// e.g. Inventory users should land on Stock Master, not the movements/overview page.
const LANDING_PAGE_OVERRIDES: Record<string, string> = {
  "/dashboard/inventory": "/dashboard/inventory/items",
};

const HR_EMPLOYEE_LANDING_PATH =
  "/dashboard/hr/employees?section=employees&tab=attendance";
const EMPLOYEE_ATTENDANCE_FIRST_IDENTITIES = new Set(["padma_n", "padma"]);

function normalizeIdentity(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function userIdentityCandidates(user: StoredUser | null): string[] {
  if (!user) return [];
  const first = (user as any).first_name ?? (user as any).firstName ?? "";
  const last = (user as any).last_name ?? (user as any).lastName ?? "";
  const raw = [
    (user as any).username,
    (user as any).email,
    typeof (user as any).email === "string"
      ? String((user as any).email).split("@")[0]
      : "",
    first,
    `${first} ${last}`,
  ];

  return raw.map(normalizeIdentity).filter(Boolean);
}

export function shouldStartAtEmployeeAttendance(
  user: StoredUser | null,
): boolean {
  if (!user || isAdminLike(user)) return false;

  const identities = userIdentityCandidates(user);
  if (
    identities.some((identity) =>
      EMPLOYEE_ATTENDANCE_FIRST_IDENTITIES.has(identity),
    )
  ) {
    return true;
  }

  const roleNames = getUserRoleNames(user)
    .map((name) => normalizeIdentity(name).replace(/[_-]+/g, " "))
    .filter(Boolean);

  return roleNames.some(
    (roleName) =>
      roleName.includes("employee self service") ||
      roleName === "employee" ||
      roleName.includes("hr employee") ||
      roleName.includes("staff"),
  );
}

function getHrLandingPath(user: StoredUser | null): string {
  if (isAdminLike(user)) return "/dashboard";

  // HR users should always start at the punch-first employee workspace.
  // HR managers can still navigate to management/payroll tabs after landing.
  return HR_EMPLOYEE_LANDING_PATH;
}

function hasHrAccess(user: StoredUser | null): boolean {
  if (!user) return false;

  const enabledModules = getEnabledModules(user);
  if (enabledModules.has("HR Management")) return true;

  const allowedPrefixes = getAllowedRoutePrefixes(user);
  if (
    allowedPrefixes.some(
      (prefix) =>
        prefix === "/dashboard/hr" || prefix.startsWith("/dashboard/hr/"),
    )
  ) {
    return true;
  }

  return (
    hasScreenPermission(user, "/dashboard/hr", "view") ||
    hasScreenPermission(user, "/dashboard/hr/employees", "view") ||
    hasScreenPermission(user, HR_EMPLOYEE_LANDING_PATH, "view")
  );
}

export function getDefaultLandingPath(user: StoredUser | null): string {
  // The dashboard is always deployed. Never route a successful login to an
  // optional command-centre screen that may be disabled for this tenant.
  if (isAdminLike(user)) return "/dashboard";

  // Employee/mobile users must start with Check In / Attendance even when
  // their role also has purchase, inventory, or other back-office screens.
  if (shouldStartAtEmployeeAttendance(user) || hasHrAccess(user)) {
    return getHrLandingPath(user);
  }

  const enabledScreen = SCREEN_DEFINITIONS.find((screen) =>
    hasScreenPermission(user, screen.route, "view"),
  );
  if (enabledScreen) {
    if (
      enabledScreen.route === "/dashboard/hr" ||
      enabledScreen.route.startsWith("/dashboard/hr/")
    ) {
      return getHrLandingPath(user);
    }
    return enabledScreen.match === "prefix"
      ? enabledScreen.route.replace(/\/$/, "")
      : enabledScreen.route;
  }

  const prefixes = getAllowedRoutePrefixes(user);
  // Prefer something other than the global dashboard.
  const firstNonDashboard = prefixes.find((p) => p !== "/dashboard");
  if (firstNonDashboard) {
    if (
      firstNonDashboard === "/dashboard/hr" ||
      firstNonDashboard.startsWith("/dashboard/hr/")
    ) {
      return getHrLandingPath(user);
    }
    return LANDING_PAGE_OVERRIDES[firstNonDashboard] ?? firstNonDashboard;
  }

  // If the user has no other module access (or no permissions configured yet),
  // send them to a safe page instead of looping on /dashboard.
  return "/dashboard/unauthorized";
}

export function isPathAllowedForUser(
  user: StoredUser | null,
  pathname: string,
): boolean {
  // Master Admin feature control must remain reachable even when every
  // customer-facing feature is disabled. The API still restricts it to the
  // tenant's Master Admin role.
  if (pathname === "/dashboard/settings/feature-access") {
    return isAdminLike(user);
  }

  // Tenant entitlements are the outer licence boundary. Role and screen
  // permissions below can only narrow this set; even admins must respect it.
  if (user?.featureAccessConfigured && Array.isArray(user.enabledFeatures)) {
    const matchedFeature = [...SCREEN_DEFINITIONS]
      .filter((screen) =>
        screen.match === "prefix"
          ? pathname.startsWith(screen.route)
          : pathname === screen.route,
      )
      .sort((left, right) => right.route.length - left.route.length)[0];
    if (matchedFeature && !user.enabledFeatures.includes(matchedFeature.key)) {
      const coveredByParentFeature = (
        SCREEN_PERMISSION_FALLBACKS[matchedFeature.key] ?? []
      ).some((key) => user.enabledFeatures!.includes(key));
      const productionCockpitCoveredByWorkspace =
        pathname === "/dashboard/production" &&
        SCREEN_DEFINITIONS.some(
          (screen) =>
            screen.module === "Production" &&
            screen.key !== "production-overview" &&
            user.enabledFeatures!.includes(screen.key),
        );
      if (!coveredByParentFeature && !productionCockpitCoveredByWorkspace)
        return false;
    }
  }

  if (!shouldEnforcePermissions(user)) return true;
  if (isAdminLike(user)) return true;

  // Management leaders receive the role-filtered Command Center.  Detailed
  // modules and sensitive sub-workspaces continue to use their normal module
  // permission checks; this is deliberately not a broad navigation override.
  if (isManagementLeader(user) && pathname === "/dashboard/command-center")
    return true;

  // Always allow the unauthorized landing page.
  if (pathname === "/dashboard/unauthorized") return true;

  // Block the global dashboard for non-admin users.
  if (pathname === "/dashboard") return false;

  // Production Management screen is restricted to Production approvers.
  // This allows production operators to access job orders without seeing the management page.
  if (pathname === "/dashboard/production") {
    const screenOverride = getScreenOverrideForPath(user, pathname);
    if (screenOverride && isPermissionEnabled(screenOverride)) return true;
    const canUseProductionWorkspace = SCREEN_DEFINITIONS.some((screen) => {
      if (
        screen.module !== "Production" ||
        screen.route === "/dashboard/production"
      )
        return false;
      const permission = getScreenOverrideForPath(user, screen.route);
      return Boolean(permission && isPermissionEnabled(permission));
    });
    return (
      canUseProductionWorkspace ||
      hasModulePermission(user, "Production", "view") ||
      hasModulePermission(user, "Production", "approve")
    );
  }

  const matchedScreen = findScreenDefinition(pathname);
  if (matchedScreen) {
    const screenOverride = getScreenOverrideForPath(user, pathname);
    if (screenOverride) {
      return isPermissionEnabled(screenOverride);
    }
  }

  const prefixes = getAllowedRoutePrefixes(user);
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
  );
}
