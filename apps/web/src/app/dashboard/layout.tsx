"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "../../components/Sidebar";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { CommandPalette } from "@/components/CommandPalette";
import DashboardReminders from "@/components/DashboardReminders";
import { ConfirmDialogProvider } from "@/components/ui/ConfirmDialog";
import { SecurityWrapper } from "@/components/SecurityWrapper";
import { useAuthStore } from "@/stores/auth.store";
import {
  getDefaultLandingPath,
  isPathAllowedForUser,
  readStoredUser,
} from "../../lib/rbac";
import { apiClient } from "../../../lib/api-client";
import GovernanceRequiredNotice from "../../components/GovernanceRequiredNotice";

// A module's overview can be disabled independently of its operational
// workspaces.  Preserve the owner's feature controls, but do not strand a
// user at the Command Center when they open the module's root URL and have
// access to work inside that module.
const restrictedRootFallbacks: Record<string, string[]> = {
  "/dashboard/production": [
    "/dashboard/production/job-orders/smart-items",
    "/dashboard/production/job-orders",
    "/dashboard/production/smart-planning",
    "/dashboard/production/mrp",
    "/dashboard/production/subcontracting",
    "/dashboard/production/autonomy",
  ],
};

function getRestrictedRootFallback(
  user: ReturnType<typeof readStoredUser>,
  pathname: string,
) {
  return (restrictedRootFallbacks[pathname] || []).find((route) =>
    isPathAllowedForUser(user, route),
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { setUser } = useAuthStore();

  // Persist sidebar state
  useEffect(() => {
    const saved = localStorage.getItem("sidebarCollapsed");
    if (saved) {
      setSidebarCollapsed(JSON.parse(saved));
    }
  }, []);

  const toggleSidebar = () => {
    const newState = !sidebarCollapsed;
    setSidebarCollapsed(newState);
    localStorage.setItem("sidebarCollapsed", JSON.stringify(newState));
  };

  // Enforce module-level navigation based on role permissions.
  // This prevents users from opening unauthorized modules by typing URLs.
  useEffect(() => {
    if (!pathname) return;
    try {
      const postLoginLandingPath = sessionStorage.getItem(
        "postLoginLandingPath",
      );
      if (
        postLoginLandingPath &&
        pathname !== postLoginLandingPath.split("?")[0]
      ) {
        sessionStorage.removeItem("postLoginLandingPath");
        router.replace(postLoginLandingPath);
        return;
      }
      if (
        postLoginLandingPath &&
        pathname === postLoginLandingPath.split("?")[0]
      ) {
        sessionStorage.removeItem("postLoginLandingPath");
      }
    } catch {
      // Ignore storage restrictions; normal RBAC routing below still applies.
    }
    const user = readStoredUser();
    const defaultLandingPath = getDefaultLandingPath(user);
    if (
      pathname === "/dashboard/hr" &&
      defaultLandingPath.startsWith("/dashboard/hr/")
    ) {
      router.replace(defaultLandingPath);
      return;
    }
    const permittedModuleWorkspace = getRestrictedRootFallback(user, pathname);
    const canUseProductionCockpit =
      pathname === "/dashboard/production" && Boolean(permittedModuleWorkspace);
    if (!isPathAllowedForUser(user, pathname) && !canUseProductionCockpit) {
      router.replace(permittedModuleWorkspace || defaultLandingPath);
    }
  }, [pathname, router]);

  useEffect(() => {
    let cancelled = false;

    const syncCurrentUser = async () => {
      if (typeof window === "undefined") return;
      if (!localStorage.getItem("accessToken")) {
        router.replace("/login");
        return;
      }

      try {
        const currentUser = await apiClient.getCurrentUser();
        if (cancelled || !currentUser) return;
        let featureAccess: any = null;
        try {
          // Entitlements can change while a user is signed in. Avoid a stale
          // conditional GET restoring an older menu after a deployment or
          // feature-access save.
          featureAccess = await apiClient.get("/features/me", {
            _ts: Date.now(),
          });
        } catch {
          // Rolling-deployment compatibility: retain existing access if the
          // additive feature service has not reached this deployment yet.
        }
        const effectiveUser = featureAccess?.configured
          ? {
              ...currentUser,
              featureAccessConfigured: true,
              enabledFeatures: Array.isArray(featureAccess.enabled_features)
                ? featureAccess.enabled_features
                : [],
            }
          : currentUser;

        setUser(effectiveUser);

        const defaultLandingPath = getDefaultLandingPath(effectiveUser);
        if (
          pathname === "/dashboard/hr" &&
          defaultLandingPath.startsWith("/dashboard/hr/")
        ) {
          router.replace(defaultLandingPath);
          return;
        }

        if (pathname && !isPathAllowedForUser(effectiveUser, pathname)) {
          router.replace(
            getRestrictedRootFallback(effectiveUser, pathname) ||
              defaultLandingPath,
          );
        }
      } catch (error: any) {
        const message = error?.message || "";
        const isUnauthorized =
          message.includes("401") ||
          message.toLowerCase().includes("unauthorized") ||
          message.toLowerCase().includes("invalid token");
        if (isUnauthorized) {
          localStorage.removeItem("accessToken");
          localStorage.removeItem("refreshToken");
          localStorage.removeItem("user");
          localStorage.removeItem("userId");
          localStorage.removeItem("tenant");
          localStorage.removeItem("tenantId");
          if (!cancelled) router.replace("/login");
        }
      }
    };

    syncCurrentUser();

    return () => {
      cancelled = true;
    };
  }, [pathname, router, setUser]);

  // Don't show breadcrumbs on the root dashboard page
  const isEmployeeSelfService =
    pathname?.startsWith("/dashboard/hr/employees") ?? false;
  const showBreadcrumbs = pathname !== "/dashboard" && !isEmployeeSelfService;

  // Update page title based on current route
  useEffect(() => {
    if (!pathname) return;

    const getPageTitle = (path: string): string => {
      // Remove /dashboard prefix and get the last segment
      const cleanPath = path
        .replace("/dashboard/", "")
        .replace("/dashboard", "");

      // Map paths to titles
      const pathTitles: Record<string, string> = {
        "": "Dashboard",
        purchase: "Purchase",
        "purchase/requisitions": "Purchase Requisitions",
        "purchase/orders": "Purchase Orders",
        "purchase/vendors": "Vendors",
        "purchase/grn": "GRN",
        "purchase/debit-notes": "Debit Notes",
        inventory: "Inventory",
        "inventory/siv": "Store Issue Vouchers",
        "inventory/srv": "Store Receipt Vouchers",
        "inventory/stock-adjustments": "Stock Adjustments",
        "inventory/low-stock": "Low Stock Planning",
        "inventory/store-vouchers": "Store Vouchers",
        production: "Production",
        "production/job-orders": "Job Orders",
        "production/mrp": "Material Planning (MRP)",
        "production/smart-planning": "Smart Production Planning",
        "production/planning-control-tower":
          "Production Planning Control Tower",
        "production/planning-configuration": "MRP & APS Configuration",
        "production/autonomy": "Production Autonomy Control Tower",
        "production/work-stations": "Work Stations",
        "production/shop-floor": "Shop Floor",
        quality: "Quality Control",
        sales: "Sales",
        service: "Service",
        accounts: "Accounts",
        "accounts/margin-control": "Margin-to-Cash Control Tower",
        "accounts/costing": "Cost & Margin Control",
        "accounts/collections": "Collections Worklist",
        "accounts/payables": "Accounts Payable",
        "accounts/supplier-invoices": "Supplier Invoices",
        reports: "Reports",
        hr: "HR",
        documents: "Documents",
        uid: "UID",
        "uid/trace": "UID Trace",
        settings: "Settings",
        manager: "Manager Dashboard",
      };

      // Check for exact match first
      if (pathTitles[cleanPath]) {
        return pathTitles[cleanPath];
      }

      // Check for partial matches (e.g., purchase/orders/123 should show "Purchase Orders")
      for (const [key, title] of Object.entries(pathTitles)) {
        if (cleanPath.startsWith(key + "/") || cleanPath === key) {
          return title;
        }
      }

      // Fallback: capitalize each segment
      return (
        cleanPath
          .split("/")
          .map((s) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " "))
          .join(" - ") || "Dashboard"
      );
    };

    const pageTitle = getPageTitle(pathname);
    document.title = `${pageTitle} | SAK ERP`;
  }, [pathname]);

  return (
    <SecurityWrapper>
      <div className="min-h-screen bg-[#FAF9F6] dark:bg-[#2B211B]">
        {/* Command palette — global Cmd+K */}
        <CommandPalette />
        {/* Confirm dialog portal */}
        <ConfirmDialogProvider />
        <DashboardReminders />
        <GovernanceRequiredNotice />

        <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
        <main
          className={`min-h-screen min-w-0 overflow-x-hidden pb-20 transition-all duration-300 md:pb-0 ${
            sidebarCollapsed ? "dashboard-main-collapsed md:ml-16" : "dashboard-main-expanded md:ml-56"
          }`}
        >
          {/* Top sub-header with breadcrumbs */}
          {showBreadcrumbs && (
            <div className="sticky top-0 z-30 border-b border-[#E8DCC4] bg-white/90 px-3 py-2 shadow-sm backdrop-blur-xl sm:px-4 lg:px-6 lg:py-3">
              <div className="flex items-center justify-between gap-3">
                <Breadcrumbs />
              </div>
            </div>
          )}
          <div
            className={`min-w-0 ${isEmployeeSelfService ? "p-0 md:p-3 lg:p-4" : "p-2 sm:p-3 lg:p-4"}`}
          >
            {children}
          </div>
        </main>
      </div>
    </SecurityWrapper>
  );
}
