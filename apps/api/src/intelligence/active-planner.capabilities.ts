export type PlannerIntent =
  | "PURCHASE_REQUISITION"
  | "PURCHASE_ORDER"
  | "GOODS_RECEIPT"
  | "SERVICE_ENTRY"
  | "SALES_QUOTATION"
  | "SALES_ORDER"
  | "SALES_INVOICE"
  | "CUSTOMER_RECEIPT"
  | "DISPATCH"
  | "STOCK_ISSUE"
  | "STOCK_RETURN"
  | "STOCK_ADJUSTMENT"
  | "PRODUCTION_PLAN"
  | "JOB_ORDER"
  | "MRP_RELEASE"
  | "FACTORY_READINESS"
  | "PRODUCTION_OVERRIDE"
  | "SUBCONTRACT_ORDER"
  | "QUALITY_INSPECTION"
  | "QUALITY_NCR"
  | "MAINTENANCE_WORK_ORDER"
  | "SERVICE_TICKET"
  | "PROJECT"
  | "JOURNAL_ENTRY"
  | "PAYMENT_RUN"
  | "EMPLOYEE"
  | "LEAVE_REQUEST"
  | "ATTENDANCE"
  | "PAYROLL_RUN"
  | "REPORT"
  | "AUTOMATION_RULE"
  | "CRM_ACTION"
  | "UNKNOWN";

export type PlannerCapability = {
  intent: PlannerIntent;
  module: string;
  label: string;
  route: string;
  mode: "NATIVE_DRAFT" | "CONTROLLED_WORKFLOW" | "ANALYSE";
  description: string;
  examples: string[];
  required: string[];
  never: string[];
};

export const ACTIVE_PLANNER_CAPABILITIES: PlannerCapability[] = [
  {
    intent: "CRM_ACTION",
    module: "Sales",
    label: "CRM action",
    route: "/dashboard/crm",
    mode: "CONTROLLED_WORKFLOW",
    description:
      "Create a lead, record or schedule a CRM activity, assign its owner, or move its pipeline stage.",
    examples: [
      "Create a lead for Acme Marine",
      "Schedule a follow-up with LEAD-2026-00001 tomorrow",
      "Assign Acme Marine to Ali",
      "Move Acme Marine to Qualified",
    ],
    required: ["CRM action", "lead/prospect", "action-specific details"],
    never: [
      "mark won without confirmation",
      "send customer communication automatically",
    ],
  },
  {
    intent: "PURCHASE_REQUISITION",
    module: "Procurement",
    label: "Purchase requisition",
    route: "/dashboard/purchase/requisitions",
    mode: "NATIVE_DRAFT",
    description: "Prepare a material or service requisition draft.",
    examples: ["Raise a PR for 50 bearings needed next Friday"],
    required: [
      "item or service",
      "quantity",
      "required date",
      "department/purpose",
    ],
    never: ["approve PR", "send RFQ"],
  },
  {
    intent: "PURCHASE_ORDER",
    module: "Procurement",
    label: "Purchase order",
    route: "/dashboard/purchase/orders",
    mode: "NATIVE_DRAFT",
    description: "Prepare a supplier PO draft from approved commercial inputs.",
    examples: ["Create a PO for Asons with 100 cartons of 8x80"],
    required: [
      "supplier",
      "item",
      "quantity",
      "rate",
      "delivery date",
      "delivery address",
    ],
    never: ["approve PO", "send supplier email"],
  },
  {
    intent: "GOODS_RECEIPT",
    module: "Inventory",
    label: "Goods receipt",
    route: "/dashboard/purchase/grn",
    mode: "CONTROLLED_WORKFLOW",
    description:
      "Validate PO, invoice and open quantity before preparing receipt.",
    examples: ["Receive 25 chargers against PO-210 invoice G26-0216"],
    required: [
      "purchase order",
      "invoice number/date/file",
      "received quantity",
      "warehouse",
    ],
    never: ["accept QC", "post stock silently"],
  },
  {
    intent: "SERVICE_ENTRY",
    module: "Procurement",
    label: "Service entry",
    route: "/dashboard/purchase/service-entries",
    mode: "CONTROLLED_WORKFLOW",
    description: "Prepare service acceptance against a service PO.",
    examples: ["Record transport service completion against PO-100"],
    required: ["service PO", "accepted quantity/value", "service date"],
    never: ["sanction invoice", "record payment"],
  },
  {
    intent: "SALES_QUOTATION",
    module: "Sales",
    label: "Sales quotation",
    route: "/dashboard/sales",
    mode: "NATIVE_DRAFT",
    description: "Prepare a customer quotation for review.",
    examples: ["Quote MOD for 100 drones at 10 lakhs each"],
    required: ["customer", "item", "quantity", "rate", "validity"],
    never: ["email customer", "convert automatically"],
  },
  {
    intent: "SALES_ORDER",
    module: "Sales",
    label: "Sales order",
    route: "/dashboard/sales",
    mode: "CONTROLLED_WORKFLOW",
    description: "Prepare an order pending commercial release.",
    examples: ["Create an order for MOD for 100 drones"],
    required: ["customer", "item", "quantity", "rate", "delivery date"],
    never: ["release order", "override credit block"],
  },
  {
    intent: "SALES_INVOICE",
    module: "Sales",
    label: "Sales invoice",
    route: "/dashboard/sales",
    mode: "CONTROLLED_WORKFLOW",
    description: "Find and validate an unbilled PGI dispatch before billing.",
    examples: ["Invoice MOD for 100 drones at 10 lakhs each"],
    required: ["customer", "item/dispatch", "quantity"],
    never: ["bypass Sales Order", "bypass PGI", "post duplicate invoice"],
  },
  {
    intent: "CUSTOMER_RECEIPT",
    module: "Accounts",
    label: "Customer receipt",
    route: "/dashboard/accounts/collections",
    mode: "CONTROLLED_WORKFLOW",
    description: "Prepare a receipt allocation against an open invoice.",
    examples: ["Record 5 lakhs received from MOD against INV-10"],
    required: ["customer/invoice", "amount", "method", "reference/date"],
    never: ["over-allocate", "reconcile bank automatically"],
  },
  {
    intent: "DISPATCH",
    module: "Sales",
    label: "Dispatch",
    route: "/dashboard/sales",
    mode: "CONTROLLED_WORKFLOW",
    description: "Prepare fulfilment/dispatch from a released unblocked order.",
    examples: ["Dispatch 20 drones against SO-100"],
    required: [
      "released Sales Order",
      "line quantity",
      "warehouse",
      "dispatch date",
    ],
    never: ["bypass availability", "post goods issue silently"],
  },
  {
    intent: "STOCK_ISSUE",
    module: "Inventory",
    label: "Stock issue",
    route: "/dashboard/inventory/siv",
    mode: "CONTROLLED_WORKFLOW",
    description: "Prepare a store issue against an authorized demand.",
    examples: ["Issue 20 bearings to job JO-10"],
    required: ["item", "quantity", "warehouse", "job/cost purpose"],
    never: ["create negative stock"],
  },
  {
    intent: "STOCK_RETURN",
    module: "Inventory",
    label: "Stock return",
    route: "/dashboard/inventory/srv",
    mode: "CONTROLLED_WORKFLOW",
    description: "Prepare a traceable store return.",
    examples: ["Return 5 unused bearings from JO-10"],
    required: ["original issue/job", "item", "quantity", "condition"],
    never: ["inflate stock without source"],
  },
  {
    intent: "STOCK_ADJUSTMENT",
    module: "Inventory",
    label: "Stock adjustment",
    route: "/dashboard/inventory/stock-adjustments",
    mode: "CONTROLLED_WORKFLOW",
    description: "Prepare a counted-stock variance for approval.",
    examples: ["Adjust item X down by 3 after cycle count"],
    required: ["item", "warehouse", "counted quantity", "reason/evidence"],
    never: ["post without approval"],
  },
  {
    intent: "PRODUCTION_PLAN",
    module: "Production",
    label: "Production plan",
    route: "/dashboard/production/smart-planning",
    mode: "NATIVE_DRAFT",
    description: "Prepare a manual or Sales Order-linked production program.",
    examples: ["Plan 100 drones for SO-100 by 30 September"],
    required: ["product/Sales Order", "quantity", "due date"],
    never: ["release jobs", "publish shifts"],
  },
  {
    intent: "JOB_ORDER",
    module: "Production",
    label: "Job order",
    route: "/dashboard/production/job-orders/smart-items",
    mode: "NATIVE_DRAFT",
    description: "Prepare a production job from valid BOM and demand.",
    examples: ["Create a job for 100 impellers by Monday"],
    required: ["product", "quantity", "BOM", "dates"],
    never: ["issue material", "complete production"],
  },
  {
    intent: "FACTORY_READINESS",
    module: "Production",
    label: "Factory readiness",
    route: "/dashboard/production/job-orders",
    mode: "ANALYSE",
    description:
      "Diagnose a Job Order's material cover, child supply, blockers and exact next controlled action.",
    examples: [
      "Is JO-2026-00010 ready for production?",
      "What should I do next for JO-2026-00010?",
      "Why is this job waiting for the previous operation?",
    ],
    required: ["job order"],
    never: ["invent stock", "bypass SIV, WIP, QC or approval controls"],
  },
  {
    intent: "MRP_RELEASE",
    module: "Production",
    label: "MRP release",
    route: "/dashboard/production/mrp",
    mode: "CONTROLLED_WORKFLOW",
    description:
      "Preview approved MRP recommendations and submit governed BUY/BUILD release packets for independent approval.",
    examples: [
      "Prepare the approved MRP recommendations for release",
      "Submit the latest MRP BUY and BUILD proposals for approval",
    ],
    required: ["latest MRP run", "recorded planner decisions"],
    never: ["approve its own recommendation", "release supply silently"],
  },
  {
    intent: "PRODUCTION_OVERRIDE",
    module: "Production",
    label: "Supervisor WIP override",
    route: "/dashboard/production/job-orders",
    mode: "CONTROLLED_WORKFLOW",
    description:
      "Create an expiring, audited WIP-predecessor override for an authorized production supervisor.",
    examples: [
      "Override the predecessor block for JO-2026-00010 for 30 minutes because batch 1 is physically verified",
    ],
    required: ["job order", "specific reason", "expiry"],
    never: ["exceed planned quantity", "override without supervisor authority"],
  },
  {
    intent: "SUBCONTRACT_ORDER",
    module: "Production",
    label: "Subcontract order",
    route: "/dashboard/production/subcontracting",
    mode: "NATIVE_DRAFT",
    description: "Prepare subcontract processing with input/output quantities.",
    examples: ["Send 100 castings to Vendor X for machining"],
    required: [
      "vendor",
      "operation",
      "input/output items",
      "quantities",
      "rates/dates",
    ],
    never: ["issue material", "approve QC", "pay vendor"],
  },
  {
    intent: "QUALITY_INSPECTION",
    module: "Quality",
    label: "Quality inspection",
    route: "/dashboard/quality",
    mode: "CONTROLLED_WORKFLOW",
    description: "Prepare an inspection against the source receipt/production.",
    examples: ["Inspect GRN-100 and sample 10 pieces"],
    required: [
      "source document",
      "sample/received quantity",
      "inspection plan",
    ],
    never: ["invent acceptance", "post scrap"],
  },
  {
    intent: "QUALITY_NCR",
    module: "Quality",
    label: "Quality NCR",
    route: "/dashboard/quality",
    mode: "CONTROLLED_WORKFLOW",
    description: "Prepare a non-conformance record with evidence.",
    examples: ["Raise NCR for 5 rejected impellers"],
    required: ["source/item", "affected quantity", "defect/evidence"],
    never: ["close NCR", "charge supplier automatically"],
  },
  {
    intent: "MAINTENANCE_WORK_ORDER",
    module: "Production",
    label: "Maintenance work order",
    route: "/dashboard/production/maintenance",
    mode: "CONTROLLED_WORKFLOW",
    description: "Prepare preventive or breakdown maintenance.",
    examples: ["Create urgent breakdown work order for CNC-2"],
    required: ["asset", "work type", "description", "priority/date"],
    never: ["mark completed"],
  },
  {
    intent: "SERVICE_TICKET",
    module: "Service",
    label: "Service ticket",
    route: "/dashboard/service",
    mode: "CONTROLLED_WORKFLOW",
    description: "Prepare a customer service request and entitlement check.",
    examples: ["Open a breakdown ticket for customer ABC"],
    required: ["customer", "asset/product", "issue", "priority/contact"],
    never: ["close ticket", "promise unsupported SLA"],
  },
  {
    intent: "PROJECT",
    module: "Projects",
    label: "Project",
    route: "/dashboard/projects",
    mode: "NATIVE_DRAFT",
    description: "Prepare a project charter and commercial baseline.",
    examples: ["Create project Alpha for customer MOD"],
    required: ["name", "customer/owner", "dates", "scope/budget"],
    never: ["approve budget", "post costs"],
  },
  {
    intent: "JOURNAL_ENTRY",
    module: "Accounts",
    label: "Journal entry",
    route: "/dashboard/accounts",
    mode: "NATIVE_DRAFT",
    description: "Prepare a balanced journal draft.",
    examples: ["Accrue 2 lakhs audit fees for August"],
    required: [
      "date",
      "narration",
      "balanced debit/credit accounts and values",
    ],
    never: ["approve journal", "post journal"],
  },
  {
    intent: "PAYMENT_RUN",
    module: "Accounts",
    label: "Payment run",
    route: "/dashboard/accounts/payment-runs",
    mode: "CONTROLLED_WORKFLOW",
    description: "Prepare eligible supplier liabilities for review.",
    examples: ["Prepare Friday payment run for approved invoices"],
    required: ["company/bank", "cut-off", "eligible invoices", "payment date"],
    never: ["approve", "post", "send remittance", "move cash"],
  },
  {
    intent: "EMPLOYEE",
    module: "HR",
    label: "Employee onboarding",
    route: "/dashboard/hr/management",
    mode: "NATIVE_DRAFT",
    description: "Prepare employee master onboarding.",
    examples: ["Add a new production engineer joining Monday"],
    required: [
      "identity",
      "contact",
      "joining date",
      "department/designation",
      "payroll details",
    ],
    never: ["invent identity/bank/tax data"],
  },
  {
    intent: "LEAVE_REQUEST",
    module: "HR",
    label: "Leave request",
    route: "/dashboard/hr/employees?tab=leaves",
    mode: "CONTROLLED_WORKFLOW",
    description: "Prepare a leave application and balance check.",
    examples: ["Apply casual leave next Monday"],
    required: ["employee", "leave type", "dates", "reason"],
    never: ["approve leave"],
  },
  {
    intent: "ATTENDANCE",
    module: "HR",
    label: "Attendance correction",
    route: "/dashboard/hr/management?tab=attendance",
    mode: "CONTROLLED_WORKFLOW",
    description: "Prepare an attendance correction with evidence.",
    examples: ["Correct yesterday checkout to 6:30 PM"],
    required: ["employee", "date", "correct time/status", "reason"],
    never: ["rewrite attendance silently"],
  },
  {
    intent: "PAYROLL_RUN",
    module: "HR",
    label: "Payroll run",
    route: "/dashboard/hr/management?tab=payroll",
    mode: "CONTROLLED_WORKFLOW",
    description: "Validate payroll period and prepare generation.",
    examples: ["Prepare August payroll"],
    required: [
      "period",
      "eligible employees",
      "attendance lock",
      "salary setup",
    ],
    never: ["approve payroll", "pay employees"],
  },
  {
    intent: "REPORT",
    module: "Reports",
    label: "Report/query",
    route: "/dashboard/reports",
    mode: "ANALYSE",
    description:
      "Answer a tenant-scoped operational question or open the report.",
    examples: ["Show overdue POs by supplier", "What is inventory ageing?"],
    required: ["question", "period/filters when ambiguous"],
    never: ["change transactions"],
  },
  {
    intent: "AUTOMATION_RULE",
    module: "Settings",
    label: "Automation rule",
    route: "/dashboard/automation",
    mode: "NATIVE_DRAFT",
    description: "Prepare a governed trigger/action rule.",
    examples: ["Remind purchase manager when PO is overdue by 3 days"],
    required: ["trigger", "conditions", "action", "recipients", "schedule"],
    never: ["activate rule", "send externally without consent"],
  },
];

export const capabilityFor = (intent: PlannerIntent) =>
  ACTIVE_PLANNER_CAPABILITIES.find((x) => x.intent === intent) || null;

const normalizeLaymanEnglish = (input: string) => {
  const typoAliases: Record<string, string> = {
    wht: "what",
    whats: "what is",
    hw: "how",
    wich: "which",
    remaning: "remaining",
    remainig: "remaining",
    quanitty: "quantity",
    quantitty: "quantity",
    peice: "piece",
    peices: "pieces",
    recieve: "receive",
    recieved: "received",
    suplier: "supplier",
    supplr: "supplier",
    suplr: "supplier",
    vender: "vendor",
    custmer: "customer",
    inventry: "inventory",
    stck: "stock",
    prodction: "production",
    manufaturing: "manufacturing",
    machne: "machine",
    maintainance: "maintenance",
    brokn: "broken",
    qoute: "quote",
    quatation: "quotation",
    invoce: "invoice",
    paymnt: "payment",
    attendence: "attendance",
    employe: "employee",
    folloup: "follow up",
  };
  return String(input || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[a-z]+/g, (word) => typoAliases[word] || word)
    .replace(/\s+/g, " ")
    .trim();
};

export function isJobCardDocumentLookup(input: string) {
  const value = String(input || "").toLowerCase();
  const hasJobCard =
    /\b(?:job\s*cards?|operation\s+cards?|production\s+sheets?)\b/.test(value);
  const hasLookupLanguage =
    /\b(?:show|get|find|display|open|print|download|select|view|latest|list|today(?:'s)?)\b/.test(
      value,
    );
  const hasMutation =
    /\b(?:create|raise|make|approve|edit|change|delete|cancel|convert|submit|allocate)\b/.test(
      value,
    );
  return hasJobCard && hasLookupLanguage && !hasMutation;
}

export function isReadOnlyDocumentLookup(input: string) {
  const value = String(input || "").toLowerCase();
  if (isJobCardDocumentLookup(value)) return true;
  const hasDocument =
    /\b(?:pos?|purchase orders?|prs?|purchase requisitions?|grns?|goods receipts?|sales orders?|job orders?|production orders?|job\s*cards?|production\s+sheets?|invoices?)\b/.test(
      value,
    );
  const hasLookupLanguage =
    /\b(?:show|get|find|display|print|download|select|looking for|latest|list)\b/.test(
      value,
    ) ||
    (/\b(?:need|want)\b/.test(value) &&
      /\b(?:no|number|from|dated|on|for|latest|open|pending|approved|rejected|supplier|vendor|customer)\b/.test(
        value,
      ));
  const hasMutation =
    /\b(?:create|raise|make|approve|edit|change|delete|cancel|convert|submit)\b/.test(
      value,
    );
  return hasDocument && hasLookupLanguage && !hasMutation;
}

export function detectPlannerIntent(input: string): PlannerIntent {
  const value = normalizeLaymanEnglish(input);
  if (isReadOnlyDocumentLookup(value)) return "REPORT";
  const rules: [PlannerIntent, RegExp][] = [
    [
      "CRM_ACTION",
      /\b(?:create|add|capture|assign|move|schedule|log|record|put|shift)\b.*\b(?:lead|prospect|enquiry|opportunity|follow.?up|pipeline|crm)\b|\b(?:lead|prospect|enquiry|opportunity)\b.*\b(?:qualified|contacted|negotiation|on hold|won|lost|under|owner)\b/,
    ],
    [
      "PURCHASE_REQUISITION",
      /\b(purchase requisition|raise (?:a )?pr|create (?:a )?pr|(?:buy|purchase) \d+(?!.*\bfrom\b)|(?:we|i|the team|maintenance|production)?\s*(?:need|want|require)\s+(?:to\s+buy\s+)?\d+|request \d+ .+ (?:for|needed by))\b/,
    ],
    ["QUALITY_INSPECTION", /\b(quality inspection|inspect|qc check)\b/],
    [
      "GOODS_RECEIPT",
      /\b(grn|goods receipt|receive goods|receive .+ against po|book .+(?:inward|arrival|delivery)|record .+(?:arrived|received).+\bpo\b)\b/,
    ],
    [
      "SERVICE_ENTRY",
      /\b(service entry|ses\b|accept service|record .+ service completion|(?:contractor|vendor) (?:finished|completed) .+\bpo\b|book completed service)\b/,
    ],
    [
      "PURCHASE_ORDER",
      /\b(purchase order|create (?:a )?po|\bpo for|procure|buy from|order \d+.*\bfrom|place (?:an? )?order .+\b(?:with|from)\b|send (?:an? )?order to (?:the )?(?:supplier|vendor))\b/,
    ],
    [
      "SALES_QUOTATION",
      /\b(quotation|sales quote|quote .+ for|prepare (?:a )?(?:price|offer) for (?:the )?(?:customer|client)|send (?:a )?price to (?:the )?(?:customer|client))\b/,
    ],
    [
      "SALES_INVOICE",
      /\b(sales invoice|invoice|bill customer|raise (?:a )?bill|bill (?:this|the) (?:delivery|dispatch|order))\b/,
    ],
    [
      "CUSTOMER_RECEIPT",
      /\b(customer receipt|payment received|record receipt|record .+ received from|book .+(?:customer payment|money received)|received from)\b/,
    ],
    [
      "DISPATCH",
      /\b(dispatch|delivery note|ship goods|send goods|send .+ to (?:the )?(?:customer|client)|deliver .+ against (?:the )?(?:sales order|so-))\b/,
    ],
    [
      "SALES_ORDER",
      /^(?!.*\b(?:make|manufacture|produce)\b).*\b(sales order|customer order|create (?:an )?order for|book (?:the )?(?:customer|client) order|customer .+ confirmed (?:the )?order)\b/,
    ],
    [
      "STOCK_ISSUE",
      /\b(siv|stock issue|store issue|issue material|issue \d+ .+ to (?:job|employee)|(?:give|send|take) .+ material (?:to|for) (?:the )?(?:job|worker|employee|production))\b/,
    ],
    [
      "STOCK_RETURN",
      /\b(srv|stock return|store return|return unused|return \d+ (?:unused|.+ from employee)|put (?:the )?unused material back (?:in|to) (?:the )?(?:store|warehouse))\b/,
    ],
    [
      "STOCK_ADJUSTMENT",
      /\b(stock adjustment|stock count|set stock count|adjust stock|adjust item|cycle count variance|physical count (?:is|shows|says)|system stock is wrong)\b/,
    ],
    ["SUBCONTRACT_ORDER", /\b(subcontract|job work|send .+ machining)\b/],
    [
      "PRODUCTION_OVERRIDE",
      /\b(?:override|temporarily allow|supervisor release)\b.*\b(?:predecessor|previous (?:operation|stage)|wip|job order|jo-)/,
    ],
    [
      "MRP_RELEASE",
      /\b(?:prepare|preview|submit|request|release)\b.*\bmrp\b|\bmrp\b.*\b(?:release|approval|approved recommendations?)\b/,
    ],
    [
      "FACTORY_READINESS",
      /\b(?:factory readiness|ready (?:for|to) (?:production|release)|production blockers?|material cover|what (?:should i|do i) do next|what is left|can we (?:start|make|continue)|why (?:is|has) .+ (?:stuck|stopped|held)|next (?:production )?(?:step|action)|waiting for (?:the )?previous (?:operation|stage)|partial batch|parallel (?:operation|machine))\b.*(?:\bjo-[a-z0-9-]+\b|\bjob order\b)|(?:\bjo-[a-z0-9-]+\b|\bjob order\b).*\b(?:ready|readiness|block|next|waiting|partial|parallel|left|start|stuck|stopped|held|continue)\b/,
    ],
    [
      "PRODUCTION_PLAN",
      /\b(production plan|plan production|plan \d+ .+ for so-|smart planning|(?:make|manufacture|produce) \d+ .+ (?:for|against) (?:sales order|so-))\b/,
    ],
    [
      "JOB_ORDER",
      /\b(job order|production order|create (?:a )?job|manufacture|make \d+|produce \d+|build \d+|assemble \d+|(?:we|i|production)?\s*(?:need|want|have) to (?:make|build|produce|assemble)\b|create \d+\s*(?:pcs?|pieces?|nos?|units?))\b/,
    ],
    [
      "QUALITY_NCR",
      /\b(ncr|non.?conformance|record .+(?:bad|rejected|defective) (?:piece|pieces|parts|items)|raise .+(?:quality problem|defect))\b/,
    ],
    [
      "SERVICE_TICKET",
      /\b(service ticket|support ticket|customer complaint|service request|open .+ ticket|log .+(?:customer|client) complaint|customer says .+(?:not working|broken|failed))\b/,
    ],
    [
      "MAINTENANCE_WORK_ORDER",
      /\b(maintenance|breakdown|repair .+ machine|preventive work|fix (?:the )?(?:machine|equipment)|(?:machine|equipment|press|line) .+(?:not working|broken|stopped|making noise|overheating))\b/,
    ],
    ["PROJECT", /\b(create|start|open) (?:a )?project\b/],
    ["JOURNAL_ENTRY", /\b(journal entry|journals?|accrue|provision entry)\b/],
    [
      "PAYMENT_RUN",
      /\b(payment run|supplier payments|pay approved invoices|pay (?:every|all|the) .*supplier|pay .*supplier.*(?:invoice|due|overdue))\b/,
    ],
    [
      "LEAVE_REQUEST",
      /\b(leave request|apply .+ leave|take leave|need (?:a )?day off|will not (?:come|be in) .+(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday))\b/,
    ],
    [
      "ATTENDANCE",
      /\b(attendance|check.?in|check.?out|forgot to (?:punch|check)|(?:punch|attendance time) (?:is|was) (?:wrong|missing))\b/,
    ],
    ["PAYROLL_RUN", /\b(payroll|salary run|run (?:the )?(?:salaries|wages))\b/],
    [
      "EMPLOYEE",
      /\b(add|create|onboard) (?:an? |a new )?employee\b|\badd a new .+ joining\b/,
    ],
    [
      "AUTOMATION_RULE",
      /\b(automation rule|automate|when .+ then|remind .+ when)\b/,
    ],
    [
      "REPORT",
      /\b(show|report|list|how many|what is|analyse|analyze|dashboard|print|download|export|p ?& ?l|pnl|profit and loss|income statement|costing sheet|cost sheet)\b|^(?:what|which|who|where|when|why|how|is|are|do|does|did|has|have)\b/,
    ],
  ];
  return rules.find(([, pattern]) => pattern.test(value))?.[0] || "UNKNOWN";
}
