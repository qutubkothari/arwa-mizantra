"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Save, Settings2 } from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";

const field =
  "w-full rounded-lg border border-[#D9C8AA] bg-white px-3 py-2 text-sm";
const split = (v: any) =>
  String(v || "")
    .split(/[,;\n]/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
const label = (e: any) =>
  [
    e.employee_code || e.employee_id,
    e.name ||
      e.full_name ||
      [e.first_name, e.last_name].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(" — ") ||
  e.email ||
  e.id;

export default function PlanningConfigurationPage() {
  const [data, setData] = useState<any>({
      items: [],
      stations: [],
      routings: [],
      employees: [],
    }),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [policyItemId, setPolicyItemId] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await apiClient.get("/production-planning/configuration"));
      setMessage("");
    } catch (e: any) {
      setMessage(e?.message || "Unable to load planning configuration.");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const post = async (
    path: string,
    form: HTMLFormElement,
    transform: (x: any) => any = (x) => x,
  ) => {
    setBusy(true);
    try {
      const raw: any = Object.fromEntries(new FormData(form));
      await apiClient.post(path, transform(raw));
      setMessage(
        "Configuration saved. New planning runs will use this control.",
      );
      form.reset();
      await load();
    } catch (e: any) {
      setMessage(e?.message || "Unable to save configuration.");
    } finally {
      setBusy(false);
    }
  };
  const patch = async (
    path: string,
    form: HTMLFormElement,
    transform: (x: any) => any = (x) => x,
  ) => {
    setBusy(true);
    try {
      const raw: any = Object.fromEntries(new FormData(form));
      await apiClient.patch(path, transform(raw));
      setMessage(
        "Configuration saved. Existing approved plans will be marked stale until replanned.",
      );
      await load();
    } catch (e: any) {
      setMessage(e?.message || "Unable to save configuration.");
    } finally {
      setBusy(false);
    }
  };
  const policyMap = useMemo(
    () =>
      new Map(
        (data.production_item_planning_policies || []).map((x: any) => [
          x.item_id,
          x,
        ]),
      ),
    [data],
  );
  const selectedPolicy: any = policyMap.get(policyItemId) || {};
  useEffect(() => {
    if (!policyItemId && data.items.length) {
      setPolicyItemId(String(data.items[0].id));
    }
  }, [data.items, policyItemId]);
  return (
    <main className="mx-auto max-w-[1500px] space-y-5 p-3 sm:p-5">
      <header className="rounded-2xl bg-gradient-to-r from-[#4A3526] to-[#8B6844] p-6 text-white">
        <div className="flex justify-between gap-3">
          <div>
            <p className="text-sm text-amber-100">
              2026 governed planning masters
            </p>
            <h1 className="mt-1 text-2xl font-bold">MRP & APS Configuration</h1>
            <p className="mt-2 max-w-4xl text-sm text-amber-50">
              Control purchase quantities, shelf-life risk, safety stock,
              skills, tooling, campaigns, alternate machines and changeovers
              without bypassing approvals.
            </p>
          </div>
          <button
            onClick={load}
            className="h-fit rounded border border-white/40 p-2"
            aria-label="Refresh"
          >
            <RefreshCw className={busy ? "animate-spin" : ""} />
          </button>
        </div>
      </header>
      {message && (
        <div className="rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          {message}
        </div>
      )}
      <Card
        title="Item planning policy"
        note="MOQ, order multiples and pack size prevent impossible supplier quantities; maximum stock and shelf life protect cash."
      >
        <form
          key={policyItemId || "new-item-policy"}
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const f = e.currentTarget,
              id = String(new FormData(f).get("item_id") || "");
            patch(`/production-planning/configuration/items/${id}`, f, (x) => ({
              ...x,
              alternate_item_ids: split(x.alternate_item_ids),
              substitution_approval_required: true,
            }));
          }}
          className="grid gap-3 md:grid-cols-4"
        >
          <select
            required
            name="item_id"
            className={field}
            value={policyItemId}
            onChange={(event) => setPolicyItemId(event.target.value)}
          >
            <option value="">Item</option>
            {data.items.map((x: any) => (
              <option key={x.id} value={x.id}>
                {x.code} — {x.name} ({x.uom})
              </option>
            ))}
          </select>
          <select
            name="procurement_type"
            className={field}
            defaultValue={selectedPolicy.procurement_type || "AUTO"}
          >
            <option>AUTO</option>
            <option>BUY</option>
            <option>MAKE</option>
            <option>TRANSFER</option>
          </select>
          {[
            ["minimum_order_quantity", "MOQ"],
            ["order_multiple", "Order multiple"],
            ["pack_size", "Pack size"],
            ["minimum_stock", "Minimum stock"],
            ["maximum_stock", "Maximum stock"],
            ["shelf_life_days", "Shelf life days"],
            ["minimum_remaining_shelf_life_days", "Min remaining shelf life"],
          ].map(([n, p]) => (
            <input
              key={n}
              name={n}
              type="number"
              min="0"
              step="0.0001"
              placeholder={p}
              className={field}
              defaultValue={selectedPolicy[n] ?? ""}
            />
          ))}
          <select
            name="batch_constraint"
            className={field}
            defaultValue={selectedPolicy.batch_constraint || "NONE"}
          >
            <option>NONE</option>
            <option>FIFO</option>
            <option>FEFO</option>
            <option>SINGLE_BATCH</option>
          </select>
          <select
            name="safety_stock_method"
            className={field}
            defaultValue={selectedPolicy.safety_stock_method || "PERCENT"}
          >
            <option>PERCENT</option>
            <option>FIXED</option>
            <option>SERVICE_LEVEL</option>
          </select>
          <input
            name="safety_stock_value"
            type="number"
            min="0"
            step="0.01"
            placeholder="Safety quantity, percentage or service target"
            className={field}
            defaultValue={selectedPolicy.safety_stock_value ?? ""}
          />
          <AlternateItemPicker
            items={data.items}
            currentItemId={policyItemId}
            initialSelected={selectedPolicy.alternate_item_ids || []}
          />
          <Submit busy={busy} />
        </form>
        <p className="mt-3 text-xs text-slate-500">
          {policyMap.size} item policies configured.
        </p>
      </Card>
      <Card
        title="Routing constraint"
        note="Tie each operation to qualified labour, approved tools, campaign sizes and a preferred resource."
      >
        <form
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const f = e.currentTarget,
              id = String(new FormData(f).get("routing_id") || "");
            patch(
              `/production-planning/configuration/routings/${id}`,
              f,
              (x) => ({
                ...x,
                required_skill_codes: split(x.required_skill_codes),
                required_tool_codes: split(x.required_tool_codes),
              }),
            );
          }}
          className="grid gap-3 md:grid-cols-4"
        >
          <RoutingSelect data={data} name="routing_id" />
          <input
            name="required_skill_codes"
            placeholder="Skills: CNC, QC"
            className={field}
          />
          <input
            name="required_tool_codes"
            placeholder="Tools: JIG-01, GAUGE-02"
            className={field}
          />
          <input
            name="minimum_qualified_people"
            type="number"
            min="0"
            placeholder="Minimum qualified people"
            className={field}
          />
          <input
            name="campaign_code"
            placeholder="Campaign code"
            className={field}
          />
          <input
            name="campaign_min_quantity"
            type="number"
            min="0"
            placeholder="Campaign minimum"
            className={field}
          />
          <input
            name="campaign_max_quantity"
            type="number"
            min="0"
            placeholder="Campaign maximum"
            className={field}
          />
          <input
            name="setup_family"
            placeholder="Setup family"
            className={field}
          />
          <select name="preferred_resource_id" className={field}>
            <option value="">No preferred station</option>
            {data.stations.map((x: any) => (
              <option key={x.id} value={x.id}>
                {x.station_code} — {x.station_name}
              </option>
            ))}
          </select>
          <Submit busy={busy} />
        </form>
      </Card>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Alternate machine/resource">
          <form
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              post(
                "/production-planning/configuration/resource-alternatives",
                e.currentTarget,
              );
            }}
            className="grid gap-3 sm:grid-cols-2"
          >
            <RoutingSelect data={data} name="routing_id" />
            <StationSelect data={data} />
            <input
              name="priority"
              type="number"
              min="1"
              defaultValue="100"
              placeholder="Priority"
              className={field}
            />
            <input
              name="efficiency_percent"
              type="number"
              min="1"
              defaultValue="100"
              placeholder="Efficiency %"
              className={field}
            />
            <input
              name="additional_setup_minutes"
              type="number"
              min="0"
              placeholder="Extra setup minutes"
              className={field}
            />
            <input
              name="cost_per_hour"
              type="number"
              min="0"
              placeholder="Cost / hour"
              className={field}
            />
            <Submit busy={busy} />
          </form>
        </Card>
        <Card title="Changeover matrix">
          <form
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              post(
                "/production-planning/configuration/changeovers",
                e.currentTarget,
              );
            }}
            className="grid gap-3 sm:grid-cols-2"
          >
            <StationSelect data={data} />
            <input
              required
              name="from_setup_family"
              placeholder="From setup family"
              className={field}
            />
            <input
              required
              name="to_setup_family"
              placeholder="To setup family"
              className={field}
            />
            <input
              name="changeover_minutes"
              type="number"
              min="0"
              placeholder="Changeover minutes"
              className={field}
            />
            <input
              name="changeover_cost"
              type="number"
              min="0"
              placeholder="Changeover cost"
              className={field}
            />
            <Submit busy={busy} />
          </form>
        </Card>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Tool availability">
          <form
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              post("/production-planning/configuration/tools", e.currentTarget);
            }}
            className="grid gap-3 sm:grid-cols-2"
          >
            <input
              required
              name="tool_code"
              placeholder="Tool code"
              className={field}
            />
            <input
              required
              name="tool_name"
              placeholder="Tool / jig / gauge name"
              className={field}
            />
            <select name="resource_type" className={field}>
              <option>TOOL</option>
              <option>DIE</option>
              <option>JIG</option>
              <option>FIXTURE</option>
              <option>GAUGE</option>
            </select>
            <input
              name="serial_number"
              placeholder="Serial number"
              className={field}
            />
            <StationSelect data={data} optional />
            <input
              name="available_quantity"
              type="number"
              min="0"
              defaultValue="1"
              placeholder="Available quantity"
              className={field}
            />
            <select name="status" className={field}>
              <option>AVAILABLE</option>
              <option>IN_USE</option>
              <option>MAINTENANCE</option>
              <option>BLOCKED</option>
            </select>
            <input name="valid_until" type="date" className={field} />
            <input
              name="life_limit_cycles"
              type="number"
              min="0.0001"
              step="0.0001"
              placeholder="Certified life cycles"
              className={field}
            />
            <input
              name="cycles_used"
              type="number"
              min="0"
              step="0.0001"
              placeholder="Opening cycles used"
              className={field}
            />
            <label className="flex items-center gap-2 rounded-lg border border-[#D9C8AA] px-3 py-2 text-sm">
              <input name="calibration_required" type="checkbox" /> Calibration
              required
            </label>
            <input
              name="last_calibration_date"
              type="date"
              className={field}
              title="Last calibration date"
            />
            <input
              name="next_calibration_due"
              type="date"
              className={field}
              title="Next calibration due"
            />
            <Submit busy={busy} />
          </form>
        </Card>
        <Card title="Employee skill certification">
          <form
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              post(
                "/production-planning/configuration/skills",
                e.currentTarget,
              );
            }}
            className="grid gap-3 sm:grid-cols-2"
          >
            <select required name="employee_id" className={field}>
              <option value="">Employee</option>
              {data.employees.map((x: any) => (
                <option key={x.id} value={x.id}>
                  {label(x)}
                </option>
              ))}
            </select>
            <input
              required
              name="skill_code"
              placeholder="Skill code"
              className={field}
            />
            <input
              name="proficiency_level"
              type="number"
              min="1"
              max="5"
              defaultValue="1"
              className={field}
            />
            <input name="valid_from" type="date" className={field} />
            <input name="valid_until" type="date" className={field} />
            <Submit busy={busy} />
          </form>
        </Card>
      </div>
      <Card
        title="Tool life & calibration evidence"
        note="Usage updates the certified life counter atomically. Calibration requires independent verification before APS treats the resource as available."
      >
        <div className="grid gap-4 xl:grid-cols-3">
          <form
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              const form = e.currentTarget;
              const id = String(
                new FormData(form).get("tool_resource_id") || "",
              );
              post(
                `/production-planning/configuration/tools/${id}/usage`,
                form,
              );
            }}
            className="space-y-2 rounded-lg bg-[#FFFCF7] p-3"
          >
            <h3 className="text-sm font-semibold">Record production usage</h3>
            <ToolSelect data={data} />
            <input
              required
              name="cycle_quantity"
              type="number"
              min="0.0001"
              step="0.0001"
              placeholder="Cycles used"
              className={field}
            />
            <input
              required
              name="evidence_reference"
              placeholder="Job/order/counter evidence"
              className={field}
            />
            <Submit busy={busy} />
          </form>
          <form
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              const form = e.currentTarget;
              const id = String(
                new FormData(form).get("tool_resource_id") || "",
              );
              post(
                `/production-planning/configuration/tools/${id}/calibrations`,
                form,
              );
            }}
            className="space-y-2 rounded-lg bg-[#FFFCF7] p-3"
          >
            <h3 className="text-sm font-semibold">Record calibration result</h3>
            <ToolSelect data={data} calibrationOnly />
            <div className="grid grid-cols-2 gap-2">
              <input required name="event_date" type="date" className={field} />
              <select name="result" className={field}>
                <option>PASS</option>
                <option>FAIL</option>
              </select>
            </div>
            <input
              name="next_due_date"
              type="date"
              className={field}
              title="Next calibration due"
            />
            <input
              required
              name="evidence_reference"
              placeholder="Certificate / lab evidence"
              className={field}
            />
            <Submit busy={busy} />
          </form>
          <form
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              const form = e.currentTarget;
              const id = String(
                new FormData(form).get("calibration_event_id") || "",
              );
              patch(
                `/production-planning/configuration/tool-calibrations/${id}/verify`,
                form,
              );
            }}
            className="space-y-2 rounded-lg bg-[#FFFCF7] p-3"
          >
            <h3 className="text-sm font-semibold">
              Independently verify calibration
            </h3>
            <select required name="calibration_event_id" className={field}>
              <option value="">Pending calibration</option>
              {(data.production_tool_events || [])
                .filter(
                  (event: any) =>
                    event.event_type === "CALIBRATION" &&
                    event.status === "RECORDED",
                )
                .map((event: any) => (
                  <option key={event.id} value={event.id}>
                    {event.event_date} · {event.result} ·{" "}
                    {event.evidence_reference}
                  </option>
                ))}
            </select>
            <textarea
              required
              name="verification_note"
              placeholder="Independent verification note"
              className={field}
            />
            <Submit busy={busy} />
          </form>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="p-2">Tool</th>
                <th className="p-2">Life</th>
                <th className="p-2">Calibration</th>
                <th className="p-2">APS status</th>
              </tr>
            </thead>
            <tbody>
              {(data.production_tool_resources || []).map((tool: any) => (
                <tr key={tool.id} className="border-b">
                  <td className="p-2">
                    <b>{tool.tool_code}</b>
                    <span className="block text-xs text-slate-500">
                      {tool.resource_type || "TOOL"} ·{" "}
                      {tool.serial_number || "No serial"}
                    </span>
                  </td>
                  <td className="p-2">
                    {Number(tool.cycles_used || 0)} /{" "}
                    {tool.life_limit_cycles || "Unlimited"}
                  </td>
                  <td className="p-2">
                    {tool.calibration_required
                      ? `${tool.calibration_status} · due ${tool.next_calibration_due || "not set"}`
                      : "Not required"}
                  </td>
                  <td className="p-2">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-semibold ${tool.status === "AVAILABLE" && ["VALID", "NOT_REQUIRED"].includes(tool.calibration_status) ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}
                    >
                      {tool.status}
                      {tool.block_reason ? ` · ${tool.block_reason}` : ""}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Configured control inventory">
        <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["Item policies", data.production_item_planning_policies],
            ["Routing constraints", data.production_routing_constraints],
            ["Alternate resources", data.production_resource_alternatives],
            ["Changeovers", data.production_changeover_matrix],
            [
              "Skills / tools",
              [
                ...(data.production_employee_skills || []),
                ...(data.production_tool_resources || []),
              ],
            ],
          ].map(([n, v]: any) => (
            <div key={n} className="rounded-lg border bg-[#FFFCF7] p-3">
              <span className="text-slate-500">{n}</span>
              <b className="mt-1 block text-xl">{v?.length || 0}</b>
            </div>
          ))}
        </div>
      </Card>
    </main>
  );
}
function Card({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: any;
}) {
  return (
    <section className="rounded-xl border border-[#E6D8C0] bg-white p-4">
      <div className="mb-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Settings2 size={17} />
          {title}
        </h2>
        {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
      </div>
      {children}
    </section>
  );
}
function Submit({ busy }: { busy: boolean }) {
  return (
    <button
      disabled={busy}
      className="inline-flex items-center justify-center gap-1 rounded bg-[#4A3526] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
    >
      <Save size={15} />
      Save
    </button>
  );
}
function RoutingSelect({ data, name }: { data: any; name: string }) {
  return (
    <select required name={name} className={field}>
      <option value="">Routing operation</option>
      {data.routings.map((x: any) => (
        <option key={x.id} value={x.id}>
          {x.item?.code || "BOM"} v{x.bom_version || "?"} · {x.sequence_no}.{" "}
          {x.operation_name}
        </option>
      ))}
    </select>
  );
}
function StationSelect({
  data,
  optional = false,
}: {
  data: any;
  optional?: boolean;
}) {
  return (
    <select required={!optional} name="work_station_id" className={field}>
      <option value="">{optional ? "Any station" : "Work station"}</option>
      {data.stations.map((x: any) => (
        <option key={x.id} value={x.id}>
          {x.station_code} — {x.station_name}
        </option>
      ))}
    </select>
  );
}

function ToolSelect({
  data,
  calibrationOnly = false,
}: {
  data: any;
  calibrationOnly?: boolean;
}) {
  const tools = (data.production_tool_resources || []).filter(
    (tool: any) => !calibrationOnly || tool.calibration_required,
  );
  return (
    <select required name="tool_resource_id" className={field}>
      <option value="">Tool / die / gauge</option>
      {tools.map((tool: any) => (
        <option key={tool.id} value={tool.id}>
          {tool.tool_code} — {tool.tool_name} · {tool.status}
        </option>
      ))}
    </select>
  );
}

function AlternateItemPicker({
  items,
  currentItemId,
  initialSelected,
}: {
  items: any[];
  currentItemId: string;
  initialSelected: string[];
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>(
    (initialSelected || []).map(String),
  );
  const visible = (items || [])
    .filter((item: any) => String(item.id) !== currentItemId)
    .filter((item: any) =>
      `${item.code || ""} ${item.name || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .slice(0, 12);
  return (
    <div className="rounded-lg border border-[#D9C8AA] bg-white p-2 md:col-span-2">
      <input
        type="hidden"
        name="alternate_item_ids"
        value={selected.join(",")}
      />
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search approved alternate materials"
        className="w-full border-b px-1 py-1 text-sm outline-none"
      />
      <div className="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs">
        {visible.map((item: any) => (
          <label
            key={item.id}
            className="flex cursor-pointer items-center gap-2"
          >
            <input
              type="checkbox"
              checked={selected.includes(String(item.id))}
              onChange={() =>
                setSelected((current) =>
                  current.includes(String(item.id))
                    ? current.filter((id) => id !== String(item.id))
                    : [...current, String(item.id)],
                )
              }
            />
            <span>
              <b>{item.code}</b> — {item.name}
            </span>
          </label>
        ))}
        {!visible.length && (
          <span className="text-slate-500">No matching items.</span>
        )}
      </div>
      {selected.length > 0 && (
        <p className="mt-2 text-xs font-semibold text-emerald-700">
          {selected.length} approved alternate(s) selected
        </p>
      )}
    </div>
  );
}
