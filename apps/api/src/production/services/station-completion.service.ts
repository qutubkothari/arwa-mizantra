import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  operationQueuePosition,
  releasableUpstreamGood,
} from "./work-station.service";

export function normalizeCompletionQuantities(
  completed: unknown,
  rejected: unknown,
) {
  const good = Number(completed);
  const reject = Number(rejected || 0);
  if (
    !Number.isFinite(good) ||
    !Number.isFinite(reject) ||
    good < 0 ||
    reject < 0
  ) {
    throw new BadRequestException(
      "Completed and rejected quantities must be non-negative numbers",
    );
  }
  if (good + reject <= 0) {
    throw new BadRequestException(
      "At least one completed or rejected unit is required",
    );
  }
  return { good, reject, processed: good + reject };
}

export function normalizeReworkQuantity(value: unknown) {
  const rework = Number(value || 0);
  if (!Number.isFinite(rework) || rework < 0) {
    throw new BadRequestException(
      "Rework quantity must be a non-negative number",
    );
  }
  return rework;
}

export interface StationCompletion {
  id: string;
  tenant_id: string;
  production_order_id: string;
  routing_id: string;
  work_station_id: string;
  operator_id: string;
  quantity_completed: number;
  quantity_rejected: number;
  start_time: string;
  end_time: string | null;
  actual_time_minutes: number | null;
  paused_at?: string | null;
  total_paused_minutes?: number;
  pause_loss_category?: string | null;
  pause_reason?: string | null;
  pause_evidence_reference?: string | null;
  pause_source?: "MANUAL" | "IOT" | "SYSTEM" | null;
  notes: string | null;
  status: "IN_PROGRESS" | "COMPLETED" | "PAUSED";
  created_at: string;
  updated_at: string;
}

export interface StartOperationDto {
  production_order_id: string;
  routing_id: string;
  operator_id: string;
  work_station_id?: string;
  operation_dispatch_id?: string;
  notes?: string;
}

export interface CompleteOperationDto {
  quantity_completed: number;
  quantity_rejected?: number;
  rework_quantity?: number;
  actual_input_quantity?: number;
  actual_input_uom?: "KG" | "G";
  actual_scrap_quantity?: number;
  machine_strokes?: number;
  batch_count?: number;
  batch_number?: string;
  notes?: string;
}

export interface ChangeToolDto {
  assignment_id: string;
  replacement_tool_resource_id: string;
  actual_usage_value: number;
  reason: string;
  evidence_reference?: string;
}

export interface PauseOperationDto {
  loss_category: string;
  reason: string;
  evidence_reference?: string;
  source?: "MANUAL" | "IOT" | "SYSTEM";
}

const DOWNTIME_CATEGORIES = new Set([
  "BREAKDOWN",
  "ROLL_CHANGE",
  "MOLD_CHANGE",
  "CHANGEOVER",
  "POWER",
  "MATERIAL",
  "QUALITY",
  "LABOUR",
  "PLANNED",
  "MAINTENANCE",
  "OTHER",
]);

export function normalizeDowntimeReason(dto: PauseOperationDto) {
  const lossCategory = String(dto?.loss_category || "")
    .trim()
    .toUpperCase();
  const reason = String(dto?.reason || "").trim();
  const source = String(dto?.source || "MANUAL")
    .trim()
    .toUpperCase();
  if (!DOWNTIME_CATEGORIES.has(lossCategory))
    throw new BadRequestException("Select a valid downtime reason category");
  if (!reason)
    throw new BadRequestException("Downtime reason is required before pausing");
  if (!["MANUAL", "IOT", "SYSTEM"].includes(source))
    throw new BadRequestException("Invalid downtime event source");
  return { lossCategory, reason, source };
}

export function toolLifeUnit(basis: string) {
  return (
    {
      KG_INPUT: "KG",
      GOOD_PIECES: "PCS",
      TOTAL_PIECES: "PCS",
      STROKES: "STROKES",
      RUN_HOURS: "HOURS",
      BATCHES: "BATCHES",
    }[String(basis || "").toUpperCase()] || "STROKES"
  );
}

export function calculatedToolUsage(input: {
  basis: string;
  good: number;
  rejected: number;
  actualInputKg?: number | null;
  machineStrokes?: number | null;
  batchCount?: number | null;
  actualMinutes: number;
  cavities?: number | null;
}) {
  const basis = String(input.basis || "").toUpperCase();
  if (basis === "KG_INPUT") return Number(input.actualInputKg || 0);
  if (basis === "GOOD_PIECES") return Number(input.good || 0);
  if (basis === "TOTAL_PIECES")
    return Number(input.good || 0) + Number(input.rejected || 0);
  if (basis === "RUN_HOURS") return Number(input.actualMinutes || 0) / 60;
  if (basis === "BATCHES") return Number(input.batchCount || 0);
  return input.machineStrokes != null
    ? Number(input.machineStrokes)
    : Math.ceil(
        (Number(input.good || 0) + Number(input.rejected || 0)) /
          Math.max(1, Number(input.cavities || 1)),
      );
}

export function partialProductionSummary(input: {
  planned: unknown;
  priorGood: unknown;
  priorRejected: unknown;
  currentGood: unknown;
  currentRejected: unknown;
}) {
  const planned = Math.max(0, Number(input.planned || 0));
  const good = Math.max(
    0,
    Number(input.priorGood || 0) + Number(input.currentGood || 0),
  );
  const rejected = Math.max(
    0,
    Number(input.priorRejected || 0) + Number(input.currentRejected || 0),
  );
  const processed = good + rejected;
  return {
    planned_quantity: planned,
    good_quantity: good,
    rejected_quantity: rejected,
    processed_quantity: processed,
    remaining_quantity: Math.max(0, planned - good),
    is_partial: good < planned,
  };
}

export function allRoutingTargetsCompleted(
  routingIds: string[],
  completions: Array<{
    routing_id: string;
    quantity_completed: number | string;
    status: string;
  }>,
  orderQuantity: number | string,
) {
  const target = Number(orderQuantity || 0);
  return (
    target > 0 &&
    routingIds.every((routingId) =>
      completions
        .filter(
          (completion) =>
            String(completion.routing_id) === String(routingId) &&
            completion.status === "COMPLETED",
        )
        .reduce(
          (sum, completion) =>
            sum + Number(completion.quantity_completed || 0),
          0,
        ) >= target,
    )
  );
}

@Injectable()
export class StationCompletionService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_KEY!,
    );
  }

  private toolingUsable(tool: any, stationId: string) {
    const today = new Date().toISOString().slice(0, 10);
    if (String(tool?.status || "").toUpperCase() !== "AVAILABLE") return false;
    if (Number(tool?.available_quantity || 0) <= 0) return false;
    if (tool?.work_station_id && String(tool.work_station_id) !== stationId)
      return false;
    if (tool?.valid_until && String(tool.valid_until).slice(0, 10) < today)
      return false;
    if (
      tool?.life_limit_value != null &&
      Number(tool.life_used_value || 0) >= Number(tool.life_limit_value)
    )
      return false;
    if (
      tool?.calibration_required &&
      (String(tool.calibration_status).toUpperCase() !== "VALID" ||
        !tool.next_calibration_due ||
        String(tool.next_calibration_due).slice(0, 10) < today)
    )
      return false;
    return true;
  }

  private plannedToolUsage(tool: any, quantity: number, profile: any) {
    const basis = String(tool.life_basis || "STROKES").toUpperCase();
    if (basis === "KG_INPUT") {
      const consumption = Number(profile?.consumption_per_unit || 0);
      return consumption
        ? quantity *
            consumption *
            (profile?.consumption_uom === "G" ? 0.001 : 1)
        : null;
    }
    if (basis === "GOOD_PIECES" || basis === "TOTAL_PIECES") return quantity;
    if (basis === "STROKES")
      return Math.ceil(quantity / Math.max(1, Number(profile?.cavities || 1)));
    if (basis === "RUN_HOURS") {
      const rate = Number(profile?.rate_value || 0);
      if (!rate) return null;
      const hourly =
        profile.rate_unit === "PCS_PER_MINUTE"
          ? rate * 60
          : profile.rate_unit === "SHOTS_PER_MINUTE"
            ? rate * 60 * Math.max(1, Number(profile.cavities || 1))
            : rate;
      return quantity / hourly;
    }
    return null;
  }

  private async enrichTooling(tenantId: string, completion: any) {
    const [{ data: assignments, error: ae }, { data: constraint, error: ce }] =
      await Promise.all([
        this.supabase
          .from("production_tool_assignments")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("station_completion_id", completion.id)
          .order("installed_at", { ascending: true }),
        this.supabase
          .from("production_routing_constraints")
          .select("required_tool_codes")
          .eq("tenant_id", tenantId)
          .eq("routing_id", completion.routing_id)
          .maybeSingle(),
      ]);
    if (ae || ce)
      throw new BadRequestException(
        ae?.message || ce?.message || "Unable to load operation tooling",
      );
    const codes = Array.isArray(constraint?.required_tool_codes)
      ? constraint.required_tool_codes
      : [];
    const { data: tools, error: te } = codes.length
      ? await this.supabase
          .from("production_tool_resources")
          .select("*")
          .eq("tenant_id", tenantId)
          .in("tool_code", codes)
      : ({ data: [], error: null } as any);
    if (te) throw new BadRequestException(te.message);
    const candidateIds = (tools || []).map((x: any) => x.id);
    const { data: activeToolAllocations, error: allocationError } =
      candidateIds.length
        ? await this.supabase
            .from("production_tool_assignments")
            .select("tool_resource_id")
            .eq("tenant_id", tenantId)
            .eq("status", "IN_USE")
            .in("tool_resource_id", candidateIds)
        : ({ data: [], error: null } as any);
    if (allocationError) throw new BadRequestException(allocationError.message);
    const allocations = new Map<string, number>();
    for (const assignment of activeToolAllocations || []) {
      const key = String(assignment.tool_resource_id);
      allocations.set(key, (allocations.get(key) || 0) + 1);
    }
    const ids = (assignments || []).map((x: any) => x.tool_resource_id);
    const assignedTools = ids.length
      ? await this.supabase
          .from("production_tool_resources")
          .select("*")
          .eq("tenant_id", tenantId)
          .in("id", ids)
      : ({ data: [], error: null } as any);
    if (assignedTools.error)
      throw new BadRequestException(assignedTools.error.message);
    const toolMap = new Map(
      (assignedTools.data || []).map((x: any) => [String(x.id), x]),
    );
    const enriched = {
      ...completion,
      required_tool_codes: codes,
      tool_assignments: (assignments || []).map((x: any) => ({
        ...x,
        tool_resource: toolMap.get(String(x.tool_resource_id)) || null,
      })),
      tooling_candidates: (tools || []).map((tool: any) => ({
        ...tool,
        available_slots: Math.max(
          0,
          Number(tool.available_quantity || 0) -
            (allocations.get(String(tool.id)) || 0),
        ),
      })),
    };
    return this.enrichOperationContext(tenantId, enriched);
  }

  private async enrichOperationContext(tenantId: string, completion: any) {
    const [orderResult, routingResult, stationResult, completionResult] =
      await Promise.all([
        this.supabase
          .from("production_orders")
          .select("id,order_number,job_order_id,item_id,bom_id,quantity")
          .eq("tenant_id", tenantId)
          .eq("id", completion.production_order_id)
          .maybeSingle(),
        this.supabase
          .from("production_routing")
          .select("id,operation_name,sequence_no,bom_id")
          .eq("tenant_id", tenantId)
          .eq("id", completion.routing_id)
          .maybeSingle(),
        this.supabase
          .from("work_stations")
          .select("id,station_code,station_name,station_type")
          .eq("tenant_id", tenantId)
          .eq("id", completion.work_station_id)
          .maybeSingle(),
        this.supabase
          .from("station_completions")
          .select("routing_id,quantity_completed,quantity_rejected,status")
          .eq("tenant_id", tenantId)
          .eq("production_order_id", completion.production_order_id)
          .eq("status", "COMPLETED"),
      ]);
    const order: any = orderResult.data;
    const routing: any = routingResult.data;
    const station: any = stationResult.data;
    const completedRows: any[] = completionResult.data || [];
    if (!order || !routing)
      return {
        ...completion,
        work_station_code: station?.station_code || null,
        work_station_name: station?.station_name || null,
        work_station_type: station?.station_type || null,
      };

    const [itemResult, jobResult, previousResult, policyResult] =
      await Promise.all([
        this.supabase
          .from("items")
          .select("id,code,name,uom")
          .eq("tenant_id", tenantId)
          .eq("id", order.item_id)
          .maybeSingle(),
        order.job_order_id
          ? this.supabase
              .from("job_orders")
              .select("id,job_order_number")
              .eq("tenant_id", tenantId)
              .eq("id", order.job_order_id)
              .maybeSingle()
          : Promise.resolve({ data: null } as any),
        this.supabase
          .from("production_routing")
          .select("id,sequence_no")
          .eq("tenant_id", tenantId)
          .eq("bom_id", order.bom_id)
          .lt("sequence_no", routing.sequence_no)
          .order("sequence_no", { ascending: false })
          .limit(1),
        this.supabase
          .from("production_stage_policies")
          .select(
            "execution_mode,predecessor_routing_ids,transfer_batch_quantity,overlap_percent",
          )
          .eq("tenant_id", tenantId)
          .eq("routing_id", routing.id)
          .maybeSingle(),
      ]);
    const policy: any = policyResult.data || {};
    const explicitPredecessors = Array.isArray(policy.predecessor_routing_ids)
      ? policy.predecessor_routing_ids.map(String)
      : [];
    const predecessorIds: string[] = explicitPredecessors.length
      ? explicitPredecessors
      : String(policy.execution_mode || "SEQUENTIAL") === "PARALLEL"
        ? []
        : previousResult.data?.[0]
          ? [String(previousResult.data[0].id)]
          : [];
    const currentRows = completedRows.filter(
      (row) => String(row.routing_id) === String(routing.id),
    );
    const completedGood = currentRows.reduce(
      (sum, row) => sum + Number(row.quantity_completed || 0),
      0,
    );
    const processed = currentRows.reduce(
      (sum, row) =>
        sum +
        Number(row.quantity_completed || 0) +
        Number(row.quantity_rejected || 0),
      0,
    );
    const predecessorGood = predecessorIds.map((routingId) =>
      completedRows
        .filter((row) => String(row.routing_id) === routingId)
        .reduce(
          (sum, row) => sum + Number(row.quantity_completed || 0),
          0,
        ),
    );
    const rawUpstreamGood = predecessorGood.length
      ? Math.min(...predecessorGood)
      : undefined;
    const threshold =
      Number(policy.transfer_batch_quantity || 0) ||
      (Number(policy.overlap_percent || 0) > 0
        ? (Number(order.quantity || 0) * Number(policy.overlap_percent)) / 100
        : Number(order.quantity || 0));
    const upstreamGood = releasableUpstreamGood(
      policy.execution_mode,
      rawUpstreamGood,
      threshold,
    );
    const position = operationQueuePosition(
      Number(order.quantity || 0),
      completedGood,
      processed,
      upstreamGood,
    );
    const item: any = itemResult.data || {};
    const job: any = jobResult.data || {};
    return {
      ...completion,
      job_order_id: order.job_order_id || completion.job_order_id || null,
      job_order_number: job.job_order_number || order.order_number || null,
      production_order_number: order.order_number || null,
      item_code: item.code || null,
      item_name: item.name || null,
      uom: item.uom || "pcs",
      operation_name: routing.operation_name || null,
      sequence_no: routing.sequence_no,
      work_station_code: station?.station_code || null,
      work_station_name: station?.station_name || null,
      work_station_type: station?.station_type || null,
      planned_quantity: Number(order.quantity || 0),
      completed_before: Number(completedGood.toFixed(3)),
      quantity_remaining: position.target_remaining,
      input_available: position.input_available,
      quantity_to_produce: Math.min(
        position.target_remaining,
        position.input_available,
      ),
    };
  }

  /**
   * Start an operation at a workstation
   */
  async startOperation(tenantId: string, dto: StartOperationDto): Promise<any> {
    // Verify production order exists
    const { data: order, error: orderError } = await this.supabase
      .from("production_orders")
      .select("id,status,bom_id,quantity,job_order_id")
      .eq("tenant_id", tenantId)
      .eq("id", dto.production_order_id)
      .single();

    if (orderError || !order) {
      throw new NotFoundException(
        `Production order with ID ${dto.production_order_id} not found`,
      );
    }

    if (order.status !== "RELEASED" && order.status !== "IN_PROGRESS") {
      throw new BadRequestException(
        `Production order must be RELEASED or IN_PROGRESS to start operations`,
      );
    }

    // Verify routing exists
    const { data: routing, error: routingError } = await this.supabase
      .from("production_routing")
      .select("id,work_station_id,sequence_no,bom_id")
      .eq("tenant_id", tenantId)
      .eq("id", dto.routing_id)
      .single();

    if (routingError || !routing) {
      throw new NotFoundException(
        `Routing with ID ${dto.routing_id} not found`,
      );
    }
    if (String(routing.bom_id) !== String(order.bom_id)) {
      throw new BadRequestException(
        "The selected routing is not an operation on this production order BOM",
      );
    }
    const executionStationId = String(
      dto.work_station_id || routing.work_station_id,
    ).trim();
    if (executionStationId !== String(routing.work_station_id)) {
      const { data: alternative } = await this.supabase
        .from("production_resource_alternatives")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("routing_id", routing.id)
        .eq("work_station_id", executionStationId)
        .eq("is_active", true)
        .maybeSingle();
      if (!alternative)
        throw new BadRequestException(
          "The selected machine is not approved for this operation",
        );
    }
    const { data: station } = await this.supabase
      .from("work_stations")
      .select("id,is_active")
      .eq("tenant_id", tenantId)
      .eq("id", executionStationId)
      .maybeSingle();
    if (!station?.is_active) {
      throw new BadRequestException(
        "The work station is inactive or unavailable",
      );
    }

    // Check if operator already has an active operation
    const { data: activeOps } = await this.supabase
      .from("station_completions")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("operator_id", dto.operator_id)
      .in("status", ["IN_PROGRESS", "PAUSED"])
      .limit(1);

    if (activeOps && activeOps.length > 0) {
      throw new BadRequestException(
        "Operator already has an active operation. Please complete or pause it first.",
      );
    }

    // Check if there's already an active completion for this production order + routing
    const { data: existingCompletion } = await this.supabase
      .from("station_completions")
      .select("id, status")
      .eq("tenant_id", tenantId)
      .eq("production_order_id", dto.production_order_id)
      .eq("routing_id", dto.routing_id)
      .eq("work_station_id", executionStationId)
      .in("status", ["IN_PROGRESS", "PAUSED"])
      .limit(1);

    if (existingCompletion && existingCompletion.length > 0) {
      throw new BadRequestException(
        "This operation is already in progress by another operator",
      );
    }

    const { data: routeSteps, error: routeError } = await this.supabase
      .from("production_routing")
      .select("id,sequence_no")
      .eq("tenant_id", tenantId)
      .eq("bom_id", order.bom_id)
      .order("sequence_no", { ascending: true });
    if (routeError) throw new BadRequestException(routeError.message);
    const { data: stagePolicy } = await this.supabase
      .from("production_stage_policies")
      .select(
        "execution_mode,predecessor_routing_ids,transfer_batch_quantity,overlap_percent",
      )
      .eq("tenant_id", tenantId)
      .eq("routing_id", routing.id)
      .maybeSingle();
    const explicitPredecessors = Array.isArray(
      stagePolicy?.predecessor_routing_ids,
    )
      ? stagePolicy.predecessor_routing_ids.map(String)
      : [];
    const implicitPrevious = (routeSteps || [])
      .filter((step) => Number(step.sequence_no) < Number(routing.sequence_no))
      .sort((a, b) => Number(b.sequence_no) - Number(a.sequence_no))[0];
    const predecessorIds = explicitPredecessors.length
      ? explicitPredecessors
      : String(stagePolicy?.execution_mode || "SEQUENTIAL") === "PARALLEL"
        ? []
        : implicitPrevious
          ? [String(implicitPrevious.id)]
          : [];
    const relevantIds = [routing.id, ...predecessorIds].filter(Boolean);
    const { data: completedRows, error: completionError } = relevantIds.length
      ? await this.supabase
          .from("station_completions")
          .select("routing_id,quantity_completed,quantity_rejected,status")
          .eq("tenant_id", tenantId)
          .eq("production_order_id", dto.production_order_id)
          .in("routing_id", relevantIds)
          .eq("status", "COMPLETED")
      : ({ data: [], error: null } as any);
    if (completionError) throw new BadRequestException(completionError.message);
    const currentRows = (completedRows || []).filter(
      (row) => String(row.routing_id) === String(routing.id),
    );
    const currentGood = currentRows.reduce(
      (sum, row) => sum + Number(row.quantity_completed || 0),
      0,
    );
    const currentProcessed = currentRows.reduce(
      (sum, row) =>
        sum +
        Number(row.quantity_completed || 0) +
        Number(row.quantity_rejected || 0),
      0,
    );
    const predecessorGood = predecessorIds.map((predecessorId) =>
      (completedRows || [])
        .filter((row) => String(row.routing_id) === predecessorId)
        .reduce((sum, row) => sum + Number(row.quantity_completed || 0), 0),
    );
    const rawUpstreamGood = predecessorGood.length
      ? Math.min(...predecessorGood)
      : undefined;
    const mode = String(stagePolicy?.execution_mode || "SEQUENTIAL");
    const threshold =
      Number(stagePolicy?.transfer_batch_quantity || 0) ||
      (Number(stagePolicy?.overlap_percent || 0) > 0
        ? (Number(order.quantity) * Number(stagePolicy.overlap_percent)) / 100
        : Number(order.quantity));
    const upstreamGood = releasableUpstreamGood(
      mode,
      rawUpstreamGood,
      threshold,
    );
    const position = operationQueuePosition(
      Number(order.quantity),
      currentGood,
      currentProcessed,
      upstreamGood,
    );
    if (!position.ready) {
      throw new BadRequestException(
        predecessorIds.length
          ? "This operation is waiting for completed WIP from the previous operation"
          : "The planned quantity for this operation is already complete",
      );
    }

    let operationDispatch: any = null;
    if (dto.operation_dispatch_id) {
      const { data: dispatch, error: dispatchError } = await this.supabase
        .from("production_schedule_operations")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("id", dto.operation_dispatch_id)
        .single();
      if (dispatchError || !dispatch)
        throw new BadRequestException("The selected Job Card allocation was not found");
      let dispatchDetail: any = {};
      try { dispatchDetail = JSON.parse(String(dispatch.scheduling_note || "{}")); } catch {}
      if (
        String(dispatch.job_order_id) !== String(order.job_order_id) ||
        dispatchDetail.kind !== "JOB_CARD" ||
        String(dispatchDetail.routing_id) !== String(routing.id) ||
        String(dispatch.work_station_id) !== executionStationId
      )
        throw new BadRequestException(
          "The selected Job Card does not belong to this operation and machine",
        );
      if (!["PLANNED", "RELEASED"].includes(String(dispatch.status)))
        throw new BadRequestException("This Job Card is not available to start");
      if (
        dispatchDetail.assigned_operator_id &&
        String(dispatchDetail.assigned_operator_id) !== String(dto.operator_id)
      )
        throw new BadRequestException(
          `This Job Card is assigned to ${dispatchDetail.assigned_operator_name || "another operator"}`,
        );
      const marker = `[[JOB_CARD:${dispatch.id}]]`;
      const { data: priorExecutions } = await this.supabase
        .from("station_completions")
        .select("quantity_completed,quantity_rejected,status,notes")
        .eq("tenant_id", tenantId)
        .eq("job_order_id", order.job_order_id)
        .eq("status", "COMPLETED");
      const dispatchProcessed = (priorExecutions || [])
        .filter((entry: any) => String(entry.notes || "").includes(marker))
        .reduce(
          (sum: number, entry: any) =>
            sum + Number(entry.quantity_completed || 0) + Number(entry.quantity_rejected || 0),
          0,
        );
      const dispatchRemaining = Math.max(
        0,
        Number(dispatchDetail.assigned_quantity || 0) - dispatchProcessed,
      );
      if (dispatchRemaining <= 0)
        throw new BadRequestException("This Job Card allocation is already complete");
      operationDispatch = { ...dispatch, ...dispatchDetail, dispatchRemaining };
    }

    const { data: routingConstraint, error: constraintError } =
      await this.supabase
        .from("production_routing_constraints")
        .select("required_tool_codes")
        .eq("tenant_id", tenantId)
        .eq("routing_id", routing.id)
        .maybeSingle();
    if (constraintError) throw new BadRequestException(constraintError.message);
    const requiredToolCodes = Array.isArray(
      routingConstraint?.required_tool_codes,
    )
      ? routingConstraint.required_tool_codes
      : [];
    const [{ data: availableTools, error: toolError }, { data: profile }] =
      await Promise.all([
        requiredToolCodes.length
          ? this.supabase
              .from("production_tool_resources")
              .select("*")
              .eq("tenant_id", tenantId)
              .in("tool_code", requiredToolCodes)
          : Promise.resolve({ data: [], error: null } as any),
        this.supabase
          .from("production_process_resource_profiles")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("routing_id", routing.id)
          .eq("work_station_id", executionStationId)
          .maybeSingle(),
      ]);
    if (toolError) throw new BadRequestException(toolError.message);
    const candidateIds = (availableTools || []).map((x: any) => x.id);
    const { data: activeAssignments, error: allocationError } =
      candidateIds.length
        ? await this.supabase
            .from("production_tool_assignments")
            .select("tool_resource_id")
            .eq("tenant_id", tenantId)
            .eq("status", "IN_USE")
            .in("tool_resource_id", candidateIds)
        : ({ data: [], error: null } as any);
    if (allocationError) throw new BadRequestException(allocationError.message);
    const allocationCount = new Map<string, number>();
    for (const assignment of activeAssignments || []) {
      const key = String(assignment.tool_resource_id);
      allocationCount.set(key, (allocationCount.get(key) || 0) + 1);
    }
    const selectedTools: any[] = [];
    for (const requiredCode of requiredToolCodes) {
      const candidates = (availableTools || [])
        .filter(
          (tool: any) =>
            String(tool.tool_code).toUpperCase() ===
              String(requiredCode).toUpperCase() &&
            this.toolingUsable(tool, executionStationId) &&
            (allocationCount.get(String(tool.id)) || 0) <
              Number(tool.available_quantity || 0),
        )
        .sort((a: any, b: any) => {
          const stationFit =
            Number(Boolean(b.work_station_id)) -
            Number(Boolean(a.work_station_id));
          if (stationFit) return stationFit;
          const remaining = (tool: any) =>
            tool.life_limit_value == null
              ? Number.POSITIVE_INFINITY
              : Number(tool.life_limit_value) -
                Number(tool.life_used_value || 0);
          return remaining(b) - remaining(a);
        });
      if (!candidates.length)
        throw new BadRequestException(
          `Required tooling ${requiredCode} is unavailable, expired, exhausted, under maintenance or already allocated.`,
        );
      selectedTools.push(candidates[0]);
      const key = String(candidates[0].id);
      allocationCount.set(key, (allocationCount.get(key) || 0) + 1);
    }

    const startTime = new Date().toISOString();

    const { data: jobOperation, error: jobOperationError } =
      order.job_order_id
        ? await this.supabase
            .from("job_order_operations")
            .select("id")
            // job_order_operations is a child table and has no tenant_id.
            // Tenant isolation is already established above by loading the
            // production order with tenant_id, then scope the child lookup by
            // that verified Job Order plus its verified BOM routing.
            .eq("job_order_id", order.job_order_id)
            .eq("routing_id", routing.id)
            .maybeSingle()
        : ({ data: null, error: null } as any);
    if (jobOperationError) {
      throw new BadRequestException(
        `Unable to resolve the Job Order operation: ${jobOperationError.message}`,
      );
    }

    const { data, error } = await this.supabase
      .from("station_completions")
      .insert({
        tenant_id: tenantId,
        production_order_id: dto.production_order_id,
        routing_id: dto.routing_id,
        work_station_id: executionStationId,
        sequence_no: routing.sequence_no,
        operator_id: dto.operator_id,
        quantity_completed: 0,
        quantity_rejected: 0,
        start_time: startTime,
        end_time: null,
        actual_time_minutes: null,
        job_order_id: order.job_order_id || null,
        job_order_operation_id: jobOperation?.id || null,
        paused_at: null,
        total_paused_minutes: 0,
        notes: operationDispatch
          ? `[[JOB_CARD:${operationDispatch.id}]]${dto.notes ? ` ${dto.notes}` : ""}`
          : dto.notes || null,
        status: "IN_PROGRESS",
      })
      .select()
      .single();

    if (error) {
      throw new BadRequestException(
        `Failed to start operation: ${error.message}${error.details ? ` (${error.details})` : ""}`,
      );
    }

    if (operationDispatch) {
      await this.supabase
        .from("production_schedule_operations")
        .update({ status: "IN_PROGRESS" })
        .eq("tenant_id", tenantId)
        .eq("id", operationDispatch.id);
    }

    if (selectedTools.length) {
      const assignments = selectedTools.map((tool: any) => ({
        tenant_id: tenantId,
        station_completion_id: data.id,
        production_order_id: dto.production_order_id,
        routing_id: dto.routing_id,
        work_station_id: routing.work_station_id,
        tool_resource_id: tool.id,
        tool_code: tool.tool_code,
        life_basis: tool.life_basis || "STROKES",
        life_uom: tool.life_uom || toolLifeUnit(tool.life_basis),
        planned_usage_value: this.plannedToolUsage(
          tool,
          Number(position.input_available || position.target_remaining || 0),
          profile,
        ),
        assignment_source: "AUTO",
        assigned_by: dto.operator_id,
        status: "IN_USE",
      }));
      const { error: assignmentError } = await this.supabase
        .from("production_tool_assignments")
        .insert(assignments);
      if (assignmentError) {
        await this.supabase
          .from("station_completions")
          .delete()
          .eq("tenant_id", tenantId)
          .eq("id", data.id);
        if (operationDispatch) {
          await this.supabase
            .from("production_schedule_operations")
            .update({ status: "RELEASED" })
            .eq("tenant_id", tenantId)
            .eq("id", operationDispatch.id);
        }
        throw new BadRequestException(
          `Unable to reserve required tooling: ${assignmentError.message}`,
        );
      }
    }

    // Update production order status to IN_PROGRESS if it was RELEASED
    if (order.status === "RELEASED") {
      await this.supabase
        .from("production_orders")
        .update({ status: "IN_PROGRESS", updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("id", dto.production_order_id);
    }

    return this.enrichTooling(tenantId, data);
  }

  /**
   * Complete an operation
   */
  async completeOperation(
    tenantId: string,
    userId: string,
    completionId: string,
    dto: CompleteOperationDto,
  ): Promise<StationCompletion> {
    // Verify completion exists and is IN_PROGRESS
    const { data: existing, error: fetchError } = await this.supabase
      .from("station_completions")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", completionId)
      .single();

    if (fetchError || !existing) {
      throw new NotFoundException(
        `Station completion with ID ${completionId} not found`,
      );
    }

    if (existing.status !== "IN_PROGRESS") {
      throw new BadRequestException(
        "Only IN_PROGRESS operations can be completed",
      );
    }
    if (String(existing.operator_id) !== String(userId)) {
      throw new BadRequestException(
        "Only the operator who started this operation can complete it",
      );
    }
    const quantities = normalizeCompletionQuantities(
      dto.quantity_completed,
      dto.quantity_rejected,
    );
    if (quantities.reject > 0 && !String(dto.notes || "").trim())
      throw new BadRequestException(
        "A rejection reason is required when rejected quantity is recorded",
      );
    const reworkQuantity = normalizeReworkQuantity(dto.rework_quantity);
    if (reworkQuantity > 0 && !String(dto.notes || "").trim())
      throw new BadRequestException(
        "A rework reason is required when rework quantity is recorded",
      );

    const [{ data: order }, { data: routing }, { data: completedRows }] =
      await Promise.all([
        this.supabase
          .from("production_orders")
          .select("id,bom_id,item_id,quantity")
          .eq("tenant_id", tenantId)
          .eq("id", existing.production_order_id)
          .single(),
        this.supabase
          .from("production_routing")
          .select("id,bom_id,sequence_no")
          .eq("tenant_id", tenantId)
          .eq("id", existing.routing_id)
          .single(),
        this.supabase
          .from("station_completions")
          .select("routing_id,quantity_completed,quantity_rejected,status")
          .eq("tenant_id", tenantId)
          .eq("production_order_id", existing.production_order_id)
          .eq("status", "COMPLETED"),
      ]);
    if (!order || !routing || String(order.bom_id) !== String(routing.bom_id))
      throw new BadRequestException(
        "Production order routing evidence is incomplete",
      );
    const { data: previousSteps } = await this.supabase
      .from("production_routing")
      .select("id,sequence_no")
      .eq("tenant_id", tenantId)
      .eq("bom_id", order.bom_id)
      .lt("sequence_no", routing.sequence_no)
      .order("sequence_no", { ascending: false })
      .limit(1);
    const { data: stagePolicy } = await this.supabase
      .from("production_stage_policies")
      .select("execution_mode,predecessor_routing_ids")
      .eq("tenant_id", tenantId)
      .eq("routing_id", routing.id)
      .maybeSingle();
    const explicitPredecessors = Array.isArray(
      stagePolicy?.predecessor_routing_ids,
    )
      ? stagePolicy.predecessor_routing_ids.map(String)
      : [];
    const predecessorIds = explicitPredecessors.length
      ? explicitPredecessors
      : String(stagePolicy?.execution_mode || "SEQUENTIAL") === "PARALLEL"
        ? []
        : previousSteps?.[0]
          ? [String(previousSteps[0].id)]
          : [];
    const currentRows = (completedRows || []).filter(
      (row) => String(row.routing_id) === String(routing.id),
    );
    const currentGood = currentRows.reduce(
      (sum, row) => sum + Number(row.quantity_completed || 0),
      0,
    );
    const currentProcessed = currentRows.reduce(
      (sum, row) =>
        sum +
        Number(row.quantity_completed || 0) +
        Number(row.quantity_rejected || 0),
      0,
    );
    const predecessorGood = predecessorIds.map((predecessorId) =>
      (completedRows || [])
        .filter((row) => String(row.routing_id) === predecessorId)
        .reduce((sum, row) => sum + Number(row.quantity_completed || 0), 0),
    );
    const upstreamGood = predecessorGood.length
      ? Math.min(...predecessorGood)
      : undefined;
    const position = operationQueuePosition(
      Number(order.quantity),
      currentGood,
      currentProcessed,
      upstreamGood,
    );
    if (quantities.good > position.target_remaining)
      throw new BadRequestException(
        `Completed quantity exceeds the remaining target of ${position.target_remaining}`,
      );
    if (
      predecessorIds.length &&
      quantities.processed > position.input_available
    )
      throw new BadRequestException(
        `Processed quantity exceeds the ${position.input_available} units available from the previous operation`,
      );

    const dispatchMarker = String(existing.notes || "").match(/\[\[JOB_CARD:([0-9a-f-]{36})\]\]/i);
    let completionDispatch: any = null;
    if (dispatchMarker?.[1]) {
      const { data: dispatch, error: dispatchError } = await this.supabase
        .from("production_schedule_operations")
        .select("id,status,scheduling_note")
        .eq("tenant_id", tenantId)
        .eq("id", dispatchMarker[1])
        .single();
      if (dispatchError || !dispatch)
        throw new BadRequestException("The Job Card allocation is missing");
      let detail: any = {};
      try { detail = JSON.parse(String(dispatch.scheduling_note || "{}")); } catch {}
      if (detail.kind !== "JOB_CARD") throw new BadRequestException("The Job Card allocation is invalid");
      const { data: priorDispatchRows } = await this.supabase
        .from("station_completions")
        .select("quantity_completed,quantity_rejected,status,notes")
        .eq("tenant_id", tenantId)
        .eq("job_order_id", existing.job_order_id)
        .eq("status", "COMPLETED");
      const priorProcessed = (priorDispatchRows || [])
        .filter((entry: any) => String(entry.notes || "").includes(`[[JOB_CARD:${dispatch.id}]]`))
        .reduce(
          (sum: number, entry: any) =>
            sum + Number(entry.quantity_completed || 0) + Number(entry.quantity_rejected || 0),
          0,
        );
      const dispatchRemaining = Math.max(
        0,
        Number(detail.assigned_quantity || 0) - priorProcessed,
      );
      if (quantities.processed > dispatchRemaining)
        throw new BadRequestException(
          `Processed quantity exceeds the ${dispatchRemaining} units remaining on this Job Card`,
        );
      completionDispatch = { ...dispatch, ...detail, priorProcessed };
    }

    const endTime = new Date();
    const startTime = new Date(existing.start_time);
    const actualTimeMinutes = Math.max(
      0,
      Math.round(
        (endTime.getTime() - startTime.getTime()) / 60000 -
          Number(existing.total_paused_minutes || 0),
      ),
    );

    const rawInput =
      dto.actual_input_quantity == null
        ? null
        : Number(dto.actual_input_quantity);
    const inputUom = String(dto.actual_input_uom || "KG").toUpperCase();
    if (
      rawInput != null &&
      (!Number.isFinite(rawInput) ||
        rawInput < 0 ||
        !["KG", "G"].includes(inputUom))
    )
      throw new BadRequestException(
        "Actual material input must be a non-negative quantity in kg or grams",
      );
    const actualInputKg =
      rawInput == null ? null : rawInput * (inputUom === "G" ? 0.001 : 1);
    const scrap = Number(dto.actual_scrap_quantity || 0);
    const strokes =
      dto.machine_strokes == null ? null : Number(dto.machine_strokes);
    const batches = dto.batch_count == null ? null : Number(dto.batch_count);
    if (
      !Number.isFinite(scrap) ||
      scrap < 0 ||
      (strokes != null && (!Number.isFinite(strokes) || strokes < 0)) ||
      (batches != null && (!Number.isFinite(batches) || batches < 0))
    )
      throw new BadRequestException(
        "Scrap, machine strokes and batch count must be non-negative numbers",
      );

    const [{ data: assignments, error: assignmentError }, { data: profile }] =
      await Promise.all([
        this.supabase
          .from("production_tool_assignments")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("station_completion_id", completionId),
        this.supabase
          .from("production_process_resource_profiles")
          .select("cavities")
          .eq("tenant_id", tenantId)
          .eq("routing_id", existing.routing_id)
          .eq("work_station_id", existing.work_station_id)
          .maybeSingle(),
      ]);
    if (assignmentError) throw new BadRequestException(assignmentError.message);
    const activeAssignments = (assignments || []).filter(
      (x: any) => x.status === "IN_USE",
    );
    if (
      activeAssignments.some((x: any) => x.life_basis === "KG_INPUT") &&
      !(actualInputKg != null && actualInputKg > 0)
    )
      throw new BadRequestException(
        "Actual material processed in kg is required for the installed kg-life tooling",
      );
    if (
      activeAssignments.some((x: any) => x.life_basis === "BATCHES") &&
      !(batches != null && batches > 0)
    )
      throw new BadRequestException(
        "Actual batch count is required for the installed batch-life tooling",
      );
    const priorByCode = new Map<string, number>();
    for (const assignment of assignments || []) {
      if (assignment.status === "IN_USE") continue;
      priorByCode.set(
        String(assignment.tool_code),
        (priorByCode.get(String(assignment.tool_code)) || 0) +
          Number(assignment.actual_usage_value || 0),
      );
    }
    const toolUsages = activeAssignments.map((assignment: any) => {
      const total = calculatedToolUsage({
        basis: assignment.life_basis,
        good: quantities.good,
        rejected: quantities.reject,
        actualInputKg,
        machineStrokes: strokes,
        batchCount: batches,
        actualMinutes: actualTimeMinutes,
        cavities: profile?.cavities,
      });
      return {
        assignment_id: assignment.id,
        usage_value: Math.max(
          0,
          total - (priorByCode.get(String(assignment.tool_code)) || 0),
        ),
      };
    });

    const { data, error } = await this.supabase.rpc(
      "complete_station_operation_with_tooling",
      {
        p_tenant_id: tenantId,
        p_completion_id: completionId,
        p_user_id: userId,
        p_good_quantity: quantities.good,
        p_rejected_quantity: quantities.reject,
        p_end_time: endTime.toISOString(),
        p_actual_time_minutes: actualTimeMinutes,
        p_notes: dispatchMarker?.[1]
          ? `[[JOB_CARD:${dispatchMarker[1]}]]${dto.notes ? ` ${dto.notes}` : ""}`
          : dto.notes || "",
        p_actual_input_quantity: actualInputKg,
        p_actual_input_uom: actualInputKg == null ? "" : "KG",
        p_scrap_quantity: scrap,
        p_machine_strokes: strokes,
        p_batch_count: batches,
        p_tool_usages: toolUsages,
      },
    );

    if (error) {
      throw new BadRequestException(
        `Failed to complete operation: ${error.message}`,
      );
    }


    if (completionDispatch) {
      const processedAfter = Number(completionDispatch.priorProcessed || 0) + quantities.processed;
      const nextStatus = processedAfter >= Number(completionDispatch.assigned_quantity || 0)
        ? "COMPLETED"
        : "RELEASED";
      const { error: dispatchUpdateError } = await this.supabase
        .from("production_schedule_operations")
        .update({ status: nextStatus })
        .eq("tenant_id", tenantId)
        .eq("id", completionDispatch.id);
      if (dispatchUpdateError)
        throw new BadRequestException(
          `Output was saved, but Job Card status could not be updated: ${dispatchUpdateError.message}`,
        );
    }

    let completionResult: any = Array.isArray(data) ? data[0] : data;
    if (reworkQuantity > 0) {
      const { data: reworked, error: reworkError } = await this.supabase
        .from("station_completions")
        .update({ rework_quantity: reworkQuantity })
        .eq("tenant_id", tenantId)
        .eq("id", completionId)
        .select()
        .single();
      if (reworkError)
        throw new BadRequestException(
          `Output was saved, but rework could not be recorded: ${reworkError.message}`,
        );
      completionResult = reworked;
    }

    // WIP, transfer and consumption evidence is written by the same database
    // transaction that completes the station operation. Keeping this at the
    // database boundary prevents a saved completion with a missing WIP ledger.

    // Check if all operations for this production order are completed
    await this.checkAndUpdateOrderCompletion(
      tenantId,
      existing.production_order_id,
    );

    const summary = partialProductionSummary({
      planned: order.quantity,
      priorGood: currentGood,
      priorRejected: currentProcessed - currentGood,
      currentGood: quantities.good,
      currentRejected: quantities.reject,
    });
    if (!summary.is_partial) return completionResult;

    const { data: components } = await this.supabase
      .from("production_order_components")
      .select("item_id,required_quantity,consumed_quantity")
      .eq("production_order_id", existing.production_order_id);
    const itemIds = [...new Set((components || []).map((x: any) => x.item_id))];
    const { data: items } = itemIds.length
      ? await this.supabase
          .from("items")
          .select("id,code,name,uom")
          .eq("tenant_id", tenantId)
          .in("id", itemIds)
      : ({ data: [] } as any);
    const itemById = new Map((items || []).map((x: any) => [String(x.id), x]));
    const progress = summary.planned_quantity
      ? Math.min(1, summary.processed_quantity / summary.planned_quantity)
      : 0;
    const materialReconciliation = (components || []).map((component: any) => {
      const item: any = itemById.get(String(component.item_id)) || {};
      const planned = Number(component.required_quantity || 0);
      const standardUsed = planned * progress;
      return {
        item_id: component.item_id,
        item_code: item.code || "",
        item_name: item.name || "Material",
        uom: item.uom || "",
        planned_quantity: planned,
        standard_used_to_date: Number(standardUsed.toFixed(4)),
        expected_balance: Number(
          Math.max(0, planned - standardUsed).toFixed(4),
        ),
        recorded_consumed_quantity: Number(component.consumed_quantity || 0),
      };
    });
    const completionRow: any = completionResult;
    // The completion RPC has already committed at this point. Use the returned
    // row id when available, with the request id as the stable fallback, so the
    // partial-balance disposition is attached to the completed operation.
    const completionRowId = String(completionRow?.id || completionId);
    const dispositionPayload = {
      tenant_id: tenantId,
      production_order_id: existing.production_order_id,
      station_completion_id: completionRowId,
      routing_id: existing.routing_id,
      planned_quantity: summary.planned_quantity,
      good_quantity: summary.good_quantity,
      rejected_quantity: summary.rejected_quantity,
      remaining_quantity: summary.remaining_quantity,
      material_reconciliation: materialReconciliation,
      actual_evidence: {
        input_kg: actualInputKg,
        scrap_kg: scrap,
        runtime_minutes: actualTimeMinutes,
      },
      created_by: userId,
      updated_at: new Date().toISOString(),
    };
    const { data: disposition, error: dispositionError } = await this.supabase
      .from("production_partial_dispositions")
      .upsert(dispositionPayload, {
        onConflict: "tenant_id,station_completion_id",
      })
      .select()
      .single();
    if (dispositionError)
      throw new BadRequestException(
        `Output was saved, but the balance decision could not be prepared: ${dispositionError.message}`,
      );
    return {
      ...(completionRow || {}),
      partial_decision: { ...summary, ...disposition },
    };
  }

  async decidePartialProduction(
    tenantId: string,
    userId: string,
    dispositionId: string,
    body: any,
  ) {
    const decision = String(body?.decision || "").toUpperCase();
    if (
      ![
        "CONTINUE_NOW",
        "NEXT_SHIFT",
        "NEXT_DAY",
        "CLOSE_SHORT",
        "RETURN_TO_STORE",
      ].includes(decision)
    )
      throw new BadRequestException("Select a valid balance action");
    if (decision === "NEXT_DAY" && !body?.scheduled_date)
      throw new BadRequestException("Select the next production date");
    if (
      ["CLOSE_SHORT", "RETURN_TO_STORE"].includes(decision) &&
      !String(body?.reason || "").trim()
    )
      throw new BadRequestException("Enter the reason for closing short");

    const { data: disposition, error } = await this.supabase
      .from("production_partial_dispositions")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", dispositionId)
      .eq("status", "PENDING")
      .single();
    if (error || !disposition)
      throw new NotFoundException(
        "Pending production balance decision not found",
      );

    const closing = ["CLOSE_SHORT", "RETURN_TO_STORE"].includes(decision);
    const status =
      decision === "RETURN_TO_STORE"
        ? "RETURN_REQUESTED"
        : closing
          ? "CLOSED"
          : "PLANNED";
    const now = new Date().toISOString();
    const { data: saved, error: saveError } = await this.supabase
      .from("production_partial_dispositions")
      .update({
        decision,
        status,
        scheduled_date: body?.scheduled_date || null,
        reason: String(body?.reason || "").trim() || null,
        decided_by: userId,
        decided_at: now,
        updated_at: now,
      })
      .eq("tenant_id", tenantId)
      .eq("id", dispositionId)
      .select()
      .single();
    if (saveError) throw new BadRequestException(saveError.message);

    if (closing) {
      const { error: orderError } = await this.supabase
        .from("production_orders")
        .update({
          status: "COMPLETED",
          produced_quantity: disposition.good_quantity,
          closed_short_quantity: disposition.remaining_quantity,
          closed_short_reason: String(body.reason).trim(),
          closed_short_at: now,
          closed_short_by: userId,
          actual_end_date: now,
          updated_at: now,
        })
        .eq("tenant_id", tenantId)
        .eq("id", disposition.production_order_id);
      if (orderError) throw new BadRequestException(orderError.message);
    }

    let return_request: any = null;
    if (decision === "RETURN_TO_STORE") {
      const requestNumber = `PRR-${now.slice(0, 10).replaceAll("-", "")}-${String(disposition.id).slice(0, 8).toUpperCase()}`;
      const { data: request, error: requestError } = await this.supabase
        .from("production_material_return_requests")
        .upsert(
          {
            tenant_id: tenantId,
            disposition_id: disposition.id,
            production_order_id: disposition.production_order_id,
            request_number: requestNumber,
            suggested_lines: disposition.material_reconciliation || [],
            requested_by: userId,
            notes: String(body.reason).trim(),
            updated_at: now,
          },
          { onConflict: "tenant_id,disposition_id" },
        )
        .select()
        .single();
      if (requestError) throw new BadRequestException(requestError.message);
      return_request = request;
    }
    return { disposition: saved, return_request };
  }

  async changeTool(
    tenantId: string,
    userId: string,
    completionId: string,
    dto: ChangeToolDto,
  ) {
    const usage = Number(dto.actual_usage_value);
    if (
      !dto.assignment_id ||
      !dto.replacement_tool_resource_id ||
      !Number.isFinite(usage) ||
      usage < 0 ||
      !String(dto.reason || "").trim()
    )
      throw new BadRequestException(
        "Current tool, replacement tool, actual outgoing usage and reason are required",
      );
    const { data, error } = await this.supabase.rpc(
      "change_station_operation_tool",
      {
        p_tenant_id: tenantId,
        p_completion_id: completionId,
        p_assignment_id: dto.assignment_id,
        p_replacement_tool_resource_id: dto.replacement_tool_resource_id,
        p_usage_value: usage,
        p_reason: String(dto.reason).trim(),
        p_evidence_reference: String(dto.evidence_reference || "").trim(),
        p_user_id: userId,
      },
    );
    if (error)
      throw new BadRequestException(
        `Unable to change tooling: ${error.message}`,
      );
    return data;
  }

  /**
   * Pause an operation
   */
  async pauseOperation(
    tenantId: string,
    userId: string,
    completionId: string,
    dto: PauseOperationDto,
  ): Promise<StationCompletion> {
    const { data: existing, error: fetchError } = await this.supabase
      .from("station_completions")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", completionId)
      .single();

    if (fetchError || !existing) {
      throw new NotFoundException(
        `Station completion with ID ${completionId} not found`,
      );
    }

    if (existing.status !== "IN_PROGRESS") {
      throw new BadRequestException(
        "Only IN_PROGRESS operations can be paused",
      );
    }
    if (String(existing.operator_id) !== String(userId))
      throw new BadRequestException(
        "Only the assigned operator can pause this operation",
      );

    const downtime = normalizeDowntimeReason(dto);

    const { data, error } = await this.supabase
      .from("station_completions")
      .update({
        status: "PAUSED",
        paused_at: new Date().toISOString(),
        pause_loss_category: downtime.lossCategory,
        pause_reason: downtime.reason,
        pause_evidence_reference:
          String(dto.evidence_reference || "").trim() || null,
        pause_source: downtime.source,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", completionId)
      .select()
      .single();

    if (error) {
      throw new BadRequestException(
        `Failed to pause operation: ${error.message}`,
      );
    }

    return data;
  }

  /**
   * Resume a paused operation
   */
  async resumeOperation(
    tenantId: string,
    userId: string,
    completionId: string,
  ): Promise<StationCompletion> {
    const { data: existing, error: fetchError } = await this.supabase
      .from("station_completions")
      .select("*, operator_id")
      .eq("tenant_id", tenantId)
      .eq("id", completionId)
      .single();

    if (fetchError || !existing) {
      throw new NotFoundException(
        `Station completion with ID ${completionId} not found`,
      );
    }

    if (existing.status !== "PAUSED") {
      throw new BadRequestException("Only PAUSED operations can be resumed");
    }
    if (String(existing.operator_id) !== String(userId))
      throw new BadRequestException(
        "Only the assigned operator can resume this operation",
      );

    // Check if operator has another active operation
    const { data: activeOps } = await this.supabase
      .from("station_completions")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("operator_id", existing.operator_id)
      .eq("status", "IN_PROGRESS")
      .limit(1);

    if (activeOps && activeOps.length > 0) {
      throw new BadRequestException(
        "Operator already has an active operation. Please complete or pause it first.",
      );
    }

    const pauseStarted = new Date(existing.paused_at || existing.updated_at);
    const pauseEnded = new Date();
    const pausedMinutes = Math.max(
      1,
      Math.round((pauseEnded.getTime() - pauseStarted.getTime()) / 60000),
    );
    const workDate = pauseStarted.toISOString().slice(0, 10);
    const { data: shift } = await this.supabase
      .from("manufacturing_shift_plans")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("work_station_id", existing.work_station_id)
      .eq("work_date", workDate)
      .maybeSingle();
    const pauseStartedAt = pauseStarted.toISOString();
    const { data: existingDowntime, error: existingDowntimeError } =
      await this.supabase
        .from("manufacturing_downtime_events")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("station_completion_id", existing.id)
        .eq("started_at", pauseStartedAt)
        .maybeSingle();
    if (existingDowntimeError)
      throw new BadRequestException(
        `Unable to verify downtime before resuming: ${existingDowntimeError.message}`,
      );

    const { error: downtimeError } = existingDowntime
      ? { error: null }
      : await this.supabase.from("manufacturing_downtime_events").insert({
          tenant_id: tenantId,
          shift_id: shift?.id || null,
          station_completion_id: existing.id,
          production_order_id: existing.production_order_id,
          routing_id: existing.routing_id,
          work_station_id: existing.work_station_id,
          loss_category: existing.pause_loss_category || "OTHER",
          reason: existing.pause_reason || "Unspecified shop-floor pause",
          downtime_minutes: pausedMinutes,
          evidence_reference: existing.pause_evidence_reference || null,
          source: existing.pause_source || "MANUAL",
          started_at: pauseStartedAt,
          ended_at: pauseEnded.toISOString(),
          reported_by: userId,
        });
    if (downtimeError)
      throw new BadRequestException(
        `Unable to record downtime before resuming: ${downtimeError.message}`,
      );

    const { data, error } = await this.supabase
      .from("station_completions")
      .update({
        status: "IN_PROGRESS",
        paused_at: null,
        total_paused_minutes:
          Number(existing.total_paused_minutes || 0) + pausedMinutes,
        pause_loss_category: null,
        pause_reason: null,
        pause_evidence_reference: null,
        pause_source: null,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", completionId)
      .select()
      .single();

    if (error) {
      throw new BadRequestException(
        `Failed to resume operation: ${error.message}`,
      );
    }

    return data;
  }

  /**
   * Get active operation for an operator
   */
  async getActiveOperation(
    tenantId: string,
    operatorId: string,
  ): Promise<StationCompletion | null> {
    const { data } = await this.supabase
      .from("station_completions")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("operator_id", operatorId)
      .in("status", ["IN_PROGRESS", "PAUSED"])
      .limit(1)
      .maybeSingle();

    return data ? this.enrichTooling(tenantId, data) : null;
  }

  /**
   * Get completions for a production order with routing and work station details
   */
  async findByProductionOrder(
    tenantId: string,
    productionOrderId: string,
  ): Promise<any[]> {
    // Fetch completions
    const { data: completions, error } = await this.supabase
      .from("station_completions")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("production_order_id", productionOrderId)
      .order("created_at", { ascending: true });

    if (error) {
      throw new BadRequestException(
        `Failed to fetch completions: ${error.message}`,
      );
    }

    if (!completions || completions.length === 0) {
      return [];
    }

    // Fetch routing details
    const routingIds = [...new Set(completions.map((c) => c.routing_id))];
    const { data: routings } = await this.supabase
      .from("production_routing")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("id", routingIds);

    // Fetch work stations
    const stationIds = [...new Set(completions.map((c) => c.work_station_id))];
    const { data: stations } = await this.supabase
      .from("work_stations")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("id", stationIds);

    // Build maps
    const routingMap = new Map(routings?.map((r) => [r.id, r]) || []);
    const stationMap = new Map(stations?.map((s) => [s.id, s]) || []);

    // Merge data
    return completions.map((completion) => ({
      ...completion,
      routing: routingMap.get(completion.routing_id) || null,
      work_station: stationMap.get(completion.work_station_id) || null,
    }));
  }

  /**
   * Get completions by work station
   */
  async findByWorkStation(
    tenantId: string,
    workStationId: string,
    filters?: { startDate?: string; endDate?: string; operatorId?: string },
  ): Promise<StationCompletion[]> {
    let query = this.supabase
      .from("station_completions")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("work_station_id", workStationId);

    if (filters?.startDate) {
      query = query.gte("start_time", filters.startDate);
    }

    if (filters?.endDate) {
      query = query.lte("start_time", filters.endDate);
    }

    if (filters?.operatorId) {
      query = query.eq("operator_id", filters.operatorId);
    }

    query = query.order("start_time", { ascending: false });

    const { data, error } = await query;

    if (error) {
      throw new BadRequestException(
        `Failed to fetch completions: ${error.message}`,
      );
    }

    return data || [];
  }

  /**
   * Check if all operations are completed and update production order status
   */
  private async checkAndUpdateOrderCompletion(
    tenantId: string,
    productionOrderId: string,
  ): Promise<void> {
    // Get production order
    const { data: order } = await this.supabase
      .from("production_orders")
      .select("bom_id, quantity, status")
      .eq("tenant_id", tenantId)
      .eq("id", productionOrderId)
      .single();

    if (!order) return;

    // Get all routing operations for this BOM
    const { data: routings } = await this.supabase
      .from("production_routing")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("bom_id", order.bom_id);

    if (!routings || routings.length === 0) return;

    // Get all completions for this production order
    const { data: completions } = await this.supabase
      .from("station_completions")
      .select("routing_id, quantity_completed, status")
      .eq("tenant_id", tenantId)
      .eq("production_order_id", productionOrderId);

    if (!completions) return;

    // Check if all operations are completed with full quantity
    const routingIds = routings.map((r) => r.id);
    const allCompleted = allRoutingTargetsCompleted(
      routingIds.map(String),
      completions,
      order.quantity,
    );
    const nextStatus = allCompleted ? "COMPLETED" : "IN_PROGRESS";

    if (String(order.status) !== nextStatus) {
      await this.supabase
        .from("production_orders")
        .update({ status: nextStatus, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("id", productionOrderId);
    }
  }

  /**
   * Get operator productivity report
   */
  async getOperatorProductivity(
    tenantId: string,
    operatorId: string,
    startDate: string,
    endDate: string,
  ): Promise<any> {
    const { data: completions, error } = await this.supabase
      .from("station_completions")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("operator_id", operatorId)
      .eq("status", "COMPLETED")
      .gte("start_time", startDate)
      .lte("end_time", endDate);

    if (error) {
      throw new BadRequestException(
        `Failed to fetch productivity data: ${error.message}`,
      );
    }

    if (!completions || completions.length === 0) {
      return {
        operator_id: operatorId,
        total_operations: 0,
        total_quantity: 0,
        total_rejected: 0,
        total_time_minutes: 0,
        average_time_per_operation: 0,
      };
    }

    const totalQuantity = completions.reduce(
      (sum, c) => sum + c.quantity_completed,
      0,
    );
    const totalRejected = completions.reduce(
      (sum, c) => sum + c.quantity_rejected,
      0,
    );
    const totalTime = completions.reduce(
      (sum, c) => sum + (c.actual_time_minutes || 0),
      0,
    );

    return {
      operator_id: operatorId,
      total_operations: completions.length,
      total_quantity: totalQuantity,
      total_rejected: totalRejected,
      rejection_rate:
        totalQuantity > 0 ? (totalRejected / totalQuantity) * 100 : 0,
      total_time_minutes: totalTime,
      average_time_per_operation:
        completions.length > 0 ? totalTime / completions.length : 0,
    };
  }
}
