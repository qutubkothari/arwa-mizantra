"use client";
import {
  type CSSProperties,
  FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BarChart3,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Download,
  FileSpreadsheet,
  FileText,
  ListChecks,
  Loader2,
  MessageCircle,
  Mic,
  Paperclip,
  Printer,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Volume2,
} from "lucide-react";
import { apiClient } from "../../../../lib/api-client";
import { useLocale } from "@/lib/locale";

type Capability = {
  intent: string;
  module: string;
  label: string;
  route: string;
  mode: "NATIVE_DRAFT" | "CONTROLLED_WORKFLOW" | "ANALYSE";
  description: string;
  examples: string[];
};
type Result = {
  status: string;
  intent_type: string;
  extracted: any;
  resolved: any;
  questions: string[];
  context_token: string;
  provider: string;
  safety: any;
  capability?: Capability;
  next_step?: { route: string; mode: string; label?: string };
  analytics?: AnalyticsAnswer;
  conversation_id?: string;
  assistant_message?: string;
};
type AnalyticsAnswer = {
  kind: string;
  status: "READY" | "NEEDS_INFORMATION";
  title: string;
  questions?: string[];
  headline?: string;
  period?: { from: string; to: string; label: string };
  currency_code?: string;
  metrics?: Array<{ label: string; value: number | string; format?: string }>;
  columns?: Array<{ key: string; label: string; format?: string }>;
  rows?: Record<string, any>[];
  definition?: string;
  warnings?: string[];
  sources?: Array<{
    table: string;
    label: string;
    record_count: number;
    route?: string;
  }>;
  drill_down?: { label: string; route: string };
  actions?: Array<{
    kind: "DOWNLOAD_PDF" | "OPEN_RECORD";
    label: string;
    route: string;
    filename?: string;
  }>;
  semantic_plan?: {
    dataset?: string;
  };
  read_only: boolean;
  sections?: AnalyticsAnswer[];
};
type Turn = { role: "user" | "planner"; text: string };
type Attachment = { url: string; name: string; type: string; size: number };
type ConversationSummary = {
  id: string;
  title: string;
  message_count: number;
  last_message_at: string;
};
const sourceRoute = (source: {
  table?: string;
  label?: string;
  route?: string;
}) => {
  if (source.route?.startsWith("/dashboard/")) return source.route;
  const key = `${source.table || ""} ${source.label || ""}`.toLowerCase();
  if (/bom|bill of material/.test(key)) return "/dashboard/bom";
  if (/work.?station|machine/.test(key)) return "/dashboard/work-stations";
  if (/store issue|\bsiv\b/.test(key)) return "/dashboard/inventory/siv";
  if (/employee/.test(key)) return "/dashboard/hr/employees";
  if (/customer/.test(key)) return "/dashboard/sales?tab=customers";
  if (/item master/.test(key)) return "/dashboard/inventory/items";
  if (/warehouse|stock|inventory|item master/.test(key))
    return "/dashboard/inventory";
  if (/sales order|customer|quotation|sales invoice|receivable/.test(key))
    return "/dashboard/sales";
  if (
    /supplier|vendor|purchase order|purchase invoice|payable|advance/.test(key)
  )
    return "/dashboard/accounts/payables";
  if (/attendance|leave|payroll/.test(key)) return "/dashboard/hr";
  if (/lead|opportunity|follow.?up|crm/.test(key)) return "/dashboard/crm";
  if (/production|job order|work order|mrp/.test(key))
    return "/dashboard/production";
  return "/dashboard/reports";
};

const analyticsFollowUps = (analytics?: AnalyticsAnswer) => {
  switch (analytics?.kind) {
    case "SUPPLIER_DUES":
      return ["Show overdue supplier dues", "Show supplier advances"];
    case "SUPPLIER_ADVANCES":
      return ["Show supplier dues", "Which supplier has the highest advance?"];
    case "SUPPLIER_PAYMENTS":
      return ["Show supplier dues", "Show supplier advances"];
    case "INVENTORY_POSITION":
      return ["Show low stock items", "Show slow moving stock"];
    case "CUSTOMER_SALES":
    case "SALES_ORDER_STATUS":
      return [
        "Show open sales order status",
        "Show overdue customer receivables",
      ];
    case "PRODUCTION_STATUS":
      return ["Show production delays", "Show material shortages"];
    case "PRODUCTION_REPORT":
      return ["Show this month's production report", "Show production delays"];
    case "PROFIT_AND_LOSS":
      return ["Show owner business summary", "Show customer receivables"];
    case "COSTING_SHEET":
      return [
        "Show costing sheet for a finished item",
        "Show production report",
      ];
    case "CRM_PIPELINE":
    case "CRM_FOLLOWUPS":
      return ["Show leads needing follow-up", "Show my CRM pipeline"];
    case "EMPLOYEE_ATTENDANCE":
      return ["Who is late today?", "Show attendance exceptions this month"];
    default:
      return [];
  }
};
const erpQuantity = (value: unknown, uom?: string) => {
  const amount = Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 4,
  });
  return amount + (uom ? " " + uom : "");
};
const selectRecordPrompt = (
  answer: AnalyticsAnswer,
  row: Record<string, any>,
) => {
  const subject = answer.title.replace(/\s+matching\s+.+$/i, "").trim();
  return `Show ${subject} ${String(row.reference || "").trim()}`;
};
const VOICE_LANGUAGES = [
  ["en", "English"],
  ["hi", "हिन्दी"],
  ["bn", "বাংলা"],
  ["ta", "தமிழ்"],
  ["te", "తెలుగు"],
  ["mr", "मराठी"],
  ["gu", "ગુજરાતી"],
  ["kn", "ಕನ್ನಡ"],
  ["ml", "മലയാളം"],
  ["pa", "ਪੰਜਾਬੀ"],
  ["ur", "اردو"],
  ["or", "ଓଡ଼ିଆ"],
  ["as", "অসমীয়া"],
  ["ar", "العربية"],
] as const;
const CURRENCY_ALIASES: Record<string, string> = {
  RS: "INR",
  "RS.": "INR",
  INR: "INR",
  "₹": "INR",
  RUPEE: "INR",
  RUPEES: "INR",
  USD: "USD",
  $: "USD",
  AED: "AED",
  DHS: "AED",
  "د.إ": "AED",
  EUR: "EUR",
  "€": "EUR",
  GBP: "GBP",
  "£": "GBP",
};

const normalizeCurrencyCode = (value: unknown) => {
  const raw = String(value || "INR").trim();
  const normalized = CURRENCY_ALIASES[raw.toUpperCase()] || raw.toUpperCase();
  try {
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: normalized,
    });
    return normalized;
  } catch {
    return "INR";
  }
};

const money = (value: any, currency = "INR") =>
  value !== null && value !== undefined && value !== ""
    ? new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: normalizeCurrencyCode(currency),
        maximumFractionDigits: 2,
      }).format(Number(value))
    : "—";

const analyticsValue = (value: any, format = "text", currency = "INR") => {
  if (value === null || value === undefined || value === "") return "—";
  if (format === "money") {
    if (String(currency).toUpperCase() === "MIXED")
      return `${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })} (mixed currencies)`;
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: normalizeCurrencyCode(currency),
      maximumFractionDigits: 2,
    }).format(Number(value));
  }
  if (format === "number") return Number(value).toLocaleString("en-IN");
  if (format === "date")
    return new Date(
      `${String(value).slice(0, 10)}T00:00:00`,
    ).toLocaleDateString("en-IN");
  return String(value);
};

const safeFilename = (value: string, extension: string) =>
  `${value || "Mizantra report"}`
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) + extension;

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const exportAnalyticsExcel = async (analytics: AnalyticsAnswer) => {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const summary = [
    ["Mizantra report", analytics.title],
    ["Generated at", new Date().toLocaleString("en-IN")],
    ["Period", analytics.period?.label || "All available records"],
    ["Summary", analytics.headline || ""],
    [],
    ["Metric", "Value"],
    ...(analytics.metrics || []).map((metric) => [
      metric.label,
      analyticsValue(metric.value, metric.format, analytics.currency_code),
    ]),
    [],
    ["Calculation", analytics.definition || ""],
    ...(analytics.warnings || []).map((warning) => ["Important", warning]),
  ];
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(summary),
    "Summary",
  );
  const addTable = (answer: AnalyticsAnswer, requestedName: string) => {
    if (!answer.rows?.length) return;
    const columns = answer.columns || [];
    const rows = answer.rows.map((row) =>
      Object.fromEntries(
        columns.map((column) => [
          column.label,
          column.format === "date"
            ? String(row[column.key] || "").slice(0, 10)
            : row[column.key],
        ]),
      ),
    );
    const used = new Set(workbook.SheetNames);
    let name =
      requestedName
        .replace(/[\\/?*\[\]:]/g, " ")
        .trim()
        .slice(0, 31) || "Data";
    let suffix = 2;
    while (used.has(name))
      name = `${requestedName.slice(0, 27)} ${suffix++}`.slice(0, 31);
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(rows),
      name,
    );
  };
  addTable(analytics, "Report data");
  (analytics.sections || []).forEach((section, index) =>
    addTable(section, section.title || `Section ${index + 1}`),
  );
  XLSX.writeFile(
    workbook,
    safeFilename(
      analytics.title,
      ` ${new Date().toISOString().slice(0, 10)}.xlsx`,
    ),
  );
};

const printAnalytics = (analytics: AnalyticsAnswer) => {
  const popup = window.open("", "_blank");
  if (!popup)
    throw new Error("Allow pop-ups to print or save this report as PDF.");
  popup.opener = null;
  const table = (answer: AnalyticsAnswer) => {
    if (!answer.rows?.length) return "";
    const columns = answer.columns || [];
    return `<table><thead><tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr></thead><tbody>${answer.rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(analyticsValue(row[column.key], column.format, row.currency_code || answer.currency_code))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  };
  const sections = (analytics.sections || [])
    .map(
      (section) =>
        `<section><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.headline)}</p>${table(section)}</section>`,
    )
    .join("");
  popup.document.write(
    `<!doctype html><html><head><title>${escapeHtml(analytics.title)}</title><style>body{font:13px Arial,sans-serif;color:#21160f;margin:28px}header{border-bottom:3px solid #8b6f47;margin-bottom:20px}h1{font-size:24px;margin:0 0 8px}h2{font-size:17px;margin-top:24px}.meta{color:#6f5a45}.metrics{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}.metric{border:1px solid #d8c8aa;padding:10px 14px;min-width:130px}.metric b{display:block;margin-top:5px}table{border-collapse:collapse;width:100%;margin:14px 0;font-size:11px}th,td{border:1px solid #d8c8aa;padding:7px;text-align:left}th{background:#f7f1e6}.note{margin-top:18px;padding:10px;background:#f8f3ea}@media print{body{margin:12mm}.no-print{display:none}}</style></head><body><header><h1>Mizantra</h1><p>Enterprise report</p></header><h1>${escapeHtml(analytics.title)}</h1><p>${escapeHtml(analytics.headline)}</p><p class="meta">${escapeHtml(analytics.period?.label || "All available records")} · Generated ${escapeHtml(new Date().toLocaleString("en-IN"))}</p><div class="metrics">${(analytics.metrics || []).map((metric) => `<div class="metric">${escapeHtml(metric.label)}<b>${escapeHtml(analyticsValue(metric.value, metric.format, analytics.currency_code))}</b></div>`).join("")}</div>${table(analytics)}${sections}<div class="note"><b>Calculation used</b><p>${escapeHtml(analytics.definition)}</p>${(analytics.warnings || []).map((warning) => `<p>Important: ${escapeHtml(warning)}</p>`).join("")}</div><script>window.onload=()=>{window.print()}</script></body></html>`,
  );
  popup.document.close();
};

const downloadAnalyticsDocument = async (
  action: NonNullable<AnalyticsAnswer["actions"]>[number],
) => {
  const blob = await apiClient.getBlob(action.route);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeFilename(
    action.filename?.replace(/\.pdf$/i, "") || "Document",
    ".pdf",
  );
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
};

export default function ActivePlannerPage() {
  const { language } = useLocale();
  const [input, setInput] = useState(""),
    [context, setContext] = useState(""),
    [result, setResult] = useState<Result | null>(null),
    [capabilities, setCapabilities] = useState<Capability[]>([]),
    [capabilitiesLoaded, setCapabilitiesLoaded] = useState(false),
    [provider, setProvider] = useState<any>(null),
    [turns, setTurns] = useState<Turn[]>([
      {
        role: "planner",
        text: "Tell me the outcome you need in any ERP module. I will understand the workflow, reuse the details you supplied, ask only for missing information, and preserve every approval control.",
      },
    ]),
    [busy, setBusy] = useState(false),
    [processingSeconds, setProcessingSeconds] = useState(0),
    [error, setError] = useState(""),
    [created, setCreated] = useState<any>(null),
    [approvalRequest, setApprovalRequest] = useState<any>(null),
    [attachments, setAttachments] = useState<Attachment[]>([]),
    [uploading, setUploading] = useState(false),
    [voiceLanguage, setVoiceLanguage] = useState("en"),
    [voiceState, setVoiceState] = useState<
      "idle" | "recording" | "transcribing"
    >("idle"),
    [speaking, setSpeaking] = useState(false),
    [conversationId, setConversationId] = useState(""),
    [conversations, setConversations] = useState<ConversationSummary[]>([]),
    [conversationSearch, setConversationSearch] = useState(""),
    [conversationMenuOpen, setConversationMenuOpen] = useState(false),
    [clearingConversations, setClearingConversations] = useState(false),
    [historyLoading, setHistoryLoading] = useState(true),
    [feedbackState, setFeedbackState] = useState<
      "" | "saving" | "helpful" | "incorrect"
    >(""),
    [correctionOpen, setCorrectionOpen] = useState(false),
    [correctionText, setCorrectionText] = useState(""),
    [correctionSaved, setCorrectionSaved] = useState(false),
    [mobilePanel, setMobilePanel] = useState<"chat" | "review">("chat"),
    [chatPanelWidth, setChatPanelWidth] = useState(50),
    [panelSizeReady, setPanelSizeReady] = useState(false),
    [quickPromptEdges, setQuickPromptEdges] = useState({
      left: false,
      right: false,
    });

  const quickPrompts = capabilitiesLoaded
    ? Array.from(
        new Set(
          capabilities
            .map((capability) => capability.examples?.[0])
            .filter((example): example is string => Boolean(example)),
        ),
      ).slice(0, 8)
    : [];

  useEffect(() => {
    const savedWidth = Number(
      localStorage.getItem("mizantra-planner-chat-width"),
    );
    const oldPreset = localStorage.getItem("mizantra-planner-panel-size");
    const migratedWidth =
      oldPreset === "chat" ? 65 : oldPreset === "review" ? 40 : 50;
    setChatPanelWidth(
      Number.isFinite(savedWidth) && savedWidth >= 35 && savedWidth <= 70
        ? savedWidth
        : migratedWidth,
    );
    setPanelSizeReady(true);
  }, []);

  useEffect(() => {
    if (!panelSizeReady) return;
    localStorage.setItem("mizantra-planner-chat-width", String(chatPanelWidth));
  }, [chatPanelWidth, panelSizeReady]);
  const recorderRef = useRef<MediaRecorder | null>(null),
    streamRef = useRef<MediaStream | null>(null),
    recordingTimeoutRef = useRef<number | null>(null),
    audioPlayerRef = useRef<HTMLAudioElement | null>(null),
    audioUrlRef = useRef<string>(""),
    quickPromptsRef = useRef<HTMLDivElement | null>(null),
    chatEndRef = useRef<HTMLDivElement | null>(null);
  const updateQuickPromptEdges = () => {
    const element = quickPromptsRef.current;
    if (!element) return;
    setQuickPromptEdges({
      left: element.scrollLeft > 2,
      right: element.scrollLeft + element.clientWidth < element.scrollWidth - 2,
    });
  };
  const scrollQuickPrompts = (direction: -1 | 1) => {
    const element = quickPromptsRef.current;
    if (!element) return;
    element.scrollBy({
      left: direction * Math.max(180, element.clientWidth * 0.7),
      behavior: "smooth",
    });
  };
  useEffect(() => {
    const element = quickPromptsRef.current;
    if (!element) return;
    updateQuickPromptEdges();
    const observer = new ResizeObserver(updateQuickPromptEdges);
    observer.observe(element);
    return () => observer.disconnect();
  }, [context, quickPrompts.length]);
  useEffect(() => {
    if (!busy) {
      setProcessingSeconds(0);
      return;
    }
    setProcessingSeconds(0);
    const timer = window.setInterval(
      () => setProcessingSeconds((seconds) => seconds + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [busy, turns.length]);
  useEffect(() => {
    apiClient
      .post<{ capabilities: Capability[]; provider: any }>(
        "/active-planner/capabilities",
        {},
      )
      .then((x) => {
        setCapabilities(x.capabilities || []);
        setProvider(x.provider || null);
      })
      .catch(() => undefined)
      .finally(() => setCapabilitiesLoaded(true));
  }, []);
  const applyHistory = (data: any) => {
    setConversations(data?.conversations || []);
    const active = data?.active;
    if (!active) return;
    setConversationId(active.conversation?.id || "");
    setContext(active.conversation?.current_context_token || "");
    setResult(active.conversation?.last_result || null);
    const restored = (active.messages || []).map((message: any) => ({
      role: message.role === "USER" ? "user" : "planner",
      text: String(message.content || ""),
    })) as Turn[];
    if (restored.length) setTurns(restored);
  };
  const loadHistory = async (id?: string) => {
    setHistoryLoading(true);
    setError("");
    try {
      const data = await apiClient.get<any>(
        id
          ? `/active-planner/conversations/${encodeURIComponent(id)}`
          : "/active-planner/conversations",
      );
      applyHistory(data);
    } catch (x: any) {
      setError(
        x?.message || "Saved planner conversations could not be loaded.",
      );
    } finally {
      setHistoryLoading(false);
    }
  };
  useEffect(() => {
    void loadHistory();
    // The latest tenant/user conversation is restored once on entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(
    () => () => {
      if (recordingTimeoutRef.current)
        window.clearTimeout(recordingTimeoutRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      audioPlayerRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    },
    [],
  );

  const uploadVoice = async (chunks: BlobPart[], mimeType: string) => {
    setVoiceState("transcribing");
    setError("");
    try {
      const cleanType = String(mimeType || "audio/webm").split(";")[0];
      const extension = cleanType.includes("mp4")
        ? "mp4"
        : cleanType.includes("wav")
          ? "wav"
          : "webm";
      const recording = new File(
        [new Blob(chunks, { type: cleanType })],
        `voice-request.${extension}`,
        { type: cleanType },
      );
      const form = new FormData();
      form.append("audio", recording);
      form.append("language", voiceLanguage);
      const data = await apiClient.postForm<{
        transcript: string;
        language_name: string;
        retained: boolean;
      }>("/active-planner/audio/transcribe", form);
      setInput(data.transcript);
      setTurns((current) => [
        ...current,
        {
          role: "planner",
          text: `I transcribed your ${data.language_name} request. Please review or edit the text, then tap Send. The recording was not retained.`,
        },
      ]);
    } catch (x: any) {
      setError(
        x?.message || "Voice transcription failed. You can continue by typing.",
      );
    } finally {
      setVoiceState("idle");
    }
  };

  const stopRecording = () => {
    if (recordingTimeoutRef.current)
      window.clearTimeout(recordingTimeoutRef.current);
    recordingTimeoutRef.current = null;
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  };

  const startRecording = async () => {
    if (voiceState !== "idle") return;
    setError("");
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError(
        "Voice recording is not supported by this browser. Please type your request.",
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const preferred = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/webm",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(
        stream,
        preferred ? { mimeType: preferred } : undefined,
      );
      const chunks: BlobPart[] = [];
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        void uploadVoice(
          chunks,
          recorder.mimeType || preferred || "audio/webm",
        );
      };
      recorder.start(500);
      setVoiceState("recording");
      recordingTimeoutRef.current = window.setTimeout(stopRecording, 60000);
    } catch (x: any) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      setVoiceState("idle");
      setError(
        x?.name === "NotAllowedError"
          ? "Microphone permission was blocked. Allow microphone access or type your request."
          : "The microphone could not be started. Please type your request.",
      );
    }
  };

  const readLatestAnswer = async () => {
    const latest = [...turns]
      .reverse()
      .find((turn) => turn.role === "planner")
      ?.text?.trim();
    if (!latest) return;
    setSpeaking(true);
    setError("");
    try {
      audioPlayerRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      const blob = await apiClient.postBlob("/active-planner/audio/speech", {
        text: latest.slice(0, 4096),
        language: voiceLanguage,
      });
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const player = new Audio(url);
      audioPlayerRef.current = player;
      player.onended = () => setSpeaking(false);
      player.onerror = () => {
        setSpeaking(false);
        setError("The spoken answer could not be played.");
      };
      await player.play();
    } catch (x: any) {
      setSpeaking(false);
      setError(x?.message || "Spoken response is temporarily unavailable.");
    }
  };
  const uploadAttachment = async (file?: File) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError("Attachment must be 10 MB or smaller.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const token = localStorage.getItem("accessToken");
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/v1/purchase/grn/invoice/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.url)
        throw new Error(data?.message || "Document upload failed.");
      setAttachments([
        {
          url: String(data.url),
          name: String(data.name || file.name),
          type: String(data.type || file.type),
          size: Number(data.size || file.size),
        },
      ]);
    } catch (x: any) {
      setError(x?.message || "Document upload failed.");
    } finally {
      setUploading(false);
    }
  };
  const submitMessage = async (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message) return;
    setBusy(true);
    setMobilePanel("chat");
    setError("");
    setCreated(null);
    setApprovalRequest(null);
    setTurns((x) => [...x, { role: "user", text: message }]);
    setInput("");
    try {
      const data = await apiClient.post<Result>("/active-planner/interpret", {
        message,
        response_language:
          language === "ar"
            ? "ar-EG"
            : voiceLanguage !== "en"
              ? voiceLanguage
              : "auto",
        conversation_id: conversationId || undefined,
        context_token: context || undefined,
        attachments: attachments.length ? attachments : undefined,
      });
      setResult(data);
      setConversationId(data.conversation_id || conversationId);
      setContext(data.context_token);
      setFeedbackState("");
      setCorrectionOpen(false);
      setCorrectionText("");
      setCorrectionSaved(false);
      setMobilePanel(data.status.startsWith("READY") ? "review" : "chat");
      const success =
        data.status === "READY_WITH_ANALYTICS"
          ? data.analytics?.headline ||
            "I analysed the governed ERP records and prepared the answer."
          : data.status === "READY_TO_CREATE_DRAFT"
            ? "I resolved and validated the transaction. Review it before creating the ERP draft."
            : data.status === "READY_TO_REQUEST_APPROVAL"
              ? "I validated the request and its source masters. Submit it for independent approval; no native record will be created yet."
              : data.status === "READY_FOR_BILLING_REVIEW"
                ? "The billing prerequisites are valid. Open the native workflow for final review."
                : data.status === "READY_TO_OPEN_WORKFLOW"
                  ? `I have enough information. Open ${data.capability?.label || "the native workflow"} to continue under its normal controls.`
                  : "Please provide the remaining details below.";
      setTurns((x) => [
        ...x,
        {
          role: "planner",
          text:
            data.assistant_message ||
            (data.questions.length ? data.questions.join("\n") : success),
        },
      ]);
      void loadHistory(data.conversation_id || conversationId);
    } catch (x: any) {
      setError(x?.message || "The planner could not interpret this request.");
    } finally {
      setBusy(false);
    }
  };
  const send = async (e: FormEvent) => {
    e.preventDefault();
    await submitMessage(input);
  };
  const create = async () => {
    setBusy(true);
    setError("");
    setMobilePanel("chat");
    try {
      const data = await apiClient.post<any>("/active-planner/execute", {
        context_token: context,
        confirm: "CREATE DRAFT",
      });
      setCreated(data);
      const number =
        data.native_record?.po_number ||
        data.native_record?.pr_number ||
        data.native_record?.quotation_number ||
        data.native_record?.so_number ||
        data.native_record?.job_order_number ||
        data.native_record?.program_code ||
        data.native_record?.journal_number ||
        "";
      setTurns((x) => [
        ...x,
        {
          role: "planner",
          text: data.native_record?.launch_packs?.length
            ? `${data.native_record.launch_packs.length} production launch packs are ready. Each product has its own Job Order, material plan, operation schedule, shop-floor tasks, QC checkpoint and SRV receipt path.`
            : data.native_record?.launch_pack
              ? `Production launch pack for ${number} is ready. I prepared the Job Order, shortage PR if needed, SIV pick list, operation schedule, shop-floor tasks, QC checkpoint and SRV receipt path. Confirm only the quantities that physically move or complete.`
              : `Controlled record ${number} created. Normal review, approval, release, and posting controls remain active.`,
        },
      ]);
    } catch (x: any) {
      setError(x?.message || "The ERP record could not be created.");
    } finally {
      setBusy(false);
    }
  };
  const requestApproval = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await apiClient.post<any>(
        "/active-planner/request-approval",
        {
          context_token: context,
          confirm: "REQUEST APPROVAL",
        },
      );
      setApprovalRequest(data);
      setTurns((turns) => [
        ...turns,
        {
          role: "planner",
          text: "The governed action request is now waiting for an independent approver. No native ERP record has been created.",
        },
      ]);
    } catch (x: any) {
      setError(x?.message || "The approval request could not be created.");
    } finally {
      setBusy(false);
    }
  };
  const restart = async () => {
    audioPlayerRef.current?.pause();
    setSpeaking(false);
    setContext("");
    setResult(null);
    setCreated(null);
    setApprovalRequest(null);
    setAttachments([]);
    setError("");
    setFeedbackState("");
    setCorrectionOpen(false);
    setCorrectionText("");
    setCorrectionSaved(false);
    try {
      const conversation = await apiClient.post<any>(
        "/active-planner/conversations",
        { title: "New conversation" },
      );
      setConversationId(conversation.id);
      setConversations((current) => [conversation, ...current]);
    } catch (x: any) {
      setError(
        x?.message || "A new planner conversation could not be started.",
      );
    }
    setTurns([
      {
        role: "planner",
        text: "New request started. What would you like me to prepare?",
      },
    ]);
  };
  const clearConversationList = async () => {
    if (!conversations.length || clearingConversations) return;
    if (
      !window.confirm(
        "Clear all saved conversations from this list? The chats will be archived for audit and will no longer be used as active context.",
      )
    )
      return;
    setClearingConversations(true);
    setError("");
    try {
      await apiClient.delete("/active-planner/conversations");
      setConversations([]);
      setConversationId("");
      setConversationSearch("");
      setConversationMenuOpen(false);
      setContext("");
      setResult(null);
      setCreated(null);
      setApprovalRequest(null);
      setAttachments([]);
      setFeedbackState("");
      setCorrectionOpen(false);
      setCorrectionText("");
      setCorrectionSaved(false);
      setTurns([
        {
          role: "planner",
          text: "Conversation list cleared. What would you like me to prepare?",
        },
      ]);
    } catch (x: any) {
      setError(x?.message || "The conversation list could not be cleared.");
    } finally {
      setClearingConversations(false);
    }
  };
  const sendFeedback = async (helpful: boolean, correction = "") => {
    if (!conversationId || feedbackState === "saving") return;
    setFeedbackState("saving");
    setError("");
    try {
      const feedback = await apiClient.post<any>("/active-planner/feedback", {
        conversation_id: conversationId,
        helpful,
        correction: correction.trim() || undefined,
      });
      setCorrectionSaved(feedback?.correction_verified === true);
      setCorrectionOpen(false);
      setCorrectionText("");
      setFeedbackState(helpful ? "helpful" : "incorrect");
    } catch (x: any) {
      setFeedbackState("");
      setError(x?.message || "Planner feedback could not be recorded.");
    }
  };
  const e = result?.extracted || {},
    counterparty = result?.resolved?.counterparty,
    item = result?.resolved?.item,
    productionPlan = result?.resolved?.daily_production_plan,
    productionPlans = Array.isArray(result?.resolved?.daily_production_plans)
      ? result.resolved.daily_production_plans
      : productionPlan
        ? [productionPlan]
        : [],
    nativeDocumentLookup =
      result?.analytics?.status === "READY" &&
      result.analytics.rows?.length === 1 &&
      [
        "PURCHASE_ORDERS",
        "PURCHASE_REQUISITIONS",
        "GRNS",
        "PRODUCTION_ORDERS",
      ].includes(String(result.analytics.semantic_plan?.dataset || "")),
    activeConversation = conversations.find(
      (conversation) => conversation.id === conversationId,
    ),
    visibleConversations = conversations.filter((conversation) =>
      conversation.title
        .toLocaleLowerCase()
        .includes(conversationSearch.trim().toLocaleLowerCase()),
    );
  return (
    <main className="mx-auto max-w-7xl space-y-3 p-3 pb-24 text-[#2F241B] sm:space-y-4 sm:p-4 sm:pb-4">
      <header className="rounded-2xl border border-[#D8C8AA] bg-gradient-to-r from-[#FBF7EF] to-white p-4 sm:rounded-xl sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
              <Sparkles className="h-4 w-4" />
              Mizantra intelligence
            </p>
            <h1 className="mt-1 text-2xl font-bold">
              <span className="sm:hidden">Ask Mizantra</span>
              <span className="hidden sm:inline">Active Planner</span>
            </h1>
            <p className="mt-1 hidden max-w-3xl text-sm text-[#6F5A45] sm:block [@media(max-height:760px)]:hidden">
              One prompt workspace for the complete ERP. It prepares safe
              drafts, validates controlled transactions, and hands work to the
              correct native screen without bypassing approvals.
            </p>
            <span
              className={`mt-2 inline-flex rounded-full px-2 py-1 text-[11px] font-bold ${provider?.configured ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}
            >
              {provider?.configured
                ? `${provider.provider} · ${provider.default_model} · ${provider.api_mode}`
                : "Deterministic safe mode"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!!conversations.length && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setConversationMenuOpen((open) => !open)}
                  disabled={historyLoading || busy || clearingConversations}
                  className="flex w-64 max-w-[70vw] items-center justify-between gap-2 rounded border border-[#D8C8AA] bg-white px-3 py-2 text-left text-sm disabled:opacity-60"
                  aria-haspopup="listbox"
                  aria-expanded={conversationMenuOpen}
                  aria-label="Search saved planner conversations"
                >
                  <span className="truncate">
                    {activeConversation?.title || "Search conversations"}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0" />
                </button>
                {conversationMenuOpen && (
                  <div className="absolute right-0 z-50 mt-1 w-80 max-w-[85vw] rounded-lg border border-[#D8C8AA] bg-white p-2 shadow-xl">
                    <label className="flex items-center gap-2 rounded border border-[#D8C8AA] px-2">
                      <Search className="h-4 w-4 text-[#8B6F47]" />
                      <input
                        autoFocus
                        value={conversationSearch}
                        onChange={(event) =>
                          setConversationSearch(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Escape")
                            setConversationMenuOpen(false);
                        }}
                        placeholder="Type to search chats..."
                        className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
                        aria-label="Search conversation history"
                      />
                    </label>
                    <div
                      role="listbox"
                      aria-label="Saved planner conversations"
                      className="mt-2 max-h-64 overflow-y-auto"
                    >
                      {visibleConversations.map((conversation) => (
                        <button
                          type="button"
                          role="option"
                          aria-selected={conversation.id === conversationId}
                          key={conversation.id}
                          onClick={() => {
                            setConversationMenuOpen(false);
                            setConversationSearch("");
                            void loadHistory(conversation.id);
                          }}
                          className={`block w-full rounded px-3 py-2 text-left text-sm hover:bg-[#F5EEDD] ${conversation.id === conversationId ? "bg-[#F5EEDD] font-semibold" : ""}`}
                        >
                          <span className="block truncate">
                            {conversation.title}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-[#806B57]">
                            {conversation.message_count} messages
                          </span>
                        </button>
                      ))}
                      {!visibleConversations.length && (
                        <p className="px-3 py-5 text-center text-sm text-[#806B57]">
                          No matching conversations
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            {!!conversations.length && (
              <button
                type="button"
                onClick={() => void clearConversationList()}
                disabled={historyLoading || busy || clearingConversations}
                className="inline-flex items-center gap-1.5 rounded border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                title="Clear saved conversation list"
              >
                {clearingConversations ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">Clear list</span>
              </button>
            )}
            <label className="hidden min-w-52 items-center gap-2 rounded border border-[#D8C8AA] bg-white px-3 py-1.5 text-xs font-semibold text-[#65452B] lg:flex">
              <span className="whitespace-nowrap">Bot width</span>
              <input
                type="range"
                min="35"
                max="70"
                step="5"
                value={chatPanelWidth}
                onChange={(event) =>
                  setChatPanelWidth(Number(event.target.value))
                }
                className="h-2 min-w-20 flex-1 cursor-ew-resize accent-[#65452B]"
                aria-label="Bot window width"
                aria-valuetext={`${chatPanelWidth}% of the workspace`}
              />
              <output className="w-8 text-right tabular-nums">
                {chatPanelWidth}%
              </output>
            </label>
            <button
              onClick={() => void restart()}
              className="rounded border border-[#80613D] px-3 py-2 text-sm font-semibold"
            >
              New request
            </button>
          </div>
        </div>
      </header>
      {error && (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      <div className="sticky top-12 z-20 grid grid-cols-2 gap-1 rounded-2xl border border-[#D8C8AA] bg-[#FFFDF8]/95 p-1.5 shadow-sm backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setMobilePanel("chat")}
          className={`flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-bold ${mobilePanel === "chat" ? "bg-[#65452B] text-white" : "text-[#65452B]"}`}
        >
          <MessageCircle className="h-4 w-4" /> Ask
        </button>
        <button
          type="button"
          onClick={() => setMobilePanel("review")}
          className={`relative flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-bold ${mobilePanel === "review" ? "bg-[#65452B] text-white" : "text-[#65452B]"}`}
        >
          <ListChecks className="h-4 w-4" /> Review
          {result && (
            <span
              className={`h-2 w-2 rounded-full ${result.status.startsWith("READY") ? "bg-emerald-400" : "bg-amber-400"}`}
              aria-label="Review available"
            />
          )}
        </button>
      </div>
      <section
        className="grid gap-3 lg:grid-cols-[minmax(360px,var(--planner-chat-width))_minmax(0,1fr)] lg:gap-4"
        style={
          {
            "--planner-chat-width": `${chatPanelWidth}%`,
          } as CSSProperties
        }
      >
        <div
          className={`${mobilePanel === "chat" ? "flex" : "hidden"} h-[calc(100dvh-20.5rem)] min-h-[420px] min-w-0 flex-col overflow-hidden rounded-2xl border border-[#E0D2B8] bg-white sm:h-auto sm:min-h-[560px] sm:rounded-xl lg:flex lg:h-[calc(100dvh-20rem)] lg:min-h-[320px] lg:max-h-[680px]`}
        >
          <div className="flex shrink-0 items-center gap-2 border-b p-4">
            <Bot className="h-5 w-5 text-[#80613D]" />
            <div>
              <b>Prompt workspace</b>
              <p className="hidden text-xs text-[#7A6555] sm:block">
                Try: “Plan 100 drones for SO-100 by 30-09-2026” or “Raise NCR
                for 5 rejected impellers”
              </p>
            </div>
            <button
              type="button"
              onClick={() => void readLatestAnswer()}
              disabled={speaking || busy}
              className="ml-auto flex min-h-10 items-center gap-2 rounded-lg border border-[#D8C8AA] px-3 text-xs font-bold text-[#65452B] disabled:opacity-50"
              title="Listen to the latest answer"
            >
              {speaking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">Listen</span>
            </button>
          </div>
          {!context && (
            <div className="relative shrink-0 border-b border-[#EEE4D2] bg-[#FFFDF8] [@media(max-height:650px)]:hidden">
              {quickPromptEdges.left && (
                <button
                  type="button"
                  onClick={() => scrollQuickPrompts(-1)}
                  aria-label="Previous suggestions"
                  title="Previous suggestions"
                  className="absolute left-1 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-[#D8C8AA] bg-white text-[#65452B] shadow-md hover:bg-[#F7F1E6]"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )}
              <div
                ref={quickPromptsRef}
                role="region"
                aria-label="Suggested prompts"
                tabIndex={0}
                onScroll={updateQuickPromptEdges}
                onWheel={(event) => {
                  const element = event.currentTarget;
                  if (
                    element.scrollWidth > element.clientWidth &&
                    Math.abs(event.deltaY) > Math.abs(event.deltaX)
                  ) {
                    event.preventDefault();
                    element.scrollLeft += event.deltaY;
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    scrollQuickPrompts(-1);
                  } else if (event.key === "ArrowRight") {
                    event.preventDefault();
                    scrollQuickPrompts(1);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    event.currentTarget.scrollTo({
                      left: 0,
                      behavior: "smooth",
                    });
                  } else if (event.key === "End") {
                    event.preventDefault();
                    event.currentTarget.scrollTo({
                      left: event.currentTarget.scrollWidth,
                      behavior: "smooth",
                    });
                  }
                }}
                className="flex gap-2 overflow-x-auto px-10 py-2 outline-none [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8B6F47] [&::-webkit-scrollbar]:hidden"
              >
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setInput(prompt)}
                    className="shrink-0 rounded-full border border-[#D8C8AA] bg-white px-3 py-2 text-xs font-semibold text-[#65452B] shadow-sm hover:bg-[#F7F1E6]"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
              {quickPromptEdges.right && (
                <button
                  type="button"
                  onClick={() => scrollQuickPrompts(1)}
                  aria-label="Next suggestions"
                  title="Next suggestions"
                  className="absolute right-1 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-[#D8C8AA] bg-white text-[#65452B] shadow-md hover:bg-[#F7F1E6]"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
          <div
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            aria-busy={busy}
            aria-label="Conversation with Mizantra"
            className="min-h-0 flex-1 space-y-3 overflow-auto p-4"
          >
            {turns.map((turn, i) => (
              <div
                key={i}
                className={`max-w-[88%] whitespace-pre-line rounded-xl p-3 text-sm ${turn.role === "user" ? "ml-auto bg-[#65452B] text-white" : "bg-[#F7F1E6] text-[#3F3024]"}`}
              >
                {turn.text}
              </div>
            ))}
            {busy && (
              <div
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className="max-w-[92%] rounded-xl border border-[#D8C8AA] bg-[#FFF9EF] p-3 text-sm text-[#3F3024] shadow-sm"
              >
                <div className="flex items-center gap-2 font-semibold">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#8A6338]" />
                  <span>Request is processing</span>
                  <span className="ml-auto tabular-nums text-xs font-normal text-[#7A6555]">
                    {processingSeconds}s
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-5 text-[#6B5848]">
                  {processingSeconds < 3
                    ? "Understanding your request…"
                    : processingSeconds < 7
                      ? "Finding the right ERP records and checking access…"
                      : processingSeconds < 13
                        ? "Preparing your result…"
                        : "Still working — complex searches can take a little longer. Your request is active."}
                </p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#EADDC8]">
                  <div className="h-full w-2/3 animate-pulse rounded-full bg-[#9B7749]" />
                </div>
                <p className="mt-2 text-[11px] text-[#8A7563]">
                  Please keep this window open. You can continue when the result
                  appears here.
                </p>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          {attachments.map((attachment) => (
            <div
              key={attachment.url}
              className="mx-3 mb-2 flex items-center justify-between rounded-lg bg-[#F7F1E6] px-3 py-2 text-xs"
            >
              <span className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0" />
                <span className="truncate">{attachment.name}</span>
              </span>
              <button type="button" onClick={() => setAttachments([])}>
                Remove
              </button>
            </div>
          ))}
          <div className="sticky bottom-0 shrink-0 border-t bg-white">
            <div className="flex items-center justify-between gap-2 border-b border-[#EEE4D2] px-3 py-2">
              <label className="flex min-w-0 items-center gap-2 text-xs font-semibold text-[#65452B]">
                Voice
                <select
                  value={voiceLanguage}
                  onChange={(event) => setVoiceLanguage(event.target.value)}
                  disabled={voiceState !== "idle" || speaking}
                  className="max-w-36 rounded-lg border border-[#D8C8AA] bg-white px-2 py-1.5 text-xs"
                  aria-label="Voice language"
                >
                  {VOICE_LANGUAGES.map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <span className="truncate text-[10px] text-[#7A6555]">
                {voiceState === "recording"
                  ? "Recording — tap stop"
                  : voiceState === "transcribing"
                    ? "Transcribing…"
                    : "AI voice · audio not stored"}
              </span>
            </div>
            <form onSubmit={send} className="flex gap-2 p-3">
              <label className="self-end cursor-pointer rounded-xl border border-[#D8C8AA] p-3 text-[#65452B] sm:rounded-lg">
                <Paperclip className="h-5 w-5" />
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  className="hidden"
                  disabled={busy || uploading}
                  onChange={(event) => {
                    void uploadAttachment(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
              <button
                type="button"
                onClick={
                  voiceState === "recording"
                    ? stopRecording
                    : () => void startRecording()
                }
                disabled={busy || uploading || voiceState === "transcribing"}
                className={`self-end rounded-xl border p-3 sm:rounded-lg ${voiceState === "recording" ? "border-red-600 bg-red-600 text-white animate-pulse" : "border-[#D8C8AA] text-[#65452B]"}`}
                aria-label={
                  voiceState === "recording"
                    ? "Stop recording"
                    : "Record voice request"
                }
              >
                {voiceState === "transcribing" ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : voiceState === "recording" ? (
                  <Square className="h-5 w-5" />
                ) : (
                  <Mic className="h-5 w-5" />
                )}
              </button>
              <textarea
                value={input}
                onChange={(x) => setInput(x.target.value)}
                disabled={busy}
                aria-label="Message to Mizantra"
                placeholder={
                  busy
                    ? "Mizantra is processing your request…"
                    : context
                      ? "Reply with the missing details…"
                      : "What should Mizantra prepare?"
                }
                className="min-h-14 flex-1 resize-none rounded-xl border border-[#D8C8AA] p-3 text-sm sm:min-h-16 sm:rounded-lg"
              />
              <button
                disabled={
                  busy || uploading || voiceState !== "idle" || !input.trim()
                }
                aria-label="Send message to Mizantra"
                className="self-end rounded-xl bg-[#65452B] p-3 text-white disabled:opacity-50 sm:rounded-lg"
              >
                <Send className="h-5 w-5" />
              </button>
            </form>
          </div>
        </div>
        <div
          className={`${mobilePanel === "review" ? "block" : "hidden"} min-w-0 space-y-3 sm:space-y-4 lg:block`}
        >
          <section className="rounded-2xl border border-[#E0D2B8] bg-white p-4 sm:rounded-xl">
            <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="font-bold">System-checked preview</h2>
              <span
                className={`max-w-full rounded-full px-2 py-1 text-[10px] font-bold sm:text-xs ${result?.status?.startsWith("READY") ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}
              >
                {result?.status?.replaceAll("_", " ") || "WAITING FOR REQUEST"}
              </span>
            </div>
            {result && !result.analytics ? (
              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <span className="text-xs text-[#7A6555]">Module</span>
                  <b className="block">{result.capability?.module || "ERP"}</b>
                </div>
                <div>
                  <span className="text-xs text-[#7A6555]">Workflow</span>
                  <b className="block">
                    {result.capability?.label ||
                      result.intent_type.replaceAll("_", " ")}
                  </b>
                </div>
                <div>
                  <span className="text-xs text-[#7A6555]">
                    Supplier / customer
                  </span>
                  <b className="block">
                    {counterparty?.name ||
                      counterparty?.customer_name ||
                      e.counterparty_query ||
                      "—"}
                  </b>
                </div>
                <div>
                  <span className="text-xs text-[#7A6555]">Reference</span>
                  <b className="block">{e.reference_query || "—"}</b>
                </div>
                <div>
                  <span className="text-xs text-[#7A6555]">Item</span>
                  <b className="block">
                    {item ? `${item.code} - ${item.name}` : e.item_query || "—"}
                  </b>
                </div>
                <div>
                  <span className="text-xs text-[#7A6555]">Quantity</span>
                  <b className="block">
                    {e.quantity || "—"} {e.uom || item?.uom || ""}
                  </b>
                </div>
                <div>
                  <span className="text-xs text-[#7A6555]">Rate / amount</span>
                  <b className="block">
                    {money(e.unit_price || e.amount, e.currency)}
                  </b>
                </div>
                <div>
                  <span className="text-xs text-[#7A6555]">Date / period</span>
                  <b className="block">{e.delivery_date || e.period || "—"}</b>
                </div>
              </div>
            ) : !result ? (
              <p className="mt-6 text-sm text-[#7A6555]">
                The validated transaction preview will appear here.
              </p>
            ) : null}
            {productionPlans.map((productionPlan: any, planIndex: number) => (
              <div
                key={productionPlan.item?.id || planIndex}
                className="mt-4 space-y-3 rounded-xl border border-[#C9B894] bg-[#FFFDF8] p-3 sm:p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#8B6F47]">
                      Complete production pack preview{" "}
                      {productionPlans.length > 1
                        ? `${planIndex + 1} of ${productionPlans.length}`
                        : ""}
                    </p>
                    <h3 className="mt-1 font-bold">
                      {productionPlan.quantity}{" "}
                      {productionPlan.item?.uom || "units"} ·{" "}
                      {productionPlan.item?.name}
                    </h3>
                    <p className="text-xs text-[#6F5A45]">
                      Active BOM v{productionPlan.bom?.version} ·{" "}
                      {productionPlan.requested_date}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-[10px] font-bold ${productionPlan.capacity_feasible ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}
                  >
                    {productionPlan.capacity_feasible
                      ? "CAPACITY FEASIBLE"
                      : "CAPACITY DECISION NEEDED"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-lg bg-white p-2.5">
                    <span className="text-[10px] text-[#7A6555]">
                      Working hours
                    </span>
                    <b className="block text-sm">
                      {productionPlan.working_hours} h/day
                    </b>
                    {productionPlan.temporary_hours_override && (
                      <span className="text-[10px] font-semibold text-indigo-700">
                        This plan only
                      </span>
                    )}
                  </div>
                  <div className="rounded-lg bg-white p-2.5">
                    <span className="text-[10px] text-[#7A6555]">
                      Estimated time
                    </span>
                    <b className="block text-sm">
                      {productionPlan.estimated_working_days} working day(s)
                    </b>
                  </div>
                  <div className="rounded-lg bg-white p-2.5">
                    <span className="text-[10px] text-[#7A6555]">
                      Bottleneck load
                    </span>
                    <b className="block text-sm">
                      {productionPlan.bottleneck_hours} hours
                    </b>
                  </div>
                  <div className="rounded-lg bg-white p-2.5">
                    <span className="text-[10px] text-[#7A6555]">
                      Material shortages
                    </span>
                    <b
                      className={`block text-sm ${productionPlan.shortage_count ? "text-amber-800" : "text-emerald-700"}`}
                    >
                      {productionPlan.shortage_count}
                    </b>
                  </div>
                </div>
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-950">
                  <b>Preview only — nothing has been created yet.</b>
                  <p className="mt-1">
                    Confirmation prepares the parent Job Order, required
                    sub-assembly Job Orders and one consolidated shortage PR as
                    controlled drafts. It will not issue stock or start
                    production.
                  </p>
                </div>
                {!!productionPlan.bom_explosion?.length && (
                  <details
                    open
                    className="rounded-lg border border-[#D8C8AA] bg-white"
                  >
                    <summary className="cursor-pointer p-3 text-xs font-bold">
                      BOM explosion ({productionPlan.bom_explosion.length}{" "}
                      lines) — stock, shortage and planned action
                    </summary>
                    <div className="max-h-80 overflow-auto border-t border-[#EEE4D2]">
                      <table className="w-full min-w-[760px] text-left text-xs">
                        <thead className="sticky top-0 bg-[#F7F1E6]">
                          <tr>
                            <th className="p-2">Level</th>
                            <th className="p-2">Component</th>
                            <th className="p-2">Type / policy</th>
                            <th className="p-2 text-right">Required</th>
                            <th className="p-2 text-right">Available</th>
                            <th className="p-2 text-right">Shortage</th>
                            <th className="p-2">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {productionPlan.bom_explosion.map(
                            (line: any, lineIndex: number) => (
                              <tr
                                key={
                                  line.item_code +
                                  "-" +
                                  line.level +
                                  "-" +
                                  lineIndex
                                }
                                className="border-t border-[#EEE4D2]"
                              >
                                <td className="p-2">{line.level}</td>
                                <td className="p-2">
                                  <b>{line.item_code}</b>
                                  <span className="block text-[#6F5A45]">
                                    {line.item_name}
                                  </span>
                                </td>
                                <td className="p-2">
                                  {line.component_type} / {line.supply_policy}
                                </td>
                                <td className="p-2 text-right">
                                  {erpQuantity(line.required, line.uom)}
                                </td>
                                <td className="p-2 text-right">
                                  {erpQuantity(line.available, line.uom)}
                                </td>
                                <td
                                  className={
                                    "p-2 text-right font-bold " +
                                    (Number(line.shortage) > 0
                                      ? "text-red-700"
                                      : "text-emerald-700")
                                  }
                                >
                                  {erpQuantity(line.shortage, line.uom)}
                                </td>
                                <td className="p-2 font-bold">{line.action}</td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <section className="rounded-lg border border-[#D8C8AA] bg-white p-3">
                    <h4 className="text-xs font-bold">
                      Sub-assembly Job Orders (
                      {productionPlan.sub_assembly_jobs?.length || 0})
                    </h4>
                    {productionPlan.sub_assembly_jobs?.length ? (
                      <ul className="mt-2 space-y-2 text-xs">
                        {productionPlan.sub_assembly_jobs.map(
                          (line: any, lineIndex: number) => (
                            <li
                              key={line.item_code + "-" + lineIndex}
                              className="rounded bg-[#F8F3EA] p-2"
                            >
                              <b>
                                {line.item_code} — {line.item_name}
                              </b>
                              <span className="mt-1 block text-[#6F5A45]">
                                Required {erpQuantity(line.required)} ·
                                Available {erpQuantity(line.available)} · Draft
                                JO {erpQuantity(line.job_quantity)}
                              </span>
                            </li>
                          ),
                        )}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-emerald-700">
                        No child Job Order is required; available supply covers
                        the sub-assemblies.
                      </p>
                    )}
                  </section>
                  <section className="rounded-lg border border-[#D8C8AA] bg-white p-3">
                    <h4 className="text-xs font-bold">
                      Consolidated shortage PR (
                      {productionPlan.master_pr?.line_count || 0} lines)
                    </h4>
                    {productionPlan.master_pr?.lines?.length ? (
                      <ul className="mt-2 space-y-2 text-xs">
                        {productionPlan.master_pr.lines.map(
                          (line: any, lineIndex: number) => (
                            <li
                              key={line.item_code + "-" + lineIndex}
                              className="rounded bg-amber-50 p-2"
                            >
                              <b>
                                {line.item_code} — {line.item_name}
                              </b>
                              <span className="mt-1 block text-amber-900">
                                Shortage{" "}
                                {erpQuantity(line.shortage, line.uom)} from
                                required {erpQuantity(line.required, line.uom)}
                              </span>
                            </li>
                          ),
                        )}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-emerald-700">
                        No purchase shortage; a PR will not be created.
                      </p>
                    )}
                  </section>
                </div>
                {!!productionPlan.exceptions?.length && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                    <b>Needs attention before execution</b>
                    <ul className="mt-1 list-disc space-y-1 pl-5">
                      {productionPlan.exceptions.map((exception: string) => (
                        <li key={exception}>{exception}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {!!productionPlan.adjustment_prompts?.length && (
                  <div className="flex flex-wrap gap-2">
                    {productionPlan.adjustment_prompts.map((prompt: string) => (
                      <button
                        key={prompt}
                        type="button"
                        disabled={busy}
                        onClick={() => void submitMessage(prompt)}
                        className="rounded-full border border-[#B79B6C] bg-white px-3 py-1.5 text-xs font-semibold text-[#65452B] disabled:opacity-50"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                )}
                {!!productionPlan.operations?.length && (
                  <details
                    open
                    className="rounded-lg border border-[#EEE4D2] bg-white"
                  >
                    <summary className="cursor-pointer p-3 text-xs font-bold">
                      Verify {productionPlan.operations.length} routing
                      operation(s)
                    </summary>
                    <div className="overflow-x-auto border-t border-[#EEE4D2]">
                      <table className="min-w-full text-left text-xs">
                        <thead className="bg-[#F7F1E6]">
                          <tr>
                            <th className="p-2">Seq</th>
                            <th className="p-2">Operation</th>
                            <th className="p-2">Workstation</th>
                            <th className="p-2">Capacity/hr</th>
                            <th className="p-2">Plan hours</th>
                          </tr>
                        </thead>
                        <tbody>
                          {productionPlan.operations.map((operation: any) => (
                            <tr
                              key={`${operation.sequence}-${operation.operation}`}
                              className="border-t border-[#EEE4D2]"
                            >
                              <td className="p-2">{operation.sequence}</td>
                              <td className="p-2">{operation.operation}</td>
                              <td className="p-2">
                                {operation.station_code} -{" "}
                                {operation.station_name}
                              </td>
                              <td className="p-2">
                                {operation.capacity_per_hour || "—"}
                              </td>
                              <td className="p-2">{operation.planned_hours}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
                <p className="text-[11px] text-[#6F5A45]">
                  {productionPlan.control_note}
                </p>
              </div>
            ))}
            {result?.analytics?.status === "READY" && (
              <div className="mt-4 space-y-4">
                <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-4">
                  <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-indigo-700">
                    <BarChart3 className="h-4 w-4" /> Read-only analysis
                  </p>
                  <h3 className="mt-2 text-lg font-bold">
                    {result.analytics.title}
                  </h3>
                  <p className="mt-1 text-sm text-[#5F4B3B]">
                    {result.analytics.headline}
                  </p>
                  {result.analytics.period?.label && (
                    <p className="mt-2 text-xs text-indigo-700">
                      Period: {result.analytics.period.label}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!nativeDocumentLookup && (
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            printAnalytics(result.analytics!);
                          } catch (printError: any) {
                            setError(
                              printError?.message ||
                                "Unable to open the print view.",
                            );
                          }
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-white px-3 py-2 text-xs font-bold text-indigo-800 hover:bg-indigo-50"
                      >
                        <Printer className="h-3.5 w-3.5" /> Print report summary
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        void exportAnalyticsExcel(result.analytics!).catch(
                          (exportError) =>
                            setError(
                              exportError?.message ||
                                "Unable to create the Excel report.",
                            ),
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-50"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5" /> Download Excel
                    </button>
                    {(result.analytics.actions || []).map((action) =>
                      action.kind === "DOWNLOAD_PDF" ? (
                        <button
                          key={`${action.kind}:${action.route}`}
                          type="button"
                          onClick={() =>
                            void downloadAnalyticsDocument(action).catch(
                              (downloadError) =>
                                setError(
                                  downloadError?.message ||
                                    "Unable to download the document.",
                                ),
                            )
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#B89A67] bg-[#65452B] px-3 py-2 text-xs font-bold text-white hover:bg-[#4D3321]"
                        >
                          <Download className="h-3.5 w-3.5" /> {action.label}
                        </button>
                      ) : (
                        <Link
                          key={`${action.kind}:${action.route}`}
                          href={action.route}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#B89A67] bg-white px-3 py-2 text-xs font-bold text-[#65452B]"
                        >
                          {action.label}{" "}
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      ),
                    )}
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(result.analytics.metrics || []).map((metric) => (
                    <div
                      key={metric.label}
                      className="rounded-lg border border-[#E5D8C1] bg-[#FFFDF8] p-3"
                    >
                      <span className="text-[11px] text-[#7A6555]">
                        {metric.label}
                      </span>
                      <b className="mt-1 block text-sm">
                        {analyticsValue(
                          metric.value,
                          metric.format,
                          result.analytics?.currency_code,
                        )}
                      </b>
                    </div>
                  ))}
                </div>
                {!!result.analytics.sections?.length && (
                  <div className="space-y-3">
                    {result.analytics.sections.map((section, sectionIndex) => (
                      <section
                        key={`${section.kind}-${sectionIndex}`}
                        className="rounded-xl border border-[#D8C8AA] bg-white p-4 shadow-sm"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-[#8B6F47]">
                              Answer {sectionIndex + 1}
                            </p>
                            <h4 className="mt-1 font-bold">{section.title}</h4>
                            {section.headline && (
                              <p className="mt-1 text-sm text-[#5F4B3B]">
                                {section.headline}
                              </p>
                            )}
                          </div>
                          {section.status === "READY" ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-800">
                              VERIFIED
                            </span>
                          ) : (
                            <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-800">
                              NEEDS INFORMATION
                            </span>
                          )}
                        </div>
                        {!!section.metrics?.length && (
                          <div className="mt-3 grid gap-2 sm:grid-cols-3">
                            {section.metrics.map((metric) => (
                              <div
                                key={metric.label}
                                className="rounded-lg bg-[#F8F3EA] p-2.5"
                              >
                                <span className="text-[10px] text-[#7A6555]">
                                  {metric.label}
                                </span>
                                <b className="mt-0.5 block text-xs">
                                  {analyticsValue(
                                    metric.value,
                                    metric.format,
                                    section.currency_code,
                                  )}
                                </b>
                              </div>
                            ))}
                          </div>
                        )}
                        {!!section.rows?.length && (
                          <div className="mt-3 overflow-x-auto rounded-lg border border-[#EEE4D2]">
                            <table className="min-w-full text-left text-xs">
                              <thead className="bg-[#F7F1E6] text-[#65452B]">
                                <tr>
                                  {(section.columns || []).map((column) => (
                                    <th
                                      key={column.key}
                                      className="whitespace-nowrap p-2"
                                    >
                                      {column.label}
                                    </th>
                                  ))}
                                  {section.rows?.some(
                                    (row) => row.record_id && row.reference,
                                  ) && (
                                    <th className="whitespace-nowrap p-2">
                                      Select
                                    </th>
                                  )}
                                </tr>
                              </thead>
                              <tbody>
                                {section.rows
                                  .slice(0, 10)
                                  .map((row, rowIndex) => (
                                    <tr
                                      key={rowIndex}
                                      className="border-t border-[#EEE4D2]"
                                    >
                                      {(section.columns || []).map((column) => (
                                        <td
                                          key={column.key}
                                          className="whitespace-nowrap p-2"
                                        >
                                          {analyticsValue(
                                            row[column.key],
                                            column.format,
                                            row.currency_code ||
                                              section.currency_code,
                                          )}
                                        </td>
                                      ))}
                                      {section.rows?.some(
                                        (candidate) =>
                                          candidate.record_id &&
                                          candidate.reference,
                                      ) && (
                                        <td className="whitespace-nowrap p-2">
                                          {row.record_id && row.reference ? (
                                            <button
                                              type="button"
                                              disabled={busy}
                                              onClick={() =>
                                                void submitMessage(
                                                  selectRecordPrompt(
                                                    section,
                                                    row,
                                                  ),
                                                )
                                              }
                                              className="rounded border border-indigo-300 bg-indigo-50 px-2 py-1 font-bold text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
                                            >
                                              Select
                                            </button>
                                          ) : null}
                                        </td>
                                      )}
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {!!section.questions?.length && (
                          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-900">
                            {section.questions.map((question) => (
                              <li key={question}>{question}</li>
                            ))}
                          </ul>
                        )}
                        {section.drill_down && (
                          <Link
                            href={section.drill_down.route}
                            className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-indigo-800"
                          >
                            {section.drill_down.label}
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        )}
                      </section>
                    ))}
                  </div>
                )}
                {!!result.analytics.rows?.length && (
                  <div className="overflow-x-auto rounded-lg border border-[#E5D8C1]">
                    <table className="min-w-full text-left text-xs">
                      <thead className="bg-[#F7F1E6] text-[#65452B]">
                        <tr>
                          {(result.analytics.columns || []).map((column) => (
                            <th
                              key={column.key}
                              className="whitespace-nowrap p-2"
                            >
                              {column.label}
                            </th>
                          ))}
                          {result.analytics.rows?.some(
                            (row) => row.record_id && row.reference,
                          ) && (
                            <th className="whitespace-nowrap p-2">Select</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {result.analytics.rows
                          .slice(0, 20)
                          .map((row, index) => (
                            <tr
                              key={index}
                              className="border-t border-[#EEE4D2]"
                            >
                              {(result.analytics?.columns || []).map(
                                (column) => (
                                  <td
                                    key={column.key}
                                    className="whitespace-nowrap p-2"
                                  >
                                    {analyticsValue(
                                      row[column.key],
                                      column.format,
                                      row.currency_code ||
                                        result.analytics?.currency_code,
                                    )}
                                  </td>
                                ),
                              )}
                              {result.analytics?.rows?.some(
                                (candidate) =>
                                  candidate.record_id && candidate.reference,
                              ) && (
                                <td className="whitespace-nowrap p-2">
                                  {row.record_id && row.reference ? (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() =>
                                        void submitMessage(
                                          selectRecordPrompt(
                                            result.analytics!,
                                            row,
                                          ),
                                        )
                                      }
                                      className="rounded border border-indigo-300 bg-indigo-50 px-2 py-1 font-bold text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
                                    >
                                      Select
                                    </button>
                                  ) : null}
                                </td>
                              )}
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {!!result.analytics.warnings?.length && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    <b className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" /> Important context
                    </b>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {result.analytics.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="rounded-lg bg-[#F8F3EA] p-3 text-xs text-[#6F5A45]">
                  <b>Calculation used</b>
                  <p className="mt-1">{result.analytics.definition}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <b>Sources:</b>
                    {result.analytics.sources?.length
                      ? result.analytics.sources.map((source) => (
                          <Link
                            key={`${source.table}:${source.label}`}
                            href={sourceRoute(source)}
                            className="inline-flex items-center gap-1 rounded border border-[#D8C8AA] bg-white px-2 py-1 font-semibold text-indigo-800 hover:bg-indigo-50"
                            title={`Open governed source: ${source.label}`}
                          >
                            {source.label} ({source.record_count})
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        ))
                      : "Governed ERP records"}
                  </div>
                </div>
                {result.analytics.drill_down && (
                  <Link
                    href={result.analytics.drill_down.route}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-indigo-300 p-3 text-sm font-bold text-indigo-800"
                  >
                    {result.analytics.drill_down.label}
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                )}
                {!!analyticsFollowUps(result.analytics).length && (
                  <div className="rounded-lg border border-[#E5D8C1] bg-white p-3 text-xs">
                    <b className="text-[#65452B]">
                      Continue with a related question
                    </b>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {analyticsFollowUps(result.analytics).map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          disabled={busy}
                          onClick={() => void submitMessage(prompt)}
                          className="rounded-full border border-[#C9B894] px-3 py-1.5 font-semibold text-[#65452B] hover:bg-[#FBF7EF] disabled:opacity-50"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {result?.capability && !result.analytics && (
              <p className="mt-3 rounded bg-[#F8F3EA] p-3 text-xs text-[#6F5A45]">
                {result.capability.description}
              </p>
            )}
            {result && conversationId && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#EEE4D2] pt-3 text-xs text-[#6F5A45]">
                <span>Was this interpretation correct?</span>
                <button
                  type="button"
                  onClick={() => void sendFeedback(true)}
                  disabled={feedbackState !== ""}
                  className={`flex items-center gap-1 rounded border px-2 py-1.5 ${feedbackState === "helpful" ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-[#D8C8AA]"}`}
                >
                  <ThumbsUp className="h-3.5 w-3.5" /> Correct
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCorrectionOpen(true);
                    setCorrectionText("");
                    setCorrectionSaved(false);
                  }}
                  disabled={feedbackState !== ""}
                  className={`flex items-center gap-1 rounded border px-2 py-1.5 ${feedbackState === "incorrect" ? "border-red-400 bg-red-50 text-red-800" : "border-[#D8C8AA]"}`}
                >
                  <ThumbsDown className="h-3.5 w-3.5" /> Incorrect
                </button>
                {feedbackState === "saving" && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {feedbackState === "helpful" && (
                  <span className="text-emerald-700">
                    Saved as verified phrasing for this tenant.
                  </span>
                )}
                {feedbackState === "incorrect" && (
                  <span className="text-red-700">
                    {correctionSaved
                      ? "Incorrect meaning rejected; your correction is now a verified tenant example."
                      : "Excluded from learning. Rephrase or correct the request."}
                  </span>
                )}
                {correctionOpen && feedbackState === "" && (
                  <div className="mt-2 w-full rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <label className="block font-semibold text-amber-950">
                      What did you mean?
                    </label>
                    <textarea
                      value={correctionText}
                      onChange={(event) =>
                        setCorrectionText(event.target.value.slice(0, 500))
                      }
                      maxLength={500}
                      rows={2}
                      placeholder="Example: I meant unused supplier advances, not outstanding payables."
                      className="mt-2 w-full rounded-lg border border-amber-300 bg-white p-2 text-sm outline-none focus:border-amber-600"
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!correctionText.trim()}
                        onClick={() => void sendFeedback(false, correctionText)}
                        className="rounded-lg bg-amber-800 px-3 py-2 font-bold text-white disabled:opacity-50"
                      >
                        Save correction
                      </button>
                      <button
                        type="button"
                        onClick={() => void sendFeedback(false)}
                        className="rounded-lg border border-amber-300 bg-white px-3 py-2 font-semibold"
                      >
                        Just mark incorrect
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCorrectionOpen(false);
                          setCorrectionText("");
                        }}
                        className="px-3 py-2 font-semibold text-[#6F5A45]"
                      >
                        Cancel
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] text-amber-800">
                      Only the intended workflow classification is learned.
                      Names, quantities, dates and approvals are never learned
                      as operational facts.
                    </p>
                  </div>
                )}
              </div>
            )}
            {!!result?.questions?.length && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <b className="text-sm">Still needed</b>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-900">
                  {result.questions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            )}
            {result?.status === "READY_TO_CREATE_DRAFT" && (
              <button
                onClick={create}
                disabled={busy}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 p-3 text-sm font-bold text-white disabled:opacity-50"
              >
                <CheckCircle2 className="h-5 w-5" />
                {result.intent_type === "JOB_ORDER"
                  ? "Confirm & prepare production pack"
                  : "Create controlled ERP record"}
              </button>
            )}
            {result?.status === "READY_TO_REQUEST_APPROVAL" &&
              !approvalRequest && (
                <button
                  onClick={requestApproval}
                  disabled={busy}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-violet-700 p-3 text-sm font-bold text-white disabled:opacity-50"
                >
                  <ShieldCheck className="h-5 w-5" />
                  Request independent approval
                </button>
              )}
            {approvalRequest && (
              <Link
                href={
                  approvalRequest.route || "/dashboard/command-center/actions"
                }
                className="mt-3 flex items-center justify-center gap-2 rounded-lg border border-violet-300 p-3 text-sm font-bold text-violet-800"
              >
                Open approval queue
                <ExternalLink className="h-4 w-4" />
              </Link>
            )}
            {result?.status === "READY_TO_OPEN_WORKFLOW" &&
              result.next_step?.route && (
                <Link
                  href={result.next_step.route}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#65452B] p-3 text-sm font-bold text-white"
                >
                  Open {result.capability?.label}
                  <ExternalLink className="h-4 w-4" />
                </Link>
              )}
            {!!created?.native_record?.launch_packs?.length && (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <div className="flex items-center gap-2 text-emerald-950">
                  <ListChecks className="h-5 w-5" />
                  <b>
                    {created.native_record.launch_packs.length} Job Orders
                    created
                  </b>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {created.native_record.launch_packs.map((entry: any) => (
                    <Link
                      key={entry.job_order_number}
                      href="/dashboard/production/job-orders"
                      className="rounded-lg border border-emerald-200 bg-white p-3 hover:border-emerald-500"
                    >
                      <b className="text-xs text-[#3F3024]">
                        {entry.job_order_number}
                      </b>
                      <span className="mt-1 block text-[11px] text-[#6F5A45]">
                        {entry.item_name || "Production launch pack ready"}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {created?.native_record?.launch_pack && (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <div className="flex items-center gap-2 text-emerald-950">
                  <ListChecks className="h-5 w-5" />
                  <b>{created.native_record.launch_pack.title}</b>
                </div>
                <p className="mt-1 text-xs text-emerald-900">
                  Everything needed to start is prepared. Physical movements
                  still need confirmation.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {created.native_record.launch_pack.steps.map((step: any) => (
                    <Link
                      key={step.code}
                      href={step.route}
                      className="rounded-lg border border-emerald-200 bg-white p-3 hover:border-emerald-500"
                    >
                      <span className="flex items-start justify-between gap-2">
                        <b className="text-xs text-[#3F3024]">{step.label}</b>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold ${step.status === "AWAITING_PHYSICAL_EVENT" ? "bg-amber-100 text-amber-900" : step.status === "NOT_REQUIRED" ? "bg-slate-100 text-slate-700" : "bg-emerald-100 text-emerald-800"}`}
                        >
                          {step.status.replaceAll("_", " ")}
                        </span>
                      </span>
                      <span className="mt-1 block text-[11px] text-[#6F5A45]">
                        {step.detail}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {created && (
              <Link
                href={created.route || "/dashboard"}
                className="mt-3 flex items-center justify-center gap-2 rounded-lg border border-emerald-700 p-3 text-sm font-bold text-emerald-800"
              >
                Open{" "}
                {created.native_record?.po_number ||
                  created.native_record?.pr_number ||
                  created.native_record?.quotation_number ||
                  created.native_record?.so_number ||
                  created.native_record?.job_order_number ||
                  created.native_record?.program_code ||
                  created.native_record?.journal_number ||
                  "record"}
                <ExternalLink className="h-4 w-4" />
              </Link>
            )}
          </section>
          <section className="hidden rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm sm:block">
            <h2 className="flex items-center gap-2 font-bold text-emerald-900">
              <ShieldCheck className="h-5 w-5" />
              Control boundary
            </h2>
            <ul className="mt-2 space-y-2 text-xs text-emerald-900">
              <li>
                • The planner may prepare a draft; it cannot approve, post, pay,
                release, or message externally.
              </li>
              <li>
                • GRN, dispatch, QC, inventory, payroll, payments, and invoices
                stay inside their native controlled workflows.
              </li>
              <li>
                • Tenant masters and source-document prerequisites are
                permission-checked by the server before they are exposed.
              </li>
              <li>
                • OpenAI structured extraction is optional; deterministic
                parsing remains available during provider failure.
              </li>
              <li>
                • Every confirmation is one-time and duplicate draft creation is
                blocked.
              </li>
            </ul>
          </section>
        </div>
      </section>
      {!!capabilities.length && (
        <details className="hidden rounded-xl border border-[#E0D2B8] bg-white p-4 sm:block">
          <summary className="cursor-pointer list-none">
            <span className="font-bold">Planner coverage</span>
            <span className="ml-2 text-xs text-[#7A6555]">
              {capabilities.length} governed workflows — open to use an example
              prompt.
            </span>
          </summary>
          <div className="mt-3 border-t border-[#E5D8C1] pt-3">
            <p className="text-xs text-[#7A6555]">
              Select an example to place it in the prompt. Draft, approval,
              posting, payment, and external messaging controls are never
              bypassed.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {capabilities.map((cap) => (
                <button
                  key={cap.intent}
                  onClick={() => setInput(cap.examples[0])}
                  className="rounded-lg border border-[#E5D8C1] p-3 text-left hover:bg-[#FBF7EF]"
                >
                  <span className="text-[10px] font-bold uppercase text-[#8B6F47]">
                    {cap.module} · {cap.mode.replaceAll("_", " ")}
                  </span>
                  <b className="mt-1 block text-sm">{cap.label}</b>
                  <span className="mt-1 block text-xs text-[#7A6555]">
                    {cap.examples[0]}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </details>
      )}
    </main>
  );
}
