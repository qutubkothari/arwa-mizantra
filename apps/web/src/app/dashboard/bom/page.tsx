"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "../../../../lib/api-client";
import { confirmDialog } from "../../../components/ui/ConfirmDialog";
import ItemSearch from "../../../components/ItemSearch";
import DrawingManager from "../../../components/DrawingManager";
import DateInput from "../../../components/ui/DateInput";
import {
  readStoredUser,
  hasModulePermission,
  type StoredUser,
} from "../../../lib/rbac";
import { getTodayDateInputValue } from "../../../lib/date";
import { smartSearchMatches } from "../../../lib/smart-search";

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });

const dataUrlToBlob = (dataUrl: string) => {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) return null;

  const mimeType = match[1];
  const base64Data = match[2];
  const byteString = atob(base64Data);
  const byteArray = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    byteArray[i] = byteString.charCodeAt(i);
  }

  return new Blob([byteArray], { type: mimeType });
};

const openDrawingUrlInNewTab = (url: string) => {
  try {
    if (!url) return;

    if (url.startsWith("data:")) {
      const blob = dataUrlToBlob(url);
      if (!blob) {
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  } catch (error) {
    alert("Failed to open drawing");
  }
};

const normalizeUomLabel = (uom?: string | null): string => {
  const value = String(uom || "")
    .trim()
    .toLowerCase();
  if (!value) return "Nos";

  if (
    [
      "no",
      "nos",
      "number",
      "numbers",
      "unit",
      "units",
      "piece",
      "pieces",
      "pc",
      "pcs",
    ].includes(value)
  ) {
    return "Nos";
  }

  if (["set", "sets"].includes(value)) {
    return "Set";
  }

  return uom!.trim();
};

interface BOM {
  id: string;
  version: number;
  is_active: boolean;
  effective_from?: string;
  effective_to?: string;
  notes?: string;
  lifecycle_status?: "DRAFT" | "SUBMITTED" | "APPROVED" | "RETIRED";
  revision_reason?: string;
  approval_note?: string;
  approved_at?: string;
  item?: {
    id?: string;
    code: string;
    name: string;
    type: string;
  };
  bom_items?: Array<{
    id: string;
    component_type: "ITEM" | "BOM";
    quantity: number;
    scrap_percentage: number;
    sequence: number;
    drawing_url?: string;
    notes?: string;
    item?: {
      id?: string;
      code: string;
      name: string;
      uom: string;
    };
    child_bom?: {
      id: string;
      version: number;
      item?: {
        code: string;
        name: string;
        uom?: string;
      };
    };
  }>;
  created_at: string;
}

interface PurchaseTrail {
  uid: string;
  item: {
    code: string;
    name: string;
  };
  supplier: {
    name: string;
    contact_person: string;
  } | null;
  purchase_order: {
    po_number: string;
    order_date: string;
    total_amount: number;
  } | null;
  grn: {
    grn_number: string;
    received_date: string;
    received_quantity: number;
  } | null;
  batch_number: string | null;
  location: string | null;
  lifecycle: Array<{
    stage: string;
    timestamp: string;
    location: string;
    reference: string;
  }>;
}

export default function BOMPage() {
  const router = useRouter();
  const todayDate = getTodayDateInputValue();
  const [boms, setBoms] = useState<BOM[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingBomId, setEditingBomId] = useState<string | null>(null);
  const [revisionSourceId, setRevisionSourceId] = useState<string | null>(null);
  const [selectedBom, setSelectedBom] = useState<BOM | null>(null);
  const [showTrailModal, setShowTrailModal] = useState(false);
  const [purchaseTrail, setPurchaseTrail] = useState<PurchaseTrail | null>(
    null,
  );
  const [loadingTrail, setLoadingTrail] = useState(false);
  const [showDrawingManager, setShowDrawingManager] = useState(false);
  const [selectedItemForDrawing, setSelectedItemForDrawing] = useState<{
    id: string;
    code: string;
    name: string;
  } | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [storedUser, setStoredUser] = useState<StoredUser | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  // Sorting state
  const [sortColumn, setSortColumn] = useState<string>("created_at");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const [formData, setFormData] = useState({
    itemId: "",
    version: 1,
    effectiveFrom: new Date().toISOString().split("T")[0],
    effectiveTo: "",
    notes: "",
    items: [] as Array<{
      componentType: "ITEM" | "BOM";
      itemId: string;
      childBomId: string;
      quantity: number;
      scrapPercentage: number;
      sequence: number;
      notes: string;
      drawingUrl: string;
    }>,
  });
  const [availableBOMs, setAvailableBOMs] = useState<BOM[]>([]);

  const canEditBom = hasModulePermission(
    storedUser,
    "BOM & Engineering",
    "edit",
  );
  const canCreate = hasModulePermission(
    storedUser,
    "BOM & Engineering",
    "create",
  );
  const canDelete = hasModulePermission(
    storedUser,
    "BOM & Engineering",
    "delete",
  );

  const isEditMode = Boolean(editingBomId);
  const isRevisionMode = Boolean(revisionSourceId);

  useEffect(() => {
    setStoredUser(readStoredUser());
    fetchBOMs();
    if (showModal) {
      fetchAvailableBOMs();
    }
  }, [showModal]);

  // Reset to page 1 when search query changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const fetchAvailableBOMs = async () => {
    try {
      const data = await apiClient.get("/bom");
      setAvailableBOMs(Array.isArray(data) ? data : []);
    } catch (error) {}
  };

  const fetchBOMs = async () => {
    try {
      setLoading(true);

      const data = await apiClient.get("/bom");

      // Ensure data is an array
      setBoms(Array.isArray(data) ? data : []);
    } catch (error: any) {
      // Handle 401 Unauthorized - redirect to login
      if (
        error.message?.includes("Unauthorized") ||
        error.message?.includes("401")
      ) {
        localStorage.removeItem("accessToken");
        localStorage.removeItem("refreshToken");
        localStorage.removeItem("user");
        router.push("/login");
        return;
      }

      setBoms([]); // Set empty array on error
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBOM = async () => {
    // Validation
    if (!formData.itemId) {
      alert("Please select an item for the BOM");
      return;
    }

    if (formData.items.length === 0) {
      alert("Please add at least one component to the BOM");
      return;
    }
    if (!formData.notes.trim()) {
      alert("Please enter the revision reason before creating the BOM draft");
      return;
    }

    try {
      // Clean up empty date fields - send null instead of empty string
      const cleanedData = {
        ...formData,
        effectiveTo: formData.effectiveTo || null,
      };

      const result = await apiClient.post("/bom", cleanedData);
      alert("BOM created successfully!");
      setShowModal(false);
      setRevisionSourceId(null);
      fetchBOMs();
      resetForm();
    } catch (error) {
      alert(
        `Error creating BOM: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  };

  const handleUpdateBOM = async () => {
    if (!editingBomId) return;

    // Validation
    if (!formData.itemId) {
      alert("Please select an item for the BOM");
      return;
    }

    if (formData.items.length === 0) {
      alert("Please add at least one component to the BOM");
      return;
    }
    if (!formData.notes.trim()) {
      alert("Please enter the revision reason before saving the BOM draft");
      return;
    }

    try {
      const cleanedData = {
        ...formData,
        effectiveTo: formData.effectiveTo || null,
      };

      await apiClient.put(`/bom/${editingBomId}`, cleanedData);
      alert("✅ BOM updated successfully!");
      setShowModal(false);
      setEditingBomId(null);
      resetForm();
      await fetchBOMs();
    } catch (error) {
      alert(
        `Error updating BOM: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  };

  const openEditModal = (bom: BOM) => {
    if (!canEditBom) {
      alert("Only Admin and Super Admin can edit BOM.");
      return;
    }

    const toDateOnly = (value?: string) => {
      if (!value) return "";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      return date.toISOString().slice(0, 10);
    };

    // Get the item ID - try item_id first, then item.id
    const itemId = (bom as any).item_id || bom.item?.id || "";

    setSelectedBom(bom);

    setEditingBomId(bom.id);
    setRevisionSourceId(null);
    setFormData({
      itemId: itemId,
      version: bom.version || 1,
      effectiveFrom:
        toDateOnly(bom.effective_from) || new Date().toISOString().slice(0, 10),
      effectiveTo: toDateOnly(bom.effective_to),
      notes: bom.notes || "",
      items:
        (bom.bom_items || []).map((bi, index) => {
          // Determine component type from the structure
          const componentType =
            bi.component_type ||
            (bi.child_bom?.id || (bi as any).child_bom_id ? "BOM" : "ITEM");

          return {
            componentType: componentType,
            itemId:
              componentType === "ITEM"
                ? bi.item?.id || (bi as any).item_id || ""
                : "",
            childBomId:
              componentType === "BOM"
                ? bi.child_bom?.id || (bi as any).child_bom_id || ""
                : "",
            quantity:
              typeof bi.quantity === "number"
                ? bi.quantity
                : Number(bi.quantity) || 0,
            scrapPercentage:
              typeof bi.scrap_percentage === "number"
                ? bi.scrap_percentage
                : Number(bi.scrap_percentage) || 0,
            sequence:
              typeof bi.sequence === "number"
                ? bi.sequence
                : Number(bi.sequence) || index + 1,
            notes: bi.notes || "",
            drawingUrl: bi.drawing_url || "",
          };
        }) || [],
    });

    setShowModal(true);
  };

  const openRevisionModal = (bom: BOM) => {
    if (!canCreate) {
      alert("You do not have permission to create a BOM revision.");
      return;
    }

    const itemId = (bom as any).item_id || bom.item?.id || "";
    const matchingVersions = boms
      .filter(
        (candidate) =>
          ((candidate as any).item_id || candidate.item?.id || "") === itemId,
      )
      .map((candidate) => Number(candidate.version) || 0);
    const nextVersion = Math.max(Number(bom.version) || 0, ...matchingVersions) + 1;

    setSelectedBom(bom);
    setEditingBomId(null);
    setRevisionSourceId(bom.id);
    setFormData({
      itemId,
      version: nextVersion,
      effectiveFrom: new Date().toISOString().slice(0, 10),
      effectiveTo: "",
      notes: "",
      items: (bom.bom_items || []).map((bi, index) => {
        const componentType =
          bi.component_type ||
          (bi.child_bom?.id || (bi as any).child_bom_id ? "BOM" : "ITEM");
        return {
          componentType,
          itemId:
            componentType === "ITEM"
              ? bi.item?.id || (bi as any).item_id || ""
              : "",
          childBomId:
            componentType === "BOM"
              ? bi.child_bom?.id || (bi as any).child_bom_id || ""
              : "",
          quantity: Number(bi.quantity) || 0,
          scrapPercentage: Number(bi.scrap_percentage) || 0,
          sequence: Number(bi.sequence) || index + 1,
          notes: bi.notes || "",
          drawingUrl: bi.drawing_url || "",
        };
      }),
    });
    setShowModal(true);
  };

  const handleDeleteBOM = async (bomId: string) => {
    const confirmed = await confirmDialog({
      title: "Delete BOM",
      message:
        "Are you sure you want to delete this BOM? This action cannot be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!confirmed) return;

    try {
      await apiClient.delete(`/bom/${bomId}`);
      alert("✅ BOM deleted successfully!");
      setSelectedBom(null);
      fetchBOMs();
    } catch (error) {
      alert("❌ Failed to delete BOM.");
    }
  };

  const handleRevisionAction = async (
    bom: BOM,
    action: "submit" | "approve" | "retire",
  ) => {
    let body: Record<string, string> = {};
    if (action === "approve") {
      const approvalNote = prompt("Approval rationale / engineering evidence");
      if (!approvalNote) return;
      body = { approvalNote };
    }
    if (action === "retire") {
      const retirementNote = prompt("Reason for retiring this revision");
      if (!retirementNote) return;
      body = { retirementNote };
    }
    try {
      await apiClient.post(`/bom/${bom.id}/${action}`, body);
      alert(
        `BOM revision ${action === "submit" ? "submitted" : action === "approve" ? "approved" : "retired"} successfully.`,
      );
      setSelectedBom(null);
      await fetchBOMs();
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Unable to update BOM revision.",
      );
    }
  };

  const fetchPurchaseTrail = async (uid: string) => {
    try {
      setLoadingTrail(true);
      const data = await apiClient.get(`/uid/${uid}/purchase-trail`);
      setPurchaseTrail(data);
      setShowTrailModal(true);
    } catch (error) {
      alert("Failed to fetch purchase trail");
    } finally {
      setLoadingTrail(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-IN", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handleAddItem = () => {
    // Validate that all existing rows are complete before adding a new one
    if (formData.items.length > 0) {
      const lastItem = formData.items[formData.items.length - 1];

      // Check if the last item is incomplete
      if (lastItem.componentType === "ITEM" && !lastItem.itemId) {
        alert(
          "Please select an item for the current row before adding a new one",
        );
        return;
      }

      if (lastItem.componentType === "BOM" && !lastItem.childBomId) {
        alert(
          "Please select a BOM/Assembly for the current row before adding a new one",
        );
        return;
      }

      if (!lastItem.quantity || lastItem.quantity <= 0) {
        alert(
          "Please enter a valid quantity for the current row before adding a new one",
        );
        return;
      }
    }

    setFormData({
      ...formData,
      items: [
        ...formData.items,
        {
          componentType: "ITEM",
          itemId: "",
          childBomId: "",
          quantity: 1,
          scrapPercentage: 0,
          sequence: formData.items.length + 1,
          notes: "",
          drawingUrl: "",
        },
      ],
    });
  };

  const handleDrawingFileSelect = async (index: number, file?: File | null) => {
    if (!file) return;

    const validTypes = [
      "image/png",
      "image/jpeg",
      "image/jpg",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (!validTypes.includes(file.type)) {
      alert("Please upload PNG, JPG, PDF, DOC, or DOCX files only");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert("File size must be less than 10MB");
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);
      handleUpdateItem(index, "drawingUrl", dataUrl);
    } catch (error) {
      alert("Failed to attach drawing");
    }
  };

  const handleUpdateItem = (index: number, field: string, value: any) => {
    // Check for duplicate items when changing itemId or childBomId
    if (field === "itemId" && value) {
      const isDuplicate = formData.items.some(
        (item, i) =>
          i !== index && item.componentType === "ITEM" && item.itemId === value,
      );
      if (isDuplicate) {
        alert(
          "This item is already added to the BOM. Please select a different item.",
        );
        return;
      }
    }

    if (field === "childBomId" && value) {
      const isDuplicate = formData.items.some(
        (item, i) =>
          i !== index &&
          item.componentType === "BOM" &&
          item.childBomId === value,
      );
      if (isDuplicate) {
        alert(
          "This BOM/Assembly is already added. Please select a different one.",
        );
        return;
      }
    }

    const updatedItems = [...formData.items];
    updatedItems[index] = { ...updatedItems[index], [field]: value };
    setFormData({ ...formData, items: updatedItems });
  };

  const handleRemoveItem = (index: number) => {
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index),
    });
  };

  const resetForm = () => {
    setFormData({
      itemId: "",
      version: 1,
      effectiveFrom: new Date().toISOString().split("T")[0],
      effectiveTo: "",
      notes: "",
      items: [],
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-bold text-amber-900">
              Bill of Materials (BOM)
            </h1>
            <p className="text-amber-700">
              Define and manage product structure
            </p>
          </div>
          <div className="flex gap-3">
            <label className="text-xs font-semibold uppercase tracking-wide text-amber-800">
              View
              <select
                value={viewMode}
                onChange={(event) =>
                  setViewMode(event.target.value as typeof viewMode)
                }
                className="mt-1 block rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-semibold normal-case tracking-normal text-amber-900"
              >
                <option value="table">Table</option>
                <option value="cards">Cards</option>
              </select>
            </label>
            {canCreate && (
              <button
                onClick={() => {
                  setEditingBomId(null);
                  setRevisionSourceId(null);
                  setSelectedBom(null);
                  resetForm();
                  setShowModal(true);
                }}
                className="bg-amber-600 hover:bg-amber-700 text-white px-6 py-3 rounded-lg font-semibold"
              >
                + Create BOM
              </button>
            )}
          </div>
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <div className="relative">
            <input
              type="text"
              placeholder="Search BOMs by item code, item name, or version..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-3 pl-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
            />
            <svg
              className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* BOM List - Table or Card View */}
        {viewMode === "table" ? (
          // TABLE VIEW
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            {loading ? (
              <div className="text-center py-12 text-gray-500">
                Loading BOMs...
              </div>
            ) : boms.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">📋</div>
                <h3 className="text-xl font-semibold text-gray-700 mb-2">
                  No BOMs Found
                </h3>
                <p className="text-gray-500">
                  Create your first BOM to define product structure
                </p>
              </div>
            ) : (
              (() => {
                // Filter BOMs
                const filteredBoms = boms.filter((bom) => {
                  if (!searchQuery) return true;
                  return smartSearchMatches(
                    searchQuery,
                    bom.item?.name,
                    bom.item?.code,
                    bom.version,
                    bom.notes,
                  );
                });

                // Sort BOMs
                const sortedBoms = [...filteredBoms].sort((a, b) => {
                  let aVal: any;
                  let bVal: any;

                  switch (sortColumn) {
                    case "item_name":
                      aVal = a.item?.name || "";
                      bVal = b.item?.name || "";
                      break;
                    case "item_code":
                      aVal = a.item?.code || "";
                      bVal = b.item?.code || "";
                      break;
                    case "version":
                      aVal = a.version || 0;
                      bVal = b.version || 0;
                      break;
                    case "components":
                      aVal = a.bom_items?.length || 0;
                      bVal = b.bom_items?.length || 0;
                      break;
                    case "is_active":
                      aVal = a.is_active ? 1 : 0;
                      bVal = b.is_active ? 1 : 0;
                      break;
                    case "effective_from":
                      aVal = a.effective_from || "";
                      bVal = b.effective_from || "";
                      break;
                    case "created_at":
                    default:
                      aVal = a.created_at || "";
                      bVal = b.created_at || "";
                      break;
                  }

                  if (typeof aVal === "string") aVal = aVal.toLowerCase();
                  if (typeof bVal === "string") bVal = bVal.toLowerCase();

                  if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
                  if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
                  return 0;
                });

                // Paginate BOMs
                const totalItems = sortedBoms.length;
                const totalPages = Math.ceil(totalItems / itemsPerPage);
                const startIndex = (currentPage - 1) * itemsPerPage;
                const endIndex = startIndex + itemsPerPage;
                const paginatedBoms = sortedBoms.slice(startIndex, endIndex);

                // Handle sort
                const handleSort = (column: string) => {
                  if (sortColumn === column) {
                    setSortDirection(sortDirection === "asc" ? "desc" : "asc");
                  } else {
                    setSortColumn(column);
                    setSortDirection("asc");
                  }
                };

                // Handle pagination
                const goToPage = (page: number) => {
                  setCurrentPage(Math.max(1, Math.min(page, totalPages)));
                };

                if (filteredBoms.length === 0) {
                  return (
                    <div className="text-center py-12">
                      <div className="text-6xl mb-4">🔍</div>
                      <h3 className="text-xl font-semibold text-gray-700 mb-2">
                        No BOMs Match Your Search
                      </h3>
                      <p className="text-gray-500">
                        Try different keywords or clear the search
                      </p>
                    </div>
                  );
                }

                return (
                  <>
                    <table className="w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th
                            onClick={() => handleSort("item_name")}
                            className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                          >
                            <div className="flex items-center gap-1">
                              Product
                              {sortColumn === "item_name" && (
                                <span>
                                  {sortDirection === "asc" ? "↑" : "↓"}
                                </span>
                              )}
                            </div>
                          </th>
                          <th
                            onClick={() => handleSort("item_code")}
                            className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                          >
                            <div className="flex items-center gap-1">
                              Item Code
                              {sortColumn === "item_code" && (
                                <span>
                                  {sortDirection === "asc" ? "↑" : "↓"}
                                </span>
                              )}
                            </div>
                          </th>
                          <th
                            onClick={() => handleSort("version")}
                            className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                          >
                            <div className="flex items-center justify-center gap-1">
                              Version
                              {sortColumn === "version" && (
                                <span>
                                  {sortDirection === "asc" ? "↑" : "↓"}
                                </span>
                              )}
                            </div>
                          </th>
                          <th
                            onClick={() => handleSort("components")}
                            className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                          >
                            <div className="flex items-center justify-center gap-1">
                              Components
                              {sortColumn === "components" && (
                                <span>
                                  {sortDirection === "asc" ? "↑" : "↓"}
                                </span>
                              )}
                            </div>
                          </th>
                          <th
                            onClick={() => handleSort("is_active")}
                            className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                          >
                            <div className="flex items-center justify-center gap-1">
                              Status
                              {sortColumn === "is_active" && (
                                <span>
                                  {sortDirection === "asc" ? "↑" : "↓"}
                                </span>
                              )}
                            </div>
                          </th>
                          <th
                            onClick={() => handleSort("effective_from")}
                            className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                          >
                            <div className="flex items-center gap-1">
                              Effective From
                              {sortColumn === "effective_from" && (
                                <span>
                                  {sortDirection === "asc" ? "↑" : "↓"}
                                </span>
                              )}
                            </div>
                          </th>
                          <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {paginatedBoms.map((bom) => (
                          <tr key={bom.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm font-medium text-gray-900">
                                {bom.item?.name || "Unknown Item"}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-gray-500">
                                {bom.item?.code || "N/A"}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center">
                              <span className="text-sm font-medium text-gray-900">
                                v{bom.version}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center">
                              <span className="px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                                {bom.bom_items?.length || 0}{" "}
                                {(bom.bom_items?.length || 0) === 1
                                  ? "part"
                                  : "parts"}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center">
                              <span
                                className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                  bom.is_active
                                    ? "bg-green-100 text-green-800"
                                    : "bg-gray-100 text-gray-800"
                                }`}
                              >
                                {bom.lifecycle_status ||
                                  (bom.is_active ? "APPROVED" : "RETIRED")}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {bom.effective_from
                                ? formatDate(bom.effective_from)
                                : "N/A"}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                              <div className="flex flex-wrap items-center justify-center gap-2">
                                <button
                                  onClick={() => setSelectedBom(bom)}
                                  className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50"
                                  title="View Details"
                                >
                                  View
                                </button>
                                <button
                                  onClick={() =>
                                    router.push(`/dashboard/bom/${bom.id}/routing`)
                                  }
                                  className="rounded border border-blue-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-800 hover:bg-blue-50"
                                  title="Configure operation sequence and work stations"
                                >
                                  Routing
                                </button>
                                {canEditBom &&
                                  (bom.lifecycle_status || "DRAFT") ===
                                    "DRAFT" && (
                                    <button
                                      onClick={() => openEditModal(bom)}
                                      className="rounded border border-amber-400 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
                                      title="Edit this draft BOM"
                                    >
                                      Edit
                                    </button>
                                  )}
                                {canDelete &&
                                  (bom.lifecycle_status || "DRAFT") ===
                                    "DRAFT" && (
                                    <button
                                      onClick={() => handleDeleteBOM(bom.id)}
                                      className="rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                                      title="Delete this draft BOM"
                                    >
                                      Delete
                                    </button>
                                  )}
                                {canCreate &&
                                  (bom.lifecycle_status || "DRAFT") !==
                                    "DRAFT" && (
                                    <button
                                      onClick={() => openRevisionModal(bom)}
                                      className="rounded border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50"
                                      title="Copy this locked BOM into a new editable draft revision"
                                    >
                                      New revision
                                    </button>
                                  )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Pagination Controls */}
                    {totalPages > 1 && (
                      <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
                        <div className="flex-1 flex justify-between sm:hidden">
                          <button
                            onClick={() => goToPage(currentPage - 1)}
                            disabled={currentPage === 1}
                            className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Previous
                          </button>
                          <button
                            onClick={() => goToPage(currentPage + 1)}
                            disabled={currentPage === totalPages}
                            className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Next
                          </button>
                        </div>
                        <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                          <div className="flex gap-4 items-center">
                            <div className="text-sm text-gray-700">
                              Showing{" "}
                              <span className="font-medium">
                                {startIndex + 1}
                              </span>{" "}
                              to{" "}
                              <span className="font-medium">
                                {Math.min(endIndex, totalItems)}
                              </span>{" "}
                              of{" "}
                              <span className="font-medium">{totalItems}</span>{" "}
                              results
                            </div>
                            <select
                              value={itemsPerPage}
                              onChange={(e) => {
                                setItemsPerPage(Number(e.target.value));
                                setCurrentPage(1);
                              }}
                              className="px-3 py-1 border border-gray-300 rounded text-sm"
                            >
                              <option value={10}>10 per page</option>
                              <option value={25}>25 per page</option>
                              <option value={50}>50 per page</option>
                              <option value={100}>100 per page</option>
                            </select>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => goToPage(1)}
                              disabled={currentPage === 1}
                              className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              First
                            </button>
                            <button
                              onClick={() => goToPage(currentPage - 1)}
                              disabled={currentPage === 1}
                              className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Previous
                            </button>

                            {/* Page Numbers */}
                            <div className="flex gap-1">
                              {Array.from(
                                { length: Math.min(5, totalPages) },
                                (_, i) => {
                                  let pageNum;
                                  if (totalPages <= 5) {
                                    pageNum = i + 1;
                                  } else if (currentPage <= 3) {
                                    pageNum = i + 1;
                                  } else if (currentPage >= totalPages - 2) {
                                    pageNum = totalPages - 4 + i;
                                  } else {
                                    pageNum = currentPage - 2 + i;
                                  }

                                  return (
                                    <button
                                      key={pageNum}
                                      onClick={() => goToPage(pageNum)}
                                      className={`px-3 py-1 border rounded text-sm ${
                                        currentPage === pageNum
                                          ? "bg-amber-600 text-white border-amber-600"
                                          : "border-gray-300 hover:bg-gray-100"
                                      }`}
                                    >
                                      {pageNum}
                                    </button>
                                  );
                                },
                              )}
                            </div>

                            <button
                              onClick={() => goToPage(currentPage + 1)}
                              disabled={currentPage === totalPages}
                              className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Next
                            </button>
                            <button
                              onClick={() => goToPage(totalPages)}
                              disabled={currentPage === totalPages}
                              className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Last
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()
            )}
          </div>
        ) : (
          // CARD VIEW
          <>
            {loading ? (
              <div className="text-center py-12 text-gray-500">
                Loading BOMs...
              </div>
            ) : boms.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">📋</div>
                <h3 className="text-xl font-semibold text-gray-700 mb-2">
                  No BOMs Found
                </h3>
                <p className="text-gray-500">
                  Create your first BOM to define product structure
                </p>
              </div>
            ) : (
              (() => {
                // Filter BOMs
                const filteredBoms = boms.filter((bom) => {
                  if (!searchQuery) return true;
                  return smartSearchMatches(
                    searchQuery,
                    bom.item?.name,
                    bom.item?.code,
                    bom.version,
                    bom.notes,
                  );
                });

                // Paginate BOMs
                const totalItems = filteredBoms.length;
                const totalPages = Math.ceil(totalItems / itemsPerPage);
                const startIndex = (currentPage - 1) * itemsPerPage;
                const endIndex = startIndex + itemsPerPage;
                const paginatedBoms = filteredBoms.slice(startIndex, endIndex);

                // Handle pagination
                const goToPage = (page: number) => {
                  setCurrentPage(Math.max(1, Math.min(page, totalPages)));
                };

                if (filteredBoms.length === 0) {
                  return (
                    <div className="text-center py-12">
                      <div className="text-6xl mb-4">🔍</div>
                      <h3 className="text-xl font-semibold text-gray-700 mb-2">
                        No BOMs Match Your Search
                      </h3>
                      <p className="text-gray-500">
                        Try different keywords or clear the search
                      </p>
                    </div>
                  );
                }

                return (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {paginatedBoms.map((bom) => (
                        <div
                          key={bom.id}
                          className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow"
                        >
                          <div className="flex justify-between items-start mb-4">
                            <div>
                              <h3 className="text-lg font-bold text-gray-900">
                                {bom.item?.name || "Unknown Item"}
                              </h3>
                              <p className="text-sm text-gray-500">
                                {bom.item?.code || "N/A"} - Version{" "}
                                {bom.version}
                              </p>
                            </div>
                            <span
                              className={`px-2 py-1 text-xs rounded-full ${
                                bom.is_active
                                  ? "bg-green-100 text-green-800"
                                  : "bg-gray-100 text-gray-800"
                              }`}
                            >
                              {bom.lifecycle_status ||
                                (bom.is_active ? "APPROVED" : "RETIRED")}
                            </span>
                          </div>

                          <div className="mb-4">
                            <h4 className="text-sm font-semibold text-gray-700 mb-2">
                              Components ({bom.bom_items?.length || 0})
                            </h4>
                            <div className="space-y-2">
                              {bom.bom_items?.slice(0, 3).map((item) => {
                                const isChildBom =
                                  item.component_type === "BOM";
                                const componentCode = isChildBom
                                  ? item.child_bom?.item?.code || "BOM"
                                  : item.item?.code || "N/A";
                                const componentName = isChildBom
                                  ? `${item.child_bom?.item?.name || "Unknown"} (v${item.child_bom?.version ?? "?"})`
                                  : item.item?.name || "Unknown";
                                const componentUom = isChildBom
                                  ? normalizeUomLabel(
                                      item.child_bom?.item?.uom || "set",
                                    )
                                  : normalizeUomLabel(
                                      item.item?.uom || "units",
                                    );

                                return (
                                  <div
                                    key={item.id}
                                    className="flex justify-between text-sm"
                                  >
                                    <span className="text-gray-600">
                                      {componentCode} - {componentName}
                                    </span>
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium">
                                        {item.quantity} {componentUom}
                                      </span>
                                      {item.drawing_url && (
                                        <span
                                          className="text-blue-600"
                                          title="Drawing attached"
                                        >
                                          📎
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                              {(bom.bom_items?.length || 0) > 3 && (
                                <p className="text-xs text-gray-500">
                                  + {(bom.bom_items?.length || 0) - 3} more
                                  items
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex gap-2 pt-4 border-t">
                            <button
                              onClick={() => {
                                setSelectedBom(bom);
                              }}
                              className="flex-1 bg-amber-100 text-amber-700 px-4 py-2 rounded hover:bg-amber-200 text-sm"
                            >
                              View Details
                            </button>
                            {canEditBom &&
                              (bom.lifecycle_status || "DRAFT") === "DRAFT" && (
                                <button
                                  onClick={() => {
                                    openEditModal(bom);
                                  }}
                                  className="flex-1 bg-amber-600 text-white px-4 py-2 rounded hover:bg-amber-700 text-sm"
                                >
                                  Edit
                                </button>
                              )}
                            <button
                              onClick={() =>
                                router.push(`/dashboard/bom/${bom.id}/routing`)
                              }
                              className="flex-1 border border-blue-300 bg-blue-50 text-blue-800 px-4 py-2 rounded hover:bg-blue-100 text-sm"
                            >
                              Routing
                            </button>
                            {canCreate &&
                              (bom.lifecycle_status || "DRAFT") !== "DRAFT" && (
                                <button
                                  onClick={() => openRevisionModal(bom)}
                                  className="flex-1 border border-emerald-300 bg-emerald-50 text-emerald-800 px-4 py-2 rounded hover:bg-emerald-100 text-sm"
                                >
                                  New revision
                                </button>
                              )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Pagination Controls for Card View */}
                    {totalPages > 1 && (
                      <div className="mt-6 bg-white px-4 py-3 rounded-lg shadow flex items-center justify-between border-t border-gray-200 sm:px-6">
                        <div className="flex-1 flex justify-between sm:hidden">
                          <button
                            onClick={() => goToPage(currentPage - 1)}
                            disabled={currentPage === 1}
                            className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Previous
                          </button>
                          <button
                            onClick={() => goToPage(currentPage + 1)}
                            disabled={currentPage === totalPages}
                            className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Next
                          </button>
                        </div>
                        <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                          <div className="flex gap-4 items-center">
                            <div className="text-sm text-gray-700">
                              Showing{" "}
                              <span className="font-medium">
                                {startIndex + 1}
                              </span>{" "}
                              to{" "}
                              <span className="font-medium">
                                {Math.min(endIndex, totalItems)}
                              </span>{" "}
                              of{" "}
                              <span className="font-medium">{totalItems}</span>{" "}
                              results
                            </div>
                            <select
                              value={itemsPerPage}
                              onChange={(e) => {
                                setItemsPerPage(Number(e.target.value));
                                setCurrentPage(1);
                              }}
                              className="px-3 py-1 border border-gray-300 rounded text-sm"
                            >
                              <option value={10}>10 per page</option>
                              <option value={25}>25 per page</option>
                              <option value={50}>50 per page</option>
                              <option value={100}>100 per page</option>
                            </select>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => goToPage(1)}
                              disabled={currentPage === 1}
                              className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              First
                            </button>
                            <button
                              onClick={() => goToPage(currentPage - 1)}
                              disabled={currentPage === 1}
                              className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Previous
                            </button>

                            {/* Page Numbers */}
                            <div className="flex gap-1">
                              {Array.from(
                                { length: Math.min(5, totalPages) },
                                (_, i) => {
                                  let pageNum;
                                  if (totalPages <= 5) {
                                    pageNum = i + 1;
                                  } else if (currentPage <= 3) {
                                    pageNum = i + 1;
                                  } else if (currentPage >= totalPages - 2) {
                                    pageNum = totalPages - 4 + i;
                                  } else {
                                    pageNum = currentPage - 2 + i;
                                  }

                                  return (
                                    <button
                                      key={pageNum}
                                      onClick={() => goToPage(pageNum)}
                                      className={`px-3 py-1 border rounded text-sm ${
                                        currentPage === pageNum
                                          ? "bg-amber-600 text-white border-amber-600"
                                          : "border-gray-300 hover:bg-gray-100"
                                      }`}
                                    >
                                      {pageNum}
                                    </button>
                                  );
                                },
                              )}
                            </div>

                            <button
                              onClick={() => goToPage(currentPage + 1)}
                              disabled={currentPage === totalPages}
                              className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Next
                            </button>
                            <button
                              onClick={() => goToPage(totalPages)}
                              disabled={currentPage === totalPages}
                              className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Last
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()
            )}
          </>
        )}
      </div>

      {/* Create BOM Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-2xl font-bold text-gray-900">
                {isEditMode
                  ? "Edit Bill of Materials"
                  : isRevisionMode
                    ? "Create New BOM Revision"
                    : "Create Bill of Materials"}
              </h2>
            </div>

            <div className="p-6 space-y-6">
              {/* Info Box */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">ℹ️</span>
                  <div>
                    <h4 className="font-semibold text-blue-900 mb-1">
                      How to fill this form:
                    </h4>
                    <ul className="text-sm text-blue-800 space-y-1">
                      <li>
                        • <strong>Finished Product:</strong> Search and select
                        the finished product you want to manufacture
                      </li>
                      <li>
                        • <strong>Parts:</strong> Add raw materials or purchased
                        components needed for production
                      </li>
                      <li>
                        • <strong>Assemblies:</strong> Add sub-assemblies (other
                        BOMs) that are part of this product
                      </li>
                      <li>
                        • <strong>Quantity:</strong> How many units of each
                        part/assembly are needed to make 1 finished product
                      </li>
                    </ul>
                    <p className="text-xs text-blue-700 mt-2">
                      ✨ Start typing to search items by name or code
                    </p>
                  </div>
                </div>
              </div>

              {/* BOM Header */}
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Finished Product *
                  </label>
                  <ItemSearch
                    value={formData.itemId}
                    initialItem={
                      selectedBom?.item?.id &&
                      selectedBom.item.id === formData.itemId
                        ? {
                            id: selectedBom.item.id,
                            code: selectedBom.item.code,
                            name: selectedBom.item.name,
                          }
                        : null
                    }
                    onSelect={(item) =>
                      setFormData({ ...formData, itemId: item.id })
                    }
                    placeholder="Search by item name or code..."
                    disabled={isEditMode}
                  />
                  {isEditMode ? (
                    <p className="text-xs text-gray-500 mt-1">
                      Finished product cannot be changed in edit mode.
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Version
                  </label>
                  <input
                    type="number"
                    value={formData.version}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        version: parseInt(e.target.value),
                      })
                    }
                    className="w-full border border-gray-300 rounded-lg px-4 py-2"
                    disabled={isEditMode}
                  />
                  {isEditMode ? (
                    <p className="text-xs text-gray-500 mt-1">
                      Version cannot be changed in edit mode.
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Effective From
                  </label>
                  <DateInput
                    max={todayDate}
                    value={formData.effectiveFrom}
                    onChange={(value) =>
                      setFormData({ ...formData, effectiveFrom: value })
                    }
                    className="w-full border border-gray-300 rounded-lg px-4 py-2"
                  />
                </div>
              </div>

              {/* Components */}
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">
                    Components (Parts & Assemblies)
                  </h3>
                  <button
                    onClick={handleAddItem}
                    className="text-amber-600 hover:text-amber-800 font-medium"
                  >
                    + Add Part/Assembly
                  </button>
                </div>

                {formData.items.length === 0 ? (
                  <div className="text-center py-8 border-2 border-dashed border-gray-300 rounded-lg">
                    <p className="text-gray-500">
                      No parts or assemblies added. Click &quot;Add
                      Part/Assembly&quot; to get started.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {formData.items.map((item, index) => (
                      <div
                        key={index}
                        className="border border-gray-300 rounded-lg p-4 bg-white"
                      >
                        {/* Component Type Selector */}
                        <div className="mb-3">
                          <label className="text-xs text-gray-600 font-medium block mb-2">
                            Component Type *
                          </label>
                          <div className="flex gap-4">
                            <label className="flex items-center cursor-pointer">
                              <input
                                type="radio"
                                name={`componentType-${index}`}
                                value="ITEM"
                                checked={item.componentType === "ITEM"}
                                onChange={(e) =>
                                  handleUpdateItem(
                                    index,
                                    "componentType",
                                    e.target.value,
                                  )
                                }
                                className="mr-2"
                              />
                              <span className="text-sm">
                                📦 Part (Raw Material/Component)
                              </span>
                            </label>
                            <label className="flex items-center cursor-pointer">
                              <input
                                type="radio"
                                name={`componentType-${index}`}
                                value="BOM"
                                checked={item.componentType === "BOM"}
                                onChange={(e) =>
                                  handleUpdateItem(
                                    index,
                                    "componentType",
                                    e.target.value,
                                  )
                                }
                                className="mr-2"
                              />
                              <span className="text-sm">
                                🔧 Assembly (Sub-BOM)
                              </span>
                            </label>
                          </div>
                        </div>

                        <div className="grid grid-cols-12 gap-3">
                          <div className="col-span-4">
                            <label className="text-xs text-gray-600 font-medium">
                              {item.componentType === "ITEM"
                                ? "Part *"
                                : "Assembly *"}
                            </label>
                            {item.componentType === "ITEM" ? (
                              <ItemSearch
                                value={item.itemId}
                                initialItem={
                                  selectedBom?.bom_items
                                    ?.map((bi) => {
                                      const resolvedId =
                                        bi.item?.id || (bi as any).item_id;
                                      if (
                                        !resolvedId ||
                                        resolvedId !== item.itemId
                                      )
                                        return null;
                                      if (!bi.item?.code || !bi.item?.name)
                                        return null;
                                      return {
                                        id: resolvedId,
                                        code: bi.item.code,
                                        name: bi.item.name,
                                      };
                                    })
                                    .find(Boolean) || null
                                }
                                onSelect={(selectedItem) =>
                                  handleUpdateItem(
                                    index,
                                    "itemId",
                                    selectedItem.id,
                                  )
                                }
                                placeholder="Search part by name or code..."
                                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500"
                              />
                            ) : (
                              <select
                                value={item.childBomId}
                                onChange={(e) =>
                                  handleUpdateItem(
                                    index,
                                    "childBomId",
                                    e.target.value,
                                  )
                                }
                                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500"
                              >
                                <option value="">Select assembly BOM...</option>
                                {availableBOMs.map((bom) => (
                                  <option key={bom.id} value={bom.id}>
                                    {bom.item?.code} - {bom.item?.name} (v
                                    {bom.version})
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                          <div className="col-span-2">
                            <label className="text-xs text-gray-600">
                              Quantity *
                            </label>
                            <input
                              type="number"
                              value={item.quantity}
                              onChange={(e) =>
                                handleUpdateItem(
                                  index,
                                  "quantity",
                                  parseFloat(e.target.value),
                                )
                              }
                              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                            />
                          </div>
                          <div className="col-span-2">
                            <label className="text-xs text-gray-600">
                              Scrap %
                            </label>
                            <input
                              type="number"
                              value={item.scrapPercentage}
                              onChange={(e) =>
                                handleUpdateItem(
                                  index,
                                  "scrapPercentage",
                                  parseFloat(e.target.value),
                                )
                              }
                              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                            />
                          </div>
                          <div className="col-span-1 flex items-end">
                            <button
                              onClick={() => handleRemoveItem(index)}
                              className="text-red-600 hover:text-red-900 text-xl"
                              title="Remove component"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                        <div className="mt-2">
                          <input
                            type="text"
                            value={item.notes}
                            onChange={(e) =>
                              handleUpdateItem(index, "notes", e.target.value)
                            }
                            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                            placeholder="Specifications / Notes..."
                          />
                        </div>

                        <div className="mt-3">
                          <label className="text-xs text-gray-600 font-medium block mb-1">
                            Drawing (optional)
                          </label>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <input
                              type="text"
                              value={item.drawingUrl || ""}
                              onChange={(e) =>
                                handleUpdateItem(
                                  index,
                                  "drawingUrl",
                                  e.target.value,
                                )
                              }
                              className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm"
                              placeholder="Paste drawing URL (or use Upload)"
                            />
                            <div className="flex items-center gap-3">
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/jpg,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  await handleDrawingFileSelect(index, file);
                                  e.target.value = "";
                                }}
                                className="text-sm"
                              />
                              {item.drawingUrl ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    openDrawingUrlInNewTab(item.drawingUrl)
                                  }
                                  className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                                >
                                  View
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {formData.items.length > 0 && (
                  <div className="mt-4 flex justify-center">
                    <button
                      onClick={handleAddItem}
                      className="px-6 py-2 text-amber-600 hover:text-amber-800 font-medium border-2 border-dashed border-amber-300 hover:border-amber-500 rounded-lg transition-colors"
                    >
                      + Add Another Component
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Revision reason / BOM notes
                </label>
                <textarea
                  required
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData({ ...formData, notes: e.target.value })
                  }
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2"
                  placeholder="Explain why this BOM revision is required."
                />
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end gap-4">
              <button
                onClick={() => {
                  setShowModal(false);
                  setEditingBomId(null);
                  setRevisionSourceId(null);
                  setSelectedBom(null);
                  resetForm();
                }}
                className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={isEditMode ? handleUpdateBOM : handleCreateBOM}
                className="px-6 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
              >
                {isEditMode
                  ? "Save Changes"
                  : isRevisionMode
                    ? "Create Revision Draft"
                    : "Create BOM"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Purchase Trail Modal */}
      {showTrailModal && purchaseTrail && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">
                    Purchase Trail
                  </h2>
                  <p className="text-gray-600 mt-1">
                    Complete traceability for UID: {purchaseTrail.uid}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowTrailModal(false);
                    setPurchaseTrail(null);
                  }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <span className="text-2xl">×</span>
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Item Information */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-semibold text-blue-900 mb-2">
                  📦 Item Information
                </h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">Item Code:</span>
                    <span className="ml-2 font-medium">
                      {purchaseTrail.item.code}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600">Item Name:</span>
                    <span className="ml-2 font-medium">
                      {purchaseTrail.item.name}
                    </span>
                  </div>
                  {purchaseTrail.batch_number && (
                    <div>
                      <span className="text-gray-600">Batch Number:</span>
                      <span className="ml-2 font-medium">
                        {purchaseTrail.batch_number}
                      </span>
                    </div>
                  )}
                  {purchaseTrail.location && (
                    <div>
                      <span className="text-gray-600">Current Location:</span>
                      <span className="ml-2 font-medium">
                        {purchaseTrail.location}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Supplier Information */}
              {purchaseTrail.supplier && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h3 className="font-semibold text-green-900 mb-2">
                    🏭 Supplier Information
                  </h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">Supplier Name:</span>
                      <span className="ml-2 font-medium">
                        {purchaseTrail.supplier.name}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Contact Person:</span>
                      <span className="ml-2 font-medium">
                        {purchaseTrail.supplier.contact_person}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Purchase Order Information */}
              {purchaseTrail.purchase_order && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                  <h3 className="font-semibold text-purple-900 mb-2">
                    📋 Purchase Order
                  </h3>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">PO Number:</span>
                      <span className="ml-2 font-medium">
                        {purchaseTrail.purchase_order.po_number}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Order Date:</span>
                      <span className="ml-2 font-medium">
                        {formatDate(purchaseTrail.purchase_order.order_date)}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Total Amount:</span>
                      <span className="ml-2 font-medium">
                        ₹
                        {purchaseTrail.purchase_order.total_amount.toLocaleString(
                          "en-IN",
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* GRN Information */}
              {purchaseTrail.grn && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <h3 className="font-semibold text-amber-900 mb-2">
                    📥 Goods Receipt Note
                  </h3>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">GRN Number:</span>
                      <span className="ml-2 font-medium">
                        {purchaseTrail.grn.grn_number}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Received Date:</span>
                      <span className="ml-2 font-medium">
                        {formatDate(purchaseTrail.grn.received_date)}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Quantity:</span>
                      <span className="ml-2 font-medium">
                        {purchaseTrail.grn.received_quantity}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Lifecycle Timeline */}
              {purchaseTrail.lifecycle &&
                purchaseTrail.lifecycle.length > 0 && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <h3 className="font-semibold text-gray-900 mb-4">
                      🕐 Lifecycle Timeline
                    </h3>
                    <div className="space-y-3">
                      {purchaseTrail.lifecycle.map((event, index) => (
                        <div key={index} className="flex gap-4">
                          <div className="flex flex-col items-center">
                            <div className="w-3 h-3 bg-amber-600 rounded-full"></div>
                            {index < purchaseTrail.lifecycle.length - 1 && (
                              <div className="w-0.5 h-full bg-amber-300 my-1"></div>
                            )}
                          </div>
                          <div className="flex-1 pb-4">
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-medium text-gray-900">
                                  {event.stage}
                                </p>
                                <p className="text-sm text-gray-600">
                                  {event.location}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {event.reference}
                                </p>
                              </div>
                              <span className="text-xs text-gray-500">
                                {formatDate(event.timestamp)}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => {
                  setShowTrailModal(false);
                  setPurchaseTrail(null);
                }}
                className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BOM Details Modal */}
      {selectedBom && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">
                    BOM Details
                  </h2>
                  <p className="text-gray-600 mt-1">
                    {selectedBom.item?.code || "N/A"} -{" "}
                    {selectedBom.item?.name || "Unknown"}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedBom(null)}
                  className="text-gray-500 hover:text-gray-700 text-2xl"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-600">
                    Version
                  </label>
                  <p className="text-gray-900">{selectedBom.version}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-600">
                    Status
                  </label>
                  <p
                    className={`inline-block px-2 py-1 text-xs rounded-full ${
                      selectedBom.is_active
                        ? "bg-green-100 text-green-800"
                        : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {selectedBom.lifecycle_status ||
                      (selectedBom.is_active ? "APPROVED" : "RETIRED")}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-600">
                    Effective From
                  </label>
                  <p className="text-gray-900">
                    {selectedBom.effective_from
                      ? formatDate(selectedBom.effective_from)
                      : "N/A"}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-600">
                    Effective To
                  </label>
                  <p className="text-gray-900">
                    {selectedBom.effective_to
                      ? formatDate(selectedBom.effective_to)
                      : "N/A"}
                  </p>
                </div>
                {selectedBom.notes && (
                  <div className="col-span-2">
                    <label className="text-sm font-medium text-gray-600">
                      Notes
                    </label>
                    <p className="text-gray-900">{selectedBom.notes}</p>
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Components ({selectedBom.bom_items?.length || 0})
                </h3>

                {selectedBom.bom_items && selectedBom.bom_items.length > 0 ? (
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                            Type
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                            Code
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                            Name
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase">
                            Quantity
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase">
                            Scrap %
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                            Notes
                          </th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase">
                            Drawing
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {selectedBom.bom_items.map((item) => (
                          <tr key={item.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3">
                              <span
                                className={`px-2 py-1 text-xs rounded ${
                                  item.component_type === "BOM"
                                    ? "bg-blue-100 text-blue-800"
                                    : "bg-green-100 text-green-800"
                                }`}
                              >
                                {item.component_type === "BOM"
                                  ? "🔧 Assembly"
                                  : "📦 Part"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-900">
                              {item.component_type === "BOM"
                                ? item.child_bom?.item?.code || "N/A"
                                : item.item?.code || "N/A"}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-900">
                              {item.component_type === "BOM"
                                ? `${item.child_bom?.item?.name || "Unknown"} (v${item.child_bom?.version || "?"})`
                                : item.item?.name || "Unknown"}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">
                              {item.quantity}{" "}
                              {normalizeUomLabel(
                                item.component_type === "ITEM"
                                  ? item.item?.uom
                                  : "units",
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">
                              {item.scrap_percentage || 0}%
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">
                              {item.notes || "-"}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex items-center justify-center gap-3">
                                {item.drawing_url ? (
                                  <a
                                    href={item.drawing_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:text-blue-800"
                                  >
                                    📎 View
                                  </a>
                                ) : (
                                  <span className="text-gray-400">-</span>
                                )}

                                {item.component_type === "ITEM" &&
                                  item.item?.id && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedItemForDrawing({
                                          id: item.item!.id!,
                                          code: item.item?.code || "",
                                          name: item.item?.name || "",
                                        });
                                        setShowDrawingManager(true);
                                      }}
                                      className="text-amber-700 hover:text-amber-900 text-sm font-medium"
                                    >
                                      Manage
                                    </button>
                                  )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-8 bg-gray-50 rounded-lg">
                    No components
                  </p>
                )}
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-between">
              {canDelete &&
                (selectedBom.lifecycle_status || "DRAFT") === "DRAFT" && (
                  <button
                    onClick={() => handleDeleteBOM(selectedBom.id)}
                    className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                  >
                    Delete BOM
                  </button>
                )}
              <div className="flex flex-wrap justify-end gap-3">
                <button
                  onClick={() =>
                    router.push(`/dashboard/bom/${selectedBom.id}/routing`)
                  }
                  className="px-6 py-2 border border-blue-300 bg-blue-50 text-blue-800 rounded-lg hover:bg-blue-100"
                >
                  Configure Routing
                </button>
                {canEditBom &&
                  (selectedBom.lifecycle_status || "DRAFT") === "DRAFT" && (
                    <button
                      onClick={() => {
                        openEditModal(selectedBom);
                        setSelectedBom(null);
                      }}
                      className="px-6 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
                    >
                      Edit BOM
                    </button>
                  )}
                {canCreate &&
                  (selectedBom.lifecycle_status || "DRAFT") !== "DRAFT" && (
                    <button
                      onClick={() => {
                        const source = selectedBom;
                        setSelectedBom(null);
                        openRevisionModal(source);
                      }}
                      className="px-6 py-2 border border-emerald-300 bg-emerald-50 text-emerald-800 rounded-lg hover:bg-emerald-100"
                    >
                      Create New Revision
                    </button>
                  )}
                {canEditBom &&
                  (selectedBom.lifecycle_status || "DRAFT") === "DRAFT" && (
                    <button
                      onClick={() =>
                        handleRevisionAction(selectedBom, "submit")
                      }
                      className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      Submit for approval
                    </button>
                  )}
                {canEditBom && selectedBom.lifecycle_status === "SUBMITTED" && (
                  <button
                    onClick={() => handleRevisionAction(selectedBom, "approve")}
                    className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                  >
                    Approve revision
                  </button>
                )}
                {canEditBom && selectedBom.lifecycle_status === "APPROVED" && (
                  <button
                    onClick={() => handleRevisionAction(selectedBom, "retire")}
                    className="px-6 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800"
                  >
                    Retire revision
                  </button>
                )}
                <button
                  onClick={() => setSelectedBom(null)}
                  className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Drawing Manager Modal (BOM component item drawings) */}
      {showDrawingManager && selectedItemForDrawing && (
        <DrawingManager
          itemId={selectedItemForDrawing.id}
          itemCode={selectedItemForDrawing.code}
          itemName={selectedItemForDrawing.name}
          onClose={() => {
            setShowDrawingManager(false);
            setSelectedItemForDrawing(null);
          }}
        />
      )}
    </div>
  );
}
