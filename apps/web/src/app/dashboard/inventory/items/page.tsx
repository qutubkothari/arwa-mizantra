"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  BadgeCheck,
  BadgeX,
  Boxes,
  Download,
  Eye,
  FileText,
  Layers,
  PackagePlus,
  Pencil,
  Route,
  Tags,
  Trash2,
  CheckCircle,
  Copy,
  XCircle,
  Upload,
  X,
} from "lucide-react";
import { apiClient } from "../../../../../lib/api-client";
import { confirmDialog } from "../../../../components/ui/ConfirmDialog";
import DrawingManager from "../../../../components/DrawingManager";
import DuplicateWarning, {
  useDuplicateDetection,
} from "../../../../components/DuplicateWarning";
import { hasModulePermission, isAdminLike, readStoredUser } from "@/lib/rbac";
import {
  ListTable,
  type ListTableColumn,
} from "../../../../components/ui/ListTable";
import { useEscapeKey } from "../../../../hooks/useEscapeKey";
import { exportToExcel } from "../../../../lib/export-excel";
import { smartSearchMatches } from "../../../../lib/smart-search";

interface Item {
  id: string;
  code: string;
  name: string;
  description?: string;
  oem_part_no?: string;
  oem_name?: string;
  category: string;
  product_category?: string;
  uom: string;
  product_size?: number;
  product_size_uom?: string;
  hsn_code?: string;
  standard_cost?: number;
  selling_price?: number;
  purchase_currency?: string;
  foreign_unit_price?: number;
  reorder_level?: number;
  reorder_quantity?: number;
  lead_time_days?: number;
  is_active: boolean;
  is_verified?: boolean;
  verified_at?: string | null;
  verified_by?: string | null;
  created_by?: string | null;
  approval_status?: string;
  approval_reason?: string | null;
  approval_history?: Array<Record<string, any>>;
  approved_at?: string | null;
  approved_by?: string | null;
  created_at: string;
  total_stock?: number;
  current_stock?: number;
  available_quantity?: number;
  uid_tracking?: boolean;
  uid_strategy?: string;
  batch_uom?: string;
  batch_quantity?: number;
  sales_uom?: string;
  sales_uom_factor?: number;
  sales_whole_uom_only?: boolean;
  drawing_required?: string;
  parent_item_id?: string;
  is_variant?: boolean;
  is_default_variant?: boolean;
  variant_name?: string;
  updated_at?: string;
  updated_by?: string;
}

interface Vendor {
  id: string;
  code: string;
  name: string;
  is_verified?: boolean;
}

interface ItemVendor {
  vendor_id: string;
  vendor?: Vendor;
  vendor_name?: string;
  vendor_code?: string;
  priority: number;
  unit_price?: number;
  lead_time_days?: number;
  vendor_item_code?: string;
}

type ItemsTableColumnKey =
  | "code"
  | "name"
  | "oem_part_no"
  | "category"
  | "uom"
  | "hsn_code"
  | "uid_tracking"
  | "drawing_required"
  | "total_stock"
  | "standard_cost"
  | "is_active";

const ITEMS_TABLE_COLUMNS: Array<{ key: ItemsTableColumnKey; label: string }> =
  [
    { key: "code", label: "SAS Part Number" },
    { key: "name", label: "Name" },
    { key: "oem_part_no", label: "OEM Part No." },
    { key: "category", label: "Category" },
    { key: "uom", label: "UOM" },
    { key: "hsn_code", label: "HSN" },
    { key: "uid_tracking", label: "UID" },
    { key: "drawing_required", label: "Drawing" },
    { key: "total_stock", label: "Stock" },
    { key: "standard_cost", label: "Cost" },
    { key: "is_active", label: "Status" },
  ];

const ITEMS_TABLE_COLUMNS_STORAGE_KEY = "itemsTableColumns:v1";
const ITEMS_TABLE_PAGE_SIZE_STORAGE_KEY = "itemsTablePageSize:v1";
const ITEM_CATEGORY_OPTIONS = [
  { value: "RAW_MATERIAL", label: "Raw Material" },
  { value: "SUB_ASSEMBLY", label: "Sub Assembly" },
  { value: "CAPITAL_GOODS", label: "Capital Goods" },
  { value: "CONSUMABLE", label: "Consumable" },
  { value: "FINISHED_GOODS", label: "Finished Goods" },
  { value: "SERVICES", label: "Services" },
];

const ITEM_CODE_PREFIX_BY_CATEGORY: Record<string, string> = {
  RAW_MATERIAL: "100",
  SUB_ASSEMBLY: "200",
  SERVICES: "300",
  CAPITAL_GOODS: "400",
  CONSUMABLE: "500",
  FINISHED_GOODS: "700",
};

const ITEM_CATEGORY_ALIASES: Record<string, string> = {
  RAW_MATERIALS: "RAW_MATERIAL",
  SERVICE: "SERVICES",
  SERVICES_PURCHASE: "SERVICES",
  SUB: "SUB_ASSEMBLY",
  SUBASSEMBLY: "SUB_ASSEMBLY",
  SUB_ASSEMBLIES: "SUB_ASSEMBLY",
  FINISHED: "FINISHED_GOODS",
  FINISHED_GOOD: "FINISHED_GOODS",
  FG: "FINISHED_GOODS",
  PACKING_MATERIAL: "RAW_MATERIAL",
};

function normalizeItemCategory(category: unknown): string {
  const value = String(category ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  return ITEM_CATEGORY_ALIASES[value] || value;
}

function formatItemCategory(category: unknown): string {
  const normalized = normalizeItemCategory(category);
  return (
    ITEM_CATEGORY_OPTIONS.find((option) => option.value === normalized)
      ?.label || normalized.replace(/_/g, " ")
  );
}

function formatImportError(error: unknown): string {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object")
    return String(error || "Import failed");

  const row = (error as any).row ?? (error as any).line ?? null;
  const item =
    (error as any).item ?? (error as any).code ?? (error as any).name ?? "";
  const message =
    (error as any).error ??
    (error as any).message ??
    (error as any).details ??
    "Import failed";

  return [row ? `Row ${row}` : "", item ? String(item) : "", String(message)]
    .filter(Boolean)
    .join(" - ");
}

function normalizeImportErrors(errors: unknown): string[] {
  if (!Array.isArray(errors)) return [];
  return errors.map(formatImportError);
}

export default function ItemsPage() {
  const router = useRouter();
  const currentUser = readStoredUser();
  const currentUserId = String(
    (currentUser as any)?.id || (currentUser as any)?.userId || "",
  ).trim();
  const canCreate = hasModulePermission(currentUser, "Inventory", "create");
  const canEdit = hasModulePermission(currentUser, "Inventory", "edit");
  const canDelete = hasModulePermission(currentUser, "Inventory", "delete");
  const canVerify =
    isAdminLike(currentUser) &&
    hasModulePermission(currentUser, "Inventory", "approve");
  const canExport = isAdminLike(currentUser); // Only admins can export data
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [itemScope, setItemScope] = useState<"REGULAR" | "RND">("REGULAR");
  const [showDeleted, setShowDeleted] = useState(false);
  const [showDrawingManager, setShowDrawingManager] = useState(false);
  const [selectedItemForDrawing, setSelectedItemForDrawing] =
    useState<Item | null>(null);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const [newCategory, setNewCategory] = useState("");
  const [editingCategory, setEditingCategory] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [itemVendors, setItemVendors] = useState<ItemVendor[]>([]);
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [savingItem, setSavingItem] = useState(false);
  const savingItemRef = useRef(false);

  // Variant manager state
  const [showVariantManager, setShowVariantManager] = useState(false);
  const [selectedParentItem, setSelectedParentItem] = useState<Item | null>(
    null,
  );
  const [variants, setVariants] = useState<Item[]>([]);
  const { duplicateState, checkDuplicates, handleProceed, handleCancel } =
    useDuplicateDetection();
  const cancelDuplicateCheck = () => {
    handleCancel();
    savingItemRef.current = false;
    setSavingItem(false);
  };
  const [newVariant, setNewVariant] = useState({
    code: "",
    name: "",
    variant_name: "",
    is_default: false,
  });

  // Drawing upload state
  const [drawingFile, setDrawingFile] = useState<File | null>(null);
  const [uploadingDrawing, setUploadingDrawing] = useState(false);
  const drawingFileInputRef = useRef<HTMLInputElement | null>(null);

  // Item view modal
  const [viewingItem, setViewingItem] = useState<Item | null>(null);

  // Stock trail drill-down
  const [stockTrail, setStockTrail] = useState<{
    open: boolean;
    item: Item | null;
    loading: boolean;
    data: any;
  }>({ open: false, item: null, loading: false, data: null });
  const stockHydrationKeyRef = useRef<string>("");

  const applyLedgerStockToItem = (itemId: string, ledgerStock: number) => {
    setItems((current) =>
      current.map((row) =>
        row.id === itemId
          ? ({
              ...row,
              total_stock: ledgerStock,
              current_stock: ledgerStock,
              available_quantity: ledgerStock,
            } as Item)
          : row,
      ),
    );
  };

  const openStockTrail = async (item: Item) => {
    setStockTrail({ open: true, item, loading: true, data: null });
    try {
      const data = await apiClient.get<any>(`/items/${item.id}/stock-trail`);
      if (
        data &&
        data.currentBalance !== undefined &&
        data.currentBalance !== null
      ) {
        const ledgerStock = Number(data.currentBalance) || 0;
        applyLedgerStockToItem(item.id, ledgerStock);
        setStockTrail((prev) => ({
          ...prev,
          item: {
            ...item,
            total_stock: ledgerStock,
            current_stock: ledgerStock,
            available_quantity: ledgerStock,
          } as Item,
        }));
      }
      setStockTrail((prev) => ({ ...prev, loading: false, data }));
    } catch (err: any) {
      setStockTrail((prev) => ({
        ...prev,
        loading: false,
        data: { error: String(err?.message || err) },
      }));
    }
  };

  const openItemDetail = async (item: Item) => {
    setViewingItem(item);
    try {
      const detail = await apiClient.get<Item>(`/inventory/items/${item.id}`);
      setViewingItem({
        ...item,
        ...detail,
        total_stock: item.total_stock,
      });
    } catch {
      // Keep the list row open if detail hydration fails.
    }
  };
  const [drawingAttachmentMessage, setDrawingAttachmentMessage] = useState<{
    type: "success" | "warning" | "info";
    text: string;
  } | null>(null);

  // Bulk inventory state
  const [showBulkInventory, setShowBulkInventory] = useState(false);
  const [bulkInventoryItems, setBulkInventoryItems] = useState<
    Array<{
      itemId: string;
      itemCode: string;
      itemName: string;
      quantity: string;
      location: string;
    }>
  >([]);

  // Excel import state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const [importResult, setImportResult] = useState<{
    success: number;
    failed: number;
    errors: string[];
  } | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Sorting state
  const [sortColumn, setSortColumn] = useState<string>("code");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  // Column visibility
  const [showColumnsMenu, setShowColumnsMenu] = useState(false);
  const topTableScrollRef = useRef<HTMLDivElement | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<
    Record<ItemsTableColumnKey, boolean>
  >(() => {
    return ITEMS_TABLE_COLUMNS.reduce(
      (acc, col) => {
        acc[col.key] = true;
        return acc;
      },
      {} as Record<ItemsTableColumnKey, boolean>,
    );
  });

  // Autocomplete state
  const [showAutocomplete, setShowAutocomplete] = useState(false);

  const [vendorForm, setVendorForm] = useState({
    vendor_id: "",
    priority: 1,
    unit_price: "",
    lead_time_days: "",
    vendor_item_code: "",
  });

  const [formData, setFormData] = useState({
    code: "",
    name: "",
    oem_part_no: "",
    oem_name: "",
    description: "",
    category: "RAW_MATERIAL",
    product_category: "",
    uom: "PCS",
    product_size: "",
    product_size_uom: "MM",
    hsn_code: "",
    standard_cost: "",
    selling_price: "",
    purchase_currency: "INR",
    foreign_unit_price: "",
    reorder_level: "",
    reorder_quantity: "",
    lead_time_days: "",
    is_active: true,
    uid_tracking: true,
    uid_strategy: "SERIALIZED",
    batch_uom: "",
    batch_quantity: "",
    sales_uom: "",
    sales_uom_factor: "",
    sales_whole_uom_only: true,
    drawing_required: "OPTIONAL",
    parent_item_id: "",
    is_variant: false,
    is_default_variant: false,
    variant_name: "",
    drawing_url: "",
    drawing_file_name: "",
  });
  const [codeGenerating, setCodeGenerating] = useState(false);
  const itemCodeRequestRef = useRef(0);

  const refreshGeneratedItemCode = async (
    categoryValue = formData.category,
  ) => {
    const normalizedCategory = normalizeItemCategory(categoryValue);
    const prefix = ITEM_CODE_PREFIX_BY_CATEGORY[normalizedCategory] || "100";
    const requestId = itemCodeRequestRef.current + 1;
    itemCodeRequestRef.current = requestId;

    if (editingItem) return;
    setCodeGenerating(true);
    try {
      const result = await apiClient.get<{ code?: string }>(
        `/items/next-code?category=${encodeURIComponent(normalizedCategory)}`,
      );
      if (itemCodeRequestRef.current !== requestId) return;
      const apiCode = String(result?.code || "");
      const nextCode = apiCode.startsWith(`${prefix}-`)
        ? apiCode
        : `${prefix}-0001`;
      setFormData((prev) => ({
        ...prev,
        category: normalizedCategory,
        code: nextCode,
      }));
    } catch {
      if (itemCodeRequestRef.current !== requestId) return;
      setFormData((prev) => ({
        ...prev,
        category: normalizedCategory,
        code: prev.code || `${prefix}-0001`,
      }));
    } finally {
      if (itemCodeRequestRef.current === requestId) setCodeGenerating(false);
    }
  };

  const addCategory = async () => {
    if (newCategory.trim()) {
      try {
        await apiClient.post("/categories", { name: newCategory });
        setNewCategory("");
        await fetchCategories();
        alert("Category added successfully!");
      } catch (error) {
        alert("Failed to add category");
      }
    }
  };

  const updateCategory = async () => {
    if (editingCategory && editingCategory.name.trim()) {
      try {
        await apiClient.put(`/categories/${editingCategory.id}`, {
          name: editingCategory.name,
        });
        setEditingCategory(null);
        await fetchCategories();
        alert("Category updated successfully!");
      } catch (error) {
        alert("Failed to update category");
      }
    }
  };

  const deleteCategory = async (id: string, name: string) => {
    if (
      confirm(`Delete category "${name}"? This won't affect existing items.`)
    ) {
      try {
        await apiClient.delete(`/categories/${id}`);
        await fetchCategories();
        alert("Category deleted successfully!");
      } catch (error) {
        alert("Failed to delete category");
      }
    }
  };

  const fetchCategories = async () => {
    try {
      const data = await apiClient.get("/categories");
      setCategories(data);
    } catch (error) {}
  };

  const fetchVendors = async () => {
    try {
      // Vendors live under the purchase module routes
      const data = await apiClient.get("/purchase/vendors?isActive=true");
      const verifiedVendors = Array.isArray(data)
        ? data.filter((vendor: Vendor) => vendor.is_verified === true)
        : [];
      // Sort alphabetically by name
      verifiedVendors.sort((a: Vendor, b: Vendor) =>
        a.name.localeCompare(b.name),
      );
      setVendors(verifiedVendors);
    } catch (error) {
      setVendors([]);
    }
  };

  const seedCategories = async () => {
    try {
      await apiClient.post("/categories/seed", {});
      await fetchCategories();
      alert("Default categories restored!");
    } catch (error) {
      alert("Failed to restore categories");
    }
  };

  useEffect(() => {
    fetchCategories();
    fetchVendors();
  }, []);

  const uomOptions = [
    "PCS",
    "KG",
    "GRAM",
    "LITER",
    "METER",
    "CM",
    "MM",
    "BOX",
    "SET",
    "PACK",
    "ROLL",
    "SHEET",
    "FEET",
    "INCH",
  ];

  // Close modals on Escape key
  useEscapeKey(showForm, () => setShowForm(false));
  useEscapeKey(!!viewingItem, () => setViewingItem(null));
  useEscapeKey(showDrawingManager, () => {
    setShowDrawingManager(false);
    setSelectedItemForDrawing(null);
  });
  useEscapeKey(showCategoryManager, () => setShowCategoryManager(false));
  useEscapeKey(showBulkInventory, () => setShowBulkInventory(false));
  useEscapeKey(showImportModal, () => setShowImportModal(false));
  useEscapeKey(stockTrail.open, () =>
    setStockTrail((s) => ({ ...s, open: false })),
  );

  useEffect(() => {
    fetchItems();
    fetchVendors();
  }, [showDeleted, itemScope]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ITEMS_TABLE_COLUMNS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<
        Record<ItemsTableColumnKey, boolean>
      >;

      setVisibleColumns((prev) => {
        const next = { ...prev };
        for (const { key } of ITEMS_TABLE_COLUMNS) {
          if (typeof parsed[key] === "boolean")
            next[key] = parsed[key] as boolean;
        }
        return next;
      });
    } catch {
      // ignore invalid localStorage value
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ITEMS_TABLE_PAGE_SIZE_STORAGE_KEY);
      if (!raw) return;
      const next = Number(raw);
      if ([10, 25, 50, 100].includes(next)) setItemsPerPage(next);
    } catch {
      // ignore invalid localStorage value
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        ITEMS_TABLE_COLUMNS_STORAGE_KEY,
        JSON.stringify(visibleColumns),
      );
    } catch {
      // ignore localStorage write errors
    }
  }, [visibleColumns]);

  useEffect(() => {
    try {
      localStorage.setItem(
        ITEMS_TABLE_PAGE_SIZE_STORAGE_KEY,
        String(itemsPerPage),
      );
    } catch {
      // ignore localStorage write errors
    }
  }, [itemsPerPage]);

  const fetchItems = async () => {
    try {
      const params = new URLSearchParams();
      if (showDeleted) params.set("includeInactive", "true");
      if (itemScope === "RND") params.set("scope", "RND");
      params.set("_ts", String(Date.now()));
      const url = `/inventory/items${params.toString() ? `?${params.toString()}` : ""}`;
      const token =
        typeof window !== "undefined"
          ? localStorage.getItem("accessToken")
          : null;
      const response = await fetch(`/api/v1${url}`, {
        method: "GET",
        cache: "no-store",
        headers: token
          ? {
              Authorization: `Bearer ${token}`,
              "Cache-Control": "no-cache",
              Pragma: "no-cache",
            }
          : {
              "Cache-Control": "no-cache",
              Pragma: "no-cache",
            },
      });
      if (!response.ok) {
        throw new Error(await response.text().catch(() => response.statusText));
      }
      const data = await response.json();

      stockHydrationKeyRef.current = "";
      setItems(Array.isArray(data) ? data : []);
    } catch (error) {
      alert("Failed to fetch items");
    } finally {
      setLoading(false);
    }
  };

  const actuallyCreateItem = async (
    payload: any,
    drawingLink?: {
      fileName: string;
      fileUrl: string;
      fileType?: string;
      fileSize?: number;
      revisionNotes?: string;
    },
  ) => {
    try {
      if (editingItem) {
        const shouldPreUploadDrawing =
          !!drawingLink && payload?.drawing_required === "COMPULSORY";

        // If user is setting drawing as COMPULSORY and uploading in the same save,
        // we must create the drawing record first so the API validation passes.
        if (shouldPreUploadDrawing) {
          try {
            await apiClient.post(
              `/inventory/items/${editingItem.id}/drawings`,
              {
                fileName: drawingLink!.fileName,
                fileUrl: drawingLink!.fileUrl,
                fileType: drawingLink!.fileType,
                fileSize: drawingLink!.fileSize,
                revisionNotes:
                  drawingLink!.revisionNotes || "Uploaded via item form",
              },
            );
          } catch (err) {
            // Continue to item update; if drawing is compulsory, API may still reject.
          }
        }

        await apiClient.put(`/inventory/items/${editingItem.id}`, payload);

        // For normal updates, link the new drawing after the item update succeeds.
        if (drawingLink && !shouldPreUploadDrawing) {
          try {
            await apiClient.post(
              `/inventory/items/${editingItem.id}/drawings`,
              {
                fileName: drawingLink.fileName,
                fileUrl: drawingLink.fileUrl,
                fileType: drawingLink.fileType,
                fileSize: drawingLink.fileSize,
                revisionNotes:
                  drawingLink.revisionNotes || "Uploaded via item form",
              },
            );
          } catch (err) {
            alert(
              "Item updated, but drawing could not be linked. Please upload it from the Drawings tab.",
            );
          }
        }

        alert(
          drawingLink
            ? `Item updated successfully! Attachment uploaded: ${drawingLink.fileName}`
            : "Item updated successfully!",
        );
      } else {
        const result = await apiClient.post("/inventory/items", payload);

        // If a drawing was uploaded during creation, link it to the new item.
        if (drawingLink && result?.id) {
          try {
            await apiClient.post(`/inventory/items/${result.id}/drawings`, {
              fileName: drawingLink.fileName,
              fileUrl: drawingLink.fileUrl,
              fileType: drawingLink.fileType,
              fileSize: drawingLink.fileSize,
              revisionNotes: drawingLink.revisionNotes || "Initial version",
            });
          } catch (err) {
            alert(
              "Item created, but drawing could not be linked. Please upload it from the Drawings tab.",
            );
          }
        }

        // If vendors were added during creation, save them now
        if (itemVendors.length > 0 && result.id) {
          for (const vendor of itemVendors) {
            try {
              await apiClient.post(`/inventory/items/${result.id}/vendors`, {
                vendor_id: vendor.vendor_id,
                priority: vendor.priority,
                unit_price: vendor.unit_price,
                lead_time_days: vendor.lead_time_days,
                vendor_item_code: vendor.vendor_item_code,
              });
            } catch (vendorError) {
              // Continue with other vendors even if one fails
            }
          }
        }

        alert(
          drawingLink
            ? `Item created successfully! Attachment uploaded: ${drawingLink.fileName}`
            : "Item created successfully!",
        );
      }

      setShowForm(false);
      setEditingItem(null);
      resetForm();
      fetchItems();
    } catch (error: any) {
      alert(
        error.message || error.response?.data?.message || "Failed to save item",
      );
    } finally {
      savingItemRef.current = false;
      setSavingItem(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingItemRef.current) return;
    savingItemRef.current = true;
    setSavingItem(true);
    try {
      // Upload drawing if file is selected
      let drawingData = {
        drawing_url: formData.drawing_url,
        drawing_file_name: formData.drawing_file_name,
      };

      let drawingLink:
        | {
            fileName: string;
            fileUrl: string;
            fileType?: string;
            fileSize?: number;
            revisionNotes?: string;
          }
        | undefined;

      if (drawingFile) {
        const uploadResult = await handleDrawingUpload(drawingFile);
        if (uploadResult) {
          drawingData = uploadResult;

          // Create a drawing record (item_drawings) after the item save.
          drawingLink = {
            fileName: drawingFile.name,
            fileUrl: uploadResult.drawing_url,
            fileType: drawingFile.type,
            fileSize: drawingFile.size,
            revisionNotes: editingItem
              ? "Updated via item form"
              : "Initial version",
          };
        }
      }

      const payload = {
        ...formData,
        ...drawingData,
        category: normalizeItemCategory(formData.category),
        auto_generate_code: !editingItem,
        product_category: null,
        hsn_code: (formData.hsn_code || "").replace(/[^0-9]/g, ""),
        standard_cost: formData.standard_cost
          ? parseFloat(formData.standard_cost)
          : null,
        selling_price: null,
        purchase_currency: formData.purchase_currency || "INR",
        foreign_unit_price:
          formData.purchase_currency &&
          formData.purchase_currency !== "INR" &&
          formData.foreign_unit_price
            ? parseFloat(formData.foreign_unit_price)
            : null,
        reorder_level: formData.reorder_level
          ? parseInt(formData.reorder_level)
          : null,
        reorder_quantity: formData.reorder_quantity
          ? parseInt(formData.reorder_quantity)
          : null,
        lead_time_days: formData.lead_time_days
          ? parseInt(formData.lead_time_days)
          : null,
        batch_quantity: formData.batch_quantity
          ? parseFloat(formData.batch_quantity)
          : null,
        sales_uom: formData.sales_uom || null,
        sales_uom_factor: formData.sales_uom_factor
          ? parseFloat(formData.sales_uom_factor)
          : null,
        sales_whole_uom_only:
          Boolean(formData.sales_uom) && formData.sales_whole_uom_only,
        parent_item_id: formData.parent_item_id || null,
        is_variant: formData.is_variant || false,
        is_default_variant: formData.is_default_variant || false,
        variant_name: formData.variant_name || null,
        isRndItem: itemScope === "RND",
        department: itemScope === "RND" ? "R&D" : undefined,
      };

      // For updates, skip duplicate check
      if (editingItem) {
        await actuallyCreateItem(payload, drawingLink);
        return;
      }

      // Check for duplicates before creating
      await checkDuplicates(
        () => apiClient.post("/items/check-duplicates", payload),
        () => actuallyCreateItem(payload, drawingLink),
      );
    } catch (error: any) {
      alert(
        error.message || error.response?.data?.message || "Failed to save item",
      );
      savingItemRef.current = false;
      setSavingItem(false);
    }
  };

  const loadExistingDrawingForEdit = async (itemId: string) => {
    try {
      const drawings = await apiClient.get(
        `/inventory/items/${itemId}/drawings`,
      );
      if (!Array.isArray(drawings) || drawings.length === 0) return;

      const active = drawings.find((d: any) => d?.is_active) || drawings[0];
      const fileUrl = String(active?.file_url || "");
      const fileName = String(active?.file_name || "");
      if (!fileUrl && !fileName) return;

      setFormData((prev) => ({
        ...prev,
        drawing_url: fileUrl || prev.drawing_url,
        drawing_file_name: fileName || prev.drawing_file_name,
      }));
    } catch (error) {}
  };

  const handleEdit = (item: Item) => {
    setEditingItem(item);
    setFormData({
      code: item.code,
      name: item.name,
      oem_part_no: item.oem_part_no || "",
      oem_name: item.oem_name || "",
      description: item.description || "",
      category: normalizeItemCategory(item.category),
      product_category: "",
      uom: item.uom,
      product_size: item.product_size?.toString() || "",
      product_size_uom: item.product_size_uom || "MM",
      // Some older records/imports can have whitespace; trim so HTML pattern validation doesn't block saving
      hsn_code: (item.hsn_code ? String(item.hsn_code) : "").replace(
        /[^0-9]/g,
        "",
      ),
      standard_cost: item.standard_cost?.toString() || "",
      selling_price: item.selling_price?.toString() || "",
      purchase_currency: item.purchase_currency || "INR",
      foreign_unit_price: item.foreign_unit_price?.toString() || "",
      reorder_level: item.reorder_level?.toString() || "",
      reorder_quantity: item.reorder_quantity?.toString() || "",
      lead_time_days: item.lead_time_days?.toString() || "",
      is_active: item.is_active,
      uid_tracking: item.uid_tracking !== false,
      uid_strategy: item.uid_strategy || "SERIALIZED",
      batch_uom: item.batch_uom || "",
      batch_quantity: item.batch_quantity?.toString() || "",
      sales_uom: item.sales_uom || "",
      sales_uom_factor: item.sales_uom_factor?.toString() || "",
      sales_whole_uom_only: item.sales_whole_uom_only ?? true,
      drawing_required: item.drawing_required || "OPTIONAL",
      parent_item_id: item.parent_item_id || "",
      is_variant: item.is_variant || false,
      is_default_variant: item.is_default_variant || false,
      variant_name: item.variant_name || "",
      drawing_url: (item as any).drawing_url || "",
      drawing_file_name: (item as any).drawing_file_name || "",
    });
    setDrawingFile(null);
    setDrawingAttachmentMessage(null);
    if (drawingFileInputRef.current) drawingFileInputRef.current.value = "";
    setShowForm(true);
    fetchItemVendors(item.id);

    // Ensure the edit form shows the current drawing even when drawings are stored in item_drawings.
    loadExistingDrawingForEdit(item.id);
  };

  const handleCloneItem = async (item: Item) => {
    if (!canCreate) {
      alert("You do not have permission to create item masters.");
      return;
    }

    try {
      let detail: Item = item;
      try {
        const loadedDetail = await apiClient.get<Item>(
          `/inventory/items/${item.id}`,
        );
        detail = { ...item, ...loadedDetail };
      } catch {
        detail = item;
      }

      let linkedVendors: ItemVendor[] = [];
      try {
        const vendorRows = await apiClient.get(
          `/inventory/items/${item.id}/vendors`,
        );
        linkedVendors = (Array.isArray(vendorRows) ? vendorRows : [])
          .map((row: any) => ({
            vendor_id: row.vendor_id || row.vendorId || row.vendor?.id || "",
            vendor: row.vendor,
            vendor_name:
              row.vendor_name || row.vendorName || row.vendor?.name || "",
            vendor_code:
              row.vendor_code || row.vendorCode || row.vendor?.code || "",
            priority: Number(row.priority || 1),
            unit_price:
              row.unit_price !== undefined && row.unit_price !== null
                ? Number(row.unit_price)
                : undefined,
            lead_time_days:
              row.lead_time_days !== undefined && row.lead_time_days !== null
                ? Number(row.lead_time_days)
                : undefined,
            vendor_item_code: row.vendor_item_code || row.vendorItemCode || "",
          }))
          .filter((row: ItemVendor) => Boolean(row.vendor_id));
      } catch {
        linkedVendors = [];
      }

      setViewingItem(null);
      setEditingItem(null);
      setItemScope(
        (detail as any).department === "R&D" ||
          (detail as any).is_rnd_item ||
          (detail as any).isRndItem
          ? "RND"
          : "REGULAR",
      );
      setFormData({
        code: "",
        name: detail.name,
        oem_part_no: detail.oem_part_no || "",
        oem_name: detail.oem_name || "",
        description: detail.description || "",
        category: normalizeItemCategory(detail.category),
        product_category: detail.product_category || "",
        uom: detail.uom || "PCS",
        product_size: detail.product_size?.toString() || "",
        product_size_uom: detail.product_size_uom || "MM",
        hsn_code: (detail.hsn_code ? String(detail.hsn_code) : "").replace(
          /[^0-9]/g,
          "",
        ),
        standard_cost: detail.standard_cost?.toString() || "",
        selling_price: detail.selling_price?.toString() || "",
        purchase_currency: detail.purchase_currency || "INR",
        foreign_unit_price: detail.foreign_unit_price?.toString() || "",
        reorder_level: detail.reorder_level?.toString() || "",
        reorder_quantity: detail.reorder_quantity?.toString() || "",
        lead_time_days: detail.lead_time_days?.toString() || "",
        is_active: true,
        uid_tracking: detail.uid_tracking !== false,
        uid_strategy: detail.uid_strategy || "SERIALIZED",
        batch_uom: detail.batch_uom || "",
        batch_quantity: detail.batch_quantity?.toString() || "",
        sales_uom: detail.sales_uom || "",
        sales_uom_factor: detail.sales_uom_factor?.toString() || "",
        sales_whole_uom_only: detail.sales_whole_uom_only ?? true,
        drawing_required: detail.drawing_required || "OPTIONAL",
        parent_item_id: detail.parent_item_id || "",
        is_variant: detail.is_variant || false,
        is_default_variant: false,
        variant_name: detail.variant_name ? `${detail.variant_name} Copy` : "",
        drawing_url: "",
        drawing_file_name: "",
      });
      setItemVendors(linkedVendors);
      setDrawingFile(null);
      setDrawingAttachmentMessage(null);
      if (drawingFileInputRef.current) drawingFileInputRef.current.value = "";
      setShowVendorForm(false);
      setShowForm(true);
    } catch (error: any) {
      alert(error?.message || "Failed to clone item master");
    }
  };

  const fetchItemVendors = async (itemId: string) => {
    try {
      const data = await apiClient.get(`/inventory/items/${itemId}/vendors`);
      setItemVendors(
        (Array.isArray(data) ? data : []).map((row: any) => ({
          ...row,
          vendor_id: row.vendor_id || row.vendorId || row.vendor?.id || "",
          vendor_name:
            row.vendor_name || row.vendorName || row.vendor?.name || "",
          vendor_code:
            row.vendor_code || row.vendorCode || row.vendor?.code || "",
        })),
      );
    } catch (error) {
      setItemVendors([]);
    }
  };

  const resolveItemVendorDisplay = (itemVendor: ItemVendor) => {
    const linkedVendor = vendors.find(
      (vendor) => vendor.id === itemVendor.vendor_id,
    );
    const name =
      itemVendor.vendor?.name ||
      linkedVendor?.name ||
      itemVendor.vendor_name ||
      itemVendor.vendor?.code ||
      linkedVendor?.code ||
      itemVendor.vendor_code ||
      "Vendor";
    const code =
      itemVendor.vendor?.code ||
      linkedVendor?.code ||
      itemVendor.vendor_code ||
      "";
    return { name, code };
  };

  const openVariantManager = async (item: Item) => {
    setSelectedParentItem(item);
    setShowVariantManager(true);
    await fetchVariants(item.id);
  };

  const fetchVariants = async (parentItemId: string) => {
    try {
      const data = await apiClient.get(`/items/${parentItemId}/variants`);
      setVariants(data || []);
    } catch (error) {
      setVariants([]);
    }
  };

  const addVariantQuick = async () => {
    if (
      !selectedParentItem ||
      !newVariant.code ||
      !newVariant.name ||
      !newVariant.variant_name
    ) {
      alert("Please fill in all variant fields");
      return;
    }

    try {
      const payload = {
        code: newVariant.code,
        name: newVariant.name,
        variant_name: newVariant.variant_name,
        parent_item_id: selectedParentItem.id,
        is_variant: true,
        is_default_variant: newVariant.is_default,
        category: normalizeItemCategory(selectedParentItem.category),
        product_category: null,
        uom: selectedParentItem.uom,
        hsn_code: selectedParentItem.hsn_code || "",
        is_active: true,
        uid_tracking: false,
        uid_strategy: "NONE",
      };

      const result = await apiClient.post("/inventory/items", payload);

      setNewVariant({
        code: "",
        name: "",
        variant_name: "",
        is_default: false,
      });
      await fetchVariants(selectedParentItem.id);
      await fetchItems();
      alert("Variant added successfully!");
    } catch (error: any) {
      const errorMsg =
        error.response?.data?.message ||
        error.message ||
        "Failed to add variant";
      alert("Failed to add variant:\n" + errorMsg);
    }
  };

  const deleteVariant = async (variantId: string) => {
    const confirmed = await confirmDialog({
      title: "Delete Variant",
      message: "Delete this variant? This cannot be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!confirmed) return;

    try {
      await apiClient.delete(`/inventory/items/${variantId}`);
      if (selectedParentItem) {
        await fetchVariants(selectedParentItem.id);
      }
      await fetchItems();
      alert("Variant deleted successfully!");
    } catch (error: any) {
      alert(error.response?.data?.message || "Failed to delete variant");
    }
  };

  const toggleDefaultVariant = async (
    variantId: string,
    currentDefault: boolean,
  ) => {
    if (!selectedParentItem) return;

    try {
      await apiClient.put(`/inventory/items/${variantId}`, {
        is_default_variant: !currentDefault,
      });
      await fetchVariants(selectedParentItem.id);
      await fetchItems();
    } catch (error: any) {
      alert(
        error.response?.data?.message || "Failed to update default variant",
      );
    }
  };

  const addItemVendor = async () => {
    if (!vendorForm.vendor_id) {
      alert("Please select a vendor");
      return;
    }

    // Check for duplicate vendor
    const isDuplicate = itemVendors.some(
      (iv) => iv.vendor_id === vendorForm.vendor_id,
    );
    if (isDuplicate) {
      alert("This vendor is already added. Please select a different vendor.");
      return;
    }

    // If editing existing item, save to database
    if (editingItem) {
      try {
        await apiClient.post(`/inventory/items/${editingItem.id}/vendors`, {
          vendor_id: vendorForm.vendor_id,
          priority: vendorForm.priority,
          unit_price: vendorForm.unit_price
            ? parseFloat(vendorForm.unit_price)
            : null,
          lead_time_days: vendorForm.lead_time_days
            ? parseInt(vendorForm.lead_time_days)
            : null,
          vendor_item_code: vendorForm.vendor_item_code || null,
        });

        alert("Vendor added successfully!");
        setShowVendorForm(false);
        setVendorForm({
          vendor_id: "",
          priority: 1,
          unit_price: "",
          lead_time_days: "",
          vendor_item_code: "",
        });
        fetchItemVendors(editingItem.id);
      } catch (error: any) {
        const status = error?.response?.status;
        const apiMessage =
          error?.response?.data?.message ||
          error?.response?.data?.error ||
          error?.message ||
          "Failed to add vendor";

        // If vendor is already linked (409), treat as non-fatal and refresh.
        if (status === 409) {
          alert(apiMessage);
          setShowVendorForm(false);
          fetchItemVendors(editingItem.id);
          return;
        }

        alert(apiMessage);
      }
    } else {
      // If creating new item, add to temporary list
      const vendor = vendors.find((v) => v.id === vendorForm.vendor_id);
      if (!vendor) {
        alert("Vendor not found");
        return;
      }

      const newVendor: any = {
        vendor_id: vendorForm.vendor_id,
        vendor_name: vendor.name,
        priority: vendorForm.priority,
        unit_price: vendorForm.unit_price
          ? parseFloat(vendorForm.unit_price)
          : null,
        lead_time_days: vendorForm.lead_time_days
          ? parseInt(vendorForm.lead_time_days)
          : null,
        vendor_item_code: vendorForm.vendor_item_code || null,
        is_preferred: vendorForm.priority === 1,
      };

      setItemVendors([...itemVendors, newVendor]);
      setShowVendorForm(false);
      setVendorForm({
        vendor_id: "",
        priority: 1,
        unit_price: "",
        lead_time_days: "",
        vendor_item_code: "",
      });
    }
  };

  const removeItemVendor = async (vendorId: string) => {
    if (editingItem) {
      // If editing, remove from database
      const confirmed = await confirmDialog({
        title: "Remove Vendor",
        message: "Remove this vendor?",
        confirmLabel: "Remove",
        variant: "warning",
      });
      if (!confirmed) return;

      try {
        await apiClient.delete(
          `/inventory/items/${editingItem.id}/vendors/${vendorId}`,
        );
        alert("Vendor removed successfully!");
        fetchItemVendors(editingItem.id);
      } catch (error) {
        alert("Failed to remove vendor");
      }
    } else {
      // If creating new item, remove from temporary list
      setItemVendors(itemVendors.filter((iv) => iv.vendor_id !== vendorId));
    }
  };

  const handleDelete = async (id: string) => {
    const confirmed = await confirmDialog({
      title: "Delete Item",
      message: "Are you sure you want to delete this item?",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!confirmed) return;

    try {
      await apiClient.delete(`/inventory/items/${id}`);
      alert("Item deleted successfully!");
      fetchItems();
    } catch (error) {
      alert("Failed to delete item");
    }
  };

  const handleRestore = async (id: string) => {
    const confirmed = await confirmDialog({
      title: "Restore Item",
      message: "Are you sure you want to restore this item?",
      confirmLabel: "Restore",
      variant: "warning",
    });
    if (!confirmed) return;

    try {
      await apiClient.put(`/inventory/items/${id}`, { is_active: true });
      alert("Item restored successfully!");
      fetchItems();
    } catch (error) {
      alert("Failed to restore item");
    }
  };

  const handleVerification = async (item: Item, shouldVerify: boolean) => {
    if (!canVerify) {
      alert("Only admin users with approval permission can verify items");
      return;
    }
    if (
      shouldVerify &&
      item.created_by &&
      currentUserId &&
      String(item.created_by) === currentUserId
    ) {
      alert(
        "Maker-checker rule: item creator cannot verify their own material master.",
      );
      return;
    }

    const confirmed = await confirmDialog({
      title: shouldVerify ? "Verify Item" : "Remove Item Verification",
      message: shouldVerify
        ? `Allow ${item.name} to be used in purchases, production, and inventory movements?`
        : `Block ${item.name} from new usage until verified again?`,
      confirmLabel: shouldVerify ? "Verify" : "Unverify",
      variant: shouldVerify ? "info" : "warning",
    });
    if (!confirmed) return;

    try {
      await apiClient.put(
        `/items/${item.id}/${shouldVerify ? "verify" : "unverify"}`,
        {},
      );
      alert(
        shouldVerify
          ? "Item verified successfully!"
          : "Item verification removed!",
      );
      fetchItems();
    } catch (error: any) {
      alert(error?.message || "Failed to update item verification");
    }
  };

  const handleDrawingUpload = async (file: File) => {
    if (!file) return null;

    setUploadingDrawing(true);
    try {
      const formDataUpload = new FormData();
      formDataUpload.append("file", file);
      formDataUpload.append("bucket", "drawings");
      formDataUpload.append("folder", "item-drawings");

      const result: any = await apiClient.postForm("/upload", formDataUpload);

      const uploadedUrl = result?.url || "";
      if (!uploadedUrl) throw new Error("Upload failed: no url returned");

      return {
        drawing_url: uploadedUrl,
        drawing_file_name: file.name,
      };
    } catch (error) {
      alert("Failed to upload drawing");
      return null;
    } finally {
      setUploadingDrawing(false);
    }
  };

  const formatFileSize = (size: number) => {
    if (!size) return "0 KB";
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  const clearDrawingSelection = () => {
    setDrawingFile(null);
    setDrawingAttachmentMessage(null);
    if (drawingFileInputRef.current) drawingFileInputRef.current.value = "";
  };

  const handleDrawingFileSelect = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const selectedFile = event.target.files?.[0] || null;
    if (!selectedFile) return;

    const isSameAsSelected =
      drawingFile &&
      drawingFile.name === selectedFile.name &&
      drawingFile.size === selectedFile.size &&
      drawingFile.lastModified === selectedFile.lastModified;
    const isSameAsSaved =
      !drawingFile && formData.drawing_file_name === selectedFile.name;

    if (isSameAsSelected || isSameAsSaved) {
      setDrawingAttachmentMessage({
        type: "warning",
        text: `${selectedFile.name} is already attached. Duplicate upload skipped.`,
      });
      event.target.value = "";
      return;
    }

    setDrawingFile(selectedFile);
    setDrawingAttachmentMessage({
      type: "success",
      text: `${selectedFile.name} added (${formatFileSize(selectedFile.size)}). It will upload when you save the item.`,
    });
  };

  const downloadItemTemplate = () => {
    const headers = [
      "code",
      "name",
      "category",
      "uom",
      "hsn_code",
      "standard_cost",
      "selling_price",
      "description",
      "drawing_required",
      "min_stock_level",
      "reorder_level",
    ];
    const example = [
      "ITM-001",
      "Sample Item",
      "Raw Material",
      "NOS",
      "12345678",
      "100",
      "120",
      "Example item description",
      "OPTIONAL",
      "10",
      "20",
    ];
    const csv = [headers.join(","), example.join(",")].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "items_import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const parseImportFile = (file: File) => {
    setImportFile(file);
    setImportResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) {
        setImportPreview([]);
        return;
      }
      const headers = lines[0]
        .split(",")
        .map((h) => h.trim().replace(/^"|"+$/g, ""));
      const rows = lines.slice(1).map((line) => {
        const vals = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
        return Object.fromEntries(headers.map((h, i) => [h, vals[i] || ""]));
      });
      setImportPreview(rows);
    };
    reader.readAsText(file);
  };

  const submitImport = async () => {
    if (!importPreview.length) return;
    setImportLoading(true);
    setImportResult(null);
    try {
      const result = await apiClient.post("/items/bulk", {
        items: importPreview,
      });
      const r = result as any;
      setImportResult({
        success: r.success || 0,
        failed: r.failed || 0,
        errors: normalizeImportErrors(r.errors),
      });
      if ((r.success || 0) > 0) fetchItems();
    } catch (e: any) {
      const responseData = e?.response?.data;
      const responseErrors =
        responseData?.errors ||
        (Array.isArray(responseData?.message) ? responseData.message : null);
      const fallbackMessage =
        responseData?.message ||
        responseData?.error ||
        e?.message ||
        "Import failed";
      setImportResult({
        success: 0,
        failed: importPreview.length,
        errors:
          normalizeImportErrors(responseErrors).length > 0
            ? normalizeImportErrors(responseErrors)
            : [formatImportError(fallbackMessage)],
      });
    } finally {
      setImportLoading(false);
    }
  };

  const initBulkInventory = () => {
    // Initialize with all active items with zero quantity
    const bulkItems = items
      .filter((item) => item.is_active && item.is_verified === true)
      .map((item) => ({
        itemId: item.id,
        itemCode: item.code,
        itemName: item.name,
        quantity: "",
        location: "MAIN_WAREHOUSE",
      }));
    setBulkInventoryItems(bulkItems);
    setShowBulkInventory(true);
  };

  const handleBulkInventorySubmit = async () => {
    // Filter items with quantity entered
    const itemsWithQty = bulkInventoryItems.filter(
      (item) => item.quantity && parseFloat(item.quantity) > 0,
    );

    if (itemsWithQty.length === 0) {
      alert("Please enter quantities for at least one item");
      return;
    }

    const confirmed = await confirmDialog({
      title: "Add Inventory",
      message: `Add inventory for ${itemsWithQty.length} items?`,
      confirmLabel: "Add",
      variant: "info",
    });
    if (!confirmed) return;

    try {
      // Fetch warehouses to get warehouse IDs
      const warehousesResponse = await apiClient.get("/inventory/warehouses");
      const warehouses = warehousesResponse || [];

      // Map location names to warehouse IDs
      const locationToWarehouseId: Record<string, string> = {};
      warehouses.forEach((wh: any) => {
        if (wh.name === "Main Warehouse")
          locationToWarehouseId["MAIN_WAREHOUSE"] = wh.id;
        else if (wh.name === "Production Floor")
          locationToWarehouseId["PRODUCTION_FLOOR"] = wh.id;
        else if (wh.name === "QC Area")
          locationToWarehouseId["QC_AREA"] = wh.id;
        else if (wh.name === "Finished Goods")
          locationToWarehouseId["FINISHED_GOODS"] = wh.id;
      });

      // If no mapping found, use the first warehouse as default
      const defaultWarehouseId = warehouses[0]?.id;

      if (!defaultWarehouseId) {
        alert("No warehouses found. Please create a warehouse first.");
        return;
      }

      // Create inventory movements for each item
      const promises = itemsWithQty.map((item) =>
        apiClient.post("/inventory/movements", {
          movement_type: "ADJUSTMENT",
          item_id: item.itemId,
          to_warehouse_id:
            locationToWarehouseId[item.location] || defaultWarehouseId,
          quantity: parseFloat(item.quantity),
          notes: "Bulk inventory entry",
        }),
      );

      await Promise.all(promises);
      alert(`Successfully added inventory for ${itemsWithQty.length} items!`);
      setShowBulkInventory(false);
      setBulkInventoryItems([]);
      fetchItems();
    } catch (error) {
      alert("Failed to add bulk inventory");
    }
  };

  const resetForm = () => {
    setFormData({
      code: "",
      name: "",
      oem_part_no: "",
      oem_name: "",
      description: "",
      category: "RAW_MATERIAL",
      product_category: "",
      uom: "PCS",
      product_size: "",
      product_size_uom: "MM",
      hsn_code: "",
      standard_cost: "",
      selling_price: "",
      purchase_currency: "INR",
      foreign_unit_price: "",
      reorder_level: "",
      reorder_quantity: "",
      lead_time_days: "",
      is_active: true,
      uid_tracking: true,
      uid_strategy: "SERIALIZED",
      batch_uom: "",
      batch_quantity: "",
      sales_uom: "",
      sales_uom_factor: "",
      sales_whole_uom_only: true,
      drawing_required: "OPTIONAL",
      parent_item_id: "",
      is_variant: false,
      is_default_variant: false,
      variant_name: "",
      drawing_url: "",
      drawing_file_name: "",
    });
    setDrawingFile(null);
    setDrawingAttachmentMessage(null);
    if (drawingFileInputRef.current) drawingFileInputRef.current.value = "";
    setItemVendors([]);
    setShowVendorForm(false);
  };

  useEffect(() => {
    if (!showForm || editingItem) return;
    if (formData.code) return;
    refreshGeneratedItemCode(formData.category);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showForm, editingItem, formData.code, formData.category]);

  const filteredItems = items.filter((item) => {
    const matchesType =
      !typeFilter || normalizeItemCategory(item.category) === typeFilter;
    // When showDeleted is true, show only inactive items. When false, show only active items.
    const matchesActiveStatus = showDeleted ? !item.is_active : item.is_active;
    return matchesType && matchesActiveStatus;
  });
  const activeItemCount = items.filter((item) => item.is_active).length;
  const inactiveItemCount = items.filter((item) => !item.is_active).length;
  const verifiedItemCount = items.filter(
    (item) => item.is_active && item.is_verified,
  ).length;
  const uidTrackedItemCount = items.filter(
    (item) => item.is_active && item.uid_tracking,
  ).length;

  // Sorting
  const sortedItems = [...filteredItems].sort((a, b) => {
    let aVal: any = a[sortColumn as keyof Item];
    let bVal: any = b[sortColumn as keyof Item];

    // Handle null/undefined values
    if (aVal === null || aVal === undefined) aVal = "";
    if (bVal === null || bVal === undefined) bVal = "";

    // Convert to string for comparison if needed
    if (typeof aVal === "string") aVal = aVal.toLowerCase();
    if (typeof bVal === "string") bVal = bVal.toLowerCase();

    if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
    if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
    return 0;
  });

  // Pagination
  const totalItems = sortedItems.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedItems = sortedItems.slice(startIndex, endIndex);

  useEffect(() => {
    if (loading || paginatedItems.length === 0) return;

    const key = [
      itemScope,
      showDeleted ? "inactive" : "active",
      currentPage,
      itemsPerPage,
      paginatedItems
        .map((item) =>
          [
            item.id,
            item.total_stock ?? "",
            item.current_stock ?? "",
            item.available_quantity ?? "",
          ].join(":"),
        )
        .join(","),
    ].join("|");

    if (stockHydrationKeyRef.current === key) return;
    stockHydrationKeyRef.current = key;

    let cancelled = false;
    void Promise.all(
      paginatedItems.map(async (item) => {
        try {
          const data = await apiClient.get<any>(
            `/items/${item.id}/stock-trail`,
          );
          if (
            cancelled ||
            data?.currentBalance === undefined ||
            data?.currentBalance === null
          )
            return;

          const ledgerStock = Number(data.currentBalance) || 0;
          const displayedStock =
            Number(
              item.total_stock ??
                item.current_stock ??
                item.available_quantity ??
                0,
            ) || 0;
          if (Math.abs(displayedStock - ledgerStock) > 1e-9) {
            applyLedgerStockToItem(item.id, ledgerStock);
          }
        } catch {
          // Keep the list usable if a stock-trail lookup fails for one row.
        }
      }),
    );

    return () => {
      cancelled = true;
    };
  }, [
    currentPage,
    itemScope,
    itemsPerPage,
    loading,
    paginatedItems,
    showDeleted,
  ]);

  // Autocomplete suggestions (top 10 matches)
  const autocompleteSuggestions =
    searchTerm.length >= 2
      ? items
          .filter(
            (item) =>
              smartSearchMatches(
                searchTerm,
                item.code,
                item.name,
                item.description,
                item.oem_part_no,
                item.oem_name,
              ) && (showDeleted ? !item.is_active : item.is_active),
          )
          .slice(0, 10)
      : [];

  // Handle sort column click
  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const toggleColumn = (key: ItemsTableColumnKey) => {
    setVisibleColumns((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const resetColumns = () => {
    setVisibleColumns(
      ITEMS_TABLE_COLUMNS.reduce(
        (acc, col) => {
          acc[col.key] = true;
          return acc;
        },
        {} as Record<ItemsTableColumnKey, boolean>,
      ),
    );
  };

  const visibleColumnsCount = ITEMS_TABLE_COLUMNS.reduce(
    (count, col) => count + (visibleColumns[col.key] ? 1 : 0),
    0,
  );
  const itemsTableWidth = Math.max(1180, visibleColumnsCount * 150 + 280);

  const syncTableScroll = (source: "top" | "table") => {
    const topScroll = topTableScrollRef.current;
    const tableScroll = tableScrollRef.current;
    if (!topScroll || !tableScroll) return;
    if (source === "top") {
      tableScroll.scrollLeft = topScroll.scrollLeft;
    } else {
      topScroll.scrollLeft = tableScroll.scrollLeft;
    }
  };

  // Handle pagination
  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, typeFilter, showDeleted]);

  const normalizedItemUom = String(formData.uom || "")
    .trim()
    .toUpperCase();
  const isVolumeUom =
    normalizedItemUom === "LITER" ||
    normalizedItemUom === "L" ||
    normalizedItemUom === "LTR" ||
    normalizedItemUom === "ML";

  useEffect(() => {
    if (formData.uid_strategy !== "BATCHED") return;
    if (!formData.batch_uom) return;

    const allowedContainerTypes = isVolumeUom
      ? ["Drum", "Bucket", "Can", "IBC", "Bottle", "Container"]
      : ["Box", "Carton", "Pallet", "Bag", "Roll", "Container"];

    if (!allowedContainerTypes.includes(formData.batch_uom)) {
      setFormData((prev) => ({ ...prev, batch_uom: "", batch_quantity: "" }));
    }
  }, [formData.uid_strategy, formData.batch_uom, isVolumeUom]);

  const itemsTableColumns: Array<ListTableColumn<Item>> = [
    {
      id: "code",
      label: "SAS Part Number",
      accessor: (item) => item.code,
      cell: (item) => (
        <span
          className="block truncate font-medium text-gray-900"
          title={item.code}
        >
          {item.code}
        </span>
      ),
      minWidth: 160,
    },
    {
      id: "name",
      label: "Name",
      accessor: (item) => item.name,
      searchAccessor: (item) =>
        `${item.name || ""} ${item.description || ""} ${item.oem_part_no || ""} ${item.oem_name || ""}`.trim(),
      cell: (item) => (
        <span className="block truncate text-gray-900" title={item.name}>
          {item.name}
        </span>
      ),
      minWidth: 220,
    },
    {
      id: "oem_part_no",
      label: "OEM Part No.",
      accessor: (item) => item.oem_part_no || "-",
      cell: (item) => (
        <span
          className="block truncate text-gray-600"
          title={item.oem_part_no || "-"}
        >
          {item.oem_part_no || "-"}
        </span>
      ),
      minWidth: 160,
    },
    {
      id: "category",
      label: "Category",
      accessor: (item) => formatItemCategory(item.category),
      cell: (item) => (
        <span
          className="block truncate text-gray-600"
          title={formatItemCategory(item.category)}
        >
          {item.category ? formatItemCategory(item.category) : "N/A"}
        </span>
      ),
      minWidth: 170,
    },
    {
      id: "uom",
      label: "UOM",
      accessor: (item) => item.uom || "",
      minWidth: 110,
    },
    {
      id: "hsn_code",
      label: "HSN",
      accessor: (item) => item.hsn_code || "-",
      minWidth: 130,
    },
    {
      id: "uid_tracking",
      label: "UID",
      accessor: (item) => (item.uid_tracking !== false ? "YES" : "NO"),
      cell: (item) => (
        <span
          className={`inline-flex px-2 py-1 text-xs rounded-full ${item.uid_tracking !== false ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}
        >
          {item.uid_tracking !== false ? "YES" : "NO"}
        </span>
      ),
      align: "center",
      minWidth: 110,
    },
    {
      id: "drawing_required",
      label: "Drawing",
      accessor: (item) => item.drawing_required || "OPTIONAL",
      cell: (item) => {
        const drawingRequired = item.drawing_required || "OPTIONAL";
        return (
          <span
            className={`inline-flex max-w-[120px] truncate px-2 py-1 text-xs rounded-full ${drawingRequired === "COMPULSORY" ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-800"}`}
            title={drawingRequired}
          >
            {drawingRequired}
          </span>
        );
      },
      align: "center",
      minWidth: 140,
    },
    {
      id: "total_stock",
      label: "Stock",
      accessor: (item) => item.total_stock ?? 0,
      align: "right",
      cell: (item) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void openStockTrail(item);
          }}
          title="Click to view stock trail"
          className={`font-semibold underline decoration-dotted cursor-pointer hover:opacity-70 ${item.total_stock && item.total_stock > 0 ? "text-green-700" : "text-gray-400"}`}
        >
          {item.total_stock ?? 0}
        </button>
      ),
      minWidth: 120,
    },
    {
      id: "standard_cost",
      label: "Cost",
      accessor: (item) => item.standard_cost || 0,
      align: "right",
      cell: (item) => (
        <span className="whitespace-nowrap text-gray-600">
          {item.standard_cost ? `₹${item.standard_cost.toFixed(2)}` : "-"}
        </span>
      ),
      minWidth: 140,
    },
    {
      id: "is_active",
      label: "Status",
      accessor: (item) => (item.is_active ? "Active" : "Inactive"),
      cell: (item) => (
        <span
          className={`inline-flex px-2 py-1 text-xs rounded-full ${item.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}
        >
          {item.is_active ? "Active" : "Inactive"}
        </span>
      ),
      align: "center",
      minWidth: 120,
    },
    {
      id: "verification",
      label: "Verification",
      accessor: (item) => (item.is_verified ? "Verified" : "Pending"),
      cell: (item) => (
        <span
          className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full ${item.is_verified ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}
        >
          {item.is_verified ? (
            <CheckCircle className="h-3 w-3" />
          ) : (
            <XCircle className="h-3 w-3" />
          )}
          {item.is_verified ? "Verified" : "Pending"}
        </span>
      ),
      align: "center",
      minWidth: 140,
    },
    {
      id: "updated_at",
      label: "Date Modified",
      accessor: (item) => item.updated_at || item.created_at || "",
      sortAccessor: (item) =>
        item.updated_at
          ? new Date(item.updated_at).getTime()
          : item.created_at
            ? new Date(item.created_at).getTime()
            : 0,
      cell: (item) => {
        const d = item.updated_at || item.created_at;
        if (!d) return <span className="text-xs text-gray-400">—</span>;
        const dt = new Date(d);
        return (
          <span className="text-xs text-gray-700 whitespace-nowrap">
            {dt.toLocaleDateString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
            <span className="block text-gray-400">
              {dt.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </span>
        );
      },
      defaultVisible: false,
      minWidth: 140,
    },
    {
      id: "updated_by",
      label: "Modified By",
      accessor: (item) => (item as any).updated_by || "",
      cell: (item) => {
        const user = (item as any).updated_by;
        if (!user) return <span className="text-xs text-gray-400">—</span>;
        return (
          <span className="text-xs text-gray-700 truncate block" title={user}>
            {user}
          </span>
        );
      },
      defaultVisible: false,
      minWidth: 130,
    },
    {
      id: "actions",
      label: "Actions",
      sortable: false,
      hideable: false,
      align: "right",
      minWidth: 224,
      cell: (item) => (
        <div className="flex items-center justify-end gap-1 whitespace-nowrap text-xs font-medium">
          <button
            type="button"
            onClick={() => void openItemDetail(item)}
            title="Open item"
            aria-label="Open item"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#D8C8AA] bg-white text-[#5E4635] hover:bg-[#F5EFE3]"
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void openStockTrail(item)}
            title="View stock trail"
            aria-label="View stock trail"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
          >
            <Route className="h-3.5 w-3.5" />
          </button>
          {canCreate && (
            <button
              type="button"
              onClick={() => void handleCloneItem(item)}
              title="Clone item master"
              aria-label="Clone item master"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          )}
          {item.is_active ? (
            <>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => handleEdit(item)}
                  title="Edit item"
                  aria-label="Edit item"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#D8C8AA] bg-white text-[#5E4635] hover:bg-[#F5EFE3]"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
              {canVerify && (
                <button
                  type="button"
                  onClick={() => handleVerification(item, !item.is_verified)}
                  title={
                    item.is_verified ? "Remove verification" : "Verify item"
                  }
                  aria-label={
                    item.is_verified ? "Remove verification" : "Verify item"
                  }
                  disabled={
                    !item.is_verified &&
                    Boolean(
                      item.created_by &&
                      currentUserId &&
                      String(item.created_by) === currentUserId,
                    )
                  }
                  className={
                    item.is_verified
                      ? "inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                      : "inline-flex h-8 w-8 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:opacity-40"
                  }
                >
                  {item.is_verified ? (
                    <BadgeX className="h-3.5 w-3.5" />
                  ) : (
                    <BadgeCheck className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
              {!item.is_variant && (
                <button
                  type="button"
                  onClick={() => openVariantManager(item)}
                  title="Manage variants and brands"
                  aria-label="Manage variants and brands"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#D8C8AA] bg-white text-[#5E4635] hover:bg-[#F5EFE3]"
                >
                  <Layers className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setSelectedItemForDrawing(item);
                  setShowDrawingManager(true);
                }}
                title="Manage drawings"
                aria-label="Manage drawings"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#D8C8AA] bg-white text-[#5E4635] hover:bg-[#F5EFE3]"
              >
                <FileText className="h-3.5 w-3.5" />
              </button>
              {canDelete && (
                <button
                  type="button"
                  onClick={() => handleDelete(item.id)}
                  title="Delete item"
                  aria-label="Delete item"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={() => handleRestore(item.id)}
              title="Restore item"
              aria-label="Restore item"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
            >
              <Archive className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAF9F6] text-[#4A3426]">
        <div className="rounded-md border border-[#E8DCC4] bg-white px-6 py-4 text-sm font-semibold shadow-sm">
          Loading stock master...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-[#2F241D]">
      <div className="flex min-h-screen w-full max-w-none flex-col">
        <section className="border-b border-[#E8DCC4] bg-white px-6 py-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-wide text-[#8B6F47]">
                Inventory Master Data
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold leading-tight text-[#4A3426]">
                  Stock Master
                </h1>
                <span className="rounded-full border border-[#E8DCC4] bg-[#FFFCF5] px-2.5 py-0.5 text-[11px] font-semibold uppercase text-[#7A6555]">
                  {showDeleted ? "Inactive" : "Active"}
                </span>
              </div>
              <p className="mt-0.5 max-w-5xl text-sm text-[#7A6555]">
                Material master, SAS part numbers, UOM, HSN, UID control,
                drawings, vendors, variants, stock trail, and verification.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-start gap-2 xl:justify-end">
              <details className="relative">
                <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border border-[#D8C8AA] bg-white px-3 text-sm font-semibold text-[#5E4635] hover:bg-[#F5EFE3]">
                  Master data tools
                </summary>
                <div className="absolute right-0 z-20 mt-1 flex w-48 flex-col gap-1 rounded-md border border-[#D8C8AA] bg-white p-2 shadow-lg">
              {canExport && (
                <button
                  onClick={() => {
                    exportToExcel(
                      items,
                      [
                        { header: "SAS Part Number", key: "code" },
                        { header: "Name", key: "name" },
                        { header: "Description", key: "description" },
                        { header: "Category", key: "category" },
                        { header: "UOM", key: "uom" },
                        { header: "HSN Code", key: "hsn_code" },
                        { header: "Standard Cost", key: "standard_cost" },
                        { header: "Selling Price", key: "selling_price" },
                        { header: "Reorder Level", key: "reorder_level" },
                        { header: "Reorder Qty", key: "reorder_quantity" },
                        { header: "Lead Time (Days)", key: "lead_time_days" },
                        { header: "Total Stock", key: "total_stock" },
                        { header: "UID Tracking", key: "uid_tracking" },
                        { header: "UID Strategy", key: "uid_strategy" },
                        { header: "Active", key: "is_active" },
                        { header: "Verified", key: "is_verified" },
                        { header: "OEM Part No", key: "oem_part_no" },
                        { header: "OEM Name", key: "oem_name" },
                        { header: "Date Modified", key: "updated_at" },
                        { header: "Modified By", key: "updated_by" },
                        { header: "Created At", key: "created_at" },
                      ],
                      `Items_${new Date().toISOString().slice(0, 10)}.csv`,
                    );
                  }}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-[#D8C8AA] bg-white px-3 text-sm font-semibold text-[#5E4635] hover:bg-[#F5EFE3]"
                >
                  <Download className="h-4 w-4" />
                  Export
                </button>
              )}
              <button
                onClick={() => setShowCategoryManager(true)}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-[#D8C8AA] bg-white px-3 text-sm font-semibold text-[#5E4635] hover:bg-[#F5EFE3]"
              >
                <Tags className="h-4 w-4" />
                Categories
              </button>
              <button
                onClick={initBulkInventory}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-[#D8C8AA] bg-white px-3 text-sm font-semibold text-[#5E4635] hover:bg-[#F5EFE3]"
              >
                <Boxes className="h-4 w-4" />
                Bulk Stock
              </button>
              {canCreate && (
                <>
                  <button
                    onClick={downloadItemTemplate}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-[#D8C8AA] bg-white px-3 text-sm font-semibold text-[#5E4635] hover:bg-[#F5EFE3]"
                  >
                    <Download className="h-4 w-4" />
                    Template
                  </button>
                  <button
                    onClick={() => {
                      setShowImportModal(true);
                      setImportPreview([]);
                      setImportResult(null);
                      setImportFile(null);
                    }}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-[#D8C8AA] bg-white px-3 text-sm font-semibold text-[#5E4635] hover:bg-[#F5EFE3]"
                  >
                    <Upload className="h-4 w-4" />
                    Import
                  </button>
                </>
              )}
                </div>
              </details>
              {canCreate && (
                <button
                  onClick={() => {
                    setEditingItem(null);
                    resetForm();
                    setShowForm(true);
                  }}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-[#8B6F47] bg-[#8B6F47] px-4 text-sm font-bold text-white hover:bg-[#6F4E37]"
                >
                  <PackagePlus className="h-4 w-4" />
                  New Item
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="border-b border-[#E8DCC4] bg-[#FFFCF5] px-6">
          <div className="grid divide-y divide-[#E8DCC4] md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-5">
            <div className="py-3 pr-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-[#7A6555]">
                Active Materials
              </div>
              <div className="mt-1 text-2xl font-bold text-[#4A3426]">
                {activeItemCount}
              </div>
            </div>
            <div className="px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-[#7A6555]">
                Verified
              </div>
              <div className="mt-1 text-2xl font-bold text-emerald-700">
                {verifiedItemCount}
              </div>
            </div>
            <div className="px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-[#7A6555]">
                Pending Verification
              </div>
              <div className="mt-1 text-2xl font-bold text-amber-700">
                {Math.max(activeItemCount - verifiedItemCount, 0)}
              </div>
            </div>
            <div className="px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-[#7A6555]">
                UID Controlled
              </div>
              <div className="mt-1 text-2xl font-bold text-[#4A3426]">
                {uidTrackedItemCount}
              </div>
            </div>
            <div className="py-3 pl-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-[#7A6555]">
                Inactive
              </div>
              <div className="mt-1 text-2xl font-bold text-red-700">
                {inactiveItemCount}
              </div>
            </div>
          </div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col bg-white px-6 py-4">
          <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-xl font-bold text-[#4A3426]">
                {showDeleted ? "Inactive Item Register" : "Item Register"}
              </h2>
              <p className="mt-1 text-sm text-[#7A6555]">
                {filteredItems.length} records shown. Freeze columns, saved
                views, CSV export, and stock trail are available from the grid.
              </p>
            </div>
            <div className="inline-flex w-fit rounded-md border border-[#D8C8AA] bg-white p-1">
              <button
                type="button"
                onClick={() => setShowDeleted(false)}
                className={`rounded px-3 py-1.5 text-sm font-semibold ${!showDeleted ? "bg-[#8B6F47] text-white" : "text-[#5E4635] hover:bg-[#F5EFE3]"}`}
              >
                Active
              </button>
              <button
                type="button"
                onClick={() => setShowDeleted(true)}
                className={`rounded px-3 py-1.5 text-sm font-semibold ${showDeleted ? "bg-[#8B6F47] text-white" : "text-[#5E4635] hover:bg-[#F5EFE3]"}`}
              >
                Inactive
              </button>
            </div>
          </div>

          <ListTable
            storageKey="stockMasterTable:poStyle:v1"
            rows={filteredItems}
            columns={itemsTableColumns}
            getRowId={(item) => item.id}
            defaultPageSize={10}
            pageSizeOptions={[10, 25, 50, 100]}
            searchPlaceholder="Search by code, name, description, OEM name/part no., HSN, category…"
            exportFilename={`stock-master-${new Date().toISOString().slice(0, 10)}`}
            toolbarLayout="singleLine"
            variantContext={{
              category: typeFilter,
              status: showDeleted ? "inactive" : "active",
            }}
            onApplyVariantContext={(context) => {
              setTypeFilter(context.category || "");
              setShowDeleted(context.status === "inactive");
            }}
            toolbarRight={
              <div className="flex min-w-0 items-center gap-2">
                <select
                  value={itemScope}
                  onChange={(e) => {
                    setItemScope(e.target.value === "RND" ? "RND" : "REGULAR");
                    setCurrentPage(1);
                  }}
                  className="min-h-9 w-44 rounded-md border border-[#D8C8AA] bg-white px-3 py-1.5 text-sm focus:border-[#8B6F47] focus:ring-2 focus:ring-[#8B6F47]/30"
                >
                  <option value="REGULAR">Regular items</option>
                  <option value="RND">R&D items</option>
                </select>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="min-h-9 w-52 rounded-md border border-[#D8C8AA] bg-white px-3 py-1.5 text-sm focus:border-[#8B6F47] focus:ring-2 focus:ring-[#8B6F47]/30"
                >
                  <option value="">All categories</option>
                  {ITEM_CATEGORY_OPTIONS.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>
            }
            emptyState={
              <div className="p-12 text-center">
                <div className="mb-2 text-lg font-semibold text-[#4A3426]">
                  No items found
                </div>
                <p className="text-sm text-[#7A6555]">
                  Create your first item or adjust the category/status filter.
                </p>
              </div>
            }
          />
        </section>
      </div>

      {/* Create/Edit Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-[#FAF9F6] text-[#2F241D]">
          <div className="flex h-screen flex-col">
            <div className="sticky top-0 z-20 border-b border-[#E8DCC4] bg-white px-6 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                    Material Master
                  </div>
                  <h2 className="mt-1 text-2xl font-bold text-[#4A3426]">
                    {editingItem ? "Edit Item" : "Create New Item"}
                  </h2>
                  {editingItem && (
                    <div className="mt-1 text-sm font-medium text-[#7A6555]">
                      {editingItem.code}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setEditingItem(null);
                    resetForm();
                  }}
                  className="inline-flex items-center justify-center rounded-md border border-[#D8C8AA] bg-white px-4 py-2 text-sm font-semibold text-[#5E4635] hover:bg-[#F5EFE3]"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Category / Item Number Generator */}
                {!editingItem && (
                  <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-amber-900">
                          New Item Number Generation
                        </h3>
                        <p className="text-xs text-amber-800">
                          Category prefix + four digit running number, e.g.
                          200-0001.
                        </p>
                      </div>
                      <div className="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-900">
                        Prefix{" "}
                        {ITEM_CODE_PREFIX_BY_CATEGORY[
                          normalizeItemCategory(formData.category)
                        ] || "100"}
                        -
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">
                          Category *
                        </label>
                        <select
                          value={formData.category}
                          onChange={(e) => {
                            const nextCategory = normalizeItemCategory(
                              e.target.value,
                            );
                            setFormData((prev) => ({
                              ...prev,
                              category: nextCategory,
                              code: "",
                            }));
                            refreshGeneratedItemCode(nextCategory);
                          }}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500"
                        >
                          {ITEM_CATEGORY_OPTIONS.map((cat) => (
                            <option key={cat.value} value={cat.value}>
                              {cat.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">
                          Generated Item No.
                        </label>
                        <input
                          type="text"
                          required
                          value={formData.code}
                          readOnly
                          className="w-full rounded-lg border-2 border-amber-400 bg-white px-3 py-2 font-mono text-sm font-semibold text-amber-900"
                          placeholder={
                            codeGenerating
                              ? "Generating..."
                              : "Auto-generated on save"
                          }
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">
                          OEM Part No.
                        </label>
                        <input
                          type="text"
                          value={formData.oem_part_no}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              oem_part_no: e.target.value,
                            }))
                          }
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500"
                          placeholder="e.g., 0003455"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">
                          OEM Name
                        </label>
                        <input
                          type="text"
                          value={(formData as any).oem_name || ""}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              oem_name: e.target.value,
                            } as any)
                          }
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500"
                          placeholder="e.g., Bosch, Siemens"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs text-amber-900 md:grid-cols-6">
                      <span>Raw: 100-</span>
                      <span>Sub: 200-</span>
                      <span>Service: 300-</span>
                      <span>Capital: 400-</span>
                      <span>Consumable: 500-</span>
                      <span>FG: 700-</span>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  {editingItem && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        SAS Part Number *
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.code}
                        onChange={(e) =>
                          setFormData({ ...formData, code: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Item Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                      placeholder="e.g., Steel Sheet"
                    />
                  </div>

                  {editingItem && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          OEM Part No.
                        </label>
                        <input
                          type="text"
                          value={formData.oem_part_no}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              oem_part_no: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                          placeholder="e.g., Robu-866205"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          OEM Name
                        </label>
                        <input
                          type="text"
                          value={(formData as any).oem_name || ""}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              oem_name: e.target.value,
                            } as any)
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                          placeholder="e.g., Bosch, Siemens"
                        />
                      </div>
                    </>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                    placeholder="Optional description"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {editingItem && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Category *
                      </label>
                      <select
                        required
                        value={formData.category}
                        onChange={(e) => {
                          const nextCategory = normalizeItemCategory(
                            e.target.value,
                          );
                          setFormData({
                            ...formData,
                            category: nextCategory,
                            code: editingItem ? formData.code : "",
                          });
                          if (!editingItem)
                            refreshGeneratedItemCode(nextCategory);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                      >
                        {ITEM_CATEGORY_OPTIONS.map((cat) => (
                          <option key={cat.value} value={cat.value}>
                            {cat.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Unit of Measure *
                    </label>
                    <select
                      required
                      value={formData.uom}
                      onChange={(e) =>
                        setFormData({ ...formData, uom: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                    >
                      {uomOptions.map((uom) => (
                        <option key={uom} value={uom}>
                          {uom}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-2 rounded-lg border border-amber-200 bg-amber-50/60 p-4">
                    <div className="mb-3">
                      <div className="text-sm font-semibold text-gray-900">
                        Sales & packing unit
                      </div>
                      <p className="mt-1 text-xs text-gray-600">
                        Optional. Let users quote and invoice cartons while
                        inventory remains in {formData.uom}.
                      </p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">
                          Alternate sales UOM
                        </label>
                        <select
                          value={formData.sales_uom}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              sales_uom: e.target.value,
                              sales_uom_factor: e.target.value
                                ? formData.sales_uom_factor
                                : "",
                            })
                          }
                          className="w-full rounded-lg border border-gray-300 px-3 py-2"
                        >
                          <option value="">Not used</option>
                          {["CTN", "BOX", "PKT", "BAG", "PALLET"]
                            .filter((uom) => uom !== formData.uom)
                            .map((uom) => (
                              <option key={uom} value={uom}>
                                {uom}
                              </option>
                            ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">
                          {formData.sales_uom
                            ? `${formData.uom} in 1 ${formData.sales_uom}`
                            : "Base units per pack"}
                        </label>
                        <input
                          type="number"
                          min="0.000001"
                          step="0.000001"
                          required={Boolean(formData.sales_uom)}
                          disabled={!formData.sales_uom}
                          value={formData.sales_uom_factor}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              sales_uom_factor: e.target.value,
                            })
                          }
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100"
                          placeholder="e.g. 1000"
                        />
                      </div>
                      <label className="flex items-center gap-2 self-end rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          disabled={!formData.sales_uom}
                          checked={formData.sales_whole_uom_only}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              sales_whole_uom_only: e.target.checked,
                            })
                          }
                        />
                        Sell full packs only
                      </label>
                    </div>
                    {formData.sales_uom && formData.sales_uom_factor && (
                      <p className="mt-3 text-sm font-medium text-amber-900">
                        1 {formData.sales_uom} = {formData.sales_uom_factor}{" "}
                        {formData.uom}. Rates entered against {formData.sales_uom}{" "}
                        are per {formData.sales_uom}.
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Product size
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={formData.product_size}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            product_size: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        placeholder="e.g. 30"
                      />
                      <select
                        value={formData.product_size_uom}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            product_size_uom: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      >
                        <option value="MM">MM</option>
                        <option value="CM">CM</option>
                        <option value="MTR">MTR</option>
                        <option value="INCH">INCH</option>
                      </select>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      Optional physical size. Stock/production quantity remains
                      in {formData.uom}.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      HSN Code *
                    </label>
                    <input
                      type="text"
                      required
                      inputMode="numeric"
                      maxLength={8}
                      pattern="^([0-9]{4}|[0-9]{6}|[0-9]{8})$"
                      value={formData.hsn_code}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          hsn_code: e.target.value.replace(/[^0-9]/g, ""),
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                      placeholder="e.g., 8542"
                      title="HSN must be 4, 6, or 8 digits"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Standard Cost (₹)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.standard_cost}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          standard_cost: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Purchase Currency
                    </label>
                    <select
                      value={formData.purchase_currency}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          purchase_currency: e.target.value,
                          foreign_unit_price: "",
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                    >
                      {["INR", "USD", "EUR", "CNY", "GBP", "AED", "JPY"].map(
                        (c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ),
                      )}
                    </select>
                  </div>

                  {formData.purchase_currency &&
                    formData.purchase_currency !== "INR" && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Unit Price ({formData.purchase_currency})
                        </label>
                        <input
                          type="number"
                          step="0.0001"
                          value={formData.foreign_unit_price}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              foreign_unit_price: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                          placeholder="0.00"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Exchange rate applied at GRN time
                        </p>
                      </div>
                    )}
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Reorder Level
                    </label>
                    <input
                      type="number"
                      value={formData.reorder_level}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          reorder_level: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                      placeholder="0"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Reorder Qty
                    </label>
                    <input
                      type="number"
                      value={formData.reorder_quantity}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          reorder_quantity: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                      placeholder="0"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Lead Time (days)
                    </label>
                    <input
                      type="number"
                      value={formData.lead_time_days}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          lead_time_days: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                      placeholder="0"
                    />
                  </div>
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="is_active"
                    checked={formData.is_active}
                    onChange={(e) =>
                      setFormData({ ...formData, is_active: e.target.checked })
                    }
                    className="h-4 w-4 text-amber-600 focus:ring-amber-500 border-gray-300 rounded"
                  />
                  <label
                    htmlFor="is_active"
                    className="ml-2 block text-sm text-gray-700"
                  >
                    Active
                  </label>
                </div>

                {/* Variant/Brand Configuration Section */}
                <div className="border-t pt-4 mt-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">
                    🏷️ Variant Configuration
                  </h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Create variants for items where you need to track different
                    brands, types, or specifications. Example: Create a parent
                    item &quot;BATTERY&quot; and variants like &quot;Exide
                    Lithium&quot;, &quot;AC Delco Alkaline&quot;, etc.
                  </p>

                  <div className="flex items-start space-x-2 mb-4">
                    <input
                      type="checkbox"
                      id="is_variant"
                      checked={formData.is_variant}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          is_variant: e.target.checked,
                        })
                      }
                      className="h-4 w-4 text-amber-600 focus:ring-amber-500 border-gray-300 rounded mt-1"
                    />
                    <div>
                      <label
                        htmlFor="is_variant"
                        className="block text-sm font-medium text-gray-700"
                      >
                        This is a variant/sub-product
                      </label>
                      <p className="text-xs text-gray-500">
                        Check this if creating a specific brand/type of a
                        generic item
                      </p>
                    </div>
                  </div>

                  {formData.is_variant && (
                    <div className="bg-yellow-50 p-4 rounded-lg space-y-4 border border-yellow-200">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Parent Item *
                        </label>
                        <select
                          required={formData.is_variant}
                          value={formData.parent_item_id}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              parent_item_id: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                        >
                          <option value="">Select parent item...</option>
                          {items
                            .filter(
                              (i) => !i.is_variant && i.id !== editingItem?.id,
                            )
                            .map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.code} - {item.name}
                              </option>
                            ))}
                        </select>
                        <p className="text-xs text-gray-500 mt-1">
                          Select the generic item this is a variant of (e.g.,
                          select &quot;BATTERY&quot; for &quot;Exide Lithium
                          Battery&quot;)
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Variant/Brand Name *
                        </label>
                        <input
                          type="text"
                          required={formData.is_variant}
                          value={formData.variant_name}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              variant_name: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                          placeholder="e.g., Exide Lithium 12V, AC Delco Alkaline"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Descriptive name for this specific variant/brand
                        </p>
                      </div>

                      <div className="flex items-start space-x-2">
                        <input
                          type="checkbox"
                          id="is_default_variant"
                          checked={formData.is_default_variant}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              is_default_variant: e.target.checked,
                            })
                          }
                          className="h-4 w-4 text-amber-600 focus:ring-amber-500 border-gray-300 rounded mt-1"
                        />
                        <div>
                          <label
                            htmlFor="is_default_variant"
                            className="block text-sm font-medium text-gray-700"
                          >
                            ⭐ Set as default variant
                          </label>
                          <p className="text-xs text-gray-500">
                            Default variants are automatically selected in job
                            orders (you can change only one variant to default)
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* UID Tracking Strategy Section */}
                <div className="border-t pt-4 mt-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">
                    UID Tracking
                  </h3>

                  <div className="flex items-start space-x-2 mb-4">
                    <input
                      type="checkbox"
                      id="uid_tracking"
                      checked={formData.uid_tracking}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          uid_tracking: e.target.checked,
                        })
                      }
                      className="h-4 w-4 text-amber-600 focus:ring-amber-500 border-gray-300 rounded mt-1"
                    />
                    <div>
                      <label
                        htmlFor="uid_tracking"
                        className="block text-sm font-medium text-gray-700"
                      >
                        Track with UIDs
                      </label>
                      <p className="text-xs text-gray-500">
                        Enable unique identifier tracking for this item
                      </p>
                    </div>
                  </div>

                  {formData.uid_tracking && (
                    <div className="bg-gray-50 p-4 rounded-lg space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          How to track?
                        </label>
                        <div className="space-y-2">
                          <div className="flex items-start">
                            <input
                              type="radio"
                              id="uid_serialized"
                              name="uid_strategy"
                              value="SERIALIZED"
                              checked={formData.uid_strategy === "SERIALIZED"}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  uid_strategy: e.target.value,
                                  batch_uom: "",
                                  batch_quantity: "",
                                })
                              }
                              className="h-4 w-4 text-amber-600 focus:ring-amber-500 border-gray-300 mt-1"
                            />
                            <div className="ml-2">
                              <label
                                htmlFor="uid_serialized"
                                className="text-sm font-medium text-gray-700"
                              >
                                Track Each Piece Individually
                              </label>
                              <p className="text-xs text-gray-500">
                                For: Parts, Components, Assemblies, Finished
                                Goods
                              </p>
                            </div>
                          </div>

                          <div className="flex items-start">
                            <input
                              type="radio"
                              id="uid_batched"
                              name="uid_strategy"
                              value="BATCHED"
                              checked={formData.uid_strategy === "BATCHED"}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  uid_strategy: e.target.value,
                                })
                              }
                              className="h-4 w-4 text-amber-600 focus:ring-amber-500 border-gray-300 mt-1"
                            />
                            <div className="ml-2">
                              <label
                                htmlFor="uid_batched"
                                className="text-sm font-medium text-gray-700"
                              >
                                Track by Container/Box
                              </label>
                              <p className="text-xs text-gray-500">
                                For: Screws, Washers, Nuts, Bolts, Consumables
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {formData.uid_strategy === "BATCHED" && (
                        <div className="border-t pt-4 space-y-3">
                          <p className="text-sm font-medium text-gray-700">
                            Container Details:
                          </p>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">
                                Container Type *
                              </label>
                              <select
                                required
                                value={formData.batch_uom}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    batch_uom: e.target.value,
                                  })
                                }
                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                              >
                                <option value="">Select Type</option>
                                {isVolumeUom ? (
                                  <>
                                    <option value="Drum">Drum</option>
                                    <option value="Bucket">Bucket</option>
                                    <option value="Can">Can</option>
                                    <option value="Bottle">Bottle</option>
                                    <option value="IBC">IBC</option>
                                    <option value="Container">Container</option>
                                  </>
                                ) : (
                                  <>
                                    <option value="Box">Box</option>
                                    <option value="Carton">Carton</option>
                                    <option value="Pallet">Pallet</option>
                                    <option value="Bag">Bag</option>
                                    <option value="Roll">Roll</option>
                                    <option value="Container">Container</option>
                                  </>
                                )}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">
                                Qty per {formData.batch_uom || "Container"} (
                                {formData.uom || "UOM"}) *
                              </label>
                              <input
                                type="number"
                                required
                                step="any"
                                min="0.000001"
                                value={formData.batch_quantity}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    batch_quantity: e.target.value,
                                  })
                                }
                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                                placeholder={
                                  isVolumeUom
                                    ? "e.g. 200 (per drum/bucket)"
                                    : "e.g. 1000"
                                }
                              />
                            </div>
                          </div>
                          <div className="bg-blue-50 p-2 rounded text-xs text-blue-800">
                            💡 You will still purchase/receive in{" "}
                            {formData.uom || "UOM"}. This setting is only for
                            UID generation.
                            <br />
                            Example: If you receive 250 {formData.uom ||
                              "UOM"}{" "}
                            and 1 {formData.batch_uom || "container"} holds 200{" "}
                            {formData.uom || "UOM"}, system will generate 2 UIDs
                            (one per container).
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Drawing Required Section */}
                <div className="border-t pt-4 mt-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">
                    📐 Drawing & Documentation
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Drawing Required
                      </label>
                      <select
                        value={formData.drawing_required}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            drawing_required: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                      >
                        <option value="OPTIONAL">Optional</option>
                        <option value="COMPULSORY">Compulsory</option>
                        <option value="NOT_REQUIRED">Not Required</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Upload Drawing/Spec
                      </label>
                      <input
                        ref={drawingFileInputRef}
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf"
                        onChange={handleDrawingFileSelect}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
                      />
                      {drawingAttachmentMessage && (
                        <div
                          className={`mt-2 rounded-md border px-3 py-2 text-sm ${
                            drawingAttachmentMessage.type === "warning"
                              ? "border-amber-200 bg-amber-50 text-amber-800"
                              : drawingAttachmentMessage.type === "success"
                                ? "border-green-200 bg-green-50 text-green-800"
                                : "border-blue-200 bg-blue-50 text-blue-800"
                          }`}
                        >
                          {drawingAttachmentMessage.text}
                        </div>
                      )}
                      {(formData.drawing_file_name || drawingFile) && (
                        <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                          <span className="min-w-0 truncate">
                            Attachment ready:{" "}
                            {drawingFile?.name || formData.drawing_file_name}
                          </span>
                          {drawingFile && (
                            <button
                              type="button"
                              onClick={clearDrawingSelection}
                              className="shrink-0 text-xs font-semibold text-red-600 hover:text-red-800"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      )}

                      {!drawingFile && formData.drawing_url && (
                        <button
                          type="button"
                          onClick={() =>
                            window.open(
                              formData.drawing_url,
                              "_blank",
                              "noopener,noreferrer",
                            )
                          }
                          className="mt-1 text-xs text-blue-700 hover:text-blue-900 underline"
                        >
                          View current drawing
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Vendor Management Section */}
                <div className="border-t pt-4 mt-4">
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="text-lg font-semibold text-gray-900">
                      🏭 Preferred Vendors
                    </h3>
                    <button
                      type="button"
                      onClick={() => setShowVendorForm(!showVendorForm)}
                      className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
                    >
                      {showVendorForm ? "Cancel" : "+ Add Vendor"}
                    </button>
                  </div>

                  {showVendorForm && (
                    <div className="bg-gray-50 p-4 rounded-lg mb-4 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Vendor *
                          </label>
                          <select
                            value={vendorForm.vendor_id}
                            onChange={(e) =>
                              setVendorForm({
                                ...vendorForm,
                                vendor_id: e.target.value,
                              })
                            }
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                            required
                          >
                            <option value="">Select Vendor</option>
                            {vendors.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Priority *
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="10"
                            value={vendorForm.priority}
                            onChange={(e) =>
                              setVendorForm({
                                ...vendorForm,
                                priority: parseInt(e.target.value),
                              })
                            }
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                            placeholder="1 = Preferred"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Unit Price (₹)
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            value={vendorForm.unit_price}
                            onChange={(e) =>
                              setVendorForm({
                                ...vendorForm,
                                unit_price: e.target.value,
                              })
                            }
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Lead Time (days)
                          </label>
                          <input
                            type="number"
                            value={vendorForm.lead_time_days}
                            onChange={(e) =>
                              setVendorForm({
                                ...vendorForm,
                                lead_time_days: e.target.value,
                              })
                            }
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Vendor Item Code
                          </label>
                          <input
                            type="text"
                            value={vendorForm.vendor_item_code}
                            onChange={(e) =>
                              setVendorForm({
                                ...vendorForm,
                                vendor_item_code: e.target.value,
                              })
                            }
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={addItemVendor}
                        className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
                      >
                        Add Vendor
                      </button>
                    </div>
                  )}

                  {itemVendors.length > 0 ? (
                    <div className="space-y-2">
                      {itemVendors.map((iv: any) => {
                        const vendorDisplay = resolveItemVendorDisplay(iv);
                        return (
                          <div
                            key={iv.vendor_id}
                            className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                          >
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-gray-900">
                                  {vendorDisplay.name}
                                </span>
                                {iv.is_preferred && (
                                  <span className="px-2 py-0.5 bg-green-100 text-green-800 text-xs font-medium rounded">
                                    Preferred
                                  </span>
                                )}
                                <span className="text-xs text-gray-500">
                                  Priority: {iv.priority}
                                </span>
                              </div>
                              <div className="text-sm text-gray-600 mt-1">
                                {iv.unit_price && <span>₹{iv.unit_price}</span>}
                                {iv.unit_price && iv.lead_time_days && (
                                  <span className="mx-2">•</span>
                                )}
                                {iv.lead_time_days && (
                                  <span>
                                    {iv.lead_time_days} days lead time
                                  </span>
                                )}
                                {iv.vendor_item_code && (
                                  <>
                                    <span className="mx-2">•</span>
                                    <span>
                                      Vendor Item Code: {iv.vendor_item_code}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeItemVendor(iv.vendor_id)}
                              className="text-red-600 hover:text-red-800 text-sm font-medium ml-4"
                            >
                              Remove
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 text-center py-4">
                      No vendors assigned yet
                    </p>
                  )}
                </div>

                <div className="flex justify-end gap-3 mt-6">
                  <button
                    type="button"
                    onClick={() => {
                      setShowForm(false);
                      setEditingItem(null);
                      resetForm();
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingItem}
                    className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingItem
                      ? "Saving…"
                      : `${editingItem ? "Update" : "Create"} Item`}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Drawing Manager Modal */}
      {showDrawingManager && selectedItemForDrawing && (
        <DrawingManager
          itemId={selectedItemForDrawing.id}
          itemCode={selectedItemForDrawing.code}
          itemName={selectedItemForDrawing.name}
          onClose={() => {
            setShowDrawingManager(false);
            setSelectedItemForDrawing(null);
          }}
          mandatory={false}
        />
      )}

      {/* Category Manager Modal */}
      {showCategoryManager && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-8 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800">
                Manage Categories
              </h2>
              <button
                onClick={() => setShowCategoryManager(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>

            {/* Add New Category */}
            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-700">
                  Add New Category
                </h3>
                <button
                  onClick={seedCategories}
                  className="px-4 py-1 bg-amber-600 text-white text-sm rounded hover:bg-amber-700"
                >
                  🔄 Restore Defaults
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="Enter category name (e.g., TOOLS)"
                  className="flex-1 px-4 py-2 border rounded-lg"
                  onKeyPress={(e) => e.key === "Enter" && addCategory()}
                />
                <button
                  onClick={addCategory}
                  className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                >
                  Add
                </button>
              </div>
              <p className="text-sm text-gray-500 mt-2">
                Categories will be automatically formatted (spaces become
                underscores, uppercase)
              </p>
            </div>

            {/* Categories List */}
            <div>
              <h3 className="font-semibold text-gray-700 mb-3">
                Current Categories
              </h3>
              <div className="space-y-2">
                {categories.map((category) => (
                  <div
                    key={category.id}
                    className="flex items-center justify-between p-3 bg-white border rounded-lg hover:bg-gray-50"
                  >
                    {editingCategory?.id === category.id ? (
                      <input
                        type="text"
                        value={editingCategory?.name || ""}
                        onChange={(e) =>
                          setEditingCategory({
                            id: category.id,
                            name: e.target.value,
                          })
                        }
                        className="flex-1 px-3 py-1 border rounded mr-2"
                        onKeyPress={(e) =>
                          e.key === "Enter" && updateCategory()
                        }
                      />
                    ) : (
                      <span className="font-medium text-gray-800">
                        {category.name.replace(/_/g, " ")}
                      </span>
                    )}
                    <div className="flex gap-2">
                      {editingCategory?.id === category.id ? (
                        <>
                          <button
                            onClick={updateCategory}
                            className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-sm"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingCategory(null)}
                            className="px-3 py-1 bg-gray-400 text-white rounded hover:bg-gray-500 text-sm"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() =>
                              setEditingCategory({
                                id: category.id,
                                name: category.name,
                              })
                            }
                            className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() =>
                              deleteCategory(category.id, category.name)
                            }
                            className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 pt-4 border-t">
              <button
                onClick={() => setShowCategoryManager(false)}
                className="w-full px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Variant Manager Modal */}
      {showVariantManager && selectedParentItem && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="bg-gradient-to-r from-[#8B6F47] to-[#6F4E37] text-white px-6 py-4">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold">🏷️ Manage Variants</h2>
                  <p className="text-[#FAF9F6] text-sm mt-1">
                    Parent: {selectedParentItem.code} -{" "}
                    {selectedParentItem.name}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowVariantManager(false);
                    setSelectedParentItem(null);
                    setVariants([]);
                    setNewVariant({
                      code: "",
                      name: "",
                      variant_name: "",
                      is_default: false,
                    });
                  }}
                  className="text-white hover:text-gray-200 text-3xl font-bold"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {/* Add New Variant Form */}
              <div className="bg-yellow-50 border-2 border-yellow-200 rounded-lg p-4 mb-6">
                <h3 className="font-semibold text-lg mb-3">
                  ➕ Add New Variant
                </h3>
                <div className="grid grid-cols-4 gap-3 mb-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      SAS Part Number *
                    </label>
                    <input
                      type="text"
                      value={newVariant.code}
                      onChange={(e) =>
                        setNewVariant({ ...newVariant, code: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      placeholder="e.g., BAT-EXIDE"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Item Name *
                    </label>
                    <input
                      type="text"
                      value={newVariant.name}
                      onChange={(e) =>
                        setNewVariant({ ...newVariant, name: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      placeholder="e.g., Exide Battery"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Variant/Brand Name *
                    </label>
                    <input
                      type="text"
                      value={newVariant.variant_name}
                      onChange={(e) =>
                        setNewVariant({
                          ...newVariant,
                          variant_name: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      placeholder="e.g., Exide Lithium 12V"
                    />
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newVariant.is_default}
                        onChange={(e) =>
                          setNewVariant({
                            ...newVariant,
                            is_default: e.target.checked,
                          })
                        }
                        className="h-4 w-4 text-[#8B6F47] focus:ring-[#8B6F47] border-gray-300 rounded"
                      />
                      <span className="text-sm font-medium text-gray-700">
                        ⭐ Default
                      </span>
                    </label>
                  </div>
                </div>
                <button
                  onClick={addVariantQuick}
                  className="w-full px-4 py-2 bg-[#8B6F47] text-white rounded-lg hover:bg-[#6F4E37] font-medium"
                >
                  ➕ Add Variant
                </button>
                <p className="text-xs text-gray-500 mt-2">
                  💡 Inherits category (
                  {formatItemCategory(selectedParentItem.category)}), UOM (
                  {selectedParentItem.uom}), and HSN (
                  {selectedParentItem.hsn_code}) from parent
                </p>
              </div>

              {/* Existing Variants List */}
              <div>
                <h3 className="font-semibold text-lg mb-3">
                  Existing Variants ({variants.length})
                </h3>

                {variants.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <p className="text-lg">No variants created yet</p>
                    <p className="text-sm">
                      Add your first variant above to get started
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {variants.map((variant) => (
                      <div
                        key={variant.id}
                        className={`flex items-center justify-between p-4 rounded-lg border-2 ${
                          variant.is_default_variant
                            ? "bg-green-50 border-green-300"
                            : "bg-white border-gray-200"
                        }`}
                      >
                        <div className="flex-1">
                          <div className="flex items-center space-x-2">
                            {variant.is_default_variant && (
                              <span className="text-xl" title="Default variant">
                                ⭐
                              </span>
                            )}
                            <div>
                              <div className="font-semibold text-gray-900">
                                {variant.code} - {variant.name}
                              </div>
                              <div className="text-sm text-gray-600">
                                Brand:{" "}
                                <span className="font-medium">
                                  {variant.variant_name}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() =>
                              toggleDefaultVariant(
                                variant.id,
                                variant.is_default_variant || false,
                              )
                            }
                            className={`px-3 py-1 text-sm rounded-lg font-medium ${
                              variant.is_default_variant
                                ? "bg-gray-200 text-gray-600 hover:bg-gray-300"
                                : "bg-green-100 text-green-700 hover:bg-green-200"
                            }`}
                            title={
                              variant.is_default_variant
                                ? "Remove default"
                                : "Set as default"
                            }
                          >
                            {variant.is_default_variant
                              ? "✓ Default"
                              : "Set Default"}
                          </button>
                          <button
                            onClick={() => handleEdit(variant)}
                            className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 font-medium"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteVariant(variant.id)}
                            className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200 font-medium"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="border-t px-6 py-4 bg-gray-50">
              <button
                onClick={() => {
                  setShowVariantManager(false);
                  setSelectedParentItem(null);
                  setVariants([]);
                  setNewVariant({
                    code: "",
                    name: "",
                    variant_name: "",
                    is_default: false,
                  });
                }}
                className="w-full px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Inventory Modal */}
      {showBulkInventory && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-2xl font-bold text-gray-900">
                📦 Bulk Inventory Entry
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Enter quantities for items you want to add to inventory. Leave
                blank to skip.
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-1">
                <div className="grid grid-cols-5 gap-4 text-sm font-semibold text-gray-700 pb-2 border-b">
                  <div>SAS Part Number</div>
                  <div className="col-span-2">Item Name</div>
                  <div>Quantity</div>
                  <div>Location</div>
                </div>

                {bulkInventoryItems.map((item, index) => (
                  <div
                    key={item.itemId}
                    className="grid grid-cols-5 gap-4 py-2 border-b border-gray-100 hover:bg-gray-50"
                  >
                    <div className="text-sm font-medium text-gray-700">
                      {item.itemCode}
                    </div>
                    <div className="col-span-2 text-sm text-gray-600">
                      {item.itemName}
                    </div>
                    <div>
                      <input
                        type="number"
                        step="0.01"
                        value={item.quantity}
                        onChange={(e) => {
                          const newItems = [...bulkInventoryItems];
                          newItems[index].quantity = e.target.value;
                          setBulkInventoryItems(newItems);
                        }}
                        className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <select
                        value={item.location}
                        onChange={(e) => {
                          const newItems = [...bulkInventoryItems];
                          newItems[index].location = e.target.value;
                          setBulkInventoryItems(newItems);
                        }}
                        className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="MAIN_WAREHOUSE">Main Warehouse</option>
                        <option value="PRODUCTION_FLOOR">
                          Production Floor
                        </option>
                        <option value="QC_AREA">QC Area</option>
                        <option value="FINISHED_GOODS">Finished Goods</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex gap-4">
              <button
                onClick={() => {
                  setShowBulkInventory(false);
                  setBulkInventoryItems([]);
                }}
                className="flex-1 px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkInventorySubmit}
                className="flex-1 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
              >
                Add Inventory
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Items Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="p-5 border-b flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  Import Items from CSV
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Upload a CSV file with item data. Required columns:{" "}
                  <code className="bg-gray-100 px-1 rounded">
                    code, name, category, uom
                  </code>
                </p>
              </div>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-gray-400 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="overflow-auto flex-1 p-5 space-y-4">
              {/* Download template hint */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 flex justify-between items-center">
                <div className="text-sm text-emerald-800">
                  <strong>Step 1:</strong> Download the template CSV, fill in
                  your items, then upload below.
                </div>
                <button
                  onClick={downloadItemTemplate}
                  className="px-3 py-1.5 bg-emerald-600 text-white rounded text-xs font-semibold hover:bg-emerald-700 whitespace-nowrap ml-4"
                >
                  ⬇ Download Template
                </button>
              </div>

              {/* File upload */}
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) parseImportFile(f);
                  }}
                />
                <div className="text-4xl mb-2">📄</div>
                <p className="text-sm text-gray-600 mb-3">
                  {importFile ? (
                    <span className="font-semibold text-teal-700">
                      {importFile.name}
                    </span>
                  ) : (
                    "Select a CSV file to import"
                  )}
                </p>
                <button
                  onClick={() => importFileRef.current?.click()}
                  className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700"
                >
                  {importFile ? "Change File" : "Choose CSV File"}
                </button>
              </div>

              {/* Preview */}
              {importPreview.length > 0 && !importResult && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">
                    Preview ({importPreview.length} rows)
                  </h3>
                  <div className="overflow-x-auto border rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          {Object.keys(importPreview[0]).map((h) => (
                            <th
                              key={h}
                              className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {importPreview.slice(0, 10).map((row, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            {Object.values(row).map((val: any, j) => (
                              <td
                                key={j}
                                className="px-3 py-1.5 text-gray-700 whitespace-nowrap"
                              >
                                {val || "—"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {importPreview.length > 10 && (
                      <div className="px-4 py-2 text-xs text-gray-400 border-t">
                        …and {importPreview.length - 10} more rows
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Result */}
              {importResult && (
                <div
                  className={`rounded-lg border px-4 py-3 ${importResult.failed === 0 ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}
                >
                  <div className="font-semibold text-sm mb-1">
                    ✅ {importResult.success} imported successfully
                    {importResult.failed > 0 && (
                      <span className="text-red-600">
                        {" "}
                        · ❌ {importResult.failed} failed
                      </span>
                    )}
                  </div>
                  {importResult.errors.length > 0 && (
                    <ul className="text-xs text-red-700 space-y-0.5 mt-2 max-h-24 overflow-y-auto">
                      {importResult.errors.slice(0, 10).map((e, i) => (
                        <li key={i}>• {e}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="p-4 border-t flex justify-end gap-3">
              <button
                onClick={() => setShowImportModal(false)}
                className="px-5 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
              >
                {importResult ? "Close" : "Cancel"}
              </button>
              {importPreview.length > 0 && !importResult && (
                <button
                  onClick={submitImport}
                  disabled={importLoading}
                  className="px-5 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-60"
                >
                  {importLoading
                    ? "Importing…"
                    : `Import ${importPreview.length} Items`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Item View Modal */}
      {viewingItem && (
        <div className="fixed inset-0 z-50 bg-[#FAF9F6] text-[#2F241D]">
          <div className="flex h-screen flex-col bg-white">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 border-b border-[#E8DCC4] bg-white px-6 py-4">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-[#8B6F47]">
                  Material Master
                </div>
                <h2 className="mt-1 text-2xl font-bold text-[#4A3426]">
                  {viewingItem.code}
                </h2>
                <p className="text-sm text-[#6F4E37] mt-0.5">
                  {viewingItem.name}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      setViewingItem(null);
                      handleEdit(viewingItem);
                    }}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-[#D8C8AA] bg-white px-3 text-sm font-semibold text-[#5E4635] hover:bg-[#F5EFE3]"
                  >
                    <Pencil className="h-4 w-4" />
                    Edit
                  </button>
                )}
                {canCreate && (
                  <button
                    type="button"
                    onClick={() => void handleCloneItem(viewingItem)}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 text-sm font-semibold text-blue-800 hover:bg-blue-100"
                  >
                    <Copy className="h-4 w-4" />
                    Clone
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setViewingItem(null)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[#7A6555] hover:bg-[#F5EFE3]"
                  title="Close"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {/* Status badges */}
              <div className="flex flex-wrap gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${viewingItem.is_active ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-600"}`}
                >
                  {viewingItem.is_active ? "Active" : "Inactive"}
                </span>
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${viewingItem.is_verified ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"}`}
                >
                  {viewingItem.is_verified
                    ? "Verified"
                    : viewingItem.approval_status || "Pending Verification"}
                </span>
                {viewingItem.uid_tracking && (
                  <span className="inline-flex items-center rounded-full bg-purple-100 px-3 py-1 text-xs font-semibold text-purple-800">
                    UID Tracked: {viewingItem.uid_strategy || "SERIALIZED"}
                  </span>
                )}
                {viewingItem.is_variant && (
                  <span className="inline-flex items-center rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-800">
                    Variant
                    {viewingItem.variant_name
                      ? `: ${viewingItem.variant_name}`
                      : ""}
                  </span>
                )}
              </div>

              {/* Core details */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
                  Item Details
                </h3>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                  {[
                    { label: "SAS Part Number", value: viewingItem.code },
                    { label: "Item Name", value: viewingItem.name },
                    {
                      label: "OEM Part No.",
                      value: viewingItem.oem_part_no || "—",
                    },
                    { label: "OEM Name", value: viewingItem.oem_name || "—" },
                    {
                      label: "Category",
                      value: viewingItem.category
                        ? formatItemCategory(viewingItem.category)
                        : "—",
                    },
                    { label: "UOM", value: viewingItem.uom || "—" },
                    { label: "HSN Code", value: viewingItem.hsn_code || "—" },
                    {
                      label: "Drawing Required",
                      value: viewingItem.drawing_required || "—",
                    },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <dt className="text-xs text-gray-500">{label}</dt>
                      <dd className="mt-0.5 text-sm font-medium text-[#36454F] break-words">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
                {viewingItem.description && (
                  <div className="mt-3">
                    <dt className="text-xs text-gray-500">Description</dt>
                    <dd className="mt-0.5 text-sm text-[#36454F]">
                      {viewingItem.description}
                    </dd>
                  </div>
                )}
              </div>

              {/* Pricing & stock */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
                  Pricing & Stock
                </h3>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                  {[
                    {
                      label: "Standard Cost",
                      value:
                        viewingItem.standard_cost != null
                          ? `₹${viewingItem.standard_cost.toFixed(2)}`
                          : "—",
                    },
                    {
                      label: "Purchase Currency",
                      value: viewingItem.purchase_currency || "INR",
                    },
                    ...(viewingItem.purchase_currency &&
                    viewingItem.purchase_currency !== "INR" &&
                    viewingItem.foreign_unit_price != null
                      ? [
                          {
                            label: `Foreign Price (${viewingItem.purchase_currency})`,
                            value: viewingItem.foreign_unit_price.toFixed(4),
                          },
                        ]
                      : []),
                    {
                      label: "Current Stock",
                      value: String(viewingItem.total_stock ?? 0),
                    },
                    {
                      label: "Reorder Level",
                      value:
                        viewingItem.reorder_level != null
                          ? String(viewingItem.reorder_level)
                          : "—",
                    },
                    {
                      label: "Reorder Qty",
                      value:
                        viewingItem.reorder_quantity != null
                          ? String(viewingItem.reorder_quantity)
                          : "—",
                    },
                    {
                      label: "Lead Time (Days)",
                      value:
                        viewingItem.lead_time_days != null
                          ? String(viewingItem.lead_time_days)
                          : "—",
                    },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <dt className="text-xs text-gray-500">{label}</dt>
                      <dd className="mt-0.5 text-sm font-medium text-[#36454F]">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              {/* UID tracking */}
              {viewingItem.uid_tracking && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
                    UID Tracking
                  </h3>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                    {[
                      {
                        label: "Strategy",
                        value: viewingItem.uid_strategy || "SERIALIZED",
                      },
                      {
                        label: "Batch UOM",
                        value: viewingItem.batch_uom || "—",
                      },
                      {
                        label: "Batch Quantity",
                        value:
                          viewingItem.batch_quantity != null
                            ? String(viewingItem.batch_quantity)
                            : "—",
                      },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <dt className="text-xs text-gray-500">{label}</dt>
                        <dd className="mt-0.5 text-sm font-medium text-[#36454F]">
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              {/* Approval history */}
              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Approval History
                </h3>
                <div className="overflow-x-auto rounded-md border border-[#E8DCC4]">
                  <table className="min-w-full text-sm">
                    <thead className="bg-[#FAF9F6] text-left text-xs uppercase text-[#7A6555]">
                      <tr>
                        <th className="px-3 py-2">Action</th>
                        <th className="px-3 py-2">User</th>
                        <th className="px-3 py-2">From</th>
                        <th className="px-3 py-2">To</th>
                        <th className="px-3 py-2">Reason</th>
                        <th className="px-3 py-2">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F5EFE3]">
                      {(viewingItem.approval_history || []).map(
                        (entry, index) => (
                          <tr key={`${entry.id || entry.action}-${index}`}>
                            <td className="px-3 py-2 font-semibold">
                              {entry.action || "-"}
                            </td>
                            <td className="px-3 py-2">
                              {entry.actor_name ||
                                entry.user_name ||
                                entry.created_by_name ||
                                entry.actor_email ||
                                "-"}
                            </td>
                            <td className="px-3 py-2">
                              {entry.from_status || "-"}
                            </td>
                            <td className="px-3 py-2">
                              {entry.to_status || "-"}
                            </td>
                            <td className="px-3 py-2">{entry.reason || "-"}</td>
                            <td className="px-3 py-2">
                              {entry.created_at
                                ? new Date(entry.created_at).toLocaleString(
                                    "en-IN",
                                  )
                                : "-"}
                            </td>
                          </tr>
                        ),
                      )}
                      {!viewingItem.approval_history?.length ? (
                        <tr>
                          <td className="px-3 py-4 text-[#7A6555]" colSpan={6}>
                            No approval history recorded yet.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Audit */}
              <div className="border-t border-gray-100 pt-4">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 text-xs text-gray-500">
                  <div>
                    <dt>Created</dt>
                    <dd className="mt-0.5 font-medium text-gray-700">
                      {viewingItem.created_at
                        ? new Date(
                            viewingItem.created_at.endsWith("Z") ||
                              /[+-]\d{2}:\d{2}$/.test(viewingItem.created_at)
                              ? viewingItem.created_at
                              : `${viewingItem.created_at}Z`,
                          ).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })
                        : "—"}
                    </dd>
                  </div>
                  {viewingItem.is_verified && viewingItem.verified_at && (
                    <div>
                      <dt>Verified On</dt>
                      <dd className="mt-0.5 font-medium text-gray-700">
                        {new Date(
                          viewingItem.verified_at.endsWith("Z") ||
                            /[+-]\d{2}:\d{2}$/.test(viewingItem.verified_at)
                            ? viewingItem.verified_at
                            : `${viewingItem.verified_at}Z`,
                        ).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stock Trail Modal */}
      {stockTrail.open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-10 overflow-auto">
          <div className="w-full max-w-5xl rounded-2xl border border-gray-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 bg-[#F7F1E6] px-6 py-4 rounded-t-2xl">
              <div>
                <h2 className="text-xl font-bold text-[#36454F]">
                  Stock Trail
                </h2>
                {stockTrail.item && (
                  <p className="text-sm text-[#6F4E37] mt-1">
                    {[stockTrail.item.code, stockTrail.item.name]
                      .filter(Boolean)
                      .join(" — ")}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() =>
                  setStockTrail({
                    open: false,
                    item: null,
                    loading: false,
                    data: null,
                  })
                }
                className="rounded-md px-2 py-1 text-sm font-semibold text-gray-500 hover:bg-white hover:text-gray-700"
              >
                Close
              </button>
            </div>

            <div className="px-6 py-5">
              {stockTrail.loading ? (
                <div className="py-10 text-center text-gray-500">
                  Loading stock trail...
                </div>
              ) : stockTrail.data?.error ? (
                <div className="py-6 text-center text-red-600">
                  {stockTrail.data.error}
                </div>
              ) : (
                <>
                  {/* Current stock by warehouse */}
                  {Array.isArray(stockTrail.data?.currentStock) &&
                    stockTrail.data.currentStock.length > 0 && (
                      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                        {stockTrail.data.currentStock.map(
                          (s: any, i: number) => {
                            const wh = s.warehouses;
                            return (
                              <div
                                key={i}
                                className="rounded-lg border border-[#8B6F47]/20 bg-[#FFF9F0] px-4 py-3"
                              >
                                <div className="text-xs text-gray-500 uppercase tracking-wide">
                                  {wh?.name || wh?.code || "Warehouse"}
                                </div>
                                <div className="mt-1 text-lg font-bold text-[#36454F]">
                                  {Number(
                                    s.available_quantity ?? s.quantity ?? 0,
                                  )}
                                </div>
                                <div className="text-xs text-gray-400">
                                  {Number(s.allocated_quantity ?? 0) > 0
                                    ? `${Number(s.allocated_quantity)} allocated`
                                    : "available"}
                                </div>
                              </div>
                            );
                          },
                        )}
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                          <div className="text-xs text-emerald-700 uppercase tracking-wide">
                            Trail Balance
                          </div>
                          <div className="mt-1 text-lg font-bold text-emerald-800">
                            {Number(stockTrail.data?.currentBalance ?? 0)}
                          </div>
                          <div className="text-xs text-emerald-600">
                            {stockTrail.data?.trails?.length ?? 0} events
                          </div>
                        </div>
                      </div>
                    )}

                  {/* Movement trail table */}
                  {Array.isArray(stockTrail.data?.trails) &&
                  stockTrail.data.trails.length === 0 ? (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 py-10 text-center text-gray-500">
                      No stock movement records found for this item.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-gray-200">
                      <table
                        className="w-full divide-y divide-gray-200 text-sm"
                        style={{ tableLayout: "auto" }}
                      >
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">
                              Date
                            </th>
                            <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">
                              Type
                            </th>
                            <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                              Reference
                            </th>
                            <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                              Vendor / Note
                            </th>
                            <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                              Warehouse
                            </th>
                            <th className="px-3 py-3 text-right text-xs font-semibold text-emerald-700 uppercase whitespace-nowrap">
                              In (+)
                            </th>
                            <th className="px-3 py-3 text-right text-xs font-semibold text-red-700 uppercase whitespace-nowrap">
                              Out (−)
                            </th>
                            <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700 uppercase whitespace-nowrap">
                              Balance
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                          {(stockTrail.data?.trails ?? []).map(
                            (t: any, i: number) => {
                              const isIn = t.qty_in > 0;
                              const isOut = t.qty_out > 0;
                              const typeLabel: Record<string, string> = {
                                GRN_RECEIPT: "GRN Receipt",
                                ADJUSTMENT: "Adjustment",
                                PRODUCTION_ISSUE: "Production Issue",
                                PRODUCTION_RETURN: "Prod. Return",
                                PRODUCTION_RECEIPT: "Prod. Receipt",
                                SALES_ISSUE: "Sales Issue",
                                DEMO_ISSUE: "Demo Issue",
                                DEMO_RETURN: "Demo Return",
                                SERVICE_ISSUE: "Service Issue",
                                TRANSFER: "Transfer",
                                SCRAP: "Scrap",
                              };
                              const label = typeLabel[t.type] || t.type;
                              const dtStr = t.date
                                ? (() => {
                                    const normalized =
                                      t.date.endsWith("Z") ||
                                      /[+-]\d{2}:\d{2}$/.test(t.date)
                                        ? t.date
                                        : `${t.date}Z`;
                                    const d = new Date(normalized);
                                    return isNaN(d.getTime())
                                      ? t.date
                                      : d.toLocaleString("en-IN", {
                                          day: "2-digit",
                                          month: "short",
                                          year: "numeric",
                                          hour: "2-digit",
                                          minute: "2-digit",
                                          hour12: false,
                                        });
                                  })()
                                : "-";
                              return (
                                <tr key={i} className="hover:bg-gray-50">
                                  <td className="px-3 py-3 text-gray-700 whitespace-nowrap">
                                    {dtStr}
                                  </td>
                                  <td className="px-3 py-3 whitespace-nowrap">
                                    <span
                                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                                        isIn
                                          ? "bg-emerald-100 text-emerald-800"
                                          : "bg-red-100 text-red-800"
                                      }`}
                                    >
                                      {label}
                                    </span>
                                  </td>
                                  <td className="px-3 py-3 font-medium text-[#36454F]">
                                    {t.reference || "-"}
                                  </td>
                                  <td
                                    className="px-3 py-3 text-gray-600"
                                    title={t.vendor || t.notes || ""}
                                  >
                                    {t.vendor || t.notes || "-"}
                                  </td>
                                  <td className="px-3 py-3 text-gray-600">
                                    {t.warehouse || "-"}
                                  </td>
                                  <td className="px-3 py-3 text-right font-semibold text-emerald-700 whitespace-nowrap">
                                    {isIn ? `+${t.qty_in}` : ""}
                                  </td>
                                  <td className="px-3 py-3 text-right font-semibold text-red-700 whitespace-nowrap">
                                    {isOut ? `−${t.qty_out}` : ""}
                                  </td>
                                  <td className="px-3 py-3 text-right font-bold text-[#36454F] whitespace-nowrap">
                                    {t.balance}
                                  </td>
                                </tr>
                              );
                            },
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Duplicate Warning Modal */}
      <DuplicateWarning
        isOpen={duplicateState.isOpen}
        exactMatches={duplicateState.exactMatches}
        fuzzyMatches={duplicateState.fuzzyMatches}
        entityType="Item"
        onProceed={handleProceed}
        onCancel={cancelDuplicateCheck}
        formatRecord={(data) => (
          <div className="text-sm">
            <p className="font-semibold">{data.name || data.item_name}</p>
            <p className="text-xs text-gray-600">
              Code: {data.code || data.item_code}
            </p>
            <p className="text-xs text-gray-600">
              Drawing: {data.drawing_number || "N/A"}
            </p>
            <p className="text-xs text-gray-600 line-clamp-2">
              {data.description}
            </p>
          </div>
        )}
      />
    </div>
  );
}
