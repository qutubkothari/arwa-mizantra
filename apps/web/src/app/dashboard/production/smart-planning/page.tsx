"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  BrainCircuit,
  CalendarClock,
  Factory,
  Loader2,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";

const field =
  "w-full rounded-lg border border-[#D9C8AA] bg-white px-3 py-2 text-sm";
const num = (v: any) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(
    Number(v || 0),
  );
const money = (v: any, c = "AED") =>
  new Intl.NumberFormat(c === "INR" ? "en-IN" : "en-AE", {
    style: "currency",
    currency: c,
    maximumFractionDigits: 0,
  }).format(Number(v || 0));
type Wave = {
  wave_name: string;
  quantity: string;
  required_by: string;
  transfer_batch_quantity: string;
  priority: string;
};

export default function SmartPlanningPage() {
  const [data, setData] = useState<any>({ programs: [] }),
    [masters, setMasters] = useState<any>({ items: [], stations: [] }),
    [selected, setSelected] = useState<any>(null),
    [proposal, setProposal] = useState<any>(null),
    [stale, setStale] = useState<any>(null),
    [busy, setBusy] = useState(true),
    [message, setMessage] = useState("");
  const [demandSource, setDemandSource] = useState<"MANUAL" | "SALES_ORDER">(
      "MANUAL",
    ),
    [salesOrders, setSalesOrders] = useState<any[]>([]),
    [salesOrderId, setSalesOrderId] = useState(""),
    [salesOrderItemId, setSalesOrderItemId] = useState("");
  const [waves, setWaves] = useState<Wave[]>([
    {
      wave_name: "Pilot wave",
      quantity: "10",
      required_by: "",
      transfer_batch_quantity: "5",
      priority: "90",
    },
    {
      wave_name: "Ramp wave",
      quantity: "30",
      required_by: "",
      transfer_batch_quantity: "10",
      priority: "70",
    },
    {
      wave_name: "Balance wave",
      quantity: "60",
      required_by: "",
      transfer_batch_quantity: "10",
      priority: "50",
    },
  ]);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [m, d, s] = await Promise.all([
        apiClient.get("/production-planning/masters"),
        apiClient.get("/production-planning/dashboard"),
        apiClient.get("/production-planning/sales-orders"),
      ]);
      setMasters(m);
      setData(d);
      setSalesOrders(Array.isArray(s) ? s : []);
    } catch (e: any) {
      setMessage(e?.message || "Unable to load smart production planning.");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const body: any = Object.fromEntries(new FormData(e.currentTarget));
      body.demand_source = demandSource;
      body.sales_order_id =
        demandSource === "SALES_ORDER" ? salesOrderId : null;
      body.sales_order_item_id =
        demandSource === "SALES_ORDER" ? salesOrderItemId : null;
      body.target_quantity = Number(body.target_quantity);
      body.cash_budget = body.cash_budget ? Number(body.cash_budget) : null;
      body.default_efficiency_pct = Number(body.default_efficiency_pct || 85);
      body.default_daily_minutes = Number(body.default_daily_minutes || 480);
      body.safety_pct = Number(body.safety_pct || 0);
      body.waves = waves.map((x) => ({
        ...x,
        quantity: Number(x.quantity),
        priority: Number(x.priority),
        transfer_batch_quantity: x.transfer_batch_quantity
          ? Number(x.transfer_batch_quantity)
          : null,
      }));
      const p: any = await apiClient.post(
        "/production-planning/programs",
        body,
      );
      setMessage(
        `${p.program_code} created${p.demand_source === "SALES_ORDER" ? " from its sales-order demand" : ""}. Run the plan to calculate capacity, dates and material release.`,
      );
      (e.currentTarget as HTMLFormElement).reset();
      setDemandSource("MANUAL");
      setSalesOrderId("");
      setSalesOrderItemId("");
      setWaves([
        {
          wave_name: "Pilot wave",
          quantity: "10",
          required_by: "",
          transfer_batch_quantity: "5",
          priority: "90",
        },
        {
          wave_name: "Ramp wave",
          quantity: "30",
          required_by: "",
          transfer_batch_quantity: "10",
          priority: "70",
        },
        {
          wave_name: "Balance wave",
          quantity: "60",
          required_by: "",
          transfer_batch_quantity: "10",
          priority: "50",
        },
      ]);
      await load();
    } catch (x: any) {
      setMessage(x?.message || "Unable to create production program.");
    } finally {
      setBusy(false);
    }
  };
  const run = async (id: string) => {
    setBusy(true);
    setMessage("");
    try {
      const detail = await apiClient.post(
        `/production-planning/programs/${id}/run`,
        {},
      );
      setSelected(detail);
      setStale({ stale: false, reason: "CURRENT" });
      setMessage(
        "Plan completed safely. No PR, PO, job order or stock transaction was created.",
      );
      await load();
    } catch (e: any) {
      setMessage(e?.message || "Unable to run the production plan.");
    } finally {
      setBusy(false);
    }
  };
  const open = async (id: string) => {
    try {
      setProposal(null);
      const [d, s] = await Promise.all([
        apiClient.get(`/production-planning/programs/${id}`),
        apiClient.get(`/production-planning/programs/${id}/staleness`),
      ]);
      setSelected(d);
      setStale(s);
    } catch (e: any) {
      setMessage(e?.message || "Unable to open plan.");
    }
  };
  const prepareProposal = async (id: string) => {
    try {
      setProposal(
        await apiClient.get(
          `/production-planning/programs/${id}/procurement-proposal`,
        ),
      );
      setMessage(
        "Procurement proposal prepared for review. No PR or PO was created.",
      );
    } catch (e: any) {
      setMessage(e?.message || "Unable to prepare procurement proposal.");
    }
  };
  const createDraftPr = async () => {
    if (
      !selected?.run ||
      !confirm(
        "Create one DRAFT purchase requisition from this exact plan? It will still require normal submission and maker-checker approval.",
      )
    )
      return;
    try {
      const x: any = await apiClient.post(
        `/production-planning/programs/${selected.program.id}/procurement-proposal/draft-pr`,
        { confirm: true, idempotency_key: `smart-plan-${selected.run.id}` },
      );
      setMessage(
        `${x.purchase_requisition_number} ${x.status === "ALREADY_CREATED" ? "already exists" : "created as DRAFT"}. No approval or PO was created.`,
      );
    } catch (e: any) {
      setMessage(e?.message || "Unable to create draft purchase requisition.");
    }
  };
  const act = async (action: string, extra: any = {}) => {
    if (!selected?.program) return;
    try {
      const url =
        action === "APPROVE"
          ? `/production-planning/programs/${selected.program.id}/approve`
          : `/production-planning/programs/${selected.program.id}/action`;
      const d = await apiClient.patch(
        url,
        action === "APPROVE" ? extra : { action, ...extra },
      );
      setSelected(d);
      setMessage(
        `Production plan ${action.toLowerCase()} completed with an audit entry.`,
      );
      await load();
    } catch (e: any) {
      setMessage(
        e?.message || `Unable to ${action.toLowerCase()} production plan.`,
      );
    }
  };
  const setAutoReplan = async (enabled: boolean) => {
    if (!selected?.program) return;
    try {
      await apiClient.patch(
        `/production-planning/programs/${selected.program.id}/auto-replan`,
        { enabled, interval_minutes: 60 },
      );
      await open(selected.program.id);
      setMessage(
        `Automatic replanning ${enabled ? "enabled" : "disabled"}. Frozen plans are never changed automatically.`,
      );
    } catch (e: any) {
      setMessage(e?.message || "Unable to update automatic replanning.");
    }
  };
  const createDraftJobs = async () => {
    if (
      !selected?.program ||
      !confirm(
        "Create draft job orders for every frozen build wave and subassembly? No material will be issued automatically.",
      )
    )
      return;
    try {
      const x: any = await apiClient.post(
        `/production-planning/programs/${selected.program.id}/execution/draft-job-orders`,
        { confirm: true },
      );
      setMessage(
        `${x.count} governed draft job order link(s) are ready. Material issue and completion remain controlled.`,
      );
      await open(selected.program.id);
    } catch (e: any) {
      setMessage(e?.message || "Unable to create draft job orders.");
    }
  };
  const createDraftShifts = async () => {
    if (
      !selected?.program ||
      !confirm(
        "Create draft shift proposals from the frozen stage plan? Supervisors must still approve and publish them.",
      )
    )
      return;
    try {
      const x: any = await apiClient.post(
        `/production-planning/programs/${selected.program.id}/execution/draft-shifts`,
        { confirm: true },
      );
      setMessage(
        `${x.count} governed draft shift proposal(s) created. Nothing was published to operators.`,
      );
      await open(selected.program.id);
    } catch (e: any) {
      setMessage(e?.message || "Unable to create draft shift proposals.");
    }
  };
  const publishShifts = async () => {
    if (
      !selected?.program ||
      !confirm(
        "Approve and publish the draft shift proposals to the operating calendar? Maker-checker control applies.",
      )
    )
      return;
    try {
      const x: any = await apiClient.post(
        `/production-planning/programs/${selected.program.id}/execution/publish-shifts`,
        { confirm: true },
      );
      setMessage(
        `${x.count} approved shift(s) published to the operating calendar with evidence links.`,
      );
      await open(selected.program.id);
    } catch (e: any) {
      setMessage(
        e?.message || "Unable to approve and publish shift proposals.",
      );
    }
  };
  const setProgramField = (name: string, value: any) => {
    const field = document.querySelector<HTMLInputElement | HTMLSelectElement>(
      `form input[name="${name}"], form select[name="${name}"]`,
    );
    if (field) {
      field.value = String(value ?? "");
      field.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };
  const chooseSalesOrderLine = (orderId: string, lineId: string) => {
    setSalesOrderId(orderId);
    setSalesOrderItemId(lineId);
    const order = salesOrders.find((x: any) => String(x.id) === orderId),
      line = order?.lines?.find((x: any) => String(x.id) === lineId);
    if (!order || !line) return;
    const today = new Date().toISOString().slice(0, 10),
      due = String(line.due_date || "").slice(0, 10),
      qty = String(line.open_quantity || "");
    setProgramField(
      "program_name",
      `${order.so_number} - ${line.item?.code || line.item?.name || line.item_description || "Production"}`,
    );
    setProgramField("finished_item_id", line.item_id);
    setProgramField("target_quantity", qty);
    setProgramField("start_date", today);
    setProgramField("due_date", due);
    setProgramField("currency_code", order.currency_code || "AED");
    setWaves([
      {
        wave_name: `${order.so_number} delivery`,
        quantity: qty,
        required_by: due,
        transfer_batch_quantity: "",
        priority: "100",
      },
    ]);
    setMessage(
      `Sales order ${order.so_number} linked. Product, remaining quantity, currency and promised date were filled from the order.`,
    );
  };
  const chooseSalesOrder = (orderId: string) => {
    setSalesOrderId(orderId);
    const order = salesOrders.find((x: any) => String(x.id) === orderId),
      line = order?.lines?.find((x: any) => x.eligible);
    if (line) chooseSalesOrderLine(orderId, String(line.id));
    else setSalesOrderItemId("");
  };
  const switchDemandSource = (value: "MANUAL" | "SALES_ORDER") => {
    setDemandSource(value);
    setSalesOrderId("");
    setSalesOrderItemId("");
    if (value === "MANUAL") {
      setMessage(
        "Manual production demand selected. Enter the product, quantity and dates below.",
      );
      setWaves([
        {
          wave_name: "Pilot wave",
          quantity: "10",
          required_by: "",
          transfer_batch_quantity: "5",
          priority: "90",
        },
        {
          wave_name: "Ramp wave",
          quantity: "30",
          required_by: "",
          transfer_batch_quantity: "10",
          priority: "70",
        },
        {
          wave_name: "Balance wave",
          quantity: "60",
          required_by: "",
          transfer_batch_quantity: "10",
          priority: "50",
        },
      ]);
    }
  };
  const patchWave = (i: number, k: keyof Wave, v: string) =>
    setWaves((x) => x.map((w, n) => (n === i ? { ...w, [k]: v } : w)));
  return (
    <main className="mx-auto max-w-[1500px] space-y-5 p-3 sm:p-5">
      <header className="rounded-2xl bg-gradient-to-r from-[#4A3526] to-[#8B6844] p-6 text-white">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-amber-100">
              <BrainCircuit size={18} />
              Constraint-driven MRP & APS
            </div>
            <h1 className="mt-2 text-2xl font-bold sm:text-3xl">
              Smart Production Planning
            </h1>
            <p className="mt-2 max-w-4xl text-sm text-amber-50">
              Build waves, multi-level BOM demand, bottleneck-pull release,
              capacity feasibility, purchase timing and cash exposure—with every
              recommendation pegged to the demand it protects.
            </p>
          </div>
          {busy && <Loader2 className="animate-spin" />}
        </div>
      </header>
      {message && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          {message}
        </div>
      )}
      <section className="rounded-xl border border-[#E6D8C0] bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Production demand source</h2>
            <p className="text-xs text-slate-500">
              Plan manually or pull controlled demand directly from a released
              sales-order line.
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-[#D9C8AA] p-1">
            <button
              type="button"
              onClick={() => switchDemandSource("MANUAL")}
              className={`rounded px-4 py-2 text-sm font-semibold ${demandSource === "MANUAL" ? "bg-[#4A3526] text-white" : "text-[#4A3526]"}`}
            >
              Enter manually
            </button>
            <button
              type="button"
              onClick={() => switchDemandSource("SALES_ORDER")}
              className={`rounded px-4 py-2 text-sm font-semibold ${demandSource === "SALES_ORDER" ? "bg-[#4A3526] text-white" : "text-[#4A3526]"}`}
            >
              Select sales order
            </button>
          </div>
        </div>
        {demandSource === "SALES_ORDER" && (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-medium text-slate-600">
              Sales order
              <select
                value={salesOrderId}
                onChange={(e) => chooseSalesOrder(e.target.value)}
                className={`${field} mt-1`}
              >
                <option value="">Select released sales order</option>
                {salesOrders.map((order: any) => (
                  <option
                    key={order.id}
                    value={order.id}
                    disabled={!order.eligible}
                  >
                    {order.so_number} — {order.customer_name || "Customer"}
                    {order.eligible ? "" : " (not eligible)"}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              Product line
              <select
                value={salesOrderItemId}
                onChange={(e) =>
                  chooseSalesOrderLine(salesOrderId, e.target.value)
                }
                disabled={!salesOrderId}
                className={`${field} mt-1 disabled:bg-slate-100`}
              >
                <option value="">Select product line</option>
                {(
                  salesOrders.find(
                    (order: any) => String(order.id) === salesOrderId,
                  )?.lines || []
                ).map((line: any) => (
                  <option
                    key={line.id}
                    value={line.id}
                    disabled={!line.eligible}
                  >
                    {line.item?.code || line.item_description || "Item"} — open{" "}
                    {num(line.open_quantity)}{" "}
                    {line.item?.uom || line.ordered_uom || ""} — due{" "}
                    {line.due_date || "not set"}
                    {line.eligible ? "" : ` (${line.blocked_reason})`}
                  </option>
                ))}
              </select>
            </label>
            <div className="md:col-span-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              The server rechecks the selected order before creating the plan.
              Product, remaining quantity, promised date and currency cannot be
              replaced by typed values, preventing duplicate or incorrect
              production demand.
            </div>
          </div>
        )}
      </section>
      <form
        onSubmit={create}
        className="space-y-4 rounded-xl border border-[#E6D8C0] bg-[#FFFCF7] p-4"
      >
        <div>
          <h2 className="font-semibold">New production program</h2>
          <p className="text-xs text-slate-500">
            The sum of build waves must equal the target quantity.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <input
            required
            name="program_name"
            placeholder="Program name (e.g. 100 drones)"
            className={field}
          />
          <input
            name="program_code"
            placeholder="Program code (automatic if blank)"
            className={field}
          />
          <select required name="finished_item_id" className={field}>
            <option value="">Finished item</option>
            {masters.items.map((x: any) => (
              <option key={x.id} value={x.id}>
                {x.code} — {x.name}
              </option>
            ))}
          </select>
          <input
            required
            name="target_quantity"
            type="number"
            min="0.0001"
            step="0.0001"
            placeholder="Target quantity"
            className={field}
          />
          <label className="text-xs text-slate-500">
            Planning start
            <input required name="start_date" type="date" className={field} />
          </label>
          <label className="text-xs text-slate-500">
            Customer due date
            <input required name="due_date" type="date" className={field} />
          </label>
          <select name="planning_policy" className={field}>
            <option value="BOTTLENECK_PULL">Bottleneck pull</option>
            <option value="DUE_DATE">Due-date priority</option>
            <option value="CASH_CONSTRAINED">Cash constrained</option>
          </select>
          <input
            name="cash_budget"
            type="number"
            min="0"
            step="0.01"
            placeholder="Optional material cash budget"
            className={field}
          />
          <input
            name="default_daily_minutes"
            type="number"
            min="60"
            defaultValue="480"
            placeholder="Minutes / working day"
            className={field}
          />
          <input
            name="default_efficiency_pct"
            type="number"
            min="1"
            max="150"
            defaultValue="85"
            placeholder="Planning efficiency %"
            className={field}
          />
          <input
            name="safety_pct"
            type="number"
            min="0"
            max="100"
            defaultValue="2"
            placeholder="Material safety %"
            className={field}
          />
          <select name="currency_code" className={field}>
            <option>AED</option>
            <option>INR</option>
            <option>USD</option>
          </select>
          <input
            name="overtime_cost_per_hour"
            type="number"
            min="0"
            defaultValue="45"
            placeholder="Overtime cost / hour"
            className={field}
          />
          <input
            name="second_shift_cost_per_hour"
            type="number"
            min="0"
            defaultValue="60"
            placeholder="Second shift cost / hour"
            className={field}
          />
          <input
            name="subcontract_cost_per_hour"
            type="number"
            min="0"
            defaultValue="90"
            placeholder="Subcontract cost / hour"
            className={field}
          />
          <input
            name="late_delivery_cost_per_day"
            type="number"
            min="0"
            defaultValue="500"
            placeholder="Late delivery cost / day"
            className={field}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="p-2">Build wave</th>
                <th className="p-2">Quantity</th>
                <th className="p-2">Required by</th>
                <th className="p-2">Transfer batch</th>
                <th className="p-2">Priority</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {waves.map((w, i) => (
                <tr key={i}>
                  <td className="p-1">
                    <input
                      required
                      value={w.wave_name}
                      onChange={(e) =>
                        patchWave(i, "wave_name", e.target.value)
                      }
                      className={field}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      required
                      type="number"
                      min="0.0001"
                      step="0.0001"
                      value={w.quantity}
                      onChange={(e) => patchWave(i, "quantity", e.target.value)}
                      className={field}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      required
                      type="date"
                      value={w.required_by}
                      onChange={(e) =>
                        patchWave(i, "required_by", e.target.value)
                      }
                      className={field}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      type="number"
                      min="0.0001"
                      step="0.0001"
                      value={w.transfer_batch_quantity}
                      onChange={(e) =>
                        patchWave(i, "transfer_batch_quantity", e.target.value)
                      }
                      className={field}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={w.priority}
                      onChange={(e) => patchWave(i, "priority", e.target.value)}
                      className={field}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      aria-label="Remove wave"
                      onClick={() =>
                        setWaves((x) => x.filter((_, n) => n !== i))
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              setWaves((x) => [
                ...x,
                {
                  wave_name: `Wave ${x.length + 1}`,
                  quantity: "",
                  required_by: "",
                  transfer_batch_quantity: "",
                  priority: "50",
                },
              ])
            }
            className="inline-flex items-center gap-1 rounded border px-3 py-2 text-sm"
          >
            <Plus size={15} />
            Add wave
          </button>
          <button
            disabled={
              busy ||
              !waves.length ||
              (demandSource === "SALES_ORDER" && !salesOrderItemId)
            }
            className="rounded bg-[#4A3526] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Create staged program
          </button>
        </div>
      </form>
      <section className="rounded-xl border bg-white p-4">
        <h2 className="font-semibold">Production programs</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="p-2">Program</th>
                <th className="p-2">Target / waves</th>
                <th className="p-2">Due</th>
                <th className="p-2">Feasibility</th>
                <th className="p-2">Cash need</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.programs.map((p: any) => (
                <tr key={p.id} className="border-b">
                  <td className="p-2">
                    <b>{p.program_code}</b>
                    <small className="block text-slate-500">
                      {p.program_name} · {p.finished_item?.code}
                    </small>
                  </td>
                  <td className="p-2">
                    {num(p.target_quantity)} / {p.waves.length}
                  </td>
                  <td className="p-2">{p.due_date}</td>
                  <td className="p-2">
                    {p.latest_run ? (
                      <span
                        className={
                          p.latest_run.feasible
                            ? "font-semibold text-emerald-700"
                            : "font-semibold text-red-700"
                        }
                      >
                        {p.latest_run.feasible ? "FEASIBLE" : "AT RISK"} ·{" "}
                        {num(p.latest_run.delivery_confidence_pct)}%
                      </span>
                    ) : (
                      "Not planned"
                    )}
                  </td>
                  <td className="p-2">
                    {p.latest_run
                      ? money(
                          p.latest_run.material_cash_required,
                          p.currency_code,
                        )
                      : "—"}
                  </td>
                  <td className="p-2">
                    <button
                      onClick={() => run(p.id)}
                      className="mr-2 inline-flex items-center gap-1 rounded bg-[#4A3526] px-2 py-1 text-xs text-white"
                    >
                      <Play size={13} />
                      Run
                    </button>
                    <button
                      onClick={() => open(p.id)}
                      className="rounded border px-2 py-1 text-xs"
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.programs.length && !busy && (
            <p className="py-6 text-sm text-slate-500">
              No staged production programs yet.
            </p>
          )}
        </div>
      </section>
      {selected?.run && (
        <>
          <div className="flex justify-end">
            <button
              onClick={publishShifts}
              disabled={
                !selected.shift_proposals?.some(
                  (x: any) => x.status === "DRAFT",
                ) || stale?.stale
              }
              className="rounded bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            >
              Approve &amp; publish draft shifts
            </button>
          </div>
          <Plan
            detail={selected}
            proposal={proposal}
            stale={stale}
            onPrepareProposal={() => prepareProposal(selected.program.id)}
            onCreateDraftPr={createDraftPr}
            onReplan={() => run(selected.program.id)}
            onAction={act}
            onAutoReplan={setAutoReplan}
            onCreateDraftJobs={createDraftJobs}
            onCreateDraftShifts={createDraftShifts}
          />
        </>
      )}
    </main>
  );
}

function Plan({
  detail,
  proposal,
  stale,
  onPrepareProposal,
  onCreateDraftPr,
  onReplan,
  onAction,
  onAutoReplan,
  onCreateDraftJobs,
  onCreateDraftShifts,
}: {
  detail: any;
  proposal: any;
  stale: any;
  onPrepareProposal: () => Promise<void>;
  onCreateDraftPr: () => Promise<void>;
  onReplan: () => Promise<void>;
  onAction: (action: string, extra?: any) => Promise<void>;
  onAutoReplan: (enabled: boolean) => Promise<void>;
  onCreateDraftJobs: () => Promise<void>;
  onCreateDraftShifts: () => Promise<void>;
}) {
  const r = detail.run,
    p = detail.program,
    c = p.currency_code || "AED",
    alternatives = r.explanation?.alternatives || [],
    calendar = r.explanation?.calendar || {};
  const [simulation, setSimulation] = useState<any>(null);
  const [simulationBusy, setSimulationBusy] = useState(false);
  const [execution, setExecution] = useState<any>(null);
  const [executionBusy, setExecutionBusy] = useState(false);
  const loadExecution = useCallback(async () => {
    setExecutionBusy(true);
    try {
      setExecution(
        await apiClient.get(
          `/production-planning/programs/${p.id}/execution-variance`,
        ),
      );
    } catch (error: any) {
      setExecution({
        error: error?.message || "Unable to load execution variance.",
      });
    } finally {
      setExecutionBusy(false);
    }
  }, [p.id, r.id]);
  useEffect(() => {
    setSimulation(null);
    setExecution(null);
    loadExecution();
  }, [p.id, r.id, loadExecution]);
  const simulate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSimulationBusy(true);
    try {
      const values: any = Object.fromEntries(new FormData(event.currentTarget));
      for (const key of Object.keys(values))
        values[key] = Number(values[key] || 0);
      values.overtime_minutes = Number(values.overtime_hours || 0) * 60;
      values.alternate_capacity_minutes =
        Number(values.alternate_capacity_hours || 0) * 60;
      delete values.overtime_hours;
      delete values.alternate_capacity_hours;
      setSimulation(
        await apiClient.post(
          `/production-planning/programs/${p.id}/simulate`,
          values,
        ),
      );
    } catch (error: any) {
      setSimulation({
        error: error?.message || "Unable to simulate this scenario.",
      });
    } finally {
      setSimulationBusy(false);
    }
  };
  return (
    <section className="space-y-4">
      {stale?.stale && (
        <div className="flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <span>
            Source data changed after this run. Replan before releasing
            procurement or production.
          </span>
          <button
            onClick={onReplan}
            className="rounded bg-amber-800 px-3 py-1 text-white"
          >
            Replan now
          </button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <K
          l="Delivery"
          v={r.feasible ? "Feasible" : "At risk"}
          alert={!r.feasible}
        />
        <K l="Confidence" v={`${num(r.delivery_confidence_pct)}%`} />
        <K l="Projected completion" v={r.projected_completion_date} />
        <K
          l="Overtime gap"
          v={`${num(r.required_overtime_minutes / 60)} h`}
          alert={r.required_overtime_minutes > 0}
        />
        <K l="Material cash" v={money(r.material_cash_required, c)} />
      </div>
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-blue-950">
              <CalendarClock size={17} /> Capacity calendar evidence
            </h2>
            <p className="mt-1 max-w-4xl text-xs text-blue-900">
              {calendar.control ||
                "Rerun this plan to generate dated shift, downtime, holiday and maintenance evidence."}
            </p>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-blue-900">
            {num(calendar.configured_calendar_coverage_pct)}% configured
            coverage
          </span>
        </div>
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
          <span>
            Open dates: <b>{num(calendar.open_calendar_dates)}</b>
          </span>
          <span>
            Configured: <b>{num(calendar.configured_calendar_dates)}</b>
          </span>
          <span>
            Default weekdays: <b>{num(calendar.default_weekday_dates)}</b>
          </span>
          <span>
            Closed dates: <b>{num(calendar.closed_calendar_dates)}</b>
          </span>
          <span>
            Maintenance:{" "}
            <b>{num(calendar.planned_maintenance_minutes / 60)} h</b>
          </span>
          <span>
            Allocated dates: <b>{num(calendar.allocated_station_dates)}</b>
          </span>
        </div>
      </div>
      <div className="rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Governed plan release</h2>
            <p className="text-xs text-slate-500">
              Plan → submit → independent approval → freeze horizon → draft jobs
              and shifts. Replanning clears prior approval.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onAction("SUBMIT")}
              disabled={!!p.submitted_at}
              className="rounded border px-3 py-2 text-xs disabled:opacity-40"
            >
              Submit
            </button>
            <button
              onClick={() => onAction("APPROVE")}
              disabled={!p.submitted_at || !!p.approved_at || stale?.stale}
              className="rounded border px-3 py-2 text-xs disabled:opacity-40"
            >
              Approve
            </button>
            <button
              onClick={() =>
                onAction("FREEZE", { freeze_horizon_date: p.due_date })
              }
              disabled={!p.approved_at || !!p.frozen_at}
              className="rounded border px-3 py-2 text-xs disabled:opacity-40"
            >
              Freeze to due date
            </button>
            <button
              onClick={onCreateDraftJobs}
              disabled={!p.frozen_at || stale?.stale}
              className="rounded bg-[#4A3526] px-3 py-2 text-xs text-white disabled:opacity-40"
            >
              Create draft job orders
            </button>
            <button
              onClick={onCreateDraftShifts}
              disabled={!p.frozen_at || stale?.stale}
              className="rounded bg-[#8B6844] px-3 py-2 text-xs text-white disabled:opacity-40"
            >
              Create draft shifts
            </button>
            <button
              onClick={() => onAutoReplan(!p.auto_replan_enabled)}
              disabled={!!p.frozen_at}
              className="rounded border px-3 py-2 text-xs disabled:opacity-40"
            >
              Auto replan: {p.auto_replan_enabled ? "ON" : "OFF"}
            </button>
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
          <span>
            Status: <b>{p.status}</b>
          </span>
          <span>
            Submitted: <b>{p.submitted_at ? "Yes" : "No"}</b>
          </span>
          <span>
            Approved: <b>{p.approved_at ? "Yes" : "No"}</b>
          </span>
          <span>
            Frozen: <b>{p.freeze_horizon_date || "No"}</b>
          </span>
        </div>
        {detail.execution_conversions?.length > 0 && (
          <p className="mt-2 text-xs text-emerald-700">
            {
              detail.execution_conversions.filter(
                (x: any) => x.status === "DRAFT_CREATED",
              ).length
            }{" "}
            draft job order(s) linked to this plan.
          </p>
        )}
        {detail.shift_proposals?.length > 0 && (
          <p className="mt-1 text-xs text-emerald-700">
            {detail.shift_proposals.length} draft shift proposal(s) linked to
            this frozen plan.
          </p>
        )}
      </div>
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-emerald-950">
              <Factory size={17} /> Plan versus actual execution
            </h2>
            <p className="mt-1 max-w-4xl text-xs text-emerald-900">
              Linked job-order progress, schedule variance, rejection and net
              material issue. This view never assumes issued material was
              consumed.
            </p>
          </div>
          <button
            onClick={loadExecution}
            disabled={executionBusy}
            className="rounded border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 disabled:opacity-50"
          >
            {executionBusy ? "Refreshing..." : "Refresh actuals"}
          </button>
        </div>
        {execution?.error && (
          <p className="mt-3 rounded bg-red-50 p-3 text-xs text-red-700">
            {execution.error}
          </p>
        )}
        {execution && !execution.error && (
          <>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
              <K
                l="Linked jobs"
                v={`${num(execution.summary.linked_job_orders)} / ${num(execution.summary.planned_job_orders)}`}
              />
              <K
                l="Completed jobs"
                v={num(execution.summary.completed_job_orders)}
              />
              <K
                l="Jobs at risk"
                v={num(execution.summary.jobs_at_risk)}
                alert={execution.summary.jobs_at_risk > 0}
              />
              <K
                l="Completed quantity"
                v={`${num(execution.summary.completed_quantity)} / ${num(execution.summary.planned_quantity)}`}
              />
              <K
                l="Rejected quantity"
                v={num(execution.summary.rejected_quantity)}
                alert={execution.summary.rejected_quantity > 0}
              />
              <K
                l="On-time completion"
                v={`${num(execution.summary.on_time_completion_pct)}%`}
              />
            </div>
            {execution.rows?.length ? (
              <div className="mt-3 overflow-x-auto rounded-lg border border-emerald-100 bg-white">
                <table className="min-w-full text-xs">
                  <thead className="border-b bg-emerald-50 text-left uppercase text-slate-500">
                    <tr>
                      <th className="p-2">Job order</th>
                      <th className="p-2">Schedule</th>
                      <th className="p-2 text-right">Output</th>
                      <th className="p-2 text-right">Net material issue</th>
                      <th className="p-2">Exceptions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {execution.rows.map((row: any) => (
                      <tr
                        key={row.conversion_id}
                        className="border-b last:border-0"
                      >
                        <td className="p-2">
                          <b>{row.job_order_number}</b>
                          <small className="block text-slate-500">
                            {row.status}
                          </small>
                        </td>
                        <td className="p-2">
                          <b>{row.schedule_status.replaceAll("_", " ")}</b>
                          <small className="block text-slate-500">
                            Plan {row.planned_start || "—"} →{" "}
                            {row.planned_end || "—"}
                          </small>
                          <small className="block text-slate-500">
                            Actual {row.actual_start || "—"} →{" "}
                            {row.actual_end || "—"}
                          </small>
                        </td>
                        <td className="p-2 text-right">
                          <b>
                            {num(row.completed_quantity)} /{" "}
                            {num(row.planned_quantity)}
                          </b>
                          <small className="block text-slate-500">
                            {num(row.progress_pct)}% · rejected{" "}
                            {num(row.rejected_quantity)}
                          </small>
                        </td>
                        <td className="p-2 text-right">
                          <b>
                            {num(row.material_net_issued_quantity)} /{" "}
                            {num(row.material_required_quantity)}
                          </b>
                          <small className="block text-slate-500">
                            variance {num(row.material_issue_variance_quantity)}
                          </small>
                        </td>
                        <td className="p-2">
                          {row.risks.length
                            ? row.risks
                                .map((risk: string) =>
                                  risk.replaceAll("_", " "),
                                )
                                .join(" · ")
                            : "No current variance"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-3 rounded bg-white p-3 text-xs text-slate-600">
                No job orders have been converted from this planning run yet.
              </p>
            )}
            <p className="mt-2 text-xs font-semibold text-emerald-900">
              {execution.control}
            </p>
          </>
        )}
      </div>
      {alternatives.length > 0 && (
        <div className="rounded-xl border bg-white p-4">
          <h2 className="font-semibold">
            Cost- and risk-ranked recovery scenarios
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Alternatives are recommendations only and require the normal
            approval process.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {alternatives.map((x: any) => (
              <div
                key={x.code}
                className={`rounded-lg border p-3 ${x.recommended ? "border-emerald-300 bg-emerald-50" : "border-[#E6D8C0] bg-[#FFFCF7]"}`}
              >
                <b className="text-sm">
                  #{x.rank} {x.label}
                </b>
                {x.recommended && (
                  <small className="ml-2 font-semibold text-emerald-700">
                    Recommended
                  </small>
                )}
                <p className="mt-1 text-xs text-slate-600">{x.impact}</p>
                <p className="mt-2 text-xs">
                  Estimated cost: <b>{money(x.estimated_cost, c)}</b> · risk{" "}
                  {num(x.risk_score)}/100
                </p>
                {x.approval_required && (
                  <small className="mt-1 block font-semibold text-amber-700">
                    Approval required
                  </small>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
        <div className="flex items-start gap-2">
          <BrainCircuit className="mt-0.5 text-violet-800" size={18} />
          <div>
            <h2 className="font-semibold text-violet-950">
              What-if delivery scenario
            </h2>
            <p className="mt-1 text-xs text-violet-900">
              Test recovery options against the latest plan. The simulation is
              temporary and cannot change capacity, suppliers, budgets or the
              customer promise.
            </p>
          </div>
        </div>
        <form
          onSubmit={simulate}
          className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5"
        >
          <label className="text-xs text-slate-700">
            Overtime hours
            <input
              className={`${field} mt-1`}
              name="overtime_hours"
              type="number"
              min="0"
              max="168"
              step="0.5"
              defaultValue="0"
            />
          </label>
          <label className="text-xs text-slate-700">
            Alternate capacity hours
            <input
              className={`${field} mt-1`}
              name="alternate_capacity_hours"
              type="number"
              min="0"
              max="168"
              step="0.5"
              defaultValue="0"
            />
          </label>
          <label className="text-xs text-slate-700">
            Supplier acceleration days
            <input
              className={`${field} mt-1`}
              name="supplier_acceleration_days"
              type="number"
              min="0"
              max="60"
              defaultValue="0"
            />
          </label>
          <label className="text-xs text-slate-700">
            Additional budget ({c})
            <input
              className={`${field} mt-1`}
              name="additional_budget"
              type="number"
              min="0"
              step="0.01"
              defaultValue="0"
            />
          </label>
          <label className="text-xs text-slate-700">
            Promise extension days
            <input
              className={`${field} mt-1`}
              name="due_date_extension_days"
              type="number"
              min="0"
              max="365"
              defaultValue="0"
            />
          </label>
          <div className="md:col-span-2 xl:col-span-5">
            <button
              disabled={simulationBusy}
              className="rounded bg-violet-800 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {simulationBusy ? "Simulating..." : "Simulate without saving"}
            </button>
          </div>
        </form>
        {simulation?.error && (
          <p className="mt-3 rounded bg-red-50 p-3 text-xs text-red-700">
            {simulation.error}
          </p>
        )}
        {simulation && !simulation.error && (
          <div className="mt-4 rounded-lg border border-violet-200 bg-white p-3">
            <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
              <K
                l="Scenario result"
                v={simulation.delivery_status.replaceAll("_", " ")}
                alert={simulation.delivery_status !== "ON_TIME"}
              />
              <K
                l="Projected completion"
                v={simulation.projected_completion_date}
              />
              <K l="Scenario promise" v={simulation.scenario_due_date} />
              <K l="Confidence" v={`${num(simulation.confidence_pct)}%`} />
              <K
                l="Residual capacity gap"
                v={`${num(simulation.residual_capacity_shortage_minutes / 60)} h`}
                alert={simulation.residual_capacity_shortage_minutes > 0}
              />
            </div>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
              <span>
                Capacity recovered:{" "}
                <b>{num(simulation.recovered_capacity_minutes / 60)} h</b>
              </span>
              <span>
                Remaining cash gap:{" "}
                <b>{money(simulation.residual_cash_gap, c)}</b>
              </span>
              <span>
                Risk score: <b>{num(simulation.risk_score)}/100</b>
              </span>
            </div>
            <p className="mt-3 text-xs font-semibold text-violet-900">
              {simulation.control}
            </p>
            {(simulation.warnings || []).map((warning: string) => (
              <p key={warning} className="mt-1 text-xs text-slate-500">
                {warning}
              </p>
            ))}
          </div>
        )}
      </div>
      <StageControls detail={detail} onReplan={onReplan} />
      <div className="rounded-xl border bg-white p-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <Factory size={17} />
          Finite-capacity multi-level stage plan
        </h2>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="p-2">Wave / item / stage</th>
                <th className="p-2">Station</th>
                <th className="p-2">Window</th>
                <th className="p-2 text-right">Qty / capacity</th>
                <th className="p-2 text-right">Yield / skill</th>
                <th className="p-2 text-right">Load</th>
                <th className="p-2">Control</th>
              </tr>
            </thead>
            <tbody>
              {detail.stages.map((x: any) => (
                <tr
                  key={x.id}
                  className={
                    x.is_bottleneck ? "border-b bg-amber-50" : "border-b"
                  }
                >
                  <td className="p-2">
                    <b>{x.stage_name}</b>
                    <small className="block text-slate-600">
                      {x.item_code || x.item_name || "Item"} · BOM level{" "}
                      {x.bom_level}
                    </small>
                    <small className="block">
                      Wave{" "}
                      {
                        detail.program.waves.find(
                          (w: any) => w.id === x.wave_id,
                        )?.wave_number
                      }{" "}
                      · {x.execution_mode}
                      {x.stage_group_code ? ` · ${x.stage_group_code}` : ""}
                    </small>
                  </td>
                  <td className="p-2">
                    {x.station?.station_name || "Unassigned"}
                    {x.is_bottleneck && (
                      <b className="block text-amber-700">BOTTLENECK</b>
                    )}
                    <small className="block max-w-xs text-slate-500">
                      {x.selected_resource_reason}
                    </small>
                  </td>
                  <td className="p-2">
                    {String(x.planned_start).slice(0, 10)} →{" "}
                    {String(x.planned_end).slice(0, 10)}
                  </td>
                  <td className="p-2 text-right">
                    {num(x.quantity)} units
                    <small className="block">
                      {num(x.required_capacity_minutes / 60)} h
                    </small>
                  </td>
                  <td className="p-2 text-right">
                    {num(x.yield_pct)}%
                    <small className="block">
                      Skill {num(x.skill_coverage_pct)}%
                    </small>
                  </td>
                  <td className="p-2 text-right">{num(x.load_percent)}%</td>
                  <td className="max-w-sm p-2 text-xs">{x.recommendation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold">
              <CalendarClock size={17} />
              Time-phased material and purchase plan
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Approved POs are date-netted. Supplier recommendations use
              item/vendor receipt lead time and on-time performance.
            </p>
          </div>
          <button
            type="button"
            onClick={onPrepareProposal}
            className="rounded bg-[#4A3526] px-3 py-2 text-xs font-semibold text-white"
          >
            Prepare PR proposal
          </button>
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="p-2">Material / pegging</th>
                <th className="p-2">Need by</th>
                <th className="p-2">Release</th>
                <th className="p-2 text-right">Gross</th>
                <th className="p-2 text-right">On hand</th>
                <th className="p-2 text-right">Inbound PO</th>
                <th className="p-2 text-right">Net</th>
                <th className="p-2">Lead / supplier</th>
                <th className="p-2">Action</th>
                <th className="p-2 text-right">Cash</th>
              </tr>
            </thead>
            <tbody>
              {detail.materials.map((x: any) => {
                const v = x.pegging?.supplier_recommendation;
                return (
                  <tr
                    key={x.id}
                    className={
                      ["CRITICAL", "HIGH"].includes(x.shortage_risk)
                        ? "border-b bg-red-50"
                        : "border-b"
                    }
                  >
                    <td className="p-2">
                      <b>{x.item_code || x.item_name}</b>
                      <small className="block text-slate-500">
                        Wave {x.pegging?.wave_number} · level {x.bom_level} ·{" "}
                        {x.shortage_risk}
                      </small>
                    </td>
                    <td className="p-2">{x.required_by}</td>
                    <td className="p-2">{x.recommended_release_date}</td>
                    <td className="p-2 text-right">
                      {num(x.gross_requirement)} {x.uom}
                    </td>
                    <td className="p-2 text-right">
                      {num(x.available_quantity)}
                    </td>
                    <td className="p-2 text-right">
                      {num(x.incoming_quantity)}
                    </td>
                    <td className="p-2 text-right font-semibold">
                      {num(x.net_requirement)}
                    </td>
                    <td className="p-2">
                      {num(x.lead_time_days)} days
                      <small className="block text-slate-500">
                        {v
                          ? `${v.vendor_name} · ${num(v.on_time_pct)}% on-time · n=${v.sample_count}`
                          : x.historical_lead_time_days
                            ? "Actual receipt median"
                            : "Item master"}
                      </small>
                    </td>
                    <td className="p-2">
                      <b>{String(x.supply_action).replaceAll("_", " ")}</b>
                      <small className="block max-w-xs text-slate-500">
                        {x.recommendation}
                      </small>
                    </td>
                    <td className="p-2 text-right">
                      {money(x.cash_required, c)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {proposal && (
          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3">
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <b>Controlled procurement proposal</b>
                <p className="text-xs text-blue-800">
                  {proposal.posting_control}
                </p>
              </div>
              <div className="text-right">
                <b>{money(proposal.estimated_value, proposal.currency_code)}</b>
                <button
                  type="button"
                  disabled={stale?.stale || !proposal.lines.length}
                  onClick={onCreateDraftPr}
                  className="ml-3 rounded bg-blue-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
                >
                  Create draft PR
                </button>
              </div>
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr>
                    <th className="p-1 text-left">Item</th>
                    <th className="p-1 text-right">Qty</th>
                    <th className="p-1">Supplier evidence</th>
                    <th className="p-1">Release</th>
                    <th className="p-1">Waves</th>
                    <th className="p-1">Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {proposal.lines.map((x: any) => (
                    <tr key={x.item_id}>
                      <td className="p-1">{x.item_code}</td>
                      <td className="p-1 text-right">
                        {num(x.quantity)} {x.uom}
                      </td>
                      <td className="p-1 text-center">
                        {x.supplier_recommendation?.vendor_name ||
                          "Buyer review"}
                      </td>
                      <td className="p-1 text-center">
                        {x.recommended_release_date}
                      </td>
                      <td className="p-1 text-center">{x.waves.join(", ")}</td>
                      <td className="p-1 text-center">{x.risk}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function StageControls({
  detail,
  onReplan,
}: {
  detail: any;
  onReplan: () => Promise<void>;
}) {
  const unique = Array.from(
    new Map(detail.stages.map((x: any) => [x.routing_id, x])).values(),
  ) as any[];
  const [rows, setRows] = useState<any[]>(
    unique.map((x) => ({
      routing_id: x.routing_id,
      stage_name: x.stage_name,
      stage_group_code: x.stage_group_code || "",
      execution_mode: x.execution_mode || "SEQUENTIAL",
      is_bottleneck: Boolean(x.is_bottleneck),
      transfer_batch_quantity: "",
      buffer_limit_quantity: "",
      efficiency_percent: "85",
    })),
  );
  const [saving, setSaving] = useState("");
  useEffect(
    () =>
      setRows(
        unique.map((x) => ({
          routing_id: x.routing_id,
          stage_name: x.stage_name,
          stage_group_code: x.stage_group_code || "",
          execution_mode: x.execution_mode || "SEQUENTIAL",
          is_bottleneck: Boolean(x.is_bottleneck),
          transfer_batch_quantity: "",
          buffer_limit_quantity: "",
          efficiency_percent: "85",
        })),
      ),
    [detail.run.id],
  );
  const patch = (id: string, key: string, value: any) =>
    setRows((all) =>
      all.map((x) => (x.routing_id === id ? { ...x, [key]: value } : x)),
    );
  const save = async (row: any) => {
    setSaving(row.routing_id);
    try {
      await apiClient.patch("/production-planning/stage-policies", {
        ...row,
        transfer_batch_quantity: row.transfer_batch_quantity
          ? Number(row.transfer_batch_quantity)
          : null,
        buffer_limit_quantity: row.buffer_limit_quantity
          ? Number(row.buffer_limit_quantity)
          : null,
        efficiency_percent: Number(row.efficiency_percent || 85),
        queue_minutes: 0,
        move_minutes: 0,
        wait_minutes: 0,
        overlap_percent: row.execution_mode === "OVERLAPPED" ? 50 : 0,
      });
      await onReplan();
    } finally {
      setSaving("");
    }
  };
  return (
    <div className="rounded-xl border border-[#E6D8C0] bg-[#FFFCF7] p-4">
      <h2 className="font-semibold">Stage grouping and flow controls</h2>
      <p className="mt-1 text-xs text-slate-500">
        Give stages the same group code to club related sub-assemblies. Choose
        parallel/overlapped execution, set transfer batches and cap WIP before
        rerunning the plan.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="border-b text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="p-2">Stage</th>
              <th className="p-2">Group</th>
              <th className="p-2">Execution</th>
              <th className="p-2">Transfer batch</th>
              <th className="p-2">WIP buffer</th>
              <th className="p-2">Efficiency %</th>
              <th className="p-2">Constraint</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.routing_id} className="border-b">
                <td className="p-2 font-medium">{row.stage_name}</td>
                <td className="p-1">
                  <input
                    aria-label={`${row.stage_name} group`}
                    className={field}
                    value={row.stage_group_code}
                    onChange={(e) =>
                      patch(row.routing_id, "stage_group_code", e.target.value)
                    }
                  />
                </td>
                <td className="p-1">
                  <select
                    aria-label={`${row.stage_name} execution`}
                    className={field}
                    value={row.execution_mode}
                    onChange={(e) =>
                      patch(row.routing_id, "execution_mode", e.target.value)
                    }
                  >
                    <option value="SEQUENTIAL">Sequential</option>
                    <option value="PARALLEL">Parallel</option>
                    <option value="OVERLAPPED">Overlapped</option>
                    <option value="SYNCHRONIZED">Synchronized finish</option>
                  </select>
                </td>
                <td className="p-1">
                  <input
                    aria-label={`${row.stage_name} transfer batch`}
                    className={field}
                    type="number"
                    min="0"
                    value={row.transfer_batch_quantity}
                    onChange={(e) =>
                      patch(
                        row.routing_id,
                        "transfer_batch_quantity",
                        e.target.value,
                      )
                    }
                  />
                </td>
                <td className="p-1">
                  <input
                    aria-label={`${row.stage_name} WIP buffer`}
                    className={field}
                    type="number"
                    min="0"
                    value={row.buffer_limit_quantity}
                    onChange={(e) =>
                      patch(
                        row.routing_id,
                        "buffer_limit_quantity",
                        e.target.value,
                      )
                    }
                  />
                </td>
                <td className="p-1">
                  <input
                    aria-label={`${row.stage_name} efficiency`}
                    className={field}
                    type="number"
                    min="1"
                    max="150"
                    value={row.efficiency_percent}
                    onChange={(e) =>
                      patch(
                        row.routing_id,
                        "efficiency_percent",
                        e.target.value,
                      )
                    }
                  />
                </td>
                <td className="p-2 text-center">
                  <input
                    aria-label={`${row.stage_name} bottleneck`}
                    type="checkbox"
                    checked={row.is_bottleneck}
                    onChange={(e) =>
                      patch(row.routing_id, "is_bottleneck", e.target.checked)
                    }
                  />
                </td>
                <td className="p-2">
                  <button
                    type="button"
                    disabled={saving === row.routing_id}
                    onClick={() => save(row)}
                    className="rounded border border-[#8B6844] px-3 py-2 text-xs font-semibold text-[#4A3526] disabled:opacity-50"
                  >
                    {saving === row.routing_id ? "Saving…" : "Save & replan"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function K({ l, v, alert = false }: { l: string; v: any; alert?: boolean }) {
  return (
    <div
      className={`rounded-xl border p-4 ${alert ? "border-red-200 bg-red-50" : "bg-white"}`}
    >
      <p className="flex items-center gap-1 text-xs text-slate-500">
        {alert && <AlertCircle size={13} />} {l}
      </p>
      <p className="mt-1 text-lg font-bold">{v}</p>
    </div>
  );
}
