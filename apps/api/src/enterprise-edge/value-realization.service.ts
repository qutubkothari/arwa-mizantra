import { BadRequestException, Injectable } from "@nestjs/common";
import { createHash } from "crypto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

@Injectable()
export class ValueRealizationService {
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
    const result = Number(value);
    return Number.isFinite(result) ? result : 0;
  }
  private async initiative(tenantId: string, id: string) {
    const { data, error } = await this.db
      .from("value_realization_initiatives")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) this.fail(error, "Value initiative not found.");
    return data;
  }
  private async claim(tenantId: string, id: string) {
    const { data, error } = await this.db
      .from("value_realization_claims")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) this.fail(error, "Benefit claim not found.");
    return data;
  }

  private hash(value: any) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  private async sourceBenefit(tenantId: string, id: string) {
    const { data, error } = await this.db
      .from("value_source_benefits")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) this.fail(error, "Connected benefit not found.");
    return data;
  }

  async dashboard(tenantId: string) {
    const [initiativeResult, claimResult, sourceResult, overlapResult, profileResult, statementResult, benchmarkResult, benchmarkConsentResult, currentCountryResult, benchmarkProfilesResult] = await Promise.all([
      this.db
        .from("value_realization_initiatives")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }),
      this.db
        .from("value_realization_claims")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }),
      this.db.from("value_source_benefits").select("*").eq("tenant_id", tenantId).order("source_verified_at", { ascending: false }),
      this.db.from("value_benefit_overlaps").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
      this.db.from("value_commercial_profiles").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
      this.db.from("value_roi_statements").select("*").eq("tenant_id", tenantId).order("period_from", { ascending: false }),
      this.db.from("value_roi_statements").select("tenant_id,roi_pct,net_benefit,status").eq("status", "ISSUED").not("roi_pct", "is", null),
      this.db.from("value_country_profiles").select("tenant_id").eq("benchmarking_consent", true),
      this.db.from("value_country_profiles").select("*").eq("tenant_id", tenantId).maybeSingle(),
      this.db.from("value_country_profiles").select("tenant_id,market,benchmark_segment").eq("benchmarking_consent", true),
    ]);
    if (initiativeResult.error)
      this.fail(initiativeResult.error, "Unable to load value initiatives.");
    if (claimResult.error)
      this.fail(claimResult.error, "Unable to load benefit claims.");
    if (sourceResult.error) this.fail(sourceResult.error, "Unable to load connected benefits.");
    if (overlapResult.error) this.fail(overlapResult.error, "Unable to load benefit attributions.");
    if (profileResult.error) this.fail(profileResult.error, "Unable to load commercial profile.");
    if (statementResult.error) this.fail(statementResult.error, "Unable to load ROI statements.");
    if (benchmarkResult.error) this.fail(benchmarkResult.error, "Unable to load anonymized ROI benchmark.");
    if (benchmarkConsentResult.error) this.fail(benchmarkConsentResult.error, "Unable to load benchmark consent.");
    if (currentCountryResult.error || benchmarkProfilesResult.error) this.fail(currentCountryResult.error || benchmarkProfilesResult.error, "Unable to load benchmark cohort.");
    const initiatives = initiativeResult.data || [];
    const claims = claimResult.data || [];
    const initiativeMap = new Map(
      initiatives.map((row: any) => [String(row.id), row]),
    );
    const enrichedClaims = claims.map((row: any) => ({
      ...row,
      initiative: initiativeMap.get(String(row.initiative_id)),
      confidence_adjusted_amount:
        row.status === "REJECTED"
          ? 0
          : row.status === "VERIFIED"
            ? this.number(row.verified_amount)
            : (this.number(row.claimed_amount) *
                this.number(row.confidence_pct)) /
              100,
    }));
    const verified = enrichedClaims.filter(
      (row: any) => row.status === "VERIFIED",
    );
    const verifiedBenefit = verified.reduce(
      (sum: number, row: any) => sum + this.number(row.verified_amount),
      0,
    );
    const investment = initiatives
      .filter((row: any) => row.status !== "CANCELLED")
      .reduce(
        (sum: number, row: any) =>
          sum + this.number(row.implementation_investment),
        0,
      );
    const sourceBenefits = sourceResult.data || [];
    const overlaps = overlapResult.data || [];
    const financeVerifiedSources = sourceBenefits.filter((row: any) => row.finance_status === "FINANCE_VERIFIED" && !row.drift_detected);
    const connectedGross = financeVerifiedSources.reduce((sum: number, row: any) => sum + this.number(row.finance_verified_amount), 0);
    const approvedOverlap = overlaps.filter((row: any) => row.status === "APPROVED").reduce((sum: number, row: any) => sum + this.number(row.overlap_amount), 0);
    const connectedNet = Math.max(0, connectedGross - approvedOverlap);
    const today = new Date().toISOString().slice(0, 10);
    const leakageAlerts = [
      ...sourceBenefits.filter((row: any) => row.finance_status === "SOURCE_VERIFIED").map((row: any) => ({severity:"MEDIUM",type:"FINANCE_VERIFICATION",title:`Finance verification pending: ${row.benefit_title}`,amount:this.number(row.gross_amount),source:row.source_module})),
      ...sourceBenefits.filter((row: any) => row.drift_detected).map((row: any) => ({severity:"HIGH",type:"EVIDENCE_DRIFT",title:`Evidence drift: ${row.benefit_title}`,amount:this.number(row.finance_verified_amount || row.gross_amount),source:row.source_module})),
      ...initiatives.filter((row: any) => row.status !== "CLOSED" && row.status !== "CANCELLED" && row.target_date < today).map((row: any) => ({severity:"HIGH",type:"TARGET_OVERDUE",title:`Target overdue: ${row.title}`,amount:this.number(row.target_benefit),source:row.source_module})),
    ];
    const currentCohort=currentCountryResult.data;
    const consentedTenants=new Set((benchmarkConsentResult.data||[]).map((row:any)=>row.tenant_id));
    const cohortTenants=new Set((benchmarkProfilesResult.data||[]).filter((row:any)=>row.market===currentCohort?.market&&String(row.benchmark_segment||'').trim().toUpperCase()===String(currentCohort?.benchmark_segment||'').trim().toUpperCase()).map((row:any)=>row.tenant_id));
    const benchmarkRows=(benchmarkResult.data||[]).filter((row:any)=>row.tenant_id!==tenantId&&consentedTenants.has(row.tenant_id)&&cohortTenants.has(row.tenant_id)).map((row:any)=>this.number(row.roi_pct)).sort((a:number,b:number)=>a-b);
    const currentRoi=statementResult.data?.find((row:any)=>row.status==='ISSUED')?.roi_pct;
    const benchmarkEligible=benchmarkRows.length>=3;
    const percentile=benchmarkEligible&&currentRoi!=null?Math.round(100*benchmarkRows.filter((x:number)=>x<=this.number(currentRoi)).length/benchmarkRows.length):null;
    return {
      kpis: {
        target_benefit: initiatives
          .filter((row: any) => row.status !== "CANCELLED")
          .reduce(
            (sum: number, row: any) => sum + this.number(row.target_benefit),
            0,
          ),
        submitted_benefit: enrichedClaims
          .filter((row: any) => row.status === "SUBMITTED")
          .reduce(
            (sum: number, row: any) => sum + this.number(row.claimed_amount),
            0,
          ),
        confidence_adjusted_pipeline: enrichedClaims.reduce(
          (sum: number, row: any) =>
            sum + this.number(row.confidence_adjusted_amount),
          0,
        ),
        verified_benefit: verifiedBenefit,
        verified_cash_release: verified
          .filter((row: any) => row.benefit_type === "CASH_RELEASE")
          .reduce(
            (sum: number, row: any) => sum + this.number(row.verified_amount),
            0,
          ),
        implementation_investment: investment,
        verified_roi_pct:
          investment > 0
            ? ((verifiedBenefit - investment) / investment) * 100
            : null,
        pending_finance_verification: enrichedClaims.filter(
          (row: any) => row.status === "SUBMITTED",
        ).length,
        connected_source_benefit: connectedGross,
        duplicate_overlap_deduction: approvedOverlap,
        connected_net_benefit: connectedNet,
        connected_pending_finance: sourceBenefits.filter((row: any) => row.finance_status === "SOURCE_VERIFIED").length,
        evidence_drift_alerts: sourceBenefits.filter((row: any) => row.drift_detected).length,
        benefit_leakage_amount: leakageAlerts.reduce((sum:number,row:any)=>sum+this.number(row.amount),0),
      },
      initiatives,
      claims: enrichedClaims,
      source_benefits: sourceBenefits,
      overlaps,
      commercial_profiles: profileResult.data || [],
      statements: statementResult.data || [],
      leakage_alerts: leakageAlerts,
      benchmark: {sample_size:benchmarkRows.length, eligible:benchmarkEligible, cohort:{market:currentCohort?.market||null,segment:currentCohort?.benchmark_segment||null}, current_roi_pct:currentRoi==null?null:this.number(currentRoi), percentile, privacy_note:'A benchmark is suppressed until at least three explicitly consenting, country-and-segment-matched tenants are in the cohort. Results are aggregate and anonymized; no client identities or raw financial records are exposed.'},
    };
  }

  async createInitiative(tenantId: string, userId: string, body: any) {
    const code = this.text(body.initiative_code).toUpperCase();
    const title = this.text(body.title);
    const module = this.text(body.source_module).toUpperCase();
    const owner = this.text(body.owner_reference);
    const from = this.text(body.baseline_period_from);
    const to = this.text(body.baseline_period_to);
    const evidence = this.text(body.baseline_evidence);
    const targetDate = this.text(body.target_date);
    const target = this.number(body.target_benefit);
    const baseline = this.number(body.baseline_value);
    const investment = this.number(body.implementation_investment);
    if (
      !code ||
      !title ||
      !module ||
      !owner ||
      !from ||
      !to ||
      from > to ||
      !evidence ||
      !targetDate ||
      target <= 0 ||
      baseline < 0 ||
      investment < 0
    )
      this.fail(
        null,
        "Code, title, module, owner, valid baseline period/evidence, positive target and target date are required.",
      );
    const { data, error } = await this.db
      .from("value_realization_initiatives")
      .insert({
        tenant_id: tenantId,
        initiative_code: code,
        title,
        source_module: module,
        source_reference: this.text(body.source_reference) || null,
        owner_reference: owner,
        baseline_period_from: from,
        baseline_period_to: to,
        baseline_value: baseline,
        baseline_evidence: evidence,
        target_benefit: target,
        implementation_investment: investment,
        target_date: targetDate,
        created_by: userId,
      })
      .select()
      .single();
    if (error) this.fail(error, "Unable to create value initiative.");
    return data;
  }

  async approveInitiative(
    tenantId: string,
    userId: string,
    id: string,
    body: any,
  ) {
    const initiative = await this.initiative(tenantId, id);
    const note = this.text(body.approval_note);
    if (
      initiative.status !== "PROPOSED" ||
      initiative.created_by === userId ||
      !note
    )
      this.fail(
        null,
        "Independent approval with a documented business-case rationale is required.",
      );
    return this.transitionInitiative(tenantId, id, "PROPOSED", {
      status: "APPROVED",
      approved_by: userId,
      approval_note: note,
      approved_at: new Date().toISOString(),
    });
  }

  async createClaim(tenantId: string, userId: string, body: any) {
    const initiativeId = this.text(body.initiative_id);
    const initiative = await this.initiative(tenantId, initiativeId);
    const type = this.text(body.benefit_type).toUpperCase();
    const from = this.text(body.period_from);
    const to = this.text(body.period_to);
    const amount = this.number(body.claimed_amount);
    const confidence = this.number(body.confidence_pct);
    const method = this.text(body.measurement_method);
    const source = this.text(body.source_reference);
    const evidence = this.text(body.evidence_reference);
    if (
      initiative.status !== "APPROVED" ||
      ![
        "CASH_RELEASE",
        "COST_SAVING",
        "REVENUE_UPLIFT",
        "RISK_AVOIDANCE",
      ].includes(type) ||
      !from ||
      !to ||
      from > to ||
      amount <= 0 ||
      confidence < 0 ||
      confidence > 100 ||
      !method ||
      !source ||
      !evidence
    )
      this.fail(
        null,
        "An approved initiative, valid period, positive benefit, confidence, measurement method and source evidence are required.",
      );
    const fingerprint = createHash("sha256")
      .update(
        [initiativeId, type, from, to, source.toUpperCase()]
          .map((value) => value.trim())
          .join("|"),
      )
      .digest("hex");
    const { data, error } = await this.db
      .from("value_realization_claims")
      .insert({
        tenant_id: tenantId,
        initiative_id: initiativeId,
        benefit_type: type,
        period_from: from,
        period_to: to,
        claimed_amount: amount,
        confidence_pct: confidence,
        measurement_method: method,
        source_reference: source,
        evidence_reference: evidence,
        claim_fingerprint: fingerprint,
        created_by: userId,
      })
      .select()
      .single();
    if (error?.code === "23505")
      this.fail(
        null,
        "Duplicate benefit claim blocked: this source, period and benefit type were already claimed.",
      );
    if (error) this.fail(error, "Unable to submit benefit claim.");
    return data;
  }

  async verifyClaim(tenantId: string, userId: string, id: string, body: any) {
    const claim = await this.claim(tenantId, id);
    const amount = this.number(body.verified_amount);
    const evidence = this.text(body.finance_evidence);
    const note = this.text(body.verifier_note);
    if (
      claim.status !== "SUBMITTED" ||
      claim.created_by === userId ||
      amount <= 0 ||
      amount > this.number(claim.claimed_amount) ||
      !evidence ||
      !note
    )
      this.fail(
        null,
        "An independent finance verifier, amount up to the claim, ledger/bank evidence and note are required.",
      );
    return this.transitionClaim(tenantId, id, "SUBMITTED", {
      status: "VERIFIED",
      verified_amount: amount,
      finance_evidence: evidence,
      verifier_note: note,
      confidence_pct: 100,
      verified_by: userId,
      verified_at: new Date().toISOString(),
    });
  }

  async rejectClaim(tenantId: string, userId: string, id: string, body: any) {
    const claim = await this.claim(tenantId, id);
    const reason = this.text(body.rejection_reason);
    if (claim.status !== "SUBMITTED" || claim.created_by === userId || !reason)
      this.fail(null, "Independent rejection with a reason is required.");
    return this.transitionClaim(tenantId, id, "SUBMITTED", {
      status: "REJECTED",
      rejection_reason: reason,
      rejected_by: userId,
      rejected_at: new Date().toISOString(),
    });
  }

  async closeInitiative(
    tenantId: string,
    userId: string,
    id: string,
    body: any,
  ) {
    const initiative = await this.initiative(tenantId, id);
    const evidence = this.text(body.closure_evidence);
    const { count, error } = await this.db
      .from("value_realization_claims")
      .select("*", { head: true, count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("initiative_id", id)
      .eq("status", "SUBMITTED");
    if (error) this.fail(error, "Unable to validate pending claims.");
    if (
      initiative.status !== "APPROVED" ||
      initiative.created_by === userId ||
      !evidence ||
      (count || 0) > 0
    )
      this.fail(
        null,
        "Independent closure evidence is required and every benefit claim must first be verified or rejected.",
      );
    return this.transitionInitiative(tenantId, id, "APPROVED", {
      status: "CLOSED",
      closure_evidence: evidence,
      closed_by: userId,
      closed_at: new Date().toISOString(),
    });
  }

  async syncSources(tenantId: string) {
    const specs: any[] = [
      { table: "treasury_optimization_actions", module: "TREASURY", statuses: ["VERIFIED"], title: (r: any) => `${r.action_type}: ${r.action_description}`, evidence: "verification_evidence", verifiedBy: "verified_by", verifiedAt: "verified_at", benefits: [
        ["CASH_RELEASE", "CASH_RELEASE", "ONE_TIME", "realized_cash_release", "target_cash_release"],
        ["ANNUAL_SAVINGS", "ACCOUNTING_SAVING", "ANNUALIZED", "realized_annual_savings", "target_annual_savings"],
      ] },
      { table: "inventory_disposition_cases", module: "INVENTORY", statuses: ["VERIFIED"], title: (r: any) => `${r.classification} inventory disposition: ${r.disposition_action}`, evidence: "verification_evidence", verifiedBy: "verified_by", verifiedAt: "verified_at", benefits: [
        ["CASH_RELEASE", "WORKING_CAPITAL", "ONE_TIME", "realized_cash_release", "target_cash_release"],
        ["CARRYING_COST", "ACCOUNTING_SAVING", "ANNUALIZED", "realized_carrying_cost_avoidance", "target_annual_carrying_cost_avoidance"],
      ] },
      { table: "project_margin_recovery_actions", module: "PROJECTS", statuses: ["VERIFIED"], title: (r: any) => `${r.issue_category}: ${r.action_description}`, evidence: "verification_evidence", verifiedBy: "verified_by", verifiedAt: "verified_at", benefits: [
        ["MARGIN_RECOVERY", "ACCOUNTING_SAVING", "ONE_TIME", "realized_margin_recovery", "target_margin_recovery"],
        ["CASH_ACCELERATION", "CASH_RELEASE", "ONE_TIME", "realized_cash_acceleration", "target_cash_acceleration"],
      ] },
      { table: "workforce_gap_actions", module: "WORKFORCE", statuses: ["VERIFIED"], title: (r: any) => `${r.action_type}: ${r.action_description}`, evidence: "verification_evidence", verifiedBy: "verified_by", verifiedAt: "verified_at", benefits: [["COST_AVOIDANCE", "ACCOUNTING_SAVING", "ANNUALIZED", "realized_annual_cost_avoidance", "target_annual_cost_avoidance"]] },
      { table: "control_remediation_actions", module: "CONTROLS", statuses: ["VERIFIED"], title: (r: any) => r.action_description, evidence: "verification_evidence", verifiedBy: "verified_by", verifiedAt: "verified_at", benefits: [["LOSS_PREVENTION", "RISK_AVOIDANCE", "ONE_TIME", "realized_loss_prevention", "target_loss_prevention"]] },
      { table: "warehouse_slotting_recommendations", module: "WAREHOUSE", statuses: ["VERIFIED"], title: (r: any) => `Slotting recommendation ${r.id}`, evidence: "verification_evidence", verifiedBy: "verified_by", verifiedAt: "verified_at", benefits: [["ANNUAL_SAVINGS", "ACCOUNTING_SAVING", "ANNUALIZED", "realized_annual_savings", "target_annual_savings"]] },
      { table: "ehs_actions", module: "EHS", statuses: ["VERIFIED"], title: (r: any) => r.action_title, evidence: "verification_evidence", verifiedBy: "verified_by", verifiedAt: "verified_at", benefits: [["ANNUAL_SAVINGS", "RISK_AVOIDANCE", "ANNUALIZED", "realized_annual_savings", "target_annual_savings"]] },
      { table: "engineering_change_requests", module: "ENGINEERING", statuses: ["VERIFIED"], title: (r: any) => `${r.change_number}: ${r.title}`, evidence: "verification_evidence", verifiedBy: "verified_by", verifiedAt: "verified_at", benefits: [["COST_AVOIDANCE", "RISK_AVOIDANCE", "ONE_TIME", "realized_avoidance", "estimated_avoidance"]] },
      { table: "manufacturing_loss_actions", module: "MANUFACTURING", statuses: ["VERIFIED"], title: (r: any) => r.action_title, evidence: "verification_evidence", verifiedBy: "verified_by", verifiedAt: "verified_at", benefits: [["LOSS_RECOVERY", "ACCOUNTING_SAVING", "ONE_TIME", "realized_savings", "target_savings"]] },
      { table: "quality_capa_cases", module: "QUALITY", statuses: ["EFFECTIVE"], title: (r: any) => `${r.capa_number}: ${r.title}`, evidence: "verification_evidence", verifiedBy: "verified_by", verifiedAt: "verified_at", benefits: [
        ["ANNUAL_AVOIDANCE", "RISK_AVOIDANCE", "ANNUALIZED", "realized_annual_avoidance", "estimated_annual_avoidance"],
        ["SUPPLIER_RECOVERY", "CASH_RELEASE", "ONE_TIME", "supplier_recovered_amount", "supplier_claim_amount"],
      ] },
      { table: "procurement_savings_opportunities", module: "PROCUREMENT", statuses: ["REALIZED"], title: (r: any) => r.title, evidence: "evidence_reference", verifiedBy: "realized_by", verifiedAt: "realized_at", benefits: [["REALIZED_SAVINGS", "ACCOUNTING_SAVING", "ONE_TIME", "realized_savings", "expected_savings"]] },
    ];
    let inserted = 0;
    let unchanged = 0;
    let drifted = 0;
    const skipped: string[] = [];
    for (const spec of specs) {
      const { data: rows, error } = await this.db.from(spec.table).select("*").eq("tenant_id", tenantId).in("status", spec.statuses);
      if (error) {
        skipped.push(`${spec.module}: ${error.message}`);
        continue;
      }
      for (const row of rows || []) {
        for (const benefit of spec.benefits) {
          const gross = this.number(row[benefit[3]]);
          if (gross <= 0 || !row[spec.verifiedAt]) continue;
          const snapshot = {
            amount: gross,
            baseline: this.number(row[benefit[4]]),
            evidence: this.text(row[spec.evidence]),
            verified_by: row[spec.verifiedBy] || null,
            verified_at: row[spec.verifiedAt],
          };
          const snapshotHash = this.hash(snapshot);
          const { data: existing, error: existingError } = await this.db.from("value_source_benefits").select("*")
            .eq("tenant_id", tenantId).eq("source_table", spec.table).eq("source_record_id", row.id).eq("source_benefit_key", benefit[0]).maybeSingle();
          if (existingError) this.fail(existingError, "Unable to inspect connected benefit.");
          if (existing) {
            if (existing.source_snapshot_hash !== snapshotHash) {
              const { error: driftError } = await this.db.from("value_source_benefits").update({ drift_detected: true, drift_details: { previous_hash: existing.source_snapshot_hash, observed_hash: snapshotHash, observed_snapshot: snapshot }, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", existing.id).eq("tenant_id", tenantId);
              if (driftError) this.fail(driftError, "Unable to flag source evidence drift.");
              drifted++;
            } else {
              await this.db.from("value_source_benefits").update({ last_synced_at: new Date().toISOString() }).eq("id", existing.id).eq("tenant_id", tenantId);
              unchanged++;
            }
            continue;
          }
          const sourceReference = `${spec.table}/${row.id}`;
          const { error: insertError } = await this.db.from("value_source_benefits").insert({
            tenant_id: tenantId, source_module: spec.module, source_table: spec.table, source_record_id: row.id,
            source_benefit_key: benefit[0], source_reference: sourceReference, benefit_title: this.text(spec.title(row)) || sourceReference,
            benefit_class: benefit[1], realization_basis: benefit[2], baseline_amount: snapshot.baseline,
            baseline_evidence: `${sourceReference} / ${benefit[4]}`, gross_amount: gross,
            outcome_evidence: snapshot.evidence || `${sourceReference} / verified source outcome`,
            source_verified_by: snapshot.verified_by, source_verified_at: snapshot.verified_at, source_snapshot_hash: snapshotHash,
          });
          if (insertError?.code === "23505") unchanged++;
          else if (insertError) this.fail(insertError, `Unable to connect ${spec.module} benefit.`);
          else inserted++;
        }
      }
    }
    return { inserted, unchanged, drifted, skipped };
  }

  async verifySourceBenefit(tenantId: string, userId: string, id: string, body: any) {
    const benefit = await this.sourceBenefit(tenantId, id);
    const amount = this.number(body.finance_verified_amount);
    const evidence = this.text(body.finance_evidence);
    const note = this.text(body.finance_note);
    if (benefit.finance_status !== "SOURCE_VERIFIED" || benefit.drift_detected || benefit.source_verified_by === userId || amount <= 0 || amount > this.number(benefit.gross_amount) || !evidence || !note)
      this.fail(null, "Independent finance verification, an amount up to the source outcome, finance evidence and a note are required; drift alerts must be resolved at source.");
    const { data, error } = await this.db.from("value_source_benefits").update({ finance_status: "FINANCE_VERIFIED", finance_verified_amount: amount, finance_evidence: evidence, finance_note: note, finance_verified_by: userId, finance_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", id).eq("finance_status", "SOURCE_VERIFIED").select().maybeSingle();
    if (error || !data) this.fail(error, "Unable to verify connected benefit.");
    return data;
  }

  async rejectSourceBenefit(tenantId: string, userId: string, id: string, body: any) {
    const benefit = await this.sourceBenefit(tenantId, id);
    const reason = this.text(body.rejection_reason);
    if (benefit.finance_status !== "SOURCE_VERIFIED" || benefit.source_verified_by === userId || !reason) this.fail(null, "Independent finance rejection with a reason is required.");
    const { data, error } = await this.db.from("value_source_benefits").update({ finance_status: "REJECTED", rejection_reason: reason, rejected_by: userId, rejected_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", id).eq("finance_status", "SOURCE_VERIFIED").select().maybeSingle();
    if (error || !data) this.fail(error, "Unable to reject connected benefit.");
    return data;
  }

  async proposeOverlap(tenantId: string, userId: string, body: any) {
    const ids = [this.text(body.primary_benefit_id), this.text(body.overlapping_benefit_id)].sort();
    const amount = this.number(body.overlap_amount);
    const rationale = this.text(body.rationale);
    if (!ids[0] || !ids[1] || ids[0] === ids[1] || amount <= 0 || !rationale) this.fail(null, "Two different connected benefits, a positive overlap and rationale are required.");
    const benefits = await Promise.all(ids.map((id) => this.sourceBenefit(tenantId, id)));
    if (benefits.some((row: any) => row.finance_status !== "FINANCE_VERIFIED") || amount > Math.min(...benefits.map((row: any) => this.number(row.finance_verified_amount)))) this.fail(null, "Both benefits must be finance verified and overlap cannot exceed either verified amount.");
    const { data, error } = await this.db.from("value_benefit_overlaps").insert({ tenant_id: tenantId, primary_benefit_id: ids[0], overlapping_benefit_id: ids[1], overlap_amount: amount, rationale, proposed_by: userId }).select().single();
    if (error?.code === "23505") this.fail(null, "This benefit pair already has an attribution decision.");
    if (error) this.fail(error, "Unable to propose benefit overlap.");
    return data;
  }

  async approveOverlap(tenantId: string, userId: string, id: string) {
    const { data: overlap, error } = await this.db.from("value_benefit_overlaps").select("*").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
    if (error || !overlap || overlap.status !== "PROPOSED" || overlap.proposed_by === userId) this.fail(error, "Independent approval of a proposed overlap is required.");
    const { data: approved } = await this.db.from("value_benefit_overlaps").select("*").eq("tenant_id", tenantId).eq("status", "APPROVED");
    for (const benefitId of [overlap.primary_benefit_id, overlap.overlapping_benefit_id]) {
      const benefit = await this.sourceBenefit(tenantId, benefitId);
      const used = (approved || []).filter((row: any) => row.primary_benefit_id === benefitId || row.overlapping_benefit_id === benefitId).reduce((sum: number, row: any) => sum + this.number(row.overlap_amount), 0);
      if (used + this.number(overlap.overlap_amount) > this.number(benefit.finance_verified_amount)) this.fail(null, "Approved overlaps cannot deduct more than a benefit's finance-verified value.");
    }
    const { data, error: updateError } = await this.db.from("value_benefit_overlaps").update({ status: "APPROVED", approved_by: userId, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", id).eq("status", "PROPOSED").select().maybeSingle();
    if (updateError || !data) this.fail(updateError, "Unable to approve benefit overlap.");
    return data;
  }

  async createCommercialProfile(tenantId: string, userId: string, body: any) {
    const reference = this.text(body.contract_reference);
    const start = this.text(body.service_start_date);
    const monthly = this.number(body.monthly_subscription_value);
    const implementation = this.number(body.implementation_investment);
    const evidence = this.text(body.commercial_evidence);
    if (!reference || !start || monthly <= 0 || implementation < 0 || !evidence) this.fail(null, "Contract reference, service start, positive monthly subscription and commercial evidence are required.");
    const { data, error } = await this.db.from("value_commercial_profiles").insert({ tenant_id: tenantId, contract_reference: reference, service_start_date: start, monthly_subscription_value: monthly, implementation_investment: implementation, commercial_evidence: evidence, created_by: userId }).select().single();
    if (error) this.fail(error, "Unable to create commercial profile.");
    return data;
  }

  async approveCommercialProfile(tenantId: string, userId: string, id: string) {
    const { data: profile, error } = await this.db.from("value_commercial_profiles").select("*").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
    if (error || !profile || profile.status !== "PROPOSED" || profile.created_by === userId) this.fail(error, "Independent approval of a proposed commercial profile is required.");
    const { count } = await this.db.from("value_commercial_profiles").select("*", { head: true, count: "exact" }).eq("tenant_id", tenantId).eq("status", "APPROVED");
    if ((count || 0) > 0) this.fail(null, "Supersede the current approved commercial profile before approving another.");
    const { data, error: updateError } = await this.db.from("value_commercial_profiles").update({ status: "APPROVED", approved_by: userId, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", id).eq("status", "PROPOSED").select().maybeSingle();
    if (updateError || !data) this.fail(updateError, "Unable to approve commercial profile.");
    return data;
  }

  async generateStatement(tenantId: string, userId: string, body: any) {
    const from = this.text(body.period_from);
    const to = this.text(body.period_to);
    if (!from || !to || from > to) this.fail(null, "A valid statement period is required.");
    const { data: profile, error: profileError } = await this.db.from("value_commercial_profiles").select("*").eq("tenant_id", tenantId).eq("status", "APPROVED").maybeSingle();
    if (profileError || !profile) this.fail(profileError, "An approved commercial profile is required.");
    const { data: benefits, error: benefitError } = await this.db.from("value_source_benefits").select("*").eq("tenant_id", tenantId).eq("finance_status", "FINANCE_VERIFIED").eq("drift_detected", false).lte("source_verified_at", `${to}T23:59:59.999Z`);
    if (benefitError) this.fail(benefitError, "Unable to calculate statement benefits.");
    const { data: cadenceRows, error: cadenceError } = await this.db.from("value_benefit_cadence").select("benefit_id,durability_status,status,next_review_date,expiry_date").eq("tenant_id", tenantId);
    if (cadenceError) this.fail(cadenceError, "Unable to enforce benefit durability.");
    const cadenceByBenefit=new Map((cadenceRows||[]).map((row:any)=>[row.benefit_id,row]));
    const snapshot = (benefits || []).map((row: any) => {
      const cadence=cadenceByBenefit.get(row.id);
      const durable = !cadence || (cadence.status === "ACTIVE" && !["REVERSED","EXPIRED"].includes(cadence.durability_status) && (!cadence.expiry_date || cadence.expiry_date >= from) && cadence.next_review_date >= from);
      if (!durable) return null;
      const verifiedDate = String(row.source_verified_at).slice(0, 10);
      const included = row.realization_basis === "ANNUALIZED" ? verifiedDate <= to : verifiedDate >= from && verifiedDate <= to;
      const credited_amount = included ? (row.realization_basis === "ANNUALIZED" ? this.number(row.finance_verified_amount) / 12 : this.number(row.finance_verified_amount)) : 0;
      return { id: row.id, source_module: row.source_module, source_reference: row.source_reference, benefit_title: row.benefit_title, benefit_class: row.benefit_class, realization_basis: row.realization_basis, finance_verified_amount: this.number(row.finance_verified_amount), credited_amount };
    }).filter((row: any) => row && row.credited_amount > 0);
    const gross = snapshot.reduce((sum: number, row: any) => sum + row.credited_amount, 0);
    const includedIds = new Set(snapshot.map((row: any) => row.id));
    const { data: overlaps } = await this.db.from("value_benefit_overlaps").select("*").eq("tenant_id", tenantId).eq("status", "APPROVED");
    const overlapDeduction = (overlaps || []).filter((row: any) => includedIds.has(row.primary_benefit_id) && includedIds.has(row.overlapping_benefit_id)).reduce((sum: number, row: any) => {
      const source = (benefits || []).find((benefit: any) => benefit.id === row.primary_benefit_id);
      return sum + (source?.realization_basis === "ANNUALIZED" ? this.number(row.overlap_amount) / 12 : this.number(row.overlap_amount));
    }, 0);
    const net = Math.max(0, gross - overlapDeduction);
    const { data: prior } = await this.db.from("value_roi_statements").select("*").eq("tenant_id", tenantId).eq("status", "ISSUED").lt("period_to", from).order("period_to", { ascending: false }).limit(1).maybeSingle();
    const { data: tcoCosts, error: tcoError } = await this.db.from("value_commercial_costs").select("*").eq("tenant_id", tenantId).eq("status", "ACTIVE").lte("effective_from", to);
    if (tcoError) this.fail(tcoError, "Unable to calculate client TCO.");
    const extraCost = (tcoCosts || []).filter((cost:any) => !cost.effective_to || cost.effective_to >= from).reduce((sum:number, cost:any) => {
      const frequency=String(cost.recurring_frequency||"ONE_TIME");
      const value=this.number(cost.amount);
      const credit=String(cost.cost_type)==="CREDIT" ? -Math.abs(value) : value;
      return sum + (frequency === "MONTHLY" ? credit : frequency === "ANNUAL" ? credit / 12 : (cost.effective_from >= from && cost.effective_from <= to ? credit : 0));
    }, 0);
    const cashBenefit=snapshot.filter((x:any)=>["CASH_RELEASE","WORKING_CAPITAL"].includes(x.benefit_class)).reduce((sum:number,x:any)=>sum+this.number(x.credited_amount),0);
    const accountingBenefit=snapshot.filter((x:any)=>["ACCOUNTING_SAVING","REVENUE_UPLIFT"].includes(x.benefit_class)).reduce((sum:number,x:any)=>sum+this.number(x.credited_amount),0);
    const riskBenefit=snapshot.filter((x:any)=>x.benefit_class==="RISK_AVOIDANCE").reduce((sum:number,x:any)=>sum+this.number(x.credited_amount),0);
    const { data: statementProofs } = await this.db.from("value_proof_links").select("status,expected_amount,proven_amount,benefit_id").eq("tenant_id",tenantId).in("benefit_id",snapshot.map((x:any)=>x.id));
    const proofMatched=Math.min(gross,(statementProofs||[]).filter((x:any)=>x.status==="MATCHED").reduce((sum:number,x:any)=>sum+this.number(x.proven_amount),0));
    const proofMismatch=(statementProofs||[]).filter((x:any)=>["MISMATCH","PARTIAL"].includes(x.status)).reduce((sum:number,x:any)=>sum+Math.abs(this.number(x.expected_amount)-this.number(x.proven_amount)),0);
    const cumulativeBenefit = this.number(prior?.cumulative_net_benefit) + net;
    const periodCost = this.number(profile.monthly_subscription_value) + extraCost + (prior ? 0 : this.number(profile.implementation_investment));
    const cumulativeCost = (prior ? this.number(prior.cumulative_client_cost) : 0) + periodCost;
    const netValue = cumulativeBenefit - cumulativeCost;
    const roi = cumulativeCost > 0 ? (netValue / cumulativeCost) * 100 : null;
    const statementPayload = { period_from: from, period_to: to, gross_benefit: gross, overlap_deduction: overlapDeduction, net_benefit: net, subscription_value: periodCost, cumulative_client_cost: cumulativeCost, cumulative_net_benefit: cumulativeBenefit, net_value_created: netValue, roi_pct: roi, payback_achieved: cumulativeBenefit >= cumulativeCost, payback_period_end: cumulativeBenefit >= cumulativeCost ? to : null, benefit_snapshot: snapshot, cash_benefit:cashBenefit, accounting_benefit:accountingBenefit, risk_benefit:riskBenefit, proof_matched_amount:proofMatched, proof_mismatch_amount:proofMismatch };
    const statementHash = this.hash(statementPayload);
    const { data: existing } = await this.db.from("value_roi_statements").select("*").eq("tenant_id", tenantId).eq("period_from", from).eq("period_to", to).maybeSingle();
    if (existing?.status === "ISSUED") this.fail(null, "An issued statement is immutable.");
    const query = existing ? this.db.from("value_roi_statements").update({ ...statementPayload, statement_hash: statementHash, generated_by: userId, updated_at: new Date().toISOString() }).eq("id", existing.id).eq("tenant_id", tenantId) : this.db.from("value_roi_statements").insert({ tenant_id: tenantId, ...statementPayload, statement_hash: statementHash, generated_by: userId });
    const { data, error } = await query.select().single();
    if (error) this.fail(error, "Unable to generate ROI statement.");
    return data;
  }

  async issueStatement(tenantId: string, userId: string, id: string) {
    const { data: statement, error } = await this.db.from("value_roi_statements").select("*").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
    if (error || !statement || statement.status !== "DRAFT" || statement.generated_by === userId) this.fail(error, "Independent issuance of a draft statement is required.");
    const { data, error: updateError } = await this.db.from("value_roi_statements").update({ status: "ISSUED", issued_by: userId, issued_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", id).eq("status", "DRAFT").select().maybeSingle();
    if (updateError || !data) this.fail(updateError, "Unable to issue ROI statement.");
    return data;
  }

  // Value Graph / proof layer. It deliberately references the accounting source of truth
  // rather than copying financial records into an ROI-only ledger.
  async moatDashboard(tenantId: string) {
    const [benefitsResult, proofsResult, edgesResult, baselinesResult, cadenceResult, costsResult, countryResult, statementsResult] = await Promise.all([
      this.db.from("value_source_benefits").select("*").eq("tenant_id", tenantId).order("source_verified_at", { ascending: false }),
      this.db.from("value_proof_links").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
      this.db.from("value_graph_edges").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
      this.db.from("value_baselines").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
      this.db.from("value_benefit_cadence").select("*").eq("tenant_id", tenantId).order("next_review_date"),
      this.db.from("value_commercial_costs").select("*").eq("tenant_id", tenantId).eq("status", "ACTIVE").order("effective_from", { ascending: false }),
      this.db.from("value_country_profiles").select("*").eq("tenant_id", tenantId).maybeSingle(),
      this.db.from("value_roi_statements").select("*").eq("tenant_id", tenantId).order("period_to", { ascending: false }),
    ]);
    for (const r of [benefitsResult, proofsResult, edgesResult, baselinesResult, cadenceResult, costsResult, countryResult, statementsResult]) if (r.error) this.fail(r.error, "Unable to load ROI moat controls.");
    const benefits = benefitsResult.data || [], proofs = proofsResult.data || [], cadence = cadenceResult.data || [];
    const today = new Date().toISOString().slice(0, 10);
    const assurance = benefits.map((benefit: any) => {
      const linked = proofs.filter((p: any) => p.benefit_id === benefit.id);
      const matched = Math.min(this.number(benefit.finance_verified_amount || benefit.gross_amount), linked.filter((p: any) => p.status === "MATCHED").reduce((n: number, p: any) => n + this.number(p.proven_amount), 0));
      const mismatch = linked.filter((p: any) => ["MISMATCH", "PARTIAL"].includes(p.status)).reduce((n: number, p: any) => n + Math.abs(this.number(p.expected_amount) - this.number(p.proven_amount)), 0);
      const schedule = cadence.find((c: any) => c.benefit_id === benefit.id);
      const expected = this.number(benefit.finance_verified_amount || benefit.gross_amount);
      const score = Math.round((benefit.outcome_evidence ? 15 : 0) + (benefit.finance_status === "FINANCE_VERIFIED" ? 20 : 0) + (benefit.source_verified_by !== benefit.finance_verified_by ? 10 : 0) + (expected > 0 ? Math.min(35, 35 * matched / expected) : 0) + (schedule?.durability_status === "SUSTAINED" ? 10 : 0) + (benefit.drift_detected ? 0 : 10));
      return { benefit_id: benefit.id, title: benefit.benefit_title, source_module: benefit.source_module, assurance_score: score, matched_amount: matched, mismatch_amount: mismatch, expected_amount: expected, durability_status: schedule?.durability_status || "PENDING", forecast_variance: schedule ? this.number(schedule.realized_to_date) - this.number(schedule.forecast_to_date) : null };
    });
    const overdue = cadence.filter((c: any) => c.status === "ACTIVE" && c.next_review_date < today);
    const market = countryResult.data?.market || "UAE";
    const libraries: any = { UAE: ["VAT/FTA evidence and recoverable VAT", "WPS and end-of-service benefit controls", "Working capital, retention and project-collection recovery"], INDIA: ["GST/TDS/e-invoice/e-way bill leakage prevention", "Receivables, input-credit and inventory turns", "PF/ESI/payroll statutory automation"], GLOBAL: ["Cash conversion, procurement, quality and operational resilience"] };
    const alerts = [
      ...overdue.map((c:any) => ({ severity:"HIGH", type:"REVALIDATION_OVERDUE", benefit_id:c.benefit_id, due_date:c.next_review_date })),
      ...assurance.filter((a:any) => a.assurance_score < 60).map((a:any) => ({ severity:"MEDIUM", type:"LOW_ASSURANCE", ...a })),
    ];
    const renewal=await this.renewalCockpit(tenantId);
    const intelligence=[
      ...alerts.map((a:any)=>({priority:a.severity==='HIGH'?95:70,category:a.type,title:a.title||`${a.type.replaceAll('_',' ')} requires action`,recommendation:a.type==='REVALIDATION_OVERDUE'?'Revalidate the operational outcome or stop future annualised credit.':'Link independent financial proof and request finance verification.',evidence:{benefit_id:a.benefit_id||null,due_date:a.due_date||null}})),
      ...proofs.filter((p:any)=>['MISMATCH','PARTIAL'].includes(p.status)).map((p:any)=>({priority:85,category:'PROOF_VARIANCE',title:`Proof variance: ${p.proof_reference}`,recommendation:'Resolve the amount variance against the reconciled source before client reporting.',evidence:{proof_id:p.id,expected:p.expected_amount,proven:p.proven_amount}})),
      ...(renewal.configured&&renewal.renewal_risk_score>=50?[{priority:90,category:'RENEWAL_RISK',title:`Renewal risk ${renewal.renewal_risk_score}/100`,recommendation:'Run an executive value review and assign the account action plan before renewal.',evidence:{days_to_renewal:renewal.days_to_renewal,value_coverage_ratio:renewal.value_coverage_ratio}}]:[]),
    ].sort((a:any,b:any)=>b.priority-a.priority).slice(0,20);
    return { benefits, proofs, graph_edges: edgesResult.data || [], baselines: baselinesResult.data || [], cadence, commercial_costs: costsResult.data || [], country_profile: countryResult.data || { market, benchmarking_consent:false }, statements: statementsResult.data || [], assurance, alerts, intelligence, country_value_library: libraries[market] || libraries.GLOBAL };
  }

  async createBaseline(tenantId: string, userId: string, body: any) {
    const key=this.text(body.baseline_key).toUpperCase(), title=this.text(body.title), from=this.text(body.period_from), to=this.text(body.period_to), evidence=this.text(body.evidence_reference);
    const value=this.number(body.baseline_value); if (!key || !title || !from || !to || from>to || !evidence || !Number.isFinite(value)) this.fail(null,"Baseline key, title, valid period, value and evidence are required.");
    const { data: prior }=await this.db.from("value_baselines").select("version_no").eq("tenant_id",tenantId).eq("baseline_key",key).order("version_no",{ascending:false}).limit(1).maybeSingle();
    const payload={tenant_id:tenantId,baseline_key:key,title,metric_type:this.text(body.metric_type).toUpperCase()||"CURRENCY",unit:this.text(body.unit)||"AED",currency:this.text(body.currency).toUpperCase()||"AED",period_from:from,period_to:to,baseline_value:value,volume_value:body.volume_value==null?null:this.number(body.volume_value),normalization_method:this.text(body.normalization_method).toUpperCase()||"NONE",seasonality_factor:this.number(body.seasonality_factor)||1,fx_rate:this.number(body.fx_rate)||1,inflation_factor:this.number(body.inflation_factor)||1,comparison_basis:this.text(body.comparison_basis)||"Comparable prior period",evidence_reference:evidence,version_no:(prior?.version_no||0)+1,created_by:userId};
    const {data,error}=await this.db.from("value_baselines").insert(payload).select().single(); if(error) this.fail(error,"Unable to create ROI baseline."); return data;
  }
  async approveBaseline(tenantId:string,userId:string,id:string){ const {data: row,error}=await this.db.from("value_baselines").select("*").eq("tenant_id",tenantId).eq("id",id).maybeSingle(); if(error||!row||row.status!=="DRAFT"||row.created_by===userId)this.fail(error,"Independent approval of a draft baseline is required."); await this.db.from("value_baselines").update({status:"SUPERSEDED",updated_at:new Date().toISOString()}).eq("tenant_id",tenantId).eq("baseline_key",row.baseline_key).eq("status","APPROVED"); const {data,error:updateError}=await this.db.from("value_baselines").update({status:"APPROVED",approved_by:userId,approved_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("tenant_id",tenantId).eq("id",id).eq("status","DRAFT").select().single(); if(updateError) this.fail(updateError,"Unable to approve ROI baseline."); return data; }

  async linkProof(tenantId:string,userId:string,benefitId:string,body:any){ const benefit=await this.sourceBenefit(tenantId,benefitId); const type=this.text(body.proof_type).toUpperCase(), reference=this.text(body.proof_reference), table=this.text(body.proof_table)||type; const expected=this.number(body.expected_amount||benefit.finance_verified_amount||benefit.gross_amount), proven=this.number(body.proven_amount); if(!type||!reference||expected<=0||proven<0)this.fail(null,"Proof type, reference, expected amount and a non-negative proven amount are required."); const variance=Math.abs(expected-proven), status=proven===0?"PENDING":variance<0.01?"MATCHED":proven<expected?"PARTIAL":"MISMATCH"; const {data,error}=await this.db.from("value_proof_links").upsert({tenant_id:tenantId,benefit_id:benefitId,proof_type:type,proof_table:table,proof_record_id:body.proof_record_id||null,proof_reference:reference,expected_amount:expected,proven_amount:proven,currency:this.text(body.currency).toUpperCase()||benefit.currency||"AED",proof_date:this.text(body.proof_date)||null,match_method:this.text(body.match_method).toUpperCase()||"MANUAL",confidence_pct:Math.max(0,Math.min(100,this.number(body.confidence_pct)||0)),status,match_details:body.match_details||{},linked_by:userId}).select().single(); if(error)this.fail(error,"Unable to link financial proof."); return data; }

  async autoMatchProofs(tenantId:string,userId:string){ const {data: benefits,error}=await this.db.from("value_source_benefits").select("*").eq("tenant_id",tenantId).eq("finance_status","FINANCE_VERIFIED").eq("drift_detected",false).in("benefit_class",["CASH_RELEASE","WORKING_CAPITAL"]); if(error)this.fail(error,"Unable to load cash benefits."); const [{data:tx,error:txError},{data:settlements,error:settlementError}]=await Promise.all([this.db.from("accounting_bank_transactions").select("id,transaction_date,reference_number,amount,direction,reconciliation_status,matched_journal_id").eq("tenant_id",tenantId).eq("reconciliation_status","MATCHED").order("transaction_date",{ascending:false}).limit(1000),this.db.from("accounting_settlements").select("id,settlement_date,reference_number,amount,journal_id,payment_method").eq("tenant_id",tenantId).order("settlement_date",{ascending:false}).limit(1000)]); if(txError||settlementError)this.fail(txError||settlementError,"Unable to inspect accounting proof."); let linked=0, candidates=0; for(const benefit of benefits||[]){ const expected=this.number(benefit.finance_verified_amount); const bankRows=(tx||[]).filter((x:any)=>Math.abs(this.number(x.amount)-expected)<=Math.max(1,expected*.01)); const settlementRows=(settlements||[]).filter((x:any)=>Math.abs(this.number(x.amount)-expected)<=Math.max(1,expected*.01)); candidates+=bankRows.length+settlementRows.length; for(const row of bankRows.slice(0,1)){ await this.linkProof(tenantId,userId,benefit.id,{proof_type:"BANK_TRANSACTION",proof_table:"accounting_bank_transactions",proof_record_id:row.id,proof_reference:row.reference_number||row.id,expected_amount:expected,proven_amount:this.number(row.amount),proof_date:row.transaction_date,match_method:"AMOUNT_AND_RECONCILED_BANK",confidence_pct:95,match_details:{direction:row.direction,journal_id:row.matched_journal_id}}); linked++; } for(const row of settlementRows.slice(0,1)){ await this.linkProof(tenantId,userId,benefit.id,{proof_type:"SETTLEMENT",proof_table:"accounting_settlements",proof_record_id:row.id,proof_reference:row.reference_number||row.id,expected_amount:expected,proven_amount:this.number(row.amount),proof_date:row.settlement_date,match_method:"AMOUNT_AND_POSTED_SETTLEMENT",confidence_pct:90,match_details:{payment_method:row.payment_method,journal_id:row.journal_id}}); linked++; } } return {linked,candidates,method:"Reconciled bank transactions and posted settlements are matched within 1%; review proof links before client issuance."}; }
  async detectDuplicateValue(tenantId:string,userId:string){ const {data: benefits,error}=await this.db.from("value_source_benefits").select("*").eq("tenant_id",tenantId).eq("finance_status","FINANCE_VERIFIED").eq("drift_detected",false);if(error)this.fail(error,"Unable to load benefits for duplicate detection.");let proposed=0;const rows=benefits||[];for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){const a=rows[i],b=rows[j],aa=this.number(a.finance_verified_amount),bb=this.number(b.finance_verified_amount);const days=Math.abs(new Date(a.source_verified_at).getTime()-new Date(b.source_verified_at).getTime())/86400000;const sameClass=a.benefit_class===b.benefit_class||(["CASH_RELEASE","WORKING_CAPITAL"].includes(a.benefit_class)&&["CASH_RELEASE","WORKING_CAPITAL"].includes(b.benefit_class));if(!sameClass||days>31||Math.abs(aa-bb)>Math.max(1,Math.max(aa,bb)*.1))continue;const ids=[a.id,b.id].sort();const {error:edgeError}=await this.db.from("value_graph_edges").upsert({tenant_id:tenantId,from_type:"BENEFIT",from_id:ids[0],to_type:"BENEFIT",to_id:ids[1],relationship_type:"DUPLICATES",allocation_pct:100,rationale:"Automated candidate: same economic class, similar finance-verified value and outcome date within 31 days.",confidence_pct:65,created_by:userId},{onConflict:"tenant_id,from_type,from_id,to_type,to_id,relationship_type",ignoreDuplicates:true});if(edgeError)this.fail(edgeError,"Unable to create duplicate-value candidate.");proposed++;}return {proposed,method:"Candidate only: similarity uses economic class, amount tolerance of 10% and 31-day outcome window; independent approval remains required."}; }

  async createGraphEdge(tenantId:string,userId:string,body:any){ const fromType=this.text(body.from_type).toUpperCase(),toType=this.text(body.to_type).toUpperCase(),fromId=this.text(body.from_id),toId=this.text(body.to_id),relation=this.text(body.relationship_type).toUpperCase(),rationale=this.text(body.rationale); if(!fromType||!toType||!fromId||!toId||!relation||!rationale)this.fail(null,"Both graph nodes, relationship and rationale are required."); const {data,error}=await this.db.from("value_graph_edges").upsert({tenant_id:tenantId,from_type:fromType,from_id:fromId,to_type:toType,to_id:toId,relationship_type:relation,allocation_pct:this.number(body.allocation_pct)||100,rationale,confidence_pct:this.number(body.confidence_pct)||100,created_by:userId},{onConflict:"tenant_id,from_type,from_id,to_type,to_id,relationship_type"}).select().single(); if(error)this.fail(error,"Unable to create Value Graph link."); return data; }
  async approveGraphEdge(tenantId:string,userId:string,id:string){ const {data:row,error}=await this.db.from("value_graph_edges").select("*").eq("tenant_id",tenantId).eq("id",id).maybeSingle(); if(error||!row||row.status!=="PROPOSED"||row.created_by===userId)this.fail(error,"Independent approval of a proposed Value Graph link is required."); const {data,error:updateError}=await this.db.from("value_graph_edges").update({status:"APPROVED",approved_by:userId,approved_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("tenant_id",tenantId).eq("id",id).select().single(); if(updateError)this.fail(updateError,"Unable to approve Value Graph link."); return data; }

  async setCadence(tenantId:string,userId:string,benefitId:string,body:any){ await this.sourceBenefit(tenantId,benefitId); const days=Math.max(7,Math.min(365,Math.floor(this.number(body.review_frequency_days)||30))), next=this.text(body.next_review_date)||new Date(Date.now()+days*86400000).toISOString().slice(0,10); const {data,error}=await this.db.from("value_benefit_cadence").upsert({tenant_id:tenantId,benefit_id:benefitId,owner_id:body.owner_id||null,review_frequency_days:days,next_review_date:next,expiry_date:this.text(body.expiry_date)||null,forecast_to_date:this.number(body.forecast_to_date),created_by:userId},{onConflict:"tenant_id,benefit_id"}).select().single(); if(error)this.fail(error,"Unable to set benefit revalidation cadence."); return data; }
  async reviewCadence(tenantId:string,userId:string,id:string,body:any){ const {data:row,error}=await this.db.from("value_benefit_cadence").select("*").eq("tenant_id",tenantId).eq("id",id).maybeSingle(); if(error||!row)this.fail(error,"Benefit cadence was not found."); const durable=this.text(body.durability_status).toUpperCase(); if(!["SUSTAINED","TAPERING","REVERSED","EXPIRED"].includes(durable))this.fail(null,"Choose SUSTAINED, TAPERING, REVERSED or EXPIRED."); const realized=this.number(body.realized_to_date), next=durable==="EXPIRED"?row.next_review_date:new Date(Date.now()+row.review_frequency_days*86400000).toISOString().slice(0,10); const {data,error:updateError}=await this.db.from("value_benefit_cadence").update({durability_status:durable,realized_to_date:realized,last_confirmed_date:new Date().toISOString().slice(0,10),next_review_date:next,status:durable==="EXPIRED"?"CLOSED":"ACTIVE",updated_at:new Date().toISOString()}).eq("tenant_id",tenantId).eq("id",id).select().single();if(updateError)this.fail(updateError,"Unable to review benefit durability.");return data; }
  async createCommercialCost(tenantId:string,userId:string,body:any){ const title=this.text(body.title), type=this.text(body.cost_type).toUpperCase(), from=this.text(body.effective_from), evidence=this.text(body.evidence_reference), amount=this.number(body.amount); if(!title||!type||!from||!evidence||!Number.isFinite(amount))this.fail(null,"Cost title, type, effective date, amount and evidence are required."); const {data,error}=await this.db.from("value_commercial_costs").insert({tenant_id:tenantId,commercial_profile_id:body.commercial_profile_id||null,cost_type:type,title,amount,currency:this.text(body.currency).toUpperCase()||"AED",effective_from:from,effective_to:this.text(body.effective_to)||null,recurring_frequency:this.text(body.recurring_frequency).toUpperCase()||"ONE_TIME",evidence_reference:evidence,created_by:userId}).select().single();if(error)this.fail(error,"Unable to record client TCO cost.");return data; }
  async setCountryProfile(tenantId:string,userId:string,body:any){ const market=this.text(body.market).toUpperCase();if(!["UAE","INDIA","GLOBAL"].includes(market))this.fail(null,"Market must be UAE, INDIA or GLOBAL.");const consent=body.benchmarking_consent===true||["true","1","on","yes"].includes(this.text(body.benchmarking_consent).toLowerCase());const {data,error}=await this.db.from("value_country_profiles").upsert({tenant_id:tenantId,market,currency:this.text(body.currency).toUpperCase()||(market==="INDIA"?"INR":"AED"),benchmarking_consent:consent,benchmark_segment:this.text(body.benchmark_segment)||null,client_display_name:this.text(body.client_display_name)||null,created_by:userId,updated_at:new Date().toISOString()},{onConflict:"tenant_id"}).select().single();if(error)this.fail(error,"Unable to save country ROI profile.");return data; }
  async clientPack(tenantId:string,id:string){const {data:statement,error}=await this.db.from("value_roi_statements").select("*").eq("tenant_id",tenantId).eq("id",id).maybeSingle();if(error||!statement)this.fail(error,"ROI statement not found.");const {data:proofs}=await this.db.from("value_proof_links").select("*").eq("tenant_id",tenantId).in("benefit_id",(statement.benefit_snapshot||[]).map((x:any)=>x.id));const snapshot=statement.benefit_snapshot||[];const waterfall={cash:snapshot.filter((x:any)=>x.benefit_class==="CASH_RELEASE"||x.benefit_class==="WORKING_CAPITAL").reduce((n:number,x:any)=>n+this.number(x.credited_amount),0),accounting:snapshot.filter((x:any)=>["ACCOUNTING_SAVING","REVENUE_UPLIFT"].includes(x.benefit_class)).reduce((n:number,x:any)=>n+this.number(x.credited_amount),0),risk:snapshot.filter((x:any)=>x.benefit_class==="RISK_AVOIDANCE").reduce((n:number,x:any)=>n+this.number(x.credited_amount),0)};return {statement,waterfall,evidence:proofs||[],narrative:statement.client_narrative||`Verified client value statement for ${statement.period_from} to ${statement.period_to}. Only finance-verified, evidence-linked benefits are included.`,download:{format:"JSON",hash:statement.statement_hash}};}
  async approveClientPack(tenantId:string,userId:string,id:string,body:any){const note=this.text(body.client_note);const {data,error}=await this.db.from("value_roi_statements").update({client_approved_by:userId,client_approved_at:new Date().toISOString(),client_narrative:this.text(body.client_narrative)||undefined,updated_at:new Date().toISOString()}).eq("tenant_id",tenantId).eq("id",id).eq("status","ISSUED").select().single();if(error)this.fail(error,"Only an issued ROI statement can be client-approved.");return {...data,client_note:note};}

  async calculateBaselineOutcome(tenantId:string,baselineId:string,body:any){const {data:base,error}=await this.db.from("value_baselines").select("*").eq("tenant_id",tenantId).eq("id",baselineId).eq("status","APPROVED").maybeSingle();if(error||!base)this.fail(error,"An approved baseline is required.");const outcome=this.number(body.outcome_value), volume=body.outcome_volume==null?this.number(base.volume_value):this.number(body.outcome_volume);const baseVolume=this.number(base.volume_value);const volumeFactor=baseVolume>0&&volume>=0?volume/baseVolume:1;const normalized=this.number(base.baseline_value)*volumeFactor*this.number(base.seasonality_factor)*this.number(base.fx_rate)*this.number(base.inflation_factor);const avoided=Math.max(0,normalized-outcome);return {baseline_id:base.id,normalized_baseline:normalized,outcome_value:outcome,benefit_amount:avoided,variance:outcome-normalized,method:{normalization:base.normalization_method,volume_factor:volumeFactor,seasonality:base.seasonality_factor,fx:base.fx_rate,inflation:base.inflation_factor},requires_finance_verification:true};}
  async setRenewalProfile(tenantId:string,userId:string,body:any){const date=this.text(body.renewal_date),arr=this.number(body.contracted_arr);if(!date||arr<0)this.fail(null,"Renewal date and non-negative contracted ARR are required.");const {data,error}=await this.db.from("value_renewal_profiles").upsert({tenant_id:tenantId,renewal_date:date,contracted_arr:arr,adoption_score:Math.max(0,Math.min(100,this.number(body.adoption_score))),account_owner_id:body.account_owner_id||null,account_owner_reference:this.text(body.account_owner_reference)||null,action_plan:this.text(body.action_plan)||null,created_by:userId,updated_at:new Date().toISOString()},{onConflict:"tenant_id"}).select().single();if(error)this.fail(error,"Unable to save renewal profile.");return data;}
  async renewalCockpit(tenantId:string){const [{data:profile,error},{data:statements},{data:cadence}]=await Promise.all([this.db.from("value_renewal_profiles").select("*").eq("tenant_id",tenantId).maybeSingle(),this.db.from("value_roi_statements").select("*").eq("tenant_id",tenantId).eq("status","ISSUED").order("period_to",{ascending:false}),this.db.from("value_benefit_cadence").select("*").eq("tenant_id",tenantId)]);if(error)this.fail(error,"Unable to load renewal cockpit.");if(!profile)return {configured:false};const latest=(statements||[])[0], days=Math.ceil((new Date(`${profile.renewal_date}T00:00:00Z`).getTime()-Date.now())/86400000), value=this.number(latest?.cumulative_net_benefit), ratio=this.number(profile.contracted_arr)>0?value/this.number(profile.contracted_arr):null, overdue=(cadence||[]).filter((x:any)=>x.status==='ACTIVE'&&x.next_review_date<new Date().toISOString().slice(0,10)).length;const risk=Math.min(100,Math.max(0,(days<120?30:0)+(profile.adoption_score<60?30:0)+(ratio!=null&&ratio<1?25:0)+Math.min(15,overdue*5)));return {configured:true,profile,days_to_renewal:days,value_coverage_ratio:ratio,latest_verified_value:value,overdue_revalidations:overdue,renewal_risk_score:risk,status:risk>=60?'AT_RISK':'ACTIVE'};}
  async scheduleClientDelivery(tenantId:string,userId:string,body:any){const statementId=this.text(body.statement_id),recipient=this.text(body.recipient_reference),scheduled=this.text(body.scheduled_for);if(!statementId||!recipient||!scheduled)this.fail(null,"Statement, recipient reference and schedule are required.");const {data,error}=await this.db.from("value_client_deliveries").insert({tenant_id:tenantId,statement_id:statementId,delivery_channel:this.text(body.delivery_channel).toUpperCase()||'PORTAL',recipient_reference:recipient,scheduled_for:scheduled,created_by:userId}).select().single();if(error)this.fail(error,"Unable to schedule client ROI pack delivery.");return data;}
  async processDueDeliveries(tenantId?:string){let query=this.db.from("value_client_deliveries").select("*").eq("status","SCHEDULED").lte("scheduled_for",new Date().toISOString()).order("scheduled_for").limit(100);if(tenantId)query=query.eq("tenant_id",tenantId);const {data,error}=await query;if(error)this.fail(error,"Unable to load due client ROI deliveries.");let delivered=0,failed=0;for(const row of data||[]){const {data:statement,error:statementError}=await this.db.from("value_roi_statements").select("id,status,statement_hash").eq("tenant_id",row.tenant_id).eq("id",row.statement_id).maybeSingle();const patch=statementError||!statement||statement.status!=="ISSUED"?{status:"FAILED",updated_at:new Date().toISOString()}:{status:"DELIVERED",delivered_at:new Date().toISOString(),updated_at:new Date().toISOString()};const {error:updateError}=await this.db.from("value_client_deliveries").update(patch).eq("id",row.id).eq("status","SCHEDULED");if(updateError||patch.status==='FAILED')failed++;else delivered++;}return {processed:(data||[]).length,delivered,failed,mode:"Portal/export delivery creates a controlled delivery audit record; external email dispatch remains connector-controlled."};}
  async runCountryRules(tenantId:string,from:string,to:string){const {data:country,error}=await this.db.from("value_country_profiles").select("market,currency").eq("tenant_id",tenantId).maybeSingle();if(error)this.fail(error,"Unable to load country profile.");const market=country?.market||'UAE',currency=country?.currency||(market==='INDIA'?'INR':'AED');const rules=market==='INDIA'?[['GST_INPUT_CREDIT','Input-credit / GST reconciliation value'],['TDS_COMPLIANCE','TDS leakage prevention']]:market==='UAE'?[['FTA_VAT','FTA VAT recoverability evidence'],['WPS_ESB','WPS / end-of-service control value'],['PROJECT_RETENTION','Project retention cash acceleration']]:[['WORKING_CAPITAL','Working capital control value']];const rows=rules.map(([code,label])=>({tenant_id:tenantId,rule_code:code,period_from:from,period_to:to,value_amount:0,currency,evidence:{label,mode:'ACTIVE_RULE_LIBRARY',note:'Awaiting country connector or finance evidence.'},status:'NO_DATA'}));const {data,error:upsertError}=await this.db.from("value_country_rule_runs").upsert(rows,{onConflict:'tenant_id,rule_code,period_from,period_to'}).select();if(upsertError)this.fail(upsertError,"Unable to run country ROI rules.");return {market,currency,runs:data||[]};}

  private async transitionInitiative(
    tenantId: string,
    id: string,
    status: string,
    values: any,
  ) {
    const { data, error } = await this.db
      .from("value_realization_initiatives")
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .eq("status", status)
      .select()
      .maybeSingle();
    if (error || !data)
      this.fail(error, "Unable to progress value initiative.");
    return data;
  }

  private async transitionClaim(
    tenantId: string,
    id: string,
    status: string,
    values: any,
  ) {
    const { data, error } = await this.db
      .from("value_realization_claims")
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .eq("status", status)
      .select()
      .maybeSingle();
    if (error || !data) this.fail(error, "Unable to progress benefit claim.");
    return data;
  }
}
