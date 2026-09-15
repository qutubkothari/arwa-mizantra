"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiClient } from "../../../../lib/api-client";

type Tab =
  | "overview"
  | "chart"
  | "cost-centres"
  | "posting-rules"
  | "recurring-journals"
  | "exchange-rates"
  | "parties"
  | "journals"
  | "reports"
  | "business-impact"
  | "receivables"
  | "payables"
  | "payment-runs"
  | "opening-balances"
  | "statutory"
  | "report-schedules"
  | "workflow"
  | "bank"
  | "tax"
  | "assets"
  | "budgets"
  | "periods";
type FormKind =
  | "account"
  | "cost-centre"
  | "posting-rule"
  | "posting-preview"
  | "exchange-rate"
  | "party"
  | "period"
  | "journal"
  | "open-item"
  | "voucher"
  | "bank"
  | "bank-transaction"
  | "bank-import"
  | "tax"
  | "asset"
  | "budget"
  | null;
const tabs: Array<[Tab, string]> = [
  ["overview", "Overview"],
  ["chart", "Chart of accounts"],
  ["cost-centres", "Cost centres"],
  ["posting-rules", "Posting rules"],
  ["recurring-journals", "Recurring journals"],
  ["exchange-rates", "Exchange rates"],
  ["parties", "Parties"],
  ["journals", "Journals"],
  ["reports", "Reports"],
  ["business-impact", "Business impact"],
  ["receivables", "Receivables"],
  ["payables", "Payables"],
  ["payment-runs", "Payment runs"],
  ["opening-balances", "Opening balances"],
  ["statutory", "Statutory returns"],
  ["report-schedules", "Report schedules"],
  ["workflow", "Workflow roles"],
  ["bank", "Banking"],
  ["tax", "Tax"],
  ["assets", "Fixed assets"],
  ["budgets", "Budgets"],
  ["periods", "Periods"],
];
const financeNavigation: Array<{
  label: string;
  items: Array<[Tab, string, string]>;
}> = [
  {
    label: "Daily finance",
    items: [
      ["overview", "Overview", "Control position and exceptions"],
      ["receivables", "Receivables", "Customer open items and settlements"],
      ["payables", "Payables", "Supplier open items and settlements"],
      [
        "payment-runs",
        "Payment runs",
        "Prepare, approve and post controlled bulk payments",
      ],
    ],
  },
  {
    label: "Management & reporting",
    items: [
      ["reports", "Reports", "Trial balance, P&L and balance sheet"],
      [
        "business-impact",
        "Business impact",
        "Cash, working capital and transparent ROI scenario",
      ],
    ],
  },
  {
    label: "General ledger",
    items: [
      ["chart", "Chart of accounts", "Ledgers and control accounts"],
      [
        "cost-centres",
        "Cost centres",
        "Projects, departments and profitability",
      ],
      [
        "posting-rules",
        "Posting rules",
        "Controlled source debit and credit mapping",
      ],
      [
        "recurring-journals",
        "Recurring journals",
        "Generate reviewed repeat voucher drafts",
      ],
      ["journals", "Journal entries", "Draft, post and reverse vouchers"],
      [
        "workflow",
        "Workflow roles",
        "Assign independent preparer, reviewer, approver and poster roles",
      ],
      ["periods", "Periods", "Close and lock accounting periods"],
    ],
  },
  {
    label: "Subledgers",
    items: [
      ["parties", "Business partners", "Customers, suppliers and employees"],
      [
        "opening-balances",
        "Opening balances",
        "Controlled migration and suspense reconciliation",
      ],
    ],
  },
  {
    label: "Treasury & controls",
    items: [
      ["bank", "Banking", "Bank accounts and reconciliation"],
      [
        "exchange-rates",
        "Exchange rates",
        "Dated transaction-currency conversion control",
      ],
      ["tax", "Tax", "GST, VAT and withholding codes"],
      [
        "statutory",
        "Statutory returns",
        "Review, file and audit GST, VAT and withholding returns",
      ],
      [
        "report-schedules",
        "Report schedules",
        "Controlled recurring management-report distribution",
      ],
      ["assets", "Fixed assets", "Asset register and depreciation"],
      ["budgets", "Budgets", "Budgets and approval control"],
    ],
  },
];
const money = (value: unknown) =>
  `\u20B9${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);
const date = (value: unknown) => (value ? String(value).slice(0, 10) : "-");
const due = (row: any) =>
  Number(row.original_amount || 0) - Number(row.settled_amount || 0);
const accountName = (accounts: any[], id: string | null | undefined) =>
  accounts.find((account) => account.id === id)
    ? `${accounts.find((account) => account.id === id).account_code} — ${accounts.find((account) => account.id === id).account_name}`
    : "-";

export default function AccountsPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [form, setForm] = useState<FormKind>(null);
  const [voucherDirection, setVoucherDirection] = useState<
    "RECEIVABLE" | "PAYABLE"
  >("RECEIVABLE");
  const [data, setData] = useState<any>({
    accounts: [],
    costCentres: [],
    postingRules: [],
    recurringJournals: [],
    exchangeRates: [],
    parties: [],
    periods: [],
    journals: [],
    trial: [],
    pl: null,
    bs: null,
    receivables: [],
    payables: [],
    paymentRuns: [],
    openingBalances: [],
    statutoryReturns: [],
    reportSchedules: [],
    workflowRoles: [],
    workflowUsers: [],
    bank: [],
    bankTransactions: [],
    tax: [],
    assets: [],
    budgets: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [journalActionError, setJournalActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [ledger, setLedger] = useState<any>(null);
  const [editingAccount, setEditingAccount] = useState<any>(null);
  const [editingCostCentre, setEditingCostCentre] = useState<any>(null);
  const [editingPostingRule, setEditingPostingRule] = useState<any>(null);
  const [previewPostingRule, setPreviewPostingRule] = useState<any>(null);
  const [editingExchangeRate, setEditingExchangeRate] = useState<any>(null);
  const [recurringEditor, setRecurringEditor] = useState<any>(null);
  const [editingParty, setEditingParty] = useState<any>(null);
  const [editingJournal, setEditingJournal] = useState<any>(null);
  const [journalView, setJournalView] = useState<any>(null);
  async function load() {
    setLoading(true);
    setError("");
    const paths = [
      "/accounting/accounts",
      "/accounting/cost-centres",
      "/accounting/posting-rules",
      "/accounting/recurring-journals",
      "/accounting/exchange-rates",
      "/accounting/parties",
      "/accounting/periods",
      "/accounting/journals",
      "/accounting/trial-balance",
      "/accounting/reports/profit-loss",
      "/accounting/reports/balance-sheet",
      "/accounting/open-items?direction=RECEIVABLE",
      "/accounting/open-items?direction=PAYABLE",
      "/accounting/payment-runs",
      "/accounting/opening-balances",
      "/accounting/statutory-returns",
      "/accounting/report-schedules",
      "/accounting/workflow-roles",
      "/accounting/workflow-users",
      "/accounting/bank-accounts",
      "/accounting/bank-transactions",
      "/accounting/tax-codes",
      "/accounting/fixed-assets",
      "/accounting/budgets",
    ];
    const results = await Promise.allSettled(
      paths.map((path) => apiClient.get(path)),
    );
    const get = (index: number, fallback: any) =>
      results[index].status === "fulfilled"
        ? (results[index] as PromiseFulfilledResult<any>).value
        : fallback;
    setData({
      accounts: get(0, []),
      costCentres: get(1, []),
      postingRules: get(2, []),
      recurringJournals: get(3, []),
      exchangeRates: get(4, []),
      parties: get(5, []),
      periods: get(6, []),
      journals: get(7, []),
      trial: get(8, []),
      pl: get(9, null),
      bs: get(10, null),
      receivables: get(11, []),
      payables: get(12, []),
      paymentRuns: get(13, []),
      openingBalances: get(14, []),
      statutoryReturns: get(15, []),
      reportSchedules: get(16, []),
      workflowRoles: get(17, []),
      workflowUsers: get(18, []),
      bank: get(19, []),
      bankTransactions: get(20, []),
      tax: get(21, []),
      assets: get(22, []),
      budgets: get(23, []),
    });
    if (results.some((result) => result.status === "rejected"))
      setError(
        "Some accounting data could not be loaded. Confirm the Mizantra accounting migrations are applied and your role has Accounts access.",
      );
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);
  async function action(
    run: () => Promise<any>,
    message: string,
    surface: "page" | "form" = "page",
    setLocalError?: (value: string) => void,
  ) {
    if (surface === "form") setFormError("");
    else setError("");
    setNotice("");
    setLocalError?.("");
    try {
      await run();
      setNotice(message);
      setForm(null);
      setEditingJournal(null);
      setEditingAccount(null);
      setEditingPostingRule(null);
      setEditingParty(null);
      setFormError("");
      await load();
      return true;
    } catch (caught: any) {
      const message =
        caught?.message ||
        "The requested accounting action could not be completed.";
      if (setLocalError) setLocalError(message);
      else if (surface === "form") setFormError(message);
      else setError(message);
      return false;
    }
  }
  async function showLedger(account: any) {
    try {
      setError("");
      setLedger(
        await apiClient.get(`/accounting/accounts/${account.id}/ledger`),
      );
    } catch (caught: any) {
      setError(caught?.message || "The account ledger could not be loaded.");
    }
  }
  const totals = useMemo(
    () =>
      data.trial.reduce(
        (sum: any, item: any) => ({
          debit: sum.debit + Number(item.debit || 0),
          credit: sum.credit + Number(item.credit || 0),
        }),
        { debit: 0, credit: 0 },
      ),
    [data.trial],
  );
  const accounts = data.accounts.filter((item: any) =>
    `${item.account_code} ${item.account_name} ${item.account_type}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const receivable = data.receivables
    .filter((item: any) => ["OPEN", "PARTIAL"].includes(item.status))
    .reduce((sum: number, item: any) => sum + due(item), 0);
  const payable = data.payables
    .filter((item: any) => ["OPEN", "PARTIAL"].includes(item.status))
    .reduce((sum: number, item: any) => sum + due(item), 0);
  const primaryFinanceGroups = financeNavigation.slice(0, 3);
  const controlFinanceGroups = financeNavigation.slice(3);
  return (
    <main className="p-6 space-y-5">
      <header className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-[#9a7445]">
            Finance &amp; accounting
          </p>
          <h1 className="text-3xl font-semibold text-[#2e241d]">
            Accounts control centre
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Controlled double-entry accounting, AR/AP, banking, tax, assets and
            management reporting.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setFormError("");
              setEditingJournal(null);
              setForm("journal");
            }}
            className="px-4 py-2 rounded-lg bg-[#6b4d2e] text-white"
          >
            + Journal entry
          </button>
          <button onClick={load} className="px-4 py-2 border rounded-lg">
            Refresh
          </button>
        </div>
      </header>
      {notice && (
        <Banner tone="success" text={notice} close={() => setNotice("")} />
      )}
      {error && <Banner tone="error" text={error} close={() => setError("")} />}
      <section className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <Metric label="Ledger accounts" value={data.accounts.length} />
        <Metric
          label="Posted journals"
          value={
            data.journals.filter((item: any) => item.status === "POSTED").length
          }
        />
        <Metric label="Receivables open" value={money(receivable)} />
        <Metric label="Payables open" value={money(payable)} />
      </section>
      <section className="border rounded-xl bg-white shadow-sm overflow-hidden">
        <div className="lg:grid lg:grid-cols-[250px_minmax(0,1fr)]">
          <aside className="border-b lg:border-b-0 lg:border-r bg-[#fcfaf7] p-3 lg:p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <p className="text-xs uppercase tracking-widest text-[#9a7445]">
                  Finance workbench
                </p>
                <p className="text-sm font-semibold text-[#2e241d]">
                  Navigate by process
                </p>
              </div>
            </div>
            <label className="lg:hidden block text-sm text-gray-700">
              <span className="sr-only">Accounting section</span>
              <select
                value={tab}
                onChange={(event) => setTab(event.target.value as Tab)}
                className="w-full rounded-lg border px-3 py-2"
              >
                {financeNavigation.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.items.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <nav
              aria-label="Accounting navigation"
              className="hidden lg:block space-y-4"
            >
              {primaryFinanceGroups.map((group) => (
                <div key={group.label}>
                  <p className="px-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-[#8b6f47]">
                    {group.label}
                  </p>
                  <div className="space-y-1">
                    {group.items.map(([key, label, description]) => (
                      <button
                        key={key}
                        onClick={() => setTab(key)}
                        className={`w-full text-left rounded-lg px-3 py-2 transition-colors ${tab === key ? "bg-[#9a7445] text-white shadow-sm" : "text-[#4d3b2b] hover:bg-[#f1e9dd]"}`}
                      >
                        <span className="block text-sm font-medium">
                          {label}
                        </span>
                        <span
                          className={`block text-xs mt-0.5 ${tab === key ? "text-white/80" : "text-[#7a6858]"}`}
                        >
                          {description}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <details className="group border-t border-[#E8DCC4] pt-3" open={controlFinanceGroups.some((group) => group.items.some(([key]) => key === tab))}>
                <summary className="cursor-pointer list-none px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#8b6f47] hover:bg-[#f1e9dd]">General ledger, treasury &amp; controls</summary>
                <div className="mt-3 space-y-4">
                  {controlFinanceGroups.map((group) => (
                    <div key={group.label}>
                      <p className="px-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-[#8b6f47]">{group.label}</p>
                      <div className="space-y-1">
                        {group.items.map(([key, label, description]) => (
                          <button key={key} onClick={() => setTab(key)} className={`w-full text-left rounded-lg px-3 py-2 transition-colors ${tab === key ? "bg-[#9a7445] text-white shadow-sm" : "text-[#4d3b2b] hover:bg-[#f1e9dd]"}`}>
                            <span className="block text-sm font-medium">{label}</span>
                            <span className={`block text-xs mt-0.5 ${tab === key ? "text-white/80" : "text-[#7a6858]"}`}>{description}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </nav>
          </aside>
          <div className="min-w-0">
            <div className="border-b px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-widest text-[#9a7445]">
                  {financeNavigation
                    .flatMap((group) => group.items)
                    .find(([key]) => key === tab)?.[1] || "Overview"}
                </p>
                <p className="text-sm text-gray-600">
                  Role-based accounting workspace with controlled postings and
                  audit trail.
                </p>
              </div>
              <button
                onClick={() => {
                  setFormError("");
                  setEditingJournal(null);
                  setForm("journal");
                }}
                className="text-sm px-3 py-2 rounded-lg border border-[#9a7445] text-[#6b4d2e] hover:bg-[#f7f1e7]"
              >
                + Journal entry
              </button>
            </div>
            {tab === "overview" && (
              <div className="p-5 grid md:grid-cols-3 gap-4">
                <Metric
                  label="Total assets"
                  value={money(data.bs?.total_assets)}
                />
                <Metric
                  label="Net profit / (loss)"
                  value={money(data.pl?.net_profit)}
                />
                <Metric
                  label="Trial balance difference"
                  value={money(totals.debit - totals.credit)}
                />
                <div className="md:col-span-3 border rounded-xl p-4 text-sm text-gray-600">
                  <strong className="block text-[#2e241d] mb-1">
                    Control status
                  </strong>
                  Only posted journals affect reporting. Closing a period
                  requires all draft entries in that period to be posted or
                  cancelled.
                </div>
              </div>
            )}
            {tab === "chart" && (
              <>
                <Toolbar
                  placeholder="Search account code or name"
                  search={search}
                  change={setSearch}
                  create={() => {
                    setEditingAccount(null);
                    setFormError("");
                    setForm("account");
                  }}
                  label="New account"
                />
                <div className="px-3 pb-3 text-sm text-gray-600 flex flex-wrap items-center gap-3">
                  <span>
                    First-time setup: add the standard India chart, then
                    customise it for your company.
                  </span>
                  <button
                    className={softButton}
                    onClick={() =>
                      action(
                        () =>
                          apiClient.post("/accounting/accounts/seed-defaults"),
                        "Starter chart of accounts is ready to review and customise.",
                      )
                    }
                  >
                    Load starter chart
                  </button>
                </div>
                <Grid
                  headers={[
                    "Code",
                    "Account",
                    "Type",
                    "Subtype",
                    "Control",
                    "Opening balance",
                    "Status",
                    "Actions",
                  ]}
                  rows={accounts.map((item: any) => [
                    item.account_code,
                    item.account_name,
                    item.account_type,
                    item.account_subtype || "-",
                    item.is_control_account ? "Yes" : "No",
                    money(
                      Number(item.opening_debit || 0) -
                        Number(item.opening_credit || 0),
                    ),
                    item.is_active ? "Active" : "Inactive",
                    <span key="actions" className="flex gap-3">
                      <button
                        className={textButton}
                        onClick={() => showLedger(item)}
                      >
                        View ledger
                      </button>
                      <button
                        className={textButton}
                        onClick={() => {
                          setEditingAccount(item);
                          setFormError("");
                          setForm("account");
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className={textButton}
                        onClick={() =>
                          action(
                            () =>
                              apiClient.patch(
                                `/accounting/accounts/${item.id}`,
                                { is_active: !item.is_active },
                              ),
                            `Account ${item.is_active ? "deactivated" : "reactivated"}.`,
                          )
                        }
                      >
                        {item.is_active ? "Deactivate" : "Reactivate"}
                      </button>
                    </span>,
                  ])}
                />
              </>
            )}
            {tab === "cost-centres" && (
              <>
                <Toolbar
                  placeholder="Search code, centre, project or department"
                  search={search}
                  change={setSearch}
                  create={() => {
                    setEditingCostCentre(null);
                    setFormError("");
                    setForm("cost-centre");
                  }}
                  label="New cost centre"
                />
                <div className="px-4 py-2 text-xs text-gray-600 bg-[#fcfaf7]">
                  Use active centres on manual journals and budgets. Deactivate
                  rather than delete a centre once it has been used.
                </div>
                <Grid
                  headers={[
                    "Code",
                    "Name",
                    "Type",
                    "Parent",
                    "Status",
                    "Actions",
                  ]}
                  rows={data.costCentres
                    .filter((item: any) =>
                      `${item.centre_code} ${item.centre_name} ${item.centre_type}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    )
                    .map((item: any) => [
                      item.centre_code,
                      item.centre_name,
                      String(item.centre_type).replaceAll("_", " "),
                      data.costCentres.find(
                        (parent: any) => parent.id === item.parent_id,
                      )?.centre_name || "-",
                      item.is_active ? "Active" : "Inactive",
                      <span key="actions" className="flex gap-3">
                        <button
                          className={textButton}
                          onClick={() => {
                            setEditingCostCentre(item);
                            setFormError("");
                            setForm("cost-centre");
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className={textButton}
                          onClick={() =>
                            action(
                              () =>
                                apiClient.patch(
                                  `/accounting/cost-centres/${item.id}`,
                                  { is_active: !item.is_active },
                                ),
                              `Cost centre ${item.is_active ? "deactivated" : "reactivated"}.`,
                            )
                          }
                        >
                          {item.is_active ? "Deactivate" : "Reactivate"}
                        </button>
                      </span>,
                    ])}
                />
              </>
            )}
            {tab === "posting-rules" && (
              <>
                <Toolbar
                  placeholder="Search rule, source or ledger mapping"
                  search={search}
                  change={setSearch}
                  create={() => {
                    setEditingPostingRule(null);
                    setFormError("");
                    setForm("posting-rule");
                  }}
                  label="New posting rule"
                />
                <div className="px-4 py-2 text-xs text-gray-600 bg-[#fcfaf7]">
                  Finance-reviewed mapping templates. Use Create draft to
                  validate an approved mapping first; a Finance user must still
                  review and post the generated voucher.
                </div>
                <Grid
                  headers={[
                    "Code",
                    "Rule",
                    "Source",
                    "Debit account",
                    "Credit account",
                    "Tax account",
                    "Status",
                    "Actions",
                  ]}
                  rows={data.postingRules
                    .filter((item: any) =>
                      `${item.rule_code} ${item.rule_name} ${item.source_type}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    )
                    .map((item: any) => [
                      item.rule_code,
                      item.rule_name,
                      String(item.source_type).replaceAll("_", " "),
                      accountName(data.accounts, item.debit_account_id),
                      accountName(data.accounts, item.credit_account_id),
                      item.tax_account_id
                        ? accountName(data.accounts, item.tax_account_id)
                        : "-",
                      item.is_active ? "Active" : "Draft",
                      <span key="actions" className="flex gap-3">
                        <button
                          className={textButton}
                          onClick={() => {
                            setEditingPostingRule(item);
                            setFormError("");
                            setForm("posting-rule");
                          }}
                        >
                          Edit
                        </button>
                        {item.is_active && (
                          <button
                            className={textButton}
                            onClick={() => {
                              setPreviewPostingRule(item);
                              setFormError("");
                              setForm("posting-preview");
                            }}
                          >
                            Create draft
                          </button>
                        )}
                        <button
                          className={textButton}
                          onClick={() =>
                            action(
                              () =>
                                apiClient.patch(
                                  `/accounting/posting-rules/${item.id}`,
                                  { is_active: !item.is_active },
                                ),
                              `Posting rule ${item.is_active ? "deactivated" : "activated"}.`,
                            )
                          }
                        >
                          {item.is_active ? "Deactivate" : "Activate"}
                        </button>
                      </span>,
                    ])}
                />
              </>
            )}
            {tab === "recurring-journals" && (
              <>
                <Toolbar
                  placeholder="Search template code, name or frequency"
                  search={search}
                  change={setSearch}
                  create={() => {
                    setRecurringEditor({});
                    setFormError("");
                  }}
                  label="New recurring journal"
                />
                <div className="px-4 py-2 text-xs text-gray-600 bg-[#fcfaf7]">
                  Templates are for recurring rent, depreciation, accruals and
                  allocations. <strong>Generate draft</strong> creates a
                  balanced draft voucher for finance review; it never posts
                  automatically.
                </div>
                <Grid
                  headers={[
                    "Code",
                    "Template",
                    "Frequency",
                    "Next run",
                    "Currency",
                    "Status",
                    "Actions",
                  ]}
                  rows={data.recurringJournals
                    .filter((item: any) =>
                      `${item.template_code} ${item.template_name} ${item.frequency}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    )
                    .map((item: any) => [
                      item.template_code,
                      item.template_name,
                      item.frequency,
                      date(item.next_run_date),
                      `${item.transaction_currency_code || "INR"} @ ${Number(item.exchange_rate || 1).toLocaleString("en-IN", { maximumFractionDigits: 6 })}`,
                      item.is_active ? "Active" : "Inactive",
                      <span key="actions" className="flex gap-3">
                        <button
                          className={textButton}
                          onClick={() => {
                            setRecurringEditor(item);
                            setFormError("");
                          }}
                        >
                          Edit
                        </button>
                        {item.is_active && (
                          <button
                            className={textButton}
                            onClick={() =>
                              action(
                                () =>
                                  apiClient.post(
                                    `/accounting/recurring-journals/${item.id}/generate`,
                                    {},
                                  ),
                                "Balanced draft voucher generated from recurring template. Review it in Journal entries before posting.",
                              )
                            }
                          >
                            Generate draft
                          </button>
                        )}
                        <button
                          className={textButton}
                          onClick={() =>
                            action(
                              () =>
                                apiClient.patch(
                                  `/accounting/recurring-journals/${item.id}`,
                                  { is_active: !item.is_active },
                                ),
                              `Recurring template ${item.is_active ? "deactivated" : "activated"}.`,
                            )
                          }
                        >
                          {item.is_active ? "Deactivate" : "Activate"}
                        </button>
                      </span>,
                    ])}
                />
              </>
            )}
            {tab === "exchange-rates" && (
              <>
                <Toolbar
                  placeholder="Search currency, date or source"
                  search={search}
                  change={setSearch}
                  create={() => {
                    setEditingExchangeRate(null);
                    setFormError("");
                    setForm("exchange-rate");
                  }}
                  label="New exchange rate"
                />
                <div className="px-4 py-2 text-xs text-gray-600 bg-[#fcfaf7]">
                  Rates convert the transaction currency into the INR functional
                  ledger currency. Saving the same currency pair and date
                  updates that controlled daily rate.
                </div>
                <Grid
                  headers={[
                    "Rate date",
                    "From",
                    "To (base)",
                    "Rate",
                    "Source / reference",
                    "Status",
                    "Actions",
                  ]}
                  rows={data.exchangeRates
                    .filter((item: any) =>
                      `${item.rate_date} ${item.from_currency_code} ${item.to_currency_code} ${item.source_reference || ""}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    )
                    .map((item: any) => [
                      date(item.rate_date),
                      item.from_currency_code,
                      item.to_currency_code,
                      Number(item.exchange_rate || 0).toLocaleString("en-IN", {
                        maximumFractionDigits: 8,
                      }),
                      item.source_reference || "-",
                      item.is_active ? "Active" : "Inactive",
                      <span key="actions" className="flex gap-3">
                        <button
                          className={textButton}
                          onClick={() => {
                            setEditingExchangeRate(item);
                            setFormError("");
                            setForm("exchange-rate");
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className={textButton}
                          onClick={() =>
                            action(
                              () =>
                                apiClient.patch(
                                  `/accounting/exchange-rates/${item.id}`,
                                  { is_active: !item.is_active },
                                ),
                              `Exchange rate ${item.is_active ? "deactivated" : "reactivated"}.`,
                            )
                          }
                        >
                          {item.is_active ? "Deactivate" : "Reactivate"}
                        </button>
                      </span>,
                    ])}
                />
              </>
            )}
            {tab === "parties" && (
              <>
                <Toolbar
                  placeholder="Search customer, supplier or employee"
                  search={search}
                  change={setSearch}
                  create={() => {
                    setEditingParty(null);
                    setFormError("");
                    setForm("party");
                  }}
                  label="New party"
                />
                <Grid
                  headers={[
                    "Party",
                    "Type",
                    "Code",
                    "Receivable ledger",
                    "Payable ledger",
                    "Credit terms",
                    "Status",
                    "Actions",
                  ]}
                  rows={data.parties
                    .filter((item: any) =>
                      `${item.party_name} ${item.party_code || ""} ${item.party_type}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    )
                    .map((item: any) => [
                      item.party_name,
                      item.party_type,
                      item.party_code || "-",
                      accountName(data.accounts, item.receivable_account_id),
                      accountName(data.accounts, item.payable_account_id),
                      `${money(item.credit_limit)} / ${item.credit_days} days`,
                      item.is_active ? "Active" : "Inactive",
                      <span key="actions" className="flex gap-3">
                        <button
                          className={textButton}
                          onClick={() => {
                            setEditingParty(item);
                            setFormError("");
                            setForm("party");
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className={textButton}
                          onClick={() =>
                            action(
                              () =>
                                apiClient.patch(
                                  `/accounting/parties/${item.id}`,
                                  { is_active: !item.is_active },
                                ),
                              `${item.party_name} ${item.is_active ? "deactivated" : "reactivated"}.`,
                            )
                          }
                        >
                          {item.is_active ? "Deactivate" : "Reactivate"}
                        </button>
                      </span>,
                    ])}
                />
              </>
            )}
            {tab === "journals" && (
              <>
                <div className="border-b bg-[#fcfaf7] px-4 py-3 text-sm text-gray-600">
                  Manual and recurring vouchers follow Prepare → Review →
                  Approve → Post. Draft vouchers may be edited or deleted.
                  Posting is irreversible except through a controlled reversal.{" "}
                  <strong>
                    Only active ledger accounts and an explicitly open
                    accounting period can be posted.
                  </strong>
                </div>
                {journalActionError && (
                  <Banner
                    tone="error"
                    text={journalActionError}
                    close={() => setJournalActionError("")}
                  />
                )}
                <Toolbar
                  placeholder="Search journal or narration"
                  search={search}
                  change={setSearch}
                  create={() => {
                    setEditingJournal(null);
                    setJournalActionError("");
                    setForm("journal");
                  }}
                  label="New journal"
                />
                <Grid
                  headers={[
                    "Journal",
                    "Date",
                    "Narration",
                    "Source",
                    "Adjustment",
                    "Status",
                    "Debit",
                    "Credit",
                    "Actions",
                  ]}
                  rows={data.journals
                    .filter((item: any) =>
                      `${item.journal_number} ${item.narration}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    )
                    .map((item: any) => [
                      item.journal_number,
                      date(item.journal_date),
                      item.narration,
                      item.source_type || "Manual",
                      item.adjustment_type && item.adjustment_type !== "NONE"
                        ? String(item.adjustment_type).replaceAll("_", " ")
                        : "-",
                      <Status key="s" value={item.status} />,
                      money(item.total_debit),
                      money(item.total_credit),
                      <JournalActions
                        key="a"
                        row={item}
                        action={action}
                        setError={setJournalActionError}
                        view={async () => {
                          try {
                            setJournalActionError("");
                            setJournalView(
                              await apiClient.get(
                                `/accounting/journals/${item.id}`,
                              ),
                            );
                          } catch (caught: any) {
                            setJournalActionError(
                              caught?.message ||
                                "Journal details could not be loaded.",
                            );
                          }
                        }}
                        edit={async () => {
                          try {
                            setJournalActionError("");
                            const journal = await apiClient.get(
                              `/accounting/journals/${item.id}`,
                            );
                            setEditingJournal(journal);
                            setForm("journal");
                          } catch (caught: any) {
                            setJournalActionError(
                              caught?.message ||
                                "Draft journal could not be loaded for editing.",
                            );
                          }
                        }}
                      />,
                    ])}
                />
              </>
            )}
            {tab === "reports" && <ReportsPanelV2 data={data} />}
            {tab === "business-impact" && <BusinessImpactPanel />}
            {tab === "receivables" && (
              <OpenItems
                direction="RECEIVABLE"
                rows={data.receivables}
                create={() => setForm("open-item")}
                createVoucher={() => {
                  setVoucherDirection("RECEIVABLE");
                  setFormError("");
                  setForm("voucher");
                }}
                action={action}
                journals={data.journals}
              />
            )}
            {tab === "payables" && (
              <OpenItems
                direction="PAYABLE"
                rows={data.payables}
                create={() => setForm("open-item")}
                createVoucher={() => {
                  setVoucherDirection("PAYABLE");
                  setFormError("");
                  setForm("voucher");
                }}
                action={action}
                journals={data.journals}
              />
            )}
            {tab === "payment-runs" && (
              <PaymentRuns
                rows={data.paymentRuns}
                payables={data.payables}
                banks={data.bank}
                action={action}
              />
            )}
            {tab === "opening-balances" && (
              <OpeningBalances
                rows={data.openingBalances}
                accounts={data.accounts}
                action={action}
              />
            )}
            {tab === "statutory" && (
              <StatutoryReturns rows={data.statutoryReturns} action={action} />
            )}
            {tab === "report-schedules" && (
              <ReportSchedules rows={data.reportSchedules} action={action} />
            )}
            {tab === "workflow" && (
              <WorkflowRoles
                rows={data.workflowRoles}
                users={data.workflowUsers}
                action={action}
              />
            )}
            {tab === "bank" && (
              <Bank data={data} create={setForm} action={action} />
            )}
            {tab === "tax" && (
              <TaxWorkspace taxCodes={data.tax} create={() => setForm("tax")} />
            )}
            {tab === "assets" && (
              <AssetsPanel
                assets={data.assets.filter((item: any) =>
                  `${item.asset_code} ${item.asset_name}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )}
                search={search}
                change={setSearch}
                create={() => setForm("asset")}
              />
            )}
            {tab === "budgets" && (
              <Budgets
                rows={data.budgets}
                create={() => setForm("budget")}
                action={action}
              />
            )}
            {tab === "periods" && (
              <Periods
                rows={data.periods}
                create={() => setForm("period")}
                action={action}
              />
            )}
          </div>
        </div>
      </section>
      {loading && (
        <p className="text-sm text-gray-500">Loading accounting controls...</p>
      )}
      {recurringEditor && (
        <RecurringJournalForm
          template={recurringEditor.id ? recurringEditor : null}
          accounts={data.accounts}
          error={formError}
          close={() => {
            setFormError("");
            setRecurringEditor(null);
          }}
          save={(payload: any) =>
            action(
              () =>
                recurringEditor.id
                  ? apiClient.patch(
                      `/accounting/recurring-journals/${recurringEditor.id}`,
                      payload,
                    )
                  : apiClient.post("/accounting/recurring-journals", payload),
              `Recurring journal template ${recurringEditor.id ? "updated" : "saved"}.`,
              "form",
            ).then((ok) => {
              if (ok) setRecurringEditor(null);
            })
          }
        />
      )}
      {form === "bank-import" ? (
        <BankImportForm
          banks={data.bank}
          error={formError}
          close={() => {
            setFormError("");
            setForm(null);
          }}
          save={(payload: any) =>
            action(
              () =>
                apiClient.post("/accounting/bank-transactions/import", payload),
              "Bank statement imported. Review unmatched transactions and match them to posted vouchers.",
              "form",
            )
          }
        />
      ) : form === "voucher" ? (
        <PaymentVoucherForm
          direction={voucherDirection}
          rows={
            voucherDirection === "RECEIVABLE" ? data.receivables : data.payables
          }
          banks={data.bank}
          error={formError}
          close={() => {
            setFormError("");
            setForm(null);
          }}
          save={(payload: any) =>
            action(
              () => apiClient.post("/accounting/payment-vouchers", payload),
              `${voucherDirection === "RECEIVABLE" ? "Customer receipt" : "Supplier payment"} voucher posted, matched to the bank, and settlement updated.`,
              "form",
            )
          }
        />
      ) : (
        form && (
          <AccountingForm
            kind={form}
            data={data}
            initialAccount={form === "account" ? editingAccount : null}
            initialCostCentre={
              form === "cost-centre" ? editingCostCentre : null
            }
            initialPostingRule={
              form === "posting-rule"
                ? editingPostingRule
                : form === "posting-preview"
                  ? previewPostingRule
                  : null
            }
            initialExchangeRate={
              form === "exchange-rate" ? editingExchangeRate : null
            }
            initialParty={form === "party" ? editingParty : null}
            initialJournal={form === "journal" ? editingJournal : null}
            error={formError}
            close={() => {
              setFormError("");
              setEditingAccount(null);
              setEditingCostCentre(null);
              setEditingPostingRule(null);
              setPreviewPostingRule(null);
              setEditingExchangeRate(null);
              setEditingParty(null);
              setEditingJournal(null);
              setForm(null);
            }}
            save={(payload: any) =>
              action(
                () =>
                  form === "account" && editingAccount
                    ? apiClient.patch(
                        `/accounting/accounts/${editingAccount.id}`,
                        payload,
                      )
                    : form === "cost-centre" && editingCostCentre
                      ? apiClient.patch(
                          `/accounting/cost-centres/${editingCostCentre.id}`,
                          payload,
                        )
                      : form === "posting-rule" && editingPostingRule
                        ? apiClient.patch(
                            `/accounting/posting-rules/${editingPostingRule.id}`,
                            payload,
                          )
                        : form === "posting-rule"
                          ? apiClient.post("/accounting/posting-rules", payload)
                          : form === "posting-preview"
                            ? apiClient.post(
                                `/accounting/posting-rules/${previewPostingRule.id}/create-draft`,
                                payload,
                              )
                            : form === "exchange-rate" && editingExchangeRate
                              ? apiClient.patch(
                                  `/accounting/exchange-rates/${editingExchangeRate.id}`,
                                  payload,
                                )
                              : form === "party" && editingParty
                                ? apiClient.patch(
                                    `/accounting/parties/${editingParty.id}`,
                                    payload,
                                  )
                                : form === "journal" && editingJournal
                                  ? apiClient.patch(
                                      `/accounting/journals/${editingJournal.id}`,
                                      payload,
                                    )
                                  : saveForm(form, payload),
                `${form === "posting-preview" ? "Draft voucher created from posting rule" : form === "exchange-rate" ? (editingExchangeRate ? "Exchange rate updated" : "Exchange rate saved") : form === "account" ? (editingAccount ? "Ledger account updated" : "Ledger account saved") : form === "cost-centre" ? (editingCostCentre ? "Cost centre updated" : "Cost centre saved") : form === "posting-rule" ? (editingPostingRule ? "Posting rule updated" : "Posting rule saved as draft") : form === "party" ? (editingParty ? "Accounting party updated" : "Accounting party saved") : form === "journal" ? (editingJournal ? "Draft journal updated" : "Journal saved as draft") : "Accounting record saved"} successfully.`,
                "form",
              )
            }
          />
        )
      )}
      {ledger && <LedgerDrawer ledger={ledger} close={() => setLedger(null)} />}
      {journalView && (
        <JournalDrawer
          journal={journalView}
          accounts={data.accounts}
          close={() => setJournalView(null)}
        />
      )}
    </main>
  );
}

async function saveForm(kind: FormKind, body: any) {
  const paths: Record<Exclude<FormKind, null>, string> = {
    account: "/accounting/accounts",
    "cost-centre": "/accounting/cost-centres",
    "posting-rule": "/accounting/posting-rules",
    "posting-preview": "/accounting/posting-rules",
    "exchange-rate": "/accounting/exchange-rates",
    party: "/accounting/parties",
    period: "/accounting/periods",
    journal: "/accounting/journals",
    "open-item": "/accounting/open-items",
    voucher: "/accounting/payment-vouchers",
    bank: "/accounting/bank-accounts",
    "bank-transaction": "/accounting/bank-transactions",
    "bank-import": "/accounting/bank-transactions/import",
    tax: "/accounting/tax-codes",
    asset: "/accounting/fixed-assets",
    budget: "/accounting/budgets",
  };
  return apiClient.post(paths[kind!], body);
}
function OpenItems({
  direction,
  rows,
  create,
  createVoucher,
  action,
  journals,
}: any) {
  const [filter, setFilter] = useState("");
  const visible = rows.filter((item: any) =>
    `${item.document_number} ${item.party?.party_name || ""} ${item.status}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  return (
    <>
      <div className="p-3 border-b flex flex-wrap gap-2">
        <input
          className="flex-1 min-w-[240px] border rounded-lg px-3 py-2"
          placeholder={`Search ${direction.toLowerCase()} documents`}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <button className={softButton} onClick={createVoucher}>
          + {direction === "RECEIVABLE" ? "Record receipt" : "Record payment"}
        </button>
        <button className={softButton} onClick={create}>
          + New {direction === "RECEIVABLE" ? "receivable" : "payable"}
        </button>
      </div>
      <div className="px-4 py-2 text-xs text-gray-600 bg-[#fcfaf7]">
        A voucher posts the double entry, creates a matched bank transaction,
        and settles the selected open item in one controlled action.
      </div>
      <Grid
        headers={[
          "Document",
          "Party",
          "Date",
          "Due date",
          "Original",
          "Settled",
          "Outstanding",
          "Status",
          "Actions",
        ]}
        rows={visible.map((item: any) => [
          item.document_number,
          item.party?.party_name || "-",
          date(item.document_date),
          date(item.due_date),
          money(item.original_amount),
          money(item.settled_amount),
          money(due(item)),
          <Status key="s" value={item.status} />,
          <Settle key="a" row={item} journals={journals} action={action} />,
        ])}
      />
    </>
  );
}

function PaymentRuns({ rows, payables, banks, action }: any) {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [remittances, setRemittances] = useState<any[] | null>(null);
  const open = payables.filter((item: any) =>
    ["OPEN", "PARTIAL"].includes(item.status),
  );
  const chosen = open.filter((item: any) => selected[item.id]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const source = new FormData(event.currentTarget);
    const items = chosen.map((item: any) => ({
      open_item_id: item.id,
      planned_amount: Number(amounts[item.id] || due(item)),
      reference_number: String(source.get("reference_number") || ""),
    }));
    if (!items.length) {
      setError("Select at least one payable for this run.");
      return;
    }
    action(
      () =>
        apiClient.post("/accounting/payment-runs", {
          run_date: source.get("run_date"),
          direction: "PAYABLE",
          bank_account_id: source.get("bank_account_id"),
          narration: source.get("narration"),
          items,
        }),
      "Payment run prepared and sent for independent approval.",
      "page",
      setError,
    ).then((ok: boolean) => {
      if (ok) setCreating(false);
    });
  };
  return (
    <>
      <div className="p-3 border-b flex flex-wrap items-center justify-between gap-2">
        <div>
          <strong>Payment runs</strong>
          <p className="text-xs text-gray-600 mt-1">
            Prepare supplier payments in bulk, approve them independently, then
            post individual, traceable settlement vouchers.
          </p>
        </div>
        <button
          className={softButton}
          onClick={() => {
            setCreating(true);
            setError("");
          }}
        >
          + Prepare payment run
        </button>
      </div>
      <Grid
        headers={["Run", "Date", "Bank", "Items", "Total", "Status", "Actions"]}
        rows={rows.map((run: any) => [
          run.run_number,
          date(run.run_date),
          run.bank?.bank_name || "-",
          (run.items || []).length,
          money(run.total_amount),
          <Status key="s" value={run.status} />,
          <span key="a" className="flex flex-wrap gap-2">
            {run.status === "DRAFT" && (
              <button
                className={textButton}
                onClick={() =>
                  action(
                    () =>
                      apiClient.post(
                        `/accounting/payment-runs/${run.id}/approve`,
                      ),
                    `Payment run ${run.run_number} approved.`,
                    "page",
                    setError,
                  )
                }
              >
                Approve
              </button>
            )}
            {run.status === "APPROVED" && (
              <button
                className={textButton}
                onClick={() => {
                  if (
                    window.confirm(
                      `Post ${run.run_number}? This creates and settles ${run.items?.length || 0} payment vouchers.`,
                    )
                  )
                    action(
                      () =>
                        apiClient.post(
                          `/accounting/payment-runs/${run.id}/post`,
                        ),
                      `Payment run ${run.run_number} posted.`,
                      "page",
                      setError,
                    );
                }}
              >
                Post run
              </button>
            )}
            {run.status === "POSTED" && (
              <>
                <button
                  className={textButton}
                  onClick={() =>
                    action(
                      () =>
                        apiClient.post(
                          `/accounting/payment-runs/${run.id}/remittances`,
                        ),
                      `Remittance advice prepared for ${run.run_number}.`,
                      "page",
                      setError,
                    )
                  }
                >
                  Prepare remittance
                </button>
                <button
                  className={textButton}
                  onClick={async () => {
                    try {
                      setError("");
                      setRemittances(
                        await apiClient.get(
                          `/accounting/payment-runs/${run.id}/remittances`,
                        ),
                      );
                    } catch (caught: any) {
                      setError(
                        caught?.message ||
                          "Remittance advice could not be loaded.",
                      );
                    }
                  }}
                >
                  View remittances
                </button>
              </>
            )}
          </span>,
        ])}
      />
      {remittances && (
        <section className="m-3 rounded-xl border border-[#ddcfbb] bg-[#fcfaf7] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-widest text-[#9a7445]">
                Remittance advice
              </p>
              <p className="text-sm text-gray-600">
                Delivery is recorded here; sending remains a controlled,
                auditable action.
              </p>
            </div>
            <button className={textButton} onClick={() => setRemittances(null)}>
              Close
            </button>
          </div>
          <div className="mt-3 grid gap-2">
            {remittances.map((item: any) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2 text-sm"
              >
                <div>
                  <strong>{item.remittance_number}</strong>
                  <p className="text-xs text-gray-600">
                    {item.party?.party_name || "Supplier"} ·{" "}
                    {money(item.amount)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Status value={item.status} />
                  {item.status !== "SENT" && (
                    <button
                      className={textButton}
                      onClick={() =>
                        action(
                          () =>
                            apiClient.post(
                              `/accounting/remittances/${item.id}/mark-sent`,
                            ),
                          `Remittance ${item.remittance_number} marked sent.`,
                          "page",
                          setError,
                        ).then(async (ok: boolean) => {
                          if (ok)
                            setRemittances((current) =>
                              (current || []).map((row: any) =>
                                row.id === item.id
                                  ? { ...row, status: "SENT" }
                                  : row,
                              ),
                            );
                        })
                      }
                    >
                      Mark sent
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {creating && (
        <div className="fixed inset-0 z-50 bg-black/40 flex justify-end">
          <form
            onSubmit={submit}
            className="h-full w-full max-w-4xl overflow-y-auto bg-white p-6 shadow-xl"
          >
            <div className="flex justify-between gap-3 border-b pb-4">
              <div>
                <p className="text-xs uppercase tracking-widest text-[#9a7445]">
                  Treasury control
                </p>
                <h2 className="text-xl font-semibold">
                  Prepare supplier payment run
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  Only selected open payables will be included. Approval and
                  posting are separate finance roles.
                </p>
              </div>
              <button
                type="button"
                className={softButton}
                onClick={() => setCreating(false)}
              >
                Close
              </button>
            </div>
            {error && (
              <p
                role="alert"
                className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700"
              >
                {error}
              </p>
            )}
            <div className="grid sm:grid-cols-3 gap-3 mt-4">
              <Field
                name="run_date"
                label="Payment date"
                type="date"
                required
                defaultValue={today()}
              />
              <label className="block text-sm">
                <span className="block mb-1">Paying bank *</span>
                <select
                  name="bank_account_id"
                  required
                  className="w-full border rounded-lg px-3 py-2"
                >
                  <option value="">Select bank</option>
                  {banks
                    .filter((bank: any) => bank.is_active)
                    .map((bank: any) => (
                      <option key={bank.id} value={bank.id}>
                        {bank.bank_name}
                      </option>
                    ))}
                </select>
              </label>
              <Field name="reference_number" label="Batch / bank reference" />
            </div>
            <Field
              name="narration"
              label="Narration"
              placeholder="Optional payment-run narration"
            />
            <div className="mt-5 rounded-lg border">
              <div className="grid grid-cols-[40px_1fr_150px_150px] gap-3 border-b bg-[#fcfaf7] p-3 text-xs font-semibold uppercase text-gray-600">
                <span></span>
                <span>Supplier payable</span>
                <span>Outstanding</span>
                <span>Pay now</span>
              </div>
              {open.map((item: any) => (
                <label
                  key={item.id}
                  className="grid grid-cols-[40px_1fr_150px_150px] gap-3 items-center border-b p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={!!selected[item.id]}
                    onChange={(event) => {
                      setSelected((current) => ({
                        ...current,
                        [item.id]: event.target.checked,
                      }));
                      if (event.target.checked && !amounts[item.id])
                        setAmounts((current) => ({
                          ...current,
                          [item.id]: due(item).toFixed(2),
                        }));
                    }}
                  />
                  <span>
                    <strong>{item.document_number}</strong>
                    <br />
                    <span className="text-xs text-gray-600">
                      {item.party?.party_name || "-"}
                    </span>
                  </span>
                  <span>{money(due(item))}</span>
                  <input
                    disabled={!selected[item.id]}
                    type="number"
                    min="0.01"
                    max={due(item).toFixed(2)}
                    step="0.01"
                    className="border rounded px-2 py-1 disabled:bg-gray-100"
                    value={amounts[item.id] || ""}
                    onChange={(event) =>
                      setAmounts((current) => ({
                        ...current,
                        [item.id]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className={softButton}
                onClick={() => setCreating(false)}
              >
                Cancel
              </button>
              <button className={primaryButton}>
                Prepare run ({chosen.length})
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function PaymentVoucherForm({
  direction,
  rows,
  banks,
  error,
  close,
  save,
}: any) {
  const openRows = rows.filter((row: any) =>
    ["OPEN", "PARTIAL"].includes(row.status),
  );
  const [itemId, setItemId] = useState(openRows[0]?.id || "");
  const selected = openRows.find((row: any) => row.id === itemId);
  const [amount, setAmount] = useState(
    selected ? String(due(selected).toFixed(2)) : "",
  );
  function choose(id: string) {
    setItemId(id);
    const item = openRows.find((row: any) => row.id === id);
    setAmount(item ? String(due(item).toFixed(2)) : "");
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const source = new FormData(event.currentTarget);
    save({
      open_item_id: itemId,
      bank_account_id: source.get("bank_account_id"),
      voucher_date: source.get("voucher_date"),
      value_date: source.get("value_date"),
      amount: Number(amount),
      payment_method: source.get("payment_method"),
      reference_number: source.get("reference_number"),
      narration: source.get("narration"),
    });
  }
  const label =
    direction === "RECEIVABLE"
      ? "Customer receipt voucher"
      : "Supplier payment voucher";
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end">
      <form
        onSubmit={submit}
        className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-xl"
      >
        <div className="flex justify-between items-start mb-5">
          <div>
            <p className="text-xs uppercase tracking-widest text-[#9a7445]">
              Treasury & settlement
            </p>
            <h2 className="text-xl font-semibold">{label}</h2>
            <p className="mt-1 text-sm text-gray-600">
              Posts the bank and party control ledgers, then settles the
              selected document.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close voucher"
            className="text-lg"
            onClick={close}
          >
            ×
          </button>
        </div>
        {error && (
          <div
            role="alert"
            className="mb-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}
        <div className="grid gap-4">
          <label className="block text-sm">
            <span className="block mb-1">
              Open{" "}
              {direction === "RECEIVABLE"
                ? "customer invoice"
                : "supplier invoice"}{" "}
              *
            </span>
            <select
              required
              value={itemId}
              onChange={(event) => choose(event.target.value)}
              className="w-full border rounded-lg px-3 py-2"
            >
              <option value="">Select document</option>
              {openRows.map((row: any) => (
                <option key={row.id} value={row.id}>
                  {row.document_number} — {row.party?.party_name || "-"} —
                  outstanding {money(due(row))}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <div className="rounded-lg bg-[#fcfaf7] border p-3 text-sm">
              <strong>{selected.document_number}</strong>
              <div className="mt-1">
                Outstanding: {money(due(selected))} · Due:{" "}
                {date(selected.due_date)}
              </div>
            </div>
          )}
          <label className="block text-sm">
            <span className="block mb-1">Bank account *</span>
            <select
              name="bank_account_id"
              required
              className="w-full border rounded-lg px-3 py-2"
            >
              <option value="">Select bank account</option>
              {banks
                .filter((bank: any) => bank.is_active)
                .map((bank: any) => (
                  <option key={bank.id} value={bank.id}>
                    {bank.bank_name}
                  </option>
                ))}
            </select>
          </label>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field
              name="voucher_date"
              label="Voucher date"
              type="date"
              required
              defaultValue={today()}
            />
            <Field
              name="value_date"
              label="Value date"
              type="date"
              defaultValue={today()}
            />
            <label className="block text-sm">
              <span className="block mb-1">Settlement amount *</span>
              <input
                required
                min="0.01"
                max={selected ? due(selected).toFixed(2) : undefined}
                step="0.01"
                type="number"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="w-full border rounded-lg px-3 py-2"
              />
            </label>
            <Select
              name="payment_method"
              label="Method"
              options={["BANK", "UPI", "CHEQUE", "CASH", "OTHER"]}
            />
            <Field name="reference_number" label="Bank / cheque reference" />
            <Field
              name="narration"
              label="Narration"
              placeholder="Optional; generated from invoice if blank"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-7 pt-4 border-t">
          <button
            type="button"
            className="px-4 py-2 border rounded-lg"
            onClick={close}
          >
            Cancel
          </button>
          <button
            disabled={!itemId || !banks.some((bank: any) => bank.is_active)}
            className="px-4 py-2 bg-[#6b4d2e] text-white rounded-lg disabled:opacity-50"
          >
            Post {direction === "RECEIVABLE" ? "receipt" : "payment"}
          </button>
        </div>
      </form>
    </div>
  );
}
function csvCells(line: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else cell += character;
  }
  cells.push(cell.trim());
  return cells;
}
function BankImportForm({ banks, error, close, save }: any) {
  const [bankId, setBankId] = useState(
    banks.find((bank: any) => bank.is_active)?.id || "",
  );
  const [statement, setStatement] = useState(
    "transaction_date,direction,amount,reference_number,description\n2026-08-22,IN,12500.00,UTR123456,Customer receipt\n2026-08-22,OUT,2450.00,NEFT987654,Supplier payment",
  );
  const [parseError, setParseError] = useState("");
  const [fileName, setFileName] = useState("");
  const [statementReference, setStatementReference] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [closingBalance, setClosingBalance] = useState("");
  async function loadFile(file?: File) {
    if (!file) return;
    setParseError("");
    try {
      setFileName(file.name);
      setStatement(await file.text());
    } catch {
      setParseError("The selected CSV file could not be read.");
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setParseError("");
    const rawRows = statement
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(csvCells);
    if (rawRows.length < 2) {
      setParseError("Paste a header row and at least one transaction row.");
      return;
    }
    const header = rawRows[0].map((cell) =>
      cell.toLowerCase().replaceAll(" ", "_"),
    );
    if (!header.some(Boolean)) {
      setParseError("The statement header row is empty.");
      return;
    }
    const rows = rawRows
      .slice(1)
      .map((cells) =>
        Object.fromEntries(
          header.map((column, index) => [column, cells[index] || ""]),
        ),
      );
    const selectedBank = banks.find((bank: any) => bank.id === bankId);
    save({ bank_account_id: bankId, format_code: selectedBank?.statement_format_code || undefined, statement_reference: statementReference || undefined, file_name: fileName || undefined, opening_balance: openingBalance === "" ? undefined : Number(openingBalance), closing_balance: closingBalance === "" ? undefined : Number(closingBalance), rows });
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end">
      <form
        onSubmit={submit}
        className="h-full w-full max-w-2xl overflow-y-auto bg-white p-6 shadow-xl"
      >
        <div className="flex justify-between items-start mb-5">
          <div>
            <p className="text-xs uppercase tracking-widest text-[#9a7445]">
              Treasury & reconciliation
            </p>
            <h2 className="text-xl font-semibold">Import bank statement</h2>
            <p className="mt-1 text-sm text-gray-600">
              Import CSV rows into the reconciliation queue. This does not post
              any ledger entry.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close bank import"
            className="text-lg"
            onClick={close}
          >
            ×
          </button>
        </div>
        {(error || parseError) && (
          <div
            role="alert"
            className="mb-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {parseError || error}
          </div>
        )}
        <div className="grid gap-4">
          <label className="block text-sm">
            <span className="block mb-1">Bank account *</span>
            <select
              required
              value={bankId}
              onChange={(event) => setBankId(event.target.value)}
              className="w-full border rounded-lg px-3 py-2"
            >
              <option value="">Select bank account</option>
              {banks
                .filter((bank: any) => bank.is_active)
                .map((bank: any) => (
                  <option key={bank.id} value={bank.id}>
                    {bank.bank_name}
                  </option>
                ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm"><span className="mb-1 block">Statement reference</span><input value={statementReference} onChange={(event) => setStatementReference(event.target.value)} className="w-full rounded-lg border px-3 py-2" placeholder="Bank statement number" /></label>
            <label className="block text-sm"><span className="mb-1 block">Opening balance</span><input type="number" step="0.01" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} className="w-full rounded-lg border px-3 py-2" /></label>
            <label className="block text-sm"><span className="mb-1 block">Closing balance</span><input type="number" step="0.01" value={closingBalance} onChange={(event) => setClosingBalance(event.target.value)} className="w-full rounded-lg border px-3 py-2" /></label>
          </div>
          <label className="block text-sm">
            <span className="block mb-1">Upload CSV (optional)</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => loadFile(event.target.files?.[0])}
              className="w-full border rounded-lg px-3 py-2"
            />
          </label>
          <div className="rounded-lg border bg-[#fcfaf7] p-3 text-xs text-gray-700">
            The selected bank&apos;s format profile maps its native export headers,
            date style and debit/credit or signed-amount convention. Generic CSV
            may use transaction_date, direction and amount. Re-importing the same
            file hash safely skips the duplicate.
          </div>
          <label className="block text-sm">
            <span className="block mb-1">Statement CSV *</span>
            <textarea
              required
              rows={12}
              value={statement}
              onChange={(event) => setStatement(event.target.value)}
              className="w-full font-mono text-xs border rounded-lg px-3 py-2"
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-7 pt-4 border-t">
          <button
            type="button"
            className="px-4 py-2 border rounded-lg"
            onClick={close}
          >
            Cancel
          </button>
          <button
            disabled={!bankId}
            className="px-4 py-2 bg-[#6b4d2e] text-white rounded-lg disabled:opacity-50"
          >
            Import statement
          </button>
        </div>
      </form>
    </div>
  );
}
function ReportsPanel({ data, totals }: any) {
  const [asOf, setAsOf] = useState(today());
  const [reportData, setReportData] = useState<any>(null);
  const [suspense, setSuspense] = useState<any[] | null>(null);
  const [ageing, setAgeing] = useState<any>(null);
  const [cashFlow, setCashFlow] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const active = reportData || { trial: data.trial, pl: data.pl, bs: data.bs };
  const activeTotals = (active.trial || []).reduce(
    (sum: any, item: any) => ({
      debit: sum.debit + Number(item.debit || 0),
      credit: sum.credit + Number(item.credit || 0),
    }),
    { debit: 0, credit: 0 },
  );
  const trialDifference = activeTotals.debit - activeTotals.credit;
  const balanceSheetDifference =
    Number(active.bs?.total_assets || 0) -
    Number(active.bs?.balances?.liabilities_and_equity || 0);
  const trialBalanced = Math.abs(trialDifference) < 0.005;
  const balanceSheetBalanced = Math.abs(balanceSheetDifference) < 0.005;
  async function runReports() {
    try {
      setError("");
      setLoading(true);
      const [trial, pl, bs] = await Promise.all([
        apiClient.get(`/accounting/trial-balance?as_of=${asOf}`),
        apiClient.get(`/accounting/reports/profit-loss?as_of=${asOf}`),
        apiClient.get(`/accounting/reports/balance-sheet?as_of=${asOf}`),
      ]);
      setReportData({ trial, pl, bs });
    } catch (caught: any) {
      setError(
        caught?.message || "Reports could not be loaded for the selected date.",
      );
    } finally {
      setLoading(false);
    }
  }
  async function show(run: () => Promise<any>, set: (value: any) => void) {
    try {
      setError("");
      set(await run());
    } catch (caught: any) {
      setError(caught?.message || "Report could not be loaded.");
    }
  }
  function exportTrial() {
    const rows: Array<Array<string | number>> = [
      ["Account code", "Account name", "Debit", "Credit", "Balance"],
      ...(active.trial || []).map((row: any) => [
        row.account_code,
        row.account_name,
        Number(row.debit || 0).toFixed(2),
        Number(row.credit || 0).toFixed(2),
        Number(row.balance || 0).toFixed(2),
      ]),
    ];
    const csv = rows
      .map((row) =>
        row
          .map(
            (value: string | number) =>
              `"${String(value).replaceAll('"', '""')}"`,
          )
          .join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `trial-balance-${asOf}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="p-5 space-y-5">
      <section className="rounded-xl border bg-[#fcfaf7] p-4 flex flex-wrap items-end gap-3">
        <label className="block text-sm text-gray-700">
          <span className="block mb-1">Reporting date (as at)</span>
          <input
            type="date"
            value={asOf}
            onChange={(event) => setAsOf(event.target.value)}
            className="border rounded-lg px-3 py-2"
          />
        </label>
        <button className={softButton} onClick={runReports} disabled={loading}>
          {loading ? "Refreshing reports…" : "Refresh reports"}
        </button>
        <button className={softButton} onClick={exportTrial}>
          Export trial balance CSV
        </button>
        <p className="text-xs text-gray-600">
          Use the same cut-off date for trial balance, P&amp;L, balance sheet,
          ageing and cash movement.
        </p>
      </section>
      <div className="grid lg:grid-cols-3 gap-5">
        <Report
          title={`Profit & loss · ${asOf}`}
          rows={[
            ["Revenue", money(active.pl?.total_revenue)],
            ["Expenses", money(active.pl?.total_expense)],
            ["Net profit / (loss)", money(active.pl?.net_profit)],
          ]}
        />
        <Report
          title={`Balance sheet · ${asOf}`}
          rows={[
            ["Assets", money(active.bs?.total_assets)],
            ["Liabilities", money(active.bs?.total_liabilities)],
            ["Equity incl. current profit", money(active.bs?.total_equity)],
            [
              "Liabilities + equity",
              money(active.bs?.balances?.liabilities_and_equity),
            ],
          ]}
        />
        <Report
          title={`Trial balance · ${asOf}`}
          rows={[
            ["Total debit", money(activeTotals.debit)],
            ["Total credit", money(activeTotals.credit)],
            ["Difference", money(trialDifference)],
          ]}
        />
      </div>
      <section className="grid md:grid-cols-2 gap-3">
        <div
          className={`rounded-xl border p-4 ${trialBalanced ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}
        >
          <p className="text-xs uppercase tracking-wide text-gray-600">
            Trial balance control
          </p>
          <p
            className={`mt-1 font-semibold ${trialBalanced ? "text-green-800" : "text-red-800"}`}
          >
            {trialBalanced ? "Balanced" : "Action required"}
          </p>
          <p className="mt-1 text-sm text-gray-700">
            Debit / credit difference: {money(trialDifference)}
          </p>
        </div>
        <div
          className={`rounded-xl border p-4 ${balanceSheetBalanced ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}
        >
          <p className="text-xs uppercase tracking-wide text-gray-600">
            Balance sheet control
          </p>
          <p
            className={`mt-1 font-semibold ${balanceSheetBalanced ? "text-green-800" : "text-red-800"}`}
          >
            {balanceSheetBalanced ? "Balanced" : "Action required"}
          </p>
          <p className="mt-1 text-sm text-gray-700">
            Assets less liabilities and equity: {money(balanceSheetDifference)}
          </p>
        </div>
      </section>
      <div className="flex flex-wrap gap-2">
        <button
          className={softButton}
          onClick={() =>
            show(() => apiClient.get("/accounting/suspense"), setSuspense)
          }
        >
          View suspense accounts
        </button>
        <button
          className={softButton}
          onClick={() =>
            show(
              () =>
                apiClient.get(
                  `/accounting/reports/ageing?direction=RECEIVABLE&as_of=${asOf}`,
                ),
              setAgeing,
            )
          }
        >
          Receivables ageing
        </button>
        <button
          className={softButton}
          onClick={() =>
            show(
              () =>
                apiClient.get(
                  `/accounting/reports/ageing?direction=PAYABLE&as_of=${asOf}`,
                ),
              setAgeing,
            )
          }
        >
          Payables ageing
        </button>
        <button
          className={softButton}
          onClick={() =>
            show(
              () =>
                apiClient.get(`/accounting/reports/cash-flow?as_of=${asOf}`),
              setCashFlow,
            )
          }
        >
          Cash movement report
        </button>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {suspense && (
        <Grid
          headers={["Suspense account", "Balance"]}
          rows={suspense.map((row) => [
            `${row.account_code} — ${row.account_name}`,
            money(row.balance),
          ])}
        />
      )}
      {ageing && (
        <div className="border rounded-xl p-4">
          <h3 className="font-semibold mb-3">
            {ageing.direction} ageing as at {date(ageing.as_of)}
          </h3>
          <Grid
            headers={["Current", "1–30", "31–60", "61–90", "Over 90"]}
            rows={[
              [
                money(ageing.buckets.current),
                money(ageing.buckets.days_1_30),
                money(ageing.buckets.days_31_60),
                money(ageing.buckets.days_61_90),
                money(ageing.buckets.over_90),
              ],
            ]}
          />
        </div>
      )}
      {cashFlow && (
        <div className="border rounded-xl p-4 space-y-3">
          <h3 className="font-semibold">
            Cash movement as at {date(cashFlow.as_of)}
          </h3>
          <Grid
            headers={[
              "Opening cash",
              "Inflows",
              "Outflows",
              "Net movement",
              "Closing cash",
            ]}
            rows={[
              [
                money(cashFlow.opening_balance),
                money(cashFlow.total_inflows),
                money(cashFlow.total_outflows),
                money(cashFlow.net_cash_movement),
                money(cashFlow.closing_balance),
              ],
            ]}
          />
          <Grid
            headers={["Source", "Cash in", "Cash out"]}
            rows={[
              ...(cashFlow.inflows || []),
              ...(cashFlow.outflows || []),
            ].reduce(
              (rows: any[], row: any) =>
                rows.some((existing) => existing[0] === row.label)
                  ? rows
                  : [
                      ...rows,
                      [row.label, money(row.inflow), money(row.outflow)],
                    ],
              [],
            )}
          />
        </div>
      )}
    </div>
  );
}
function ReportsPanelV2({ data }: any) {
  const [asOf, setAsOf] = useState(today());
  const [journalFrom, setJournalFrom] = useState(
    () => `${new Date().getFullYear()}-01-01`,
  );
  const [journalSearch, setJournalSearch] = useState("");
  const [journalStatus, setJournalStatus] = useState("POSTED");
  const [journalRegister, setJournalRegister] = useState<any[] | null>(null);
  const [reports, setReports] = useState<any>({
    trial: data.trial || [],
    pl: data.pl,
    bs: data.bs,
  });
  const [ageing, setAgeing] = useState<any>(null);
  const [cashFlow, setCashFlow] = useState<any>(null);
  const [cashForecast, setCashForecast] = useState<any>(null);
  const [costCentres, setCostCentres] = useState<any>(null);
  const [suspense, setSuspense] = useState<any[] | null>(null);
  const [comparative, setComparative] = useState<any>(null);
  const [fxPreview, setFxPreview] = useState<any>(null);
  const [auditTrail, setAuditTrail] = useState<any>(null);
  const [showTrial, setShowTrial] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const totals = (reports.trial || []).reduce(
    (sum: any, row: any) => ({
      debit: sum.debit + Number(row.debit || 0),
      credit: sum.credit + Number(row.credit || 0),
    }),
    { debit: 0, credit: 0 },
  );
  const trialDifference = totals.debit - totals.credit;
  const balanceSheetDifference =
    Number(reports.bs?.total_assets || 0) -
    Number(reports.bs?.balances?.liabilities_and_equity || 0);
  const trialBalanced = Math.abs(trialDifference) < 0.005;
  const balanceSheetBalanced = Math.abs(balanceSheetDifference) < 0.005;
  async function refresh() {
    try {
      setLoading(true);
      setError("");
      const [trial, pl, bs] = await Promise.all([
        apiClient.get(`/accounting/trial-balance?as_of=${asOf}`),
        apiClient.get(`/accounting/reports/profit-loss?as_of=${asOf}`),
        apiClient.get(`/accounting/reports/balance-sheet?as_of=${asOf}`),
      ]);
      setReports({ trial, pl, bs });
      setAgeing(null);
      setCashFlow(null);
      setCashForecast(null);
      setCostCentres(null);
      setSuspense(null);
      setComparative(null);
      setFxPreview(null);
      setAuditTrail(null);
      setJournalRegister(null);
    } catch (caught: any) {
      setError(
        caught?.message || "Reports could not be loaded for the selected date.",
      );
    } finally {
      setLoading(false);
    }
  }
  async function loadDetail(
    kind:
      | "suspense"
      | "receivable"
      | "payable"
      | "cash"
      | "forecast"
      | "cost-centres"
      | "comparative"
      | "fx"
      | "audit",
  ) {
    try {
      setError("");
      if (kind === "suspense")
        setSuspense(await apiClient.get(`/accounting/suspense?as_of=${asOf}`));
      if (kind === "receivable")
        setAgeing(
          await apiClient.get(
            `/accounting/reports/ageing?direction=RECEIVABLE&as_of=${asOf}`,
          ),
        );
      if (kind === "payable")
        setAgeing(
          await apiClient.get(
            `/accounting/reports/ageing?direction=PAYABLE&as_of=${asOf}`,
          ),
        );
      if (kind === "cash")
        setCashFlow(
          await apiClient.get(`/accounting/reports/cash-flow?as_of=${asOf}`),
        );
      if (kind === "forecast")
        setCashForecast(
          await apiClient.get(
            `/accounting/reports/cash-forecast?as_of=${asOf}&days=90`,
          ),
        );
      if (kind === "cost-centres")
        setCostCentres(
          await apiClient.get(
            `/accounting/reports/cost-centres?from=${journalFrom}&to=${asOf}`,
          ),
        );
      if (kind === "comparative")
        setComparative(
          await apiClient.get(
            `/accounting/reports/comparative-financials?as_of=${asOf}`,
          ),
        );
      if (kind === "fx")
        setFxPreview(
          await apiClient.get(
            `/accounting/fx-revaluation/preview?as_of=${asOf}`,
          ),
        );
      if (kind === "audit")
        setAuditTrail(await apiClient.get("/accounting/audit-trail?limit=100"));
    } catch (caught: any) {
      setError(caught?.message || "Report detail could not be loaded.");
    }
  }
  async function loadJournalRegister() {
    try {
      setError("");
      const params = new URLSearchParams({ from: journalFrom, to: asOf });
      if (journalStatus !== "ALL") params.set("status", journalStatus);
      if (journalSearch.trim()) params.set("search", journalSearch.trim());
      setJournalRegister(
        await apiClient.get(`/accounting/journals?${params.toString()}`),
      );
    } catch (caught: any) {
      setError(caught?.message || "Journal register could not be loaded.");
    }
  }
  function exportTrial() {
    const values: Array<Array<string | number>> = [
      ["Account code", "Account name", "Type", "Debit", "Credit", "Balance"],
      ...(reports.trial || []).map((row: any) => [
        row.account_code,
        row.account_name,
        row.account_type,
        Number(row.debit || 0).toFixed(2),
        Number(row.credit || 0).toFixed(2),
        Number(row.balance || 0).toFixed(2),
      ]),
    ];
    const csv = values
      .map((row) =>
        row
          .map(
            (value: string | number) =>
              `"${String(value).replaceAll('"', '""')}"`,
          )
          .join(","),
      )
      .join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    link.download = `trial-balance-${asOf}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }
  function exportJournalRegister() {
    if (!journalRegister?.length) return;
    const values: Array<Array<string | number>> = [
      ["Voucher", "Date", "Source", "Narration", "Status", "Debit", "Credit"],
      ...journalRegister.map((row: any) => [
        row.journal_number,
        row.journal_date,
        row.source_type || "Manual",
        row.narration,
        row.status,
        Number(row.total_debit || 0).toFixed(2),
        Number(row.total_credit || 0).toFixed(2),
      ]),
    ];
    const csv = values
      .map((row) =>
        row
          .map(
            (value: string | number) =>
              `"${String(value).replaceAll('"', '""')}"`,
          )
          .join(","),
      )
      .join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    link.download = `journal-register-${journalFrom}-to-${asOf}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }
  return (
    <div className="p-5 space-y-5">
      <section className="rounded-xl border bg-[#fcfaf7] p-4 flex flex-wrap items-end gap-3">
        <label className="block text-sm text-gray-700">
          <span className="block mb-1">Reporting date (as at)</span>
          <input
            type="date"
            value={asOf}
            onChange={(event) => setAsOf(event.target.value)}
            className="border rounded-lg px-3 py-2"
          />
        </label>
        <button className={softButton} onClick={refresh} disabled={loading}>
          {loading ? "Refreshing reports…" : "Refresh reports"}
        </button>
        <button className={softButton} onClick={exportTrial}>
          Export trial balance CSV
        </button>
        <p className="text-xs text-gray-600">
          All report controls below use this same cut-off date.
        </p>
      </section>
      {error && <Banner tone="error" text={error} close={() => setError("")} />}
      <section className="grid xl:grid-cols-3 gap-4">
        <Report
          title={`Profit & loss · ${asOf}`}
          rows={[
            ["Revenue", money(reports.pl?.total_revenue)],
            ["Expenses", money(reports.pl?.total_expense)],
            ["Net profit / (loss)", money(reports.pl?.net_profit)],
          ]}
        />
        <Report
          title={`Balance sheet · ${asOf}`}
          rows={[
            ["Assets", money(reports.bs?.total_assets)],
            ["Liabilities", money(reports.bs?.total_liabilities)],
            ["Equity incl. current profit", money(reports.bs?.total_equity)],
            [
              "Liabilities + equity",
              money(reports.bs?.balances?.liabilities_and_equity),
            ],
          ]}
        />
        <Report
          title={`Trial balance · ${asOf}`}
          rows={[
            ["Total debit", money(totals.debit)],
            ["Total credit", money(totals.credit)],
            ["Difference", money(trialDifference)],
          ]}
        />
      </section>
      <section className="grid md:grid-cols-2 gap-3">
        <div
          className={`rounded-xl border p-4 ${trialBalanced ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}
        >
          <p className="text-xs uppercase tracking-wide text-gray-600">
            Trial balance control
          </p>
          <p
            className={`mt-1 font-semibold ${trialBalanced ? "text-green-800" : "text-red-800"}`}
          >
            {trialBalanced ? "Balanced" : "Action required"}
          </p>
          <p className="mt-1 text-sm text-gray-700">
            Debit / credit difference: {money(trialDifference)}
          </p>
        </div>
        <div
          className={`rounded-xl border p-4 ${balanceSheetBalanced ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}
        >
          <p className="text-xs uppercase tracking-wide text-gray-600">
            Balance sheet control
          </p>
          <p
            className={`mt-1 font-semibold ${balanceSheetBalanced ? "text-green-800" : "text-red-800"}`}
          >
            {balanceSheetBalanced ? "Balanced" : "Action required"}
          </p>
          <p className="mt-1 text-sm text-gray-700">
            Assets less liabilities and equity: {money(balanceSheetDifference)}
          </p>
        </div>
      </section>
      <section className="border rounded-xl overflow-hidden">
        <div className="bg-[#fcfaf7] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold">Financial report drill-down</p>
            <p className="text-xs text-gray-600">
              Review reconciliations and export evidence for the selected
              reporting date.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className={softButton}
              onClick={() => setShowTrial((value) => !value)}
            >
              {showTrial ? "Hide trial balance" : "View trial balance"}
            </button>
            <button
              className={softButton}
              onClick={() => loadDetail("suspense")}
            >
              Suspense accounts
            </button>
            <button
              className={softButton}
              onClick={() => loadDetail("receivable")}
            >
              Receivables ageing
            </button>
            <button
              className={softButton}
              onClick={() => loadDetail("payable")}
            >
              Payables ageing
            </button>
            <button className={softButton} onClick={() => loadDetail("cash")}>
              Cash movement
            </button>
            <button
              className={softButton}
              onClick={() => loadDetail("forecast")}
            >
              90-day cash forecast
            </button>
            <button
              className={softButton}
              onClick={() => loadDetail("cost-centres")}
            >
              Cost-centre report
            </button>
            <button
              className={softButton}
              onClick={() => loadDetail("comparative")}
            >
              Comparative reports
            </button>
            <button className={softButton} onClick={() => loadDetail("fx")}>
              FX revaluation preview
            </button>
            <button className={softButton} onClick={() => loadDetail("audit")}>
              Audit trail
            </button>
          </div>
        </div>
        {showTrial && (
          <Grid
            headers={[
              "Account code",
              "Account",
              "Type",
              "Debit",
              "Credit",
              "Balance",
            ]}
            rows={(reports.trial || []).map((row: any) => [
              row.account_code,
              row.account_name,
              row.account_type,
              money(row.debit),
              money(row.credit),
              money(row.balance),
            ])}
          />
        )}
        {suspense && (
          <Grid
            headers={["Suspense account", "Balance"]}
            rows={suspense.map((row: any) => [
              `${row.account_code} — ${row.account_name}`,
              money(row.balance),
            ])}
          />
        )}
        {ageing && (
          <div className="p-4">
            <p className="font-semibold mb-3">
              {ageing.direction} ageing as at {date(ageing.as_of)}
            </p>
            <Grid
              headers={["Current", "1–30", "31–60", "61–90", "Over 90"]}
              rows={[
                [
                  money(ageing.buckets.current),
                  money(ageing.buckets.days_1_30),
                  money(ageing.buckets.days_31_60),
                  money(ageing.buckets.days_61_90),
                  money(ageing.buckets.over_90),
                ],
              ]}
            />
          </div>
        )}
        {cashFlow && (
          <div className="p-4 space-y-3">
            <p className="font-semibold">
              Cash movement as at {date(cashFlow.as_of)}
            </p>
            <Grid
              headers={[
                "Opening cash",
                "Inflows",
                "Outflows",
                "Net movement",
                "Closing cash",
              ]}
              rows={[
                [
                  money(cashFlow.opening_balance),
                  money(cashFlow.total_inflows),
                  money(cashFlow.total_outflows),
                  money(cashFlow.net_cash_movement),
                  money(cashFlow.closing_balance),
                ],
              ]}
            />
          </div>
        )}
        {cashForecast && (
          <div className="p-4 space-y-3 border-t">
            <div>
              <p className="font-semibold">
                Cash forecast through {date(cashForecast.through)}
              </p>
              <p className="text-xs text-gray-600">
                Forecast only: based on open receivables and payables. It does
                not create a voucher or bank entry.
              </p>
            </div>
            <Grid
              headers={[
                "Current cash",
                "Expected receipts",
                "Expected payments",
                "Projected cash",
              ]}
              rows={[
                [
                  money(cashForecast.current_cash),
                  money(cashForecast.expected_receipts),
                  money(cashForecast.expected_payments),
                  money(cashForecast.projected_cash),
                ],
              ]}
            />
            <Grid
              headers={["Period", "Receipts", "Payments", "Net cash change"]}
              rows={(cashForecast.buckets || []).map((row: any) => [
                row.label,
                money(row.receivables),
                money(row.payables),
                money(row.net_cash_change),
              ])}
            />
            {cashForecast.items?.length > 0 && (
              <Grid
                headers={[
                  "Due date",
                  "Document",
                  "Party",
                  "Type",
                  "Outstanding",
                ]}
                rows={cashForecast.items.map((item: any) => [
                  date(item.due_date),
                  item.document_number,
                  item.party?.party_name || "-",
                  item.direction,
                  money(item.outstanding),
                ])}
              />
            )}
          </div>
        )}
        {comparative && (
          <div className="p-4 space-y-3 border-t">
            <div>
              <p className="font-semibold">Comparative financials</p>
              <p className="text-xs text-gray-600">
                Current versus prior-year cut-off: {date(comparative.as_of)} /{" "}
                {date(comparative.compare_as_of)}.
              </p>
            </div>
            <Grid
              headers={[
                "Measure",
                "Current",
                "Prior",
                "Variance",
                "Variance %",
              ]}
              rows={[
                ["Revenue", comparative.profit_loss?.revenue],
                ["Expenses", comparative.profit_loss?.expense],
                ["Net profit / (loss)", comparative.profit_loss?.profit],
                ["Assets", comparative.balance_sheet?.assets],
                ["Liabilities", comparative.balance_sheet?.liabilities],
                ["Equity", comparative.balance_sheet?.equity],
                ["Closing cash", comparative.cash?.closing],
                ["Cash movement", comparative.cash?.movement],
              ].map(([label, value]: any) => [
                label,
                money(value?.current),
                money(value?.prior),
                money(value?.variance),
                value?.variance_percent === null ||
                value?.variance_percent === undefined
                  ? "-"
                  : `${value.variance_percent}%`,
              ])}
            />
          </div>
        )}
        {fxPreview && (
          <div className="p-4 space-y-3 border-t">
            <div>
              <p className="font-semibold">FX revaluation preview</p>
              <p className="text-xs text-gray-600">
                Preview only. Review the rate and post a controlled adjustment
                journal separately; no entry has been created.
              </p>
            </div>
            <Grid
              headers={[
                "Account",
                "Currency",
                "Foreign balance",
                "Book balance",
                "Closing rate",
                "Revalued balance",
                "Difference",
              ]}
              rows={(fxPreview.lines || []).map((row: any) => [
                `${row.account?.account_code || ""} — ${row.account?.account_name || ""}`,
                row.currency_code,
                row.foreign_balance,
                money(row.base_balance),
                row.closing_rate,
                money(row.revalued_base_balance),
                money(row.difference_amount),
              ])}
            />
          </div>
        )}
        {auditTrail && (
          <div className="p-4 space-y-3 border-t">
            <div>
              <p className="font-semibold">Accounting audit trail</p>
              <p className="text-xs text-gray-600">
                Latest controlled vouchers, workflow events and operational
                posting attempts.
              </p>
            </div>
            <Grid
              headers={[
                "When",
                "Event / voucher",
                "Status",
                "Source",
                "Detail",
              ]}
              rows={[
                ...(auditTrail.journals || []).map((row: any) => [
                  date(row.created_at),
                  row.journal_number,
                  row.status,
                  row.source_type || "Manual",
                  row.narration,
                ]),
                ...(auditTrail.workflow_events || []).map((row: any) => [
                  date(row.created_at),
                  row.journal?.journal_number || "Journal workflow",
                  row.to_status || row.event_type,
                  "Workflow",
                  row.note || row.event_type,
                ]),
                ...(auditTrail.source_postings || []).map((row: any) => [
                  date(row.created_at),
                  row.journal?.journal_number ||
                    row.source_document_number ||
                    "Operational source",
                  row.status,
                  row.source_type,
                  row.error_message || row.source_document_number || "-",
                ]),
              ].slice(0, 100)}
            />
          </div>
        )}
        {costCentres && (
          <div className="p-4 space-y-3 border-t">
            <div>
              <p className="font-semibold">Cost-centre / project report</p>
              <p className="text-xs text-gray-600">
                Posted journal lines from {date(costCentres.from)} to{" "}
                {date(costCentres.to)}. Unassigned lines remain visible for
                control.
              </p>
            </div>
            <Grid
              headers={[
                "Cost centre / project",
                "Entries",
                "Debit",
                "Credit",
                "Net",
              ]}
              rows={(costCentres.centres || []).map((row: any) => [
                row.cost_center,
                row.entries,
                money(row.debit),
                money(row.credit),
                money(row.net),
              ])}
            />
            {costCentres.lines?.length > 0 && (
              <Grid
                headers={[
                  "Date",
                  "Voucher",
                  "Cost centre",
                  "Ledger account",
                  "Debit",
                  "Credit",
                  "Narration",
                ]}
                rows={costCentres.lines.map((line: any) => [
                  date(line.journal_date),
                  line.journal_number || "-",
                  line.cost_center,
                  `${line.account_code || "-"} - ${line.account_name || "-"}`,
                  money(line.debit),
                  money(line.credit),
                  line.description || line.narration || "-",
                ])}
              />
            )}
          </div>
        )}
      </section>
      <section className="border rounded-xl overflow-hidden">
        <div className="bg-[#fcfaf7] px-4 py-3">
          <p className="font-semibold">Journal register</p>
          <p className="text-xs text-gray-600">
            Voucher-level audit register. Use Posted for financial reporting, or
            include drafts during review.
          </p>
        </div>
        <div className="p-4 flex flex-wrap items-end gap-3">
          <label className="block text-sm text-gray-700">
            <span className="block mb-1">From date</span>
            <input
              type="date"
              value={journalFrom}
              onChange={(event) => setJournalFrom(event.target.value)}
              className="border rounded-lg px-3 py-2"
            />
          </label>
          <label className="block text-sm text-gray-700">
            <span className="block mb-1">To date</span>
            <input
              type="date"
              value={asOf}
              onChange={(event) => setAsOf(event.target.value)}
              className="border rounded-lg px-3 py-2"
            />
          </label>
          <label className="block text-sm text-gray-700">
            <span className="block mb-1">Voucher status</span>
            <select
              value={journalStatus}
              onChange={(event) => setJournalStatus(event.target.value)}
              className="border rounded-lg px-3 py-2"
            >
              <option value="POSTED">Posted</option>
              <option value="DRAFT">Draft</option>
              <option value="REVERSED">Reversed</option>
              <option value="ALL">All statuses</option>
            </select>
          </label>
          <label className="block text-sm text-gray-700 flex-1 min-w-[220px]">
            <span className="block mb-1">Search</span>
            <input
              value={journalSearch}
              onChange={(event) => setJournalSearch(event.target.value)}
              placeholder="Voucher, narration or source"
              className="w-full border rounded-lg px-3 py-2"
            />
          </label>
          <button className={softButton} onClick={loadJournalRegister}>
            View register
          </button>
          <button
            className={softButton}
            disabled={!journalRegister?.length}
            onClick={exportJournalRegister}
          >
            Export CSV
          </button>
        </div>
        {journalRegister && (
          <Grid
            headers={[
              "Voucher",
              "Date",
              "Source",
              "Narration",
              "Status",
              "Debit",
              "Credit",
            ]}
            rows={journalRegister.map((row: any) => [
              row.journal_number,
              date(row.journal_date),
              row.source_type || "Manual",
              row.narration,
              <Status key={`status-${row.id}`} value={row.status} />,
              money(row.total_debit),
              money(row.total_credit),
            ])}
          />
        )}
      </section>
    </div>
  );
}
function LedgerDrawer({ ledger, close }: any) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 p-4 flex justify-end">
      <section className="bg-white w-full max-w-4xl h-full overflow-auto shadow-2xl">
        <header className="sticky top-0 bg-white border-b p-4 flex justify-between items-start">
          <div>
            <p className="text-xs uppercase text-[#9a7445]">General ledger</p>
            <h2 className="text-xl font-semibold">
              {ledger.account.account_code} — {ledger.account.account_name}
            </h2>
            <p className="text-sm text-gray-600">
              Opening {money(ledger.opening_balance)} · Closing{" "}
              {money(ledger.closing_balance)}
            </p>
          </div>
          <button className={softButton} onClick={close}>
            Close
          </button>
        </header>
        <Grid
          headers={[
            "Date",
            "Voucher",
            "Narration",
            "Debit",
            "Credit",
            "Running balance",
          ]}
          rows={(ledger.entries || []).map((entry: any) => [
            date(entry.journal?.journal_date),
            entry.journal?.journal_number || "-",
            entry.description || entry.journal?.narration || "-",
            money(entry.debit),
            money(entry.credit),
            money(entry.running_balance),
          ])}
        />
      </section>
    </div>
  );
}
function JournalDrawer({ journal, accounts, close }: any) {
  const lines = [...(journal.lines || [])].sort(
    (a: any, b: any) => a.line_number - b.line_number,
  );
  const debit = lines.reduce(
    (sum: number, line: any) => sum + Number(line.debit || 0),
    0,
  );
  const credit = lines.reduce(
    (sum: number, line: any) => sum + Number(line.credit || 0),
    0,
  );
  return (
    <div className="fixed inset-0 z-50 bg-black/40 p-4 flex justify-end">
      <section className="bg-white w-full max-w-5xl h-full overflow-auto shadow-2xl">
        <header className="sticky top-0 bg-white border-b p-4 flex justify-between items-start gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-[#9a7445]">
              Journal voucher
            </p>
            <h2 className="text-xl font-semibold text-[#2e241d]">
              {journal.journal_number}
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              {date(journal.journal_date)} ·{" "}
              {journal.source_type || "Manual journal"}
            </p>
            <p className="text-sm text-gray-700 mt-2">{journal.narration}</p>
          </div>
          <div className="flex items-center gap-3">
            <Status value={journal.status} />
            <button className={softButton} onClick={close}>
              Close
            </button>
          </div>
        </header>
        <div className="p-4">
          <Grid
            headers={[
              "Line",
              "Account",
              "Description",
              "Debit",
              "Credit",
              "Cost centre",
              "Tax code",
            ]}
            rows={lines.map((line: any) => [
              line.line_number,
              accountName(accounts, line.account_id),
              line.description || "-",
              money(line.debit),
              money(line.credit),
              line.cost_center || "-",
              line.tax_code || "-",
            ])}
          />
          <div className="mt-4 ml-auto max-w-sm rounded-lg border bg-[#fcfaf7] p-3 grid grid-cols-2 gap-y-2 text-sm">
            <span>Total debit</span>
            <strong className="text-right">{money(debit)}</strong>
            <span>Total credit</span>
            <strong className="text-right">{money(credit)}</strong>
            <span>Difference</span>
            <strong
              className={`text-right ${Math.abs(debit - credit) < 0.005 ? "text-green-700" : "text-red-700"}`}
            >
              {money(debit - credit)}
            </strong>
          </div>
          <section className="mt-4 rounded-lg border p-3 text-sm">
            <h3 className="font-semibold">Finance review</h3>
            {journal.review ? (
              <div className="mt-2 grid sm:grid-cols-2 gap-2">
                <span>
                  Outcome:{" "}
                  <strong>
                    {String(journal.review.review_status).replaceAll("_", " ")}
                  </strong>
                </span>
                <span>
                  Reviewed:{" "}
                  <strong>
                    {new Date(journal.review.reviewed_at).toLocaleString(
                      "en-IN",
                    )}
                  </strong>
                </span>
                {journal.review.review_note && (
                  <span className="sm:col-span-2">
                    Note: {journal.review.review_note}
                  </span>
                )}
              </div>
            ) : (
              <p className="mt-1 text-gray-600">
                Not yet reviewed. Review evidence is recorded separately from
                posting.
              </p>
            )}
            {journal.approval ? (
              <div className="mt-3 border-t pt-3 grid sm:grid-cols-2 gap-2">
                <span>
                  Approval:{" "}
                  <strong>
                    {String(journal.approval.approval_status).replaceAll(
                      "_",
                      " ",
                    )}
                  </strong>
                </span>
                <span>
                  Approved:{" "}
                  <strong>
                    {new Date(journal.approval.approved_at).toLocaleString(
                      "en-IN",
                    )}
                  </strong>
                </span>
                {journal.approval.approval_note && (
                  <span className="sm:col-span-2">
                    Approval note: {journal.approval.approval_note}
                  </span>
                )}
              </div>
            ) : (
              <p className="mt-3 border-t pt-3 text-gray-600">
                Approval is pending after independent review.
              </p>
            )}
          </section>
          {(journal.workflow || []).length > 0 && (
            <section className="mt-4 rounded-lg border p-3 text-sm">
              <h3 className="font-semibold">Voucher workflow audit</h3>
              <div className="mt-2 space-y-1">
                {journal.workflow.map((event: any) => (
                  <div
                    key={event.id}
                    className="flex flex-wrap justify-between gap-x-3 text-gray-700"
                  >
                    <span>
                      {String(event.event_type).replaceAll("_", " ")} ·{" "}
                      {event.from_status || "—"} → {event.to_status}
                    </span>
                    <span>
                      {new Date(event.created_at).toLocaleString("en-IN")}
                    </span>
                    {event.note && (
                      <span className="w-full text-gray-500">{event.note}</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
          <JournalEvidence journal={journal} />
        </div>
      </section>
    </div>
  );
}
function JournalEvidence({ journal }: any) {
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [items, setItems] = useState<any[]>(journal.attachments || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function upload() {
    if (!file) {
      setError("Choose a supporting document first.");
      return;
    }
    try {
      setBusy(true);
      setError("");
      const form = new FormData();
      form.append("file", file);
      if (note.trim()) form.append("note", note.trim());
      const result = await apiClient.postForm(
        `/accounting/journals/${journal.id}/attachments`,
        form,
      );
      setItems((rows) => [result, ...rows]);
      setFile(null);
      setNote("");
    } catch (caught: any) {
      setError(caught?.message || "Supporting evidence could not be uploaded.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-6 rounded-xl border bg-[#fcfaf7] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-[#2e241d]">Supporting evidence</h3>
          <p className="text-xs text-gray-600 mt-1">
            Attach bills, approval notes, working papers, or source documents.
            Evidence is retained separately and does not change a posted
            voucher.
          </p>
        </div>
        <span className="text-sm text-gray-600">
          {items.length} file{items.length === 1 ? "" : "s"}
        </span>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="mt-3 grid md:grid-cols-[1fr_1fr_auto] gap-2 items-end">
        <label className="block text-sm">
          <span className="block mb-1">File</span>
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.xls,.xlsx"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
            className="w-full border rounded-lg px-3 py-2 bg-white"
          />
        </label>
        <label className="block text-sm">
          <span className="block mb-1">Evidence note</span>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Approval / bill / reconciliation note"
            className="w-full border rounded-lg px-3 py-2 bg-white"
          />
        </label>
        <button
          type="button"
          disabled={!file || busy}
          onClick={upload}
          className="px-4 py-2 rounded-lg bg-[#6b4d2e] text-white disabled:opacity-50"
        >
          {busy ? "Uploading…" : "Attach evidence"}
        </button>
      </div>
      {items.length > 0 && (
        <div className="mt-4 divide-y rounded-lg border bg-white">
          {items.map((item: any) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <div>
                <a
                  className="text-[#6b4d2e] underline font-medium"
                  href={item.file_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {item.file_name}
                </a>
                {item.note && (
                  <p className="text-xs text-gray-600 mt-0.5">{item.note}</p>
                )}
              </div>
              <span className="text-xs text-gray-500">
                {date(item.created_at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
function AssetsPanel({ assets, search, change, create }: any) {
  const [schedule, setSchedule] = useState<any[] | null>(null);
  const [asOf, setAsOf] = useState(today());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [posting, setPosting] = useState(false);
  async function depreciation() {
    try {
      setError("");
      setNotice("");
      setSchedule(
        await apiClient.get(
          `/accounting/fixed-assets/depreciation?as_of=${asOf}`,
        ),
      );
    } catch (caught: any) {
      setError(
        caught?.message || "Depreciation schedule could not be calculated.",
      );
    }
  }
  async function postDepreciation() {
    if (
      !schedule?.length ||
      !window.confirm(
        `Post monthly depreciation dated ${asOf} for ${schedule.length} asset(s)? Posted vouchers can only be reversed.`,
      )
    )
      return;
    try {
      setPosting(true);
      setError("");
      const result = await apiClient.post(
        "/accounting/fixed-assets/depreciation/post",
        { posting_date: asOf, asset_ids: schedule.map((item: any) => item.id) },
      );
      setNotice(
        `Depreciation posted in ${result.journals?.length || 0} voucher(s): ${money(result.total_depreciation)}.`,
      );
      await depreciation();
    } catch (caught: any) {
      setError(caught?.message || "Depreciation could not be posted.");
    } finally {
      setPosting(false);
    }
  }
  return (
    <>
      <Toolbar
        placeholder="Search asset"
        search={search}
        change={change}
        create={create}
        label="New asset"
      />
      <section className="mx-3 mb-3 rounded-xl border bg-[#fcfaf7] p-4 flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <p className="font-semibold text-[#2e241d]">Depreciation run</p>
          <p className="text-xs text-gray-600">
            Calculate first, then post a separate immutable journal per asset
            and month.
          </p>
        </div>
        <label className="block text-sm">
          Posting date
          <input
            type="date"
            value={asOf}
            onChange={(event) => setAsOf(event.target.value)}
            className="block mt-1 border rounded px-3 py-2"
          />
        </label>
        <button className={softButton} onClick={depreciation}>
          Calculate schedule
        </button>
        <button
          className={softButton}
          disabled={!schedule?.length || posting}
          onClick={postDepreciation}
        >
          {posting ? "Posting…" : "Post depreciation"}
        </button>
      </section>
      {notice && (
        <Banner tone="success" text={notice} close={() => setNotice("")} />
      )}
      {error && <Banner tone="error" text={error} close={() => setError("")} />}
      <Grid
        headers={["Asset code", "Asset", "Acquired", "Cost", "Life", "Status"]}
        rows={assets.map((item: any) => [
          item.asset_code,
          item.asset_name,
          date(item.acquisition_date),
          money(item.cost),
          `${item.useful_life_months} months`,
          item.status,
        ])}
      />
      {schedule && (
        <div className="border-t">
          <Grid
            headers={[
              "Asset",
              "Monthly depreciation",
              "Depreciation to date",
              "Net book value",
              "Posting setup",
            ]}
            rows={schedule.map((item: any) => [
              item.asset_name,
              money(item.monthly_depreciation),
              money(item.depreciation_to_date),
              money(item.net_book_value),
              item.depreciation_account_id &&
              item.accumulated_depreciation_account_id
                ? "Ready"
                : "Missing ledgers",
            ])}
          />
        </div>
      )}
    </>
  );
}
const softButton =
  "px-3 py-2 rounded-lg border border-[#9a7445] text-[#6b4d2e] hover:bg-[#f7f1e7]";
function OpeningBalances({ rows, accounts, action }: any) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [lines, setLines] = useState([
    { account_id: "", debit: "", credit: "", description: "" },
  ]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const source = new FormData(event.currentTarget);
    action(
      () =>
        apiClient.post("/accounting/opening-balances", {
          batch_number: source.get("batch_number"),
          as_of_date: source.get("as_of_date"),
          suspense_account_id: source.get("suspense_account_id") || null,
          source_reference: source.get("source_reference"),
          lines: lines.map((line) => ({
            ...line,
            debit: Number(line.debit || 0),
            credit: Number(line.credit || 0),
          })),
        }),
      "Opening-balance batch prepared for independent validation.",
      "page",
      setError,
    ).then((ok: boolean) => {
      if (ok) setOpen(false);
    });
  };
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
        <div>
          <h3 className="font-semibold">Opening balance migration</h3>
          <p className="text-sm text-gray-600">
            Four-person control: prepare, independently validate, approve
            against signed evidence, then post one immutable AED journal.
          </p>
        </div>
        <button className={softButton} onClick={() => setOpen(true)}>
          New opening batch
        </button>
      </div>
      <Grid
        headers={[
          "Batch",
          "As of",
          "Lines",
          "Suspense",
          "Status",
          "Journal",
          "Actions",
        ]}
        rows={rows.map((row: any) => [
          row.batch_number,
          date(row.as_of_date),
          (row.lines || []).length,
          row.suspense
            ? `${row.suspense.account_code} — ${row.suspense.account_name}`
            : "Balanced / none",
          <Status key="s" value={row.status} />,
          row.journal?.journal_number || "-",
          <span className="flex gap-2" key="a">
            {row.status === "DRAFT" && (
              <button
                className={textButton}
                onClick={() =>
                  action(
                    () =>
                      apiClient.post(
                        `/accounting/opening-balances/${row.id}/validate`,
                      ),
                    `Opening batch ${row.batch_number} validated.`,
                    "page",
                  )
                }
              >
                Validate
              </button>
            )}
            {row.status === "VALIDATED" && (
              <button
                className={textButton}
                onClick={() => {
                  const note = window.prompt(
                    "Approval note / signed trial-balance reference",
                  );
                  if (note)
                    action(
                      () =>
                        apiClient.post(
                          `/accounting/opening-balances/${row.id}/approve`,
                          { approval_note: note },
                        ),
                      `Opening batch ${row.batch_number} approved.`,
                      "page",
                    );
                }}
              >
                Approve
              </button>
            )}
            {row.status === "APPROVED" && (
              <button
                className={textButton}
                onClick={() => {
                  if (
                    window.confirm(
                      `Post approved opening batch ${row.batch_number}? This creates an immutable AED journal.`,
                    )
                  )
                    action(
                      () =>
                        apiClient.post(
                          `/accounting/opening-balances/${row.id}/post`,
                        ),
                      `Opening batch ${row.batch_number} posted.`,
                      "page",
                    );
                }}
              >
                Post
              </button>
            )}
          </span>,
        ])}
      />
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
          <form
            className="h-full w-full max-w-4xl overflow-y-auto bg-white p-6 shadow-xl"
            onSubmit={submit}
          >
            <div className="flex justify-between border-b pb-4">
              <div>
                <h2 className="text-xl font-semibold">
                  New opening-balance batch
                </h2>
                <p className="text-sm text-gray-600">
                  Use suspense only to migrate a known difference; resolve it
                  through a separate adjustment journal.
                </p>
              </div>
              <button
                type="button"
                className={softButton}
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
            {error && (
              <p
                role="alert"
                className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700"
              >
                {error}
              </p>
            )}
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Field
                name="batch_number"
                label="Batch number"
                placeholder="Auto-generated if blank"
              />
              <Field
                name="as_of_date"
                label="Opening date"
                type="date"
                required
                defaultValue={today()}
              />
              <label className="block text-sm">
                <span className="mb-1 block">
                  Suspense account (only if unbalanced)
                </span>
                <select
                  name="suspense_account_id"
                  className="w-full rounded-lg border px-3 py-2"
                >
                  <option value="">None — source balances must balance</option>
                  {accounts.map((account: any) => (
                    <option key={account.id} value={account.id}>
                      {account.account_code} — {account.account_name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <Field
              name="source_reference"
              label="Source file / reference"
              placeholder="e.g. audited opening trial balance"
            />
            <div className="mt-4 overflow-x-auto rounded border">
              <div className="grid min-w-[680px] grid-cols-[1fr_140px_140px_1fr_80px] gap-2 border-b bg-[#fcfaf7] p-3 text-xs font-semibold uppercase">
                <span>Ledger</span>
                <span>Debit</span>
                <span>Credit</span>
                <span>Description</span>
                <span></span>
              </div>
              {lines.map((line, index) => (
                <div
                  key={index}
                    className="grid min-w-[680px] grid-cols-[1fr_140px_140px_1fr_80px] gap-2 border-b p-2"
                >
                  <select
                    required
                    value={line.account_id}
                    className="rounded border px-2"
                    onChange={(e) =>
                      setLines((current) =>
                        current.map((x, i) =>
                          i === index
                            ? { ...x, account_id: e.target.value }
                            : x,
                        ),
                      )
                    }
                  >
                    <option value="">Select ledger</option>
                    {accounts.map((account: any) => (
                      <option key={account.id} value={account.id}>
                        {account.account_code} — {account.account_name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="rounded border px-2"
                    value={line.debit}
                    onChange={(e) =>
                      setLines((current) =>
                        current.map((x, i) =>
                          i === index ? { ...x, debit: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="rounded border px-2"
                    value={line.credit}
                    onChange={(e) =>
                      setLines((current) =>
                        current.map((x, i) =>
                          i === index ? { ...x, credit: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <input
                    className="rounded border px-2"
                    value={line.description}
                    onChange={(e) =>
                      setLines((current) =>
                        current.map((x, i) =>
                          i === index
                            ? { ...x, description: e.target.value }
                            : x,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    className={textButton}
                    disabled={lines.length === 1}
                    onClick={() =>
                      setLines((current) =>
                        current.filter((_, i) => i !== index),
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className={`${textButton} mt-3`}
              onClick={() =>
                setLines((current) => [
                  ...current,
                  { account_id: "", debit: "", credit: "", description: "" },
                ])
              }
            >
              + Add line
            </button>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className={softButton}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button className={primaryButton}>Prepare batch</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
function StatutoryReturns({ rows, action }: any) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const source = new FormData(event.currentTarget);
    action(
      () =>
        apiClient.post("/accounting/statutory-returns", {
          return_type: source.get("return_type"),
          period_from: source.get("period_from"),
          period_to: source.get("period_to"),
          reference_number: source.get("reference_number"),
          working_note: source.get("working_note"),
        }),
      "Statutory return drafted for review.",
      "page",
      setError,
    ).then((ok: boolean) => {
      if (ok) setOpen(false);
    });
  };
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
        <div>
          <h3 className="font-semibold">Statutory return register</h3>
          <p className="text-sm text-gray-600">
            Keep GST, VAT, TDS and withholding working papers reviewed and filed
            with an audit trail.
          </p>
        </div>
        <button className={softButton} onClick={() => setOpen(true)}>
          New return
        </button>
      </div>
      <Grid
        headers={[
          "Return",
          "Period",
          "Reference",
          "Status",
          "Filed",
          "Actions",
        ]}
        rows={rows.map((row: any) => [
          row.return_type,
          `${date(row.period_from)} to ${date(row.period_to)}`,
          row.reference_number || "-",
          <Status key="s" value={row.status} />,
          date(row.filed_at),
          <span className="flex gap-2" key="a">
            {row.status === "DRAFT" && (
              <button
                className={textButton}
                onClick={() =>
                  action(
                    () =>
                      apiClient.patch(
                        `/accounting/statutory-returns/${row.id}`,
                        { status: "REVIEWED" },
                      ),
                    `${row.return_type} return marked reviewed.`,
                    "page",
                  )
                }
              >
                Mark reviewed
              </button>
            )}
            {row.status === "REVIEWED" && (
              <button
                className={textButton}
                onClick={() =>
                  action(
                    () =>
                      apiClient.patch(
                        `/accounting/statutory-returns/${row.id}`,
                        { status: "FILED" },
                      ),
                    `${row.return_type} return marked filed.`,
                    "page",
                  )
                }
              >
                Mark filed
              </button>
            )}
          </span>,
        ])}
      />
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
          <form
            onSubmit={submit}
            className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-xl"
          >
            <div className="flex justify-between border-b pb-4">
              <h2 className="text-xl font-semibold">New statutory return</h2>
              <button
                type="button"
                className={softButton}
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
            {error && (
              <p role="alert" className="mt-3 text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block">Return type *</span>
                <select
                  name="return_type"
                  required
                  className="w-full rounded-lg border px-3 py-2"
                >
                  <option value="GST">GST</option>
                  <option value="VAT">VAT</option>
                  <option value="TDS">TDS</option>
                  <option value="WITHHOLDING">Withholding tax</option>
                </select>
              </label>
              <Field name="reference_number" label="Working reference" />
              <Field
                name="period_from"
                label="Period from"
                type="date"
                required
              />
              <Field name="period_to" label="Period to" type="date" required />
            </div>
            <Field name="working_note" label="Working note" type="textarea" />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className={softButton}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button className={primaryButton}>Save return</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
function ReportSchedules({ rows, action }: any) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const source = new FormData(event.currentTarget);
    action(
      () =>
        apiClient.post("/accounting/report-schedules", {
          report_code: source.get("report_code"),
          schedule_name: source.get("schedule_name"),
          frequency: source.get("frequency"),
          recipients: source.get("recipients"),
          is_active: source.get("is_active") === "on",
        }),
      "Report schedule saved. It remains an auditable configuration until an approved delivery automation is enabled.",
      "page",
      setError,
    ).then((ok: boolean) => {
      if (ok) setOpen(false);
    });
  };
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
        <div>
          <h3 className="font-semibold">Management report schedules</h3>
          <p className="text-sm text-gray-600">
            Configure recipients and frequency; delivery remains controlled and
            auditable.
          </p>
        </div>
        <button className={softButton} onClick={() => setOpen(true)}>
          New schedule
        </button>
      </div>
      <Grid
        headers={[
          "Schedule",
          "Report",
          "Frequency",
          "Recipients",
          "Active",
          "Next run",
        ]}
        rows={rows.map((row: any) => [
          row.schedule_name,
          row.report_code,
          row.frequency,
          Array.isArray(row.recipients) ? row.recipients.join(", ") : "-",
          row.is_active ? "Yes" : "No",
          date(row.next_run_at),
        ])}
      />
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
          <form
            onSubmit={submit}
            className="h-full w-full max-w-xl bg-white p-6 shadow-xl"
          >
            <div className="flex justify-between border-b pb-4">
              <h2 className="text-xl font-semibold">New report schedule</h2>
              <button
                type="button"
                className={softButton}
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
            {error && (
              <p role="alert" className="mt-3 text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="mt-4 grid gap-3">
              <Field name="schedule_name" label="Schedule name" required />
              <label className="block text-sm">
                <span className="mb-1 block">Report *</span>
                <select
                  name="report_code"
                  required
                  className="w-full rounded-lg border px-3 py-2"
                >
                  <option value="TRIAL_BALANCE">Trial balance</option>
                  <option value="PROFIT_LOSS">Profit and loss</option>
                  <option value="BALANCE_SHEET">Balance sheet</option>
                  <option value="CASH_FLOW">Cash flow</option>
                  <option value="AGEING">Receivable/payable ageing</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block">Frequency *</span>
                <select
                  name="frequency"
                  required
                  className="w-full rounded-lg border px-3 py-2"
                >
                  <option value="MONTHLY">Monthly</option>
                  <option value="WEEKLY">Weekly</option>
                  <option value="QUARTERLY">Quarterly</option>
                  <option value="DAILY">Daily</option>
                </select>
              </label>
              <Field
                name="recipients"
                label="Recipients"
                placeholder="finance@example.com; director@example.com"
              />
              <label className="flex gap-2 text-sm">
                <input name="is_active" type="checkbox" /> Mark active (requires
                approved delivery automation)
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className={softButton}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button className={primaryButton}>Save schedule</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
const primaryButton =
  "rounded-lg bg-[#6b4d2e] px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50";
const textButton =
  "text-[#6b4d2e] underline underline-offset-2 hover:text-[#9a7445] disabled:opacity-40";
function Bank({ data, create, action }: any) {
  return (
    <>
      <div className="p-3 border-b flex flex-wrap gap-2">
        <button className={softButton} onClick={() => create("bank")}>
          New bank account
        </button>
        <button
          className={softButton}
          onClick={() => create("bank-transaction")}
        >
          Add bank transaction
        </button>
        <button className={softButton} onClick={() => create("bank-import")}>
          Import bank statement
        </button>
      </div>
      <div className="px-4 py-2 text-xs text-gray-600 bg-[#fcfaf7]">
        Imported statement rows remain unmatched until finance matches them to a
        posted voucher or excludes them. Duplicate statement lines are skipped
        safely.
      </div>
      <Grid
        headers={["Bank", "Ledger", "Currency", "Opening balance", "Status"]}
        rows={data.bank.map((item: any) => [
          item.bank_name,
          accountName(data.accounts, item.account_id),
          item.currency_code,
          money(item.opening_balance),
          item.is_active ? "Active" : "Inactive",
        ])}
      />
      <div className="border-t">
        <Grid
          headers={[
            "Date",
            "Bank",
            "Reference",
            "Direction",
            "Amount",
            "Reconciliation",
            "Action",
          ]}
          rows={data.bankTransactions.map((item: any) => [
            date(item.transaction_date),
            item.bank?.bank_name || "-",
            item.reference_number || "-",
            item.direction,
            money(item.amount),
            <Status key="s" value={item.reconciliation_status} />,
            <BankReconciliation
              key="b"
              row={item}
              journals={data.journals}
              action={action}
            />,
          ])}
        />
      </div>
    </>
  );
}
function TaxWorkspace({ taxCodes, create }: any) {
  const [from, setFrom] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(today());
  const [register, setRegister] = useState<any>(null);
  const [error, setError] = useState("");
  async function loadRegister() {
    try {
      setError("");
      setRegister(
        await apiClient.get(`/accounting/tax-register?from=${from}&to=${to}`),
      );
    } catch (caught: any) {
      setError(caught?.message || "Tax register could not be loaded.");
    }
  }
  function exportRegister() {
    if (!register?.entries?.length) return;
    const values: Array<Array<string | number>> = [
      [
        "Date",
        "Voucher",
        "Tax code",
        "Tax name",
        "Type",
        "Rate",
        "Debit",
        "Credit",
        "Narration",
      ],
      ...register.entries.map((item: any) => [
        item.journal_date,
        item.journal_number,
        item.tax_code,
        item.tax_name,
        item.tax_type,
        item.rate,
        Number(item.debit || 0).toFixed(2),
        Number(item.credit || 0).toFixed(2),
        item.narration,
      ]),
    ];
    const csv = values
      .map((row) =>
        row
          .map(
            (value: string | number) =>
              `"${String(value).replaceAll('"', '""')}"`,
          )
          .join(","),
      )
      .join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    link.download = `tax-register-${from}-to-${to}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }
  return (
    <div className="space-y-4">
      <section className="p-4 border-b bg-[#fcfaf7] flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <p className="font-semibold text-[#2e241d]">
            Tax compliance register
          </p>
          <p className="text-xs text-gray-600">
            Posted voucher tax lines only. Review GST/VAT and withholding before
            filing.
          </p>
        </div>
        <label className="text-sm">
          From
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="block mt-1 border rounded px-3 py-2"
          />
        </label>
        <label className="text-sm">
          To
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="block mt-1 border rounded px-3 py-2"
          />
        </label>
        <button className={softButton} onClick={loadRegister}>
          View register
        </button>
        <button
          className={softButton}
          disabled={!register?.entries?.length}
          onClick={exportRegister}
        >
          Export CSV
        </button>
      </section>
      {error && <Banner tone="error" text={error} close={() => setError("")} />}
      {register && (
        <>
          <Grid
            headers={[
              "Tax code",
              "Tax name",
              "Type",
              "Rate",
              "Input / debit",
              "Output / credit",
              "Net payable",
            ]}
            rows={(register.summary || []).map((item: any) => [
              item.tax_code,
              item.tax_name,
              item.tax_type,
              `${item.rate}%`,
              money(item.debit),
              money(item.credit),
              money(item.net),
            ])}
          />
          <Grid
            headers={[
              "Date",
              "Voucher",
              "Tax code",
              "Type",
              "Rate",
              "Debit",
              "Credit",
              "Narration",
            ]}
            rows={(register.entries || []).map((item: any) => [
              date(item.journal_date),
              item.journal_number,
              item.tax_code,
              item.tax_type,
              `${item.rate}%`,
              money(item.debit),
              money(item.credit),
              item.narration,
            ])}
          />
        </>
      )}
      <section className="border-t">
        <div className="p-3 border-b flex justify-between items-center">
          <div>
            <p className="font-semibold text-[#2e241d]">Tax-code master</p>
            <p className="text-xs text-gray-600">
              Maintain GST, VAT and withholding codes used on journal lines.
            </p>
          </div>
          <button className={softButton} onClick={create}>
            New tax code
          </button>
        </div>
        <Grid
          headers={["Code", "Tax name", "Type", "Rate", "Status"]}
          rows={taxCodes.map((item: any) => [
            item.tax_code,
            item.tax_name,
            item.tax_type,
            `${item.rate}%`,
            item.is_active ? "Active" : "Inactive",
          ])}
        />
      </section>
    </div>
  );
}
function BankReconciliation({ row, journals, action }: any) {
  const [open, setOpen] = useState(false);
  const [journalId, setJournalId] = useState(row.matched_journal_id || "");
  const posted = journals.filter((journal: any) => journal.status === "POSTED");
  const eligible = posted.filter((journal: any) =>
    (journal.lines || []).some(
      (line: any) =>
        line.account_id === row.bank?.account_id &&
        Math.abs(
          Number(line.debit || 0) +
            Number(line.credit || 0) -
            Number(row.amount || 0),
        ) < 0.005,
    ),
  );
  const reopen = () =>
    action(
      () =>
        apiClient.post(`/accounting/bank-transactions/${row.id}/reconcile`, {
          status: "UNMATCHED",
        }),
      "Bank transaction returned to the reconciliation queue.",
    );
  const exclude = () => {
    const reason = window.prompt(
      "Document why this statement row should be excluded from ledger reconciliation:",
    );
    if (!reason?.trim()) return;
    action(
      () =>
        apiClient.post(`/accounting/bank-transactions/${row.id}/reconcile`, {
          status: "EXCLUDED",
          exclusion_reason: reason.trim(),
        }),
      "Bank transaction excluded with documented evidence; the audit record remains available.",
    );
  };
  if (open)
    return (
      <div className="grid gap-1 min-w-[250px]">
        <select
          aria-label="Eligible posted bank matching journal"
          className="border rounded px-2 py-1"
          value={journalId}
          onChange={(event) => setJournalId(event.target.value)}
        >
          <option value="">
            {eligible.length
              ? "Select exact matching journal *"
              : "No exact ledger/amount match"}
          </option>
          {eligible.map((journal: any) => (
            <option key={journal.id} value={journal.id}>
              {journal.journal_number} — {journal.narration}
            </option>
          ))}
        </select>
        {!eligible.length && (
          <span className="text-xs text-amber-700">
            Create and post the matching bank-ledger journal first.
          </span>
        )}
        <span className="flex gap-2">
          <button
            className={textButton}
            disabled={!journalId}
            onClick={() =>
              action(
                () =>
                  apiClient.post(
                    `/accounting/bank-transactions/${row.id}/reconcile`,
                    { status: "MATCHED", journal_id: journalId },
                  ),
                "Bank transaction matched to the posted journal.",
              )
            }
          >
            Match
          </button>
          <button className={textButton} onClick={() => setOpen(false)}>
            Cancel
          </button>
        </span>
      </div>
    );
  if (row.reconciliation_status === "MATCHED") {
    const journal = posted.find(
      (item: any) => item.id === row.matched_journal_id,
    );
    return (
      <span className="flex flex-wrap gap-2">
        <span>Matched{journal ? `: ${journal.journal_number}` : ""}</span>
        <button className={textButton} onClick={reopen}>
          Reopen
        </button>
      </span>
    );
  }
  if (row.reconciliation_status === "EXCLUDED")
    return (
      <span className="flex flex-wrap gap-2">
        <span>Excluded</span>
        <button className={textButton} onClick={reopen}>
          Reopen
        </button>
      </span>
    );
  return (
    <span className="flex flex-wrap gap-2">
      <button className={textButton} onClick={() => setOpen(true)}>
        Match journal
      </button>
      <button className={textButton} onClick={exclude}>
        Exclude
      </button>
    </span>
  );
}
function Budgets({ rows, create, action }: any) {
  const [variance, setVariance] = useState<any>(null);
  const [error, setError] = useState("");
  async function viewVariance(item: any) {
    try {
      setError("");
      setVariance(
        await apiClient.get(`/accounting/budgets/${item.id}/variance`),
      );
    } catch (caught: any) {
      setError(caught?.message || "Budget variance could not be loaded.");
    }
  }
  const totalVariance = variance
    ? Number(variance.totals?.budget || 0) -
      Number(variance.totals?.actual || 0)
    : 0;
  return (
    <>
      <div className="p-3 border-b flex flex-wrap gap-2 items-center justify-between">
        <div>
          <p className="text-sm font-medium text-[#2e241d]">Budget control</p>
          <p className="text-xs text-gray-600">
            Compare approved monthly budgets with posted general-ledger actuals.
            This report does not create postings.
          </p>
        </div>
        <button className={softButton} onClick={create}>
          New budget
        </button>
      </div>
      {error && <Banner tone="error" text={error} close={() => setError("")} />}
      {variance && (
        <section className="m-3 rounded-xl border bg-[#fcfaf7] overflow-hidden">
          <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 border-b">
            <div>
              <p className="font-semibold text-[#2e241d]">
                {variance.budget?.budget_name} variance
              </p>
              <p className="text-xs text-gray-600">
                Posted actuals from {date(variance.from)} to {date(variance.to)}
                .
              </p>
            </div>
            <button className={textButton} onClick={() => setVariance(null)}>
              Close variance
            </button>
          </div>
          <div className="p-4 grid sm:grid-cols-3 gap-3">
            <Metric label="Budget" value={money(variance.totals?.budget)} />
            <Metric label="Actual" value={money(variance.totals?.actual)} />
            <Metric label="Remaining / (over)" value={money(totalVariance)} />
          </div>
          <Grid
            headers={[
              "Period",
              "Ledger account",
              "Cost centre",
              "Budget",
              "Actual",
              "Remaining / (over)",
              "Status",
            ]}
            rows={(variance.lines || []).map((line: any) => [
              date(line.period_start),
              line.account
                ? `${line.account.account_code} - ${line.account.account_name}`
                : "-",
              line.cost_center || "-",
              money(line.amount),
              money(line.actual),
              money(line.variance),
              <Status key={line.id} value={line.variance_status} />,
            ])}
          />
        </section>
      )}
      <Grid
        headers={["Budget", "Fiscal year", "Lines", "Status", "Actions"]}
        rows={rows.map((item: any) => [
          item.budget_name,
          item.fiscal_year,
          item.lines?.length || 0,
          <Status key="s" value={item.status} />,
          <span key="a" className="flex gap-3">
            <button className={textButton} onClick={() => viewVariance(item)}>
              Variance
            </button>
            {item.status === "DRAFT" ? (
              <button
                className={textButton}
                onClick={() =>
                  action(
                    () =>
                      apiClient.post(`/accounting/budgets/${item.id}/approve`),
                    "Budget approved.",
                  )
                }
              >
                Approve budget
              </button>
            ) : (
              <span>Approved</span>
            )}
          </span>,
        ])}
      />
    </>
  );
}
function Periods({ rows, create, action }: any) {
  const [checklist, setChecklist] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [error, setError] = useState("");
  async function review(item: any) {
    try {
      setError("");
      const [nextChecklist, nextTasks] = await Promise.all([
        apiClient.get(`/accounting/periods/${item.id}/close-checklist`),
        apiClient.get(`/accounting/periods/${item.id}/tasks`),
      ]);
      setChecklist(nextChecklist);
      setTasks(nextTasks || []);
    } catch (caught: any) {
      setError(
        caught?.message || "Period-close checklist could not be loaded.",
      );
    }
  }
  return (
    <>
      <div className="p-3 border-b flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[#2e241d]">Period close</p>
          <p className="text-xs text-gray-600">
            Review controls before closing; locking preserves the audit trail.
          </p>
        </div>
        <button className={softButton} onClick={create}>
          New period
        </button>
      </div>
      {error && <p className="mx-3 mt-3 text-sm text-red-700">{error}</p>}
      {checklist && (
        <section className="m-3 rounded-xl border border-[#ddcfbb] bg-[#fcfaf7] p-4">
          <div className="flex flex-wrap justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-widest text-[#9a7445]">
                Close checklist
              </p>
              <h3 className="font-semibold text-[#2e241d]">
                {checklist.period.period_name}
              </h3>
            </div>
            <button
              className={textButton}
              onClick={() => {
                setChecklist(null);
                setTasks([]);
              }}
            >
              Close checklist
            </button>
          </div>
          <div className="mt-3 grid gap-2">
            {checklist.checks.map((check: any) => (
              <div
                key={check.code}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2 text-sm"
              >
                <div>
                  <strong className="text-[#2e241d]">{check.label}</strong>
                  <p className="text-xs text-gray-600 mt-0.5">{check.detail}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span>
                    {check.amount !== undefined
                      ? money(check.amount)
                      : check.count}
                  </span>
                  <Status value={check.status} />
                </div>
              </div>
            ))}
          </div>
          <p
            className={`mt-3 text-sm font-medium ${checklist.ready_to_close ? "text-green-700" : "text-amber-700"}`}
          >
            {checklist.ready_to_close
              ? "Required posting checks are clear. This period can be closed."
              : "Resolve the required posting checks before closing this period."}
          </p>
          <div className="mt-4 border-t pt-3">
            <p className="text-xs uppercase tracking-widest text-[#9a7445]">
              Controlled close tasks
            </p>
            <p className="mt-1 text-xs text-gray-600">
              Assign, document and complete the operational close tasks before
              the period is locked.
            </p>
            <div className="mt-2 grid gap-2">
              {tasks.map((task: any) => (
                <div
                  key={task.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2 text-sm"
                >
                  <div>
                    <strong>{task.task_name}</strong>
                    {task.owner_name && (
                      <span className="ml-2 text-xs text-gray-500">
                        Owner: {task.owner_name}
                      </span>
                    )}
                    {task.notes && (
                      <p className="mt-0.5 text-xs text-gray-600">
                        {task.notes}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Status value={task.status} />
                    <select
                      aria-label={`Status for ${task.task_name}`}
                      value={task.status}
                      onChange={(event) => {
                        const status = event.target.value;
                        const note =
                          status === "WAIVED"
                            ? window.prompt(
                                "Document the waiver reason:",
                                task.note || "",
                              )
                            : task.note;
                        if (status === "WAIVED" && !note) return;
                        action(
                          () =>
                            apiClient.patch(
                              `/accounting/period-close-tasks/${task.id}`,
                              { status, note },
                            ),
                          "Period-close task updated.",
                          "page",
                          setError,
                        ).then(async (ok: boolean) => {
                          if (ok && checklist?.period?.id) {
                            const refreshed = await apiClient.get(
                              `/accounting/periods/${checklist.period.id}/tasks`,
                            );
                            setTasks(refreshed || []);
                          }
                        });
                      }}
                      className="rounded border px-2 py-1 text-xs"
                    >
                      <option value="OPEN">Open</option>
                      <option value="IN_REVIEW">In review</option>
                      <option value="COMPLETE">Complete</option>
                      <option value="WAIVED">Waived</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
      <Grid
        headers={["Period", "Start", "End", "Status", "Actions"]}
        rows={rows.map((item: any) => [
          item.period_name,
          date(item.start_date),
          date(item.end_date),
          <Status key="s" value={item.status} />,
          <span key="a" className="flex gap-3">
            <button className={textButton} onClick={() => review(item)}>
              Close checks
            </button>
            {item.status === "OPEN" ? (
              <button
                className={textButton}
                onClick={() =>
                  action(
                    () =>
                      apiClient.patch(`/accounting/periods/${item.id}/close`),
                    "Accounting period closed.",
                  )
                }
              >
                Close period
              </button>
            ) : item.status === "CLOSED" ? (
              <button
                className={textButton}
                onClick={() =>
                  action(
                    () =>
                      apiClient.patch(`/accounting/periods/${item.id}/lock`),
                    "Accounting period locked. Posted entries remain read-only.",
                  )
                }
              >
                Lock period
              </button>
            ) : (
              <span>Locked</span>
            )}
          </span>,
        ])}
      />
    </>
  );
}
function JournalActions({ row, action, view, edit, setError }: any) {
  const [confirmation, setConfirmation] = useState<"POST" | "REVERSE" | null>(
    null,
  );
  const run = async (operation: "POST" | "REVERSE") => {
    const succeeded = await action(
      () =>
        operation === "POST"
          ? apiClient.post(`/accounting/journals/${row.id}/post`)
          : apiClient.post(`/accounting/journals/${row.id}/reverse`, {
              narration: `Reversal of ${row.journal_number}`,
            }),
      operation === "POST"
        ? `Journal ${row.journal_number} posted.`
        : `Reversal journal created for ${row.journal_number}.`,
      "page",
      setError,
    );
    if (succeeded) setConfirmation(null);
  };
  if (confirmation)
    return (
      <span className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
        <span>
          {confirmation === "POST"
            ? "Post this balanced draft? It can only be corrected by reversal."
            : "Create and post a reversing voucher? The original will be marked reversed."}
        </span>
        <button className={textButton} onClick={() => run(confirmation)}>
          {confirmation === "POST" ? "Confirm post" : "Confirm reversal"}
        </button>
        <button className={textButton} onClick={() => setConfirmation(null)}>
          Cancel
        </button>
      </span>
    );
  return (
    <span className="flex flex-wrap gap-2">
      <button className={textButton} onClick={view}>
        View
      </button>
      {row.status === "DRAFT" && (
        <>
          <button className={textButton} onClick={edit}>
            Edit
          </button>
          <button
            className={textButton}
            onClick={() => {
              if (
                window.confirm(
                  `Delete draft journal ${row.journal_number}? This cannot be undone.`,
                )
              )
                action(
                  () => apiClient.delete(`/accounting/journals/${row.id}`),
                  `Draft journal ${row.journal_number} deleted.`,
                  "page",
                  setError,
                );
            }}
          >
            Delete
          </button>
          <button
            className={textButton}
            onClick={() => {
              const note = window.prompt("Review note (optional):");
              if (note === null) return;
              action(
                () =>
                  apiClient.post(`/accounting/journals/${row.id}/review`, {
                    review_status: "APPROVED",
                    review_note: note,
                  }),
                `Journal ${row.journal_number} reviewed and sent for approval.`,
                "page",
                setError,
              );
            }}
          >
            Mark reviewed
          </button>
        </>
      )}
      {row.status === "REVIEWED" && (
        <>
          <button
            className={textButton}
            onClick={() => {
              const note = window.prompt("Return-to-draft note (optional):");
              if (note === null) return;
              action(
                () =>
                  apiClient.post(`/accounting/journals/${row.id}/review`, {
                    review_status: "RETURNED",
                    review_note: note,
                  }),
                `Journal ${row.journal_number} returned to draft.`,
                "page",
                setError,
              );
            }}
          >
            Return to draft
          </button>
          <button
            className={textButton}
            onClick={() => {
              const note = window.prompt("Approval note (optional):");
              if (note === null) return;
              action(
                () =>
                  apiClient.post(`/accounting/journals/${row.id}/approve`, {
                    approval_status: "APPROVED",
                    approval_note: note,
                  }),
                `Journal ${row.journal_number} approved and ready for posting.`,
                "page",
                setError,
              );
            }}
          >
            Approve
          </button>
        </>
      )}
      {row.status === "APPROVED" && (
        <>
          <button
            className={textButton}
            onClick={() => {
              const note = window.prompt("Return-to-draft note (optional):");
              if (note === null) return;
              action(
                () =>
                  apiClient.post(`/accounting/journals/${row.id}/approve`, {
                    approval_status: "RETURNED",
                    approval_note: note,
                  }),
                `Journal ${row.journal_number} returned to draft.`,
                "page",
                setError,
              );
            }}
          >
            Return to draft
          </button>
          <button
            className={textButton}
            onClick={() => setConfirmation("POST")}
          >
            Post
          </button>
        </>
      )}
      {row.status === "POSTED" && (
        <button
          className={textButton}
          onClick={() => setConfirmation("REVERSE")}
        >
          Reverse
        </button>
      )}
    </span>
  );
}
function Settle({ row, journals, action }: any) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(due(row).toFixed(2)));
  const [journalId, setJournalId] = useState("");
  if (row.status === "SETTLED") return <>Settled</>;
  return (
    <>
      {open ? (
        <div className="grid gap-1 min-w-[230px]">
          <input
            aria-label="Settlement amount"
            className="border rounded px-2 py-1"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <select
            aria-label="Posted payment journal"
            className="border rounded px-2 py-1"
            value={journalId}
            onChange={(event) => setJournalId(event.target.value)}
          >
            <option value="">Posted payment/receipt journal *</option>
            {journals
              .filter((journal: any) => journal.status === "POSTED")
              .map((journal: any) => (
                <option key={journal.id} value={journal.id}>
                  {journal.journal_number} — {journal.narration}
                </option>
              ))}
          </select>
          <span className="flex gap-2">
            <button
              className={textButton}
              disabled={!journalId}
              onClick={() =>
                action(
                  () =>
                    apiClient.post(`/accounting/open-items/${row.id}/settle`, {
                      amount: Number(amount),
                      settlement_date: today(),
                      journal_id: journalId,
                    }),
                  "Settlement recorded and linked to the posted journal.",
                )
              }
            >
              Save
            </button>
            <button className={textButton} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </span>
        </div>
      ) : (
        <button className={textButton} onClick={() => setOpen(true)}>
          Record settlement
        </button>
      )}
    </>
  );
}

function RecurringJournalForm({ template, accounts, error, close, save }: any) {
  const [lines, setLines] = useState<any[]>(
    template?.lines?.length
      ? template.lines.map((line: any) => ({
          account_id: line.account_id || "",
          description: line.description || "",
          debit: Number(line.debit || 0) ? String(line.debit) : "",
          credit: Number(line.credit || 0) ? String(line.credit) : "",
        }))
      : [
          { account_id: "", description: "", debit: "", credit: "" },
          { account_id: "", description: "", debit: "", credit: "" },
        ],
  );
  const [localError, setLocalError] = useState("");
  const debit = lines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
  const credit = lines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
  const balanced = debit > 0 && Math.abs(debit - credit) < 0.005;
  function updateLine(index: number, key: string, value: string) {
    setLines((current) =>
      current.map((line, position) =>
        position === index ? { ...line, [key]: value } : line,
      ),
    );
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError("");
    if (!balanced) {
      setLocalError(
        "Journal debits and credits must balance and be greater than zero.",
      );
      return;
    }
    const source = new FormData(event.currentTarget);
    save({
      template_code: source.get("template_code"),
      template_name: source.get("template_name"),
      frequency: source.get("frequency"),
      next_run_date: source.get("next_run_date"),
      transaction_currency_code: source.get("transaction_currency_code"),
      exchange_rate: Number(source.get("exchange_rate") || 1),
      narration: source.get("narration"),
      lines: lines.map((line) => ({
        account_id: line.account_id,
        description: line.description,
        debit: Number(line.debit || 0),
        credit: Number(line.credit || 0),
      })),
    });
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end">
      <form
        onSubmit={submit}
        className="h-full w-full max-w-3xl overflow-y-auto bg-white p-6 shadow-xl"
      >
        <div className="flex justify-between items-start gap-4 mb-5">
          <div>
            <p className="text-xs uppercase tracking-widest text-[#9a7445]">
              Accounting control
            </p>
            <h2 className="text-xl font-semibold">
              {template ? "Edit recurring journal" : "New recurring journal"}
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              This template only creates balanced draft vouchers. Finance must
              review and post each generated voucher.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close recurring journal"
            className="text-lg"
            onClick={close}
          >
            ×
          </button>
        </div>
        {(error || localError) && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {localError || error}
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-4">
          <Field
            name="template_code"
            label="Template code"
            required
            defaultValue={template?.template_code}
            disabled={Boolean(template)}
            placeholder="e.g. MONTHLY-RENT"
          />
          <Field
            name="template_name"
            label="Template name"
            required
            defaultValue={template?.template_name}
            placeholder="e.g. Monthly premises rent"
          />
          <Select
            name="frequency"
            label="Frequency"
            options={["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]}
            defaultValue={template?.frequency || "MONTHLY"}
          />
          <Field
            name="next_run_date"
            label="Next run date"
            type="date"
            required
            defaultValue={
              template?.next_run_date ? date(template.next_run_date) : today()
            }
          />
          <Field
            name="transaction_currency_code"
            label="Transaction currency"
            required
            defaultValue={template?.transaction_currency_code || "INR"}
          />
          <Field
            name="exchange_rate"
            label="Exchange rate to INR"
            type="number"
            required
            defaultValue={template?.exchange_rate || 1}
          />
          <label className="sm:col-span-2 block text-sm text-gray-700">
            <span className="block mb-1">Narration *</span>
            <textarea
              name="narration"
              required
              defaultValue={template?.narration}
              className="w-full border rounded-lg px-3 py-2"
              rows={3}
              placeholder="Narration carried to each generated draft voucher"
            />
          </label>
        </div>
        <section className="mt-6 border rounded-xl overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-[#fcfaf7] px-4 py-3">
            <div>
              <h3 className="font-semibold">Journal lines</h3>
              <p className="text-xs text-gray-600">
                Debit {money(debit)} · Credit {money(credit)} ·{" "}
                {balanced ? "Balanced" : "Action required"}
              </p>
            </div>
            <button
              type="button"
              className={softButton}
              onClick={() =>
                setLines((current) => [
                  ...current,
                  { account_id: "", description: "", debit: "", credit: "" },
                ])
              }
            >
              + Add line
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#f8f3eb] text-left text-xs uppercase tracking-wide text-gray-600">
                <tr>
                  <th className="p-3">Ledger account</th>
                  <th className="p-3">Description</th>
                  <th className="p-3">Debit</th>
                  <th className="p-3">Credit</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={index} className="border-t">
                    <td className="p-2 min-w-[210px]">
                      <select
                        required
                        value={line.account_id}
                        onChange={(event) =>
                          updateLine(index, "account_id", event.target.value)
                        }
                        className="w-full border rounded-lg px-2 py-2"
                      >
                        <option value="">Select account</option>
                        {accounts
                          .filter((account: any) => account.is_active)
                          .map((account: any) => (
                            <option key={account.id} value={account.id}>
                              {account.account_code} - {account.account_name}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="p-2 min-w-[180px]">
                      <input
                        value={line.description}
                        onChange={(event) =>
                          updateLine(index, "description", event.target.value)
                        }
                        className="w-full border rounded-lg px-2 py-2"
                        placeholder="Optional description"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.debit}
                        onChange={(event) =>
                          updateLine(index, "debit", event.target.value)
                        }
                        className="w-28 border rounded-lg px-2 py-2"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.credit}
                        onChange={(event) =>
                          updateLine(index, "credit", event.target.value)
                        }
                        className="w-28 border rounded-lg px-2 py-2"
                      />
                    </td>
                    <td className="p-2">
                      <button
                        type="button"
                        className={textButton}
                        disabled={lines.length <= 2}
                        onClick={() =>
                          setLines((current) =>
                            current.filter((_, position) => position !== index),
                          )
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <div className="flex justify-end gap-2 mt-7 pt-4 border-t">
          <button
            type="button"
            className="px-4 py-2 border rounded-lg"
            onClick={close}
          >
            Cancel
          </button>
          <button className="px-4 py-2 bg-[#6b4d2e] text-white rounded-lg">
            Save template
          </button>
        </div>
      </form>
    </div>
  );
}
function AccountingForm({
  kind,
  data,
  initialAccount,
  initialCostCentre,
  initialPostingRule,
  initialExchangeRate,
  initialParty,
  initialJournal,
  error,
  close,
  save,
}: any) {
  const [journalLines, setJournalLines] = useState<
    Array<{
      account_id: string;
      description: string;
      debit: string;
      credit: string;
      cost_center: string;
      tax_code: string;
    }>
  >(() =>
    initialJournal?.lines?.length
      ? initialJournal.lines.map((line: any) => ({
          account_id: line.account_id,
          description: line.description || "",
          debit: Number(line.debit || 0) ? String(line.debit) : "",
          credit: Number(line.credit || 0) ? String(line.credit) : "",
          cost_center: line.cost_center || "",
          tax_code: line.tax_code || "",
        }))
      : [
          {
            account_id: "",
            description: "",
            debit: "",
            credit: "",
            cost_center: "",
            tax_code: "",
          },
          {
            account_id: "",
            description: "",
            debit: "",
            credit: "",
            cost_center: "",
            tax_code: "",
          },
        ],
  );
  const [budgetLines, setBudgetLines] = useState([
    {
      account_id: "",
      period_start: `${new Date().getFullYear()}-01-01`,
      amount: "",
      cost_center: "",
    },
  ]);
  const title: Record<string, string> = {
    account: initialAccount
      ? `Edit ledger account ${initialAccount.account_code}`
      : "New ledger account",
    "cost-centre": initialCostCentre
      ? `Edit cost centre ${initialCostCentre.centre_code}`
      : "New cost centre / project",
    "posting-rule": initialPostingRule
      ? `Edit posting rule ${initialPostingRule.rule_code}`
      : "New posting rule",
    "posting-preview": `Create draft from ${initialPostingRule?.rule_code || "posting rule"}`,
    "exchange-rate": initialExchangeRate
      ? `Edit ${initialExchangeRate.from_currency_code}/${initialExchangeRate.to_currency_code} rate`
      : "New exchange rate",
    party: initialParty
      ? `Edit accounting party ${initialParty.party_name}`
      : "New accounting party",
    period: "New accounting period",
    journal: initialJournal
      ? `Edit draft journal ${initialJournal.journal_number}`
      : "New journal entry",
    "open-item": "New open item",
    bank: "New bank account",
    "bank-transaction": "New bank transaction",
    tax: "New tax code",
    asset: "New fixed asset",
    budget: "New budget",
  };
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const source = new FormData(event.currentTarget);
    const payload: any = Object.fromEntries(source.entries());
    [
      "opening_balance",
      "opening_debit",
      "opening_credit",
      "credit_limit",
      "credit_days",
      "rate",
      "exchange_rate",
      "cost",
      "residual_value",
      "useful_life_months",
      "amount",
      "original_amount",
    ].forEach((key) => {
      if (payload[key] !== undefined && payload[key] !== "")
        payload[key] = Number(payload[key]);
    });
    if (kind === "account") {
      payload.is_control_account = source.get("is_control_account") === "on";
      payload.is_suspense_account = source.get("is_suspense_account") === "on";
    }
    if (kind === "journal")
      payload.lines = journalLines.map((line) => ({
        ...line,
        debit: Number(line.debit || 0),
        credit: Number(line.credit || 0),
      }));
    if (kind === "budget")
      payload.lines = budgetLines.map((line) => ({
        ...line,
        amount: Number(line.amount || 0),
      }));
    save(payload);
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end">
      <form
        onSubmit={submit}
        className="h-full w-full max-w-2xl overflow-y-auto bg-white p-6 shadow-xl"
      >
        <div className="flex justify-between items-start mb-5">
          <div>
            <p className="text-xs uppercase tracking-widest text-[#9a7445]">
              Accounting control
            </p>
            <h2 className="text-xl font-semibold">{title[kind]}</h2>
          </div>
          <button
            type="button"
            aria-label="Close form"
            className="text-lg"
            onClick={close}
          >
            ×
          </button>
        </div>
        {error && (
          <div
            role="alert"
            className="mb-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            <strong className="block">Could not save this entry</strong>
            <span>{error}</span>
          </div>
        )}
        {kind === "account" && (
          <div className="grid md:grid-cols-2 gap-3">
            <Field
              name="account_code"
              label="Account code"
              required
              defaultValue={initialAccount?.account_code}
              disabled={Boolean(initialAccount)}
            />
            <Field
              name="account_name"
              label="Account name"
              required
              defaultValue={initialAccount?.account_name}
            />
            {initialAccount ? (
              <label className="block text-sm text-gray-700">
                <span className="block mb-1">Account type</span>
                <input
                  value={initialAccount.account_type}
                  disabled
                  className="w-full border rounded-lg px-3 py-2 bg-gray-50"
                />
              </label>
            ) : (
              <Select
                name="account_type"
                label="Account type"
                options={["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]}
              />
            )}
            <Field
              name="account_subtype"
              label="Account subtype"
              placeholder="Bank, inventory, sales..."
              defaultValue={initialAccount?.account_subtype}
            />
            <Field
              name="currency_code"
              label="Currency"
              defaultValue={initialAccount?.currency_code || "INR"}
              disabled={Boolean(initialAccount)}
            />
            <Field
              name="opening_debit"
              label="Opening debit"
              type="number"
              defaultValue={initialAccount?.opening_debit ?? "0"}
              disabled={Boolean(initialAccount)}
            />
            <Field
              name="opening_credit"
              label="Opening credit"
              type="number"
              defaultValue={initialAccount?.opening_credit ?? "0"}
              disabled={Boolean(initialAccount)}
            />
            <div className="space-y-2 pt-6">
              <label className="block text-sm">
                <input
                  type="checkbox"
                  name="is_control_account"
                  defaultChecked={Boolean(initialAccount?.is_control_account)}
                  disabled={Boolean(initialAccount)}
                />{" "}
                Control account
              </label>
              <label className="block text-sm">
                <input
                  type="checkbox"
                  name="is_suspense_account"
                  defaultChecked={Boolean(initialAccount?.is_suspense_account)}
                />{" "}
                Suspense account
              </label>
            </div>
          </div>
        )}
        {kind === "cost-centre" && (
          <div className="grid md:grid-cols-2 gap-3">
            <Field
              name="centre_code"
              label="Code"
              required
              defaultValue={initialCostCentre?.centre_code}
              disabled={Boolean(initialCostCentre)}
            />
            <Field
              name="centre_name"
              label="Name"
              required
              defaultValue={initialCostCentre?.centre_name}
            />
            <label className="block text-sm text-gray-700">
              <span className="block mb-1">Type</span>
              <select
                name="centre_type"
                defaultValue={initialCostCentre?.centre_type || "COST_CENTER"}
                className="w-full border rounded-lg px-3 py-2"
              >
                {["COST_CENTER", "PROJECT", "DEPARTMENT", "PROFIT_CENTER"].map(
                  (value) => (
                    <option key={value} value={value}>
                      {value.replaceAll("_", " ")}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="block text-sm text-gray-700">
              <span className="block mb-1">Parent centre</span>
              <select
                name="parent_id"
                defaultValue={initialCostCentre?.parent_id || ""}
                className="w-full border rounded-lg px-3 py-2"
              >
                <option value="">No parent</option>
                {data.costCentres
                  .filter(
                    (item: any) =>
                      item.id !== initialCostCentre?.id && item.is_active,
                  )
                  .map((item: any) => (
                    <option key={item.id} value={item.id}>
                      {item.centre_code} — {item.centre_name}
                    </option>
                  ))}
              </select>
            </label>
            <p className="md:col-span-2 text-xs text-gray-600">
              Use active codes in journals and budgets. Deactivate rather than
              delete a centre once it has been used, so historical reporting
              stays auditable.
            </p>
          </div>
        )}
        {kind === "party" && (
          <div className="grid md:grid-cols-2 gap-3">
            <Field
              name="party_name"
              label="Party name"
              required
              defaultValue={initialParty?.party_name}
            />
            {initialParty ? (
              <label className="block text-sm text-gray-700">
                <span className="block mb-1">Party type</span>
                <input
                  value={initialParty.party_type}
                  disabled
                  className="w-full border rounded-lg px-3 py-2 bg-gray-50"
                />
              </label>
            ) : (
              <Select
                name="party_type"
                label="Party type"
                options={["CUSTOMER", "SUPPLIER", "EMPLOYEE", "OTHER"]}
              />
            )}
            <Field
              name="party_code"
              label="Party code"
              defaultValue={initialParty?.party_code}
            />
            <label className="block text-sm">
              <span className="block mb-1">Receivable control ledger</span>
              <select
                name="receivable_account_id"
                defaultValue={initialParty?.receivable_account_id || ""}
                className="w-full border rounded-lg px-3 py-2"
              >
                <option value="">Not selected</option>
                {data.accounts
                  .filter((item: any) => item.is_active)
                  .map((item: any) => (
                    <option key={item.id} value={item.id}>
                      {item.account_code} — {item.account_name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="block mb-1">Payable control ledger</span>
              <select
                name="payable_account_id"
                defaultValue={initialParty?.payable_account_id || ""}
                className="w-full border rounded-lg px-3 py-2"
              >
                <option value="">Not selected</option>
                {data.accounts
                  .filter((item: any) => item.is_active)
                  .map((item: any) => (
                    <option key={item.id} value={item.id}>
                      {item.account_code} — {item.account_name}
                    </option>
                  ))}
              </select>
            </label>
            <Field
              name="credit_limit"
              label="Credit limit"
              type="number"
              defaultValue={initialParty?.credit_limit ?? "0"}
            />
            <Field
              name="credit_days"
              label="Credit days"
              type="number"
              defaultValue={initialParty?.credit_days ?? "0"}
            />
          </div>
        )}
        {kind === "posting-rule" && (
          <div className="grid md:grid-cols-2 gap-3">
            <Field
              name="rule_code"
              label="Rule code"
              required
              defaultValue={initialPostingRule?.rule_code}
              disabled={Boolean(initialPostingRule)}
            />
            <Field
              name="rule_name"
              label="Rule name"
              required
              defaultValue={initialPostingRule?.rule_name}
            />
            <label className="block text-sm text-gray-700">
              <span className="block mb-1">Operational source *</span>
              <select
                name="source_type"
                defaultValue={
                  initialPostingRule?.source_type || "SALES_INVOICE"
                }
                disabled={Boolean(initialPostingRule)}
                className="w-full border rounded-lg px-3 py-2 disabled:bg-gray-50"
              >
                {[
                  "SALES_INVOICE",
                  "SALES_RECEIPT",
                  "PURCHASE_INVOICE",
                  "SUPPLIER_PAYMENT",
                  "STOCK_RECEIPT",
                  "STOCK_ISSUE",
                  "PAYROLL",
                  "MANUAL_ADJUSTMENT",
                ].map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <AccountSelect
              data={data}
              name="debit_account_id"
              label="Debit account"
              defaultValue={initialPostingRule?.debit_account_id}
            />
            <AccountSelect
              data={data}
              name="credit_account_id"
              label="Credit account"
              defaultValue={initialPostingRule?.credit_account_id}
            />
            <AccountSelect
              data={data}
              name="tax_account_id"
              label="Tax account (optional)"
              optional
              defaultValue={initialPostingRule?.tax_account_id}
            />
            <Field
              name="narration_template"
              label="Narration template"
              placeholder="e.g. Sales invoice {{document_number}}"
              defaultValue={initialPostingRule?.narration_template}
            />
            <label className="md:col-span-2 block text-sm text-gray-700">
              <input
                type="checkbox"
                name="is_active"
                defaultChecked={Boolean(initialPostingRule?.is_active)}
              />{" "}
              Activate after finance review
            </label>
            <p className="md:col-span-2 text-xs text-gray-600">
              Activation records the approved template. Operational auto-posting
              remains intentionally disabled until the next controlled
              integration release.
            </p>
          </div>
        )}
        {kind === "posting-preview" && (
          <div className="grid md:grid-cols-2 gap-3">
            <div className="md:col-span-2 rounded-lg border bg-[#fcfaf7] p-3 text-sm">
              <strong>{initialPostingRule?.rule_name}</strong>
              <div className="mt-1">
                Debit:{" "}
                {accountName(
                  data.accounts,
                  initialPostingRule?.debit_account_id,
                )}
                <br />
                Credit:{" "}
                {accountName(
                  data.accounts,
                  initialPostingRule?.credit_account_id,
                )}
              </div>
              <p className="mt-2 text-xs text-gray-600">
                This creates a balanced draft voucher only. It does not change
                the operational document, stock, receivable, payable, or
                financial statements until Finance posts the voucher.
              </p>
            </div>
            <Field
              name="journal_number"
              label="Draft voucher number (optional)"
              placeholder="Auto-generated if blank"
            />
            <Field
              name="journal_date"
              label="Journal date"
              type="date"
              required
              defaultValue={today()}
            />
            <Field
              name="reference_number"
              label="Document reference"
              placeholder="Invoice, GRN, receipt, etc."
            />
            <Field
              name="amount"
              label="Posting amount"
              type="number"
              required
              placeholder="0.00"
            />
            <label className="md:col-span-2 block text-sm text-gray-700">
              <span className="block mb-1">Narration (optional)</span>
              <textarea
                name="narration"
                rows={3}
                placeholder="Uses the posting-rule narration template if left blank"
                className="w-full border rounded-lg px-3 py-2"
              />
            </label>
          </div>
        )}
        {kind === "exchange-rate" && (
          <div className="grid md:grid-cols-2 gap-3">
            <Field
              name="rate_date"
              label="Rate date"
              type="date"
              required
              defaultValue={
                initialExchangeRate?.rate_date?.slice(0, 10) || today()
              }
            />
            {initialExchangeRate ? (
              <div className="rounded-lg border bg-gray-50 px-3 py-2 text-sm">
                <span className="block text-xs text-gray-500">
                  Currency pair
                </span>
                <strong>
                  {initialExchangeRate.from_currency_code} 1 ={" "}
                  {initialExchangeRate.to_currency_code}
                </strong>
                <input
                  type="hidden"
                  name="from_currency_code"
                  value={initialExchangeRate.from_currency_code}
                  readOnly
                />
                <input
                  type="hidden"
                  name="to_currency_code"
                  value={initialExchangeRate.to_currency_code}
                  readOnly
                />
              </div>
            ) : (
              <>
                <Field
                  name="from_currency_code"
                  label="Transaction currency"
                  required
                  placeholder="AED"
                />
                <Field
                  name="to_currency_code"
                  label="Functional currency"
                  required
                  defaultValue="INR"
                />
              </>
            )}
            <Field
              name="exchange_rate"
              label="Rate to functional currency"
              type="number"
              required
              defaultValue={initialExchangeRate?.exchange_rate}
              placeholder="e.g. 22.65"
            />
            <Field
              name="source_reference"
              label="Source / reference"
              defaultValue={initialExchangeRate?.source_reference}
              placeholder="Bank, RBI, CB, contract rate"
            />
            <p className="md:col-span-2 text-xs text-gray-600">
              Example: AED 1 = INR 22.65. Rates preserve transaction-currency
              evidence while the current Mizantra general ledger reports in INR.
            </p>
          </div>
        )}
        {kind === "period" && (
          <div className="grid md:grid-cols-2 gap-3">
            <Field
              name="period_name"
              label="Period name"
              required
              placeholder="FY 2026-27 / August 2026"
            />
            <Field name="start_date" label="Start date" type="date" required />
            <Field name="end_date" label="End date" type="date" required />
          </div>
        )}
        {kind === "journal" && (
          <>
            <div className="grid md:grid-cols-2 gap-3">
              <Field
                name="journal_number"
                label="Journal number (optional)"
                placeholder="Auto-generated if blank"
                defaultValue={initialJournal?.journal_number}
              />
              <Field
                name="journal_date"
                label="Journal date"
                type="date"
                required
                defaultValue={
                  initialJournal?.journal_date?.slice(0, 10) || today()
                }
              />
              <Field
                name="narration"
                label="Narration"
                required
                defaultValue={initialJournal?.narration}
              />
              <Field
                name="source_type"
                label="Source / voucher type"
                placeholder="Manual journal"
                defaultValue={initialJournal?.source_type}
              />
              <Field
                name="transaction_currency_code"
                label="Transaction currency"
                required
                defaultValue={
                  initialJournal?.transaction_currency_code || "INR"
                }
                placeholder="INR"
              />
              <Field
                name="exchange_rate"
                label="Exchange rate to INR"
                type="number"
                required
                defaultValue={initialJournal?.exchange_rate || "1"}
                placeholder="1"
              />
            </div>
            <div className="mt-5">
              <h3 className="font-semibold mb-2">Journal lines</h3>
              <p className="text-xs text-gray-600 mb-2">
                Line narration, cost centre / project, and tax code are
                optional. Use them for audit evidence, project profitability and
                tax-register reporting. Debit and credit are always recorded in
                INR; the transaction currency and rate retain the original
                foreign-currency evidence.
              </p>
              {journalLines.map((line, index) => (
                <div
                  className="grid grid-cols-[minmax(160px,1fr)_minmax(150px,1fr)_160px_140px_100px_100px_auto] gap-2 mb-2"
                  key={index}
                >
                  <select
                    required
                    value={line.account_id}
                    onChange={(event) =>
                      setJournalLines((rows) =>
                        rows.map((row, i) =>
                          i === index
                            ? { ...row, account_id: event.target.value }
                            : row,
                        ),
                      )
                    }
                    className="border rounded px-2"
                  >
                    <option value="">Select account</option>
                    {data.accounts
                      .filter((item: any) => item.is_active)
                      .map((item: any) => (
                        <option key={item.id} value={item.id}>
                          {item.account_code} — {item.account_name}
                        </option>
                      ))}
                  </select>
                  <input
                    aria-label="Journal line description"
                    placeholder="Line description"
                    value={line.description}
                    onChange={(event) =>
                      setJournalLines((rows) =>
                        rows.map((row, i) =>
                          i === index
                            ? { ...row, description: event.target.value }
                            : row,
                        ),
                      )
                    }
                    className="border rounded px-2"
                  />
                  <select
                    aria-label="Cost centre or project"
                    value={line.cost_center}
                    onChange={(event) =>
                      setJournalLines((rows) =>
                        rows.map((row, i) =>
                          i === index
                            ? { ...row, cost_center: event.target.value }
                            : row,
                        ),
                      )
                    }
                    className="border rounded px-2"
                  >
                    <option value="">No cost centre</option>
                    {data.costCentres
                      .filter((item: any) => item.is_active)
                      .map((item: any) => (
                        <option key={item.id} value={item.centre_code}>
                          {item.centre_code} — {item.centre_name}
                        </option>
                      ))}
                  </select>
                  <select
                    aria-label="Tax code"
                    value={line.tax_code}
                    onChange={(event) =>
                      setJournalLines((rows) =>
                        rows.map((row, i) =>
                          i === index
                            ? { ...row, tax_code: event.target.value }
                            : row,
                        ),
                      )
                    }
                    className="border rounded px-2"
                  >
                    <option value="">No tax code</option>
                    {data.tax
                      .filter((item: any) => item.is_active)
                      .map((item: any) => (
                        <option key={item.id} value={item.tax_code}>
                          {item.tax_code} — {item.tax_name}
                        </option>
                      ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Debit (INR)"
                    value={line.debit}
                    onChange={(event) =>
                      setJournalLines((rows) =>
                        rows.map((row, i) =>
                          i === index
                            ? {
                                ...row,
                                debit: event.target.value,
                                credit: event.target.value ? "" : row.credit,
                              }
                            : row,
                        ),
                      )
                    }
                    className="border rounded px-2"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Credit (INR)"
                    value={line.credit}
                    onChange={(event) =>
                      setJournalLines((rows) =>
                        rows.map((row, i) =>
                          i === index
                            ? {
                                ...row,
                                credit: event.target.value,
                                debit: event.target.value ? "" : row.debit,
                              }
                            : row,
                        ),
                      )
                    }
                    className="border rounded px-2"
                  />
                  <button
                    type="button"
                    className="link"
                    disabled={journalLines.length <= 2}
                    onClick={() =>
                      setJournalLines((rows) =>
                        rows.filter((_, i) => i !== index),
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="button mt-1"
                onClick={() =>
                  setJournalLines((rows) => [
                    ...rows,
                    {
                      account_id: "",
                      description: "",
                      debit: "",
                      credit: "",
                      cost_center: "",
                      tax_code: "",
                    },
                  ])
                }
              >
                + Add line
              </button>
            </div>
          </>
        )}
        {kind === "open-item" && (
          <div className="grid md:grid-cols-2 gap-3">
            <Select
              name="direction"
              label="Subledger"
              options={["RECEIVABLE", "PAYABLE"]}
            />
            <label className="block text-sm">
              <span className="block mb-1">Customer / supplier *</span>
              <select
                name="party_id"
                required
                className="w-full border rounded-lg px-3 py-2"
              >
                <option value="">Select accounting party</option>
                {data.parties
                  .filter((party: any) => party.is_active)
                  .map((party: any) => (
                    <option key={party.id} value={party.id}>
                      {party.party_name} ({party.party_type})
                    </option>
                  ))}
              </select>
            </label>
            <Field
              name="document_number"
              label="Invoice / document number"
              required
            />
            <Field
              name="document_date"
              label="Document date"
              type="date"
              required
              defaultValue={today()}
            />
            <Field name="due_date" label="Due date" type="date" />
            <Field
              name="original_amount"
              label="Original amount"
              type="number"
              required
            />
            <Field name="currency_code" label="Currency" defaultValue="INR" />
            <label className="block text-sm">
              <span className="block mb-1">Source posted journal</span>
              <select
                name="journal_id"
                className="w-full border rounded-lg px-3 py-2"
              >
                <option value="">Not linked (opening/manual item)</option>
                {data.journals
                  .filter((journal: any) => journal.status === "POSTED")
                  .map((journal: any) => (
                    <option key={journal.id} value={journal.id}>
                      {journal.journal_number} — {journal.narration}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        )}
        {kind === "bank" && (
          <div className="grid md:grid-cols-2 gap-3">
            <Field name="bank_name" label="Bank name" required />
            <Field name="account_name" label="Account display name" />
            <AccountSelect
              data={data}
              name="account_id"
              label="Ledger account"
            />
            <Field
              name="account_number_masked"
              label="Account number (masked)"
            />
            <Field name="ifsc_or_swift" label="IFSC / SWIFT" />
            <Field name="iban_masked" label="IBAN (masked)" />
            <Field name="currency_code" label="Currency" defaultValue="AED" />
            <Field name="statement_format_code" label="Statement format code" placeholder="ENBD_CSV" />
            <label className="block text-sm"><span className="mb-1 block">Reconciliation owner</span><select name="reconciliation_owner_id" className="w-full rounded-lg border px-3 py-2"><option value="">Not assigned</option>{(data.workflowUsers || []).map((user: any) => <option key={user.id} value={user.id}>{[user.first_name, user.last_name].filter(Boolean).join(" ") || user.email}</option>)}</select></label>
            <Field
              name="opening_balance"
              label="Opening balance"
              type="number"
              defaultValue="0"
            />
          </div>
        )}
        {kind === "bank-transaction" && (
          <div className="grid md:grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="block mb-1">Bank account *</span>
              <select
                name="bank_account_id"
                required
                className="w-full border rounded-lg px-3 py-2"
              >
                <option value="">Select bank account</option>
                {data.bank.map((item: any) => (
                  <option key={item.id} value={item.id}>
                    {item.bank_name}
                  </option>
                ))}
              </select>
            </label>
            <Select
              name="direction"
              label="Direction"
              options={["IN", "OUT"]}
            />
            <Field
              name="transaction_date"
              label="Transaction date"
              type="date"
              required
              defaultValue={today()}
            />
            <Field name="value_date" label="Value date" type="date" />
            <Field name="amount" label="Amount" type="number" required />
            <Field name="reference_number" label="Bank reference" />
            <Field name="description" label="Description" />
          </div>
        )}
        {kind === "tax" && (
          <div className="grid md:grid-cols-2 gap-3">
            <Field name="tax_code" label="Tax code" required />
            <Field name="tax_name" label="Tax name" required />
            <Select
              name="tax_type"
              label="Tax type"
              options={["GST", "VAT", "SALES_TAX", "WITHHOLDING", "OTHER"]}
            />
            <Field
              name="rate"
              label="Rate %"
              type="number"
              required
              defaultValue="0"
            />
            <AccountSelect
              data={data}
              name="input_account_id"
              label="Input tax ledger"
              optional
            />
            <AccountSelect
              data={data}
              name="output_account_id"
              label="Output tax ledger"
              optional
            />
          </div>
        )}
        {kind === "asset" && (
          <div className="grid md:grid-cols-2 gap-3">
            <Field name="asset_code" label="Asset code" required />
            <Field name="asset_name" label="Asset name" required />
            <AccountSelect
              data={data}
              name="asset_account_id"
              label="Asset ledger"
            />
            <AccountSelect
              data={data}
              name="depreciation_account_id"
              label="Depreciation expense ledger"
              optional
            />
            <AccountSelect
              data={data}
              name="accumulated_depreciation_account_id"
              label="Accumulated depreciation ledger"
              optional
            />
            <Field
              name="acquisition_date"
              label="Acquisition date"
              type="date"
              required
              defaultValue={today()}
            />
            <Field name="cost" label="Cost" type="number" required />
            <Field
              name="residual_value"
              label="Residual value"
              type="number"
              defaultValue="0"
            />
            <Field
              name="useful_life_months"
              label="Useful life (months)"
              type="number"
              defaultValue="60"
            />
            <Select
              name="depreciation_method"
              label="Method"
              options={["STRAIGHT_LINE"]}
            />
          </div>
        )}
        {kind === "budget" && (
          <>
            <div className="grid md:grid-cols-2 gap-3">
              <Field name="budget_name" label="Budget name" required />
              <Field
                name="fiscal_year"
                label="Fiscal year"
                required
                placeholder="2026-27"
              />
            </div>
            <h3 className="font-semibold mt-5 mb-2">Budget lines</h3>
            <p className="text-xs text-gray-600 mb-2">
              A cost centre is optional. Use it to control and compare budget
              versus actuals by project, department or profit centre.
            </p>
            {budgetLines.map((line, index) => (
              <div
                className="grid grid-cols-[minmax(180px,1fr)_180px_140px_130px_auto] gap-2 mb-2"
                key={index}
              >
                <select
                  required
                  value={line.account_id}
                  onChange={(event) =>
                    setBudgetLines((rows) =>
                      rows.map((row, i) =>
                        i === index
                          ? { ...row, account_id: event.target.value }
                          : row,
                      ),
                    )
                  }
                  className="border rounded px-2"
                >
                  <option value="">Select account</option>
                  {data.accounts
                    .filter((item: any) => item.is_active)
                    .map((item: any) => (
                      <option key={item.id} value={item.id}>
                        {item.account_code} — {item.account_name}
                      </option>
                    ))}
                </select>
                <select
                  aria-label="Budget cost centre or project"
                  value={line.cost_center}
                  onChange={(event) =>
                    setBudgetLines((rows) =>
                      rows.map((row, i) =>
                        i === index
                          ? { ...row, cost_center: event.target.value }
                          : row,
                      ),
                    )
                  }
                  className="border rounded px-2"
                >
                  <option value="">All cost centres</option>
                  {data.costCentres
                    .filter((item: any) => item.is_active)
                    .map((item: any) => (
                      <option key={item.id} value={item.centre_code}>
                        {item.centre_code} — {item.centre_name}
                      </option>
                    ))}
                </select>
                <input
                  type="date"
                  value={line.period_start}
                  onChange={(event) =>
                    setBudgetLines((rows) =>
                      rows.map((row, i) =>
                        i === index
                          ? { ...row, period_start: event.target.value }
                          : row,
                      ),
                    )
                  }
                  className="border rounded px-2"
                />
                <input
                  required
                  type="number"
                  min="0"
                  placeholder="Amount"
                  value={line.amount}
                  onChange={(event) =>
                    setBudgetLines((rows) =>
                      rows.map((row, i) =>
                        i === index
                          ? { ...row, amount: event.target.value }
                          : row,
                      ),
                    )
                  }
                  className="border rounded px-2"
                />
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    setBudgetLines((rows) =>
                      rows.length > 1
                        ? rows.filter((_, i) => i !== index)
                        : rows,
                    )
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="button"
              onClick={() =>
                setBudgetLines((rows) => [
                  ...rows,
                  {
                    account_id: "",
                    period_start: `${new Date().getFullYear()}-01-01`,
                    amount: "",
                    cost_center: "",
                  },
                ])
              }
            >
              + Add budget line
            </button>
          </>
        )}
        <div className="flex justify-end gap-2 mt-7 pt-4 border-t">
          <button
            type="button"
            className="px-4 py-2 border rounded-lg"
            onClick={close}
          >
            Cancel
          </button>
          <button className="px-4 py-2 bg-[#6b4d2e] text-white rounded-lg">
            {kind === "posting-preview" ? "Create draft voucher" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
function Field({
  name,
  label,
  type = "text",
  required = false,
  defaultValue,
  placeholder,
  disabled = false,
}: any) {
  return (
    <label className="block text-sm text-gray-700">
      <span className="block mb-1">
        {label}
        {required ? " *" : ""}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full border rounded-lg px-3 py-2 ${disabled ? "bg-gray-50 text-gray-500" : ""}`}
      />
    </label>
  );
}
function Select({ name, label, options, defaultValue }: any) {
  return (
    <label className="block text-sm text-gray-700">
      <span className="block mb-1">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="w-full border rounded-lg px-3 py-2"
      >
        {options.map((item: string) => (
          <option key={item} value={item}>
            {item.replaceAll("_", " ")}
          </option>
        ))}
      </select>
    </label>
  );
}
function AccountSelect({ data, name, label, optional, defaultValue }: any) {
  return (
    <label className="block text-sm text-gray-700">
      <span className="block mb-1">
        {label}
        {optional ? "" : " *"}
      </span>
      <select
        name={name}
        required={!optional}
        defaultValue={defaultValue || ""}
        className="w-full border rounded-lg px-3 py-2"
      >
        <option value="">{optional ? "Not selected" : "Select account"}</option>
        {data.accounts
          .filter((item: any) => item.is_active)
          .map((item: any) => (
            <option key={item.id} value={item.id}>
              {item.account_code} — {item.account_name}
            </option>
          ))}
      </select>
    </label>
  );
}
function Toolbar({ placeholder, search, change, create, label }: any) {
  return (
    <div className="p-3 border-b flex flex-wrap gap-2">
      <input
        className="flex-1 min-w-[240px] border rounded-lg px-3 py-2"
        placeholder={placeholder}
        value={search}
        onChange={(event) => change(event.target.value)}
      />
      <button
        className="px-3 py-2 rounded-lg border border-[#9a7445] text-[#6b4d2e] hover:bg-[#f7f1e7]"
        onClick={create}
      >
        + {label}
      </button>
    </div>
  );
}
function Metric({ label, value }: any) {
  return (
    <div className="border rounded-xl p-4 bg-white">
      <div className="text-xs uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="text-2xl font-semibold mt-1 text-[#2e241d]">{value}</div>
    </div>
  );
}
function Banner({ tone, text, close }: any) {
  return (
    <div
      className={`rounded-lg p-3 text-sm flex justify-between gap-3 ${tone === "error" ? "border border-red-200 bg-red-50 text-red-700" : "border border-green-200 bg-green-50 text-green-800"}`}
    >
      <span>{text}</span>
      <button onClick={close}>×</button>
    </div>
  );
}
function Status({ value }: any) {
  return (
    <span className="inline-flex px-2 py-1 rounded-full text-xs bg-[#f7f1e7] text-[#765735]">
      {String(value || "-").replaceAll("_", " ")}
    </span>
  );
}
function Report({ title, rows }: any) {
  return (
    <div className="border rounded-xl p-4">
      <h2 className="font-semibold mb-3">{title}</h2>
      {rows.map(([label, value]: [string, string]) => (
        <div key={label} className="flex justify-between border-b py-2 text-sm">
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}
function WorkflowRoles({
  rows,
  users,
  action,
}: {
  rows: any[];
  users: any[];
  action: any;
}) {
  const [userId, setUserId] = useState("");
  const [workflowRole, setWorkflowRole] = useState("JOURNAL_PREPARER");
  const roles = [
    "JOURNAL_PREPARER",
    "JOURNAL_REVIEWER",
    "JOURNAL_APPROVER",
    "JOURNAL_POSTER",
    "PAYMENT_PREPARER",
    "PAYMENT_APPROVER",
    "PAYMENT_POSTER",
    "BANK_RECONCILER",
    "BANK_RECON_REVIEWER",
  ];
  const userName = (id: string) => {
    const user = users.find((candidate: any) => candidate.id === id);
    return user
      ? `${[user.first_name, user.last_name].filter(Boolean).join(" ") || user.email} (${user.email || "no email"})`
      : id;
  };
  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-[#fcfaf7] p-4 text-sm text-gray-700">
        <h2 className="font-semibold text-[#2e241d]">
          Maker–checker role separation
        </h2>
        <p className="mt-1">
          Assign different users to prepare, review, approve and post journals
          or payment runs. Once a role has assignments, only its assigned users
          may perform that stage. Finance administrators retain controlled
          override access.
        </p>
      </section>
      <form
        className="grid gap-3 rounded-xl border p-4 md:grid-cols-[minmax(0,1fr)_260px_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          if (!userId) return;
          action(
            () =>
              apiClient.post("/accounting/workflow-roles", {
                user_id: userId,
                workflow_role: workflowRole,
              }),
            "Accounting workflow role assigned.",
            "page",
          );
        }}
      >
        <select
          aria-label="Finance user"
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          className="rounded-lg border px-3 py-2"
        >
          <option value="">Select finance user</option>
          {users.map((user: any) => (
            <option key={user.id} value={user.id}>
              {[user.first_name, user.last_name].filter(Boolean).join(" ") ||
                user.email}{" "}
              — {user.email}
            </option>
          ))}
        </select>
        <select
          aria-label="Workflow role"
          value={workflowRole}
          onChange={(event) => setWorkflowRole(event.target.value)}
          className="rounded-lg border px-3 py-2"
        >
          {roles.map((role) => (
            <option key={role} value={role}>
              {role.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <button
          className="rounded-lg bg-[#6b4d2e] px-4 py-2 font-medium text-white"
          type="submit"
        >
          Assign role
        </button>
      </form>
      <Grid
        headers={["User", "Workflow role", "Status"]}
        rows={rows.map((row: any) => [
          userName(row.user_id),
          row.workflow_role.replaceAll("_", " "),
          <Status key="status" value={row.is_active ? "ACTIVE" : "INACTIVE"} />,
        ])}
      />
    </div>
  );
}

function Grid({ headers, rows }: { headers: string[]; rows: any[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                className="text-left px-4 py-3 bg-[#f7f1e7] border-b font-semibold text-[#6b5137] whitespace-nowrap"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, index) => (
              <tr key={index} className="hover:bg-stone-50">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-4 py-3 border-b align-top">
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td
                colSpan={headers.length}
                className="p-10 text-center text-gray-500"
              >
                No records found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
function BusinessImpactPanel() {
  const [asOf, setAsOf] = useState(today());
  const [cashFlow, setCashFlow] = useState<any>(null);
  const [forecast, setForecast] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hoursSaved, setHoursSaved] = useState("0");
  const [hourlyCost, setHourlyCost] = useState("0");
  const [monthlyLeakageAvoided, setMonthlyLeakageAvoided] = useState("0");
  const [annualInvestment, setAnnualInvestment] = useState("0");

  async function refresh() {
    try {
      setLoading(true);
      setError("");
      const [flow, next] = await Promise.all([
        apiClient.get(`/accounting/reports/cash-flow?as_of=${asOf}`),
        apiClient.get(
          `/accounting/reports/cash-forecast?as_of=${asOf}&days=90`,
        ),
      ]);
      setCashFlow(flow);
      setForecast(next);
    } catch (caught: any) {
      setError(caught?.message || "Business-impact data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  const number = (value: string) => Math.max(0, Number(value || 0) || 0);
  const annualOperationalSaving = number(hoursSaved) * number(hourlyCost) * 12;
  const annualLeakageSaving = number(monthlyLeakageAvoided) * 12;
  const annualBenefit = annualOperationalSaving + annualLeakageSaving;
  const investment = number(annualInvestment);
  const netBenefit = annualBenefit - investment;
  const roi = investment > 0 ? (netBenefit / investment) * 100 : null;
  const exposure =
    Number(forecast?.expected_receipts || 0) -
    Number(forecast?.expected_payments || 0);

  return (
    <div className="p-5 space-y-5 bg-[#fcfaf7]">
      <div className="flex flex-wrap items-end justify-between gap-3 border rounded-xl bg-white p-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-[#9a7445]">
            Client value cockpit
          </p>
          <h2 className="text-lg font-semibold text-[#2e241d]">
            Cash flow and measurable business impact
          </h2>
          <p className="text-sm text-gray-600">
            Actual cash and open-item exposure come from posted accounting data.
            ROI below is a transparent scenario model, not an assumed saving.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-sm text-gray-700">
            As at date
            <input
              type="date"
              value={asOf}
              onChange={(event) => setAsOf(event.target.value)}
              className="block mt-1 border rounded-lg px-3 py-2"
            />
          </label>
          <button
            onClick={refresh}
            disabled={loading}
            className="px-3 py-2 rounded-lg bg-[#9a7445] text-white disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>
      {error && <Banner tone="error" text={error} close={() => setError("")} />}
      <section className="grid sm:grid-cols-2 xl:grid-cols-5 gap-3">
        <Metric
          label="Cash available"
          value={money(cashFlow?.closing_balance)}
        />
        <Metric label="Cash inflows" value={money(cashFlow?.total_inflows)} />
        <Metric label="Cash outflows" value={money(cashFlow?.total_outflows)} />
        <Metric
          label="90-day expected receipts"
          value={money(forecast?.expected_receipts)}
        />
        <Metric
          label="90-day projected cash"
          value={money(forecast?.projected_cash)}
        />
      </section>
      <section className="grid xl:grid-cols-[1.1fr_.9fr] gap-5">
        <div className="border rounded-xl bg-white overflow-hidden">
          <div className="p-4 border-b">
            <p className="font-semibold">Working-capital decision view</p>
            <p className="text-sm text-gray-600">
              Use this to prioritise collections and approve payments with the
              expected cash effect visible.
            </p>
          </div>
          <div className="p-4 grid sm:grid-cols-3 gap-3">
            <Metric
              label="Expected payments"
              value={money(forecast?.expected_payments)}
            />
            <Metric
              label="Net cash movement"
              value={money(cashFlow?.net_cash_movement)}
            />
            <Metric label="90-day net exposure" value={money(exposure)} />
          </div>
          {forecast?.buckets?.length > 0 && (
            <Grid
              headers={[
                "Due window",
                "Expected receipts",
                "Expected payments",
                "Net impact",
              ]}
              rows={forecast.buckets.map((row: any) => [
                row.label,
                money(row.receivables),
                money(row.payables),
                money(row.net_cash_change),
              ])}
            />
          )}
        </div>
        <div className="border rounded-xl bg-white p-4">
          <p className="font-semibold">ROI scenario calculator</p>
          <p className="text-sm text-gray-600 mb-4">
            Enter agreed client assumptions to present a defensible annual value
            case.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <ImpactInput
              label="Hours saved per month"
              value={hoursSaved}
              change={setHoursSaved}
            />
            <ImpactInput
              label="Loaded cost per hour"
              value={hourlyCost}
              change={setHourlyCost}
            />
            <ImpactInput
              label="Monthly leakage / rework avoided"
              value={monthlyLeakageAvoided}
              change={setMonthlyLeakageAvoided}
            />
            <ImpactInput
              label="Annual ERP investment"
              value={annualInvestment}
              change={setAnnualInvestment}
            />
          </div>
          <div className="mt-4 rounded-lg bg-[#f7f1e7] p-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="block text-gray-600">
                Annual quantified benefit
              </span>
              <strong>{money(annualBenefit)}</strong>
            </div>
            <div>
              <span className="block text-gray-600">Net annual benefit</span>
              <strong>{money(netBenefit)}</strong>
            </div>
            <div>
              <span className="block text-gray-600">Operational saving</span>
              <strong>{money(annualOperationalSaving)}</strong>
            </div>
            <div>
              <span className="block text-gray-600">ROI</span>
              <strong>
                {roi === null
                  ? "Enter annual investment"
                  : `${roi.toFixed(1)}%`}
              </strong>
            </div>
          </div>
        </div>
      </section>
      <section className="border rounded-xl bg-white p-4">
        <p className="font-semibold">What the client can see and act on</p>
        <div className="grid md:grid-cols-3 gap-3 mt-3 text-sm">
          <div className="rounded-lg border p-3">
            <strong>Cash control</strong>
            <p className="mt-1 text-gray-600">
              Posted cash movement, 90-day forecast, incoming and outgoing
              commitments.
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <strong>Working-capital control</strong>
            <p className="mt-1 text-gray-600">
              Receivables and payables by due window, so collection and payment
              priorities are visible.
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <strong>Audit-ready value</strong>
            <p className="mt-1 text-gray-600">
              Every accounting figure links to posted vouchers; ROI inputs are
              explicit rather than marketing estimates.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
function ImpactInput({ label, value, change }: any) {
  return (
    <label className="text-sm text-gray-700">
      <span className="block mb-1">{label}</span>
      <input
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(event) => change(event.target.value)}
        className="w-full border rounded-lg px-3 py-2"
      />
    </label>
  );
}
