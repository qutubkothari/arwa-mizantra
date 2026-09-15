"use client";

import { useState, useEffect } from "react";
import { apiClient } from "../../../../lib/api-client";
import {
  ListTable,
  type ListTableColumn,
} from "../../../components/ui/ListTable";
import { confirmDialog } from "../../../components/ui/ConfirmDialog";
import { hasModulePermission, readStoredUser } from "@/lib/rbac";

interface WorkStation {
  id: string;
  station_name: string;
  station_code: string;
  station_type: string;
  capacity_per_hour: number;
  is_active: boolean;
  description: string | null;
  created_at: string;
}

export default function WorkStationsPage() {
  const [currentUser, setCurrentUser] =
    useState<ReturnType<typeof readStoredUser>>(null);
  const canCreate = hasModulePermission(currentUser, "Production", "create");
  const canEdit = hasModulePermission(currentUser, "Production", "edit");
  const canDelete = hasModulePermission(currentUser, "Production", "delete");
  const [workStations, setWorkStations] = useState<WorkStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [sortColumn, setSortColumn] = useState<string>("created_at");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const workStationsColumns: ListTableColumn<WorkStation>[] = [
    {
      id: "station_code",
      label: "Code",
      accessor: (r) => r.station_code,
    },
    {
      id: "station_name",
      label: "Name",
      accessor: (r) => r.station_name,
    },
    {
      id: "station_type",
      label: "Type",
      accessor: (r) => r.station_type,
    },
    {
      id: "capacity",
      label: "Capacity",
      accessor: (r) => `${r.capacity_per_hour || 0} units/hour`,
      sortAccessor: (r) => r.capacity_per_hour || 0,
      align: "right",
    },
    {
      id: "status",
      label: "Status",
      cell: (r) => (
        <span
          className={`px-2 py-1 rounded-full text-xs font-medium ${
            r.is_active
              ? "bg-green-100 text-green-800"
              : "bg-gray-100 text-gray-800"
          }`}
        >
          {r.is_active ? "Active" : "Inactive"}
        </span>
      ),
      sortAccessor: (r) => (r.is_active ? 1 : 0),
      searchAccessor: (r) => (r.is_active ? "active" : "inactive"),
      align: "center",
    },
    {
      id: "actions",
      label: "Actions",
      cell: (station) => (
        <div className="text-sm space-x-2">
          {canEdit && (
            <button
              type="button"
              onClick={() => handleEdit(station)}
              className="text-blue-600 hover:text-blue-900 font-medium"
            >
              Edit
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => handleDelete(station.id)}
              className="text-red-600 hover:text-red-900 font-medium"
            >
              Delete
            </button>
          )}
          {!canEdit && !canDelete && (
            <span className="text-gray-400">No actions</span>
          )}
        </div>
      ),
      sortable: false,
      hideable: false,
      align: "left",
    },
  ];

  // Form state
  const [formData, setFormData] = useState({
    stationName: "",
    stationCode: "",
    stationType: "MACHINING",
    capacityPerHour: 1,
    isActive: true,
    description: "",
  });

  const stationTypes = [
    "MACHINING",
    "ASSEMBLY",
    "WELDING",
    "PAINTING",
    "TESTING",
    "PACKAGING",
    "OTHER",
  ];

  useEffect(() => {
    setCurrentUser(readStoredUser());
    fetchWorkStations();
  }, []);

  const fetchWorkStations = async () => {
    setLoading(true);
    try {
      const data = await apiClient.get("/production/work-stations");
      // Ensure data is always an array
      const stationsArray = Array.isArray(data)
        ? data
        : data?.data
          ? data.data
          : [];
      setWorkStations(stationsArray);
    } catch (error) {
      setWorkStations([]);
      alert(
        "Failed to load work stations: " +
          (error instanceof Error ? error.message : "Unknown error"),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId ? !canEdit : !canCreate) {
      alert(
        `You do not have permission to ${editingId ? "edit" : "create"} work stations`,
      );
      return;
    }
    setLoading(true);

    try {
      if (editingId) {
        await apiClient.put(`/production/work-stations/${editingId}`, formData);
      } else {
        await apiClient.post("/production/work-stations", formData);
      }

      alert(
        editingId
          ? "Work station updated successfully"
          : "Work station created successfully",
      );
      resetForm();
      fetchWorkStations();
    } catch (error: any) {
      alert(
        "Failed to save work station: " + (error.message || "Unknown error"),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (station: WorkStation) => {
    if (!canEdit) {
      alert("You do not have permission to edit work stations");
      return;
    }
    setFormData({
      stationName: station.station_name,
      stationCode: station.station_code,
      stationType: station.station_type,
      capacityPerHour: station.capacity_per_hour || 0,
      isActive: station.is_active,
      description: station.description || "",
    });
    setEditingId(station.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!canDelete) {
      alert("You do not have permission to delete work stations");
      return;
    }
    const confirmed = await confirmDialog({
      title: "Delete Work Station",
      message: "Are you sure you want to delete this work station?",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!confirmed) return;

    setLoading(true);
    try {
      await apiClient.delete(`/production/work-stations/${id}`);
      alert("Work station deleted successfully");
      fetchWorkStations();
    } catch (error: any) {
      alert(error.response?.data?.message || "Failed to delete work station");
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      stationName: "",
      stationCode: "",
      stationType: "MACHINING",
      capacityPerHour: 1,
      isActive: true,
      description: "",
    });
    setEditingId(null);
    setShowForm(false);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#D8C8AA] bg-[#FFFDF8] p-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
            Production master data
          </p>
          <h1 className="mt-1 text-3xl font-bold text-[#3F2D20]">
            Work Stations
          </h1>
          <p className="mt-1 text-sm text-[#7A6555]">
            Manage production work centers and workstations
          </p>
        </div>
        {canCreate && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="rounded-lg bg-[#65452B] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#4A3526]"
          >
            {showForm ? "Cancel" : "+ New Work Station"}
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div className="rounded-xl border border-[#D8C8AA] bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-xl font-bold text-[#3F2D20]">
            {editingId ? "Edit Work Station" : "Create Work Station"}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.stationName}
                  onChange={(e) =>
                    setFormData({ ...formData, stationName: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g., CNC Machine 1"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Code <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.stationCode}
                  onChange={(e) =>
                    setFormData({ ...formData, stationCode: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g., WS-CNC-01"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Station Type <span className="text-red-600">*</span>
                </label>
                <select
                  required
                  value={formData.stationType}
                  onChange={(e) =>
                    setFormData({ ...formData, stationType: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {stationTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Capacity (operators) <span className="text-red-600">*</span>
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  value={formData.capacityPerHour}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      capacityPerHour: Number(e.target.value),
                    })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description (Optional)
              </label>
              <textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Additional details about this work station..."
              />
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                id="is_active"
                checked={formData.isActive}
                onChange={(e) =>
                  setFormData({ ...formData, isActive: e.target.checked })
                }
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label htmlFor="is_active" className="ml-2 text-sm text-gray-700">
                Active
              </label>
            </div>

            <div className="flex justify-end space-x-4">
              <button
                type="button"
                onClick={resetForm}
                className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || (editingId ? !canEdit : !canCreate)}
                className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
              >
                {loading ? "Saving..." : editingId ? "Update" : "Create"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg shadow">
        {loading && !showForm ? (
          <div className="px-6 py-12 text-center text-gray-500">Loading...</div>
        ) : workStations.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-500">
            No work stations found. Create one to get started.
          </div>
        ) : (
          <ListTable
            storageKey="workStationsTable"
            rows={workStations}
            columns={workStationsColumns}
            getRowId={(r) => r.id}
            defaultPageSize={10}
            pageSizeOptions={[10, 25, 50, 100]}
            searchPlaceholder="Search by code, name, type, status…"
          />
        )}
      </div>
    </div>
  );
}
