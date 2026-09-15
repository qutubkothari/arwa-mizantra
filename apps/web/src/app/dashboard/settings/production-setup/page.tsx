"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Factory,
  RefreshCw,
  Save,
} from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";
import ProductionCostSheet from "./ProductionCostSheet";
import ProductionStandardizationStudio from "./ProductionStandardizationStudio";

const field =
  "mt-1 w-full rounded-lg border border-[#D9C8AA] bg-white px-3 py-2 text-sm";
const label = "text-xs font-semibold text-[#5E4635]";

const wizardSteps = [
  { title: "Start", detail: "Readiness and master data" },
  { title: "Product", detail: "Industry pack and definition" },
  { title: "Machines", detail: "Capacity master" },
  { title: "Tooling", detail: "Tools and process links" },
  { title: "Standards", detail: "Product-specific rates" },
  { title: "Costing", detail: "Expected product cost" },
  { title: "Review", detail: "Check and finish" },
] as const;

export default function ProductionSetupPage() {
  const [data, setData] = useState<any>({
    items: [],
    stations: [],
    routings: [],
    production_process_resource_profiles: [],
    production_tool_resources: [],
    production_routing_constraints: [],
    production_tool_assignments: [],
    production_tool_events: [],
    production_cost_sheet_templates: [],
  });
  const [stationId, setStationId] = useState("");
  const [capacity, setCapacity] = useState("");
  const [showNewMachine, setShowNewMachine] = useState(false);
  const [newMachine, setNewMachine] = useState({
    stationCode: "",
    stationName: "",
    stationType: "CUTTING",
    capacityPerHour: "",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [toolRoutingId, setToolRoutingId] = useState("");
  const [requiredToolCodes, setRequiredToolCodes] = useState<string[]>([]);
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const saved = Number(
      window.localStorage.getItem("mizantra-production-setup-step"),
    );
    if (Number.isInteger(saved) && saved >= 0 && saved < wizardSteps.length) {
      setActiveStep(saved);
    }
  }, []);

  const goToStep = (step: number) => {
    const next = Math.max(0, Math.min(wizardSteps.length - 1, step));
    setActiveStep(next);
    window.localStorage.setItem("mizantra-production-setup-step", String(next));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const response = await apiClient.get(
        "/production-planning/configuration",
      );
      setData({
        ...response,
        items: response?.items || [],
        stations: response?.stations || [],
        routings: response?.routings || [],
        production_process_resource_profiles:
          response?.production_process_resource_profiles || [],
        production_tool_resources: response?.production_tool_resources || [],
        production_routing_constraints:
          response?.production_routing_constraints || [],
        production_tool_assignments:
          response?.production_tool_assignments || [],
        production_tool_events: response?.production_tool_events || [],
        production_cost_sheet_templates:
          response?.production_cost_sheet_templates || [],
      });
      setMessage("");
    } catch (error: any) {
      try {
        const items = await apiClient.get("/items");
        setData((current: any) => ({
          ...current,
          items: Array.isArray(items) ? items : [],
        }));
        setMessage("");
      } catch (fallbackError: any) {
        setMessage(
          fallbackError?.message ||
            error?.message ||
            "Unable to load production setup.",
        );
      }
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const routingLabel = useCallback((routing: any) => {
    const product = routing.item
      ? `${routing.item.code} — ${routing.item.name}`
      : "Product not linked";
    return `${product} / ${routing.sequence_no}. ${routing.operation_name}`;
  }, []);

  const stationMap = useMemo(
    () => new Map(data.stations.map((station: any) => [station.id, station])),
    [data.stations],
  );
  const routingMap = useMemo(
    () => new Map(data.routings.map((routing: any) => [routing.id, routing])),
    [data.routings],
  );

  const selectStation = (id: string) => {
    setStationId(id);
    const station: any = stationMap.get(id);
    setCapacity(station ? String(station.capacity_per_hour || 0) : "");
  };

  const saveMachine = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!stationId) return;
    setBusy(true);
    try {
      await apiClient.put(`/production/work-stations/${stationId}`, {
        capacityPerHour: Number(capacity),
      });
      setMessage("Machine capacity saved.");
      await load();
    } catch (error: any) {
      setMessage(error?.message || "Unable to save machine capacity.");
    } finally {
      setBusy(false);
    }
  };

  const createMachine = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      const created = await apiClient.post("/production/work-stations", {
        stationCode: newMachine.stationCode.trim().toUpperCase(),
        stationName: newMachine.stationName.trim(),
        stationType: newMachine.stationType,
        capacityPerHour: Number(newMachine.capacityPerHour),
        isActive: true,
      });
      const station = created?.data ?? created;
      setMessage(
        `Machine ${newMachine.stationCode.trim().toUpperCase()} created.`,
      );
      setNewMachine({
        stationCode: "",
        stationName: "",
        stationType: "CUTTING",
        capacityPerHour: "",
      });
      setShowNewMachine(false);
      await load();
      if (station?.id) {
        setStationId(station.id);
        setCapacity(String(station.capacity_per_hour ?? 0));
      }
    } catch (error: any) {
      setMessage(error?.message || "Unable to create machine.");
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const raw: any = Object.fromEntries(new FormData(form));
    setBusy(true);
    try {
      await apiClient.post(
        "/production-planning/configuration/process-resource-profiles",
        {
          ...raw,
          is_primary: raw.is_primary === "on",
          first_load_required: raw.first_load_required === "on",
        },
      );
      setMessage(
        "Machine/process standard saved. Future plans will use this rate and recurring downtime.",
      );
      form.reset();
      await load();
    } catch (error: any) {
      setMessage(error?.message || "Unable to save machine/process standard.");
    } finally {
      setBusy(false);
    }
  };

  const saveTool = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const raw: any = Object.fromEntries(new FormData(form));
    setBusy(true);
    try {
      await apiClient.post("/production-planning/configuration/tools", {
        ...raw,
        calibration_required: raw.calibration_required === "on",
      });
      setMessage(
        "Tooling resource saved and is now available for process assignment.",
      );
      form.reset();
      await load();
    } catch (error: any) {
      setMessage(error?.message || "Unable to save tooling resource.");
    } finally {
      setBusy(false);
    }
  };

  const selectToolRouting = (id: string) => {
    setToolRoutingId(id);
    const existing = data.production_routing_constraints.find(
      (constraint: any) => constraint.routing_id === id,
    );
    setRequiredToolCodes(existing?.required_tool_codes || []);
  };

  const saveToolRequirements = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!toolRoutingId) return;
    const existing =
      data.production_routing_constraints.find(
        (constraint: any) => constraint.routing_id === toolRoutingId,
      ) || {};
    setBusy(true);
    try {
      await apiClient.patch(
        `/production-planning/configuration/routings/${toolRoutingId}`,
        {
          required_skill_codes: existing.required_skill_codes || [],
          required_tool_codes: requiredToolCodes,
          minimum_qualified_people: existing.minimum_qualified_people || 0,
          campaign_code: existing.campaign_code || null,
          campaign_min_quantity: existing.campaign_min_quantity || null,
          campaign_max_quantity: existing.campaign_max_quantity || null,
          setup_family: existing.setup_family || null,
          preferred_resource_id: existing.preferred_resource_id || null,
        },
      );
      setMessage(
        "Required tooling saved. Planning will block or flag this process when it is unavailable.",
      );
      await load();
    } catch (error: any) {
      setMessage(error?.message || "Unable to save process tooling.");
    } finally {
      setBusy(false);
    }
  };

  const uniqueTools = useMemo(() => {
    const byCode = new Map<string, any>();
    data.production_tool_resources.forEach((tool: any) => {
      if (!byCode.has(tool.tool_code)) byCode.set(tool.tool_code, tool);
    });
    return Array.from(byCode.values());
  }, [data.production_tool_resources]);
  const toolMap = useMemo(
    () =>
      new Map(
        data.production_tool_resources.map((tool: any) => [tool.id, tool]),
      ),
    [data.production_tool_resources],
  );
  const toolInsights = useMemo(
    () =>
      data.production_tool_resources.map((tool: any) => {
        const assignments = data.production_tool_assignments.filter(
            (assignment: any) => assignment.tool_resource_id === tool.id,
          ),
          events = data.production_tool_events.filter(
            (event: any) => event.tool_resource_id === tool.id,
          ),
          planned = assignments.reduce(
            (sum: number, assignment: any) =>
              sum + Number(assignment.planned_usage_value || 0),
            0,
          ),
          actual = assignments.reduce(
            (sum: number, assignment: any) =>
              sum + Number(assignment.actual_usage_value || 0),
            0,
          ),
          good = events.reduce(
            (sum: number, event: any) => sum + Number(event.good_quantity || 0),
            0,
          ),
          rejected = events.reduce(
            (sum: number, event: any) =>
              sum + Number(event.rejected_quantity || 0),
            0,
          ),
          rejectRate =
            good + rejected ? (rejected / (good + rejected)) * 100 : 0,
          remaining =
            tool.life_limit_value == null
              ? null
              : Math.max(
                  0,
                  Number(tool.life_limit_value) -
                    Number(tool.life_used_value || 0),
                ),
          remainingPct =
            remaining == null
              ? null
              : (remaining / Number(tool.life_limit_value)) * 100,
          variancePct = planned ? ((actual - planned) / planned) * 100 : null,
          changes = assignments.filter(
            (assignment: any) => assignment.status === "CHANGED",
          ).length;
        let recommendation =
          "Collect completed-run evidence to establish a reliable baseline.";
        if (tool.status === "BLOCKED")
          recommendation = `Tool is blocked: ${tool.block_reason || "inspect or replace before scheduling"}.`;
        else if (remainingPct != null && remainingPct <= 20)
          recommendation = `Only ${remainingPct.toFixed(1)}% rated life remains; reserve a replacement and include ${tool.replacement_minutes || 0} minutes change time.`;
        else if (variancePct != null && variancePct > 10)
          recommendation = `Actual usage is ${variancePct.toFixed(1)}% above plan; inspect material, setup, machine and operator causes.`;
        else if (rejectRate > 5)
          recommendation = `Reject rate is ${rejectRate.toFixed(1)}%; check wear trend and first-piece inspection after tool changes.`;
        else if (events.length >= 3)
          recommendation =
            "Performance is within the current baseline; continue condition and wear monitoring.";
        return {
          tool,
          planned,
          actual,
          variancePct,
          runs: new Set(assignments.map((x: any) => x.station_completion_id))
            .size,
          changes,
          good,
          rejected,
          rejectRate,
          recommendation,
        };
      }),
    [
      data.production_tool_assignments,
      data.production_tool_events,
      data.production_tool_resources,
    ],
  );
  const setupReadiness = useMemo(
    () => ({
      machines: data.stations.length,
      standards: data.production_process_resource_profiles.length,
      tools: data.production_tool_resources.length,
      routedTools: data.production_routing_constraints.filter(
        (constraint: any) => (constraint.required_tool_codes || []).length > 0,
      ).length,
    }),
    [
      data.production_process_resource_profiles,
      data.production_routing_constraints,
      data.production_tool_resources,
      data.stations,
    ],
  );

  return (
    <main className="mx-auto max-w-[1500px] space-y-5 p-3 pb-28 sm:p-5 sm:pb-28">
      <header className="rounded-2xl bg-gradient-to-r from-[#4A3526] to-[#8B6844] p-6 text-white">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-amber-100">
              Administrator setup
            </p>
            <h1 className="mt-1 text-2xl font-bold">Production Setup</h1>
            <p className="mt-2 max-w-4xl text-sm text-amber-50">
              Set each machine up once. Mizantra then uses its capacity, product
              limits, roll changes and tooling availability when planning work.
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            className="rounded-lg border border-white/40 p-2"
            aria-label="Refresh production setup"
          >
            <RefreshCw className={busy ? "animate-spin" : ""} size={18} />
          </button>
        </div>
      </header>

      {message && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          {message}
        </div>
      )}

      <nav
        aria-label="Production setup progress"
        className="rounded-xl border border-[#E5D7BF] bg-white p-3 shadow-sm"
      >
        <div className="mb-3 flex items-center justify-between gap-3 px-1">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[#8B6844]">
              Guided setup
            </p>
            <p className="text-sm font-semibold text-[#3F2D20]">
              Step {activeStep + 1} of {wizardSteps.length}:{" "}
              {wizardSteps[activeStep].title}
            </p>
          </div>
          <span className="rounded-full bg-[#F7F0E5] px-3 py-1 text-xs font-bold text-[#5E4635]">
            {Math.round(((activeStep + 1) / wizardSteps.length) * 100)}%
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[#EFE5D5]">
          <div
            className="h-full rounded-full bg-[#8B6844] transition-all"
            style={{
              width: `${((activeStep + 1) / wizardSteps.length) * 100}%`,
            }}
          />
        </div>
        <ol className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
          {wizardSteps.map((step, index) => {
            const current = index === activeStep;
            const visited = index < activeStep;
            return (
              <li key={step.title}>
                <button
                  type="button"
                  onClick={() => goToStep(index)}
                  aria-current={current ? "step" : undefined}
                  className={`flex min-h-16 w-full items-start gap-2 rounded-lg border p-2 text-left transition ${
                    current
                      ? "border-[#8B6844] bg-[#FFF9EF] shadow-sm"
                      : "border-[#E5D7BF] bg-white hover:border-[#B9975B]"
                  }`}
                >
                  <span
                    className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      current || visited
                        ? "bg-[#5E3B27] text-white"
                        : "bg-[#F7F0E5] text-[#8B6844]"
                    }`}
                  >
                    {visited ? <Check size={14} /> : index + 1}
                  </span>
                  <span>
                    <span className="block text-xs font-bold text-[#3F2D20]">
                      {step.title}
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-4 text-[#7A6555]">
                      {step.detail}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {activeStep === 0 && (
        <div className="space-y-5">
          <section className="rounded-xl border border-[#E5D7BF] bg-[#FFF9EF] p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-[#8B6844]">
              Start here — four small steps
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <SetupStep
                number="1"
                title="Add machines"
                detail={`${setupReadiness.machines} machine${setupReadiness.machines === 1 ? "" : "s"} available`}
              />
              <SetupStep
                number="2"
                title="Set product rates"
                detail={`${setupReadiness.standards} machine/process standard${setupReadiness.standards === 1 ? "" : "s"}`}
              />
              <SetupStep
                number="3"
                title="Add roll-change time"
                detail="Only where wire, moulds, barrels or containers change"
              />
              <SetupStep
                number="4"
                title="Add critical tools"
                detail={`${setupReadiness.tools} tool${setupReadiness.tools === 1 ? "" : "s"}; ${setupReadiness.routedTools} process link${setupReadiness.routedTools === 1 ? "" : "s"}`}
              />
            </div>
            <p className="mt-3 text-xs text-[#7A6555]">
              You do not need to configure every advanced field before starting.
              Begin with the machines and product rates used this week; improve
              the data from actual production results.
            </p>
          </section>

          <section className="grid gap-3 md:grid-cols-3">
            <SetupLink
              title="1. Items"
              detail="Raw materials, subassemblies, finished goods, dimensions and unit weight."
              href="/dashboard/inventory/items"
            />
            <SetupLink
              title="2. BOM & routes"
              detail="Material quantity per unit and the ordered production operations."
              href="/dashboard/bom"
            />
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <Factory size={18} />
              <h2 className="mt-2 font-bold">3. Machine standards</h2>
              <p className="mt-1 text-xs leading-5">
                Configure rates, compatibility and recurring downtime below.
                These values are reused automatically.
              </p>
            </div>
          </section>
        </div>
      )}

      {activeStep === 5 && (
        <ProductionCostSheet
          items={data.items}
          templates={data.production_cost_sheet_templates}
          onSaved={load}
        />
      )}
      {activeStep === 1 && <ProductionStandardizationStudio />}

      {activeStep === 2 && (
        <section className="rounded-xl border border-[#E5D7BF] bg-white p-4">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-[#E5D7BF] pb-4">
            <div>
              <h2 className="font-bold text-[#3F2D20]">
                Machines and workstations
              </h2>
              <p className="mt-1 text-xs text-[#7A6555]">
                Create any missing machine here before defining its capacity.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowNewMachine((current) => !current)}
              className="rounded-lg border border-[#8B6F47] px-4 py-2 text-sm font-bold text-[#4A3526]"
            >
              {showNewMachine ? "Cancel new machine" : "+ Create new machine"}
            </button>
          </div>

          {showNewMachine && (
            <form
              onSubmit={createMachine}
              className="mb-5 grid gap-3 rounded-xl border border-[#D9C8AA] bg-[#FFF9ED] p-4 md:grid-cols-4"
            >
              <label className={label}>
                Machine code *
                <input
                  required
                  placeholder="e.g. CUT-01"
                  value={newMachine.stationCode}
                  onChange={(event) =>
                    setNewMachine((current) => ({
                      ...current,
                      stationCode: event.target.value,
                    }))
                  }
                  className={field}
                />
              </label>
              <label className={label}>
                Machine/workstation name *
                <input
                  required
                  placeholder="e.g. Sheet Cutting / CNC Station"
                  value={newMachine.stationName}
                  onChange={(event) =>
                    setNewMachine((current) => ({
                      ...current,
                      stationName: event.target.value,
                    }))
                  }
                  className={field}
                />
              </label>
              <label className={label}>
                Type *
                <select
                  required
                  value={newMachine.stationType}
                  onChange={(event) =>
                    setNewMachine((current) => ({
                      ...current,
                      stationType: event.target.value,
                    }))
                  }
                  className={field}
                >
                  <option value="CUTTING">Cutting</option>
                  <option value="FORMING">Forming</option>
                  <option value="MACHINING">Machining</option>
                  <option value="ASSEMBLY">Assembly</option>
                  <option value="INSULATION">Insulation</option>
                  <option value="QUALITY">Quality inspection</option>
                  <option value="PACKAGING">Packing</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>
              <label className={label}>
                Capacity per hour *
                <input
                  required
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  placeholder="e.g. 20"
                  value={newMachine.capacityPerHour}
                  onChange={(event) =>
                    setNewMachine((current) => ({
                      ...current,
                      capacityPerHour: event.target.value,
                    }))
                  }
                  className={field}
                />
              </label>
              <button
                disabled={busy}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#4A3526] px-4 text-sm font-bold text-white disabled:opacity-50 md:col-start-4"
              >
                <Save size={16} /> Create machine
              </button>
            </form>
          )}
          <h2 className="font-bold text-[#3F2D20]">
            Update an existing machine
          </h2>
          <p className="mt-1 text-xs text-[#7A6555]">
            This is a broad fallback rate. The product-specific rate—which MRP
            uses for a realistic schedule—is set in “Product, process &amp;
            machine standard” below.
          </p>
          <form
            onSubmit={saveMachine}
            className="mt-4 grid gap-3 md:grid-cols-3"
          >
            <label className={label}>
              Choose machine *
              <select
                required
                value={stationId}
                onChange={(event) => selectStation(event.target.value)}
                className={field}
              >
                <option value="">Select machine</option>
                {data.stations.map((station: any) => (
                  <option key={station.id} value={station.id}>
                    {station.station_code} — {station.station_name}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              Fallback capacity per hour *
              <input
                required
                type="number"
                min="0.0001"
                step="0.0001"
                value={capacity}
                onChange={(event) => setCapacity(event.target.value)}
                className={field}
              />
            </label>
            <button
              disabled={busy || !stationId}
              className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#4A3526] px-4 text-sm font-bold text-white disabled:opacity-50"
            >
              <Save size={16} /> Save machine
            </button>
          </form>
        </section>
      )}

      {activeStep === 3 && (
        <div className="space-y-5">
          <section className="rounded-xl border border-[#E5D7BF] bg-white p-4">
            <h2 className="font-bold text-[#3F2D20]">
              Tool, die, punch &amp; mould master
            </h2>
            <p className="mt-1 text-xs text-[#7A6555]">
              Register each physical production aid and its usable quantity.
              Life and calibration controls prevent an expired, exhausted or
              unavailable tool from being silently assumed in the plan.
            </p>
            <form
              onSubmit={saveTool}
              className="mt-4 grid gap-3 md:grid-cols-4"
            >
              <label className={label}>
                Tool code *
                <input
                  required
                  name="tool_code"
                  placeholder="e.g. PUNCH-M6"
                  className={field}
                />
              </label>
              <label className={label}>
                Tool name *
                <input
                  required
                  name="tool_name"
                  placeholder="e.g. M6 header punch"
                  className={field}
                />
              </label>
              <label className={label}>
                Type *
                <select
                  name="resource_type"
                  className={field}
                  defaultValue="PUNCH"
                >
                  <option value="PUNCH">Punch</option>
                  <option value="DIE">Die</option>
                  <option value="MOULD">Mould</option>
                  <option value="JIG">Jig</option>
                  <option value="FIXTURE">Fixture / plating rack</option>
                  <option value="GAUGE">Gauge</option>
                  <option value="TOOL">Other tool</option>
                </select>
              </label>
              <label className={label}>
                Assigned machine
                <select name="work_station_id" className={field}>
                  <option value="">Shared / not machine-specific</option>
                  {data.stations.map((station: any) => (
                    <option key={station.id} value={station.id}>
                      {station.station_code} — {station.station_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Available quantity *
                <input
                  required
                  name="available_quantity"
                  type="number"
                  min="0"
                  step="1"
                  defaultValue="1"
                  className={field}
                />
              </label>
              <label className={label}>
                Status *
                <select
                  name="status"
                  className={field}
                  defaultValue="AVAILABLE"
                >
                  <option value="AVAILABLE">Available</option>
                  <option value="IN_USE">In use</option>
                  <option value="MAINTENANCE">Under maintenance</option>
                  <option value="BLOCKED">Blocked</option>
                </select>
              </label>
              <label className={label}>
                Life measured by *
                <select
                  name="life_basis"
                  className={field}
                  defaultValue="STROKES"
                >
                  <option value="KG_INPUT">Kilograms of input material</option>
                  <option value="GOOD_PIECES">Good pieces produced</option>
                  <option value="TOTAL_PIECES">Total pieces processed</option>
                  <option value="STROKES">Machine strokes / shots</option>
                  <option value="RUN_HOURS">Operating hours</option>
                  <option value="BATCHES">Production batches</option>
                </select>
              </label>
              <label className={label}>
                Rated life
                <input
                  name="life_limit_value"
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  placeholder="e.g. 200"
                  className={field}
                />
              </label>
              <label className={label}>
                Opening life already used
                <input
                  name="life_used_value"
                  type="number"
                  min="0"
                  step="0.0001"
                  defaultValue="0"
                  className={field}
                />
              </label>
              <label className={label}>
                Replacement downtime (minutes)
                <input
                  name="replacement_minutes"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue="0"
                  className={field}
                />
              </label>
              <label className={label}>
                Maximum refurbishments
                <input
                  name="refurbishment_limit"
                  type="number"
                  min="0"
                  step="1"
                  defaultValue="0"
                  className={field}
                />
              </label>
              <label className={label}>
                Serial / identification number
                <input
                  name="serial_number"
                  placeholder="Optional"
                  className={field}
                />
              </label>
              <label className={label}>
                Valid until
                <input name="valid_until" type="date" className={field} />
              </label>
              <label className={`${label} flex items-center gap-2 pt-6`}>
                <input name="calibration_required" type="checkbox" />{" "}
                Calibration required
              </label>
              <label className={label}>
                Next calibration due
                <input
                  name="next_calibration_due"
                  type="date"
                  className={field}
                />
              </label>
              <button
                disabled={busy}
                className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#4A3526] px-4 text-sm font-bold text-white disabled:opacity-50"
              >
                <Save size={16} /> Save tool
              </button>
            </form>
          </section>

          <section className="rounded-xl border border-[#E5D7BF] bg-white p-4">
            <h2 className="font-bold text-[#3F2D20]">
              Required tooling by process
            </h2>
            <p className="mt-1 text-xs text-[#7A6555]">
              Select the punches, header dies, threading dies, moulds, gauges or
              plating fixtures that must be ready before this operation can be
              planned.
            </p>
            <form onSubmit={saveToolRequirements} className="mt-4 space-y-4">
              <label className={label}>
                Product and process *
                <select
                  required
                  value={toolRoutingId}
                  onChange={(event) => selectToolRouting(event.target.value)}
                  className={field}
                >
                  <option value="">Select product process</option>
                  {data.routings.map((routing: any) => (
                    <option key={routing.id} value={routing.id}>
                      {routingLabel(routing)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {uniqueTools.map((tool: any) => {
                  const checked = requiredToolCodes.includes(tool.tool_code);
                  return (
                    <label
                      key={tool.tool_code}
                      className="flex items-start gap-2 rounded-lg border border-[#E5D7BF] p-3 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setRequiredToolCodes((current) =>
                            checked
                              ? current.filter(
                                  (code) => code !== tool.tool_code,
                                )
                              : [...current, tool.tool_code],
                          )
                        }
                      />
                      <span>
                        <strong>{tool.tool_code}</strong>
                        <br />
                        <span className="text-xs text-[#7A6555]">
                          {tool.tool_name} · {tool.resource_type}
                        </span>
                      </span>
                    </label>
                  );
                })}
                {!uniqueTools.length && (
                  <p className="text-sm text-slate-500">
                    Create a tooling resource above first.
                  </p>
                )}
              </div>
              <button
                disabled={busy || !toolRoutingId}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#4A3526] px-4 text-sm font-bold text-white disabled:opacity-50"
              >
                <Save size={16} /> Save process tooling
              </button>
            </form>
          </section>

          <section className="rounded-xl border border-[#E5D7BF] bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-bold text-[#3F2D20]">
                  Tooling availability register
                </h2>
                <p className="mt-1 text-xs text-[#7A6555]">
                  Current quantity, life and readiness used by production
                  planning.
                </p>
              </div>
              <Link
                href="/dashboard/bom"
                className="rounded-lg border border-[#D9C8AA] px-3 py-2 text-xs font-bold text-[#4A3526]"
              >
                Maintain plating chemicals in BOM
              </Link>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b text-left text-xs uppercase text-[#7A6555]">
                  <tr>
                    <th className="p-2">Code / type</th>
                    <th className="p-2">Description</th>
                    <th className="p-2">Machine</th>
                    <th className="p-2">Available</th>
                    <th className="p-2">Life remaining</th>
                    <th className="p-2">Readiness</th>
                  </tr>
                </thead>
                <tbody>
                  {data.production_tool_resources.map((tool: any) => {
                    const remaining =
                      tool.life_limit_value == null
                        ? null
                        : Math.max(
                            0,
                            Number(tool.life_limit_value) -
                              Number(tool.life_used_value || 0),
                          );
                    const station: any = stationMap.get(tool.work_station_id);
                    return (
                      <tr key={tool.id} className="border-b align-top">
                        <td className="p-2 font-semibold">
                          {tool.tool_code}
                          <br />
                          <span className="text-xs font-normal text-[#7A6555]">
                            {tool.resource_type}
                          </span>
                        </td>
                        <td className="p-2">{tool.tool_name}</td>
                        <td className="p-2">
                          {station?.station_code || "Shared"}
                        </td>
                        <td className="p-2">{tool.available_quantity}</td>
                        <td className="p-2">
                          {remaining == null
                            ? "Not specified"
                            : `${remaining} ${tool.life_uom || "units"}`}
                          <br />
                          <span className="text-xs text-[#7A6555]">
                            Basis:{" "}
                            {String(tool.life_basis || "STROKES")
                              .replaceAll("_", " ")
                              .toLowerCase()}
                          </span>
                        </td>
                        <td className="p-2">
                          {tool.status}
                          {tool.calibration_required
                            ? ` · Calibration ${tool.calibration_status}`
                            : ""}
                        </td>
                      </tr>
                    );
                  })}
                  {!data.production_tool_resources.length && (
                    <tr>
                      <td
                        colSpan={6}
                        className="p-5 text-center text-slate-500"
                      >
                        No tooling resources configured yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              <strong>
                Plating chemicals are consumable materials, not tools.
              </strong>{" "}
              Add each chemical to the plating BOM with quantity per kg or
              batch, lead time, minimum stock and supplier. MRP will then
              time-phase its purchase; barrels, racks, anodes, jigs and gauges
              belong in this tooling register.
            </div>
          </section>

          <section className="rounded-xl border border-[#E5D7BF] bg-white p-4">
            <h2 className="font-bold text-[#3F2D20]">
              Actual tooling evidence
            </h2>
            <p className="mt-1 text-xs text-[#7A6555]">
              Automatically written when shop-floor operations finish or an
              operator changes a tool. This is the history used for life
              prediction and corrective recommendations.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b text-left text-xs uppercase text-[#7A6555]">
                  <tr>
                    <th className="p-2">Date / tool</th>
                    <th className="p-2">Machine / process</th>
                    <th className="p-2">Actual life used</th>
                    <th className="p-2">Input</th>
                    <th className="p-2">Good / rejected</th>
                    <th className="p-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.production_tool_events]
                    .sort((a: any, b: any) =>
                      String(b.created_at).localeCompare(String(a.created_at)),
                    )
                    .slice(0, 50)
                    .map((event: any) => {
                      const tool: any = toolMap.get(event.tool_resource_id);
                      const station: any = stationMap.get(
                        event.work_station_id,
                      );
                      const routing: any = routingMap.get(event.routing_id);
                      return (
                        <tr key={event.id} className="border-b align-top">
                          <td className="p-2">
                            {event.event_date}
                            <br />
                            <strong>{tool?.tool_code || "Unknown tool"}</strong>
                          </td>
                          <td className="p-2">
                            {station?.station_code || "—"}
                            <br />
                            <span className="text-xs text-[#7A6555]">
                              {routing?.operation_name || "—"}
                            </span>
                          </td>
                          <td className="p-2">
                            {event.life_usage_value ??
                              event.cycle_quantity ??
                              0}{" "}
                            {event.life_uom || "cycles"}
                          </td>
                          <td className="p-2">
                            {event.actual_input_quantity == null
                              ? "—"
                              : `${event.actual_input_quantity} ${event.actual_input_uom || ""}`}
                          </td>
                          <td className="p-2">
                            {event.good_quantity ?? "—"} /{" "}
                            {event.rejected_quantity ?? "—"}
                          </td>
                          <td className="p-2">
                            {event.change_reason || "Operation completion"}
                          </td>
                        </tr>
                      );
                    })}
                  {!data.production_tool_events.length && (
                    <tr>
                      <td
                        colSpan={6}
                        className="p-5 text-center text-slate-500"
                      >
                        No shop-floor tooling usage has been recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-[#E5D7BF] bg-white p-4">
            <h2 className="font-bold text-[#3F2D20]">
              Tooling intelligence &amp; corrective action
            </h2>
            <p className="mt-1 text-xs text-[#7A6555]">
              Compares planned and actual life consumption for each physical
              serial or pooled tool and correlates it with production and
              rejection evidence.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b text-left text-xs uppercase text-[#7A6555]">
                  <tr>
                    <th className="p-2">Tool / serial</th>
                    <th className="p-2">Runs / changes</th>
                    <th className="p-2">Planned / actual</th>
                    <th className="p-2">Variance</th>
                    <th className="p-2">Good / rejected</th>
                    <th className="p-2">Recommendation</th>
                  </tr>
                </thead>
                <tbody>
                  {toolInsights.map((insight: any) => (
                    <tr key={insight.tool.id} className="border-b align-top">
                      <td className="p-2">
                        <strong>{insight.tool.tool_code}</strong>
                        <br />
                        <span className="text-xs text-[#7A6555]">
                          {insight.tool.serial_number || "Pooled quantity"}
                        </span>
                      </td>
                      <td className="p-2">
                        {insight.runs} / {insight.changes}
                      </td>
                      <td className="p-2">
                        {insight.planned.toFixed(2)} /{" "}
                        {insight.actual.toFixed(2)} {insight.tool.life_uom}
                      </td>
                      <td className="p-2">
                        {insight.variancePct == null
                          ? "Not enough data"
                          : `${insight.variancePct >= 0 ? "+" : ""}${insight.variancePct.toFixed(1)}%`}
                      </td>
                      <td className="p-2">
                        {insight.good} / {insight.rejected}
                        <br />
                        <span className="text-xs text-[#7A6555]">
                          {insight.rejectRate.toFixed(1)}% rejected
                        </span>
                      </td>
                      <td className="p-2 max-w-md">{insight.recommendation}</td>
                    </tr>
                  ))}
                  {!toolInsights.length && (
                    <tr>
                      <td
                        colSpan={6}
                        className="p-5 text-center text-slate-500"
                      >
                        Configure tooling to begin collecting intelligence.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {activeStep === 4 && (
        <div className="space-y-5">
          <section className="rounded-xl border border-[#E5D7BF] bg-white p-4">
            <h2 className="font-bold text-[#3F2D20]">
              Product, process &amp; machine standard
            </h2>
            <p className="mt-1 text-xs text-[#7A6555]">
              Select an existing product operation and define how a particular
              machine performs it. Saving the same process and machine updates
              the existing standard.
            </p>
            <form
              onSubmit={saveProfile}
              className="mt-4 grid gap-3 md:grid-cols-4"
            >
              <label className={`${label} md:col-span-2`}>
                Product and process *
                <select required name="routing_id" className={field}>
                  <option value="">Select product process</option>
                  {data.routings.map((routing: any) => (
                    <option key={routing.id} value={routing.id}>
                      {routingLabel(routing)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={`${label} md:col-span-2`}>
                Eligible machine *
                <select required name="work_station_id" className={field}>
                  <option value="">Select machine</option>
                  {data.stations.map((station: any) => (
                    <option key={station.id} value={station.id}>
                      {station.station_code} — {station.station_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Production rate *
                <input
                  required
                  name="rate_value"
                  type="number"
                  min="0.000001"
                  step="0.000001"
                  placeholder="e.g. 60"
                  className={field}
                />
              </label>
              <label className={label}>
                Rate unit *
                <select required name="rate_unit" className={field}>
                  <option value="PCS_PER_MINUTE">Pieces per minute</option>
                  <option value="PCS_PER_HOUR">Pieces per hour</option>
                  <option value="SHOTS_PER_MINUTE">Shots per minute</option>
                  <option value="KG_PER_HOUR">Kilograms per hour</option>
                </select>
              </label>
              <label className={label}>
                Cavities per shot
                <input
                  name="cavities"
                  type="number"
                  min="1"
                  step="1"
                  defaultValue="1"
                  className={field}
                />
              </label>
              <label className={label}>
                Expected efficiency (%)
                <input
                  name="efficiency_percent"
                  type="number"
                  min="1"
                  max="150"
                  step="0.01"
                  defaultValue="100"
                  className={field}
                />
              </label>
              <label className={label}>
                Minimum product length (mm)
                <input
                  name="minimum_length_mm"
                  type="number"
                  min="0"
                  step="0.001"
                  className={field}
                />
              </label>
              <label className={label}>
                Maximum product length (mm)
                <input
                  name="maximum_length_mm"
                  type="number"
                  min="0"
                  step="0.001"
                  className={field}
                />
              </label>
              <label className={label}>
                Maximum input diameter (mm)
                <input
                  name="maximum_material_diameter_mm"
                  type="number"
                  min="0"
                  step="0.001"
                  className={field}
                />
              </label>
              <label className={label}>
                Priority
                <input
                  name="priority"
                  type="number"
                  min="1"
                  step="1"
                  defaultValue="100"
                  className={field}
                />
              </label>

              <div className="md:col-span-4 mt-2 border-t border-[#E8DCC4] pt-4">
                <h3 className="text-sm font-bold text-[#3F2D20]">
                  Recurring material or container change
                </h3>
                <p className="text-xs text-[#7A6555]">
                  Leave these fields blank when this process has no roll,
                  barrel, container or similar recurring change.
                </p>
              </div>
              <label className={label}>
                Input material
                <select name="input_item_id" className={field}>
                  <option value="">Not applicable</option>
                  {data.items.map((item: any) => (
                    <option key={item.id} value={item.id}>
                      {item.code} — {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Roll/container quantity
                <input
                  name="container_quantity"
                  type="number"
                  min="0.000001"
                  step="0.000001"
                  placeholder="e.g. 60"
                  className={field}
                />
              </label>
              <label className={label}>
                Container unit
                <select
                  name="container_uom"
                  defaultValue="KG"
                  className={field}
                >
                  <option value="KG">kg</option>
                  <option value="G">grams</option>
                </select>
              </label>
              <label className={label}>
                Change time (minutes)
                <input
                  name="recurring_change_minutes"
                  type="number"
                  min="0"
                  step="0.001"
                  placeholder="e.g. 20"
                  className={field}
                />
              </label>
              <label className={label}>
                Consumption per finished unit
                <input
                  name="consumption_per_unit"
                  type="number"
                  min="0.000000001"
                  step="0.000000001"
                  placeholder="e.g. 8"
                  className={field}
                />
              </label>
              <label className={label}>
                Consumption unit
                <select
                  name="consumption_uom"
                  defaultValue="G"
                  className={field}
                >
                  <option value="G">grams</option>
                  <option value="KG">kg</option>
                </select>
              </label>
              <label className={`${label} flex items-center gap-2 pt-6`}>
                <input name="first_load_required" type="checkbox" />
                Count initial loading as downtime
              </label>
              <label className={`${label} flex items-center gap-2 pt-6`}>
                <input name="is_primary" type="checkbox" /> Primary machine
              </label>
              <label className={`${label} md:col-span-3`}>
                Notes
                <input
                  name="notes"
                  placeholder="Optional operating notes"
                  className={field}
                />
              </label>
              <button
                disabled={busy}
                className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#4A3526] px-4 text-sm font-bold text-white disabled:opacity-50"
              >
                <Save size={16} /> Save standard
              </button>
            </form>
          </section>

          <section className="rounded-xl border border-[#E5D7BF] bg-white p-4">
            <h2 className="font-bold text-[#3F2D20]">Configured standards</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b text-left text-xs uppercase text-[#7A6555]">
                  <tr>
                    <th className="p-2">Product / process</th>
                    <th className="p-2">Machine</th>
                    <th className="p-2">Rate</th>
                    <th className="p-2">Compatibility</th>
                    <th className="p-2">Recurring downtime</th>
                  </tr>
                </thead>
                <tbody>
                  {data.production_process_resource_profiles.map(
                    (profile: any) => {
                      const routing: any = routingMap.get(profile.routing_id);
                      const station: any = stationMap.get(
                        profile.work_station_id,
                      );
                      return (
                        <tr key={profile.id} className="border-b align-top">
                          <td className="p-2">
                            {routing
                              ? routingLabel(routing)
                              : "Unknown process"}
                          </td>
                          <td className="p-2">
                            {station?.station_code || "Unknown"}
                            {profile.is_primary ? " · Primary" : ""}
                          </td>
                          <td className="p-2">
                            {profile.rate_value}{" "}
                            {String(profile.rate_unit)
                              .replaceAll("_", " ")
                              .toLowerCase()}
                            {profile.rate_unit === "SHOTS_PER_MINUTE"
                              ? ` × ${profile.cavities} cavities`
                              : ""}
                          </td>
                          <td className="p-2">
                            {profile.minimum_length_mm ?? "—"}–
                            {profile.maximum_length_mm ?? "—"} mm
                            <br />
                            Diameter ≤{" "}
                            {profile.maximum_material_diameter_mm ?? "—"} mm
                          </td>
                          <td className="p-2">
                            {profile.recurring_change_minutes
                              ? `${profile.container_quantity} ${profile.container_uom} → ${profile.recurring_change_minutes} min`
                              : "Not configured"}
                          </td>
                        </tr>
                      );
                    },
                  )}
                  {!data.production_process_resource_profiles.length && (
                    <tr>
                      <td
                        colSpan={5}
                        className="p-5 text-center text-slate-500"
                      >
                        No machine/process standards configured yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {activeStep === 6 && (
        <section className="rounded-xl border border-[#E5D7BF] bg-white p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-[#8B6844]">
            Review and continue
          </p>
          <h2 className="mt-1 text-xl font-bold text-[#3F2D20]">
            Production setup readiness
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-[#7A6555]">
            Saved records are already available to planning. Review the
            essentials below before using the model for a live job order.
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <ReviewItem
              ready={data.items.length > 0}
              title="Items"
              detail={`${data.items.length} raw material, subassembly or finished item records available`}
              href="/dashboard/inventory/items"
            />
            <ReviewItem
              ready={data.routings.length > 0}
              title="BOM and routing"
              detail={`${data.routings.length} production operation${data.routings.length === 1 ? "" : "s"} available`}
              href="/dashboard/bom"
            />
            <ReviewItem
              ready={setupReadiness.machines > 0}
              title="Machines"
              detail={`${setupReadiness.machines} machine${setupReadiness.machines === 1 ? "" : "s"} configured`}
              onEdit={() => goToStep(2)}
            />
            <ReviewItem
              ready={setupReadiness.standards > 0}
              title="Product-specific standards"
              detail={`${setupReadiness.standards} rate and compatibility standard${setupReadiness.standards === 1 ? "" : "s"} configured`}
              onEdit={() => goToStep(4)}
            />
            <ReviewItem
              ready={setupReadiness.tools > 0}
              optional
              title="Critical tooling"
              detail={`${setupReadiness.tools} tool${setupReadiness.tools === 1 ? "" : "s"}; ${setupReadiness.routedTools} linked process${setupReadiness.routedTools === 1 ? "" : "es"}`}
              onEdit={() => goToStep(3)}
            />
            <ReviewItem
              ready={data.production_cost_sheet_templates.length > 0}
              optional
              title="Production costing"
              detail={`${data.production_cost_sheet_templates.length} reusable cost sheet${data.production_cost_sheet_templates.length === 1 ? "" : "s"} saved`}
              onEdit={() => goToStep(5)}
            />
          </div>
          <div className="mt-5 flex flex-wrap gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex-1">
              <h3 className="font-bold text-emerald-950">
                Ready for the daily workflow?
              </h3>
              <p className="mt-1 text-xs leading-5 text-emerald-800">
                Create a job order only after the finished item, approved BOM
                and required production operations have been checked.
              </p>
            </div>
            <Link
              href="/dashboard/production/job-orders/smart-items"
              className="inline-flex items-center justify-center rounded-lg bg-[#4A3526] px-4 py-2 text-sm font-bold text-white"
            >
              Go to job orders
            </Link>
          </div>
        </section>
      )}

      <footer className="fixed bottom-5 left-1/2 z-[60] flex w-[min(720px,calc(100vw-1.5rem))] -translate-x-1/2 items-center justify-between gap-3 rounded-xl border border-[#D9C8AA] bg-white/95 p-3 shadow-2xl backdrop-blur lg:left-[calc(50%+145px)]">
        <button
          type="button"
          onClick={() => goToStep(activeStep - 1)}
          disabled={activeStep === 0}
          className="inline-flex items-center gap-2 rounded-lg border border-[#D9C8AA] px-4 py-2 text-sm font-bold text-[#4A3526] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft size={16} /> Back
        </button>
        <p className="hidden text-center text-xs font-semibold text-[#7A6555] sm:block">
          Step {activeStep + 1} of {wizardSteps.length}
        </p>
        {activeStep < wizardSteps.length - 1 ? (
          <button
            type="button"
            onClick={() => goToStep(activeStep + 1)}
            className="inline-flex items-center gap-2 rounded-lg bg-[#4A3526] px-4 py-2 text-sm font-bold text-white"
          >
            Next: {wizardSteps[activeStep + 1].title} <ChevronRight size={16} />
          </button>
        ) : (
          <Link
            href="/dashboard/production"
            className="inline-flex items-center gap-2 rounded-lg bg-[#4A3526] px-4 py-2 text-sm font-bold text-white"
          >
            Finish setup <Check size={16} />
          </Link>
        )}
      </footer>
    </main>
  );
}

function SetupLink({
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
      className="rounded-xl border border-[#E5D7BF] bg-white p-4 text-sm hover:border-[#A9824A] hover:shadow-sm"
    >
      <h2 className="font-bold text-[#3F2D20]">{title}</h2>
      <p className="mt-1 text-xs leading-5 text-[#7A6555]">{detail}</p>
    </Link>
  );
}

function SetupStep({
  number,
  title,
  detail,
}: {
  number: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-[#E5D7BF] bg-white p-3">
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#4A3526] text-xs font-bold text-white">
        {number}
      </span>
      <h2 className="mt-2 text-sm font-bold text-[#3F2D20]">{title}</h2>
      <p className="mt-1 text-xs leading-5 text-[#7A6555]">{detail}</p>
    </div>
  );
}

function ReviewItem({
  ready,
  optional = false,
  title,
  detail,
  href,
  onEdit,
}: {
  ready: boolean;
  optional?: boolean;
  title: string;
  detail: string;
  href?: string;
  onEdit?: () => void;
}) {
  const content = (
    <>
      <span
        className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          ready
            ? "bg-emerald-100 text-emerald-700"
            : optional
              ? "bg-slate-100 text-slate-500"
              : "bg-amber-100 text-amber-700"
        }`}
      >
        {ready ? <Check size={16} /> : <Circle size={14} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <strong className="text-sm text-[#3F2D20]">{title}</strong>
          {optional && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-500">
              Optional
            </span>
          )}
        </span>
        <span className="mt-1 block text-xs leading-5 text-[#7A6555]">
          {detail}
        </span>
      </span>
      <span className="text-xs font-bold text-[#8B6844]">Review</span>
    </>
  );

  const classes =
    "flex w-full items-start gap-3 rounded-lg border border-[#E5D7BF] p-4 text-left hover:border-[#B9975B] hover:bg-[#FFF9EF]";
  if (href) {
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onEdit} className={classes}>
      {content}
    </button>
  );
}
