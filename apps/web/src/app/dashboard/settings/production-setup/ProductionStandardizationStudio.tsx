"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  FlaskConical,
  Layers3,
  PackageOpen,
  RefreshCw,
} from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";

const input =
  "mt-1 w-full rounded-lg border border-[#D9C8AA] bg-white px-3 py-2 text-sm";
const label = "text-xs font-semibold text-[#5E4635]";
const tabs = [
  ["PACK", "Start: Industry pack"],
  ["SPEC", "1. Product specifications"],
  ["FORMULA", "2. Formulas"],
  ["MATERIAL", "3. Operation materials"],
  ["ENGINEERING", "4. Engineering results"],
  ["EVIDENCE", "5. Cost & delivery evidence"],
];

export default function ProductionStandardizationStudio() {
  const [active, setActive] = useState("PACK");
  const [data, setData] = useState<any>({});
  const [packs, setPacks] = useState<any[]>([]);
  const [packPreview, setPackPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [attributeValues, setAttributeValues] = useState<
    Record<string, string>
  >({});
  const [specFamily, setSpecFamily] = useState("");
  const [specItem, setSpecItem] = useState("");
  const [formulaInputs, setFormulaInputs] = useState(
    '{"quantity":100,"length_mm":60}',
  );
  const [formulaResult, setFormulaResult] = useState<any>(null);
  const [mapping, setMapping] = useState<any>({
    finished_item_id: "",
    bom_id: "",
    output_quantity: 1,
    output_uom: "PCS",
    currency_code: "INR",
    operation_mappings: [],
    component_mappings: [],
    quality_parameters: {},
    cost_lines: [],
    uom_conversions: [],
    mrp_parameters: { procurement_type: "MAKE" },
  });
  const [mappingValidation, setMappingValidation] = useState<any>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [overview, availablePacks] = await Promise.all([
        apiClient.get("/production-standardization/overview"),
        apiClient.get("/production-standardization/configuration-packs"),
      ]);
      setData(overview || {});
      setPacks(Array.isArray(availablePacks) ? availablePacks : []);
      setMessage("");
    } catch (error: any) {
      setMessage(
        error?.message || "Unable to load standardized production setup.",
      );
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const attributes = data.production_attribute_definitions || [];
  const families = useMemo(
    () =>
      [...new Set(attributes.map((row: any) => row.family_code))] as string[],
    [attributes],
  );
  const familyAttributes = attributes.filter(
    (row: any) =>
      row.family_code === specFamily && row.lifecycle_status === "APPROVED",
  );
  const itemMap = useMemo<Map<string, any>>(
    () => new Map((data.items || []).map((x: any) => [String(x.id), x])),
    [data.items],
  );
  const routeMap = useMemo<Map<string, any>>(
    () => new Map((data.routings || []).map((x: any) => [String(x.id), x])),
    [data.routings],
  );
  const notify = (text: string) => {
    setMessage(text);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const previewPack = async (code: string) => {
    setBusy(true);
    try {
      const preview: any = await apiClient.get(
        `/production-standardization/configuration-packs/${code}`,
      );
      setPackPreview(preview);
      setMapping((current: any) => ({
        ...current,
        operation_mappings: (preview.operation_templates || []).map(
          (row: any) => ({
            ...row,
            enabled: true,
            work_station_id: "",
            setup_time_minutes: 0,
            cycle_time_minutes: 0,
            qc_required: row.sequence === 100,
            exclusion_reason: "",
          }),
        ),
        quality_parameters: Object.fromEntries(
          (preview.quality_templates || []).map((stage: any) => [
            stage.stage,
            stage.characteristics.map((name: string) => ({
              parameter_name: name,
              data_type: "PASS_FAIL",
              specification: "",
              criticality: "MAJOR",
            })),
          ]),
        ),
        cost_lines: (preview.cost_elements || []).map((name: string) => ({
          name,
          category:
            name === "material" || name === "scrap"
              ? "MATERIAL"
              : name === "labour"
                ? "LABOUR"
                : name === "machine"
                  ? "MACHINE"
                  : "OTHER",
          basis: "PER_UNIT",
          rate: 0,
          driver_quantity: 1,
          enabled: true,
        })),
      }));
      setMappingValidation(null);
    } catch (error: any) {
      notify(error?.message || "Unable to preview the production pack.");
    } finally {
      setBusy(false);
    }
  };
  const loadDemoBaseline = () => {
    const demo = packPreview?.demo_baseline;
    if (!demo) return;
    const operationBySequence = new Map(
      (demo.operation_benchmarks || []).map((row: any) => [
        Number(row.sequence),
        row,
      ]),
    );
    setMapping((current: any) => ({
      ...current,
      currency_code: demo.cost_currency || "AED",
      operation_mappings: (current.operation_mappings || []).map(
        (row: any) => {
          const benchmark: any = operationBySequence.get(Number(row.sequence));
          if (!benchmark) return row;
          return {
            ...row,
            enabled: benchmark.enabled,
            setup_time_minutes: benchmark.setup_time_minutes,
            cycle_time_minutes: benchmark.cycle_time_minutes,
            exclusion_reason: benchmark.enabled ? "" : benchmark.note,
            benchmark_note: benchmark.note,
          };
        },
      ),
      quality_parameters: Object.fromEntries(
        Object.entries(current.quality_parameters || {}).map(
          ([stage, parameters]: [string, any]) => [
            stage,
            (parameters || []).map((parameter: any) => ({
              ...parameter,
              specification:
                demo.quality_specifications?.[stage]?.[
                  parameter.parameter_name
                ] || parameter.specification,
            })),
          ],
        ),
      ),
      cost_lines: (current.cost_lines || []).map((line: any) => ({
        ...line,
        rate: Number(demo.cost_benchmarks?.[line.name] || 0),
        basis:
          line.name === "overhead" || line.name === "scrap" || line.name === "rework"
            ? "PERCENT_MATERIAL"
            : line.basis,
      })),
      mrp_parameters: {
        ...current.mrp_parameters,
        ...(demo.mrp_parameters || {}),
      },
    }));
    setMappingValidation(null);
    notify(
      "Demo benchmark loaded into the draft form. Work centres remain unselected; review and replace all demo assumptions before approval.",
    );
  };
  const selectMappingItem = (itemId: string) => {
    const item = (data.items || []).find((row: any) => row.id === itemId);
    setMapping((current: any) => ({
      ...current,
      finished_item_id: itemId,
      item_code: item?.code || "",
      output_uom: item?.uom || "PCS",
      bom_id: "",
      component_mappings: [],
    }));
    setMappingValidation(null);
  };
  const selectMappingBom = (bomId: string) => {
    const components = (data.bom_items || []).filter(
      (row: any) => row.bom_id === bomId,
    );
    setMapping((current: any) => ({
      ...current,
      bom_id: bomId,
      component_mappings: components.map((row: any) => ({
        bom_item_id: row.id,
        operation_sequence: 10,
        issue_method: row.issue_method || "PRE_STAGE",
        consumption_uom:
          row.consumption_uom || itemMap.get(String(row.item_id))?.uom || "",
        quantity_basis: row.quantity_basis || "PER_OUTPUT",
        rounding_rule: row.rounding_rule || "NONE",
      })),
    }));
    setMappingValidation(null);
  };
  const validateMapping = async () => {
    if (!packPreview) return;
    setBusy(true);
    try {
      const result = await apiClient.post(
        `/production-standardization/configuration-packs/${packPreview.code}/mappings/validate`,
        mapping,
      );
      setMappingValidation(result);
      notify(
        result.valid
          ? "Configuration is structurally valid. Review warnings, then generate controlled drafts."
          : "Configuration has blocking fields. They are listed in the setup panel.",
      );
    } catch (error: any) {
      notify(error?.message || "Unable to validate production configuration.");
    } finally {
      setBusy(false);
    }
  };
  const applyMapping = async () => {
    if (!packPreview || !mappingValidation?.mapping?.id) return;
    setBusy(true);
    try {
      const result: any = await apiClient.post(
        `/production-standardization/configuration-packs/${packPreview.code}/mappings/${mappingValidation.mapping.id}/apply`,
        {},
      );
      notify(
        `${result.generated_as_drafts?.routes || 0} route steps and ${result.generated_as_drafts?.quality_plans || 0} QC plans generated as drafts. No job, stock or accounting entry was created.`,
      );
      setMappingValidation(null);
      await load();
    } catch (error: any) {
      notify(error?.message || "Unable to generate controlled drafts.");
    } finally {
      setBusy(false);
    }
  };
  const installPack = async (code: string) => {
    setBusy(true);
    try {
      const result: any = await apiClient.post(
        `/production-standardization/configuration-packs/${code}/install`,
        {},
      );
      notify(
        `${result?.pack?.name || "Production pack"}: ${result?.installed?.attributes || 0} draft attributes and ${result?.installed?.formulas || 0} draft formulas installed. Nothing was activated or posted.`,
      );
      await load();
    } catch (error: any) {
      notify(error?.message || "Unable to install the draft production pack.");
    } finally {
      setBusy(false);
    }
  };
  const submit = async (
    event: FormEvent<HTMLFormElement>,
    endpoint: string,
    success: string,
  ) => {
    event.preventDefault();
    const form = event.currentTarget;
    const raw: any = Object.fromEntries(new FormData(form));
    setBusy(true);
    try {
      await apiClient.post(endpoint, raw);
      form.reset();
      notify(success);
      await load();
    } catch (error: any) {
      notify(error?.message || "Unable to save.");
    } finally {
      setBusy(false);
    }
  };
  const transition = async (endpoint: string, action: string) => {
    setBusy(true);
    try {
      await apiClient.patch(endpoint, { action });
      notify(`${action.toLowerCase()} completed.`);
      await load();
    } catch (error: any) {
      notify(error?.message || `Unable to ${action.toLowerCase()}.`);
    } finally {
      setBusy(false);
    }
  };
  const saveSpecification = async () => {
    setBusy(true);
    try {
      await apiClient.post("/production-standardization/specifications", {
        item_id: specItem,
        family_code: specFamily,
        specification_values: attributeValues,
      });
      notify(
        "Draft product specification saved. Submit it for independent approval.",
      );
      await load();
    } catch (error: any) {
      notify(error?.message || "Unable to save product specification.");
    } finally {
      setBusy(false);
    }
  };
  const saveFormula = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const raw: any = Object.fromEntries(new FormData(form));
    try {
      const inputs = JSON.parse(formulaInputs);
      setBusy(true);
      await apiClient.post("/production-standardization/formulas", {
        ...raw,
        sample_inputs: inputs,
        input_schema: Object.fromEntries(
          Object.keys(inputs).map((key) => [
            key,
            { type: "NUMBER", default: inputs[key] },
          ]),
        ),
        test_cases: [
          {
            case_name: "Configured baseline",
            input_values: inputs,
            expected_result: Number(raw.expected_result),
            tolerance: Number(raw.tolerance || 0),
          },
        ],
      });
      form.reset();
      notify("Draft formula and its baseline test were saved.");
      await load();
    } catch (error: any) {
      notify(error?.message || "Use valid JSON inputs and a valid formula.");
    } finally {
      setBusy(false);
    }
  };
  const testFormula = async (id: string) => {
    try {
      setBusy(true);
      setFormulaResult(
        await apiClient.post(
          `/production-standardization/formulas/${id}/evaluate`,
          { input_values: JSON.parse(formulaInputs), persist: true },
        ),
      );
    } catch (error: any) {
      notify(error?.message || "Formula evaluation failed.");
    } finally {
      setBusy(false);
    }
  };
  const saveAllocation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const raw: any = Object.fromEntries(new FormData(form));
    setBusy(true);
    try {
      await apiClient.patch(
        `/production-standardization/bom-items/${raw.bom_item_id}/operation-allocation`,
        raw,
      );
      notify(
        "Component staging rule saved against the canonical BOM operation.",
      );
      await load();
    } catch (error: any) {
      notify(error?.message || "Unable to save material allocation.");
    } finally {
      setBusy(false);
    }
  };
  const saveEngineering = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const raw: any = Object.fromEntries(new FormData(form));
    setBusy(true);
    try {
      await apiClient.post("/production-standardization/engineering-results", {
        ...raw,
        lines: [
          {
            item_id: raw.item_id || null,
            material_code: raw.material_code,
            planned_usage: Number(raw.planned_usage),
            expected_output: Number(raw.expected_output),
            expected_scrap: Number(raw.expected_scrap),
            developed_quantity: Number(raw.developed_quantity || 0),
            uom: raw.uom,
          },
        ],
      });
      form.reset();
      notify(
        "Draft engineering result saved with source evidence and validated quantities.",
      );
      await load();
    } catch (error: any) {
      notify(error?.message || "Unable to save engineering result.");
    } finally {
      setBusy(false);
    }
  };
  const freezeCost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const raw: any = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    try {
      await apiClient.post(
        `/production-standardization/job-cost-statements/${raw.job_order_id}`,
        {},
      );
      notify("Controlled job-cost statement frozen from transaction evidence.");
      await load();
    } catch (error: any) {
      notify(error?.message || "The job cost evidence is not yet complete.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      id="standard-production-definition"
      className="rounded-xl border-2 border-[#B9975B] bg-white shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E5D7BF] p-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[#8B6844]">
            One reusable production model
          </p>
          <h2 className="mt-1 text-xl font-bold text-[#3F2D20]">
            Standard production definition
          </h2>
          <p className="mt-1 max-w-4xl text-xs leading-5 text-[#7A6555]">
            Configure client-specific products without new code. Approved BOM,
            routing, specifications, formulas and engineering evidence remain
            the source of truth.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg border border-[#B9975B] px-3 py-2 text-sm font-bold"
        >
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>
      {message && (
        <div className="m-4 rounded-lg border border-[#D9C8AA] bg-[#FFF9EF] px-4 py-3 text-sm text-[#5E4635]">
          {message}
        </div>
      )}
      <div className="flex gap-1 overflow-x-auto border-b border-[#E5D7BF] px-4 pt-2">
        {tabs.map(([code, name]) => (
          <button
            key={code}
            type="button"
            onClick={() => setActive(code)}
            className={`whitespace-nowrap rounded-t-lg px-3 py-2 text-xs font-bold ${active === code ? "bg-[#5E3B27] text-white" : "bg-[#F7F0E5] text-[#5E4635]"}`}
          >
            {name}
          </button>
        ))}
      </div>

      {active === "PACK" && (
        <div className="space-y-4 p-4">
          <div className="rounded-lg border border-[#D9C8AA] bg-[#FFF9EF] p-4">
            <div className="flex items-start gap-3">
              <PackageOpen className="mt-0.5 text-[#8B6844]" size={22} />
              <div>
                <h3 className="font-bold text-[#3F2D20]">
                  Start from a controlled industry blueprint
                </h3>
                <p className="mt-1 text-xs leading-5 text-[#7A6555]">
                  A starter pack fills draft product attributes and tested draft
                  formulas. It does not create a second production engine,
                  operational transactions, items, BOMs or routings.
                </p>
              </div>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {packs.map((pack: any) => (
              <article
                key={pack.code}
                className="rounded-lg border border-[#E5D7BF] p-4"
              >
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#8B6844]">
                  {pack.industry} · v{pack.version}
                </p>
                <h3 className="mt-1 text-lg font-bold text-[#3F2D20]">
                  {pack.name}
                </h3>
                <p className="mt-2 text-xs leading-5 text-[#7A6555]">
                  {pack.description}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                  {Object.entries(pack.counts || {}).map(([name, value]) => (
                    <div key={name} className="rounded border bg-[#FCFAF6] p-2">
                      <b className="block text-base text-[#5E3B27]">
                        {String(value)}
                      </b>
                      <span className="capitalize text-[#7A6555]">
                        {name.replaceAll("_", " ")}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => previewPack(pack.code)}
                    className="rounded-lg border border-[#B9975B] px-3 py-2 text-xs font-bold"
                  >
                    Review contents
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => installPack(pack.code)}
                    className="rounded-lg bg-[#5E3B27] px-3 py-2 text-xs font-bold text-white"
                  >
                    Install as drafts
                  </button>
                </div>
              </article>
            ))}
          </div>
          {packPreview && (
            <div className="rounded-lg border border-[#E5D7BF] p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold text-[#3F2D20]">
                    {packPreview.name}
                  </h3>
                  <p className="text-xs text-[#7A6555]">
                    Source: {packPreview.source}
                  </p>
                </div>
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">
                  Draft starter configuration
                </span>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <PackList
                  title="Product specification"
                  rows={(packPreview.attributes || []).map(
                    (x: any) =>
                      `${x.attribute_name}${x.unit_code ? ` (${x.unit_code})` : ""}`,
                  )}
                />
                <PackList
                  title="Operation template"
                  rows={(packPreview.operation_templates || []).map(
                    (x: any) => `${x.sequence}. ${x.operation}`,
                  )}
                />
                <PackList
                  title="Quality and costing"
                  rows={[
                    ...(packPreview.quality_templates || []).map(
                      (x: any) => `${x.stage}: ${x.characteristics.join(", ")}`,
                    ),
                    ...(packPreview.cost_elements || []).map(
                      (x: string) => `Cost: ${x}`,
                    ),
                  ]}
                />
              </div>
              <div className="mt-4 rounded border border-amber-200 bg-amber-50 p-3">
                <b className="text-xs text-amber-950">Before approval</b>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-amber-900">
                  {(packPreview.required_client_data || []).map((x: string) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
              {packPreview.demo_baseline && (
                <div className="mt-4 rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wide text-amber-800">
                        {packPreview.demo_baseline.label}
                      </p>
                      <p className="mt-1 max-w-4xl text-xs leading-5 text-amber-950">
                        {packPreview.demo_baseline.disclaimer}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={loadDemoBaseline}
                      className="rounded-lg bg-amber-800 px-4 py-2 text-xs font-bold text-white"
                    >
                      Load demo numbers
                    </button>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {Object.entries(
                      packPreview.demo_baseline.calculated_example || {},
                    )
                      .filter(([name]) => name !== "note")
                      .map(([name, value]) => (
                        <div key={name} className="rounded border border-amber-200 bg-white p-2">
                          <span className="block text-[10px] uppercase text-amber-800">
                            {name.replaceAll("_", " ")}
                          </span>
                          <b className="text-sm text-[#3F2D20]">{String(value)}</b>
                        </div>
                      ))}
                  </div>
                  <p className="mt-2 text-[11px] text-amber-900">
                    {packPreview.demo_baseline.calculated_example?.note}
                  </p>
                </div>
              )}
              <div className="mt-5 rounded-xl border-2 border-[#B9975B] bg-white p-4">
                <h3 className="text-lg font-bold text-[#3F2D20]">
                  Guided product setup
                </h3>
                <p className="mt-1 text-xs leading-5 text-[#7A6555]">
                  Map this blueprint to one existing finished item and draft
                  BOM. Fields can be included or excluded without changing
                  code. Validation never posts production, stock or finance.
                </p>
                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <label className={label}>
                    Finished item *
                    <select
                      className={input}
                      value={mapping.finished_item_id}
                      onChange={(e) => selectMappingItem(e.target.value)}
                    >
                      <option value="">Select item</option>
                      {(data.items || []).map((row: any) => (
                        <option key={row.id} value={row.id}>
                          {row.code} - {row.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={label}>
                    Draft BOM revision *
                    <select
                      className={input}
                      value={mapping.bom_id}
                      onChange={(e) => selectMappingBom(e.target.value)}
                    >
                      <option value="">Select BOM</option>
                      {(data.boms || [])
                        .filter(
                          (row: any) =>
                            row.item_id === mapping.finished_item_id,
                        )
                        .map((row: any) => (
                          <option key={row.id} value={row.id}>
                            Version {row.version} - {row.lifecycle_status}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className={label}>
                    BOM output quantity *
                    <input
                      type="number"
                      min="0.000001"
                      step="any"
                      className={input}
                      value={mapping.output_quantity}
                      onChange={(e) =>
                        setMapping({
                          ...mapping,
                          output_quantity: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label className={label}>
                    Output UOM *
                    <input
                      className={input}
                      value={mapping.output_uom}
                      onChange={(e) =>
                        setMapping({
                          ...mapping,
                          output_uom: e.target.value.toUpperCase(),
                        })
                      }
                    />
                  </label>
                </div>

                <h4 className="mt-6 font-bold text-[#3F2D20]">
                  Route and work-centre mapping
                </h4>
                <p className="text-xs text-[#7A6555]">
                  Keep only the operations used by this product. Every excluded
                  step needs a reason; every included step needs a real work
                  centre and standard minutes.
                </p>
                <div className="mt-3 space-y-2">
                  {(mapping.operation_mappings || []).map(
                    (row: any, index: number) => (
                      <div
                        key={row.sequence}
                        className="grid gap-2 rounded-lg border border-[#E5D7BF] bg-[#FCFAF6] p-3 md:grid-cols-[70px_1.3fr_1.2fr_110px_110px]"
                      >
                        <label className={`${label} flex items-center gap-2`}>
                          <input
                            type="checkbox"
                            checked={row.enabled !== false}
                            onChange={(e) => {
                              const next = [...mapping.operation_mappings];
                              next[index] = {
                                ...row,
                                enabled: e.target.checked,
                              };
                              setMapping({
                                ...mapping,
                                operation_mappings: next,
                              });
                            }}
                          />
                          {row.sequence}
                        </label>
                        <div className="text-xs">
                          <b className="block text-[#3F2D20]">
                            {row.operation}
                          </b>
                          <span className="text-[#7A6555]">
                            {row.suggested_resource}
                          </span>
                        </div>
                        {row.enabled !== false ? (
                          <select
                            className={input}
                            aria-label={`Work centre for ${row.operation}`}
                            value={row.work_station_id}
                            onChange={(e) => {
                              const next = [...mapping.operation_mappings];
                              next[index] = {
                                ...row,
                                work_station_id: e.target.value,
                              };
                              setMapping({
                                ...mapping,
                                operation_mappings: next,
                              });
                            }}
                          >
                            <option value="">Select work centre</option>
                            {(data.work_stations || []).map((station: any) => (
                              <option key={station.id} value={station.id}>
                                {station.station_code} - {station.station_name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className={input}
                            placeholder="Reason not used *"
                            value={row.exclusion_reason}
                            onChange={(e) => {
                              const next = [...mapping.operation_mappings];
                              next[index] = {
                                ...row,
                                exclusion_reason: e.target.value,
                              };
                              setMapping({
                                ...mapping,
                                operation_mappings: next,
                              });
                            }}
                          />
                        )}
                        <label className={label}>
                          Setup min
                          <input
                            type="number"
                            min="0"
                            step="any"
                            disabled={row.enabled === false}
                            className={input}
                            value={row.setup_time_minutes}
                            onChange={(e) => {
                              const next = [...mapping.operation_mappings];
                              next[index] = {
                                ...row,
                                setup_time_minutes: Number(e.target.value),
                              };
                              setMapping({
                                ...mapping,
                                operation_mappings: next,
                              });
                            }}
                          />
                        </label>
                        <label className={label}>
                          Run min/unit
                          <input
                            type="number"
                            min="0"
                            step="any"
                            disabled={row.enabled === false}
                            className={input}
                            value={row.cycle_time_minutes}
                            onChange={(e) => {
                              const next = [...mapping.operation_mappings];
                              next[index] = {
                                ...row,
                                cycle_time_minutes: Number(e.target.value),
                              };
                              setMapping({
                                ...mapping,
                                operation_mappings: next,
                              });
                            }}
                          />
                        </label>
                      </div>
                    ),
                  )}
                </div>

                {!!mapping.component_mappings?.length && (
                  <details className="mt-5 rounded-lg border border-[#E5D7BF] p-3" open>
                    <summary className="cursor-pointer font-bold text-[#3F2D20]">
                      Material issue points ({mapping.component_mappings.length})
                    </summary>
                    <div className="mt-3 space-y-2">
                      {mapping.component_mappings.map(
                        (row: any, index: number) => {
                          const line = (data.bom_items || []).find(
                            (x: any) => x.id === row.bom_item_id,
                          );
                          const component = itemMap.get(String(line?.item_id));
                          return (
                            <div
                              key={row.bom_item_id}
                              className="grid gap-2 rounded border bg-[#FCFAF6] p-2 md:grid-cols-[1.5fr_1fr_1fr_1fr]"
                            >
                              <div className="text-xs">
                                <b>{component?.code || "Sub-assembly"}</b>
                                <span className="block text-[#7A6555]">
                                  {component?.name || "Linked child BOM"} · Qty {line?.quantity}
                                </span>
                              </div>
                              <select
                                className={input}
                                value={row.operation_sequence}
                                onChange={(e) => {
                                  const next = [...mapping.component_mappings];
                                  next[index] = {
                                    ...row,
                                    operation_sequence: Number(e.target.value),
                                  };
                                  setMapping({
                                    ...mapping,
                                    component_mappings: next,
                                  });
                                }}
                              >
                                {(mapping.operation_mappings || [])
                                  .filter((x: any) => x.enabled !== false)
                                  .map((x: any) => (
                                    <option key={x.sequence} value={x.sequence}>
                                      {x.sequence} - {x.operation}
                                    </option>
                                  ))}
                              </select>
                              <select
                                className={input}
                                value={row.quantity_basis}
                                onChange={(e) => {
                                  const next = [...mapping.component_mappings];
                                  next[index] = {
                                    ...row,
                                    quantity_basis: e.target.value,
                                  };
                                  setMapping({
                                    ...mapping,
                                    component_mappings: next,
                                  });
                                }}
                              >
                                <option value="PER_OUTPUT">Per BOM output</option>
                                <option value="PER_BATCH">Per batch/run</option>
                                <option value="FIXED_SETUP">Fixed per setup</option>
                                <option value="FORMULA">Formula driven</option>
                              </select>
                              <input
                                className={input}
                                aria-label="Consumption UOM"
                                placeholder="Consumption UOM"
                                value={row.consumption_uom}
                                onChange={(e) => {
                                  const next = [...mapping.component_mappings];
                                  next[index] = {
                                    ...row,
                                    consumption_uom: e.target.value.toUpperCase(),
                                  };
                                  setMapping({
                                    ...mapping,
                                    component_mappings: next,
                                  });
                                }}
                              />
                            </div>
                          );
                        },
                      )}
                    </div>
                  </details>
                )}

                <details className="mt-4 rounded-lg border border-[#E5D7BF] p-3">
                  <summary className="cursor-pointer font-bold text-[#3F2D20]">
                    QC specifications, costing and MRP proposal
                  </summary>
                  <p className="mt-2 text-xs text-[#7A6555]">
                    Demo values are visibly provisional. Replace them with
                    client-approved tolerances and rates before activation. Blank
                    QC stages are reported as warnings; cost sheets remain inactive
                    until reviewed.
                  </p>
                  <div className="mt-3 grid gap-4 lg:grid-cols-2">
                    <div>
                      {(packPreview.quality_templates || []).map((stage: any) => (
                        <div key={stage.stage} className="mb-3 rounded border p-2">
                          <b className="text-xs text-[#5E3B27]">{stage.stage}</b>
                          {(mapping.quality_parameters?.[stage.stage] || []).map(
                            (parameter: any, index: number) => (
                              <div key={parameter.parameter_name} className="mt-2 grid grid-cols-2 gap-2">
                                <span className="text-xs capitalize">{parameter.parameter_name}</span>
                                <input
                                  className={input}
                                  placeholder="Specification / tolerance"
                                  value={parameter.specification}
                                  onChange={(e) => {
                                    const quality = { ...mapping.quality_parameters };
                                    const next = [...quality[stage.stage]];
                                    next[index] = { ...parameter, specification: e.target.value };
                                    quality[stage.stage] = next;
                                    setMapping({ ...mapping, quality_parameters: quality });
                                  }}
                                />
                              </div>
                            ),
                          )}
                        </div>
                      ))}
                    </div>
                    <div>
                      {(mapping.cost_lines || []).map((line: any, index: number) => (
                        <div key={line.name} className="grid grid-cols-[1fr_120px] gap-2 border-b py-2">
                          <span className="text-xs capitalize">{line.name}</span>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            className={input}
                            aria-label={`${line.name} rate`}
                            value={line.rate}
                            onChange={(e) => {
                              const next = [...mapping.cost_lines];
                              next[index] = { ...line, rate: Number(e.target.value) };
                              setMapping({ ...mapping, cost_lines: next });
                            }}
                          />
                        </div>
                      ))}
                      <label className={`${label} mt-3 block`}>
                        MRP procurement proposal
                        <select
                          className={input}
                          value={mapping.mrp_parameters?.procurement_type || "MAKE"}
                          onChange={(e) =>
                            setMapping({
                              ...mapping,
                              mrp_parameters: {
                                ...mapping.mrp_parameters,
                                procurement_type: e.target.value,
                              },
                            })
                          }
                        >
                          <option value="MAKE">Make</option>
                          <option value="BUY">Buy</option>
                          <option value="AUTO">Auto decide</option>
                        </select>
                      </label>
                    </div>
                  </div>
                </details>

                {mappingValidation && (
                  <div
                    className={`mt-4 rounded-lg border p-3 ${mappingValidation.valid ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50"}`}
                  >
                    <b className="text-sm">
                      {mappingValidation.valid
                        ? "Structurally valid"
                        : `${mappingValidation.blockers?.length || 0} blocking issue(s)`}
                    </b>
                    {!!mappingValidation.blockers?.length && (
                      <ul className="mt-2 list-disc pl-5 text-xs">
                        {mappingValidation.blockers.map((text: string) => (
                          <li key={text}>{text}</li>
                        ))}
                      </ul>
                    )}
                    {!!mappingValidation.warnings?.length && (
                      <ul className="mt-2 list-disc pl-5 text-xs text-amber-900">
                        {mappingValidation.warnings.map((text: string) => (
                          <li key={text}>{text}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={validateMapping}
                    className="rounded-lg border border-[#5E3B27] px-4 py-2 text-sm font-bold text-[#5E3B27]"
                  >
                    Validate setup
                  </button>
                  <button
                    type="button"
                    disabled={busy || !mappingValidation?.valid}
                    onClick={applyMapping}
                    className="rounded-lg bg-[#5E3B27] px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                  >
                    Generate controlled drafts
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {active === "SPEC" && (
        <div className="grid gap-5 p-4 lg:grid-cols-2">
          <form
            onSubmit={(e) =>
              submit(
                e,
                "/production-standardization/attributes",
                "Draft attribute saved. A different authorized user must approve it.",
              )
            }
            className="rounded-lg border border-[#E5D7BF] p-4"
          >
            <h3 className="font-bold text-[#3F2D20]">
              Define a reusable attribute
            </h3>
            <p className="mb-3 text-xs text-[#7A6555]">
              Example: width_mm, gauge, resin or colour. No database change is
              needed.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={label}>
                Product family *
                <input
                  name="family_code"
                  required
                  placeholder="SCREW or AC_DUCT"
                  className={input}
                />
              </label>
              <label className={label}>
                Attribute code *
                <input
                  name="attribute_code"
                  required
                  placeholder="length_mm"
                  className={input}
                />
              </label>
              <label className={label}>
                Display name *
                <input
                  name="attribute_name"
                  required
                  placeholder="Length"
                  className={input}
                />
              </label>
              <label className={label}>
                Type *
                <select name="data_type" className={input}>
                  <option>MEASUREMENT</option>
                  <option>NUMBER</option>
                  <option>TEXT</option>
                  <option>OPTION</option>
                  <option>BOOLEAN</option>
                  <option>DATE</option>
                </select>
              </label>
              <label className={label}>
                Unit
                <input name="unit_code" placeholder="MM" className={input} />
              </label>
              <label className={label}>
                Identity sequence
                <input
                  name="identity_sequence"
                  type="number"
                  min="1"
                  className={input}
                />
              </label>
              <label className={label}>
                Minimum
                <input
                  name="minimum_value"
                  type="number"
                  step="any"
                  className={input}
                />
              </label>
              <label className={label}>
                Maximum
                <input
                  name="maximum_value"
                  type="number"
                  step="any"
                  className={input}
                />
              </label>
            </div>
            <label className="mt-3 flex gap-2 text-xs">
              <input name="required" type="checkbox" value="true" />
              Required for this family
            </label>
            <button
              disabled={busy}
              className="mt-3 rounded-lg bg-[#5E3B27] px-4 py-2 text-sm font-bold text-white"
            >
              Save draft attribute
            </button>
          </form>
          <div className="rounded-lg border border-[#E5D7BF] p-4">
            <h3 className="font-bold">Attribute register</h3>
            <div className="mt-3 max-h-80 space-y-2 overflow-auto">
              {attributes.map((row: any) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between gap-2 rounded border p-2 text-xs"
                >
                  <span>
                    <b>
                      {row.family_code} / {row.attribute_name}
                    </b>
                    <br />
                    {row.attribute_code} · {row.data_type}
                    {row.unit_code ? ` · ${row.unit_code}` : ""}
                  </span>
                  <span className="text-right">
                    {row.lifecycle_status}
                    {row.lifecycle_status === "DRAFT" && (
                      <button
                        type="button"
                        onClick={() =>
                          transition(
                            `/production-standardization/attributes/${row.id}/transition`,
                            "APPROVE",
                          )
                        }
                        className="ml-2 rounded border px-2 py-1"
                      >
                        Approve
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-[#E5D7BF] p-4 lg:col-span-2">
            <h3 className="font-bold">Create a governed item specification</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <label className={label}>
                Item *
                <select
                  value={specItem}
                  onChange={(e) => setSpecItem(e.target.value)}
                  className={input}
                >
                  <option value="">Select item</option>
                  {(data.items || []).map((x: any) => (
                    <option key={x.id} value={x.id}>
                      {x.code} - {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Product family *
                <select
                  value={specFamily}
                  onChange={(e) => {
                    setSpecFamily(e.target.value);
                    setAttributeValues({});
                  }}
                  className={input}
                >
                  <option value="">Select family</option>
                  {families.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              {familyAttributes.map((x: any) => (
                <label key={x.id} className={label}>
                  {x.attribute_name}
                  {x.required ? " *" : ""}
                  <input
                    value={attributeValues[x.attribute_code] || ""}
                    onChange={(e) =>
                      setAttributeValues((v) => ({
                        ...v,
                        [x.attribute_code]: e.target.value,
                      }))
                    }
                    type={
                      ["NUMBER", "MEASUREMENT"].includes(x.data_type)
                        ? "number"
                        : "text"
                    }
                    step="any"
                    className={input}
                  />
                </label>
              ))}
            </div>
            <button
              type="button"
              disabled={busy || !specItem || !specFamily}
              onClick={saveSpecification}
              className="mt-3 rounded-lg bg-[#5E3B27] px-4 py-2 text-sm font-bold text-white"
            >
              Save draft specification
            </button>
            <div className="mt-3 flex flex-wrap gap-2">
              {(data.production_item_specifications || []).map((x: any) => (
                <span key={x.id} className="rounded border px-2 py-1 text-xs">
                  {itemMap.get(x.item_id)?.code || "Item"} · {x.family_code} ·{" "}
                  {x.variant_identity || "Specification"} · {x.lifecycle_status}
                  {x.lifecycle_status === "DRAFT" && (
                    <button
                      onClick={() =>
                        transition(
                          `/production-standardization/specifications/${x.id}/transition`,
                          "SUBMIT",
                        )
                      }
                      className="ml-2 underline"
                    >
                      Submit
                    </button>
                  )}
                  {x.lifecycle_status === "SUBMITTED" && (
                    <button
                      onClick={() =>
                        transition(
                          `/production-standardization/specifications/${x.id}/transition`,
                          "APPROVE",
                        )
                      }
                      className="ml-2 underline"
                    >
                      Approve
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {active === "FORMULA" && (
        <div className="grid gap-5 p-4 lg:grid-cols-2">
          <form onSubmit={saveFormula} className="rounded-lg border p-4">
            <h3 className="font-bold">Versioned planning formula</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className={label}>
                Formula code *
                <input name="formula_code" required className={input} />
              </label>
              <label className={label}>
                Name *<input name="formula_name" required className={input} />
              </label>
              <label className={`${label} sm:col-span-2`}>
                Expression *
                <input
                  name="expression"
                  required
                  placeholder="ceil(quantity * piece_weight_g / 1000)"
                  className={input}
                />
              </label>
              <label className={label}>
                Output target
                <select name="output_target" className={input}>
                  <option>BOM_QUANTITY</option>
                  <option>SCRAP_PERCENT</option>
                  <option>YIELD_PERCENT</option>
                  <option>OPERATION_TIME</option>
                  <option>COST_DRIVER</option>
                </select>
              </label>
              <label className={label}>
                Output UOM
                <input name="output_uom" className={input} />
              </label>
              <label className={`${label} sm:col-span-2`}>
                Sample inputs (JSON)
                <textarea
                  value={formulaInputs}
                  onChange={(e) => setFormulaInputs(e.target.value)}
                  rows={3}
                  className={input}
                />
              </label>
              <label className={label}>
                Expected result *
                <input
                  name="expected_result"
                  required
                  type="number"
                  step="any"
                  className={input}
                />
              </label>
              <label className={label}>
                Tolerance
                <input
                  name="tolerance"
                  type="number"
                  step="any"
                  defaultValue="0"
                  className={input}
                />
              </label>
            </div>
            <button
              disabled={busy}
              className="mt-3 rounded-lg bg-[#5E3B27] px-4 py-2 text-sm font-bold text-white"
            >
              Save formula + baseline test
            </button>
          </form>
          <div className="rounded-lg border p-4">
            <h3 className="font-bold">Formula register and trace</h3>
            {formulaResult && (
              <pre className="mt-2 overflow-auto rounded bg-[#F7F0E5] p-2 text-xs">
                {JSON.stringify(formulaResult, null, 2)}
              </pre>
            )}
            <div className="mt-3 space-y-2">
              {(data.production_formula_definitions || []).map((x: any) => (
                <div key={x.id} className="rounded border p-2 text-xs">
                  <b>
                    {x.formula_code} v{x.version} · {x.formula_name}
                  </b>
                  <br />
                  <code>{x.expression}</code>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => testFormula(x.id)}
                      className="rounded border px-2 py-1"
                    >
                      Evaluate
                    </button>
                    <button
                      onClick={async () => {
                        await apiClient.post(
                          `/production-standardization/formulas/${x.id}/run-tests`,
                          {},
                        );
                        await load();
                      }}
                      className="rounded border px-2 py-1"
                    >
                      Run tests
                    </button>
                    {x.lifecycle_status === "DRAFT" && (
                      <button
                        onClick={() =>
                          transition(
                            `/production-standardization/formulas/${x.id}/transition`,
                            "SUBMIT",
                          )
                        }
                        className="rounded border px-2 py-1"
                      >
                        Submit
                      </button>
                    )}
                    {x.lifecycle_status === "SUBMITTED" && (
                      <button
                        onClick={() =>
                          transition(
                            `/production-standardization/formulas/${x.id}/transition`,
                            "APPROVE",
                          )
                        }
                        className="rounded border px-2 py-1"
                      >
                        Approve
                      </button>
                    )}
                    <span className="py-1 font-bold">{x.lifecycle_status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {active === "MATERIAL" && (
        <div className="p-4">
          <form onSubmit={saveAllocation} className="rounded-lg border p-4">
            <h3 className="font-bold">
              Stage each component at its consuming operation
            </h3>
            <p className="text-xs text-[#7A6555]">
              This extends the existing BOM; it does not create a second
              material list.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <label className={label}>
                BOM component *
                <select name="bom_item_id" required className={input}>
                  <option value="">Select component</option>
                  {(data.bom_items || []).map((x: any) => (
                    <option key={x.id} value={x.id}>
                      {itemMap.get(x.item_id)?.code || "Subassembly"} · Qty{" "}
                      {x.quantity}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Consuming operation *
                <select name="route_operation_id" required className={input}>
                  <option value="">Select operation</option>
                  {(data.routings || []).map((x: any) => (
                    <option key={x.id} value={x.id}>
                      {x.sequence_no}. {x.operation_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Issue method *
                <select name="issue_method" className={input}>
                  <option>MANUAL</option>
                  <option>PRE_STAGE</option>
                  <option>BACKFLUSH</option>
                  <option>SUBCONTRACT_OUTWARD</option>
                </select>
              </label>
              <label className={label}>
                Input warehouse
                <select name="input_warehouse_id" className={input}>
                  <option value="">At scheduling</option>
                  {(data.warehouses || []).map((x: any) => (
                    <option key={x.id} value={x.id}>
                      {x.code} - {x.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              disabled={busy}
              className="mt-3 rounded-lg bg-[#5E3B27] px-4 py-2 text-sm font-bold text-white"
            >
              Save operation allocation
            </button>
          </form>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {(data.bom_items || [])
              .filter((x: any) => x.route_operation_id)
              .map((x: any) => (
                <div key={x.id} className="rounded border p-2 text-xs">
                  <b>{itemMap.get(x.item_id)?.code || "Component"}</b> →{" "}
                  {routeMap.get(x.route_operation_id)?.operation_name ||
                    "Operation"}{" "}
                  · {x.issue_method}
                </div>
              ))}
          </div>
        </div>
      )}

      {active === "ENGINEERING" && (
        <div className="grid gap-5 p-4 lg:grid-cols-2">
          <form onSubmit={saveEngineering} className="rounded-lg border p-4">
            <h3 className="font-bold">
              Import controlled nesting/engineering output
            </h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className={label}>
                Result number *
                <input name="result_number" required className={input} />
              </label>
              <label className={label}>
                Type
                <select name="result_type" className={input}>
                  <option>NESTING</option>
                  <option>CAD</option>
                  <option>CAM</option>
                  <option>CUT_LIST</option>
                  <option>ENGINEERING_CALCULATION</option>
                </select>
              </label>
              <label className={`${label} sm:col-span-2`}>
                Source file URL *
                <input
                  name="source_file_url"
                  required
                  type="url"
                  className={input}
                />
              </label>
              <label className={label}>
                Project
                <select name="project_id" className={input}>
                  <option value="">Optional</option>
                  {(data.projects || []).map((x: any) => (
                    <option key={x.id} value={x.id}>
                      {x.project_code} - {x.project_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Material item
                <select name="item_id" className={input}>
                  <option value="">Optional</option>
                  {(data.items || []).map((x: any) => (
                    <option key={x.id} value={x.id}>
                      {x.code}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Material code
                <input name="material_code" className={input} />
              </label>
              <label className={label}>
                UOM *<input name="uom" required className={input} />
              </label>
              <label className={label}>
                Planned usage *
                <input
                  name="planned_usage"
                  required
                  type="number"
                  min="0"
                  step="any"
                  className={input}
                />
              </label>
              <label className={label}>
                Expected good output *
                <input
                  name="expected_output"
                  required
                  type="number"
                  min="0"
                  step="any"
                  className={input}
                />
              </label>
              <label className={label}>
                Expected scrap *
                <input
                  name="expected_scrap"
                  required
                  type="number"
                  min="0"
                  step="any"
                  className={input}
                />
              </label>
            </div>
            <button
              disabled={busy}
              className="mt-3 rounded-lg bg-[#5E3B27] px-4 py-2 text-sm font-bold text-white"
            >
              Save draft result
            </button>
          </form>
          <div className="rounded-lg border p-4">
            <h3 className="font-bold">Engineering result register</h3>
            <div className="mt-3 space-y-2">
              {(data.production_engineering_results || []).map((x: any) => (
                <div key={x.id} className="rounded border p-2 text-xs">
                  <b>
                    {x.result_number} v{x.version}
                  </b>{" "}
                  · {x.result_type} · {x.lifecycle_status}
                  {x.lifecycle_status === "DRAFT" && (
                    <button
                      onClick={() =>
                        transition(
                          `/production-standardization/engineering-results/${x.id}/transition`,
                          "SUBMIT",
                        )
                      }
                      className="ml-2 underline"
                    >
                      Submit
                    </button>
                  )}
                  {x.lifecycle_status === "SUBMITTED" && (
                    <button
                      onClick={() =>
                        transition(
                          `/production-standardization/engineering-results/${x.id}/transition`,
                          "APPROVE",
                        )
                      }
                      className="ml-2 underline"
                    >
                      Approve
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {active === "EVIDENCE" && (
        <div className="space-y-4 p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Evidence
              title="Controlled job costing"
              detail={`${(data.production_job_cost_statements || []).length} frozen statement(s)`}
              href="/dashboard/accounts/costing"
            />
            <Evidence
              title="Project delivery thread"
              detail={`${(data.project_delivery_allocations || []).length} allocation(s)`}
              href="/dashboard/projects"
            />
            <Evidence
              title="Production variance"
              detail="Material, time, yield and cost evidence"
              href="/dashboard/production/reports"
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <form onSubmit={freezeCost} className="rounded-lg border p-4">
              <h3 className="font-bold">
                Freeze a completed job-cost statement
              </h3>
              <label className={label}>
                Controlled job *
                <select name="job_order_id" required className={input}>
                  <option value="">Select completed job</option>
                  {(data.jobs || [])
                    .filter(
                      (x: any) =>
                        String(x.status).toUpperCase() === "COMPLETED",
                    )
                    .map((x: any) => (
                      <option key={x.id} value={x.id}>
                        {x.job_order_number}
                      </option>
                    ))}
                </select>
              </label>
              <button
                disabled={busy}
                className="mt-3 rounded-lg bg-[#5E3B27] px-4 py-2 text-sm font-bold text-white"
              >
                Generate from actual evidence
              </button>
            </form>
            <form
              onSubmit={(e) =>
                submit(
                  e,
                  "/production-standardization/delivery-allocations",
                  "Accepted output allocated to the project delivery thread.",
                )
              }
              className="rounded-lg border p-4"
            >
              <h3 className="font-bold">
                Allocate accepted output to a project
              </h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className={label}>
                  Project *
                  <select name="project_id" required className={input}>
                    <option value="">Select project</option>
                    {(data.projects || []).map((x: any) => (
                      <option key={x.id} value={x.id}>
                        {x.project_code} - {x.project_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={label}>
                  Production job
                  <select name="job_order_id" className={input}>
                    <option value="">Optional</option>
                    {(data.jobs || []).map((x: any) => (
                      <option key={x.id} value={x.id}>
                        {x.job_order_number}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={label}>
                  Item *
                  <select name="item_id" required className={input}>
                    <option value="">Select item</option>
                    {(data.items || []).map((x: any) => (
                      <option key={x.id} value={x.id}>
                        {x.code} - {x.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={label}>
                  Accepted quantity
                  <input
                    name="accepted_quantity"
                    type="number"
                    min="0"
                    step="any"
                    className={input}
                  />
                </label>
                <label className={label}>
                  Allocate quantity *
                  <input
                    name="allocated_quantity"
                    required
                    type="number"
                    min="0.000001"
                    step="any"
                    className={input}
                  />
                </label>
                <label className={label}>
                  Site / package reference
                  <input name="site_reference" className={input} />
                </label>
              </div>
              <button
                disabled={busy}
                className="mt-3 rounded-lg bg-[#5E3B27] px-4 py-2 text-sm font-bold text-white"
              >
                Allocate output
              </button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

function Evidence({
  title,
  detail,
  href,
}: {
  title: string;
  detail: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-[#D9C8AA] bg-[#FFF9EF] p-4"
    >
      <CheckCircle2 className="text-emerald-700" size={20} />
      <h3 className="mt-2 font-bold">{title}</h3>
      <p className="text-xs text-[#7A6555]">{detail}</p>
      <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold underline">
        <Layers3 size={13} />
        Open controlled evidence
      </span>
    </Link>
  );
}
function PackList({ title, rows }: { title: string; rows: string[] }) {
  return (
    <div>
      <h4 className="text-sm font-bold text-[#3F2D20]">{title}</h4>
      <ul className="mt-2 max-h-64 space-y-1 overflow-auto text-xs text-[#6F5A4B]">
        {rows.map((row, index) => (
          <li
            key={`${row}-${index}`}
            className="rounded border border-[#EEE3D1] bg-[#FCFAF6] px-2 py-1.5"
          >
            {row}
          </li>
        ))}
      </ul>
    </div>
  );
}
