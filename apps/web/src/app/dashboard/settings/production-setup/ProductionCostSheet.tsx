"use client";

import { useMemo, useState } from "react";
import {
  Calculator,
  ChevronDown,
  CopyPlus,
  Plus,
  Save,
  Sparkles,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";
import { useLocale } from "@/lib/locale";

type CostLine = {
  id: string;
  name: string;
  category: string;
  basis: string;
  rate: number;
  driver_quantity: number;
  wastage_percent: number;
  enabled: boolean;
  notes?: string | null;
};

type CostTemplate = {
  id: string;
  finished_item_id: string;
  template_name: string;
  currency_code: string;
  output_quantity: number;
  cost_lines: CostLine[];
  assumptions?: { selling_price?: number };
  is_active?: boolean;
};

type CostPreset = {
  key: string;
  name: string;
  category: string;
  basis: string;
};

const input =
  "mt-1 w-full rounded-lg border border-[#D9C8AA] bg-white px-3 py-2.5 text-sm text-[#3F2D20] outline-none focus:border-[#8B6844] focus:ring-2 focus:ring-[#B9975B]/20";
const categories = [
  "MATERIAL",
  "LABOUR",
  "MACHINE",
  "POWER",
  "TOOLING",
  "SUBCONTRACT",
  "OVERHEAD",
  "PACKING",
  "OTHER",
];
const bases = [
  ["PER_UNIT", "Per finished unit"],
  ["KG_INPUT", "Per kg input"],
  ["KG_OUTPUT", "Per kg output"],
  ["MACHINE_HOUR", "Per machine hour"],
  ["LABOUR_HOUR", "Per labour hour"],
  ["BATCH", "Per batch / barrel"],
  ["SHOT", "Per mould shot"],
  ["FIXED_RUN", "Fixed per production run"],
  ["PERCENT_MATERIAL", "% of material cost"],
  ["SUBCONTRACT_QUANTITY", "Per subcontract unit"],
  ["PACKING_UNIT", "Per packed unit"],
];

const presets: CostPreset[] = [
  {
    key: "material",
    name: "Raw material",
    category: "MATERIAL",
    basis: "KG_INPUT",
  },
  {
    key: "labour",
    name: "Direct labour",
    category: "LABOUR",
    basis: "LABOUR_HOUR",
  },
  {
    key: "machine",
    name: "Machine running",
    category: "MACHINE",
    basis: "MACHINE_HOUR",
  },
  {
    key: "power",
    name: "Electricity",
    category: "POWER",
    basis: "MACHINE_HOUR",
  },
  {
    key: "tooling",
    name: "Tools, dies & punches",
    category: "TOOLING",
    basis: "KG_OUTPUT",
  },
  {
    key: "packing",
    name: "Packing",
    category: "PACKING",
    basis: "PACKING_UNIT",
  },
  {
    key: "subcontract",
    name: "Subcontracting",
    category: "SUBCONTRACT",
    basis: "SUBCONTRACT_QUANTITY",
  },
  {
    key: "overhead",
    name: "Factory overhead",
    category: "OVERHEAD",
    basis: "PERCENT_MATERIAL",
  },
  { key: "other", name: "Other cost", category: "OTHER", basis: "FIXED_RUN" },
];

const createLine = (preset: CostPreset): CostLine => ({
  id: crypto.randomUUID(),
  name: preset.name,
  category: preset.category,
  basis: preset.basis,
  rate: 0,
  driver_quantity: 0,
  wastage_percent: 0,
  enabled: true,
});

const starterLines = () =>
  ["material", "labour", "machine", "power", "packing", "overhead"].map((key) =>
    createLine(presets.find((preset) => preset.key === key)!),
  );

function calculate(lines: CostLine[], outputQuantity: number) {
  const direct = lines.map((line) => {
    const multiplier =
      line.basis === "FIXED_RUN"
        ? 1
        : ["PER_UNIT", "PACKING_UNIT"].includes(line.basis)
          ? outputQuantity
          : Number(line.driver_quantity || 0);
    return {
      ...line,
      amount:
        !line.enabled || line.basis === "PERCENT_MATERIAL"
          ? 0
          : Number(line.rate || 0) *
            multiplier *
            (1 + Number(line.wastage_percent || 0) / 100),
    };
  });
  const material = direct
    .filter((line) => line.enabled && line.category === "MATERIAL")
    .reduce((sum, line) => sum + line.amount, 0);
  const calculated = direct.map((line) => ({
    ...line,
    amount:
      line.enabled && line.basis === "PERCENT_MATERIAL"
        ? (material * Number(line.rate || 0)) / 100
        : line.amount,
  }));
  const total = calculated.reduce((sum, line) => sum + line.amount, 0);
  return {
    calculated,
    total,
    unit: outputQuantity > 0 ? total / outputQuantity : 0,
  };
}

function fieldLabels(basis: string) {
  const labels: Record<
    string,
    { rate: string; quantity?: string; help: string }
  > = {
    KG_INPUT: {
      rate: "Price per kg",
      quantity: "Material required (kg)",
      help: "Total kilograms needed.",
    },
    KG_OUTPUT: {
      rate: "Cost per kg output",
      quantity: "Finished weight (kg)",
      help: "For costs linked to output weight.",
    },
    MACHINE_HOUR: {
      rate: "Cost per machine hour",
      quantity: "Machine hours needed",
      help: "Total running hours across all machines.",
    },
    LABOUR_HOUR: {
      rate: "Cost per labour hour",
      quantity: "Labour hours needed",
      help: "People x hours; for example, 3 people x 8 hours = 24.",
    },
    BATCH: {
      rate: "Cost per batch",
      quantity: "Number of batches",
      help: "For barrels, lots or production batches.",
    },
    SHOT: {
      rate: "Cost per shot",
      quantity: "Number of mould shots",
      help: "Total moulding shots needed.",
    },
    SUBCONTRACT_QUANTITY: {
      rate: "Subcontract cost per unit",
      quantity: "Quantity subcontracted",
      help: "Quantity sent to the outside processor.",
    },
    PER_UNIT: {
      rate: "Cost per finished unit",
      help: "Quantity comes automatically from planned output.",
    },
    PACKING_UNIT: {
      rate: "Packing cost per unit",
      help: "Quantity comes automatically from planned output.",
    },
    FIXED_RUN: {
      rate: "Total fixed cost",
      help: "Charged once for this production run.",
    },
    PERCENT_MATERIAL: {
      rate: "% of material cost",
      help: "Calculated automatically from the material subtotal.",
    },
  };
  return labels[basis] || labels.FIXED_RUN;
}

const scalableBases = new Set([
  "KG_INPUT",
  "KG_OUTPUT",
  "MACHINE_HOUR",
  "LABOUR_HOUR",
  "BATCH",
  "SHOT",
  "SUBCONTRACT_QUANTITY",
]);

export default function ProductionCostSheet({
  items,
  templates,
  onSaved,
}: {
  items: any[];
  templates: CostTemplate[];
  onSaved: () => Promise<void> | void;
}) {
  const { t } = useLocale();
  const activeTemplates = templates.filter(
    (template) => template.is_active !== false,
  );
  const [id, setId] = useState("");
  const [finishedItemId, setFinishedItemId] = useState("");
  const [templateName, setTemplateName] = useState("Standard production cost");
  const [currency, setCurrency] = useState("INR");
  const [outputQuantity, setOutputQuantity] = useState(1000);
  const [sellingPrice, setSellingPrice] = useState(0);
  const [lines, setLines] = useState<CostLine[]>(starterLines);
  const [newCostType, setNewCostType] = useState("material");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const result = useMemo(
    () => calculate(lines, outputQuantity),
    [lines, outputQuantity],
  );
  const salesValue = outputQuantity * sellingPrice;
  const profit = salesValue - result.total;
  const margin = salesValue > 0 ? (profit / salesValue) * 100 : 0;
  const money = (value: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: /^[A-Z]{3}$/.test(currency) ? currency : "INR",
      maximumFractionDigits: 2,
    }).format(value || 0);

  const updateLine = (
    lineId: string,
    key: keyof CostLine,
    value: string | number | boolean,
  ) =>
    setLines((current) =>
      current.map((line) =>
        line.id === lineId ? { ...line, [key]: value } : line,
      ),
    );

  const newSheet = () => {
    setId("");
    setFinishedItemId("");
    setTemplateName("Standard production cost");
    setCurrency("INR");
    setOutputQuantity(1000);
    setSellingPrice(0);
    setLines(starterLines());
    setMessage("");
  };

  const chooseTemplate = (templateId: string) => {
    const template = activeTemplates.find((row) => row.id === templateId);
    if (!template) return newSheet();
    setId(template.id);
    setFinishedItemId(template.finished_item_id);
    setTemplateName(template.template_name);
    setCurrency(template.currency_code || "INR");
    setOutputQuantity(Number(template.output_quantity || 1));
    setSellingPrice(Number(template.assumptions?.selling_price || 0));
    setLines(
      (template.cost_lines || []).map((line) => ({
        ...line,
        id: line.id || crypto.randomUUID(),
      })),
    );
    setMessage("");
  };

  const chooseItem = (itemId: string) => {
    const saved = activeTemplates.find(
      (template) => template.finished_item_id === itemId,
    );
    if (saved) return chooseTemplate(saved.id);
    const item = items.find((row) => row.id === itemId);
    setId("");
    setFinishedItemId(itemId);
    setTemplateName("Standard production cost");
    setOutputQuantity(1000);
    setSellingPrice(Number(item?.selling_price || 0));
    setLines(starterLines());
    setMessage(
      itemId
        ? "First-time setup: enter these standard rates once. Mizantra will reuse them automatically."
        : "",
    );
  };

  const changeOutputQuantity = (next: number) => {
    const safeNext = Math.max(0, next || 0);
    if (outputQuantity > 0) {
      const ratio = safeNext / outputQuantity;
      setLines((current) =>
        current.map((line) =>
          scalableBases.has(line.basis)
            ? {
                ...line,
                driver_quantity: Number(line.driver_quantity || 0) * ratio,
              }
            : line,
        ),
      );
    }
    setOutputQuantity(safeNext);
  };

  const save = async () => {
    if (
      !finishedItemId ||
      !templateName.trim() ||
      outputQuantity <= 0 ||
      !lines.length
    ) {
      setMessage("Choose a finished item and enter a production quantity.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await apiClient.post(
        "/production-planning/configuration/cost-sheet-templates",
        {
          id: id || undefined,
          finished_item_id: finishedItemId,
          template_name: templateName,
          currency_code: currency.toUpperCase(),
          output_quantity: outputQuantity,
          cost_lines: lines,
          assumptions: { selling_price: sellingPrice },
        },
      );
      setMessage(
        "Cost saved. Mizantra will reuse these rates for future estimates.",
      );
      await onSaved();
    } catch (error: any) {
      setMessage(error?.message || "Unable to save production cost.");
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async () => {
    if (
      !id ||
      !window.confirm(
        "Remove this saved cost? Historical data will be preserved.",
      )
    )
      return;
    setBusy(true);
    try {
      await apiClient.delete(
        `/production-planning/configuration/cost-sheet-templates/${id}`,
      );
      newSheet();
      await onSaved();
    } catch (error: any) {
      setMessage(error?.message || "Unable to remove saved cost.");
    } finally {
      setBusy(false);
    }
  };

  const addCost = () => {
    const preset = presets.find((row) => row.key === newCostType) || presets[0];
    setLines((current) => [...current, createLine(preset)]);
  };

  return (
    <section
      id="production-costing"
      className="rounded-2xl border-2 border-[#B9975B] bg-white p-4 shadow-sm sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[#8B6844]">
            <Sparkles size={14} /> Simple production costing
          </p>
          <h2 className="mt-1 text-xl font-bold text-[#3F2D20]">
            What will this product cost?
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-5 text-[#7A6555]">
            Select the item and quantity. Set the rates once; Mizantra reuses
            and scales them automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={newSheet}
          className="inline-flex items-center gap-2 rounded-lg border border-[#B9975B] px-3 py-2 text-sm font-bold text-[#4A3526]"
        >
          <CopyPlus size={16} /> New calculation
        </button>
      </div>

      <div className="mt-5 grid gap-3 rounded-xl bg-[#FFF9EF] p-4 md:grid-cols-4">
        <label className="text-xs font-semibold text-[#5E4635] md:col-span-2">
          1. Finished item
          <select
            required
            value={finishedItemId}
            onChange={(event) => chooseItem(event.target.value)}
            className={input}
          >
            <option value="">Search or select an item</option>
            {items.map((item) => (
              <option
                key={item.id}
                value={item.id}
                data-search={`${item.code} ${item.name}`}
              >
                {item.code} - {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-[#5E4635]">
          2. Quantity to produce
          <input
            type="number"
            min="0.000001"
            step="0.000001"
            value={outputQuantity}
            onChange={(event) =>
              changeOutputQuantity(Number(event.target.value))
            }
            className={input}
          />
        </label>
        <label className="text-xs font-semibold text-[#5E4635]">
          3. Selling price per unit{" "}
          <span className="font-normal text-[#8D7B6B]">(optional)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={sellingPrice}
            onChange={(event) => setSellingPrice(Number(event.target.value))}
            className={input}
          />
        </label>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <ResultCard
          label="Cost per unit"
          value={money(result.unit)}
          tone="green"
        />
        <ResultCard label="Total production cost" value={money(result.total)} />
        <ResultCard label="Expected sales" value={money(salesValue)} />
        <ResultCard
          label="Expected profit"
          value={money(profit)}
          tone={profit < 0 ? "red" : "green"}
        />
        <ResultCard
          label="Profit margin"
          value={`${margin.toFixed(1)}%`}
          tone={margin < 0 ? "red" : "green"}
        />
      </div>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-3 border-b border-[#E8DCC8] pb-3">
        <div>
          <h3 className="font-bold text-[#3F2D20]">Cost details</h3>
          <p className="text-xs text-[#7A6555]">
            Only fill the costs this product actually uses.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdvanced((value) => !value)}
          className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold text-[#6F4E37] hover:bg-[#FFF9EF]"
        >
          Advanced settings{" "}
          <ChevronDown size={15} className={showAdvanced ? "rotate-180" : ""} />
        </button>
      </div>

      <div className="mt-3 space-y-3">
        {result.calculated.map((line) => {
          const labels = fieldLabels(line.basis);
          return (
            <div
              key={line.id}
              className="rounded-xl border border-[#E5D7BF] bg-white p-3"
            >
              <div className="grid items-end gap-3 lg:grid-cols-[minmax(180px,1.2fr)_minmax(150px,1fr)_minmax(150px,1fr)_150px_40px]">
                <label className="text-xs font-semibold text-[#5E4635]">
                  Cost name
                  <input
                    value={t(line.name)}
                    onChange={(event) =>
                      updateLine(line.id, "name", event.target.value)
                    }
                    className={input}
                  />
                </label>
                <label className="text-xs font-semibold text-[#5E4635]">
                  {labels.rate}
                  <input
                    type="number"
                    step="0.000001"
                    value={line.rate}
                    onChange={(event) =>
                      updateLine(line.id, "rate", Number(event.target.value))
                    }
                    className={input}
                  />
                </label>
                {labels.quantity ? (
                  <label className="text-xs font-semibold text-[#5E4635]">
                    {labels.quantity}
                    <input
                      type="number"
                      min="0"
                      step="0.000001"
                      value={line.driver_quantity}
                      onChange={(event) =>
                        updateLine(
                          line.id,
                          "driver_quantity",
                          Number(event.target.value),
                        )
                      }
                      className={input}
                    />
                  </label>
                ) : (
                  <div className="rounded-lg bg-[#FAF7F1] px-3 py-2 text-xs leading-5 text-[#7A6555]">
                    {labels.help}
                  </div>
                )}
                <div className="rounded-lg bg-[#F5EFE3] px-3 py-2.5 text-right">
                  <span className="block text-[11px] text-[#7A6555]">
                    Calculated cost
                  </span>
                  <strong className="text-[#3F2D20]">
                    {money(line.amount)}
                  </strong>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setLines((current) =>
                      current.filter((row) => row.id !== line.id),
                    )
                  }
                  className="mb-0.5 rounded-lg p-2.5 text-red-600 hover:bg-red-50"
                  aria-label={`Remove ${line.name}`}
                >
                  <Trash2 size={17} />
                </button>
              </div>
              {showAdvanced && (
                <div className="mt-3 grid gap-3 border-t border-dashed border-[#E5D7BF] pt-3 sm:grid-cols-3">
                  <label className="text-xs font-semibold text-[#5E4635]">
                    Cost category
                    <select
                      value={line.category}
                      onChange={(event) =>
                        updateLine(line.id, "category", event.target.value)
                      }
                      className={input}
                    >
                      {categories.map((category) => (
                        <option key={category}>{category}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-semibold text-[#5E4635]">
                    How it is calculated
                    <select
                      value={line.basis}
                      onChange={(event) =>
                        updateLine(line.id, "basis", event.target.value)
                      }
                      className={input}
                    >
                      {bases.map(([value, text]) => (
                        <option key={value} value={value}>
                          {text}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-semibold text-[#5E4635]">
                    Waste / loss %{" "}
                    <span className="font-normal text-[#8D7B6B]">
                      (optional)
                    </span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      disabled={line.basis === "PERCENT_MATERIAL"}
                      value={line.wastage_percent}
                      onChange={(event) =>
                        updateLine(
                          line.id,
                          "wastage_percent",
                          Number(event.target.value),
                        )
                      }
                      className={input}
                    />
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3 rounded-xl bg-[#FAF7F1] p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-[#5E4635]">
            Add another cost
            <select
              value={newCostType}
              onChange={(event) => setNewCostType(event.target.value)}
              className={`${input} min-w-52`}
            >
              {presets.map((preset) => (
                <option key={preset.key} value={preset.key}>
                  {t(preset.name)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={addCost}
            className="inline-flex h-[42px] items-center gap-2 rounded-lg border border-[#B9975B] bg-white px-3 text-sm font-bold text-[#4A3526]"
          >
            <Plus size={16} /> Add
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {id && (
            <button
              type="button"
              disabled={busy}
              onClick={deactivate}
              className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2.5 text-sm font-bold text-red-700"
            >
              <Trash2 size={16} /> Remove saved cost
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="inline-flex items-center gap-2 rounded-lg bg-[#4A3526] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            <Save size={16} /> Save and reuse
          </button>
        </div>
      </div>

      {showAdvanced && (
        <div className="mt-3 grid gap-3 rounded-xl border border-[#E5D7BF] p-3 sm:grid-cols-3">
          <label className="text-xs font-semibold text-[#5E4635]">
            Open another saved calculation
            <select
              value={id}
              onChange={(event) => chooseTemplate(event.target.value)}
              className={input}
            >
              <option value="">New calculation</option>
              {activeTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.template_name} -{" "}
                  {items.find((item) => item.id === template.finished_item_id)
                    ?.code || "Item"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-[#5E4635]">
            Saved calculation name
            <input
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              className={input}
            />
          </label>
          <label className="text-xs font-semibold text-[#5E4635]">
            Currency
            <input
              maxLength={3}
              value={currency}
              onChange={(event) =>
                setCurrency(event.target.value.toUpperCase())
              }
              className={input}
            />
          </label>
        </div>
      )}

      {message && (
        <div
          className={`mt-3 rounded-lg p-3 text-sm ${message.startsWith("Cost saved") ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}
        >
          {message}
        </div>
      )}
      <div className="mt-3 flex items-start gap-2 rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-900">
        <Calculator className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          <b>How it works:</b> each cost is quantity used multiplied by its
          rate. Waste is added where applicable. Costs per unit use the
          production quantity automatically. Change the quantity and saved
          material, labour and machine requirements scale with it.
        </p>
      </div>
    </section>
  );
}

function ResultCard({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: string;
  tone?: "plain" | "green" | "red";
}) {
  const colour =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "red"
        ? "border-red-200 bg-red-50 text-red-800"
        : "border-[#E5D7BF] bg-[#FAF7F1] text-[#3F2D20]";
  return (
    <div className={`rounded-xl border p-3 ${colour}`}>
      <span className="text-xs opacity-75">{label}</span>
      <strong className="mt-1 flex items-center gap-1 text-lg">
        <TrendingUp size={15} /> {value}
      </strong>
    </div>
  );
}
