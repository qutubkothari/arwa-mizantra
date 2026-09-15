"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiClient } from "../../../../../lib/api-client";

type Message = {
  id: string;
  direction?: string;
  contact_phone?: string;
  message_text?: string;
  status?: string;
  created_at?: string;
  session_name?: string;
  waha_message_id?: string;
  consent_checked?: boolean;
  media_type?: string;
};

export default function WhatsAppControlPage() {
  const [data, setData] = useState<any>({ messages: [], connection: null });
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [expanded, setExpanded] = useState<string | null>(null);
  const load = useCallback(
    () =>
      apiClient
        .get("/whatsapp/dashboard")
        .then(setData)
        .catch((e: any) => setNotice(e.message)),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  const connected = data.connection?.status === "READY";
  useEffect(() => {
    if (!qr || connected) return;
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, [qr, connected, load]);
  useEffect(() => {
    if (connected) setQr("");
  }, [connected]);
  const connect = async () => {
    setBusy(true);
    try {
      await apiClient.post("/whatsapp/connect", {});
      const pair = await apiClient.get("/whatsapp/qr");
      setQr(pair.qr_data_url || "");
      setNotice(
        "Session started. Scan the QR only from the company WhatsApp device.",
      );
      load();
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    setBusy(true);
    try {
      await apiClient.post("/whatsapp/disconnect", {});
      setNotice("WhatsApp session disconnected.");
      load();
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  const toggleAutomation = async () => {
    setBusy(true);
    try {
      const enabled = !data.connection?.automation_enabled;
      await apiClient.post("/whatsapp/automation", {
        enabled,
        confirm: enabled ? "ENABLE" : undefined,
      });
      setNotice(
        enabled
          ? "Approved automation rules can now deliver WhatsApp messages."
          : "WhatsApp automation has been disabled.",
      );
      load();
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  const toggleCrmCapture = async () => {
    setBusy(true);
    try {
      const enabled = !data.connection?.crm_capture_enabled;
      await apiClient.post("/whatsapp/crm-capture", {
        enabled,
        confirm: enabled ? "ENABLE" : undefined,
      });
      setNotice(
        enabled
          ? "New WhatsApp contacts will now become assigned CRM leads; later messages will stay in their activity history."
          : "WhatsApp CRM capture has been disabled.",
      );
      load();
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    setBusy(true);
    try {
      const result: any = await apiClient.post("/whatsapp/send", {
        phone,
        message,
        confirm: "SEND",
      });
      setMessage("");
      setNotice(
        `${result.sent_count} message${result.sent_count === 1 ? "" : "s"} sent${result.failed_count ? `; ${result.failed_count} failed` : ""}.`,
      );
      load();
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    if (
      !window.confirm(
        "Remove this message from the WhatsApp ledger? Audit history will be retained.",
      )
    )
      return;
    setBusy(true);
    try {
      await apiClient.delete(`/whatsapp/messages/${id}`);
      setNotice("Message removed from the ledger; audit history retained.");
      load();
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...(data.messages || [])]
      .filter(
        (x: Message) =>
          !query ||
          [x.contact_phone, x.message_text, x.direction, x.status].some((v) =>
            String(v || "")
              .toLowerCase()
              .includes(query),
          ),
      )
      .sort((a: Message, b: Message) =>
        sort === "oldest"
          ? Date.parse(a.created_at || "") - Date.parse(b.created_at || "")
          : sort === "recipient"
            ? String(a.contact_phone || "").localeCompare(
                String(b.contact_phone || ""),
              )
            : sort === "status"
              ? String(a.status || "").localeCompare(String(b.status || ""))
              : Date.parse(b.created_at || "") - Date.parse(a.created_at || ""),
      );
  }, [data.messages, search, sort]);
  return (
    <main className="mx-auto max-w-6xl space-y-5 p-6">
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-[#8B6F47]">
          Integration hub
        </p>
        <h1 className="text-2xl font-bold text-[#344C67]">
          WhatsApp business control
        </h1>
        <p className="text-sm text-slate-600">
          Tenant-isolated WAHA connection with audited, controlled ERP delivery
          and CRM intake.
        </p>
      </header>
      {notice && (
        <p className="rounded border bg-blue-50 p-3 text-sm text-blue-800">
          {notice}
        </p>
      )}
      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border bg-white p-5">
          <h2 className="font-semibold text-[#344C67]">Connection</h2>
          <p className="mt-2 text-sm text-slate-600">
            Status:{" "}
            <b>{connected ? "CONNECTED" : data.connection?.status || "DISCONNECTED"}</b>
          </p>
          {connected && (
            <p className="mt-1 text-sm text-slate-700">
              Connected number:{" "}
              <b>
                {data.connection?.phone_number
                  ? `+${data.connection.phone_number}`
                  : "Detecting from provider..."}
              </b>
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            QR pairing and provider credentials stay on the server.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              disabled={busy || connected}
              onClick={connect}
              className="rounded bg-[#344C67] px-3 py-2 text-sm text-white disabled:opacity-40"
            >
              Start / show QR
            </button>
            <button
              disabled={busy || !data.connection}
              onClick={disconnect}
              className="rounded border px-3 py-2 text-sm disabled:opacity-40"
            >
              Disconnect
            </button>
          </div>
          {qr && (
            <img
              src={qr}
              alt="WhatsApp pairing QR code"
              className="mt-4 h-52 w-52 rounded border p-2"
            />
          )}
        </div>
        <div className="rounded-xl border bg-[#FBF7EE] p-5">
          <h2 className="font-semibold text-[#344C67]">CRM lead capture</h2>
          <p className="mt-2 text-sm text-slate-700">
            Inbound capture:{" "}
            <b>
              {data.connection?.crm_capture_enabled ? "ENABLED" : "DISABLED"}
            </b>
          </p>
          <button
            disabled={busy || !connected}
            onClick={toggleCrmCapture}
            className="mt-3 rounded border px-3 py-2 text-sm disabled:opacity-40"
          >
            {data.connection?.crm_capture_enabled
              ? "Disable CRM capture"
              : "Enable CRM capture"}
          </button>
          <p className="mt-3 text-xs text-slate-600">
            The first message from a new contact creates and assigns one lead.
            Repeat messages are added to the same CRM timeline.
          </p>
        </div>
        <div className="rounded-xl border bg-[#FBF7EE] p-5">
          <h2 className="font-semibold text-[#344C67]">Automation safety</h2>
          <p className="mt-2 text-sm text-slate-700">
            Approved rule delivery:{" "}
            <b>
              {data.connection?.automation_enabled ? "ENABLED" : "DISABLED"}
            </b>
          </p>
          <button
            disabled={busy || !connected}
            onClick={toggleAutomation}
            className="mt-3 rounded border px-3 py-2 text-sm disabled:opacity-40"
          >
            {data.connection?.automation_enabled
              ? "Disable automation"
              : "Enable approved automation"}
          </button>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li>Every message is logged</li>
            <li>Only enabled, previewed rules can send</li>
            <li>No financial or stock posting</li>
          </ul>
        </div>
      </section>
      <section className="rounded-xl border bg-white p-5">
        <h2 className="font-semibold text-[#344C67]">
          Send a governed message
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-[280px_1fr_auto]">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="E.164 phone numbers, comma-separated"
            className="rounded border px-3 py-2 text-sm"
          />
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Message"
            className="rounded border px-3 py-2 text-sm"
          />
          <button
            disabled={busy || !connected || !phone || !message}
            onClick={send}
            className="rounded bg-[#80613B] px-4 py-2 text-sm text-white disabled:opacity-40"
          >
            Send
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Separate multiple numbers with commas or semicolons. Send only to
          consented contacts with approved content.
        </p>
      </section>
      <section className="rounded-xl border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-[#344C67]">Message ledger</h2>
            <p className="text-xs text-slate-500">
              {rows.length} visible message{rows.length === 1 ? "" : "s"} ·
              audit history is retained separately.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search recipient, text, status"
              className="rounded border px-3 py-2 text-sm"
            />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="rounded border px-3 py-2 text-sm"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="recipient">Recipient</option>
              <option value="status">Status</option>
            </select>
          </div>
        </div>
        {rows.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b bg-[#FBF7EE] text-xs uppercase text-[#7A6555]">
                <tr>
                  <th className="p-3">Direction</th>
                  <th className="p-3">Recipient</th>
                  <th className="p-3">Message / title</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Date</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x: Message) => (
                  <tr key={x.id} className="border-b align-top">
                    <td className="p-3 font-semibold">{x.direction || "—"}</td>
                    <td className="p-3">
                      ***{String(x.contact_phone || "").slice(-4)}
                    </td>
                    <td className="max-w-sm p-3">
                      <div className="truncate" title={x.message_text || ""}>
                        {x.message_text ||
                          (x.media_type ? `Media: ${x.media_type}` : "—")}
                      </div>
                      {expanded === x.id && (
                        <div className="mt-2 rounded bg-[#FBF7EE] p-2 text-xs text-[#6F5A48]">
                          Session: {x.session_name || "—"} · Provider ID:{" "}
                          {x.waha_message_id || "—"} · Consent checked:{" "}
                          {x.consent_checked ? "Yes" : "No"}
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <span className="rounded-full bg-[#EAF5EE] px-2 py-1 text-xs font-semibold text-[#237A45]">
                        {x.status || "—"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap p-3 text-xs text-slate-600">
                      {x.created_at
                        ? new Date(x.created_at).toLocaleString()
                        : "—"}
                    </td>
                    <td className="whitespace-nowrap p-3">
                      <button
                        onClick={() =>
                          setExpanded(expanded === x.id ? null : x.id)
                        }
                        className="mr-2 rounded border px-2 py-1 text-xs"
                      >
                        {expanded === x.id ? "Hide" : "Details"}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => remove(x.id)}
                        className="rounded border border-red-200 px-2 py-1 text-xs text-red-700 disabled:opacity-40"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">
            No messages match the current filter.
          </p>
        )}
      </section>
    </main>
  );
}
