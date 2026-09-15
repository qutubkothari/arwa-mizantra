import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export function operationQueuePosition(
  orderQuantity: number,
  completedGood: number,
  processedQuantity: number,
  upstreamGood?: number,
) {
  const targetRemaining = Math.max(
    0,
    Number(orderQuantity || 0) - Number(completedGood || 0),
  );
  const inputAvailable =
    upstreamGood == null
      ? targetRemaining
      : Math.max(0, Number(upstreamGood || 0) - Number(processedQuantity || 0));
  return {
    target_remaining: Number(targetRemaining.toFixed(3)),
    input_available: Number(inputAvailable.toFixed(3)),
    ready: targetRemaining > 0 && inputAvailable > 0,
  };
}

export function releasableUpstreamGood(
  executionMode: unknown,
  upstreamGood: number | undefined,
  transferThreshold: number,
) {
  if (upstreamGood == null) return undefined;
  const available = Math.max(0, Number(upstreamGood || 0));
  // Ordinary sequential routing is quantity-flow controlled: every completed
  // good unit becomes WIP for the next operation. OVERLAPPED routing adds a
  // configured transfer-batch threshold before that WIP is released.
  if (String(executionMode || "SEQUENTIAL").toUpperCase() === "OVERLAPPED") {
    return available >= Math.max(0, Number(transferThreshold || 0))
      ? available
      : 0;
  }
  return available;
}

@Injectable()
export class WorkStationService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_KEY!,
    );
  }

  /**
   * Create work station
   */
  async create(tenantId: string, data: any) {
    const { data: station, error } = await this.supabase
      .from("work_stations")
      .insert({
        tenant_id: tenantId,
        station_code: data.stationCode,
        station_name: data.stationName,
        station_type: data.stationType,
        capacity_per_hour: Number(data.capacityPerHour ?? data.capacity ?? 0),
        is_active: data.isActive !== undefined ? data.isActive : true,
      })
      .select()
      .single();

    if (error) {
      console.error("[WorkStation] Failed to create", {
        tenantId,
        data,
        error,
      });
      throw new BadRequestException(error.message);
    }

    return station;
  }

  async getJobOrderQueue(
    tenantId: string,
    jobOrderId: string,
    afterSequence = 0,
  ) {
    const { data: order, error: orderError } = await this.supabase
      .from("production_orders")
      .select("id,job_order_id")
      .eq("tenant_id", tenantId)
      .eq("job_order_id", jobOrderId)
      .maybeSingle();
    if (orderError) throw new BadRequestException(orderError.message);
    if (!order) throw new NotFoundException("Production order not found for this Job Order");
    let effectiveAfterSequence = Number(afterSequence || 0);
    if (!effectiveAfterSequence) {
      const { data: latestCompletion } = await this.supabase
        .from("station_completions")
        .select("sequence_no")
        .eq("tenant_id", tenantId)
        .eq("production_order_id", order.id)
        .eq("status", "COMPLETED")
        .order("end_time", { ascending: false })
        .limit(1)
        .maybeSingle();
      effectiveAfterSequence = Number(latestCompletion?.sequence_no || 0);
    }

    const { data: operations, error: operationError } = await this.supabase
      .from("job_order_operations")
      .select("routing_id,workstation_id")
      .eq("job_order_id", jobOrderId);
    if (operationError) throw new BadRequestException(operationError.message);
    const routingIds = (operations || []).map((row: any) => row.routing_id).filter(Boolean);
    const { data: alternatives, error: alternativeError } = routingIds.length
      ? await this.supabase
          .from("production_resource_alternatives")
          .select("routing_id,work_station_id,priority")
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .in("routing_id", routingIds)
          .order("priority", { ascending: true })
      : ({ data: [], error: null } as any);
    if (alternativeError) throw new BadRequestException(alternativeError.message);
    const stationIds = [
      ...new Set([
        ...(operations || []).map((row: any) => String(row.workstation_id || "")),
        ...(alternatives || []).map((row: any) => String(row.work_station_id || "")),
      ].filter(Boolean)),
    ];
    const stationQueues = await Promise.all(
      stationIds.map(async (stationId, stationPriority) => ({
        stationId,
        stationPriority,
        rows: await this.getQueue(tenantId, stationId),
      })),
    );
    const ready = stationQueues
      .flatMap(({ stationId, stationPriority, rows }) =>
        (rows || [])
          .filter(
            (row: any) =>
              String(row.production_order_id) === String(order.id) && row.ready,
          )
          .map((row: any) => ({
            ...row,
            work_station_id: stationId,
            station_priority: stationPriority,
          })),
      )
      .sort((left: any, right: any) => {
        const leftSequence = Number(left.sequence_no || 0);
        const rightSequence = Number(right.sequence_no || 0);
        const leftDownstream = leftSequence > effectiveAfterSequence ? 0 : 1;
        const rightDownstream = rightSequence > effectiveAfterSequence ? 0 : 1;
        return (
          leftDownstream - rightDownstream ||
          leftSequence - rightSequence ||
          Number(left.station_priority || 0) - Number(right.station_priority || 0)
        );
      });
    return { recommended: ready[0] || null, ready };
  }

  /**
   * Get all work stations
   */
  async findAll(tenantId: string, filters?: any) {
    let query = this.supabase
      .from("work_stations")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("station_code", { ascending: true });

    if (filters?.stationType) {
      query = query.eq("station_type", filters.stationType);
    }

    if (filters?.isActive !== undefined) {
      query = query.eq("is_active", filters.isActive);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[WorkStation] Failed to fetch", {
        tenantId,
        filters,
        error,
      });
      throw new BadRequestException(error.message);
    }

    return data || [];
  }

  /**
   * Get single work station
   */
  async findOne(tenantId: string, id: string) {
    const { data, error } = await this.supabase
      .from("work_stations")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .single();

    if (error) {
      throw new NotFoundException("Work station not found");
    }

    return data;
  }

  /**
   * Update work station
   */
  async update(tenantId: string, id: string, data: any) {
    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (data.stationName) updateData.station_name = data.stationName;
    if (data.stationType) updateData.station_type = data.stationType;
    if (data.capacityPerHour !== undefined || data.capacity !== undefined)
      updateData.capacity_per_hour = Number(
        data.capacityPerHour ?? data.capacity,
      );
    if (data.isActive !== undefined) updateData.is_active = data.isActive;

    const { data: station, error } = await this.supabase
      .from("work_stations")
      .update(updateData)
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("[WorkStation] Failed to update", {
        tenantId,
        id,
        data,
        error,
      });
      throw new BadRequestException(error.message);
    }

    return station;
  }

  /**
   * Delete work station
   */
  async delete(tenantId: string, id: string) {
    const { error } = await this.supabase
      .from("work_stations")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", id);

    if (error) {
      console.error("[WorkStation] Failed to delete", { tenantId, id, error });
      throw new BadRequestException(error.message);
    }

    return { success: true };
  }

  /**
   * Get work station queue (pending operations)
   */
  async getQueue(tenantId: string, stationId: string) {
    // Get all production orders with routing that includes this station
    // and have not been completed at this station yet
    const { data: primaryRoutings, error: routingError } = await this.supabase
      .from("production_routing")
      .select(
        `
        id,
        sequence_no,
        operation_name,
        setup_time_minutes,
        cycle_time_minutes,
        qc_required,
        bom_id
      `,
      )
      .eq("work_station_id", stationId)
      .eq("tenant_id", tenantId);

    if (routingError) {
      console.error("[WorkStation] Failed to fetch routing", {
        tenantId,
        stationId,
        routingError,
      });
      throw new BadRequestException(routingError.message);
    }

    const { data: alternatives, error: alternativeError } = await this.supabase
      .from("production_resource_alternatives")
      .select("routing_id")
      .eq("tenant_id", tenantId)
      .eq("work_station_id", stationId)
      .eq("is_active", true);
    if (alternativeError)
      throw new BadRequestException(alternativeError.message);
    const alternativeIds = (alternatives || []).map((row) => row.routing_id);
    const { data: alternativeRoutings, error: alternativeRoutingError } =
      alternativeIds.length
        ? await this.supabase
            .from("production_routing")
            .select(
              "id,sequence_no,operation_name,setup_time_minutes,cycle_time_minutes,qc_required,bom_id",
            )
            .eq("tenant_id", tenantId)
            .in("id", alternativeIds)
        : ({ data: [], error: null } as any);
    if (alternativeRoutingError)
      throw new BadRequestException(alternativeRoutingError.message);
    const routings = Array.from(
      new Map(
        [...(primaryRoutings || []), ...(alternativeRoutings || [])].map(
          (routing) => [String(routing.id), routing],
        ),
      ).values(),
    );

    if (routings.length === 0) {
      return [];
    }

    // Get production orders using these BOMs
    const bomIds = [...new Set(routings.map((r) => r.bom_id))];

    const { data: orders, error: ordersError } = await this.supabase
      .from("production_orders")
      .select(
        "id, order_number, status, quantity, item_id, bom_id, job_order_id, priority, start_date, created_at",
      )
      .eq("tenant_id", tenantId)
      .in("bom_id", bomIds)
      .in("status", ["RELEASED", "IN_PROGRESS"])
      .order("created_at", { ascending: true });

    if (ordersError) {
      console.error("[WorkStation] Failed to fetch orders", {
        tenantId,
        ordersError,
      });
      throw new BadRequestException(ordersError.message);
    }

    if (!orders || orders.length === 0) {
      return [];
    }

    // Get item details
    const itemIds = [...new Set(orders.map((o) => o.item_id))];
    const { data: items } = await this.supabase
      .from("items")
      .select("id, code, name, uom")
      .in("id", itemIds);

    const itemsMap = new Map(items?.map((i) => [i.id, i]));

    // Load the full route so each queue row can prove that upstream WIP exists.
    const orderIds = orders.map((o) => o.id);
    const { data: allRoutings, error: allRoutingError } = await this.supabase
      .from("production_routing")
      .select("id,bom_id,sequence_no")
      .eq("tenant_id", tenantId)
      .in("bom_id", bomIds);
    if (allRoutingError) throw new BadRequestException(allRoutingError.message);
    const allRoutingIds = (allRoutings || []).map((r) => r.id);

    const { data: stagePolicies, error: policyError } = await this.supabase
      .from("production_stage_policies")
      .select("routing_id,execution_mode,predecessor_routing_ids,transfer_batch_quantity,overlap_percent")
      .eq("tenant_id", tenantId)
      .in("routing_id", allRoutingIds);
    if (policyError) throw new BadRequestException(policyError.message);
    const policyMap = new Map(
      (stagePolicies || []).map((policy) => [String(policy.routing_id), policy]),
    );

    const { data: completions } = await this.supabase
      .from("station_completions")
      .select(
        "production_order_id,job_order_id,routing_id,quantity_completed,quantity_rejected,status,notes",
      )
      .in("production_order_id", orderIds)
      .in("routing_id", allRoutingIds)
      .eq("status", "COMPLETED");

    const completionsMap = new Map<
      string,
      { good: number; processed: number }
    >();
    completions?.forEach((c) => {
      const key = `${c.production_order_id}-${c.routing_id}`;
      const existing = completionsMap.get(key) || { good: 0, processed: 0 };
      existing.good += Number(c.quantity_completed || 0);
      existing.processed +=
        Number(c.quantity_completed || 0) + Number(c.quantity_rejected || 0);
      completionsMap.set(key, existing);
    });

    const jobOrderIds = [...new Set(orders.map((order: any) => order.job_order_id).filter(Boolean))];
    const { data: jobOperations, error: jobOperationError } = jobOrderIds.length
      ? await this.supabase
          .from("job_order_operations")
          .select("id,job_order_id,routing_id")
          .in("job_order_id", jobOrderIds)
          .in("routing_id", allRoutingIds)
      : ({ data: [], error: null } as any);
    if (jobOperationError) throw new BadRequestException(jobOperationError.message);
    const jobOperationByKey = new Map(
      (jobOperations || []).map((row: any) => [
        `${row.job_order_id}-${row.routing_id}`,
        row,
      ]),
    );
    const { data: scheduleRows, error: dispatchError } = jobOrderIds.length
      ? await this.supabase
          .from("production_schedule_operations")
          .select("id,job_order_id,work_station_id,planned_start,planned_end,status,scheduling_note,created_at")
          .eq("tenant_id", tenantId)
          .in("job_order_id", jobOrderIds)
          .order("created_at", { ascending: true })
      : ({ data: [], error: null } as any);
    if (dispatchError) throw new BadRequestException(dispatchError.message);
    const dispatches = (scheduleRows || []).flatMap((row: any) => {
      let detail: any = {};
      try { detail = JSON.parse(String(row.scheduling_note || "{}")); } catch {}
      if (detail.kind !== "JOB_CARD") return [];
      const marker = `[[JOB_CARD:${row.id}]]`;
      const executions = (completions || []).filter((entry: any) =>
        String(entry.notes || "").includes(marker),
      );
      const completed = executions.reduce(
        (sum: number, entry: any) => sum + Number(entry.quantity_completed || 0),
        0,
      );
      const rejected = executions.reduce(
        (sum: number, entry: any) => sum + Number(entry.quantity_rejected || 0),
        0,
      );
      const assigned = Number(detail.assigned_quantity || 0);
      return [{
        id: row.id,
        dispatch_number: detail.dispatch_number,
        job_order_operation_id: detail.job_order_operation_id,
        work_station_id: row.work_station_id,
        assigned_quantity: assigned,
        completed_quantity: completed,
        rejected_quantity: rejected,
        status: row.status === "IN_PROGRESS"
          ? "IN_PROGRESS"
          : row.status === "COMPLETED" || completed + rejected >= assigned
            ? "COMPLETED"
            : completed + rejected > 0
              ? "PARTIALLY_COMPLETED"
              : "DISPATCHED",
        planned_start: row.planned_start,
        planned_end: row.planned_end,
        assigned_operator_id: detail.assigned_operator_id || null,
        assigned_operator_name: detail.assigned_operator_name || null,
      }];
    });

    // Build queue: combine orders with their routing operations for this station
    const queue: any[] = [];

    orders.forEach((order) => {
      routings.forEach((routing) => {
        if (String(order.bom_id) !== String(routing.bom_id)) return;
        const key = `${order.id}-${routing.id}`;
        const completion = completionsMap.get(key) || { good: 0, processed: 0 };
        const implicitPrevious = (allRoutings || [])
          .filter(
            (candidate) =>
              String(candidate.bom_id) === String(order.bom_id) &&
              Number(candidate.sequence_no) < Number(routing.sequence_no),
          )
          .sort((a, b) => Number(b.sequence_no) - Number(a.sequence_no))[0];
        const policy: any = policyMap.get(String(routing.id)) || {};
        const explicitPredecessors = Array.isArray(
          policy.predecessor_routing_ids,
        )
          ? policy.predecessor_routing_ids.map(String)
          : [];
        const predecessorIds = explicitPredecessors.length
          ? explicitPredecessors
          : String(policy.execution_mode || "SEQUENTIAL") === "PARALLEL"
            ? []
            : implicitPrevious
              ? [String(implicitPrevious.id)]
              : [];
        const predecessorGood = predecessorIds.map(
          (id) => completionsMap.get(`${order.id}-${id}`)?.good || 0,
        );
        const rawUpstreamGood = predecessorGood.length
          ? Math.min(...predecessorGood)
          : undefined;
        const mode = String(policy.execution_mode || "SEQUENTIAL");
        const threshold =
          Number(policy.transfer_batch_quantity || 0) ||
          (Number(policy.overlap_percent || 0) > 0
            ? (Number(order.quantity) * Number(policy.overlap_percent)) / 100
            : Number(order.quantity));
        const upstreamGood = releasableUpstreamGood(
          mode,
          rawUpstreamGood,
          threshold,
        );
        const position = operationQueuePosition(
          Number(order.quantity),
          completion.good,
          completion.processed,
          upstreamGood,
        );

        const jobOperation: any = jobOperationByKey.get(
          `${(order as any).job_order_id}-${routing.id}`,
        );
        const operationDispatches = jobOperation
          ? (dispatches || []).filter(
              (row: any) =>
                String(row.job_order_operation_id) === String(jobOperation.id),
            )
          : [];
        const openDispatches = operationDispatches.filter((row: any) =>
          ["DISPATCHED", "PARTIALLY_COMPLETED"].includes(String(row.status)),
        );
        const dispatch: any = openDispatches.find(
          (row: any) => String(row.work_station_id) === String(stationId),
        );
        if (operationDispatches.length && !dispatch) return;
        const dispatchRemaining = dispatch
          ? Math.max(
              0,
              Number(dispatch.assigned_quantity || 0) -
                Number(dispatch.completed_quantity || 0) -
                Number(dispatch.rejected_quantity || 0),
            )
          : Number.POSITIVE_INFINITY;
        const effectiveRemaining = Math.min(
          position.target_remaining,
          dispatchRemaining,
        );
        const effectiveInput = Math.min(
          position.input_available,
          dispatchRemaining,
        );
        const ready = effectiveRemaining > 0 && effectiveInput > 0;

        if (effectiveRemaining > 0) {
          const item: any = itemsMap.get(order.item_id) || {};
          queue.push({
            id: `${order.id}_${routing.id}`,
            production_order_id: order.id,
            order_number: order.order_number,
            routing_id: routing.id,
            operation_name: routing.operation_name,
            sequence_no: routing.sequence_no,
            quantity_required: order.quantity,
            quantity_completed: completion.good,
            quantity_remaining: effectiveRemaining,
            input_available: effectiveInput,
            ready,
            operation_dispatch_id: dispatch?.id || null,
            dispatch_number: dispatch?.dispatch_number || null,
            assigned_quantity: dispatch?.assigned_quantity || null,
            planned_start: dispatch?.planned_start || null,
            planned_end: dispatch?.planned_end || null,
            assigned_operator_id: dispatch?.assigned_operator_id || null,
            assigned_operator_name: dispatch?.assigned_operator_name || null,
            blocked_reason: ready
              ? null
              : predecessorIds.length
                ? mode === "OVERLAPPED"
                  ? `Waiting for transfer batch (${threshold} required).`
                  : "Waiting for predecessor operation completion."
                : "The planned quantity is already complete.",
            execution_mode: mode,
            eligible_machine: String(routing.work_station_id || "") !== String(stationId),
            setup_time_minutes: routing.setup_time_minutes,
            cycle_time_minutes: routing.cycle_time_minutes,
            qc_required: routing.qc_required,
            item,
            item_code: item.code || null,
            item_name: item.name || null,
            priority: order.priority || "NORMAL",
            start_date: order.start_date || null,
            order_status: order.status,
          });
        }
      });
    });

    // Sort by order creation date, then sequence number
    queue.sort((a, b) => {
      if (a.production_order_id === b.production_order_id) {
        return a.sequence_no - b.sequence_no;
      }
      return 0; // Keep original order (FIFO by created_at already sorted above)
    });

    return queue;
  }
}
