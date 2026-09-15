import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { CostingService } from "../../costing/costing.service";
import {
  evaluateProductionFormula,
  roundProductionFormula,
} from "./production-formula-engine";
import {
  findProductionConfigurationPack,
  productionConfigurationPacks,
  summarizeProductionConfigurationPack,
} from "../configuration-packs/production-configuration-packs";

@Injectable()
export class ProductionStandardizationService {
  private readonly db: SupabaseClient;
  constructor(private readonly costing: CostingService) {
    this.db = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_KEY!,
    );
  }
  private fail(message: string): never {
    throw new BadRequestException(message);
  }
  private text(value: any) {
    return String(value ?? "").trim();
  }
  private number(value: any) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  listConfigurationPacks() {
    return productionConfigurationPacks.map(
      summarizeProductionConfigurationPack,
    );
  }

  getConfigurationPack(code: string) {
    const pack = findProductionConfigurationPack(code);
    if (!pack)
      throw new NotFoundException("Production configuration pack not found.");
    return pack;
  }

  async installConfigurationPack(
    tenantId: string,
    userId: string,
    code: string,
  ) {
    const pack = this.getConfigurationPack(code);
    const familyCodes = [
      ...new Set(pack.attributes.map((row) => row.family_code)),
    ];
    const [existingAttributes, existingFormulas] = await Promise.all([
      this.db
        .from("production_attribute_definitions")
        .select("id,family_code,attribute_code,lifecycle_status")
        .eq("tenant_id", tenantId)
        .in("family_code", familyCodes),
      this.db
        .from("production_formula_definitions")
        .select("id,formula_code,version,lifecycle_status")
        .eq("tenant_id", tenantId)
        .in(
          "formula_code",
          pack.formulas.map((row) => row.formula_code),
        ),
    ]);
    if (existingAttributes.error || existingFormulas.error) {
      this.fail(
        (existingAttributes.error || existingFormulas.error)?.message ||
          "Unable to inspect existing production definitions.",
      );
    }
    const attributeKeys = new Set(
      (existingAttributes.data || []).map(
        (row: any) => `${row.family_code}:${row.attribute_code}`,
      ),
    );
    const formulaKeys = new Set(
      (existingFormulas.data || []).map(
        (row: any) => `${row.formula_code}:${row.version}`,
      ),
    );
    const newAttributes = pack.attributes.filter(
      (row) => !attributeKeys.has(`${row.family_code}:${row.attribute_code}`),
    );
    const newFormulas = pack.formulas.filter(
      (row) => !formulaKeys.has(`${row.formula_code}:${row.version}`),
    );

    if (newAttributes.length) {
      const inserted = await this.db
        .from("production_attribute_definitions")
        .insert(
          newAttributes.map((row) => ({
            tenant_id: tenantId,
            family_code: row.family_code,
            attribute_code: row.attribute_code,
            attribute_name: row.attribute_name,
            data_type: row.data_type,
            unit_code: row.unit_code || null,
            required: Boolean(row.required),
            allowed_values: row.allowed_values || [],
            identity_sequence: row.identity_sequence || null,
            is_searchable: true,
            lifecycle_status: "DRAFT",
            created_by: userId,
            updated_at: new Date().toISOString(),
          })),
        );
      if (inserted.error)
        this.fail(
          `Unable to install draft product attributes: ${inserted.error.message}`,
        );
    }

    const installedFormulaIds: string[] = [];
    for (const formula of newFormulas) {
      const saved = await this.db
        .from("production_formula_definitions")
        .insert({
          tenant_id: tenantId,
          formula_code: formula.formula_code,
          formula_name: formula.formula_name,
          version: formula.version,
          expression: formula.expression,
          input_schema: formula.input_schema,
          output_target: formula.output_target,
          output_uom: formula.output_uom,
          rounding_mode: formula.rounding_mode,
          decimal_places: formula.decimal_places,
          lifecycle_status: "DRAFT",
          created_by: userId,
          updated_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (saved.error)
        this.fail(
          `Unable to install draft formula ${formula.formula_code}: ${saved.error.message}`,
        );
      installedFormulaIds.push(saved.data.id);
      const tests = await this.db.from("production_formula_test_cases").insert(
        formula.test_cases.map((test) => ({
          tenant_id: tenantId,
          formula_id: saved.data.id,
          case_name: test.case_name,
          input_values: test.input_values,
          expected_result: test.expected_result,
          tolerance: test.tolerance,
          created_by: userId,
        })),
      );
      if (tests.error)
        this.fail(
          `Unable to install tests for ${formula.formula_code}: ${tests.error.message}`,
        );
    }

    return {
      pack: summarizeProductionConfigurationPack(pack),
      installed: {
        attributes: newAttributes.length,
        formulas: installedFormulaIds.length,
      },
      preserved_existing: {
        attributes: pack.attributes.length - newAttributes.length,
        formulas: pack.formulas.length - newFormulas.length,
      },
      status: "DRAFT",
      next_action:
        "Validate client parameters and submit the draft definitions for independent approval. Map operation templates only after the approved item, BOM and work centres exist.",
    };
  }

  async overview(tenantId: string) {
    const tables = [
      "production_attribute_definitions",
      "production_item_specifications",
      "production_formula_definitions",
      "production_formula_test_cases",
      "production_engineering_results",
      "production_engineering_result_lines",
      "project_delivery_allocations",
      "production_job_cost_statements",
    ];
    const result: any = {};
    for (const table of tables) {
      let builder = this.db.from(table).select("*").eq("tenant_id", tenantId);
      if (table !== "production_engineering_result_lines")
        builder = builder.order("created_at", { ascending: false });
      const query = await builder;
      if (query.error)
        this.fail(`Unable to load ${table}: ${query.error.message}`);
      result[table] = query.data || [];
    }
    const [
      items,
      boms,
      bomItems,
      routings,
      workStations,
      drawings,
      uomConversions,
      configurationMappings,
      warehouses,
      projects,
      jobs,
    ] =
      await Promise.all([
        this.db
          .from("items")
          .select("id,code,name,uom,category")
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .order("code"),
        this.db
          .from("bom_headers")
          .select("id,item_id,version,lifecycle_status,output_quantity,output_uom,source_pack_code,drawing_revision_id")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false }),
        this.db
          .from("bom_items")
          .select(
            "id,bom_id,item_id,child_bom_id,quantity,scrap_percentage,route_operation_id,issue_method,input_warehouse_id,quantity_formula_id,consumption_uom,quantity_basis,rounding_rule",
          ),
        this.db
          .from("production_routing")
          .select("id,bom_id,sequence_no,operation_name")
          .eq("tenant_id", tenantId)
          .order("sequence_no"),
        this.db
          .from("work_stations")
          .select("id,station_code,station_name,station_type,capacity_per_hour,is_active")
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .order("station_code"),
        this.db
          .from("item_drawings")
          .select("id,item_id,drawing_number,revision_code,lifecycle_status,is_active,effective_from,effective_to")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false }),
        this.db
          .from("production_uom_conversions")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false }),
        this.db
          .from("production_configuration_mappings")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("updated_at", { ascending: false }),
        this.db
          .from("warehouses")
          .select("id,code,name")
          .eq("tenant_id", tenantId)
          .order("code"),
        this.db
          .from("projects")
          .select("id,project_code,project_name,status")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false }),
        this.db
          .from("production_job_orders")
          .select(
            "id,job_order_number,item_id,status,completed_quantity,rejected_quantity",
          )
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(250),
      ]);
    const failed = [
      items,
      boms,
      bomItems,
      routings,
      workStations,
      drawings,
      uomConversions,
      configurationMappings,
      warehouses,
      projects,
      jobs,
    ].find((row) => row.error);
    if (failed?.error)
      this.fail(`Unable to load production masters: ${failed.error.message}`);
    return {
      ...result,
      items: items.data || [],
      boms: boms.data || [],
      bom_items: bomItems.data || [],
      routings: routings.data || [],
      work_stations: workStations.data || [],
      drawings: drawings.data || [],
      uom_conversions: uomConversions.data || [],
      configuration_mappings: configurationMappings.data || [],
      warehouses: warehouses.data || [],
      projects: projects.data || [],
      jobs: jobs.data || [],
    };
  }

  async validateConfigurationMapping(
    tenantId: string,
    userId: string,
    code: string,
    body: any,
  ) {
    const pack = this.getConfigurationPack(code);
    const itemId = this.text(body.finished_item_id);
    const bomId = this.text(body.bom_id);
    if (!itemId || !bomId)
      this.fail("Select the finished item and its BOM revision.");

    const [item, bom, lines, stations, drawing] = await Promise.all([
      this.db
        .from("items")
        .select("id,code,name,uom,is_active")
        .eq("tenant_id", tenantId)
        .eq("id", itemId)
        .maybeSingle(),
      this.db
        .from("bom_headers")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("id", bomId)
        .maybeSingle(),
      this.db.from("bom_items").select("*").eq("bom_id", bomId),
      this.db
        .from("work_stations")
        .select("id,station_code,station_name,is_active")
        .eq("tenant_id", tenantId),
      this.db
        .from("item_drawings")
        .select("id,drawing_number,revision_code,lifecycle_status,is_active,effective_from,effective_to")
        .eq("tenant_id", tenantId)
        .eq("item_id", itemId)
        .eq("lifecycle_status", "APPROVED")
        .eq("is_active", true)
        .order("approved_at", { ascending: false })
        .limit(1),
    ]);
    const failed = [item, bom, lines, stations, drawing].find((x) => x.error);
    if (failed?.error) this.fail(failed.error.message);
    if (!item.data?.is_active) this.fail("The selected finished item is inactive or missing.");
    if (!bom.data || String(bom.data.item_id) !== itemId)
      this.fail("The selected BOM does not belong to the finished item.");

    const blockers: string[] = [];
    const warnings: string[] = [];
    const operationMappings = Array.isArray(body.operation_mappings)
      ? body.operation_mappings
      : [];
    const enabledOperations = operationMappings.filter(
      (row: any) => row.enabled !== false,
    );
    const stationIds = new Set(
      (stations.data || [])
        .filter((row: any) => row.is_active)
        .map((row: any) => String(row.id)),
    );
    if (!enabledOperations.length)
      blockers.push("Enable at least one production operation.");
    for (const template of pack.operation_templates) {
      const mapping = operationMappings.find(
        (row: any) => Number(row.sequence) === template.sequence,
      );
      if (!mapping || mapping.enabled === false) {
        if (!this.text(mapping?.exclusion_reason))
          blockers.push(
            `${template.sequence} ${template.operation}: map a work centre or give an exclusion reason.`,
          );
        continue;
      }
      if (!stationIds.has(this.text(mapping.work_station_id)))
        blockers.push(
          `${template.sequence} ${template.operation}: select an active work centre.`,
        );
      if (this.number(mapping.cycle_time_minutes) <= 0)
        blockers.push(
          `${template.sequence} ${template.operation}: enter a positive standard run time.`,
        );
      if (this.number(mapping.setup_time_minutes) < 0)
        blockers.push(
          `${template.sequence} ${template.operation}: setup time cannot be negative.`,
        );
    }

    const componentMappings = Array.isArray(body.component_mappings)
      ? body.component_mappings
      : [];
    const bomLineIds = new Set((lines.data || []).map((row: any) => String(row.id)));
    for (const line of componentMappings) {
      if (!bomLineIds.has(this.text(line.bom_item_id)))
        blockers.push("A component mapping does not belong to the selected BOM.");
      if (
        line.operation_sequence &&
        !enabledOperations.some(
          (row: any) => Number(row.sequence) === Number(line.operation_sequence),
        )
      )
        blockers.push("A component is assigned to a disabled operation.");
    }
    if ((lines.data || []).length && componentMappings.length < (lines.data || []).length)
      warnings.push("Some BOM components do not yet have an operation issue point.");

    const outputQuantity = this.number(body.output_quantity || 1);
    const outputUom = this.text(body.output_uom || item.data.uom).toUpperCase();
    if (!(outputQuantity > 0)) blockers.push("BOM output quantity must be greater than zero.");
    if (!outputUom) blockers.push("BOM output UOM is required.");
    if (!(drawing.data || []).length)
      warnings.push("No active approved drawing revision is linked to this finished item.");

    const quality = body.quality_parameters || {};
    for (const stage of pack.quality_templates) {
      const parameters = Array.isArray(quality[stage.stage])
        ? quality[stage.stage]
        : [];
      const configured = parameters.filter(
        (row: any) => this.text(row.parameter_name) && this.text(row.specification),
      );
      if (!configured.length)
        warnings.push(`${stage.stage} QC tolerances/specifications are not configured.`);
    }

    const costLines = Array.isArray(body.cost_lines) ? body.cost_lines : [];
    if (!costLines.some((row: any) => row.enabled !== false && this.number(row.rate) > 0))
      warnings.push("Cost rates are incomplete; the generated cost sheet will remain inactive.");
    const mrp = body.mrp_parameters || {};
    if (!this.text(mrp.procurement_type))
      warnings.push("MRP make/buy policy is not yet proposed.");

    const validation = {
      valid: blockers.length === 0,
      blockers,
      warnings,
      summary: {
        item: `${item.data.code} - ${item.data.name}`,
        bom_version: bom.data.version,
        bom_status: bom.data.lifecycle_status,
        components: (lines.data || []).length,
        enabled_operations: enabledOperations.length,
        approved_drawing: (drawing.data || [])[0] || null,
      },
      checked_at: new Date().toISOString(),
    };
    const mappingData = {
      ...body,
      finished_item_id: itemId,
      bom_id: bomId,
      output_quantity: outputQuantity,
      output_uom: outputUom,
    };
    const saved = await this.db
      .from("production_configuration_mappings")
      .upsert(
        {
          tenant_id: tenantId,
          pack_code: pack.code,
          pack_version: pack.version,
          finished_item_id: itemId,
          bom_id: bomId,
          status: validation.valid ? "VALIDATED" : "DRAFT",
          mapping_data: mappingData,
          validation_result: validation,
          created_by: userId,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,pack_code,finished_item_id,bom_id" },
      )
      .select()
      .single();
    if (saved.error) this.fail(saved.error.message);
    return { ...validation, mapping: saved.data };
  }

  async applyConfigurationMapping(
    tenantId: string,
    userId: string,
    code: string,
    mappingId: string,
  ) {
    const pack = this.getConfigurationPack(code);
    const current = await this.db
      .from("production_configuration_mappings")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("pack_code", pack.code)
      .eq("id", mappingId)
      .maybeSingle();
    if (current.error || !current.data)
      throw new NotFoundException("Validated production mapping not found.");
    if (current.data.status !== "VALIDATED" || current.data.validation_result?.valid !== true)
      this.fail("Resolve every blocking validation before generating drafts.");
    const mapping = current.data.mapping_data || {};
    const bom = await this.db
      .from("bom_headers")
      .select("id,item_id,lifecycle_status")
      .eq("tenant_id", tenantId)
      .eq("id", current.data.bom_id)
      .maybeSingle();
    if (bom.error || !bom.data) this.fail("The mapped BOM revision no longer exists.");
    if (String(bom.data.lifecycle_status || "DRAFT").toUpperCase() !== "DRAFT")
      this.fail("Generate configuration only against a draft BOM revision.");

    const header = await this.db
      .from("bom_headers")
      .update({
        output_quantity: this.number(mapping.output_quantity || 1),
        output_uom: this.text(mapping.output_uom).toUpperCase(),
        source_pack_code: pack.code,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", bom.data.id);
    if (header.error) this.fail(header.error.message);

    const routeBySequence = new Map<number, string>();
    for (const operation of (mapping.operation_mappings || []).filter(
      (row: any) => row.enabled !== false,
    )) {
      const sequence = Math.round(this.number(operation.sequence));
      const saved = await this.db
        .from("production_routing")
        .upsert(
          {
            tenant_id: tenantId,
            bom_id: bom.data.id,
            sequence_no: sequence,
            work_station_id: operation.work_station_id,
            operation_name:
              this.text(operation.operation) ||
              pack.operation_templates.find((x) => x.sequence === sequence)?.operation,
            setup_time_minutes: this.number(operation.setup_time_minutes),
            cycle_time_minutes: this.number(operation.cycle_time_minutes),
            qc_required: Boolean(operation.qc_required),
            notes: `Draft route generated from ${pack.code} v${pack.version}.`,
          },
          { onConflict: "bom_id,sequence_no" },
        )
        .select("id")
        .single();
      if (saved.error) this.fail(saved.error.message);
      routeBySequence.set(sequence, saved.data.id);
    }

    for (const component of mapping.component_mappings || []) {
      const routeId = routeBySequence.get(
        Math.round(this.number(component.operation_sequence)),
      );
      if (!routeId) continue;
      const updated = await this.db
        .from("bom_items")
        .update({
          route_operation_id: routeId,
          issue_method: this.text(component.issue_method || "PRE_STAGE").toUpperCase(),
          consumption_uom: this.text(component.consumption_uom).toUpperCase() || null,
          quantity_basis: this.text(component.quantity_basis || "PER_OUTPUT").toUpperCase(),
          rounding_rule: this.text(component.rounding_rule || "NONE").toUpperCase(),
        })
        .eq("bom_id", bom.data.id)
        .eq("id", component.bom_item_id);
      if (updated.error) this.fail(updated.error.message);
    }

    let conversionCount = 0;
    for (const conversion of mapping.uom_conversions || []) {
      if (!this.text(conversion.from_uom) || !this.text(conversion.to_uom) || this.number(conversion.factor) <= 0)
        continue;
      const saved = await this.db.from("production_uom_conversions").upsert(
        {
          tenant_id: tenantId,
          item_id: conversion.item_id || null,
          from_uom: this.text(conversion.from_uom).toUpperCase(),
          to_uom: this.text(conversion.to_uom).toUpperCase(),
          factor: this.number(conversion.factor),
          rounding_mode: this.text(conversion.rounding_mode || "HALF_UP").toUpperCase(),
          decimal_places: Math.max(0, Math.min(8, Math.round(this.number(conversion.decimal_places ?? 4)))),
          version: Math.max(1, Math.round(this.number(conversion.version || 1))),
          lifecycle_status: "DRAFT",
          created_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,item_id,from_uom,to_uom,version" },
      );
      if (saved.error) this.fail(saved.error.message);
      conversionCount += 1;
    }

    let qualityPlanCount = 0;
    for (const template of pack.quality_templates) {
      const parameters = (mapping.quality_parameters?.[template.stage] || []).filter(
        (row: any) => this.text(row.parameter_name) && this.text(row.specification),
      );
      if (!parameters.length) continue;
      const codePart = this.text(mapping.item_code || current.data.finished_item_id)
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .slice(0, 24);
      const planCode = `ACD-${codePart}-${template.stage}`.slice(0, 50);
      const existing = await this.db
        .from("quality_inspection_plans")
        .select("id,status")
        .eq("tenant_id", tenantId)
        .eq("plan_code", planCode)
        .eq("revision", 1)
        .maybeSingle();
      if (existing.error) this.fail(existing.error.message);
      if (existing.data && existing.data.status !== "DRAFT")
        this.fail(`QC plan ${planCode} is already governed; create a new revision manually.`);
      const plan = existing.data
        ? existing
        : await this.db
            .from("quality_inspection_plans")
            .insert({
              tenant_id: tenantId,
              plan_code: planCode,
              plan_name: `${template.stage.replace("_", " ")} - AC duct`,
              inspection_type: template.stage,
              item_id: current.data.finished_item_id,
              revision: 1,
              effective_from: new Date().toISOString().slice(0, 10),
              sampling_method: "FIXED",
              sample_size: 1,
              status: "DRAFT",
              approval_note: `Generated from ${pack.code}; verify tolerances before approval.`,
              created_by: userId,
            })
            .select("id,status")
            .single();
      if (plan.error || !plan.data) this.fail(plan.error?.message || "Unable to create draft QC plan.");
      const cleared = await this.db
        .from("quality_inspection_plan_parameters")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("plan_id", plan.data.id);
      if (cleared.error) this.fail(cleared.error.message);
      const inserted = await this.db.from("quality_inspection_plan_parameters").insert(
        parameters.map((parameter: any, index: number) => ({
          tenant_id: tenantId,
          plan_id: plan.data.id,
          sequence_number: index + 1,
          parameter_name: this.text(parameter.parameter_name),
          data_type: this.text(parameter.data_type || "PASS_FAIL").toUpperCase(),
          specification: this.text(parameter.specification),
          unit_of_measure: this.text(parameter.unit_of_measure).toUpperCase() || null,
          tolerance_min: parameter.tolerance_min === "" || parameter.tolerance_min == null ? null : this.number(parameter.tolerance_min),
          tolerance_max: parameter.tolerance_max === "" || parameter.tolerance_max == null ? null : this.number(parameter.tolerance_max),
          criticality: this.text(parameter.criticality || "MAJOR").toUpperCase(),
          is_mandatory: parameter.is_mandatory !== false,
        })),
      );
      if (inserted.error) this.fail(inserted.error.message);
      qualityPlanCount += 1;
    }

    const costLines = (mapping.cost_lines || []).filter((row: any) => row.enabled !== false);
    let costSheetCreated = false;
    if (costLines.length) {
      const normalized = costLines.map((row: any, index: number) => ({
        id: `pack-${index + 1}`,
        name: this.text(row.name),
        category: this.text(row.category || "OTHER").toUpperCase(),
        basis: this.text(row.basis || "PER_UNIT").toUpperCase(),
        rate: this.number(row.rate),
        driver_quantity: this.number(row.driver_quantity || 0),
        wastage_percent: this.number(row.wastage_percent || 0),
        enabled: true,
        calculated_amount: 0,
      }));
      const cost = await this.db.from("production_cost_sheet_templates").upsert(
        {
          tenant_id: tenantId,
          finished_item_id: current.data.finished_item_id,
          template_name: `${pack.name} - Draft`,
          currency_code: this.text(mapping.currency_code || "INR").toUpperCase(),
          output_quantity: this.number(mapping.output_quantity || 1),
          cost_lines: normalized,
          assumptions: {
            source_pack: pack.code,
            requires_rate_validation: true,
            mrp_parameters_proposed: mapping.mrp_parameters || {},
          },
          calculated_total_cost: 0,
          calculated_unit_cost: 0,
          is_active: false,
          created_by: userId,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,finished_item_id,template_name" },
      );
      if (cost.error) this.fail(cost.error.message);
      costSheetCreated = true;
    }

    const completed = await this.db
      .from("production_configuration_mappings")
      .update({
        status: "APPLIED",
        applied_by: userId,
        applied_at: new Date().toISOString(),
        updated_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", mappingId)
      .select()
      .single();
    if (completed.error) this.fail(completed.error.message);
    return {
      mapping: completed.data,
      generated_as_drafts: {
        routes: routeBySequence.size,
        quality_plans: qualityPlanCount,
        uom_conversions: conversionCount,
        cost_sheet: costSheetCreated,
        mrp_proposal_saved: Boolean(mapping.mrp_parameters),
      },
      next_action:
        "Review draft BOM, routing, UOM, QC and cost setup. Independently approve governed records before creating a job order or MRP run.",
    };
  }

  async saveUomConversion(tenantId: string, userId: string, body: any) {
    const fromUom = this.text(body.from_uom).toUpperCase();
    const toUom = this.text(body.to_uom).toUpperCase();
    const factor = this.number(body.factor);
    if (!fromUom || !toUom || fromUom === toUom)
      this.fail("Select two different UOM codes.");
    if (!(factor > 0)) this.fail("Conversion factor must be greater than zero.");
    const row = {
      tenant_id: tenantId,
      item_id: body.item_id || null,
      from_uom: fromUom,
      to_uom: toUom,
      factor,
      rounding_mode: this.text(body.rounding_mode || "HALF_UP").toUpperCase(),
      decimal_places: Math.max(0, Math.min(8, Math.round(this.number(body.decimal_places ?? 4)))),
      version: Math.max(1, Math.round(this.number(body.version || 1))),
      lifecycle_status: "DRAFT",
      created_by: userId,
      updated_at: new Date().toISOString(),
    };
    const saved = await this.db
      .from("production_uom_conversions")
      .upsert(row, { onConflict: "tenant_id,item_id,from_uom,to_uom,version" })
      .select()
      .single();
    if (saved.error) this.fail(saved.error.message);
    return saved.data;
  }

  async transitionUomConversion(
    tenantId: string,
    userId: string,
    id: string,
    action: string,
  ) {
    const current = await this.db
      .from("production_uom_conversions")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (current.error || !current.data)
      throw new NotFoundException("UOM conversion not found.");
    const target = this.text(action).toUpperCase();
    if (target === "SUBMIT" && current.data.lifecycle_status === "DRAFT") {
      const saved = await this.db
        .from("production_uom_conversions")
        .update({ lifecycle_status: "SUBMITTED", updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .select()
        .single();
      if (saved.error) this.fail(saved.error.message);
      return saved.data;
    }
    if (target !== "APPROVE" || current.data.lifecycle_status !== "SUBMITTED")
      this.fail("Submit the draft UOM conversion before approval.");
    if (String(current.data.created_by || "") === String(userId))
      this.fail("Independent approval is required.");
    await this.db
      .from("production_uom_conversions")
      .update({ lifecycle_status: "RETIRED", effective_to: new Date().toISOString().slice(0, 10) })
      .eq("tenant_id", tenantId)
      .eq("item_id", current.data.item_id)
      .eq("from_uom", current.data.from_uom)
      .eq("to_uom", current.data.to_uom)
      .eq("lifecycle_status", "APPROVED");
    const saved = await this.db
      .from("production_uom_conversions")
      .update({
        lifecycle_status: "APPROVED",
        effective_from: current.data.effective_from || new Date().toISOString().slice(0, 10),
        effective_to: null,
        approved_by: userId,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .select()
      .single();
    if (saved.error) this.fail(saved.error.message);
    return saved.data;
  }

  async searchSpecifications(tenantId: string, search: string) {
    const term = this.text(search).toLowerCase();
    if (!term) return [];
    const [specs, items] = await Promise.all([
      this.db
        .from("production_item_specifications")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("lifecycle_status", "APPROVED"),
      this.db
        .from("items")
        .select("id,code,name,uom")
        .eq("tenant_id", tenantId),
    ]);
    if (specs.error || items.error)
      this.fail(
        (specs.error || items.error)?.message ||
          "Unable to search product specifications.",
      );
    const itemMap = new Map<string, any>(
      (items.data || []).map((item: any) => [String(item.id), item]),
    );
    return (specs.data || [])
      .map((spec: any) => ({
        ...spec,
        item: itemMap.get(String(spec.item_id)) || null,
      }))
      .filter((spec: any) =>
        JSON.stringify({
          item: spec.item,
          family: spec.family_code,
          identity: spec.variant_identity,
          values: spec.specification_values,
        })
          .toLowerCase()
          .includes(term),
      );
  }

  async saveAttribute(tenantId: string, userId: string, body: any) {
    const familyCode = this.text(body.family_code).toUpperCase(),
      attributeCode = this.text(body.attribute_code).toLowerCase();
    const dataType = this.text(body.data_type).toUpperCase();
    if (!familyCode || !attributeCode || !this.text(body.attribute_name))
      this.fail("Family, attribute code and name are required.");
    if (
      !["NUMBER", "TEXT", "OPTION", "BOOLEAN", "DATE", "MEASUREMENT"].includes(
        dataType,
      )
    )
      this.fail("Select a valid attribute type.");
    const row = {
      tenant_id: tenantId,
      family_code: familyCode,
      attribute_code: attributeCode,
      attribute_name: this.text(body.attribute_name),
      data_type: dataType,
      unit_code: this.text(body.unit_code).toUpperCase() || null,
      required: Boolean(body.required),
      default_value: body.default_value ?? null,
      allowed_values: Array.isArray(body.allowed_values)
        ? body.allowed_values.map((x: any) => this.text(x)).filter(Boolean)
        : [],
      minimum_value:
        body.minimum_value === "" || body.minimum_value == null
          ? null
          : this.number(body.minimum_value),
      maximum_value:
        body.maximum_value === "" || body.maximum_value == null
          ? null
          : this.number(body.maximum_value),
      identity_sequence: body.identity_sequence
        ? Math.max(1, Math.round(this.number(body.identity_sequence)))
        : null,
      is_searchable: body.is_searchable !== false,
      lifecycle_status: "DRAFT",
      created_by: userId,
      updated_at: new Date().toISOString(),
    };
    const saved = await this.db
      .from("production_attribute_definitions")
      .upsert(row, { onConflict: "tenant_id,family_code,attribute_code" })
      .select()
      .single();
    if (saved.error) this.fail(saved.error.message);
    return saved.data;
  }

  async transitionAttribute(
    tenantId: string,
    userId: string,
    id: string,
    action: string,
  ) {
    const current = await this.db
      .from("production_attribute_definitions")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (current.error || !current.data)
      throw new NotFoundException("Attribute definition not found.");
    const target = this.text(action).toUpperCase();
    if (target !== "APPROVE" || current.data.lifecycle_status !== "DRAFT")
      this.fail("Only a draft attribute can be approved.");
    if (String(current.data.created_by || "") === String(userId))
      this.fail("Independent approval is required.");
    const saved = await this.db
      .from("production_attribute_definitions")
      .update({
        lifecycle_status: "APPROVED",
        approved_by: userId,
        approved_at: new Date().toISOString(),
        effective_from:
          current.data.effective_from || new Date().toISOString().slice(0, 10),
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .select()
      .single();
    if (saved.error) this.fail(saved.error.message);
    return saved.data;
  }

  async saveSpecification(tenantId: string, userId: string, body: any) {
    if (!body.item_id || !this.text(body.family_code))
      this.fail("Item and product family are required.");
    const values =
      body.specification_values && typeof body.specification_values === "object"
        ? body.specification_values
        : {};
    const defs = await this.db
      .from("production_attribute_definitions")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("family_code", this.text(body.family_code).toUpperCase())
      .eq("lifecycle_status", "APPROVED");
    if (defs.error) this.fail(defs.error.message);
    for (const definition of defs.data || []) {
      const value = values[definition.attribute_code];
      if (
        definition.required &&
        (value === undefined || value === null || value === "")
      )
        this.fail(`${definition.attribute_name} is required.`);
      if (
        value !== undefined &&
        ["NUMBER", "MEASUREMENT"].includes(definition.data_type)
      ) {
        const n = Number(value);
        if (!Number.isFinite(n))
          this.fail(`${definition.attribute_name} must be numeric.`);
        if (
          definition.minimum_value != null &&
          n < Number(definition.minimum_value)
        )
          this.fail(`${definition.attribute_name} is below its minimum.`);
        if (
          definition.maximum_value != null &&
          n > Number(definition.maximum_value)
        )
          this.fail(`${definition.attribute_name} exceeds its maximum.`);
      }
      if (
        value !== undefined &&
        definition.data_type === "OPTION" &&
        !(definition.allowed_values || []).includes(String(value))
      )
        this.fail(`${definition.attribute_name} is not an allowed option.`);
    }
    const identity = (defs.data || [])
      .filter((d: any) => d.identity_sequence)
      .sort((a: any, b: any) => a.identity_sequence - b.identity_sequence)
      .map((d: any) => values[d.attribute_code])
      .filter((x: any) => x !== undefined && x !== "")
      .join("x");
    const version = Math.max(1, Math.round(this.number(body.version || 1)));
    const row = {
      tenant_id: tenantId,
      item_id: body.item_id,
      family_code: this.text(body.family_code).toUpperCase(),
      specification_values: values,
      variant_identity: identity || this.text(body.variant_identity) || null,
      version,
      lifecycle_status: "DRAFT",
      effective_from: body.effective_from || null,
      created_by: userId,
      updated_at: new Date().toISOString(),
    };
    const saved = await this.db
      .from("production_item_specifications")
      .upsert(row, { onConflict: "tenant_id,item_id,version" })
      .select()
      .single();
    if (saved.error) this.fail(saved.error.message);
    return saved.data;
  }

  async transitionSpecification(
    tenantId: string,
    userId: string,
    id: string,
    action: string,
  ) {
    const current = await this.db
      .from("production_item_specifications")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (current.error || !current.data)
      throw new NotFoundException("Product specification not found.");
    const target = this.text(action).toUpperCase();
    if (target === "SUBMIT" && current.data.lifecycle_status === "DRAFT") {
      const saved = await this.db
        .from("production_item_specifications")
        .update({
          lifecycle_status: "SUBMITTED",
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .select()
        .single();
      if (saved.error) this.fail(saved.error.message);
      return saved.data;
    }
    if (target !== "APPROVE" || current.data.lifecycle_status !== "SUBMITTED")
      this.fail("Submit the specification before approval.");
    if (String(current.data.created_by || "") === String(userId))
      this.fail("Independent approval is required.");
    await this.db
      .from("production_item_specifications")
      .update({
        lifecycle_status: "RETIRED",
        effective_to: new Date().toISOString().slice(0, 10),
      })
      .eq("tenant_id", tenantId)
      .eq("item_id", current.data.item_id)
      .eq("lifecycle_status", "APPROVED");
    const saved = await this.db
      .from("production_item_specifications")
      .update({
        lifecycle_status: "APPROVED",
        approved_by: userId,
        approved_at: new Date().toISOString(),
        effective_from:
          current.data.effective_from || new Date().toISOString().slice(0, 10),
        effective_to: null,
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .select()
      .single();
    if (saved.error) this.fail(saved.error.message);
    return saved.data;
  }

  async saveFormula(tenantId: string, userId: string, body: any) {
    const expression = this.text(body.expression),
      code = this.text(body.formula_code).toUpperCase();
    if (!code || !this.text(body.formula_name) || !expression)
      this.fail("Formula code, name and expression are required.");
    evaluateProductionFormula(
      expression,
      Object.fromEntries(
        Object.keys(body.sample_inputs || body.input_schema || {}).map(
          (key) => [
            key,
            Number(
              body.sample_inputs?.[key] ??
                body.input_schema?.[key]?.default ??
                1,
            ),
          ],
        ),
      ),
    );
    const row = {
      tenant_id: tenantId,
      formula_code: code,
      formula_name: this.text(body.formula_name),
      version: Math.max(1, Math.round(this.number(body.version || 1))),
      expression,
      input_schema: body.input_schema || {},
      output_target: this.text(body.output_target).toUpperCase(),
      output_uom: this.text(body.output_uom).toUpperCase() || null,
      rounding_mode: this.text(body.rounding_mode || "HALF_UP").toUpperCase(),
      decimal_places: Math.max(
        0,
        Math.min(8, Math.round(this.number(body.decimal_places ?? 4))),
      ),
      lifecycle_status: "DRAFT",
      effective_from: body.effective_from || null,
      created_by: userId,
      updated_at: new Date().toISOString(),
    };
    const saved = await this.db
      .from("production_formula_definitions")
      .upsert(row, { onConflict: "tenant_id,formula_code,version" })
      .select()
      .single();
    if (saved.error) this.fail(saved.error.message);
    if (Array.isArray(body.test_cases)) {
      await this.db
        .from("production_formula_test_cases")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("formula_id", saved.data.id);
      if (body.test_cases.length) {
        const tests = body.test_cases.map((test: any, index: number) => ({
          tenant_id: tenantId,
          formula_id: saved.data.id,
          case_name: this.text(test.case_name) || `Case ${index + 1}`,
          input_values: test.input_values || {},
          expected_result: this.number(test.expected_result),
          tolerance: Math.max(0, this.number(test.tolerance)),
          created_by: userId,
        }));
        const inserted = await this.db
          .from("production_formula_test_cases")
          .insert(tests);
        if (inserted.error) this.fail(inserted.error.message);
      }
    }
    return saved.data;
  }

  async testFormula(tenantId: string, userId: string, id: string, body: any) {
    const formula = await this.db
      .from("production_formula_definitions")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (formula.error || !formula.data)
      throw new NotFoundException("Formula not found.");
    const raw = evaluateProductionFormula(
      formula.data.expression,
      body.input_values || {},
    );
    const rounded = roundProductionFormula(
      raw,
      formula.data.rounding_mode,
      formula.data.decimal_places,
    );
    if (body.persist !== false) {
      const saved = await this.db
        .from("production_formula_evaluations")
        .insert({
          tenant_id: tenantId,
          formula_id: id,
          item_id: body.item_id || null,
          job_order_id: body.job_order_id || null,
          source_type: this.text(body.source_type) || "MANUAL_TEST",
          source_id: body.source_id || null,
          input_values: body.input_values || {},
          raw_result: raw,
          rounded_result: rounded,
          calculation_trace: {
            expression: formula.data.expression,
            inputs: body.input_values || {},
            raw,
            rounding_mode: formula.data.rounding_mode,
            decimal_places: formula.data.decimal_places,
          },
          evaluated_by: userId,
        })
        .select()
        .single();
      if (saved.error) this.fail(saved.error.message);
    }
    return {
      formula_id: id,
      expression: formula.data.expression,
      raw_result: raw,
      rounded_result: rounded,
    };
  }

  async runFormulaTests(tenantId: string, id: string) {
    const [formula, tests] = await Promise.all([
      this.db
        .from("production_formula_definitions")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .maybeSingle(),
      this.db
        .from("production_formula_test_cases")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("formula_id", id),
    ]);
    if (formula.error || !formula.data)
      throw new NotFoundException("Formula not found.");
    if (tests.error || !(tests.data || []).length)
      this.fail("Add at least one formula test case.");
    const results = [];
    for (const test of tests.data || []) {
      const actual = roundProductionFormula(
        evaluateProductionFormula(
          formula.data.expression,
          test.input_values || {},
        ),
        formula.data.rounding_mode,
        formula.data.decimal_places,
      );
      const passed =
        Math.abs(actual - Number(test.expected_result)) <=
        Number(test.tolerance || 0);
      const updated = await this.db
        .from("production_formula_test_cases")
        .update({
          last_result: actual,
          last_passed: passed,
          last_run_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", test.id)
        .select()
        .single();
      if (updated.error) this.fail(updated.error.message);
      results.push(updated.data);
    }
    return { passed: results.every((x: any) => x.last_passed), tests: results };
  }

  async transitionFormula(
    tenantId: string,
    userId: string,
    id: string,
    action: string,
  ) {
    const formula = await this.db
      .from("production_formula_definitions")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (formula.error || !formula.data)
      throw new NotFoundException("Formula not found.");
    const target = this.text(action).toUpperCase();
    if (target === "SUBMIT" && formula.data.lifecycle_status === "DRAFT") {
      const tests = await this.runFormulaTests(tenantId, id);
      if (!tests.passed)
        this.fail("All formula tests must pass before submission.");
      const saved = await this.db
        .from("production_formula_definitions")
        .update({
          lifecycle_status: "SUBMITTED",
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .select()
        .single();
      if (saved.error) this.fail(saved.error.message);
      return saved.data;
    }
    if (target !== "APPROVE" || formula.data.lifecycle_status !== "SUBMITTED")
      this.fail("Submit the tested formula before approval.");
    if (String(formula.data.created_by || "") === String(userId))
      this.fail("Independent approval is required.");
    await this.db
      .from("production_formula_definitions")
      .update({
        lifecycle_status: "RETIRED",
        effective_to: new Date().toISOString().slice(0, 10),
      })
      .eq("tenant_id", tenantId)
      .eq("formula_code", formula.data.formula_code)
      .eq("lifecycle_status", "APPROVED");
    const saved = await this.db
      .from("production_formula_definitions")
      .update({
        lifecycle_status: "APPROVED",
        approved_by: userId,
        approved_at: new Date().toISOString(),
        effective_from:
          formula.data.effective_from || new Date().toISOString().slice(0, 10),
        effective_to: null,
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .select()
      .single();
    if (saved.error) this.fail(saved.error.message);
    return saved.data;
  }

  async saveOperationAllocation(
    tenantId: string,
    bomItemId: string,
    body: any,
  ) {
    const [line, route] = await Promise.all([
      this.db
        .from("bom_items")
        .select("id,bom_id")
        .eq("id", bomItemId)
        .maybeSingle(),
      this.db
        .from("production_routing")
        .select("id,bom_id,tenant_id")
        .eq("tenant_id", tenantId)
        .eq("id", body.route_operation_id)
        .maybeSingle(),
    ]);
    if (line.error || !line.data || route.error || !route.data)
      this.fail("BOM component or route operation was not found.");
    if (String(line.data.bom_id) !== String(route.data.bom_id))
      this.fail("Material must be assigned to an operation on the same BOM.");
    const method = this.text(body.issue_method).toUpperCase();
    if (
      !["MANUAL", "PRE_STAGE", "BACKFLUSH", "SUBCONTRACT_OUTWARD"].includes(
        method,
      )
    )
      this.fail("Select a valid issue method.");
    const saved = await this.db
      .from("bom_items")
      .update({
        route_operation_id: body.route_operation_id,
        issue_method: method,
        input_warehouse_id: body.input_warehouse_id || null,
        quantity_formula_id: body.quantity_formula_id || null,
      })
      .eq("id", bomItemId)
      .select()
      .single();
    if (saved.error) this.fail(saved.error.message);
    return saved.data;
  }

  async createCostStatement(tenantId: string, userId: string, jobId: string) {
    const variance = await this.costing.productionVariance(tenantId);
    const job = (variance.jobs || []).find(
      (row: any) => String(row.id) === String(jobId),
    );
    if (!job) throw new NotFoundException("Job cost evidence was not found.");
    if (job.assurance !== "CONTROLLED")
      this.fail(
        `Cost statement is incomplete: ${(job.exceptions || []).join(", ")}`,
      );
    const prior = await this.db
      .from("production_job_cost_statements")
      .select("statement_version")
      .eq("tenant_id", tenantId)
      .eq("job_order_id", jobId)
      .order("statement_version", { ascending: false })
      .limit(1);
    if (prior.error) this.fail(prior.error.message);
    const version = Number(prior.data?.[0]?.statement_version || 0) + 1;
    const row = {
      tenant_id: tenantId,
      job_order_id: jobId,
      statement_version: version,
      planned_cost: {
        material: job.standard_material_cost,
        conversion: job.standard_conversion_cost,
        total: job.standard_total_cost,
      },
      actual_cost: {
        material: job.actual_material_cost,
        conversion: job.actual_conversion_cost,
        yield_loss: job.yield_variance,
        total: job.actual_total_cost,
      },
      variance: {
        material: job.material_variance,
        conversion: job.conversion_variance,
        total: job.total_variance,
        percent: job.variance_percent,
      },
      evidence: {
        assurance: job.assurance,
        fifo_material_evidence: job.fifo_material_evidence,
        generated_from: "CONTROLLED_PRODUCTION_VARIANCE",
      },
      good_quantity: job.completed_quantity,
      planned_total: job.standard_total_cost,
      actual_total: job.actual_total_cost,
      actual_cost_per_good_unit: job.cost_per_good_unit,
      created_by: userId,
    };
    const saved = await this.db
      .from("production_job_cost_statements")
      .insert(row)
      .select()
      .single();
    if (saved.error) this.fail(saved.error.message);
    return saved.data;
  }

  async saveDeliveryAllocation(tenantId: string, userId: string, body: any) {
    const allocated = this.number(body.allocated_quantity),
      accepted = this.number(body.accepted_quantity);
    if (!body.project_id || !body.item_id || allocated <= 0)
      this.fail("Project, item and positive allocation quantity are required.");
    if (accepted > 0 && allocated > accepted)
      this.fail("Allocated quantity cannot exceed accepted production.");
    const row = {
      tenant_id: tenantId,
      project_id: body.project_id,
      work_package_line_id: body.work_package_line_id || null,
      job_order_id: body.job_order_id || null,
      dispatch_note_id: body.dispatch_note_id || null,
      item_id: body.item_id,
      accepted_quantity: accepted,
      allocated_quantity: allocated,
      dispatched_quantity: this.number(body.dispatched_quantity),
      delivered_quantity: this.number(body.delivered_quantity),
      pod_url: this.text(body.pod_url) || null,
      site_reference: this.text(body.site_reference) || null,
      package_reference: this.text(body.package_reference) || null,
      status: this.text(body.status || "ALLOCATED").toUpperCase(),
      created_by: userId,
      updated_at: new Date().toISOString(),
    };
    const saved = body.id
      ? await this.db
          .from("project_delivery_allocations")
          .update(row)
          .eq("tenant_id", tenantId)
          .eq("id", body.id)
          .select()
          .single()
      : await this.db
          .from("project_delivery_allocations")
          .insert(row)
          .select()
          .single();
    if (saved.error) this.fail(saved.error.message);
    return saved.data;
  }

  async saveEngineeringResult(tenantId: string, userId: string, body: any) {
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (
      !this.text(body.result_number) ||
      !this.text(body.source_file_url) ||
      !lines.length
    )
      this.fail(
        "Result number, source file and at least one result line are required.",
      );
    for (const [index, line] of lines.entries()) {
      const usage = this.number(line.planned_usage),
        output = this.number(line.expected_output),
        scrap = this.number(line.expected_scrap);
      if (
        usage < 0 ||
        output < 0 ||
        scrap < 0 ||
        output + scrap > usage + 0.0001
      )
        this.fail(
          `Engineering result line ${index + 1} has inconsistent usage/output/scrap.`,
        );
      if (!this.text(line.uom))
        this.fail(`Engineering result line ${index + 1} needs a UOM.`);
    }
    const header = {
      tenant_id: tenantId,
      result_number: this.text(body.result_number).toUpperCase(),
      result_type: this.text(body.result_type || "NESTING").toUpperCase(),
      version: Math.max(1, Math.round(this.number(body.version || 1))),
      project_id: body.project_id || null,
      work_package_id: body.work_package_id || null,
      bom_id: body.bom_id || null,
      route_operation_id: body.route_operation_id || null,
      source_file_url: this.text(body.source_file_url),
      source_file_name: this.text(body.source_file_name) || null,
      source_checksum: this.text(body.source_checksum) || null,
      source_system: this.text(body.source_system) || null,
      input_summary: body.input_summary || {},
      output_summary: body.output_summary || {},
      lifecycle_status: "DRAFT",
      created_by: userId,
      updated_at: new Date().toISOString(),
    };
    const saved = await this.db
      .from("production_engineering_results")
      .upsert(header, { onConflict: "tenant_id,result_number,version" })
      .select()
      .single();
    if (saved.error) this.fail(saved.error.message);
    await this.db
      .from("production_engineering_result_lines")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("result_id", saved.data.id);
    const inserted = await this.db
      .from("production_engineering_result_lines")
      .insert(
        lines.map((line: any) => ({
          tenant_id: tenantId,
          result_id: saved.data.id,
          item_id: line.item_id || null,
          material_code: this.text(line.material_code) || null,
          source_size: line.source_size || {},
          developed_quantity: this.number(line.developed_quantity),
          planned_usage: this.number(line.planned_usage),
          expected_output: this.number(line.expected_output),
          expected_scrap: this.number(line.expected_scrap),
          uom: this.text(line.uom).toUpperCase(),
          metadata: line.metadata || {},
        })),
      );
    if (inserted.error) this.fail(inserted.error.message);
    return saved.data;
  }

  async transitionEngineeringResult(
    tenantId: string,
    userId: string,
    id: string,
    action: string,
  ) {
    const current = await this.db
      .from("production_engineering_results")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (current.error || !current.data)
      throw new NotFoundException("Engineering result not found.");
    const target = this.text(action).toUpperCase();
    if (target === "SUBMIT" && current.data.lifecycle_status === "DRAFT") {
      const saved = await this.db
        .from("production_engineering_results")
        .update({
          lifecycle_status: "SUBMITTED",
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .select()
        .single();
      if (saved.error) this.fail(saved.error.message);
      return saved.data;
    }
    if (target !== "APPROVE" || current.data.lifecycle_status !== "SUBMITTED")
      this.fail("Submit the engineering result before approval.");
    if (String(current.data.created_by || "") === String(userId))
      this.fail("Independent approval is required.");
    const saved = await this.db
      .from("production_engineering_results")
      .update({
        lifecycle_status: "APPROVED",
        approved_by: userId,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .select()
      .single();
    if (saved.error) this.fail(saved.error.message);
    return saved.data;
  }
}
