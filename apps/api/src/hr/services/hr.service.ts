import { BadRequestException, Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { hasAdminBypass, hasPermission } from '../../auth/utils/permission-utils';
import { AccountingService } from '../../accounting/accounting.service';

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const getOptionalEnvNumber = (value: string | undefined): number | null => {
  if (!value || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// SAIF office fallback from the confirmed Google Maps location. Env values can
// override this, but missing env must not disable attendance geofence checks.
const HR_OFFICE_LAT =
  getOptionalEnvNumber(process.env.HR_OFFICE_LAT || process.env.NEXT_PUBLIC_HR_OFFICE_LAT) ??
  17.81010395938058;
const HR_OFFICE_LNG =
  getOptionalEnvNumber(process.env.HR_OFFICE_LNG || process.env.NEXT_PUBLIC_HR_OFFICE_LNG) ??
  83.38749947116408;
const HR_OFFICE_RADIUS_METERS =
  getOptionalEnvNumber(process.env.HR_OFFICE_RADIUS_METERS || process.env.NEXT_PUBLIC_HR_OFFICE_RADIUS_METERS) ??
  100;
const HR_OFFICE_ACCURACY_GRACE_METERS =
  getOptionalEnvNumber(process.env.HR_OFFICE_ACCURACY_GRACE_METERS || process.env.NEXT_PUBLIC_HR_OFFICE_ACCURACY_GRACE_METERS) ??
  250;

const getDistanceMeters = (
  first: { lat: number; lng: number },
  second: { lat: number; lng: number },
): number => {
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
};

const isOutsideOfficeGeofence = (lat?: number, lng?: number, accuracy?: number | null): boolean => {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const distanceMeters = getDistanceMeters(
    { lat: HR_OFFICE_LAT, lng: HR_OFFICE_LNG },
    { lat: Number(lat), lng: Number(lng) },
  );
  const accuracyGrace = Number.isFinite(accuracy)
    ? Math.min(Math.max(Number(accuracy), 0), HR_OFFICE_ACCURACY_GRACE_METERS)
    : 0;
  return distanceMeters > HR_OFFICE_RADIUS_METERS + accuracyGrace;
};

const monthToRange = (month: string) => {
  // month: YYYY-MM
  const [y, m] = month.split('-').map((x) => parseInt(x, 10));
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0);
  const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);
  return { start: toIsoDate(start), end: toIsoDate(end) };
};

const parseAttendanceHours = (record: any): number | null => {
  const explicitHours = Number(record?.work_hours);
  if (Number.isFinite(explicitHours) && explicitHours >= 0) return explicitHours;

  if (!record?.check_in_time || !record?.check_out_time) return null;

  const checkIn = new Date(record.check_in_time).getTime();
  const checkOut = new Date(record.check_out_time).getTime();
  if (!Number.isFinite(checkIn) || !Number.isFinite(checkOut) || checkOut <= checkIn) return null;

  return (checkOut - checkIn) / (1000 * 60 * 60);
};

const isSundayAttendance = (record: any): boolean => {
  const value = String(record?.attendance_date || '').slice(0, 10);
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day)).getDay() === 0;
};

const calculateAttendancePayDayCredit = (record: any): number => {
  const status = String(record?.status || '').toUpperCase();
  if (status === 'ABSENT' || status === 'LEAVE') return 0;

  const hours = parseAttendanceHours(record);
  if (hours === null) {
    // Legacy/manual attendance records may only carry PRESENT status. Keep them
    // payable as one day rather than dropping valid historical payroll days.
    return status ? 1 : 0;
  }

  // Sunday is already a paid weekly-off. If an employee works at least 6 hours
  // on Sunday, credit one extra paid day, i.e. 2 paid days total.
  if (isSundayAttendance(record)) {
    return hours >= 6 ? 2 : 1;
  }

  if (hours < 8) return 0;
  if (hours < 10) return 1;
  if (hours <= 12) return 1.5;
  return 2;
};

const parseTimeMinutes = (value: unknown): number | null => {
  if (!isNonEmptyString(value)) return null;
  const raw = value.trim();
  const match = raw.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
};

const normalizeTimeOnly = (value: unknown): string | null => {
  const minutes = parseTimeMinutes(value);
  if (minutes === null) return null;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`;
};

// Attendance corrections are entered as India business-clock times. Do not
// construct these values with `new Date('YYYY-MM-DDTHH:mm')`: that expression
// uses the server timezone (UTC in production) and shifts the displayed value
// by 5:30 when the browser renders it in India. Persist an explicit IST offset
// so the entered wall-clock time remains unchanged everywhere.
const toIndiaAttendanceDateTime = (attendanceDate: string, value: unknown): string | null => {
  if (!isNonEmptyString(value)) return null;

  const raw = value.trim();
  if (raw.includes('T')) {
    // Already an absolute timestamp from a trusted client/integration.
    if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(raw)) return raw;

    const [datePart, timePart] = raw.split('T');
    const normalizedTime = normalizeTimeOnly(timePart);
    return datePart && normalizedTime ? `${datePart}T${normalizedTime}+05:30` : null;
  }

  const normalizedTime = normalizeTimeOnly(raw);
  return normalizedTime ? `${attendanceDate}T${normalizedTime}+05:30` : null;
};

// The old attendance_records table uses a timestamp-without-time-zone column.
// Preserve the entered local clock value there; adding an offset would make
// PostgreSQL convert it to UTC before storing it.
const toLegacyAttendanceDateTime = (attendanceDate: string, value: unknown): string | null => {
  if (!isNonEmptyString(value)) return null;
  const raw = value.trim();
  const timeValue = raw.includes('T') ? raw.split('T')[1].replace(/[zZ]$|[+-]\d{2}:\d{2}$/, '') : raw;
  const normalizedTime = normalizeTimeOnly(timeValue);
  return normalizedTime ? `${attendanceDate} ${normalizedTime}` : null;
};

const isOutstationTravelMarked = (record: any): boolean => {
  if (record?.is_outstation_travel === true) return true;
  const marker = String(record?.travel_status || record?.travel_type || '').toUpperCase();
  return marker.includes('OUTSTATION') || marker.includes('TRAVEL');
};

const isTravelPerDiemDay = (record: any): boolean => {
  if (!isOutstationTravelMarked(record)) return false;

  const departure = parseTimeMinutes(record?.travel_departure_time ?? record?.departure_time);
  const arrival = parseTimeMinutes(record?.travel_arrival_time ?? record?.office_reached_time ?? record?.arrival_time);

  // If employee reaches office before 08:00, the return day is not a travel day.
  if (arrival !== null && arrival < 8 * 60) return false;

  // If journey starts before 20:00, that calendar day earns per diem.
  if (departure !== null) return departure < 20 * 60;

  // If only return time is captured, reaching at/after 08:00 counts as travel day.
  if (arrival !== null) return arrival >= 8 * 60;

  // Manual HR travel day marking: count unless times explicitly disqualify it.
  return true;
};

const getEmployeePerDiemAmount = (employee: any): number => {
  const amount = Number(employee?.per_diem_amount ?? employee?.per_diem_rate ?? 0);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

const sanitizeEmployeePayload = (data: any) => {
  const employeeData: any = { ...data };
  const perDiem = Number(data?.per_diem_amount ?? data?.per_diem_rate ?? 0);
  employeeData.per_diem_amount = Number.isFinite(perDiem) && perDiem > 0 ? perDiem : 0;
  delete employeeData.per_diem_rate;
  return employeeData;
};

const withAttendanceTravelFields = (data: any) => {
  // A normal correction must not send optional travel fields. Some deployed
  // databases pre-date these columns, and an omitted field is different from
  // a deliberate false/null value.
  const travelKeys = ['is_outstation_travel', 'travel_departure_time', 'travel_arrival_time', 'travel_notes'];
  const hasTravelInput = travelKeys.some((key) => Object.prototype.hasOwnProperty.call(data ?? {}, key));
  if (!hasTravelInput) return {};

  return {
    is_outstation_travel: data?.is_outstation_travel === true || String(data?.is_outstation_travel).toLowerCase() === 'true',
    travel_departure_time: normalizeTimeOnly(data?.travel_departure_time),
    travel_arrival_time: normalizeTimeOnly(data?.travel_arrival_time),
    travel_notes: isNonEmptyString(data?.travel_notes) ? data.travel_notes.trim() : null,
  };
};

const omitKeys = (source: any, keys: string[]) => {
  const clone: any = { ...source };
  keys.forEach((key) => delete clone[key]);
  return clone;
};

const isMissingRelationError = (error: unknown, relationName: string) => {
  const msg = error && typeof error === 'object' && 'message' in error
    ? String((error as any).message)
    : String(error ?? '');
  const lower = msg.toLowerCase();
  return (
    lower.includes('does not exist') &&
    (lower.includes(`relation "${relationName.toLowerCase()}"`) ||
      lower.includes(`table "${relationName.toLowerCase()}"`) ||
      lower.includes(`'${relationName.toLowerCase()}'`) ||
      lower.includes(relationName.toLowerCase()))
  );
};

const isMissingColumnError = (error: unknown, columnName: string) => {
  const msg = error && typeof error === 'object' && 'message' in error
    ? String((error as any).message)
    : String(error ?? '');

  const lower = msg.toLowerCase();
  // PostgREST can report a missing column either as a database error or as
  // "Could not find ... column ... in the schema cache".
  if (!lower.includes('does not exist') && !lower.includes('schema cache')) return false;

  const candidates = new Set<string>();
  candidates.add(columnName);
  const lastSegment = columnName.split('.').pop();
  if (lastSegment) candidates.add(lastSegment);

  for (const name of candidates) {
    const n = name.toLowerCase();
    if (lower.includes(`column ${n}`)) return true;
    if (lower.includes(`column "${n}"`)) return true;
    if (lower.includes(`column '${n}'`)) return true;
    if (lower.includes(`'${n}' column`)) return true;
  }

  return false;
};

const normalizeDateOnly = (value: unknown, fieldName: string): string => {
  const raw = String(value ?? '').trim();
  if (!raw) {
    throw new BadRequestException(`${fieldName} is required`);
  }

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return raw;

  const displayMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (displayMatch) {
    const day = Number(displayMatch[1]);
    const month = Number(displayMatch[2]);
    const year = displayMatch[3].length === 2 ? 2000 + Number(displayMatch[3]) : Number(displayMatch[3]);
    const parsed = new Date(year, month - 1, day);
    if (
      parsed.getFullYear() === year &&
      parsed.getMonth() === month - 1 &&
      parsed.getDate() === day
    ) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  throw new BadRequestException(`${fieldName} must be a valid date`);
};

const toLocalDate = (dateOnly: string) => {
  const [year, month, day] = dateOnly.split('-').map((part) => Number(part));
  return new Date(year, month - 1, day);
};

const getIndiaTodayDateOnly = () => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
};

const countLeaveDaysExcludingSundays = (startDate: string, endDate: string) => {
  const current = toLocalDate(startDate);
  const end = toLocalDate(endDate);
  let count = 0;
  while (current.getTime() <= end.getTime()) {
    if (current.getDay() !== 0) count += 1;
    current.setDate(current.getDate() + 1);
  }
  return count;
};

const normalizeLeaveDatePayload = (data: any) => {
  const startDate = normalizeDateOnly(data?.start_date, 'Start date');
  const endDate = normalizeDateOnly(data?.end_date, 'End date');
  if (toLocalDate(endDate).getTime() < toLocalDate(startDate).getTime()) {
    throw new BadRequestException('End date cannot be before start date');
  }

  const todayDate = getIndiaTodayDateOnly();
  if (toLocalDate(startDate).getTime() <= toLocalDate(todayDate).getTime()) {
    throw new BadRequestException('Leave can be applied only from tomorrow onwards. Same-day leave is not allowed.');
  }

  const totalDays = countLeaveDaysExcludingSundays(startDate, endDate);
  if (totalDays <= 0) {
    throw new BadRequestException('Selected date range contains only Sunday(s). Sunday is a paid weekly off and does not require leave.');
  }

  return { startDate, endDate, totalDays };
};

const DEFAULT_HR_HOLIDAYS_2026 = [
  { holiday_name: 'Bhogi', start_date: '2026-01-14', end_date: null, holiday_type: 'PUBLIC' },
  { holiday_name: 'Makara Sankranti', start_date: '2026-01-15', end_date: null, holiday_type: 'PUBLIC' },
  { holiday_name: 'Kanuma', start_date: '2026-01-16', end_date: null, holiday_type: 'PUBLIC' },
  { holiday_name: 'Republic Day', start_date: '2026-01-26', end_date: null, holiday_type: 'PUBLIC' },
  { holiday_name: 'Holi', start_date: '2026-03-03', end_date: null, holiday_type: 'PUBLIC' },
  { holiday_name: 'Ugadi', start_date: '2026-03-19', end_date: null, holiday_type: 'PUBLIC' },
  { holiday_name: 'Ramzan Eid', start_date: '2026-03-20', end_date: null, holiday_type: 'PUBLIC' },
  { holiday_name: 'Bakri Eid', start_date: '2026-05-27', end_date: null, holiday_type: 'PUBLIC' },
  { holiday_name: 'Mohurram', start_date: '2026-06-16', end_date: '2026-06-24', holiday_type: 'PUBLIC', notes: 'Imported from Holiday List 2026 reference.' },
  { holiday_name: 'Independence Day', start_date: '2026-08-15', end_date: null, holiday_type: 'PUBLIC' },
  { holiday_name: 'Vinayaka Chavithi', start_date: '2026-08-21', end_date: null, holiday_type: 'PUBLIC' },
  { holiday_name: 'Eid ul Milad un Nabi', start_date: '2026-08-25', end_date: null, holiday_type: 'PUBLIC' },
  { holiday_name: 'Mahatma Gandhi Jayanti', start_date: '2026-10-02', end_date: null, holiday_type: 'PUBLIC' },
  { holiday_name: 'Dusshera', start_date: '2026-10-20', end_date: null, holiday_type: 'PUBLIC' },
  { holiday_name: 'Diwali', start_date: '2026-11-08', end_date: null, holiday_type: 'PUBLIC' },
  { holiday_name: 'Christmas', start_date: '2026-12-25', end_date: null, holiday_type: 'PUBLIC' },
];

@Injectable()
export class HrService {
  private supabase: SupabaseClient;
  private holidayTableReady = false;

  constructor(private readonly accountingService: AccountingService) {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_KEY!
    );
  }

  private countHolidayDays(startDate: string, endDate?: string | null) {
    const start = new Date(startDate);
    const end = new Date(endDate || startDate);
    const diffMs = end.getTime() - start.getTime();
    return Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1);
  }

  private async ensureHolidayTable() {
    if (this.holidayTableReady) {
      return;
    }

    const sql = `
CREATE TABLE IF NOT EXISTS hr_holidays (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    holiday_name VARCHAR(200) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE,
    holiday_type VARCHAR(50) DEFAULT 'PUBLIC',
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_holidays_tenant ON hr_holidays(tenant_id);
CREATE INDEX IF NOT EXISTS idx_hr_holidays_start_date ON hr_holidays(start_date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_holidays_tenant_name_start ON hr_holidays(tenant_id, holiday_name, start_date);
`;

    const { error } = await this.supabase.rpc('exec_sql', { sql });
    if (error) throw new Error(error.message);

    this.holidayTableReady = true;
  }

  private async ensureHolidaySeeded(tenantId: string) {
    await this.ensureHolidayTable();

    const { count, error } = await this.supabase
      .from('hr_holidays')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);
    if (error) throw new Error(error.message);

    if ((count || 0) > 0) {
      return;
    }

    const payload = DEFAULT_HR_HOLIDAYS_2026.map((holiday) => ({
      tenant_id: tenantId,
      holiday_name: holiday.holiday_name,
      start_date: holiday.start_date,
      end_date: holiday.end_date,
      holiday_type: holiday.holiday_type,
      notes: 'notes' in holiday ? (holiday as any).notes || null : null,
    }));

    const { error: insertError } = await this.supabase.from('hr_holidays').insert(payload);
    if (insertError) throw new Error(insertError.message);
  }

  async getHolidays(tenantId: string, year?: number) {
    try {
      await this.ensureHolidaySeeded(tenantId);
    } catch {
      const fallbackYear = year || new Date().getFullYear();
      return DEFAULT_HR_HOLIDAYS_2026
        .filter((holiday) => {
          const yearStart = `${fallbackYear}-01-01`;
          const yearEnd = `${fallbackYear}-12-31`;
          const start = String(holiday.start_date || '');
          const end = String(holiday.end_date || holiday.start_date || '');
          return start <= yearEnd && end >= yearStart;
        })
        .map((holiday, index) => ({
          id: `default-${fallbackYear}-${index + 1}`,
          tenant_id: tenantId,
          ...holiday,
          end_date: holiday.end_date || holiday.start_date,
          notes: 'notes' in holiday ? (holiday as any).notes || null : null,
          day_count: this.countHolidayDays(holiday.start_date, holiday.end_date),
          is_default: true,
        }));
    }

    const { data, error } = await this.supabase
      .from('hr_holidays')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('start_date', { ascending: true })
      .order('holiday_name', { ascending: true });
    if (error) throw new Error(error.message);

    const filtered = (data || []).filter((holiday: any) => {
      if (!year) return true;
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;
      const start = String(holiday.start_date || '');
      const end = String(holiday.end_date || holiday.start_date || '');
      return start <= yearEnd && end >= yearStart;
    });

    return filtered.map((holiday: any) => ({
      ...holiday,
      day_count: this.countHolidayDays(holiday.start_date, holiday.end_date),
    }));
  }

  async createHoliday(tenantId: string, data: any) {
    await this.ensureHolidayTable();

    const startDate = String(data?.start_date || '').trim();
    const endDate = String(data?.end_date || '').trim() || null;
    if (!startDate || !String(data?.holiday_name || '').trim()) {
      throw new Error('holiday_name and start_date are required');
    }
    if (endDate && endDate < startDate) {
      throw new Error('end_date cannot be earlier than start_date');
    }

    const payload = {
      tenant_id: tenantId,
      holiday_name: String(data.holiday_name).trim(),
      start_date: startDate,
      end_date: endDate,
      holiday_type: String(data?.holiday_type || 'PUBLIC').trim() || 'PUBLIC',
      notes: String(data?.notes || '').trim() || null,
    };

    const { data: result, error } = await this.supabase
      .from('hr_holidays')
      .insert([payload])
      .select();
    if (error) throw new Error(error.message);
    return result;
  }

  async updateHoliday(tenantId: string, id: string, data: any) {
    await this.ensureHolidayTable();

    const updates: any = {
      updated_at: new Date().toISOString(),
    };
    if (data.holiday_name !== undefined) updates.holiday_name = String(data.holiday_name || '').trim();
    if (data.start_date !== undefined) updates.start_date = String(data.start_date || '').trim();
    if (data.end_date !== undefined) updates.end_date = String(data.end_date || '').trim() || null;
    if (data.holiday_type !== undefined) updates.holiday_type = String(data.holiday_type || 'PUBLIC').trim() || 'PUBLIC';
    if (data.notes !== undefined) updates.notes = String(data.notes || '').trim() || null;

    const startDate = String(updates.start_date || data.start_date || '').trim();
    const endDate = String(updates.end_date || '').trim();
    if (startDate && endDate && endDate < startDate) {
      throw new Error('end_date cannot be earlier than start_date');
    }

    const { data: result, error } = await this.supabase
      .from('hr_holidays')
      .update(updates)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select();
    if (error) throw new Error(error.message);
    return result;
  }

  async deleteHoliday(tenantId: string, id: string) {
    await this.ensureHolidayTable();

    const { error } = await this.supabase
      .from('hr_holidays')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', id);
    if (error) throw new Error(error.message);
    return { message: 'Holiday deleted successfully' };
  }

  // Employee CRUD
  async createEmployee(tenantId: string, data: any) {
    const employeeData = {
      ...sanitizeEmployeePayload(data),
      tenant_id: tenantId
    };

    let { data: result, error } = await this.supabase
      .from('employees')
      .insert([employeeData])
      .select();

    if (error && isMissingColumnError(error, 'employees.per_diem_amount')) {
      const retry = omitKeys(employeeData, ['per_diem_amount']);
      const retryResult = await this.supabase
        .from('employees')
        .insert([retry])
        .select();
      result = retryResult.data;
      error = retryResult.error;
    }

    if (error) throw new Error(error.message);
    return result;
  }
  
  async getEmployees(tenantId: string) {
    const { data, error } = await this.supabase
      .from('employees')
      .select('*')
      .eq('tenant_id', tenantId);
    if (error) throw new Error(error.message);
    return data || [];
  }

  private async assertEmployeeBelongsToTenant(tenantId: string, employeeId: string) {
    const { data, error } = await this.supabase
      .from('employees')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('id', employeeId)
      .limit(1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error('Employee not found for this tenant');
  }

  private async getTenantEmployeeIds(tenantId: string) {
    const { data: employees, error } = await this.supabase
      .from('employees')
      .select('id')
      .eq('tenant_id', tenantId);
    if (error) throw new Error(error.message);
    return (employees || []).map((e: any) => e.id).filter(isNonEmptyString);
  }
  
  async getEmployee(tenantId: string, id: string) {
    const { data, error } = await this.supabase
      .from('employees')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async getEmployeeByUserId(tenantId: string, userId: string) {
    const { data, error } = await this.supabase
      .from('employees')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    return data || null;
  }
  
  async updateEmployee(tenantId: string, id: string, data: any) {
    const employeeData = sanitizeEmployeePayload(data);
    let { data: result, error } = await this.supabase
      .from('employees')
      .update(employeeData)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select();

    if (error && isMissingColumnError(error, 'employees.per_diem_amount')) {
      const retry = omitKeys(employeeData, ['per_diem_amount']);
      const retryResult = await this.supabase
        .from('employees')
        .update(retry)
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .select();
      result = retryResult.data;
      error = retryResult.error;
    }

    if (error) throw new Error(error.message);
    return result;
  }
  
  async deleteEmployee(tenantId: string, id: string) {
    const { error } = await this.supabase
      .from('employees')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', id);
    if (error) throw new Error(error.message);
    return { message: 'Employee deleted successfully' };
  }

  // Attendance
  async recordAttendance(tenantId: string, data: any) {
    const attendanceDate = isNonEmptyString(data?.attendance_date)
      ? String(data.attendance_date).slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    // attendance_records is the legacy local-time table.
    const attendanceData = {
      ...data,
      ...withAttendanceTravelFields(data),
      tenant_id: tenantId,
      attendance_date: attendanceDate,
      check_in_time: toLegacyAttendanceDateTime(attendanceDate, data.check_in_time),
      check_out_time: toLegacyAttendanceDateTime(attendanceDate, data.check_out_time),
    };

    let { data: result, error } = await this.supabase
      .from('attendance_records')
      .insert([attendanceData])
      .select();

    const travelColumns = ['is_outstation_travel', 'travel_departure_time', 'travel_arrival_time', 'travel_notes'];
    if (error && travelColumns.some((column) => isMissingColumnError(error, `attendance_records.${column}`))) {
      const retry = omitKeys(attendanceData, travelColumns);
      const retryResult = await this.supabase
        .from('attendance_records')
        .insert([retry])
        .select();
      result = retryResult.data;
      error = retryResult.error;
    }

    if (error) throw new Error(error.message);
    return result;
  }
  
  async getAttendance(tenantId: string, employeeId?: string, month?: string) {
    let query = this.supabase
      .from('attendance_records')
      .select('*')
      .eq('tenant_id', tenantId);
    
    if (employeeId) {
      query = query.eq('employee_id', employeeId);
    }
    
    if (month) {
      const { start, end } = monthToRange(month);
      query = query.gte('attendance_date', start).lte('attendance_date', end);
    }
    
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
  }

  async updateAttendance(tenantId: string, id: string, data: any) {
    const attendanceDate = isNonEmptyString(data?.attendance_date)
      ? String(data.attendance_date).slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const attendanceData: any = {
      tenant_id: tenantId,
      employee_id: data.employee_id || undefined,
      attendance_date: attendanceDate,
      check_in_time: toIndiaAttendanceDateTime(attendanceDate, data.check_in_time),
      check_out_time: toIndiaAttendanceDateTime(attendanceDate, data.check_out_time),
      status: data.status || 'PRESENT',
      check_in_notes: data.remarks || data.notes || null,
      ...withAttendanceTravelFields(data),
    };

    if (attendanceData.check_in_time && attendanceData.check_out_time) {
      const inTime = new Date(attendanceData.check_in_time);
      const outTime = new Date(attendanceData.check_out_time);
      const hours = (outTime.getTime() - inTime.getTime()) / (1000 * 60 * 60);
      attendanceData.work_hours = Number.isFinite(hours) && hours >= 0 ? hours.toFixed(2) : null;
    }

    Object.keys(attendanceData).forEach((key) => attendanceData[key] === undefined && delete attendanceData[key]);

    const travelColumns = ['is_outstation_travel', 'travel_departure_time', 'travel_arrival_time', 'travel_notes'];
    let { data: currentResult, error: currentError } = await this.supabase
      .from('attendance')
      .update(attendanceData)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select();

    if (currentError && travelColumns.some((column) => isMissingColumnError(currentError, `attendance.${column}`))) {
      const retryResult = await this.supabase
        .from('attendance')
        .update(omitKeys(attendanceData, travelColumns))
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .select();
      currentResult = retryResult.data;
      currentError = retryResult.error;
    }

    if (!currentError && currentResult && currentResult.length > 0) return currentResult;

    const legacyData: any = {
      ...data,
      ...withAttendanceTravelFields(data),
      tenant_id: tenantId,
      check_in_time: toLegacyAttendanceDateTime(attendanceDate, data.check_in_time),
      check_out_time: toLegacyAttendanceDateTime(attendanceDate, data.check_out_time),
      remarks: data.remarks || data.notes || null,
    };

    let { data: legacyResult, error: legacyError } = await this.supabase
      .from('attendance_records')
      .update(legacyData)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select();

    if (legacyError && travelColumns.some((column) => isMissingColumnError(legacyError, `attendance_records.${column}`))) {
      const retryResult = await this.supabase
        .from('attendance_records')
        .update(omitKeys(legacyData, travelColumns))
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .select();
      legacyResult = retryResult.data;
      legacyError = retryResult.error;
    }

    if (legacyError) throw new Error(currentError?.message || legacyError.message);
    return legacyResult;
  }

  async deleteAttendance(tenantId: string, id: string) {
    const { error } = await this.supabase
      .from('attendance_records')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', id);
    if (error) throw new Error(error.message);
    return { message: 'Attendance deleted successfully' };
  }

  async importBiometricAttendance(tenantId: string, body: { records: any[] }) {
    const records = Array.isArray(body?.records) ? body.records : [];
    if (records.length === 0) {
      return { imported: 0, skipped: 0, errors: [] as any[] };
    }

    const biometricIds = Array.from(
      new Set(
        records
          .map((r) => r?.biometric_id)
          .filter(isNonEmptyString)
          .map((s) => s.trim()),
      ),
    );

    const { data: employees, error: empError } = await this.supabase
      .from('employees')
      .select('id, biometric_id')
      .eq('tenant_id', tenantId)
      .in('biometric_id', biometricIds);
    if (empError) throw new Error(empError.message);

    const biometricToEmployeeId = new Map<string, string>();
    (employees || []).forEach((e: any) => {
      if (isNonEmptyString(e?.biometric_id) && isNonEmptyString(e?.id)) {
        biometricToEmployeeId.set(String(e.biometric_id).trim(), String(e.id));
      }
    });

    const errors: any[] = [];
    const upsertRows: any[] = [];
    let skipped = 0;

    for (const [idx, r] of records.entries()) {
      const biometricId = isNonEmptyString(r?.biometric_id) ? r.biometric_id.trim() : '';
      const employeeId = biometricToEmployeeId.get(biometricId);
      const attendanceDate = isNonEmptyString(r?.attendance_date) ? r.attendance_date : '';

      if (!employeeId || !attendanceDate) {
        skipped++;
        errors.push({ index: idx, reason: 'Missing employee match or attendance_date', biometric_id: biometricId });
        continue;
      }

      const checkIn = isNonEmptyString(r?.check_in_time) ? `${attendanceDate} ${r.check_in_time}:00` : null;
      const checkOut = isNonEmptyString(r?.check_out_time) ? `${attendanceDate} ${r.check_out_time}:00` : null;

      upsertRows.push({
        tenant_id: tenantId,
        employee_id: employeeId,
        attendance_date: attendanceDate,
        check_in_time: checkIn,
        check_out_time: checkOut,
        status: r?.status || 'PRESENT',
        remarks: r?.remarks || null,
      });
    }

    if (upsertRows.length === 0) {
      return { imported: 0, skipped, errors };
    }

    const { data: inserted, error: upsertError } = await this.supabase
      .from('attendance_records')
      .upsert(upsertRows, { onConflict: 'tenant_id,employee_id,attendance_date' })
      .select('id');
    if (upsertError) throw new Error(upsertError.message);

    return { imported: inserted?.length || 0, skipped, errors };
  }

  // Leave Requests
  async applyLeave(tenantId: string, data: any) {
    const employeeId = String(data?.employee_id || '').trim();
    await this.assertEmployeeBelongsToTenant(tenantId, employeeId);

    const { startDate, endDate, totalDays } = normalizeLeaveDatePayload(data);

    const leaveData = {
      employee_id: employeeId,
      leave_type: 'CASUAL',
      start_date: startDate,
      end_date: endDate,
      total_days: totalDays,
      reason: String(data?.reason || '').trim(),
      status: String(data?.status || 'PENDING').trim().toUpperCase(),
      tenant_id: tenantId,
    };

    const { data: result, error } = await this.supabase
      .from('leave_requests')
      .insert([leaveData])
      .select();

    if (error) {
      // Older DBs might have been created without leave_requests.tenant_id
      if (isMissingColumnError(error, 'leave_requests.tenant_id') || isMissingColumnError(error, 'tenant_id')) {
        const { tenant_id: _omit, ...withoutTenant } = leaveData as any;
        const { data: retryResult, error: retryError } = await this.supabase
          .from('leave_requests')
          .insert([withoutTenant])
          .select();
        if (retryError) throw new Error(retryError.message);
        return retryResult;
      }
      throw new Error(error.message);
    }

    return result;
  }
  async getLeaves(tenantId: string, employeeId?: string) {
    const leavesQuery = () => this.supabase.from('leave_requests').select('*');

    // Preferred path: enforce tenant_id directly when column exists
    try {
      let q = leavesQuery().eq('tenant_id', tenantId);
      if (employeeId) {
        q = q.eq('employee_id', employeeId);
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data || [];
    } catch (err: any) {
      // Fallback: prod table missing tenant_id. Enforce tenant isolation via employees table.
      if (!isMissingColumnError(err, 'leave_requests.tenant_id') && !isMissingColumnError(err, 'tenant_id')) {
        throw err;
      }

      if (employeeId) {
        await this.assertEmployeeBelongsToTenant(tenantId, employeeId);
        const { data, error } = await leavesQuery().eq('employee_id', employeeId);
        if (error) throw new Error(error.message);
        return data || [];
      }

      const employeeIds = await this.getTenantEmployeeIds(tenantId);
      if (employeeIds.length === 0) return [];

      const { data, error } = await leavesQuery().in('employee_id', employeeIds);
      if (error) throw new Error(error.message);
      return data || [];
    }
  }
  private async assertLeaveMakerChecker(tenantId: string, id: string, approverId: string, override = false) {
    if (override) return;
    const approverEmployee = await this.getEmployeeByUserId(tenantId, approverId);
    if (!approverEmployee?.id) return;
    const { data: leave } = await this.supabase
      .from('leave_requests')
      .select('id, employee_id')
      .eq('id', id)
      .maybeSingle();
    if (String(leave?.employee_id || '') === String(approverEmployee.id)) {
      throw new BadRequestException('Maker-checker violation: employees cannot approve or reject their own leave request.');
    }
  }

  async approveLeave(tenantId: string, id: string, approverId: string, options: { overrideMakerChecker?: boolean } = {}) {
    await this.assertLeaveMakerChecker(tenantId, id, approverId, options.overrideMakerChecker);
    const updateData = { status: 'APPROVED', approved_by: approverId, approved_at: new Date().toISOString() };

    const { data, error } = await this.supabase
      .from('leave_requests')
      .update(updateData)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select();

    if (error) {
      if (isMissingColumnError(error, 'leave_requests.tenant_id') || isMissingColumnError(error, 'tenant_id')) {
        const { data: row, error: fetchError } = await this.supabase
          .from('leave_requests')
          .select('id, employee_id')
          .eq('id', id)
          .single();
        if (fetchError) throw new Error(fetchError.message);
        await this.assertEmployeeBelongsToTenant(tenantId, String((row as any)?.employee_id || ''));

        const { data: retryData, error: retryError } = await this.supabase
          .from('leave_requests')
          .update(updateData)
          .eq('id', id)
          .select();
        if (retryError) throw new Error(retryError.message);
        return retryData;
      }
      throw new Error(error.message);
    }

    return data;
  }
  async rejectLeave(tenantId: string, id: string, approverId: string, options: { overrideMakerChecker?: boolean } = {}) {
    await this.assertLeaveMakerChecker(tenantId, id, approverId, options.overrideMakerChecker);
    const updateData = { status: 'REJECTED', approved_by: approverId, approved_at: new Date().toISOString() };

    const { data, error } = await this.supabase
      .from('leave_requests')
      .update(updateData)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select();

    if (error) {
      if (isMissingColumnError(error, 'leave_requests.tenant_id') || isMissingColumnError(error, 'tenant_id')) {
        const { data: row, error: fetchError } = await this.supabase
          .from('leave_requests')
          .select('id, employee_id')
          .eq('id', id)
          .single();
        if (fetchError) throw new Error(fetchError.message);
        await this.assertEmployeeBelongsToTenant(tenantId, String((row as any)?.employee_id || ''));

        const { data: retryData, error: retryError } = await this.supabase
          .from('leave_requests')
          .update(updateData)
          .eq('id', id)
          .select();
        if (retryError) throw new Error(retryError.message);
        return retryData;
      }
      throw new Error(error.message);
    }

    return data;
  }

  async updateLeave(tenantId: string, id: string, data: any) {
    const updatePayload: any = { ...data };
    if (data?.start_date !== undefined || data?.end_date !== undefined || data?.total_days !== undefined) {
      const { data: existing, error: existingError } = await this.supabase
        .from('leave_requests')
        .select('start_date, end_date')
        .eq('id', id)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);
      const { startDate, endDate, totalDays } = normalizeLeaveDatePayload({
        ...data,
        start_date: data?.start_date ?? existing?.start_date,
        end_date: data?.end_date ?? existing?.end_date,
      });
      updatePayload.start_date = startDate;
      updatePayload.end_date = endDate;
      updatePayload.total_days = totalDays;
    }
    delete updatePayload.leave_type;

    const { data: result, error } = await this.supabase
      .from('leave_requests')
      .update(updatePayload)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select();

    if (error) {
      if (isMissingColumnError(error, 'leave_requests.tenant_id') || isMissingColumnError(error, 'tenant_id')) {
        const { data: row, error: fetchError } = await this.supabase
          .from('leave_requests')
          .select('id, employee_id')
          .eq('id', id)
          .single();
        if (fetchError) throw new Error(fetchError.message);
        await this.assertEmployeeBelongsToTenant(tenantId, String((row as any)?.employee_id || ''));

        const { data: retryResult, error: retryError } = await this.supabase
          .from('leave_requests')
          .update(updatePayload)
          .eq('id', id)
          .select();
        if (retryError) throw new Error(retryError.message);
        return retryResult;
      }
      throw new Error(error.message);
    }

    return result;
  }

  // Salary Components
  async addSalaryComponent(tenantId: string, data: any) {
    await this.assertEmployeeBelongsToTenant(tenantId, String(data?.employee_id || ''));

    const componentData = {
      ...data,
      tenant_id: tenantId
    };

    // Some prod DBs were created without salary_components.tenant_id; fallback inserts without it.
    const { data: result, error } = await this.supabase
      .from('salary_components')
      .insert([componentData])
      .select();

    if (error) {
      if (isMissingColumnError(error, 'salary_components.tenant_id') || isMissingColumnError(error, 'tenant_id')) {
        const { tenant_id: _omit, ...withoutTenant } = componentData as any;
        const { data: retryResult, error: retryError } = await this.supabase
          .from('salary_components')
          .insert([withoutTenant])
          .select();
        if (retryError) throw new Error(retryError.message);
        return retryResult;
      }
      throw new Error(error.message);
    }

    return result;
  }
  async getSalaryComponents(tenantId: string, employeeId?: string) {
    // Preferred: filter by tenant_id when column exists
    const query = this.supabase.from('salary_components').select('*');

    try {
      let q = query.eq('tenant_id', tenantId);
      if (employeeId) {
        q = q.eq('employee_id', employeeId);
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data || [];
    } catch (err: any) {
      // Fallback: prod table missing tenant_id. Enforce tenant isolation via employees table.
      if (!isMissingColumnError(err, 'salary_components.tenant_id') && !isMissingColumnError(err, 'tenant_id')) {
        throw err;
      }

      if (employeeId) {
        await this.assertEmployeeBelongsToTenant(tenantId, employeeId);
        const { data, error } = await this.supabase
          .from('salary_components')
          .select('*')
          .eq('employee_id', employeeId);
        if (error) throw new Error(error.message);
        return data || [];
      }

      const { data: employees, error: empError } = await this.supabase
        .from('employees')
        .select('id')
        .eq('tenant_id', tenantId);
      if (empError) throw new Error(empError.message);
      const employeeIds = (employees || []).map((e: any) => e.id);
      if (employeeIds.length === 0) return [];

      const { data, error } = await this.supabase
        .from('salary_components')
        .select('*')
        .in('employee_id', employeeIds);
      if (error) throw new Error(error.message);
      return data || [];
    }
  }

  async deleteSalaryComponent(tenantId: string, id: string) {
    const { error } = await this.supabase
      .from('salary_components')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', id);

    if (error) {
      if (isMissingColumnError(error, 'salary_components.tenant_id') || isMissingColumnError(error, 'tenant_id')) {
        // Fallback: verify ownership via employees table before deleting
        const { data: row, error: fetchError } = await this.supabase
          .from('salary_components')
          .select('id, employee_id')
          .eq('id', id)
          .single();
        if (fetchError) throw new Error(fetchError.message);
        await this.assertEmployeeBelongsToTenant(tenantId, String((row as any)?.employee_id || ''));

        const { error: delError } = await this.supabase
          .from('salary_components')
          .delete()
          .eq('id', id);
        if (delError) throw new Error(delError.message);
        return { message: 'Salary component deleted successfully' };
      }
      throw new Error(error.message);
    }

    return { message: 'Salary component deleted successfully' };
  }

  // Payroll Run
  async createPayrollRun(tenantId: string, data: any, _userId?: string) {
    const payrollData = {
      ...data,
      tenant_id: tenantId,
      run_date: data.run_date || new Date().toISOString().split('T')[0]
    };
    const { data: result, error } = await this.supabase
      .from('payroll_runs')
      .insert([payrollData])
      .select();
    if (error) throw new Error(error.message);
    return result;
  }
  async getPayrollRuns(tenantId: string) {
    const { data, error } = await this.supabase
      .from('payroll_runs')
      .select('*')
      .eq('tenant_id', tenantId);
    if (error) throw new Error(error.message);
    return data || [];
  }

  // Payslip Generation
  async generatePayslip(tenantId: string, data: any, userId?: string) {
    // Check if payslips already exist for this payroll run
    let existingPayslips: any[] | null = null;
    try {
      const { data: existing, error: checkError } = await this.supabase
        .from('payslips')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('payroll_run_id', data.run_id)
        .limit(1);
      if (checkError) throw new Error(checkError.message);
      existingPayslips = existing;
    } catch (err: any) {
      if (!isMissingColumnError(err, 'payslips.tenant_id') && !isMissingColumnError(err, 'tenant_id')) {
        throw err;
      }
      const { data: existing, error: checkError } = await this.supabase
        .from('payslips')
        .select('id')
        .eq('payroll_run_id', data.run_id)
        .limit(1);
      if (checkError) throw new Error(checkError.message);
      existingPayslips = existing;
    }
    
    // If payslips already exist, just update the status and return
    if (existingPayslips && existingPayslips.length > 0) {
      const { error: updateError } = await this.supabase
        .from('payroll_runs')
        .update({ status: 'COMPLETED' })
        .eq('tenant_id', tenantId)
        .eq('id', data.run_id);
      
      if (updateError) throw new Error(updateError.message);
      
      return { message: 'Payroll run status updated to COMPLETED. Payslips already exist.' };
    }

    // Get the payroll run details
    const { data: payrollRun, error: runError } = await this.supabase
      .from('payroll_runs')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', data.run_id)
      .single();
    
    if (runError) throw new Error(runError.message);
    if (!payrollRun) throw new Error('Payroll run not found');

    // Get all employees for this tenant
    const { data: employees, error: empError } = await this.supabase
      .from('employees')
      .select('*')
      .eq('tenant_id', tenantId);
    
    if (empError) throw new Error(empError.message);
    if (!employees || employees.length === 0) {
      throw new Error('No employees found for this tenant');
    }

    // Get salary components for all employees
    let salaryComponents: any[] | null = null;
    try {
      const { data: sc, error: salError } = await this.supabase
        .from('salary_components')
        .select('*')
        .eq('tenant_id', tenantId)
        .in('employee_id', employees.map((e) => e.id));
      if (salError) throw new Error(salError.message);
      salaryComponents = sc;
    } catch (err: any) {
      if (!isMissingColumnError(err, 'salary_components.tenant_id') && !isMissingColumnError(err, 'tenant_id')) {
        throw err;
      }
      const { data: sc, error: salError } = await this.supabase
        .from('salary_components')
        .select('*')
        .in('employee_id', employees.map((e) => e.id));
      if (salError) throw new Error(salError.message);
      salaryComponents = sc;
    }

    // Attendance for the payroll month
    const payrollMonth = String(payrollRun.payroll_month);
    if (!/^\d{4}-\d{2}$/.test(payrollMonth)) {
      throw new Error(`Invalid payroll_month format for run ${data.run_id}: ${payrollMonth}. Expected YYYY-MM.`);
    }
    const { start: monthStart, end: monthEnd } = monthToRange(payrollMonth);
    const { data: legacyAttendanceRecords, error: attError } = await this.supabase
      .from('attendance_records')
      .select('*')
      .eq('tenant_id', tenantId)
      .gte('attendance_date', monthStart)
      .lte('attendance_date', monthEnd)
      .in('employee_id', employees.map((e) => e.id));
    if (attError) throw new Error(attError.message);

    let punchAttendanceRecords: any[] = [];
    const { data: punchAttendance, error: punchAttError } = await this.supabase
      .from('attendance')
      .select('*')
      .eq('tenant_id', tenantId)
      .gte('attendance_date', monthStart)
      .lte('attendance_date', monthEnd)
      .in('employee_id', employees.map((e) => e.id));
    if (punchAttError) {
      if (
        !isMissingRelationError(punchAttError, 'attendance') &&
        !isMissingColumnError(punchAttError, 'attendance.tenant_id') &&
        !isMissingColumnError(punchAttError, 'tenant_id')
      ) {
        throw new Error(punchAttError.message);
      }
    } else {
      punchAttendanceRecords = punchAttendance || [];
    }

    const attendanceDaysByEmployee = new Map<string, number>();
    const dailyCredits = new Map<string, number>();
    const travelDaysByEmployee = new Map<string, number>();
    const travelDayKeys = new Set<string>();
    [...(legacyAttendanceRecords || []), ...punchAttendanceRecords].forEach((r: any) => {
      const employeeId = String(r.employee_id || '');
      const attendanceDate = String(r.attendance_date || '').slice(0, 10);
      if (!employeeId || !attendanceDate) return;
      const key = `${employeeId}::${attendanceDate}`;
      const credit = calculateAttendancePayDayCredit(r);
      dailyCredits.set(key, Math.max(dailyCredits.get(key) || 0, credit));
      if (isTravelPerDiemDay(r)) {
        travelDayKeys.add(key);
      }
    });

    dailyCredits.forEach((credit, key) => {
      if (credit <= 0) return;
      const employeeId = key.split('::')[0];
      attendanceDaysByEmployee.set(employeeId, (attendanceDaysByEmployee.get(employeeId) || 0) + credit);
    });

    travelDayKeys.forEach((key) => {
      const employeeId = key.split('::')[0];
      travelDaysByEmployee.set(employeeId, (travelDaysByEmployee.get(employeeId) || 0) + 1);
    });

    // Generate payslips for each employee with correct schema
    const payslips = employees.map((employee, index) => {
      const employeeSalaryComponents =
        salaryComponents?.filter((sc: any) => sc.employee_id === employee.id) || [];

      const grossTypes = new Set(['BASIC', 'HRA', 'ALLOWANCE', 'BONUS']);
      const deductionTypes = new Set(['DEDUCTION', 'PF', 'ESI', 'TAX']);

      const grossSalary = employeeSalaryComponents
        .filter((sc: any) => grossTypes.has(String(sc.component_type)))
        .reduce((sum: number, sc: any) => sum + (parseFloat(sc.amount) || 0), 0);

      const totalDeductions = employeeSalaryComponents
        .filter((sc: any) => deductionTypes.has(String(sc.component_type)))
        .reduce((sum: number, sc: any) => sum + (parseFloat(sc.amount) || 0), 0);

      const attendanceDays = attendanceDaysByEmployee.get(employee.id) || 0;
      const travelDays = travelDaysByEmployee.get(employee.id) || 0;
      const perDiemAmount = getEmployeePerDiemAmount(employee);
      const totalPerDiem = travelDays * perDiemAmount;
      const netSalary = grossSalary - totalDeductions + totalPerDiem;

      const runIdPrefix = String(data.run_id).replace(/-/g, '').slice(0, 8);
      
      return {
        tenant_id: tenantId,
        payroll_run_id: data.run_id,
        employee_id: employee.id,
        payslip_number: `PAY-${payrollRun.payroll_month}-${runIdPrefix}-${String(index + 1).padStart(4, '0')}`,
        salary_month: payrollRun.payroll_month,
        gross_salary: grossSalary,
        total_deductions: totalDeductions,
        net_salary: netSalary,
        attendance_days: attendanceDays,
        leave_days: 0,
        travel_days: travelDays,
        per_diem_amount: perDiemAmount,
        total_per_diem: totalPerDiem,
      };
    });

    // Insert payslips. Some prod DBs were created without payslips.tenant_id; fallback inserts without it.
    let result: any = null;
    const { data: inserted, error } = await this.supabase
      .from('payslips')
      .insert(payslips)
      .select();

    if (error) {
      const optionalPayslipColumns = ['travel_days', 'per_diem_amount', 'total_per_diem'];
      const missingTenant = isMissingColumnError(error, 'payslips.tenant_id') || isMissingColumnError(error, 'tenant_id');
      const missingTravelColumn = optionalPayslipColumns.some((column) => isMissingColumnError(error, `payslips.${column}`));
      if (missingTenant || missingTravelColumn) {
        const omittedColumns = [
          ...(missingTenant ? ['tenant_id'] : []),
          ...(missingTravelColumn ? optionalPayslipColumns : []),
        ];
        const retryRows = payslips.map((row: any) => omitKeys(row, omittedColumns));
        const { data: retryInserted, error: retryError } = await this.supabase
          .from('payslips')
          .insert(retryRows)
          .select();
        if (retryError) throw new Error(retryError.message);
        result = retryInserted;
      } else {
        throw new Error(error.message);
      }
    } else {
      result = inserted;
    }

    // Update payroll run status to COMPLETED
    const { error: updateError } = await this.supabase
      .from('payroll_runs')
      .update({ status: 'COMPLETED' })
      .eq('tenant_id', tenantId)
      .eq('id', data.run_id);
    
    if (updateError) throw new Error(updateError.message);

    // Payroll enters Finance only after the run has produced its detailed
    // payslips.  The finance adapter is intentionally non-blocking: HR must
    // never fail merely because an accounting posting rule has not yet been
    // configured.  Its source register makes retries idempotent.
    const payrollAmount = (result || []).reduce((sum: number, slip: any) => (
      sum + Math.max(0, Number(slip?.net_salary || 0))
    ), 0);
    if (payrollAmount > 0) {
      await this.accountingService.queueAutomaticOperationalPosting(tenantId, userId || '', {
        source_type: 'PAYROLL_RUN',
        source_id: String(data.run_id),
        source_number: String(payrollRun?.payroll_month || data.run_id),
        journal_date: String(payrollRun?.run_date || new Date().toISOString()).slice(0, 10),
        amount: payrollAmount,
        narration: `Payroll run ${String(payrollRun?.payroll_month || data.run_id)}`,
      });
    }

    return result;
  }
  async getPayslips(tenantId: string, employeeId?: string) {
    // Preferred: filter by tenant_id when column exists
    try {
      let query = this.supabase
        .from('payslips')
        .select('*')
        .eq('tenant_id', tenantId);

      if (employeeId) {
        query = query.eq('employee_id', employeeId);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data || [];
    } catch (err: any) {
      if (!isMissingColumnError(err, 'payslips.tenant_id') && !isMissingColumnError(err, 'tenant_id')) {
        throw err;
      }

      // Fallback: enforce tenant isolation via employees table.
      if (employeeId) {
        await this.assertEmployeeBelongsToTenant(tenantId, employeeId);
        const { data, error } = await this.supabase
          .from('payslips')
          .select('*')
          .eq('employee_id', employeeId);
        if (error) throw new Error(error.message);
        return data || [];
      }

      const { data: employees, error: empError } = await this.supabase
        .from('employees')
        .select('id')
        .eq('tenant_id', tenantId);
      if (empError) throw new Error(empError.message);
      const employeeIds = (employees || []).map((e: any) => e.id);
      if (employeeIds.length === 0) return [];

      const { data, error } = await this.supabase
        .from('payslips')
        .select('*')
        .in('employee_id', employeeIds);
      if (error) throw new Error(error.message);
      return data || [];
    }
  }

  // Monthly Payroll Processing
  async createMonthlyPayroll(tenantId: string, data: any) {
    const payload = {
      tenant_id: tenantId,
      employee_id: data.employee_id,
      payroll_month: data.payroll_month,
      days_in_month: data.days_in_month,
      days_travelled: data.days_travelled || 0,
      comp_offs: data.comp_offs || 0,
      leaves_absent: data.leaves_absent || 0,
      approved_paid_leaves: data.approved_paid_leaves || 0,
      paid_for_total_days: data.paid_for_total_days || 0,
      bonus_monthly: data.bonus_monthly || 0,
      production_incentive: data.production_incentive || 0,
      bonus_hold: data.bonus_hold || 0,
      production_incentive_hold: data.production_incentive_hold || 0,
      special_allowance: data.special_allowance || 0,
      professional_tax: data.professional_tax || 0,
      gross_salary: data.gross_salary,
      net_salary: data.net_salary,
      monthly_hold: data.monthly_hold,
      amount_paid: data.amount_paid,
      status: data.status || 'DRAFT'
    };

    const { data: result, error } = await this.supabase
      .from('monthly_payroll')
      .insert([payload])
      .select();
    if (error) throw new Error(error.message);
    return result;
  }

  async getMonthlyPayrolls(tenantId: string, month?: string) {
    let query = this.supabase
      .from('monthly_payroll')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('payroll_month', { ascending: false })
      .order('created_at', { ascending: false });

    if (month) {
      query = query.eq('payroll_month', month);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
  }

  async updateMonthlyPayroll(tenantId: string, id: string, data: any) {
    const payload: any = {
      payroll_month: data.payroll_month,
      days_in_month: data.days_in_month,
      days_travelled: data.days_travelled || 0,
      comp_offs: data.comp_offs || 0,
      leaves_absent: data.leaves_absent || 0,
      approved_paid_leaves: data.approved_paid_leaves || 0,
      paid_for_total_days: data.paid_for_total_days || 0,
      bonus_monthly: data.bonus_monthly || 0,
      production_incentive: data.production_incentive || 0,
      bonus_hold: data.bonus_hold || 0,
      production_incentive_hold: data.production_incentive_hold || 0,
      special_allowance: data.special_allowance || 0,
      professional_tax: data.professional_tax || 0,
      gross_salary: data.gross_salary,
      net_salary: data.net_salary,
      monthly_hold: data.monthly_hold,
      amount_paid: data.amount_paid
    };

    const { data: result, error } = await this.supabase
      .from('monthly_payroll')
      .update(payload)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select();
    if (error) throw new Error(error.message);
    return result;
  }

  async processMonthlyPayroll(tenantId: string, id: string) {
    const { data: result, error } = await this.supabase
      .from('monthly_payroll')
      .update({ 
        status: 'PROCESSED',
        processed_at: new Date().toISOString()
      })
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select();
    if (error) throw new Error(error.message);
    return result;
  }

  async deleteMonthlyPayroll(tenantId: string, id: string) {
    const { error } = await this.supabase
      .from('monthly_payroll')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', id);
    if (error) throw new Error(error.message);
    return { message: 'Monthly payroll deleted successfully' };
  }

  // Employee Documents
  async getEmployeeDocuments(tenantId: string, employeeId: string) {
    const { data, error } = await this.supabase
      .from('employee_documents')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false});
    if (error) throw new Error(error.message);
    return data || [];
  }

  async addEmployeeDocument(tenantId: string, employeeId: string, data: any) {
    const payload = {
      tenant_id: tenantId,
      employee_id: employeeId,
      doc_type: data.doc_type,
      file_name: data.file_name,
      file_url: data.file_url,
      file_type: data.file_type,
      file_size: data.file_size,
      notes: data.notes || null,
    };

    const { data: result, error } = await this.supabase
      .from('employee_documents')
      .insert([payload])
      .select();
    if (error) throw new Error(error.message);
    return result;
  }

  async deleteEmployeeDocument(tenantId: string, employeeId: string, docId: string) {
    const { error } = await this.supabase
      .from('employee_documents')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .eq('id', docId);
    if (error) throw new Error(error.message);
    return { message: 'Document deleted successfully' };
  }

  // Merits & Demerits
  async getMeritsDemerits(tenantId: string, employeeId: string) {
    const { data, error } = await this.supabase
      .from('employee_merits_demerits')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .order('event_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  }

  async addMeritDemerit(tenantId: string, employeeId: string, data: any, user?: any) {
    let configuredType: any = null;
    if (data.type_id) {
      const { data: type, error: typeError } = await this.supabase
        .from('merit_demerit_types').select('*').eq('tenant_id', tenantId).eq('id', data.type_id).eq('is_active', true).maybeSingle();
      if (typeError) throw new Error(typeError.message);
      if (!type) throw new Error('The selected merit/demerit type is inactive or unavailable');
      configuredType = type;
    }
    const recordType = configuredType?.record_type || data.record_type;
    if (!['MERIT', 'DEMERIT'].includes(recordType)) throw new Error('Record type must be MERIT or DEMERIT');
    const title = (data.title || configuredType?.type_name || '').trim();
    if (!title) throw new Error('An event title or configured event type is required');
    const payload = {
      tenant_id: tenantId,
      employee_id: employeeId,
      type_id: configuredType?.id || null,
      record_type: recordType,
      title,
      description: data.description || null,
      points: data.points !== undefined && data.points !== '' ? data.points : (configuredType?.default_points ?? null),
      event_date: data.event_date || new Date().toISOString().slice(0, 10),
      evidence_reference: data.evidence_reference || null,
      // HR events must be approved before they affect any appraisal/reporting outcome.
      status: configuredType?.requires_approval === false ? 'APPROVED' : 'PENDING_APPROVAL',
      recorded_by: user?.userId || user?.id || null,
    };

    const { data: result, error } = await this.supabase
      .from('employee_merits_demerits')
      .insert([payload])
      .select();
    if (error) throw new Error(error.message);
    return result;
  }

  async deleteMeritDemerit(tenantId: string, employeeId: string, recordId: string) {
    const { data, error } = await this.supabase
      .from('employee_merits_demerits')
      .update({ status: 'VOID', voided_at: new Date().toISOString(), void_reason: 'Voided by authorised HR user' })
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .eq('id', recordId)
      .neq('status', 'VOID')
      .select();
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error('Record was already voided or could not be found');
    return { message: 'Record voided; the audit trail is retained' };
  }

  async approveMeritDemerit(tenantId: string, employeeId: string, recordId: string, data: any, user: any) {
    const status = data?.approved === false ? 'REJECTED' : 'APPROVED';
    const { data: result, error } = await this.supabase
      .from('employee_merits_demerits')
      .update({ status, approved_by: user?.userId || user?.id || null, approved_at: new Date().toISOString(), approval_comment: data?.comment || null })
      .eq('tenant_id', tenantId).eq('employee_id', employeeId).eq('id', recordId).eq('status', 'PENDING_APPROVAL').select();
    if (error) throw new Error(error.message);
    if (!result?.length) throw new Error('Only pending merit/demerit records can be approved or rejected');
    return result[0];
  }

  // KPI Definitions Master Config
  async getKPIDefinitions(tenantId: string) {
    const { data, error } = await this.supabase
      .from('kpi_definitions')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('kpi_category', { ascending: true })
      .order('kpi_name', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  }

  async createKPIDefinition(tenantId: string, data: any) {
    const payload = {
      tenant_id: tenantId,
      kpi_name: data.kpi_name,
      kpi_category: data.kpi_category,
      description: data.description || null,
      measurement_type: data.measurement_type,
      min_value: data.min_value || 0,
      max_value: data.max_value || 100,
      threshold_excellent: data.threshold_excellent || null,
      threshold_good: data.threshold_good || null,
      threshold_acceptable: data.threshold_acceptable || null,
      auto_calculate: data.auto_calculate || false,
      calculation_formula: data.calculation_formula || null,
      kpi_code: data.kpi_code || null,
      direction: data.direction || 'HIGHER_IS_BETTER',
      target_value: data.target_value ?? null,
      weight: data.weight ?? 1,
      review_frequency: data.review_frequency || 'MONTHLY',
      is_active: data.is_active !== false,
    };

    const { data: result, error } = await this.supabase
      .from('kpi_definitions')
      .insert([payload])
      .select();
    if (error) throw new Error(error.message);
    return result;
  }

  async updateKPIDefinition(tenantId: string, id: string, data: any) {
    const updates: any = {};
    if (data.kpi_name !== undefined) updates.kpi_name = data.kpi_name;
    if (data.kpi_category !== undefined) updates.kpi_category = data.kpi_category;
    if (data.description !== undefined) updates.description = data.description;
    if (data.measurement_type !== undefined) updates.measurement_type = data.measurement_type;
    if (data.min_value !== undefined) updates.min_value = data.min_value;
    if (data.max_value !== undefined) updates.max_value = data.max_value;
    if (data.threshold_excellent !== undefined) updates.threshold_excellent = data.threshold_excellent;
    if (data.threshold_good !== undefined) updates.threshold_good = data.threshold_good;
    if (data.threshold_acceptable !== undefined) updates.threshold_acceptable = data.threshold_acceptable;
    if (data.auto_calculate !== undefined) updates.auto_calculate = data.auto_calculate;
    if (data.calculation_formula !== undefined) updates.calculation_formula = data.calculation_formula;
    if (data.kpi_code !== undefined) updates.kpi_code = data.kpi_code || null;
    if (data.direction !== undefined) updates.direction = data.direction;
    if (data.target_value !== undefined) updates.target_value = data.target_value;
    if (data.weight !== undefined) updates.weight = data.weight;
    if (data.review_frequency !== undefined) updates.review_frequency = data.review_frequency;
    if (data.is_active !== undefined) updates.is_active = data.is_active;
    updates.updated_at = new Date().toISOString();

    const { data: result, error } = await this.supabase
      .from('kpi_definitions')
      .update(updates)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select();
    if (error) throw new Error(error.message);
    return result;
  }

  async deleteKPIDefinition(tenantId: string, id: string) {
    const { error } = await this.supabase
      .from('kpi_definitions')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', id);
    if (error) throw new Error(error.message);
    return { message: 'KPI definition deleted successfully' };
  }

  // Merit/Demerit Types Master Config
  async getMeritDemeritTypes(tenantId: string) {
    const { data, error } = await this.supabase
      .from('merit_demerit_types')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('record_type', { ascending: true })
      .order('category', { ascending: true })
      .order('type_name', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  }

  async createMeritDemeritType(tenantId: string, data: any) {
    const payload = {
      tenant_id: tenantId,
      type_code: data.type_code || null,
      type_name: data.type_name,
      record_type: data.record_type,
      category: data.category,
      description: data.description || null,
      default_points: data.default_points || 0,
      severity: data.severity || null,
      requires_approval: data.requires_approval || false,
      is_active: data.is_active !== false,
    };

    const { data: result, error } = await this.supabase
      .from('merit_demerit_types')
      .insert([payload])
      .select();
    if (error) throw new Error(error.message);
    return result;
  }

  async updateMeritDemeritType(tenantId: string, id: string, data: any) {
    const updates: any = {};
    if (data.type_name !== undefined) updates.type_name = data.type_name;
    if (data.type_code !== undefined) updates.type_code = data.type_code || null;
    if (data.record_type !== undefined) updates.record_type = data.record_type;
    if (data.category !== undefined) updates.category = data.category;
    if (data.description !== undefined) updates.description = data.description;
    if (data.default_points !== undefined) updates.default_points = data.default_points;
    if (data.severity !== undefined) updates.severity = data.severity;
    if (data.requires_approval !== undefined) updates.requires_approval = data.requires_approval;
    if (data.is_active !== undefined) updates.is_active = data.is_active;
    updates.updated_at = new Date().toISOString();

    const { data: result, error } = await this.supabase
      .from('merit_demerit_types')
      .update(updates)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select();
    if (error) throw new Error(error.message);
    return result;
  }

  async deleteMeritDemeritType(tenantId: string, id: string) {
    const { error } = await this.supabase
      .from('merit_demerit_types')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', id);
    if (error) throw new Error(error.message);
    return { message: 'Merit/Demerit type deleted successfully' };
  }

  async seedPerformanceDefaults(tenantId: string) {
    const kpis = [
      ['ATTENDANCE_COMPLIANCE', 'Attendance compliance', 'ATTENDANCE', 'Attendance days and authorised leave compliance', true, 100, 98, 95, 90],
      ['PUNCTUALITY', 'Punctuality', 'ATTENDANCE', 'On-time reporting against shift policy', true, 100, 98, 95, 90],
      ['QUALITY_OF_WORK', 'Quality of work', 'PERFORMANCE', 'Manager-assessed quality and rework control', false, 100, 90, 75, 60],
      ['PRODUCTIVITY', 'Productivity', 'PERFORMANCE', 'Planned versus completed output', false, 100, 90, 75, 60],
      ['SAFETY_COMPLIANCE', 'Safety & compliance', 'COMPLIANCE', 'Safety, policy and process compliance', false, 100, 100, 95, 90],
    ];
    const types = [
      ['PERFECT_ATTENDANCE', 'Perfect attendance', 'MERIT', 'ATTENDANCE', 10, 'LOW'], ['QUALITY_ACHIEVEMENT', 'Quality achievement', 'MERIT', 'PERFORMANCE', 15, 'MEDIUM'],
      ['SAFETY_RECOGNITION', 'Safety recognition', 'MERIT', 'COMPLIANCE', 15, 'MEDIUM'], ['UNAUTHORISED_ABSENCE', 'Unauthorised absence', 'DEMERIT', 'ATTENDANCE', -10, 'MEDIUM'],
      ['REPEATED_LATE', 'Repeated late reporting', 'DEMERIT', 'ATTENDANCE', -5, 'LOW'], ['QUALITY_NONCONFORMANCE', 'Quality non-conformance', 'DEMERIT', 'PERFORMANCE', -10, 'MEDIUM'],
      ['SAFETY_VIOLATION', 'Safety violation', 'DEMERIT', 'COMPLIANCE', -20, 'HIGH'],
    ];
    const existingKpi = await this.getKPIDefinitions(tenantId);
    const missingKpis = kpis.filter(([code]) => !existingKpi.some((k: any) => k.kpi_code === code)).map(([kpi_code, kpi_name, kpi_category, description, auto_calculate, target_value, threshold_excellent, threshold_good, threshold_acceptable]) =>
      ({ tenant_id: tenantId, kpi_code, kpi_name, kpi_category, description, measurement_type: 'PERCENTAGE', target_value, threshold_excellent, threshold_good, threshold_acceptable, auto_calculate, direction: 'HIGHER_IS_BETTER', weight: 1, review_frequency: 'MONTHLY', is_active: true }));
    if (missingKpis.length) { const { error } = await this.supabase.from('kpi_definitions').insert(missingKpis); if (error) throw new Error(error.message); }
    const existingTypes = await this.getMeritDemeritTypes(tenantId);
    const missingTypes = types.filter(([code]) => !existingTypes.some((t: any) => t.type_code === code)).map(([type_code, type_name, record_type, category, default_points, severity]) =>
      ({ tenant_id: tenantId, type_code, type_name, record_type, category, default_points, severity, requires_approval: true, is_active: true }));
    if (missingTypes.length) { const { error } = await this.supabase.from('merit_demerit_types').insert(missingTypes); if (error) throw new Error(error.message); }
    return { message: 'SAP-aligned KPI and merit/demerit defaults are ready', kpisAdded: missingKpis.length, typesAdded: missingTypes.length };
  }

  async getKpiReviews(tenantId: string, employeeId: string) {
    const { data, error } = await this.supabase
      .from('employee_kpi_reviews')
      .select('*, kpi_definitions(kpi_code,kpi_name,kpi_category)')
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .order('period_end', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  }

  private calculateKpiBand(definition: any, value: number | null) {
    if (value === null || !Number.isFinite(value)) return { score: null, band: 'NOT_RATED' };
    const excellent = Number(definition.threshold_excellent);
    const good = Number(definition.threshold_good);
    const acceptable = Number(definition.threshold_acceptable);
    const lowerIsBetter = definition.direction === 'LOWER_IS_BETTER';
    const meets = (threshold: number) => lowerIsBetter ? value <= threshold : value >= threshold;
    if (Number.isFinite(excellent) && meets(excellent)) return { score: 100, band: 'EXCELLENT' };
    if (Number.isFinite(good) && meets(good)) return { score: 80, band: 'GOOD' };
    if (Number.isFinite(acceptable) && meets(acceptable)) return { score: 60, band: 'ACCEPTABLE' };
    return { score: 0, band: 'BELOW_EXPECTATION' };
  }

  async saveKpiReview(tenantId: string, employeeId: string, body: any, user: any) {
    const start = String(body?.period_start || '').slice(0, 10);
    const end = String(body?.period_end || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
      throw new BadRequestException('A valid KPI review period is required');
    }
    const metrics = body?.metrics || {};
    const definitionMap: Record<string, string> = {
      attendance_rate: 'ATTENDANCE_COMPLIANCE',
      punctuality_score: 'PUNCTUALITY',
      quality_of_work: 'QUALITY_OF_WORK',
      productivity_score: 'PRODUCTIVITY',
    };
    const definitions = await this.getKPIDefinitions(tenantId);
    const preparedBy = user?.userId || user?.id || null;
    const rows: any[] = [];
    for (const [metric, code] of Object.entries(definitionMap)) {
      const definition = definitions.find((item: any) => item.kpi_code === code && item.is_active !== false);
      if (!definition || metrics[metric] === undefined || metrics[metric] === '' || metrics[metric] === null) continue;
      const actualValue = Number(metrics[metric]);
      if (!Number.isFinite(actualValue)) continue;
      const band = this.calculateKpiBand(definition, actualValue);
      rows.push({
        tenant_id: tenantId,
        employee_id: employeeId,
        kpi_definition_id: definition.id,
        period_start: start,
        period_end: end,
        actual_value: actualValue,
        calculated_score: band.score,
        result_band: band.band,
        source: definition.auto_calculate ? 'SYSTEM' : 'MANUAL',
        status: 'PENDING_APPROVAL',
        remarks: body?.remarks || null,
        evidence_reference: body?.evidence_reference || null,
        prepared_by: preparedBy,
      });
    }
    if (!rows.length) throw new BadRequestException('No valid KPI values were provided');

    for (const row of rows) {
      const { data: existing, error: existingError } = await this.supabase
        .from('employee_kpi_reviews')
        .select('id,status')
        .eq('tenant_id', tenantId).eq('employee_id', employeeId)
        .eq('kpi_definition_id', row.kpi_definition_id)
        .eq('period_start', start).eq('period_end', end)
        .in('status', ['DRAFT', 'PENDING_APPROVAL']).maybeSingle();
      if (existingError) throw new Error(existingError.message);
      if (existing?.id) {
        const { error } = await this.supabase.from('employee_kpi_reviews').update({ ...row, updated_at: new Date().toISOString() }).eq('id', existing.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await this.supabase.from('employee_kpi_reviews').insert(row);
        if (error) throw new Error(error.message);
      }
    }
    return { message: `${rows.length} KPI review record(s) submitted for approval`, count: rows.length };
  }

  async approveKpiReview(tenantId: string, employeeId: string, reviewId: string, body: any, user: any) {
    const status = body?.approved === false ? 'REJECTED' : 'APPROVED';
    const { data, error } = await this.supabase.from('employee_kpi_reviews')
      .update({ status, approved_by: user?.userId || user?.id || null, approved_at: new Date().toISOString(), approval_comment: body?.comment || null, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId).eq('employee_id', employeeId).eq('id', reviewId).eq('status', 'PENDING_APPROVAL').select();
    if (error) throw new Error(error.message);
    if (!data?.length) throw new BadRequestException('Only pending KPI reviews can be approved or rejected');
    return data[0];
  }

  // Attendance with Geo-tagging
  async getAttendanceForUser(user: any, month: string, employeeId?: string, fromDate?: string, toDate?: string) {
    const tenantId = String(user?.tenantId || '').trim();
    const canViewAll = hasAdminBypass(user) || hasPermission(user, 'hr:read') || hasPermission(user, 'hr:view');
    if (canViewAll) {
      return this.getAttendance(tenantId, month, employeeId, fromDate, toDate);
    }

    const employee = await this.getEmployeeByUserId(tenantId, String(user?.userId || user?.id || '').trim());
    if (!employee?.id) return [];
    return this.getAttendance(tenantId, month, String(employee.id), fromDate, toDate);
  }

  async getAttendance(tenantId: string, month: string, employeeId?: string, fromDate?: string, toDate?: string) {
    const monthRange = monthToRange(month);
    const start = isNonEmptyString(fromDate) ? fromDate.slice(0, 10) : monthRange.start;
    const end = isNonEmptyString(toDate) ? toDate.slice(0, 10) : monthRange.end;
    let query = this.supabase
      .from('attendance')
      .select('*')
      .eq('tenant_id', tenantId)
      .gte('attendance_date', start)
      .lte('attendance_date', end);

    if (employeeId) {
      query = query.eq('employee_id', employeeId);
    }

    const { data, error } = await query.order('attendance_date', { ascending: false });
    if (error) throw new Error(error.message);

    const rows = data || [];
    const employeeIds = Array.from(new Set(rows.map((row: any) => String(row?.employee_id || '').trim()).filter(Boolean)));
    if (employeeIds.length === 0) return rows;

    const attendanceIds = rows.map((row: any) => row.id).filter(Boolean);
    const { data: punchRows } = attendanceIds.length
      ? await this.supabase.from('attendance_punches').select('id, attendance_id, user_id, employee_id, punch_type, punch_at, lat, lng, accuracy, location, notes, is_outside_zone').in('attendance_id', attendanceIds).order('punch_at', { ascending: true })
      : { data: [] as any[] };
    const punchesByAttendance = new Map<string, any[]>();
    (punchRows || []).forEach((punch: any) => { const key = String(punch.attendance_id); punchesByAttendance.set(key, [...(punchesByAttendance.get(key) || []), punch]); });

    const { data: employees } = await this.supabase
      .from('employees')
      .select('id, employee_code, employee_name, email')
      .eq('tenant_id', tenantId)
      .in('id', employeeIds);

    const employeesById = new Map((employees || []).map((employee: any) => [String(employee.id), employee]));
    return rows.map((row: any) => {
      const employee = employeesById.get(String(row?.employee_id || ''));
      return {
        ...row,
        employee_name: row.employee_name || employee?.employee_name || null,
        employee_code: row.employee_code || employee?.employee_code || null,
        employee_email: row.employee_email || employee?.email || null,
        user: employee ? { employee_code: employee.employee_code, employee_name: employee.employee_name, email: employee.email } : null,
        punches: punchesByAttendance.get(String(row.id)) || [],
      };
    });
  }

  async getMyAttendance(userId: string, month: string) {
    const { start, end } = monthToRange(month);
    const { data, error } = await this.supabase
      .from('attendance')
      .select('*')
      .eq('user_id', userId)
      .gte('attendance_date', start)
      .lte('attendance_date', end)
      .order('attendance_date', { ascending: false });
    if (error) throw new Error(error.message);
    const rows = data || [];
    const ids = rows.map((row: any) => row.id).filter(Boolean);
    if (!ids.length) return rows;
    const { data: punches } = await this.supabase.from('attendance_punches').select('id, attendance_id, punch_type, punch_at, lat, lng, accuracy, location, notes, is_outside_zone').in('attendance_id', ids).order('punch_at', { ascending: true });
    const byAttendance = new Map<string, any[]>();
    (punches || []).forEach((punch: any) => { const key = String(punch.attendance_id); byAttendance.set(key, [...(byAttendance.get(key) || []), punch]); });
    return rows.map((row: any) => ({ ...row, punches: byAttendance.get(String(row.id)) || [] }));
  }

  async getTodayAttendance(userId: string) {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await this.supabase
      .from('attendance')
      .select('*')
      .eq('user_id', userId)
      .eq('attendance_date', today)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    if (!data) return null;
    const { data: punches, error: punchesError } = await this.supabase
      .from('attendance_punches')
      .select('*')
      .eq('attendance_id', data.id)
      .order('punch_at', { ascending: true });
    // Older databases remain readable while the one-time migration is being deployed.
    const attendancePunches = punchesError ? [] : [...(punches || [])];
    // Attendance created before movement punches were introduced may have a
    // valid header check-in followed by an OUT punch but no stored opening IN.
    // Restore that opening event in the response so return/end-day state and
    // worked-hours calculations remain correct without rewriting history.
    if (data.check_in_time && attendancePunches[0]?.punch_type !== 'IN') {
      attendancePunches.unshift({
        id: `attendance-check-in-${data.id}`,
        attendance_id: data.id,
        user_id: data.user_id,
        employee_id: data.employee_id,
        punch_type: 'IN',
        punch_at: data.check_in_time,
        lat: data.check_in_lat ?? null,
        lng: data.check_in_lng ?? null,
        location: data.check_in_location ?? null,
        notes: data.check_in_notes ?? null,
        is_outside_zone: data.is_outside_zone === true,
        synthetic: true,
      });
    }
    return { ...data, punches: attendancePunches };
  }

  private async addAttendancePunch(attendance: any, type: 'IN' | 'OUT', data: any) {
    const payload = {
      tenant_id: attendance.tenant_id,
      attendance_id: attendance.id,
      user_id: attendance.user_id,
      employee_id: attendance.employee_id,
      punch_type: type,
      punch_at: new Date().toISOString(),
      lat: data.lat ?? null,
      lng: data.lng ?? null,
      accuracy: data.accuracy ?? null,
      location: data.location ?? null,
      notes: data.notes ?? null,
      is_outside_zone: data.isOutsideZone === true,
    };
    const { data: result, error } = await this.supabase.from('attendance_punches').insert(payload).select().single();
    if (error) throw new Error(`Unable to record attendance movement: ${error.message}`);
    return result;
  }

  private workHoursFromPunches(punches: any[]) {
    let startedAt: Date | null = null;
    let milliseconds = 0;
    for (const punch of punches || []) {
      if (punch.punch_type === 'IN') startedAt = new Date(punch.punch_at);
      if (punch.punch_type === 'OUT' && startedAt) {
        milliseconds += Math.max(0, new Date(punch.punch_at).getTime() - startedAt.getTime());
        startedAt = null;
      }
    }
    // Lunch is granted a one-hour allowance; only excess lunch time is
    // deducted. Other outing reasons remain fully excluded from in-office
    // hours. The allowance is applied when an OUT punch is followed by IN.
    let lunchAllowanceMs = 0;
    for (let i = 0; i < (punches || []).length - 1; i += 1) {
      const out = punches[i];
      const back = punches[i + 1];
      if (out?.punch_type === 'OUT' && back?.punch_type === 'IN' && String(out.notes || '').toLowerCase().includes('lunch')) {
        lunchAllowanceMs += Math.min(3_600_000, Math.max(0, new Date(back.punch_at).getTime() - new Date(out.punch_at).getTime()));
      }
    }
    return Math.round(((milliseconds + lunchAllowanceMs) / 3_600_000) * 100) / 100;
  }

  async checkIn(tenantId: string, userId: string, employeeId: string, data: {
    lat?: number;
    lng?: number;
    accuracy?: number | null;
    location?: string;
    photoUrl?: string;
    notes?: string;
    isOutsideZone?: boolean;
    outsideZoneReason?: string;
  }, options: { skipOutsideEvidence?: boolean } = {}) {
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    const outsideZone = data.isOutsideZone === true || isOutsideOfficeGeofence(data.lat, data.lng, data.accuracy);
    const requiresOutsideEvidence = outsideZone && !options.skipOutsideEvidence;

    if (requiresOutsideEvidence && !isNonEmptyString(data.photoUrl)) {
      throw new BadRequestException('Selfie/photo is required when checking in outside the office geofence');
    }

    if (requiresOutsideEvidence && !isNonEmptyString(data.outsideZoneReason) && !isNonEmptyString(data.notes)) {
      throw new BadRequestException('Reason is required when checking in outside the office geofence');
    }
    
    // Check if already checked in today
    const existing = await this.getTodayAttendance(userId);
    if (existing && existing.check_in_time) {
      throw new Error('Already checked in today');
    }

    const payload: any = {
      tenant_id: tenantId,
      user_id: userId,
      employee_id: employeeId,
      attendance_date: today,
      check_in_time: now,
      check_in_lat: data.lat,
      check_in_lng: data.lng,
      check_in_location: data.location,
      check_in_photo_url: data.photoUrl,
      check_in_notes: data.notes,
      is_outside_zone: outsideZone,
      outside_zone_reason: outsideZone ? (data.outsideZoneReason || data.notes) : null,
      status: 'PRESENT',
    };

    if (existing) {
      // Update existing record
      const { data: result, error } = await this.supabase
        .from('attendance')
        .update(payload)
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      await this.addAttendancePunch(result, 'IN', data);
      return this.getTodayAttendance(userId);
    } else {
      // Create new record
      const { data: result, error } = await this.supabase
        .from('attendance')
        .insert([payload])
        .select()
        .single();
      if (error) throw new Error(error.message);
      await this.addAttendancePunch(result, 'IN', data);
      return this.getTodayAttendance(userId);
    }
  }

  async checkOut(userId: string, data: {
    lat?: number;
    lng?: number;
    accuracy?: number | null;
    location?: string;
    photoUrl?: string;
    notes?: string;
    isOutsideZone?: boolean;
    endDay?: boolean;
  }, options: { skipOutsideEvidence?: boolean } = {}) {
    const outsideZone = data.isOutsideZone === true || isOutsideOfficeGeofence(data.lat, data.lng, data.accuracy);
    if (outsideZone && !options.skipOutsideEvidence && !isNonEmptyString(data.photoUrl)) {
      throw new BadRequestException('Selfie/photo is required when checking out outside the office geofence');
    }

    const existing = await this.getTodayAttendance(userId);
    if (!existing || !existing.check_in_time) {
      throw new Error('Not checked in yet');
    }
    if (existing.check_out_time) {
      throw new Error('Already checked out today');
    }

    const punches = Array.isArray((existing as any).punches) ? (existing as any).punches : [];
    const lastPunch = punches[punches.length - 1];
    if (lastPunch?.punch_type === 'OUT') throw new Error('You are already marked out. Use Return to Office when you come back.');

    const now = new Date();
    const endDay = data.endDay === true;
    const temporaryPunch = { punch_type: 'OUT', punch_at: now.toISOString() };
    const workHours = this.workHoursFromPunches([...punches, temporaryPunch]);

    if (!endDay) {
      await this.addAttendancePunch(existing, 'OUT', data);
      const { error } = await this.supabase.from('attendance').update({ work_hours: workHours.toFixed(2) }).eq('id', existing.id);
      if (error) throw new Error(error.message);
      return this.getTodayAttendance(userId);
    }

    const payload = {
      check_out_time: now.toISOString(),
      check_out_lat: data.lat,
      check_out_lng: data.lng,
      check_out_location: data.location,
      check_out_photo_url: isNonEmptyString(data.photoUrl) ? data.photoUrl : existing.check_out_photo_url,
      check_out_notes: data.notes,
      is_outside_zone: outsideZone || existing.is_outside_zone === true,
      outside_zone_reason: isNonEmptyString(data.notes) ? data.notes : existing.outside_zone_reason,
      work_hours: workHours.toFixed(2),
    };

    const { data: result, error } = await this.supabase
      .from('attendance')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    await this.addAttendancePunch(result, 'OUT', data);
    return this.getTodayAttendance(userId);
  }

  async returnToOffice(userId: string, data: { lat?: number; lng?: number; accuracy?: number | null; location?: string; notes?: string; isOutsideZone?: boolean }) {
    const existing = await this.getTodayAttendance(userId);
    if (!existing?.check_in_time || existing.check_out_time) throw new Error('Start a new day before returning to office.');
    const punches = Array.isArray((existing as any).punches) ? (existing as any).punches : [];
    if (punches[punches.length - 1]?.punch_type !== 'OUT') throw new Error('You are already marked in the office.');
    await this.addAttendancePunch(existing, 'IN', data);
    return this.getTodayAttendance(userId);
  }
}
