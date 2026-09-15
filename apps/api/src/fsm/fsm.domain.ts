import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash } from "crypto";

export type VisitStatus =
  | "PLANNED"
  | "EN_ROUTE"
  | "CHECKED_IN"
  | "REPORT_DRAFT"
  | "COMPLETED"
  | "CANCELLED"
  | "MISSED";

const NEXT: Record<VisitStatus, VisitStatus[]> = {
  PLANNED: ["EN_ROUTE", "CHECKED_IN", "CANCELLED", "MISSED"],
  EN_ROUTE: ["CHECKED_IN", "CANCELLED"],
  CHECKED_IN: ["REPORT_DRAFT", "COMPLETED"],
  REPORT_DRAFT: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  MISSED: ["REPORT_DRAFT"],
};

export function assertVisitTransition(from: VisitStatus, to: VisitStatus) {
  if (!NEXT[from]?.includes(to)) {
    throw new ConflictException(`Visit cannot move from ${from} to ${to}.`);
  }
}

export function payloadHash(value: unknown) {
  return createHash("sha256")
    .update(stableJson(value))
    .digest("hex");
}

function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function haversineMetres(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
) {
  const rad = (value: number) => (value * Math.PI) / 180;
  const dLat = rad(latitudeB - latitudeA);
  const dLon = rad(longitudeB - longitudeA);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(latitudeA)) *
      Math.cos(rad(latitudeB)) *
      Math.sin(dLon / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export type LocationPolicy = {
  radiusM: number;
  maxAgeSeconds: number;
  maxAccuracyM: number;
};

export function evaluateLocation(
  sample: any,
  site: any,
  policy: LocationPolicy,
) {
  if (!site || site.latitude == null || site.longitude == null) {
    return { status: "MISSING_SITE", distanceM: null };
  }
  const latitude = Number(sample?.latitude);
  const longitude = Number(sample?.longitude);
  const accuracyM = Number(sample?.accuracy_m);
  const capturedAt = new Date(sample?.captured_at || 0).getTime();
  if (![latitude, longitude, accuracyM, capturedAt].every(Number.isFinite)) {
    throw new BadRequestException("A valid location sample is required.");
  }
  const ageSeconds = Math.max(0, Math.round((Date.now() - capturedAt) / 1000));
  const distanceM = haversineMetres(
    latitude,
    longitude,
    Number(site.latitude),
    Number(site.longitude),
  );
  if (ageSeconds > policy.maxAgeSeconds)
    return { status: "STALE", distanceM, ageSeconds };
  if (accuracyM > policy.maxAccuracyM)
    return { status: "POOR_ACCURACY", distanceM, ageSeconds };
  if (distanceM > policy.radiusM + accuracyM)
    return { status: "OUTSIDE", distanceM, ageSeconds };
  return { status: "VERIFIED", distanceM, ageSeconds };
}

export function recommendationScore(input: {
  daysSinceVisit?: number;
  overdueAmount?: number;
  opportunityAmount?: number;
  priority?: number;
}) {
  const recency = Math.min(Math.max(Number(input.daysSinceVisit || 0), 0), 90) / 3;
  const receivable = Math.min(Math.max(Number(input.overdueAmount || 0), 0) / 10000, 30);
  const opportunity = Math.min(Math.max(Number(input.opportunityAmount || 0), 0) / 25000, 25);
  const priority = Math.min(Math.max(Number(input.priority || 0), 0), 15);
  const score = Math.round((recency + receivable + opportunity + priority) * 10) / 10;
  const reasons = [
    recency >= 10 ? "Customer has not been visited recently" : "",
    receivable >= 5 ? "Receivable follow-up is due" : "",
    opportunity >= 5 ? "Open commercial opportunity" : "",
    priority >= 5 ? "Manager/customer priority" : "",
  ].filter(Boolean);
  return { score, reasons: reasons.length ? reasons : ["Routine relationship coverage"] };
}

export function recurrenceDates(rule: any, from: string, to: string) {
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start)
    throw new BadRequestException("A valid recurrence date range is required.");
  const effectiveStart = new Date(Math.max(start.getTime(), new Date(`${rule.starts_on}T12:00:00Z`).getTime()));
  const effectiveEnd = rule.ends_on
    ? new Date(Math.min(end.getTime(), new Date(`${rule.ends_on}T12:00:00Z`).getTime()))
    : end;
  const interval = Number(rule.interval_days) || ({ WEEKLY: 7, FORTNIGHTLY: 14, MONTHLY: 30, QUARTERLY: 90 } as any)[rule.frequency] || 1;
  const dates: string[] = [];
  for (let cursor = new Date(effectiveStart); cursor <= effectiveEnd; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const sinceRuleStart = Math.floor((cursor.getTime() - new Date(`${rule.starts_on}T12:00:00Z`).getTime()) / 86400000);
    const weekdayMatches = rule.weekday == null || cursor.getUTCDay() === Number(rule.weekday);
    if (sinceRuleStart >= 0 && sinceRuleStart % interval === 0 && weekdayMatches)
      dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

