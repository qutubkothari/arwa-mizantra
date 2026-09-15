"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiClient } from "../../lib/api-client";
import generatedCatalogue from "./arabic-catalogue.generated.json";

export type AppLanguage = "en" | "ar";

const MANUAL_ARABIC: Record<string, string> = {
  Dashboard: "لوحة المعلومات",
  "Active Planner": "المخطط الذكي",
  "Ask Mizantra": "اسأل ميزانترا",
  "Business Transformation": "تحول الأعمال",
  "Manager Approvals": "موافقات المدير",
  "MIS & Reports": "التقارير ومعلومات الإدارة",
  Projects: "المشروعات",
  Procurement: "المشتريات",
  Inventory: "المخزون",
  Production: "الإنتاج",
  Accounts: "الحسابات",
  CRM: "إدارة العملاء",
  Sales: "المبيعات",
  Service: "الخدمة",
  HR: "الموارد البشرية",
  Documents: "المستندات",
  Settings: "الإعدادات",
  "Production Overview": "نظرة عامة على الإنتاج",
  "Job Orders": "أوامر التشغيل",
  "Shop Floor": "صالة الإنتاج",
  Subcontracting: "التصنيع لدى الغير",
  "BOM & Routing": "قائمة المواد ومسار التشغيل",
  "Production Results": "نتائج الإنتاج",
  "Cost & Margin": "التكلفة والهامش",
  Accounting: "المحاسبة",
  Collections: "التحصيلات",
  "Payment Runs": "دفعات السداد",
  "Cash Forecast": "توقعات النقدية",
  "Supplier Invoices": "فواتير الموردين",
  "Accounts Payable": "حسابات الموردين",
  "Purchase Requisitions": "طلبات الشراء",
  "Purchase Orders": "أوامر الشراء",
  "Spend Intelligence": "تحليل الإنفاق",
  "Strategic Sourcing": "التوريد الاستراتيجي",
  "Contract Control": "إدارة العقود",
  "Import Files": "ملفات الاستيراد",
  "Service Entry Sheets": "شهادات إنجاز الخدمات",
  "Debit Notes": "إشعارات الخصم",
  Vendors: "الموردون",
  "Goods Receipt (GRN)": "استلام البضاعة",
  "Stock Master": "دليل الأصناف",
  "Stock Movements": "حركات المخزون",
  "Stock Alerts": "تنبيهات المخزون",
  "Low Stock Planning": "تخطيط النواقص",
  "Warehouse Control": "إدارة المخازن",
  "Warehouse Optimization": "تحسين المخازن",
  "Working Capital & SLOB": "رأس المال والمخزون الراكد",
  "Stock Adjustments": "تسويات المخزون",
  Customers: "العملاء",
  Leads: "العملاء المحتملون",
  Opportunities: "الفرص",
  Quality: "الجودة",
  "UID Tracking": "تتبع الرقم الفريد",
  "Margin-to-Cash": "من الهامش إلى التحصيل",
  "Treasury & FX Control": "إدارة الخزانة والعملات",
  "Bank Reconciliation": "التسوية البنكية",
  "FX Revaluation": "إعادة تقييم العملات",
  "Value Realization": "تحقيق القيمة",
  "FP&A Scenarios": "سيناريوهات التخطيط المالي",
  "Expense Control": "إدارة المصروفات",
  Budgets: "الموازنات",
  "Cost Centres": "مراكز التكلفة",
  "Fixed Assets": "الأصول الثابتة",
  "Statutory Returns": "الإقرارات القانونية",
  "Report Schedules": "جداول التقارير",
  "Opening Balances": "الأرصدة الافتتاحية",
  "Group Consolidation": "تجميع القوائم المالية",
  "CRM Overview": "نظرة عامة على العملاء",
  "Lead Pipeline": "مسار العملاء المحتملين",
  "All Leads": "كل العملاء المحتملين",
  Contacts: "جهات الاتصال",
  "Revenue Operations": "عمليات الإيرادات",
  "Follow-ups": "المتابعات",
  "Unified Inbox": "صندوق الوارد الموحد",
  "Assignment Rules": "قواعد الإسناد",
  "Project Master": "دليل المشروعات",
  "Margin & EVM Control": "إدارة هامش وأداء المشروع",
  "Organization": "المنشأة",
  "Dark mode": "الوضع الداكن",
  "Light mode": "الوضع الفاتح",
  Logout: "تسجيل الخروج",
  Search: "بحث",
  Refresh: "تحديث",
  Save: "حفظ",
  Saving: "جارٍ الحفظ",
  Cancel: "إلغاء",
  Close: "إغلاق",
  Open: "فتح",
  Create: "إنشاء",
  Update: "تحديث",
  Delete: "حذف",
  Edit: "تعديل",
  View: "عرض",
  Print: "طباعة",
  Download: "تنزيل",
  Submit: "إرسال",
  Approve: "اعتماد",
  Reject: "رفض",
  Status: "الحالة",
  Actions: "الإجراءات",
  Date: "التاريخ",
  Quantity: "الكمية",
  Qty: "الكمية",
  Item: "الصنف",
  Amount: "المبلغ",
  Total: "الإجمالي",
  Notes: "ملاحظات",
  Loading: "جارٍ التحميل",
  "No data available": "لا توجد بيانات",
  "New request": "طلب جديد",
  "Clear list": "مسح القائمة",
  "Search conversations": "البحث في المحادثات",
  "No matching conversations": "لا توجد محادثات مطابقة",
  Ask: "اسأل",
  Review: "مراجعة",
  "Start here": "ابدأ هنا",
  "Daily production": "الإنتاج اليومي",
  "Daily finance": "المالية اليومية",
  "Cash & banking": "النقدية والبنوك",
  "Performance & planning": "الأداء والتخطيط",
  "Close, compliance & controls": "الإقفال والامتثال والرقابة",
  "Setup & control": "الإعداد والتحكم",
  Executive: "الإدارة التنفيذية",
  Finance: "المالية",
  Operations: "العمليات",
  "Cost & Margin Control": "إدارة التكلفة والهامش",
  "Explainable profitability": "ربحية واضحة ومفسرة",
  "Billed revenue compared with the approved standard cost of each item.": "مقارنة الإيراد المفوتر بالتكلفة المعيارية المعتمدة لكل صنف.",
  "Cost per piece": "تكلفة القطعة",
  "Actual cost per piece": "التكلفة الفعلية للقطعة",
  "Planned cost per piece": "التكلفة المخططة للقطعة",
  "Material per piece": "المواد لكل قطعة",
  "Conversion per piece": "التشغيل لكل قطعة",
  "Quality loss per piece": "فاقد الجودة لكل قطعة",
  "Accepted pieces": "القطع المقبولة",
  "Job order": "أمر التشغيل",
  "Select a job order": "اختر أمر تشغيل",
  "Simple production costing": "تكلفة إنتاج مبسطة",
  "Final cost": "تكلفة نهائية",
  "Live estimate": "تقدير مباشر",
  "Planned estimate": "تقدير مخطط",
  "Cost evidence incomplete": "بيانات التكلفة غير مكتملة",
  "This standard-cost view does not post or replace actual COGS.": "هذا العرض المعياري لا يُنشئ قيوداً ولا يستبدل تكلفة المبيعات الفعلية.",
  "Production cost variance cockpit": "مراقبة فروق تكلفة الإنتاج",
  "Controlled standard cost": "التكلفة المعيارية الموثقة",
  "Controlled actual cost": "التكلفة الفعلية الموثقة",
  "Controlled variance": "فرق التكلفة الموثق",
  "Controlled yield loss": "فاقد الإنتاج الموثق",
  "Production issue value": "قيمة صرف الإنتاج",
  "FG receipt value": "قيمة استلام المنتج التام",
  "Open WIP value": "قيمة الإنتاج تحت التشغيل",
  "Std. material": "المواد المعيارية",
  "Actual material": "المواد الفعلية",
  "Conversion variance": "فرق التشغيل",
  "Yield loss": "فاقد الإنتاج",
  "Total variance": "إجمالي الفرق",
  Assurance: "اكتمال البيانات",
  "Not calculated": "غير محسوب",
  "Execution evidence incomplete": "بيانات التنفيذ غير مكتملة",
  "No controlled baseline": "لا يوجد أساس معتمد",
  INCOMPLETE: "غير مكتمل",
  CONTROLLED: "موثق",
  "Costing-readiness remediation": "استكمال بيانات التكلفة",
  "In progress": "قيد التنفيذ",
  Unassigned: "غير مسند",
  Overdue: "متأخر",
  Critical: "حرج",
  Resolved: "تم الحل",
  "Purchase-price variance feeding production": "فرق سعر الشراء المؤثر في الإنتاج",
  "Purchase-price variance": "فرق سعر الشراء",
  "Adverse production jobs": "أوامر إنتاج بتكلفة غير مواتية",
  "FIFO evidence coverage": "تغطية إثباتات الوارد أولاً صادر أولاً",
  "Receipt events": "حركات الاستلام",
  "Receipt cost evidence": "إثبات تكلفة الاستلام",
  "Issue events": "حركات الصرف",
  "Issue cost evidence": "إثبات تكلفة الصرف",
  "Inventory-to-ledger control": "الرقابة بين المخزون ودفتر الأستاذ",
  "Create month snapshot": "إنشاء لقطة شهرية",
  "Period valuation certificates": "شهادات تقييم الفترة",
  "Billed item margin": "هامش الأصناف المفوترة",
  "FIFO COGS evidence register": "سجل إثبات تكلفة المبيعات FIFO",
  "FIFO COGS evidence": "دليل تكلفة المبيعات بطريقة FIFO",
  "FIFO unit cost": "تكلفة الوحدة بطريقة FIFO",
  "IFRS 16 Leases": "عقود الإيجار — IFRS 16",
  "IFRS 15 Revenue": "الإيرادات — IFRS 15",
  "IFRS 9 ECL": "الخسائر الائتمانية المتوقعة — IFRS 9",
  "IAS 37 Provisions": "المخصصات — IAS 37",
  "Super Admin": "مسؤول النظام الأعلى",
  "PRODUCTION RECEIPT": "استلام إنتاج",
  "PRODUCTION ISSUE": "صرف للإنتاج",
  "SALES ISSUE": "صرف مبيعات",
  MISSING: "مفقود",
  CERTIFIED: "معتمد",
  Opening: "الرصيد الافتتاحي",
  Closing: "الرصيد الختامي",
  "Issues / COGS": "المنصرف / تكلفة المبيعات",
  "WORK CENTRE RATE MISSING · FIFO ISSUE EVIDENCE MISSING": "معدل مركز العمل مفقود · دليل صرف FIFO مفقود",
  "WORK CENTRE RATE MISSING · FIFO ISSUE EVIDENCE MISSING · EXECUTION COST EVIDENCE MISSING": "معدل مركز العمل مفقود · دليل صرف FIFO مفقود · دليل تكلفة التنفيذ مفقود",
  "OUTPUT STANDARD COST MISSING": "التكلفة المعيارية للمنتج مفقودة",
  "MATERIAL STANDARD COST MISSING": "التكلفة المعيارية للمواد مفقودة",
  "ROUTING COST BASIS MISSING": "أساس تكلفة مسار التشغيل مفقود",
  "WORK CENTRE RATE MISSING": "معدل مركز العمل مفقود",
  "FIFO ISSUE EVIDENCE MISSING": "دليل صرف FIFO مفقود",
  "EXECUTION COST EVIDENCE MISSING": "دليل تكلفة التنفيذ مفقود",
  "COMPLETED QUANTITY MISSING": "الكمية المكتملة مفقودة",
  "Create draft": "إنشاء مسودة",
  Revenue: "الإيراد",
  Margin: "الهامش",
  Rate: "النسبة",
  Cost: "التكلفة",
  Dispatch: "الصرف",
  Movement: "الحركة",
  Value: "القيمة",
  "Ledger control": "رقابة دفتر الأستاذ",
  "Jobs analysed": "أوامر تم تحليلها",
  "Controlled jobs": "أوامر مكتملة البيانات",
  "Incomplete / excluded": "غير مكتمل / مستبعد",
  "Billed revenue": "الإيراد المفوتر",
  "Standard cost": "التكلفة المعيارية",
  "Gross margin": "مجمل الربح",
  "Margin rate": "نسبة الهامش",
  "Organization information saved successfully.": "تم حفظ بيانات المنشأة بنجاح.",
  "Language": "اللغة",
  "Arabic": "العربية",
  "English": "الإنجليزية",
  "Market Profile": "السوق",
  "Time Zone": "المنطقة الزمنية",
  "Country": "الدولة",
  "Company Name": "اسم المنشأة",
  "Official Phone": "الهاتف الرسمي",
  "Official Email": "البريد الإلكتروني الرسمي",
  "Save Organization": "حفظ المنشأة",
  "Quick search…": "بحث سريع…",
  "Tell me the outcome you need in any ERP module. I will understand the workflow, reuse the details you supplied, ask only for missing information, and preserve every approval control.": "أخبرني بالنتيجة التي تريدها في أي جزء من النظام. سأفهم سير العمل، وأستخدم البيانات التي قدمتها، وأسأل فقط عن المعلومات الناقصة مع الحفاظ على جميع ضوابط الاعتماد.",
  "Mizantra intelligence": "ذكاء ميزانترا",
  "One prompt workspace for the complete ERP. It prepares safe drafts, validates controlled transactions, and hands work to the correct native screen without bypassing approvals.": "مساحة محادثة واحدة لكل النظام؛ تُعد المسودات الآمنة وتتحقق من المعاملات وتنقلك إلى الشاشة الصحيحة دون تجاوز الاعتمادات.",
  "Deterministic safe mode": "الوضع الآمن المحدد",
  "Bot width": "عرض المحادثة",
  "At risk / breached": "معرّض للخطر / تم التجاوز",
  Breached: "تم التجاوز",
  "Customer equipment, UID/serial traceability, location and warranty status.": "معدات العميل، وتتبع المعرّف الفريد والرقم التسلسلي، والموقع، وحالة الضمان.",
  "Supervisor workspace": "مساحة عمل المشرف",
  Mrp: "تخطيط احتياجات المواد",
  Crm: "إدارة العملاء",
  "Today's focus": "أولوية اليوم",
  "Print/PDF": "طباعة / ملف PDF",
  min: "دقيقة",
  "Notifications alt+T": "الإشعارات",
  "Unassigned product": "منتج غير مسند",
  "Finance & accounting": "المالية والمحاسبة",
  "Mizantra Intelligence": "ذكاء ميزانترا",
  "Lead routing currently depends on one configured owner.": "يعتمد توزيع العملاء المحتملين حاليًا على مسؤول واحد مُعدّ في النظام.",
  "Awaiting Approval (Level 1)": "بانتظار الاعتماد (المستوى الأول)",
  "Goods Recvd": "تم استلام البضاعة",
  "PO Done": "اكتمل أمر الشراء",
  Qualified: "مؤهل",
  "Requirement Confirmed": "تم تأكيد المتطلبات",
  Negotiation: "تفاوض",
  Lost: "مفقود",
  "Dashboard | SAK ERP": "لوحة المعلومات | نظام SAK",
  Transformation: "التحول المؤسسي",
  "All departments": "جميع الإدارات",
  "Raw material": "المواد الخام",
  "Direct labour": "العمالة المباشرة",
  "Machine running": "تشغيل الآلات",
  Electricity: "الكهرباء",
  Packing: "التعبئة",
  "Factory overhead": "المصاريف الصناعية غير المباشرة",
  "PR, PO, vendor maker-checker": "طلبات الشراء وأوامر الشراء ورقابة إعداد واعتماد الموردين",
  "Approved/pending purchase commitment": "التزامات الشراء المعتمدة والمعلقة",
  "Latest GRN invoice exposure": "أحدث التزامات فواتير استلام البضائع",
  "PO/vendor advance available for adjustment": "دفعة أمر الشراء أو المورد المتاحة للتسوية",
  "Low stock plus unverified material master": "المخزون المنخفض مع بيانات المواد غير المعتمدة",
  "Open and in-progress job orders": "أوامر التشغيل المفتوحة وقيد التنفيذ",
  "Permission-scoped, tenant-scoped read-only query planned semantically by the AI and executed only against the approved ERP dataset catalogue. No arbitrary SQL or write operation is allowed.": "استعلام للقراءة فقط ومقيد بصلاحيات المستخدم والمنشأة، يخططه الذكاء الاصطناعي دلاليًا وينفذه فقط على دليل بيانات النظام المعتمد. لا يُسمح بأي استعلام عشوائي أو عملية كتابة.",
};

const ARABIC: Record<string, string> = {
  ...(generatedCatalogue.exact as Record<string, string>),
  ...MANUAL_ARABIC,
};

const ARABIC_CASE_INSENSITIVE = new Map(
  Object.entries(ARABIC).map(([source, target]) => [source.toLocaleLowerCase("en"), target]),
);

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ARABIC_PATTERNS = generatedCatalogue.patterns
  .filter((entry) => entry.source !== entry.target && entry.source.includes("{") && !/^[A-Za-z]\{\d+\}$/.test(entry.source))
  .map((entry) => {
    const groups: number[] = [];
    let cursor = 0;
    let expression = "^";
    for (const match of entry.source.matchAll(/\{(\d+)\}/g)) {
      expression += escapeRegex(entry.source.slice(cursor, match.index)) + "(.+?)";
      groups.push(Number(match[1]));
      cursor = Number(match.index) + match[0].length;
    }
    expression += escapeRegex(entry.source.slice(cursor)) + "$";
    return { regex: new RegExp(expression, "u"), target: entry.target, groups };
  });

const ENUM_ARABIC: Record<string, string> = {
  OPEN: "مفتوح", CLOSED: "مغلق", COMPLETE: "مكتمل", COMPLETED: "مكتمل",
  IN: "قيد", PROGRESS: "التنفيذ", PENDING: "معلّق", APPROVED: "معتمد",
  REJECTED: "مرفوض", CANCELLED: "ملغى", CANCELED: "ملغى", ACTIVE: "نشط",
  INACTIVE: "غير نشط", DRAFT: "مسودة", POSTED: "مرحّل", FAILED: "فشل",
  READY: "جاهز", BLOCKED: "متوقف", CONTROLLED: "موثق", INCOMPLETE: "غير مكتمل",
  MISSING: "مفقود", CERTIFIED: "معتمد", PRODUCTION: "إنتاج", SALES: "مبيعات",
  PURCHASE: "شراء", RECEIPT: "استلام", ISSUE: "صرف", RETURN: "مرتجع",
  REVIEW: "مراجعة", RELEASED: "مفرج عنه", PLANNED: "مخطط", RUNNING: "جارٍ التشغيل",
  PASSED: "ناجح", FAIL: "راسب", YES: "نعم", NO: "لا", ENABLED: "مفعّل",
  DISABLED: "معطّل", WAITING: "انتظار", OVERDUE: "متأخر", RESOLVED: "تم الحل",
  BREACHED: "تم التجاوز",
  LATE: "متأخر", UNASSIGNED: "غير مسند",
  URGENT: "عاجل", HIGH: "مرتفع", MEDIUM: "متوسط", LOW: "منخفض",
  QUALIFIED: "مؤهل", NEGOTIATION: "تفاوض", LOST: "مفقود", ASC: "تصاعدي", DESC: "تنازلي",
  FIFO: "FIFO", COGS: "تكلفة المبيعات", QC: "الجودة", GRN: "GRN", SIV: "SIV", SRV: "SRV",
};

function translateEnum(value: string) {
  if (!/^[A-Z][A-Z_ /-]*$/.test(value)) return "";
  const parts = value.split(/([_ /-]+)/);
  const words = parts.filter((part) => !/^[_ /-]+$/.test(part));
  if (!words.length || words.some((word) => !ENUM_ARABIC[word])) return "";
  return parts.map((part) => ENUM_ARABIC[part] || (/^[_ /-]+$/.test(part) ? " " : part)).join("").replace(/\s+/g, " ").trim();
}

const LocaleContext = createContext({
  language: "en" as AppLanguage,
  locale: "en-AE",
  currency: "AED",
  setLanguage: (_language: AppLanguage) => {},
  t: (value: string) => value,
});

const originalText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const lastAppliedText = new WeakMap<Text, string>();
const lastAppliedAttributes = new WeakMap<Element, Map<string, string>>();

const translate = (value: string, language: AppLanguage) => {
  if (language !== "ar") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  const translated = ARABIC[trimmed] || ARABIC_CASE_INSENSITIVE.get(trimmed.toLocaleLowerCase("en"));
  let resolved = translated;
  if (!resolved) {
    for (const pattern of ARABIC_PATTERNS) {
      const match = trimmed.match(pattern.regex);
      if (!match) continue;
      resolved = pattern.target.replace(/\{(\d+)\}/g, (_token, rawIndex) => {
        const position = pattern.groups.indexOf(Number(rawIndex));
        return position >= 0 ? translate(match[position + 1], language) : _token;
      });
      break;
    }
  }
  if (!resolved) resolved = translateEnum(trimmed);
  if (!resolved) {
    const minutes = trimmed.match(/^(\d+(?:\.\d+)?)\s+min$/i);
    if (minutes) resolved = `${minutes[1]} دقيقة`;
  }
  if (!resolved) {
    const tenantRegister = trimmed.match(/^Tenant job-order register \((\d+)\)$/i);
    if (tenantRegister) resolved = `سجل أوامر تشغيل المنشأة (${tenantRegister[1]})`;
  }
  if (!resolved) return value;
  return `${value.slice(0, value.indexOf(trimmed))}${resolved}${value.slice(value.indexOf(trimmed) + trimmed.length)}`;
};

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>("en");
  const [currency, setCurrency] = useState("AED");
  const [locale, setLocale] = useState("en-AE");

  const setLanguage = useCallback((next: AppLanguage) => {
    setLanguageState(next);
    localStorage.setItem("mizantra-language", next);
    window.setTimeout(() => window.location.reload(), 0);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("mizantra-language");
    if (stored === "ar" || stored === "en") setLanguageState(stored);
    if (!localStorage.getItem("accessToken")) return;
    apiClient.get<any>("/tenant/current").then((tenant) => {
      const tenantLanguage = String(
        tenant?.settings?.organization?.language || tenant?.language || "",
      ).toLowerCase();
      if (!stored && tenantLanguage.startsWith("arab")) setLanguageState("ar");
      setCurrency(String(tenant?.default_currency || tenant?.currency || "AED").toUpperCase());
      setLocale(String(tenant?.locale || (tenantLanguage.startsWith("arab") ? "ar-EG" : "en-AE")));
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === "ar" ? "ar" : locale;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
    document.body.dataset.language = language;
  }, [language, locale]);

  useEffect(() => {
    const localize = (root: Node) => {
      const translateNode = (node: Text) => {
        const parent = node.parentElement;
        if (!parent || parent.closest("[data-i18n-skip]") || ["SCRIPT", "STYLE", "TEXTAREA"].includes(parent.tagName)) return;
        const currentValue = node.nodeValue || "";
        const savedOriginal = originalText.get(node);
        const lastApplied = lastAppliedText.get(node);
        if (savedOriginal === undefined || (lastApplied !== undefined && currentValue !== lastApplied && currentValue !== savedOriginal)) {
          originalText.set(node, currentValue);
        }
        const original = originalText.get(node) || "";
        const next = translate(original, language);
        lastAppliedText.set(node, next);
        if (node.nodeValue !== next) node.nodeValue = next;
      };
      if (root.nodeType === Node.TEXT_NODE) translateNode(root as Text);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let current = walker.nextNode();
      while (current) {
        translateNode(current as Text);
        current = walker.nextNode();
      }
      const elements = root.nodeType === Node.ELEMENT_NODE
        ? [root as Element, ...(root as Element).querySelectorAll("[placeholder],[title],[aria-label]")]
        : [];
      for (const element of elements) {
        if (element.closest("[data-i18n-skip]")) continue;
        for (const attribute of ["placeholder", "title", "aria-label"]) {
          const currentValue = element.getAttribute(attribute);
          if (!currentValue) continue;
          let saved = originalAttributes.get(element);
          if (!saved) {
            saved = new Map();
            originalAttributes.set(element, saved);
          }
          let applied = lastAppliedAttributes.get(element);
          if (!applied) {
            applied = new Map();
            lastAppliedAttributes.set(element, applied);
          }
          const savedOriginal = saved.get(attribute);
          const lastApplied = applied.get(attribute);
          if (savedOriginal === undefined || (lastApplied !== undefined && currentValue !== lastApplied && currentValue !== savedOriginal)) {
            saved.set(attribute, currentValue);
          }
          const original = saved.get(attribute) || currentValue;
          const next = translate(original, language);
          applied.set(attribute, next);
          if (currentValue !== next) element.setAttribute(attribute, next);
        }
      }
    };
    localize(document.body);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") localize(mutation.target);
        if (mutation.type === "attributes") localize(mutation.target);
        mutation.addedNodes.forEach(localize);
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["placeholder", "title", "aria-label"],
    });
    return () => observer.disconnect();
  }, [language]);

  const value = useMemo(() => ({
    language,
    locale: language === "ar" ? "ar-EG" : locale,
    currency,
    setLanguage,
    t: (text: string) => translate(text, language),
  }), [currency, language, locale, setLanguage]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export const useLocale = () => useContext(LocaleContext);
