import { BadRequestException, Injectable } from "@nestjs/common";
import { createHash } from "crypto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { MrpService } from "../mrp/mrp.service";
import { MrpExceptionService } from "../mrp/mrp-exception.service";
import { GovernedActionService } from "./governed-action.service";
import { GovernedToolRegistryService } from "./governed-tool-registry.service";
import { MrpReleaseReadinessService } from "./mrp-release-readiness.service";

@Injectable()
export class MrpReleaseService {
  private readonly db: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );

  constructor(
    private readonly mrp: MrpService,
    private readonly governedActions: GovernedActionService,
    private readonly registry: GovernedToolRegistryService,
    private readonly readiness: MrpReleaseReadinessService,
    private readonly exceptions: MrpExceptionService,
  ) {}

  private hash(value: unknown) {
    return createHash("sha256")
      .update(JSON.stringify(value))
      .digest("hex")
      .slice(0, 20);
  }

  private safeDate(value: unknown, fallback: string) {
    const text = String(value || "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) && text >= fallback
      ? text
      : fallback;
  }

  private async attachGovernance(tenantId: string, packets: any[]) {
    if (!packets.length) return packets;
    const { data, error } = await this.db
      .from("mizantra_governed_action_requests")
      .select(
        "id,insight_id,tool_code,status,created_by,created_at,approved_by,approved_at,rejected_by,rejected_at,rejection_reason,executed_by,execution_started_at,executed_at,native_resource_type,native_resource_id,native_result,failure_reason,updated_at",
      )
      .eq("tenant_id", tenantId)
      .in(
        "insight_id",
        packets.map((packet) => packet.insight_id),
      )
      .order("created_at", { ascending: false });
    if (error) throw new BadRequestException(error.message);
    const byInsight = new Map<string, any>();
    for (const row of data || []) {
      if (!byInsight.has(String(row.insight_id)))
        byInsight.set(String(row.insight_id), row);
    }
    return packets.map((packet) => ({
      ...packet,
      governance: byInsight.get(packet.insight_id) || null,
      can_submit: !byInsight.has(packet.insight_id),
    }));
  }

  async status(tenantId: string) {
    const plan: any = await this.mrp.latest(tenantId);
    if (!plan.run) return { run_id: null, by_line: {} };
    const { data: evidenceRows, error: evidenceError } = await this.db
      .from("mizantra_exception_register")
      .select("source_key,title,source_route,evidence,updated_at")
      .eq("tenant_id", tenantId)
      .eq("source_type", "MRP_RELEASE")
      .order("updated_at", { ascending: false })
      .limit(500);
    if (evidenceError) throw new BadRequestException(evidenceError.message);
    const releases = (evidenceRows || []).filter(
      (row: any) => String(row.evidence?.run_id || "") === String(plan.run.id),
    );
    const insightIds = releases
      .map((row: any) => String(row.source_key || ""))
      .filter(Boolean);
    if (!insightIds.length)
      return { run_id: plan.run.id, by_line: {}, release_count: 0 };
    const { data: actionRows, error: actionError } = await this.db
      .from("mizantra_governed_action_requests")
      .select(
        "id,insight_id,tool_code,status,created_by,created_at,approved_by,approved_at,rejected_by,rejected_at,rejection_reason,executed_by,execution_started_at,executed_at,native_resource_type,native_resource_id,native_result,failure_reason,updated_at",
      )
      .eq("tenant_id", tenantId)
      .in("insight_id", insightIds)
      .order("updated_at", { ascending: false });
    if (actionError) throw new BadRequestException(actionError.message);
    const actionByInsight = new Map<string, any>();
    for (const row of actionRows || []) {
      if (!actionByInsight.has(String(row.insight_id)))
        actionByInsight.set(String(row.insight_id), row);
    }
    const byLine: Record<string, any> = {};
    for (const release of releases) {
      const governance = actionByInsight.get(String(release.source_key));
      if (!governance) continue;
      for (const lineId of release.evidence?.line_ids || []) {
        const key = String(lineId);
        if (byLine[key]) continue;
        byLine[key] = {
          insight_id: release.source_key,
          title: release.title,
          route: release.source_route,
          release_type: release.evidence?.release_type || null,
          governance,
        };
      }
    }
    return {
      run_id: plan.run.id,
      by_line: byLine,
      release_count: Object.keys(byLine).length,
    };
  }

  async preview(tenantId: string, selectedLineIds?: string[]) {
    const plan: any = await this.mrp.latest(tenantId);
    if (!plan.run)
      return {
        run: null,
        packets: [],
        blocked_lines: [],
        control: "Run MRP and record planner decisions before release.",
      };

    await this.exceptions.syncPlan(tenantId, plan);

    const requested = new Set(
      (Array.isArray(selectedLineIds) ? selectedLineIds : [])
        .map(String)
        .filter(Boolean),
    );
    const allLines = plan.lines || [];
    const considered = requested.size
      ? allLines.filter((line: any) => requested.has(String(line.id)))
      : allLines;
    const supplyReviews = (line: any) => [
      ...(Array.isArray(line.supply_interventions)
        ? line.supply_interventions
        : []),
      ...(Array.isArray(line.unpegged_supply_documents)
        ? line.unpegged_supply_documents
        : []),
    ];
    const hasSupplyIntervention = (line: any) => supplyReviews(line).length > 0;
    const hasNewSupplyRelease = (line: any) => {
      const quantity = Number(
        line.planner_decision?.adjusted_quantity ??
          line.recommended_quantity ??
          0,
      );
      return (
        quantity > 0 && ["BUY", "BUILD"].includes(String(line.supply_action))
      );
    };
    const blockedLines = considered
      .filter((line: any) => {
        const decision = String(line.planner_decision?.decision || "PENDING");
        return (
          !["APPROVED", "CHANGED"].includes(decision) ||
          (!hasNewSupplyRelease(line) && !hasSupplyIntervention(line))
        );
      })
      .map((line: any) => ({
        line_id: line.id,
        item_code: line.item_code,
        item_name: line.item_name,
        reason: !["APPROVED", "CHANGED"].includes(
          String(line.planner_decision?.decision || "PENDING"),
        )
          ? "Planner approval is required."
          : "The approved quantity or supply action is not releasable.",
      }));
    const eligible = considered.filter(
      (line: any) =>
        ["APPROVED", "CHANGED"].includes(
          String(line.planner_decision?.decision || "PENDING"),
        ) &&
        (hasNewSupplyRelease(line) || hasSupplyIntervention(line)),
    );
    const itemIds = Array.from(
      new Set(
        eligible.map((line: any) => String(line.item_id)).filter(Boolean),
      ),
    );
    const itemResult = itemIds.length
      ? await this.db
          .from("items")
          .select("id,code,name,uom,standard_cost")
          .eq("tenant_id", tenantId)
          .in("id", itemIds)
      : { data: [], error: null };
    if (itemResult.error)
      throw new BadRequestException(itemResult.error.message);
    const itemById = new Map(
      (itemResult.data || []).map((item: any) => [String(item.id), item]),
    );
    const today = new Date().toISOString().slice(0, 10);
    const normalized = eligible.map((line: any) => {
      const decision = line.planner_decision || {};
      const item: any = itemById.get(String(line.item_id)) || {};
      const quantity = Number(
        decision.adjusted_quantity ??
          line.recommended_quantity ??
          line.net_requirement,
      );
      const requiredDate = this.safeDate(
        decision.adjusted_required_by_date || line.required_by_date,
        today,
      );
      const proposedStartDate = this.safeDate(line.release_by_date, today);
      return {
        line,
        item,
        quantity,
        required_date: requiredDate,
        start_date:
          proposedStartDate <= requiredDate ? proposedStartDate : requiredDate,
      };
    });
    const readinessByLine = new Map<string, any>();
    for (const entry of normalized.filter(
      (candidate: any) => candidate.line.supply_action === "BUILD",
    )) {
      readinessByLine.set(
        String(entry.line.id),
        await this.readiness.assessBuild(tenantId, entry),
      );
    }
    await this.exceptions.syncReadiness(
      tenantId,
      plan.run,
      normalized
        .filter((entry: any) => entry.line.supply_action === "BUILD")
        .map((entry: any) => ({
          line: entry.line,
          readiness: readinessByLine.get(String(entry.line.id)),
        })),
    );
    const readinessBlocked = normalized
      .filter(
        (entry: any) =>
          entry.line.supply_action === "BUILD" &&
          !readinessByLine.get(String(entry.line.id))?.ready,
      )
      .map((entry: any) => ({
        line_id: entry.line.id,
        item_code: entry.line.item_code,
        item_name: entry.line.item_name,
        reason:
          readinessByLine.get(String(entry.line.id))?.reason ||
          "Build release readiness failed.",
        readiness: readinessByLine.get(String(entry.line.id)),
      }));
    blockedLines.push(...readinessBlocked);
    const packets: any[] = [];
    const buyLines = normalized.filter(
      (entry: any) => entry.line.supply_action === "BUY" && entry.quantity > 0,
    );
    if (buyLines.length) {
      const signature = buyLines.map((entry: any) => ({
        id: entry.line.id,
        quantity: entry.quantity,
        required_date: entry.required_date,
        vendor_id: entry.line.planner_decision?.preferred_supplier_id || null,
      }));
      const insightId = `mrp-buy-${this.hash({ run: plan.run.id, signature })}`;
      const requiredDate = buyLines
        .map((entry: any) => entry.required_date)
        .sort()[0];
      packets.push({
        insight_id: insightId,
        type: "BUY",
        title: `MRP ${plan.run.id}: release ${buyLines.length} approved material line(s) to a draft PR`,
        explanation:
          "Planner-approved BUY recommendations are grouped into one maker-checker release request.",
        recommendation:
          "Independently approve the request, then execute it to create a draft purchase requisition for native review.",
        route: "/dashboard/purchase/requisitions",
        line_ids: buyLines.map((entry: any) => entry.line.id),
        tool_code: "CREATE_PURCHASE_REQUISITION_DRAFT",
        input: {
          insight_id: insightId,
          department: "PRODUCTION",
          purpose: `MRP release ${plan.run.id}`,
          required_date: requiredDate,
          priority: "HIGH",
          remarks:
            "Generated from independently reviewed MRP recommendations; native PR remains DRAFT.",
          items: buyLines.map((entry: any) => ({
            item_id: entry.line.item_id,
            item_code: entry.line.item_code || entry.item.code,
            item_name: entry.line.item_name || entry.item.name,
            description: `MRP net requirement from run ${plan.run.id}`,
            uom: entry.item.uom || "NOS",
            requested_qty: entry.quantity,
            estimated_rate: Number(entry.item.standard_cost || 0),
            required_date: entry.required_date,
            vendor_id:
              entry.line.planner_decision?.preferred_supplier_id || null,
          })),
        },
      });
    }
    for (const entry of normalized.filter(
      (candidate: any) =>
        candidate.line.supply_action === "BUILD" &&
        candidate.quantity > 0 &&
        readinessByLine.get(String(candidate.line.id))?.ready,
    )) {
      const insightId = `mrp-build-${this.hash({
        run: plan.run.id,
        line: entry.line.id,
        quantity: entry.quantity,
        required_date: entry.required_date,
      })}`;
      packets.push({
        insight_id: insightId,
        type: "BUILD",
        title: `MRP ${plan.run.id}: build ${entry.quantity} ${entry.line.item_code || entry.item.code}`,
        explanation:
          "This planner-approved BUILD recommendation is staged for independent release approval.",
        recommendation:
          "Independently approve the request, then execute it to create a draft production job order.",
        route: "/dashboard/production/job-orders",
        line_ids: [entry.line.id],
        tool_code: "CREATE_PRODUCTION_JOB_ORDER_DRAFT",
        readiness: readinessByLine.get(String(entry.line.id)),
        input: {
          insight_id: insightId,
          item_id: entry.line.item_id,
          quantity: entry.quantity,
          start_date: entry.start_date,
          end_date: entry.required_date,
          priority: "HIGH",
          notes: `Governed MRP release from run ${plan.run.id}; native job order remains DRAFT.`,
        },
      });
    }
    for (const entry of normalized) {
      for (const intervention of supplyReviews(entry.line)) {
        const requiredDate = this.safeDate(
          intervention.required_date || entry.required_date,
          today,
        );
        const insightId = `mrp-supply-${this.hash({
          run: plan.run.id,
          line: entry.line.id,
          intervention,
        })}`;
        const documentNumber = String(
          intervention.document_number || intervention.document_id,
        );
        const isUnpegged =
          intervention.intervention_type === "REVIEW_UNPEGGED_SUPPLY";
        const verb = isUnpegged
          ? "review unpegged"
          : intervention.intervention_type === "CONFIRM_DATE"
            ? "confirm"
            : "reschedule";
        packets.push({
          insight_id: insightId,
          type: "SUPPLY_RESCHEDULE",
          title: `MRP ${plan.run.id}: ${verb} ${documentNumber}`,
          explanation: isUnpegged
            ? `${documentNumber} has ${intervention.quantity} unit(s) left after demand and safety-stock coverage through ${requiredDate}. Suggested action: ${String(intervention.suggested_action || "REVIEW").replaceAll("_", " ")}.`
            : `${documentNumber} has ${intervention.quantity} unit(s) pegged to ${entry.line.item_code || entry.line.item_name || "this material"} for ${requiredDate}.`,
          recommendation:
            "Independently approve and execute this request to create an auditable review task. The source document and its date remain unchanged until an authorized user updates it in the native workflow.",
          route:
            intervention.document_type === "PURCHASE_REQUISITION"
              ? "/dashboard/purchase/requisitions"
              : intervention.document_type === "PURCHASE_ORDER"
                ? "/dashboard/purchase/orders"
                : "/dashboard/production/job-orders",
          line_ids: [entry.line.id],
          tool_code: "CREATE_SUPPLY_RESCHEDULE_REVIEW",
          intervention,
          input: {
            insight_id: insightId,
            run_id: plan.run.id,
            line_id: entry.line.id,
            intervention_type: intervention.intervention_type,
            document_type: intervention.document_type,
            document_id: intervention.document_id,
            document_number: documentNumber,
            document_line_id: intervention.document_line_id || null,
            quantity: intervention.quantity,
            current_date: intervention.current_date || null,
            required_date: requiredDate,
            notes: `MRP ${plan.run.id}: ${
              isUnpegged
                ? `review ${intervention.quantity} unpegged unit(s), reason ${intervention.review_reason || "UNPEGGED_SUPPLY"}`
                : intervention.intervention_type === "CONFIRM_DATE"
                  ? "confirm supply date"
                  : `review movement from ${intervention.current_date || "undated"} to ${requiredDate}`
            } for ${documentNumber}. Review only; do not change the source without native authorization.`,
          },
        });
      }
    }
    const tracedPackets = await this.attachGovernance(tenantId, packets);
    return {
      run: {
        id: plan.run.id,
        run_at: plan.run.run_at,
        shortage_lines: plan.run.shortage_lines,
      },
      summary: {
        selected_lines: considered.length,
        eligible_lines: eligible.length,
        releasable_lines: eligible.length - readinessBlocked.length,
        blocked_lines: blockedLines.length,
        buy_packets: packets.filter((packet) => packet.type === "BUY").length,
        build_packets: packets.filter((packet) => packet.type === "BUILD")
          .length,
        supply_reschedule_packets: packets.filter(
          (packet) => packet.type === "SUPPLY_RESCHEDULE",
        ).length,
        native_documents_created: tracedPackets.filter(
          (packet) => packet.governance?.status === "EXECUTED",
        ).length,
      },
      packets: tracedPackets,
      blocked_lines: blockedLines,
      confirmation_required: true,
      control:
        "Preview only. Submission creates maker-checker requests, not PRs, job orders or date changes. New-supply drafts and reschedule review tasks exist only after independent approval and explicit execution.",
    };
  }

  async request(tenantId: string, user: any, body: any, request: any) {
    if (body?.confirm !== true)
      throw new BadRequestException(
        "Explicit confirmation is required to submit MRP release requests.",
      );
    const preview: any = await this.preview(tenantId, body?.selected_line_ids);
    if (!preview.packets.length)
      throw new BadRequestException(
        "No approved new-supply or document-level intervention is eligible for release.",
      );
    for (const packet of preview.packets) {
      const tool = this.registry.require(packet.tool_code);
      this.registry.authorize(tool, user);
      this.registry.validate(tool, packet.input);
    }
    const now = new Date().toISOString();
    const exceptionRows = preview.packets.map((packet: any) => ({
      tenant_id: tenantId,
      source_key: packet.insight_id,
      source_type: "MRP_RELEASE",
      source_route: packet.route,
      title: packet.title,
      explanation: packet.explanation,
      recommendation: packet.recommendation,
      severity: "HIGH",
      priority_score: 88,
      confidence: "HIGH",
      evidence: {
        run_id: preview.run.id,
        line_ids: packet.line_ids,
        release_type: packet.type,
        readiness: packet.readiness || null,
        intervention: packet.intervention || null,
      },
      last_seen_at: now,
      updated_at: now,
    }));
    const sync = await this.db
      .from("mizantra_exception_register")
      .upsert(exceptionRows, { onConflict: "tenant_id,source_key" });
    if (sync.error) throw new BadRequestException(sync.error.message);
    const requests = preview.packets
      .filter((packet: any) => packet.governance)
      .map((packet: any) => ({
        action_request: packet.governance,
        reused: true,
        requires_approval: packet.governance.status === "PENDING_APPROVAL",
      }));
    for (const packet of preview.packets) {
      if (!packet.can_submit) continue;
      requests.push(
        await this.governedActions.request(
          tenantId,
          user,
          packet.tool_code,
          packet.input,
          request,
        ),
      );
    }
    return {
      requests,
      summary: {
        submitted: requests.filter((entry: any) => !entry.reused).length,
        reused: requests.filter((entry: any) => entry.reused).length,
        native_documents_created: requests.filter(
          (entry: any) => entry.action_request?.status === "EXECUTED",
        ).length,
      },
      safe_note: requests.some((entry: any) => !entry.reused)
        ? "New MRP release requests are waiting for independent approval. Existing requests were reused and no duplicate native document was created."
        : "Every selected release packet already has a governed request. No duplicate request or native document was created.",
    };
  }
}
