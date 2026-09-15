"use client";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

import {
  Fragment,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiClient } from "../../../../lib/api-client";
import { getTodayDateInputValue } from "@/lib/date";
import {
  buildDocumentBranding,
  escapeHtml,
  renderStandardLetterheadHtml,
} from "@/lib/document-branding";
import { confirmDialog } from "../../../components/ui/ConfirmDialog";
import DateInput from "../../../components/ui/DateInput";
import {
  getEnabledModules,
  getUserRoleNames as getStoredUserRoleNames,
  hasModulePermission as hasRbacPermission,
  isAdminLike,
  readStoredUser,
} from "@/lib/rbac";
import { useEscapeKey } from "../../../hooks/useEscapeKey";
import {
  AlertTriangle,
  ArrowDownUp,
  ArrowRight,
  BadgeCheck,
  Briefcase,
  Building2,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileWarning,
  FileText,
  GaugeCircle,
  IndianRupee,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UserPlus,
  UserX,
  Users,
  WalletCards,
  X,
} from "lucide-react";

// Import HR module utilities
import {
  calculatePF,
  calculateESI,
  calculateProfessionalTax,
  calculateTDS,
  calculateGratuity,
  calculateEndOfServiceBenefits,
  generatePayslipHTML,
  UAEConfig,
  IndiaConfig,
} from "@sak-erp/hr-module";

interface Employee {
  id: string;
  user_id?: string | null;
  employee_code: string;
  employee_name: string;
  designation: string;
  department: string;
  contact_number: string;
  email: string;
  status: string;
  date_of_joining: string;
  per_diem_amount?: number | string | null;
  per_diem_rate?: number | string | null;
}

interface AttendanceRecord {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code?: string;
  employee_email?: string;
  attendance_date: string;
  check_in_time: string;
  check_out_time: string;
  check_in_location?: string;
  check_out_location?: string;
  check_in_lat?: number | null;
  check_in_lng?: number | null;
  check_out_lat?: number | null;
  check_out_lng?: number | null;
  check_in_photo_url?: string;
  check_out_photo_url?: string;
  check_in_notes?: string;
  check_out_notes?: string;
  punches?: Array<{
    id: string;
    punch_type: "IN" | "OUT";
    punch_at: string;
    location?: string;
    notes?: string;
  }>;
  is_outside_zone?: boolean;
  outside_zone_reason?: string;
  is_outstation_travel?: boolean;
  travel_departure_time?: string | null;
  travel_arrival_time?: string | null;
  travel_notes?: string | null;
  employee_per_diem_amount?: number | string | null;
  work_hours?: number;
  status: string;
}

type AttendanceSortKey =
  | "employee"
  | "date"
  | "check_in"
  | "check_out"
  | "hours"
  | "pay_days"
  | "travel_per_diem"
  | "status";
type SortDirection = "asc" | "desc";
type AttendanceColumnKey =
  | "details"
  | AttendanceSortKey
  | "evidence"
  | "actions";

const DEFAULT_ATTENDANCE_COLUMN_WIDTHS: Record<AttendanceColumnKey, number> = {
  details: 100,
  employee: 260,
  date: 150,
  check_in: 255,
  check_out: 255,
  hours: 110,
  pay_days: 125,
  travel_per_diem: 180,
  status: 145,
  evidence: 175,
  actions: 125,
};

interface LeaveRequest {
  id: string;
  employee_id: string;
  employee_name: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  total_days: number;
  reason: string;
  status: string;
}

interface Holiday {
  id: string;
  holiday_name: string;
  start_date: string;
  end_date?: string | null;
  holiday_type: string;
  notes?: string | null;
  day_count?: number;
}

interface Payslip {
  id: string;
  employee_id: string;
  employee_name: string;
  payslip_number: string;
  salary_month: string;
  gross_salary: number;
  total_deductions: number;
  net_salary: number;
  attendance_days: number;
  leave_days: number;
  travel_days?: number;
  per_diem_amount?: number;
  total_per_diem?: number;
}

interface SalaryComponent {
  id: string;
  employee_id: string;
  employee_name?: string;
  component_type: string;
  component_name: string;
  amount: number;
  is_taxable: boolean;
}

interface ComprehensiveSalaryForm {
  employee_id: string;
  basic_salary: number;
  hra: number;
  medical_allowance: number;
  travelling_allowance: number;
  special_allowance: number;
  pf_deduction: number;
  esi_deduction: number;
  professional_tax: number;
  other_allowances: { name: string; amount: number; is_taxable: boolean }[];
  other_deductions: { name: string; amount: number }[];
}

interface KPIMetrics {
  attendance_rate: number;
  punctuality_score: number;
  leave_utilization: number;
  overtime_hours: number;
  late_count: number;
  absent_count: number;
  // Manual entry fields
  quality_of_work?: number; // 0-100
  productivity_score?: number; // 0-100
  teamwork_rating?: number; // 0-100
  customer_satisfaction?: number; // 0-100
  project_completion_rate?: number; // 0-100
  initiative_innovation?: number; // 0-100
  manual_notes?: string;
}

interface PayrollRun {
  id: string;
  payroll_month: string;
  run_date: string;
  status: string;
  remarks?: string;
}

interface EmployeeDocument {
  id: string;
  employee_id: string;
  doc_type: string;
  file_name?: string;
  file_url: string;
  file_type?: string;
  file_size?: number;
  notes?: string;
  created_at: string;
}

interface MeritDemerit {
  id: string;
  employee_id: string;
  record_type: "MERIT" | "DEMERIT" | string;
  title: string;
  description?: string;
  points?: number;
  event_date: string;
  created_at: string;
  status?: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "VOID" | string;
  evidence_reference?: string;
}

interface MonthlyPayroll {
  id?: string;
  employee_id: string;
  employee_name?: string;
  payroll_month: string;
  days_in_month: number;
  days_travelled: number;
  comp_offs: number;
  leaves_absent: number;
  approved_paid_leaves: number;
  paid_for_total_days: number;
  bonus_monthly: number;
  production_incentive: number;
  bonus_hold: number; // Bonus Monthly (On Hold)
  production_incentive_hold: number; // Production Incentive (On Hold)
  special_allowance: number;
  professional_tax: number;
  gross_salary: number;
  net_salary: number; // Gross - Professional Tax
  monthly_hold: number; // Bonus Hold + Production Incentive Hold
  amount_paid: number; // Net - Monthly Hold
  status: "DRAFT" | "PROCESSED" | "PAID";
  created_at?: string;
  processed_at?: string;
}

interface HrCommandStats {
  activeEmployees: number;
  inactiveEmployees: number;
  presentToday: number;
  lateToday: number;
  absentToday: number;
  pendingLeaves: number;
  approvedLeaves: number;
  pendingPayrolls: number;
  processedPayrolls: number;
  holidayCount: number;
  nextHolidayName: string;
  nextHolidayDate: string;
  documentsExpiring: number;
  lastUpdated: string;
}

const initialHrCommandStats: HrCommandStats = {
  activeEmployees: 0,
  inactiveEmployees: 0,
  presentToday: 0,
  lateToday: 0,
  absentToday: 0,
  pendingLeaves: 0,
  approvedLeaves: 0,
  pendingPayrolls: 0,
  processedPayrolls: 0,
  holidayCount: 0,
  nextHolidayName: "-",
  nextHolidayDate: "",
  documentsExpiring: 0,
  lastUpdated: "",
};

type StoredUser = {
  id?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: {
    id: string;
    name: string;
    permissions?: any[];
  };
  roles?:
    | string[]
    | Array<{
        role: {
          id: string;
          name: string;
          permissions?: any[];
        };
      }>;
};

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

async function reverseGeocodeLocation(position: {
  lat: number;
  lng: number;
}): Promise<string> {
  const fallback = `${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}`;

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(position.lat)}&lon=${encodeURIComponent(position.lng)}&zoom=18&addressdetails=1`,
    );
    const data = await response.json();
    return data?.display_name || fallback;
  } catch {
    return fallback;
  }
}

function loadImageForStamp(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to read selected photo"));
    };
    image.src = url;
  });
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = String(text || "")
    .split(/\s+/)
    .filter(Boolean);
  const lines: string[] = [];
  let line = "";

  words.forEach((word) => {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width <= maxWidth || !line) {
      line = testLine;
      return;
    }
    lines.push(line);
    line = word;
  });

  if (line) lines.push(line);
  return lines;
}

async function createStampedAttendancePhoto(
  file: File,
  stamp: {
    employeeName: string;
    action: "CHECK IN" | "CHECK OUT";
    lat: number;
    lng: number;
    address: string;
    timestamp: Date;
  },
): Promise<File> {
  if (typeof document === "undefined") return file;

  try {
    const image = await loadImageForStamp(file);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const baseFont = Math.max(22, Math.round(canvas.width * 0.022));
    const smallFont = Math.max(18, Math.round(canvas.width * 0.018));
    const padding = Math.max(18, Math.round(canvas.width * 0.018));
    const maxTextWidth = canvas.width - padding * 2;
    const dateText = stamp.timestamp.toLocaleString("en-IN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    ctx.font = `600 ${smallFont}px Arial, sans-serif`;
    const lines = [
      `SAK ERP Attendance - ${stamp.action}`,
      `Employee: ${stamp.employeeName || "Employee"}`,
      `Time: ${dateText}`,
      `Lat/Lng: ${stamp.lat.toFixed(6)}, ${stamp.lng.toFixed(6)}`,
      ...wrapCanvasText(
        ctx,
        `Location: ${stamp.address || "-"}`,
        maxTextWidth,
      ).slice(0, 3),
    ];

    const lineHeight = Math.round(baseFont * 1.35);
    const overlayHeight = padding * 2 + lines.length * lineHeight;
    const overlayY = Math.max(0, canvas.height - overlayHeight);

    ctx.fillStyle = "rgba(0, 0, 0, 0.68)";
    ctx.fillRect(0, overlayY, canvas.width, overlayHeight);
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "top";

    lines.forEach((line, index) => {
      ctx.font = `${index === 0 ? "700" : "600"} ${index === 0 ? baseFont : smallFont}px Arial, sans-serif`;
      ctx.fillText(line, padding, overlayY + padding + index * lineHeight);
    });

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    if (!blob) return file;

    const safeName = file.name.replace(/\.[^.]+$/, "") || "attendance-photo";
    return new File([blob], `${safeName}-stamped.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

function getOptionalEnvNumber(value: string | undefined): number | null {
  if (!value || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// SAIF office fallback from the confirmed Google Maps location.
// Env values can still override this per deployment, but missing env must not
// disable geofence enforcement.
const DEFAULT_HR_OFFICE_LAT = 17.81010395938058;
const DEFAULT_HR_OFFICE_LNG = 83.38749947116408;
const HR_OFFICE_LAT =
  getOptionalEnvNumber(process.env.NEXT_PUBLIC_HR_OFFICE_LAT) ??
  DEFAULT_HR_OFFICE_LAT;
const HR_OFFICE_LNG =
  getOptionalEnvNumber(process.env.NEXT_PUBLIC_HR_OFFICE_LNG) ??
  DEFAULT_HR_OFFICE_LNG;
const HR_OFFICE_RADIUS_METERS =
  getOptionalEnvNumber(process.env.NEXT_PUBLIC_HR_OFFICE_RADIUS_METERS) ?? 100;
const HR_OFFICE_ACCURACY_GRACE_METERS =
  getOptionalEnvNumber(
    process.env.NEXT_PUBLIC_HR_OFFICE_ACCURACY_GRACE_METERS,
  ) ?? 250;
const HAS_HR_OFFICE_GEOFENCE = true;

function getDistanceMeters(
  first: { lat: number; lng: number },
  second: { lat: number; lng: number },
): number {
  const earthRadiusMeters = 6371000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(second.lat - first.lat);
  const dLng = toRadians(second.lng - first.lng);
  const lat1 = toRadians(first.lat);
  const lat2 = toRadians(second.lat);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getOfficeDistanceMeters(position: {
  lat: number;
  lng: number;
}): number | null {
  if (
    !HAS_HR_OFFICE_GEOFENCE ||
    HR_OFFICE_LAT === null ||
    HR_OFFICE_LNG === null
  )
    return null;
  return getDistanceMeters(
    { lat: HR_OFFICE_LAT, lng: HR_OFFICE_LNG },
    position,
  );
}

function isPositionOutsideOfficeGeofence(position: {
  lat: number;
  lng: number;
  accuracy?: number | null;
}): boolean | null {
  const distanceMeters = getOfficeDistanceMeters(position);
  if (distanceMeters === null) return null;
  const accuracyGrace = Number.isFinite(position.accuracy)
    ? Math.min(
        Math.max(Number(position.accuracy), 0),
        HR_OFFICE_ACCURACY_GRACE_METERS,
      )
    : 0;
  return distanceMeters > HR_OFFICE_RADIUS_METERS + accuracyGrace;
}

function isGeolocationPermissionDenied(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? Number((error as { code?: unknown }).code)
      : null;
  const message = String(
    (error as { message?: unknown })?.message || "",
  ).toLowerCase();
  return (
    code === 1 || message.includes("denied") || message.includes("permission")
  );
}

function displayAttendanceLocation(
  location?: string | null,
  lat?: number | null,
  lng?: number | null,
) {
  const value = String(location || "").toLowerCase();
  if (
    value.includes("kolkata") ||
    value.includes("ripon street") ||
    value.includes("eac")
  )
    return "EAC";
  if (
    value.includes("visakhapatnam") ||
    value.includes("vizag") ||
    value.includes("mithilapuri") ||
    value.includes("apis")
  )
    return "SAK Solutions - APIS";
  if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (
      Math.abs(latitude - 22.5726) < 0.25 &&
      Math.abs(longitude - 88.3639) < 0.25
    )
      return "EAC";
    if (
      Math.abs(latitude - 17.8101) < 0.25 &&
      Math.abs(longitude - 83.3875) < 0.25
    )
      return "SAK Solutions - APIS";
  }
  return location || "-";
}

function parseDateInputLocal(value?: string | null): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function formatDateInputLocal(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDaysToDateInput(value: string, days: number): string {
  const parsed = parseDateInputLocal(value) || new Date();
  parsed.setDate(parsed.getDate() + days);
  return formatDateInputLocal(parsed);
}

function getNextLeaveDateInputValue(): string {
  const date = parseDateInputLocal(getTodayDateInputValue()) || new Date();
  do {
    date.setDate(date.getDate() + 1);
  } while (date.getDay() === 0);
  return formatDateInputLocal(date);
}

function countLeaveDaysExcludingSundays(
  startDate?: string,
  endDate?: string,
): number {
  const start = parseDateInputLocal(startDate);
  const end = parseDateInputLocal(endDate);
  if (!start || !end || end.getTime() < start.getTime()) return 0;
  const cursor = new Date(start);
  let count = 0;
  while (cursor.getTime() <= end.getTime()) {
    if (cursor.getDay() !== 0) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function normalizeLeaveDateForm<
  T extends { start_date: string; end_date: string; total_days: number },
>(form: T, changes: Partial<T>): T {
  const next = { ...form, ...changes };
  if (next.start_date && next.end_date) {
    const start = parseDateInputLocal(next.start_date);
    const end = parseDateInputLocal(next.end_date);
    if (start && end && end.getTime() < start.getTime()) {
      next.end_date = next.start_date;
    }
    next.total_days = countLeaveDaysExcludingSundays(
      next.start_date,
      next.end_date,
    );
  }
  return next;
}

function getAttendanceLocationErrorMessage(
  error: unknown,
  action: "check in" | "check out",
): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? Number((error as { code?: unknown }).code)
      : null;
  const rawMessage = String(
    (error as { message?: unknown })?.message || "",
  ).trim();

  if (isGeolocationPermissionDenied(error)) {
    return `Location permission is blocked, so ${action} cannot verify the office geofence. Please allow Location for this site from the browser address-bar lock/site settings, then press ${action === "check in" ? "Check In" : "Check Out"} again.`;
  }

  if (code === 2) {
    return `Unable to read current location. Please make sure GPS/location services are enabled and try ${action} again.`;
  }

  if (code === 3 || rawMessage.toLowerCase().includes("timeout")) {
    return `Location request timed out. Please move to an open area or enable high-accuracy location, then try ${action} again.`;
  }

  return rawMessage || `Failed to ${action}. Please try again.`;
}

function toTimeInputValue(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  const match = String(value).match(/(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "";
}

function getUserRoleNames(user: StoredUser | null): string[] {
  return getStoredUserRoleNames(user).map(normalizeText).filter(Boolean);
}

function hasModulePermission(
  user: StoredUser | null,
  moduleName: string,
  action: "view" | "create" | "edit" | "delete" | "approve" = "view",
): boolean {
  return hasRbacPermission(user, moduleName, action);
}

function userCanAccessManagement(user: StoredUser | null): boolean {
  if (!user) {
    return false;
  }

  // Prefer permissions-based check (works for multi-role and custom role names)
  if (
    hasModulePermission(user, "HR Management", "approve") ||
    hasModulePermission(user, "HR Management", "edit") ||
    hasModulePermission(user, "HR Management", "create") ||
    hasModulePermission(user, "HR Management", "delete")
  ) {
    return true;
  }

  // Fallback: allow known admin/owner patterns by role name
  const roleNames = getUserRoleNames(user);

  const hasAdminRole = roleNames.some((name) =>
    [
      "ADMIN",
      "ADMINISTRATOR",
      "SUPER ADMIN",
      "SUPER_ADMIN",
      "SUPERADMIN",
      "OWNER",
      "OWNER1",
      "OWNER2",
      "MANAGER HR",
      "MANAGER_HR",
      "HR",
      "HR MANAGER",
      "MANAGER",
    ].includes(name),
  );

  if (hasAdminRole) {
  } else {
  }

  return hasAdminRole;
}

export default function HrPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6">
          <div className="text-xl">Loading...</div>
        </div>
      }
    >
      <HrPageContent />
    </Suspense>
  );
}

function HrPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const todayDate = getTodayDateInputValue();
  const serverSafeTodayDate = [
    todayDate,
    new Date().toISOString().slice(0, 10),
  ].sort()[0];
  const [activeSection, setActiveSection] = useState<
    "management" | "employees"
  >("employees");
  const [currentUser, setCurrentUser] = useState<StoredUser | null>(null);
  const [myEmployee, setMyEmployee] = useState<Employee | null>(null);
  const [activeTab, setActiveTab] = useState<
    | "dashboard"
    | "employees"
    | "attendance"
    | "leaves"
    | "holidays"
    | "payroll"
    | "config"
  >("attendance");
  const [showEmployeeMore, setShowEmployeeMore] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [attendanceSort, setAttendanceSort] = useState<{
    key: AttendanceSortKey;
    direction: SortDirection;
  }>({
    key: "date",
    direction: "desc",
  });
  const [attendanceColumnWidths, setAttendanceColumnWidths] = useState<
    Record<AttendanceColumnKey, number>
  >(DEFAULT_ATTENDANCE_COLUMN_WIDTHS);
  const [expandedAttendanceId, setExpandedAttendanceId] = useState<
    string | null
  >(null);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [leaveStatusFilter, setLeaveStatusFilter] = useState<
    "ALL" | "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"
  >("ALL");
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [hrCommandStats, setHrCommandStats] = useState<HrCommandStats>(
    initialHrCommandStats,
  );
  const [hrCommandLoading, setHrCommandLoading] = useState(true);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeeStatusFilter, setEmployeeStatusFilter] = useState<
    "ALL" | "ACTIVE" | "INACTIVE"
  >("ALL");

  // Geo-tagging attendance state
  const [todayAttendance, setTodayAttendance] = useState<any>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<{
    lat: number;
    lng: number;
    address: string;
    accuracy?: number | null;
  } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const attendanceCameraInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingOutsideCheckIn, setPendingOutsideCheckIn] = useState<{
    position: { lat: number; lng: number; accuracy?: number | null };
    address: string;
    distanceMeters: number | null;
  } | null>(null);
  const [pendingOutsideCheckOut, setPendingOutsideCheckOut] = useState<{
    position: { lat: number; lng: number; accuracy?: number | null };
    address: string;
    distanceMeters: number | null;
    endDay: boolean;
  } | null>(null);
  const [isOutsideZone, setIsOutsideZone] = useState(false);
  const [officeDistanceMeters, setOfficeDistanceMeters] = useState<
    number | null
  >(null);
  const [outReason, setOutReason] = useState("");
  const [outReasonOther, setOutReasonOther] = useState("");

  const isEmployeePortal = activeSection === "employees";
  const canManage = userCanAccessManagement(currentUser);
  const canCreateHR = hasModulePermission(
    currentUser,
    "HR Management",
    "create",
  );
  const canEditHR = hasModulePermission(currentUser, "HR Management", "edit");
  const canDeleteHR = hasModulePermission(
    currentUser,
    "HR Management",
    "delete",
  );
  const canApproveHR = hasModulePermission(
    currentUser,
    "HR Management",
    "approve",
  );
  const canCorrectAttendance =
    canEditHR ||
    canApproveHR ||
    getUserRoleNames(currentUser).some((name) =>
      [
        "ADMIN",
        "ADMINISTRATOR",
        "SUPER ADMIN",
        "SUPER_ADMIN",
        "SUPERADMIN",
        "HR",
        "HR MANAGER",
        "MANAGER HR",
        "MANAGER",
      ].includes(name),
    );
  const canManageAttendance = canCreateHR || canCorrectAttendance;
  const enabledModules = useMemo(
    () => getEnabledModules(currentUser),
    [currentUser],
  );
  const canSkipAttendanceEvidence = getUserRoleNames(currentUser).some(
    (name) => {
      const normalized = String(name || "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_")
        .replace(/[^A-Z0-9_]/g, "");
      return ["SUPER_ADMIN", "SUPERADMIN", "OWNER"].includes(normalized);
    },
  );
  const canOpenBackOfficeMenu =
    isAdminLike(currentUser) || canManage || enabledModules.size > 1;
  const backOfficeMenuHref = isAdminLike(currentUser)
    ? "/dashboard"
    : canManage
      ? "/dashboard/hr/management?tab=attendance&section=management"
      : enabledModules.has("Purchase Management")
        ? "/dashboard/purchase"
        : enabledModules.has("Inventory Management")
          ? "/dashboard/inventory/items"
          : enabledModules.has("Production Management")
            ? "/dashboard/production/job-orders"
            : "/dashboard";
  const getCurrentUserId = () =>
    currentUser?.id || localStorage.getItem("userId");
  const getAttendanceEmployeeName = () => {
    const userName = [currentUser?.firstName, currentUser?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    return (
      myEmployee?.employee_name || userName || currentUser?.email || "Employee"
    );
  };

  // Region configuration (INDIA or UAE)
  const [complianceRegion, setComplianceRegion] = useState<"INDIA" | "UAE">(
    "INDIA",
  );
  const [complianceState, setComplianceState] = useState("MH"); // For India PT calculation

  // Helper: Auto-calculate PF/ESI/PT based on salary
  const calculateStatutoryDeductions = (
    basicSalary: number,
    grossSalary: number,
  ) => {
    if (complianceRegion === "INDIA") {
      const pf = calculatePF(basicSalary);
      const esi = calculateESI(grossSalary);
      const pt = calculateProfessionalTax(grossSalary, complianceState);

      return {
        pf: pf.employeeShare,
        esi: esi?.employeeShare || 0,
        pt: pt,
      };
    }
    // UAE has no PF/ESI/PT
    return { pf: 0, esi: 0, pt: 0 };
  };

  // Geo-tagging attendance helpers
  const getCurrentPosition = (): Promise<{
    lat: number;
    lng: number;
    accuracy?: number | null;
  }> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation is not supported"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
        },
        (error) => reject(error),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      );
    });
  };

  const fetchTodayAttendance = async () => {
    try {
      const data = await apiClient.get("/hr/attendance/today");
      setTodayAttendance(data);
    } catch {
      setTodayAttendance(null);
    }
  };

  const submitCheckIn = async (
    position: { lat: number; lng: number; accuracy?: number | null },
    address: string,
    outsideByGeoFence: boolean,
    evidencePhoto?: File | null,
  ) => {
    const requiresOutsideEvidence =
      outsideByGeoFence && !canSkipAttendanceEvidence;

    let photoUrl = "";
    if (requiresOutsideEvidence) {
      if (!evidencePhoto) {
        throw new Error(
          "Selfie is required because you are outside the office geofence.",
        );
      }

      const stampedPhoto = await createStampedAttendancePhoto(evidencePhoto, {
        employeeName: getAttendanceEmployeeName(),
        action: "CHECK IN",
        lat: position.lat,
        lng: position.lng,
        address,
        timestamp: new Date(),
      });
      const formData = new FormData();
      formData.append("file", stampedPhoto);
      formData.append("folder", "attendance");
      formData.append("bucket", "documents");
      const uploadRes = await apiClient.postForm("/upload", formData);
      photoUrl = uploadRes.url || "";
    }

    await apiClient.post("/hr/attendance/check-in", {
      lat: position.lat,
      lng: position.lng,
      accuracy: position.accuracy,
      location: address,
      photoUrl,
      notes: requiresOutsideEvidence
        ? "Outside office geofence - selfie captured by camera."
        : undefined,
      isOutsideZone: outsideByGeoFence,
      outsideZoneReason: requiresOutsideEvidence
        ? "Outside office geofence - selfie captured by camera."
        : undefined,
    });

    await fetchTodayAttendance();
    setPendingOutsideCheckIn(null);
    setIsOutsideZone(false);
    setOfficeDistanceMeters(null);
    alert("Checked in successfully!");
  };

  const handleCheckIn = async () => {
    try {
      setCheckingIn(true);
      setLocationError(null);
      setPendingOutsideCheckIn(null);

      // Get current location
      const position = await getCurrentPosition();
      let address = "";

      // Try to get address/name from coordinates (reverse geocoding)
      address = await reverseGeocodeLocation(position);

      setCurrentLocation({
        lat: position.lat,
        lng: position.lng,
        address,
        accuracy: position.accuracy,
      });
      const distanceMeters = getOfficeDistanceMeters(position);
      const outsideByGeoFence =
        isPositionOutsideOfficeGeofence(position) ?? isOutsideZone;
      setOfficeDistanceMeters(distanceMeters);
      setIsOutsideZone(outsideByGeoFence);

      const requiresOutsideEvidence =
        outsideByGeoFence && !canSkipAttendanceEvidence;

      if (requiresOutsideEvidence) {
        setPendingOutsideCheckIn({ position, address, distanceMeters });
        setLocationError(
          "You are outside the office geofence. Tap the camera button below to take a selfie and complete Check In.",
        );
        return;
      }

      await submitCheckIn(position, address, outsideByGeoFence);
    } catch (err: any) {
      const message = getAttendanceLocationErrorMessage(err, "check in");
      setLocationError(message);
      if (!isGeolocationPermissionDenied(err)) {
        alert(message);
      }
    } finally {
      setCheckingIn(false);
    }
  };

  const handleCheckOut = async (endDay = false) => {
    const movementReason =
      outReason === "Other" ? outReasonOther.trim() : outReason.trim();
    if (!endDay && !movementReason) {
      setLocationError("Select a reason before recording Go Out.");
      return;
    }

    try {
      setCheckingOut(true);
      setLocationError(null);
      setPendingOutsideCheckOut(null);

      // Get current location
      const position = await getCurrentPosition();
      let address = "";

      // Try to get address/name from coordinates
      address = await reverseGeocodeLocation(position);
      setCurrentLocation({
        lat: position.lat,
        lng: position.lng,
        address,
        accuracy: position.accuracy,
      });
      const distanceMeters = getOfficeDistanceMeters(position);
      const outsideByGeoFence =
        isPositionOutsideOfficeGeofence(position) ?? isOutsideZone;
      setOfficeDistanceMeters(distanceMeters);
      setIsOutsideZone(outsideByGeoFence);

      if (outsideByGeoFence && !canSkipAttendanceEvidence) {
        setPendingOutsideCheckOut({
          position,
          address,
          distanceMeters,
          endDay,
        });
        setLocationError(
          `You are outside the office geofence. Tap the camera button below to ${
            endDay ? "take a selfie and complete End Day" : "take a selfie and record Go Out"
          }.`,
        );
        return;
      }

      // Call check-out API
      await apiClient.post("/hr/attendance/check-out", {
        lat: position.lat,
        lng: position.lng,
        accuracy: position.accuracy,
        location: address,
        photoUrl: "",
        notes: endDay ? undefined : movementReason,
        isOutsideZone: outsideByGeoFence,
        endDay,
      });

      // Refresh today's attendance
      await fetchTodayAttendance();

      // Reset states
      setPendingOutsideCheckIn(null);
      setIsOutsideZone(false);
      setOfficeDistanceMeters(null);
      if (!endDay) {
        setOutReason("");
        setOutReasonOther("");
      }
      alert(
        endDay
          ? "Day completed successfully!"
          : "Out movement recorded. Press Return to Office when you come back.",
      );
    } catch (err: any) {
      const message = getAttendanceLocationErrorMessage(err, "check out");
      setLocationError(message);
      if (!isGeolocationPermissionDenied(err)) {
        alert(message);
      }
    } finally {
      setCheckingOut(false);
    }
  };

  const submitOutsideCheckOut = async (file: File) => {
    if (!pendingOutsideCheckOut) return;
    const movementReason =
      outReason === "Other" ? outReasonOther.trim() : outReason.trim();
    if (!pendingOutsideCheckOut.endDay && !movementReason) {
      throw new Error("Select a reason before recording Go Out.");
    }
    const stampedPhoto = await createStampedAttendancePhoto(file, {
      employeeName: getAttendanceEmployeeName(),
      action: "CHECK OUT",
      lat: pendingOutsideCheckOut.position.lat,
      lng: pendingOutsideCheckOut.position.lng,
      address: pendingOutsideCheckOut.address,
      timestamp: new Date(),
    });
    const formData = new FormData();
    formData.append("file", stampedPhoto);
    formData.append("folder", "attendance");
    formData.append("bucket", "documents");
    const uploadRes = await apiClient.postForm("/upload", formData);
    await apiClient.post("/hr/attendance/check-out", {
      ...pendingOutsideCheckOut.position,
      location: pendingOutsideCheckOut.address,
      photoUrl: uploadRes.url || "",
      notes: pendingOutsideCheckOut.endDay
        ? "Outside office geofence - selfie captured by camera."
        : `${movementReason}; Outside office geofence - selfie captured by camera.`,
      isOutsideZone: true,
      endDay: pendingOutsideCheckOut.endDay,
    });
    await fetchTodayAttendance();
    setPendingOutsideCheckOut(null);
    setIsOutsideZone(false);
    setOfficeDistanceMeters(null);
    if (!pendingOutsideCheckOut.endDay) {
      setOutReason("");
      setOutReasonOther("");
    }
    alert(
      pendingOutsideCheckOut.endDay
        ? "Day completed successfully!"
        : "Out movement recorded.",
    );
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) {
      setLocationError(
        "Selfie capture was not completed. Tap the camera button to try again.",
      );
      return;
    }

    if (pendingOutsideCheckOut) {
      try {
        setCheckingOut(true);
        setLocationError(null);
        await submitOutsideCheckOut(file);
      } catch (err: any) {
        setLocationError(err.message || "Failed to check out with selfie");
        alert("Error: " + (err.message || "Failed to check out with selfie"));
      } finally {
        setCheckingOut(false);
      }
      return;
    }
    if (!pendingOutsideCheckIn) {
      return;
    }

    try {
      setCheckingIn(true);
      setLocationError(null);
      await submitCheckIn(
        pendingOutsideCheckIn.position,
        pendingOutsideCheckIn.address,
        true,
        file,
      );
    } catch (err: any) {
      setLocationError(err.message || "Failed to check in with selfie");
      alert("Error: " + (err.message || "Failed to check in with selfie"));
    } finally {
      setCheckingIn(false);
    }
  };

  const openAttendanceCamera = () => {
    if (!pendingOutsideCheckIn && !pendingOutsideCheckOut) return;
    const input = attendanceCameraInputRef.current;
    if (!input) {
      setLocationError(
        "Camera capture is unavailable in this browser. Open this page in Chrome or Safari and allow camera access.",
      );
      return;
    }
    setLocationError(null);
    input.value = "";
    input.click();
  };

  const cancelPendingAttendanceSelfie = () => {
    setPendingOutsideCheckIn(null);
    setPendingOutsideCheckOut(null);
    setLocationError(null);
  };

  const openAttendanceCorrection = (record: AttendanceRecord) => {
    setSelectedAttendance(record);
    setAttendanceForm({
      employee_id: record.employee_id || "",
      attendance_date: record.attendance_date
        ? String(record.attendance_date).slice(0, 10)
        : getTodayDateInputValue(),
      check_in_time: toTimeInputValue(record.check_in_time),
      check_out_time: toTimeInputValue(record.check_out_time),
      status: record.status || "PRESENT",
      remarks: "",
      is_outstation_travel: Boolean(record.is_outstation_travel),
      travel_departure_time:
        formatTimeOnly(record.travel_departure_time) === "-"
          ? ""
          : formatTimeOnly(record.travel_departure_time),
      travel_arrival_time:
        formatTimeOnly(record.travel_arrival_time) === "-"
          ? ""
          : formatTimeOnly(record.travel_arrival_time),
      travel_notes: record.travel_notes || "",
    });
    setShowEditAttendance(true);
  };

  const [salaryComponents, setSalaryComponents] = useState<SalaryComponent[]>(
    [],
  );
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([]);
  const [monthlyPayrolls, setMonthlyPayrolls] = useState<MonthlyPayroll[]>([]);
  const [payrollSubTab, setPayrollSubTab] = useState<
    "salary" | "runs" | "payslips" | "monthly"
  >("salary");

  // Payroll modals
  const [showSalaryForm, setShowSalaryForm] = useState(false);
  const [showComprehensiveSalaryForm, setShowComprehensiveSalaryForm] =
    useState(false);
  const [showPayrollRunForm, setShowPayrollRunForm] = useState(false);
  const [selectedSalaryComponent, setSelectedSalaryComponent] =
    useState<SalaryComponent | null>(null);
  const [showMonthlyPayrollForm, setShowMonthlyPayrollForm] = useState(false);
  const [selectedMonthlyPayroll, setSelectedMonthlyPayroll] =
    useState<MonthlyPayroll | null>(null);
  const [showKPICalculator, setShowKPICalculator] = useState(false);
  const [kpiMetrics, setKpiMetrics] = useState<KPIMetrics | null>(null);
  const [kpiReviewMonth, setKpiReviewMonth] = useState(
    new Date().toISOString().substring(0, 7),
  );
  const [manualKPIs, setManualKPIs] = useState({
    quality_of_work: 0,
    productivity_score: 0,
    teamwork_rating: 0,
    customer_satisfaction: 0,
    project_completion_rate: 0,
    initiative_innovation: 0,
    manual_notes: "",
  });

  // Employee modals
  const [showEmployeeForm, setShowEmployeeForm] = useState(false);
  const [showEmployeeDetails, setShowEmployeeDetails] = useState(false);
  const [showEditEmployee, setShowEditEmployee] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(
    null,
  );

  // Attendance modals
  const [showAttendanceDetails, setShowAttendanceDetails] = useState(false);
  const [showEditAttendance, setShowEditAttendance] = useState(false);
  const [selectedAttendance, setSelectedAttendance] =
    useState<AttendanceRecord | null>(null);

  const [showAttendanceImport, setShowAttendanceImport] = useState(false);
  const [attendanceImportText, setAttendanceImportText] = useState("");
  const [attendanceImportResult, setAttendanceImportResult] = useState("");

  // Leave modals
  const [showLeaveDetails, setShowLeaveDetails] = useState(false);
  const [showEditLeave, setShowEditLeave] = useState(false);
  const [selectedLeave, setSelectedLeave] = useState<LeaveRequest | null>(null);
  const [showHolidayForm, setShowHolidayForm] = useState(false);
  const [selectedHoliday, setSelectedHoliday] = useState<Holiday | null>(null);
  const [holidayYear, setHolidayYear] = useState(
    String(new Date().getFullYear()),
  );

  // Loading and error states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Employee form
  const [employeeForm, setEmployeeForm] = useState({
    employee_code: "",
    employee_name: "",
    designation: "",
    department: "",
    date_of_joining: getTodayDateInputValue(),
    date_of_birth: "",
    contact_number: "",
    email: "",
    address: "",
    biometric_id: "",
    per_diem_amount: "",
  });

  const [employeeDocuments, setEmployeeDocuments] = useState<
    EmployeeDocument[]
  >([]);
  const [meritsDemerits, setMeritsDemerits] = useState<MeritDemerit[]>([]);

  const [documentForm, setDocumentForm] = useState({
    doc_type: "",
    file_url: "",
    file_name: "",
    file_type: "",
    file_size: 0,
    notes: "",
  });

  const [meritDemeritForm, setMeritDemeritForm] = useState({
    record_type: "MERIT",
    type_id: "",
    title: "",
    description: "",
    points: "",
    evidence_reference: "",
    event_date: getTodayDateInputValue(),
  });

  // Master Config State
  const [kpiDefinitions, setKpiDefinitions] = useState<any[]>([]);
  const [meritDemeritTypes, setMeritDemeritTypes] = useState<any[]>([]);
  const [showKpiForm, setShowKpiForm] = useState(false);
  const [showMeritTypeForm, setShowMeritTypeForm] = useState(false);
  const [editingKpi, setEditingKpi] = useState<any>(null);
  const [editingMeritType, setEditingMeritType] = useState<any>(null);
  const [kpiForm, setKpiForm] = useState({
    kpi_name: "",
    kpi_category: "ATTENDANCE",
    description: "",
    measurement_type: "PERCENTAGE",
    min_value: 0,
    max_value: 100,
    threshold_excellent: 90,
    threshold_good: 75,
    threshold_acceptable: 60,
    auto_calculate: false,
    is_active: true,
  });
  const [meritTypeForm, setMeritTypeForm] = useState({
    type_name: "",
    record_type: "MERIT",
    category: "ATTENDANCE",
    description: "",
    default_points: 10,
    severity: "",
    requires_approval: false,
    is_active: true,
  });

  // Attendance form
  const [showAttendanceForm, setShowAttendanceForm] = useState(false);
  const [attendanceEmployeeOptions, setAttendanceEmployeeOptions] = useState<
    Employee[]
  >([]);
  const [
    attendanceEmployeeOptionsLoading,
    setAttendanceEmployeeOptionsLoading,
  ] = useState(false);
  const [attendanceFromDate, setAttendanceFromDate] = useState(
    `${serverSafeTodayDate.slice(0, 8)}01`,
  );
  const [attendanceToDate, setAttendanceToDate] = useState(serverSafeTodayDate);
  const [attendanceEmployeeFilter, setAttendanceEmployeeFilter] =
    useState("ALL");
  const [attendanceForm, setAttendanceForm] = useState({
    employee_id: "",
    attendance_date: getTodayDateInputValue(),
    check_in_time: "",
    check_out_time: "",
    status: "PRESENT",
    remarks: "",
    is_outstation_travel: false,
    travel_departure_time: "",
    travel_arrival_time: "",
    travel_notes: "",
  });

  const buildAttendanceQuery = (employeeId?: string) => {
    const params = new URLSearchParams();
    if (attendanceFromDate) params.set("fromDate", attendanceFromDate);
    if (attendanceToDate) params.set("toDate", attendanceToDate);
    const selectedEmployeeId = employeeId || attendanceEmployeeFilter;
    if (selectedEmployeeId && selectedEmployeeId !== "ALL") {
      params.set("employeeId", selectedEmployeeId);
    }
    return params.toString();
  };

  const handleExportAttendance = () => {
    if (attendance.length === 0) {
      alert("No attendance records available for the selected report range.");
      return;
    }

    const formatDateTime = (value?: string) => {
      if (!value) return "";
      const date = new Date(value);
      return Number.isNaN(date.getTime())
        ? value
        : date.toLocaleString("en-IN");
    };
    const formatAttendanceDay = (value?: string) => {
      const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return "";
      const date = new Date(
        Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
      );
      return date.toLocaleDateString("en-IN", {
        weekday: "long",
        timeZone: "UTC",
      });
    };
    const escapeCsv = (value: unknown) =>
      `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = [
      [
        "Employee",
        "Employee Code",
        "Email",
        "Date",
        "Day",
        "Check In",
        "Check In Location",
        "Check Out",
        "Check Out Location",
        "Hours",
        "Pay Days",
        "Travel Day",
        "Travel Departure",
        "Office Return",
        "Per Diem Rate",
        "Per Diem Amount",
        "Status",
        "Outside Zone",
        "Travel Notes",
        "Outside-zone Reason",
        "Check-in Notes",
        "Check-out Notes",
      ],
      ...attendance.map((record) => [
        record.employee_name || "",
        record.employee_code || "",
        record.employee_email || "",
        record.attendance_date
          ? new Date(record.attendance_date).toLocaleDateString("en-IN")
          : "",
        formatAttendanceDay(record.attendance_date),
        formatDateTime(record.check_in_time),
        record.check_in_location || "",
        formatDateTime(record.check_out_time),
        record.check_out_location || "",
        record.work_hours ?? "",
        getAttendancePayDayCredit(record),
        isTravelPerDiemDay(record) ? "Yes" : "No",
        formatTimeOnly(record.travel_departure_time),
        formatTimeOnly(record.travel_arrival_time),
        getEmployeePerDiemAmount(record.employee_id),
        getAttendanceTravelPerDiemAmount(record),
        record.status || "",
        record.is_outside_zone ? "Yes" : "No",
        record.travel_notes || "",
        record.outside_zone_reason || "",
        record.check_in_notes || "",
        record.check_out_notes || "",
      ]),
    ];

    const csv = `\uFEFF${rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `attendance-report-${attendanceFromDate || "from"}-to-${attendanceToDate || "to"}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    const loadAttendanceEmployees = async () => {
      if (!showAttendanceForm || isEmployeePortal) return;

      const seededEmployees = employees.filter(
        (employee) => normalizeStatus(employee.status) !== "INACTIVE",
      );
      if (seededEmployees.length > 0) {
        setAttendanceEmployeeOptions(seededEmployees);
      }

      setAttendanceEmployeeOptionsLoading(true);
      try {
        const data = await apiClient.get<any>("/hr/employees");
        const list: Employee[] = Array.isArray(data) ? data : data?.data || [];
        const activeList = list
          .filter((employee) => normalizeStatus(employee.status) !== "INACTIVE")
          .sort((a, b) =>
            String(a.employee_name || "").localeCompare(
              String(b.employee_name || ""),
            ),
          );
        setAttendanceEmployeeOptions(activeList);
        if (
          attendanceForm.employee_id &&
          !activeList.some(
            (employee) => employee.id === attendanceForm.employee_id,
          )
        ) {
          setAttendanceForm((prev) => ({ ...prev, employee_id: "" }));
        }
      } catch {
        setAttendanceEmployeeOptions(seededEmployees);
      } finally {
        setAttendanceEmployeeOptionsLoading(false);
      }
    };

    loadAttendanceEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAttendanceForm, isEmployeePortal]);

  // Leave form
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [leaveEmployeeOptions, setLeaveEmployeeOptions] = useState<Employee[]>(
    [],
  );
  const [leaveEmployeeOptionsLoading, setLeaveEmployeeOptionsLoading] =
    useState(false);
  const defaultLeaveDate = getNextLeaveDateInputValue();
  const [leaveForm, setLeaveForm] = useState({
    employee_id: "",
    leave_type: "CASUAL",
    start_date: defaultLeaveDate,
    end_date: defaultLeaveDate,
    total_days: 1,
    reason: "",
  });

  const [holidayForm, setHolidayForm] = useState({
    holiday_name: "",
    start_date: getTodayDateInputValue(),
    end_date: "",
    holiday_type: "PUBLIC",
    notes: "",
  });

  useEffect(() => {
    if (!showLeaveForm) return;
    if (!isEmployeePortal) return;
    if (!myEmployee?.id) return;
    setLeaveForm((prev) => ({
      ...prev,
      employee_id: myEmployee.id,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLeaveForm, isEmployeePortal, myEmployee?.id]);

  useEffect(() => {
    const loadLeaveEmployees = async () => {
      if (!showLeaveForm || isEmployeePortal) return;

      const seededEmployees = employees.filter(
        (employee) => normalizeStatus(employee.status) !== "INACTIVE",
      );
      if (seededEmployees.length > 0) {
        setLeaveEmployeeOptions(seededEmployees);
      }

      setLeaveEmployeeOptionsLoading(true);
      try {
        const data = await apiClient.get<any>("/hr/employees");
        const list: Employee[] = Array.isArray(data) ? data : data?.data || [];
        const activeList = list
          .filter((employee) => normalizeStatus(employee.status) !== "INACTIVE")
          .sort((a, b) =>
            String(a.employee_name || "").localeCompare(
              String(b.employee_name || ""),
            ),
          );
        setLeaveEmployeeOptions(activeList);
        if (
          leaveForm.employee_id &&
          !activeList.some((employee) => employee.id === leaveForm.employee_id)
        ) {
          setLeaveForm((prev) => ({ ...prev, employee_id: "" }));
        }
      } catch {
        setLeaveEmployeeOptions(seededEmployees);
      } finally {
        setLeaveEmployeeOptionsLoading(false);
      }
    };

    loadLeaveEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLeaveForm, isEmployeePortal]);

  // Payroll forms
  const [salaryForm, setSalaryForm] = useState({
    employee_id: "",
    component_type: "BASIC",
    component_name: "",
    amount: 0,
    is_taxable: true,
  });

  const [comprehensiveSalaryForm, setComprehensiveSalaryForm] =
    useState<ComprehensiveSalaryForm>({
      employee_id: "",
      basic_salary: 0,
      hra: 0,
      medical_allowance: 0,
      travelling_allowance: 0,
      special_allowance: 0,
      pf_deduction: 0,
      esi_deduction: 0,
      professional_tax: 200,
      other_allowances: [],
      other_deductions: [],
    });

  // Auto-calculate deductions when basic salary changes
  const handleBasicSalaryChange = (basicSalary: number) => {
    const hra = Math.round(basicSalary * 0.4); // 40% HRA
    const grossEstimate =
      basicSalary +
      hra +
      comprehensiveSalaryForm.medical_allowance +
      comprehensiveSalaryForm.travelling_allowance +
      comprehensiveSalaryForm.special_allowance;

    const deductions = calculateStatutoryDeductions(basicSalary, grossEstimate);

    setComprehensiveSalaryForm((prev) => ({
      ...prev,
      basic_salary: basicSalary,
      hra: hra,
      pf_deduction: deductions.pf,
      esi_deduction: deductions.esi,
      professional_tax: deductions.pt,
    }));
  };

  const [payrollRunForm, setPayrollRunForm] = useState({
    payroll_month: new Date().toISOString().substring(0, 7),
    remarks: "",
  });

  const [monthlyPayrollForm, setMonthlyPayrollForm] = useState({
    employee_id: "",
    payroll_month: new Date().toISOString().substring(0, 7),
    days_in_month: new Date(
      new Date().getFullYear(),
      new Date().getMonth() + 1,
      0,
    ).getDate(),
    days_travelled: 0,
    comp_offs: 0,
    leaves_absent: 0,
    approved_paid_leaves: 0,
    paid_for_total_days: 0,
    bonus_monthly: 0,
    production_incentive: 0,
    bonus_hold: 0,
    production_incentive_hold: 0,
    special_allowance: 0,
    professional_tax: 200,
  });

  // Close modals on Escape key
  useEscapeKey(showEmployeeForm, () => setShowEmployeeForm(false));
  useEscapeKey(showEmployeeDetails, () => setShowEmployeeDetails(false));
  useEscapeKey(showEditEmployee, () => setShowEditEmployee(false));
  useEscapeKey(showAttendanceDetails, () => setShowAttendanceDetails(false));
  useEscapeKey(showEditAttendance, () => setShowEditAttendance(false));
  useEscapeKey(showAttendanceImport, () => setShowAttendanceImport(false));
  useEscapeKey(showLeaveDetails, () => setShowLeaveDetails(false));
  useEscapeKey(showEditLeave, () => setShowEditLeave(false));
  useEscapeKey(showHolidayForm, () => setShowHolidayForm(false));
  useEscapeKey(showSalaryForm, () => setShowSalaryForm(false));
  useEscapeKey(showComprehensiveSalaryForm, () =>
    setShowComprehensiveSalaryForm(false),
  );
  useEscapeKey(showPayrollRunForm, () => setShowPayrollRunForm(false));
  useEscapeKey(showMonthlyPayrollForm, () => setShowMonthlyPayrollForm(false));
  useEscapeKey(showKPICalculator, () => setShowKPICalculator(false));
  useEscapeKey(showAttendanceForm, () => setShowAttendanceForm(false));
  useEscapeKey(showLeaveForm, () => setShowLeaveForm(false));

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setCurrentUser(readStoredUser() as StoredUser | null);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const pathSection = pathname.includes("/dashboard/hr/employees")
      ? "employees"
      : pathname.includes("/dashboard/hr/management")
        ? "management"
        : null;
    const sectionParam = (searchParams.get("section") || "").toLowerCase();
    const sectionFromUrl =
      sectionParam === "management" || sectionParam === "admin"
        ? "management"
        : sectionParam === "employees" || sectionParam === "employee"
          ? "employees"
          : pathSection;

    if (sectionFromUrl && sectionFromUrl !== activeSection) {
      setActiveSection(sectionFromUrl);
    }

    if (!sectionFromUrl) {
      // No explicit section in URL: default to the punch-first employee workspace.
      // Management users can still switch to HR Management from the tabs/sidebar.
      const defaultSection = "employees";
      if (defaultSection !== activeSection) {
        setActiveSection(defaultSection);
      }
    }

    // Employee portal doesn't support config
    if (
      (sectionFromUrl === "employees" || !sectionFromUrl) &&
      activeTab === "config"
    ) {
      setActiveTab("attendance");
    }

    // Employee self-service is a punch-first workspace. If the employee route is
    // opened without an explicit tab, normalize it to Check In / Attendance so
    // mobile/PWA users land on the correct first screen every time.
    if (
      (sectionFromUrl === "employees" || !sectionFromUrl) &&
      !searchParams.get("tab")
    ) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("section", "employees");
      params.set("tab", "attendance");
      setActiveTab("attendance");
      router.replace(`/dashboard/hr/employees?${params.toString()}`, {
        scroll: false,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, pathname, canManage]);

  useEffect(() => {
    if (!isEmployeePortal) return;
    if (activeTab !== "payroll") return;
    if (payrollSubTab !== "payslips" && payrollSubTab !== "monthly") {
      setPayrollSubTab("payslips");
    }
  }, [isEmployeePortal, activeTab, payrollSubTab]);

  // Fetch today's attendance when on attendance tab
  useEffect(() => {
    if (activeTab === "attendance") {
      fetchTodayAttendance();
    }
  }, [activeTab]);

  useEffect(() => {
    const token =
      typeof window === "undefined"
        ? null
        : localStorage.getItem("accessToken");
    if (!token) {
      router.push("/login");
      return;
    }

    fetchData();
    if (activeSection === "management" && activeTab === "config") {
      fetchMasterConfig();
    }
  }, [
    activeSection,
    activeTab,
    payrollSubTab,
    holidayYear,
    attendanceFromDate,
    attendanceToDate,
    attendanceEmployeeFilter,
  ]);

  useEffect(() => {
    const token =
      typeof window === "undefined"
        ? null
        : localStorage.getItem("accessToken");
    if (!token) return;
    fetchHrCommandCenter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, currentUser?.id, holidayYear]);

  const fetchHrCommandCenter = async () => {
    try {
      setHrCommandLoading(true);
      const currentMonth = new Date().toISOString().slice(0, 7);
      const currentYear = String(new Date().getFullYear());

      const [
        employeeRes,
        attendanceRes,
        leaveRes,
        holidayRes,
        monthlyPayrollRes,
      ] = await Promise.all([
        apiClient.get<any>("/hr/employees").catch(() => []),
        apiClient
          .get<any>(`/hr/attendance?month=${encodeURIComponent(currentMonth)}`)
          .catch(() => []),
        apiClient.get<any>("/hr/leaves").catch(() => []),
        apiClient
          .get<any>(`/hr/holidays?year=${encodeURIComponent(currentYear)}`)
          .catch(() => []),
        apiClient
          .get<any>(
            `/hr/payroll/monthly?month=${encodeURIComponent(currentMonth)}`,
          )
          .catch(() => []),
      ]);

      const employeeList: Employee[] = Array.isArray(employeeRes)
        ? employeeRes
        : employeeRes?.data || [];
      const attendanceList: AttendanceRecord[] = Array.isArray(attendanceRes)
        ? attendanceRes
        : attendanceRes?.data || [];
      const leaveList: LeaveRequest[] = Array.isArray(leaveRes)
        ? leaveRes
        : leaveRes?.data || [];
      const holidayList: Holiday[] = Array.isArray(holidayRes)
        ? holidayRes
        : holidayRes?.data || [];
      const monthlyPayrollList: MonthlyPayroll[] = Array.isArray(
        monthlyPayrollRes,
      )
        ? monthlyPayrollRes
        : monthlyPayrollRes?.data || [];

      const today = getTodayDateInputValue();
      const todayAttendance = attendanceList.filter(
        (row: any) => String(row?.attendance_date || "").slice(0, 10) === today,
      );
      const upcomingHoliday = holidayList
        .filter(
          (holiday) => String(holiday.start_date || "").slice(0, 10) >= today,
        )
        .sort((a, b) =>
          String(a.start_date).localeCompare(String(b.start_date)),
        )[0];

      setHrCommandStats({
        activeEmployees: employeeList.filter(
          (employee) => normalizeStatus(employee.status) !== "INACTIVE",
        ).length,
        inactiveEmployees: employeeList.filter(
          (employee) => normalizeStatus(employee.status) === "INACTIVE",
        ).length,
        presentToday: todayAttendance.filter((row) =>
          ["PRESENT", "LATE", "HALF_DAY", "WORK_FROM_HOME"].includes(
            normalizeStatus(row.status),
          ),
        ).length,
        lateToday: todayAttendance.filter(
          (row) => normalizeStatus(row.status) === "LATE",
        ).length,
        absentToday: todayAttendance.filter((row) =>
          ["ABSENT", "LEAVE"].includes(normalizeStatus(row.status)),
        ).length,
        pendingLeaves: leaveList.filter((leave) =>
          isPendingLeaveStatus(leave.status),
        ).length,
        approvedLeaves: leaveList.filter(
          (leave) => normalizeStatus(leave.status) === "APPROVED",
        ).length,
        pendingPayrolls: monthlyPayrollList.filter(
          (payroll) => normalizeStatus(payroll.status) === "DRAFT",
        ).length,
        processedPayrolls: monthlyPayrollList.filter((payroll) =>
          ["PROCESSED", "PAID"].includes(normalizeStatus(payroll.status)),
        ).length,
        holidayCount: holidayList.length,
        nextHolidayName: upcomingHoliday?.holiday_name || "-",
        nextHolidayDate: upcomingHoliday?.start_date || "",
        documentsExpiring: 0,
        lastUpdated: new Date().toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      });
    } finally {
      setHrCommandLoading(false);
    }
  };

  const fetchMasterConfig = async () => {
    try {
      const [kpis, types] = await Promise.all([
        apiClient.get("/hr/kpi-definitions"),
        apiClient.get("/hr/merit-demerit-types"),
      ]);
      setKpiDefinitions(Array.isArray(kpis) ? kpis : kpis?.data || []);
      setMeritDemeritTypes(Array.isArray(types) ? types : types?.data || []);
    } catch (error) {}
  };

  useEffect(() => {
    const loadEmployeeExtras = async () => {
      if (!showEmployeeDetails || !selectedEmployee?.id) return;

      const token =
        typeof window === "undefined"
          ? null
          : localStorage.getItem("accessToken");
      if (!token) {
        router.push("/login");
        return;
      }

      try {
        const [docs, md] = await Promise.all([
          apiClient.get<any>(`/hr/employees/${selectedEmployee.id}/documents`),
          apiClient.get<any>(
            `/hr/employees/${selectedEmployee.id}/merits-demerits`,
          ),
        ]);

        setEmployeeDocuments(Array.isArray(docs) ? docs : docs.data || []);
        setMeritsDemerits(Array.isArray(md) ? md : md.data || []);
      } catch (e) {
        setEmployeeDocuments([]);
        setMeritsDemerits([]);
      }
    };

    loadEmployeeExtras();
  }, [showEmployeeDetails, selectedEmployee?.id]);

  const fetchData = async () => {
    try {
      const token =
        typeof window === "undefined"
          ? null
          : localStorage.getItem("accessToken");
      if (!token) {
        router.push("/login");
        return;
      }

      if (activeSection === "employees") {
        const resolveMyEmployee = async (): Promise<Employee | null> => {
          if (myEmployee?.id) return myEmployee;

          const userId = normalizeText(currentUser?.id);
          const email = normalizeText(currentUser?.email);
          if (!userId && !email) {
            setError("User profile not loaded. Please re-login.");
            return null;
          }

          const empData = await apiClient.get<any>("/hr/employees");
          const allEmployees: Employee[] = Array.isArray(empData)
            ? empData
            : empData.data || [];
          const match =
            allEmployees.find((emp) => normalizeText(emp.user_id) === userId) ||
            allEmployees.find((emp) => normalizeText(emp.email) === email) ||
            null;

          if (!match) {
            setMyEmployee(null);
            setEmployees([]);
            setError(
              "No employee record found for this login. Ask HR to link your account to your employee profile.",
            );
            return null;
          }

          setMyEmployee(match);
          setEmployees([match]);
          setError("");
          return match;
        };

        const employee = await resolveMyEmployee();
        if (!employee) return;

        // Self-service: fetch only current employee data
        if (activeTab === "employees") {
          try {
            const [docs, md] = await Promise.all([
              apiClient.get<any>(`/hr/employees/${employee.id}/documents`),
              apiClient.get<any>(
                `/hr/employees/${employee.id}/merits-demerits`,
              ),
            ]);
            setEmployeeDocuments(Array.isArray(docs) ? docs : docs.data || []);
            setMeritsDemerits(Array.isArray(md) ? md : md.data || []);
          } catch {
            setEmployeeDocuments([]);
            setMeritsDemerits([]);
          }
          return;
        }

        if (activeTab === "attendance") {
          const query = buildAttendanceQuery(employee.id);
          const attData = await apiClient.get<any>(`/hr/attendance?${query}`);
          const records = Array.isArray(attData) ? attData : attData.data || [];
          setAttendance(
            records.map((record: any) => ({
              ...record,
              employee_name: employee.employee_name,
              employee_code: employee.employee_code,
              employee_email: employee.email,
            })),
          );
          return;
        }

        if (activeTab === "leaves") {
          const leaveData = await apiClient.get<any>(
            `/hr/leaves?employeeId=${employee.id}`,
          );
          const records = Array.isArray(leaveData)
            ? leaveData
            : leaveData.data || [];
          setLeaves(
            records.map((leave: any) => ({
              ...leave,
              employee_name: employee.employee_name,
            })),
          );
          return;
        }

        if (activeTab === "holidays") {
          const holidayData = await apiClient.get<any>(
            `/hr/holidays?year=${encodeURIComponent(holidayYear)}`,
          );
          setHolidays(
            Array.isArray(holidayData) ? holidayData : holidayData.data || [],
          );
          return;
        }

        if (activeTab === "payroll") {
          if (payrollSubTab === "payslips") {
            const slipsData = await apiClient.get<any>("/hr/payroll/payslips");
            const slips = Array.isArray(slipsData)
              ? slipsData
              : slipsData.data || [];
            const mySlips = slips
              .filter((slip: any) => slip.employee_id === employee.id)
              .map((slip: any) => ({
                ...slip,
                employee_name: employee.employee_name,
              }));
            setPayslips(mySlips);
            return;
          }

          if (payrollSubTab === "monthly") {
            const monthlyData = await apiClient.get<any>("/hr/payroll/monthly");
            const records = Array.isArray(monthlyData)
              ? monthlyData
              : monthlyData.data || [];
            const myRecords = records
              .filter((rec: any) => rec.employee_id === employee.id)
              .map((rec: any) => ({
                ...rec,
                employee_name: employee.employee_name,
              }));
            setMonthlyPayrolls(myRecords);
            return;
          }

          // Other payroll sub-tabs are not available in employee portal
          setPayrollSubTab("payslips");
          return;
        }

        return;
      }

      if (activeTab === "employees") {
        const data = await apiClient.get<any>("/hr/employees");
        setEmployees(Array.isArray(data) ? data : data.data || []);
      } else if (activeTab === "attendance") {
        const empData = await apiClient.get<any>("/hr/employees");
        const allEmployees: Employee[] = Array.isArray(empData)
          ? empData
          : empData.data || [];
        setEmployees(allEmployees);
        const employeeById = new Map(
          allEmployees.map((employee) => [employee.id, employee]),
        );
        const query = buildAttendanceQuery();
        const attData = await apiClient.get<any>(`/hr/attendance?${query}`);
        const records = Array.isArray(attData) ? attData : attData.data || [];
        setAttendance(
          records.map((record: any) => {
            const employee = employeeById.get(record.employee_id);
            return {
              ...record,
              employee_name:
                record.employee_name || employee?.employee_name || "-",
              employee_code:
                record.employee_code || employee?.employee_code || "",
              employee_email: record.employee_email || employee?.email || "",
            };
          }),
        );
      } else if (activeTab === "leaves") {
        const empData = await apiClient.get<any>("/hr/employees");
        const allEmployees = Array.isArray(empData)
          ? empData
          : empData.data || [];

        const leavePromises = allEmployees.map(async (emp: Employee) => {
          try {
            const leaveData = await apiClient.get<any>(
              `/hr/leaves?employeeId=${emp.id}`,
            );
            const records = Array.isArray(leaveData)
              ? leaveData
              : leaveData.data || [];
            return records.map((leave: any) => ({
              ...leave,
              employee_name: emp.employee_name,
            }));
          } catch {
            return [];
          }
        });

        const allLeaves = await Promise.all(leavePromises);
        setLeaves(allLeaves.flat());
      } else if (activeTab === "holidays") {
        const holidayData = await apiClient.get<any>(
          `/hr/holidays?year=${encodeURIComponent(holidayYear)}`,
        );
        setHolidays(
          Array.isArray(holidayData) ? holidayData : holidayData.data || [],
        );
      } else if (activeTab === "payroll") {
        const empData = await apiClient.get<any>("/hr/employees");
        const allEmployees = Array.isArray(empData)
          ? empData
          : empData.data || [];

        if (payrollSubTab === "salary") {
          const salaryPromises = allEmployees.map(async (emp: Employee) => {
            try {
              const salData = await apiClient.get<any>(`/hr/salary/${emp.id}`);
              const records = Array.isArray(salData)
                ? salData
                : salData.data || [];
              return records.map((comp: any) => ({
                ...comp,
                employee_name: emp.employee_name,
              }));
            } catch {
              return [];
            }
          });
          const allSalary = await Promise.all(salaryPromises);
          setSalaryComponents(allSalary.flat());
        } else if (payrollSubTab === "runs") {
          const runsData = await apiClient.get<any>("/hr/payroll/runs");
          setPayrollRuns(
            Array.isArray(runsData) ? runsData : runsData.data || [],
          );
        } else if (payrollSubTab === "payslips") {
          const slipsData = await apiClient.get<any>("/hr/payroll/payslips");
          const slips = Array.isArray(slipsData)
            ? slipsData
            : slipsData.data || [];
          const slipsWithNames = slips.map((slip: any) => {
            const emp = allEmployees.find(
              (e: Employee) => e.id === slip.employee_id,
            );
            return { ...slip, employee_name: emp?.employee_name || "Unknown" };
          });
          setPayslips(slipsWithNames);
        } else if (payrollSubTab === "monthly") {
          const monthlyData = await apiClient.get<any>("/hr/payroll/monthly");
          const records = Array.isArray(monthlyData)
            ? monthlyData
            : monthlyData.data || [];
          const recordsWithNames = records.map((rec: any) => {
            const emp = allEmployees.find(
              (e: Employee) => e.id === rec.employee_id,
            );
            return { ...rec, employee_name: emp?.employee_name || "Unknown" };
          });
          setMonthlyPayrolls(recordsWithNames);
        }
      }
    } catch (error) {
      const msg = (error as any)?.message || String(error);
      if (msg.includes("401") || msg.toLowerCase().includes("unauthorized")) {
        try {
          localStorage.removeItem("accessToken");
          localStorage.removeItem("refreshToken");
        } catch {}
        router.push("/login");
      }
    }
  };

  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreateHR) {
      alert("You do not have permission to create employees");
      return;
    }
    try {
      await apiClient.post("/hr/employees", employeeForm);
      setShowEmployeeForm(false);
      setEmployeeForm({
        employee_code: "",
        employee_name: "",
        designation: "",
        department: "",
        date_of_joining: getTodayDateInputValue(),
        date_of_birth: "",
        contact_number: "",
        email: "",
        address: "",
        biometric_id: "",
        per_diem_amount: "",
      });
      fetchData();
      alert("Employee created successfully");
    } catch (error) {
      alert("Failed to create employee");
    }
  };

  const handleRecordAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreateHR) {
      alert("You do not have permission to record attendance");
      return;
    }
    try {
      await apiClient.post("/hr/attendance", attendanceForm);
      setShowAttendanceForm(false);
      setAttendanceForm({
        employee_id: "",
        attendance_date: getTodayDateInputValue(),
        check_in_time: "",
        check_out_time: "",
        status: "PRESENT",
        remarks: "",
        is_outstation_travel: false,
        travel_departure_time: "",
        travel_arrival_time: "",
        travel_notes: "",
      });
      fetchData();
      alert("Attendance recorded successfully");
    } catch (error) {
      alert("Failed to record attendance");
    }
  };

  const handleApplyLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEmployeePortal && !canCreateHR) {
      alert("You do not have permission to create leave requests");
      return;
    }
    try {
      const today = parseDateInputLocal(getTodayDateInputValue());
      const start = parseDateInputLocal(leaveForm.start_date);
      const end = parseDateInputLocal(leaveForm.end_date);
      if (!start || !end) {
        alert("Please select valid leave dates.");
        return;
      }
      if (today && start.getTime() <= today.getTime()) {
        alert("Same-day leave is not allowed. Please select a future date.");
        return;
      }
      if (end.getTime() < start.getTime()) {
        alert("End date cannot be before start date.");
        return;
      }
      const totalDays = countLeaveDaysExcludingSundays(
        leaveForm.start_date,
        leaveForm.end_date,
      );
      if (totalDays <= 0) {
        alert(
          "Selected date range contains only Sunday(s). Sunday is a paid weekly off and does not require leave.",
        );
        return;
      }
      const payload = {
        ...leaveForm,
        leave_type: "CASUAL",
        total_days: totalDays,
        employee_id: isEmployeePortal
          ? myEmployee?.id || leaveForm.employee_id
          : leaveForm.employee_id,
      };
      if (!payload.employee_id) {
        alert("Employee profile is not linked. Please contact HR/admin.");
        return;
      }
      await apiClient.post("/hr/leaves", payload);
      setShowLeaveForm(false);
      const resetLeaveDate = getNextLeaveDateInputValue();
      setLeaveForm({
        employee_id: "",
        leave_type: "CASUAL",
        start_date: resetLeaveDate,
        end_date: resetLeaveDate,
        total_days: 1,
        reason: "",
      });
      fetchData();
      alert("Leave request submitted successfully");
    } catch (error: any) {
      alert(error?.message || "Failed to submit leave request");
    }
  };

  const handleApproveLeave = async (leaveId: string) => {
    if (!canApproveHR) {
      alert("You do not have permission to approve leave requests");
      return;
    }
    try {
      const userId = getCurrentUserId();
      await apiClient.put(`/hr/leaves/${leaveId}/approve`, {
        approverId: userId,
      });
      fetchData();
      alert("Leave approved successfully");
    } catch (error) {
      alert("Failed to approve leave");
    }
  };

  const handleRejectLeave = async (leaveId: string) => {
    if (!canApproveHR) {
      alert("You do not have permission to reject leave requests");
      return;
    }
    try {
      const userId = getCurrentUserId();
      await apiClient.put(`/hr/leaves/${leaveId}/reject`, {
        approverId: userId,
      });
      fetchData();
      alert("Leave rejected successfully");
    } catch (error) {
      alert("Failed to reject leave");
    }
  };

  const resetHolidayForm = () => {
    setHolidayForm({
      holiday_name: "",
      start_date: getTodayDateInputValue(),
      end_date: "",
      holiday_type: "PUBLIC",
      notes: "",
    });
    setSelectedHoliday(null);
  };

  const openHolidayForm = (holiday?: Holiday | null) => {
    if (holiday) {
      setSelectedHoliday(holiday);
      setHolidayForm({
        holiday_name: holiday.holiday_name,
        start_date: holiday.start_date,
        end_date: holiday.end_date || "",
        holiday_type: holiday.holiday_type || "PUBLIC",
        notes: holiday.notes || "",
      });
    } else {
      resetHolidayForm();
    }

    setShowHolidayForm(true);
  };

  const handleSaveHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedHoliday ? !canEditHR : !canCreateHR) {
      alert(
        `You do not have permission to ${selectedHoliday ? "edit" : "create"} holidays`,
      );
      return;
    }

    setLoading(true);
    try {
      const payload = {
        ...holidayForm,
        end_date: holidayForm.end_date || null,
      };

      if (selectedHoliday?.id) {
        await apiClient.put(`/hr/holidays/${selectedHoliday.id}`, payload);
        alert("Holiday updated successfully");
      } else {
        await apiClient.post("/hr/holidays", payload);
        alert("Holiday added successfully");
      }

      setShowHolidayForm(false);
      resetHolidayForm();
      fetchData();
    } catch (error: any) {
      alert(error?.message || "Failed to save holiday");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteHoliday = async (holiday: Holiday) => {
    if (!canDeleteHR) {
      alert("You do not have permission to delete holidays");
      return;
    }

    const confirmed = await confirmDialog({
      title: "Delete Holiday",
      message: `Delete holiday ${holiday.holiday_name}?`,
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!confirmed) return;

    try {
      await apiClient.delete(`/hr/holidays/${holiday.id}`);
      fetchData();
      alert("Holiday deleted successfully");
    } catch (error: any) {
      alert(error?.message || "Failed to delete holiday");
    }
  };

  const handleCreateSalaryComponent = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    if (!canCreateHR) {
      alert("You do not have permission to create salary components");
      setLoading(false);
      return;
    }
    try {
      await apiClient.post("/hr/salary", salaryForm);
      setShowSalaryForm(false);
      setSalaryForm({
        employee_id: "",
        component_type: "BASIC",
        component_name: "",
        amount: 0,
        is_taxable: true,
      });
      fetchData();
      alert("Salary component added successfully");
    } catch (error) {
      alert("Failed to add salary component");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSalaryComponent = async (id: string) => {
    if (!canDeleteHR) {
      alert("You do not have permission to delete salary components");
      return;
    }
    const confirmed = await confirmDialog({
      title: "Delete Salary Component",
      message: "Are you sure you want to delete this salary component?",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!confirmed) return;
    try {
      await apiClient.delete(`/hr/salary/${id}`);
      fetchData();
      alert("Salary component deleted successfully");
    } catch (error) {
      alert("Failed to delete salary component");
    }
  };

  const handleCreatePayrollRun = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    if (!canCreateHR) {
      alert("You do not have permission to create payroll runs");
      setLoading(false);
      return;
    }
    try {
      await apiClient.post("/hr/payroll/run", payrollRunForm);
      setShowPayrollRunForm(false);
      setPayrollRunForm({
        payroll_month: new Date().toISOString().substring(0, 7),
        remarks: "",
      });
      fetchData();
      alert("Payroll run created successfully");
    } catch (error) {
      alert("Failed to create payroll run");
    } finally {
      setLoading(false);
    }
  };

  const handleGeneratePayslips = async (runId: string) => {
    if (!canApproveHR) {
      alert("You do not have permission to generate payslips");
      return;
    }
    const confirmed = await confirmDialog({
      title: "Generate Payslips",
      message: "Generate payslips for this payroll run?",
      confirmLabel: "Generate",
      variant: "warning",
    });
    if (!confirmed) return;
    setLoading(true);
    try {
      await apiClient.post(`/hr/payroll/run/${runId}/generate`);
      fetchData();
      alert("Payslips generated successfully");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      alert(`Failed to generate payslips${message ? `: ${message}` : ""}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveMonthlyPayroll = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    if (selectedMonthlyPayroll?.id ? !canEditHR : !canCreateHR) {
      alert(
        `You do not have permission to ${selectedMonthlyPayroll?.id ? "edit" : "create"} monthly payroll`,
      );
      setLoading(false);
      return;
    }
    try {
      // Calculate gross, net, and amount paid per salary slip format
      const empRes = await apiClient.get<any>(
        `/hr/salary/${monthlyPayrollForm.employee_id}`,
      );
      const components = Array.isArray(empRes) ? empRes : empRes.data || [];

      // Fixed components (BASIC, HRA, MEDICAL, TRAVELLING)
      const fixedComponents = components.filter(
        (c: any) =>
          ["BASIC", "HRA"].includes(c.component_type) ||
          ["Medical", "Travelling"].includes(c.component_name),
      );
      const fixedTotal = fixedComponents.reduce(
        (sum: number, c: any) => sum + Number(c.amount || 0),
        0,
      );

      // Calculate full month gross salary
      const fullMonthGross =
        fixedTotal +
        Number(monthlyPayrollForm.bonus_monthly) +
        Number(monthlyPayrollForm.production_incentive) +
        Number(monthlyPayrollForm.special_allowance);

      // Prorate based on paid_for_total_days
      const daysInMonth = Number(monthlyPayrollForm.days_in_month);
      const paidDays = Number(monthlyPayrollForm.paid_for_total_days);
      const grossSalary =
        daysInMonth > 0 && paidDays > 0
          ? (fullMonthGross / daysInMonth) * paidDays
          : fullMonthGross;

      // Professional Tax should also be prorated
      const fullMonthPT = Number(monthlyPayrollForm.professional_tax);
      const professionalTax =
        daysInMonth > 0 && paidDays > 0
          ? (fullMonthPT / daysInMonth) * paidDays
          : fullMonthPT;

      // Net Salary = Gross - Professional Tax (holds are NOT deducted here)
      const netSalary = grossSalary - professionalTax;

      // Monthly Hold = Bonus Hold + Production Incentive Hold
      const monthlyHold =
        Number(monthlyPayrollForm.bonus_hold) +
        Number(monthlyPayrollForm.production_incentive_hold);

      // Amount Paid = Net Salary - Monthly Hold
      const amountPaid = netSalary - monthlyHold;

      const payload = {
        ...monthlyPayrollForm,
        gross_salary: grossSalary,
        net_salary: netSalary,
        monthly_hold: monthlyHold,
        amount_paid: amountPaid,
        status: "DRAFT",
      };

      if (selectedMonthlyPayroll?.id) {
        await apiClient.put(
          `/hr/payroll/monthly/${selectedMonthlyPayroll.id}`,
          payload,
        );
        alert("Monthly payroll updated successfully");
      } else {
        await apiClient.post("/hr/payroll/monthly", payload);
        alert("Monthly payroll created successfully");
      }

      setShowMonthlyPayrollForm(false);
      setSelectedMonthlyPayroll(null);
      setMonthlyPayrollForm({
        employee_id: "",
        payroll_month: new Date().toISOString().substring(0, 7),
        days_in_month: new Date(
          new Date().getFullYear(),
          new Date().getMonth() + 1,
          0,
        ).getDate(),
        days_travelled: 0,
        comp_offs: 0,
        leaves_absent: 0,
        approved_paid_leaves: 0,
        paid_for_total_days: 0,
        bonus_monthly: 0,
        production_incentive: 0,
        bonus_hold: 0,
        production_incentive_hold: 0,
        special_allowance: 0,
        professional_tax: 200,
      });
      fetchData();
    } catch (error) {
      alert("Failed to save monthly payroll");
    } finally {
      setLoading(false);
    }
  };

  const handleProcessMonthlyPayroll = async (id: string) => {
    if (!canApproveHR) {
      alert("You do not have permission to process monthly payroll");
      return;
    }
    const confirmed = await confirmDialog({
      title: "Process Monthly Payroll",
      message: "Process this monthly payroll? This will lock the record.",
      confirmLabel: "Process",
      variant: "warning",
    });
    if (!confirmed) return;
    setLoading(true);
    try {
      await apiClient.put(`/hr/payroll/monthly/${id}/process`);
      fetchData();
      alert("Monthly payroll processed successfully");
    } catch (error) {
      alert("Failed to process monthly payroll");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteMonthlyPayroll = async (id: string) => {
    if (!canDeleteHR) {
      alert("You do not have permission to delete monthly payroll");
      return;
    }
    const confirmed = await confirmDialog({
      title: "Delete Monthly Payroll",
      message: "Delete this monthly payroll record?",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!confirmed) return;
    setLoading(true);
    try {
      await apiClient.delete(`/hr/payroll/monthly/${id}`);
      fetchData();
      alert("Monthly payroll deleted successfully");
    } catch (error) {
      alert("Failed to delete monthly payroll");
    } finally {
      setLoading(false);
    }
  };

  // Comprehensive Salary Form Handler
  const handleSaveComprehensiveSalary = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    if (!canCreateHR && !canEditHR) {
      alert("You do not have permission to save salary components");
      setLoading(false);
      return;
    }

    try {
      const components = [];

      // Add fixed components
      if (comprehensiveSalaryForm.basic_salary > 0) {
        components.push({
          employee_id: comprehensiveSalaryForm.employee_id,
          component_type: "BASIC",
          component_name: "Basic Salary",
          amount: comprehensiveSalaryForm.basic_salary,
          is_taxable: true,
        });
      }

      if (comprehensiveSalaryForm.hra > 0) {
        components.push({
          employee_id: comprehensiveSalaryForm.employee_id,
          component_type: "HRA",
          component_name: "House Rent Allowance",
          amount: comprehensiveSalaryForm.hra,
          is_taxable: true,
        });
      }

      if (comprehensiveSalaryForm.medical_allowance > 0) {
        components.push({
          employee_id: comprehensiveSalaryForm.employee_id,
          component_type: "ALLOWANCE",
          component_name: "Medical",
          amount: comprehensiveSalaryForm.medical_allowance,
          is_taxable: false,
        });
      }

      if (comprehensiveSalaryForm.travelling_allowance > 0) {
        components.push({
          employee_id: comprehensiveSalaryForm.employee_id,
          component_type: "ALLOWANCE",
          component_name: "Travelling",
          amount: comprehensiveSalaryForm.travelling_allowance,
          is_taxable: false,
        });
      }

      if (comprehensiveSalaryForm.special_allowance > 0) {
        components.push({
          employee_id: comprehensiveSalaryForm.employee_id,
          component_type: "ALLOWANCE",
          component_name: "Special Allowance",
          amount: comprehensiveSalaryForm.special_allowance,
          is_taxable: true,
        });
      }

      // Add deductions
      if (comprehensiveSalaryForm.pf_deduction > 0) {
        components.push({
          employee_id: comprehensiveSalaryForm.employee_id,
          component_type: "PF",
          component_name: "Provident Fund",
          amount: comprehensiveSalaryForm.pf_deduction,
          is_taxable: false,
        });
      }

      if (comprehensiveSalaryForm.esi_deduction > 0) {
        components.push({
          employee_id: comprehensiveSalaryForm.employee_id,
          component_type: "ESI",
          component_name: "ESI",
          amount: comprehensiveSalaryForm.esi_deduction,
          is_taxable: false,
        });
      }

      if (comprehensiveSalaryForm.professional_tax > 0) {
        components.push({
          employee_id: comprehensiveSalaryForm.employee_id,
          component_type: "TAX",
          component_name: "Professional Tax",
          amount: comprehensiveSalaryForm.professional_tax,
          is_taxable: false,
        });
      }

      // Add other allowances
      comprehensiveSalaryForm.other_allowances.forEach((allowance) => {
        if (allowance.name && allowance.amount > 0) {
          components.push({
            employee_id: comprehensiveSalaryForm.employee_id,
            component_type: "ALLOWANCE",
            component_name: allowance.name,
            amount: allowance.amount,
            is_taxable: allowance.is_taxable,
          });
        }
      });

      // Add other deductions
      comprehensiveSalaryForm.other_deductions.forEach((deduction) => {
        if (deduction.name && deduction.amount > 0) {
          components.push({
            employee_id: comprehensiveSalaryForm.employee_id,
            component_type: "DEDUCTION",
            component_name: deduction.name,
            amount: deduction.amount,
            is_taxable: false,
          });
        }
      });

      // Delete existing components for this employee
      const existingComponents = await apiClient.get<any>(
        `/hr/salary/${comprehensiveSalaryForm.employee_id}`,
      );
      const existing = Array.isArray(existingComponents)
        ? existingComponents
        : existingComponents.data || [];

      for (const comp of existing) {
        await apiClient.delete(`/hr/salary/${comp.id}`);
      }

      // Create all new components
      for (const comp of components) {
        await apiClient.post("/hr/salary", comp);
      }

      setShowComprehensiveSalaryForm(false);
      setComprehensiveSalaryForm({
        employee_id: "",
        basic_salary: 0,
        hra: 0,
        medical_allowance: 0,
        travelling_allowance: 0,
        special_allowance: 0,
        pf_deduction: 0,
        esi_deduction: 0,
        professional_tax: 200,
        other_allowances: [],
        other_deductions: [],
      });
      fetchData();
      alert(`Successfully saved ${components.length} salary components`);
    } catch (error) {
      alert("Failed to save salary components");
    } finally {
      setLoading(false);
    }
  };

  // KPI Calculation Function
  const calculateKPIMetrics = async (employeeId: string, month: string) => {
    if (!canApproveHR) {
      alert("You do not have permission to calculate KPI metrics");
      return null;
    }
    try {
      setLoading(true);

      // Fetch attendance records for the month
      const attendanceRes = await apiClient.get<any>("/hr/attendance");
      const attendanceData = Array.isArray(attendanceRes)
        ? attendanceRes
        : attendanceRes.data || [];

      const monthStart = new Date(month + "-01");
      const monthEnd = new Date(
        monthStart.getFullYear(),
        monthStart.getMonth() + 1,
        0,
      );

      const employeeAttendance = attendanceData.filter(
        (a: any) =>
          a.employee_id === employeeId &&
          new Date(a.attendance_date) >= monthStart &&
          new Date(a.attendance_date) <= monthEnd,
      );

      // Calculate metrics
      const totalDays = employeeAttendance.length;
      const presentDays = employeeAttendance.filter(
        (a: any) => a.status === "PRESENT",
      ).length;
      const lateDays = employeeAttendance.filter(
        (a: any) => a.status === "LATE",
      ).length;
      const absentDays = employeeAttendance.filter(
        (a: any) => a.status === "ABSENT",
      ).length;

      // Fetch leave records
      const leaveRes = await apiClient.get<any>("/hr/leaves");
      const leaveData = Array.isArray(leaveRes)
        ? leaveRes
        : leaveRes.data || [];

      const employeeLeaves = leaveData.filter(
        (l: any) =>
          l.employee_id === employeeId &&
          l.status === "APPROVED" &&
          new Date(l.start_date) >= monthStart &&
          new Date(l.end_date) <= monthEnd,
      );

      const totalLeaveDays = employeeLeaves.reduce(
        (sum: number, l: any) => sum + (l.total_days || 0),
        0,
      );

      // Calculate KPI scores
      const workingDays = monthEnd.getDate();
      const attendanceRate =
        totalDays > 0 ? (presentDays / totalDays) * 100 : 0;
      const punctualityScore =
        totalDays > 0 ? ((totalDays - lateDays) / totalDays) * 100 : 100;
      const leaveUtilization = totalLeaveDays; // Total leaves taken

      // Calculate overtime (check if worked on weekends or after hours)
      const overtimeHours = 0; // Would need check_in/check_out time analysis

      const metrics: KPIMetrics = {
        attendance_rate: Math.round(attendanceRate * 100) / 100,
        punctuality_score: Math.round(punctualityScore * 100) / 100,
        leave_utilization: leaveUtilization,
        overtime_hours: overtimeHours,
        late_count: lateDays,
        absent_count: absentDays,
      };

      setKpiMetrics(metrics);

      setLoading(false);
      return metrics;
    } catch (error) {
      setLoading(false);
      return null;
    }
  };

  // Save Manual KPIs
  const handleSaveManualKPIs = async () => {
    if (!selectedEmployee?.id || !kpiMetrics) return;

    setLoading(true);
    try {
      // Merge auto-calculated and manual KPIs
      const combinedMetrics: KPIMetrics = {
        ...kpiMetrics,
        ...manualKPIs,
      };

      const [year, month] = kpiReviewMonth.split("-").map(Number);
      const periodStart = `${kpiReviewMonth}-01`;
      // Build the final calendar date directly. Using toISOString() here can
      // shift the review date by one day in some time zones.
      const periodEnd = `${kpiReviewMonth}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
      await apiClient.post(`/hr/employees/${selectedEmployee.id}/kpi-reviews`, {
        period_start: periodStart,
        period_end: periodEnd,
        metrics: combinedMetrics,
        remarks: manualKPIs.manual_notes || null,
      });

      // Update displayed metrics after the controlled KPI review has been submitted.
      setKpiMetrics(combinedMetrics);
      alert(
        "KPI review submitted for approval. Recognition, demerits and payroll actions remain separate controlled processes.",
      );

      // Reset manual form
      setManualKPIs({
        quality_of_work: 0,
        productivity_score: 0,
        teamwork_rating: 0,
        customer_satisfaction: 0,
        project_completion_rate: 0,
        initiative_innovation: 0,
        manual_notes: "",
      });
    } catch (error) {
      alert("Failed to save manual KPIs");
    } finally {
      setLoading(false);
    }
  };

  // Auto-fill monthly payroll from saved salary components
  const handleEmployeeSelectForPayroll = async (employeeId: string) => {
    if (!employeeId) {
      setMonthlyPayrollForm({
        employee_id: "",
        payroll_month: "",
        days_in_month: 30,
        days_travelled: 0,
        comp_offs: 0,
        leaves_absent: 0,
        approved_paid_leaves: 0,
        paid_for_total_days: 30,
        bonus_monthly: 0,
        production_incentive: 0,
        bonus_hold: 0,
        production_incentive_hold: 0,
        special_allowance: 0,
        professional_tax: 200,
      });
      return;
    }

    try {
      // Fetch employee's saved salary components
      const empRes = await apiClient.get<any>(`/hr/salary/${employeeId}`);
      const components = Array.isArray(empRes) ? empRes : empRes.data || [];

      // Map components to form fields
      let specialAllowance = 0;
      let professionalTax = 200;

      components.forEach((comp: any) => {
        if (comp.component_name === "Special Allowance") {
          specialAllowance = comp.amount;
        }
        if (comp.component_name === "Professional Tax") {
          professionalTax = comp.amount;
        }
      });

      // Pre-fill form with employee's salary structure
      setMonthlyPayrollForm({
        employee_id: employeeId,
        payroll_month: new Date().toISOString().substring(0, 7), // Current month
        days_in_month: 30,
        days_travelled: 0,
        comp_offs: 0,
        leaves_absent: 0,
        approved_paid_leaves: 0,
        paid_for_total_days: 30,
        bonus_monthly: 0,
        production_incentive: 0,
        bonus_hold: 0,
        production_incentive_hold: 0,
        special_allowance: specialAllowance,
        professional_tax: professionalTax,
      });
    } catch (error) {
      // Set default values if fetch fails
      setMonthlyPayrollForm({
        employee_id: employeeId,
        payroll_month: new Date().toISOString().substring(0, 7),
        days_in_month: 30,
        days_travelled: 0,
        comp_offs: 0,
        leaves_absent: 0,
        approved_paid_leaves: 0,
        paid_for_total_days: 30,
        bonus_monthly: 0,
        production_incentive: 0,
        bonus_hold: 0,
        production_incentive_hold: 0,
        special_allowance: 0,
        professional_tax: 200,
      });
    }
  };

  const handleEditMonthlyPayroll = (record: MonthlyPayroll) => {
    setSelectedMonthlyPayroll(record);
    setMonthlyPayrollForm({
      employee_id: record.employee_id,
      payroll_month: record.payroll_month,
      days_in_month: record.days_in_month,
      days_travelled: record.days_travelled,
      comp_offs: record.comp_offs,
      leaves_absent: record.leaves_absent,
      approved_paid_leaves: record.approved_paid_leaves,
      paid_for_total_days: record.paid_for_total_days,
      bonus_monthly: record.bonus_monthly,
      production_incentive: record.production_incentive,
      bonus_hold: record.bonus_hold,
      production_incentive_hold: record.production_incentive_hold,
      special_allowance: record.special_allowance,
      professional_tax: record.professional_tax,
    });
    setShowMonthlyPayrollForm(true);
  };

  const handlePrintPayslip = async (record: any) => {
    try {
      const formatPayrollMonthLabel = (yyyyMm: string) => {
        const match = /^(\d{4})-(\d{2})$/.exec(String(yyyyMm || "").trim());
        if (!match) return String(yyyyMm || "").trim();
        const year = Number(match[1]);
        const month = Number(match[2]);
        const date = new Date(year, month - 1, 1);
        const monthName = date.toLocaleString("en-IN", { month: "long" });
        return `${monthName} ${year}`;
      };

      const fmtINR = (n: number) =>
        Number(n || 0).toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });

      let branding = buildDocumentBranding(null);
      const generatedOn = new Date().toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
      });

      const buildSaifLetterHtml = (opts: {
        employeeName: string;
        monthLabel: string;
        amountPaid: number;
        salaryRows: Array<{
          label: string;
          amount: number;
          sl?: number;
          daysInMonth?: number | string;
        }>;
        grossSalary?: number;
        lessRows: Array<{ label: string; amount: number }>;
        monthlyHold?: number;
        netSalary?: number;
        sideRows: Array<{ label: string; value: string | number }>;
        employeeAddressLines?: string[];
      }) => {
        const addressLines =
          Array.isArray(opts.employeeAddressLines) &&
          opts.employeeAddressLines.length
            ? opts.employeeAddressLines
            : ["Address not available"];

        const salaryRowsHtml = opts.salaryRows
          .map((row, i) => {
            const sl = row.sl ?? i + 1;
            return `
              <tr>
                <td class="center">${sl}</td>
                <td>${escapeHtml(row.label)}</td>
                <td class="right">${fmtINR(row.amount)}</td>
                <td class="center">${row.daysInMonth ?? ""}</td>
              </tr>
            `;
          })
          .join("");

        const lessRowsHtml = opts.lessRows
          .filter((r) => Number(r.amount || 0) !== 0)
          .map(
            (r, idx) => `
              <tr>
                <td class="center">${opts.salaryRows.length + 2 + idx}</td>
                <td>${escapeHtml(r.label)}</td>
                <td class="right highlight-red">(${fmtINR(Math.abs(r.amount))})</td>
                <td></td>
              </tr>
            `,
          )
          .join("");

        const grossRowSl = opts.salaryRows.length + 1;
        const amountPaidSl =
          opts.salaryRows.length +
          2 +
          opts.lessRows.filter((r) => Number(r.amount || 0) !== 0).length;
        const monthlyHoldSl = amountPaidSl + 1;
        const netSalarySl =
          amountPaidSl + (Number(opts.monthlyHold || 0) > 0 ? 2 : 1);

        const sideRowsHtml = opts.sideRows
          .map(
            (r) => `
              <tr>
                <th>${escapeHtml(r.label)}</th>
                <td>${escapeHtml(r.value)}</td>
              </tr>
            `,
          )
          .join("");

        return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Salary Sheet - ${escapeHtml(opts.employeeName)}</title>
  <style>
    @page { margin: 0.5cm; }
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #000; font-size: 11pt; }
    .letterhead {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #1e3a8a;
      padding-bottom: 15px;
      margin-bottom: 20px;
    }
    .logo-section { display: flex; align-items: center; gap: 12px; }
    .logo-box {
      width: 50px; height: 50px; background: #1e3a8a; color: white;
      display: flex; align-items: center; justify-content: center;
      font-size: 24px; font-weight: bold; border-radius: 4px;
    }
    .logo { width: 50px; height: 50px; object-fit: contain; border-radius: 4px; }
    .company-name { font-size: 22px; font-weight: bold; color: #1e3a8a; }
    .company-meta { font-size: 9pt; color: #1e3a8a; line-height: 1.5; }
    .generated-on { text-align: right; font-size: 9pt; color: #1e3a8a; line-height: 1.5; }
    .generated-on-label { font-weight: bold; text-transform: uppercase; letter-spacing: 0.06em; }
    .generated-on-value { font-size: 11pt; color: #111827; }
    .date { margin: 15px 0 20px 0; font-size: 10pt; }
    .recipient { margin: 15px 0; font-size: 10pt; line-height: 1.5; }
    .greeting { margin: 20px 0 15px 0; font-size: 10pt; }
    .message { margin: 15px 0 25px 0; font-size: 10pt; line-height: 1.6; }
    .content-grid { display: grid; grid-template-columns: 1fr 230px; gap: 15px; margin: 20px 0; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #000; padding: 5px 8px; text-align: left; font-size: 10pt; }
    th { background: #f5f5f5; font-weight: bold; }
    .center { text-align: center; }
    .right { text-align: right; }
    .highlight-yellow { background: #fff8dc !important; font-weight: bold; }
    .highlight-green { background: #d4edda !important; font-weight: bold; }
    .highlight-red { color: #dc3545; }
    .side-table th { background: #f8f9fa; text-align: left; width: 60%; }
    .side-table td { text-align: right; width: 40%; }
    .footer { margin-top: 40px; font-size: 10pt; line-height: 1.8; }
    .footer-address { margin-top: 30px; font-size: 8pt; color: #666; line-height: 1.5; }
    .footer-works { font-weight: bold; margin-bottom: 5px; }
    .bottom-stripes {
      margin-top: 12px;
      height: 14px;
      background: linear-gradient(90deg, #f59e0b 0%, #f59e0b 33%, #1e3a8a 33%, #1e3a8a 66%, #60a5fa 66%, #60a5fa 100%);
    }
    @media print { body { padding: 10px; } }
  </style>
</head>
<body>
  ${renderStandardLetterheadHtml(branding, generatedOn)}

  <div class="date">Dated : ${generatedOn}</div>

  <div class="recipient">
    <div><strong>To,</strong></div>
    <div>${escapeHtml(opts.employeeName || "Employee Name")}</div>
    ${addressLines.map((l) => `<div>${escapeHtml(l)}</div>`).join("")}
  </div>

  <div class="greeting"><strong>Dear Sir,</strong></div>

  <div class="message">
    We are pleased to inform you that Rs. <strong>${fmtINR(opts.amountPaid)}</strong> towards your salary for the month of <strong>${escapeHtml(opts.monthLabel)}</strong> has been credited to your bank account. The detailed breakup of the payment is as under:
  </div>

  <div class="content-grid">
    <div>
      <table>
        <thead>
          <tr>
            <th class="center" style="width:50px;">Sl. No.</th>
            <th>Salary Break Up</th>
            <th class="right" style="width:150px;">Amount (INR)</th>
            <th class="center" style="width:120px;">Days In Month</th>
          </tr>
        </thead>
        <tbody>
          ${salaryRowsHtml}
          <tr class="highlight-yellow">
            <td class="center">${grossRowSl}</td>
            <td><strong>Gross Monthly Salary</strong></td>
            <td class="right"><strong>${fmtINR(Number(opts.grossSalary || 0))}</strong></td>
            <td></td>
          </tr>
          ${lessRowsHtml}
          <tr class="highlight-green">
            <td class="center">${amountPaidSl}</td>
            <td><strong>Amount Paid</strong></td>
            <td class="right"><strong>${fmtINR(opts.amountPaid)}</strong></td>
            <td></td>
          </tr>
          ${
            Number(opts.monthlyHold || 0) > 0
              ? `
          <tr>
            <td class="center">${monthlyHoldSl}</td>
            <td><strong>Monthly Hold</strong></td>
            <td class="right highlight-red"><strong>(${fmtINR(Number(opts.monthlyHold || 0))})</strong></td>
            <td></td>
          </tr>
          `
              : ""
          }
          ${
            typeof opts.netSalary === "number"
              ? `
          <tr>
            <td class="center">${netSalarySl}</td>
            <td><strong>Net Salary</strong></td>
            <td class="right"><strong>${fmtINR(Number(opts.netSalary || 0))}</strong></td>
            <td></td>
          </tr>
          `
              : ""
          }
        </tbody>
      </table>
    </div>

    <div>
      <table class="side-table">
        <tbody>
          ${sideRowsHtml}
        </tbody>
      </table>
    </div>
  </div>

  <div class="footer">
    <div>Thanking You,</div>
    <div style="margin-top: 15px;">With Regards,</div>
    <div style="margin-top: 15px;"><strong>For ${escapeHtml(branding.companyName)}</strong></div>
    <div style="margin-top: 30px;"><strong>Accounts In Charge</strong></div>
    <div style="margin-top: 5px;">Paramita Mall</div>
  </div>

  <div class="footer-address">
    <div class="footer-works"><u>Company Address:</u></div>
    ${branding.addressLines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}
    <div class="bottom-stripes"></div>
  </div>
</body>
</html>
        `;
      };

      // IMPORTANT: Open the window synchronously inside the click handler.
      // If we await before calling window.open, most browsers will block the popup.
      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        alert("Popup blocked. Please allow popups to print payslips.");
        return;
      }

      printWindow.document.open();
      printWindow.document.write(
        '<!doctype html><html><head><title>Preparing payslip...</title></head><body style="font-family: Arial, sans-serif; padding: 16px;">Preparing payslip...</body></html>',
      );
      printWindow.document.close();

      const company = await apiClient
        .get<any>("/tenant/current")
        .catch(() => null);
      branding = buildDocumentBranding(company);

      // Check if it's monthly payroll or regular payslip
      const isMonthlyPayroll = record.paid_for_total_days !== undefined;

      // Fetch employee salary components
      const empRes = await apiClient.get<any>(
        `/hr/salary/${record.employee_id}`,
      );
      const components = Array.isArray(empRes) ? empRes : empRes.data || [];

      if (isMonthlyPayroll) {
        // Print Monthly Payroll (new format matching salary slip)

        // Fixed components
        const fixedComponents = components.filter(
          (c: any) =>
            ["BASIC", "HRA"].includes(c.component_type) ||
            ["Medical", "Travelling"].includes(c.component_name),
        );

        const monthLabel = formatPayrollMonthLabel(
          String(record.payroll_month || record.salary_month || ""),
        );
        const employeeBase = employees.find(
          (employee) => employee.id === record.employee_id,
        ) as any;
        const employeeAddressRaw = String(employeeBase?.address || "").trim();
        const employeeAddressLines = employeeAddressRaw
          ? employeeAddressRaw
              .split(/\r?\n|,\s*/)
              .map((line: string) => line.trim())
              .filter(Boolean)
          : ["Address not available"];

        printWindow.document.open();
        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Salary Sheet - ${record.employee_name}</title>
            <style>
              @page { margin: 0.5cm; }
              body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #000; font-size: 11pt; }
              
              /* Letterhead */
              .letterhead { 
                display: flex; 
                justify-content: space-between; 
                align-items: flex-start; 
                border-bottom: 2px solid #1e3a8a;
                padding-bottom: 15px;
                margin-bottom: 20px;
              }
              .logo-section {
                display: flex;
                align-items: center;
                gap: 12px;
              }
              .logo-box {
                width: 50px;
                height: 50px;
                background: #1e3a8a;
                color: white;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 24px;
                font-weight: bold;
                border-radius: 4px;
              }
              .logo { width: 50px; height: 50px; object-fit: contain; border-radius: 4px; }
              .company-name {
                font-size: 22px;
                font-weight: bold;
                color: #1e3a8a;
              }
              .company-meta {
                font-size: 9pt;
                color: #1e3a8a;
                line-height: 1.5;
              }
              .generated-on {
                text-align: right;
                font-size: 9pt;
                color: #1e3a8a;
                line-height: 1.5;
              }
              .generated-on-label { font-weight: bold; text-transform: uppercase; letter-spacing: 0.06em; }
              .generated-on-value { font-size: 11pt; color: #111827; }
              
              /* Letter Content */
              .date { margin: 15px 0 20px 0; font-size: 10pt; }
              .recipient { margin: 15px 0; font-size: 10pt; line-height: 1.5; }
              .greeting { margin: 20px 0 15px 0; font-size: 10pt; }
              .message { margin: 15px 0 25px 0; font-size: 10pt; line-height: 1.6; }
              
              /* Table Layout */
              .content-grid { 
                display: grid; 
                grid-template-columns: 1fr 230px; 
                gap: 15px; 
                margin: 20px 0;
              }
              
              /* Main Table */
              table { width: 100%; border-collapse: collapse; }
              th, td { border: 1px solid #000; padding: 5px 8px; text-align: left; font-size: 10pt; }
              th { background: #f5f5f5; font-weight: bold; }
              .center { text-align: center; }
              .right { text-align: right; }
              
              /* Highlighting */
              .highlight-yellow { background: #fff8dc !important; font-weight: bold; }
              .highlight-green { background: #d4edda !important; font-weight: bold; }
              .highlight-red { color: #dc3545; }
              
              /* Side Table */
              .side-table th { background: #f8f9fa; text-align: left; width: 60%; }
              .side-table td { text-align: right; width: 40%; }
              
              /* Footer */
              .footer { margin-top: 40px; font-size: 10pt; line-height: 1.8; }
              .footer-address { margin-top: 30px; font-size: 8pt; color: #666; line-height: 1.5; }
              .footer-works { font-weight: bold; margin-bottom: 5px; }
              
              @media print {
                body { padding: 10px; }
                .no-print { display: none; }
              }
            </style>
          </head>
          <body>
            ${renderStandardLetterheadHtml(branding, generatedOn)}

            <!-- Date -->
            <div class="date">Dated : ${generatedOn}</div>

            <!-- Recipient -->
            <div class="recipient">
              <div><strong>To,</strong></div>
              <div>${record.employee_name || "Employee Name"}</div>
              ${employeeAddressLines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}
            </div>

            <!-- Greeting -->
            <div class="greeting"><strong>Dear Sir,</strong></div>

            <!-- Message -->
            <div class="message">
              We are pleased to inform you that Rs. <strong>${fmtINR(record.amount_paid)}</strong> towards your salary for the month of <strong>${escapeHtml(monthLabel)}</strong> has been credited to your bank account. The detailed breakup of the payment is as under:
            </div>

            <!-- Main Content Grid -->
            <div class="content-grid">
              <!-- Salary Breakdown Table -->
              <div>
                <table>
                  <thead>
                    <tr>
                      <th class="center" style="width:50px;">Sl. No.</th>
                      <th>Salary Break Up</th>
                      <th class="right" style="width:150px;">Amount (INR)</th>
                      <th class="center" style="width:120px;">Days In Month</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${fixedComponents
                      .map(
                        (c: any, i: number) => `
                      <tr>
                        <td class="center">${i + 1}</td>
                        <td>${c.component_name}</td>
                        <td class="right">${fmtINR(c.amount)}</td>
                        <td class="center">${i === 0 ? record.days_in_month : ""}</td>
                      </tr>
                    `,
                      )
                      .join("")}
                    ${
                      record.bonus_monthly > 0
                        ? `
                      <tr>
                        <td class="center">${fixedComponents.length + 1}</td>
                        <td>Bonus Monthly</td>
                        <td class="right">${fmtINR(record.bonus_monthly)}</td>
                        <td></td>
                      </tr>
                    `
                        : ""
                    }
                    ${
                      record.production_incentive > 0
                        ? `
                      <tr>
                        <td class="center">${fixedComponents.length + (record.bonus_monthly > 0 ? 2 : 1)}</td>
                        <td>Production Incentive Monthly</td>
                        <td class="right">${fmtINR(record.production_incentive)}</td>
                        <td></td>
                      </tr>
                    `
                        : ""
                    }
                    ${
                      record.special_allowance > 0
                        ? `
                      <tr>
                        <td class="center">${fixedComponents.length + (record.bonus_monthly > 0 ? 1 : 0) + (record.production_incentive > 0 ? 1 : 0) + 1}</td>
                        <td>Monthly Special Allowance</td>
                        <td class="right">${fmtINR(record.special_allowance)}</td>
                        <td></td>
                      </tr>
                    `
                        : ""
                    }
                    ${
                      Number(record.total_per_diem || 0) > 0
                        ? `
                      <tr>
                        <td class="center">${fixedComponents.length + (record.bonus_monthly > 0 ? 1 : 0) + (record.production_incentive > 0 ? 1 : 0) + (record.special_allowance > 0 ? 1 : 0) + 1}</td>
                        <td>Outstation Travel Per Diem (${Number(record.travel_days || record.days_travelled || 0)} day(s))</td>
                        <td class="right">${fmtINR(record.total_per_diem)}</td>
                        <td></td>
                      </tr>
                    `
                        : ""
                    }
                    <tr class="highlight-yellow">
                      <td class="center">${fixedComponents.length + (record.bonus_monthly > 0 ? 1 : 0) + (record.production_incentive > 0 ? 1 : 0) + (record.special_allowance > 0 ? 1 : 0) + 1}</td>
                      <td><strong>Gross Monthly Salary</strong></td>
                      <td class="right"><strong>${fmtINR(record.gross_salary)}</strong></td>
                      <td></td>
                    </tr>
                    ${
                      record.professional_tax > 0
                        ? `
                      <tr>
                        <td class="center">${fixedComponents.length + (record.bonus_monthly > 0 ? 1 : 0) + (record.production_incentive > 0 ? 1 : 0) + (record.special_allowance > 0 ? 1 : 0) + 2}</td>
                        <td>Less : Professional Tax</td>
                        <td class="right highlight-red">(${fmtINR(record.professional_tax)})</td>
                        <td></td>
                      </tr>
                    `
                        : ""
                    }
                    ${
                      record.bonus_hold > 0
                        ? `
                      <tr>
                        <td class="center">${fixedComponents.length + (record.bonus_monthly > 0 ? 1 : 0) + (record.production_incentive > 0 ? 1 : 0) + (record.special_allowance > 0 ? 1 : 0) + (record.professional_tax > 0 ? 2 : 1) + 1}</td>
                        <td>Less : Bonus Monthly (On Hold )</td>
                        <td class="right highlight-red">(${fmtINR(record.bonus_hold)})</td>
                        <td></td>
                      </tr>
                    `
                        : ""
                    }
                    ${
                      record.production_incentive_hold > 0
                        ? `
                      <tr>
                        <td class="center">${fixedComponents.length + (record.bonus_monthly > 0 ? 1 : 0) + (record.production_incentive > 0 ? 1 : 0) + (record.special_allowance > 0 ? 1 : 0) + (record.professional_tax > 0 ? 2 : 1) + (record.bonus_hold > 0 ? 1 : 0) + 1}</td>
                        <td>Less : Production Incentive Monthly (On Hold )</td>
                        <td class="right highlight-red">(${fmtINR(record.production_incentive_hold)})</td>
                        <td></td>
                      </tr>
                    `
                        : ""
                    }
                    <tr class="highlight-green">
                      <td class="center">${fixedComponents.length + (record.bonus_monthly > 0 ? 1 : 0) + (record.production_incentive > 0 ? 1 : 0) + (record.special_allowance > 0 ? 1 : 0) + (record.professional_tax > 0 ? 2 : 1) + (record.bonus_hold > 0 ? 1 : 0) + (record.production_incentive_hold > 0 ? 1 : 0) + 1}</td>
                      <td><strong>Amount Paid</strong></td>
                      <td class="right"><strong>${fmtINR(record.amount_paid)}</strong></td>
                      <td></td>
                    </tr>
                    ${
                      record.monthly_hold > 0
                        ? `
                      <tr>
                        <td class="center">${fixedComponents.length + (record.bonus_monthly > 0 ? 1 : 0) + (record.production_incentive > 0 ? 1 : 0) + (record.special_allowance > 0 ? 1 : 0) + (record.professional_tax > 0 ? 2 : 1) + (record.bonus_hold > 0 ? 1 : 0) + (record.production_incentive_hold > 0 ? 1 : 0) + 2}</td>
                        <td><strong>Monthly Hold</strong></td>
                        <td class="right highlight-red"><strong>(${fmtINR(record.monthly_hold)})</strong></td>
                        <td></td>
                      </tr>
                    `
                        : ""
                    }
                    <tr>
                      <td class="center">${fixedComponents.length + (record.bonus_monthly > 0 ? 1 : 0) + (record.production_incentive > 0 ? 1 : 0) + (record.special_allowance > 0 ? 1 : 0) + (record.professional_tax > 0 ? 2 : 1) + (record.bonus_hold > 0 ? 1 : 0) + (record.production_incentive_hold > 0 ? 1 : 0) + (record.monthly_hold > 0 ? 2 : 1) + 1}</td>
                      <td><strong>Net Salary</strong></td>
                      <td class="right"><strong>${fmtINR(record.net_salary)}</strong></td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
                )}
              </div>

              <!-- Side Information Table -->
              <div>
                <table class="side-table">
                  <tbody>
                    <tr>
                      <th>Days In Month</th>
                      <td>${record.days_in_month}</td>
                    </tr>
                    <tr>
                      <th>No. of days Travelled</th>
                      <td>${record.days_travelled}</td>
                    </tr>
                    <tr>
                      <th>Comp-Offs</th>
                      <td>${record.comp_offs}</td>
                    </tr>
                    <tr>
                      <th>Leave(s) / Absent</th>
                      <td>${record.leaves_absent}</td>
                    </tr>
                    <tr>
                      <th>Approved Paid Leaves</th>
                      <td>${record.approved_paid_leaves}</td>
                    </tr>
                    <tr style="background: #d4edda;">
                      <th><strong>Paid for Total Days</strong></th>
                      <td><strong>${record.paid_for_total_days}</strong></td>
                    </tr>
                  </tbody>
                </table>
                )}
              </div>
            </div>

            <!-- Footer -->
            <div class="footer">
              <div>Thanking You,</div>
              <div style="margin-top: 15px;">With Regards,</div>
              <div style="margin-top: 15px;"><strong>For ${escapeHtml(branding.companyName)}</strong></div>
              <div style="margin-top: 30px;"><strong>Accounts In Charge</strong></div>
              <div style="margin-top: 5px;">Paramita Mall</div>
            </div>

            <!-- Footer Address -->
            <div class="footer-address">
              <div class="footer-works"><u>Company Address:</u></div>
              ${branding.addressLines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}
            </div>

          </body>
          </html>
        `);
        printWindow.document.close();
        setTimeout(() => {
          try {
            printWindow.focus();
            printWindow.print();
          } catch {}
        }, 250);
      } else {
        // Regular payslip uses the standard SAK Solutions letter format.
        const salaryComponents = Array.isArray(empRes)
          ? empRes
          : empRes.data || [];
        const grossTypes = new Set(["BASIC", "HRA", "ALLOWANCE", "BONUS"]);
        const deductionTypes = new Set(["DEDUCTION", "PF", "ESI", "TAX"]);
        const isHoldName = (name: unknown) =>
          typeof name === "string" && /\bon\s*hold\b|\bhold\b/i.test(name);
        const earnings = salaryComponents.filter((sc: any) =>
          grossTypes.has(String(sc.component_type || "")),
        );
        const onHold = earnings.filter((sc: any) =>
          isHoldName(sc.component_name),
        );
        const deductions = salaryComponents.filter((sc: any) =>
          deductionTypes.has(String(sc.component_type || "")),
        );
        const holdTotal = onHold.reduce(
          (sum: number, sc: any) => sum + (parseFloat(sc.amount) || 0),
          0,
        );
        const netSalary = Number(record.net_salary || 0);
        const amountPaid = Math.max(0, netSalary - holdTotal);

        const salaryMonth = String(
          record.salary_month || record.payroll_month || "",
        ).trim();
        const daysInMonth = (() => {
          const match = /^(\d{4})-(\d{2})$/.exec(salaryMonth);
          if (!match) return 30;
          const y = Number(match[1]);
          const m = Number(match[2]);
          return new Date(y, m, 0).getDate();
        })();

        const daysPresent = Number(record.attendance_days || 0);
        const daysLeave = Number(record.leave_days || 0);
        const paidDays = Math.max(0, daysPresent + daysLeave);
        const daysAbsent = Math.max(0, daysInMonth - paidDays);

        const sumAmount = (rows: any[]) =>
          rows.reduce(
            (sum: number, sc: any) => sum + (parseFloat(sc?.amount) || 0),
            0,
          );

        const basicSalary = sumAmount(
          earnings.filter((sc: any) => String(sc.component_type) === "BASIC"),
        );
        const hra = sumAmount(
          earnings.filter((sc: any) => String(sc.component_type) === "HRA"),
        );
        const bonus = sumAmount(
          earnings.filter((sc: any) => String(sc.component_type) === "BONUS"),
        );

        const allowances: Record<string, number> = {};
        earnings
          .filter((sc: any) => String(sc.component_type) === "ALLOWANCE")
          .filter((sc: any) => !isHoldName(sc.component_name))
          .forEach((sc: any) => {
            const key = String(sc.component_name || "Allowance");
            allowances[key] =
              (allowances[key] || 0) + (parseFloat(sc.amount) || 0);
          });

        const pfEmployee = sumAmount(
          deductions.filter((sc: any) => String(sc.component_type) === "PF"),
        );
        const esiEmployee = sumAmount(
          deductions.filter((sc: any) => String(sc.component_type) === "ESI"),
        );
        const taxRows = deductions.filter(
          (sc: any) => String(sc.component_type) === "TAX",
        );
        const professionalTax = sumAmount(
          taxRows.filter((sc: any) =>
            /professional\s*tax/i.test(String(sc.component_name || "")),
          ),
        );
        const tds = sumAmount(
          taxRows.filter((sc: any) =>
            /\btds\b/i.test(String(sc.component_name || "")),
          ),
        );

        const otherDeductions: Record<string, number> = {};
        deductions
          .filter((sc: any) => String(sc.component_type) === "DEDUCTION")
          .forEach((sc: any) => {
            const key = String(sc.component_name || "Deduction");
            otherDeductions[key] =
              (otherDeductions[key] || 0) + (parseFloat(sc.amount) || 0);
          });

        const grossSalary = Number(record.gross_salary || 0);
        const totalDeductions = Number(record.total_deductions || 0);
        const employeeBase = employees.find(
          (e) => e.id === record.employee_id,
        ) as any;
        const employeeName = String(
          employeeBase?.employee_name || record.employee_name || "Employee",
        );
        const monthLabel = formatPayrollMonthLabel(salaryMonth);
        const employeeAddressRaw = String(employeeBase?.address || "").trim();
        const employeeAddressLines = employeeAddressRaw
          ? employeeAddressRaw
              .split(/\r?\n|,\s*/)
              .map((s: string) => s.trim())
              .filter(Boolean)
          : undefined;

        const salaryRows: Array<{
          label: string;
          amount: number;
          sl?: number;
          daysInMonth?: number | string;
        }> = [];
        if (basicSalary)
          salaryRows.push({
            label: "Basic Monthly",
            amount: basicSalary,
            daysInMonth,
          });
        if (hra) salaryRows.push({ label: "HRA Monthly", amount: hra });

        Object.entries(allowances).forEach(([name, amount]) => {
          if (!amount) return;
          salaryRows.push({ label: String(name), amount: Number(amount) });
        });

        if (bonus) salaryRows.push({ label: "Bonus Monthly", amount: bonus });

        const travelDays = Number(
          record.travel_days || record.days_travelled || 0,
        );
        const totalPerDiem = Number(record.total_per_diem || 0);
        if (totalPerDiem > 0) {
          salaryRows.push({
            label: `Outstation Travel Per Diem${travelDays > 0 ? ` (${travelDays} day${travelDays === 1 ? "" : "s"})` : ""}`,
            amount: totalPerDiem,
          });
        }

        // Anything marked "hold" is shown as "Less" rows like the sample.
        const lessRows: Array<{ label: string; amount: number }> = [];
        if (professionalTax)
          lessRows.push({
            label: "Less : Professional Tax",
            amount: professionalTax,
          });
        if (pfEmployee)
          lessRows.push({ label: "Less : PF (Employee)", amount: pfEmployee });
        if (esiEmployee)
          lessRows.push({
            label: "Less : ESI (Employee)",
            amount: esiEmployee,
          });
        if (tds) lessRows.push({ label: "Less : TDS", amount: tds });
        Object.entries(otherDeductions).forEach(([name, amount]) => {
          if (!amount) return;
          lessRows.push({ label: `Less : ${name}`, amount: Number(amount) });
        });

        if (holdTotal > 0)
          lessRows.push({
            label: "Less : Monthly Hold (On Hold)",
            amount: holdTotal,
          });

        const sideRows = [
          { label: "Days In Month", value: daysInMonth },
          { label: "No. of days Travelled", value: travelDays },
          {
            label: "Travel Per Diem",
            value: totalPerDiem > 0 ? formatCurrency(totalPerDiem) : "-",
          },
          { label: "Comp-Offs", value: 0 },
          { label: "Leave(s) / Absent", value: daysAbsent },
          { label: "Approved Paid Leaves", value: daysLeave },
          { label: "Paid for Total Days", value: paidDays },
        ];

        const html = buildSaifLetterHtml({
          employeeName,
          monthLabel,
          amountPaid,
          salaryRows,
          grossSalary,
          lessRows,
          monthlyHold: holdTotal,
          netSalary,
          sideRows,
          employeeAddressLines,
        });

        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
        setTimeout(() => {
          try {
            printWindow.focus();
            printWindow.print();
          } catch {}
        }, 250);
      }
    } catch (error: any) {
      alert(error?.message || "Failed to print payslip");
    }
  };

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const dataUrlToBlob = (dataUrl: string) => {
    const [meta, data] = dataUrl.split(",");
    const match = /data:(.*?);base64/.exec(meta || "");
    const mimeType = match?.[1] || "application/octet-stream";
    const binary = atob(data || "");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
  };

  const openFileUrlInNewTab = (fileUrl: string) => {
    if (!fileUrl) return;
    if (fileUrl.startsWith("data:")) {
      const blob = dataUrlToBlob(fileUrl);
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      return;
    }
    window.open(fileUrl, "_blank", "noopener,noreferrer");
  };

  const handleAttendanceImport = async () => {
    if (!canCreateHR) {
      alert("You do not have permission to import attendance");
      return;
    }
    setLoading(true);
    setAttendanceImportResult("");
    try {
      let parsed: any;
      try {
        parsed = JSON.parse(attendanceImportText);
      } catch {
        throw new Error(
          'Invalid JSON. Paste a JSON array of records, or {"records": [...]}',
        );
      }

      const records = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.records)
          ? parsed.records
          : null;
      if (!records)
        throw new Error('Expected JSON array or {"records": [...]}');

      const res = await apiClient.post<any>("/hr/attendance/import", {
        records,
      });
      const imported =
        (res as any)?.imported ?? (res as any)?.data?.imported ?? 0;
      const skipped = (res as any)?.skipped ?? (res as any)?.data?.skipped ?? 0;
      setAttendanceImportResult(`Imported: ${imported}, Skipped: ${skipped}`);
      fetchData();
    } catch (err: any) {
      alert(err?.message || "Failed to import attendance");
    } finally {
      setLoading(false);
    }
  };

  const handleEmployeeDocumentFileSelect = async (file: File) => {
    if (!canEditHR) {
      alert("You do not have permission to add employee documents");
      return;
    }
    const allowed = new Set([
      "application/pdf",
      "image/png",
      "image/jpeg",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]);

    if (!allowed.has(file.type)) {
      alert("Only PDF, PNG, JPG, DOC, DOCX allowed");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert("Max file size is 10MB");
      return;
    }

    const dataUrl = await fileToDataUrl(file);
    setDocumentForm((prev) => ({
      ...prev,
      file_url: dataUrl,
      file_name: file.name,
      file_type: file.type,
      file_size: file.size,
    }));
  };

  const handleAddEmployeeDocument = async () => {
    if (!selectedEmployee?.id) return;
    if (!canEditHR) {
      alert("You do not have permission to add employee documents");
      return;
    }
    if (!documentForm.doc_type.trim()) {
      alert("Document type is required");
      return;
    }
    if (!documentForm.file_url.trim()) {
      alert("Upload a file or paste file URL");
      return;
    }

    setLoading(true);
    try {
      await apiClient.post(`/hr/employees/${selectedEmployee.id}/documents`, {
        doc_type: documentForm.doc_type.trim(),
        file_url: documentForm.file_url.trim(),
        file_name: documentForm.file_name || null,
        file_type: documentForm.file_type || null,
        file_size: documentForm.file_size || null,
        notes: documentForm.notes || null,
      });

      const docs = await apiClient.get<any>(
        `/hr/employees/${selectedEmployee.id}/documents`,
      );
      setEmployeeDocuments(Array.isArray(docs) ? docs : docs.data || []);
      setDocumentForm({
        doc_type: "",
        file_url: "",
        file_name: "",
        file_type: "",
        file_size: 0,
        notes: "",
      });
    } catch (err: any) {
      alert(err?.message || "Failed to add document");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteEmployeeDocument = async (docId: string) => {
    if (!selectedEmployee?.id) return;
    if (!canDeleteHR) {
      alert("You do not have permission to delete employee documents");
      return;
    }
    const confirmed = await confirmDialog({
      title: "Delete Document",
      message: "Delete this document?",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!confirmed) return;
    setLoading(true);
    try {
      await apiClient.delete(
        `/hr/employees/${selectedEmployee.id}/documents/${docId}`,
      );
      setEmployeeDocuments((prev) => prev.filter((d) => d.id !== docId));
    } catch (err: any) {
      alert(err?.message || "Failed to delete document");
    } finally {
      setLoading(false);
    }
  };

  const handleAddMeritDemerit = async () => {
    if (!selectedEmployee?.id) return;
    if (!canCreateHR) {
      alert("You do not have permission to add merit or demerit records");
      return;
    }
    if (!meritDemeritForm.title.trim()) {
      alert("Title is required");
      return;
    }

    setLoading(true);
    try {
      await apiClient.post(
        `/hr/employees/${selectedEmployee.id}/merits-demerits`,
        {
          record_type: meritDemeritForm.record_type,
          type_id: meritDemeritForm.type_id || null,
          title: meritDemeritForm.title.trim(),
          description: meritDemeritForm.description || null,
          points: meritDemeritForm.points
            ? parseInt(meritDemeritForm.points, 10)
            : null,
          evidence_reference: meritDemeritForm.evidence_reference || null,
          event_date: meritDemeritForm.event_date,
        },
      );

      const md = await apiClient.get<any>(
        `/hr/employees/${selectedEmployee.id}/merits-demerits`,
      );
      setMeritsDemerits(Array.isArray(md) ? md : md.data || []);
      setMeritDemeritForm({
        record_type: "MERIT",
        type_id: "",
        title: "",
        description: "",
        points: "",
        evidence_reference: "",
        event_date: getTodayDateInputValue(),
      });
    } catch (err: any) {
      alert(err?.message || "Failed to add record");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteMeritDemerit = async (recordId: string) => {
    if (!selectedEmployee?.id) return;
    if (!canDeleteHR) {
      alert("You do not have permission to delete merit or demerit records");
      return;
    }
    const confirmed = await confirmDialog({
      title: "Void Record",
      message: "Void this record? The audit history will be retained.",
      confirmLabel: "Void Record",
      variant: "danger",
    });
    if (!confirmed) return;
    setLoading(true);
    try {
      await apiClient.delete(
        `/hr/employees/${selectedEmployee.id}/merits-demerits/${recordId}`,
      );
      const md = await apiClient.get<any>(
        `/hr/employees/${selectedEmployee.id}/merits-demerits`,
      );
      setMeritsDemerits(Array.isArray(md) ? md : md.data || []);
    } catch (err: any) {
      alert(err?.message || "Failed to delete record");
    } finally {
      setLoading(false);
    }
  };

  const normalizeStatus = (status: unknown) =>
    String(status || "")
      .trim()
      .toUpperCase();
  const isSundayAttendance = (record: AttendanceRecord) => {
    const value = String(record.attendance_date || "").slice(0, 10);
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    const [, year, month, day] = match;
    return (
      new Date(Number(year), Number(month) - 1, Number(day)).getDay() === 0
    );
  };
  const getAttendancePayDayCredit = (record: AttendanceRecord) => {
    const status = normalizeStatus(record.status);
    if (status === "ABSENT" || status === "LEAVE") return 0;

    const hours = Number(record.work_hours);
    if (!Number.isFinite(hours)) {
      return status ? 1 : 0;
    }

    // Sunday is already paid. Working 6+ hours on Sunday earns one extra day,
    // so payroll/reporting should show 2 paid days total.
    if (isSundayAttendance(record)) {
      return hours >= 6 ? 2 : 1;
    }

    if (hours < 8) return 0;
    if (hours < 10) return 1;
    if (hours <= 12) return 1.5;
    return 2;
  };
  const formatPayDayCredit = (record: AttendanceRecord) => {
    const credit = getAttendancePayDayCredit(record);
    return credit ? `${credit} day${credit === 1 ? "" : "s"}` : "-";
  };
  const parseTravelMinutes = (value?: string | null) => {
    if (!value) return null;
    const match = String(value).match(/(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (
      !Number.isFinite(hours) ||
      !Number.isFinite(minutes) ||
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59
    )
      return null;
    return hours * 60 + minutes;
  };
  const formatTimeOnly = (value?: string | null) => {
    const minutes = parseTravelMinutes(value);
    if (minutes === null) return "-";
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  };
  const getEmployeePerDiemAmount = (employeeId?: string) => {
    const employee = employees.find((item) => item.id === employeeId);
    const amount = Number(
      employee?.per_diem_amount ?? employee?.per_diem_rate ?? 0,
    );
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  };
  const isTravelPerDiemDay = (record: AttendanceRecord) => {
    if (!record.is_outstation_travel) return false;
    const departure = parseTravelMinutes(record.travel_departure_time);
    const arrival = parseTravelMinutes(record.travel_arrival_time);
    if (arrival !== null && arrival < 8 * 60) return false;
    if (departure !== null) return departure < 20 * 60;
    if (arrival !== null) return arrival >= 8 * 60;
    return true;
  };
  const getAttendanceTravelPerDiemAmount = (record: AttendanceRecord) => {
    if (!isTravelPerDiemDay(record)) return 0;
    const amount = Number(
      record.employee_per_diem_amount ??
        getEmployeePerDiemAmount(record.employee_id),
    );
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  };
  const formatPerDiemAmount = (amount: number) =>
    amount > 0
      ? `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
      : "-";
  const isPendingLeaveStatus = (status: unknown) => {
    const s = normalizeStatus(status);
    return s === "PENDING" || s === "PENDING_APPROVAL";
  };

  const formatHolidayDateRange = (holiday: Holiday) => {
    const start = new Date(holiday.start_date).toLocaleDateString("en-IN");
    if (!holiday.end_date || holiday.end_date === holiday.start_date) {
      return start;
    }
    return `${start} - ${new Date(holiday.end_date).toLocaleDateString("en-IN")}`;
  };

  const totalHolidayDays = holidays.reduce(
    (sum, holiday) => sum + Number(holiday.day_count || 0),
    0,
  );

  // Support deep-links like /dashboard/hr?tab=leaves or /dashboard/hr?tab=leaves&applyLeave=1
  useEffect(() => {
    const tabParam = (searchParams.get("tab") || "").toLowerCase();
    const allowedTabs = isEmployeePortal
      ? ([
          "dashboard",
          "employees",
          "attendance",
          "leaves",
          "holidays",
          "payroll",
        ] as const)
      : ([
          "dashboard",
          "employees",
          "attendance",
          "leaves",
          "holidays",
          "payroll",
          "config",
        ] as const);
    const tab = (allowedTabs as readonly string[]).includes(tabParam)
      ? (tabParam as typeof activeTab)
      : null;
    if (tab && tab !== activeTab) setActiveTab(tab);

    const applyLeaveParam = normalizeStatus(
      searchParams.get("applyLeave") ?? searchParams.get("action"),
    );
    const shouldOpenApplyLeave =
      tabParam === "leaves" &&
      (applyLeaveParam === "1" ||
        applyLeaveParam === "TRUE" ||
        applyLeaveParam === "APPLY");
    if (shouldOpenApplyLeave) setShowLeaveForm(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, isEmployeePortal]);

  const getStatusColor = (status: string) => {
    const colors: { [key: string]: string } = {
      ACTIVE: "bg-green-100 text-green-800",
      INACTIVE: "bg-gray-100 text-gray-800",
      PRESENT: "bg-green-100 text-green-800",
      ABSENT: "bg-red-100 text-red-800",
      LEAVE: "bg-yellow-100 text-yellow-800",
      LATE: "bg-orange-100 text-orange-800",
      HALF_DAY: "bg-blue-100 text-blue-800",
      PENDING: "bg-yellow-100 text-yellow-800",
      PENDING_APPROVAL: "bg-yellow-100 text-yellow-800",
      APPROVED: "bg-green-100 text-green-800",
      REJECTED: "bg-red-100 text-red-800",
      CANCELLED: "bg-gray-100 text-gray-800",
    };
    return colors[normalizeStatus(status)] || "bg-gray-100 text-gray-800";
  };

  const sectionOptions = [
    {
      key: "employees" as const,
      label: "Employee Self-Service",
      description:
        "Profile, attendance, leave, holidays, payslips, and personal documents.",
      href: "/dashboard/hr/employees?tab=attendance",
      icon: UserCheck,
      enabled: true,
    },
    {
      key: "management" as const,
      label: "HR Management",
      description:
        "Employee master, attendance control, leave approvals, payroll, KPI, and configuration.",
      href: "/dashboard/hr/management?tab=attendance",
      icon: Briefcase,
      enabled: canManage,
    },
  ];

  const activeTabs = isEmployeePortal
    ? [
        { key: "attendance" as const, label: "My Attendance", icon: Clock3 },
        {
          key: "dashboard" as const,
          label: "Dashboard",
          icon: LayoutDashboard,
        },
        { key: "employees" as const, label: "My Profile", icon: UserCheck },
        { key: "leaves" as const, label: "My Leaves", icon: ClipboardCheck },
        {
          key: "holidays" as const,
          label: "Holiday Calendar",
          icon: CalendarDays,
        },
        { key: "payroll" as const, label: "My Payslips", icon: WalletCards },
      ]
    : [
        { key: "attendance" as const, label: "Attendance", icon: Clock3 },
        {
          key: "dashboard" as const,
          label: "Dashboard",
          icon: LayoutDashboard,
        },
        { key: "employees" as const, label: "Employees", icon: Users },
        {
          key: "leaves" as const,
          label: "Leave Requests",
          icon: ClipboardCheck,
        },
        {
          key: "holidays" as const,
          label: "Holiday Calendar",
          icon: CalendarDays,
        },
        {
          key: "payroll" as const,
          label: "Payroll & Payslips",
          icon: WalletCards,
        },
        { key: "config" as const, label: "Master Config", icon: Settings2 },
      ];

  const employeeAppTabs = activeTabs
    .filter((tab) => ["attendance", "leaves", "payroll"].includes(tab.key))
    .map((tab) => ({
      ...tab,
      label:
        tab.key === "attendance"
          ? "Check In"
          : tab.key === "leaves"
            ? "Leaves"
            : tab.key === "payroll"
              ? "Payslips"
              : "Profile",
    }));

  const navigateToHrTab = (tabKey: typeof activeTab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("section", activeSection);
    params.set("tab", tabKey);
    setActiveTab(tabKey);
    router.replace(
      `${activeSection === "employees" ? "/dashboard/hr/employees" : "/dashboard/hr/management"}?${params.toString()}`,
      { scroll: false },
    );
  };

  const getHrTabHref = (tabKey: typeof activeTab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("section", activeSection);
    params.set("tab", tabKey);
    return `${activeSection === "employees" ? "/dashboard/hr/employees" : "/dashboard/hr/management"}?${params.toString()}`;
  };

  const handleEmployeeLogout = () => {
    // Server logout is audit/best-effort only. Clear every local identity key
    // synchronously so an offline API, an installed PWA, or a slow mobile
    // connection can never leave the employee trapped in another user's session.
    void apiClient.logout();
    if (typeof window !== "undefined") {
      [
        "accessToken",
        "refreshToken",
        "user",
        "userId",
        "tenant",
        "tenantId",
      ].forEach((key) => localStorage.removeItem(key));
      sessionStorage.removeItem("postLoginLandingPath");
      setCurrentUser(null);
      setShowEmployeeMore(false);
      window.location.replace("/login");
    } else {
      router.replace("/login");
    }
  };

  const getAttendancePhotoLinks = (record: AttendanceRecord) =>
    [
      { label: "Check-in Photo", href: record.check_in_photo_url },
      { label: "Check-out Photo", href: record.check_out_photo_url },
    ].filter((link): link is { label: string; href: string } =>
      Boolean(link.href),
    );

  const formatCount = (value: number) =>
    Number(value || 0).toLocaleString("en-IN");
  const openActionCount =
    hrCommandStats.pendingLeaves +
    hrCommandStats.pendingPayrolls +
    hrCommandStats.lateToday +
    hrCommandStats.absentToday;
  const nextHolidayLabel = hrCommandStats.nextHolidayDate
    ? new Date(hrCommandStats.nextHolidayDate).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      })
    : "Not scheduled";

  const commandKpis = useMemo(
    () => [
      {
        label: "Active Headcount",
        value: hrCommandStats.activeEmployees,
        helper: `${formatCount(hrCommandStats.inactiveEmployees)} inactive / exited`,
        icon: Users,
        tone: "info",
      },
      {
        label: "Present Today",
        value: hrCommandStats.presentToday,
        helper: `${formatCount(hrCommandStats.lateToday)} late / ${formatCount(hrCommandStats.absentToday)} absent/leave`,
        icon: Clock3,
        tone:
          hrCommandStats.absentToday > 0 || hrCommandStats.lateToday > 0
            ? "warning"
            : "success",
      },
      {
        label: "Leave Approvals",
        value: hrCommandStats.pendingLeaves,
        helper: `${formatCount(hrCommandStats.approvedLeaves)} approved records`,
        icon: ClipboardCheck,
        tone: hrCommandStats.pendingLeaves > 0 ? "warning" : "success",
      },
      {
        label: "Payroll Readiness",
        value: hrCommandStats.pendingPayrolls,
        helper: `${formatCount(hrCommandStats.processedPayrolls)} processed this month`,
        icon: WalletCards,
        tone: hrCommandStats.pendingPayrolls > 0 ? "warning" : "neutral",
      },
      {
        label: "Holiday Calendar",
        value: hrCommandStats.holidayCount,
        helper: `${hrCommandStats.nextHolidayName} / ${nextHolidayLabel}`,
        icon: CalendarDays,
        tone: "neutral",
      },
    ],
    [hrCommandStats, nextHolidayLabel],
  );

  const workCenters = [
    {
      title: "Employee Central",
      label: "Master data & lifecycle",
      description:
        "Maintain employee profiles, joining data, documents, HR history, merits, and role-linked access.",
      icon: UserCheck,
      tab: "employees" as const,
      status: `${formatCount(hrCommandStats.activeEmployees)} active`,
      tone: "info",
      disabled: false,
    },
    {
      title: "Time & Attendance",
      label: "Daily workforce control",
      description:
        "Track check-ins, biometric imports, geo/photo exceptions, late marks, and absence governance.",
      icon: Clock3,
      tab: "attendance" as const,
      status: `${formatCount(hrCommandStats.presentToday)} present today`,
      tone: "success",
      disabled: false,
    },
    {
      title: "Leave Management",
      label: "Requests & approvals",
      description:
        "Review pending leaves, maintain leave visibility, and prepare the base for policy-driven balances.",
      icon: ClipboardCheck,
      tab: "leaves" as const,
      status: `${formatCount(hrCommandStats.pendingLeaves)} pending`,
      tone: hrCommandStats.pendingLeaves > 0 ? "warning" : "success",
      disabled: false,
    },
    {
      title: "Payroll & Compensation",
      label: "Monthly pay cycle",
      description:
        "Prepare salary inputs, process payroll, generate payslips, and manage statutory components.",
      icon: IndianRupee,
      tab: "payroll" as const,
      status: `${formatCount(hrCommandStats.pendingPayrolls)} drafts`,
      tone: "warning",
      disabled: false,
    },
    {
      title: "Compliance & Masters",
      label: "Policies and controls",
      description:
        "Configure holidays, KPI definitions, merits/demerits, payroll logic, and HR operating rules.",
      icon: ShieldCheck,
      tab: "config" as const,
      status: canManage ? "configured" : "restricted",
      tone: "neutral",
      disabled: !canManage,
    },
  ];

  const hrWorkflow = [
    {
      label: "Hire",
      caption: "Employee master",
      icon: UserPlus,
      tab: "employees" as const,
    },
    {
      label: "Work",
      caption: "Attendance & shifts",
      icon: Clock3,
      tab: "attendance" as const,
    },
    {
      label: "Leave",
      caption: "Policy & approval",
      icon: CalendarDays,
      tab: "leaves" as const,
    },
    {
      label: "Pay",
      caption: "Payroll close",
      icon: WalletCards,
      tab: "payroll" as const,
    },
    {
      label: "Review",
      caption: "KPI & compliance",
      icon: GaugeCircle,
      tab: (canManage ? "config" : "employees") as typeof activeTab,
    },
  ];

  const actionQueue = [
    {
      label: "Leave requests awaiting approval",
      count: hrCommandStats.pendingLeaves,
      tab: "leaves" as const,
      tone: hrCommandStats.pendingLeaves > 0 ? "warning" : "success",
    },
    {
      label: "Payroll drafts pending process",
      count: hrCommandStats.pendingPayrolls,
      tab: "payroll" as const,
      tone: hrCommandStats.pendingPayrolls > 0 ? "warning" : "success",
    },
    {
      label: "Attendance exceptions today",
      count: hrCommandStats.lateToday + hrCommandStats.absentToday,
      tab: "attendance" as const,
      tone:
        hrCommandStats.lateToday + hrCommandStats.absentToday > 0
          ? "warning"
          : "success",
    },
  ];

  const filteredEmployees = useMemo(() => {
    const search = employeeSearch.trim().toLowerCase();
    return employees.filter((employee) => {
      const status = normalizeStatus(employee.status);
      const statusMatch =
        employeeStatusFilter === "ALL" ||
        (employeeStatusFilter === "ACTIVE" && status !== "INACTIVE") ||
        (employeeStatusFilter === "INACTIVE" && status === "INACTIVE");
      if (!statusMatch) return false;
      if (!search) return true;
      return [
        employee.employee_code,
        employee.employee_name,
        employee.designation,
        employee.department,
        employee.email,
        employee.contact_number,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    });
  }, [employees, employeeSearch, employeeStatusFilter]);

  const employeeDepartments = useMemo(
    () =>
      new Set(
        employees
          .map((employee) => String(employee.department || "").trim())
          .filter(Boolean),
      ).size,
    [employees],
  );

  const attendanceSummary = useMemo(() => {
    const present = attendance.filter((record) =>
      ["PRESENT", "LATE", "HALF_DAY", "WORK_FROM_HOME"].includes(
        normalizeStatus(record.status),
      ),
    ).length;
    const late = attendance.filter(
      (record) => normalizeStatus(record.status) === "LATE",
    ).length;
    const absent = attendance.filter((record) =>
      ["ABSENT", "LEAVE"].includes(normalizeStatus(record.status)),
    ).length;
    const missingOut = attendance.filter(
      (record) => record.check_in_time && !record.check_out_time,
    ).length;
    const totalHours = attendance.reduce(
      (sum, record) => sum + Number(record.work_hours || 0),
      0,
    );
    return {
      present,
      late,
      absent,
      missingOut,
      totalHours,
      records: attendance.length,
    };
  }, [attendance]);

  const sortedAttendance = useMemo(() => {
    const getTime = (value?: string | null) => {
      if (!value) return null;
      const time = new Date(value).getTime();
      return Number.isFinite(time) ? time : null;
    };

    const getComparableValue = (record: AttendanceRecord) => {
      switch (attendanceSort.key) {
        case "employee":
          return record.employee_name || record.employee_code || "";
        case "date":
          return getTime(record.attendance_date);
        case "check_in":
          return getTime(record.check_in_time);
        case "check_out":
          return getTime(record.check_out_time);
        case "hours":
          return Number(record.work_hours || 0);
        case "pay_days":
          return getAttendancePayDayCredit(record);
        case "travel_per_diem":
          return getAttendanceTravelPerDiemAmount(record);
        case "status":
          return normalizeStatus(record.status);
        default:
          return "";
      }
    };

    return [...attendance].sort((a, b) => {
      const left = getComparableValue(a);
      const right = getComparableValue(b);
      const directionMultiplier = attendanceSort.direction === "asc" ? 1 : -1;

      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;

      if (typeof left === "number" && typeof right === "number") {
        if (left !== right) return (left - right) * directionMultiplier;
      } else {
        const result = String(left).localeCompare(String(right), undefined, {
          numeric: true,
          sensitivity: "base",
        });
        if (result !== 0) return result * directionMultiplier;
      }

      const leftDate = getTime(a.attendance_date) || 0;
      const rightDate = getTime(b.attendance_date) || 0;
      if (leftDate !== rightDate) return rightDate - leftDate;
      return String(a.id || "").localeCompare(String(b.id || ""));
    });
  }, [attendance, attendanceSort, getAttendancePayDayCredit]);

  useEffect(() => {
    try {
      const savedWidths = window.localStorage.getItem(
        "hr-attendance-column-widths",
      );
      if (!savedWidths) return;
      const parsedWidths = JSON.parse(savedWidths) as Partial<
        Record<AttendanceColumnKey, unknown>
      >;
      setAttendanceColumnWidths((current) => {
        const next = { ...current };
        (
          Object.keys(DEFAULT_ATTENDANCE_COLUMN_WIDTHS) as AttendanceColumnKey[]
        ).forEach((key) => {
          const width = Number(parsedWidths[key]);
          if (Number.isFinite(width) && width >= 80 && width <= 600)
            next[key] = width;
        });
        return next;
      });
    } catch {
      // A malformed browser preference must never block the attendance register.
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      "hr-attendance-column-widths",
      JSON.stringify(attendanceColumnWidths),
    );
  }, [attendanceColumnWidths]);

  const attendanceColumnCount =
    1 +
    (isEmployeePortal ? 0 : 1) +
    7 +
    (isEmployeePortal ? 0 : 1) +
    (!isEmployeePortal && canCorrectAttendance ? 1 : 0);

  const attendanceVisibleColumns: AttendanceColumnKey[] = [
    "details",
    ...(!isEmployeePortal ? (["employee"] as AttendanceColumnKey[]) : []),
    "date",
    "check_in",
    "check_out",
    "hours",
    "pay_days",
    "travel_per_diem",
    "status",
    ...(!isEmployeePortal ? (["evidence"] as AttendanceColumnKey[]) : []),
    ...(!isEmployeePortal && canCorrectAttendance
      ? (["actions"] as AttendanceColumnKey[])
      : []),
  ];

  const toggleAttendanceSort = (key: AttendanceSortKey) => {
    setAttendanceSort((previous) => ({
      key,
      direction:
        previous.key === key
          ? previous.direction === "asc"
            ? "desc"
            : "asc"
          : key === "date"
            ? "desc"
            : "asc",
    }));
  };

  const handleReturnToOffice = async () => {
    try {
      setCheckingIn(true);
      setLocationError(null);
      const position = await getCurrentPosition();
      const address = await reverseGeocodeLocation(position);
      const outsideByGeoFence =
        isPositionOutsideOfficeGeofence(position) ?? false;
      await apiClient.post("/hr/attendance/return", {
        lat: position.lat,
        lng: position.lng,
        accuracy: position.accuracy,
        location: address,
        isOutsideZone: outsideByGeoFence,
      });
      await fetchTodayAttendance();
      alert("Returned to office successfully!");
    } catch (err: any) {
      const message = getAttendanceLocationErrorMessage(err, "check in");
      setLocationError(message);
      alert(message);
    } finally {
      setCheckingIn(false);
    }
  };

  const handleApproveMeritDemerit = async (
    recordId: string,
    approved: boolean,
  ) => {
    if (!selectedEmployee?.id || !canApproveHR) return;
    setLoading(true);
    try {
      await apiClient.put(
        `/hr/employees/${selectedEmployee.id}/merits-demerits/${recordId}/approval`,
        { approved },
      );
      const md = await apiClient.get<any>(
        `/hr/employees/${selectedEmployee.id}/merits-demerits`,
      );
      setMeritsDemerits(Array.isArray(md) ? md : md.data || []);
    } catch (err: any) {
      alert(err?.message || "Failed to update merit/demerit approval");
    } finally {
      setLoading(false);
    }
  };

  const startAttendanceColumnResize = (
    key: AttendanceColumnKey,
    event: ReactMouseEvent<HTMLSpanElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = attendanceColumnWidths[key];

    const onMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = Math.max(
        80,
        Math.min(600, startWidth + moveEvent.clientX - startX),
      );
      setAttendanceColumnWidths((current) => ({
        ...current,
        [key]: nextWidth,
      }));
    };
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const renderAttendanceResizeHandle = (
    key: AttendanceColumnKey,
    label: string,
  ) => (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label} column`}
      title="Drag to resize column"
      onMouseDown={(event) => startAttendanceColumnResize(key, event)}
      className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize select-none border-r border-transparent hover:border-[#8B6F47] hover:bg-[#E8DCC4]/70"
    />
  );

  const renderAttendanceStaticHeader = (
    key: Extract<AttendanceColumnKey, "details" | "evidence" | "actions">,
    label: string,
    align: "left" | "right" = "left",
  ) => (
    <th
      className={`relative px-4 py-3 text-xs font-bold uppercase tracking-wide text-[#6F5A49] ${align === "right" ? "text-right" : "text-left"}`}
    >
      {label}
      {renderAttendanceResizeHandle(key, label)}
    </th>
  );

  const renderAttendanceSortHeader = (
    key: AttendanceSortKey,
    label: string,
    align: "left" | "right" = "left",
  ) => (
    <th
      className={`relative px-4 py-3 text-xs font-bold uppercase tracking-wide text-[#6F5A49] ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={() => toggleAttendanceSort(key)}
        className={`inline-flex items-center gap-1.5 rounded-lg px-1 py-1 hover:bg-[#EFE3CF] ${
          align === "right" ? "justify-end" : "justify-start"
        }`}
        aria-label={`Sort attendance by ${label}`}
      >
        {label}
        {attendanceSort.key === key ? (
          <span className="text-[10px] text-[#8B6F47]">
            {attendanceSort.direction === "asc" ? "↑" : "↓"}
          </span>
        ) : (
          <ArrowDownUp className="h-3 w-3 text-[#B5A592]" />
        )}
      </button>
      {renderAttendanceResizeHandle(key, label)}
    </th>
  );

  const leaveSummary = useMemo(() => {
    const pending = leaves.filter((leave) =>
      isPendingLeaveStatus(leave.status),
    ).length;
    const approved = leaves.filter(
      (leave) => normalizeStatus(leave.status) === "APPROVED",
    ).length;
    const rejected = leaves.filter(
      (leave) => normalizeStatus(leave.status) === "REJECTED",
    ).length;
    const cancelled = leaves.filter(
      (leave) => normalizeStatus(leave.status) === "CANCELLED",
    ).length;
    const totalDays = leaves.reduce(
      (sum, leave) => sum + Number(leave.total_days || 0),
      0,
    );
    return {
      pending,
      approved,
      rejected,
      cancelled,
      totalDays,
      records: leaves.length,
    };
  }, [leaves]);

  const leaveStatusFilters = useMemo(
    () => [
      {
        key: "ALL" as const,
        label: "All",
        count: leaveSummary.records,
        tone: "neutral",
      },
      {
        key: "PENDING" as const,
        label: "Pending",
        count: leaveSummary.pending,
        tone: "warning",
      },
      {
        key: "APPROVED" as const,
        label: "Approved",
        count: leaveSummary.approved,
        tone: "success",
      },
      {
        key: "REJECTED" as const,
        label: "Rejected",
        count: leaveSummary.rejected,
        tone: "danger",
      },
      {
        key: "CANCELLED" as const,
        label: "Cancelled",
        count: leaveSummary.cancelled,
        tone: "neutral",
      },
    ],
    [leaveSummary],
  );

  const filteredLeaves = useMemo(() => {
    if (leaveStatusFilter === "ALL") return leaves;
    if (leaveStatusFilter === "PENDING")
      return leaves.filter((leave) => isPendingLeaveStatus(leave.status));
    return leaves.filter(
      (leave) => normalizeStatus(leave.status) === leaveStatusFilter,
    );
  }, [leaveStatusFilter, leaves]);

  const payrollSummary = useMemo(() => {
    const monthlyGross = monthlyPayrolls.reduce(
      (sum, row) => sum + Number(row.gross_salary || 0),
      0,
    );
    const monthlyNet = monthlyPayrolls.reduce(
      (sum, row) => sum + Number(row.net_salary || 0),
      0,
    );
    const amountPaid = monthlyPayrolls.reduce(
      (sum, row) => sum + Number(row.amount_paid || 0),
      0,
    );
    const holdAmount = monthlyPayrolls.reduce(
      (sum, row) => sum + Number(row.monthly_hold || 0),
      0,
    );
    const draft = monthlyPayrolls.filter(
      (row) => normalizeStatus(row.status) === "DRAFT",
    ).length;
    const processed = monthlyPayrolls.filter((row) =>
      ["PROCESSED", "PAID"].includes(normalizeStatus(row.status)),
    ).length;
    return {
      monthlyGross,
      monthlyNet,
      amountPaid,
      holdAmount,
      draft,
      processed,
      payslips: payslips.length,
      salaryComponents: salaryComponents.length,
      runs: payrollRuns.length,
    };
  }, [
    monthlyPayrolls,
    payslips.length,
    salaryComponents.length,
    payrollRuns.length,
  ]);

  const formatCurrency = (value: number) =>
    `Rs. ${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  const todayPunches = todayAttendance?.punches || [];
  const isCurrentlyInOffice =
    Boolean(todayAttendance?.check_in_time) &&
    !todayAttendance?.check_out_time &&
    (todayPunches.length === 0 ||
      todayPunches[todayPunches.length - 1]?.punch_type === "IN");
  const isCurrentlyOut =
    Boolean(todayAttendance?.check_in_time) &&
    !todayAttendance?.check_out_time &&
    todayPunches[todayPunches.length - 1]?.punch_type === "OUT";

  return (
    <div
      className={`space-y-4 ${isEmployeePortal ? "px-3 pb-24 pt-3 md:p-5 md:pb-5" : "p-4 sm:p-5"}`}
    >
      {isEmployeePortal && (
        <div className="sticky top-0 z-30 -mx-3 -mt-3 flex items-center justify-between gap-2 border-b border-[#E8DCC4] bg-[#FFFDF8]/95 px-3 py-3 shadow-sm backdrop-blur md:hidden">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wide text-[#8B6F47]">
              Employee App
            </div>
            <div className="truncate text-sm font-bold text-[#2F1B12]">
              {getAttendanceEmployeeName()}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => navigateToHrTab("employees")}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#D8C4A8] bg-white px-3 text-xs font-bold text-[#4A3426] shadow-sm hover:bg-[#F5EFE3]"
              aria-label="Open my profile"
            >
              <UserCheck className="h-4 w-4" />
              Profile
            </button>
            {canOpenBackOfficeMenu && (
              <button
                type="button"
                onClick={() => router.push(backOfficeMenuHref)}
                className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[#D8C4A8] bg-white px-2.5 text-[#4A3426] shadow-sm hover:bg-[#F5EFE3]"
                aria-label="Open application menu"
                title="Menu"
              >
                <LayoutDashboard className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={handleEmployeeLogout}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 text-xs font-bold text-red-700 shadow-sm hover:bg-red-50"
              aria-label="Log out"
            >
              <LogOut className="h-4 w-4" />
              Log out
            </button>
          </div>
        </div>
      )}
      <div
        className={`border border-[#E8DCC4] bg-white ${isEmployeePortal ? "hidden md:block" : ""}`}
      >
        <div className="flex flex-col gap-3 border-b border-[#E8DCC4] px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
              Human Resources
            </div>
            <h1 className="mt-1 text-2xl font-bold text-[#3E2A1F]">
              {isEmployeePortal ? "Employee Self-Service" : "HR Management"}
            </h1>
            <p className="mt-1 max-w-4xl text-sm text-[#6F5A49]">
              {isEmployeePortal
                ? "Employee workspace for attendance, leave, holidays, documents, and salary slips."
                : "Management workspace for employee master data, attendance governance, leave approvals, payroll, KPI, and HR configuration."}
            </p>
          </div>
          <div
            className={`flex-wrap items-center gap-2 ${isEmployeePortal ? "hidden md:flex" : "flex"}`}
          >
            {sectionOptions.map((section) => {
              const Icon = section.icon;
              const active = activeSection === section.key;
              return (
                <button
                  key={section.key}
                  type="button"
                  onClick={() => {
                    if (!section.enabled) return;
                    const params = new URLSearchParams(searchParams.toString());
                    params.set("section", section.key);
                    if (
                      !params.get("tab") ||
                      (section.key === "employees" &&
                        params.get("tab") === "config")
                    ) {
                      params.set(
                        "tab",
                        section.key === "employees"
                          ? "attendance"
                          : "dashboard",
                      );
                    }
                    const targetPath =
                      section.key === "employees"
                        ? "/dashboard/hr/employees"
                        : "/dashboard/hr/management";
                    router.push(`${targetPath}?${params.toString()}`);
                    setActiveSection(section.key);
                  }}
                  disabled={!section.enabled}
                  title={
                    section.enabled
                      ? section.description
                      : "You do not have access to HR Management"
                  }
                  className={`flex min-h-10 items-center gap-2 border px-3 text-sm font-semibold transition-colors ${
                    active
                      ? "border-[#8B6F47] bg-[#8B6F47] text-white"
                      : section.enabled
                        ? "border-[#D8C4A8] bg-[#FAF9F6] text-[#4A3426] hover:bg-[#F5EFE3]"
                        : "cursor-not-allowed border-[#E8DCC4] bg-[#F7F3EA] text-[#B5A592]"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{section.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-col gap-3 px-4 py-2.5 xl:flex-row xl:items-center xl:justify-between">
          <label className="min-w-0 text-xs font-bold uppercase tracking-wide text-[#7A6555]">
            <span className="block mb-1">HR workspace</span>
            <select
              value={activeTab}
              onChange={(event) =>
                navigateToHrTab(event.target.value as typeof activeTab)
              }
              className="min-w-56 rounded-md border border-[#D8C4A8] bg-white px-3 py-2 text-sm font-semibold normal-case tracking-normal text-[#3E2A1F]"
            >
              {activeTabs.map((tab) => (
                <option key={tab.key} value={tab.key}>
                  {tab.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {!isEmployeePortal && activeTab === "employees" && canCreateHR && (
              <button
                onClick={() => setShowEmployeeForm(true)}
                className="inline-flex min-h-10 items-center gap-2 bg-[#8B6F47] px-4 text-sm font-semibold text-white hover:bg-[#6F4E37]"
              >
                <Plus className="h-4 w-4" />
                New Employee
              </button>
            )}
            {!isEmployeePortal && activeTab === "attendance" && (
              <>
                {canManageAttendance && (
                  <>
                    <button
                      onClick={() => setShowAttendanceForm(true)}
                      className="inline-flex min-h-10 items-center gap-2 bg-[#8B6F47] px-4 text-sm font-semibold text-white hover:bg-[#6F4E37]"
                    >
                      <Plus className="h-4 w-4" />
                      Record Manual Attendance
                    </button>
                    <button
                      onClick={() => {
                        setAttendanceImportText("");
                        setAttendanceImportResult("");
                        setShowAttendanceImport(true);
                      }}
                      className="inline-flex min-h-10 items-center gap-2 border border-[#D8C4A8] bg-white px-4 text-sm font-semibold text-[#4A3426] hover:bg-[#FAF9F6]"
                    >
                      <FileText className="h-4 w-4" />
                      Import Biometric
                    </button>
                  </>
                )}
              </>
            )}
            {!isEmployeePortal && activeTab === "holidays" && canCreateHR && (
              <button
                onClick={() => openHolidayForm()}
                className="inline-flex min-h-10 items-center gap-2 bg-[#8B6F47] px-4 text-sm font-semibold text-white hover:bg-[#6F4E37]"
              >
                <Plus className="h-4 w-4" />
                Add Holiday
              </button>
            )}
          </div>
        </div>
      </div>

      {activeTab === "dashboard" && (
        <section className="overflow-hidden rounded-2xl border border-[#E8DCC4] bg-white shadow-sm">
          <div className="border-b border-[#E8DCC4] bg-gradient-to-r from-[#FFF8EA] via-white to-[#F7F3EA] px-5 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full border border-[#E8DCC4] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                    <LayoutDashboard className="h-3.5 w-3.5" />
                    HR Command Center
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full bg-[#ECFDF3] px-3 py-1 text-xs font-semibold text-[#027A48]">
                    <Sparkles className="h-3.5 w-3.5" />
                    SAP-style workbench
                  </span>
                </div>
                <h2 className="mt-3 text-2xl font-bold text-[#3E2A1F]">
                  People operations cockpit
                </h2>
                <p className="mt-1 max-w-3xl text-sm text-[#6F5A49]">
                  A single control view for headcount, attendance exceptions,
                  leave approvals, payroll readiness, holidays, and HR
                  master-data governance.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={fetchHrCommandCenter}
                  disabled={hrCommandLoading}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#D8C4A8] bg-white px-4 text-sm font-semibold text-[#4A3426] hover:bg-[#FAF9F6] disabled:opacity-60"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${hrCommandLoading ? "animate-spin" : ""}`}
                  />
                  Refresh
                </button>
                {!isEmployeePortal && canCreateHR && (
                  <button
                    type="button"
                    onClick={() => setShowEmployeeForm(true)}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#8B6F47] px-4 text-sm font-semibold text-white hover:bg-[#6F4E37]"
                  >
                    <UserPlus className="h-4 w-4" />
                    Add Employee
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 divide-y divide-[#E8DCC4] md:grid-cols-5 md:divide-x md:divide-y-0">
            {commandKpis.map((kpi) => {
              const Icon = kpi.icon;
              const toneClass =
                kpi.tone === "success"
                  ? "bg-[#ECFDF3] text-[#027A48]"
                  : kpi.tone === "warning"
                    ? "bg-[#FFFAEB] text-[#B54708]"
                    : kpi.tone === "info"
                      ? "bg-[#EFF8FF] text-[#175CD3]"
                      : "bg-[#F7F3EA] text-[#6F5A49]";
              return (
                <button
                  key={kpi.label}
                  type="button"
                  onClick={() => {
                    if (
                      kpi.label.includes("Attendance") ||
                      kpi.label.includes("Present")
                    )
                      navigateToHrTab("attendance");
                    else if (kpi.label.includes("Leave"))
                      navigateToHrTab("leaves");
                    else if (kpi.label.includes("Payroll"))
                      navigateToHrTab("payroll");
                    else if (kpi.label.includes("Holiday"))
                      navigateToHrTab("holidays");
                    else navigateToHrTab("dashboard");
                  }}
                  className="group flex min-h-[132px] flex-col items-start justify-between p-4 text-left transition-colors hover:bg-[#FAF9F6]"
                >
                  <div className="flex w-full items-start justify-between gap-3">
                    <span className={`rounded-xl p-2 ${toneClass}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <ArrowRight className="h-4 w-4 text-[#B5A592] opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                  <div>
                    <div className="text-3xl font-bold text-[#2F1B12]">
                      {formatCount(kpi.value)}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-[#4A3426]">
                      {kpi.label}
                    </div>
                    <div className="mt-1 text-xs text-[#7A6555]">
                      {kpi.helper}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="grid gap-5 border-t border-[#E8DCC4] bg-[#FAF9F6] p-5 xl:grid-cols-[1.7fr_1fr]">
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {workCenters.map((center) => {
                  const Icon = center.icon;
                  const disabled = Boolean(center.disabled);
                  const toneClass =
                    center.tone === "success"
                      ? "border-[#A6F4C5] bg-[#F6FEF9]"
                      : center.tone === "warning"
                        ? "border-[#FEDF89] bg-[#FFFCF5]"
                        : center.tone === "info"
                          ? "border-[#B2DDFF] bg-[#F5FAFF]"
                          : "border-[#E8DCC4] bg-white";
                  return (
                    <button
                      key={center.title}
                      type="button"
                      disabled={disabled}
                      onClick={() => navigateToHrTab(center.tab)}
                      className={`group min-h-[184px] rounded-xl border p-4 text-left shadow-sm transition-all ${
                        disabled
                          ? "cursor-not-allowed opacity-60"
                          : `hover:-translate-y-0.5 hover:shadow-md ${toneClass}`
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="rounded-xl bg-white p-2 text-[#8B6F47] shadow-sm ring-1 ring-[#E8DCC4]">
                          <Icon className="h-5 w-5" />
                        </span>
                        <span className="rounded-full border border-[#E8DCC4] bg-white px-2.5 py-1 text-xs font-semibold text-[#6F5A49]">
                          {center.status}
                        </span>
                      </div>
                      <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                        {center.label}
                      </div>
                      <h3 className="mt-1 text-lg font-bold text-[#2F1B12]">
                        {center.title}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-[#6F5A49]">
                        {center.description}
                      </p>
                      <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#8B6F47]">
                        Open workspace
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="rounded-xl border border-[#E8DCC4] bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                      Standard HR process flow
                    </div>
                    <h3 className="text-lg font-bold text-[#2F1B12]">
                      Hire to retire controls
                    </h3>
                  </div>
                  <div className="text-xs text-[#7A6555]">
                    Last updated: {hrCommandStats.lastUpdated || "-"}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-5">
                  {hrWorkflow.map((step, index) => {
                    const Icon = step.icon;
                    const disabled = step.tab === "config" && !canManage;
                    return (
                      <button
                        key={step.label}
                        type="button"
                        disabled={disabled}
                        onClick={() => navigateToHrTab(step.tab)}
                        className={`group relative rounded-xl border border-[#E8DCC4] bg-[#FAF9F6] p-3 text-left transition-all ${
                          disabled
                            ? "cursor-not-allowed opacity-60"
                            : "hover:-translate-y-0.5 hover:border-[#B9975B] hover:bg-[#FFF8EA] hover:shadow-sm"
                        }`}
                        title={
                          disabled
                            ? "You do not have access to Master Config"
                            : `Open ${step.label} workspace`
                        }
                      >
                        {index < hrWorkflow.length - 1 && (
                          <div className="absolute -right-3 top-1/2 hidden h-px w-3 bg-[#D8C4A8] md:block" />
                        )}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="rounded-lg bg-white p-2 text-[#8B6F47] ring-1 ring-[#E8DCC4]">
                              <Icon className="h-4 w-4" />
                            </span>
                            <div>
                              <div className="font-bold text-[#2F1B12]">
                                {step.label}
                              </div>
                              <div className="text-xs text-[#7A6555]">
                                {step.caption}
                              </div>
                            </div>
                          </div>
                          {!disabled && (
                            <ArrowRight className="h-4 w-4 shrink-0 text-[#B5A592] opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <aside className="space-y-4">
              <div className="rounded-xl border border-[#E8DCC4] bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                      Action required
                    </div>
                    <h3 className="text-lg font-bold text-[#2F1B12]">
                      {formatCount(openActionCount)} open HR actions
                    </h3>
                  </div>
                  <span
                    className={`rounded-xl p-2 ${openActionCount > 0 ? "bg-[#FFFAEB] text-[#B54708]" : "bg-[#ECFDF3] text-[#027A48]"}`}
                  >
                    {openActionCount > 0 ? (
                      <AlertTriangle className="h-5 w-5" />
                    ) : (
                      <CheckCircle2 className="h-5 w-5" />
                    )}
                  </span>
                </div>
                <div className="mt-4 space-y-3">
                  {actionQueue.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => navigateToHrTab(item.tab)}
                      className="flex w-full items-center justify-between rounded-lg border border-[#E8DCC4] bg-[#FAF9F6] px-3 py-3 text-left hover:bg-[#F5EFE3]"
                    >
                      <span className="text-sm font-semibold text-[#4A3426]">
                        {item.label}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                          item.tone === "warning"
                            ? "bg-[#FFFAEB] text-[#B54708]"
                            : "bg-[#ECFDF3] text-[#027A48]"
                        }`}
                      >
                        {formatCount(item.count)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-[#E8DCC4] bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="rounded-xl bg-[#EFF8FF] p-2 text-[#175CD3]">
                      <ShieldCheck className="h-5 w-5" />
                    </span>
                    <div>
                      <div className="text-sm font-bold text-[#2F1B12]">
                        HR governance snapshot
                      </div>
                      <p className="mt-1 text-sm leading-6 text-[#6F5A49]">
                        Control checks for approvals, attendance exceptions,
                        payroll readiness, and active employee masters.
                      </p>
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                      openActionCount > 0
                        ? "bg-[#FFFAEB] text-[#B54708]"
                        : "bg-[#ECFDF3] text-[#027A48]"
                    }`}
                  >
                    {openActionCount > 0 ? "Review" : "Clear"}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  {[
                    {
                      label: "Leave approvals",
                      value: hrCommandStats.pendingLeaves,
                      helper: "pending manager action",
                      icon: ClipboardCheck,
                      tab: "leaves" as const,
                    },
                    {
                      label: "Attendance exceptions",
                      value:
                        hrCommandStats.lateToday + hrCommandStats.absentToday,
                      helper: "late / absent today",
                      icon: Clock3,
                      tab: "attendance" as const,
                    },
                    {
                      label: "Payroll drafts",
                      value: hrCommandStats.pendingPayrolls,
                      helper: "awaiting process",
                      icon: WalletCards,
                      tab: "payroll" as const,
                    },
                    {
                      label: "Active masters",
                      value: hrCommandStats.activeEmployees,
                      helper: `${formatCount(hrCommandStats.inactiveEmployees)} inactive / exited`,
                      icon: Users,
                      tab: "employees" as const,
                    },
                  ].map((item) => {
                    const Icon = item.icon;
                    const needsReview =
                      item.label !== "Active masters" && item.value > 0;
                    return (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => navigateToHrTab(item.tab)}
                        className={`rounded-lg border p-3 text-left transition-colors ${
                          needsReview
                            ? "border-[#FEDF89] bg-[#FFFCF5] hover:bg-[#FFFAEB]"
                            : "border-[#D8EAD5] bg-[#F6FEF9] hover:bg-[#ECFDF3]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`rounded-lg p-1.5 ${needsReview ? "bg-[#FFFAEB] text-[#B54708]" : "bg-[#ECFDF3] text-[#027A48]"}`}
                          >
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="text-xl font-bold text-[#2F1B12]">
                            {formatCount(item.value)}
                          </span>
                        </div>
                        <div className="mt-2 font-semibold text-[#4A3426]">
                          {item.label}
                        </div>
                        <div className="mt-1 text-xs text-[#7A6555]">
                          {item.helper}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </aside>
          </div>
        </section>
      )}

      {/* Master Config Tab */}
      {!isEmployeePortal && activeTab === "config" && (
        <div className="space-y-5">
          <section className="overflow-hidden rounded-2xl border border-[#E8DCC4] bg-white shadow-sm">
            <div className="border-b border-[#E8DCC4] bg-gradient-to-r from-[#FFF8EA] via-white to-[#F7F3EA] p-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-[#E8DCC4] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                    <Settings2 className="h-3.5 w-3.5" />
                    HR control tower
                  </div>
                  <h2 className="mt-3 text-2xl font-bold text-[#2F1B12]">
                    Master configuration
                  </h2>
                  <p className="mt-1 max-w-4xl text-sm leading-6 text-[#6F5A49]">
                    Maintain KPI rules, merit/demerit categories, approval
                    behaviour, and payroll governance masters. This tab is
                    intentionally separated from the dashboard so configuration
                    work stays focused.
                  </p>
                  <div className="mt-3 rounded-xl border border-[#E8DCC4] bg-white/80 p-3 text-xs leading-5 text-[#6F5A49]">
                    <span className="font-bold text-[#4A3426]">
                      Access standard:
                    </span>{" "}
                    HR/Admin maintains KPI and merit/demerit masters; managers
                    with HR rights may record employee merits or demerits;
                    employees view their own HR history but do not maintain
                    policy masters.
                  </div>
                </div>
                <div className="grid min-w-[280px] grid-cols-2 gap-3">
                  <div className="rounded-xl border border-[#B2DDFF] bg-[#F5FAFF] p-3">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[#175CD3]">
                      <GaugeCircle className="h-4 w-4" />
                      KPIs
                    </div>
                    <div className="mt-2 text-2xl font-bold text-[#2F1B12]">
                      {formatCount(kpiDefinitions.length)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#A6F4C5] bg-[#F6FEF9] p-3">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[#027A48]">
                      <BadgeCheck className="h-4 w-4" />
                      Merit rules
                    </div>
                    <div className="mt-2 text-2xl font-bold text-[#2F1B12]">
                      {formatCount(meritDemeritTypes.length)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 bg-[#FAF9F6] p-5 md:grid-cols-3">
              <div className="rounded-xl border border-[#E8DCC4] bg-white p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-[#4A3426]">
                  <ShieldCheck className="h-4 w-4 text-[#027A48]" />
                  Policy governance
                </div>
                <p className="mt-2 text-sm leading-6 text-[#6F5A49]">
                  Define measurable HR controls with active/inactive status and
                  clear thresholds. Inactive or exited employees stay in history
                  but should be excluded from new payroll and attendance
                  operations.
                </p>
              </div>
              <div className="rounded-xl border border-[#E8DCC4] bg-white p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-[#4A3426]">
                  <GaugeCircle className="h-4 w-4 text-[#175CD3]" />
                  Performance scoring
                </div>
                <p className="mt-2 text-sm leading-6 text-[#6F5A49]">
                  KPI thresholds support excellent, good, and acceptable bands
                  for performance review, with auto-calculated attendance KPIs
                  and manual manager inputs where policy allows.
                </p>
              </div>
              <div className="rounded-xl border border-[#E8DCC4] bg-white p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-[#4A3426]">
                  <FileWarning className="h-4 w-4 text-[#B54708]" />
                  Audit readiness
                </div>
                <p className="mt-2 text-sm leading-6 text-[#6F5A49]">
                  Merit and demerit masters keep HR decisions traceable and
                  standardized, including who recorded the event and when it was
                  applied.
                </p>
              </div>
            </div>

            <div className="border-t border-[#E8DCC4] bg-white p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                    Merit / demerit operating standard
                  </div>
                  <h3 className="mt-1 text-lg font-bold text-[#2F1B12]">
                    How HR performance events should be used
                  </h3>
                  <p className="mt-1 max-w-4xl text-sm leading-6 text-[#6F5A49]">
                    Merits are positive employee events such as excellent
                    attendance, quality work, customer appreciation, or
                    initiative. Demerits are controlled negative events such as
                    repeated lateness, absence, quality issue, safety violation,
                    or policy breach. Both should remain in the employee history
                    with points, date, reason, and creator trail.
                  </p>
                </div>
                <div className="rounded-xl border border-[#D8C4A8] bg-[#FFFCF7] px-4 py-3 text-xs leading-5 text-[#6F5A49] lg:max-w-sm">
                  <span className="font-bold text-[#4A3426]">
                    Recommended governance:
                  </span>{" "}
                  calculate measurable KPIs, manually record exceptional events
                  with evidence, then approve or reject them. Records are
                  voided—not deleted—to preserve the audit trail.
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-4">
                {[
                  [
                    "Define masters",
                    "Create KPI definitions and merit/demerit types with category, points, severity and approval rule.",
                    Settings2,
                  ],
                  [
                    "Capture event",
                    "Manager/HR records the event against an employee, with date, description and points.",
                    ClipboardCheck,
                  ],
                  [
                    "Review score",
                    "KPI scores inform an appraisal review; they never automatically create a reward or disciplinary action.",
                    GaugeCircle,
                  ],
                  [
                    "Audit trail",
                    "Employee history retains the recorder, approver, evidence reference and any voided record.",
                    FileWarning,
                  ],
                ].map(([title, body, Icon]) => (
                  <div
                    key={String(title)}
                    className="rounded-xl border border-[#E8DCC4] bg-[#FAF9F6] p-4"
                  >
                    <div className="flex items-center gap-2 text-sm font-bold text-[#4A3426]">
                      <Icon className="h-4 w-4 text-[#8B6F47]" />
                      {String(title)}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-[#6F5A49]">
                      {String(body)}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-[#A6F4C5] bg-[#F6FEF9] p-4">
                  <div className="text-sm font-bold text-[#027A48]">
                    Merit examples
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[#05603A]">
                    Excellent attendance, high productivity, quality
                    improvement, on-time delivery, customer appreciation,
                    teamwork.
                  </p>
                </div>
                <div className="rounded-xl border border-[#FECDCA] bg-[#FEF3F2] p-4">
                  <div className="text-sm font-bold text-[#B42318]">
                    Demerit examples
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[#912018]">
                    Repeated late coming, unapproved absence, safety breach,
                    quality rejection, misconduct, missed responsibility.
                  </p>
                </div>
                <div className="rounded-xl border border-[#B2DDFF] bg-[#F5FAFF] p-4">
                  <div className="text-sm font-bold text-[#175CD3]">
                    Who can view / maintain
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[#1849A9]">
                    Employees view their own history. Managers/HR can record if
                    permitted. HR/Admin maintains masters and controls deletion.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* KPI Definitions Section */}
          <div className="overflow-hidden rounded-2xl border border-[#E8DCC4] bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-[#E8DCC4] bg-gradient-to-r from-white to-[#FAF9F6] p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                  Performance policy
                </div>
                <h2 className="mt-1 text-xl font-bold text-[#2F1B12]">
                  KPI definitions
                </h2>
                <p className="mt-1 text-sm text-[#6F5A49]">
                  Set measurement type, scoring thresholds, and auto-calculation
                  behaviour.
                </p>
              </div>
              {canCreateHR && (
                <div className="flex gap-2">
                  {(kpiDefinitions.length === 0 ||
                    meritDemeritTypes.length === 0) && (
                    <button
                      onClick={async () => {
                        try {
                          await apiClient.post(
                            "/hr/performance/seed-defaults",
                            {},
                          );
                          await fetchMasterConfig();
                        } catch (error: any) {
                          alert(
                            error?.message ||
                              "Failed to load performance policy",
                          );
                        }
                      }}
                      className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#8B6F47] px-4 text-sm font-semibold text-[#6F4E37] hover:bg-[#FAF9F6]"
                    >
                      Load standard policy
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setEditingKpi(null);
                      setKpiForm({
                        kpi_name: "",
                        kpi_category: "ATTENDANCE",
                        description: "",
                        measurement_type: "PERCENTAGE",
                        min_value: 0,
                        max_value: 100,
                        threshold_excellent: 90,
                        threshold_good: 75,
                        threshold_acceptable: 60,
                        auto_calculate: false,
                        is_active: true,
                      });
                      setShowKpiForm(true);
                    }}
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#8B6F47] px-4 text-sm font-semibold text-white hover:bg-[#6F4E37]"
                  >
                    <Plus className="h-4 w-4" /> Add KPI
                  </button>
                </div>
              )}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full divide-y divide-[#E8DCC4]">
                <thead className="bg-[#F7F3EA]">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                      KPI Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                      Category
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                      Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                      Thresholds
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                      Auto
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFE3CF] bg-white">
                  {kpiDefinitions.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center">
                        <div className="mx-auto flex max-w-md flex-col items-center">
                          <span className="rounded-full bg-[#F7F3EA] p-3 text-[#8B6F47]">
                            <GaugeCircle className="h-6 w-6" />
                          </span>
                          <h3 className="mt-3 text-base font-bold text-[#2F1B12]">
                            No KPI definitions configured
                          </h3>
                          <p className="mt-1 text-sm text-[#7A6555]">
                            Add KPI definitions to standardize employee
                            performance measurement.
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                  {kpiDefinitions.map((kpi) => (
                    <tr key={kpi.id} className="hover:bg-[#FAF9F6]">
                      <td className="px-6 py-4 text-sm font-bold text-[#2F1B12]">
                        {kpi.kpi_name}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span className="inline-flex rounded-full bg-[#EFF8FF] px-2.5 py-1 text-xs font-bold text-[#175CD3]">
                          {kpi.kpi_category}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm font-semibold text-[#4A3426]">
                        {kpi.measurement_type}
                      </td>
                      <td className="px-6 py-4 text-xs font-semibold text-[#6F5A49]">
                        Excellent {kpi.threshold_excellent} / Good{" "}
                        {kpi.threshold_good} / Acceptable{" "}
                        {kpi.threshold_acceptable}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${kpi.auto_calculate ? "bg-[#ECFDF3] text-[#027A48]" : "bg-[#F7F3EA] text-[#6F5A49]"}`}
                        >
                          {kpi.auto_calculate ? "Auto" : "Manual"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${kpi.is_active ? "bg-[#ECFDF3] text-[#027A48]" : "bg-[#F7F3EA] text-[#6F5A49]"}`}
                        >
                          {kpi.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm">
                        {canEditHR && (
                          <button
                            onClick={() => {
                              setEditingKpi(kpi);
                              setKpiForm(kpi);
                              setShowKpiForm(true);
                            }}
                            className="mr-3 font-semibold text-[#175CD3] hover:underline"
                          >
                            Edit
                          </button>
                        )}
                        {canDeleteHR && (
                          <button
                            onClick={async () => {
                              if (confirm("Delete this KPI?")) {
                                await apiClient.delete(
                                  `/hr/kpi-definitions/${kpi.id}`,
                                );
                                fetchMasterConfig();
                              }
                            }}
                            className="font-semibold text-[#B42318] hover:underline"
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Merit/Demerit Types Section */}
          <div className="overflow-hidden rounded-2xl border border-[#E8DCC4] bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-[#E8DCC4] bg-gradient-to-r from-white to-[#FAF9F6] p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                  Recognition & controls
                </div>
                <h2 className="mt-1 text-xl font-bold text-[#2F1B12]">
                  Merit & demerit types
                </h2>
                <p className="mt-1 text-sm text-[#6F5A49]">
                  Standardize positive and corrective HR events with points,
                  severity, and approval flags.
                </p>
              </div>
              {canCreateHR && (
                <button
                  onClick={() => {
                    setEditingMeritType(null);
                    setMeritTypeForm({
                      type_name: "",
                      record_type: "MERIT",
                      category: "ATTENDANCE",
                      description: "",
                      default_points: 10,
                      severity: "",
                      requires_approval: false,
                      is_active: true,
                    });
                    setShowMeritTypeForm(true);
                  }}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#8B6F47] px-4 text-sm font-semibold text-white hover:bg-[#6F4E37]"
                >
                  <Plus className="h-4 w-4" />
                  Add Type
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-[#E8DCC4]">
                <thead className="bg-[#F7F3EA]">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                      Type Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                      Record Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                      Category
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                      Points
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                      Severity
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFE3CF] bg-white">
                  {meritDemeritTypes.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center">
                        <div className="mx-auto flex max-w-md flex-col items-center">
                          <span className="rounded-full bg-[#F7F3EA] p-3 text-[#8B6F47]">
                            <BadgeCheck className="h-6 w-6" />
                          </span>
                          <h3 className="mt-3 text-base font-bold text-[#2F1B12]">
                            No merit or demerit types configured
                          </h3>
                          <p className="mt-1 text-sm text-[#7A6555]">
                            Add rule types to make HR recognition and corrective
                            actions consistent.
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                  {meritDemeritTypes.map((type) => (
                    <tr key={type.id} className="hover:bg-[#FAF9F6]">
                      <td className="px-6 py-4 text-sm font-bold text-[#2F1B12]">
                        {type.type_name}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${type.record_type === "MERIT" ? "bg-[#ECFDF3] text-[#027A48]" : "bg-[#FEF3F2] text-[#B42318]"}`}
                        >
                          {type.record_type}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span className="inline-flex rounded-full bg-[#EFF8FF] px-2.5 py-1 text-xs font-bold text-[#175CD3]">
                          {type.category}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm font-bold text-[#4A3426]">
                        {type.default_points > 0 ? "+" : ""}
                        {type.default_points}
                      </td>
                      <td className="px-6 py-4 text-sm font-semibold text-[#6F5A49]">
                        {type.severity || "-"}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${type.is_active ? "bg-[#ECFDF3] text-[#027A48]" : "bg-[#F7F3EA] text-[#6F5A49]"}`}
                        >
                          {type.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm">
                        {canEditHR && (
                          <button
                            onClick={() => {
                              setEditingMeritType(type);
                              setMeritTypeForm(type);
                              setShowMeritTypeForm(true);
                            }}
                            className="mr-3 font-semibold text-[#175CD3] hover:underline"
                          >
                            Edit
                          </button>
                        )}
                        {canDeleteHR && (
                          <button
                            onClick={async () => {
                              if (confirm("Delete this type?")) {
                                await apiClient.delete(
                                  `/hr/merit-demerit-types/${type.id}`,
                                );
                                fetchMasterConfig();
                              }
                            }}
                            className="font-semibold text-[#B42318] hover:underline"
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Employees Tab */}
      {activeTab === "employees" &&
        (isEmployeePortal ? (
          <div className="space-y-5">
            <section className="overflow-hidden rounded-2xl border border-[#E8DCC4] bg-white shadow-sm">
              <div className="border-b border-[#E8DCC4] bg-gradient-to-r from-[#FFF8EA] via-white to-[#F7F3EA] p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-[#E8DCC4] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                      <UserCheck className="h-3.5 w-3.5" />
                      Employee profile
                    </div>
                    <h2 className="mt-3 text-2xl font-bold text-[#2F1B12]">
                      {myEmployee?.employee_name || "My Profile"}
                    </h2>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-[#6F5A49]">
                      View your employee master details, HR documents, and
                      recognition records in one clean self-service workspace.
                    </p>
                  </div>
                  {myEmployee && (
                    <span
                      className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-bold ${getStatusColor(myEmployee.status)}`}
                    >
                      {myEmployee.status}
                    </span>
                  )}
                </div>
              </div>

              {!myEmployee ? (
                <div className="p-8 text-sm text-[#6F5A49]">
                  {error || "Loading your employee profile..."}
                </div>
              ) : (
                <div className="grid gap-4 bg-[#FAF9F6] p-5 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl border border-[#B2DDFF] bg-[#F5FAFF] p-4">
                    <div className="text-xs font-bold uppercase tracking-wide text-[#175CD3]">
                      Employee code
                    </div>
                    <div className="mt-2 text-lg font-bold text-[#2F1B12]">
                      {myEmployee.employee_code || "-"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#A6F4C5] bg-[#F6FEF9] p-4">
                    <div className="text-xs font-bold uppercase tracking-wide text-[#027A48]">
                      Department
                    </div>
                    <div className="mt-2 text-lg font-bold text-[#2F1B12]">
                      {myEmployee.department || "-"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#FEDF89] bg-[#FFFCF5] p-4">
                    <div className="text-xs font-bold uppercase tracking-wide text-[#B54708]">
                      Designation
                    </div>
                    <div className="mt-2 text-lg font-bold text-[#2F1B12]">
                      {myEmployee.designation || "-"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#E8DCC4] bg-white p-4">
                    <div className="text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                      Date of joining
                    </div>
                    <div className="mt-2 text-lg font-bold text-[#2F1B12]">
                      {myEmployee.date_of_joining
                        ? new Date(
                            myEmployee.date_of_joining,
                          ).toLocaleDateString("en-IN")
                        : "-"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#E8DCC4] bg-white p-4 md:col-span-2">
                    <div className="text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                      Email
                    </div>
                    <div className="mt-2 break-words text-sm font-semibold text-[#2F1B12]">
                      {myEmployee.email || "-"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#E8DCC4] bg-white p-4 md:col-span-2">
                    <div className="text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                      Contact number
                    </div>
                    <div className="mt-2 text-sm font-semibold text-[#2F1B12]">
                      {myEmployee.contact_number || "-"}
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className="overflow-hidden rounded-2xl border border-[#E8DCC4] bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-[#E8DCC4] bg-gradient-to-r from-white to-[#FAF9F6] p-5">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                    Document vault
                  </div>
                  <h2 className="mt-1 text-xl font-bold text-[#2F1B12]">
                    My Documents
                  </h2>
                </div>
                <span className="rounded-full border border-[#E8DCC4] bg-white px-3 py-1 text-xs font-semibold text-[#6F5A49]">
                  {formatCount(employeeDocuments.length)} files
                </span>
              </div>
              {employeeDocuments.length === 0 ? (
                <div className="p-10 text-center">
                  <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#F7F3EA] text-[#8B6F47]">
                    <FileText className="h-6 w-6" />
                  </span>
                  <h3 className="mt-3 text-base font-bold text-[#2F1B12]">
                    No documents found
                  </h3>
                  <p className="mt-1 text-sm text-[#7A6555]">
                    HR-uploaded documents will appear here for quick access.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-[#E8DCC4]">
                    <thead className="bg-[#F7F3EA]">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                          Type
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                          File
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                          Created
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EFE3CF] bg-white">
                      {employeeDocuments.map((doc) => (
                        <tr key={doc.id} className="hover:bg-[#FAF9F6]">
                          <td className="px-6 py-4 text-sm">
                            <span className="inline-flex rounded-full bg-[#EFF8FF] px-2.5 py-1 text-xs font-bold text-[#175CD3]">
                              {doc.doc_type}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm">
                            <a
                              href={doc.file_url}
                              target="_blank"
                              rel="noreferrer"
                              className="font-semibold text-[#8B6F47] hover:underline"
                            >
                              {doc.file_name || "Open"}
                            </a>
                          </td>
                          <td className="px-6 py-4 text-sm font-semibold text-[#4A3426]">
                            {new Date(doc.created_at).toLocaleDateString(
                              "en-IN",
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="overflow-hidden rounded-2xl border border-[#E8DCC4] bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-[#E8DCC4] bg-gradient-to-r from-white to-[#FAF9F6] p-5">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                    Recognition history
                  </div>
                  <h2 className="mt-1 text-xl font-bold text-[#2F1B12]">
                    Merits & Demerits
                  </h2>
                </div>
                <span className="rounded-full border border-[#E8DCC4] bg-white px-3 py-1 text-xs font-semibold text-[#6F5A49]">
                  {formatCount(meritsDemerits.length)} records
                </span>
              </div>
              {meritsDemerits.length === 0 ? (
                <div className="p-10 text-center">
                  <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#F7F3EA] text-[#8B6F47]">
                    <BadgeCheck className="h-6 w-6" />
                  </span>
                  <h3 className="mt-3 text-base font-bold text-[#2F1B12]">
                    No recognition records found
                  </h3>
                  <p className="mt-1 text-sm text-[#7A6555]">
                    Merit and demerit entries will appear here once HR records
                    them.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-[#E8DCC4]">
                    <thead className="bg-[#F7F3EA]">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                          Type
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                          Title
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                          Points
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                          Date
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EFE3CF] bg-white">
                      {meritsDemerits.map((rec) => (
                        <tr key={rec.id} className="hover:bg-[#FAF9F6]">
                          <td className="px-6 py-4 text-sm">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${normalizeText(rec.record_type) === "MERIT" ? "bg-[#ECFDF3] text-[#027A48]" : "bg-[#FEF3F2] text-[#B42318]"}`}
                            >
                              {rec.record_type}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm font-bold text-[#2F1B12]">
                            {rec.title}
                          </td>
                          <td className="px-6 py-4 text-sm font-semibold text-[#4A3426]">
                            {rec.points ?? "-"}
                          </td>
                          <td className="px-6 py-4 text-sm font-semibold text-[#4A3426]">
                            {new Date(rec.event_date).toLocaleDateString(
                              "en-IN",
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[#E8DCC4] bg-white shadow-sm">
            <div className="border-b border-[#E8DCC4] bg-gradient-to-r from-white to-[#FAF9F6] p-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                    Employee Central
                  </div>
                  <h2 className="mt-1 text-2xl font-bold text-[#2F1B12]">
                    Employee directory
                  </h2>
                  <p className="mt-1 max-w-3xl text-sm text-[#6F5A49]">
                    Govern employee master data, lifecycle status, role-linked
                    access, documents, payroll base data, and people records
                    from a single HR control list.
                  </p>
                  <div className="mt-3 rounded-xl border border-[#E8DCC4] bg-[#FAF9F6] p-3 text-xs leading-5 text-[#6F5A49]">
                    <span className="font-bold text-[#4A3426]">
                      Directory standard:
                    </span>{" "}
                    Active employees participate in attendance, leave, payroll
                    and approvals. Inactive/exited employees remain searchable
                    for audit history, but should not be selected for new
                    operational transactions.
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    type="search"
                    value={employeeSearch}
                    onChange={(event) => setEmployeeSearch(event.target.value)}
                    placeholder="Search name, code, department, email..."
                    className="min-h-10 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4] sm:w-80"
                  />
                  <select
                    value={employeeStatusFilter}
                    onChange={(event) =>
                      setEmployeeStatusFilter(
                        event.target.value as typeof employeeStatusFilter,
                      )
                    }
                    className="min-h-10 rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#4A3426] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                  >
                    <option value="ALL">All employees</option>
                    <option value="ACTIVE">Active only</option>
                    <option value="INACTIVE">Inactive only</option>
                  </select>
                  {canCreateHR && (
                    <button
                      type="button"
                      onClick={() => setShowEmployeeForm(true)}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#8B6F47] px-4 text-sm font-semibold text-white hover:bg-[#6F4E37]"
                    >
                      <UserPlus className="h-4 w-4" />
                      New Employee
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-4">
                <div className="rounded-xl border border-[#B2DDFF] bg-[#F5FAFF] p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#175CD3]">
                    <Users className="h-4 w-4" />
                    Total records
                  </div>
                  <div className="mt-2 text-2xl font-bold text-[#2F1B12]">
                    {formatCount(employees.length)}
                  </div>
                </div>
                <div className="rounded-xl border border-[#A6F4C5] bg-[#F6FEF9] p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#027A48]">
                    <UserCheck className="h-4 w-4" />
                    Active employees
                  </div>
                  <div className="mt-2 text-2xl font-bold text-[#2F1B12]">
                    {formatCount(hrCommandStats.activeEmployees)}
                  </div>
                </div>
                <div className="rounded-xl border border-[#FEDF89] bg-[#FFFCF5] p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#B54708]">
                    <UserX className="h-4 w-4" />
                    Inactive / exited
                  </div>
                  <div className="mt-2 text-2xl font-bold text-[#2F1B12]">
                    {formatCount(hrCommandStats.inactiveEmployees)}
                  </div>
                </div>
                <div className="rounded-xl border border-[#E8DCC4] bg-white p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#8B6F47]">
                    <Building2 className="h-4 w-4" />
                    Departments
                  </div>
                  <div className="mt-2 text-2xl font-bold text-[#2F1B12]">
                    {formatCount(employeeDepartments)}
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-3 lg:grid-cols-3">
                <div className="rounded-xl border border-[#A6F4C5] bg-[#F6FEF9] p-4">
                  <div className="flex items-center gap-2 text-sm font-bold text-[#027A48]">
                    <UserCheck className="h-4 w-4" />
                    Active employee
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[#05603A]">
                    Can be selected for attendance, leave, payroll, approvals,
                    department access, PR/JO assignment, and new operational
                    transactions.
                  </p>
                </div>
                <div className="rounded-xl border border-[#FEDF89] bg-[#FFFCF5] p-4">
                  <div className="flex items-center gap-2 text-sm font-bold text-[#B54708]">
                    <UserX className="h-4 w-4" />
                    Inactive / exited employee
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[#7A4E0E]">
                    Kept for audit history only. Should not appear in new
                    attendance, payroll, purchase approval, job order
                    assignment, or operational selection lists.
                  </p>
                </div>
                <div className="rounded-xl border border-[#B2DDFF] bg-[#F5FAFF] p-4">
                  <div className="flex items-center gap-2 text-sm font-bold text-[#175CD3]">
                    <ShieldCheck className="h-4 w-4" />
                    Role-linked access
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[#1849A9]">
                    Roles and department rights decide what the employee can
                    view or approve. Deactivation preserves old records but
                    removes the employee from future work.
                  </p>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-[#E8DCC4]">
                <thead className="bg-[#F7F3EA]">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                      Employee
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                      Org Assignment
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                      Contact
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                      Joining
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFE3CF] bg-white">
                  {filteredEmployees.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center">
                        <div className="mx-auto flex max-w-md flex-col items-center">
                          <span className="rounded-full bg-[#F7F3EA] p-3 text-[#8B6F47]">
                            <Users className="h-6 w-6" />
                          </span>
                          <h3 className="mt-3 text-base font-bold text-[#2F1B12]">
                            No employees found
                          </h3>
                          <p className="mt-1 text-sm text-[#7A6555]">
                            Try clearing the search/filter, or add a new
                            employee master record.
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                  {filteredEmployees.map((employee) => (
                    <tr key={employee.id} className="hover:bg-[#FAF9F6]">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#8B6F47] text-sm font-bold uppercase text-white">
                            {String(
                              employee.employee_name ||
                                employee.employee_code ||
                                "?",
                            ).slice(0, 1)}
                          </div>
                          <div>
                            <div className="font-bold text-[#2F1B12]">
                              {employee.employee_name}
                            </div>
                            <div className="text-xs font-semibold text-[#8B6F47]">
                              {employee.employee_code}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-semibold text-[#4A3426]">
                          {employee.designation || "-"}
                        </div>
                        <div className="text-xs text-[#7A6555]">
                          {employee.department || "Department not assigned"}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-[#4A3426]">
                          {employee.email || "-"}
                        </div>
                        <div className="text-xs text-[#7A6555]">
                          {employee.contact_number || "-"}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-[#4A3426]">
                        {employee.date_of_joining
                          ? new Date(
                              employee.date_of_joining,
                            ).toLocaleDateString("en-IN")
                          : "-"}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${getStatusColor(employee.status)}`}
                        >
                          {employee.status || "ACTIVE"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setSelectedEmployee(employee);
                              setShowEmployeeDetails(true);
                            }}
                            className="rounded-lg border border-[#D8C4A8] px-3 py-1.5 text-xs font-semibold text-[#4A3426] hover:bg-[#F5EFE3]"
                            title="View Details"
                          >
                            View
                          </button>
                          {canEditHR && (
                            <button
                              onClick={() => {
                                setSelectedEmployee(employee);
                                setEmployeeForm({
                                  employee_code: employee.employee_code,
                                  employee_name: employee.employee_name,
                                  designation: employee.designation || "",
                                  department: employee.department || "",
                                  date_of_joining: employee.date_of_joining,
                                  date_of_birth: "",
                                  contact_number: employee.contact_number || "",
                                  email: employee.email || "",
                                  address: "",
                                  biometric_id: "",
                                  per_diem_amount: String(
                                    employee.per_diem_amount ??
                                      employee.per_diem_rate ??
                                      "",
                                  ),
                                });
                                setShowEditEmployee(true);
                              }}
                              className="rounded-lg border border-[#FEDF89] px-3 py-1.5 text-xs font-semibold text-[#B54708] hover:bg-[#FFFAEB]"
                              title="Edit"
                            >
                              Edit
                            </button>
                          )}
                          {canDeleteHR &&
                            normalizeStatus(employee.status) !== "INACTIVE" && (
                              <button
                                onClick={async () => {
                                  if (
                                    confirm(
                                      `Mark ${employee.employee_name} as inactive?`,
                                    )
                                  ) {
                                    try {
                                      await apiClient.put(
                                        `/hr/employees/${employee.id}`,
                                        { status: "INACTIVE" },
                                      );
                                      fetchData();
                                      fetchHrCommandCenter();
                                    } catch (err: any) {
                                      alert("Failed to deactivate employee");
                                    }
                                  }
                                }}
                                className="rounded-lg border border-[#FECDCA] px-3 py-1.5 text-xs font-semibold text-[#B42318] hover:bg-[#FEF3F2]"
                                title="Deactivate"
                              >
                                Inactivate
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-3 bg-[#FAF9F6] p-4 md:hidden">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-[#2F1B12]">Employee cards</h3>
                <span className="rounded-full border border-[#E8DCC4] bg-white px-3 py-1 text-xs font-semibold text-[#6F5A49]">
                  {formatCount(filteredEmployees.length)} shown
                </span>
              </div>
              {filteredEmployees.length === 0 && (
                <div className="rounded-2xl border border-dashed border-[#D8C4A8] bg-white p-6 text-center">
                  <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#F7F3EA] text-[#8B6F47]">
                    <Users className="h-6 w-6" />
                  </span>
                  <h3 className="mt-3 text-base font-bold text-[#2F1B12]">
                    No employees found
                  </h3>
                  <p className="mt-1 text-sm text-[#7A6555]">
                    Try clearing the search/filter, or add a new employee master
                    record.
                  </p>
                </div>
              )}
              {filteredEmployees.map((employee) => (
                <div
                  key={employee.id}
                  className="rounded-2xl border border-[#E8DCC4] bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#8B6F47] text-sm font-bold uppercase text-white">
                        {String(
                          employee.employee_name ||
                            employee.employee_code ||
                            "?",
                        ).slice(0, 1)}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-bold text-[#2F1B12]">
                          {employee.employee_name}
                        </div>
                        <div className="text-xs font-semibold text-[#8B6F47]">
                          {employee.employee_code || "-"}
                        </div>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${getStatusColor(employee.status)}`}
                    >
                      {employee.status || "ACTIVE"}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-xl bg-[#FAF9F6] p-3">
                      <span className="block text-xs font-semibold uppercase text-[#8B6F47]">
                        Designation
                      </span>
                      <span className="font-bold text-[#4A3426]">
                        {employee.designation || "-"}
                      </span>
                    </div>
                    <div className="rounded-xl bg-[#FAF9F6] p-3">
                      <span className="block text-xs font-semibold uppercase text-[#8B6F47]">
                        Department
                      </span>
                      <span className="font-bold text-[#4A3426]">
                        {employee.department || "-"}
                      </span>
                    </div>
                    <div className="rounded-xl bg-[#FAF9F6] p-3">
                      <span className="block text-xs font-semibold uppercase text-[#8B6F47]">
                        Joining
                      </span>
                      <span className="font-bold text-[#4A3426]">
                        {employee.date_of_joining
                          ? new Date(
                              employee.date_of_joining,
                            ).toLocaleDateString("en-IN")
                          : "-"}
                      </span>
                    </div>
                    <div className="rounded-xl bg-[#FAF9F6] p-3">
                      <span className="block text-xs font-semibold uppercase text-[#8B6F47]">
                        Phone
                      </span>
                      <span className="font-bold text-[#4A3426]">
                        {employee.contact_number || "-"}
                      </span>
                    </div>
                  </div>

                  {employee.email && (
                    <div className="mt-3 rounded-xl border border-[#B2DDFF] bg-[#F5FAFF] p-3 text-sm font-semibold text-[#175CD3]">
                      {employee.email}
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedEmployee(employee);
                        setShowEmployeeDetails(true);
                      }}
                      className="rounded-lg border border-[#D8C4A8] px-3 py-2 text-xs font-semibold text-[#4A3426] hover:bg-[#F5EFE3]"
                    >
                      View
                    </button>
                    {canEditHR && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedEmployee(employee);
                          setEmployeeForm({
                            employee_code: employee.employee_code,
                            employee_name: employee.employee_name,
                            designation: employee.designation || "",
                            department: employee.department || "",
                            date_of_joining: employee.date_of_joining,
                            date_of_birth: "",
                            contact_number: employee.contact_number || "",
                            email: employee.email || "",
                            address: "",
                            biometric_id: "",
                            per_diem_amount: String(
                              employee.per_diem_amount ??
                                employee.per_diem_rate ??
                                "",
                            ),
                          });
                          setShowEditEmployee(true);
                        }}
                        className="rounded-lg border border-[#FEDF89] px-3 py-2 text-xs font-semibold text-[#B54708] hover:bg-[#FFFAEB]"
                      >
                        Edit
                      </button>
                    )}
                    {canDeleteHR &&
                      normalizeStatus(employee.status) !== "INACTIVE" && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (
                              confirm(
                                `Mark ${employee.employee_name} as inactive?`,
                              )
                            ) {
                              try {
                                await apiClient.put(
                                  `/hr/employees/${employee.id}`,
                                  { status: "INACTIVE" },
                                );
                                fetchData();
                                fetchHrCommandCenter();
                              } catch (err: any) {
                                alert("Failed to deactivate employee");
                              }
                            }
                          }}
                          className="rounded-lg border border-[#FECDCA] px-3 py-2 text-xs font-semibold text-[#B42318] hover:bg-[#FEF3F2]"
                        >
                          Inactivate
                        </button>
                      )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

      {/* Attendance Tab with Mobile-Friendly Geo-Tagging */}
      {activeTab === "attendance" && (
        <div className="space-y-4">
          {!isEmployeePortal && (
            <section className="overflow-hidden rounded-2xl border border-[#E8DCC4] bg-white shadow-sm">
              <div className="border-b border-[#E8DCC4] bg-gradient-to-r from-[#FFF8EA] via-white to-[#F7F3EA] p-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                      Time Office
                    </div>
                    <h2 className="mt-1 text-2xl font-bold text-[#2F1B12]">
                      {isEmployeePortal
                        ? "My attendance control"
                        : "Attendance control center"}
                    </h2>
                    <p className="mt-1 max-w-3xl text-sm text-[#6F5A49]">
                      Monitor daily punch status, attendance exceptions, late
                      marks, missing check-outs, and manual records. This is the
                      operational base for shift governance and payroll
                      readiness.
                    </p>
                    <div className="mt-3 rounded-xl border border-[#E8DCC4] bg-white/80 p-3 text-xs leading-5 text-[#6F5A49]">
                      <span className="font-bold text-[#4A3426]">Control:</span>{" "}
                      Employees use self check-in/out; GPS/photo evidence can be
                      captured where configured. HR/Admin records manual
                      corrections or biometric imports only when needed, so
                      attendance remains auditable before payroll.
                    </div>
                  </div>
                  {!isEmployeePortal && (
                    <div className="flex flex-wrap items-center gap-2">
                      {canManageAttendance ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setShowAttendanceForm(true)}
                            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#8B6F47] px-4 text-sm font-semibold text-white hover:bg-[#6F4E37]"
                          >
                            <Plus className="h-4 w-4" />
                            Record Attendance
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAttendanceImportText("");
                              setAttendanceImportResult("");
                              setShowAttendanceImport(true);
                            }}
                            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#D8C4A8] bg-white px-4 text-sm font-semibold text-[#4A3426] hover:bg-[#FAF9F6]"
                          >
                            <FileText className="h-4 w-4" />
                            Import Biometric
                          </button>
                        </>
                      ) : (
                        <div className="max-w-sm rounded-xl border border-[#FEDF89] bg-[#FFFCF5] p-3 text-xs leading-5 text-[#B54708]">
                          Manual attendance and biometric import are restricted
                          to HR/Admin users. You can review attendance records
                          only.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {!isEmployeePortal && (
                  <div className="mt-5 grid gap-3 md:grid-cols-5">
                    <div className="rounded-xl border border-[#A6F4C5] bg-[#F6FEF9] p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-[#027A48]">
                        <CheckCircle2 className="h-4 w-4" />
                        Present records
                      </div>
                      <div className="mt-2 text-2xl font-bold text-[#2F1B12]">
                        {formatCount(attendanceSummary.present)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[#FEDF89] bg-[#FFFCF5] p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-[#B54708]">
                        <Clock3 className="h-4 w-4" />
                        Late marks
                      </div>
                      <div className="mt-2 text-2xl font-bold text-[#2F1B12]">
                        {formatCount(attendanceSummary.late)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[#FECDCA] bg-[#FEF3F2] p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-[#B42318]">
                        <AlertTriangle className="h-4 w-4" />
                        Absence / leave
                      </div>
                      <div className="mt-2 text-2xl font-bold text-[#2F1B12]">
                        {formatCount(attendanceSummary.absent)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[#B2DDFF] bg-[#F5FAFF] p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-[#175CD3]">
                        <FileWarning className="h-4 w-4" />
                        Missing checkout
                      </div>
                      <div className="mt-2 text-2xl font-bold text-[#2F1B12]">
                        {formatCount(attendanceSummary.missingOut)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[#E8DCC4] bg-white p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-[#8B6F47]">
                        <GaugeCircle className="h-4 w-4" />
                        Work hours
                      </div>
                      <div className="mt-2 text-2xl font-bold text-[#2F1B12]">
                        {attendanceSummary.totalHours.toFixed(1)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {!isEmployeePortal && (
            <section className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
              <div className="overflow-hidden rounded-2xl border border-[#E8DCC4] bg-white shadow-sm">
                <div className="border-b border-[#E8DCC4] bg-[#FAF9F6] px-5 py-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                    Standard attendance flow
                  </div>
                  <h3 className="mt-1 text-lg font-bold text-[#2F1B12]">
                    How the attendance record is created
                  </h3>
                </div>
                <div className="grid divide-y divide-[#EFE3CF] md:grid-cols-4 md:divide-x md:divide-y-0">
                  {[
                    [
                      "1",
                      "Employee punch",
                      "Self check-in/out captures time, device, GPS and optional photo where required.",
                      UserCheck,
                    ],
                    [
                      "2",
                      "Device import",
                      "Biometric logs can be imported by HR/Admin as source attendance evidence.",
                      FileText,
                    ],
                    [
                      "3",
                      "HR correction",
                      "Manual attendance is only for approved exceptions, missed punches, or corrections.",
                      ClipboardCheck,
                    ],
                    [
                      "4",
                      "Payroll lock",
                      "Approved attendance feeds paid days, late marks, leave, and payroll readiness.",
                      WalletCards,
                    ],
                  ].map(([step, title, body, Icon]) => (
                    <div key={String(step)} className="p-4">
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#F7F3EA] text-xs font-bold text-[#6F4E37]">
                          {String(step)}
                        </span>
                        <Icon className="h-4 w-4 text-[#8B6F47]" />
                      </div>
                      <div className="mt-3 font-bold text-[#2F1B12]">
                        {String(title)}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-[#6F5A49]">
                        {String(body)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-[#FEDF89] bg-[#FFFCF5] p-5 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-bold text-[#B54708]">
                  <ShieldCheck className="h-5 w-5" />
                  Attendance governance
                </div>
                <div className="mt-3 space-y-3 text-xs leading-5 text-[#7A4E0E]">
                  <div className="rounded-xl border border-[#FEDF89] bg-white/70 p-3">
                    <span className="font-bold">Employees:</span> can mark their
                    own check-in/check-out only.
                  </div>
                  <div className="rounded-xl border border-[#FEDF89] bg-white/70 p-3">
                    <span className="font-bold">HR/Admin:</span> can import
                    biometric logs and record approved manual corrections.
                  </div>
                  <div className="rounded-xl border border-[#FEDF89] bg-white/70 p-3">
                    <span className="font-bold">Audit:</span> manual entries
                    should carry remarks and remain visible before payroll
                    processing.
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Mobile-First Check-In/Out Card */}
          <div className="rounded-2xl border border-[#E8DCC4] bg-white p-4 shadow-sm md:p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                  Today
                </div>
                <h3 className="text-lg font-bold text-[#2F1B12]">
                  {isEmployeePortal ? "Attendance" : "Punch status"}
                </h3>
              </div>
              <span className="rounded-full bg-[#F7F3EA] px-3 py-1 text-sm font-semibold text-[#6F5A49]">
                {new Date().toLocaleDateString(
                  "en-IN",
                  isEmployeePortal
                    ? { day: "2-digit", month: "2-digit", year: "numeric" }
                    : { weekday: "long", day: "numeric", month: "long" },
                )}
              </span>
            </div>

            {/* Status Badge */}
            {!isEmployeePortal && (
              <div className="mb-4">
                {todayAttendance?.check_in_time ? (
                  todayAttendance?.check_out_time ? (
                    <div className="flex items-center gap-3 rounded-xl border border-[#A6F4C5] bg-[#F6FEF9] p-3 text-[#027A48]">
                      <CheckCircle2 className="h-6 w-6" />
                      <span className="font-bold">
                        Day Complete - Checked Out
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 rounded-xl border border-[#B2DDFF] bg-[#F5FAFF] p-3 text-[#175CD3]">
                      <Clock3 className="h-6 w-6" />
                      <span className="font-bold">Currently Checked In</span>
                    </div>
                  )
                ) : (
                  <div className="flex items-center gap-3 rounded-xl border border-[#E8DCC4] bg-[#FAF9F6] p-3 text-[#6F5A49]">
                    <Clock3 className="h-6 w-6" />
                    <span className="font-bold">Not Checked In Yet</span>
                  </div>
                )}
              </div>
            )}

            {/* Location Info */}
            {currentLocation && (
              <div className="mb-4 rounded-xl border border-[#B2DDFF] bg-[#F5FAFF] p-3 text-sm">
                <div className="flex items-start gap-2">
                  <GaugeCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#175CD3]" />
                  <div>
                    <p className="font-bold text-[#2F1B12]">Current Location</p>
                    <p className="text-[#4A3426]">{currentLocation.address}</p>
                    <p className="mt-1 text-xs text-[#175CD3]">
                      Lat: {currentLocation.lat.toFixed(6)}, Lng:{" "}
                      {currentLocation.lng.toFixed(6)}
                      {Number.isFinite(currentLocation.accuracy)
                        ? `, Accuracy: ±${Math.round(Number(currentLocation.accuracy))} m`
                        : ""}
                    </p>
                    {officeDistanceMeters !== null && (
                      <p className="mt-1 text-xs font-semibold text-[#175CD3]">
                        Office distance: {Math.round(officeDistanceMeters)} m /
                        allowed {HR_OFFICE_RADIUS_METERS} m
                        {Number.isFinite(currentLocation.accuracy)
                          ? ` + GPS buffer ${Math.min(Math.round(Number(currentLocation.accuracy)), HR_OFFICE_ACCURACY_GRACE_METERS)} m`
                          : ""}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {locationError && (
              <div className="mb-4 rounded-xl border border-[#FECDCA] bg-[#FEF3F2] p-3 text-sm text-[#B42318]">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  {locationError}
                </div>
              </div>
            )}

            {/* Check In/Out Buttons */}
            <div className="grid gap-4">
              {isCurrentlyInOffice && (
                <div className="grid gap-2">
                  <label
                    htmlFor="attendance-go-out-reason"
                    className="text-sm font-semibold text-[#5C4738]"
                  >
                    Go Out reason <span className="text-[#B42318]">*</span>
                  </label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <select
                      id="attendance-go-out-reason"
                      value={outReason}
                      onChange={(e) => {
                        setOutReason(e.target.value);
                        if (e.target.value !== "Other") setOutReasonOther("");
                        setLocationError(null);
                      }}
                      className="rounded-xl border border-[#D8C6AA] px-3 py-2"
                      aria-required="true"
                    >
                      <option value="" disabled>
                        Select reason
                      </option>
                      <option value="Lunch">Lunch</option>
                      <option value="Trials">Trials</option>
                      <option value="Official work">Official work</option>
                      <option value="Other">Other</option>
                    </select>
                    {outReason === "Other" && (
                      <input
                        value={outReasonOther}
                        onChange={(e) => {
                          setOutReasonOther(e.target.value);
                          setLocationError(null);
                        }}
                        placeholder="Enter reason"
                        className="rounded-xl border border-[#D8C6AA] px-3 py-2"
                        required
                      />
                    )}
                  </div>
                  <p className="text-xs text-[#7A6555]">
                    Required for Go Out. It is not required for Check In or End Day.
                  </p>
                </div>
              )}

              {(pendingOutsideCheckIn || pendingOutsideCheckOut) && (
                <div className="rounded-2xl border-2 border-[#F79009] bg-[#FFFAEB] p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-[#FEF0C7] p-2 text-[#B54708]">
                      <Camera className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-[#7A2E0E]">
                        Selfie required outside the office geofence
                      </p>
                      <p className="mt-1 text-sm leading-5 text-[#93370D]">
                        {pendingOutsideCheckOut?.endDay
                          ? "Your End Day is waiting. Take a live selfie to complete checkout."
                          : pendingOutsideCheckOut
                            ? "Your Go Out entry is waiting. Take a live selfie to record it."
                            : "Your Check In is waiting. Take a live selfie to complete it."}
                      </p>
                      {officeDistanceMeters !== null && (
                        <p className="mt-1 text-xs font-semibold text-[#B54708]">
                          Detected approximately {Math.round(officeDistanceMeters)} m from the office.
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
                    <button
                      type="button"
                      onClick={openAttendanceCamera}
                      disabled={checkingIn || checkingOut}
                      className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#B54708] px-4 py-3 font-bold text-white hover:bg-[#93370D] disabled:cursor-not-allowed disabled:bg-[#D6D0C4]"
                    >
                      <Camera className="h-5 w-5" />
                      {pendingOutsideCheckOut?.endDay
                        ? "Take Selfie & Complete End Day"
                        : pendingOutsideCheckOut
                          ? "Take Selfie & Record Go Out"
                          : "Take Selfie & Complete Check In"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelPendingAttendanceSelfie}
                      disabled={checkingIn || checkingOut}
                      className="min-h-12 rounded-xl border border-[#D8C4A8] bg-white px-4 py-3 font-semibold text-[#6F5A49] hover:bg-[#F7F3EA] disabled:cursor-not-allowed"
                    >
                      Cancel
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-[#93370D]">
                    If asked, choose Camera and allow access. On a computer you may also select a freshly captured image.
                  </p>
                </div>
              )}

              <input
                ref={attendanceCameraInputRef}
                id="attendance-selfie-camera"
                type="file"
                accept="image/*"
                capture="user"
                onChange={handlePhotoChange}
                className="absolute -left-[9999px] h-px w-px opacity-0"
                tabIndex={-1}
              />

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleCheckIn}
                  disabled={checkingIn || !!todayAttendance?.check_in_time}
                  className="flex min-h-16 w-full items-center justify-center rounded-2xl bg-[#027A48] px-4 py-4 text-lg font-bold text-white shadow-sm transition-transform hover:bg-[#05603A] active:scale-95 disabled:cursor-not-allowed disabled:bg-[#D6D0C4] disabled:text-[#7A6555]"
                >
                  {checkingIn ? "Please wait..." : "Check In"}
                </button>
                <button
                  onClick={() => handleCheckOut(false)}
                  disabled={
                    checkingOut ||
                    !isCurrentlyInOffice ||
                    !outReason ||
                    (outReason === "Other" && !outReasonOther.trim())
                  }
                  className="flex min-h-16 w-full items-center justify-center rounded-2xl bg-[#B42318] px-4 py-4 text-lg font-bold text-white shadow-sm transition-transform hover:bg-[#912018] active:scale-95 disabled:cursor-not-allowed disabled:bg-[#D6D0C4] disabled:text-[#7A6555]"
                >
                  {checkingOut ? "Please wait..." : "Go Out"}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleReturnToOffice}
                  disabled={checkingIn || !isCurrentlyOut}
                  className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-[#175CD3] px-4 py-3 text-base font-bold text-white shadow-sm transition-transform hover:bg-[#1849A9] active:scale-95 disabled:cursor-not-allowed disabled:bg-[#D6D0C4] disabled:text-[#7A6555]"
                >
                  {checkingIn ? "Please wait..." : "Return to Office"}
                </button>
                <button
                  onClick={() => handleCheckOut(true)}
                  disabled={checkingOut || !isCurrentlyInOffice}
                  className="flex min-h-14 w-full items-center justify-center rounded-2xl border border-[#B42318] bg-white px-4 py-3 text-base font-bold text-[#B42318] transition-transform hover:bg-[#FEF3F2] active:scale-95 disabled:cursor-not-allowed disabled:border-[#D6D0C4] disabled:text-[#7A6555]"
                >
                  {checkingOut ? "Please wait..." : "End Day"}
                </button>
              </div>

              {todayPunches.length > 0 && (
                <p className="rounded-xl bg-[#F7F3EA] px-3 py-2 text-xs font-medium text-[#6F5A49]">
                  Today:{" "}
                  {todayPunches
                    .map(
                      (p: { punch_type: "IN" | "OUT"; punch_at: string }) =>
                        `${p.punch_type === "IN" ? "In" : "Out"} ${new Date(p.punch_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`,
                    )
                    .join("  ·  ")}
                </p>
              )}

              {!HAS_HR_OFFICE_GEOFENCE &&
                !canSkipAttendanceEvidence &&
                !todayAttendance?.check_in_time && (
                  <label className="flex items-center gap-3 rounded-xl border border-[#FEDF89] bg-[#FFFCF5] p-3 text-sm font-semibold text-[#B54708]">
                    <input
                      type="checkbox"
                      checked={isOutsideZone}
                      onChange={(e) => setIsOutsideZone(e.target.checked)}
                      className="h-5 w-5 rounded text-amber-600 focus:ring-amber-500"
                    />
                    I am outside office
                  </label>
                )}

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-[#A6F4C5] bg-[#F6FEF9] p-4 text-center">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#027A48]">
                    Check In
                  </p>
                  <p className="mt-1 text-xl font-bold text-[#2F1B12]">
                    {todayAttendance?.check_in_time
                      ? new Date(
                          todayAttendance.check_in_time,
                        ).toLocaleTimeString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "-"}
                  </p>
                </div>
                <div className="rounded-xl border border-[#FECDCA] bg-[#FEF3F2] p-4 text-center">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#B42318]">
                    Check Out
                  </p>
                  <p className="mt-1 text-xl font-bold text-[#2F1B12]">
                    {todayAttendance?.check_out_time
                      ? new Date(
                          todayAttendance.check_out_time,
                        ).toLocaleTimeString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "-"}
                  </p>
                </div>
              </div>

              {todayAttendance?.work_hours && (
                <div className="rounded-xl border border-[#B2DDFF] bg-[#F5FAFF] p-3 text-center">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#175CD3]">
                    Today Hours
                  </p>
                  <p className="text-lg font-bold text-[#2F1B12]">
                    {todayAttendance.work_hours} hrs
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Attendance Report Controls */}
          {!isEmployeePortal && (
            <div className="rounded-2xl border border-[#E8DCC4] bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                    Attendance Report
                  </div>
                  <h4 className="text-lg font-bold text-[#2F1B12]">
                    Filter, review, and export attendance
                  </h4>
                  <p className="text-sm text-[#6F5A49]">
                    Choose From / To dates and export the same filtered register
                    to Excel.
                  </p>
                </div>
                <span className="rounded-full border border-[#E8DCC4] bg-[#FAF9F6] px-3 py-1 text-xs font-semibold text-[#6F5A49]">
                  {formatCount(attendance.length)} records in report
                </span>
              </div>
              <div className="grid gap-3 lg:grid-cols-[minmax(150px,1fr)_minmax(150px,1fr)_minmax(220px,1.5fr)_auto_auto] lg:items-end">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                    From
                  </label>
                  <DateInput
                    value={attendanceFromDate}
                    onChange={setAttendanceFromDate}
                    max={attendanceToDate || serverSafeTodayDate}
                    className="w-full rounded-xl border border-[#D8C4A8] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                    To
                  </label>
                  <DateInput
                    value={attendanceToDate}
                    onChange={setAttendanceToDate}
                    min={attendanceFromDate || undefined}
                    max={serverSafeTodayDate}
                    className="w-full rounded-xl border border-[#D8C4A8] px-3 py-2 text-sm"
                  />
                </div>
                {!isEmployeePortal && (
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                      Employee
                    </label>
                    <select
                      value={attendanceEmployeeFilter}
                      onChange={(event) =>
                        setAttendanceEmployeeFilter(event.target.value)
                      }
                      className="w-full rounded-xl border border-[#D8C4A8] bg-white px-3 py-2 text-sm text-[#4A3426]"
                    >
                      <option value="ALL">All employees</option>
                      {employees
                        .slice()
                        .sort((a, b) =>
                          String(a.employee_name || "").localeCompare(
                            String(b.employee_name || ""),
                          ),
                        )
                        .map((employee) => (
                          <option key={employee.id} value={employee.id}>
                            {employee.employee_name}{" "}
                            {employee.employee_code
                              ? `(${employee.employee_code})`
                              : ""}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
                <button
                  type="button"
                  onClick={fetchData}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[#D8C4A8] bg-white px-4 text-sm font-bold text-[#4A3426] hover:bg-[#F5EFE3]"
                >
                  <RefreshCw className="h-4 w-4" />
                  Apply
                </button>
                <button
                  type="button"
                  onClick={handleExportAttendance}
                  disabled={attendance.length === 0}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#8B6F47] px-4 text-sm font-bold text-white shadow-sm hover:bg-[#6F5A49] disabled:cursor-not-allowed disabled:bg-[#C8B79C]"
                >
                  <FileText className="h-4 w-4" />
                  Excel
                </button>
              </div>
            </div>
          )}

          {/* Attendance History Table (Desktop View) */}
          <div className="hidden overflow-hidden rounded-2xl border border-[#E8DCC4] bg-white shadow-sm md:block">
            <div className="flex items-center justify-between border-b border-[#E8DCC4] bg-[#FAF9F6] px-5 py-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                  Register
                </div>
                <h4 className="font-bold text-[#2F1B12]">Attendance history</h4>
              </div>
              <span className="rounded-full border border-[#E8DCC4] bg-white px-3 py-1 text-xs font-semibold text-[#6F5A49]">
                {formatCount(attendanceSummary.records)} records
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[1650px] table-fixed divide-y divide-[#E8DCC4]">
                <colgroup>
                  {attendanceVisibleColumns.map((column) => (
                    <col
                      key={column}
                      style={{ width: `${attendanceColumnWidths[column]}px` }}
                    />
                  ))}
                </colgroup>
                <thead className="bg-[#F7F3EA]">
                  <tr>
                    {renderAttendanceStaticHeader("details", "Details")}
                    {!isEmployeePortal &&
                      renderAttendanceSortHeader("employee", "Employee")}
                    {renderAttendanceSortHeader("date", "Date")}
                    {renderAttendanceSortHeader("check_in", "Check In")}
                    {renderAttendanceSortHeader("check_out", "Check Out")}
                    {renderAttendanceSortHeader("hours", "Hours")}
                    {renderAttendanceSortHeader("pay_days", "Pay Days")}
                    {renderAttendanceSortHeader(
                      "travel_per_diem",
                      "Travel / Per Diem",
                      "right",
                    )}
                    {renderAttendanceSortHeader("status", "Status")}
                    {!isEmployeePortal &&
                      renderAttendanceStaticHeader("evidence", "Evidence")}
                    {!isEmployeePortal &&
                      canCorrectAttendance &&
                      renderAttendanceStaticHeader(
                        "actions",
                        "Actions",
                        "right",
                      )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFE3CF] bg-white">
                  {attendance.length === 0 && (
                    <tr>
                      <td
                        colSpan={attendanceColumnCount}
                        className="px-6 py-10 text-center text-sm text-[#7A6555]"
                      >
                        No attendance records found for the selected period.
                      </td>
                    </tr>
                  )}
                  {sortedAttendance.map((record) => {
                    const isExpanded = expandedAttendanceId === record.id;
                    const photoLinks = getAttendancePhotoLinks(record);
                    return (
                      <Fragment key={record.id}>
                        <tr className="hover:bg-[#FAF9F6]">
                          <td className="whitespace-nowrap px-4 py-4">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedAttendanceId(
                                  isExpanded ? null : record.id,
                                )
                              }
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#E8DCC4] bg-white text-[#6F5A49] hover:bg-[#F5EFE3]"
                              aria-label={
                                isExpanded
                                  ? "Collapse attendance details"
                                  : "Expand attendance details"
                              }
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </button>
                          </td>
                          {!isEmployeePortal && (
                            <td className="px-6 py-4 text-sm font-semibold text-[#2F1B12]">
                              {record.employee_name || "-"}
                              {record.employee_code && (
                                <p className="text-xs font-medium text-[#8B6F47]">
                                  {record.employee_code}
                                </p>
                              )}
                            </td>
                          )}
                          <td className="whitespace-nowrap px-6 py-4 text-sm font-semibold text-[#4A3426]">
                            {new Date(
                              record.attendance_date,
                            ).toLocaleDateString("en-IN")}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-[#4A3426]">
                            {record.check_in_time ? (
                              <div>
                                <span className="font-semibold">
                                  {new Date(
                                    record.check_in_time,
                                  ).toLocaleTimeString("en-IN", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                                {record.check_in_location && (
                                  <p className="max-w-[170px] truncate text-xs text-[#7A6555]">
                                    {displayAttendanceLocation(
                                      record.check_in_location,
                                      record.check_in_lat,
                                      record.check_in_lng,
                                    )}
                                  </p>
                                )}
                              </div>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-[#4A3426]">
                            {record.check_out_time
                              ? new Date(
                                  record.check_out_time,
                                ).toLocaleTimeString("en-IN", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "-"}
                            {record.check_out_location && (
                              <p className="max-w-[170px] truncate text-xs text-[#7A6555]">
                                {displayAttendanceLocation(
                                  record.check_out_location,
                                  record.check_out_lat,
                                  record.check_out_lng,
                                )}
                              </p>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm font-semibold text-[#4A3426]">
                            {record.work_hours || "-"}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm font-semibold text-[#4A3426]">
                            {formatPayDayCredit(record)}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                            <div
                              className={
                                isTravelPerDiemDay(record)
                                  ? "font-semibold text-[#027A48]"
                                  : "text-[#98A2B3]"
                              }
                            >
                              {isTravelPerDiemDay(record) ? "Travel day" : "-"}
                            </div>
                            <div className="text-xs font-semibold text-[#6F5A49]">
                              {formatPerDiemAmount(
                                getAttendanceTravelPerDiemAmount(record),
                              )}
                            </div>
                            {record.is_outstation_travel && (
                              <div className="text-[11px] text-[#8B6F47]">
                                {formatTimeOnly(record.travel_departure_time)} →{" "}
                                {formatTimeOnly(record.travel_arrival_time)}
                              </div>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${getStatusColor(record.status)}`}
                            >
                              {record.status}
                            </span>
                          </td>
                          {!isEmployeePortal && (
                            <td className="whitespace-nowrap px-6 py-4 text-sm">
                              {photoLinks.length > 0 ? (
                                <div className="flex flex-col items-start gap-1">
                                  {photoLinks.map((link) => (
                                    <a
                                      key={link.label}
                                      href={link.href}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex min-h-7 items-center rounded-lg border border-[#B2DDFF] bg-[#F5FAFF] px-2 text-xs font-bold text-[#175CD3] hover:bg-[#EAF4FF]"
                                    >
                                      {link.label}
                                    </a>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-xs text-[#B5A592]">
                                  No photo
                                </span>
                              )}
                            </td>
                          )}
                          {!isEmployeePortal && canCorrectAttendance && (
                            <td className="whitespace-nowrap px-6 py-4 text-right">
                              <button
                                type="button"
                                onClick={() => openAttendanceCorrection(record)}
                                className="inline-flex min-h-9 items-center justify-center rounded-lg border border-[#D8C4A8] bg-white px-3 text-xs font-bold text-[#4A3426] hover:bg-[#F5EFE3]"
                              >
                                Correct
                              </button>
                            </td>
                          )}
                        </tr>
                        {isExpanded && (
                          <tr className="bg-[#FFFCF6]">
                            <td
                              colSpan={attendanceColumnCount}
                              className="px-6 py-4"
                            >
                              <div className="grid gap-3 rounded-xl border border-[#E8DCC4] bg-white p-4 text-sm text-[#4A3426] md:grid-cols-2 xl:grid-cols-4">
                                <div className="md:col-span-2 xl:col-span-4">
                                  <div className="text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                                    Movement timeline
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {(record.punches || []).map(
                                      (punch: any) => (
                                        <div
                                          key={punch.id}
                                          className={`rounded-lg border px-3 py-2 ${punch.punch_type === "OUT" ? "border-[#FECDCA] bg-[#FEF3F2]" : "border-[#ABEFC6] bg-[#ECFDF3]"}`}
                                        >
                                          <div className="font-bold">
                                            {punch.punch_type === "OUT"
                                              ? "Gone out"
                                              : "Returned to office"}{" "}
                                            ·{" "}
                                            {new Date(
                                              punch.punch_at,
                                            ).toLocaleTimeString("en-IN", {
                                              hour: "2-digit",
                                              minute: "2-digit",
                                            })}
                                          </div>
                                          <div className="text-xs text-[#6F5A49]">
                                            {punch.notes ||
                                              "No reason recorded"}
                                            {punch.location
                                              ? ` · ${punch.location}`
                                              : ""}
                                          </div>
                                        </div>
                                      ),
                                    )}
                                    {!(record.punches || []).length && (
                                      <span className="text-xs text-[#7A6555]">
                                        No movement punches recorded.
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                                    Check-in location
                                  </div>
                                  <p className="mt-1 text-[#2F1B12]">
                                    {displayAttendanceLocation(
                                      record.check_in_location,
                                      record.check_in_lat,
                                      record.check_in_lng,
                                    )}
                                  </p>
                                </div>
                                <div>
                                  <div className="text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                                    Check-out location
                                  </div>
                                  <p className="mt-1 text-[#2F1B12]">
                                    {displayAttendanceLocation(
                                      record.check_out_location,
                                      record.check_out_lat,
                                      record.check_out_lng,
                                    )}
                                  </p>
                                </div>
                                <div>
                                  <div className="text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                                    Notes / reason
                                  </div>
                                  <p className="mt-1 text-[#2F1B12]">
                                    {record.outside_zone_reason ||
                                      record.check_in_notes ||
                                      record.check_out_notes ||
                                      "-"}
                                  </p>
                                </div>
                                <div>
                                  <div className="text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                                    Travel / per diem
                                  </div>
                                  <p className="mt-1 text-[#2F1B12]">
                                    {record.is_outstation_travel
                                      ? `${isTravelPerDiemDay(record) ? "Eligible" : "Not eligible"} · ${formatPerDiemAmount(getAttendanceTravelPerDiemAmount(record))}`
                                      : "-"}
                                  </p>
                                  {record.travel_notes && (
                                    <p className="mt-1 text-xs text-[#7A6555]">
                                      {record.travel_notes}
                                    </p>
                                  )}
                                </div>
                                <div>
                                  <div className="text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                                    Evidence
                                  </div>
                                  {photoLinks.length > 0 ? (
                                    <div className="mt-1 flex flex-wrap gap-2">
                                      {photoLinks.map((link) => (
                                        <a
                                          key={link.label}
                                          href={link.href}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex min-h-8 items-center rounded-lg border border-[#B2DDFF] bg-[#F5FAFF] px-2 text-xs font-bold text-[#175CD3] hover:bg-[#EAF4FF]"
                                        >
                                          {link.label}
                                        </a>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="mt-1 text-[#7A6555]">
                                      No photo uploaded
                                    </p>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Attendance History Cards */}
          <div className="space-y-3 md:hidden">
            <div className="flex items-center justify-between px-1">
              <h4 className="font-bold text-[#2F1B12]">Recent history</h4>
              <span className="rounded-full border border-[#E8DCC4] bg-white px-3 py-1 text-xs font-semibold text-[#6F5A49]">
                {formatCount(attendanceSummary.records)} records
              </span>
            </div>
            {attendance.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[#D8C4A8] bg-[#FAF9F6] p-6 text-center text-sm text-[#7A6555]">
                No attendance records found for the selected period.
              </div>
            )}

            {isEmployeePortal && !currentLocation && !locationError && (
              <div className="mb-4 rounded-xl border border-[#E8DCC4] bg-[#FAF9F6] p-3 text-sm text-[#6F5A49]">
                <div className="flex items-start gap-2">
                  <GaugeCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#8B6F47]" />
                  <div>
                    <p className="font-bold text-[#2F1B12]">
                      Geo tagging enabled
                    </p>
                    <p>
                      Location, latitude, longitude, and time are captured when
                      Check In or Check Out is pressed.
                    </p>
                  </div>
                </div>
              </div>
            )}
            {attendance.map((record) => (
              <div
                key={record.id}
                className="rounded-2xl border border-[#E8DCC4] bg-white p-4 shadow-sm"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                      Attendance date
                    </div>
                    <span className="font-bold text-[#2F1B12]">
                      {new Date(record.attendance_date).toLocaleDateString(
                        "en-IN",
                      )}
                    </span>
                    {!isEmployeePortal && record.employee_name && (
                      <p className="mt-1 text-xs font-semibold text-[#7A6555]">
                        {record.employee_name}
                      </p>
                    )}
                  </div>
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${getStatusColor(record.status)}`}
                  >
                    {record.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-xl bg-[#FAF9F6] p-3">
                    <span className="block text-xs font-semibold uppercase text-[#8B6F47]">
                      Check In
                    </span>
                    <span className="font-bold text-[#4A3426]">
                      {record.check_in_time
                        ? new Date(record.check_in_time).toLocaleTimeString(
                            "en-IN",
                            { hour: "2-digit", minute: "2-digit" },
                          )
                        : "-"}
                    </span>
                  </div>
                  <div className="rounded-xl bg-[#FAF9F6] p-3">
                    <span className="block text-xs font-semibold uppercase text-[#8B6F47]">
                      Check Out
                    </span>
                    <span className="font-bold text-[#4A3426]">
                      {record.check_out_time
                        ? new Date(record.check_out_time).toLocaleTimeString(
                            "en-IN",
                            { hour: "2-digit", minute: "2-digit" },
                          )
                        : "-"}
                    </span>
                  </div>
                </div>
                {record.work_hours && (
                  <div className="mt-3 rounded-xl border border-[#B2DDFF] bg-[#F5FAFF] p-3 text-sm font-bold text-[#175CD3]">
                    {record.work_hours} hrs worked
                  </div>
                )}
                {record.is_outstation_travel && (
                  <div className="mt-3 rounded-xl border border-[#A6F4C5] bg-[#F6FEF9] p-3 text-sm">
                    <div className="font-bold text-[#027A48]">
                      {isTravelPerDiemDay(record)
                        ? "Travel per diem eligible"
                        : "Travel marked - no per diem"}
                    </div>
                    <div className="mt-1 text-xs font-semibold text-[#4A3426]">
                      {formatTimeOnly(record.travel_departure_time)} →{" "}
                      {formatTimeOnly(record.travel_arrival_time)} ·{" "}
                      {formatPerDiemAmount(
                        getAttendanceTravelPerDiemAmount(record),
                      )}
                    </div>
                    {record.travel_notes && (
                      <p className="mt-1 text-xs text-[#7A6555]">
                        {record.travel_notes}
                      </p>
                    )}
                  </div>
                )}
                {getAttendancePhotoLinks(record).length > 0 && (
                  <div className="mt-3 grid gap-2">
                    {getAttendancePhotoLinks(record).map((link) => (
                      <a
                        key={link.label}
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[#B2DDFF] bg-[#F5FAFF] px-3 text-sm font-bold text-[#175CD3] hover:bg-[#EAF4FF]"
                      >
                        {link.label}
                      </a>
                    ))}
                  </div>
                )}
                {!isEmployeePortal && canCorrectAttendance && (
                  <button
                    type="button"
                    onClick={() => openAttendanceCorrection(record)}
                    className="mt-3 w-full rounded-xl border border-[#D8C4A8] bg-white px-3 py-2 text-sm font-bold text-[#4A3426] hover:bg-[#F5EFE3]"
                  >
                    Correct check-in / check-out
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Leave Requests Tab */}
      {activeTab === "leaves" && (
        <div className="overflow-hidden rounded-2xl border border-[#E8DCC4] bg-white shadow-sm">
          <div className="border-b border-[#E8DCC4] bg-gradient-to-r from-[#FFF8EA] via-white to-[#F7F3EA] p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                  Leave Management
                </div>
                <h2 className="mt-1 text-2xl font-bold text-[#2F1B12]">
                  {isEmployeePortal
                    ? "My leave requests"
                    : "Leave approval workbench"}
                </h2>
                <p className="mt-1 max-w-3xl text-sm text-[#6F5A49]">
                  Track leave applications, pending approvals,
                  rejected/cancelled requests, and leave days consumed. This
                  screen is ready for the next policy-engine layer: balances,
                  accruals, carry-forward, and sandwich rules.
                </p>
              </div>
              {(isEmployeePortal || canCreateHR) && (
                <button
                  type="button"
                  onClick={() => setShowLeaveForm(true)}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#8B6F47] px-4 text-sm font-semibold text-white hover:bg-[#6F4E37]"
                >
                  <Plus className="h-4 w-4" />
                  Apply Leave
                </button>
              )}
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-5">
              <div className="rounded-xl border border-[#FEDF89] bg-[#FFFCF5] p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#B54708]">
                  <AlertTriangle className="h-4 w-4" />
                  Pending approval
                </div>
                <div className="mt-2 text-2xl font-bold text-[#2F1B12]">
                  {formatCount(leaveSummary.pending)}
                </div>
              </div>
              <div className="rounded-xl border border-[#A6F4C5] bg-[#F6FEF9] p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#027A48]">
                  <CheckCircle2 className="h-4 w-4" />
                  Approved
                </div>
                <div className="mt-2 text-2xl font-bold text-[#2F1B12]">
                  {formatCount(leaveSummary.approved)}
                </div>
              </div>
              <div className="rounded-xl border border-[#FECDCA] bg-[#FEF3F2] p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#B42318]">
                  <UserX className="h-4 w-4" />
                  Rejected
                </div>
                <div className="mt-2 text-2xl font-bold text-[#2F1B12]">
                  {formatCount(leaveSummary.rejected)}
                </div>
              </div>
              <div className="rounded-xl border border-[#B2DDFF] bg-[#F5FAFF] p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#175CD3]">
                  <CalendarDays className="h-4 w-4" />
                  Leave days
                </div>
                <div className="mt-2 text-2xl font-bold text-[#2F1B12]">
                  {formatCount(leaveSummary.totalDays)}
                </div>
              </div>
              <div className="rounded-xl border border-[#E8DCC4] bg-white p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#8B6F47]">
                  <ClipboardCheck className="h-4 w-4" />
                  Total requests
                </div>
                <div className="mt-2 text-2xl font-bold text-[#2F1B12]">
                  {formatCount(leaveSummary.records)}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-b border-[#E8DCC4] bg-[#FAF9F6] px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                Approval queue
              </div>
              <div className="mt-1 text-sm text-[#6F5A49]">
                Showing {formatCount(filteredLeaves.length)} of{" "}
                {formatCount(leaves.length)} leave requests
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {leaveStatusFilters.map((filter) => {
                const active = leaveStatusFilter === filter.key;
                const toneClass =
                  filter.tone === "success"
                    ? "border-[#A6F4C5] text-[#027A48]"
                    : filter.tone === "warning"
                      ? "border-[#FEDF89] text-[#B54708]"
                      : filter.tone === "danger"
                        ? "border-[#FECDCA] text-[#B42318]"
                        : "border-[#D8C4A8] text-[#4A3426]";
                return (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => setLeaveStatusFilter(filter.key)}
                    className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-xs font-bold transition-colors ${
                      active
                        ? "border-[#8B6F47] bg-[#8B6F47] text-white"
                        : `bg-white hover:bg-[#F5EFE3] ${toneClass}`
                    }`}
                  >
                    <span>{filter.label}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 ${active ? "bg-white/20 text-white" : "bg-[#F7F3EA] text-[#6F5A49]"}`}
                    >
                      {formatCount(filter.count)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[#E8DCC4]">
              <thead className="bg-[#F7F3EA]">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                    Employee
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                    Period
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                    Days
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                    Reason
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFE3CF] bg-white">
                {filteredLeaves.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center">
                      <div className="mx-auto flex max-w-md flex-col items-center">
                        <span className="rounded-full bg-[#F7F3EA] p-3 text-[#8B6F47]">
                          <CalendarDays className="h-6 w-6" />
                        </span>
                        <h3 className="mt-3 text-base font-bold text-[#2F1B12]">
                          No leave requests found
                        </h3>
                        <p className="mt-1 text-sm text-[#7A6555]">
                          {leaveStatusFilter === "ALL"
                            ? "New leave applications will appear here for HR review and approval."
                            : `No ${leaveStatusFilter.toLowerCase()} leave requests match this view.`}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
                {filteredLeaves.map((leave) => (
                  <tr key={leave.id} className="hover:bg-[#FAF9F6]">
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-bold text-[#2F1B12]">
                      {leave.employee_name}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-[#4A3426]">
                      <div className="font-semibold">
                        {new Date(leave.start_date).toLocaleDateString("en-IN")}
                      </div>
                      <div className="text-xs text-[#7A6555]">
                        to{" "}
                        {new Date(leave.end_date).toLocaleDateString("en-IN")}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-bold text-[#4A3426]">
                      {leave.total_days}
                    </td>
                    <td className="max-w-xs truncate px-6 py-4 text-sm text-[#6F5A49]">
                      {leave.reason}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${getStatusColor(leave.status)}`}
                      >
                        {leave.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => {
                            setSelectedLeave(leave);
                            setShowLeaveDetails(true);
                          }}
                          className="rounded-lg border border-[#D8C4A8] px-3 py-1.5 text-xs font-semibold text-[#4A3426] hover:bg-[#F5EFE3]"
                          title="View Details"
                        >
                          View
                        </button>
                        {!isEmployeePortal &&
                          canApproveHR &&
                          isPendingLeaveStatus(leave.status) && (
                            <>
                              <button
                                onClick={() => handleApproveLeave(leave.id)}
                                className="rounded-lg border border-[#A6F4C5] px-3 py-1.5 text-xs font-semibold text-[#027A48] hover:bg-[#ECFDF3]"
                                title="Approve"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => handleRejectLeave(leave.id)}
                                className="rounded-lg border border-[#FECDCA] px-3 py-1.5 text-xs font-semibold text-[#B42318] hover:bg-[#FEF3F2]"
                                title="Reject"
                              >
                                Reject
                              </button>
                              {canEditHR && (
                                <button
                                  onClick={() => {
                                    setSelectedLeave(leave);
                                    setLeaveForm({
                                      employee_id: leave.employee_id,
                                      leave_type: leave.leave_type,
                                      start_date: leave.start_date,
                                      end_date: leave.end_date,
                                      total_days: leave.total_days,
                                      reason: leave.reason,
                                    });
                                    setShowEditLeave(true);
                                  }}
                                  className="rounded-lg border border-[#FEDF89] px-3 py-1.5 text-xs font-semibold text-[#B54708] hover:bg-[#FFFAEB]"
                                  title="Edit"
                                >
                                  Edit
                                </button>
                              )}
                            </>
                          )}
                        {isPendingLeaveStatus(leave.status) &&
                          (isEmployeePortal || canEditHR) && (
                            <button
                              onClick={async () => {
                                if (confirm("Cancel this leave request?")) {
                                  try {
                                    await apiClient.put(
                                      `/hr/leaves/${leave.id}`,
                                      { status: "CANCELLED" },
                                    );
                                    fetchData();
                                    fetchHrCommandCenter();
                                  } catch (err: any) {
                                    alert("Failed to cancel leave");
                                  }
                                }
                              }}
                              className="rounded-lg border border-[#E8DCC4] px-3 py-1.5 text-xs font-semibold text-[#6F5A49] hover:bg-[#F7F3EA]"
                              title="Cancel"
                            >
                              Cancel
                            </button>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Holiday Calendar Tab */}
      {activeTab === "holidays" && (
        <div className="space-y-5">
          <section className="overflow-hidden rounded-2xl border border-[#E8DCC4] bg-white shadow-sm">
            <div className="border-b border-[#E8DCC4] bg-gradient-to-r from-[#FFF8EA] via-white to-[#F7F3EA] p-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-[#E8DCC4] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                    <CalendarDays className="h-3.5 w-3.5" />
                    HR calendar
                  </div>
                  <h2 className="mt-3 text-2xl font-bold text-[#2F1B12]">
                    Holiday Calendar
                  </h2>
                  <p className="mt-1 max-w-4xl text-sm leading-6 text-[#6F5A49]">
                    Central holiday master for HR planning, attendance
                    reference, leave visibility, and payroll cut-off awareness.
                    Casual leave remains separate from this company holiday
                    calendar.
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <label
                    className="text-xs font-bold uppercase tracking-wide text-[#8B6F47]"
                    htmlFor="holiday-year"
                  >
                    Year
                  </label>
                  <input
                    id="holiday-year"
                    type="number"
                    value={holidayYear}
                    onChange={(e) =>
                      setHolidayYear(
                        e.target.value || String(new Date().getFullYear()),
                      )
                    }
                    className="min-h-10 w-32 rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                  />
                  {!isEmployeePortal && canCreateHR && (
                    <button
                      type="button"
                      onClick={() => openHolidayForm()}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#8B6F47] px-4 text-sm font-semibold text-white hover:bg-[#6F4E37]"
                    >
                      <Plus className="h-4 w-4" />
                      Add Holiday
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-4 bg-[#FAF9F6] p-5 md:grid-cols-3">
              <div className="rounded-xl border border-[#FEDF89] bg-[#FFFCF5] p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#B54708]">
                  <CalendarDays className="h-4 w-4" />
                  Holiday entries
                </div>
                <div className="mt-2 text-2xl font-bold text-[#2F1B12]">
                  {formatCount(holidays.length)}
                </div>
              </div>
              <div className="rounded-xl border border-[#B2DDFF] bg-[#F5FAFF] p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#175CD3]">
                  <Clock3 className="h-4 w-4" />
                  Total holiday days
                </div>
                <div className="mt-2 text-2xl font-bold text-[#2F1B12]">
                  {formatCount(totalHolidayDays)}
                </div>
              </div>
              <div className="rounded-xl border border-[#A6F4C5] bg-[#F6FEF9] p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#027A48]">
                  <ShieldCheck className="h-4 w-4" />
                  Calendar scope
                </div>
                <div className="mt-2 text-sm font-semibold leading-6 text-[#2F1B12]">
                  Public/company holidays only. Leave policies stay under Leave
                  Management.
                </div>
              </div>
            </div>
          </section>

          <div className="overflow-hidden rounded-2xl border border-[#E8DCC4] bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-[#E8DCC4] bg-gradient-to-r from-white to-[#FAF9F6] p-5">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                  Year plan
                </div>
                <h3 className="mt-1 text-xl font-bold text-[#2F1B12]">
                  {holidayYear} holiday list
                </h3>
              </div>
              <span className="rounded-full border border-[#E8DCC4] bg-white px-3 py-1 text-xs font-semibold text-[#6F5A49]">
                {formatCount(holidays.length)} entries
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-[#E8DCC4]">
                <thead className="bg-[#F7F3EA]">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                      Holiday
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                      Days
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                      Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                      Notes
                    </th>
                    {!isEmployeePortal && (
                      <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFE3CF] bg-white">
                  {holidays.length === 0 && (
                    <tr>
                      <td
                        colSpan={isEmployeePortal ? 5 : 6}
                        className="px-6 py-12 text-center"
                      >
                        <div className="mx-auto flex max-w-md flex-col items-center">
                          <span className="rounded-full bg-[#F7F3EA] p-3 text-[#8B6F47]">
                            <CalendarDays className="h-6 w-6" />
                          </span>
                          <h3 className="mt-3 text-base font-bold text-[#2F1B12]">
                            No holidays found for {holidayYear}
                          </h3>
                          <p className="mt-1 text-sm text-[#7A6555]">
                            Add public/company holidays so attendance and
                            payroll planning have a reliable calendar.
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                  {holidays.map((holiday) => (
                    <tr key={holiday.id} className="hover:bg-[#FAF9F6]">
                      <td className="whitespace-nowrap px-6 py-4 text-sm font-bold text-[#2F1B12]">
                        {holiday.holiday_name}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm font-semibold text-[#4A3426]">
                        {formatHolidayDateRange(holiday)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm font-bold text-[#4A3426]">
                        {holiday.day_count || 1}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className="inline-flex rounded-full bg-[#EFF8FF] px-2.5 py-1 text-xs font-bold text-[#175CD3]">
                          {holiday.holiday_type || "PUBLIC"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-[#6F5A49]">
                        {holiday.notes || "-"}
                      </td>
                      {!isEmployeePortal && (
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <div className="flex items-center gap-3">
                            {canEditHR && (
                              <button
                                onClick={() => openHolidayForm(holiday)}
                                className="font-semibold text-[#175CD3] hover:underline"
                                title="Edit Holiday"
                              >
                                <svg
                                  className="w-5 h-5"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                  />
                                </svg>
                              </button>
                            )}
                            {canDeleteHR && (
                              <button
                                onClick={() => handleDeleteHoliday(holiday)}
                                className="font-semibold text-[#B42318] hover:underline"
                                title="Delete Holiday"
                              >
                                <svg
                                  className="w-5 h-5"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                  />
                                </svg>
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Payroll Tab */}
      {activeTab === "payroll" && (
        <div className="overflow-hidden rounded-2xl border border-[#E8DCC4] bg-white shadow-sm">
          <div className="border-b border-[#E8DCC4] bg-gradient-to-r from-[#FFF8EA] via-white to-[#F7F3EA] p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                  Payroll & Compensation
                </div>
                <h2 className="mt-1 text-2xl font-bold text-[#2F1B12]">
                  {isEmployeePortal ? "My payslips" : "Payroll control center"}
                </h2>
                <p className="mt-1 max-w-3xl text-sm text-[#6F5A49]">
                  Govern monthly payroll inputs, salary structures, payroll
                  runs, payslip release, statutory calculations, held amounts,
                  and final paid values.
                </p>
              </div>
              {!isEmployeePortal && (
                <div className="flex flex-wrap items-center gap-2">
                  {canCreateHR && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedMonthlyPayroll(null);
                          setShowMonthlyPayrollForm(true);
                        }}
                        className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#8B6F47] px-4 text-sm font-semibold text-white hover:bg-[#6F4E37]"
                      >
                        <Plus className="h-4 w-4" />
                        Process Salary
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowPayrollRunForm(true)}
                        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#D8C4A8] bg-white px-4 text-sm font-semibold text-[#4A3426] hover:bg-[#FAF9F6]"
                      >
                        <WalletCards className="h-4 w-4" />
                        Create Run
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {!isEmployeePortal && (
              <div className="mt-5 grid gap-3 md:grid-cols-5">
                <div className="rounded-xl border border-[#B2DDFF] bg-[#F5FAFF] p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#175CD3]">
                    <IndianRupee className="h-4 w-4" />
                    Gross payroll
                  </div>
                  <div className="mt-2 text-2xl font-bold text-[#2F1B12]">
                    {formatCurrency(payrollSummary.monthlyGross)}
                  </div>
                </div>
                <div className="rounded-xl border border-[#A6F4C5] bg-[#F6FEF9] p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#027A48]">
                    <CheckCircle2 className="h-4 w-4" />
                    Amount paid
                  </div>
                  <div className="mt-2 text-2xl font-bold text-[#2F1B12]">
                    {formatCurrency(payrollSummary.amountPaid)}
                  </div>
                </div>
                <div className="rounded-xl border border-[#FEDF89] bg-[#FFFCF5] p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#B54708]">
                    <AlertTriangle className="h-4 w-4" />
                    Payroll drafts
                  </div>
                  <div className="mt-2 text-2xl font-bold text-[#2F1B12]">
                    {formatCount(payrollSummary.draft)}
                  </div>
                </div>
                <div className="rounded-xl border border-[#FECDCA] bg-[#FEF3F2] p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#B42318]">
                    <FileWarning className="h-4 w-4" />
                    Held amount
                  </div>
                  <div className="mt-2 text-2xl font-bold text-[#2F1B12]">
                    {formatCurrency(payrollSummary.holdAmount)}
                  </div>
                </div>
                <div className="rounded-xl border border-[#E8DCC4] bg-white p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#8B6F47]">
                    <FileText className="h-4 w-4" />
                    Payslips
                  </div>
                  <div className="mt-2 text-2xl font-bold text-[#2F1B12]">
                    {formatCount(payrollSummary.payslips)}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Payroll Sub-tabs */}
          <div className="flex gap-2 overflow-x-auto border-b border-[#E8DCC4] bg-white px-5 py-3">
            <button
              onClick={() => setPayrollSubTab("monthly")}
              className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold ${payrollSubTab === "monthly" ? "bg-[#8B6F47] text-white" : "border border-[#E8DCC4] text-[#6F5A49] hover:bg-[#FAF9F6]"}`}
            >
              Monthly Processing
            </button>
            <button
              onClick={() => setPayrollSubTab("payslips")}
              className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold ${payrollSubTab === "payslips" ? "bg-[#8B6F47] text-white" : "border border-[#E8DCC4] text-[#6F5A49] hover:bg-[#FAF9F6]"}`}
            >
              Payslips
            </button>
            {!isEmployeePortal && (
              <>
                <button
                  onClick={() => setPayrollSubTab("salary")}
                  className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold ${payrollSubTab === "salary" ? "bg-[#8B6F47] text-white" : "border border-[#E8DCC4] text-[#6F5A49] hover:bg-[#FAF9F6]"}`}
                >
                  Salary Components
                </button>
                <button
                  onClick={() => setPayrollSubTab("runs")}
                  className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold ${payrollSubTab === "runs" ? "bg-[#8B6F47] text-white" : "border border-[#E8DCC4] text-[#6F5A49] hover:bg-[#FAF9F6]"}`}
                >
                  Payroll Runs
                </button>
              </>
            )}
          </div>

          <div className="p-5">
            {/* Monthly Processing Section */}
            {payrollSubTab === "monthly" && (
              <>
                <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                      Payroll processing
                    </div>
                    <h3 className="mt-1 text-xl font-bold text-[#2F1B12]">
                      Monthly salary workbench
                    </h3>
                    <p className="mt-1 max-w-3xl text-sm text-[#6F5A49]">
                      Review attendance-paid days, variable earnings, held
                      amounts, deductions, and release status before payroll is
                      locked.
                    </p>
                  </div>
                  {!isEmployeePortal && canCreateHR && (
                    <button
                      onClick={() => {
                        setSelectedMonthlyPayroll(null);
                        setShowMonthlyPayrollForm(true);
                      }}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#8B6F47] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#6F5838]"
                    >
                      <Plus className="h-4 w-4" />
                      Process salary
                    </button>
                  )}
                </div>
                <div className="mb-5 grid gap-3 md:grid-cols-4">
                  <div className="rounded-xl border border-[#B2DDFF] bg-[#F5FAFF] p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#175CD3]">
                      <Users className="h-4 w-4" />
                      Payroll records
                    </div>
                    <div className="mt-2 text-2xl font-bold text-[#2F1B12]">
                      {formatCount(monthlyPayrolls.length)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#FEDF89] bg-[#FFFCF5] p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#B54708]">
                      <AlertTriangle className="h-4 w-4" />
                      Drafts to review
                    </div>
                    <div className="mt-2 text-2xl font-bold text-[#2F1B12]">
                      {formatCount(payrollSummary.draft)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#A6F4C5] bg-[#F6FEF9] p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#027A48]">
                      <CheckCircle2 className="h-4 w-4" />
                      Processed / paid
                    </div>
                    <div className="mt-2 text-2xl font-bold text-[#2F1B12]">
                      {formatCount(payrollSummary.processed)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#FECDCA] bg-[#FEF3F2] p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#B42318]">
                      <FileWarning className="h-4 w-4" />
                      Hold exposure
                    </div>
                    <div className="mt-2 text-2xl font-bold text-[#2F1B12]">
                      {formatCurrency(payrollSummary.holdAmount)}
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-[#E8DCC4] bg-white">
                  <div className="flex flex-col gap-2 border-b border-[#E8DCC4] bg-[#FAF7F0] px-4 py-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-sm font-bold text-[#2F1B12]">
                        Monthly payroll register
                      </div>
                      <div className="text-xs text-[#7A6555]">
                        SAP-style pre-posting control list for salary release.
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs font-semibold">
                      <span className="rounded-full border border-[#E8DCC4] bg-white px-3 py-1 text-[#6F5A49]">
                        Gross {formatCurrency(payrollSummary.monthlyGross)}
                      </span>
                      <span className="rounded-full border border-[#A6F4C5] bg-[#F6FEF9] px-3 py-1 text-[#027A48]">
                        Paid {formatCurrency(payrollSummary.amountPaid)}
                      </span>
                      <span className="rounded-full border border-[#FEDF89] bg-[#FFFCF5] px-3 py-1 text-[#B54708]">
                        Net {formatCurrency(payrollSummary.monthlyNet)}
                      </span>
                    </div>
                  </div>
                  {monthlyPayrolls.length === 0 ? (
                    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                      <div className="rounded-2xl bg-[#FFF8EA] p-4 text-[#8B6F47]">
                        <WalletCards className="h-8 w-8" />
                      </div>
                      <h4 className="mt-4 text-lg font-bold text-[#2F1B12]">
                        No monthly payroll records yet
                      </h4>
                      <p className="mt-1 max-w-xl text-sm text-[#6F5A49]">
                        Start by processing salary for an employee. Draft
                        records can be reviewed, corrected, and then locked by
                        payroll approval.
                      </p>
                      {!isEmployeePortal && canCreateHR && (
                        <button
                          onClick={() => {
                            setSelectedMonthlyPayroll(null);
                            setShowMonthlyPayrollForm(true);
                          }}
                          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#8B6F47] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6F5838]"
                        >
                          <Plus className="h-4 w-4" />
                          Process first salary
                        </button>
                      )}
                    </div>
                  ) : (
                    <table className="min-w-[1320px] w-full divide-y divide-[#E8DCC4]">
                      <thead className="bg-[#F5EFE3]">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#4A3426]">
                            Employee
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#4A3426]">
                            Month
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#4A3426]">
                            Days
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#4A3426]">
                            Paid
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#4A3426]">
                            Bonus
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#4A3426]">
                            Incentive
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#4A3426]">
                            Bonus hold
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#4A3426]">
                            Incentive hold
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#4A3426]">
                            Gross
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#4A3426]">
                            Net
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#4A3426]">
                            Total hold
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#4A3426]">
                            Paid amount
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#4A3426]">
                            Status
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#4A3426]">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EFE3CF] bg-white">
                        {monthlyPayrolls.map((record) => (
                          <tr key={record.id} className="hover:bg-[#FAF9F6]">
                            <td className="whitespace-nowrap px-4 py-4 text-sm font-bold text-[#2F1B12]">
                              {record.employee_name}
                            </td>
                            <td className="whitespace-nowrap px-4 py-4 text-sm font-semibold text-[#4A3426]">
                              {record.payroll_month}
                            </td>
                            <td className="whitespace-nowrap px-4 py-4 text-right text-sm text-[#4A3426]">
                              {record.days_in_month}d
                            </td>
                            <td className="whitespace-nowrap px-4 py-4 text-right text-sm font-bold text-[#027A48]">
                              {record.paid_for_total_days}d
                            </td>
                            <td className="whitespace-nowrap px-4 py-4 text-right text-sm text-[#4A3426]">
                              {formatCurrency(record.bonus_monthly)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-4 text-right text-sm font-semibold text-[#027A48]">
                              {formatCurrency(record.production_incentive)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-4 text-right text-sm font-semibold text-[#B54708]">
                              ({formatCurrency(record.bonus_hold)})
                            </td>
                            <td className="whitespace-nowrap px-4 py-4 text-right text-sm font-semibold text-[#B54708]">
                              (
                              {formatCurrency(record.production_incentive_hold)}
                              )
                            </td>
                            <td className="whitespace-nowrap px-4 py-4 text-right text-sm font-bold text-[#2F1B12]">
                              {formatCurrency(record.gross_salary)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-4 text-right text-sm font-bold text-[#2F1B12]">
                              {formatCurrency(record.net_salary)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-4 text-right text-sm font-bold text-[#B42318]">
                              ({formatCurrency(record.monthly_hold)})
                            </td>
                            <td className="whitespace-nowrap px-4 py-4 text-right text-sm font-bold text-[#027A48]">
                              {formatCurrency(record.amount_paid)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span
                                className={`px-2 py-1 text-xs rounded ${
                                  record.status === "DRAFT"
                                    ? "bg-gray-100 text-gray-800"
                                    : record.status === "PROCESSED"
                                      ? "bg-blue-100 text-blue-800"
                                      : "bg-green-100 text-green-800"
                                }`}
                              >
                                {record.status}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                              {!isEmployeePortal && (
                                <div className="flex space-x-2">
                                  {record.status === "DRAFT" && (
                                    <>
                                      {canEditHR && (
                                        <button
                                          onClick={() =>
                                            handleEditMonthlyPayroll(record)
                                          }
                                          className="text-amber-600 hover:text-amber-800"
                                          title="Edit"
                                        >
                                          <svg
                                            className="w-4 h-4"
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                          >
                                            <path
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                              strokeWidth="2"
                                              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                            />
                                          </svg>
                                        </button>
                                      )}
                                      {canApproveHR && (
                                        <button
                                          onClick={() =>
                                            handleProcessMonthlyPayroll(
                                              record.id!,
                                            )
                                          }
                                          className="text-blue-600 hover:text-blue-800"
                                          title="Process"
                                        >
                                          <svg
                                            className="w-4 h-4"
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                          >
                                            <path
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                              strokeWidth="2"
                                              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                                            />
                                          </svg>
                                        </button>
                                      )}
                                      {canDeleteHR && (
                                        <button
                                          onClick={() =>
                                            handleDeleteMonthlyPayroll(
                                              record.id!,
                                            )
                                          }
                                          className="text-red-600 hover:text-red-800"
                                          title="Delete"
                                        >
                                          <svg
                                            className="w-4 h-4"
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                          >
                                            <path
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                              strokeWidth="2"
                                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                            />
                                          </svg>
                                        </button>
                                      )}
                                    </>
                                  )}
                                  {record.status !== "DRAFT" && (
                                    <button
                                      onClick={() => handlePrintPayslip(record)}
                                      className="text-purple-600 hover:text-purple-800"
                                      title="Print"
                                    >
                                      <svg
                                        className="w-4 h-4"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                      >
                                        <path
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          strokeWidth="2"
                                          d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
                                        />
                                      </svg>
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}

            {/* Salary Components Section */}
            {payrollSubTab === "salary" && (
              <>
                <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                      Salary master
                    </div>
                    <h3 className="mt-1 text-xl font-bold text-[#2F1B12]">
                      Salary Components
                    </h3>
                    <p className="mt-1 max-w-3xl text-sm text-[#6F5A49]">
                      Maintain earning and deduction components used for payroll
                      processing.
                    </p>
                  </div>
                  <div>
                    {(canCreateHR || canEditHR) && (
                      <button
                        onClick={() => setShowComprehensiveSalaryForm(true)}
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#8B6F47] px-4 text-sm font-semibold text-white hover:bg-[#6F4E37]"
                      >
                        <Plus className="h-4 w-4" />
                        Add Component
                      </button>
                    )}
                  </div>
                </div>
                <div className="overflow-hidden rounded-2xl border border-[#E8DCC4] bg-white shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-[#E8DCC4]">
                      <thead className="bg-[#F7F3EA]">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                            Employee
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                            Component Type
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                            Component Name
                          </th>
                          <th className="px-6 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                            Amount
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                            Taxable
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EFE3CF] bg-white">
                        {salaryComponents.length === 0 && (
                          <tr>
                            <td
                              colSpan={6}
                              className="px-6 py-10 text-center text-sm text-[#7A6555]"
                            >
                              No salary components configured yet.
                            </td>
                          </tr>
                        )}
                        {salaryComponents.map((comp) => (
                          <tr key={comp.id} className="hover:bg-[#FAF9F6]">
                            <td className="whitespace-nowrap px-6 py-4 text-sm font-bold text-[#2F1B12]">
                              {comp.employee_name || "N/A"}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-sm">
                              <span className="inline-flex rounded-full bg-[#EFF8FF] px-2.5 py-1 text-xs font-bold text-[#175CD3]">
                                {comp.component_type}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-sm font-semibold text-[#4A3426]">
                              {comp.component_name}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-bold text-[#2F1B12]">
                              {formatCurrency(comp.amount)}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-sm">
                              <span
                                className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${comp.is_taxable ? "bg-[#ECFDF3] text-[#027A48]" : "bg-[#F7F3EA] text-[#6F5A49]"}`}
                              >
                                {comp.is_taxable ? "Yes" : "No"}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-sm">
                              {canDeleteHR && (
                                <button
                                  onClick={() =>
                                    handleDeleteSalaryComponent(comp.id)
                                  }
                                  className="font-semibold text-[#B42318] hover:underline"
                                >
                                  Delete
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {/* Payroll Runs Section */}
            {payrollSubTab === "runs" && (
              <>
                <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                      Payroll cycle
                    </div>
                    <h3 className="mt-1 text-xl font-bold text-[#2F1B12]">
                      Payroll Runs
                    </h3>
                    <p className="mt-1 max-w-3xl text-sm text-[#6F5A49]">
                      Track monthly payroll batches and payslip generation
                      readiness.
                    </p>
                  </div>
                  {canCreateHR && (
                    <button
                      onClick={() => setShowPayrollRunForm(true)}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#8B6F47] px-4 text-sm font-semibold text-white hover:bg-[#6F4E37]"
                    >
                      <Plus className="h-4 w-4" />
                      Create Run
                    </button>
                  )}
                </div>
                <div className="overflow-hidden rounded-2xl border border-[#E8DCC4] bg-white shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-[#E8DCC4]">
                      <thead className="bg-[#F7F3EA]">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                            Month
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                            Run Date
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                            Status
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                            Remarks
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EFE3CF] bg-white">
                        {payrollRuns.length === 0 && (
                          <tr>
                            <td
                              colSpan={5}
                              className="px-6 py-10 text-center text-sm text-[#7A6555]"
                            >
                              No payroll runs created yet.
                            </td>
                          </tr>
                        )}
                        {payrollRuns.map((run) => (
                          <tr key={run.id} className="hover:bg-[#FAF9F6]">
                            <td className="whitespace-nowrap px-6 py-4 text-sm font-bold text-[#2F1B12]">
                              {run.payroll_month}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-sm font-semibold text-[#4A3426]">
                              {new Date(run.run_date).toLocaleDateString(
                                "en-IN",
                              )}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-sm">
                              <span
                                className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${getStatusColor(run.status)}`}
                              >
                                {run.status}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm text-[#6F5A49]">
                              {run.remarks || "-"}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-sm">
                              {run.status === "PENDING" && canApproveHR && (
                                <button
                                  onClick={() => handleGeneratePayslips(run.id)}
                                  disabled={loading}
                                  className="font-semibold text-[#8B6F47] hover:underline disabled:opacity-50"
                                >
                                  Generate Payslips
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {/* Payslips Section */}
            {payrollSubTab === "payslips" && (
              <>
                <div className="mb-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                    Salary documents
                  </div>
                  <h3 className="mt-1 text-xl font-bold text-[#2F1B12]">
                    Payslips
                  </h3>
                  <p className="mt-1 max-w-3xl text-sm text-[#6F5A49]">
                    Review and print employee salary slips generated from
                    processed payroll.
                  </p>
                </div>
                <div className="overflow-hidden rounded-2xl border border-[#E8DCC4] bg-white shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-[#E8DCC4]">
                      <thead className="bg-[#F7F3EA]">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                            Payslip #
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                            Employee
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                            Month
                          </th>
                          <th className="px-6 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                            Gross
                          </th>
                          <th className="px-6 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                            Deductions
                          </th>
                          <th className="px-6 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                            Travel Per Diem
                          </th>
                          <th className="px-6 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                            Net Pay
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                            Days
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#6F5A49]">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EFE3CF] bg-white">
                        {payslips.length === 0 && (
                          <tr>
                            <td
                              colSpan={9}
                              className="px-6 py-10 text-center text-sm text-[#7A6555]"
                            >
                              No payslips generated yet.
                            </td>
                          </tr>
                        )}
                        {payslips.map((slip) => (
                          <tr key={slip.id} className="hover:bg-[#FAF9F6]">
                            <td className="whitespace-nowrap px-6 py-4 text-sm font-bold text-[#2F1B12]">
                              {slip.payslip_number}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-sm font-semibold text-[#4A3426]">
                              {slip.employee_name}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-sm text-[#4A3426]">
                              {slip.salary_month}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-bold text-[#2F1B12]">
                              {formatCurrency(slip.gross_salary)}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-semibold text-[#B42318]">
                              {formatCurrency(slip.total_deductions)}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-semibold text-[#175CD3]">
                              {Number(slip.travel_days || 0) > 0
                                ? `${slip.travel_days} day(s) / ${formatCurrency(Number(slip.total_per_diem || 0))}`
                                : "-"}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-bold text-[#027A48]">
                              {formatCurrency(slip.net_salary)}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-sm text-[#6F5A49]">
                              {slip.attendance_days} present / {slip.leave_days}{" "}
                              leave
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-sm">
                              <button
                                onClick={() => handlePrintPayslip(slip)}
                                className="font-semibold text-[#175CD3] hover:underline"
                                title="Print Payslip"
                              >
                                Print
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Create Employee Modal */}
      {showEmployeeForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2F1B12]/55 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-[#E8DCC4] bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[#E8DCC4] bg-gradient-to-r from-[#FFF8EA] via-white to-[#F7F3EA] p-5">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-[#E8DCC4] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                  <UserPlus className="h-3.5 w-3.5" />
                  Employee Central
                </div>
                <h2 className="mt-3 text-2xl font-bold text-[#2F1B12]">
                  Create New Employee
                </h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-[#6F5A49]">
                  Add core employee master data used for attendance, leave,
                  payroll, and role-linked HR records.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowEmployeeForm(false)}
                className="rounded-full border border-[#E8DCC4] bg-white px-3 py-1.5 text-lg leading-none text-[#6F5A49] hover:bg-[#F7F3EA]"
                aria-label="Close create employee modal"
              >
                ×
              </button>
            </div>
            <form
              onSubmit={handleCreateEmployee}
              className="max-h-[calc(92vh-132px)] overflow-y-auto p-5"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                    Employee Code *
                  </label>
                  <input
                    type="text"
                    value={employeeForm.employee_code}
                    onChange={(e) =>
                      setEmployeeForm({
                        ...employeeForm,
                        employee_code: e.target.value,
                      })
                    }
                    className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                    Employee Name *
                  </label>
                  <input
                    type="text"
                    value={employeeForm.employee_name}
                    onChange={(e) =>
                      setEmployeeForm({
                        ...employeeForm,
                        employee_name: e.target.value,
                      })
                    }
                    className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                    required
                  />
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                    Designation
                  </label>
                  <input
                    type="text"
                    value={employeeForm.designation}
                    onChange={(e) =>
                      setEmployeeForm({
                        ...employeeForm,
                        designation: e.target.value,
                      })
                    }
                    className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                    Department
                  </label>
                  <input
                    type="text"
                    value={employeeForm.department}
                    onChange={(e) =>
                      setEmployeeForm({
                        ...employeeForm,
                        department: e.target.value,
                      })
                    }
                    className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                  />
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                    Date of Joining
                  </label>
                  <DateInput
                    max={todayDate}
                    value={employeeForm.date_of_joining}
                    onChange={(value) =>
                      setEmployeeForm({
                        ...employeeForm,
                        date_of_joining: value,
                      })
                    }
                    className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                    Date of Birth
                  </label>
                  <DateInput
                    max={todayDate}
                    value={employeeForm.date_of_birth}
                    onChange={(value) =>
                      setEmployeeForm({ ...employeeForm, date_of_birth: value })
                    }
                    className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                  />
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                    Contact Number
                  </label>
                  <input
                    type="text"
                    value={employeeForm.contact_number}
                    onChange={(e) =>
                      setEmployeeForm({
                        ...employeeForm,
                        contact_number: e.target.value,
                      })
                    }
                    className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                    Email
                  </label>
                  <input
                    type="email"
                    value={employeeForm.email}
                    onChange={(e) =>
                      setEmployeeForm({
                        ...employeeForm,
                        email: e.target.value,
                      })
                    }
                    className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                  Per Diem Amount (₹)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={employeeForm.per_diem_amount}
                  onChange={(e) =>
                    setEmployeeForm({
                      ...employeeForm,
                      per_diem_amount: e.target.value,
                    })
                  }
                  className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                  placeholder="Daily outstation travel allowance"
                />
                <p className="mt-1 text-xs text-[#7A6555]">
                  Used when HR marks an attendance day as outstation travel.
                </p>
              </div>

              <div className="mt-4">
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                  Address
                </label>
                <textarea
                  value={employeeForm.address}
                  onChange={(e) =>
                    setEmployeeForm({
                      ...employeeForm,
                      address: e.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-[#D8C4A8] bg-white px-3 py-2 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                  rows={2}
                />
              </div>

              <div className="mt-4">
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                  Biometric ID
                </label>
                <input
                  type="text"
                  value={employeeForm.biometric_id}
                  onChange={(e) =>
                    setEmployeeForm({
                      ...employeeForm,
                      biometric_id: e.target.value,
                    })
                  }
                  className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                />
              </div>

              <div className="sticky bottom-0 -mx-5 mt-5 flex justify-end gap-3 border-t border-[#E8DCC4] bg-white/95 px-5 py-4 backdrop-blur">
                <button
                  type="button"
                  onClick={() => setShowEmployeeForm(false)}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#D8C4A8] bg-white px-4 text-sm font-semibold text-[#4A3426] hover:bg-[#FAF9F6]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#8B6F47] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[#6F4E37]"
                >
                  <UserPlus className="h-4 w-4" />
                  Create Employee
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Attendance Modal */}
      {showAttendanceForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2F1B12]/55 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-[#E8DCC4] bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[#E8DCC4] bg-gradient-to-r from-[#FFF8EA] via-white to-[#F7F3EA] p-5">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-[#E8DCC4] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                  <Clock3 className="h-3.5 w-3.5" />
                  Time Office
                </div>
                <h2 className="mt-3 text-2xl font-bold text-[#2F1B12]">
                  Record Attendance
                </h2>
                <p className="mt-1 max-w-xl text-sm leading-6 text-[#6F5A49]">
                  Use this for HR-entered corrections, biometric exceptions, and
                  approved manual attendance records.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAttendanceForm(false)}
                className="rounded-full border border-[#E8DCC4] bg-white px-3 py-1.5 text-lg leading-none text-[#6F5A49] hover:bg-[#F7F3EA]"
                aria-label="Close record attendance modal"
              >
                ×
              </button>
            </div>
            <form
              onSubmit={handleRecordAttendance}
              className="max-h-[calc(92vh-132px)] overflow-y-auto p-5"
            >
              <div className="rounded-xl border border-[#B2DDFF] bg-[#F5FAFF] p-4">
                <div className="flex items-start gap-3">
                  <GaugeCircle className="mt-0.5 h-5 w-5 text-[#175CD3]" />
                  <div>
                    <div className="text-sm font-bold text-[#2F1B12]">
                      Manual attendance entry
                    </div>
                    <p className="mt-1 text-sm leading-6 text-[#6F5A49]">
                      Select the employee, attendance date, punch times, and
                      final day status. This entry updates HR attendance
                      records.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                  Employee *
                </label>
                <select
                  value={attendanceForm.employee_id}
                  onChange={(e) =>
                    setAttendanceForm({
                      ...attendanceForm,
                      employee_id: e.target.value,
                    })
                  }
                  disabled={attendanceEmployeeOptionsLoading}
                  className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4] disabled:bg-[#F7F3EA] disabled:text-[#7A6555]"
                  required
                >
                  <option value="">
                    {attendanceEmployeeOptionsLoading
                      ? "Loading employees..."
                      : "Select Employee"}
                  </option>
                  {attendanceEmployeeOptions.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.employee_name} ({emp.employee_code})
                    </option>
                  ))}
                </select>
                {!attendanceEmployeeOptionsLoading &&
                  attendanceEmployeeOptions.length === 0 && (
                    <p className="mt-2 text-xs font-medium text-red-700">
                      No active employees found. Please check Employee Master or
                      refresh the HR page.
                    </p>
                  )}
              </div>

              <div className="mt-4">
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                  Attendance Date *
                </label>
                <DateInput
                  max={todayDate}
                  value={attendanceForm.attendance_date}
                  onChange={(value) =>
                    setAttendanceForm({
                      ...attendanceForm,
                      attendance_date: value,
                    })
                  }
                  className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                  required
                />
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                    Check In Time
                  </label>
                  <input
                    type="time"
                    value={attendanceForm.check_in_time}
                    onChange={(e) =>
                      setAttendanceForm({
                        ...attendanceForm,
                        check_in_time: e.target.value,
                      })
                    }
                    className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                    Check Out Time
                  </label>
                  <input
                    type="time"
                    value={attendanceForm.check_out_time}
                    onChange={(e) =>
                      setAttendanceForm({
                        ...attendanceForm,
                        check_out_time: e.target.value,
                      })
                    }
                    className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                  Status *
                </label>
                <select
                  value={attendanceForm.status}
                  onChange={(e) =>
                    setAttendanceForm({
                      ...attendanceForm,
                      status: e.target.value,
                    })
                  }
                  className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                  required
                >
                  <option value="PRESENT">Present</option>
                  <option value="ABSENT">Absent</option>
                  <option value="LEAVE">Leave</option>
                  <option value="LATE">Late</option>
                  <option value="HALF_DAY">Half Day</option>
                  <option value="WORK_FROM_HOME">Work From Home</option>
                </select>
              </div>

              <div className="mt-4">
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                  Remarks
                </label>
                <textarea
                  value={attendanceForm.remarks}
                  onChange={(e) =>
                    setAttendanceForm({
                      ...attendanceForm,
                      remarks: e.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-[#D8C4A8] bg-white px-3 py-2 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                  rows={2}
                />
              </div>

              <div className="mt-4 rounded-xl border border-[#FEDF89] bg-[#FFFAEB] p-4">
                <label className="flex items-start gap-2 text-sm font-semibold text-[#4A3426]">
                  <input
                    type="checkbox"
                    checked={attendanceForm.is_outstation_travel}
                    onChange={(e) =>
                      setAttendanceForm({
                        ...attendanceForm,
                        is_outstation_travel: e.target.checked,
                      })
                    }
                    className="mt-1 h-4 w-4 rounded border-[#D8C4A8] text-[#8B6F47] focus:ring-[#E8DCC4]"
                  />
                  Outstation travel / per diem day
                </label>
                {attendanceForm.is_outstation_travel && (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                        Departure Time
                      </label>
                      <input
                        type="time"
                        value={attendanceForm.travel_departure_time}
                        onChange={(e) =>
                          setAttendanceForm({
                            ...attendanceForm,
                            travel_departure_time: e.target.value,
                          })
                        }
                        className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                        Office Return Time
                      </label>
                      <input
                        type="time"
                        value={attendanceForm.travel_arrival_time}
                        onChange={(e) =>
                          setAttendanceForm({
                            ...attendanceForm,
                            travel_arrival_time: e.target.value,
                          })
                        }
                        className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                        Travel Notes
                      </label>
                      <textarea
                        value={attendanceForm.travel_notes}
                        onChange={(e) =>
                          setAttendanceForm({
                            ...attendanceForm,
                            travel_notes: e.target.value,
                          })
                        }
                        className="w-full rounded-lg border border-[#D8C4A8] bg-white px-3 py-2 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                        rows={2}
                        placeholder="Train/flight details, city, customer visit, approval note..."
                      />
                    </div>
                    <p className="md:col-span-2 text-xs leading-5 text-[#8B6F47]">
                      Per diem applies when travel starts before 8:00 pm. If the
                      employee reaches office before 8:00 am, the return day is
                      not counted as a travel day.
                    </p>
                  </div>
                )}
              </div>

              <div className="sticky bottom-0 -mx-5 mt-5 flex justify-end gap-3 border-t border-[#E8DCC4] bg-white/95 px-5 py-4 backdrop-blur">
                <button
                  type="button"
                  onClick={() => setShowAttendanceForm(false)}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#D8C4A8] bg-white px-4 text-sm font-semibold text-[#4A3426] hover:bg-[#FAF9F6]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#8B6F47] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[#6F4E37]"
                >
                  <Clock3 className="h-4 w-4" />
                  Record Attendance
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Apply Leave Modal */}
      {showLeaveForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#2F1B12]/55 px-2 pb-[calc(4.5rem+env(safe-area-inset-bottom))] pt-2 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="flex max-h-[calc(100dvh-5.5rem-env(safe-area-inset-bottom))] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#E8DCC4] bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)]">
            <div className="shrink-0 flex items-start justify-between gap-4 border-b border-[#E8DCC4] bg-gradient-to-r from-[#FFF8EA] via-white to-[#F7F3EA] p-4 sm:p-5">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-[#E8DCC4] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                  <ClipboardCheck className="h-3.5 w-3.5" />
                  Leave Management
                </div>
                <h2 className="mt-3 text-2xl font-bold text-[#2F1B12]">
                  Apply Leave
                </h2>
                <p className="mt-1 max-w-xl text-sm leading-6 text-[#6F5A49]">
                  Submit a leave request for approval. Future leave dates are
                  allowed for planning and payroll visibility.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowLeaveForm(false)}
                className="rounded-full border border-[#E8DCC4] bg-white px-3 py-1.5 text-lg leading-none text-[#6F5A49] hover:bg-[#F7F3EA]"
                aria-label="Close apply leave modal"
              >
                ×
              </button>
            </div>
            <form
              onSubmit={handleApplyLeave}
              className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5"
            >
              <div className="rounded-xl border border-[#E8DCC4] bg-[#FAF9F6] p-4">
                <div className="text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                  Request ownership
                </div>
                <p className="mt-1 text-sm text-[#6F5A49]">
                  {isEmployeePortal
                    ? "Your employee profile is locked for this self-service request."
                    : "Select the employee for whom the leave is being applied."}
                </p>
              </div>

              <div className="mt-4">
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                  Employee *
                </label>
                <select
                  value={leaveForm.employee_id}
                  onChange={(e) =>
                    setLeaveForm({ ...leaveForm, employee_id: e.target.value })
                  }
                  disabled={isEmployeePortal || leaveEmployeeOptionsLoading}
                  className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4] disabled:bg-[#F7F3EA] disabled:text-[#7A6555]"
                  required
                >
                  <option value="">
                    {leaveEmployeeOptionsLoading
                      ? "Loading employees..."
                      : "Select Employee"}
                  </option>
                  {(isEmployeePortal && myEmployee
                    ? [myEmployee]
                    : leaveEmployeeOptions
                  ).map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.employee_name} ({emp.employee_code})
                    </option>
                  ))}
                </select>
                {!isEmployeePortal &&
                  !leaveEmployeeOptionsLoading &&
                  leaveEmployeeOptions.length === 0 && (
                    <p className="mt-2 text-xs font-medium text-red-700">
                      No active employees found. Please check Employee Master or
                      refresh the HR page.
                    </p>
                  )}
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                    Start Date *
                  </label>
                  <DateInput
                    min={addDaysToDateInput(todayDate, 1)}
                    value={leaveForm.start_date}
                    onChange={(value) =>
                      setLeaveForm((prev) =>
                        normalizeLeaveDateForm(prev, { start_date: value }),
                      )
                    }
                    className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                    End Date *
                  </label>
                  <DateInput
                    min={
                      leaveForm.start_date || addDaysToDateInput(todayDate, 1)
                    }
                    value={leaveForm.end_date}
                    onChange={(value) =>
                      setLeaveForm((prev) =>
                        normalizeLeaveDateForm(prev, { end_date: value }),
                      )
                    }
                    className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                    required
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                  Total Days *
                </label>
                <input
                  type="number"
                  value={leaveForm.total_days}
                  readOnly
                  className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-[#F7F3EA] px-3 text-sm font-semibold text-[#2F1B12] outline-none"
                  min="1"
                  required
                />
                <p className="mt-1 text-xs text-[#7A6555]">
                  Auto-calculated from start/end dates. Sundays are paid weekly
                  off and are not counted.
                </p>
              </div>

              <div className="mt-4">
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                  Reason *
                </label>
                <textarea
                  value={leaveForm.reason}
                  onChange={(e) =>
                    setLeaveForm({ ...leaveForm, reason: e.target.value })
                  }
                  className="w-full rounded-lg border border-[#D8C4A8] bg-white px-3 py-2 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                  rows={3}
                  required
                />
              </div>

              <div className="sticky bottom-0 -mx-4 mt-5 flex justify-end gap-3 border-t border-[#E8DCC4] bg-white/95 px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur sm:-mx-5 sm:px-5">
                <button
                  type="button"
                  onClick={() => setShowLeaveForm(false)}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#D8C4A8] bg-white px-4 text-sm font-semibold text-[#4A3426] hover:bg-[#FAF9F6]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#8B6F47] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[#6F4E37]"
                >
                  <ClipboardCheck className="h-4 w-4" />
                  Submit Leave Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showHolidayForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2F1B12]/55 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-[#E8DCC4] bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[#E8DCC4] bg-gradient-to-r from-[#FFF8EA] via-white to-[#F7F3EA] p-5">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-[#E8DCC4] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                  <CalendarDays className="h-3.5 w-3.5" />
                  HR Calendar
                </div>
                <h2 className="mt-3 text-2xl font-bold text-[#2F1B12]">
                  {selectedHoliday ? "Edit Holiday" : "Add Holiday"}
                </h2>
                <p className="mt-1 max-w-xl text-sm leading-6 text-[#6F5A49]">
                  Maintain public, company, and optional holidays used by
                  attendance visibility and payroll planning.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowHolidayForm(false);
                  resetHolidayForm();
                }}
                className="rounded-full border border-[#E8DCC4] bg-white px-3 py-1.5 text-lg leading-none text-[#6F5A49] hover:bg-[#F7F3EA]"
                aria-label="Close holiday modal"
              >
                ×
              </button>
            </div>
            <form
              onSubmit={handleSaveHoliday}
              className="max-h-[calc(92vh-132px)] overflow-y-auto p-5"
            >
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                  Holiday Name *
                </label>
                <input
                  type="text"
                  value={holidayForm.holiday_name}
                  onChange={(e) =>
                    setHolidayForm({
                      ...holidayForm,
                      holiday_name: e.target.value,
                    })
                  }
                  className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                  required
                />
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                    Start Date *
                  </label>
                  <DateInput
                    value={holidayForm.start_date}
                    onChange={(value) =>
                      setHolidayForm({ ...holidayForm, start_date: value })
                    }
                    className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                    End Date
                  </label>
                  <DateInput
                    min={holidayForm.start_date}
                    value={holidayForm.end_date}
                    onChange={(value) =>
                      setHolidayForm({ ...holidayForm, end_date: value })
                    }
                    className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                  />
                </div>
              </div>
              <div className="mt-4">
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                  Holiday Type
                </label>
                <select
                  value={holidayForm.holiday_type}
                  onChange={(e) =>
                    setHolidayForm({
                      ...holidayForm,
                      holiday_type: e.target.value,
                    })
                  }
                  className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                >
                  <option value="PUBLIC">Public Holiday</option>
                  <option value="COMPANY">Company Holiday</option>
                  <option value="OPTIONAL">Optional Holiday</option>
                </select>
              </div>
              <div className="mt-4">
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                  Notes
                </label>
                <textarea
                  value={holidayForm.notes}
                  onChange={(e) =>
                    setHolidayForm({ ...holidayForm, notes: e.target.value })
                  }
                  className="w-full rounded-lg border border-[#D8C4A8] bg-white px-3 py-2 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                  rows={3}
                />
              </div>
              <div className="sticky bottom-0 -mx-5 mt-5 flex justify-end gap-3 border-t border-[#E8DCC4] bg-white/95 px-5 py-4 backdrop-blur">
                <button
                  type="button"
                  onClick={() => {
                    setShowHolidayForm(false);
                    resetHolidayForm();
                  }}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#D8C4A8] bg-white px-4 text-sm font-semibold text-[#4A3426] hover:bg-[#FAF9F6]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#8B6F47] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[#6F4E37] disabled:opacity-50"
                >
                  <CalendarDays className="h-4 w-4" />
                  {loading
                    ? "Saving..."
                    : selectedHoliday
                      ? "Update Holiday"
                      : "Add Holiday"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Attendance Import Modal */}
      {showAttendanceImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2F1B12]/55 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-[#E8DCC4] bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[#E8DCC4] bg-gradient-to-r from-[#FFF8EA] via-white to-[#F7F3EA] p-5">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-[#E8DCC4] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                  <FileText className="h-3.5 w-3.5" />
                  Time Office Import
                </div>
                <h3 className="mt-3 text-2xl font-bold text-[#2F1B12]">
                  Import Biometric Attendance
                </h3>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-[#6F5A49]">
                  Paste a JSON array from the biometric system. Each row should
                  include biometric ID, date, punch times, and attendance
                  status.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAttendanceImport(false)}
                className="rounded-full border border-[#E8DCC4] bg-white px-3 py-1.5 text-lg leading-none text-[#6F5A49] hover:bg-[#F7F3EA]"
                aria-label="Close biometric import modal"
              >
                ×
              </button>
            </div>
            <div className="max-h-[calc(92vh-132px)] overflow-y-auto p-5">
              <div className="rounded-xl border border-[#B2DDFF] bg-[#F5FAFF] p-4">
                <div className="text-xs font-bold uppercase tracking-wide text-[#175CD3]">
                  Expected JSON format
                </div>
                <code className="mt-2 block break-words rounded-lg bg-white p-3 text-xs text-[#4A3426] ring-1 ring-[#D8C4A8]">
                  [
                  {`{"biometric_id":"1001","attendance_date":"2025-12-19","check_in_time":"09:00","check_out_time":"18:00","status":"PRESENT"}`}
                  ]
                </code>
              </div>
              <textarea
                value={attendanceImportText}
                onChange={(e) => setAttendanceImportText(e.target.value)}
                className="mt-4 w-full rounded-xl border border-[#D8C4A8] bg-[#FAF9F6] px-3 py-3 font-mono text-sm text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                rows={10}
                placeholder={
                  '[{"biometric_id":"1001","attendance_date":"2025-12-19","check_in_time":"09:00","check_out_time":"18:00","status":"PRESENT"}]'
                }
              />
              {attendanceImportResult && (
                <div className="mt-3 rounded-xl border border-[#E8DCC4] bg-white p-3 text-sm font-semibold text-[#4A3426]">
                  {attendanceImportResult}
                </div>
              )}
              <div className="sticky bottom-0 -mx-5 mt-5 flex justify-end gap-3 border-t border-[#E8DCC4] bg-white/95 px-5 py-4 backdrop-blur">
                <button
                  type="button"
                  onClick={() => setShowAttendanceImport(false)}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#D8C4A8] bg-white px-4 text-sm font-semibold text-[#4A3426] hover:bg-[#FAF9F6]"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleAttendanceImport}
                  disabled={loading}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#8B6F47] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[#6F4E37] disabled:opacity-50"
                >
                  <FileText className="h-4 w-4" />
                  {loading ? "Importing..." : "Import"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Employee Details Modal */}
      {showEmployeeDetails && selectedEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2F1B12]/55 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-[#E8DCC4] bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[#E8DCC4] bg-gradient-to-r from-[#FFF8EA] via-white to-[#F7F3EA] p-5">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#8B6F47] text-lg font-bold uppercase text-white">
                  {String(
                    selectedEmployee.employee_name ||
                      selectedEmployee.employee_code ||
                      "?",
                  ).slice(0, 1)}
                </div>
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-[#E8DCC4] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                    <UserCheck className="h-3.5 w-3.5" />
                    Employee Central
                  </div>
                  <h3 className="mt-3 text-2xl font-bold text-[#2F1B12]">
                    {selectedEmployee.employee_name}
                  </h3>
                  <p className="mt-1 text-sm font-semibold text-[#8B6F47]">
                    {selectedEmployee.employee_code || "-"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowEmployeeDetails(false)}
                className="rounded-full border border-[#E8DCC4] bg-white px-3 py-1.5 text-lg leading-none text-[#6F5A49] hover:bg-[#F7F3EA]"
                aria-label="Close employee details"
              >
                ×
              </button>
            </div>

            <div className="max-h-[calc(92vh-132px)] overflow-y-auto p-5">
              <div className="grid gap-3 text-sm md:grid-cols-4">
                {[
                  ["Designation", selectedEmployee.designation || "N/A"],
                  ["Department", selectedEmployee.department || "N/A"],
                  ["Email", selectedEmployee.email || "N/A"],
                  ["Contact", selectedEmployee.contact_number || "N/A"],
                  [
                    "Per Diem",
                    formatPerDiemAmount(
                      Number(
                        selectedEmployee.per_diem_amount ??
                          selectedEmployee.per_diem_rate ??
                          0,
                      ),
                    ),
                  ],
                  [
                    "Joining Date",
                    selectedEmployee.date_of_joining
                      ? new Date(
                          selectedEmployee.date_of_joining,
                        ).toLocaleDateString("en-IN")
                      : "N/A",
                  ],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-xl border border-[#E8DCC4] bg-[#FAF9F6] p-3"
                  >
                    <div className="text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                      {label}
                    </div>
                    <div className="mt-1 break-words font-bold text-[#2F1B12]">
                      {value}
                    </div>
                  </div>
                ))}
                <div className="rounded-xl border border-[#E8DCC4] bg-white p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                    Status
                  </div>
                  <span
                    className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${getStatusColor(selectedEmployee.status)}`}
                  >
                    {selectedEmployee.status}
                  </span>
                </div>
              </div>

              <div className="mt-6">
                <h4 className="text-sm font-semibold mb-2">Documents</h4>
                <div className="border rounded">
                  <div className="divide-y">
                    {employeeDocuments.length === 0 && (
                      <div className="p-3 text-sm text-gray-500">
                        No documents
                      </div>
                    )}
                    {employeeDocuments.map((d) => (
                      <div
                        key={d.id}
                        className="p-3 flex items-center justify-between"
                      >
                        <div className="text-sm">
                          <div className="font-medium">{d.doc_type}</div>
                          <div className="text-gray-600">
                            {d.file_name || "Attachment"}
                            {d.created_at
                              ? ` - ${new Date(d.created_at).toLocaleDateString()}`
                              : ""}
                          </div>
                        </div>
                        <div className="space-x-2">
                          <button
                            type="button"
                            onClick={() => openFileUrlInNewTab(d.file_url)}
                            className="px-3 py-1 border rounded hover:bg-gray-50 text-sm"
                          >
                            View
                          </button>
                          {canDeleteHR && (
                            <button
                              type="button"
                              onClick={() => handleDeleteEmployeeDocument(d.id)}
                              className="px-3 py-1 border rounded hover:bg-gray-50 text-sm text-red-600"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Document Type
                    </label>
                    <input
                      type="text"
                      value={documentForm.doc_type}
                      onChange={(e) =>
                        setDocumentForm({
                          ...documentForm,
                          doc_type: e.target.value,
                        })
                      }
                      className="w-full border rounded px-3 py-2"
                      placeholder="Aadhar / Photo / Police Verification"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Upload File
                    </label>
                    <input
                      type="file"
                      disabled={!canEditHR}
                      className="w-full border rounded px-3 py-2"
                      accept="application/pdf,image/png,image/jpeg,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) await handleEmployeeDocumentFileSelect(file);
                      }}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-1">
                      Or Paste File URL
                    </label>
                    <input
                      type="text"
                      value={documentForm.file_url}
                      onChange={(e) =>
                        setDocumentForm({
                          ...documentForm,
                          file_url: e.target.value,
                        })
                      }
                      className="w-full border rounded px-3 py-2"
                      placeholder="https://... or data:..."
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-1">
                      Notes (optional)
                    </label>
                    <input
                      type="text"
                      value={documentForm.notes}
                      onChange={(e) =>
                        setDocumentForm({
                          ...documentForm,
                          notes: e.target.value,
                        })
                      }
                      className="w-full border rounded px-3 py-2"
                      placeholder="Any notes"
                    />
                  </div>
                  <div className="col-span-2 flex justify-end">
                    {canEditHR && (
                      <button
                        type="button"
                        onClick={handleAddEmployeeDocument}
                        disabled={loading}
                        className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50"
                      >
                        {loading ? "Saving..." : "Add Document"}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <div className="flex justify-between items-center mb-2">
                  <h4 className="text-sm font-semibold">Merits & Demerits</h4>
                  {canApproveHR && (
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedEmployee?.id) {
                          setShowKPICalculator(true);
                        }
                      }}
                      className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                    >
                      Calculate KPI Review
                    </button>
                  )}
                </div>
                <div className="border rounded">
                  <div className="divide-y">
                    {meritsDemerits.length === 0 && (
                      <div className="p-3 text-sm text-gray-500">
                        No records
                      </div>
                    )}
                    {meritsDemerits.map((r) => (
                      <div
                        key={r.id}
                        className="p-3 flex items-center justify-between"
                      >
                        <div className="text-sm">
                          <div className="font-medium">
                            <span
                              className={`px-2 py-0.5 rounded text-xs ${r.record_type === "DEMERIT" ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"}`}
                            >
                              {r.record_type}
                            </span>
                            <span className="ml-2">{r.title}</span>
                            <span
                              className={`ml-2 px-2 py-0.5 rounded text-xs ${r.status === "APPROVED" ? "bg-emerald-100 text-emerald-800" : r.status === "PENDING_APPROVAL" ? "bg-amber-100 text-amber-800" : r.status === "VOID" ? "bg-slate-100 text-slate-700" : "bg-red-100 text-red-800"}`}
                            >
                              {String(r.status || "APPROVED").replace("_", " ")}
                            </span>
                          </div>
                          <div className="text-gray-600">
                            {r.event_date
                              ? new Date(r.event_date).toLocaleDateString()
                              : ""}
                            {typeof r.points === "number"
                              ? ` - Points: ${r.points}`
                              : ""}
                          </div>
                          {r.description && (
                            <div className="text-gray-600 mt-1">
                              {r.description}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2">
                          {canApproveHR && r.status === "PENDING_APPROVAL" && (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  handleApproveMeritDemerit(r.id, true)
                                }
                                className="px-3 py-1 border rounded hover:bg-gray-50 text-sm text-emerald-700"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleApproveMeritDemerit(r.id, false)
                                }
                                className="px-3 py-1 border rounded hover:bg-gray-50 text-sm text-red-600"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {canDeleteHR && r.status !== "VOID" && (
                            <button
                              type="button"
                              onClick={() => handleDeleteMeritDemerit(r.id)}
                              className="px-3 py-1 border rounded hover:bg-gray-50 text-sm text-red-600"
                            >
                              Void
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Event class
                    </label>
                    <select
                      value={meritDemeritForm.record_type}
                      onChange={(e) =>
                        setMeritDemeritForm({
                          ...meritDemeritForm,
                          record_type: e.target.value,
                          type_id: "",
                        })
                      }
                      className="w-full border rounded px-3 py-2"
                    >
                      <option value="MERIT">Merit</option>
                      <option value="DEMERIT">Demerit</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Event Date
                    </label>
                    <DateInput
                      max={todayDate}
                      value={meritDemeritForm.event_date}
                      onChange={(value) =>
                        setMeritDemeritForm({
                          ...meritDemeritForm,
                          event_date: value,
                        })
                      }
                      className="w-full border rounded px-3 py-2"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-1">
                      Configured event type
                    </label>
                    <select
                      value={meritDemeritForm.type_id}
                      onChange={(e) => {
                        const type = meritDemeritTypes.find(
                          (item) => item.id === e.target.value,
                        );
                        setMeritDemeritForm({
                          ...meritDemeritForm,
                          type_id: e.target.value,
                          title: type?.type_name || meritDemeritForm.title,
                          points:
                            type?.default_points?.toString?.() ||
                            meritDemeritForm.points,
                        });
                      }}
                      className="w-full border rounded px-3 py-2"
                    >
                      <option value="">
                        Custom HR event (approval required)
                      </option>
                      {meritDemeritTypes
                        .filter(
                          (item) =>
                            item.is_active !== false &&
                            item.record_type === meritDemeritForm.record_type,
                        )
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.type_name} ({item.default_points ?? 0} points)
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-1">
                      Title
                    </label>
                    <input
                      type="text"
                      value={meritDemeritForm.title}
                      onChange={(e) =>
                        setMeritDemeritForm({
                          ...meritDemeritForm,
                          title: e.target.value,
                        })
                      }
                      className="w-full border rounded px-3 py-2"
                      placeholder="Good performance / Late coming / etc."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Points (optional)
                    </label>
                    <input
                      type="number"
                      value={meritDemeritForm.points}
                      onChange={(e) =>
                        setMeritDemeritForm({
                          ...meritDemeritForm,
                          points: e.target.value,
                        })
                      }
                      className="w-full border rounded px-3 py-2"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-1">
                      Evidence / reference (optional)
                    </label>
                    <input
                      type="text"
                      value={meritDemeritForm.evidence_reference}
                      onChange={(e) =>
                        setMeritDemeritForm({
                          ...meritDemeritForm,
                          evidence_reference: e.target.value,
                        })
                      }
                      className="w-full border rounded px-3 py-2"
                      placeholder="Incident report, appraisal form, document link, etc."
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-1">
                      Description (optional)
                    </label>
                    <textarea
                      value={meritDemeritForm.description}
                      onChange={(e) =>
                        setMeritDemeritForm({
                          ...meritDemeritForm,
                          description: e.target.value,
                        })
                      }
                      className="w-full border rounded px-3 py-2"
                      rows={2}
                    />
                  </div>
                  <div className="col-span-2 flex justify-end">
                    {canCreateHR && (
                      <button
                        type="button"
                        onClick={handleAddMeritDemerit}
                        disabled={loading}
                        className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50"
                      >
                        {loading ? "Saving..." : "Add Record"}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setShowEmployeeDetails(false)}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Employee Modal */}
      {showEditEmployee && selectedEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2F1B12]/55 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-[#E8DCC4] bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[#E8DCC4] bg-gradient-to-r from-[#FFF8EA] via-white to-[#F7F3EA] p-5">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-[#E8DCC4] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#8B6F47]">
                  <UserCheck className="h-3.5 w-3.5" />
                  Employee Central
                </div>
                <h3 className="mt-3 text-2xl font-bold text-[#2F1B12]">
                  Edit Employee
                </h3>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-[#6F5A49]">
                  Update employee master data used across attendance, leave,
                  payroll, and HR records.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowEditEmployee(false)}
                className="rounded-full border border-[#E8DCC4] bg-white px-3 py-1.5 text-lg leading-none text-[#6F5A49] hover:bg-[#F7F3EA]"
                aria-label="Close edit employee modal"
              >
                ×
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!canEditHR) {
                  alert("You do not have permission to update employees");
                  return;
                }
                setLoading(true);
                setError("");
                try {
                  await apiClient.put(
                    `/hr/employees/${selectedEmployee.id}`,
                    employeeForm,
                  );
                  setShowEditEmployee(false);
                  fetchData();
                  alert("Employee updated successfully");
                } catch (err: any) {
                  setError(err.message);
                  alert("Failed to update employee");
                } finally {
                  setLoading(false);
                }
              }}
              className="max-h-[calc(92vh-132px)] overflow-y-auto p-5"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                    Employee Code *
                  </label>
                  <input
                    type="text"
                    value={employeeForm.employee_code}
                    onChange={(e) =>
                      setEmployeeForm({
                        ...employeeForm,
                        employee_code: e.target.value,
                      })
                    }
                    className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                    Employee Name *
                  </label>
                  <input
                    type="text"
                    value={employeeForm.employee_name}
                    onChange={(e) =>
                      setEmployeeForm({
                        ...employeeForm,
                        employee_name: e.target.value,
                      })
                    }
                    className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                    Designation
                  </label>
                  <input
                    type="text"
                    value={employeeForm.designation}
                    onChange={(e) =>
                      setEmployeeForm({
                        ...employeeForm,
                        designation: e.target.value,
                      })
                    }
                    className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                    Department
                  </label>
                  <input
                    type="text"
                    value={employeeForm.department}
                    onChange={(e) =>
                      setEmployeeForm({
                        ...employeeForm,
                        department: e.target.value,
                      })
                    }
                    className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                    Contact
                  </label>
                  <input
                    type="text"
                    value={employeeForm.contact_number}
                    onChange={(e) =>
                      setEmployeeForm({
                        ...employeeForm,
                        contact_number: e.target.value,
                      })
                    }
                    className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                    Email
                  </label>
                  <input
                    type="email"
                    value={employeeForm.email}
                    onChange={(e) =>
                      setEmployeeForm({
                        ...employeeForm,
                        email: e.target.value,
                      })
                    }
                    className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                    Per Diem Amount (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={employeeForm.per_diem_amount}
                    onChange={(e) =>
                      setEmployeeForm({
                        ...employeeForm,
                        per_diem_amount: e.target.value,
                      })
                    }
                    className="min-h-11 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12] outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#E8DCC4]"
                    placeholder="Daily outstation allowance"
                  />
                </div>
              </div>
              <div className="sticky bottom-0 -mx-5 mt-5 flex justify-end gap-3 border-t border-[#E8DCC4] bg-white/95 px-5 py-4 backdrop-blur">
                <button
                  type="button"
                  onClick={() => setShowEditEmployee(false)}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#D8C4A8] bg-white px-4 text-sm font-semibold text-[#4A3426] hover:bg-[#FAF9F6]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#8B6F47] px-4 text-sm font-semibold text-white hover:bg-[#6F4E37] disabled:opacity-50"
                >
                  {loading ? "Updating..." : "Update Employee"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Attendance Details Modal */}
      {showAttendanceDetails && selectedAttendance && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Attendance Details</h3>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="font-medium">Employee:</span>{" "}
                  {selectedAttendance.employee_name}
                </div>
                <div>
                  <span className="font-medium">Date:</span>{" "}
                  {new Date(
                    selectedAttendance.attendance_date,
                  ).toLocaleDateString()}
                </div>
                <div>
                  <span className="font-medium">Check In:</span>{" "}
                  {selectedAttendance.check_in_time
                    ? new Date(
                        selectedAttendance.check_in_time,
                      ).toLocaleTimeString()
                    : "N/A"}
                </div>
                <div>
                  <span className="font-medium">Check Out:</span>{" "}
                  {selectedAttendance.check_out_time
                    ? new Date(
                        selectedAttendance.check_out_time,
                      ).toLocaleTimeString()
                    : "N/A"}
                </div>
                <div>
                  <span className="font-medium">Status:</span>{" "}
                  <span
                    className={`px-2 py-1 text-xs rounded ${getStatusColor(selectedAttendance.status)}`}
                  >
                    {selectedAttendance.status}
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowAttendanceDetails(false)}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Attendance Modal */}
      {showEditAttendance && selectedAttendance && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Edit Attendance</h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!canCorrectAttendance) {
                  alert("You do not have permission to update attendance");
                  return;
                }
                setLoading(true);
                try {
                  await apiClient.put(
                    `/hr/attendance/${selectedAttendance.id}`,
                    attendanceForm,
                  );
                  setShowEditAttendance(false);
                  fetchData();
                  fetchTodayAttendance();
                  alert("Attendance updated successfully");
                } catch (err: any) {
                  alert(err?.message || "Failed to update attendance");
                } finally {
                  setLoading(false);
                }
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium mb-1">Date</label>
                <DateInput
                  max={todayDate}
                  value={attendanceForm.attendance_date}
                  onChange={(value) =>
                    setAttendanceForm({
                      ...attendanceForm,
                      attendance_date: value,
                    })
                  }
                  className="w-full border rounded px-3 py-2"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Check In
                  </label>
                  <input
                    type="time"
                    value={attendanceForm.check_in_time}
                    onChange={(e) =>
                      setAttendanceForm({
                        ...attendanceForm,
                        check_in_time: e.target.value,
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Check Out
                  </label>
                  <input
                    type="time"
                    value={attendanceForm.check_out_time}
                    onChange={(e) =>
                      setAttendanceForm({
                        ...attendanceForm,
                        check_out_time: e.target.value,
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Status</label>
                <select
                  value={attendanceForm.status}
                  onChange={(e) =>
                    setAttendanceForm({
                      ...attendanceForm,
                      status: e.target.value,
                    })
                  }
                  className="w-full border rounded px-3 py-2"
                  required
                >
                  <option value="PRESENT">Present</option>
                  <option value="ABSENT">Absent</option>
                  <option value="LEAVE">Leave</option>
                  <option value="LATE">Late</option>
                  <option value="HALF_DAY">Half Day</option>
                  <option value="WORK_FROM_HOME">Work From Home</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Correction Reason / Remarks
                </label>
                <textarea
                  value={attendanceForm.remarks}
                  onChange={(e) =>
                    setAttendanceForm({
                      ...attendanceForm,
                      remarks: e.target.value,
                    })
                  }
                  className="w-full border rounded px-3 py-2"
                  rows={3}
                  placeholder="Reason for correction (audit note)"
                />
              </div>
              <div className="rounded-xl border border-[#FEDF89] bg-[#FFFAEB] p-4">
                <label className="flex items-start gap-2 text-sm font-semibold text-[#4A3426]">
                  <input
                    type="checkbox"
                    checked={attendanceForm.is_outstation_travel}
                    onChange={(e) =>
                      setAttendanceForm({
                        ...attendanceForm,
                        is_outstation_travel: e.target.checked,
                      })
                    }
                    className="mt-1"
                  />
                  <span>
                    Outstation travel / per diem day
                    <span className="mt-1 block text-xs font-normal text-[#8B6F47]">
                      Travel before 8 PM counts for per diem. Return before 8 AM
                      does not count as a travel day.
                    </span>
                  </span>
                </label>
                {attendanceForm.is_outstation_travel && (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                        Departure Time
                      </label>
                      <input
                        type="time"
                        value={attendanceForm.travel_departure_time}
                        onChange={(e) =>
                          setAttendanceForm({
                            ...attendanceForm,
                            travel_departure_time: e.target.value,
                          })
                        }
                        className="min-h-10 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12]"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                        Office Return Time
                      </label>
                      <input
                        type="time"
                        value={attendanceForm.travel_arrival_time}
                        onChange={(e) =>
                          setAttendanceForm({
                            ...attendanceForm,
                            travel_arrival_time: e.target.value,
                          })
                        }
                        className="min-h-10 w-full rounded-lg border border-[#D8C4A8] bg-white px-3 text-sm font-semibold text-[#2F1B12]"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                        Travel Notes
                      </label>
                      <textarea
                        value={attendanceForm.travel_notes}
                        onChange={(e) =>
                          setAttendanceForm({
                            ...attendanceForm,
                            travel_notes: e.target.value,
                          })
                        }
                        className="w-full rounded-lg border border-[#D8C4A8] bg-white px-3 py-2 text-sm text-[#2F1B12]"
                        rows={2}
                        placeholder="Train/flight details, city, purpose, approval reference..."
                      />
                    </div>
                  </div>
                )}
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowEditAttendance(false)}
                  className="px-4 py-2 border rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                >
                  {loading ? "Updating..." : "Update Attendance"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Leave Details Modal */}
      {showLeaveDetails && selectedLeave && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">
              Leave Request Details
            </h3>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="font-medium">Employee:</span>{" "}
                  {selectedLeave.employee_name}
                </div>
                <div>
                  <span className="font-medium">Start Date:</span>{" "}
                  {new Date(selectedLeave.start_date).toLocaleDateString()}
                </div>
                <div>
                  <span className="font-medium">End Date:</span>{" "}
                  {new Date(selectedLeave.end_date).toLocaleDateString()}
                </div>
                <div>
                  <span className="font-medium">Total Days:</span>{" "}
                  {selectedLeave.total_days}
                </div>
                <div>
                  <span className="font-medium">Status:</span>{" "}
                  <span
                    className={`px-2 py-1 text-xs rounded ${getStatusColor(selectedLeave.status)}`}
                  >
                    {selectedLeave.status}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="font-medium">Reason:</span>{" "}
                  <p className="mt-1 bg-gray-50 p-3 rounded">
                    {selectedLeave.reason}
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              {!isEmployeePortal &&
                canApproveHR &&
                isPendingLeaveStatus(selectedLeave.status) && (
                  <>
                    <button
                      onClick={async () => {
                        const confirmed = await confirmDialog({
                          title: "Approve Leave",
                          message: "Approve this leave request?",
                          confirmLabel: "Approve",
                          variant: "warning",
                        });
                        if (!confirmed) return;
                        await handleApproveLeave(selectedLeave.id);
                        setShowLeaveDetails(false);
                      }}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                    >
                      Approve
                    </button>
                    <button
                      onClick={async () => {
                        const confirmed = await confirmDialog({
                          title: "Reject Leave",
                          message: "Reject this leave request?",
                          confirmLabel: "Reject",
                          variant: "danger",
                        });
                        if (!confirmed) return;
                        await handleRejectLeave(selectedLeave.id);
                        setShowLeaveDetails(false);
                      }}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                    >
                      Reject
                    </button>
                  </>
                )}
              <button
                onClick={() => setShowLeaveDetails(false)}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Leave Modal */}
      {showEditLeave && selectedLeave && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Edit Leave Request</h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!canEditHR) {
                  alert("You do not have permission to update leave requests");
                  return;
                }
                const today = parseDateInputLocal(getTodayDateInputValue());
                const start = parseDateInputLocal(leaveForm.start_date);
                const end = parseDateInputLocal(leaveForm.end_date);
                if (!start || !end) {
                  alert("Please select valid leave dates.");
                  return;
                }
                if (today && start.getTime() <= today.getTime()) {
                  alert(
                    "Same-day leave is not allowed. Please select a future date.",
                  );
                  return;
                }
                if (end.getTime() < start.getTime()) {
                  alert("End date cannot be before start date.");
                  return;
                }
                const totalDays = countLeaveDaysExcludingSundays(
                  leaveForm.start_date,
                  leaveForm.end_date,
                );
                if (totalDays <= 0) {
                  alert(
                    "Selected date range contains only Sunday(s). Sunday is a paid weekly off and does not require leave.",
                  );
                  return;
                }
                setLoading(true);
                try {
                  await apiClient.put(`/hr/leaves/${selectedLeave.id}`, {
                    ...leaveForm,
                    leave_type: "CASUAL",
                    total_days: totalDays,
                  });
                  setShowEditLeave(false);
                  fetchData();
                  alert("Leave updated successfully");
                } catch (err: any) {
                  alert(err?.message || "Failed to update leave");
                } finally {
                  setLoading(false);
                }
              }}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Start Date
                  </label>
                  <DateInput
                    min={addDaysToDateInput(todayDate, 1)}
                    value={leaveForm.start_date}
                    onChange={(value) =>
                      setLeaveForm((prev) =>
                        normalizeLeaveDateForm(prev, { start_date: value }),
                      )
                    }
                    className="w-full border rounded px-3 py-2"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    End Date
                  </label>
                  <DateInput
                    min={
                      leaveForm.start_date || addDaysToDateInput(todayDate, 1)
                    }
                    value={leaveForm.end_date}
                    onChange={(value) =>
                      setLeaveForm((prev) =>
                        normalizeLeaveDateForm(prev, { end_date: value }),
                      )
                    }
                    className="w-full border rounded px-3 py-2"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Total Days
                </label>
                <input
                  type="number"
                  value={leaveForm.total_days}
                  readOnly
                  className="w-full border rounded px-3 py-2 bg-gray-50"
                  min="1"
                  required
                />
                <p className="mt-1 text-xs text-gray-500">
                  Sundays are paid weekly off and are not counted.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Reason</label>
                <textarea
                  value={leaveForm.reason}
                  onChange={(e) =>
                    setLeaveForm({ ...leaveForm, reason: e.target.value })
                  }
                  className="w-full border rounded px-3 py-2"
                  rows={3}
                  required
                />
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowEditLeave(false)}
                  className="px-4 py-2 border rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
                >
                  {loading ? "Updating..." : "Update Leave"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Monthly Payroll Form Modal */}
      {showMonthlyPayrollForm && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-white rounded-lg p-6 max-w-5xl w-full mx-4 my-8 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">
              {selectedMonthlyPayroll ? "Edit" : "Process"} Monthly Payroll
            </h3>
            <form onSubmit={handleSaveMonthlyPayroll} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Employee *
                  </label>
                  <select
                    value={monthlyPayrollForm.employee_id}
                    onChange={(e) =>
                      handleEmployeeSelectForPayroll(e.target.value)
                    }
                    className="w-full border rounded px-3 py-2"
                    required
                    disabled={!!selectedMonthlyPayroll}
                  >
                    <option value="">Select Employee</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.employee_name} ({emp.employee_code})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Payroll Month *
                  </label>
                  <input
                    type="month"
                    value={monthlyPayrollForm.payroll_month}
                    onChange={(e) =>
                      setMonthlyPayrollForm({
                        ...monthlyPayrollForm,
                        payroll_month: e.target.value,
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                    required
                  />
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-semibold mb-3 text-amber-600">
                  Attendance & Working Days
                </h4>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Days in Month
                    </label>
                    <input
                      type="number"
                      value={monthlyPayrollForm.days_in_month}
                      onChange={(e) =>
                        setMonthlyPayrollForm({
                          ...monthlyPayrollForm,
                          days_in_month: Number(e.target.value),
                        })
                      }
                      className="w-full border rounded px-3 py-2"
                      min="28"
                      max="31"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      No. of days Travelled
                    </label>
                    <input
                      type="number"
                      value={monthlyPayrollForm.days_travelled}
                      onChange={(e) =>
                        setMonthlyPayrollForm({
                          ...monthlyPayrollForm,
                          days_travelled: Number(e.target.value),
                        })
                      }
                      className="w-full border rounded px-3 py-2"
                      min="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Comp-Offs
                    </label>
                    <input
                      type="number"
                      value={monthlyPayrollForm.comp_offs}
                      onChange={(e) =>
                        setMonthlyPayrollForm({
                          ...monthlyPayrollForm,
                          comp_offs: Number(e.target.value),
                        })
                      }
                      className="w-full border rounded px-3 py-2"
                      min="0"
                      step="0.5"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Leave(s) / Absent
                    </label>
                    <input
                      type="number"
                      value={monthlyPayrollForm.leaves_absent}
                      onChange={(e) =>
                        setMonthlyPayrollForm({
                          ...monthlyPayrollForm,
                          leaves_absent: Number(e.target.value),
                        })
                      }
                      className="w-full border rounded px-3 py-2"
                      min="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Approved Paid Leaves
                    </label>
                    <input
                      type="number"
                      value={monthlyPayrollForm.approved_paid_leaves}
                      onChange={(e) =>
                        setMonthlyPayrollForm({
                          ...monthlyPayrollForm,
                          approved_paid_leaves: Number(e.target.value),
                        })
                      }
                      className="w-full border rounded px-3 py-2"
                      min="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1 text-green-600">
                      Paid for Total Days *
                    </label>
                    <input
                      type="number"
                      value={monthlyPayrollForm.paid_for_total_days}
                      onChange={(e) =>
                        setMonthlyPayrollForm({
                          ...monthlyPayrollForm,
                          paid_for_total_days: Number(e.target.value),
                        })
                      }
                      className="w-full border rounded px-3 py-2 font-semibold"
                      min="0"
                      step="0.5"
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-semibold mb-3 text-green-600">
                  Variable Salary Components
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="border-l-4 border-green-400 pl-3">
                    <label className="block text-sm font-medium mb-1">
                      Bonus Monthly
                    </label>
                    <input
                      type="number"
                      value={monthlyPayrollForm.bonus_monthly}
                      onChange={(e) =>
                        setMonthlyPayrollForm({
                          ...monthlyPayrollForm,
                          bonus_monthly: Number(e.target.value),
                        })
                      }
                      className="w-full border rounded px-3 py-2"
                      min="0"
                      step="0.01"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Monthly bonus (included in gross)
                    </p>
                  </div>
                  <div className="border-l-4 border-green-400 pl-3">
                    <label className="block text-sm font-medium mb-1">
                      Production Incentive Monthly
                    </label>
                    <input
                      type="number"
                      value={monthlyPayrollForm.production_incentive}
                      onChange={(e) =>
                        setMonthlyPayrollForm({
                          ...monthlyPayrollForm,
                          production_incentive: Number(e.target.value),
                        })
                      }
                      className="w-full border rounded px-3 py-2"
                      min="0"
                      step="0.01"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Production bonus (included in gross)
                    </p>
                  </div>
                  <div className="border-l-4 border-amber-400 pl-3">
                    <label className="block text-sm font-medium mb-1 text-amber-700">
                      Bonus Monthly (On Hold)
                    </label>
                    <input
                      type="number"
                      value={monthlyPayrollForm.bonus_hold}
                      onChange={(e) =>
                        setMonthlyPayrollForm({
                          ...monthlyPayrollForm,
                          bonus_hold: Number(e.target.value),
                        })
                      }
                      className="w-full border rounded px-3 py-2"
                      min="0"
                      step="0.01"
                    />
                    <p className="text-xs text-amber-600 mt-1">
                      Calculated but held, not paid now
                    </p>
                  </div>
                  <div className="border-l-4 border-amber-400 pl-3">
                    <label className="block text-sm font-medium mb-1 text-amber-700">
                      Production Incentive (On Hold)
                    </label>
                    <input
                      type="number"
                      value={monthlyPayrollForm.production_incentive_hold}
                      onChange={(e) =>
                        setMonthlyPayrollForm({
                          ...monthlyPayrollForm,
                          production_incentive_hold: Number(e.target.value),
                        })
                      }
                      className="w-full border rounded px-3 py-2"
                      min="0"
                      step="0.01"
                    />
                    <p className="text-xs text-amber-600 mt-1">
                      Calculated but held, not paid now
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Monthly Special Allowance
                    </label>
                    <input
                      type="number"
                      value={monthlyPayrollForm.special_allowance}
                      onChange={(e) =>
                        setMonthlyPayrollForm({
                          ...monthlyPayrollForm,
                          special_allowance: Number(e.target.value),
                        })
                      }
                      className="w-full border rounded px-3 py-2"
                      min="0"
                      step="0.01"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Additional allowance (balancing figure)
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Professional Tax (Deduction)
                    </label>
                    <input
                      type="number"
                      value={monthlyPayrollForm.professional_tax}
                      onChange={(e) =>
                        setMonthlyPayrollForm({
                          ...monthlyPayrollForm,
                          professional_tax: Number(e.target.value),
                        })
                      }
                      className="w-full border rounded px-3 py-2"
                      min="0"
                      step="0.01"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Statutory deduction
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded p-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <strong>Calculation Formula (as per salary slip):</strong>
                  </div>
                  <div></div>
                  <div className="text-gray-700">1. Gross Monthly Salary =</div>
                  <div className="text-gray-700">
                    Fixed Components + Bonus Monthly + Production Incentive +
                    Special Allowance
                  </div>
                  <div className="text-gray-700">2. Net Salary =</div>
                  <div className="text-gray-700">
                    Gross Salary - Professional Tax
                  </div>
                  <div className="text-amber-700 font-medium">
                    3. Monthly Hold =
                  </div>
                  <div className="text-amber-700 font-medium">
                    Bonus Monthly (On Hold) + Production Incentive (On Hold)
                  </div>
                  <div className="font-bold text-green-700">
                    4. Amount Paid =
                  </div>
                  <div className="font-bold text-green-700">
                    Net Salary - Monthly Hold
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowMonthlyPayrollForm(false);
                    setSelectedMonthlyPayroll(null);
                  }}
                  className="px-4 py-2 border rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50"
                >
                  {loading
                    ? "Saving..."
                    : selectedMonthlyPayroll
                      ? "Update"
                      : "Save as Draft"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Payroll Run Modal */}
      {showPayrollRunForm && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Create Payroll Run</h3>
            <form onSubmit={handleCreatePayrollRun} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Payroll Month
                </label>
                <input
                  type="month"
                  value={payrollRunForm.payroll_month}
                  onChange={(e) =>
                    setPayrollRunForm({
                      ...payrollRunForm,
                      payroll_month: e.target.value,
                    })
                  }
                  className="w-full border rounded px-3 py-2"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Remarks (Optional)
                </label>
                <textarea
                  value={payrollRunForm.remarks}
                  onChange={(e) =>
                    setPayrollRunForm({
                      ...payrollRunForm,
                      remarks: e.target.value,
                    })
                  }
                  className="w-full border rounded px-3 py-2"
                  rows={3}
                  placeholder="Any notes about this payroll run..."
                />
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-800">
                <strong>Note:</strong> This will create a payroll run for the
                selected month. You can generate payslips after creating the
                run.
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowPayrollRunForm(false)}
                  className="px-4 py-2 border rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50"
                >
                  {loading ? "Creating..." : "Create Run"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Comprehensive Salary Setup Modal */}
      {showComprehensiveSalaryForm && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-white rounded-lg p-6 max-w-4xl w-full mx-4 my-8 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">
              Comprehensive Salary Setup
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Enter all salary components for an employee in one form. All
              existing components will be replaced.
            </p>

            <form
              onSubmit={handleSaveComprehensiveSalary}
              className="space-y-6"
            >
              {/* Region Selector */}
              <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-4">
                <label className="block text-sm font-semibold mb-2">
                  Compliance Region
                </label>
                <div className="flex space-x-4">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="radio"
                      value="INDIA"
                      checked={complianceRegion === "INDIA"}
                      onChange={(e) =>
                        setComplianceRegion(e.target.value as "INDIA" | "UAE")
                      }
                      className="w-4 h-4"
                    />
                    <span className="font-medium">
                      India (PF, ESI, PT, TDS)
                    </span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="radio"
                      value="UAE"
                      checked={complianceRegion === "UAE"}
                      onChange={(e) =>
                        setComplianceRegion(e.target.value as "INDIA" | "UAE")
                      }
                      className="w-4 h-4"
                    />
                    <span className="font-medium">
                      UAE (WPS, Gratuity, ESB)
                    </span>
                  </label>
                </div>
                {complianceRegion === "INDIA" && (
                  <div className="mt-3">
                    <label className="block text-xs font-medium mb-1">
                      State (for Professional Tax)
                    </label>
                    <select
                      value={complianceState}
                      onChange={(e) => setComplianceState(e.target.value)}
                      className="border rounded px-2 py-1 text-sm"
                    >
                      <option value="MH">Maharashtra</option>
                      <option value="KA">Karnataka</option>
                      <option value="WB">West Bengal</option>
                      <option value="TN">Tamil Nadu</option>
                      <option value="GJ">Gujarat</option>
                      <option value="AP">Andhra Pradesh</option>
                      <option value="TS">Telangana</option>
                      <option value="DL">Delhi (No PT)</option>
                    </select>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Select Employee *
                </label>
                <select
                  value={comprehensiveSalaryForm.employee_id}
                  onChange={(e) =>
                    setComprehensiveSalaryForm({
                      ...comprehensiveSalaryForm,
                      employee_id: e.target.value,
                    })
                  }
                  className="w-full border rounded px-3 py-2"
                  required
                >
                  <option value="">Choose Employee</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.employee_name} ({emp.employee_code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-semibold mb-3 text-green-600">
                  Fixed Components (Monthly)
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Basic Salary *
                    </label>
                    <input
                      type="number"
                      value={comprehensiveSalaryForm.basic_salary}
                      onChange={(e) =>
                        handleBasicSalaryChange(Number(e.target.value))
                      }
                      className="w-full border rounded px-3 py-2"
                      min="0"
                      step="0.01"
                      required
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Auto-calculates HRA, PF, ESI, PT
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      HRA (House Rent Allowance)
                    </label>
                    <input
                      type="number"
                      value={comprehensiveSalaryForm.hra}
                      onChange={(e) =>
                        setComprehensiveSalaryForm({
                          ...comprehensiveSalaryForm,
                          hra: Number(e.target.value),
                        })
                      }
                      className="w-full border rounded px-3 py-2"
                      min="0"
                      step="0.01"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Medical Allowance
                    </label>
                    <input
                      type="number"
                      value={comprehensiveSalaryForm.medical_allowance}
                      onChange={(e) =>
                        setComprehensiveSalaryForm({
                          ...comprehensiveSalaryForm,
                          medical_allowance: Number(e.target.value),
                        })
                      }
                      className="w-full border rounded px-3 py-2"
                      min="0"
                      step="0.01"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Travelling Allowance
                    </label>
                    <input
                      type="number"
                      value={comprehensiveSalaryForm.travelling_allowance}
                      onChange={(e) =>
                        setComprehensiveSalaryForm({
                          ...comprehensiveSalaryForm,
                          travelling_allowance: Number(e.target.value),
                        })
                      }
                      className="w-full border rounded px-3 py-2"
                      min="0"
                      step="0.01"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Special Allowance
                    </label>
                    <input
                      type="number"
                      value={comprehensiveSalaryForm.special_allowance}
                      onChange={(e) =>
                        setComprehensiveSalaryForm({
                          ...comprehensiveSalaryForm,
                          special_allowance: Number(e.target.value),
                        })
                      }
                      className="w-full border rounded px-3 py-2"
                      min="0"
                      step="0.01"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-semibold mb-3 text-red-600">
                  Deductions{" "}
                  {complianceRegion === "INDIA" && "(Auto-calculated)"}
                </h4>
                {complianceRegion === "INDIA" && (
                  <div className="bg-green-50 border border-green-200 rounded p-3 mb-4 text-sm">
                    <p className="font-semibold text-green-700 mb-1">
                      Statutory Compliance (India)
                    </p>
                    <ul className="space-y-1 text-green-600">
                      <li>
                        - PF: Rs.{" "}
                        {comprehensiveSalaryForm.pf_deduction.toFixed(2)} (12%
                        of Basic)
                      </li>
                      <li>
                        - ESI: Rs.{" "}
                        {comprehensiveSalaryForm.esi_deduction.toFixed(2)}{" "}
                        (0.75% if gross &lt;= Rs. 21,000)
                      </li>
                      <li>
                        - PT: Rs.{" "}
                        {comprehensiveSalaryForm.professional_tax.toFixed(2)} (
                        {complianceState} state slab)
                      </li>
                    </ul>
                  </div>
                )}
                {complianceRegion === "UAE" && (
                  <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4 text-sm">
                    <p className="font-semibold text-blue-700">
                      UAE - No PF/ESI/PT required
                    </p>
                    <p className="text-blue-600 text-xs">
                      End of Service Benefits & WPS compliance handled
                      separately
                    </p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      PF (Provident Fund)
                    </label>
                    <input
                      type="number"
                      value={comprehensiveSalaryForm.pf_deduction}
                      onChange={(e) =>
                        setComprehensiveSalaryForm({
                          ...comprehensiveSalaryForm,
                          pf_deduction: Number(e.target.value),
                        })
                      }
                      className="w-full border rounded px-3 py-2 bg-gray-50"
                      min="0"
                      step="0.01"
                      readOnly={complianceRegion === "INDIA"}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      {complianceRegion === "INDIA"
                        ? "Auto: 12% of Basic"
                        : "Manual entry"}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      ESI
                    </label>
                    <input
                      type="number"
                      value={comprehensiveSalaryForm.esi_deduction}
                      onChange={(e) =>
                        setComprehensiveSalaryForm({
                          ...comprehensiveSalaryForm,
                          esi_deduction: Number(e.target.value),
                        })
                      }
                      className="w-full border rounded px-3 py-2 bg-gray-50"
                      min="0"
                      step="0.01"
                      readOnly={complianceRegion === "INDIA"}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      {complianceRegion === "INDIA"
                        ? "Auto: 0.75% if gross <= Rs. 21k"
                        : "Manual entry"}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Professional Tax
                    </label>
                    <input
                      type="number"
                      value={comprehensiveSalaryForm.professional_tax}
                      onChange={(e) =>
                        setComprehensiveSalaryForm({
                          ...comprehensiveSalaryForm,
                          professional_tax: Number(e.target.value),
                        })
                      }
                      className="w-full border rounded px-3 py-2 bg-gray-50"
                      min="0"
                      step="0.01"
                      readOnly={complianceRegion === "INDIA"}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      {complianceRegion === "INDIA"
                        ? `Auto: ${complianceState} state slab`
                        : "Manual entry"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-semibold mb-3 text-blue-600">
                  Other Allowances (Optional)
                </h4>
                {comprehensiveSalaryForm.other_allowances.map(
                  (allowance, index) => (
                    <div key={index} className="grid grid-cols-12 gap-2 mb-2">
                      <input
                        type="text"
                        placeholder="Allowance Name"
                        value={allowance.name}
                        onChange={(e) => {
                          const updated = [
                            ...comprehensiveSalaryForm.other_allowances,
                          ];
                          updated[index].name = e.target.value;
                          setComprehensiveSalaryForm({
                            ...comprehensiveSalaryForm,
                            other_allowances: updated,
                          });
                        }}
                        className="col-span-5 border rounded px-3 py-2"
                      />
                      <input
                        type="number"
                        placeholder="Amount"
                        value={allowance.amount}
                        onChange={(e) => {
                          const updated = [
                            ...comprehensiveSalaryForm.other_allowances,
                          ];
                          updated[index].amount = Number(e.target.value);
                          setComprehensiveSalaryForm({
                            ...comprehensiveSalaryForm,
                            other_allowances: updated,
                          });
                        }}
                        className="col-span-4 border rounded px-3 py-2"
                        min="0"
                        step="0.01"
                      />
                      <label className="col-span-2 flex items-center text-sm">
                        <input
                          type="checkbox"
                          checked={allowance.is_taxable}
                          onChange={(e) => {
                            const updated = [
                              ...comprehensiveSalaryForm.other_allowances,
                            ];
                            updated[index].is_taxable = e.target.checked;
                            setComprehensiveSalaryForm({
                              ...comprehensiveSalaryForm,
                              other_allowances: updated,
                            });
                          }}
                          className="mr-1"
                        />
                        Taxable
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const updated =
                            comprehensiveSalaryForm.other_allowances.filter(
                              (_, i) => i !== index,
                            );
                          setComprehensiveSalaryForm({
                            ...comprehensiveSalaryForm,
                            other_allowances: updated,
                          });
                        }}
                        className="col-span-1 text-red-600 hover:text-red-800"
                      >
                        Remove
                      </button>
                    </div>
                  ),
                )}
                <button
                  type="button"
                  onClick={() => {
                    setComprehensiveSalaryForm({
                      ...comprehensiveSalaryForm,
                      other_allowances: [
                        ...comprehensiveSalaryForm.other_allowances,
                        { name: "", amount: 0, is_taxable: true },
                      ],
                    });
                  }}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  + Add Another Allowance
                </button>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-semibold mb-3 text-red-600">
                  Other Deductions (Optional)
                </h4>
                {comprehensiveSalaryForm.other_deductions.map(
                  (deduction, index) => (
                    <div key={index} className="grid grid-cols-12 gap-2 mb-2">
                      <input
                        type="text"
                        placeholder="Deduction Name"
                        value={deduction.name}
                        onChange={(e) => {
                          const updated = [
                            ...comprehensiveSalaryForm.other_deductions,
                          ];
                          updated[index].name = e.target.value;
                          setComprehensiveSalaryForm({
                            ...comprehensiveSalaryForm,
                            other_deductions: updated,
                          });
                        }}
                        className="col-span-7 border rounded px-3 py-2"
                      />
                      <input
                        type="number"
                        placeholder="Amount"
                        value={deduction.amount}
                        onChange={(e) => {
                          const updated = [
                            ...comprehensiveSalaryForm.other_deductions,
                          ];
                          updated[index].amount = Number(e.target.value);
                          setComprehensiveSalaryForm({
                            ...comprehensiveSalaryForm,
                            other_deductions: updated,
                          });
                        }}
                        className="col-span-4 border rounded px-3 py-2"
                        min="0"
                        step="0.01"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const updated =
                            comprehensiveSalaryForm.other_deductions.filter(
                              (_, i) => i !== index,
                            );
                          setComprehensiveSalaryForm({
                            ...comprehensiveSalaryForm,
                            other_deductions: updated,
                          });
                        }}
                        className="col-span-1 text-red-600 hover:text-red-800"
                      >
                        Remove
                      </button>
                    </div>
                  ),
                )}
                <button
                  type="button"
                  onClick={() => {
                    setComprehensiveSalaryForm({
                      ...comprehensiveSalaryForm,
                      other_deductions: [
                        ...comprehensiveSalaryForm.other_deductions,
                        { name: "", amount: 0 },
                      ],
                    });
                  }}
                  className="text-sm text-red-600 hover:text-red-800"
                >
                  + Add Another Deduction
                </button>
              </div>

              <div className="bg-green-50 border border-green-200 rounded p-4">
                <p className="text-sm text-green-800">
                  <strong>This form will save all components at once.</strong>{" "}
                  All existing salary components for this employee will be
                  replaced with the new entries.
                </p>
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowComprehensiveSalaryForm(false);
                    setComprehensiveSalaryForm({
                      employee_id: "",
                      basic_salary: 0,
                      hra: 0,
                      medical_allowance: 0,
                      travelling_allowance: 0,
                      special_allowance: 0,
                      pf_deduction: 0,
                      esi_deduction: 0,
                      professional_tax: 200,
                      other_allowances: [],
                      other_deductions: [],
                    });
                  }}
                  className="px-4 py-2 border rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 font-medium"
                >
                  {loading ? "Saving..." : "Save All Components"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* KPI Calculator Modal */}
      {showKPICalculator && selectedEmployee && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">
              KPI Performance Review
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Employee: <strong>{selectedEmployee.employee_name}</strong> (
              {selectedEmployee.employee_code})
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">
                Select Month
              </label>
              <input
                type="month"
                value={kpiReviewMonth}
                onChange={async (e) => {
                  setKpiReviewMonth(e.target.value);
                  if (selectedEmployee?.id) {
                    await calculateKPIMetrics(
                      selectedEmployee.id,
                      e.target.value,
                    );
                  }
                }}
                className="w-full border rounded px-3 py-2"
              />
            </div>

            {kpiMetrics && (
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded p-4">
                  <h4 className="font-semibold mb-3 text-blue-800">
                    KPI Metrics
                  </h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="font-medium">Attendance Rate</div>
                      <div
                        className={`text-2xl font-bold ${kpiMetrics.attendance_rate >= 95 ? "text-green-600" : kpiMetrics.attendance_rate >= 85 ? "text-amber-600" : "text-red-600"}`}
                      >
                        {kpiMetrics.attendance_rate.toFixed(1)}%
                      </div>
                    </div>
                    <div>
                      <div className="font-medium">Punctuality Score</div>
                      <div
                        className={`text-2xl font-bold ${kpiMetrics.punctuality_score >= 95 ? "text-green-600" : kpiMetrics.punctuality_score >= 85 ? "text-amber-600" : "text-red-600"}`}
                      >
                        {kpiMetrics.punctuality_score.toFixed(1)}%
                      </div>
                    </div>
                    <div>
                      <div className="font-medium">Late Arrivals</div>
                      <div
                        className={`text-2xl font-bold ${kpiMetrics.late_count <= 2 ? "text-green-600" : kpiMetrics.late_count <= 5 ? "text-amber-600" : "text-red-600"}`}
                      >
                        {kpiMetrics.late_count}
                      </div>
                    </div>
                    <div>
                      <div className="font-medium">Absences</div>
                      <div
                        className={`text-2xl font-bold ${kpiMetrics.absent_count === 0 ? "text-green-600" : kpiMetrics.absent_count <= 2 ? "text-amber-600" : "text-red-600"}`}
                      >
                        {kpiMetrics.absent_count}
                      </div>
                    </div>
                    <div>
                      <div className="font-medium">Leave Days</div>
                      <div className="text-2xl font-bold text-blue-600">
                        {kpiMetrics.leave_utilization}
                      </div>
                    </div>
                    <div>
                      <div className="font-medium">Overtime Hours</div>
                      <div className="text-2xl font-bold text-purple-600">
                        {kpiMetrics.overtime_hours}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-green-50 border border-green-200 rounded p-4">
                  <h4 className="font-semibold mb-2 text-green-800">
                    Recognition review guidance
                  </h4>
                  <ul className="text-sm space-y-1">
                    <li>
                      - Attendance Rate &gt;= 98% may support{" "}
                      <strong>Perfect attendance</strong>
                    </li>
                    <li>
                      - Punctuality &gt;= 95% may support a{" "}
                      <strong>recognition review</strong>
                    </li>
                    <li>
                      - Quality and safety recognition require manager evidence
                    </li>
                  </ul>
                </div>

                <div className="bg-red-50 border border-red-200 rounded p-4">
                  <h4 className="font-semibold mb-2 text-red-800">
                    Corrective-action review guidance
                  </h4>
                  <ul className="text-sm space-y-1">
                    <li>
                      - Attendance Rate &lt; 85% requires a manager review
                      before any action
                    </li>
                    <li>
                      - Repeated late arrivals require verified attendance
                      evidence
                    </li>
                    <li>- A demerit is never generated automatically</li>
                  </ul>
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded p-4 text-sm text-amber-800">
                  <strong>Control:</strong> KPI results are review evidence
                  only. Create the applicable merit or demerit from the
                  configured event type, attach evidence, and have an authorised
                  HR approver confirm it.
                </div>

                {/* Manual KPI Entry Section */}
                <div className="bg-purple-50 border border-purple-200 rounded p-4">
                  <h4 className="font-semibold mb-3 text-purple-800">
                    Manual Performance Metrics (Optional)
                  </h4>
                  <p className="text-sm text-purple-700 mb-3">
                    Enter subjective performance ratings that can&apos;t be
                    auto-calculated (0-100 scale):
                  </p>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Quality of Work
                      </label>
                      <input
                        type="number"
                        value={manualKPIs.quality_of_work}
                        onChange={(e) =>
                          setManualKPIs({
                            ...manualKPIs,
                            quality_of_work: Number(e.target.value),
                          })
                        }
                        className="w-full border rounded px-3 py-2"
                        min="0"
                        max="100"
                        placeholder="0-100"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Manager-reviewed rating; no automatic reward or penalty
                        is created.
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Productivity Score
                      </label>
                      <input
                        type="number"
                        value={manualKPIs.productivity_score}
                        onChange={(e) =>
                          setManualKPIs({
                            ...manualKPIs,
                            productivity_score: Number(e.target.value),
                          })
                        }
                        className="w-full border rounded px-3 py-2"
                        min="0"
                        max="100"
                        placeholder="0-100"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Manager-reviewed rating; no automatic reward or penalty
                        is created.
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Teamwork Rating
                      </label>
                      <input
                        type="number"
                        value={manualKPIs.teamwork_rating}
                        onChange={(e) =>
                          setManualKPIs({
                            ...manualKPIs,
                            teamwork_rating: Number(e.target.value),
                          })
                        }
                        className="w-full border rounded px-3 py-2"
                        min="0"
                        max="100"
                        placeholder="0-100"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Use documented feedback or review evidence.
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Customer Satisfaction
                      </label>
                      <input
                        type="number"
                        value={manualKPIs.customer_satisfaction}
                        onChange={(e) =>
                          setManualKPIs({
                            ...manualKPIs,
                            customer_satisfaction: Number(e.target.value),
                          })
                        }
                        className="w-full border rounded px-3 py-2"
                        min="0"
                        max="100"
                        placeholder="0-100"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Use documented feedback or review evidence.
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Project Completion Rate
                      </label>
                      <input
                        type="number"
                        value={manualKPIs.project_completion_rate}
                        onChange={(e) =>
                          setManualKPIs({
                            ...manualKPIs,
                            project_completion_rate: Number(e.target.value),
                          })
                        }
                        className="w-full border rounded px-3 py-2"
                        min="0"
                        max="100"
                        placeholder="0-100"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Use approved delivery evidence or manager assessment.
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Initiative & Innovation
                      </label>
                      <input
                        type="number"
                        value={manualKPIs.initiative_innovation}
                        onChange={(e) =>
                          setManualKPIs({
                            ...manualKPIs,
                            initiative_innovation: Number(e.target.value),
                          })
                        }
                        className="w-full border rounded px-3 py-2"
                        min="0"
                        max="100"
                        placeholder="0-100"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Use approved manager assessment and supporting evidence.
                      </p>
                    </div>
                  </div>

                  <div className="mt-3">
                    <label className="block text-sm font-medium mb-1">
                      Performance Notes (Optional)
                    </label>
                    <textarea
                      value={manualKPIs.manual_notes}
                      onChange={(e) =>
                        setManualKPIs({
                          ...manualKPIs,
                          manual_notes: e.target.value,
                        })
                      }
                      className="w-full border rounded px-3 py-2"
                      rows={2}
                      placeholder="Additional comments about performance..."
                    />
                  </div>

                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={handleSaveManualKPIs}
                      disabled={loading}
                      className="w-full px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 font-medium"
                    >
                      {loading ? "Saving..." : "Save Manual KPI Review"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {!kpiMetrics && !loading && (
              <div className="text-center py-8 text-gray-500">
                <p>Select a month above to calculate auto KPIs first</p>
                <p className="text-xs mt-2">
                  Then you can add manual performance metrics
                </p>
              </div>
            )}

            {loading && (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-4 text-gray-600">Analyzing KPIs...</p>
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => {
                  setShowKPICalculator(false);
                  setKpiMetrics(null);
                }}
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* KPI Definition Form Modal */}
      {showKpiForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-semibold mb-4">
              {editingKpi ? "Edit" : "Add"} KPI Definition
            </h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    KPI Name *
                  </label>
                  <input
                    type="text"
                    value={kpiForm.kpi_name}
                    onChange={(e) =>
                      setKpiForm({ ...kpiForm, kpi_name: e.target.value })
                    }
                    className="w-full border rounded px-3 py-2"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Category *
                  </label>
                  <select
                    value={kpiForm.kpi_category}
                    onChange={(e) =>
                      setKpiForm({ ...kpiForm, kpi_category: e.target.value })
                    }
                    className="w-full border rounded px-3 py-2"
                  >
                    <option value="ATTENDANCE">Attendance</option>
                    <option value="QUALITY">Quality</option>
                    <option value="PRODUCTIVITY">Productivity</option>
                    <option value="BEHAVIOR">Behavior</option>
                    <option value="CUSTOM">Custom</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Description
                </label>
                <textarea
                  value={kpiForm.description}
                  onChange={(e) =>
                    setKpiForm({ ...kpiForm, description: e.target.value })
                  }
                  className="w-full border rounded px-3 py-2"
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Measurement Type *
                  </label>
                  <select
                    value={kpiForm.measurement_type}
                    onChange={(e) =>
                      setKpiForm({
                        ...kpiForm,
                        measurement_type: e.target.value,
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                  >
                    <option value="PERCENTAGE">Percentage</option>
                    <option value="NUMBER">Number</option>
                    <option value="SCORE">Score</option>
                    <option value="COUNT">Count</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <input
                    type="checkbox"
                    checked={kpiForm.auto_calculate}
                    onChange={(e) =>
                      setKpiForm({
                        ...kpiForm,
                        auto_calculate: e.target.checked,
                      })
                    }
                  />
                  <label className="text-sm">Auto Calculate</label>
                  <input
                    type="checkbox"
                    checked={kpiForm.is_active}
                    onChange={(e) =>
                      setKpiForm({ ...kpiForm, is_active: e.target.checked })
                    }
                  />
                  <label className="text-sm">Active</label>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Min Value
                  </label>
                  <input
                    type="number"
                    value={kpiForm.min_value}
                    onChange={(e) =>
                      setKpiForm({
                        ...kpiForm,
                        min_value: Number(e.target.value),
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Max Value
                  </label>
                  <input
                    type="number"
                    value={kpiForm.max_value}
                    onChange={(e) =>
                      setKpiForm({
                        ...kpiForm,
                        max_value: Number(e.target.value),
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Threshold Excellent
                  </label>
                  <input
                    type="number"
                    value={kpiForm.threshold_excellent}
                    onChange={(e) =>
                      setKpiForm({
                        ...kpiForm,
                        threshold_excellent: Number(e.target.value),
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Threshold Good
                  </label>
                  <input
                    type="number"
                    value={kpiForm.threshold_good}
                    onChange={(e) =>
                      setKpiForm({
                        ...kpiForm,
                        threshold_good: Number(e.target.value),
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Threshold Acceptable
                  </label>
                  <input
                    type="number"
                    value={kpiForm.threshold_acceptable}
                    onChange={(e) =>
                      setKpiForm({
                        ...kpiForm,
                        threshold_acceptable: Number(e.target.value),
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowKpiForm(false)}
                className="flex-1 px-4 py-2 border rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (editingKpi ? !canEditHR : !canCreateHR) {
                    alert(
                      `You do not have permission to ${editingKpi ? "update" : "create"} KPI definitions`,
                    );
                    return;
                  }
                  try {
                    if (editingKpi) {
                      await apiClient.put(
                        `/hr/kpi-definitions/${editingKpi.id}`,
                        kpiForm,
                      );
                    } else {
                      await apiClient.post("/hr/kpi-definitions", kpiForm);
                    }
                    await fetchMasterConfig();
                    setShowKpiForm(false);
                  } catch (e) {
                    alert("Failed to save KPI");
                  }
                }}
                className="flex-1 px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Merit/Demerit Type Form Modal */}
      {showMeritTypeForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-semibold mb-4">
              {editingMeritType ? "Edit" : "Add"} Merit/Demerit Type
            </h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Type Name *
                  </label>
                  <input
                    type="text"
                    value={meritTypeForm.type_name}
                    onChange={(e) =>
                      setMeritTypeForm({
                        ...meritTypeForm,
                        type_name: e.target.value,
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Record Type *
                  </label>
                  <select
                    value={meritTypeForm.record_type}
                    onChange={(e) =>
                      setMeritTypeForm({
                        ...meritTypeForm,
                        record_type: e.target.value,
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                  >
                    <option value="MERIT">Merit</option>
                    <option value="DEMERIT">Demerit</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Category *
                  </label>
                  <select
                    value={meritTypeForm.category}
                    onChange={(e) =>
                      setMeritTypeForm({
                        ...meritTypeForm,
                        category: e.target.value,
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                  >
                    <option value="ATTENDANCE">Attendance</option>
                    <option value="QUALITY">Quality</option>
                    <option value="BEHAVIOR">Behavior</option>
                    <option value="SAFETY">Safety</option>
                    <option value="PRODUCTIVITY">Productivity</option>
                    <option value="CUSTOM">Custom</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Default Points *
                  </label>
                  <input
                    type="number"
                    value={meritTypeForm.default_points}
                    onChange={(e) =>
                      setMeritTypeForm({
                        ...meritTypeForm,
                        default_points: Number(e.target.value),
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Description
                </label>
                <textarea
                  value={meritTypeForm.description}
                  onChange={(e) =>
                    setMeritTypeForm({
                      ...meritTypeForm,
                      description: e.target.value,
                    })
                  }
                  className="w-full border rounded px-3 py-2"
                  rows={2}
                />
              </div>
              {meritTypeForm.record_type === "DEMERIT" && (
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Severity (for demerits)
                  </label>
                  <select
                    value={meritTypeForm.severity}
                    onChange={(e) =>
                      setMeritTypeForm({
                        ...meritTypeForm,
                        severity: e.target.value,
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                  >
                    <option value="">None</option>
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="CRITICAL">Critical</option>
                  </select>
                </div>
              )}
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={meritTypeForm.requires_approval}
                    onChange={(e) =>
                      setMeritTypeForm({
                        ...meritTypeForm,
                        requires_approval: e.target.checked,
                      })
                    }
                  />
                  <span className="text-sm">Requires Approval</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={meritTypeForm.is_active}
                    onChange={(e) =>
                      setMeritTypeForm({
                        ...meritTypeForm,
                        is_active: e.target.checked,
                      })
                    }
                  />
                  <span className="text-sm">Active</span>
                </label>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowMeritTypeForm(false)}
                className="flex-1 px-4 py-2 border rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (editingMeritType ? !canEditHR : !canCreateHR) {
                    alert(
                      `You do not have permission to ${editingMeritType ? "update" : "create"} merit and demerit types`,
                    );
                    return;
                  }
                  try {
                    if (editingMeritType) {
                      await apiClient.put(
                        `/hr/merit-demerit-types/${editingMeritType.id}`,
                        meritTypeForm,
                      );
                    } else {
                      await apiClient.post(
                        "/hr/merit-demerit-types",
                        meritTypeForm,
                      );
                    }
                    await fetchMasterConfig();
                    setShowMeritTypeForm(false);
                  } catch (e) {
                    alert("Failed to save type");
                  }
                }}
                className="flex-1 px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {isEmployeePortal && (
        <nav
          className="fixed inset-x-0 bottom-0 z-40 border-t border-[#E8DCC4] bg-white/95 px-2 py-2 shadow-[0_-10px_25px_rgba(62,42,31,0.12)] backdrop-blur md:hidden"
          aria-label="Employee app navigation"
        >
          <div className="mx-auto grid max-w-md grid-cols-4 gap-1">
            {employeeAppTabs.slice(0, 1).map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.key;
              return (
                <a
                  key={tab.key}
                  href={getHrTabHref(tab.key)}
                  onClick={(event) => {
                    event.preventDefault();
                    navigateToHrTab(tab.key);
                  }}
                  className={`flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-2xl px-2 text-[11px] font-semibold transition-colors ${
                    active
                      ? "bg-[#8B6F47] text-white shadow-sm"
                      : "text-[#7A6555] hover:bg-[#F7F3EA] hover:text-[#3E2A1F]"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span>{tab.label}</span>
                </a>
              );
            })}
            <a
              href="/dashboard/active-planner"
              className="flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-2xl px-2 text-[11px] font-semibold text-violet-700 transition-colors hover:bg-violet-50"
            >
              <Sparkles className="h-5 w-5" />
              <span>Ask</span>
            </a>
            <a
              href="/dashboard/command-center/actions"
              className="flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-2xl px-2 text-[11px] font-semibold text-[#7A6555] transition-colors hover:bg-[#F7F3EA] hover:text-[#3E2A1F]"
            >
              <ClipboardCheck className="h-5 w-5" />
              <span>My Work</span>
            </a>
            <button
              type="button"
              onClick={() => setShowEmployeeMore(true)}
              className="flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-2xl px-2 text-[11px] font-semibold text-[#7A6555] transition-colors hover:bg-[#F7F3EA]"
            >
              <Menu className="h-5 w-5" />
              <span>More</span>
            </button>
          </div>
        </nav>
      )}

      {isEmployeePortal && showEmployeeMore && (
        <div className="fixed inset-0 z-[950] md:hidden">
          <button
            type="button"
            aria-label="Close employee menu"
            className="absolute inset-0 bg-black/35"
            onClick={() => setShowEmployeeMore(false)}
          />
          <section className="absolute inset-x-0 bottom-0 rounded-t-[28px] bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="min-w-0">
                <b className="text-[#2F241B]">My workspace</b>
                <p className="truncate text-xs font-semibold text-[#7A6555]">
                  Signed in as {getAttendanceEmployeeName()}
                </p>
                {currentUser?.email && (
                  <p className="truncate text-[11px] text-[#8B7A68]">
                    {currentUser.email}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowEmployeeMore(false)}
                className="rounded-full bg-[#F3EBDD] p-2 text-[#4A3426]"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowEmployeeMore(false);
                  navigateToHrTab("employees");
                }}
                className="flex min-h-[76px] items-center gap-3 rounded-2xl border border-[#E8DCC4] p-3 text-left text-sm font-semibold"
              >
                <UserCheck className="h-5 w-5 text-[#80613D]" /> My profile
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowEmployeeMore(false);
                  navigateToHrTab("holidays");
                }}
                className="flex min-h-[76px] items-center gap-3 rounded-2xl border border-[#E8DCC4] p-3 text-left text-sm font-semibold"
              >
                <CalendarDays className="h-5 w-5 text-[#80613D]" /> Holidays
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowEmployeeMore(false);
                  navigateToHrTab("leaves");
                }}
                className="flex min-h-[76px] items-center gap-3 rounded-2xl border border-[#E8DCC4] p-3 text-left text-sm font-semibold"
              >
                <ClipboardCheck className="h-5 w-5 text-[#80613D]" /> Leaves
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowEmployeeMore(false);
                  navigateToHrTab("payroll");
                }}
                className="flex min-h-[76px] items-center gap-3 rounded-2xl border border-[#E8DCC4] p-3 text-left text-sm font-semibold"
              >
                <WalletCards className="h-5 w-5 text-[#80613D]" /> Payslips
              </button>
            </div>
            <button
              type="button"
              onClick={handleEmployeeLogout}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-red-200 p-3 text-sm font-semibold text-red-700"
            >
              <LogOut className="h-5 w-5" /> Logout
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
