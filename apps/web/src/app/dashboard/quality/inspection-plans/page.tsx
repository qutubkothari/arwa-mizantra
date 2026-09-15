"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";

type Parameter = {
  parameter_name: string;
  data_type: "NUMERIC" | "TEXT" | "PASS_FAIL";
  specification: string;
  unit_of_measure?: string;
  tolerance_min?: string | number | null;
  tolerance_max?: string | number | null;
  criticality: "MINOR" | "MAJOR" | "CRITICAL";
  is_mandatory: boolean;
};

type Plan = {
  id: string;
  plan_code: string;
  plan_name: string;
  inspection_type: string;
  revision: number;
  effective_from: string;
  effective_to?: string | null;
  sampling_method: string;
  sample_size: number;
  status: string;
  item_id?: string | null;
  parameters?: Parameter[];
};

type Item = {
  id: string;
  code?: string;
  item_code?: string;
  name?: string;
  item_name?: string;
};

const field =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600";
const blankParameter = (): Parameter => ({
  parameter_name: "",
  data_type: "NUMERIC",
  specification: "",
  unit_of_measure: "",
  tolerance_min: "",
  tolerance_max: "",
  criticality: "MAJOR",
  is_mandatory: true,
});

export default function InspectionPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    plan_code: "",
    plan_name: "",
    inspection_type: "INCOMING",
    item_id: "",
    revision: 1,
    effective_from: new Date().toISOString().slice(0, 10),
    effective_to: "",
    sampling_method: "FIXED",
    sample_size: 1,
  });
  const [parameters, setParameters] = useState<Parameter[]>([blankParameter()]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [planRows, itemResponse] = await Promise.all([
        apiClient.get<Plan[]>("/quality/plans"),
        apiClient
          .get<any>("/inventory/items?onlyVerified=true")
          .catch(() => []),
      ]);
      setPlans(Array.isArray(planRows) ? planRows : []);
      const rawItems = Array.isArray(itemResponse)
        ? itemResponse
        : itemResponse?.items || itemResponse?.data || [];
      setItems(Array.isArray(rawItems) ? rawItems : []);
    } catch (caught: any) {
      setError(caught?.message || "Unable to load inspection plans.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(
    () => ({
      approved: plans.filter((plan) => plan.status === "APPROVED").length,
      draft: plans.filter((plan) => plan.status === "DRAFT").length,
      critical: plans.reduce(
        (count, plan) =>
          count +
          (plan.parameters || []).filter(
            (parameter) => parameter.criticality === "CRITICAL",
          ).length,
        0,
      ),
    }),
    [plans],
  );

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await apiClient.post("/quality/plans", {
        ...form,
        item_id: form.item_id || null,
        effective_to: form.effective_to || null,
        parameters,
      });
      setMessage(
        "Draft inspection-plan revision created. A different user must approve it before use.",
      );
      setShowCreate(false);
      setParameters([blankParameter()]);
      setForm((current) => ({
        ...current,
        plan_code: "",
        plan_name: "",
        item_id: "",
        revision: 1,
      }));
      await load();
    } catch (caught: any) {
      setError(caught?.message || "Unable to create inspection plan.");
    } finally {
      setSaving(false);
    }
  };

  const approve = async (plan: Plan) => {
    const approval_note = window.prompt(
      `Approval rationale for ${plan.plan_code} revision ${plan.revision}`,
    );
    if (!approval_note) return;
    try {
      await apiClient.post(`/quality/plans/${plan.id}/approve`, {
        approval_note,
      });
      setMessage("Inspection plan approved and frozen for use.");
      await load();
    } catch (caught: any) {
      setError(caught?.message || "Unable to approve inspection plan.");
    }
  };

  const retire = async (plan: Plan) => {
    if (
      !window.confirm(
        `Retire ${plan.plan_code} revision ${plan.revision}? Existing inspection snapshots remain unchanged.`,
      )
    )
      return;
    try {
      await apiClient.post(`/quality/plans/${plan.id}/retire`, {});
      setMessage(
        "Inspection plan retired. Historical inspection evidence is preserved.",
      );
      await load();
    } catch (caught: any) {
      setError(caught?.message || "Unable to retire inspection plan.");
    }
  };

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-2 sm:p-4">
      <header className="rounded-2xl bg-gradient-to-r from-[#174C43] to-[#2D7669] p-6 text-white shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-emerald-100">
              <ShieldCheck size={18} /> Governed quality master data
            </div>
            <h1 className="mt-1 text-2xl font-bold">Inspection Plans</h1>
            <p className="mt-2 max-w-3xl text-sm text-emerald-50">
              Create effective-dated incoming, in-process and final inspection
              standards. Approved revisions are frozen and copied into each new
              inspection as evidence.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowCreate((value) => !value)}
              className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-emerald-900"
            >
              <Plus size={16} /> New revision
            </button>
            <button
              onClick={load}
              className="rounded-lg bg-white/15 p-2"
              aria-label="Refresh"
            >
              {loading ? (
                <Loader2 className="animate-spin" size={18} />
              ) : (
                <RefreshCw size={18} />
              )}
            </button>
          </div>
        </div>
      </header>
      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <section className="grid gap-3 sm:grid-cols-3">
        <Metric label="Approved revisions" value={summary.approved} />
        <Metric label="Drafts awaiting approval" value={summary.draft} />
        <Metric label="Critical checks defined" value={summary.critical} />
      </section>

      {showCreate && (
        <form
          onSubmit={save}
          className="space-y-4 rounded-xl border bg-white p-5 shadow-sm"
        >
          <div>
            <h2 className="font-semibold">Create draft plan revision</h2>
            <p className="text-xs text-slate-500">
              Approval is independent. Editing an approved revision is
              intentionally unavailable.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <input
              required
              className={field}
              placeholder="Plan code"
              value={form.plan_code}
              onChange={(e) => setForm({ ...form, plan_code: e.target.value })}
            />
            <input
              required
              className={field}
              placeholder="Plan name"
              value={form.plan_name}
              onChange={(e) => setForm({ ...form, plan_name: e.target.value })}
            />
            <select
              className={field}
              value={form.inspection_type}
              onChange={(e) =>
                setForm({ ...form, inspection_type: e.target.value })
              }
            >
              <option>INCOMING</option>
              <option>IN_PROCESS</option>
              <option>FINAL</option>
            </select>
            <input
              required
              min="1"
              type="number"
              className={field}
              value={form.revision}
              onChange={(e) =>
                setForm({ ...form, revision: Number(e.target.value) })
              }
              placeholder="Revision"
            />
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <select
              className={field}
              value={form.item_id}
              onChange={(e) => setForm({ ...form, item_id: e.target.value })}
            >
              <option value="">Generic for inspection type</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code || item.item_code || "Item"} ·{" "}
                  {item.name || item.item_name || item.id}
                </option>
              ))}
            </select>
            <input
              required
              type="date"
              className={field}
              value={form.effective_from}
              onChange={(e) =>
                setForm({ ...form, effective_from: e.target.value })
              }
            />
            <input
              type="date"
              className={field}
              value={form.effective_to}
              onChange={(e) =>
                setForm({ ...form, effective_to: e.target.value })
              }
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                className={field}
                value={form.sampling_method}
                onChange={(e) =>
                  setForm({ ...form, sampling_method: e.target.value })
                }
              >
                <option>FIXED</option>
                <option>PERCENTAGE</option>
                <option>FULL</option>
                <option>AQL</option>
              </select>
              <input
                required
                min="0.0001"
                step="0.0001"
                type="number"
                className={field}
                value={form.sample_size}
                onChange={(e) =>
                  setForm({ ...form, sample_size: Number(e.target.value) })
                }
              />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Inspection parameters</h3>
              <button
                type="button"
                className="text-sm font-medium text-emerald-700"
                onClick={() => setParameters([...parameters, blankParameter()])}
              >
                + Add parameter
              </button>
            </div>
            {parameters.map((parameter, index) => (
              <div
                key={index}
                className="grid gap-2 rounded-lg bg-slate-50 p-3 md:grid-cols-7"
              >
                <input
                  required
                  className={field}
                  placeholder="Parameter"
                  value={parameter.parameter_name}
                  onChange={(e) =>
                    setParameters(
                      parameters.map((row, i) =>
                        i === index
                          ? { ...row, parameter_name: e.target.value }
                          : row,
                      ),
                    )
                  }
                />
                <select
                  className={field}
                  value={parameter.data_type}
                  onChange={(e) =>
                    setParameters(
                      parameters.map((row, i) =>
                        i === index
                          ? {
                              ...row,
                              data_type: e.target
                                .value as Parameter["data_type"],
                            }
                          : row,
                      ),
                    )
                  }
                >
                  <option>NUMERIC</option>
                  <option>TEXT</option>
                  <option>PASS_FAIL</option>
                </select>
                <input
                  required
                  className={`${field} md:col-span-2`}
                  placeholder="Specification"
                  value={parameter.specification}
                  onChange={(e) =>
                    setParameters(
                      parameters.map((row, i) =>
                        i === index
                          ? { ...row, specification: e.target.value }
                          : row,
                      ),
                    )
                  }
                />
                <input
                  className={field}
                  placeholder="UOM"
                  value={parameter.unit_of_measure || ""}
                  onChange={(e) =>
                    setParameters(
                      parameters.map((row, i) =>
                        i === index
                          ? { ...row, unit_of_measure: e.target.value }
                          : row,
                      ),
                    )
                  }
                />
                <select
                  className={field}
                  value={parameter.criticality}
                  onChange={(e) =>
                    setParameters(
                      parameters.map((row, i) =>
                        i === index
                          ? {
                              ...row,
                              criticality: e.target
                                .value as Parameter["criticality"],
                            }
                          : row,
                      ),
                    )
                  }
                >
                  <option>MINOR</option>
                  <option>MAJOR</option>
                  <option>CRITICAL</option>
                </select>
                <button
                  type="button"
                  disabled={parameters.length === 1}
                  className="text-xs text-red-600 disabled:opacity-30"
                  onClick={() =>
                    setParameters(parameters.filter((_, i) => i !== index))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <button
            disabled={saving}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Create draft revision"}
          </button>
        </form>
      )}

      <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
        <div className="border-b p-4">
          <h2 className="font-semibold">Plan revision register</h2>
          <p className="text-xs text-slate-500">
            Item-specific plans take priority over generic plans. The highest
            effective approved revision is selected automatically.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3">Plan / revision</th>
                <th className="p-3">Scope</th>
                <th className="p-3">Effective</th>
                <th className="p-3">Sampling</th>
                <th className="p-3">Checks</th>
                <th className="p-3">Status / action</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.id} className="border-b align-top">
                  <td className="p-3">
                    <b>
                      {plan.plan_code} · R{plan.revision}
                    </b>
                    <span className="block text-slate-500">
                      {plan.plan_name}
                    </span>
                  </td>
                  <td className="p-3">
                    {plan.inspection_type}
                    <span className="block text-xs text-slate-500">
                      {plan.item_id ? "Item-specific" : "Generic"}
                    </span>
                  </td>
                  <td className="p-3">
                    {plan.effective_from}
                    <span className="block text-xs text-slate-500">
                      to {plan.effective_to || "open-ended"}
                    </span>
                  </td>
                  <td className="p-3">
                    {plan.sampling_method}
                    <span className="block text-xs text-slate-500">
                      {plan.sample_size}
                      {plan.sampling_method === "PERCENTAGE" ? "%" : " sample"}
                    </span>
                  </td>
                  <td className="p-3">
                    {plan.parameters?.length || 0}
                    <span className="block text-xs text-red-700">
                      {
                        (plan.parameters || []).filter(
                          (parameter) => parameter.criticality === "CRITICAL",
                        ).length
                      }{" "}
                      critical
                    </span>
                  </td>
                  <td className="p-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${plan.status === "APPROVED" ? "bg-emerald-100 text-emerald-800" : plan.status === "DRAFT" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}
                    >
                      {plan.status}
                    </span>
                    <div className="mt-2">
                      {plan.status === "DRAFT" && (
                        <button
                          onClick={() => approve(plan)}
                          className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs"
                        >
                          <CheckCircle2 size={13} /> Approve
                        </button>
                      )}
                      {plan.status === "APPROVED" && (
                        <button
                          onClick={() => retire(plan)}
                          className="rounded border px-2 py-1 text-xs"
                        >
                          Retire
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !plans.length && (
            <p className="p-8 text-center text-sm text-slate-500">
              No inspection plans yet. Create the first draft revision.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold text-slate-800">{value}</div>
    </div>
  );
}
