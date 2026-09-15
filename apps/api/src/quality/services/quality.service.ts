import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { SupabaseClient } from "@supabase/supabase-js";

const PLAN_TYPES = ["INCOMING", "IN_PROCESS", "FINAL"] as const;
const SAMPLING_METHODS = ["FIXED", "PERCENTAGE", "FULL", "AQL"] as const;
const PARAMETER_TYPES = ["NUMERIC", "TEXT", "PASS_FAIL"] as const;
const CRITICALITIES = ["MINOR", "MAJOR", "CRITICAL"] as const;

export function planIsEffective(plan: any, inspectionDate: string): boolean {
  const date = String(inspectionDate || "").slice(0, 10);
  return Boolean(
    plan?.status === "APPROVED" &&
    date &&
    String(plan.effective_from || "").slice(0, 10) <= date &&
    (!plan.effective_to || String(plan.effective_to).slice(0, 10) >= date),
  );
}

export function evaluateInspectionParameter(parameter: any, input: any) {
  const dataType = String(
    parameter?.data_type || parameter?.parameter_type || "TEXT",
  ).toUpperCase();
  const measuredValue = String(input?.measured_value ?? "").trim();
  const explicitResult = String(input?.result || "").toUpperCase();
  if (
    parameter?.is_mandatory !== false &&
    !measuredValue &&
    dataType !== "PASS_FAIL"
  ) {
    throw new BadRequestException(
      `${parameter?.parameter_name || "Inspection parameter"} requires a measured value.`,
    );
  }
  if (dataType === "NUMERIC") {
    const measured = Number(measuredValue);
    if (!Number.isFinite(measured)) {
      throw new BadRequestException(
        `${parameter?.parameter_name || "Inspection parameter"} requires a numeric measured value.`,
      );
    }
    const min =
      parameter?.tolerance_min == null ? null : Number(parameter.tolerance_min);
    const max =
      parameter?.tolerance_max == null ? null : Number(parameter.tolerance_max);
    const result =
      (min == null || measured >= min) && (max == null || measured <= max)
        ? "PASS"
        : "FAIL";
    const deviation =
      min != null && measured < min
        ? measured - min
        : max != null && measured > max
          ? measured - max
          : 0;
    return { measured_value: measuredValue, result, deviation };
  }
  if (!["PASS", "FAIL", "NA"].includes(explicitResult)) {
    throw new BadRequestException(
      `${parameter?.parameter_name || "Inspection parameter"} requires PASS, FAIL or NA.`,
    );
  }
  if (parameter?.is_mandatory !== false && explicitResult === "NA") {
    throw new BadRequestException(
      `${parameter?.parameter_name || "Inspection parameter"} is mandatory and cannot be NA.`,
    );
  }
  return {
    measured_value: measuredValue || null,
    result: explicitResult,
    deviation: null,
  };
}

export function validateInspectionPlanInput(data: any) {
  const inspectionType = String(data?.inspection_type || "").toUpperCase();
  const samplingMethod = String(data?.sampling_method || "FIXED").toUpperCase();
  const planCode = String(data?.plan_code || "")
    .trim()
    .toUpperCase();
  const planName = String(data?.plan_name || "").trim();
  const revision = Number(data?.revision || 1);
  const sampleSize = Number(data?.sample_size || 0);
  const effectiveFrom = String(data?.effective_from || "").slice(0, 10);
  const effectiveTo = data?.effective_to
    ? String(data.effective_to).slice(0, 10)
    : null;
  const parameters = Array.isArray(data?.parameters) ? data.parameters : [];

  if (!planCode || !planName)
    throw new BadRequestException("Plan code and name are required.");
  if (!PLAN_TYPES.includes(inspectionType as any))
    throw new BadRequestException("Select a valid inspection type.");
  if (!SAMPLING_METHODS.includes(samplingMethod as any))
    throw new BadRequestException("Select a valid sampling method.");
  if (!Number.isInteger(revision) || revision < 1)
    throw new BadRequestException("Revision must be a positive whole number.");
  if (!effectiveFrom || (effectiveTo && effectiveTo < effectiveFrom))
    throw new BadRequestException("Enter a valid effective date range.");
  if (
    !Number.isFinite(sampleSize) ||
    sampleSize <= 0 ||
    (samplingMethod === "PERCENTAGE" && sampleSize > 100)
  ) {
    throw new BadRequestException(
      "Enter a valid sample size (percentage cannot exceed 100).",
    );
  }
  if (!parameters.length)
    throw new BadRequestException(
      "At least one inspection parameter is required.",
    );

  const normalizedParameters = parameters.map(
    (parameter: any, index: number) => {
      const name = String(parameter?.parameter_name || "").trim();
      const specification = String(parameter?.specification || "").trim();
      const dataType = String(parameter?.data_type || "NUMERIC").toUpperCase();
      const criticality = String(
        parameter?.criticality || "MAJOR",
      ).toUpperCase();
      const min =
        parameter?.tolerance_min === "" || parameter?.tolerance_min == null
          ? null
          : Number(parameter.tolerance_min);
      const max =
        parameter?.tolerance_max === "" || parameter?.tolerance_max == null
          ? null
          : Number(parameter.tolerance_max);
      if (!name || !specification)
        throw new BadRequestException(
          `Parameter ${index + 1} requires a name and specification.`,
        );
      if (
        !PARAMETER_TYPES.includes(dataType as any) ||
        !CRITICALITIES.includes(criticality as any)
      )
        throw new BadRequestException(
          `Parameter ${index + 1} has an invalid type or criticality.`,
        );
      if (
        (min != null && !Number.isFinite(min)) ||
        (max != null && !Number.isFinite(max)) ||
        (min != null && max != null && max < min)
      ) {
        throw new BadRequestException(
          `Parameter ${index + 1} has an invalid tolerance range.`,
        );
      }
      return {
        sequence_number: index + 1,
        parameter_name: name,
        data_type: dataType,
        specification,
        unit_of_measure:
          String(parameter?.unit_of_measure || "").trim() || null,
        tolerance_min: min,
        tolerance_max: max,
        criticality,
        is_mandatory: parameter?.is_mandatory !== false,
      };
    },
  );

  return {
    planCode,
    planName,
    inspectionType,
    samplingMethod,
    revision,
    sampleSize,
    effectiveFrom,
    effectiveTo,
    parameters: normalizedParameters,
  };
}

@Injectable()
export class QualityService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = new SupabaseClient(
      process.env.SUPABASE_URL || "",
      process.env.SUPABASE_KEY || "",
    );
  }

  // ==================== Quality Inspections ====================

  async getInspectionPlans(tenantId: string, filters?: any) {
    let query = this.supabase
      .from("quality_inspection_plans")
      .select("*, parameters:quality_inspection_plan_parameters(*)")
      .eq("tenant_id", tenantId)
      .order("plan_code")
      .order("revision", { ascending: false });
    if (filters?.status)
      query = query.eq("status", String(filters.status).toUpperCase());
    if (filters?.inspection_type)
      query = query.eq(
        "inspection_type",
        String(filters.inspection_type).toUpperCase(),
      );
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return (data || []).map((plan: any) => ({
      ...plan,
      parameters: [...(plan.parameters || [])].sort(
        (a: any, b: any) => a.sequence_number - b.sequence_number,
      ),
    }));
  }

  async createInspectionPlan(tenantId: string, userId: string, data: any) {
    const input = validateInspectionPlanInput(data);
    const { data: plan, error } = await this.supabase
      .from("quality_inspection_plans")
      .insert({
        tenant_id: tenantId,
        plan_code: input.planCode,
        plan_name: input.planName,
        inspection_type: input.inspectionType,
        item_id: data.item_id || null,
        revision: input.revision,
        effective_from: input.effectiveFrom,
        effective_to: input.effectiveTo,
        sampling_method: input.samplingMethod,
        sample_size: input.sampleSize,
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);

    const { error: parameterError } = await this.supabase
      .from("quality_inspection_plan_parameters")
      .insert(
        input.parameters.map((parameter) => ({
          ...parameter,
          tenant_id: tenantId,
          plan_id: plan.id,
        })),
      );
    if (parameterError) {
      await this.supabase
        .from("quality_inspection_plans")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("id", plan.id)
        .eq("status", "DRAFT");
      throw new BadRequestException(parameterError.message);
    }
    return this.getInspectionPlan(tenantId, plan.id);
  }

  async getInspectionPlan(tenantId: string, planId: string) {
    const { data, error } = await this.supabase
      .from("quality_inspection_plans")
      .select("*, parameters:quality_inspection_plan_parameters(*)")
      .eq("tenant_id", tenantId)
      .eq("id", planId)
      .maybeSingle();
    if (error || !data)
      throw new NotFoundException("Inspection plan not found.");
    return {
      ...data,
      parameters: [...(data.parameters || [])].sort(
        (a: any, b: any) => a.sequence_number - b.sequence_number,
      ),
    };
  }

  async approveInspectionPlan(
    tenantId: string,
    userId: string,
    planId: string,
    data: any,
  ) {
    const plan = await this.getInspectionPlan(tenantId, planId);
    const note = String(data?.approval_note || "").trim();
    if (plan.status !== "DRAFT")
      throw new BadRequestException("Only a draft plan can be approved.");
    if (plan.created_by === userId)
      throw new BadRequestException(
        "Independent approval is required; the creator cannot approve this plan.",
      );
    if (!note) throw new BadRequestException("Approval rationale is required.");
    if (!(plan.parameters || []).length)
      throw new BadRequestException(
        "At least one inspection parameter is required.",
      );

    const { data: approved, error } = await this.supabase
      .from("quality_inspection_plans")
      .update({
        status: "APPROVED",
        approval_note: note,
        approved_by: userId,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", planId)
      .eq("status", "DRAFT")
      .select()
      .maybeSingle();
    if (error || !approved)
      throw new BadRequestException(
        error?.message || "Inspection plan approval did not complete.",
      );
    return approved;
  }

  async retireInspectionPlan(tenantId: string, userId: string, planId: string) {
    const { data, error } = await this.supabase
      .from("quality_inspection_plans")
      .update({
        status: "RETIRED",
        retired_by: userId,
        retired_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", planId)
      .eq("status", "APPROVED")
      .select()
      .maybeSingle();
    if (error || !data)
      throw new BadRequestException(
        error?.message || "Only an approved plan can be retired.",
      );
    return data;
  }

  async createInspection(tenantId: string, userId: string, data: any) {
    const inspectedQuantity = Number(data.inspected_quantity);
    if (!Number.isFinite(inspectedQuantity) || inspectedQuantity <= 0) {
      throw new BadRequestException(
        "Inspected quantity must be greater than zero.",
      );
    }
    const inspectionNumber = await this.generateInspectionNumber(
      tenantId,
      data.inspection_type,
    );
    const inspectionDate =
      data.inspection_date || new Date().toISOString().split("T")[0];
    const plan = await this.resolveInspectionPlan(
      tenantId,
      data,
      inspectionDate,
    );

    const inspectionData = {
      tenant_id: tenantId,
      inspection_number: inspectionNumber,
      inspection_type: data.inspection_type,
      inspection_date: inspectionDate,
      status: "PENDING",
      grn_id: data.grn_id || null,
      production_order_id: data.production_order_id || null,
      uid: data.uid || null,
      item_id: data.item_id,
      item_name: data.item_name,
      item_code: data.item_code,
      vendor_id: data.vendor_id || null,
      vendor_name: data.vendor_name || null,
      batch_number: data.batch_number,
      lot_number: data.lot_number,
      inspected_quantity: inspectedQuantity,
      inspector_id: userId,
      inspector_name: data.inspector_name,
      inspection_checklist: data.inspection_checklist,
      inspection_plan_id: plan?.id || null,
      inspection_plan_revision: plan?.revision || null,
      inspection_plan_snapshot: plan
        ? {
            plan_code: plan.plan_code,
            plan_name: plan.plan_name,
            revision: plan.revision,
            inspection_type: plan.inspection_type,
            sampling_method: plan.sampling_method,
            sample_size: plan.sample_size,
            parameters: plan.parameters || [],
          }
        : null,
      created_by: userId,
    };

    const { data: inspection, error } = await this.supabase
      .from("quality_inspections")
      .insert(inspectionData)
      .select()
      .single();

    if (error) {
      console.error("Database error:", error);
      throw new BadRequestException(error.message);
    }

    const executionParameters =
      data.parameters && data.parameters.length > 0
        ? data.parameters
        : (plan?.parameters || []).map((parameter: any) => ({
            ...parameter,
            plan_parameter_id: parameter.id,
            parameter_type: parameter.data_type,
            measured_value: null,
            result: null,
          }));
    if (executionParameters.length > 0) {
      await this.addInspectionParameters(
        tenantId,
        inspection.id,
        executionParameters,
      );
    }

    return inspection;
  }

  async getInspections(tenantId: string, filters?: any) {
    let query = this.supabase
      .from("quality_inspections")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("inspection_date", { ascending: false });

    if (filters?.inspection_type) {
      query = query.eq("inspection_type", filters.inspection_type);
    }
    if (filters?.status) {
      query = query.eq("status", filters.status);
    }
    if (filters?.vendor_id) {
      query = query.eq("vendor_id", filters.vendor_id);
    }
    if (filters?.uid) {
      query = query.eq("uid", filters.uid);
    }

    const { data, error } = await query;

    if (error) throw new BadRequestException(error.message);

    return data;
  }

  async getInspectionById(tenantId: string, inspectionId: string) {
    const { data, error } = await this.supabase
      .from("quality_inspections")
      .select(
        `
        *,
        parameters:inspection_parameters(*),
        defects:inspection_defects(*),
        ncr:ncr(*)
      `,
      )
      .eq("tenant_id", tenantId)
      .eq("id", inspectionId)
      .single();

    if (error) throw new NotFoundException("Inspection not found");

    return data;
  }

  async updateInspection(tenantId: string, inspectionId: string, data: any) {
    const updateData = {
      inspection_type: data.inspection_type,
      inspection_date: data.inspection_date,
      grn_id: data.grn_id,
      production_order_id: data.production_order_id,
      uid: data.uid,
      item_id: data.item_id,
      item_name: data.item_name,
      item_code: data.item_code,
      vendor_id: data.vendor_id,
      vendor_name: data.vendor_name,
      batch_number: data.batch_number,
      lot_number: data.lot_number,
      inspected_quantity: data.inspected_quantity,
      inspector_id: data.inspector_id,
      inspector_name: data.inspector_name,
      inspection_checklist: data.inspection_checklist,
      remarks: data.remarks,
      updated_at: new Date().toISOString(),
    };

    const { data: inspection, error } = await this.supabase
      .from("quality_inspections")
      .update(updateData)
      .eq("tenant_id", tenantId)
      .eq("id", inspectionId)
      .eq("status", "PENDING") // Only allow updates for pending inspections
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    return inspection;
  }

  async deleteInspection(tenantId: string, inspectionId: string) {
    // Only allow deletion of pending inspections
    const { data: inspection, error: fetchError } = await this.supabase
      .from("quality_inspections")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("id", inspectionId)
      .single();

    if (fetchError) throw new NotFoundException("Inspection not found");
    if (inspection.status !== "PENDING") {
      throw new BadRequestException("Only pending inspections can be deleted");
    }

    const { error } = await this.supabase
      .from("quality_inspections")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", inspectionId);

    if (error) throw new BadRequestException(error.message);

    return { message: "Inspection deleted successfully" };
  }

  async completeInspection(
    tenantId: string,
    userId: string,
    inspectionId: string,
    data: any,
  ) {
    // Get inspection details
    const { data: inspection, error: fetchError } = await this.supabase
      .from("quality_inspections")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", inspectionId)
      .single();

    if (fetchError) throw new NotFoundException("Inspection not found");
    if (inspection.status !== "PENDING")
      throw new BadRequestException(
        "Only a pending inspection can be completed.",
      );

    const { data: executionRows, error: executionError } = await this.supabase
      .from("inspection_parameters")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("inspection_id", inspectionId)
      .order("sequence_number", { ascending: true });
    if (executionError) throw new BadRequestException(executionError.message);
    const resultById = new Map(
      (Array.isArray(data.parameter_results) ? data.parameter_results : []).map(
        (result: any) => [String(result?.id || ""), result],
      ),
    );
    const evaluatedRows: any[] = [];
    for (const parameter of executionRows || []) {
      const input = resultById.get(String(parameter.id)) || parameter;
      const evaluated = evaluateInspectionParameter(parameter, input);
      const { error: resultError } = await this.supabase
        .from("inspection_parameters")
        .update({
          ...evaluated,
          remarks: input?.remarks ?? parameter.remarks,
          evaluated_at: new Date().toISOString(),
          evaluated_by: userId,
        })
        .eq("tenant_id", tenantId)
        .eq("inspection_id", inspectionId)
        .eq("id", parameter.id);
      if (resultError) throw new BadRequestException(resultError.message);
      evaluatedRows.push({ ...parameter, ...evaluated });
    }

    const accepted = Number(data.quantity_accepted || 0);
    const rejected = Number(data.quantity_rejected || 0);
    const onHold = Number(data.quantity_on_hold || 0);
    if (
      ![accepted, rejected, onHold].every(
        (value) => Number.isFinite(value) && value >= 0,
      )
    ) {
      throw new BadRequestException(
        "Accepted, rejected and on-hold quantities must be non-negative numbers.",
      );
    }
    const totalQty = accepted + rejected + onHold;
    if (
      Math.abs(totalQty - Number(inspection.inspected_quantity || 0)) > 0.0001
    ) {
      throw new BadRequestException(
        `Accepted + rejected + on hold must equal inspected quantity ${inspection.inspected_quantity}.`,
      );
    }
    const hasFailedParameter = evaluatedRows.some(
      (parameter) => parameter.result === "FAIL",
    );
    if (
      String(data.inspection_status || "").toUpperCase() === "PASSED" &&
      (hasFailedParameter || rejected > 0 || onHold > 0)
    ) {
      throw new BadRequestException(
        "A passed inspection cannot contain failed parameters, rejected quantity or on-hold quantity.",
      );
    }

    // Calculate defect rate
    const defectRate = totalQty > 0 ? (rejected / totalQty) * 100 : 0;

    // Update inspection
    const updateData = {
      status: data.inspection_status,
      accepted_quantity: accepted,
      rejected_quantity: rejected,
      on_hold_quantity: onHold,
      defect_rate: defectRate,
      inspector_remarks: data.inspector_remarks,
      completion_date: new Date().toISOString().split("T")[0],
      completed_by: userId,
      updated_at: new Date().toISOString(),
    };

    const { data: updatedInspection, error: updateError } = await this.supabase
      .from("quality_inspections")
      .update(updateData)
      .eq("tenant_id", tenantId)
      .eq("id", inspectionId)
      .eq("status", "PENDING")
      .select()
      .maybeSingle();

    if (updateError || !updatedInspection)
      throw new BadRequestException(
        updateError?.message ||
          "Inspection was already completed by another user.",
      );

    // Generate NCR if requested
    if (data.generate_ncr && data.ncr_description) {
      await this.createNCRFromInspection(
        tenantId,
        { ...inspection, ...updatedInspection },
        { description: data.ncr_description },
      );
    }

    return updatedInspection;
  }

  async addInspectionParameters(
    tenantId: string,
    inspectionId: string,
    parameters: any[],
  ) {
    await this.requirePendingInspection(tenantId, inspectionId);
    const parameterData = parameters.map((param) => ({
      tenant_id: tenantId,
      inspection_id: inspectionId,
      plan_parameter_id: param.plan_parameter_id || null,
      sequence_number: param.sequence_number || null,
      parameter_name: param.parameter_name,
      parameter_type: param.parameter_type,
      data_type: param.data_type || param.parameter_type || "TEXT",
      specification: param.specification,
      measured_value: param.measured_value,
      unit_of_measure: param.unit_of_measure,
      tolerance_min: param.tolerance_min,
      tolerance_max: param.tolerance_max,
      result: param.result,
      deviation: param.deviation,
      criticality: param.criticality || "MAJOR",
      is_mandatory: param.is_mandatory !== false,
      remarks: param.remarks,
    }));

    const { error } = await this.supabase
      .from("inspection_parameters")
      .insert(parameterData);

    if (error) throw new BadRequestException(error.message);
  }

  async addInspectionDefects(
    tenantId: string,
    inspectionId: string,
    defects: any[],
  ) {
    await this.requirePendingInspection(tenantId, inspectionId);
    const defectData = defects.map((defect) => ({
      inspection_id: inspectionId,
      defect_code: defect.defect_code,
      defect_description: defect.defect_description,
      defect_category: defect.defect_category,
      severity: defect.severity,
      location: defect.location,
      quantity_affected: defect.quantity_affected,
      root_cause: defect.root_cause,
      corrective_action: defect.corrective_action,
    }));

    const { error } = await this.supabase
      .from("inspection_defects")
      .insert(defectData);

    if (error) throw new BadRequestException(error.message);
  }

  // ==================== NCR Management ====================

  async createNCR(tenantId: string, userId: string, data: any) {
    const ncrNumber = await this.generateNCRNumber(tenantId);

    // Map frontend field names to backend
    const ncrData = {
      tenant_id: tenantId,
      ncr_number: ncrNumber,
      inspection_id: data.inspection_id || data.reference_id || null,
      ncr_date: data.ncr_date || new Date().toISOString().split("T")[0],
      status: "OPEN",
      nonconformance_type:
        data.nonconformance_type || data.related_to || "MATERIAL",
      description: data.description || data.issue_description,
      item_id: data.item_id,
      item_name: data.item_name,
      uid: data.uid,
      vendor_id: data.vendor_id,
      production_order_id: data.production_order_id,
      quantity_affected: data.quantity_affected,
      root_cause: data.root_cause,
      immediate_action: data.immediate_action,
      containment_action: data.containment_action,
      corrective_action_plan: data.corrective_action,
      preventive_action_plan: data.preventive_action,
      cost_impact: data.cost_impact || 0,
      raised_by: userId,
    };

    const { data: ncr, error } = await this.supabase
      .from("ncr")
      .insert(ncrData)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    // Update inspection with NCR link if applicable
    if (data.inspection_id) {
      await this.supabase
        .from("quality_inspections")
        .update({ ncr_generated: true, ncr_id: ncr.id })
        .eq("tenant_id", tenantId)
        .eq("id", data.inspection_id);
    }

    return ncr;
  }

  async createNCRFromInspection(
    tenantId: string,
    inspection: any,
    ncrDetails: any,
  ) {
    const ncrData = {
      tenant_id: tenantId,
      inspection_id: inspection.id,
      nonconformance_type: "MATERIAL",
      description:
        ncrDetails?.description ||
        `Failed inspection ${inspection.inspection_number}`,
      item_id: inspection.item_id,
      item_name: inspection.item_name,
      uid: inspection.uid,
      vendor_id: inspection.vendor_id,
      quantity_affected: inspection.rejected_quantity,
      immediate_action:
        ncrDetails?.immediate_action || "Item segregated and placed on hold",
      containment_action: "Material quarantined pending disposition",
      root_cause: "To be determined through investigation",
    };

    return this.createNCR(tenantId, inspection.created_by, ncrData);
  }

  async getNCRs(tenantId: string, filters?: any) {
    let query = this.supabase
      .from("ncr")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("ncr_date", { ascending: false });

    if (filters?.status) {
      query = query.eq("status", filters.status);
    }
    if (filters?.nonconformance_type) {
      query = query.eq("nonconformance_type", filters.nonconformance_type);
    }
    if (filters?.vendor_id) {
      query = query.eq("vendor_id", filters.vendor_id);
    }

    const { data, error } = await query;

    if (error) throw new BadRequestException(error.message);

    return data;
  }

  async getNCRById(tenantId: string, ncrId: string) {
    const { data, error } = await this.supabase
      .from("ncr")
      .select(
        `
        *,
        inspection:quality_inspections(*)
      `,
      )
      .eq("tenant_id", tenantId)
      .eq("id", ncrId)
      .single();

    if (error) throw new NotFoundException("NCR not found");

    return data;
  }

  async updateNCR(tenantId: string, ncrId: string, data: any) {
    const { data: ncr, error } = await this.supabase
      .from("ncr")
      .update({
        ...data,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", ncrId)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    return ncr;
  }

  async closeNCR(tenantId: string, ncrId: string, userId: string, data: any) {
    const { data: ncr, error } = await this.supabase
      .from("ncr")
      .update({
        status: "CLOSED",
        closure_date:
          data.closure_date || new Date().toISOString().split("T")[0],
        closed_by: userId,
        closure_remarks: data.closure_remarks,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", ncrId)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    return ncr;
  }

  // ==================== Quality Analytics ====================

  async getVendorQualityRatings(tenantId: string, vendorId?: string) {
    // Get all completed incoming inspections grouped by vendor
    const { data: inspections, error: inspError } = await this.supabase
      .from("quality_inspections")
      .select(
        "vendor_id, vendor_name, status, rejected_quantity, inspected_quantity",
      )
      .eq("tenant_id", tenantId)
      .eq("inspection_type", "INCOMING")
      .not("vendor_id", "is", null)
      .in("status", ["PASSED", "FAILED"]);

    if (inspError) throw new BadRequestException(inspError.message);
    if (!inspections || inspections.length === 0) return [];

    // Group by vendor
    const vendorStats: Record<string, any> = {};

    inspections.forEach((inspection) => {
      const vId = inspection.vendor_id;
      if (!vId) return;

      if (!vendorStats[vId]) {
        vendorStats[vId] = {
          vendor_name: inspection.vendor_name || "Unknown Vendor",
          total_inspections: 0,
          passed_inspections: 0,
          total_defects: 0,
          total_quantity: 0,
        };
      }

      vendorStats[vId].total_inspections++;
      if (inspection.status === "PASSED") {
        vendorStats[vId].passed_inspections++;
      }
      vendorStats[vId].total_defects += Number(
        inspection.rejected_quantity || 0,
      );
      vendorStats[vId].total_quantity += Number(
        inspection.inspected_quantity || 0,
      );
    });

    // Get NCR counts per vendor
    const { data: ncrs } = await this.supabase
      .from("ncr")
      .select("vendor_id")
      .eq("tenant_id", tenantId)
      .not("vendor_id", "is", null);

    const ncrCounts: Record<string, number> = {};
    ncrs?.forEach((ncr) => {
      if (ncr.vendor_id) {
        ncrCounts[ncr.vendor_id] = (ncrCounts[ncr.vendor_id] || 0) + 1;
      }
    });

    // Calculate ratings
    const ratings = Object.entries(vendorStats).map(([vendorId, stats]) => {
      const passRate =
        stats.total_inspections > 0
          ? (stats.passed_inspections / stats.total_inspections) * 100
          : 0;

      const defectRatePpm =
        stats.total_quantity > 0
          ? (stats.total_defects / stats.total_quantity) * 1000000
          : 0;

      const ncrCount = ncrCounts[vendorId] || 0;

      // Quality score calculation
      const passRateScore = passRate;
      const defectScore = Math.max(0, 100 - defectRatePpm / 100);
      const ncrPenalty = Math.max(0, 100 - ncrCount * 10);
      const qualityScore =
        passRateScore * 0.5 + defectScore * 0.3 + ncrPenalty * 0.2;

      let qualityGrade = "F";
      if (qualityScore >= 95) qualityGrade = "A+";
      else if (qualityScore >= 90) qualityGrade = "A";
      else if (qualityScore >= 80) qualityGrade = "B";
      else if (qualityScore >= 70) qualityGrade = "C";
      else if (qualityScore >= 60) qualityGrade = "D";

      return {
        vendor_name: stats.vendor_name,
        total_inspections: stats.total_inspections,
        passed_inspections: stats.passed_inspections,
        pass_rate: passRate,
        total_defects: stats.total_defects,
        defect_rate_ppm: defectRatePpm,
        ncr_count: ncrCount,
        quality_score: qualityScore,
        quality_grade: qualityGrade,
      };
    });

    return ratings.sort((a, b) => b.quality_score - a.quality_score);
  }

  async calculateVendorQualityRating(
    tenantId: string,
    vendorId: string,
    periodStart: string,
    periodEnd: string,
  ) {
    // Get inspections for vendor in period
    const { data: inspections, error: inspError } = await this.supabase
      .from("quality_inspections")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("vendor_id", vendorId)
      .eq("inspection_type", "INCOMING")
      .gte("inspection_date", periodStart)
      .lte("inspection_date", periodEnd);

    if (inspError) throw new BadRequestException(inspError.message);

    const totalInspections = inspections.length;
    const passedInspections = inspections.filter(
      (i) => i.status === "PASSED",
    ).length;
    const failedInspections = inspections.filter(
      (i) => i.status === "FAILED" || i.status === "REJECTED",
    ).length;
    const passRate =
      totalInspections > 0 ? (passedInspections / totalInspections) * 100 : 0;

    // Get defects
    const totalDefects = inspections.reduce(
      (sum, i) => sum + (i.defect_count || 0),
      0,
    );
    const totalQuantity = inspections.reduce(
      (sum, i) => sum + (i.inspected_quantity || 0),
      0,
    );
    const defectRate =
      totalQuantity > 0 ? (totalDefects / totalQuantity) * 1000000 : 0; // PPM

    // Get NCRs
    const { data: ncrs, error: ncrError } = await this.supabase
      .from("ncr")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("vendor_id", vendorId)
      .gte("ncr_date", periodStart)
      .lte("ncr_date", periodEnd);

    if (ncrError) throw new BadRequestException(ncrError.message);

    const totalNCRs = ncrs.length;
    const openNCRs = ncrs.filter((n) => n.status !== "CLOSED").length;

    // Calculate quality score (weighted)
    const passRateScore = passRate; // 0-100
    const defectRateScore = Math.max(0, 100 - defectRate / 100); // Lower is better
    const ncrScore = Math.max(0, 100 - totalNCRs * 10); // Penalty for NCRs

    const qualityScore =
      passRateScore * 0.5 + defectRateScore * 0.3 + ncrScore * 0.2;

    // Determine grade
    let ratingGrade = "F";
    if (qualityScore >= 95) ratingGrade = "A+";
    else if (qualityScore >= 90) ratingGrade = "A";
    else if (qualityScore >= 80) ratingGrade = "B";
    else if (qualityScore >= 70) ratingGrade = "C";
    else if (qualityScore >= 60) ratingGrade = "D";

    // Get vendor name
    const { data: vendor } = await this.supabase
      .from("vendors")
      .select("vendor_name")
      .eq("id", vendorId)
      .single();

    const ratingData = {
      tenant_id: tenantId,
      vendor_id: vendorId,
      vendor_name: vendor?.vendor_name || "",
      rating_period_start: periodStart,
      rating_period_end: periodEnd,
      total_inspections: totalInspections,
      passed_inspections: passedInspections,
      failed_inspections: failedInspections,
      pass_rate: passRate,
      total_defects: totalDefects,
      defect_rate: defectRate,
      total_ncrs: totalNCRs,
      open_ncrs: openNCRs,
      quality_score: qualityScore,
      rating_grade: ratingGrade,
    };

    const { data: rating, error } = await this.supabase
      .from("vendor_quality_rating")
      .insert(ratingData)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    return rating;
  }

  async getQualityDashboard(tenantId: string) {
    // Get inspection summary
    const { data: inspections } = await this.supabase
      .from("quality_inspections")
      .select("status, inspection_type")
      .eq("tenant_id", tenantId);

    const inspectionSummary = {
      total: inspections?.length || 0,
      passed: inspections?.filter((i) => i.status === "PASSED").length || 0,
      failed: inspections?.filter((i) => i.status === "FAILED").length || 0,
      pending: inspections?.filter((i) => i.status === "PENDING").length || 0,
      by_type: {
        incoming:
          inspections?.filter((i) => i.inspection_type === "INCOMING").length ||
          0,
        in_process:
          inspections?.filter((i) => i.inspection_type === "IN_PROCESS")
            .length || 0,
        final:
          inspections?.filter((i) => i.inspection_type === "FINAL").length || 0,
      },
    };

    // Get NCR summary
    const { data: ncrs } = await this.supabase
      .from("ncr")
      .select("status, nonconformance_type")
      .eq("tenant_id", tenantId);

    const ncrSummary = {
      total: ncrs?.length || 0,
      open:
        ncrs?.filter((n) =>
          ["OPEN", "UNDER_REVIEW", "ACTION_PLANNED", "IN_PROGRESS"].includes(
            n.status,
          ),
        ).length || 0,
      closed: ncrs?.filter((n) => n.status === "CLOSED").length || 0,
      by_type: {
        material:
          ncrs?.filter((n) => n.nonconformance_type === "MATERIAL").length || 0,
        process:
          ncrs?.filter((n) => n.nonconformance_type === "PROCESS").length || 0,
        product:
          ncrs?.filter((n) => n.nonconformance_type === "PRODUCT").length || 0,
      },
    };

    // Get top defect categories
    const { data: defects } = await this.supabase
      .from("inspection_defects")
      .select(
        "defect_category, inspection:quality_inspections!inner(tenant_id)",
      )
      .eq("inspection.tenant_id", tenantId);

    const defectCounts: Record<string, number> = {};
    defects?.forEach((d) => {
      if (d.defect_category) {
        defectCounts[d.defect_category] =
          (defectCounts[d.defect_category] || 0) + 1;
      }
    });

    const topDefects = Object.entries(defectCounts)
      .map(([defect_type, count]) => ({ defect_type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Calculate pass rate
    const totalInspections = inspectionSummary.total;
    const passRate =
      totalInspections > 0
        ? (inspectionSummary.passed / totalInspections) * 100
        : 0;

    return {
      total_inspections: inspectionSummary.total,
      passed_inspections: inspectionSummary.passed,
      failed_inspections: inspectionSummary.failed,
      pass_rate: passRate,
      open_ncrs: ncrSummary.open,
      closed_ncrs: ncrSummary.closed,
      top_defects: topDefects,
    };
  }

  // ==================== Helper Methods ====================

  private async requirePendingInspection(
    tenantId: string,
    inspectionId: string,
  ) {
    const { data, error } = await this.supabase
      .from("quality_inspections")
      .select("id,status")
      .eq("tenant_id", tenantId)
      .eq("id", inspectionId)
      .maybeSingle();
    if (error || !data) throw new NotFoundException("Inspection not found.");
    if (data.status !== "PENDING")
      throw new BadRequestException(
        "Only a pending inspection can be changed.",
      );
    return data;
  }

  private async resolveInspectionPlan(
    tenantId: string,
    input: any,
    inspectionDate: string,
  ) {
    let query = this.supabase
      .from("quality_inspection_plans")
      .select("*, parameters:quality_inspection_plan_parameters(*)")
      .eq("tenant_id", tenantId)
      .eq("status", "APPROVED")
      .eq("inspection_type", String(input.inspection_type || "").toUpperCase());
    if (input.inspection_plan_id)
      query = query.eq("id", input.inspection_plan_id);
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    const effective = (data || []).filter((plan: any) =>
      planIsEffective(plan, inspectionDate),
    );
    if (input.inspection_plan_id && !effective.length)
      throw new BadRequestException(
        "The selected inspection plan is not approved and effective on the inspection date.",
      );
    const itemId = String(input.item_id || "");
    const applicable = effective
      .filter((plan: any) => !plan.item_id || String(plan.item_id) === itemId)
      .sort(
        (a: any, b: any) =>
          Number(Boolean(b.item_id)) - Number(Boolean(a.item_id)) ||
          Number(b.revision) - Number(a.revision),
      );
    if (input.inspection_plan_id && !applicable.length)
      throw new BadRequestException(
        "The selected inspection plan does not apply to this item.",
      );
    const selected = applicable[0] || null;
    if (selected)
      selected.parameters = [...(selected.parameters || [])].sort(
        (a: any, b: any) => a.sequence_number - b.sequence_number,
      );
    return selected;
  }

  private async generateInspectionNumber(
    tenantId: string,
    type: string,
  ): Promise<string> {
    const prefix =
      type === "INCOMING" ? "IQC" : type === "IN_PROCESS" ? "IPQC" : "FQC";

    const { count } = await this.supabase
      .from("quality_inspections")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("inspection_type", type);

    const nextNumber = (count || 0) + 1;
    return `${prefix}-${String(nextNumber).padStart(6, "0")}`;
  }

  private async generateNCRNumber(tenantId: string): Promise<string> {
    const { count } = await this.supabase
      .from("ncr")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId);

    const nextNumber = (count || 0) + 1;
    return `NCR-${String(nextNumber).padStart(6, "0")}`;
  }
}
