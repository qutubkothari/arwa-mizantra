export type ManufacturingAttributeValue = string | number | boolean;

export type ManufacturingCapabilityRule = {
  attribute: string;
  operator?: "EQ" | "NE" | "MIN" | "MAX" | "BETWEEN" | "IN";
  value?: ManufacturingAttributeValue;
  min?: number;
  max?: number;
  values?: ManufacturingAttributeValue[];
};

export type ManufacturingRate = {
  basis:
    | "UNITS_PER_MINUTE"
    | "SHOTS_PER_MINUTE"
    | "KG_PER_HOUR"
    | "BATCHES_PER_HOUR";
  value: number;
  units_per_cycle?: number;
  batch_quantity?: number;
  parallel_units?: number;
  efficiency_pct?: number;
  piece_weight_attribute?: string;
};

export type ManufacturingResourceOption = {
  id: string;
  name: string;
  source?: "IN_HOUSE" | "SUBCONTRACT";
  capability_rules?: ManufacturingCapabilityRule[];
  rate: ManufacturingRate;
  setup_minutes?: number;
  cost_per_hour?: number;
};

export type ManufacturingStage = {
  id: string;
  name: string;
  predecessors?: string[];
  resources: ManufacturingResourceOption[];
  transfer_batch_quantity?: number;
};

export type ManufacturingModel = {
  code: string;
  name: string;
  attributes: Record<string, ManufacturingAttributeValue>;
  stages: ManufacturingStage[];
  planning?: {
    preferred_wave_quantity?: number;
    maximum_wave_count?: number;
    transfer_batch_quantity?: number;
  };
};

const finite = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function capabilityRuleMatches(
  attributes: Record<string, ManufacturingAttributeValue>,
  rule: ManufacturingCapabilityRule,
) {
  const actual = attributes[rule.attribute];
  if (actual == null) return false;
  switch (rule.operator || "EQ") {
    case "NE":
      return String(actual) !== String(rule.value);
    case "MIN":
      return finite(actual, Number.NEGATIVE_INFINITY) >= finite(rule.min ?? rule.value);
    case "MAX":
      return finite(actual, Number.POSITIVE_INFINITY) <= finite(rule.max ?? rule.value);
    case "BETWEEN": {
      const number = finite(actual, Number.NaN);
      return Number.isFinite(number) && number >= finite(rule.min) && number <= finite(rule.max);
    }
    case "IN":
      return (rule.values || []).some((value) => String(value) === String(actual));
    case "EQ":
    default:
      return String(actual) === String(rule.value);
  }
}

export function resourceIsEligible(
  attributes: Record<string, ManufacturingAttributeValue>,
  resource: ManufacturingResourceOption,
) {
  return (resource.capability_rules || []).every((rule) =>
    capabilityRuleMatches(attributes, rule),
  );
}

export function rateInUnitsPerMinute(
  rate: ManufacturingRate,
  attributes: Record<string, ManufacturingAttributeValue>,
) {
  const value = Math.max(0, finite(rate.value));
  const parallel = Math.max(1, finite(rate.parallel_units, 1));
  const efficiency = Math.max(0, finite(rate.efficiency_pct, 100)) / 100;
  let units = 0;
  switch (rate.basis) {
    case "SHOTS_PER_MINUTE":
      units = value * Math.max(0, finite(rate.units_per_cycle, 1));
      break;
    case "KG_PER_HOUR": {
      const weightKey = rate.piece_weight_attribute || "piece_weight_g";
      const grams = finite(attributes[weightKey]);
      if (grams <= 0) return 0;
      units = (value * 1000) / grams / 60;
      break;
    }
    case "BATCHES_PER_HOUR":
      units = (value * Math.max(0, finite(rate.batch_quantity))) / 60;
      break;
    case "UNITS_PER_MINUTE":
    default:
      units = value;
  }
  return Number((units * parallel * efficiency).toFixed(6));
}

export function evaluateManufacturingModel(
  model: ManufacturingModel,
  quantity: number,
  availableMinutes: Record<string, number> = {},
) {
  const target = Math.max(0, finite(quantity));
  const stages = model.stages.map((stage) => {
    const eligible = stage.resources
      .filter((resource) => resourceIsEligible(model.attributes, resource))
      .map((resource) => {
        const unitsPerMinute = rateInUnitsPerMinute(resource.rate, model.attributes);
        const runMinutes = unitsPerMinute > 0 ? target / unitsPerMinute : Number.POSITIVE_INFINITY;
        return {
          ...resource,
          units_per_minute: unitsPerMinute,
          required_minutes: Number((finite(resource.setup_minutes) + runMinutes).toFixed(2)),
          available_minutes: finite(availableMinutes[resource.id]),
        };
      })
      .sort((a, b) => {
        const aFits = a.available_minutes >= a.required_minutes ? 1 : 0;
        const bFits = b.available_minutes >= b.required_minutes ? 1 : 0;
        if (aFits !== bFits) return bFits - aFits;
        if (a.required_minutes !== b.required_minutes)
          return a.required_minutes - b.required_minutes;
        return finite(a.cost_per_hour) - finite(b.cost_per_hour);
      });
    return {
      id: stage.id,
      name: stage.name,
      predecessors: stage.predecessors || [],
      transfer_batch_quantity: stage.transfer_batch_quantity || null,
      eligible_resources: eligible,
      selected_resource: eligible[0] || null,
      blocked: eligible.length === 0,
    };
  });
  const schedulable = stages.filter((stage) => stage.selected_resource);
  const bottleneck = schedulable
    .slice()
    .sort(
      (a, b) =>
        Number(b.selected_resource?.required_minutes || 0) -
        Number(a.selected_resource?.required_minutes || 0),
    )[0];
  return {
    model_code: model.code,
    target_quantity: target,
    stages,
    feasible: stages.every((stage) => !stage.blocked),
    bottleneck_stage_id: bottleneck?.id || null,
    bottleneck_stage_name: bottleneck?.name || null,
    bottleneck_minutes: Number(bottleneck?.selected_resource?.required_minutes || 0),
  };
}

export function validateManufacturingModel(model: ManufacturingModel) {
  const errors: string[] = [];
  if (!model?.code?.trim()) errors.push("Model code is required.");
  if (!model?.name?.trim()) errors.push("Model name is required.");
  if (!Array.isArray(model?.stages) || !model.stages.length)
    errors.push("At least one production stage is required.");
  const ids = new Set<string>();
  for (const stage of model?.stages || []) {
    if (!stage.id?.trim()) errors.push("Every stage needs a stable ID.");
    if (ids.has(stage.id)) errors.push(`Duplicate stage ID: ${stage.id}.`);
    ids.add(stage.id);
    if (!stage.name?.trim()) errors.push(`Stage ${stage.id || "(unknown)"} needs a name.`);
    if (!Array.isArray(stage.resources) || !stage.resources.length)
      errors.push(`Stage ${stage.name || stage.id} needs at least one resource option.`);
    for (const resource of stage.resources || []) {
      if (!resource.id?.trim() || !resource.name?.trim())
        errors.push(`Every resource in ${stage.name || stage.id} needs an ID and name.`);
      if (rateInUnitsPerMinute(resource.rate, model.attributes || {}) <= 0)
        errors.push(`Resource ${resource.name || resource.id} has an unusable rate.`);
    }
  }
  for (const stage of model?.stages || []) {
    for (const predecessor of stage.predecessors || [])
      if (!ids.has(predecessor))
        errors.push(`Stage ${stage.id} references missing predecessor ${predecessor}.`);
  }
  return [...new Set(errors)];
}

export function recommendBuildWaves(input: {
  model: ManufacturingModel;
  quantity: number;
  startDate: string;
  dueDate: string;
}) {
  const total = Math.max(0, finite(input.quantity));
  if (!total) return [];
  const configured = finite(input.model.planning?.preferred_wave_quantity);
  const stageBatches = input.model.stages
    .map((stage) => finite(stage.transfer_batch_quantity))
    .filter((value) => value > 0);
  const transferBatch =
    finite(input.model.planning?.transfer_batch_quantity) ||
    (stageBatches.length ? Math.min(...stageBatches) : 0);
  const maxWaves = Math.min(
    100,
    Math.max(1, Math.round(finite(input.model.planning?.maximum_wave_count, 12))),
  );
  let waveQuantity = configured || transferBatch || total;
  if (Math.ceil(total / waveQuantity) > maxWaves)
    waveQuantity = Math.ceil(total / maxWaves);
  const count = Math.ceil(total / waveQuantity);
  const start = new Date(`${input.startDate.slice(0, 10)}T00:00:00Z`);
  const due = new Date(`${input.dueDate.slice(0, 10)}T00:00:00Z`);
  const span = Math.max(0, due.getTime() - start.getTime());
  let remaining = total;
  return Array.from({ length: count }, (_, index) => {
    const quantity = Math.min(waveQuantity, remaining);
    remaining -= quantity;
    const date = new Date(start.getTime() + (span * (index + 1)) / count)
      .toISOString()
      .slice(0, 10);
    return {
      wave_name: count === 1 ? "System recommended wave" : `System wave ${index + 1}`,
      quantity,
      required_by: date,
      transfer_batch_quantity: transferBatch || null,
      priority: Math.max(1, 100 - index),
      generated_by: "MANUFACTURING_MODEL",
    };
  });
}
