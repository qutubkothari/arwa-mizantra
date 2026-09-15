import {
  evaluateManufacturingModel,
  recommendBuildWaves,
  rateInUnitsPerMinute,
  resourceIsEligible,
  validateManufacturingModel,
} from "./manufacturing-model-engine";

describe("generic manufacturing model engine", () => {
  it("models the screw reference without hard-coded product logic", () => {
    const model: any = {
      code: "QA-SCREW-8X80",
      name: "8x80 screw",
      attributes: { length_mm: 80, wire_diameter_mm: 4.1, piece_weight_g: 10.4 },
      stages: [
        {
          id: "blank",
          name: "Blank cutting",
          resources: [
            { id: "T1", name: "T1", capability_rules: [{ attribute: "length_mm", operator: "BETWEEN", min: 60, max: 80 }, { attribute: "wire_diameter_mm", operator: "MAX", max: 6 }], rate: { basis: "UNITS_PER_MINUTE", value: 60 } },
            { id: "T2", name: "T2", capability_rules: [{ attribute: "length_mm", operator: "BETWEEN", min: 80, max: 160 }, { attribute: "wire_diameter_mm", operator: "MAX", max: 8 }], rate: { basis: "UNITS_PER_MINUTE", value: 40 } },
            { id: "CH1", name: "CH1", capability_rules: [{ attribute: "length_mm", operator: "BETWEEN", min: 60, max: 100 }], rate: { basis: "UNITS_PER_MINUTE", value: 65 } },
          ],
        },
        {
          id: "thread",
          name: "Threading",
          predecessors: ["blank"],
          resources: [
            { id: "TH1", name: "TH1", capability_rules: [{ attribute: "length_mm", operator: "BETWEEN", min: 60, max: 120 }], rate: { basis: "UNITS_PER_MINUTE", value: 40 } },
            { id: "TH2", name: "TH2", capability_rules: [{ attribute: "length_mm", operator: "BETWEEN", min: 60, max: 160 }], rate: { basis: "UNITS_PER_MINUTE", value: 80 } },
          ],
        },
        {
          id: "plate",
          name: "Plating",
          predecessors: ["thread"],
          resources: [{ id: "PLANT", name: "3-barrel plating plant", rate: { basis: "KG_PER_HOUR", value: 30, parallel_units: 3, piece_weight_attribute: "piece_weight_g" } }],
        },
      ],
    };
    expect(validateManufacturingModel(model)).toEqual([]);
    expect(resourceIsEligible(model.attributes, model.stages[0].resources[0])).toBe(true);
    const result = evaluateManufacturingModel(model, 100000);
    expect(result.feasible).toBe(true);
    expect(result.stages[1].selected_resource.id).toBe("TH2");
    expect(rateInUnitsPerMinute(model.stages[2].resources[0].rate, model.attributes)).toBeCloseTo(144.230769, 5);
  });

  it("supports a different cavity-moulded bottle scenario with the same engine", () => {
    const model: any = {
      code: "QA-BOTTLE-500ML",
      name: "500 ml bottle",
      attributes: { volume_ml: 500, resin: "HDPE", piece_weight_g: 28 },
      stages: [
        {
          id: "mould",
          name: "Blow moulding",
          resources: [
            { id: "BM1", name: "Blow moulder 1", capability_rules: [{ attribute: "resin", operator: "IN", values: ["HDPE", "PET"] }, { attribute: "volume_ml", operator: "MAX", max: 1000 }], rate: { basis: "SHOTS_PER_MINUTE", value: 4, units_per_cycle: 6, efficiency_pct: 90 } },
          ],
        },
        {
          id: "pack",
          name: "Packing",
          predecessors: ["mould"],
          resources: [{ id: "PK1", name: "Packing line", rate: { basis: "BATCHES_PER_HOUR", value: 10, batch_quantity: 24 } }],
        },
      ],
    };
    const result = evaluateManufacturingModel(model, 2400);
    expect(validateManufacturingModel(model)).toEqual([]);
    expect(result.stages[0].selected_resource.units_per_minute).toBe(21.6);
    expect(result.stages[1].selected_resource.units_per_minute).toBe(4);
    expect(result.bottleneck_stage_id).toBe("pack");
  });

  it("generates balanced waves from model policy without product-specific rules", () => {
    const waves = recommendBuildWaves({
      model: {
        code: "GENERIC",
        name: "Generic",
        attributes: {},
        planning: { preferred_wave_quantity: 30, transfer_batch_quantity: 10 },
        stages: [{ id: "one", name: "One", resources: [] }],
      },
      quantity: 100,
      startDate: "2026-09-01",
      dueDate: "2026-09-30",
    });
    expect(waves.map((wave) => wave.quantity)).toEqual([30, 30, 30, 10]);
    expect(waves.reduce((sum, wave) => sum + wave.quantity, 0)).toBe(100);
    expect(waves[3].required_by).toBe("2026-09-30");
  });
});
