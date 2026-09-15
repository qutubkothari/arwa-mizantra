import { BadRequestException } from "@nestjs/common";
import {
  evaluateInspectionParameter,
  planIsEffective,
  validateInspectionPlanInput,
} from "./quality.service";

const validPlan = () => ({
  plan_code: "iqc-bearing",
  plan_name: "Incoming bearing inspection",
  inspection_type: "incoming",
  revision: 2,
  effective_from: "2026-08-01",
  sampling_method: "percentage",
  sample_size: 10,
  parameters: [
    {
      parameter_name: "Outer diameter",
      data_type: "numeric",
      specification: "40 ± 0.02 mm",
      unit_of_measure: "MM",
      tolerance_min: 39.98,
      tolerance_max: 40.02,
      criticality: "critical",
    },
  ],
});

describe("quality inspection-plan controls", () => {
  it("normalizes governed plan and parameter values", () => {
    const result = validateInspectionPlanInput(validPlan());
    expect(result.planCode).toBe("IQC-BEARING");
    expect(result.inspectionType).toBe("INCOMING");
    expect(result.samplingMethod).toBe("PERCENTAGE");
    expect(result.parameters[0]).toMatchObject({
      sequence_number: 1,
      data_type: "NUMERIC",
      criticality: "CRITICAL",
      is_mandatory: true,
    });
  });

  it("rejects an inverted tolerance range", () => {
    const input = validPlan();
    input.parameters[0].tolerance_min = 41;
    input.parameters[0].tolerance_max = 40;
    expect(() => validateInspectionPlanInput(input)).toThrow(
      BadRequestException,
    );
  });

  it("rejects a percentage sample greater than 100", () => {
    expect(() =>
      validateInspectionPlanInput({ ...validPlan(), sample_size: 101 }),
    ).toThrow("percentage cannot exceed 100");
  });

  it("requires at least one documented inspection parameter", () => {
    expect(() =>
      validateInspectionPlanInput({ ...validPlan(), parameters: [] }),
    ).toThrow("At least one inspection parameter");
  });

  it("recognizes only approved plans inside their effective dates", () => {
    const plan = {
      status: "APPROVED",
      effective_from: "2026-08-01",
      effective_to: "2026-08-31",
    };
    expect(planIsEffective(plan, "2026-08-01")).toBe(true);
    expect(planIsEffective(plan, "2026-08-31")).toBe(true);
    expect(planIsEffective(plan, "2026-09-01")).toBe(false);
    expect(planIsEffective({ ...plan, status: "DRAFT" }, "2026-08-15")).toBe(
      false,
    );
  });

  it("evaluates numeric execution evidence against approved tolerances", () => {
    expect(
      evaluateInspectionParameter(
        {
          parameter_name: "Outer diameter",
          data_type: "NUMERIC",
          tolerance_min: 39.98,
          tolerance_max: 40.02,
          is_mandatory: true,
        },
        { measured_value: "40.01" },
      ),
    ).toMatchObject({ result: "PASS", deviation: 0 });
    expect(
      evaluateInspectionParameter(
        {
          parameter_name: "Outer diameter",
          data_type: "NUMERIC",
          tolerance_min: 39.98,
          tolerance_max: 40.02,
          is_mandatory: true,
        },
        { measured_value: "40.10" },
      ),
    ).toMatchObject({ result: "FAIL" });
  });

  it("requires governed non-numeric execution results", () => {
    expect(() =>
      evaluateInspectionParameter(
        {
          parameter_name: "Surface finish",
          data_type: "PASS_FAIL",
          is_mandatory: true,
        },
        { result: "" },
      ),
    ).toThrow("requires PASS, FAIL or NA");
  });
});
