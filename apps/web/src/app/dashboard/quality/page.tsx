"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiClient } from "../../../../lib/api-client";
import {
  ListTable,
  type ListTableColumn,
} from "../../../components/ui/ListTable";
import DateInput from "../../../components/ui/DateInput";
import { getTodayDateInputValue } from "@/lib/date";
import { hasModulePermission, readStoredUser } from "@/lib/rbac";
import { useEscapeKey } from "../../../hooks/useEscapeKey";

interface Inspection {
  id: string;
  inspection_number: string;
  inspection_type: "INCOMING" | "IN_PROCESS" | "FINAL";
  status: "PENDING" | "IN_PROGRESS" | "PASSED" | "FAILED" | "ON_HOLD";
  inspection_date: string;
  item_name: string;
  inspected_quantity: number;
  accepted_quantity: number;
  rejected_quantity: number;
  on_hold_quantity: number;
  defect_rate: number;
  inspector_name: string;
  grn_id?: string;
  uid?: string;
  completion_date?: string;
  inspector_remarks?: string;
}

interface NCR {
  id: string;
  ncr_number: string;
  status:
    | "OPEN"
    | "UNDER_REVIEW"
    | "ACTION_PLANNED"
    | "IN_PROGRESS"
    | "RESOLVED"
    | "CLOSED";
  ncr_date: string;
  description: string;
  root_cause: string;
  corrective_action: string;
  containment_action: string;
  preventive_action: string;
  raised_by: string;
  nonconformance_type: string;
  item_name?: string;
  quantity_affected?: number;
}

interface VendorRating {
  vendor_name: string;
  total_inspections: number;
  passed_inspections: number;
  pass_rate: number;
  total_defects: number;
  defect_rate_ppm: number;
  ncr_count: number;
  quality_score: number;
  quality_grade: string;
}

interface QualityDashboard {
  total_inspections: number;
  passed_inspections: number;
  failed_inspections: number;
  pass_rate: number;
  open_ncrs: number;
  closed_ncrs: number;
  top_defects: Array<{ defect_type: string; count: number }>;
}

function QualityPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentUser = readStoredUser();
  const canCreate = hasModulePermission(
    currentUser,
    "Quality Control",
    "create",
  );
  const canEdit = hasModulePermission(currentUser, "Quality Control", "edit");
  const canDelete = hasModulePermission(
    currentUser,
    "Quality Control",
    "delete",
  );
  const todayDate = getTodayDateInputValue();
  const [activeTab, setActiveTab] = useState<
    "inspections" | "ncr" | "vendors" | "dashboard"
  >("inspections");
  useEffect(() => {
    const requested = searchParams.get("tab");
    if (
      requested &&
      ["inspections", "ncr", "vendors", "dashboard"].includes(requested)
    ) {
      setActiveTab(
        requested as "inspections" | "ncr" | "vendors" | "dashboard",
      );
    }
  }, [searchParams]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [ncrs, setNcrs] = useState<NCR[]>([]);
  const [vendorRatings, setVendorRatings] = useState<VendorRating[]>([]);
  const [dashboard, setDashboard] = useState<QualityDashboard | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [sortColumn, setSortColumn] = useState<string>("inspection_date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  // Dropdown data
  const [grns, setGrns] = useState<any[]>([]);
  const [uids, setUids] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [selectedGRN, setSelectedGRN] = useState<any>(null);

  // Inspection form state
  const [showInspectionForm, setShowInspectionForm] = useState(false);
  const [inspectionForm, setInspectionForm] = useState({
    inspection_type: "INCOMING",
    reference_type: "GRN",
    reference_id: "",
    item_id: "",
    uid: "",
    quantity_inspected: 0,
    inspector_id: "",
    inspection_date: getTodayDateInputValue(),
    remarks: "",
  });

  // NCR form state
  const [showNcrForm, setShowNcrForm] = useState(false);
  const [ncrForm, setNcrForm] = useState({
    related_to: "INSPECTION",
    reference_id: "",
    issue_description: "",
    severity: "MEDIUM",
    root_cause: "",
    containment_action: "",
    corrective_action: "",
    preventive_action: "",
  });

  // Complete inspection form state
  const [showCompleteForm, setShowCompleteForm] = useState(false);
  const [completeInspectionId, setCompleteInspectionId] = useState("");
  const [completeForm, setCompleteForm] = useState({
    inspection_status: "PASSED",
    quantity_accepted: 0,
    quantity_rejected: 0,
    quantity_on_hold: 0,
    inspector_remarks: "",
    generate_ncr: false,
    ncr_description: "",
  });
  const [completionParameters, setCompletionParameters] = useState<any[]>([]);

  // Edit/Delete state
  const [editingInspection, setEditingInspection] = useState<any>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(
    null,
  );
  const [viewingInspection, setViewingInspection] = useState<any>(null);
  const [viewingNCR, setViewingNCR] = useState<any>(null);
  const [editingNCR, setEditingNCR] = useState<any>(null);

  // Close modals on Escape key
  useEscapeKey(showInspectionForm, () => setShowInspectionForm(false));
  useEscapeKey(showNcrForm, () => setShowNcrForm(false));
  useEscapeKey(showCompleteForm, () => setShowCompleteForm(false));
  useEscapeKey(!!viewingInspection, () => setViewingInspection(null));
  useEscapeKey(!!viewingNCR, () => setViewingNCR(null));
  useEscapeKey(!!editingNCR, () => setEditingNCR(null));

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab]);

  useEffect(() => {
    if (showInspectionForm) {
      fetchFormData();
    }
  }, [showInspectionForm]);

  const fetchFormData = async () => {
    try {
      // Fetch all UIDs for inspection (with forInspection flag)
      const uidsData = await apiClient.get("/uid?forInspection=true");
      const normalizedUids = Array.isArray(uidsData)
        ? uidsData
        : Array.isArray((uidsData as any)?.data)
          ? (uidsData as any).data
          : [];
      setUids(normalizedUids);

      // Fetch users (for inspectors)
      const usersData = await apiClient.get("/users");
      const normalizedUsers = Array.isArray(usersData)
        ? usersData
        : Array.isArray((usersData as any)?.data)
          ? (usersData as any).data
          : [];
      setUsers(normalizedUsers);
    } catch (error) {
      setUids([]);
      setUsers([]);
    }
  };

  const handleUIDChange = async (uid: string) => {
    if (!uid) {
      setSelectedGRN(null);
      return;
    }

    try {
      // Fetch UID details which contains vendor, item, GRN info
      const uidDetails = await apiClient.get(`/uid/details/${uid}`);

      const grnId = uidDetails.grnId || uidDetails.grn_id || null;
      let grnDetails: any = null;

      if (grnId) {
        try {
          grnDetails = await apiClient.get(`/purchase/grn/${grnId}`);
        } catch (grnError) {}
      }

      const vendorName =
        uidDetails.vendorName ||
        uidDetails.vendor_name ||
        grnDetails?.vendor?.name ||
        grnDetails?.vendor_name ||
        "";
      const vendorId =
        uidDetails.vendorId ||
        uidDetails.vendor_id ||
        grnDetails?.vendor_id ||
        null;
      const resolvedGrnNumber =
        uidDetails.grnNumber ||
        uidDetails.grn_number ||
        grnDetails?.grn_number ||
        (grnId ? `GRN-${String(grnId).substring(0, 8)}` : "");
      const itemId = uidDetails.itemId || uidDetails.item_id || "";
      const itemName = uidDetails.itemName || uidDetails.item_name || "";
      const itemCode = uidDetails.itemCode || uidDetails.item_code || "";
      const batchNumber =
        uidDetails.batchNumber ||
        uidDetails.batch_number ||
        grnDetails?.batch_number ||
        "";
      const lotNumber =
        uidDetails.lotNumber ||
        uidDetails.lot_number ||
        grnDetails?.lot_number ||
        "";

      // Create a mock GRN object with vendor and item info from UID for display
      const mockGRN = {
        id: grnId,
        grn_number: resolvedGrnNumber || "Not linked to GRN",
        vendor_id: vendorId,
        vendor_name: vendorName || "Not linked to vendor",
        batch_number: batchNumber,
        lot_number: lotNumber,
        grn_items: [
          {
            item_id: itemId,
            item_name: itemName,
            item_code: itemCode,
          },
        ],
      };

      setSelectedGRN(mockGRN);

      // Auto-fill form with UID data
      setInspectionForm({
        ...inspectionForm,
        uid: uid,
        reference_id: grnId || "",
        item_id: itemId || "",
        quantity_inspected: 1, // UID represents 1 unit
      });
    } catch (error) {
      alert("Failed to fetch UID information. Please check if the UID exists.");
    }
  };

  const fetchData = async () => {
    try {
      if (activeTab === "inspections") {
        const data = await apiClient.get("/quality/inspections");
        setInspections(data);
      } else if (activeTab === "ncr") {
        const data = await apiClient.get("/quality/ncr");
        setNcrs(data);
      } else if (activeTab === "vendors") {
        const data = await apiClient.get("/quality/vendor-ratings");
        setVendorRatings(data);
      } else if (activeTab === "dashboard") {
        const data = await apiClient.get("/quality/dashboard");
        setDashboard(data);
      }
    } catch (error) {}
  };

  const handleCreateInspection = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate UID is selected
    if (!inspectionForm.uid) {
      alert(
        "UID is required for quality inspection. UID enables complete traceability.",
      );
      return;
    }

    try {
      // Find selected inspector details
      const selectedInspector = users.find(
        (user: any) => user.id === inspectionForm.inspector_id,
      );

      // Get vendor and item details from selectedGRN (populated by handleUIDChange)
      const itemName = selectedGRN?.grn_items?.[0]?.item_name || "";
      const itemCode = selectedGRN?.grn_items?.[0]?.item_code || "";
      const vendorId = selectedGRN?.vendor_id || null;
      const vendorName = selectedGRN?.vendor_name || "";

      // Prepare data with all required fields
      const inspectionData = {
        inspection_type: inspectionForm.inspection_type,
        inspection_date: inspectionForm.inspection_date,
        grn_id: inspectionForm.reference_id || null,
        uid: inspectionForm.uid, // UID is now mandatory
        item_id: inspectionForm.item_id,
        item_name: itemName,
        item_code: itemCode,
        vendor_id: vendorId,
        vendor_name: vendorName,
        batch_number: selectedGRN?.batch_number || "",
        lot_number: selectedGRN?.lot_number || "",
        inspected_quantity: inspectionForm.quantity_inspected || 1,
        inspector_name:
          selectedInspector?.full_name || selectedInspector?.email || "",
        inspection_checklist: inspectionForm.remarks || "",
      };

      await apiClient.post("/quality/inspections", inspectionData);
      setShowInspectionForm(false);
      setInspectionForm({
        inspection_type: "INCOMING",
        reference_type: "GRN",
        reference_id: "",
        item_id: "",
        uid: "",
        quantity_inspected: 0,
        inspector_id: "",
        inspection_date: getTodayDateInputValue(),
        remarks: "",
      });
      setSelectedGRN(null);
      fetchData();
      alert("Inspection created successfully");
    } catch (error) {
      alert("Failed to create inspection");
    }
  };

  const openCompleteInspection = async (inspection: Inspection) => {
    try {
      const detail = await apiClient.get<any>(
        `/quality/inspections/${inspection.id}`,
      );
      setCompleteInspectionId(inspection.id);
      setCompleteForm((prev) => ({
        ...prev,
        inspection_status: "PASSED",
        quantity_accepted: inspection.inspected_quantity,
        quantity_rejected: 0,
        quantity_on_hold: 0,
      }));
      setCompletionParameters(
        (detail?.parameters || []).map((parameter: any) => ({
          ...parameter,
          measured_value: parameter.measured_value || "",
          result: parameter.result || "",
          remarks: parameter.remarks || "",
        })),
      );
      setShowCompleteForm(true);
    } catch (error: any) {
      alert(error?.message || "Failed to load inspection parameters");
    }
  };

  const handleCompleteInspection = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post(
        `/quality/inspections/${completeInspectionId}/complete`,
        {
          ...completeForm,
          parameter_results: completionParameters,
        },
      );
      setShowCompleteForm(false);
      setCompleteInspectionId("");
      setCompletionParameters([]);
      setCompleteForm({
        inspection_status: "PASSED",
        quantity_accepted: 0,
        quantity_rejected: 0,
        quantity_on_hold: 0,
        inspector_remarks: "",
        generate_ncr: false,
        ncr_description: "",
      });
      fetchData();
      alert("Inspection completed successfully");
    } catch (error: any) {
      alert(error?.message || "Failed to complete inspection");
    }
  };

  const handleCreateNcr = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post("/quality/ncr", ncrForm);
      setShowNcrForm(false);
      setNcrForm({
        related_to: "INSPECTION",
        reference_id: "",
        issue_description: "",
        severity: "MEDIUM",
        root_cause: "",
        containment_action: "",
        corrective_action: "",
        preventive_action: "",
      });
      fetchData();
      alert("NCR created successfully");
    } catch (error) {
      alert("Failed to create NCR");
    }
  };

  const handleEditInspection = (inspection: any) => {
    setEditingInspection(inspection);
    setInspectionForm({
      inspection_type: inspection.inspection_type,
      reference_type: "GRN", // Assuming GRN for now
      reference_id: inspection.grn_id || "",
      item_id: inspection.item_id || "",
      uid: inspection.uid || "",
      quantity_inspected: inspection.quantity_inspected || 0,
      inspector_id: inspection.inspector_id || "",
      inspection_date: inspection.inspection_date
        ? String(inspection.inspection_date).split("T")[0]
        : getTodayDateInputValue(),
      remarks: inspection.remarks || "",
    });
    setShowInspectionForm(true);
  };

  const handleUpdateInspection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingInspection) return;

    try {
      // Defensive: Ensure item_id is always UUID
      let itemId = inspectionForm.item_id;
      if (selectedGRN?.grn_items) {
        const found = selectedGRN.grn_items.find(
          (item: any) => item.item_id === itemId,
        );
        if (!found) {
          const fallback = selectedGRN.grn_items.find(
            (item: any) =>
              item.item_name === itemId || item.item_code === itemId,
          );
          if (fallback) {
            itemId = fallback.item_id;
          }
        }
      }

      const selectedItem = selectedGRN?.grn_items?.find(
        (item: any) => item.item_id === itemId,
      );
      const selectedInspector = users.find(
        (user: any) => user.id === inspectionForm.inspector_id,
      );

      const updateData = {
        inspection_type: inspectionForm.inspection_type,
        inspection_date: inspectionForm.inspection_date,
        grn_id: inspectionForm.reference_id,
        uid: inspectionForm.uid || null,
        item_id: itemId,
        item_name: selectedItem?.item_name || "",
        item_code: selectedItem?.item_code || "",
        vendor_id: selectedGRN?.vendor_id || null,
        vendor_name: selectedGRN?.vendor_name || "",
        batch_number: selectedGRN?.batch_number || "",
        lot_number: selectedGRN?.lot_number || "",
        inspected_quantity: inspectionForm.quantity_inspected || 0,
        inspector_id: inspectionForm.inspector_id,
        inspector_name:
          selectedInspector?.full_name || selectedInspector?.email || "",
        inspection_checklist: inspectionForm.remarks || "",
        remarks: inspectionForm.remarks,
      };

      await apiClient.put(
        `/quality/inspections/${editingInspection.id}`,
        updateData,
      );
      setShowInspectionForm(false);
      setEditingInspection(null);
      setInspectionForm({
        inspection_type: "INCOMING",
        reference_type: "GRN",
        reference_id: "",
        item_id: "",
        uid: "",
        quantity_inspected: 0,
        inspector_id: "",
        inspection_date: getTodayDateInputValue(),
        remarks: "",
      });
      setSelectedGRN(null);
      fetchData();
      alert("Inspection updated successfully");
    } catch (error) {
      alert("Failed to update inspection");
    }
  };

  const handleDeleteInspection = async (inspectionId: string) => {
    try {
      await apiClient.delete(`/quality/inspections/${inspectionId}`);
      setShowDeleteConfirm(null);
      fetchData();
      alert("Inspection deleted successfully");
    } catch (error) {
      alert("Failed to delete inspection");
    }
  };

  const getStatusColor = (status: string) => {
    const colors: { [key: string]: string } = {
      PENDING: "bg-yellow-100 text-yellow-800",
      IN_PROGRESS: "bg-blue-100 text-blue-800",
      PASSED: "bg-green-100 text-green-800",
      FAILED: "bg-red-100 text-red-800",
      ON_HOLD: "bg-gray-100 text-gray-800",
      OPEN: "bg-red-100 text-red-800",
      UNDER_REVIEW: "bg-yellow-100 text-yellow-800",
      ACTION_PLANNED: "bg-blue-100 text-blue-800",
      RESOLVED: "bg-purple-100 text-purple-800",
      CLOSED: "bg-green-100 text-green-800",
    };
    return colors[status] || "bg-gray-100 text-gray-800";
  };

  const getGradeColor = (grade: string) => {
    const colors: { [key: string]: string } = {
      "A+": "bg-green-600 text-white",
      A: "bg-green-500 text-white",
      B: "bg-blue-500 text-white",
      C: "bg-yellow-500 text-white",
      D: "bg-orange-500 text-white",
      F: "bg-red-500 text-white",
    };
    return colors[grade] || "bg-gray-500 text-white";
  };

  const inspectionColumns: Array<ListTableColumn<Inspection>> = [
    {
      id: "inspection_number",
      label: "Inspection #",
      accessor: (r) => r.inspection_number,
      cell: (r) => (
        <span className="font-medium text-amber-600">
          {r.inspection_number}
        </span>
      ),
      sortable: true,
      hideable: false,
    },
    {
      id: "inspection_type",
      label: "Type",
      accessor: (r) => r.inspection_type,
      cell: (r) => (
        <span className="px-2 py-1 text-xs rounded bg-purple-100 text-purple-800">
          {r.inspection_type}
        </span>
      ),
      sortable: true,
    },
    {
      id: "inspection_date",
      label: "Date",
      accessor: (r) => r.inspection_date,
      sortAccessor: (r) => new Date(r.inspection_date),
      cell: (r) => new Date(r.inspection_date).toLocaleDateString(),
      sortable: true,
    },
    {
      id: "item_name",
      label: "Item",
      accessor: (r) => r.item_name,
      sortable: true,
    },
    {
      id: "inspected_quantity",
      label: "Qty Inspected",
      accessor: (r) => r.inspected_quantity,
      align: "right",
      sortable: true,
    },
    {
      id: "accepted_quantity",
      label: "Accepted",
      accessor: (r) => r.accepted_quantity ?? 0,
      align: "right",
      cell: (r) => (
        <span className="text-green-600">{r.accepted_quantity || 0}</span>
      ),
      sortable: true,
    },
    {
      id: "rejected_quantity",
      label: "Rejected",
      accessor: (r) => r.rejected_quantity ?? 0,
      align: "right",
      cell: (r) => (
        <span className="text-red-600">{r.rejected_quantity || 0}</span>
      ),
      sortable: true,
    },
    {
      id: "defect_rate",
      label: "Defect Rate",
      accessor: (r) => r.defect_rate,
      align: "right",
      cell: (r) =>
        typeof r.defect_rate === "number"
          ? `${r.defect_rate.toFixed(2)}%`
          : "-",
      sortable: true,
    },
    {
      id: "status",
      label: "Status",
      accessor: (r) => r.status,
      cell: (r) => (
        <span
          className={`px-2 py-1 text-xs rounded ${getStatusColor(r.status)}`}
        >
          {r.status}
        </span>
      ),
      sortable: true,
    },
    {
      id: "inspector_name",
      label: "Inspector",
      accessor: (r) => r.inspector_name,
      sortable: true,
    },
    {
      id: "actions",
      label: "Actions",
      hideable: false,
      sortable: false,
      cell: (inspection) => (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <button
            onClick={() => setViewingInspection(inspection)}
            className="text-gray-600 hover:text-gray-800"
          >
            View
          </button>
          {inspection.status === "PENDING" && (
            <>
              {canEdit && (
                <button
                  onClick={() => handleEditInspection(inspection)}
                  className="text-blue-600 hover:text-blue-800"
                >
                  Edit
                </button>
              )}
              {canDelete && (
                <button
                  onClick={() => setShowDeleteConfirm(inspection.id)}
                  className="text-red-600 hover:text-red-800"
                >
                  Delete
                </button>
              )}
            </>
          )}
          {(inspection.status === "PENDING" ||
            inspection.status === "IN_PROGRESS") && (
            <button
              onClick={() => openCompleteInspection(inspection)}
              className="text-amber-600 hover:text-amber-800"
            >
              Complete
            </button>
          )}
        </div>
      ),
    },
  ];

  const ncrColumns: Array<ListTableColumn<NCR>> = [
    {
      id: "ncr_number",
      label: "NCR #",
      accessor: (r) => r.ncr_number,
      cell: (r) => (
        <span className="font-medium text-red-600">{r.ncr_number}</span>
      ),
      sortable: true,
      hideable: false,
    },
    {
      id: "ncr_date",
      label: "Raised Date",
      accessor: (r) => r.ncr_date,
      sortAccessor: (r) => new Date(r.ncr_date),
      cell: (r) => new Date(r.ncr_date).toLocaleDateString(),
      sortable: true,
    },
    {
      id: "item",
      label: "Item/Part",
      accessor: (r) => r.item_name || "",
      cell: (r) =>
        r.item_name ? (
          <div>
            <div className="font-medium">{r.item_name}</div>
            {r.quantity_affected ? (
              <div className="text-xs text-gray-500">
                Qty: {r.quantity_affected}
              </div>
            ) : null}
          </div>
        ) : (
          <span className="text-gray-400">-</span>
        ),
      sortable: true,
    },
    {
      id: "description",
      label: "Issue Description",
      accessor: (r) => r.description,
      cell: (r) => (
        <span className="block max-w-xs truncate">{r.description}</span>
      ),
      sortable: true,
    },
    {
      id: "status",
      label: "Status",
      accessor: (r) => r.status,
      cell: (r) => (
        <span
          className={`px-2 py-1 text-xs rounded ${getStatusColor(r.status)}`}
        >
          {r.status.replace(/_/g, " ")}
        </span>
      ),
      sortable: true,
    },
    {
      id: "root_cause",
      label: "Root Cause",
      accessor: (r) => r.root_cause,
      cell: (r) => (
        <span className="block max-w-xs truncate">
          {r.root_cause ? (
            r.root_cause
          ) : (
            <span className="text-gray-400">Pending investigation</span>
          )}
        </span>
      ),
      sortable: true,
    },
    {
      id: "actions",
      label: "Actions",
      hideable: false,
      sortable: false,
      cell: (ncr) => (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <button
            onClick={() => setViewingNCR(ncr)}
            className="text-gray-600 hover:text-gray-800"
          >
            View
          </button>
          {ncr.status !== "CLOSED" && canEdit && (
            <button
              onClick={() => setEditingNCR(ncr)}
              className="text-blue-600 hover:text-blue-800"
            >
              Update
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Quality & Inspection Management</h1>
        <div className="space-x-2">
          {activeTab === "inspections" && canCreate && (
            <button
              onClick={() => setShowInspectionForm(true)}
              className="bg-amber-600 text-white px-4 py-2 rounded hover:bg-amber-700"
            >
              + New Inspection
            </button>
          )}
          {activeTab === "ncr" && canCreate && (
            <button
              onClick={() => setShowNcrForm(true)}
              className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
            >
              + New NCR
            </button>
          )}
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
        <span>
          <b>Current workspace:</b>{" "}
          {activeTab === "ncr"
            ? "Non-conformance reports"
            : activeTab === "vendors"
              ? "Supplier quality"
              : activeTab}
        </span>
        <span className="text-xs text-amber-800">
          Use the Quality menu to switch workspaces.
        </span>
      </div>

      {/* Inspections Tab */}
      {activeTab === "inspections" && (
        <ListTable
          storageKey="qualityInspectionsTable"
          rows={inspections}
          columns={inspectionColumns}
          getRowId={(r) => r.id}
          searchPlaceholder="Search inspections…"
          emptyState="No inspections"
        />
      )}

      {/* NCR Tab */}
      {activeTab === "ncr" && (
        <ListTable
          storageKey="qualityNcrTable"
          rows={ncrs}
          columns={ncrColumns}
          getRowId={(r) => r.id}
          searchPlaceholder="Search NCRs…"
          emptyState="No NCRs"
        />
      )}

      {/* Vendor Ratings Tab */}
      {activeTab === "vendors" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {vendorRatings.map((vendor, index) => (
            <div key={index} className="bg-white rounded-lg shadow p-6">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-lg font-semibold">{vendor.vendor_name}</h3>
                <span
                  className={`px-3 py-1 rounded-full font-bold ${getGradeColor(vendor.quality_grade)}`}
                >
                  {vendor.quality_grade}
                </span>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Quality Score:</span>
                  <span className="font-semibold">
                    {vendor.quality_score.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Pass Rate:</span>
                  <span className="font-semibold text-green-600">
                    {vendor.pass_rate.toFixed(2)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">
                    Defect Rate (PPM):
                  </span>
                  <span className="font-semibold text-orange-600">
                    {vendor.defect_rate_ppm.toFixed(0)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">
                    Total Inspections:
                  </span>
                  <span className="font-semibold">
                    {vendor.total_inspections}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Passed:</span>
                  <span className="font-semibold text-green-600">
                    {vendor.passed_inspections}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">NCR Count:</span>
                  <span className="font-semibold text-red-600">
                    {vendor.ncr_count}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dashboard Tab */}
      {activeTab === "dashboard" && dashboard && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600 mb-2">
                Total Inspections
              </div>
              <div className="text-3xl font-bold text-amber-600">
                {dashboard.total_inspections}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600 mb-2">Pass Rate</div>
              <div className="text-3xl font-bold text-green-600">
                {dashboard.pass_rate.toFixed(1)}%
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600 mb-2">Open NCRs</div>
              <div className="text-3xl font-bold text-red-600">
                {dashboard.open_ncrs}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600 mb-2">Closed NCRs</div>
              <div className="text-3xl font-bold text-gray-600">
                {dashboard.closed_ncrs}
              </div>
            </div>
          </div>

          {/* Inspection Breakdown */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Inspection Results</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-4 bg-green-50 rounded">
                <div className="text-2xl font-bold text-green-600">
                  {dashboard.passed_inspections}
                </div>
                <div className="text-sm text-gray-600">Passed</div>
              </div>
              <div className="text-center p-4 bg-red-50 rounded">
                <div className="text-2xl font-bold text-red-600">
                  {dashboard.failed_inspections}
                </div>
                <div className="text-sm text-gray-600">Failed</div>
              </div>
              <div className="text-center p-4 bg-gray-50 rounded">
                <div className="text-2xl font-bold text-gray-600">
                  {dashboard.total_inspections -
                    dashboard.passed_inspections -
                    dashboard.failed_inspections}
                </div>
                <div className="text-sm text-gray-600">Pending</div>
              </div>
            </div>
          </div>

          {/* Top Defects */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Top 5 Defect Types</h3>
            <div className="space-y-3">
              {dashboard.top_defects.map((defect, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-red-100 text-red-600 rounded-full flex items-center justify-center font-semibold">
                      {index + 1}
                    </div>
                    <span className="font-medium">{defect.defect_type}</span>
                  </div>
                  <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm font-semibold">
                    {defect.count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Create Inspection Modal */}
      {showInspectionForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">
              {editingInspection ? "Edit Inspection" : "Create New Inspection"}
            </h2>
            <form
              onSubmit={
                editingInspection
                  ? handleUpdateInspection
                  : handleCreateInspection
              }
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Inspection Type
                  </label>
                  <select
                    value={inspectionForm.inspection_type}
                    onChange={(e) =>
                      setInspectionForm({
                        ...inspectionForm,
                        inspection_type: e.target.value,
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                    required
                  >
                    <option value="INCOMING">Incoming (IQC)</option>
                    <option value="IN_PROCESS">In-Process (IPQC)</option>
                    <option value="FINAL">Final (FQC)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Inspection Date
                  </label>
                  <DateInput
                    max={todayDate}
                    value={inspectionForm.inspection_date}
                    onChange={(value) =>
                      setInspectionForm({
                        ...inspectionForm,
                        inspection_date: value,
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                    required
                  />
                </div>
              </div>

              {/* UID Selection - PRIMARY FIELD - MANDATORY FOR TRACEABILITY */}
              <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-4">
                <label className="block text-sm font-semibold mb-2 text-amber-900">
                  🔍 Select UID (Required for Traceability) *
                </label>
                <select
                  value={inspectionForm.uid}
                  onChange={(e) => handleUIDChange(e.target.value)}
                  className="w-full border-2 border-amber-400 rounded px-3 py-2 focus:border-amber-600 focus:ring-2 focus:ring-amber-200"
                  required
                >
                  <option value="">Search and select UID...</option>
                  {uids.map((uid: any) => (
                    <option key={uid.uid} value={uid.uid}>
                      {uid.uid} -{" "}
                      {uid.entityType || uid.entity_type || "UNKNOWN"} (
                      {uid.status || uid.quality_status || "UNKNOWN"})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-amber-700 mt-1">
                  ℹ️ UID is mandatory as it enables complete product
                  traceability from receipt through warranty to repairs
                </p>
              </div>

              {/* Auto-populated Vendor Information (read-only) */}
              {selectedGRN && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="text-sm font-semibold mb-2 text-blue-900">
                    📦 Auto-populated from UID
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-blue-700 mb-1">
                        Vendor
                      </label>
                      <input
                        type="text"
                        value={
                          selectedGRN.vendor_name || "Not linked to vendor"
                        }
                        className="w-full border rounded px-3 py-2 bg-gray-50 text-gray-700"
                        readOnly
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-blue-700 mb-1">
                        Item Code
                      </label>
                      <input
                        type="text"
                        value={selectedGRN.grn_items?.[0]?.item_code || "-"}
                        className="w-full border rounded px-3 py-2 bg-gray-50 text-gray-700"
                        readOnly
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-blue-700 mb-1">
                        Item Name
                      </label>
                      <input
                        type="text"
                        value={selectedGRN.grn_items?.[0]?.item_name || "-"}
                        className="w-full border rounded px-3 py-2 bg-gray-50 text-gray-700"
                        readOnly
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-blue-700 mb-1">
                        Batch Number
                      </label>
                      <input
                        type="text"
                        value={selectedGRN.batch_number || "-"}
                        className="w-full border rounded px-3 py-2 bg-gray-50 text-gray-700"
                        readOnly
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-blue-700 mb-1">
                        GRN Number
                      </label>
                      <input
                        type="text"
                        value={selectedGRN.grn_number || "-"}
                        className="w-full border rounded px-3 py-2 bg-gray-50 text-gray-700"
                        readOnly
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Quantity to Inspect
                  </label>
                  <input
                    type="number"
                    value={inspectionForm.quantity_inspected}
                    onChange={(e) =>
                      setInspectionForm({
                        ...inspectionForm,
                        quantity_inspected: parseFloat(e.target.value),
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                    min="0"
                    step="0.01"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Usually 1 for UID-based inspection
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Inspector
                  </label>
                  <select
                    value={inspectionForm.inspector_id}
                    onChange={(e) =>
                      setInspectionForm({
                        ...inspectionForm,
                        inspector_id: e.target.value,
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                    required
                  >
                    <option value="">Select Inspector...</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {`${user.first_name || ""} ${user.last_name || ""}`.trim() ||
                          user.full_name ||
                          user.email}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Remarks
                </label>
                <textarea
                  value={inspectionForm.remarks}
                  onChange={(e) =>
                    setInspectionForm({
                      ...inspectionForm,
                      remarks: e.target.value,
                    })
                  }
                  className="w-full border rounded px-3 py-2"
                  rows={3}
                  placeholder="Visual inspection notes, dimensional checks, functional tests..."
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowInspectionForm(false);
                    setEditingInspection(null);
                    setInspectionForm({
                      inspection_type: "INCOMING",
                      reference_type: "GRN",
                      reference_id: "",
                      item_id: "",
                      uid: "",
                      quantity_inspected: 0,
                      inspector_id: "",
                      inspection_date: getTodayDateInputValue(),
                      remarks: "",
                    });
                    setSelectedGRN(null);
                  }}
                  className="px-4 py-2 border rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700"
                  disabled={!inspectionForm.uid}
                >
                  {editingInspection
                    ? "Update Inspection"
                    : "Create Inspection"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Complete Inspection Modal */}
      {showCompleteForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Complete Inspection</h2>
            <form onSubmit={handleCompleteInspection} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Inspection Status
                </label>
                <select
                  value={completeForm.inspection_status}
                  onChange={(e) =>
                    setCompleteForm({
                      ...completeForm,
                      inspection_status: e.target.value,
                    })
                  }
                  className="w-full border rounded px-3 py-2"
                  required
                >
                  <option value="PASSED">Passed</option>
                  <option value="FAILED">Failed</option>
                  <option value="ON_HOLD">On Hold</option>
                </select>
              </div>

              {completionParameters.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
                  <h3 className="font-semibold text-gray-900">
                    Inspection plan results
                  </h3>
                  <p className="mb-3 text-xs text-gray-600">
                    Numeric results are evaluated against the approved tolerance
                    by the server.
                  </p>
                  <div className="space-y-3">
                    {completionParameters.map((parameter, index) => {
                      const dataType = String(
                        parameter.data_type ||
                          parameter.parameter_type ||
                          "TEXT",
                      ).toUpperCase();
                      return (
                        <div
                          key={parameter.id}
                          className="grid gap-2 rounded border bg-white p-3 md:grid-cols-[1.3fr_1fr_1fr]"
                        >
                          <div>
                            <div className="text-sm font-semibold">
                              {parameter.sequence_number
                                ? `${parameter.sequence_number}. `
                                : ""}
                              {parameter.parameter_name}
                            </div>
                            <div className="text-xs text-gray-500">
                              {parameter.specification}
                              {parameter.unit_of_measure
                                ? ` · ${parameter.unit_of_measure}`
                                : ""}{" "}
                              · {parameter.criticality || "MAJOR"}
                            </div>
                          </div>
                          {dataType !== "PASS_FAIL" && (
                            <input
                              aria-label={`${parameter.parameter_name} measured value`}
                              type={dataType === "NUMERIC" ? "number" : "text"}
                              step={dataType === "NUMERIC" ? "any" : undefined}
                              value={parameter.measured_value}
                              onChange={(event) =>
                                setCompletionParameters((rows) =>
                                  rows.map((row, rowIndex) =>
                                    rowIndex === index
                                      ? {
                                          ...row,
                                          measured_value: event.target.value,
                                        }
                                      : row,
                                  ),
                                )
                              }
                              className="rounded border px-3 py-2 text-sm"
                              placeholder="Measured value"
                              required={parameter.is_mandatory !== false}
                            />
                          )}
                          {dataType === "NUMERIC" ? (
                            <div className="rounded bg-gray-50 px-3 py-2 text-xs text-gray-600">
                              Tolerance {parameter.tolerance_min ?? "−∞"} to{" "}
                              {parameter.tolerance_max ?? "+∞"}
                            </div>
                          ) : (
                            <select
                              aria-label={`${parameter.parameter_name} result`}
                              value={parameter.result}
                              onChange={(event) =>
                                setCompletionParameters((rows) =>
                                  rows.map((row, rowIndex) =>
                                    rowIndex === index
                                      ? { ...row, result: event.target.value }
                                      : row,
                                  ),
                                )
                              }
                              className="rounded border px-3 py-2 text-sm"
                              required
                            >
                              <option value="">Select result</option>
                              <option value="PASS">Pass</option>
                              <option value="FAIL">Fail</option>
                              {parameter.is_mandatory === false && (
                                <option value="NA">Not applicable</option>
                              )}
                            </select>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Quantity Accepted
                  </label>
                  <input
                    type="number"
                    value={completeForm.quantity_accepted}
                    onChange={(e) =>
                      setCompleteForm({
                        ...completeForm,
                        quantity_accepted: parseFloat(e.target.value),
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                    min="0"
                    step="0.01"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Quantity Rejected
                  </label>
                  <input
                    type="number"
                    value={completeForm.quantity_rejected}
                    onChange={(e) =>
                      setCompleteForm({
                        ...completeForm,
                        quantity_rejected: parseFloat(e.target.value),
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                    min="0"
                    step="0.01"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Quantity On Hold
                  </label>
                  <input
                    type="number"
                    value={completeForm.quantity_on_hold}
                    onChange={(e) =>
                      setCompleteForm({
                        ...completeForm,
                        quantity_on_hold: parseFloat(e.target.value),
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                    min="0"
                    step="0.01"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Inspector Remarks
                </label>
                <textarea
                  value={completeForm.inspector_remarks}
                  onChange={(e) =>
                    setCompleteForm({
                      ...completeForm,
                      inspector_remarks: e.target.value,
                    })
                  }
                  className="w-full border rounded px-3 py-2"
                  rows={3}
                />
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={completeForm.generate_ncr}
                  onChange={(e) =>
                    setCompleteForm({
                      ...completeForm,
                      generate_ncr: e.target.checked,
                    })
                  }
                  className="rounded"
                />
                <label className="text-sm font-medium">
                  Generate NCR (Non-Conformance Report)
                </label>
              </div>

              {completeForm.generate_ncr && (
                <div>
                  <label className="block text-sm font-medium mb-1">
                    NCR Description
                  </label>
                  <textarea
                    value={completeForm.ncr_description}
                    onChange={(e) =>
                      setCompleteForm({
                        ...completeForm,
                        ncr_description: e.target.value,
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                    rows={3}
                    placeholder="Describe the non-conformance issue..."
                  />
                </div>
              )}

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCompleteForm(false)}
                  className="px-4 py-2 border rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                >
                  Complete Inspection
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create NCR Modal */}
      {showNcrForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">
              Create Non-Conformance Report (NCR)
            </h2>
            <form onSubmit={handleCreateNcr} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Related To
                  </label>
                  <select
                    value={ncrForm.related_to}
                    onChange={(e) =>
                      setNcrForm({ ...ncrForm, related_to: e.target.value })
                    }
                    className="w-full border rounded px-3 py-2"
                    required
                  >
                    <option value="INSPECTION">Inspection</option>
                    <option value="VENDOR">Vendor</option>
                    <option value="PRODUCTION">Production</option>
                    <option value="CUSTOMER_COMPLAINT">
                      Customer Complaint
                    </option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Severity
                  </label>
                  <select
                    value={ncrForm.severity}
                    onChange={(e) =>
                      setNcrForm({ ...ncrForm, severity: e.target.value })
                    }
                    className="w-full border rounded px-3 py-2"
                    required
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="CRITICAL">Critical</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Reference ID (UUID)
                </label>
                <input
                  type="text"
                  value={ncrForm.reference_id}
                  onChange={(e) =>
                    setNcrForm({ ...ncrForm, reference_id: e.target.value })
                  }
                  className="w-full border rounded px-3 py-2"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Issue Description
                </label>
                <textarea
                  value={ncrForm.issue_description}
                  onChange={(e) =>
                    setNcrForm({
                      ...ncrForm,
                      issue_description: e.target.value,
                    })
                  }
                  className="w-full border rounded px-3 py-2"
                  rows={3}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Root Cause Analysis
                </label>
                <textarea
                  value={ncrForm.root_cause}
                  onChange={(e) =>
                    setNcrForm({ ...ncrForm, root_cause: e.target.value })
                  }
                  className="w-full border rounded px-3 py-2"
                  rows={2}
                  placeholder="5 Whys, Fishbone analysis, etc."
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Containment Action (Immediate)
                </label>
                <textarea
                  value={ncrForm.containment_action}
                  onChange={(e) =>
                    setNcrForm({
                      ...ncrForm,
                      containment_action: e.target.value,
                    })
                  }
                  className="w-full border rounded px-3 py-2"
                  rows={2}
                  placeholder="Immediate actions to contain the issue"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Corrective Action (Eliminate Root Cause)
                </label>
                <textarea
                  value={ncrForm.corrective_action}
                  onChange={(e) =>
                    setNcrForm({
                      ...ncrForm,
                      corrective_action: e.target.value,
                    })
                  }
                  className="w-full border rounded px-3 py-2"
                  rows={2}
                  placeholder="Actions to eliminate root cause"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Preventive Action (Prevent Recurrence)
                </label>
                <textarea
                  value={ncrForm.preventive_action}
                  onChange={(e) =>
                    setNcrForm({
                      ...ncrForm,
                      preventive_action: e.target.value,
                    })
                  }
                  className="w-full border rounded px-3 py-2"
                  rows={2}
                  placeholder="Actions to prevent recurrence"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowNcrForm(false)}
                  className="px-4 py-2 border rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                >
                  Create NCR
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Confirm Delete</h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete this inspection? This action
              cannot be undone.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 border rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteInspection(showDeleteConfirm)}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Inspection Details Modal */}
      {viewingInspection && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xl font-bold">Inspection Details</h2>
              <button
                onClick={() => setViewingInspection(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <label className="text-sm font-medium text-gray-600">
                  Inspection Number
                </label>
                <p className="text-lg font-semibold text-amber-600">
                  {viewingInspection.inspection_number}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">
                  Status
                </label>
                <p>
                  <span
                    className={`px-3 py-1 text-sm rounded ${getStatusColor(viewingInspection.status)}`}
                  >
                    {viewingInspection.status}
                  </span>
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">
                  Type
                </label>
                <p className="font-medium">
                  {viewingInspection.inspection_type}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">
                  Date
                </label>
                <p className="font-medium">
                  {new Date(
                    viewingInspection.inspection_date,
                  ).toLocaleDateString()}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">
                  Item
                </label>
                <p className="font-medium">{viewingInspection.item_name}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">
                  Inspector
                </label>
                <p className="font-medium">
                  {viewingInspection.inspector_name}
                </p>
              </div>
            </div>

            <div className="border-t pt-4 mb-4">
              <h3 className="font-semibold mb-3">Inspection Results</h3>
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-blue-50 p-3 rounded">
                  <div className="text-sm text-gray-600">Inspected</div>
                  <div className="text-xl font-bold text-blue-600">
                    {viewingInspection.inspected_quantity}
                  </div>
                </div>
                <div className="bg-green-50 p-3 rounded">
                  <div className="text-sm text-gray-600">Accepted</div>
                  <div className="text-xl font-bold text-green-600">
                    {viewingInspection.accepted_quantity || 0}
                  </div>
                </div>
                <div className="bg-red-50 p-3 rounded">
                  <div className="text-sm text-gray-600">Rejected</div>
                  <div className="text-xl font-bold text-red-600">
                    {viewingInspection.rejected_quantity || 0}
                  </div>
                </div>
                <div className="bg-yellow-50 p-3 rounded">
                  <div className="text-sm text-gray-600">On Hold</div>
                  <div className="text-xl font-bold text-yellow-600">
                    {viewingInspection.on_hold_quantity || 0}
                  </div>
                </div>
              </div>
            </div>

            {viewingInspection.defect_rate && (
              <div className="border-t pt-4 mb-4">
                <label className="text-sm font-medium text-gray-600">
                  Defect Rate
                </label>
                <p className="text-2xl font-bold text-red-600">
                  {viewingInspection.defect_rate.toFixed(2)}%
                </p>
              </div>
            )}

            {viewingInspection.inspector_remarks && (
              <div className="border-t pt-4 mb-4">
                <label className="text-sm font-medium text-gray-600">
                  Inspector Remarks
                </label>
                <p className="mt-1 text-gray-800">
                  {viewingInspection.inspector_remarks}
                </p>
              </div>
            )}

            {viewingInspection.uid && (
              <div className="border-t pt-4 mb-4">
                <label className="text-sm font-medium text-gray-600">UID</label>
                <p className="font-mono text-sm bg-gray-100 p-2 rounded">
                  {viewingInspection.uid}
                </p>
              </div>
            )}

            <div className="flex justify-end pt-4">
              <button
                onClick={() => setViewingInspection(null)}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View NCR Details Modal */}
      {viewingNCR && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xl font-bold">NCR Details</h2>
              <button
                onClick={() => setViewingNCR(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <label className="text-sm font-medium text-gray-600">
                  NCR Number
                </label>
                <p className="text-lg font-semibold text-red-600">
                  {viewingNCR.ncr_number}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">
                  Status
                </label>
                <p>
                  <span
                    className={`px-3 py-1 text-sm rounded ${getStatusColor(viewingNCR.status)}`}
                  >
                    {viewingNCR.status}
                  </span>
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">
                  Type
                </label>
                <p className="font-medium">{viewingNCR.nonconformance_type}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">
                  Date Raised
                </label>
                <p className="font-medium">
                  {new Date(viewingNCR.ncr_date).toLocaleDateString()}
                </p>
              </div>
              {viewingNCR.item_name && (
                <div>
                  <label className="text-sm font-medium text-gray-600">
                    Item
                  </label>
                  <p className="font-medium">{viewingNCR.item_name}</p>
                </div>
              )}
              {viewingNCR.quantity_affected && (
                <div>
                  <label className="text-sm font-medium text-gray-600">
                    Quantity Affected
                  </label>
                  <p className="font-medium">{viewingNCR.quantity_affected}</p>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="border-t pt-4">
                <label className="text-sm font-medium text-gray-600 block mb-2">
                  Issue Description
                </label>
                <p className="text-gray-800 bg-gray-50 p-3 rounded">
                  {viewingNCR.description}
                </p>
              </div>

              {/* NCR Workflow Status */}
              <div className="border-t pt-4">
                <label className="text-sm font-medium text-gray-600 block mb-2">
                  NCR Workflow
                </label>
                <div className="bg-blue-50 border border-blue-200 rounded p-4">
                  <div className="flex items-center space-x-2 mb-2">
                    <span
                      className={`px-3 py-1 text-sm rounded ${getStatusColor(viewingNCR.status)}`}
                    >
                      {viewingNCR.status.replace(/_/g, " ")}
                    </span>
                    <span className="text-sm text-gray-600">
                      {viewingNCR.status === "OPEN" &&
                        "→ Issue identified, awaiting review"}
                      {viewingNCR.status === "UNDER_REVIEW" &&
                        "→ Being investigated by quality team"}
                      {viewingNCR.status === "ACTION_PLANNED" &&
                        "→ Corrective actions planned, awaiting execution"}
                      {viewingNCR.status === "IN_PROGRESS" &&
                        "→ Corrective actions being implemented"}
                      {viewingNCR.status === "RESOLVED" &&
                        "→ Actions completed, awaiting verification"}
                      {viewingNCR.status === "CLOSED" &&
                        "→ Verified and closed"}
                    </span>
                  </div>
                  <div className="text-xs text-gray-600 mt-2">
                    <p className="font-medium mb-1">Next Steps:</p>
                    {viewingNCR.status === "OPEN" && (
                      <ul className="list-disc list-inside space-y-1">
                        <li>Conduct root cause analysis</li>
                        <li>Update status to &quot;Under Review&quot;</li>
                      </ul>
                    )}
                    {viewingNCR.status === "UNDER_REVIEW" && (
                      <ul className="list-disc list-inside space-y-1">
                        <li>Complete root cause investigation</li>
                        <li>Plan corrective and preventive actions</li>
                        <li>Update status to &quot;Action Planned&quot;</li>
                      </ul>
                    )}
                    {viewingNCR.status === "ACTION_PLANNED" && (
                      <ul className="list-disc list-inside space-y-1">
                        <li>Begin implementing corrective actions</li>
                        <li>Update status to &quot;In Progress&quot;</li>
                      </ul>
                    )}
                    {viewingNCR.status === "IN_PROGRESS" && (
                      <ul className="list-disc list-inside space-y-1">
                        <li>Complete all corrective actions</li>
                        <li>Verify effectiveness</li>
                        <li>Update status to &quot;Resolved&quot;</li>
                      </ul>
                    )}
                    {viewingNCR.status === "RESOLVED" && (
                      <ul className="list-disc list-inside space-y-1">
                        <li>Final verification by quality manager</li>
                        <li>Close NCR if satisfactory</li>
                      </ul>
                    )}
                    {viewingNCR.status === "CLOSED" && (
                      <p className="text-green-700">
                        ✓ NCR completed and verified
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {viewingNCR.root_cause && (
                <div className="border-t pt-4">
                  <label className="text-sm font-medium text-gray-600 block mb-2">
                    Root Cause Analysis
                  </label>
                  <p className="text-gray-800 bg-gray-50 p-3 rounded">
                    {viewingNCR.root_cause}
                  </p>
                </div>
              )}

              {viewingNCR.containment_action && (
                <div className="border-t pt-4">
                  <label className="text-sm font-medium text-gray-600 block mb-2">
                    Containment Action (Immediate)
                  </label>
                  <p className="text-gray-800 bg-gray-50 p-3 rounded">
                    {viewingNCR.containment_action}
                  </p>
                </div>
              )}

              {viewingNCR.corrective_action && (
                <div className="border-t pt-4">
                  <label className="text-sm font-medium text-gray-600 block mb-2">
                    Corrective Action (Eliminate Root Cause)
                  </label>
                  <p className="text-gray-800 bg-gray-50 p-3 rounded">
                    {viewingNCR.corrective_action}
                  </p>
                </div>
              )}

              {viewingNCR.preventive_action && (
                <div className="border-t pt-4">
                  <label className="text-sm font-medium text-gray-600 block mb-2">
                    Preventive Action (Prevent Recurrence)
                  </label>
                  <p className="text-gray-800 bg-gray-50 p-3 rounded">
                    {viewingNCR.preventive_action}
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-3 pt-6 border-t mt-6">
              {viewingNCR.status !== "CLOSED" && (
                <button
                  onClick={() => {
                    setEditingNCR(viewingNCR);
                    setViewingNCR(null);
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Update NCR
                </button>
              )}
              <button
                onClick={() => setViewingNCR(null)}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit NCR Modal */}
      {editingNCR && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">
              Update NCR - {editingNCR.ncr_number}
            </h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await apiClient.put(`/quality/ncr/${editingNCR.id}`, {
                    status: editingNCR.status,
                    root_cause: editingNCR.root_cause,
                    containment_action: editingNCR.containment_action,
                    corrective_action: editingNCR.corrective_action,
                    preventive_action: editingNCR.preventive_action,
                  });
                  setEditingNCR(null);
                  fetchData();
                  alert("NCR updated successfully");
                } catch (error) {
                  alert("Failed to update NCR");
                }
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium mb-1">Status</label>
                <select
                  value={editingNCR.status}
                  onChange={(e) =>
                    setEditingNCR({ ...editingNCR, status: e.target.value })
                  }
                  className="w-full border rounded px-3 py-2"
                  required
                >
                  <option value="OPEN">Open</option>
                  <option value="UNDER_REVIEW">Under Review</option>
                  <option value="ACTION_PLANNED">Action Planned</option>
                  <option value="IN_PROGRESS">In Progress</option>
                  <option value="RESOLVED">Resolved</option>
                  <option value="CLOSED">Closed</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Root Cause Analysis
                </label>
                <textarea
                  value={editingNCR.root_cause || ""}
                  onChange={(e) =>
                    setEditingNCR({ ...editingNCR, root_cause: e.target.value })
                  }
                  className="w-full border rounded px-3 py-2"
                  rows={3}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Containment Action
                </label>
                <textarea
                  value={editingNCR.containment_action || ""}
                  onChange={(e) =>
                    setEditingNCR({
                      ...editingNCR,
                      containment_action: e.target.value,
                    })
                  }
                  className="w-full border rounded px-3 py-2"
                  rows={2}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Corrective Action
                </label>
                <textarea
                  value={editingNCR.corrective_action || ""}
                  onChange={(e) =>
                    setEditingNCR({
                      ...editingNCR,
                      corrective_action: e.target.value,
                    })
                  }
                  className="w-full border rounded px-3 py-2"
                  rows={2}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Preventive Action
                </label>
                <textarea
                  value={editingNCR.preventive_action || ""}
                  onChange={(e) =>
                    setEditingNCR({
                      ...editingNCR,
                      preventive_action: e.target.value,
                    })
                  }
                  className="w-full border rounded px-3 py-2"
                  rows={2}
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setEditingNCR(null)}
                  className="px-4 py-2 border rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Update NCR
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function QualityPage() {
  return <Suspense fallback={<div className="p-6">Loading Quality workspace...</div>}><QualityPageContent /></Suspense>;
}
