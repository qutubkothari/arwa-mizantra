import { BadRequestException, Injectable } from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { AccountingService } from "../accounting/accounting.service";
import { createHash } from "crypto";

@Injectable()
export class CostingService {
  private readonly supabase: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );
  constructor(private readonly accounting: AccountingService) {}

  async standardMargin(tenantId: string) {
    const { data: invoices, error: invoiceError } = await this.supabase
      .from("invoices")
      .select("id,invoice_number,invoice_date,billing_status")
      .eq("tenant_id", tenantId)
      .neq("billing_status", "CANCELLED");
    if (invoiceError) throw new BadRequestException(invoiceError.message);
    const safeInvoices = invoices || [];
    const ids = safeInvoices.map((invoice: any) => String(invoice.id));
    if (!ids.length)
      return {
        revenue: 0,
        standard_cost: 0,
        gross_margin: 0,
        gross_margin_percent: 0,
        lines: [],
        disclaimer:
          "Standard-cost view: it does not post or replace actual COGS.",
      };
    const { data: invoiceLines, error: lineError } = await this.supabase
      .from("sales_invoice_items")
      .select(
        "invoice_id,item_id,item_description,quantity,taxable_amount,unit_price",
      )
      .in("invoice_id", ids);
    if (lineError) throw new BadRequestException(lineError.message);
    const lines = invoiceLines || [];
    const itemIds = Array.from(
      new Set(
        lines.map((line: any) => String(line.item_id || "")).filter(Boolean),
      ),
    );
    const { data: items, error: itemError } = itemIds.length
      ? await this.supabase
          .from("items")
          .select("id,code,name,standard_cost")
          .eq("tenant_id", tenantId)
          .in("id", itemIds)
      : { data: [], error: null };
    if (itemError) throw new BadRequestException(itemError.message);
    const itemById = new Map(
      (items || []).map((item: any) => [String(item.id), item]),
    );
    const aggregate = new Map<string, any>();
    for (const line of lines as any[]) {
      const key = String(line.item_id || "");
      const item = itemById.get(key);
      const quantity = Number(line.quantity || 0);
      const revenue = Number(
        line.taxable_amount ?? quantity * Number(line.unit_price || 0),
      );
      const cost = quantity * Number(item?.standard_cost || 0);
      const existing = aggregate.get(key) || {
        item_id: key,
        item_code: item?.code || null,
        item_name: item?.name || line.item_description || "Unmapped item",
        quantity: 0,
        revenue: 0,
        standard_cost: 0,
      };
      existing.quantity += quantity;
      existing.revenue += revenue;
      existing.standard_cost += cost;
      aggregate.set(key, existing);
    }
    const resultLines = Array.from(aggregate.values())
      .map((line) => ({
        ...line,
        revenue: Number(line.revenue.toFixed(2)),
        standard_cost: Number(line.standard_cost.toFixed(2)),
        gross_margin: Number((line.revenue - line.standard_cost).toFixed(2)),
        gross_margin_percent: line.revenue
          ? Number(
              (
                ((line.revenue - line.standard_cost) / line.revenue) *
                100
              ).toFixed(2),
            )
          : 0,
      }))
      .sort((a, b) => a.gross_margin_percent - b.gross_margin_percent);
    const revenue = resultLines.reduce((sum, line) => sum + line.revenue, 0);
    const standardCost = resultLines.reduce(
      (sum, line) => sum + line.standard_cost,
      0,
    );
    const grossMargin = revenue - standardCost;
    return {
      revenue: Number(revenue.toFixed(2)),
      standard_cost: Number(standardCost.toFixed(2)),
      gross_margin: Number(grossMargin.toFixed(2)),
      gross_margin_percent: revenue
        ? Number(((grossMargin / revenue) * 100).toFixed(2))
        : 0,
      lines: resultLines,
      disclaimer:
        "Standard-cost view: it does not post or replace actual COGS.",
    };
  }

  async fifoCogs(tenantId: string) {
    const { data, error } = await this.supabase
      .from("inventory_cost_events")
      .select(
        "id,reference_number,item_id,quantity,unit_cost,total_cost,event_at",
      )
      .eq("tenant_id", tenantId)
      .eq("event_type", "SALES_ISSUE")
      .order("event_at", { ascending: false })
      .limit(200);
    if (error) throw new BadRequestException(error.message);
    const events = await this.attachItems(tenantId, data || []);
    return {
      total_cogs: Number(
        events
          .reduce(
            (sum: number, event: any) => sum + Number(event.total_cost || 0),
            0,
          )
          .toFixed(2),
      ),
      event_count: events.length,
      events,
      disclaimer:
        "FIFO cost events are recorded from new dispatches onward. GL entries are not created automatically.",
    };
  }

  async fifoCoverage(tenantId: string) {
    const { data, error } = await this.supabase
      .from("inventory_cost_events")
      .select("event_type,quantity,total_cost")
      .eq("tenant_id", tenantId)
      .in("event_type", ["PURCHASE_RECEIPT", "SALES_ISSUE"]);
    if (error) throw new BadRequestException(error.message);
    const events = data || [];
    const receipts = events.filter(
      (event: any) => event.event_type === "PURCHASE_RECEIPT",
    );
    const issues = events.filter(
      (event: any) => event.event_type === "SALES_ISSUE",
    );
    const sum = (rows: any[], field: string) =>
      Number(
        rows
          .reduce((total, row) => total + Number(row[field] || 0), 0)
          .toFixed(2),
      );
    return {
      receipt_event_count: receipts.length,
      receipt_quantity: sum(receipts, "quantity"),
      receipt_cost: sum(receipts, "total_cost"),
      issue_event_count: issues.length,
      issue_quantity: sum(issues, "quantity"),
      issue_cost: sum(issues, "total_cost"),
      disclaimer:
        "Coverage begins when FIFO receipt evidence is enabled. It is an operational reconciliation indicator, not an inventory valuation or GL balance.",
    };
  }

  async inventoryEvents(tenantId: string) {
    const { data, error } = await this.supabase
      .from("inventory_cost_events")
      .select(
        "id,event_type,item_id,reference_number,quantity,unit_cost,total_cost,event_at",
      )
      .eq("tenant_id", tenantId)
      .order("event_at", { ascending: false })
      .limit(200);
    if (error) throw new BadRequestException(error.message);
    const events = await this.attachItems(tenantId, data || []);
    const ids = events.map((row: any) => row.id);
    let postings: any[] = [];
    if (ids.length) {
      const result = await this.supabase
        .from("accounting_source_postings")
        .select(
          "source_id,status,journal:accounting_journals(id,journal_number,status)",
        )
        .eq("tenant_id", tenantId)
        .in("source_id", ids);
      if (result.error) throw new BadRequestException(result.error.message);
      postings = result.data || [];
    }
    const byId = new Map(
      postings.map((row: any) => [String(row.source_id), row]),
    );
    return events.map((row: any) => ({
      ...row,
      posting: byId.get(String(row.id)) || null,
    }));
  }

  async productionVariance(tenantId: string) {
    const since = new Date(Date.now() - 180 * 86400000).toISOString();
    const [jobResult, shiftResult, eventResult, tenantResult] = await Promise.all([
      this.supabase
        .from("production_job_orders")
        .select(
          "id,job_order_number,item_id,item_code,item_name,quantity,completed_quantity,rejected_quantity,status,start_date,end_date,actual_start_date,actual_end_date,updated_at",
        )
        .eq("tenant_id", tenantId)
        .gte("updated_at", since)
        .order("updated_at", { ascending: false })
        .limit(300),
      this.supabase
        .from("manufacturing_shift_plans")
        .select(
          "work_station_id,operating_cost_per_hour,scrap_unit_cost,work_date",
        )
        .eq("tenant_id", tenantId)
        .gte("work_date", since.slice(0, 10))
        .limit(2000),
      this.supabase
        .from("inventory_cost_events")
        .select(
          "event_type,item_id,quantity,unit_cost,total_cost,reference_number,metadata,event_at",
        )
        .eq("tenant_id", tenantId)
        .in("event_type", [
          "PRODUCTION_ISSUE",
          "PRODUCTION_RECEIPT",
          "PURCHASE_RECEIPT",
        ])
        .gte("event_at", since)
        .limit(5000),
      this.supabase
        .from("tenants")
        .select("default_currency,locale,settings")
        .eq("id", tenantId)
        .maybeSingle(),
    ]);
    const firstError =
      jobResult.error || shiftResult.error || eventResult.error || tenantResult.error;
    if (firstError) throw new BadRequestException(firstError.message);
    const jobs = jobResult.data || [],
      jobIds = jobs.map((row: any) => row.id);
    const [operationResult, materialResult] = jobIds.length
      ? await Promise.all([
          this.supabase
            .from("job_order_operations")
            .select(
              "id,job_order_id,workstation_id,operation_name,expected_duration_hours,actual_duration_hours,completed_quantity,rejected_quantity,status",
            )
            .in("job_order_id", jobIds)
            .limit(5000),
          this.supabase
            .from("job_order_materials")
            .select(
              "id,job_order_id,item_id,item_code,item_name,required_quantity,issued_quantity,returned_quantity,status",
            )
            .in("job_order_id", jobIds)
            .limit(10000),
        ])
      : ([
          { data: [], error: null },
          { data: [], error: null },
        ] as any);
    if (operationResult.error || materialResult.error)
      throw new BadRequestException(
        (operationResult.error || materialResult.error).message,
      );
    const operations = operationResult.data || [],
      materials = materialResult.data || [],
      events = eventResult.data || [];
    const itemIds = [
      ...new Set(
        [
          ...jobs.map((row: any) => row.item_id),
          ...materials.map((row: any) => row.item_id),
          ...events.map((row: any) => row.item_id),
        ].filter(Boolean),
      ),
    ];
    const itemResult = itemIds.length
      ? await this.supabase
          .from("items")
          .select("id,code,name,standard_cost")
          .eq("tenant_id", tenantId)
          .in("id", itemIds)
      : ({ data: [], error: null } as any);
    if (itemResult.error)
      throw new BadRequestException(itemResult.error.message);
    const n = (value: any) => {
      const parsed = Number(value || 0);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const money = (value: number) => Number(value.toFixed(2));
    const itemMap = new Map(
      (itemResult.data || []).map((row: any) => [String(row.id), row]),
    );
    const rates = new Map<
      string,
      { total: number; count: number; scrap: number }
    >();
    for (const shift of shiftResult.data || []) {
      const key = String(shift.work_station_id),
        old = rates.get(key) || { total: 0, count: 0, scrap: 0 };
      old.total += n(shift.operating_cost_per_hour);
      old.scrap += n(shift.scrap_unit_cost);
      old.count++;
      rates.set(key, old);
    }
    const jobRows = jobs
      .map((job: any) => {
        const jobOperations = operations.filter(
          (row: any) => String(row.job_order_id) === String(job.id),
        );
        const jobMaterials = materials.filter(
          (row: any) => String(row.job_order_id) === String(job.id),
        );
        const referenceEvents = events.filter(
          (row: any) =>
            String(row.reference_number || "") ===
              String(job.job_order_number || "") ||
            String(row.metadata?.job_order_number || "") ===
              String(job.job_order_number || ""),
        );
        const outputItem: any = itemMap.get(String(job.item_id));
        let standardMaterial = 0,
          estimatedActualMaterial = 0,
          missingMaterialCosts = 0;
        for (const material of jobMaterials) {
          const item: any = itemMap.get(String(material.item_id)),
            unit = n(item?.standard_cost);
          if (unit <= 0) missingMaterialCosts++;
          standardMaterial += n(material.required_quantity) * unit;
          estimatedActualMaterial +=
            Math.max(
              0,
              n(material.issued_quantity) - n(material.returned_quantity),
            ) * unit;
        }
        const actualMaterialEvidence = referenceEvents
          .filter((row: any) => row.event_type === "PRODUCTION_ISSUE")
          .reduce((sum: number, row: any) => sum + n(row.total_cost), 0);
        const actualMaterial =
          actualMaterialEvidence > 0
            ? actualMaterialEvidence
            : estimatedActualMaterial;
        let standardConversion = 0,
          actualConversion = 0,
          missingRates = 0;
        for (const operation of jobOperations) {
          const rateInfo = rates.get(String(operation.workstation_id)),
            rate = rateInfo?.count ? rateInfo.total / rateInfo.count : 0;
          if (rate <= 0) missingRates++;
          standardConversion += n(operation.expected_duration_hours) * rate;
          actualConversion += n(operation.actual_duration_hours) * rate;
        }
        const completed = n(job.completed_quantity),
          rejected =
            n(job.rejected_quantity) +
            jobOperations.reduce(
              (sum: number, row: any) => sum + n(row.rejected_quantity),
              0,
            ),
          outputStandard = n(outputItem?.standard_cost);
        const yieldVariance = rejected * outputStandard;
        const standardTotal = standardMaterial + standardConversion;
        const actualTotal = actualMaterial + actualConversion + yieldVariance;
        const materialVariance = actualMaterial - standardMaterial,
          conversionVariance = actualConversion - standardConversion,
          totalVariance = actualTotal - standardTotal;
        const exceptions = [
          ...(outputStandard <= 0 ? ["OUTPUT_STANDARD_COST_MISSING"] : []),
          ...(missingMaterialCosts ? ["MATERIAL_STANDARD_COST_MISSING"] : []),
          ...(jobOperations.length === 0 ? ["ROUTING_COST_BASIS_MISSING"] : []),
          ...(missingRates ? ["WORK_CENTRE_RATE_MISSING"] : []),
          ...(actualMaterialEvidence <= 0 && estimatedActualMaterial > 0
            ? ["FIFO_ISSUE_EVIDENCE_MISSING"]
            : []),
          ...(actualMaterial <= 0 || completed <= 0
            ? ["EXECUTION_COST_EVIDENCE_MISSING"]
            : []),
          ...(completed <= 0 && String(job.status).toUpperCase() === "COMPLETED"
            ? ["COMPLETED_QUANTITY_MISSING"]
            : []),
        ];
        const controlled = exceptions.length === 0;
        const plannedPerPiece = n(job.quantity) > 0
          ? money(standardTotal / n(job.quantity))
          : null;
        const actualPerPiece = controlled && completed > 0
          ? money(actualTotal / completed)
          : null;
        const costStage = String(job.status).toUpperCase() === "COMPLETED"
          ? "FINAL"
          : completed > 0
            ? "LIVE"
            : "PLANNED";
        return {
          ...job,
          output_standard_cost: outputStandard,
          standard_material_cost: money(standardMaterial),
          actual_material_cost: money(actualMaterial),
          material_variance: controlled ? money(materialVariance) : null,
          standard_conversion_cost: money(standardConversion),
          actual_conversion_cost: money(actualConversion),
          conversion_variance: controlled ? money(conversionVariance) : null,
          yield_variance: controlled ? money(yieldVariance) : null,
          standard_total_cost: money(standardTotal),
          actual_total_cost: money(actualTotal),
          total_variance: controlled ? money(totalVariance) : null,
          variance_percent:
            controlled && standardTotal
              ? Number(((totalVariance / standardTotal) * 100).toFixed(2))
              : null,
          cost_per_good_unit: actualPerPiece,
          actual_cost_per_piece: actualPerPiece,
          planned_cost_per_piece: plannedPerPiece,
          material_cost_per_piece:
            controlled && completed > 0 ? money(actualMaterial / completed) : null,
          conversion_cost_per_piece:
            controlled && completed > 0 ? money(actualConversion / completed) : null,
          quality_loss_per_piece:
            controlled && completed > 0 ? money(yieldVariance / completed) : null,
          accepted_quantity: completed,
          cost_stage: costStage,
          completed_quantity: completed,
          rejected_quantity: rejected,
          fifo_material_evidence: actualMaterialEvidence > 0,
          exceptions: [...new Set(exceptions)],
          assurance: controlled ? "CONTROLLED" : "INCOMPLETE",
        };
      })
      .sort(
        (a: any, b: any) =>
          Math.abs(n(b.total_variance)) - Math.abs(n(a.total_variance)),
      );
    const purchaseEvents = events.filter(
      (row: any) => row.event_type === "PURCHASE_RECEIPT",
    );
    const purchasePriceVariance = purchaseEvents
      .map((event: any) => {
        const item: any = itemMap.get(String(event.item_id)),
          standard = n(item?.standard_cost),
          actual = n(event.unit_cost),
          quantity = n(event.quantity);
        return {
          item_id: event.item_id,
          item_code: item?.code || null,
          item_name: item?.name || "Unmapped item",
          reference_number: event.reference_number,
          event_at: event.event_at,
          quantity,
          standard_unit_cost: standard,
          actual_unit_cost: actual,
          variance: standard > 0 ? money((actual - standard) * quantity) : null,
          exception: standard <= 0 ? "STANDARD_COST_MISSING" : null,
        };
      })
      .sort(
        (a: any, b: any) => Math.abs(n(b.variance)) - Math.abs(n(a.variance)),
      );
    const controlled = jobRows.filter(
      (row: any) => row.assurance === "CONTROLLED",
    );
    const productionIssueValue = events
      .filter((row: any) => row.event_type === "PRODUCTION_ISSUE")
      .reduce((sum: number, row: any) => sum + n(row.total_cost), 0);
    const productionReceiptValue = events
      .filter((row: any) => row.event_type === "PRODUCTION_RECEIPT")
      .reduce((sum: number, row: any) => sum + n(row.total_cost), 0);
    const controlledAcceptedQuantity = controlled.reduce(
      (sum: number, row: any) => sum + n(row.accepted_quantity),
      0,
    );
    const tenantSettings: any = tenantResult.data?.settings || {};
    const tenantCurrency = String(
      tenantResult.data?.default_currency || tenantSettings.currency || "AED",
    ).toUpperCase();
    const tenantLocale = String(
      tenantResult.data?.locale || tenantSettings.locale || "en-AE",
    );
    return {
      generated_at: new Date().toISOString(),
      period_days: 180,
      currency_code: tenantCurrency,
      locale: tenantLocale,
      summary: {
        jobs_analyzed: jobRows.length,
        controlled_jobs: controlled.length,
        incomplete_jobs: jobRows.length - controlled.length,
        standard_cost: money(
          controlled.reduce(
            (sum: number, row: any) => sum + row.standard_total_cost,
            0,
          ),
        ),
        actual_cost: money(
          controlled.reduce(
            (sum: number, row: any) => sum + row.actual_total_cost,
            0,
          ),
        ),
        accepted_quantity: controlledAcceptedQuantity,
        actual_cost_per_piece: controlledAcceptedQuantity > 0
          ? money(
              controlled.reduce(
                (sum: number, row: any) => sum + n(row.actual_total_cost),
                0,
              ) / controlledAcceptedQuantity,
            )
          : null,
        total_variance: money(
          controlled.reduce(
            (sum: number, row: any) => sum + n(row.total_variance),
            0,
          ),
        ),
        adverse_jobs: controlled.filter((row: any) => n(row.total_variance) > 0)
          .length,
        yield_loss: money(
          controlled.reduce(
            (sum: number, row: any) => sum + n(row.yield_variance),
            0,
          ),
        ),
        purchase_price_variance: money(
          purchasePriceVariance.reduce(
            (sum: number, row: any) => sum + n(row.variance),
            0,
          ),
        ),
        production_issue_value: money(productionIssueValue),
        production_receipt_value: money(productionReceiptValue),
        wip_value: money(productionIssueValue - productionReceiptValue),
      },
      jobs: jobRows,
      purchase_price_variances: purchasePriceVariance.slice(0, 100),
      disclaimer:
        "Operational production variance and WIP valuation evidence only. Portfolio totals include controlled jobs only; incomplete jobs are explicitly excluded and flagged. Finance controls all journal creation and posting.",
    };
  }

  private costRemediationDefinition(code: string) {
    const definitions: Record<
      string,
      {
        title: string;
        recommended_action: string;
        target_route: string;
        severity: string;
      }
    > = {
      OUTPUT_STANDARD_COST_MISSING: {
        title: "Finished item standard cost is missing",
        recommended_action:
          "Review the finished item cost build-up and submit the approved standard through item master governance.",
        target_route: "/dashboard/inventory/items",
        severity: "HIGH",
      },
      MATERIAL_STANDARD_COST_MISSING: {
        title: "A BOM material standard cost is missing",
        recommended_action:
          "Identify the zero-cost BOM component and submit its approved standard through item master governance.",
        target_route: "/dashboard/inventory/items",
        severity: "HIGH",
      },
      ROUTING_COST_BASIS_MISSING: {
        title: "Job order has no operation cost basis",
        recommended_action:
          "Assign an approved routing and work stations before production-cost variance is evaluated.",
        target_route: "/dashboard/bom",
        severity: "HIGH",
      },
      WORK_CENTRE_RATE_MISSING: {
        title: "Work-centre operating rate is missing",
        recommended_action:
          "Configure and approve the operating cost per hour for the affected production shift or work centre.",
        target_route: "/dashboard/production/oee",
        severity: "HIGH",
      },
      FIFO_ISSUE_EVIDENCE_MISSING: {
        title: "Production issue has no FIFO cost evidence",
        recommended_action:
          "Reconcile the controlled material issue and inventory cost event; do not enter a manual substitute cost.",
        target_route: "/dashboard/production/job-orders",
        severity: "CRITICAL",
      },
      EXECUTION_COST_EVIDENCE_MISSING: {
        title: "Job execution evidence is incomplete",
        recommended_action:
          "Complete controlled material issue, operation time and production receipt evidence in the job-order workflow.",
        target_route: "/dashboard/production/job-orders",
        severity: "MEDIUM",
      },
      COMPLETED_QUANTITY_MISSING: {
        title: "Completed job has no completed quantity",
        recommended_action:
          "Investigate job completion and correct it through the governed production/QC workflow.",
        target_route: "/dashboard/production/job-orders",
        severity: "CRITICAL",
      },
    };
    return (
      definitions[code] || {
        title: code.replaceAll("_", " ").toLowerCase(),
        recommended_action:
          "Investigate the source record and resolve it through its native governed workflow.",
        target_route: "/dashboard/accounts/costing",
        severity: "MEDIUM",
      }
    );
  }

  async syncProductionCostRemediations(tenantId: string, userId: string) {
    const variance = await this.productionVariance(tenantId);
    const rows = variance.jobs.flatMap((job: any) =>
      (job.exceptions || []).map((code: string) => ({
        tenant_id: tenantId,
        job_order_id: job.id,
        exception_code: code,
        ...this.costRemediationDefinition(code),
        updated_by: userId,
      })),
    );
    if (!rows.length)
      return {
        inserted: 0,
        existing: 0,
        worklist: await this.productionCostRemediations(tenantId),
      };
    const existingResult = await this.supabase
      .from("production_cost_remediation_actions")
      .select("job_order_id,exception_code")
      .eq("tenant_id", tenantId);
    if (existingResult.error)
      throw new BadRequestException(existingResult.error.message);
    const existing = new Set(
      (existingResult.data || []).map(
        (row: any) => `${row.job_order_id}|${row.exception_code}`,
      ),
    );
    const fresh = rows.filter(
      (row: any) => !existing.has(`${row.job_order_id}|${row.exception_code}`),
    );
    if (fresh.length) {
      const result = await this.supabase
        .from("production_cost_remediation_actions")
        .insert(fresh);
      if (result.error) throw new BadRequestException(result.error.message);
    }
    return {
      inserted: fresh.length,
      existing: rows.length - fresh.length,
      worklist: await this.productionCostRemediations(tenantId),
    };
  }

  async productionCostRemediations(tenantId: string) {
    const [actionResult, userResult] = await Promise.all([
      this.supabase
        .from("production_cost_remediation_actions")
        .select(
          "*,job:production_job_orders(id,job_order_number,item_code,item_name,status)",
        )
        .eq("tenant_id", tenantId)
        .order("detected_at", { ascending: false })
        .limit(1000),
      this.supabase
        .from("users")
        .select("id,email,first_name,last_name")
        .eq("tenant_id", tenantId)
        .order("first_name")
        .limit(1000),
    ]);
    if (actionResult.error || userResult.error)
      throw new BadRequestException(
        (actionResult.error || userResult.error).message,
      );
    const users = userResult.data || [],
      userMap = new Map(users.map((user: any) => [String(user.id), user]));
    const actions = (actionResult.data || []).map((row: any) => ({
      ...row,
      assignee: userMap.get(String(row.assigned_to)) || null,
    }));
    const today = new Date().toISOString().slice(0, 10),
      open = actions.filter((row: any) =>
        ["OPEN", "IN_PROGRESS"].includes(row.status),
      );
    return {
      summary: {
        all: actions.length,
        open: open.filter((row: any) => row.status === "OPEN").length,
        in_progress: open.filter((row: any) => row.status === "IN_PROGRESS")
          .length,
        overdue: open.filter((row: any) => row.due_date && row.due_date < today)
          .length,
        critical: open.filter((row: any) => row.severity === "CRITICAL").length,
        unassigned: open.filter((row: any) => !row.assigned_to).length,
        resolved: actions.filter((row: any) => row.status === "RESOLVED")
          .length,
      },
      actions,
      users,
      control:
        "This worklist tracks remediation only. Every correction remains inside its native governed workflow.",
    };
  }

  async updateProductionCostRemediation(
    tenantId: string,
    userId: string,
    id: string,
    body: any,
  ) {
    const status = String(body.status || "")
      .trim()
      .toUpperCase();
    if (!["OPEN", "IN_PROGRESS", "RESOLVED", "DISMISSED"].includes(status))
      throw new BadRequestException("Choose a valid remediation status.");
    const { data: existing, error } = await this.supabase
      .from("production_cost_remediation_actions")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error || !existing)
      throw new BadRequestException(
        error?.message || "Cost-remediation action not found.",
      );
    const assignedTo = String(body.assigned_to || "").trim() || null,
      dueDate = String(body.due_date || "").slice(0, 10) || null,
      ownerNote = String(body.owner_note || "").trim() || null,
      evidence = String(body.resolution_evidence || "").trim() || null;
    if (assignedTo) {
      const user = await this.supabase
        .from("users")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("id", assignedTo)
        .maybeSingle();
      if (user.error || !user.data)
        throw new BadRequestException("Select an active tenant user as owner.");
    }
    if (status === "IN_PROGRESS" && (!assignedTo || !dueDate))
      throw new BadRequestException(
        "Assign an owner and due date before starting remediation.",
      );
    if (status === "RESOLVED" && (!evidence || evidence.length < 10))
      throw new BadRequestException(
        "Resolution requires meaningful evidence from the corrected native workflow.",
      );
    const patch: any = {
      status,
      assigned_to: assignedTo,
      due_date: dueDate,
      owner_note: ownerNote,
      resolution_evidence: evidence,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };
    if (status === "RESOLVED") {
      patch.resolved_at = new Date().toISOString();
      patch.resolved_by = userId;
    } else {
      patch.resolved_at = null;
      patch.resolved_by = null;
    }
    const result = await this.supabase
      .from("production_cost_remediation_actions")
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .select()
      .single();
    if (result.error) throw new BadRequestException(result.error.message);
    return result.data;
  }

  private async attachItems(tenantId: string, rows: any[]) {
    const itemIds = [
      ...new Set(
        rows.map((row: any) => String(row.item_id || "")).filter(Boolean),
      ),
    ];
    if (!itemIds.length) return rows;
    const { data, error } = await this.supabase
      .from("items")
      .select("id,code,name")
      .eq("tenant_id", tenantId)
      .in("id", itemIds);
    if (error) throw new BadRequestException(error.message);
    const items = new Map(
      (data || []).map((item: any) => [String(item.id), item]),
    );
    return rows.map((row: any) => ({
      ...row,
      items: items.get(String(row.item_id)) || null,
    }));
  }

  async createCogsDraft(tenantId: string, userId: string, id: string) {
    const { data: event, error } = await this.supabase
      .from("inventory_cost_events")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .eq("event_type", "SALES_ISSUE")
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!event) throw new BadRequestException("FIFO COGS event not found.");
    return this.accounting.queueAutomaticOperationalPosting(tenantId, userId, {
      source_type: "STOCK_ISSUE",
      source_id: event.id,
      source_number: event.reference_number,
      amount: Number(event.total_cost || 0),
      journal_date: String(event.event_at || new Date().toISOString()).slice(
        0,
        10,
      ),
      narration: `FIFO COGS for dispatch ${event.reference_number || event.id}`,
    });
  }

  async createEventDraft(tenantId: string, userId: string, id: string) {
    const { data: event, error } = await this.supabase
      .from("inventory_cost_events")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!event)
      throw new BadRequestException("Inventory cost event not found.");
    const receipts = ["PURCHASE_RECEIPT", "PRODUCTION_RECEIPT", "SALES_RETURN"];
    const issues = ["SALES_ISSUE", "PRODUCTION_ISSUE"];
    if (
      !receipts.includes(event.event_type) &&
      !issues.includes(event.event_type)
    )
      throw new BadRequestException(
        "This event type requires a manual inventory-adjustment review.",
      );
    const sourceType = receipts.includes(event.event_type)
      ? "STOCK_RECEIPT"
      : "STOCK_ISSUE";
    return this.accounting.queueAutomaticOperationalPosting(tenantId, userId, {
      source_type: sourceType,
      source_id: event.id,
      source_number: event.reference_number,
      amount: Number(event.total_cost || 0),
      journal_date: String(event.event_at || new Date().toISOString()).slice(
        0,
        10,
      ),
      narration: `${event.event_type.replaceAll("_", " ")} FIFO valuation for ${event.reference_number || event.id}`,
    });
  }

  async listValuationRuns(tenantId: string) {
    const { data, error } = await this.supabase
      .from("inventory_valuation_runs")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  private direction(eventType: string) {
    return ["PURCHASE_RECEIPT", "PRODUCTION_RECEIPT", "SALES_RETURN"].includes(
      eventType,
    )
      ? 1
      : ["SALES_ISSUE", "PRODUCTION_ISSUE"].includes(eventType)
        ? -1
        : 0;
  }

  async createValuationRun(tenantId: string, userId: string, body: any) {
    const start = String(body.period_start || "").slice(0, 10);
    const end = String(body.period_end || "").slice(0, 10);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(end) ||
      end < start
    )
      throw new BadRequestException("Enter a valid valuation period.");
    const { data: allEvents, error } = await this.supabase
      .from("inventory_cost_events")
      .select(
        "id,event_type,item_id,quantity,unit_cost,total_cost,reference_number,event_at",
      )
      .eq("tenant_id", tenantId)
      .lte("event_at", `${end}T23:59:59.999Z`)
      .order("event_at");
    if (error) throw new BadRequestException(error.message);
    const relevant = (allEvents || []).filter((row: any) =>
      this.direction(row.event_type),
    );
    const before = relevant.filter(
      (row: any) => String(row.event_at).slice(0, 10) < start,
    );
    const period = relevant.filter(
      (row: any) => String(row.event_at).slice(0, 10) >= start,
    );
    const sum = (rows: any[], sign?: number) =>
      Number(
        rows
          .reduce(
            (total, row) =>
              total +
              Number(row.total_cost || 0) *
                (sign ?? this.direction(row.event_type)),
            0,
          )
          .toFixed(4),
      );
    const opening = sum(before);
    const receipts = period.filter(
      (row: any) => this.direction(row.event_type) === 1,
    );
    const issues = period.filter(
      (row: any) => this.direction(row.event_type) === -1,
    );
    const receiptValue = sum(receipts, 1);
    const issueValue = sum(issues, 1);
    const closing = Number((opening + receiptValue - issueValue).toFixed(4));
    const ids = period.map((row: any) => row.id);
    let postings: any[] = [];
    if (ids.length) {
      const result = await this.supabase
        .from("accounting_source_postings")
        .select(
          "source_id,amount,status,journal:accounting_journals(id,journal_number,status)",
        )
        .eq("tenant_id", tenantId)
        .in("source_id", ids);
      if (result.error) throw new BadRequestException(result.error.message);
      postings = result.data || [];
    }
    const postingByEvent = new Map(
      postings.map((row: any) => [String(row.source_id), row]),
    );
    const posted = (rows: any[]) =>
      Number(
        rows
          .reduce((total, row) => {
            const link: any = postingByEvent.get(String(row.id));
            return (
              total +
              (link?.journal?.status === "POSTED"
                ? Number(link.amount || 0)
                : 0)
            );
          }, 0)
          .toFixed(4),
      );
    const postedReceipts = posted(receipts);
    const postedIssues = posted(issues);
    const movementVariance = Number(
      (receiptValue - issueValue - (postedReceipts - postedIssues)).toFixed(4),
    );
    const exceptions = period.filter(
      (row: any) =>
        Number(row.unit_cost || 0) <= 0 ||
        Number(row.total_cost || 0) <= 0 ||
        postingByEvent.get(String(row.id))?.journal?.status !== "POSTED",
    );
    const evidence = {
      generated_at: new Date().toISOString(),
      period_events: period.map((row: any) => ({
        ...row,
        posting: postingByEvent.get(String(row.id)) || null,
      })),
      exception_event_ids: exceptions.map((row: any) => row.id),
    };
    const evidenceHash = createHash("sha256")
      .update(JSON.stringify(evidence))
      .digest("hex");
    const payload = {
      tenant_id: tenantId,
      run_code: String(body.run_code || `INV-${end}-${Date.now()}`).trim(),
      period_start: start,
      period_end: end,
      currency_code: "AED",
      opening_value: opening,
      receipt_value: receiptValue,
      issue_value: issueValue,
      closing_value: closing,
      posted_receipt_value: postedReceipts,
      posted_issue_value: postedIssues,
      movement_variance: movementVariance,
      event_count: period.length,
      exception_count: exceptions.length,
      evidence,
      evidence_hash: evidenceHash,
      prepared_by: userId,
    };
    const { data, error: insertError } = await this.supabase
      .from("inventory_valuation_runs")
      .insert(payload)
      .select()
      .single();
    if (insertError || !data)
      throw new BadRequestException(
        insertError?.code === "23505"
          ? "Valuation run code already exists."
          : insertError?.message || "Valuation run could not be created.",
      );
    return data;
  }

  async certifyValuationRun(
    tenantId: string,
    userId: string,
    id: string,
    body: any,
  ) {
    const { data: run, error } = await this.supabase
      .from("inventory_valuation_runs")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!run) throw new BadRequestException("Valuation run not found.");
    if (run.status === "CERTIFIED") return run;
    if (String(run.prepared_by || "") === String(userId || ""))
      throw new BadRequestException(
        "An independent finance user must certify the valuation.",
      );
    if (
      Number(run.exception_count) ||
      Math.abs(Number(run.movement_variance)) > 0.005
    )
      throw new BadRequestException(
        "Resolve all missing/zero-cost postings and movement variance before certification.",
      );
    const note = String(body.certification_note || "").trim();
    if (note.length < 10)
      throw new BadRequestException(
        "Enter a meaningful finance certification note.",
      );
    const { data, error: updateError } = await this.supabase
      .from("inventory_valuation_runs")
      .update({
        status: "CERTIFIED",
        certified_by: userId,
        certified_at: new Date().toISOString(),
        certification_note: note,
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .eq("status", "DRAFT")
      .select()
      .single();
    if (updateError) throw new BadRequestException(updateError.message);
    return data;
  }
}
