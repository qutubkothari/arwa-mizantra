import { BadRequestException, Injectable } from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

@Injectable()
export class WorkforceSkillsService {
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

  private async gapAction(tenantId: string, id: string) {
    const { data, error } = await this.db
      .from("workforce_gap_actions")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) this.fail(error, "Workforce gap action not found.");
    return data;
  }

  async dashboard(tenantId: string) {
    const [
      employeesResult,
      requirementsResult,
      assessmentsResult,
      actionsResult,
    ] = await Promise.all([
      this.db
        .from("employees")
        .select("id,employee_code,employee_name,department,designation,status")
        .eq("tenant_id", tenantId)
        .eq("status", "ACTIVE")
        .order("employee_code"),
      this.db
        .from("workforce_skill_requirements")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("criticality")
        .order("requirement_code"),
      this.db
        .from("workforce_skill_assessments")
        .select("*")
        .eq("tenant_id", tenantId),
      this.db
        .from("workforce_gap_actions")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }),
    ]);
    if (employeesResult.error)
      this.fail(employeesResult.error, "Unable to load employees.");
    if (requirementsResult.error)
      this.fail(requirementsResult.error, "Unable to load skill requirements.");
    if (assessmentsResult.error)
      this.fail(assessmentsResult.error, "Unable to load skill assessments.");
    if (actionsResult.error)
      this.fail(actionsResult.error, "Unable to load workforce actions.");
    const employees = employeesResult.data || [];
    const requirements = requirementsResult.data || [];
    const assessments = assessmentsResult.data || [];
    const actions = actionsResult.data || [];
    const employeeMap = new Map(
      employees.map((row: any) => [String(row.id), row]),
    );
    const requirementMap = new Map(
      requirements.map((row: any) => [String(row.id), row]),
    );
    const today = new Date().toISOString().slice(0, 10);
    const expiryLimit = new Date(Date.now() + 60 * 86400000)
      .toISOString()
      .slice(0, 10);
    const gaps = requirements
      .map((requirement: any) => {
        const eligible = employees.filter(
          (employee: any) =>
            (!requirement.department ||
              this.text(employee.department).toUpperCase() ===
                this.text(requirement.department).toUpperCase()) &&
            (!requirement.designation ||
              this.text(employee.designation).toUpperCase() ===
                this.text(requirement.designation).toUpperCase()),
        );
        const assessed = assessments.filter(
          (assessment: any) =>
            String(assessment.requirement_id) === String(requirement.id) &&
            eligible.some(
              (employee: any) =>
                String(employee.id) === String(assessment.employee_id),
            ),
        );
        const qualified = assessed.filter(
          (assessment: any) =>
            this.number(assessment.proficiency_level) >=
              this.number(requirement.minimum_proficiency) &&
            (!requirement.certification_required ||
              (assessment.certified_until &&
                assessment.certified_until >= today)),
        );
        const uncovered = Math.max(
          0,
          this.number(requirement.required_headcount) - qualified.length,
        );
        const exposure =
          uncovered *
          this.number(requirement.annual_risk_hours) *
          this.number(requirement.cost_per_gap_hour);
        return {
          ...requirement,
          eligible_headcount: eligible.length,
          assessed_headcount: assessed.length,
          qualified_headcount: qualified.length,
          uncovered_headcount: uncovered,
          coverage_pct: this.number(requirement.required_headcount)
            ? Math.min(
                100,
                (qualified.length /
                  this.number(requirement.required_headcount)) *
                  100,
              )
            : 100,
          annual_capacity_risk: exposure,
        };
      })
      .sort(
        (a: any, b: any) => b.annual_capacity_risk - a.annual_capacity_risk,
      );
    const enrichedAssessments = assessments.map((row: any) => ({
      ...row,
      employee: employeeMap.get(String(row.employee_id)),
      requirement: requirementMap.get(String(row.requirement_id)),
    }));
    const enrichedActions = actions.map((row: any) => ({
      ...row,
      requirement: requirementMap.get(String(row.requirement_id)),
    }));
    return {
      kpis: {
        critical_skills: requirements.filter((row: any) =>
          ["HIGH", "CRITICAL"].includes(row.criticality),
        ).length,
        uncovered_positions: gaps.reduce(
          (sum: number, row: any) => sum + row.uncovered_headcount,
          0,
        ),
        annual_capacity_risk: gaps.reduce(
          (sum: number, row: any) => sum + row.annual_capacity_risk,
          0,
        ),
        certifications_expiring_60d: enrichedAssessments.filter(
          (row: any) =>
            row.certified_until &&
            row.certified_until >= today &&
            row.certified_until <= expiryLimit,
        ).length,
        approved_savings_pipeline: enrichedActions
          .filter((row: any) => ["APPROVED", "EXECUTED"].includes(row.status))
          .reduce(
            (sum: number, row: any) =>
              sum + this.number(row.target_annual_cost_avoidance),
            0,
          ),
        verified_annual_savings: enrichedActions
          .filter((row: any) => row.status === "VERIFIED")
          .reduce(
            (sum: number, row: any) =>
              sum + this.number(row.realized_annual_cost_avoidance),
            0,
          ),
      },
      employees,
      requirements,
      assessments: enrichedAssessments,
      gaps,
      actions: enrichedActions,
    };
  }

  async requirement(tenantId: string, userId: string, body: any) {
    const code = this.text(body.requirement_code).toUpperCase();
    const skill = this.text(body.skill_name);
    const criticality = this.text(body.criticality || "HIGH").toUpperCase();
    const required = Math.floor(this.number(body.required_headcount));
    const proficiency = Math.floor(this.number(body.minimum_proficiency));
    if (
      !code ||
      !skill ||
      !["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(criticality) ||
      required <= 0 ||
      proficiency < 1 ||
      proficiency > 5
    )
      this.fail(
        null,
        "Code, skill, criticality, positive headcount and proficiency 1-5 are required.",
      );
    const { data, error } = await this.db
      .from("workforce_skill_requirements")
      .upsert(
        {
          tenant_id: tenantId,
          requirement_code: code,
          skill_name: skill,
          department: this.text(body.department) || null,
          designation: this.text(body.designation) || null,
          criticality,
          required_headcount: required,
          minimum_proficiency: proficiency,
          certification_required:
            body.certification_required === true ||
            body.certification_required === "true" ||
            body.certification_required === "on",
          annual_risk_hours: this.number(body.annual_risk_hours),
          cost_per_gap_hour: this.number(body.cost_per_gap_hour),
          created_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,requirement_code" },
      )
      .select()
      .single();
    if (error) this.fail(error, "Unable to save skill requirement.");
    return data;
  }

  async assessment(tenantId: string, userId: string, body: any) {
    const requirementId = this.text(body.requirement_id);
    const employeeId = this.text(body.employee_id);
    const proficiency = Math.floor(this.number(body.proficiency_level));
    const assessedOn = this.text(body.assessed_on);
    const evidence = this.text(body.evidence_reference);
    const [{ data: requirement }, { data: employee }] = await Promise.all([
      this.db
        .from("workforce_skill_requirements")
        .select("id,certification_required")
        .eq("tenant_id", tenantId)
        .eq("id", requirementId)
        .maybeSingle(),
      this.db
        .from("employees")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("id", employeeId)
        .maybeSingle(),
    ]);
    if (
      !requirement ||
      !employee ||
      proficiency < 1 ||
      proficiency > 5 ||
      !assessedOn ||
      assessedOn > new Date().toISOString().slice(0, 10) ||
      !evidence ||
      (requirement.certification_required && !body.certified_until)
    )
      this.fail(
        null,
        "Valid requirement, employee, proficiency, non-future date, evidence and required certification expiry are mandatory.",
      );
    const { data, error } = await this.db
      .from("workforce_skill_assessments")
      .upsert(
        {
          tenant_id: tenantId,
          requirement_id: requirementId,
          employee_id: employeeId,
          proficiency_level: proficiency,
          assessed_on: assessedOn,
          certified_until: this.text(body.certified_until) || null,
          evidence_reference: evidence,
          assessed_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,requirement_id,employee_id" },
      )
      .select()
      .single();
    if (error) this.fail(error, "Unable to save skill assessment.");
    return data;
  }

  async action(tenantId: string, userId: string, body: any) {
    const type = this.text(body.action_type).toUpperCase();
    const description = this.text(body.action_description);
    const owner = this.text(body.owner_reference);
    const due = this.text(body.due_date);
    const headcount = Math.floor(this.number(body.affected_headcount));
    if (
      !this.text(body.requirement_id) ||
      ![
        "TRAIN",
        "CROSS_TRAIN",
        "REDEPLOY",
        "HIRE",
        "CONTRACT",
        "AUTOMATE",
      ].includes(type) ||
      !description ||
      !owner ||
      !due ||
      headcount <= 0
    )
      this.fail(
        null,
        "Requirement, action, positive headcount, description, owner and due date are required.",
      );
    const { data, error } = await this.db
      .from("workforce_gap_actions")
      .insert({
        tenant_id: tenantId,
        requirement_id: body.requirement_id,
        action_type: type,
        affected_headcount: headcount,
        action_description: description,
        owner_reference: owner,
        due_date: due,
        target_annual_cost_avoidance: this.number(
          body.target_annual_cost_avoidance,
        ),
        created_by: userId,
      })
      .select()
      .single();
    if (error) this.fail(error, "Unable to propose workforce action.");
    return data;
  }

  async approve(tenantId: string, userId: string, id: string, body: any) {
    const row = await this.gapAction(tenantId, id);
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
      "Unable to approve workforce action.",
    );
  }

  async execute(tenantId: string, userId: string, id: string, body: any) {
    const row = await this.gapAction(tenantId, id);
    const evidence = this.text(body.execution_evidence);
    if (row.status !== "APPROVED" || !evidence)
      this.fail(
        null,
        "Approved workforce action and execution evidence are required.",
      );
    return this.transition(
      tenantId,
      id,
      "APPROVED",
      {
        status: "EXECUTED",
        execution_evidence: evidence,
        executed_by: userId,
        executed_at: new Date().toISOString(),
      },
      "Unable to record workforce action execution.",
    );
  }

  async verify(tenantId: string, userId: string, id: string, body: any) {
    const row = await this.gapAction(tenantId, id);
    const evidence = this.text(body.verification_evidence);
    const savings = this.number(body.realized_annual_cost_avoidance);
    if (
      row.status !== "EXECUTED" ||
      row.executed_by === userId ||
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
      "EXECUTED",
      {
        status: "VERIFIED",
        verification_evidence: evidence,
        realized_annual_cost_avoidance: savings,
        verified_by: userId,
        verified_at: new Date().toISOString(),
      },
      "Unable to verify workforce savings.",
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
      .from("workforce_gap_actions")
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
