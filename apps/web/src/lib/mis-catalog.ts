import { getUserRoleNames, isAdminLike, type StoredUser } from "@/lib/rbac";

export type MisPersona = {
  domain: "executive" | "finance" | "sales" | "operations";
  slug: string;
  title: string;
  shortTitle: string;
  audience: string;
  description: string;
  roleTerms: string[];
  metricKeys: string[];
  quickReports: Array<{ label: string; description: string; href: string }>;
};

export const MIS_PERSONAS: MisPersona[] = [
  {
    domain: "executive", slug: "overview", title: "Executive Business Pulse", shortTitle: "Business Pulse",
    audience: "Owner, CEO, MD and Directors", description: "The few numbers, risks and decisions that need management attention now.",
    roleTerms: ["OWNER", "CEO", "MANAGING DIRECTOR", "DIRECTOR", "SUPER ADMIN"], metricKeys: ["approvals", "poExposure", "invoiced", "advance", "stockRisk", "wip"],
    quickReports: [
      { label: "Cash & working capital", description: "Payables, receivables and advances", href: "/dashboard/reports/finance/manager" },
      { label: "Sales performance", description: "Pipeline, orders and collections", href: "/dashboard/reports/sales/manager" },
      { label: "Operations control", description: "Supply, stock, production and quality", href: "/dashboard/reports/operations/control" },
    ],
  },
  {
    domain: "finance", slug: "manager", title: "Finance Manager Cockpit", shortTitle: "Finance Manager",
    audience: "CFO, Finance Manager and Commercial Head", description: "Cash exposure, overdue risk, supplier obligations and close exceptions.",
    roleTerms: ["CFO", "FINANCE MANAGER", "COMMERCIAL MANAGER", "FINANCE HEAD", "OWNER"], metricKeys: ["invoiced", "advance", "poExposure", "approvals"],
    quickReports: [
      { label: "Accounts payable", description: "Supplier balances, overdue and open advances", href: "/dashboard/accounts/payables" },
      { label: "Supplier invoices", description: "Invoice register and approval status", href: "/dashboard/accounts/supplier-invoices" },
      { label: "Cash forecast", description: "Expected inflows and outflows", href: "/dashboard/accounts/cash-forecast" },
      { label: "Bank reconciliation", description: "Unmatched bank and ledger entries", href: "/dashboard/accounts/bank-reconciliation" },
    ],
  },
  {
    domain: "finance", slug: "accountant", title: "Accountant Daily Control", shortTitle: "Accountant",
    audience: "Accountants and finance operators", description: "Today's posting workload, blocked documents and reconciliation actions.",
    roleTerms: ["ACCOUNTANT", "ACCOUNTS", "FINANCE EXECUTIVE"], metricKeys: ["invoiced", "advance", "approvals"],
    quickReports: [
      { label: "Supplier invoices", description: "Review, post and resolve exceptions", href: "/dashboard/accounts/supplier-invoices" },
      { label: "Accounts payable", description: "Settlement-ready supplier documents", href: "/dashboard/accounts/payables" },
      { label: "GR/IR control", description: "Receipts pending invoice or match", href: "/dashboard/purchase/grn" },
      { label: "Payment runs", description: "Prepare governed supplier payments", href: "/dashboard/accounts/payment-runs" },
    ],
  },
  {
    domain: "sales", slug: "manager", title: "Sales Manager Cockpit", shortTitle: "Sales Manager",
    audience: "Sales Head and Sales Managers", description: "Pipeline quality, conversion, order fulfilment, margin and collection risk.",
    roleTerms: ["SALES HEAD", "SALES MANAGER", "COMMERCIAL MANAGER", "OWNER"], metricKeys: [],
    quickReports: [
      { label: "Lead pipeline", description: "Stage value, ageing and conversion", href: "/dashboard/crm?tab=pipeline" },
      { label: "Quotations", description: "Open, expiring and converted quotations", href: "/dashboard/sales?tab=quotations" },
      { label: "Sales orders", description: "Bookings and fulfilment readiness", href: "/dashboard/sales?tab=orders" },
      { label: "Collections", description: "Receivables and overdue follow-up", href: "/dashboard/sales?tab=collections" },
    ],
  },
  {
    domain: "sales", slug: "territory", title: "Territory Performance", shortTitle: "Territory Manager",
    audience: "Regional and Territory Managers", description: "Territory pipeline, customer coverage, target progress and team follow-ups.",
    roleTerms: ["TERRITORY MANAGER", "REGIONAL MANAGER", "AREA SALES MANAGER"], metricKeys: [],
    quickReports: [
      { label: "Territory pipeline", description: "Leads and opportunities by stage", href: "/dashboard/crm?tab=pipeline" },
      { label: "Customer coverage", description: "Accounts, contacts and recent activity", href: "/dashboard/sales?tab=customers" },
      { label: "Team follow-ups", description: "Due and overdue sales activities", href: "/dashboard/crm?tab=follow-ups" },
    ],
  },
  {
    domain: "sales", slug: "executive", title: "My Sales Day", shortTitle: "Sales Executive",
    audience: "Sales Executives and Salespeople", description: "My pipeline, follow-ups, quotations, orders and collection actions for today.",
    roleTerms: ["SALES EXECUTIVE", "SALESPERSON", "SALESMAN", "BUSINESS DEVELOPMENT"], metricKeys: [],
    quickReports: [
      { label: "My leads", description: "Assigned leads and next actions", href: "/dashboard/crm?tab=leads" },
      { label: "My follow-ups", description: "Today and overdue activities", href: "/dashboard/crm?tab=follow-ups" },
      { label: "My quotations", description: "Draft, sent and expiring offers", href: "/dashboard/sales?tab=quotations" },
    ],
  },
  {
    domain: "operations", slug: "control", title: "Operations Control Tower", shortTitle: "Operations",
    audience: "Operations, Procurement, Stores, Production and Quality Heads", description: "Material availability, purchasing, WIP and quality exceptions in one decision view.",
    roleTerms: ["OPERATIONS", "PROCUREMENT", "PURCHASE", "PRODUCTION", "STORE", "INVENTORY", "QUALITY", "OWNER"], metricKeys: ["approvals", "poExposure", "stockRisk", "wip"],
    quickReports: [
      { label: "Purchase commitments", description: "PR, PO and expected receipts", href: "/dashboard/purchase/orders" },
      { label: "Inventory risk", description: "Low stock and master-data exceptions", href: "/dashboard/inventory/items" },
      { label: "Production WIP", description: "Open jobs and execution blockers", href: "/dashboard/production/job-orders" },
      { label: "Quality queue", description: "Pending inspection and NCR actions", href: "/dashboard/quality" },
    ],
  },
];

const normalize = (value: string) => value.toUpperCase().replace(/[_-]+/g, " ").trim();

export function getAllowedMisPersonas(user: StoredUser | null): MisPersona[] {
  if (isAdminLike(user)) return MIS_PERSONAS;
  const roles = getUserRoleNames(user).map(normalize);
  const allowed = MIS_PERSONAS.filter((persona) => persona.roleTerms.some((term) => roles.some((role) => role.includes(term) || term.includes(role))));
  return allowed;
}

export const getMisPersona = (domain: string, slug: string) => MIS_PERSONAS.find((persona) => persona.domain === domain && persona.slug === slug);

export function getDefaultMisHref(user: StoredUser | null): string {
  const first = getAllowedMisPersonas(user)[0];
  return first ? `/dashboard/reports/${first.domain}/${first.slug}` : "/dashboard/unauthorized";
}
