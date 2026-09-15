import {
  evaluateProductionFormula,
  roundProductionFormula,
} from "../services/production-formula-engine";
import {
  findProductionConfigurationPack,
  productionConfigurationPacks,
  summarizeProductionConfigurationPack,
} from "./production-configuration-packs";

describe("production configuration packs", () => {
  it("exposes one versioned AC duct starter pack without operational transactions", () => {
    const pack = findProductionConfigurationPack("ac_duct_blueprint");
    expect(pack).toBeDefined();
    expect(pack?.attributes.length).toBeGreaterThanOrEqual(10);
    expect(pack?.operation_templates.map((row) => row.sequence)).toEqual([
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
    ]);
    expect(pack?.guardrails.join(" ")).toMatch(
      /never creates items, BOMs, routings, jobs, inventory or finance postings/i,
    );
    expect(summarizeProductionConfigurationPack(pack!).counts.formulas).toBe(
      pack?.formulas.length,
    );
    expect(pack?.demo_baseline?.label).toMatch(/DEMO BENCHMARK/);
    expect(pack?.demo_baseline?.calculated_example).toMatchObject({
      developed_area_net_m2: 2.4,
      metal_weight_with_allowance_kg: 16.278,
    });
    expect(pack?.demo_baseline?.cost_currency).toBe("AED");
    expect(productionConfigurationPacks.map((row) => row.code)).toEqual([
      "AC_DUCT_BLUEPRINT",
    ]);
  });

  it("ships passing baseline tests for every draft formula", () => {
    const pack = findProductionConfigurationPack("AC_DUCT_BLUEPRINT")!;
    for (const formula of pack.formulas) {
      for (const test of formula.test_cases) {
        const actual = roundProductionFormula(
          evaluateProductionFormula(formula.expression, test.input_values),
          formula.rounding_mode,
          formula.decimal_places,
        );
        expect(Math.abs(actual - test.expected_result)).toBeLessThanOrEqual(
          test.tolerance,
        );
      }
    }
  });
});
