import { BadRequestException, Injectable } from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type MrpBuildReadiness = {
  ready: boolean;
  status: "READY" | "BLOCKED";
  reason: string | null;
  required_date: string | null;
  start_date: string;
  required_capacity_minutes: number;
  available_capacity_minutes: number;
  committed_capacity_minutes: number;
  remaining_capacity_minutes: number;
  work_centres: Array<{
    work_station_id: string;
    operation_count: number;
    required_minutes: number;
    available_minutes: number;
    committed_minutes: number;
    remaining_minutes: number;
    status: "AVAILABLE" | "INSUFFICIENT" | "UNCONFIGURED";
  }>;
  checks: string[];
};

@Injectable()
export class MrpReleaseReadinessService {
  private readonly db: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );

  private number(value: unknown) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private blocked(
    reason: string,
    startDate: string,
    requiredDate: string | null,
    checks: string[],
  ): MrpBuildReadiness {
    return {
      ready: false,
      status: "BLOCKED",
      reason,
      required_date: requiredDate,
      start_date: startDate,
      required_capacity_minutes: 0,
      available_capacity_minutes: 0,
      committed_capacity_minutes: 0,
      remaining_capacity_minutes: 0,
      work_centres: [],
      checks,
    };
  }

  async assessBuild(
    tenantId: string,
    entry: {
      line: any;
      quantity: number;
      start_date: string;
      required_date: string;
    },
  ): Promise<MrpBuildReadiness> {
    const rawRequiredDate = String(
      entry.line.planner_decision?.adjusted_required_by_date ||
        entry.line.required_by_date ||
        "",
    ).slice(0, 10);
    if (!rawRequiredDate) {
      return this.blocked(
        "A customer or production required date is missing.",
        entry.start_date,
        null,
        ["REQUIRED_DATE_MISSING"],
      );
    }

    const bomResult = await this.db
      .from("bom_headers")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("item_id", entry.line.item_id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (bomResult.error) throw new BadRequestException(bomResult.error.message);
    if (!bomResult.data) {
      return this.blocked(
        "An active BOM is required before releasing a BUILD recommendation.",
        entry.start_date,
        rawRequiredDate,
        ["ACTIVE_BOM_MISSING"],
      );
    }

    const routingResult = await this.db
      .from("production_routing")
      .select(
        "id,work_station_id,sequence_no,operation_name,setup_time_minutes,cycle_time_minutes,estimated_duration_hours",
      )
      .eq("tenant_id", tenantId)
      .eq("bom_id", bomResult.data.id)
      .order("sequence_no");
    if (routingResult.error)
      throw new BadRequestException(routingResult.error.message);
    const routings = (routingResult.data || []).filter(
      (routing: any) => routing.work_station_id,
    );
    if (!routings.length) {
      return this.blocked(
        "At least one routed operation with a work centre is required before release.",
        entry.start_date,
        rawRequiredDate,
        ["ROUTING_OR_WORK_CENTRE_MISSING"],
      );
    }

    const preferred = String(
      entry.line.planner_decision?.preferred_work_centre_id || "",
    );
    const routingStations = new Set(
      routings.map((routing: any) => String(routing.work_station_id)),
    );
    if (preferred && !routingStations.has(preferred)) {
      return this.blocked(
        "The preferred work centre is not an approved resource on the active routing.",
        entry.start_date,
        rawRequiredDate,
        ["PREFERRED_WORK_CENTRE_NOT_ROUTED"],
      );
    }

    const requirements = new Map<
      string,
      { required: number; operations: number }
    >();
    for (const routing of routings) {
      const stationId = String(routing.work_station_id);
      const setup = this.number(routing.setup_time_minutes);
      const cycle = this.number(routing.cycle_time_minutes);
      const fallback = this.number(routing.estimated_duration_hours) * 60;
      const required = setup + (cycle > 0 ? cycle * entry.quantity : fallback);
      const current = requirements.get(stationId) || {
        required: 0,
        operations: 0,
      };
      current.required += required;
      current.operations += 1;
      requirements.set(stationId, current);
    }
    const requiredCapacity = Array.from(requirements.values()).reduce(
      (sum, value) => sum + value.required,
      0,
    );
    if (requiredCapacity <= 0) {
      return this.blocked(
        "Routing time standards are missing; capacity cannot be validated.",
        entry.start_date,
        rawRequiredDate,
        ["ROUTING_TIME_STANDARD_MISSING"],
      );
    }

    const stationIds = Array.from(requirements.keys());
    const horizonEnd = new Date(`${rawRequiredDate}T00:00:00Z`);
    horizonEnd.setUTCDate(horizonEnd.getUTCDate() + 1);
    const [slotResult, scheduleResult] = await Promise.all([
      this.db
        .from("production_capacity_slots")
        .select(
          "work_station_id,work_date,available_minutes,planned_minutes,status",
        )
        .eq("tenant_id", tenantId)
        .in("work_station_id", stationIds)
        .gte("work_date", entry.start_date)
        .lte("work_date", rawRequiredDate),
      this.db
        .from("production_schedule_operations")
        .select(
          "work_station_id,planned_minutes,status,planned_start,planned_end",
        )
        .eq("tenant_id", tenantId)
        .in("work_station_id", stationIds)
        .in("status", ["PLANNED", "RELEASED", "IN_PROGRESS", "BLOCKED"])
        .lt("planned_start", horizonEnd.toISOString())
        .gt("planned_end", `${entry.start_date}T00:00:00.000Z`),
    ]);
    if (slotResult.error)
      throw new BadRequestException(slotResult.error.message);
    if (scheduleResult.error)
      throw new BadRequestException(scheduleResult.error.message);

    const workCentres = stationIds.map((stationId) => {
      const requirement = requirements.get(stationId)!;
      const slots = (slotResult.data || []).filter(
        (slot: any) => String(slot.work_station_id) === stationId,
      );
      const schedules = (scheduleResult.data || []).filter(
        (schedule: any) => String(schedule.work_station_id) === stationId,
      );
      const available = slots.reduce(
        (sum: number, slot: any) => sum + this.number(slot.available_minutes),
        0,
      );
      const slotCommitted = slots.reduce(
        (sum: number, slot: any) => sum + this.number(slot.planned_minutes),
        0,
      );
      const scheduleCommitted = schedules.reduce(
        (sum: number, schedule: any) =>
          sum + this.number(schedule.planned_minutes),
        0,
      );
      const committed = Math.max(slotCommitted, scheduleCommitted);
      const remaining = Math.max(0, available - committed);
      const status =
        available <= 0
          ? "UNCONFIGURED"
          : requirement.required > remaining
            ? "INSUFFICIENT"
            : "AVAILABLE";
      return {
        work_station_id: stationId,
        operation_count: requirement.operations,
        required_minutes: Number(requirement.required.toFixed(2)),
        available_minutes: Number(available.toFixed(2)),
        committed_minutes: Number(committed.toFixed(2)),
        remaining_minutes: Number(remaining.toFixed(2)),
        status,
      } as MrpBuildReadiness["work_centres"][number];
    });
    const unconfigured = workCentres.filter(
      (centre) => centre.status === "UNCONFIGURED",
    );
    const insufficient = workCentres.filter(
      (centre) => centre.status === "INSUFFICIENT",
    );
    const reason = unconfigured.length
      ? "Finite-capacity slots are not configured for every routed work centre and required-date horizon."
      : insufficient.length
        ? "Available work-centre capacity is insufficient before the required date."
        : null;
    return {
      ready: !reason,
      status: reason ? "BLOCKED" : "READY",
      reason,
      required_date: rawRequiredDate,
      start_date: entry.start_date,
      required_capacity_minutes: Number(requiredCapacity.toFixed(2)),
      available_capacity_minutes: Number(
        workCentres
          .reduce((sum, centre) => sum + centre.available_minutes, 0)
          .toFixed(2),
      ),
      committed_capacity_minutes: Number(
        workCentres
          .reduce((sum, centre) => sum + centre.committed_minutes, 0)
          .toFixed(2),
      ),
      remaining_capacity_minutes: Number(
        workCentres
          .reduce((sum, centre) => sum + centre.remaining_minutes, 0)
          .toFixed(2),
      ),
      work_centres: workCentres,
      checks: [
        "REQUIRED_DATE_PRESENT",
        "ACTIVE_BOM_PRESENT",
        "ROUTING_PRESENT",
        preferred ? "PREFERRED_WORK_CENTRE_ROUTED" : "ROUTED_WORK_CENTRES_USED",
        reason ? "FINITE_CAPACITY_FAILED" : "FINITE_CAPACITY_PASSED",
      ],
    };
  }
}
