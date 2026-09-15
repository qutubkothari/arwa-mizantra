"use client";

import { useState, useEffect } from "react";
import { hasModulePermission, readStoredUser } from "@/lib/rbac";
import { apiClient } from "../../../../lib/api-client";

interface Operation {
  id: string;
  production_order_id: string;
  routing_id: string;
  order_number: string;
  item_name: string;
  sequence_no: number;
  operation_name: string;
  quantity_required: number;
  quantity_remaining: number;
  input_available: number;
  ready: boolean;
  blocked_reason: string | null;
  cycle_time_minutes: number;
  setup_time_minutes: number;
  priority: string;
  start_date: string;
  operation_dispatch_id?: string | null;
  dispatch_number?: string | null;
  assigned_quantity?: number | null;
}

interface ActiveOperation {
  id: string;
  production_order_id: string;
  routing_id: string;
  work_station_id: string;
  sequence_no?: number;
  quantity_completed: number;
  quantity_rejected: number;
  start_time: string;
  notes: string | null;
  pause_loss_category?: string | null;
  pause_reason?: string | null;
  status: string;
  required_tool_codes?: string[];
  tool_assignments?: any[];
  tooling_candidates?: any[];
  job_order_number?: string | null;
  production_order_number?: string | null;
  item_code?: string | null;
  item_name?: string | null;
  uom?: string | null;
  operation_name?: string | null;
  work_station_code?: string | null;
  work_station_name?: string | null;
  work_station_type?: string | null;
  planned_quantity?: number;
  completed_before?: number;
  quantity_remaining?: number;
  input_available?: number;
  quantity_to_produce?: number;
}

interface PartialDecision {
  id: string;
  planned_quantity: number;
  good_quantity: number;
  rejected_quantity: number;
  processed_quantity: number;
  remaining_quantity: number;
  material_reconciliation?: Array<{
    item_id: string;
    item_code: string;
    item_name: string;
    uom: string;
    planned_quantity: number;
    standard_used_to_date: number;
    expected_balance: number;
    recorded_consumed_quantity: number;
  }>;
  actual_evidence?: {
    input_kg?: number | null;
    scrap_kg?: number | null;
    runtime_minutes?: number | null;
  };
}

interface JobMachine {
  id: string;
  name: string;
  type: string;
  operations: string[];
}

export default function ShopFloorPage() {
  const [currentUser, setCurrentUser] =
    useState<ReturnType<typeof readStoredUser>>(null);
  const canStartOperation = hasModulePermission(
    currentUser,
    "Production",
    "create",
  );
  const canUpdateOperation = hasModulePermission(
    currentUser,
    "Production",
    "edit",
  );
  const [workStations, setWorkStations] = useState<any[]>([]);
  const [selectedStation, setSelectedStation] = useState<string>("");
  const [focusedJob, setFocusedJob] = useState<{
    id: string;
    number: string;
    itemName: string;
    machines: JobMachine[];
    unassignedOperations: string[];
  } | null>(null);
  const [queue, setQueue] = useState<Operation[]>([]);
  const [activeOperation, setActiveOperation] =
    useState<ActiveOperation | null>(null);
  const [loading, setLoading] = useState(false);
  const [showRunDetails, setShowRunDetails] = useState(false);
  const [showDowntime, setShowDowntime] = useState(false);
  const [showFullQueue, setShowFullQueue] = useState(false);
  const [partialDecision, setPartialDecision] =
    useState<PartialDecision | null>(null);
  const [balanceReason, setBalanceReason] = useState("");
  const [nextProductionDate, setNextProductionDate] = useState("");

  // Completion form state
  const [quantityCompleted, setQuantityCompleted] = useState<number>(0);
  const [quantityRejected, setQuantityRejected] = useState<number>(0);
  const [quantityRework, setQuantityRework] = useState<number>(0);
  const [notes, setNotes] = useState<string>("");
  const [pauseCategory, setPauseCategory] = useState<string>("ROLL_CHANGE");
  const [pauseReason, setPauseReason] = useState<string>("");
  const [pauseEvidence, setPauseEvidence] = useState<string>("");
  const [actualInputKg, setActualInputKg] = useState<string>("");
  const [actualScrapKg, setActualScrapKg] = useState<string>("");
  const [machineStrokes, setMachineStrokes] = useState<string>("");
  const [batchCount, setBatchCount] = useState<string>("");
  const [changingAssignmentId, setChangingAssignmentId] = useState("");
  const [replacementToolId, setReplacementToolId] = useState("");
  const [outgoingToolUsage, setOutgoingToolUsage] = useState("");
  const [toolChangeReason, setToolChangeReason] = useState("");
  const [toolChangeEvidence, setToolChangeEvidence] = useState("");

  useEffect(() => {
    setCurrentUser(readStoredUser());
    fetchWorkStations();
    fetchActiveOperation();
    fetchFocusedJob();
  }, []);

  useEffect(() => {
    if (selectedStation) {
      fetchQueue();
    }
  }, [selectedStation, focusedJob?.number]);

  const selectNextReadyMachine = async (
    jobId: string,
    jobNumber: string,
    machines: JobMachine[],
    afterSequence = 0,
  ) => {
    if (!jobNumber || !machines.length) return false;
    try {
      const result = await apiClient.get(
        `/production/completions/job-order/${jobId}/queue?afterSequence=${afterSequence}`,
      );
      if (result?.recommended?.work_station_id) {
        setSelectedStation(String(result.recommended.work_station_id));
        return true;
      }
    } catch {
      // Fall through to station-by-station discovery for rolling deployments.
    }
    const stationQueues = await Promise.all(
      machines.map(async (machine) => {
        try {
          const data = await apiClient.get(
            `/production/completions/station/${machine.id}/queue`,
          );
          const rows = Array.isArray(data) ? data : data?.data || [];
          return rows
            .filter(
              (operation: Operation) =>
                String(operation.order_number) === jobNumber && operation.ready,
            )
            .map((operation: Operation) => ({
              machineId: machine.id,
              operation,
            }));
        } catch {
          return [];
        }
      }),
    );
    const ready = stationQueues.flat().sort((left, right) => {
      const leftSequence = Number(left.operation.sequence_no || 0);
      const rightSequence = Number(right.operation.sequence_no || 0);
      const leftIsDownstream = leftSequence > afterSequence ? 0 : 1;
      const rightIsDownstream = rightSequence > afterSequence ? 0 : 1;
      return leftIsDownstream - rightIsDownstream || leftSequence - rightSequence;
    });
    if (!ready.length) return false;
    setSelectedStation(ready[0].machineId);
    return true;
  };

  const fetchFocusedJob = async () => {
    const params = new URLSearchParams(window.location.search);
    const jobId = String(params.get("jobId") || "").trim();
    if (!jobId) return;

    try {
      const job = await apiClient.get(`/job-orders/${jobId}`);
      const operations = Array.isArray(job?.operations) ? job.operations : [];
      const stationMap = new Map<string, JobMachine>();
      const unassignedOperations: string[] = [];

      for (const operation of operations) {
        const operationName = String(
          operation?.operationName || operation?.operation_name || "Operation",
        );
        const plannedDispatches = Array.isArray(operation?.dispatches)
          ? operation.dispatches.filter((dispatch: any) =>
              ["DISPATCHED", "IN_PROGRESS", "PARTIALLY_COMPLETED"].includes(
                String(dispatch?.status || ""),
              ),
            )
          : [];
        const eligibleStations = plannedDispatches.length
          ? plannedDispatches.map((dispatch: any) => ({
              id: dispatch?.work_station_id,
              name:
                dispatch?.work_station?.station_name ||
                dispatch?.dispatch_number ||
                "Dispatched machine",
              type: dispatch?.work_station?.station_type || "",
            }))
          : Array.isArray(operation?.eligible_workstations)
            ? operation.eligible_workstations
          : [
              {
                id:
                  operation?.workstationId ||
                  operation?.workstation_id ||
                  operation?.work_station_id,
                name:
                  operation?.workstationName ||
                  operation?.workstation_name ||
                  operation?.work_station_name,
                type: "",
              },
            ];
        const validStations = eligibleStations.filter((station: any) =>
          String(station?.id || "").trim(),
        );
        if (!validStations.length) {
          unassignedOperations.push(operationName);
          continue;
        }
        for (const station of validStations) {
          const stationId = String(station.id).trim();
          const existing = stationMap.get(stationId);
          if (existing) existing.operations.push(operationName);
          else
            stationMap.set(stationId, {
              id: stationId,
              name: String(station.name || "Assigned machine"),
              type: String(station.type || ""),
              operations: [operationName],
            });
        }
      }

      const machines = Array.from(stationMap.values());
      setFocusedJob({
        id: jobId,
        number: String(
          job?.jobOrderNumber || params.get("joNumber") || "Job Order",
        ),
        itemName: String(job?.itemName || job?.item_name || ""),
        machines,
        unassignedOperations,
      });
      if (machines.length) {
        const foundReadyMachine = await selectNextReadyMachine(
          jobId,
          String(job?.jobOrderNumber || params.get("joNumber") || "Job Order"),
          machines,
        );
        if (!foundReadyMachine) setSelectedStation(machines[0].id);
      }
    } catch (error) {
      setFocusedJob(null);
    }
  };

  const fetchWorkStations = async () => {
    try {
      const data = await apiClient.get(
        "/production/work-stations?isActive=true",
      );
      const stationsArray = Array.isArray(data)
        ? data
        : data?.data
          ? data.data
          : [];
      setWorkStations(stationsArray);
    } catch (error) {
      setWorkStations([]);
    }
  };

  const fetchActiveOperation = async () => {
    try {
      const data = await apiClient.get("/production/completions/my-active");
      setActiveOperation(data);
    } catch (error) {}
  };

  const fetchQueue = async (stationOverride?: string) => {
    const stationId = stationOverride || selectedStation;
    if (!stationId) return;
    try {
      const data = await apiClient.get(
        `/production/completions/station/${stationId}/queue`,
      );
      const queueArray = Array.isArray(data)
        ? data
        : data?.data
          ? data.data
          : [];
      setQueue(
        focusedJob?.number
          ? queueArray.filter(
              (operation: Operation) =>
                String(operation.order_number) === focusedJob.number,
            )
          : queueArray,
      );
    } catch (error) {
      setQueue([]);
    }
  };

  const handleStartOperation = async (operation: Operation) => {
    if (!canStartOperation) {
      alert("You do not have permission to start operations");
      return;
    }
    setLoading(true);
    try {
      const data = await apiClient.post("/production/completions/start", {
        production_order_id: operation.production_order_id,
        routing_id: operation.routing_id,
        work_station_id: selectedStation,
        operation_dispatch_id: operation.operation_dispatch_id || null,
        notes: null,
      });
      setActiveOperation(data);
      setShowRunDetails(false);
      setShowDowntime(false);
      fetchQueue(); // Refresh queue
      alert("Operation started successfully");
    } catch (error: any) {
      alert(
        error?.response?.data?.message ||
          error?.message ||
          "Failed to start operation",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteOperation = async () => {
    if (!activeOperation) return;
    if (!canUpdateOperation) {
      alert("You do not have permission to complete operations");
      return;
    }
    if (quantityCompleted + quantityRejected <= 0) {
      alert("Enter a completed or rejected quantity");
      return;
    }
    if ((quantityRejected > 0 || quantityRework > 0) && !notes.trim()) {
      alert("Enter the rejection or rework reason in notes");
      return;
    }

    const completedSequence = Number(activeOperation.sequence_no || 0);
    const completedStationId = String(
      activeOperation.work_station_id || selectedStation,
    );
    setLoading(true);
    try {
      const result = await apiClient.put(
        `/production/completions/${activeOperation.id}/complete`,
        {
          quantity_completed: quantityCompleted,
          quantity_rejected: quantityRejected,
          rework_quantity: quantityRework,
          actual_input_quantity:
            actualInputKg === "" ? null : Number(actualInputKg),
          actual_input_uom: "KG",
          actual_scrap_quantity:
            actualScrapKg === "" ? 0 : Number(actualScrapKg),
          machine_strokes:
            machineStrokes === "" ? null : Number(machineStrokes),
          batch_count: batchCount === "" ? null : Number(batchCount),
          notes: notes || null,
        },
      );
      setActiveOperation(null);
      setQuantityCompleted(0);
      setQuantityRejected(0);
      setQuantityRework(0);
      setNotes("");
      setActualInputKg("");
      setActualScrapKg("");
      setMachineStrokes("");
      setBatchCount("");
      setShowRunDetails(false);
      setShowDowntime(false);
      await fetchQueue(); // Refresh queue
      if (result?.partial_decision?.is_partial) {
        try {
          await apiClient.put(
            `/production/completions/partial-dispositions/${result.partial_decision.id}/decision`,
            {
              decision: "CONTINUE_NOW",
              scheduled_date: null,
              reason: "Partial output released; remaining quantity stays open.",
            },
          );
          setPartialDecision(null);
          // A partial completion must keep the operator on the same stage.
          // Its remaining balance is a fresh runnable queue row at this
          // machine; moving downstream made that balance appear to disappear.
          setSelectedStation(completedStationId);
          await fetchQueue(completedStationId);
          alert(
            `${result.partial_decision.good_quantity} units completed. ${result.partial_decision.remaining_quantity} units remain open and ready at this same stage.`,
          );
        } catch {
          // The production confirmation is already safely committed. If the
          // automatic continuation decision cannot be stored, keep the manual
          // balance controls visible instead of hiding the exception.
          setPartialDecision(result.partial_decision);
        }
      } else {
        if (focusedJob) {
          await selectNextReadyMachine(
            focusedJob.id,
            focusedJob.number,
            focusedJob.machines,
            completedSequence,
          );
        }
        alert("Operation completed successfully");
      }
    } catch (error: any) {
      alert(error.response?.data?.message || "Failed to complete operation");
    } finally {
      setLoading(false);
    }
  };

  const handleBalanceDecision = async (decision: string) => {
    if (!partialDecision) return;
    if (decision === "NEXT_DAY" && !nextProductionDate) {
      alert("Select the next production date");
      return;
    }
    if (
      ["CLOSE_SHORT", "RETURN_TO_STORE"].includes(decision) &&
      !balanceReason.trim()
    ) {
      alert("Enter the reason for closing the remaining quantity");
      return;
    }
    setLoading(true);
    try {
      const result = await apiClient.put(
        `/production/completions/partial-dispositions/${partialDecision.id}/decision`,
        {
          decision,
          scheduled_date: decision === "NEXT_DAY" ? nextProductionDate : null,
          reason: balanceReason.trim() || null,
        },
      );
      const requestNumber = result?.return_request?.request_number;
      setPartialDecision(null);
      setBalanceReason("");
      setNextProductionDate("");
      await fetchQueue();
      alert(
        requestNumber
          ? `Return request ${requestNumber} prepared. Stores must verify and confirm the physical return.`
          : decision === "CONTINUE_NOW"
            ? "Balance kept ready for the next batch."
            : decision === "NEXT_SHIFT"
              ? "Balance moved to the next shift."
              : decision === "NEXT_DAY"
                ? "Balance scheduled for the selected day."
                : "Job order closed short with the original plan preserved.",
      );
    } catch (error: any) {
      alert(error?.message || "Failed to save the production balance decision");
    } finally {
      setLoading(false);
    }
  };

  const handleToolChange = async () => {
    if (!activeOperation || !changingAssignmentId) return;
    if (
      !replacementToolId ||
      outgoingToolUsage === "" ||
      !toolChangeReason.trim()
    ) {
      alert(
        "Select the replacement tool, enter actual outgoing usage and the reason",
      );
      return;
    }
    setLoading(true);
    try {
      await apiClient.post(
        `/production/completions/${activeOperation.id}/tools/change`,
        {
          assignment_id: changingAssignmentId,
          replacement_tool_resource_id: replacementToolId,
          actual_usage_value: Number(outgoingToolUsage),
          reason: toolChangeReason.trim(),
          evidence_reference: toolChangeEvidence.trim() || null,
        },
      );
      setChangingAssignmentId("");
      setReplacementToolId("");
      setOutgoingToolUsage("");
      setToolChangeReason("");
      setToolChangeEvidence("");
      await fetchActiveOperation();
      alert("Tool change recorded and replacement reserved");
    } catch (error: any) {
      alert(error?.message || "Failed to record tool change");
    } finally {
      setLoading(false);
    }
  };

  const activeToolAssignments = (
    activeOperation?.tool_assignments || []
  ).filter((assignment: any) => assignment.status === "IN_USE");
  const needsInputKg = activeToolAssignments.some(
    (assignment: any) => assignment.life_basis === "KG_INPUT",
  );
  const needsBatches = activeToolAssignments.some(
    (assignment: any) => assignment.life_basis === "BATCHES",
  );

  const handlePauseOperation = async () => {
    if (!activeOperation) return;
    if (!canUpdateOperation) {
      alert("You do not have permission to pause operations");
      return;
    }
    if (!pauseReason.trim()) {
      alert("Enter the downtime reason before pausing the operation");
      return;
    }

    setLoading(true);
    try {
      await apiClient.put(
        `/production/completions/${activeOperation.id}/pause`,
        {
          loss_category: pauseCategory,
          reason: pauseReason.trim(),
          evidence_reference: pauseEvidence.trim() || null,
          source: "MANUAL",
        },
      );
      await fetchActiveOperation();
      alert("Operation paused successfully");
    } catch (error: any) {
      alert(error.response?.data?.message || "Failed to pause operation");
    } finally {
      setLoading(false);
    }
  };

  const handleResumeOperation = async () => {
    if (!activeOperation || !canUpdateOperation) return;
    setLoading(true);
    try {
      const resumed = await apiClient.put(
        `/production/completions/${activeOperation.id}/resume`,
        {},
      );
      setActiveOperation(resumed);
      setPauseReason("");
      setPauseEvidence("");
      setShowDowntime(false);
      alert("Operation resumed successfully");
    } catch (error: any) {
      alert(error?.message || "Failed to resume operation");
    } finally {
      setLoading(false);
    }
  };

  const priorityScore = (operation: Operation) =>
    (operation.ready ? 1000 : 0) +
    ({ URGENT: 300, HIGH: 200, MEDIUM: 100, NORMAL: 50, LOW: 0 }[
      String(operation.priority || "NORMAL").toUpperCase()
    ] || 0) -
    Number(operation.sequence_no || 0);
  const recommendedOperation = [...queue].sort(
    (left, right) => priorityScore(right) - priorityScore(left),
  )[0];

  return (
    <div className="container mx-auto px-3 py-4 sm:px-4 sm:py-6">
      <div className="mb-6">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8B6F47]">
          Operator workspace
        </p>
        <h1 className="mt-1 text-3xl font-bold text-gray-900">My Machine</h1>
        <p className="mt-1 text-gray-600">
          One job at a time. Start work, record output and tell Mizantra only
          when something stops you.
        </p>
      </div>

      {partialDecision && (
        <div className="mb-6 rounded-2xl border-2 border-amber-400 bg-white p-4 shadow-lg sm:p-6">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-800">
            Production balance decision
          </p>
          <h2 className="mt-1 text-2xl font-bold text-gray-950">
            {partialDecision.remaining_quantity} units are still pending
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Output is saved and transferable good quantity is already available
            to downstream operations. Use these controls only if automatic
            continuation could not be recorded.
          </p>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl bg-gray-50 p-3">
              <span className="block text-xs text-gray-500">Planned</span>
              <b>{partialDecision.planned_quantity}</b>
            </div>
            <div className="rounded-xl bg-emerald-50 p-3">
              <span className="block text-xs text-emerald-700">
                Good output
              </span>
              <b>{partialDecision.good_quantity}</b>
            </div>
            <div className="rounded-xl bg-red-50 p-3">
              <span className="block text-xs text-red-700">Rejected</span>
              <b>{partialDecision.rejected_quantity}</b>
            </div>
            <div className="rounded-xl bg-amber-50 p-3">
              <span className="block text-xs text-amber-700">Remaining</span>
              <b>{partialDecision.remaining_quantity}</b>
            </div>
          </div>

          {!!partialDecision.material_reconciliation?.length && (
            <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-600">
                  <tr>
                    <th className="px-3 py-2">Material</th>
                    <th className="px-3 py-2">Full plan</th>
                    <th className="px-3 py-2">Standard used</th>
                    <th className="px-3 py-2">Expected balance</th>
                  </tr>
                </thead>
                <tbody>
                  {partialDecision.material_reconciliation.map((line) => (
                    <tr key={line.item_id} className="border-t border-gray-100">
                      <td className="px-3 py-2">
                        <b>{line.item_code}</b>
                        <span className="ml-2 text-gray-600">
                          {line.item_name}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {line.planned_quantity} {line.uom}
                      </td>
                      <td className="px-3 py-2">
                        {line.standard_used_to_date} {line.uom}
                      </td>
                      <td className="px-3 py-2 font-bold text-amber-800">
                        {line.expected_balance} {line.uom}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-gray-600">
            Material balance is a planning estimate. Stores verifies the
            physical quantity before inventory is changed.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-sm font-medium text-gray-700">
              Next production date (only if scheduling another day)
              <input
                type="date"
                value={nextProductionDate}
                onChange={(event) => setNextProductionDate(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
              />
            </label>
            <label className="text-sm font-medium text-gray-700">
              Reason (required only when closing short)
              <input
                value={balanceReason}
                onChange={(event) => setBalanceReason(event.target.value)}
                placeholder="Breakdown, customer change, material issue..."
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
              />
            </label>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <button
              onClick={() => handleBalanceDecision("CONTINUE_NOW")}
              disabled={loading}
              className="rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white disabled:bg-gray-300"
            >
              Keep balance open
            </button>
            <button
              onClick={() => handleBalanceDecision("NEXT_SHIFT")}
              disabled={loading}
              className="rounded-xl border border-blue-400 bg-white px-4 py-3 font-bold text-blue-800 disabled:text-gray-400"
            >
              Next shift
            </button>
            <button
              onClick={() => handleBalanceDecision("NEXT_DAY")}
              disabled={loading || !nextProductionDate}
              className="rounded-xl border border-blue-400 bg-white px-4 py-3 font-bold text-blue-800 disabled:text-gray-400"
            >
              Schedule day
            </button>
            <button
              onClick={() => handleBalanceDecision("CLOSE_SHORT")}
              disabled={loading || !balanceReason.trim()}
              className="rounded-xl border border-gray-400 bg-white px-4 py-3 font-bold text-gray-800 disabled:text-gray-400"
            >
              Close short
            </button>
            <button
              onClick={() => handleBalanceDecision("RETURN_TO_STORE")}
              disabled={loading || !balanceReason.trim()}
              className="rounded-xl bg-amber-700 px-4 py-3 font-bold text-white disabled:bg-gray-300"
            >
              Close &amp; return material
            </button>
          </div>
        </div>
      )}

      {focusedJob && !activeOperation && (
        <section className="mb-6 rounded-2xl border border-[#D8C8AA] bg-[#FFFDF8] p-4 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8B6F47]">
                Machines from Job Order routing
              </p>
              <h2 className="mt-1 text-xl font-bold text-gray-950">
                {focusedJob.number}
              </h2>
              {focusedJob.itemName ? (
                <p className="text-sm text-gray-600">{focusedJob.itemName}</p>
              ) : null}
            </div>
            <span className="rounded-full bg-[#4A3526] px-3 py-1 text-xs font-bold text-white">
              {focusedJob.machines.length} machine
              {focusedJob.machines.length === 1 ? "" : "s"} assigned
            </span>
          </div>

          {focusedJob.machines.length ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {focusedJob.machines.map((machine) => {
                const master = workStations.find(
                  (station) => String(station.id) === machine.id,
                );
                const selected = selectedStation === machine.id;
                return (
                  <button
                    key={machine.id}
                    type="button"
                    onClick={() => setSelectedStation(machine.id)}
                    className={`rounded-xl border-2 p-4 text-left transition ${
                      selected
                        ? "border-emerald-600 bg-emerald-50 shadow-sm"
                        : "border-[#E8DCC4] bg-white hover:border-[#B99B68]"
                    }`}
                  >
                    <span className="block text-xs font-bold uppercase tracking-wide text-gray-500">
                      {selected ? "Current machine" : "Assigned machine"}
                    </span>
                    <strong className="mt-1 block text-base text-gray-950">
                      {master?.station_name || machine.name}
                    </strong>
                    <span className="mt-1 block text-xs text-gray-600">
                      {master?.station_type ? `${master.station_type} · ` : ""}
                      {machine.operations.join(" · ")}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              No machine is assigned in this Job Order routing. Assign its
              workstation before production starts.
            </p>
          )}

          {focusedJob.unassignedOperations.length ? (
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              Routing setup required for: {focusedJob.unassignedOperations.join(", ")}.
            </p>
          ) : null}
        </section>
      )}

      {/* Work Station Selection */}
      {!activeOperation && (
        <div className={`${focusedJob?.machines.length ? "hidden" : "mb-6"} rounded-xl border border-[#E8DCC4] bg-white p-4 shadow-sm sm:p-6`}>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Which machine are you operating?
          </label>
          <select
            value={selectedStation}
            onChange={(e) => setSelectedStation(e.target.value)}
            className="w-full md:w-96 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Choose your machine</option>
            {workStations.map((station) => (
              <option key={station.id} value={station.id}>
                {station.station_name} ({station.station_type})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Active Operation */}
      {activeOperation && (
        <div className="mb-6 rounded-2xl border-2 border-blue-300 bg-blue-50 p-4 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">
                Current work
              </p>
              <h2 className="text-xl font-bold text-blue-950">
                {activeOperation.operation_name || "Operation in progress"}
              </h2>
              <p className="mt-1 text-sm font-semibold text-blue-900">
                {activeOperation.job_order_number ||
                  activeOperation.production_order_number ||
                  "Current job"}
                {activeOperation.item_name
                  ? ` · ${activeOperation.item_name}`
                  : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowRunDetails((value) => !value)}
                className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-xs font-bold text-blue-900"
              >
                {showRunDetails ? "Hide run details" : "More run details"}
              </button>
              <span className="rounded-full bg-blue-600 px-3 py-1 text-sm font-medium text-white">
                {activeOperation.status.replaceAll("_", " ")}
              </span>
            </div>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
            {[
              [
                "Stage",
                `${activeOperation.sequence_no ?? "-"} · ${activeOperation.operation_name || "Operation"}`,
              ],
              [
                "Machine",
                activeOperation.work_station_name ||
                  activeOperation.work_station_code ||
                  "Not assigned",
              ],
              [
                "Job quantity",
                `${Number(activeOperation.planned_quantity || 0).toLocaleString("en-IN")} ${activeOperation.uom || "pcs"}`,
              ],
              [
                "Completed here",
                `${Number(activeOperation.completed_before || 0).toLocaleString("en-IN")} ${activeOperation.uom || "pcs"}`,
              ],
              [
                "Produce now",
                `${Number(activeOperation.quantity_to_produce ?? activeOperation.quantity_remaining ?? 0).toLocaleString("en-IN")} ${activeOperation.uom || "pcs"}`,
              ],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-blue-200 bg-white p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
                  {label}
                </p>
                <p className="mt-1 font-bold text-gray-950">{value}</p>
              </div>
            ))}
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm text-gray-600">Started</p>
              <p className="font-medium">
                {new Date(activeOperation.start_time).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Duration</p>
              <p className="font-medium">
                {Math.round(
                  (Date.now() -
                    new Date(activeOperation.start_time).getTime()) /
                    60000,
                )}{" "}
                minutes
              </p>
            </div>
          </div>

          {activeOperation.status === "PAUSED" ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                <b>
                  {(activeOperation.pause_loss_category || "OTHER").replaceAll(
                    "_",
                    " ",
                  )}
                </b>
                <span className="ml-2">
                  {activeOperation.pause_reason || "Downtime in progress"}
                </span>
              </div>
              <button
                onClick={handleResumeOperation}
                disabled={loading || !canUpdateOperation}
                className="w-full rounded-lg bg-blue-600 px-6 py-3 font-medium text-white disabled:bg-gray-300"
              >
                {loading ? "Processing..." : "Resume Operation"}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {showRunDetails && !!activeOperation.tool_assignments?.length && (
                <section className="rounded-xl border border-blue-200 bg-white p-4">
                  <h3 className="font-bold text-gray-900">Installed tooling</h3>
                  <p className="mt-1 text-xs text-gray-600">
                    Selected automatically from valid available tooling. Record
                    a replacement whenever a punch, die, mould or fixture is
                    changed.
                  </p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {activeOperation.tool_assignments.map((assignment: any) => {
                      const tool = assignment.tool_resource || {};
                      const remaining =
                        tool.life_limit_value == null
                          ? null
                          : Math.max(
                              0,
                              Number(tool.life_limit_value) -
                                Number(tool.life_used_value || 0),
                            );
                      return (
                        <div
                          key={assignment.id}
                          className={`rounded-lg border p-3 text-sm ${assignment.status === "IN_USE" ? "border-emerald-200 bg-emerald-50" : "border-gray-200 bg-gray-50"}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <strong>
                                {tool.tool_code || assignment.tool_code}
                              </strong>
                              <p className="text-xs text-gray-600">
                                {tool.tool_name} · {tool.resource_type}
                              </p>
                            </div>
                            <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold">
                              {assignment.status.replaceAll("_", " ")}
                            </span>
                          </div>
                          <p className="mt-2 text-xs text-gray-700">
                            Life: {tool.life_used_value || 0} used
                            {tool.life_limit_value == null
                              ? " · no rated limit"
                              : ` · ${remaining} ${tool.life_uom} remaining`}
                            {assignment.planned_usage_value == null
                              ? ""
                              : ` · ${assignment.planned_usage_value} planned for this run`}
                          </p>
                          {assignment.status === "IN_USE" && (
                            <button
                              type="button"
                              onClick={() => {
                                setChangingAssignmentId(assignment.id);
                                setReplacementToolId("");
                                setOutgoingToolUsage("");
                              }}
                              className="mt-3 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-800"
                            >
                              Change / replace tool
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {changingAssignmentId &&
                    (() => {
                      const assignment = activeOperation.tool_assignments?.find(
                        (x: any) => x.id === changingAssignmentId,
                      );
                      const replacements = (
                        activeOperation.tooling_candidates || []
                      ).filter(
                        (tool: any) =>
                          tool.tool_code === assignment?.tool_code &&
                          Number(tool.available_slots || 0) > 0,
                      );
                      return (
                        <div className="mt-4 grid gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 md:grid-cols-2">
                          <label className="text-sm font-medium text-gray-700">
                            Replacement {assignment?.tool_code} *
                            <select
                              value={replacementToolId}
                              onChange={(e) =>
                                setReplacementToolId(e.target.value)
                              }
                              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2"
                            >
                              <option value="">
                                Select available replacement
                              </option>
                              {replacements.map((tool: any) => (
                                <option key={tool.id} value={tool.id}>
                                  {tool.tool_code} ·{" "}
                                  {tool.serial_number ||
                                    `${tool.tool_name} (${tool.available_slots} free)`}{" "}
                                  · {tool.life_used_value || 0}/
                                  {tool.life_limit_value || "unlimited"}{" "}
                                  {tool.life_uom}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="text-sm font-medium text-gray-700">
                            Actual usage on outgoing tool (
                            {assignment?.life_uom}) *
                            <input
                              type="number"
                              min="0"
                              step="0.0001"
                              value={outgoingToolUsage}
                              onChange={(e) =>
                                setOutgoingToolUsage(e.target.value)
                              }
                              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                            />
                          </label>
                          <label className="text-sm font-medium text-gray-700">
                            Change reason *
                            <select
                              value={toolChangeReason}
                              onChange={(e) =>
                                setToolChangeReason(e.target.value)
                              }
                              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2"
                            >
                              <option value="">Select reason</option>
                              <option value="PLANNED_LIFE">
                                Planned life reached
                              </option>
                              <option value="WEAR">
                                Wear / quality deterioration
                              </option>
                              <option value="BREAKAGE">Breakage</option>
                              <option value="SHARPENING">
                                Sharpening / refurbishment
                              </option>
                              <option value="PRODUCT_CHANGE">
                                Product or size change
                              </option>
                              <option value="OTHER">Other</option>
                            </select>
                          </label>
                          <label className="text-sm font-medium text-gray-700">
                            Evidence reference
                            <input
                              value={toolChangeEvidence}
                              onChange={(e) =>
                                setToolChangeEvidence(e.target.value)
                              }
                              placeholder="Photo, ticket or inspection reference"
                              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                            />
                          </label>
                          <div className="flex gap-2 md:col-span-2">
                            <button
                              type="button"
                              onClick={handleToolChange}
                              disabled={loading || !replacements.length}
                              className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-bold text-white disabled:bg-gray-300"
                            >
                              Record change
                            </button>
                            <button
                              type="button"
                              onClick={() => setChangingAssignmentId("")}
                              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm"
                            >
                              Cancel
                            </button>
                          </div>
                          {!replacements.length && (
                            <p className="text-xs text-red-700 md:col-span-2">
                              No second physical unit is available. Create
                              another serialized tool resource before replacing
                              this tool.
                            </p>
                          )}
                        </div>
                      );
                    })()}
                </section>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Quantity Completed <span className="text-red-600">*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  max={activeOperation.quantity_to_produce || undefined}
                  value={quantityCompleted}
                  onChange={(e) =>
                    setQuantityCompleted(parseInt(e.target.value) || 0)
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter quantity completed"
                />
                <p className="mt-1 text-xs font-semibold text-blue-900">
                  Up to{" "}
                  {Number(
                    activeOperation.quantity_to_produce ??
                      activeOperation.quantity_remaining ??
                      0,
                  ).toLocaleString("en-IN")} {activeOperation.uom || "pcs"}{" "}
                  can be recorded in this run. Any balance will stay open here.
                </p>
              </div>

              {showRunDetails && (
                <fieldset className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
                  <legend className="px-1 text-sm font-semibold text-emerald-950">
                    Actual production evidence
                  </legend>
                  <p className="mb-3 text-xs text-emerald-900">
                    Enter actual readings once. The system automatically
                    allocates them to every installed punch, die, mould and
                    fixture according to its life basis.
                  </p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="text-sm font-medium text-gray-700">
                      Rework quantity
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={quantityRework}
                        onChange={(e) =>
                          setQuantityRework(Number(e.target.value) || 0)
                        }
                        placeholder="0"
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2"
                      />
                    </label>
                    <label className="text-sm font-medium text-gray-700">
                      Actual input material processed (kg)
                      {needsInputKg ? " *" : ""}
                      <input
                        required={needsInputKg}
                        type="number"
                        min="0"
                        step="0.0001"
                        value={actualInputKg}
                        onChange={(e) => setActualInputKg(e.target.value)}
                        placeholder="Wire, chemical load or granules actually processed"
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2"
                      />
                    </label>
                    <label className="text-sm font-medium text-gray-700">
                      Actual scrap / process loss (kg)
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={actualScrapKg}
                        onChange={(e) => setActualScrapKg(e.target.value)}
                        placeholder="0"
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2"
                      />
                    </label>
                    <label className="text-sm font-medium text-gray-700">
                      Machine strokes / shots
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={machineStrokes}
                        onChange={(e) => setMachineStrokes(e.target.value)}
                        placeholder="Optional — inferred from output when blank"
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2"
                      />
                    </label>
                    <label className="text-sm font-medium text-gray-700">
                      Production batches{needsBatches ? " *" : ""}
                      <input
                        required={needsBatches}
                        type="number"
                        min="0"
                        step="0.0001"
                        value={batchCount}
                        onChange={(e) => setBatchCount(e.target.value)}
                        placeholder="Required for batch-life tooling"
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2"
                      />
                    </label>
                  </div>
                </fieldset>
              )}

              {showDowntime && (
                <fieldset className="rounded-lg border border-amber-300 bg-amber-50 p-4">
                  <legend className="px-1 text-sm font-semibold text-amber-950">
                    Downtime details — required only when pausing
                  </legend>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="text-sm font-medium text-gray-700">
                      Reason category
                      <select
                        value={pauseCategory}
                        onChange={(e) => setPauseCategory(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2"
                      >
                        <option value="ROLL_CHANGE">
                          Wire/material roll change
                        </option>
                        <option value="MOLD_CHANGE">Mould change</option>
                        <option value="BREAKDOWN">Machine breakdown</option>
                        <option value="POWER">Electricity/power failure</option>
                        <option value="LABOUR">
                          Staff unavailable/shortage
                        </option>
                        <option value="MATERIAL">Material unavailable</option>
                        <option value="QUALITY">Quality hold</option>
                        <option value="MAINTENANCE">Maintenance</option>
                        <option value="CHANGEOVER">
                          Other product changeover
                        </option>
                        <option value="PLANNED">Planned stop</option>
                        <option value="OTHER">Other</option>
                      </select>
                    </label>
                    <label className="text-sm font-medium text-gray-700">
                      Reason / observation
                      <input
                        value={pauseReason}
                        onChange={(e) => setPauseReason(e.target.value)}
                        placeholder="Example: 60 kg wire roll exhausted"
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2"
                      />
                    </label>
                    <label className="text-sm font-medium text-gray-700 md:col-span-2">
                      Evidence reference (optional)
                      <input
                        value={pauseEvidence}
                        onChange={(e) => setPauseEvidence(e.target.value)}
                        placeholder="Roll UID, maintenance ticket, meter event or photo reference"
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2"
                      />
                    </label>
                  </div>
                </fieldset>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Quantity Rejected (Optional)
                </label>
                <input
                  type="number"
                  min="0"
                  value={quantityRejected}
                  onChange={(e) =>
                    setQuantityRejected(parseInt(e.target.value) || 0)
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter quantity rejected"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes (Optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Add any notes or comments..."
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {canUpdateOperation && (
                  <>
                    <button
                      onClick={handleCompleteOperation}
                      disabled={
                        loading || quantityCompleted + quantityRejected <= 0
                      }
                      className="rounded-xl bg-green-600 px-6 py-4 text-lg font-bold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                    >
                      {loading ? "Saving..." : "✓ Finish and save output"}
                    </button>
                    {showDowntime ? (
                      <button
                        onClick={handlePauseOperation}
                        disabled={loading || !pauseReason.trim()}
                        className="rounded-xl bg-amber-600 px-6 py-4 text-lg font-bold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                      >
                        {loading ? "Saving..." : "Pause and record downtime"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowDowntime(true)}
                        className="rounded-xl border-2 border-amber-500 bg-white px-6 py-4 text-lg font-bold text-amber-800 hover:bg-amber-50"
                      >
                        Something stopped me
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Operation Queue */}
      {selectedStation && !activeOperation && (
        <div className="rounded-2xl border border-[#E8DCC4] bg-white shadow-sm">
          <div className="border-b border-gray-200 px-4 py-4 sm:px-6">
            <h2 className="text-xl font-bold text-gray-900">
              Your next operation
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Mizantra puts ready and high-priority work first. {queue.length}{" "}
              operation{queue.length !== 1 ? "s" : ""} waiting.
            </p>
          </div>

          {queue.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-500">
              No pending operations at this work station
            </div>
          ) : (
            <>
              {recommendedOperation ? (
                <div className="m-4 rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4 sm:m-6 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">
                        Recommended next
                      </p>
                      <h3 className="mt-1 text-xl font-bold text-gray-950">
                        {recommendedOperation.operation_name}
                      </h3>
                      <p className="mt-1 text-sm font-semibold text-gray-800">
                        {recommendedOperation.order_number} ·{" "}
                        {recommendedOperation.item_name}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold ${recommendedOperation.ready ? "bg-emerald-700 text-white" : "bg-amber-100 text-amber-900"}`}
                    >
                      {recommendedOperation.ready
                        ? "READY"
                        : "WAITING FOR INPUT"}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                    <div className="rounded-lg bg-white p-3">
                      <span className="block text-xs text-gray-500">
                        Quantity remaining
                      </span>
                      <b>
                        {recommendedOperation.quantity_remaining} /{" "}
                        {recommendedOperation.quantity_required}
                      </b>
                    </div>
                    <div className="rounded-lg bg-white p-3">
                      <span className="block text-xs text-gray-500">
                        Input available
                      </span>
                      <b>{recommendedOperation.input_available}</b>
                    </div>
                    <div className="rounded-lg bg-white p-3">
                      <span className="block text-xs text-gray-500">
                        Standard time
                      </span>
                      <b>{recommendedOperation.cycle_time_minutes} min</b>
                    </div>
                  </div>
                  {recommendedOperation.blocked_reason ? (
                    <p className="mt-3 rounded-lg bg-amber-100 p-2 text-sm text-amber-900">
                      {recommendedOperation.blocked_reason}
                    </p>
                  ) : null}
                  {canStartOperation ? (
                    <button
                      onClick={() => handleStartOperation(recommendedOperation)}
                      disabled={loading || !recommendedOperation.ready}
                      className="mt-4 w-full rounded-xl bg-emerald-700 px-6 py-4 text-lg font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                    >
                      {loading
                        ? "Starting..."
                        : recommendedOperation.ready
                          ? "▶ Start this operation"
                          : "Waiting for previous stage"}
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="px-4 pb-4 sm:px-6 sm:pb-6">
                <button
                  type="button"
                  onClick={() => setShowFullQueue((value) => !value)}
                  className="rounded-lg border border-[#D8C8AA] bg-white px-3 py-2 text-sm font-semibold text-[#4A3426]"
                >
                  {showFullQueue
                    ? "Hide all queued work"
                    : `See all queued work (${queue.length})`}
                </button>
              </div>
              {showFullQueue ? (
                <div className="overflow-x-auto border-t border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Order #
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Item
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Seq
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Operation
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Qty Remaining
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Std Time
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Priority
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {queue.map((operation) => (
                        <tr key={operation.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {operation.order_number}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900">
                            {operation.item_name}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {operation.sequence_no}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900">
                            {operation.operation_name}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {operation.quantity_remaining} /{" "}
                            {operation.quantity_required}
                            <span className="block text-xs text-gray-500">
                              {operation.input_available} available from
                              upstream
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {operation.cycle_time_minutes} min
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span
                              className={`px-2 py-1 rounded-full text-xs font-medium ${
                                operation.priority === "HIGH"
                                  ? "bg-red-100 text-red-800"
                                  : operation.priority === "MEDIUM"
                                    ? "bg-yellow-100 text-yellow-800"
                                    : "bg-green-100 text-green-800"
                              }`}
                            >
                              {operation.priority}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {canStartOperation && (
                              <button
                                onClick={() => handleStartOperation(operation)}
                                disabled={loading || !operation.ready}
                                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm font-medium"
                              >
                                {operation.ready ? "Start" : "Waiting for WIP"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}
