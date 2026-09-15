import { BadRequestException, Injectable } from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

@Injectable()
export class WarehouseOptimizationService {
  private readonly db: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );

  private fail(error: any, message: string): never {
    throw new BadRequestException(error?.message || message);
  }

  private text(value: any) {
    return String(value || "").trim();
  }
  private number(value: any) {
    const result = Number(value || 0);
    return Number.isFinite(result) ? result : 0;
  }

  private async recommendation(tenantId: string, id: string) {
    const { data, error } = await this.db
      .from("warehouse_slotting_recommendations")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) this.fail(error, "Slotting recommendation not found.");
    return data;
  }

  async dashboard(tenantId: string) {
    const since = new Date(Date.now() - 90 * 86400000).toISOString();
    const results = await Promise.all([
      this.db
        .from("warehouse_bins")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("bin_code"),
      this.db
        .from("warehouse_bin_profiles")
        .select("*")
        .eq("tenant_id", tenantId),
      this.db
        .from("warehouse_execution_tasks")
        .select("*")
        .eq("tenant_id", tenantId)
        .gte("created_at", since)
        .order("created_at", { ascending: false }),
      this.db
        .from("warehouse_task_observations")
        .select("*")
        .eq("tenant_id", tenantId)
        .gte("observed_at", since),
      this.db
        .from("warehouse_slotting_recommendations")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }),
      this.db
        .from("items")
        .select("id,code,name")
        .eq("tenant_id", tenantId)
        .order("code"),
      this.db
        .from("warehouses")
        .select("id,code,name")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("name"),
    ]);
    const [
      binsResult,
      profilesResult,
      tasksResult,
      observationsResult,
      recommendationsResult,
      itemsResult,
      warehousesResult,
    ] = results;
    if (binsResult.error) this.fail(binsResult.error, "Unable to load bins.");
    if (profilesResult.error)
      this.fail(profilesResult.error, "Unable to load bin profiles.");
    if (tasksResult.error)
      this.fail(tasksResult.error, "Unable to load warehouse tasks.");
    if (observationsResult.error)
      this.fail(observationsResult.error, "Unable to load task observations.");
    if (recommendationsResult.error)
      this.fail(
        recommendationsResult.error,
        "Unable to load slotting recommendations.",
      );
    if (itemsResult.error)
      this.fail(itemsResult.error, "Unable to load items.");
    if (warehousesResult.error)
      this.fail(warehousesResult.error, "Unable to load warehouses.");

    const bins = binsResult.data || [];
    const profiles = profilesResult.data || [];
    const tasks = tasksResult.data || [];
    const observations = observationsResult.data || [];
    const recommendations = recommendationsResult.data || [];
    const items = itemsResult.data || [];
    const warehouses = warehousesResult.data || [];
    const profileMap = new Map(
      profiles.map((row: any) => [String(row.bin_id), row]),
    );
    const binMap = new Map(
      bins.map((row: any) => [
        String(row.id),
        { ...row, profile: profileMap.get(String(row.id)) },
      ]),
    );
    const itemMap = new Map(items.map((row: any) => [String(row.id), row]));
    const pickCounts = new Map<string, any>();
    for (const task of tasks) {
      if (task.task_type !== "PICK" || !task.item_id || !task.from_bin_id)
        continue;
      const key = `${task.item_id}:${task.from_bin_id}`;
      const aggregate = pickCounts.get(key) || {
        item_id: task.item_id,
        current_bin_id: task.from_bin_id,
        picks: 0,
      };
      aggregate.picks += 1;
      pickCounts.set(key, aggregate);
    }
    const profiledBins = bins.filter((row: any) =>
      profileMap.has(String(row.id)),
    );
    const candidates = Array.from(pickCounts.values())
      .map((candidate: any) => {
        const current: any = binMap.get(String(candidate.current_bin_id));
        const currentDistance = this.number(
          current?.profile?.access_distance_meters,
        );
        const best: any = profiledBins
          .filter(
            (bin: any) =>
              String(bin.warehouse_id) === String(current?.warehouse_id) &&
              String(bin.id) !== String(current?.id),
          )
          .sort(
            (a: any, b: any) =>
              this.number(
                profileMap.get(String(a.id))?.access_distance_meters,
              ) -
              this.number(profileMap.get(String(b.id))?.access_distance_meters),
          )[0];
        const bestDistance = this.number(
          profileMap.get(String(best?.id))?.access_distance_meters,
        );
        const monthlyMoves = candidate.picks / 3;
        return {
          ...candidate,
          item: itemMap.get(String(candidate.item_id)),
          current_bin: current,
          recommended_bin: best ? binMap.get(String(best.id)) : null,
          monthly_moves: monthlyMoves,
          annual_travel_reduction_meters:
            Math.max(0, currentDistance - bestDistance) * monthlyMoves * 12,
        };
      })
      .filter(
        (row: any) =>
          row.recommended_bin && row.annual_travel_reduction_meters > 0,
      )
      .sort(
        (a: any, b: any) =>
          b.annual_travel_reduction_meters - a.annual_travel_reduction_meters,
      );
    const rows = recommendations.map((row: any) => ({
      ...row,
      item: itemMap.get(String(row.item_id)),
      current_bin: binMap.get(String(row.current_bin_id)),
      recommended_bin: binMap.get(String(row.recommended_bin_id)),
    }));
    return {
      kpis: {
        completed_tasks: tasks.filter((row: any) => row.status === "COMPLETED")
          .length,
        observed_tasks: observations.length,
        average_minutes: observations.length
          ? observations.reduce(
              (sum: number, row: any) =>
                sum + this.number(row.observed_minutes),
              0,
            ) / observations.length
          : 0,
        travel_km:
          observations.reduce(
            (sum: number, row: any) => sum + this.number(row.travel_meters),
            0,
          ) / 1000,
        exception_cost: observations.reduce(
          (sum: number, row: any) => sum + this.number(row.exception_cost),
          0,
        ),
        verified_savings: rows
          .filter((row: any) => row.status === "VERIFIED")
          .reduce(
            (sum: number, row: any) =>
              sum + this.number(row.realized_annual_savings),
            0,
          ),
      },
      bins: bins.map((row: any) => ({
        ...row,
        profile: profileMap.get(String(row.id)),
      })),
      tasks,
      observations,
      recommendations: rows,
      candidates,
      items,
      warehouses,
    };
  }

  async profile(tenantId: string, userId: string, body: any) {
    const binId = this.text(body.bin_id);
    const velocity = this.text(body.velocity_class || "ANY").toUpperCase();
    const handling = this.text(body.handling_class || "GENERAL").toUpperCase();
    if (
      !binId ||
      !["A", "B", "C", "ANY"].includes(velocity) ||
      !["GENERAL", "FRAGILE", "HAZMAT", "COLD", "BULK"].includes(handling)
    )
      this.fail(null, "Bin and valid velocity/handling classes are required.");
    const { data, error } = await this.db
      .from("warehouse_bin_profiles")
      .upsert(
        {
          tenant_id: tenantId,
          bin_id: binId,
          access_distance_meters: this.number(body.access_distance_meters),
          max_capacity_quantity: this.number(body.max_capacity_quantity),
          velocity_class: velocity,
          handling_class: handling,
          created_by: userId,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,bin_id" },
      )
      .select()
      .single();
    if (error) this.fail(error, "Unable to save bin profile.");
    return data;
  }

  async observation(tenantId: string, userId: string, body: any) {
    const taskId = this.text(body.task_id);
    const minutes = this.number(body.observed_minutes);
    const evidence = this.text(body.evidence_reference);
    const { data: task } = await this.db
      .from("warehouse_execution_tasks")
      .select("id,status")
      .eq("tenant_id", tenantId)
      .eq("id", taskId)
      .maybeSingle();
    if (!task || task.status !== "COMPLETED" || minutes <= 0 || !evidence)
      this.fail(
        null,
        "A completed task, positive observed minutes and evidence are required.",
      );
    const { data, error } = await this.db
      .from("warehouse_task_observations")
      .insert({
        tenant_id: tenantId,
        task_id: taskId,
        observed_minutes: minutes,
        travel_meters: this.number(body.travel_meters),
        labour_cost: this.number(body.labour_cost),
        exception_cost: this.number(body.exception_cost),
        evidence_reference: evidence,
        observed_by: userId,
      })
      .select()
      .single();
    if (error) this.fail(error, "Unable to record task observation.");
    return data;
  }

  async recommend(tenantId: string, userId: string, body: any) {
    const itemId = this.text(body.item_id);
    const targetBinId = this.text(body.recommended_bin_id);
    const rationale = this.text(body.rationale);
    if (
      !itemId ||
      !targetBinId ||
      !rationale ||
      String(body.current_bin_id || "") === targetBinId
    )
      this.fail(
        null,
        "Item, different recommended bin and rationale are required.",
      );
    const { data, error } = await this.db
      .from("warehouse_slotting_recommendations")
      .insert({
        tenant_id: tenantId,
        item_id: itemId,
        current_bin_id: body.current_bin_id || null,
        recommended_bin_id: targetBinId,
        rationale,
        monthly_moves: this.number(body.monthly_moves),
        annual_travel_reduction_meters: this.number(
          body.annual_travel_reduction_meters,
        ),
        target_annual_savings: this.number(body.target_annual_savings),
        created_by: userId,
      })
      .select()
      .single();
    if (error) this.fail(error, "Unable to create slotting recommendation.");
    return data;
  }

  async approve(tenantId: string, userId: string, id: string, body: any) {
    const row = await this.recommendation(tenantId, id);
    const note = this.text(body.approval_note);
    if (row.status !== "PROPOSED" || row.created_by === userId || !note)
      this.fail(null, "Independent approval with rationale is required.");
    return this.transition(
      tenantId,
      id,
      "PROPOSED",
      {
        status: "APPROVED",
        approval_note: note,
        approved_by: userId,
        approved_at: new Date().toISOString(),
      },
      "Unable to approve recommendation.",
    );
  }

  async implement(tenantId: string, userId: string, id: string, body: any) {
    const row = await this.recommendation(tenantId, id);
    const evidence = this.text(body.implementation_evidence);
    if (row.status !== "APPROVED" || !evidence)
      this.fail(
        null,
        "Approved recommendation and implementation evidence are required. No stock is moved automatically.",
      );
    return this.transition(
      tenantId,
      id,
      "APPROVED",
      {
        status: "IMPLEMENTED",
        implementation_evidence: evidence,
        implemented_by: userId,
        implemented_at: new Date().toISOString(),
      },
      "Unable to record implementation.",
    );
  }

  async verify(tenantId: string, userId: string, id: string, body: any) {
    const row = await this.recommendation(tenantId, id);
    const evidence = this.text(body.verification_evidence);
    const savings = this.number(body.realized_annual_savings);
    if (
      row.status !== "IMPLEMENTED" ||
      row.implemented_by === userId ||
      !evidence ||
      savings < 0
    )
      this.fail(
        null,
        "Independent verification, evidence and non-negative realized savings are required.",
      );
    return this.transition(
      tenantId,
      id,
      "IMPLEMENTED",
      {
        status: "VERIFIED",
        verification_evidence: evidence,
        realized_annual_savings: savings,
        verified_by: userId,
        verified_at: new Date().toISOString(),
      },
      "Unable to verify savings.",
    );
  }

  private async transition(
    tenantId: string,
    id: string,
    status: string,
    values: any,
    message: string,
  ) {
    const { data, error } = await this.db
      .from("warehouse_slotting_recommendations")
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .eq("status", status)
      .select()
      .maybeSingle();
    if (error || !data) this.fail(error, message);
    return data;
  }
}
