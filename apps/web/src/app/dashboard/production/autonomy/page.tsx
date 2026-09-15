"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useState } from "react";
import {
  Activity,
  Bot,
  Camera,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";

const field =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
const number = (value: any) =>
  new Intl.NumberFormat("en-AE", { maximumFractionDigits: 2 }).format(
    Number(value || 0),
  );
const money = (value: any) =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

export default function ProductionAutonomyPage() {
  const [tower, setTower] = useState<any>({
    kpis: {},
    actions: [],
    aps_recommendations: [],
    vision_inspections: [],
    cost: { stations: [] },
  });
  const [stations, setStations] = useState<any[]>([]);
  const [gateways, setGateways] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [control, workStations, registeredGateways] = await Promise.all([
        apiClient.get("/production-autonomy/control-tower"),
        apiClient.get("/production/work-stations"),
        apiClient.get("/production-device-gateways"),
      ]);
      setTower(control);
      setStations(workStations || []);
      setGateways(registeredGateways || []);
    } catch (error: any) {
      setMessage(error?.message || "Unable to load production control tower.");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const action = async (url: string, success: string) => {
    try {
      setBusy(true);
      const result = await apiClient.post(url, {});
      setMessage(
        `${success} ${result?.created != null ? `(${result.created} created)` : ""}`,
      );
      await load();
    } catch (error: any) {
      setMessage(error?.message || "Action failed.");
    } finally {
      setBusy(false);
    }
  };
  const submit =
    (url: string, success: string) =>
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      try {
        setBusy(true);
        const payload: any = Object.fromEntries(
          new FormData(event.currentTarget),
        );
        if ("confidence_pct" in payload)
          payload.confidence_pct = Number(payload.confidence_pct);
        if ("quantity" in payload && payload.quantity !== "")
          payload.quantity = Number(payload.quantity);
        if ("cost_per_kwh" in payload)
          payload.cost_per_kwh = Number(payload.cost_per_kwh);
        if ("carbon_kg_per_kwh" in payload)
          payload.carbon_kg_per_kwh = Number(payload.carbon_kg_per_kwh);
        await apiClient.post(url, payload);
        event.currentTarget.reset();
        setMessage(success);
        await load();
      } catch (error: any) {
        setMessage(error?.message || "Unable to save.");
      } finally {
        setBusy(false);
      }
    };
  const submitGateway = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setBusy(true);
      const payload: any = Object.fromEntries(
        new FormData(event.currentTarget),
      );
      payload.field_mapping = payload.field_mapping
        ? JSON.parse(payload.field_mapping)
        : {};
      await apiClient.post("/production-device-gateways", payload);
      event.currentTarget.reset();
      setMessage(
        "Test gateway registered. Submit its mapping for independent activation only after a successful controlled test.",
      );
      await load();
    } catch (error: any) {
      setMessage(
        error instanceof SyntaxError
          ? 'Field mapping must be valid JSON, for example {"machine_code":"machine"}.'
          : error?.message || "Unable to register gateway.",
      );
    } finally {
      setBusy(false);
    }
  };
  const gatewayAction = async (
    id: string,
    action: "submit-activation" | "activation-decision",
    body: any,
    success: string,
  ) => {
    try {
      setBusy(true);
      await apiClient.post(`/production-device-gateways/${id}/${action}`, body);
      setMessage(success);
      await load();
    } catch (error: any) {
      setMessage(error?.message || "Gateway action failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-3 sm:p-5">
      <header className="rounded-2xl bg-gradient-to-r from-slate-950 via-slate-800 to-cyan-900 p-6 text-white">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-cyan-200">
              <Bot size={18} />
              Autonomous Factory Value Loop
            </div>
            <h1 className="mt-2 text-2xl font-bold">
              Production Autonomy Control Tower
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-200">
              Machine and operator evidence becomes a controlled recommendation,
              verified operational outcome, and cost/carbon intelligence.
              Nothing safety-critical is auto-executed.
            </p>
          </div>
          <button
            onClick={load}
            aria-label="Refresh"
            className="rounded-lg border border-white/30 p-2"
          >
            <RefreshCw size={19} className={busy ? "animate-spin" : ""} />
          </button>
        </div>
      </header>
      {message && (
        <p className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-sm text-cyan-900">
          {message}
        </p>
      )}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <K
          icon={<Activity />}
          label="Machine alerts"
          value={tower.kpis.open_machine_alerts}
        />
        <K
          icon={<ShieldCheck />}
          label="Open exceptions"
          value={tower.kpis.open_exceptions}
        />
        <K
          icon={<Bot />}
          label="MES stations"
          value={tower.kpis.active_mes_runs}
        />
        <K
          icon={<Wrench />}
          label="Energy cost"
          value={money(tower.kpis.energy_cost)}
        />
        <K
          icon={<Activity />}
          label="Carbon kg"
          value={number(tower.kpis.carbon_kg)}
        />
        <K
          icon={<Camera />}
          label="Vision checks"
          value={tower.kpis.vision_inspections}
        />
      </section>
      <section className="grid gap-3 lg:grid-cols-4">
        <button
          onClick={() =>
            action(
              "/production-autonomy/exceptions/generate",
              "Machine-alert exceptions refreshed.",
            )
          }
          className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
        >
          Generate exceptions
        </button>
        <button
          onClick={() =>
            action(
              "/production-autonomy/aps/run",
              "APS dispatch proposals refreshed.",
            )
          }
          className="rounded-xl bg-cyan-700 px-4 py-3 text-sm font-semibold text-white"
        >
          Run constraint APS
        </button>
        <button
          onClick={() =>
            action(
              "/production-autonomy/predictive-maintenance/dispatch",
              "Predictive maintenance dispatch complete.",
            )
          }
          className="rounded-xl bg-amber-600 px-4 py-3 text-sm font-semibold text-white"
        >
          Create predictive WOs
        </button>
        <a
          href="/dashboard/production/oee"
          className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-center text-sm font-semibold text-slate-800"
        >
          Open OEE loss control
        </a>
      </section>
      <div className="grid gap-5 xl:grid-cols-3">
        <form
          onSubmit={submit(
            "/production-autonomy/mes-events",
            "MES event recorded.",
          )}
          className="space-y-2 rounded-xl border bg-white p-4"
        >
          <h2 className="font-semibold">Shop-floor MES event</h2>
          <select required name="work_station_id" className={field}>
            <option value="">Work station</option>
            {stations.map((x) => (
              <option key={x.id} value={x.id}>
                {x.station_code} - {x.station_name}
              </option>
            ))}
          </select>
          <select required name="event_type" className={field}>
            <option>START</option>
            <option>PAUSE</option>
            <option>RESUME</option>
            <option>COMPLETE</option>
            <option>MATERIAL_SCAN</option>
            <option>QC_HOLD</option>
            <option>FIRST_PIECE_APPROVED</option>
          </select>
          <input
            name="barcode"
            className={field}
            placeholder="Barcode / scan evidence"
          />
          <input
            name="reason_code"
            className={field}
            placeholder="Reason code (required for QC hold)"
          />
          <input
            name="quantity"
            type="number"
            min="0"
            step="0.001"
            className={field}
            placeholder="Quantity"
          />
          <button className="rounded bg-slate-900 px-3 py-2 text-sm text-white">
            Record event
          </button>
        </form>
        <form
          onSubmit={submit(
            "/production-autonomy/vision-inspections",
            "Vision inspection recorded and exception raised if needed.",
          )}
          className="space-y-2 rounded-xl border bg-white p-4"
        >
          <h2 className="font-semibold">Vision quality gateway</h2>
          <select required name="work_station_id" className={field}>
            <option value="">Work station</option>
            {stations.map((x) => (
              <option key={x.id} value={x.id}>
                {x.station_code} - {x.station_name}
              </option>
            ))}
          </select>
          <input
            required
            name="source_image_reference"
            className={field}
            placeholder="Camera image/evidence reference"
          />
          <select name="inspection_type" className={field}>
            <option>LABEL</option>
            <option>PACKING</option>
            <option>DIMENSION</option>
            <option>DEFECT</option>
          </select>
          <select name="verdict" className={field}>
            <option>PASS</option>
            <option>FAIL</option>
            <option>REVIEW</option>
          </select>
          <input
            required
            name="confidence_pct"
            type="number"
            min="0"
            max="100"
            defaultValue="95"
            className={field}
            placeholder="Confidence %"
          />
          <button className="rounded bg-cyan-700 px-3 py-2 text-sm text-white">
            Submit camera result
          </button>
        </form>
        <form
          onSubmit={submit(
            "/production-autonomy/energy-tariffs",
            "Energy tariff saved.",
          )}
          className="space-y-2 rounded-xl border bg-white p-4"
        >
          <h2 className="font-semibold">Energy and carbon baseline</h2>
          <select required name="work_station_id" className={field}>
            <option value="">Work station</option>
            {stations.map((x) => (
              <option key={x.id} value={x.id}>
                {x.station_code} - {x.station_name}
              </option>
            ))}
          </select>
          <input
            required
            name="cost_per_kwh"
            type="number"
            min="0"
            step="0.0001"
            className={field}
            placeholder="AED per kWh"
          />
          <input
            required
            name="carbon_kg_per_kwh"
            type="number"
            min="0"
            step="0.000001"
            defaultValue="0.4"
            className={field}
            placeholder="kg CO2e per kWh"
          />
          <button className="rounded bg-emerald-700 px-3 py-2 text-sm text-white">
            Save energy baseline
          </button>
        </form>
      </div>
      <form
        onSubmit={submitGateway}
        className="grid gap-2 rounded-xl border bg-white p-4 md:grid-cols-6"
      >
        <div className="md:col-span-6">
          <h2 className="font-semibold">Device gateway registration</h2>
          <p className="mt-1 text-xs text-slate-500">
            Credentials are never entered here: use a vault reference and let
            the PLC/camera/meter gateway call the authenticated telemetry API.
            Every mapping starts in test mode and needs an independent approval
            before it can become a live source.
          </p>
        </div>
        <input
          required
          name="gateway_code"
          className={field}
          placeholder="Gateway code"
        />
        <input
          required
          name="gateway_name"
          className={field}
          placeholder="Gateway name"
        />
        <select required name="protocol" className={field}>
          <option>HTTPS_WEBHOOK</option>
          <option>MQTT</option>
          <option>OPC_UA</option>
          <option>MODBUS</option>
          <option>FILE</option>
        </select>
        <input
          name="endpoint_reference"
          className={field}
          placeholder="Endpoint reference"
        />
        <input
          name="secret_reference"
          className={field}
          placeholder="Vault secret reference"
        />
        <input
          name="field_mapping"
          className={field}
          placeholder='Mapping JSON, e.g. {"machine_code":"machine"}'
        />
        <button className="rounded bg-slate-900 px-3 py-2 text-sm text-white">
          Register test gateway
        </button>
      </form>
      <section className="rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Gateway activation register</h2>
            <p className="mt-1 text-xs text-slate-500">
              Live telemetry requires a separate mapping approval. Material,
              finished-goods, rejection and dispatch events remain in the
              controlled review queue.
            </p>
          </div>
          <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold">
            {gateways.length} registered
          </span>
        </div>
        <div className="mt-3 space-y-2">
          {gateways.map((gateway) => (
            <div
              key={gateway.id}
              className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm"
            >
              <div>
                <b>
                  {gateway.gateway_code} · {gateway.gateway_name}
                </b>
                <p className="mt-1 text-xs text-slate-500">
                  {gateway.protocol} · {gateway.health} · mapping v
                  {gateway.mapping_version || 1} ·{" "}
                  {gateway.mapping_approval_status || "DRAFT"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {["DRAFT", "REJECTED", "REVOKED"].includes(
                  gateway.mapping_approval_status || "DRAFT",
                ) && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      gatewayAction(
                        gateway.id,
                        "submit-activation",
                        {},
                        "Gateway mapping submitted for independent approval.",
                      )
                    }
                    className="rounded border border-cyan-700 px-2 py-1 text-xs font-semibold text-cyan-800"
                  >
                    Submit mapping
                  </button>
                )}
                {gateway.mapping_approval_status === "SUBMITTED" && (
                  <>
                    <button
                      disabled={busy}
                      onClick={() =>
                        gatewayAction(
                          gateway.id,
                          "activation-decision",
                          { decision: "APPROVE" },
                          "Gateway mapping approved and live telemetry enabled.",
                        )
                      }
                      className="rounded bg-emerald-700 px-2 py-1 text-xs font-semibold text-white"
                    >
                      Approve live mapping
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        gatewayAction(
                          gateway.id,
                          "activation-decision",
                          { decision: "REJECT" },
                          "Gateway mapping rejected and paused.",
                        )
                      }
                      className="rounded border border-red-300 px-2 py-1 text-xs font-semibold text-red-800"
                    >
                      Reject
                    </button>
                  </>
                )}
                {gateway.mapping_approval_status === "APPROVED" && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      gatewayAction(
                        gateway.id,
                        "activation-decision",
                        { decision: "REVOKE" },
                        "Gateway live activation revoked and paused.",
                      )
                    }
                    className="rounded border border-amber-400 px-2 py-1 text-xs font-semibold text-amber-900"
                  >
                    Revoke live mapping
                  </button>
                )}
              </div>
            </div>
          ))}
          {!gateways.length && (
            <Empty text="No device gateway registered. Start with a test gateway and a vault reference; do not put credentials in Mizantra." />
          )}
        </div>
      </section>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Exception worklist">
          {tower.actions.length ? (
            tower.actions.slice(0, 15).map((x: any) => (
              <div
                key={`${x.source}-${x.id}`}
                className="border-b py-3 text-sm"
              >
                <div className="flex justify-between gap-3">
                  <b>{x.title}</b>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">
                    {x.source} / {x.priority}
                  </span>
                </div>
                <p className="mt-1 text-slate-600">{x.action}</p>
              </div>
            ))
          ) : (
            <Empty text="No open exceptions or dispatch proposals." />
          )}
        </Panel>
        <Panel title="Energy, carbon and quality loss evidence">
          {tower.cost.stations?.length ? (
            tower.cost.stations.map((x: any) => (
              <div
                key={x.work_station_id}
                className="flex justify-between border-b py-3 text-sm"
              >
                <span>{x.work_station_id.slice(0, 8)}</span>
                <span>
                  {number(x.energy_kwh)} kWh · {money(x.energy_cost)} ·{" "}
                  {number(x.carbon_kg)} kg
                </span>
              </div>
            ))
          ) : (
            <Empty text="Add telemetry energy events and an energy tariff to calculate per-station cost/carbon." />
          )}
        </Panel>
      </div>
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        {tower.safety ||
          "APS, quality and maintenance remain controlled recommendations. Connect approved PLC, camera, scanner and energy-meter gateways for live production use."}
      </p>
    </main>
  );
}
function K({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: any;
}) {
  return (
    <div className="rounded-xl border bg-white p-3">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-xl font-bold text-slate-900">
        {number(value)}
      </div>
    </div>
  );
}
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-white p-4">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}
function Empty({ text }: { text: string }) {
  return <p className="py-5 text-sm text-slate-500">{text}</p>;
}
