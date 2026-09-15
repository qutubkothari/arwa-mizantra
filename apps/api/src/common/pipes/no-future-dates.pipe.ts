import { BadRequestException, Injectable, PipeTransform } from "@nestjs/common";

type UnknownRecord = Record<string, unknown>;

const isPlainObject = (value: unknown): value is UnknownRecord => {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Accept common ISO-8601 datetime strings (with optional seconds/millis and timezone)
const ISO_DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/;

const getTodayUtcDateOnly = (now: Date = new Date()): string => {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// Fields that are allowed to have future dates (e.g., planning/expected dates)
const FUTURE_ALLOWED_FIELDS = new Set([
  "requiredDate",
  "required_date",
  "requiredBy",
  "required_by",
  "followUpDate",
  "follow_up_date",
  "responseDate",
  "response_date",
  "expectedDelivery",
  "expectedDeliveryDate",
  "expected_delivery_date",
  "promisedDate",
  "promised_date",
  "deliveryDate",
  "delivery_date",
  "estimatedDeliveryDate",
  "estimated_delivery_date",
  "responseDeadline",
  "response_deadline",
  "dueDate",
  "due_date",
  "dueBy",
  "due_by",
  "plannedDate",
  "planned_date",
  "plannedStart",
  "planned_start",
  "plannedEnd",
  "planned_end",
  "targetDate",
  "target_date",
  "expectedDate",
  "expected_date",
  "expectedCompletionDate",
  "expected_completion_date",
  "committedDeliveryDate",
  "committed_delivery_date",
  "scheduledDate",
  "scheduled_date",
  "scheduledStartDate",
  "scheduled_start_date",
  "scheduledEndDate",
  "scheduled_end_date",
  // FSM visit appointments are intentionally scheduled in the future.
  "scheduledStart",
  "scheduled_start",
  "scheduledEnd",
  "scheduled_end",
  // CRM commitments are intentionally forward-looking planning dates.
  "expectedCloseDate",
  "expected_close_date",
  "nextFollowUpAt",
  "next_follow_up_at",
  "scheduledAt",
  "scheduled_at",
  "nextActionAt",
  "next_action_at",
  // A planning freeze horizon is a forward-looking control boundary, not a transaction date.
  "freezeHorizonDate",
  "freeze_horizon_date",
  // Customer commercial planning controls.
  "renewalDate",
  "renewal_date",
  "scheduledFor",
  "scheduled_for",
  // Commercial validity/expiry dates describe a future planning boundary;
  // they are not accounting or posting dates.
  "validUntil",
  "valid_until",
  // Contract and warranty boundaries are validity windows, not posting dates.
  "startDate",
  "start_date",
  "endDate",
  "end_date",
  "warrantyUntil",
  "warranty_until",
]);

const assertNoFutureDateString = (value: string, path: string) => {
  const trimmed = value.trim();
  if (!trimmed) return;

  // Extract the field name from the path (e.g., "requiredDate" from "body.requiredDate")
  const fieldName = path.split(".").pop() || "";

  // Skip validation if this field is allowed to have future dates
  if (FUTURE_ALLOWED_FIELDS.has(fieldName)) {
    return;
  }

  if (DATE_ONLY_RE.test(trimmed)) {
    // Compare lexicographically since YYYY-MM-DD sorts naturally.
    const todayUtc = getTodayUtcDateOnly();
    if (trimmed > todayUtc) {
      throw new BadRequestException(
        `Future dates are not allowed. Field "${path}" has value "${trimmed}" (today is ${todayUtc}).`,
      );
    }
    return;
  }

  if (ISO_DATETIME_RE.test(trimmed)) {
    const parsed = Date.parse(trimmed);
    if (!Number.isFinite(parsed)) return;

    const now = Date.now();
    if (parsed > now) {
      throw new BadRequestException(
        `Future dates are not allowed. Field "${path}" has value "${trimmed}" which is later than now.`,
      );
    }
  }
};

const walk = (value: unknown, path: string) => {
  if (typeof value === "string") {
    assertNoFutureDateString(value, path);
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walk(value[i], `${path}[${i}]`);
    }
    return;
  }

  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      walk(child, path ? `${path}.${key}` : key);
    }
  }
};

@Injectable()
export class NoFutureDatesPipe implements PipeTransform {
  transform(value: unknown) {
    // This pipe is applied globally (body + query), so handle primitives safely.
    walk(value, "");
    return value;
  }
}
