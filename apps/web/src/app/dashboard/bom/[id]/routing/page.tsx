"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { confirmDialog } from "../../../../../components/ui/ConfirmDialog";
import { hasModulePermission, readStoredUser } from "@/lib/rbac";
import SearchableSelect from "@/components/SearchableSelect";

interface WorkStation {
  id: string;
  station_name: string;
  station_code: string;
  station_type: string;
}

interface RoutingStep {
  id: string;
  sequence_no: number;
  operation_name: string;
  work_station_id: string;
  cycle_time_minutes: number;
  setup_time_minutes: number;
  qc_required: boolean;
  notes: string | null;
  estimated_start_offset_hours: number;
  estimated_duration_hours: number;
  manhours_required: number;
  work_station?: WorkStation;
}

interface BOM {
  id: string;
  item_name: string;
  item_code: string;
}

export default function BOMRoutingPage() {
  const router = useRouter();
  const params = useParams();
  const currentUser = readStoredUser();
  const canCreateRouting = hasModulePermission(
    currentUser,
    "BOM & Engineering",
    "create",
  );
  const canEditRouting = hasModulePermission(
    currentUser,
    "BOM & Engineering",
    "edit",
  );
  const canDeleteRouting = hasModulePermission(
    currentUser,
    "BOM & Engineering",
    "delete",
  );

  // Extract BOM ID from params or URL pathname as fallback
  const getBomId = (): string | null => {
    if (!params) {
      // Fallback: extract from URL pathname
      const pathname = window.location.pathname;
      const match = pathname.match(/\/bom\/([^\/]+)\/routing/);
      if (match) {
        return match[1];
      }
      return null;
    }

    if (typeof params.id === "string") {
      return params.id;
    }

    if (Array.isArray(params.id) && params.id.length > 0) {
      return params.id[0];
    }

    return null;
  };

  const [bomId, setBomId] = useState<string | null>(null);
  const [bom, setBom] = useState<BOM | null>(null);
  const [routingSteps, setRoutingSteps] = useState<RoutingStep[]>([]);
  const [workStations, setWorkStations] = useState<WorkStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    operationName: "",
    workStationId: "",
    estimatedTime: 60,
    description: "",
    startOffsetHours: 0,
    durationHours: 1,
    manhoursRequired: 1,
  });

  // Set bomId when params become available
  useEffect(() => {
    const id = getBomId();
    setBomId(id);
  }, [params]);

  useEffect(() => {
    if (!bomId) {
      return;
    }

    fetchBOM();
    fetchRouting();
    fetchWorkStations();
  }, [bomId]);

  const fetchBOM = async () => {
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`/api/v1/bom/${bomId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        const bomData = data?.data ?? data;
        setBom({
          id: bomData.id,
          item_name:
            bomData.item_name ??
            bomData.item?.item_name ??
            bomData.item?.name ??
            "Unnamed product",
          item_code:
            bomData.item_code ??
            bomData.item?.item_code ??
            bomData.item?.code ??
            "",
        });
      }
    } catch (error) {}
  };

  const fetchRouting = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(
        `/api/v1/production/routing/bom/${bomId}?withStations=true`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (response.ok) {
        const data = await response.json();
        const stepsArray = Array.isArray(data)
          ? data
          : data?.data
            ? data.data
            : [];
        setRoutingSteps(stepsArray);
      }
    } catch (error) {
      setRoutingSteps([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchWorkStations = async () => {
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(
        "/api/v1/production/work-stations?isActive=true",
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (response.ok) {
        const data = await response.json();
        const stationsArray = Array.isArray(data)
          ? data
          : data?.data
            ? data.data
            : [];
        setWorkStations(stationsArray);
      }
    } catch (error) {
      setWorkStations([]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId ? !canEditRouting : !canCreateRouting) {
      alert(
        `You do not have permission to ${editingId ? "edit" : "add"} routing steps`,
      );
      return;
    }

    if (!bomId) {
      alert("BOM ID is missing");
      return;
    }

    setLoading(true);

    try {
      const token = localStorage.getItem("accessToken");

      // Map frontend field names to backend API field names
      const payload = editingId
        ? {
            work_station_id: formData.workStationId,
            operation_name: formData.operationName,
            cycle_time_minutes: formData.estimatedTime,
            setup_time_minutes: 0,
            qc_required: false,
            notes: formData.description.trim() || null,
            estimated_start_offset_hours: formData.startOffsetHours,
            estimated_duration_hours: formData.durationHours,
            manhours_required: formData.manhoursRequired,
          }
        : {
            bom_id: bomId,
            work_station_id: formData.workStationId,
            operation_name: formData.operationName,
            cycle_time_minutes: formData.estimatedTime,
            setup_time_minutes: 0,
            qc_required: false,
            notes: formData.description.trim() || null,
            sequence_no:
              Math.max(
                0,
                ...routingSteps.map((step) => Number(step.sequence_no) || 0),
              ) + 10,
            estimated_start_offset_hours: formData.startOffsetHours,
            estimated_duration_hours: formData.durationHours,
            manhours_required: formData.manhoursRequired,
          };

      let response;
      if (editingId) {
        response = await fetch(`/api/v1/production/routing/${editingId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
      } else {
        response = await fetch("/api/v1/production/routing", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      alert(
        editingId
          ? "Routing step updated successfully"
          : "Routing step added successfully",
      );
      resetForm();
      fetchRouting();
    } catch (error: any) {
      alert(
        "Failed to save routing step: " + (error.message || "Unknown error"),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (step: RoutingStep) => {
    if (!canEditRouting) {
      alert("You do not have permission to edit routing steps");
      return;
    }
    setFormData({
      operationName: step.operation_name,
      workStationId: step.work_station_id,
      estimatedTime: step.cycle_time_minutes,
      description: step.notes || "",
      startOffsetHours: step.estimated_start_offset_hours || 0,
      durationHours: step.estimated_duration_hours || 1,
      manhoursRequired: step.manhours_required || 1,
    });
    setEditingId(step.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!canDeleteRouting) {
      alert("You do not have permission to delete routing steps");
      return;
    }
    const confirmed = await confirmDialog({
      title: "Delete Routing Step",
      message: "Are you sure you want to delete this routing step?",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!confirmed) return;

    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`/api/v1/production/routing/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error("Failed to delete");

      alert("Routing step deleted successfully");
      fetchRouting();
    } catch (error) {
      alert("Failed to delete routing step");
    }
  };

  const moveRoutingStep = async (index: number, direction: -1 | 1) => {
    if (!bomId || !canEditRouting) return;
    const target = index + direction;
    if (target < 0 || target >= routingSteps.length) return;
    const ordered = [...routingSteps];
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    setLoading(true);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(
        `/api/v1/production/routing/bom/${bomId}/resequence`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ routingIds: ordered.map((step) => step.id) }),
        },
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }
      await fetchRouting();
    } catch (error: any) {
      alert(`Unable to move this process: ${error.message || "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      operationName: "",
      workStationId: "",
      estimatedTime: 60,
      description: "",
      startOffsetHours: 0,
      durationHours: 1,
      manhoursRequired: 1,
    });
    setEditingId(null);
    setShowForm(false);
  };

  return (
    <div className="container mx-auto py-6 px-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">
          Routing Configuration: {bom?.item_name || "Loading..."}
        </h1>
        <p className="text-gray-600 mt-1">
          Define the sequence of operations and work stations for this BOM
        </p>
      </div>

      <div className="flex justify-end mb-6">
        {canCreateRouting && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 font-medium"
          >
            {showForm ? "Cancel" : "+ Add Routing Step"}
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">
            {editingId ? "Edit Routing Step" : "Add Routing Step"}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Operation Name <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.operationName}
                onChange={(e) =>
                  setFormData({ ...formData, operationName: e.target.value })
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., CNC Machining, Assembly"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Work Station <span className="text-red-600">*</span>
              </label>
              <SearchableSelect
                value={formData.workStationId}
                onChange={(workStationId) =>
                  setFormData({ ...formData, workStationId })
                }
                options={workStations.map((station) => ({
                  value: station.id,
                  label: station.station_code,
                  subtitle: `${station.station_name}${station.station_type ? ` · ${station.station_type}` : ""}`,
                }))}
                placeholder="Search work station by code or name"
                ariaLabel="Work Station"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Estimated Time (minutes) <span className="text-red-600">*</span>
              </label>
              <input
                type="number"
                required
                min="1"
                value={formData.estimatedTime}
                onChange={(e) => {
                  const estimatedTime = Math.max(
                    0,
                    Number(e.target.value) || 0,
                  );
                  const hours = Number((estimatedTime / 60).toFixed(2));
                  setFormData({
                    ...formData,
                    estimatedTime,
                    durationHours: hours,
                    manhoursRequired: hours,
                  });
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                Duration and one-operator manhours are calculated automatically.
              </p>
            </div>

            <details className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-gray-700">
                Advanced timing (optional)
              </summary>
              <div className="mt-3 grid gap-4 md:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Start After (hours) <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={formData.startOffsetHours}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        startOffsetHours: parseFloat(e.target.value),
                      })
                    }
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="0"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Hours after previous operation
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Duration (hours) <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    value={formData.durationHours}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        durationHours: parseFloat(e.target.value),
                      })
                    }
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="1"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Total operation time
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Manhours <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    value={formData.manhoursRequired}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        manhoursRequired: parseFloat(e.target.value),
                      })
                    }
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="1"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Labor hours needed
                  </p>
                </div>
              </div>
            </details>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                rows={3}
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Operation details and instructions..."
              />
            </div>

            <div className="flex justify-end space-x-4">
              <button
                type="button"
                onClick={resetForm}
                className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  loading || (editingId ? !canEditRouting : !canCreateRouting)
                }
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
              >
                {loading ? "Saving..." : editingId ? "Update" : "Add"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Routing Steps Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Seq
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Operation
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Work Station
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Start After
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Duration
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Manhours
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-12 text-center text-gray-500"
                  >
                    Loading routing steps...
                  </td>
                </tr>
              ) : routingSteps.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-12 text-center text-gray-500"
                  >
                    No routing steps configured. Click &quot;Add Routing
                    Step&quot; to get started.
                  </td>
                </tr>
              ) : (
                routingSteps.map((step, index) => (
                  <tr key={step.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {step.sequence_no}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      <div className="font-medium">{step.operation_name}</div>
                      <div className="text-xs text-gray-500">
                        {step.cycle_time_minutes} min cycle time
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {step.work_station?.station_code} -{" "}
                      {step.work_station?.station_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {step.estimated_start_offset_hours || 0}h
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {step.estimated_duration_hours || 1}h
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {step.manhours_required || 1}h
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-3">
                      {canEditRouting && (
                        <>
                          <button
                            type="button"
                            onClick={() => moveRoutingStep(index, -1)}
                            disabled={index === 0 || loading}
                            aria-label={`Move ${step.operation_name} up`}
                            title="Move process up"
                            className="text-gray-700 hover:text-gray-950 disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveRoutingStep(index, 1)}
                            disabled={
                              index === routingSteps.length - 1 || loading
                            }
                            aria-label={`Move ${step.operation_name} down`}
                            title="Move process down"
                            className="text-gray-700 hover:text-gray-950 disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            ↓
                          </button>
                        </>
                      )}
                      {canEditRouting && (
                        <button
                          onClick={() => handleEdit(step)}
                          className="text-blue-600 hover:text-blue-900"
                        >
                          Edit
                        </button>
                      )}
                      {canDeleteRouting && (
                        <button
                          onClick={() => handleDelete(step.id)}
                          className="text-red-600 hover:text-red-900"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
