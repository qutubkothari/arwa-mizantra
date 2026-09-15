"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiClient } from "../../../../../../lib/api-client";
import { hasModulePermission, readStoredUser } from "@/lib/rbac";
import SearchableSelect from "../../../../../components/SearchableSelect";
import { confirmDialog } from "../../../../../components/ui/ConfirmDialog";
import {
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Layers,
  Package,
  RefreshCw,
  Search,
} from "lucide-react";

type FinishedItem = {
  id: string;
  code: string;
  name: string;
  category?: string | null;
  product_category?: string | null;
};

const formatItemLabel = (item: {
  category?: string | null;
  product_category?: string | null;
  name?: string | null;
  code?: string | null;
}) => {
  const parts: string[] = [];
  const category = String(item.product_category ?? item.category ?? "").trim();
  const name = String(item.name ?? "").trim();
  const code = String(item.code ?? "").trim();
  if (category) parts.push(category);
  if (name) parts.push(name);
  if (code) parts.push(code);
  return parts.filter(Boolean).join(" - ");
};

type RawItem = {
  id?: string | number;
  item_id?: string | number;
  code?: string;
  item_code?: string;
  name?: string;
  item_name?: string;
  category?: string | null;
  product_category?: string | null;
};

type SmartExplosionNode = {
  level: number;
  componentType: "ITEM" | "BOM";
  bomId: string;
  parentBomId?: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  requiredQuantity: number;
  availableQuantity: number;
  toMakeQuantity: number;
  shortageQuantity: number;
  uidStrategy?: "SERIALIZED" | "BATCHED" | "NONE";
  sequence?: number;
};

type SmartSubAssemblyPlan = {
  bomId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  requiredQuantity: number;
  availableQuantity: number;
  toMakeQuantity: number;
};

type ItemStockSummary = {
  total_quantity?: number;
  available_quantity?: number;
  allocated_quantity?: number;
};

type SmartPreview = {
  finishedItem: FinishedItem;
  quantity: number;
  topBom: {
    id: string;
    version: number;
    is_active?: boolean;
  };
  nodes: SmartExplosionNode[];
  subAssembliesToMake: SmartSubAssemblyPlan[];
  makeNowQuantity?: number;
  shortageToTargetQuantity?: number;
  source: {
    salesOrderId: string | null;
    salesOrderItemId: string | null;
  };
};

type OpenSalesOrder = {
  id: string;
  soNumber: string;
  customerName: string;
  status: string;
};

type OpenSalesOrderItem = {
  id: string;
  itemId: string;
  itemLabel: string;
  orderedQty: number;
  dispatchedQty: number;
  blockedQty: number;
  remainingQty: number;
};

type JobOrderListRow = {
  id: string;
  job_order_number?: string;
  jobOrderNumber?: string;
  item_code?: string;
  item_name?: string;
  quantity?: number;
  status?: string;
  start_date?: string;
  created_at?: string;
};

type JobOrderDetail = {
  id: string;
  job_order_number?: string;
  item_code?: string;
  item_name?: string;
  quantity?: number;
  status?: string;
  start_date?: string;
  created_at?: string;
  materials?: Array<{
    id: string;
    item_code?: string;
    item_name?: string;
    required_quantity?: number;
    issued_quantity?: number;
    status?: string;
  }>;
};
type SmartCreateResponse = {
  jobOrder?: any;
  autoCompletedSubJobOrders?: any[];
  preview?: SmartPreview;
  issueMaterialsSummary?: any;
};

type SmartCreateAsyncStartResponse = {
  jobId: string;
};

type SmartCreateAsyncStatus = {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress: {
    current: number;
    total: number;
    phase: string;
    message: string;
    itemCode?: string;
    itemName?: string;
  };
  result?: SmartCreateResponse;
  error?: string;
};

export default function SmartJobOrdersItemsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6">
          <div className="text-xl">Loading...</div>
        </div>
      }
    >
      <SmartJobOrdersItemsPageContent />
    </Suspense>
  );
}

function SmartJobOrdersItemsPageContent() {
  const router = useRouter();
  const currentUser = readStoredUser();
  const canCreate = hasModulePermission(currentUser, "Production", "create");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !canCreate) {
      router.replace("/dashboard/production/job-orders");
    }
  }, [canCreate, mounted, router]);

  const searchParams = useSearchParams();

  const prefillItemId = searchParams.get("itemId") || "";
  const prefillQuantity = Number(searchParams.get("quantity") || "") || 1;
  const prefillSalesOrderId = searchParams.get("salesOrderId");
  const prefillSalesOrderItemId = searchParams.get("salesOrderItemId");

  // LocalStorage key for caching
  const CACHE_KEY = "smart_job_order_cache";
  const RELOAD_MARKER_KEY = "smart_job_order_last_unload";

  const [shouldAutoLoadFromCache] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const navEntry = performance.getEntriesByType("navigation")?.[0] as
        | PerformanceNavigationTiming
        | undefined;
      const navType = String(navEntry?.type || "").toLowerCase();
      const navName = String(navEntry?.name || "");
      const navLooksLikeSmartItems =
        navName.includes("/dashboard/production/job-orders/smart-items") ||
        navName.includes("/smart-items");

      // Fallback marker: written on beforeunload only when this page is active.
      // This remains reliable even when NavigationTiming values are inconsistent.
      let markerLooksLikeReloadThisPage = false;
      try {
        const markerRaw = sessionStorage.getItem(RELOAD_MARKER_KEY);
        if (markerRaw) {
          const marker = JSON.parse(markerRaw) as {
            path?: string;
            at?: number;
          };
          const path = String(marker?.path || "");
          const at = Number(marker?.at || 0);
          const ageMs = Date.now() - at;
          markerLooksLikeReloadThisPage =
            path === window.location.pathname &&
            Number.isFinite(ageMs) &&
            ageMs >= 0 &&
            ageMs <= 15000;
        }
      } catch {
        markerLooksLikeReloadThisPage = false;
      } finally {
        // consume once to avoid stale marker impacting later navigations
        sessionStorage.removeItem(RELOAD_MARKER_KEY);
      }

      // Must be an actual page reload for THIS page, or a strong unload/reload marker match.
      // This prevents auto-load when user refreshes /job-orders then client-navigates here.
      const reloadedThisPage =
        (navType === "reload" && navLooksLikeSmartItems) ||
        markerLooksLikeReloadThisPage;
      if (!reloadedThisPage) return false;

      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        const hasPreviewNodes =
          Array.isArray(parsed?.preview?.nodes) &&
          parsed.preview.nodes.length > 0;
        return Boolean(parsed.previewLoaded || hasPreviewNodes);
      }
    } catch (e) {}
    return false;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onBeforeUnload = () => {
      try {
        sessionStorage.setItem(
          RELOAD_MARKER_KEY,
          JSON.stringify({
            path: window.location.pathname,
            at: Date.now(),
          }),
        );
      } catch {
        // no-op
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  // Initialize state from localStorage if available
  const [itemId, setItemId] = useState<string>(() => {
    if (prefillItemId) return prefillItemId;
    if (typeof window === "undefined") return "";
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        return parsed.itemId || "";
      }
    } catch (e) {}
    return "";
  });

  const [quantity, setQuantity] = useState<number>(() => {
    if (prefillQuantity !== 1) return prefillQuantity;
    if (typeof window === "undefined") return 1;
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        return parsed.quantity || 1;
      }
    } catch (e) {}
    return 1;
  });

  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string>("");
  const [finishedGoodsItems, setFinishedGoodsItems] = useState<FinishedItem[]>(
    [],
  );
  const [allItems, setAllItems] = useState<FinishedItem[]>([]);

  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [loadingElapsedSeconds, setLoadingElapsedSeconds] = useState(0);
  const [preview, setPreview] = useState<SmartPreview | null>(() => {
    if (typeof window === "undefined") return null;
    if (!shouldAutoLoadFromCache) return null;
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (!cached) return null;
      const parsed = JSON.parse(cached);
      if (parsed?.preview && Array.isArray(parsed.preview?.nodes)) {
        return parsed.preview as SmartPreview;
      }
    } catch (e) {}
    return null;
  });
  const [previewError, setPreviewError] = useState<string>("");

  const [selectedCategoryByNodeKey, setSelectedCategoryByNodeKey] = useState<
    Record<string, string>
  >(() => {
    if (typeof window === "undefined") return {};
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        return parsed.selectedCategoryByNodeKey || {};
      }
    } catch (e) {}
    return {};
  });

  const [selectedItemByNodeKey, setSelectedItemByNodeKey] = useState<
    Record<string, string>
  >(() => {
    if (typeof window === "undefined") return {};
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        return parsed.selectedItemByNodeKey || {};
      }
    } catch (e) {}
    return {};
  });
  const [stockByItemId, setStockByItemId] = useState<
    Record<string, { available: number; loading: boolean; error?: string }>
  >(() => {
    if (typeof window === "undefined") return {};
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        return parsed.stockByItemId || {};
      }
    } catch (e) {}
    return {};
  });
  const [expandedBoms, setExpandedBoms] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        return new Set(parsed.expandedBoms || []);
      }
    } catch (e) {}
    return new Set();
  });
  const [showShortageDetails, setShowShortageDetails] = useState(false);
  const [showSalesOrderMapping, setShowSalesOrderMapping] = useState(
    Boolean(prefillSalesOrderId),
  );
  const [showStructureDetails, setShowStructureDetails] = useState(false);

  const [openSalesOrders, setOpenSalesOrders] = useState<OpenSalesOrder[]>([]);
  const [salesOrderItems, setSalesOrderItems] = useState<OpenSalesOrderItem[]>(
    [],
  );
  const [loadingOpenSalesOrders, setLoadingOpenSalesOrders] = useState(false);
  const [loadingSalesOrderItems, setLoadingSalesOrderItems] = useState(false);
  const [mappedSalesOrderId, setMappedSalesOrderId] = useState<string>(
    prefillSalesOrderId || "",
  );
  const [mappedSalesOrderItemId, setMappedSalesOrderItemId] = useState<string>(
    prefillSalesOrderItemId || "",
  );

  const [creating, setCreating] = useState(false);
  const [creatingPR, setCreatingPR] = useState(false);
  const [createSummary, setCreateSummary] =
    useState<SmartCreateResponse | null>(null);
  const [showCreateSummary, setShowCreateSummary] = useState(false);

  const [createJobId, setCreateJobId] = useState("");
  const [createJobStatus, setCreateJobStatus] =
    useState<SmartCreateAsyncStatus | null>(null);
  const [showCreateProgress, setShowCreateProgress] = useState(false);
  const [showPurchaseRequisitionNotice, setShowPurchaseRequisitionNotice] =
    useState(false);

  // Sub-assembly individual/batch JO creation
  const [subAssemblyQtyModal, setSubAssemblyQtyModal] = useState<{
    open: boolean;
    mode: "single" | "batch";
    items: Array<{
      bomId: string;
      itemId: string;
      itemCode: string;
      itemName: string;
      defaultQty: number;
      qty: number;
    }>;
  }>({ open: false, mode: "single", items: [] });
  const [creatingSAJobs, setCreatingSAJobs] = useState(false);
  const [selectedSABatchKeys, setSelectedSABatchKeys] = useState<Set<string>>(
    new Set(),
  );
  const [saJobResults, setSaJobResults] = useState<
    Array<{
      itemCode: string;
      success: boolean;
      joNumber?: string;
      error?: string;
    }>
  >([]);
  const [showSAJobResults, setShowSAJobResults] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    if (showCreateSummary) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showCreateSummary]);

  useEffect(() => {
    if (!createJobId) return;

    let cancelled = false;
    let done = false;
    let pollFailures = 0;
    const startedAt = Date.now();
    const maxPollFailures = 8;
    const maxCreateWaitMs = 10 * 60 * 1000;

    const poll = async () => {
      if (cancelled || done) return;
      if (Date.now() - startedAt > maxCreateWaitMs) {
        done = true;
        setShowCreateProgress(false);
        setCreating(false);
        setCreateJobId("");
        void confirmDialog({
          title: "Smart Job Order Still Running",
          message:
            "The creation process is taking longer than expected. Please refresh and check View Job Orders before trying again, to avoid creating a duplicate.",
          confirmLabel: "OK",
          cancelLabel: "Close",
          variant: "warning",
        });
        return;
      }

      try {
        const status = await apiClient.get<SmartCreateAsyncStatus>(
          `/job-orders/smart/create-async/${createJobId}`,
        );
        if (cancelled) return;
        pollFailures = 0;

        setCreateJobStatus(status);

        if (status.status === "COMPLETED") {
          done = true;
          setShowCreateProgress(false);
          setCreating(false);
          setCreateJobId("");

          const result = status.result || null;

          const issueSummary = (result as any)?.issueMaterialsSummary;
          if (issueSummary?.error) {
          } else if (
            Array.isArray(issueSummary?.failures) &&
            issueSummary.failures.length > 0
          ) {
          } else if (issueSummary) {
          }

          setCreateSummary(result);
          setShowCreateSummary(true);

          // Clear localStorage cache after successful creation
          try {
            localStorage.removeItem(CACHE_KEY);
          } catch (e) {}

          navigateAfterCreate(result, showPurchaseRequisitionNotice);
        }

        if (status.status === "FAILED") {
          done = true;
          setShowCreateProgress(false);
          setCreating(false);
          setCreateJobId("");
          void confirmDialog({
            title: "Could Not Create Smart Job Order",
            message: status.error || "Unknown error",
            confirmLabel: "OK",
            cancelLabel: "Close",
            variant: "warning",
          });
        }
      } catch (err: any) {
        pollFailures += 1;
        if (pollFailures >= maxPollFailures) {
          done = true;
          setShowCreateProgress(false);
          setCreating(false);
          setCreateJobId("");
          void confirmDialog({
            title: "Could Not Track Smart Job Order",
            message:
              "The server did not return job progress after multiple attempts. Please refresh and check View Job Orders before trying again, to avoid creating a duplicate.",
            confirmLabel: "OK",
            cancelLabel: "Close",
            variant: "warning",
          });
          return;
        }

        // If polling fails transiently, keep trying but tell the user what is happening.
        setCreateJobStatus((prev) =>
          prev
            ? {
                ...prev,
                progress: {
                  ...prev.progress,
                  message: `Still working... reconnecting to progress (${pollFailures}/${maxPollFailures})`,
                },
              }
            : prev,
        );
      }
    };

    void poll();
    const interval = setInterval(poll, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createJobId, showPurchaseRequisitionNotice]);

  const canPreview = Boolean(itemId) && Number(quantity) > 0;

  const headerSubtitle = useMemo(() => {
    if (mappedSalesOrderId)
      return `Mapped to Sales Order: ${mappedSalesOrderId}`;
    return "Choose the output and quantity. Mizantra checks the approved structure, stock and purchase gaps for you.";
  }, [mappedSalesOrderId]);

  const finishedGoodsOptions = useMemo(
    () =>
      finishedGoodsItems.map((i) => ({
        value: i.id,
        label: formatItemLabel(i),
      })),
    [finishedGoodsItems],
  );

  const allItemOptions = useMemo(
    () =>
      allItems.map((i) => ({
        value: i.id,
        label: formatItemLabel(i),
      })),
    [allItems],
  );

  const allItemCategories = useMemo(() => {
    const set = new Set<string>();
    allItems.forEach((i) => {
      const cat = String(i.product_category ?? "").trim();
      if (cat) set.add(cat);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allItems]);

  // Helper function to get filtered item options by category
  const getFilteredItemOptions = (
    originalItemId: string,
    selectedCategory?: string,
    selectedItemId?: string,
  ) => {
    const originalItem = allItemsById.get(originalItemId);
    const categoryToUse = String(
      selectedCategory || originalItem?.product_category || "",
    ).trim();
    const baseOptions = !categoryToUse
      ? allItemOptions
      : allItems
          .filter((item) => item.product_category === categoryToUse)
          .map((i) => ({
            value: i.id,
            label: formatItemLabel(i),
          }));

    const normalizedSelectedId = String(selectedItemId || "").trim();
    if (!normalizedSelectedId) return baseOptions;
    if (baseOptions.some((opt) => opt.value === normalizedSelectedId))
      return baseOptions;

    const selectedItem = allItems.find(
      (it) => String(it.id) === normalizedSelectedId,
    );
    if (!selectedItem) return baseOptions;
    return [
      { value: String(selectedItem.id), label: formatItemLabel(selectedItem) },
      ...baseOptions,
    ];
  };

  const allItemsById = useMemo(() => {
    const map = new Map<string, FinishedItem>();
    for (const it of allItems) {
      if (it?.id) map.set(String(it.id), it);
    }
    return map;
  }, [allItems]);

  useEffect(() => {
    if (!preview) return;

    setAllItems((prev) => {
      const byId = new Map(prev.map((item) => [String(item.id), item]));
      let changed = false;

      const addFallbackItem = (item?: Partial<FinishedItem> | null) => {
        const id = String(item?.id || "").trim();
        const code = String(item?.code || "").trim();
        const name = String(item?.name || "").trim();
        if (!id || !code || !name || byId.has(id)) return;

        byId.set(id, {
          id,
          code,
          name,
          category: item?.category ?? null,
          product_category: item?.product_category ?? null,
        });
        changed = true;
      };

      addFallbackItem(preview.finishedItem);
      for (const node of preview.nodes || []) {
        addFallbackItem({
          id: node.itemId,
          code: node.itemCode,
          name: node.itemName,
        });
      }

      return changed ? Array.from(byId.values()) : prev;
    });
  }, [preview]);

  const selectedSalesOrderItem = useMemo(
    () =>
      salesOrderItems.find((row) => row.id === mappedSalesOrderItemId) || null,
    [salesOrderItems, mappedSalesOrderItemId],
  );

  const loadOpenSalesOrders = async () => {
    setLoadingOpenSalesOrders(true);
    try {
      const rows = (await apiClient.get("/sales/orders")) as any[];
      const openStatuses = new Set([
        "CONFIRMED",
        "IN_PRODUCTION",
        "READY_TO_DISPATCH",
        "PENDING_APPROVAL",
        "APPROVED",
      ]);
      const mapped = (Array.isArray(rows) ? rows : [])
        .map((row) => ({
          id: String(row?.id || ""),
          soNumber: String(row?.so_number || row?.soNumber || ""),
          customerName: String(row?.customer_name || row?.customerName || ""),
          status: String(row?.status || ""),
        }))
        .filter((row) => row.id && openStatuses.has(row.status));

      setOpenSalesOrders(mapped);
      if (
        mappedSalesOrderId &&
        !mapped.some((row) => row.id === mappedSalesOrderId)
      ) {
        setMappedSalesOrderId("");
        setMappedSalesOrderItemId("");
        setSalesOrderItems([]);
      }
    } catch (e) {
      setOpenSalesOrders([]);
    } finally {
      setLoadingOpenSalesOrders(false);
    }
  };

  const loadSalesOrderItems = async (salesOrderId: string) => {
    if (!salesOrderId) {
      setSalesOrderItems([]);
      return;
    }

    setLoadingSalesOrderItems(true);
    try {
      const [so, openJobOrders] = await Promise.all([
        apiClient.get<any>(`/sales/orders/${salesOrderId}`),
        apiClient.get<any[]>("/job-orders", { salesOrderId }),
      ]);

      const blockedByItemId = new Map<string, number>();
      for (const jo of Array.isArray(openJobOrders) ? openJobOrders : []) {
        const status = String(jo?.status || "").toUpperCase();
        if (status === "COMPLETED" || status === "CANCELLED") continue;
        const soItemId = String(
          jo?.sales_order_item_id || jo?.salesOrderItemId || "",
        ).trim();
        if (!soItemId) continue;
        const blockedQty = Number(jo?.quantity || 0) || 0;
        blockedByItemId.set(
          soItemId,
          (blockedByItemId.get(soItemId) || 0) + blockedQty,
        );
      }

      const soItems = (so?.sales_order_items || so?.items || []) as any[];
      const nextItems: OpenSalesOrderItem[] = (
        Array.isArray(soItems) ? soItems : []
      )
        .map((row) => {
          const id = String(row?.id || "");
          const orderedQty = Number(row?.quantity || 0) || 0;
          const dispatchedQty = Number(row?.dispatched_quantity || 0) || 0;
          const blockedQty = Number(blockedByItemId.get(id) || 0) || 0;
          const remainingQty = Math.max(
            0,
            orderedQty - dispatchedQty - blockedQty,
          );
          const itemCode = String(row?.item_code || "").trim();
          const itemDesc = String(row?.item_description || "").trim();
          const itemLabel =
            [itemCode, itemDesc].filter(Boolean).join(" - ") || id;

          return {
            id,
            itemId: String(row?.item_id || ""),
            itemLabel,
            orderedQty,
            dispatchedQty,
            blockedQty,
            remainingQty,
          };
        })
        .filter((row) => row.id && row.itemId);

      setSalesOrderItems(nextItems);
      if (
        mappedSalesOrderItemId &&
        !nextItems.some((row) => row.id === mappedSalesOrderItemId)
      ) {
        setMappedSalesOrderItemId("");
      }
    } catch (e) {
      setSalesOrderItems([]);
    } finally {
      setLoadingSalesOrderItems(false);
    }
  };

  const fetchItems = async () => {
    setItemsError("");
    setItemsLoading(true);
    try {
      // Fetch all BOMs to get items that have BOMs (for finished goods dropdown)
      const bomsResponse = await apiClient.get("/bom");
      const bomsList = Array.isArray(bomsResponse) ? bomsResponse : [];

      // Extract unique item IDs from BOMs
      const itemsWithBoms = new Set<string>();
      const itemDataMap = new Map<
        string,
        {
          code: string;
          name: string;
          category?: string | null;
          product_category?: string | null;
        }
      >();

      bomsList.forEach((bom: any) => {
        // Try multiple field patterns for item ID
        const itemId = bom.item?.id || bom.item_id || bom.itemId;
        if (itemId) {
          const id = String(itemId);
          itemsWithBoms.add(id);
          itemDataMap.set(id, {
            code: bom.item?.code || bom.item?.item_code || "",
            name: bom.item?.name || bom.item?.item_name || "",
            category: bom.item?.category ?? null,
            product_category: (bom.item as any)?.product_category ?? null,
          });
        }
      });

      // Create normalized list of finished goods items (items that have BOMs)
      const finishedGoods: FinishedItem[] = Array.from(itemsWithBoms)
        .map((id) => {
          const data = itemDataMap.get(id);
          if (!data?.code || !data?.name) return null;
          return {
            id,
            code: data.code,
            name: data.name,
            category: data.category,
            product_category: data.product_category,
          } as FinishedItem;
        })
        .filter((i) => i !== null) as FinishedItem[];

      // Fetch ALL items for component selection dropdowns
      const allItemsResponse = await apiClient.get(
        "/inventory/items?onlyVerified=true",
      );
      const allItemsList = Array.isArray(allItemsResponse)
        ? allItemsResponse
        : [];

      const allItemsNormalized: FinishedItem[] = allItemsList
        .map((raw: RawItem) => {
          const id = raw.id || raw.item_id;
          const code = raw.code || raw.item_code;
          const name = raw.name || raw.item_name;
          if (!id || !code || !name) return null;
          return {
            id: String(id),
            code: String(code),
            name: String(name),
            category: raw.category,
            product_category: raw.product_category ?? null,
          } as FinishedItem;
        })
        .filter((i) => i !== null) as FinishedItem[];

      setAllItems(allItemsNormalized);

      // Enrich finished goods with category (BOM payload may omit category)
      const categoryByItemId = new Map<string, string | null>();
      const productCategoryByItemId = new Map<string, string | null>();
      for (const it of allItemsNormalized) {
        categoryByItemId.set(String(it.id), it.category ?? null);
        productCategoryByItemId.set(String(it.id), it.product_category ?? null);
      }

      const finishedGoodsEnriched = finishedGoods.map((it) => ({
        ...it,
        category: it.category ?? categoryByItemId.get(String(it.id)) ?? null,
        product_category:
          it.product_category ??
          productCategoryByItemId.get(String(it.id)) ??
          null,
      }));

      setFinishedGoodsItems(finishedGoodsEnriched);
    } catch (err: any) {
      setFinishedGoodsItems([]);
      setAllItems([]);
      setItemsError(err?.message || "Failed to load items");
    } finally {
      setItemsLoading(false);
    }
  };

  const nodeKey = (node: SmartExplosionNode) => `${node.bomId}:${node.itemId}`;

  const getBomLineDisplay = (
    node: SmartExplosionNode,
    selectedItemId?: string,
  ) => {
    const selected = selectedItemId
      ? allItemsById.get(String(selectedItemId))
      : undefined;
    const fallback = node.itemId
      ? allItemsById.get(String(node.itemId))
      : undefined;
    const code = selected?.code || fallback?.code || node.itemCode || "";
    const name = selected?.name || fallback?.name || node.itemName || "";
    return (
      `${code}${code && name ? " - " : ""}${name}`.trim() || "Item not resolved"
    );
  };

  const getBomLineMeta = (
    node: SmartExplosionNode,
    selectedItemId?: string,
  ) => {
    const selected = selectedItemId
      ? allItemsById.get(String(selectedItemId))
      : undefined;
    const fallback = node.itemId
      ? allItemsById.get(String(node.itemId))
      : undefined;
    const code =
      selected?.code || fallback?.code || node.itemCode || "Unresolved item";
    const name =
      selected?.name || fallback?.name || node.itemName || "Item not resolved";
    const category =
      selected?.product_category ||
      selected?.category ||
      fallback?.product_category ||
      fallback?.category ||
      "";
    const substituted = Boolean(
      selectedItemId && String(selectedItemId) !== String(node.itemId || ""),
    );
    return { code, name, category, substituted };
  };

  const effectiveSelectedItemId = (node: SmartExplosionNode): string => {
    const key = nodeKey(node);
    return String(selectedItemByNodeKey[key] || node.itemId || "").trim();
  };

  const getAvailableForItemId = (
    itemId: string,
    fallbackAvailable?: number,
  ): number => {
    const id = String(itemId || "").trim();
    if (!id) return Number(fallbackAvailable || 0) || 0;
    const stockState = stockByItemId[id];
    const fromStock = stockState?.available;
    if (fromStock === undefined || fromStock === null)
      return Number(fallbackAvailable || 0) || 0;
    return Number(fromStock) || 0;
  };

  type GroupedShortageRow = {
    itemId: string;
    itemCode: string;
    itemName: string;
    requiredQuantity: number;
    availableQuantity: number;
    shortageQuantity: number;
  };

  const escapeCsv = (value: unknown) => {
    const s = String(value ?? "");
    return `"${s.replace(/"/g, '""')}"`;
  };

  const downloadCsv = (filename: string, csvText: string) => {
    try {
      const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Fallback: open in a new tab
      const url = `data:text/csv;charset=utf-8,${encodeURIComponent(csvText)}`;
      window.open(url, "_blank");
    }
  };

  const groupShortagesByItem = (
    nodes: SmartExplosionNode[],
    autoMakeItemIds: Set<string>,
  ): GroupedShortageRow[] => {
    // Collect ALL item IDs that are sub-assemblies (have BOMs = componentType 'BOM')
    // These will be auto-created, so we should skip them in raw material shortage check
    const subAssemblyItemIds = new Set<string>();
    const subAssemblyItemCodes = new Set<string>();
    for (const n of nodes || []) {
      if (n?.componentType === "BOM") {
        if (n.itemId) subAssemblyItemIds.add(String(n.itemId));
        if (n.itemCode) subAssemblyItemCodes.add(n.itemCode);
      }
    }

    // Helper to detect if an item looks like a sub-assembly by name/code pattern
    // This catches items that should be sub-assemblies but might not have BOMs yet
    const looksLikeSubAssembly = (code?: string, name?: string): boolean => {
      const c = (code || "").toUpperCase();
      const n = (name || "").toUpperCase();
      // Skip items with "ASSY" or "ASSEMBLY" in name
      if (n.includes("ASSY") || n.includes("ASSEMBLY")) return true;
      // Skip items with SA- prefix (sub-assembly code pattern)
      if (c.startsWith("SA-")) return true;
      // Skip FG- prefix (finished goods)
      if (c.startsWith("FG-")) return true;
      return false;
    };

    const byItemId = new Map<
      string,
      {
        itemId: string;
        itemCode: string;
        itemName: string;
        requiredQuantity: number;
        fallbackAvailableQuantity: number;
      }
    >();

    for (const n of nodes || []) {
      if (n?.componentType !== "ITEM") continue;
      const selectedItemId = effectiveSelectedItemId(n);
      if (!selectedItemId) continue;

      // Skip if this item is a sub-assembly (will be auto-created)
      // Check by: itemId in autoMakeItemIds, itemId in BOM nodes, or itemCode matches a BOM node
      if (autoMakeItemIds.has(selectedItemId)) continue;
      if (subAssemblyItemIds.has(selectedItemId)) continue;
      if (n.itemCode && subAssemblyItemCodes.has(n.itemCode)) continue;

      // Also skip items that LOOK like sub-assemblies by name/code pattern
      // This catches items that should have BOMs but don't (data issue)
      if (looksLikeSubAssembly(n.itemCode, n.itemName)) continue;

      const required = Number(n.requiredQuantity || 0) || 0;
      if (required <= 0) continue;

      const meta = allItemsById.get(selectedItemId);
      const existing = byItemId.get(selectedItemId);

      if (!existing) {
        byItemId.set(selectedItemId, {
          itemId: selectedItemId,
          itemCode: meta?.code || n.itemCode,
          itemName: meta?.name || n.itemName,
          requiredQuantity: required,
          fallbackAvailableQuantity: Number(n.availableQuantity || 0) || 0,
        });
      } else {
        existing.requiredQuantity += required;
      }
    }

    const rows: GroupedShortageRow[] = [];
    for (const entry of byItemId.values()) {
      const available = getAvailableForItemId(
        entry.itemId,
        entry.fallbackAvailableQuantity,
      );
      const shortage = Math.max(
        0,
        Number(entry.requiredQuantity || 0) - Number(available || 0),
      );
      if (shortage <= 0) continue;
      rows.push({
        itemId: entry.itemId,
        itemCode: entry.itemCode,
        itemName: entry.itemName,
        requiredQuantity: entry.requiredQuantity,
        availableQuantity: available,
        shortageQuantity: shortage,
      });
    }

    return rows.sort((a, b) => b.shortageQuantity - a.shortageQuantity);
  };

  const isUuid = (value: unknown) => {
    if (typeof value !== "string") return false;
    const v = value.trim();
    if (!v) return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v,
    );
  };

  const fetchItemStockAvailable = async (itemIdToCheck: string) => {
    const id = String(itemIdToCheck || "").trim();
    if (!id) return;

    setStockByItemId((prev) => {
      const existing = prev[id];
      if (existing?.loading) return prev;
      return {
        ...prev,
        [id]: { available: existing?.available ?? 0, loading: true },
      };
    });

    try {
      const summary = (await apiClient.get(
        `/items/${id}/stock`,
      )) as ItemStockSummary;
      const available = Number((summary as any)?.available_quantity ?? 0) || 0;
      setStockByItemId((prev) => ({
        ...prev,
        [id]: { available, loading: false },
      }));
    } catch (err: any) {
      setStockByItemId((prev) => ({
        ...prev,
        [id]: {
          available: prev[id]?.available ?? 0,
          loading: false,
          error: err?.message || "Failed to load stock",
        },
      }));
    }
  };

  const fetchPreview = async () => {
    if (!canPreview) return;
    setPreviewError("");
    setLoadingPreview(true);
    setLoadingProgress(0);
    setLoadingElapsedSeconds(0);
    setLoadingMessage("Loading BOM...");
    let progressInterval: ReturnType<typeof setInterval> | null = null;
    let elapsedInterval: ReturnType<typeof setInterval> | null = null;

    try {
      elapsedInterval = setInterval(() => {
        setLoadingElapsedSeconds((prev) => prev + 1);
      }, 1000);

      progressInterval = setInterval(() => {
        setLoadingProgress((prev) => {
          if (prev < 25) {
            setLoadingMessage("Loading BOM...");
            return prev + 2;
          } else if (prev < 60) {
            setLoadingMessage("Expanding BOM structure...");
            return prev + 2;
          } else if (prev < 90) {
            setLoadingMessage("Extracting items...");
            return prev + 1;
          } else if (prev < 96) {
            setLoadingMessage("Finalizing multi-level BOM...");
            return prev + 0.25;
          }
          return prev;
        });
      }, 200);

      const previewRequest = apiClient.get("/job-orders/smart/preview", {
        itemId,
        quantity,
        salesOrderId: mappedSalesOrderId || undefined,
        salesOrderItemId: mappedSalesOrderItemId || undefined,
        includeAllComponents: true,
      }) as Promise<SmartPreview>;

      const timeoutRequest = new Promise<SmartPreview>((_, reject) => {
        window.setTimeout(() => {
          reject(
            new Error(
              "BOM expansion took more than 90 seconds. Please check for circular BOM links, duplicate sub-assemblies, or unusually large BOM depth.",
            ),
          );
        }, 90000);
      });

      const data = await Promise.race([previewRequest, timeoutRequest]);

      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
      }
      if (elapsedInterval) {
        clearInterval(elapsedInterval);
        elapsedInterval = null;
      }
      setLoadingProgress(100);
      setLoadingMessage("Success: Preview ready!");

      setTimeout(() => {
        setPreview(data);
        setLoadingPreview(false);
      }, 300);
    } catch (err: any) {
      setPreview(null);
      setPreviewError(err?.message || "Failed to load BOM preview");
      setLoadingPreview(false);
      setLoadingProgress(0);
      setLoadingElapsedSeconds(0);
      setLoadingMessage("");
    } finally {
      if (progressInterval) {
        clearInterval(progressInterval);
      }
      if (elapsedInterval) {
        clearInterval(elapsedInterval);
      }
    }
  };

  // Save state to localStorage whenever it changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const cacheData = {
        itemId,
        quantity,
        previewLoaded: Boolean(preview),
        preview,
        selectedItemByNodeKey,
        selectedCategoryByNodeKey,
        stockByItemId,
        expandedBoms: Array.from(expandedBoms),
        timestamp: Date.now(),
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
    } catch (e) {}
  }, [
    itemId,
    quantity,
    preview,
    selectedItemByNodeKey,
    selectedCategoryByNodeKey,
    stockByItemId,
    expandedBoms,
  ]);

  useEffect(() => {
    fetchItems();
    loadOpenSalesOrders();

    // Fetch preview on mount only if explicitly prefilling from URL
    // or if user had already loaded a preview before refresh.
    if (
      !preview &&
      itemId &&
      Number(quantity) > 0 &&
      (Boolean(prefillItemId) || shouldAutoLoadFromCache)
    ) {
      fetchPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mappedSalesOrderId) {
      setSalesOrderItems([]);
      setMappedSalesOrderItemId("");
      return;
    }
    void loadSalesOrderItems(mappedSalesOrderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappedSalesOrderId]);

  useEffect(() => {
    if (!selectedSalesOrderItem) return;

    if (!itemId) {
      setItemId(selectedSalesOrderItem.itemId);
      setPreview(null);
    }

    if (!prefillQuantity || prefillQuantity <= 1) {
      setQuantity((current) => {
        if (current && current > 1) return current;
        return Math.max(
          1,
          Math.floor(selectedSalesOrderItem.remainingQty || 1),
        );
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSalesOrderItem?.id]);

  useEffect(() => {
    if (!preview?.nodes?.length) {
      setSelectedItemByNodeKey({});
      setStockByItemId({});
      setExpandedBoms(new Set());
      return;
    }

    const itemNodes = preview.nodes.filter(
      (n) => n.componentType === "ITEM" && n.itemId,
    );
    const bomNodes = preview.nodes.filter((n) => n.componentType === "BOM");

    // Start with all BOMs collapsed
    setExpandedBoms(new Set());

    let cancelled = false;

    (async () => {
      const nextSelected: Record<string, string> = {};
      const toFetchStock = new Set<string>();

      for (const node of itemNodes) {
        const key = nodeKey(node);
        const selected = String(node.itemId);
        nextSelected[key] = selected;
        toFetchStock.add(selected);
      }

      if (cancelled) return;

      setSelectedItemByNodeKey(nextSelected);
      await Promise.all(
        Array.from(toFetchStock).map((id) => fetchItemStockAvailable(id)),
      );
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview?.topBom?.id, preview?.quantity, preview?.finishedItem?.id]);

  // Removed automatic BOM expansion on dropdown selection
  // User must now click "Load BOM" button to trigger expansion
  // useEffect(() => {
  //   if (!canPreview) return;
  //
  //   const handle = setTimeout(() => {
  //     fetchPreview();
  //   }, 350);
  //
  //   return () => clearTimeout(handle);
  //   // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [itemId, quantity, salesOrderId, salesOrderItemId]);

  const getLinkedPurchaseRequisition = (result: SmartCreateResponse | null) => {
    const jobOrder =
      (result as any)?.jobOrder || (result as any)?.job_order || null;
    const prId = String(
      jobOrder?.linked_pr_id || jobOrder?.linkedPrId || "",
    ).trim();
    const prNumber = String(
      jobOrder?.linked_pr_number || jobOrder?.linkedPrNumber || "",
    ).trim();

    return {
      prId,
      prNumber,
      hasLinkedPr: Boolean(prId || prNumber),
    };
  };

  const navigateAfterCreate = (
    _result: SmartCreateResponse | null,
    _shouldShowPurchaseRequisitionNotice: boolean,
  ) => {
    // The creation summary modal is now the hand-off point. Do not show browser
    // alerts or auto-redirect; let the user choose Open SIV / Open PR / Job Orders.
  };

  const handlePurchaseShortageItems = async () => {
    if (!preview) return;
    const autoMakeItemIds = new Set(
      (preview.subAssembliesToMake || []).map((sa) => String(sa.itemId)),
    );
    const groupedShortages = groupShortagesByItem(
      preview.nodes || [],
      autoMakeItemIds,
    );
    if (groupedShortages.length === 0) return;

    setCreatingPR(true);
    try {
      await handleCreate();
    } finally {
      setCreatingPR(false);
    }
  };

  const handleCreate = async () => {
    if (!canPreview) {
      await confirmDialog({
        title: "Missing Job Order Details",
        message: "Please select a Finished Good item and quantity.",
        confirmLabel: "OK",
        cancelLabel: "Close",
        variant: "warning",
      });
      return;
    }

    // Check if any RAW MATERIALS are out of stock (grouped by item, so repeated components are summed)
    const autoMakeItemIds = new Set(
      (preview?.subAssembliesToMake || []).map((sa) => String(sa.itemId)),
    );
    const groupedShortages = groupShortagesByItem(
      preview?.nodes || [],
      autoMakeItemIds,
    );

    const hasShortages = groupedShortages.length > 0;
    const requestedQty = Number(quantity) || 0;
    setShowPurchaseRequisitionNotice(hasShortages);

    const effectiveQuantity = requestedQty;

    setCreating(true);
    setCreateJobStatus(null);

    let startedAsync = false;
    let createdSuccessfully = false;
    const idempotencyKey = crypto.randomUUID();
    try {
      const itemSelections: Record<string, string> = {};
      if (preview?.nodes?.length) {
        for (const node of preview.nodes) {
          if (node.componentType !== "ITEM" || !node.itemId) continue;
          const key = nodeKey(node);
          const selected = selectedItemByNodeKey[key];
          if (selected && isUuid(selected)) itemSelections[key] = selected;
        }
      }

      // Start async job to avoid request timeouts (502) for large sub-assembly counts.
      const started = await apiClient.post<SmartCreateAsyncStartResponse>(
        "/job-orders/smart/create-async",
        {
          itemId,
          quantity: Number(effectiveQuantity),
          startDate: new Date().toISOString().slice(0, 10),
          salesOrderId: mappedSalesOrderId || undefined,
          salesOrderItemId: mappedSalesOrderItemId || undefined,
          itemSelections,
          idempotencyKey,
        },
      );

      if (!started?.jobId) {
        throw new Error("Failed to start Smart Job Order job");
      }

      startedAsync = true;
      createdSuccessfully = true;
      setCreateJobId(started.jobId);
      setShowCreateProgress(true);
    } catch (err: any) {
      // Fallback to sync endpoint if the async route isn't deployed yet.
      const msg = String(err?.message || "Unknown error");
      const looksLikeNotFound =
        msg.toLowerCase().includes("404") ||
        msg.toLowerCase().includes("not found");

      if (looksLikeNotFound) {
        try {
          const itemSelections: Record<string, string> = {};
          if (preview?.nodes?.length) {
            for (const node of preview.nodes) {
              if (node.componentType !== "ITEM" || !node.itemId) continue;
              const key = nodeKey(node);
              const selected = selectedItemByNodeKey[key];
              if (selected && isUuid(selected)) itemSelections[key] = selected;
            }
          }

          const result = (await apiClient.post("/job-orders/smart/create", {
            itemId,
            quantity: Number(effectiveQuantity),
            startDate: new Date().toISOString().slice(0, 10),
            salesOrderId: mappedSalesOrderId || undefined,
            salesOrderItemId: mappedSalesOrderItemId || undefined,
            itemSelections,
            idempotencyKey,
          })) as SmartCreateResponse;

          setCreateSummary(result);
          setShowCreateSummary(true);
          createdSuccessfully = true;

          navigateAfterCreate(result, hasShortages);
        } catch (e2: any) {
          await confirmDialog({
            title: "Could Not Create Smart Job Order",
            message: e2?.message || msg,
            confirmLabel: "OK",
            cancelLabel: "Close",
            variant: "warning",
          });
        }
      } else {
        await confirmDialog({
          title: "Could Not Create Smart Job Order",
          message: msg,
          confirmLabel: "OK",
          cancelLabel: "Close",
          variant: "warning",
        });
      }
    } finally {
      // creating stays true while async job runs; polling will reset it.
      if (!startedAsync) setCreating(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Sub-assembly individual / batch JO creation
  // ---------------------------------------------------------------------------

  /** Check if a sub-assembly BOM has all its direct child materials in stock */
  const isSubAssemblyReady = (bomId: string): boolean => {
    if (!preview) return false;
    const directItems = preview.nodes.filter(
      (n) => n.componentType === "ITEM" && n.bomId === bomId,
    );
    for (const item of directItems) {
      const key = nodeKey(item);
      const selectedItemId = selectedItemByNodeKey[key] || item.itemId;
      const stockState = selectedItemId
        ? stockByItemId[selectedItemId]
        : undefined;
      const available = stockState?.available ?? item.availableQuantity;
      if (Number(item.requiredQuantity || 0) > Number(available || 0))
        return false;
    }
    return true;
  };

  /** Get all sub-assemblies that are ready (all materials in stock) */
  const getReadySubAssemblies = () => {
    if (!preview?.subAssembliesToMake?.length) return [];
    return preview.subAssembliesToMake.filter((sa) =>
      isSubAssemblyReady(sa.bomId),
    );
  };

  const getSAKey = (sa: Pick<SmartSubAssemblyPlan, "bomId" | "itemId">) =>
    `${sa.bomId}:${sa.itemId}`;

  const toggleSASelection = (sa: SmartSubAssemblyPlan) => {
    const key = getSAKey(sa);
    setSelectedSABatchKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAllReadySAs = () => {
    const ready = getReadySubAssemblies();
    const readyKeys = new Set(ready.map((sa) => getSAKey(sa)));
    setSelectedSABatchKeys((prev) => {
      const allReadySelected =
        ready.length > 0 && ready.every((sa) => prev.has(getSAKey(sa)));
      if (allReadySelected) return new Set();
      return readyKeys;
    });
  };

  /** Open quantity prompt for a single sub-assembly */
  const openSingleSAPrompt = (sa: SmartSubAssemblyPlan) => {
    const defaultQty = sa.toMakeQuantity || sa.requiredQuantity || 1;
    setSubAssemblyQtyModal({
      open: true,
      mode: "single",
      items: [
        {
          bomId: sa.bomId,
          itemId: sa.itemId,
          itemCode: sa.itemCode,
          itemName: sa.itemName,
          defaultQty,
          qty: defaultQty,
        },
      ],
    });
  };

  /** Open quantity prompt for all ready sub-assemblies */
  const openBatchSAPrompt = async () => {
    const ready = getReadySubAssemblies();
    if (!ready.length) {
      await confirmDialog({
        title: "No Ready Sub-Assemblies",
        message:
          "No sub-assemblies are ready. Their direct materials are not fully available in stock.",
        confirmLabel: "OK",
        cancelLabel: "Close",
        variant: "info",
      });
      return;
    }
    setSubAssemblyQtyModal({
      open: true,
      mode: "batch",
      items: ready.map((sa) => {
        const defaultQty = sa.toMakeQuantity || sa.requiredQuantity || 1;
        return {
          bomId: sa.bomId,
          itemId: sa.itemId,
          itemCode: sa.itemCode,
          itemName: sa.itemName,
          defaultQty,
          qty: defaultQty,
        };
      }),
    });
  };

  /** Open quantity prompt for selected sub-assemblies */
  const openSelectedSAPrompt = async () => {
    if (!preview?.subAssembliesToMake?.length) return;
    const selected = preview.subAssembliesToMake.filter((sa) =>
      selectedSABatchKeys.has(getSAKey(sa)),
    );
    const selectedReady = selected.filter((sa) => isSubAssemblyReady(sa.bomId));

    if (!selectedReady.length) {
      await confirmDialog({
        title: "Select Sub-Assembly",
        message:
          "Select at least one ready sub-assembly to create a Job Order.",
        confirmLabel: "OK",
        cancelLabel: "Close",
        variant: "warning",
      });
      return;
    }

    setSubAssemblyQtyModal({
      open: true,
      mode: "batch",
      items: selectedReady.map((sa) => {
        const defaultQty = sa.toMakeQuantity || sa.requiredQuantity || 1;
        return {
          bomId: sa.bomId,
          itemId: sa.itemId,
          itemCode: sa.itemCode,
          itemName: sa.itemName,
          defaultQty,
          qty: defaultQty,
        };
      }),
    });
  };

  /** Create JOs for the items in the modal */
  const processSubAssemblyJOs = async () => {
    const items = subAssemblyQtyModal.items.filter((i) => Number(i.qty) > 0);
    if (!items.length) return;

    setCreatingSAJobs(true);
    const results: Array<{
      itemCode: string;
      success: boolean;
      joNumber?: string;
      error?: string;
    }> = [];

    for (const item of items) {
      try {
        const result = await apiClient.post("/job-orders/from-bom", {
          itemId: item.itemId,
          bomId: item.bomId,
          quantity: Number(item.qty),
          startDate: new Date().toISOString().slice(0, 10),
          autoIssueMaterials: false,
          autoRepair: false,
        });
        const joNumber =
          result?.job_order_number ||
          result?.jobOrderNumber ||
          result?.id ||
          "Created";
        results.push({
          itemCode: item.itemCode,
          success: true,
          joNumber: String(joNumber),
        });
      } catch (err: any) {
        results.push({
          itemCode: item.itemCode,
          success: false,
          error: err?.message || "Failed",
        });
      }
    }

    setCreatingSAJobs(false);
    setSubAssemblyQtyModal({ open: false, mode: "single", items: [] });
    setSaJobResults(results);
    setShowSAJobResults(true);
    setSelectedSABatchKeys(new Set());

    const successCount = results.filter((r) => r.success).length;
    if (successCount > 0 && results.every((r) => r.success)) {
      // All succeeded - navigate after brief delay
      setTimeout(() => {
        router.push("/dashboard/production/job-orders");
      }, 2000);
    }
  };

  const formatQuantity = (value: number | string | undefined): string => {
    const num = Number(value || 0);
    if (num === 0) return "0";
    // Round to 4 decimal places and remove trailing zeros
    const rounded = Math.round(num * 10000) / 10000;
    return rounded.toString();
  };

  const renderExplosionTree = () => {
    if (!preview) return null;

    const rootBomId = preview.topBom.id;
    const virtualRoot: SmartExplosionNode = {
      level: 0,
      componentType: "BOM",
      bomId: rootBomId,
      parentBomId: undefined,
      itemId: preview.finishedItem.id,
      itemCode: preview.finishedItem.code,
      itemName: preview.finishedItem.name,
      requiredQuantity: preview.quantity,
      availableQuantity: 0,
      toMakeQuantity: 0,
      shortageQuantity: 0,
    };

    const bomNodes = [
      virtualRoot,
      ...preview.nodes.filter((n) => n.componentType === "BOM"),
    ];
    const itemNodes = preview.nodes.filter((n) => n.componentType === "ITEM");

    const bomById = new Map<string, SmartExplosionNode>();
    for (const b of bomNodes) {
      if (!bomById.has(b.bomId)) bomById.set(b.bomId, b);
    }

    const childBomIdsByParent = new Map<string, string[]>();
    for (const b of bomNodes) {
      if (b.bomId === rootBomId) continue;
      const parentId = b.parentBomId || rootBomId;
      const list = childBomIdsByParent.get(parentId) || [];
      list.push(b.bomId);
      childBomIdsByParent.set(parentId, list);
    }

    const itemNodesByBomId = new Map<string, SmartExplosionNode[]>();
    for (const n of itemNodes) {
      const list = itemNodesByBomId.get(n.bomId) || [];
      list.push(n);
      itemNodesByBomId.set(n.bomId, list);
    }

    // Deduplicate items within each BOM level - sum up quantities for same item
    for (const [bid, items] of itemNodesByBomId.entries()) {
      const dedupMap = new Map<string, SmartExplosionNode>();
      for (const item of items) {
        const key = item.itemId;
        if (dedupMap.has(key)) {
          // Merge quantities for duplicate items
          const existing = dedupMap.get(key)!;
          existing.requiredQuantity += item.requiredQuantity;
          existing.shortageQuantity = Math.max(
            0,
            existing.requiredQuantity - existing.availableQuantity,
          );
        } else {
          dedupMap.set(key, { ...item });
        }
      }
      itemNodesByBomId.set(bid, Array.from(dedupMap.values()));
    }

    // Stable ordering: by sequence then level then item code
    for (const [parentId, list] of childBomIdsByParent.entries()) {
      const sorted = [...list].sort((a, b) => {
        const aa = bomById.get(a);
        const bb = bomById.get(b);
        const seqA = Number(aa?.sequence ?? 0);
        const seqB = Number(bb?.sequence ?? 0);
        if (seqA && seqB && seqA !== seqB) return seqA - seqB;
        const lvlA = Number(aa?.level ?? 0);
        const lvlB = Number(bb?.level ?? 0);
        if (lvlA !== lvlB) return lvlA - lvlB;
        return String(aa?.itemCode || "").localeCompare(
          String(bb?.itemCode || ""),
        );
      });
      childBomIdsByParent.set(parentId, sorted);
    }

    // Sort items: by sequence first, then serialized, then item code
    for (const [bid, list] of itemNodesByBomId.entries()) {
      itemNodesByBomId.set(
        bid,
        [...list].sort((a, b) => {
          const seqA = Number(a.sequence ?? 0);
          const seqB = Number(b.sequence ?? 0);
          if (seqA && seqB && seqA !== seqB) return seqA - seqB;
          // Serialized items come next
          const aIsSerial = a.uidStrategy === "SERIALIZED";
          const bIsSerial = b.uidStrategy === "SERIALIZED";
          if (aIsSerial && !bIsSerial) return -1;
          if (!aIsSerial && bIsSerial) return 1;
          // Then sort by item code
          return String(a.itemCode || "").localeCompare(
            String(b.itemCode || ""),
          );
        }),
      );
    }

    const toggleBom = (id: string) => {
      setExpandedBoms((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    };

    const shortageMemo = new Map<string, boolean>();
    const shortageQuantityMemo = new Map<string, number>();
    const hasShortageInBom = (id: string): boolean => {
      const cached = shortageMemo.get(id);
      if (cached !== undefined) return cached;

      const directItems = itemNodesByBomId.get(id) || [];
      for (const item of directItems) {
        const key = nodeKey(item);
        const selectedItemId = selectedItemByNodeKey[key] || item.itemId;
        const stockState = selectedItemId
          ? stockByItemId[selectedItemId]
          : undefined;
        const available = stockState?.available ?? item.availableQuantity;
        if (Number(item.requiredQuantity || 0) > Number(available || 0)) {
          shortageMemo.set(id, true);
          return true;
        }
      }

      const childBoms = childBomIdsByParent.get(id) || [];
      for (const childId of childBoms) {
        if (hasShortageInBom(childId)) {
          shortageMemo.set(id, true);
          return true;
        }
      }

      shortageMemo.set(id, false);
      return false;
    };

    const getShortageQuantityInBom = (id: string): number => {
      const cached = shortageQuantityMemo.get(id);
      if (cached !== undefined) return cached;

      let totalShortage = 0;

      const directItems = itemNodesByBomId.get(id) || [];
      for (const item of directItems) {
        const key = nodeKey(item);
        const selectedItemId = selectedItemByNodeKey[key] || item.itemId;
        const stockState = selectedItemId
          ? stockByItemId[selectedItemId]
          : undefined;
        const available = stockState?.available ?? item.availableQuantity;
        const shortage = Math.max(
          0,
          Number(item.requiredQuantity || 0) - Number(available || 0),
        );
        totalShortage += shortage;
      }

      const childBoms = childBomIdsByParent.get(id) || [];
      for (const childId of childBoms) {
        totalShortage += getShortageQuantityInBom(childId);
      }

      shortageQuantityMemo.set(id, totalShortage);
      return totalShortage;
    };

    const getBgColor = (lvl: number) => {
      if (lvl === 0) return "bg-amber-100 hover:bg-amber-200";
      if (lvl === 1) return "bg-amber-50 hover:bg-amber-100";
      if (lvl === 2) return "bg-orange-50 hover:bg-orange-100";
      return "bg-yellow-50 hover:bg-yellow-100";
    };

    const renderBom = (id: string, isFirstInSection: boolean) => {
      const bom = bomById.get(id);
      if (!bom) return null;

      const isExpanded = expandedBoms.has(id);
      const directItems = itemNodesByBomId.get(id) || [];
      const childBoms = childBomIdsByParent.get(id) || [];
      const hasShortage = hasShortageInBom(id);
      const shortageQuantity = getShortageQuantityInBom(id);
      const lvl = Number(bom.level ?? 0);

      return (
        <div
          key={id}
          className={!isFirstInSection ? "border-t border-gray-200" : ""}
        >
          <div
            onClick={() => toggleBom(id)}
            className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
              hasShortage ? "bg-red-50 hover:bg-red-100" : getBgColor(lvl)
            }`}
            style={{ paddingLeft: `${16 + lvl * 24}px` }}
          >
            <span className="text-amber-700">
              {isExpanded ? (
                <ChevronDown size={18} />
              ) : (
                <ChevronRight size={18} />
              )}
            </span>
            <Layers size={16} className="text-amber-600" />
            <span className="font-semibold text-amber-900 flex items-center gap-2">
              {bom.sequence ? (
                <span className="px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 text-xs font-semibold">
                  #{bom.sequence}
                </span>
              ) : null}
              {bom.itemCode} - {bom.itemName}
              {id !== rootBomId && (
                <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
                  Level {lvl || 1} Sub-BOM
                </span>
              )}
            </span>
            <span className="ml-auto flex items-center gap-4 text-sm">
              <span className="text-amber-700">
                {directItems.length} item{directItems.length !== 1 ? "s" : ""}
                {childBoms.length ? ` - ${childBoms.length} sub` : ""}
              </span>
              {hasShortage && (
                <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">
                  Short {formatQuantity(shortageQuantity)}
                </span>
              )}
            </span>
          </div>

          {isExpanded && (
            <div className="bg-white">
              {/* Show serialized items first */}
              {directItems.filter((node) => node.uidStrategy === "SERIALIZED")
                .length > 0 ? (
                <table className="min-w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-20">
                        S.No
                      </th>
                      <th
                        className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                        style={{ paddingLeft: `${40 + lvl * 24}px` }}
                      >
                        Item (Serial Number)
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase w-24">
                        Required
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase w-24">
                        In Stock
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase w-24">
                        Short
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {directItems
                      .filter((node) => node.uidStrategy === "SERIALIZED")
                      .map((node, idx) => {
                        const key = nodeKey(node);
                        const selectedItemId = String(
                          selectedItemByNodeKey[key] || node.itemId || "",
                        ).trim();
                        const categoryValue =
                          selectedCategoryByNodeKey[key] ||
                          allItemsById.get(String(node.itemId))
                            ?.product_category ||
                          "";
                        const hasProductCategory = Boolean(
                          allItemsById.get(
                            String(selectedItemId || node.itemId),
                          )?.product_category,
                        );
                        const itemOptions = getFilteredItemOptions(
                          String(node.itemId || ""),
                          categoryValue,
                          selectedItemId,
                        );
                        const stockState = selectedItemId
                          ? stockByItemId[selectedItemId]
                          : undefined;
                        const available =
                          stockState?.available ?? node.availableQuantity;
                        const inStockLabel = stockState?.loading
                          ? "..."
                          : formatQuantity(available);
                        const requiredQty = Number(node.requiredQuantity || 0);
                        const short = Math.max(
                          0,
                          requiredQty - Number(available || 0),
                        );
                        const serial = node.sequence ?? idx + 1;
                        const lineMeta = getBomLineMeta(node, selectedItemId);

                        return (
                          <tr
                            key={`${node.bomId}:${node.itemId}:${idx}`}
                            className={`${
                              short > 0
                                ? "bg-red-50 hover:bg-red-100"
                                : "hover:bg-gray-50"
                            }`}
                          >
                            <td className="px-4 py-2 text-sm text-gray-600">
                              {serial}
                            </td>
                            <td
                              className="px-4 py-2"
                              style={{ paddingLeft: `${40 + lvl * 24}px` }}
                            >
                              <div className="flex flex-col gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Package
                                    size={14}
                                    className="text-amber-600 flex-shrink-0"
                                  />
                                  <span className="font-mono text-xs font-semibold text-[#8B4513] bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                                    {lineMeta.code}
                                  </span>
                                  {lineMeta.category ? (
                                    <span className="text-[11px] uppercase tracking-wide text-gray-600 bg-gray-100 border border-gray-200 rounded px-2 py-0.5">
                                      {lineMeta.category}
                                    </span>
                                  ) : null}
                                  {lineMeta.substituted ? (
                                    <span className="text-[11px] uppercase tracking-wide text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">
                                      Substituted
                                    </span>
                                  ) : null}
                                </div>
                                <div className="text-sm font-semibold text-gray-900 leading-snug">
                                  {lineMeta.name}
                                </div>
                                <div className="min-w-[360px] w-full">
                                  <SearchableSelect
                                    options={itemOptions}
                                    value={selectedItemId}
                                    onChange={async (value) => {
                                      const next = String(value || "");
                                      setSelectedItemByNodeKey((prev) => ({
                                        ...prev,
                                        [key]: next,
                                      }));
                                      const nextCategory =
                                        allItemsById.get(next)
                                          ?.product_category || "";
                                      if (nextCategory) {
                                        setSelectedCategoryByNodeKey(
                                          (prev) => ({
                                            ...prev,
                                            [key]: nextCategory,
                                          }),
                                        );
                                      }
                                      await fetchItemStockAvailable(next);
                                    }}
                                    placeholder={
                                      itemsLoading
                                        ? "Loading items..."
                                        : "Select item..."
                                    }
                                    disabled={
                                      itemsLoading || itemOptions.length === 0
                                    }
                                  />
                                </div>
                                {hasProductCategory && (
                                  <select
                                    value={categoryValue}
                                    onChange={(e) => {
                                      const nextCategory = e.target.value;
                                      setSelectedCategoryByNodeKey((prev) => ({
                                        ...prev,
                                        [key]: nextCategory,
                                      }));
                                      if (nextCategory) {
                                        const currentItemCategory =
                                          allItemsById.get(
                                            String(selectedItemId),
                                          )?.product_category || "";
                                        if (
                                          currentItemCategory !== nextCategory
                                        ) {
                                          setSelectedItemByNodeKey((prev) => ({
                                            ...prev,
                                            [key]: node.itemId,
                                          }));
                                        }
                                      }
                                    }}
                                    className="w-48 border rounded px-2 py-1 text-sm"
                                  >
                                    <option value="">
                                      All Product Categories
                                    </option>
                                    {allItemCategories.map((cat) => (
                                      <option key={cat} value={cat}>
                                        {cat.replace(/_/g, " ")}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-2 text-sm text-right text-gray-900">
                              {formatQuantity(node.requiredQuantity)}
                            </td>
                            <td
                              className="px-4 py-2 text-sm text-right text-gray-900"
                              title={stockState?.error || ""}
                            >
                              {inStockLabel}
                            </td>
                            <td
                              className={`px-4 py-2 text-sm text-right font-semibold ${
                                short > 0 ? "text-red-600" : "text-green-600"
                              }`}
                            >
                              {short > 0 ? formatQuantity(short) : "OK"}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              ) : null}

              {/* Show sub-assemblies (child BOMs) */}
              {childBoms.length > 0 ? (
                <div
                  className={
                    directItems.filter(
                      (node) => node.uidStrategy === "SERIALIZED",
                    ).length > 0
                      ? "border-t border-gray-100"
                      : ""
                  }
                >
                  {childBoms.map((childId, idx) =>
                    renderBom(childId, idx === 0),
                  )}
                </div>
              ) : null}

              {/* Show non-serialized items last */}
              {directItems.filter((node) => node.uidStrategy !== "SERIALIZED")
                .length > 0 ? (
                <table className="min-w-full border-t border-gray-100">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-20">
                        S.No
                      </th>
                      <th
                        className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                        style={{ paddingLeft: `${40 + lvl * 24}px` }}
                      >
                        Item
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase w-24">
                        Required
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase w-24">
                        In Stock
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase w-24">
                        Short
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {directItems
                      .filter((node) => node.uidStrategy !== "SERIALIZED")
                      .map((node, idx) => {
                        const key = nodeKey(node);
                        const selectedItemId = String(
                          selectedItemByNodeKey[key] || node.itemId || "",
                        ).trim();
                        const categoryValue =
                          selectedCategoryByNodeKey[key] ||
                          allItemsById.get(String(node.itemId))
                            ?.product_category ||
                          "";
                        const hasProductCategory = Boolean(
                          allItemsById.get(
                            String(selectedItemId || node.itemId),
                          )?.product_category,
                        );
                        const itemOptions = getFilteredItemOptions(
                          String(node.itemId || ""),
                          categoryValue,
                          selectedItemId,
                        );
                        const stockState = selectedItemId
                          ? stockByItemId[selectedItemId]
                          : undefined;
                        const available =
                          stockState?.available ?? node.availableQuantity;
                        const inStockLabel = stockState?.loading
                          ? "..."
                          : formatQuantity(available);
                        const requiredQty = Number(node.requiredQuantity || 0);
                        const short = Math.max(
                          0,
                          requiredQty - Number(available || 0),
                        );
                        const serial = node.sequence ?? idx + 1;
                        const lineMeta = getBomLineMeta(node, selectedItemId);

                        return (
                          <tr
                            key={`${node.bomId}:${node.itemId}:${idx}`}
                            className={`${
                              short > 0
                                ? "bg-red-50 hover:bg-red-100"
                                : "hover:bg-gray-50"
                            }`}
                          >
                            <td className="px-4 py-2 text-sm text-gray-600">
                              {serial}
                            </td>
                            <td
                              className="px-4 py-2"
                              style={{ paddingLeft: `${40 + lvl * 24}px` }}
                            >
                              <div className="flex flex-col gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Package
                                    size={14}
                                    className="text-amber-600 flex-shrink-0"
                                  />
                                  <span className="font-mono text-xs font-semibold text-[#8B4513] bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                                    {lineMeta.code}
                                  </span>
                                  {lineMeta.category ? (
                                    <span className="text-[11px] uppercase tracking-wide text-gray-600 bg-gray-100 border border-gray-200 rounded px-2 py-0.5">
                                      {lineMeta.category}
                                    </span>
                                  ) : null}
                                  {lineMeta.substituted ? (
                                    <span className="text-[11px] uppercase tracking-wide text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">
                                      Substituted
                                    </span>
                                  ) : null}
                                </div>
                                <div className="text-sm font-semibold text-gray-900 leading-snug">
                                  {lineMeta.name}
                                </div>
                                <div className="min-w-[360px] w-full">
                                  <SearchableSelect
                                    options={itemOptions}
                                    value={selectedItemId}
                                    onChange={async (value) => {
                                      const next = String(value || "");
                                      setSelectedItemByNodeKey((prev) => ({
                                        ...prev,
                                        [key]: next,
                                      }));
                                      const nextCategory =
                                        allItemsById.get(next)
                                          ?.product_category || "";
                                      if (nextCategory) {
                                        setSelectedCategoryByNodeKey(
                                          (prev) => ({
                                            ...prev,
                                            [key]: nextCategory,
                                          }),
                                        );
                                      }
                                      await fetchItemStockAvailable(next);
                                    }}
                                    placeholder={
                                      itemsLoading
                                        ? "Loading items..."
                                        : "Select item..."
                                    }
                                    disabled={
                                      itemsLoading || itemOptions.length === 0
                                    }
                                  />
                                </div>
                                {hasProductCategory && (
                                  <select
                                    value={categoryValue}
                                    onChange={(e) => {
                                      const nextCategory = e.target.value;
                                      setSelectedCategoryByNodeKey((prev) => ({
                                        ...prev,
                                        [key]: nextCategory,
                                      }));
                                      if (nextCategory) {
                                        const currentItemCategory =
                                          allItemsById.get(
                                            String(selectedItemId),
                                          )?.product_category || "";
                                        if (
                                          currentItemCategory !== nextCategory
                                        ) {
                                          setSelectedItemByNodeKey((prev) => ({
                                            ...prev,
                                            [key]: node.itemId,
                                          }));
                                        }
                                      }
                                    }}
                                    className="w-48 border rounded px-2 py-1 text-sm"
                                  >
                                    <option value="">
                                      All Product Categories
                                    </option>
                                    {allItemCategories.map((cat) => (
                                      <option key={cat} value={cat}>
                                        {cat.replace(/_/g, " ")}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-2 text-sm text-right text-gray-900">
                              {formatQuantity(node.requiredQuantity)}
                            </td>
                            <td
                              className="px-4 py-2 text-sm text-right text-gray-900"
                              title={stockState?.error || ""}
                            >
                              {inStockLabel}
                            </td>
                            <td
                              className={`px-4 py-2 text-sm text-right font-semibold ${
                                short > 0 ? "text-red-600" : "text-green-600"
                              }`}
                            >
                              {short > 0 ? formatQuantity(short) : "OK"}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              ) : null}
            </div>
          )}
        </div>
      );
    };

    const topChildren = childBomIdsByParent.get(rootBomId) || [];
    const rootDirectItems = itemNodesByBomId.get(rootBomId) || [];
    const rootSerializedItems = rootDirectItems.filter(
      (node) => node.uidStrategy === "SERIALIZED",
    );
    const rootNonSerializedItems = rootDirectItems.filter(
      (node) => node.uidStrategy !== "SERIALIZED",
    );

    if (!topChildren.length && itemNodes.length) {
      // Fallback: show root with items if there are no BOM nodes.
      return renderBom(rootBomId, true);
    }

    return (
      <div>
        {rootSerializedItems.length > 0 ? (
          <table className="min-w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-20">
                  S.No
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  Item (Serial Number)
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase w-24">
                  Required
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase w-24">
                  In Stock
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase w-24">
                  Short
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rootSerializedItems.map((node, idx) => {
                const key = nodeKey(node);
                const selectedItemId = String(
                  selectedItemByNodeKey[key] || node.itemId || "",
                ).trim();
                const categoryValue =
                  selectedCategoryByNodeKey[key] ||
                  allItemsById.get(String(node.itemId))?.product_category ||
                  "";
                const hasProductCategory = Boolean(
                  allItemsById.get(String(selectedItemId || node.itemId))
                    ?.product_category,
                );
                const itemOptions = getFilteredItemOptions(
                  String(node.itemId || ""),
                  categoryValue,
                  selectedItemId,
                );
                const stockState = selectedItemId
                  ? stockByItemId[selectedItemId]
                  : undefined;
                const available =
                  stockState?.available ?? node.availableQuantity;
                const inStockLabel = stockState?.loading
                  ? "..."
                  : formatQuantity(available);
                const requiredQty = Number(node.requiredQuantity || 0);
                const short = Math.max(0, requiredQty - Number(available || 0));
                const serial = node.sequence ?? idx + 1;
                const lineMeta = getBomLineMeta(node, selectedItemId);

                return (
                  <tr
                    key={`${node.bomId}:${node.itemId}:${idx}`}
                    className={`${short > 0 ? "bg-red-50 hover:bg-red-100" : "hover:bg-gray-50"}`}
                  >
                    <td className="px-4 py-2 text-sm text-gray-600">
                      {serial}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Package
                            size={14}
                            className="text-amber-600 flex-shrink-0"
                          />
                          <span className="font-mono text-xs font-semibold text-[#8B4513] bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                            {lineMeta.code}
                          </span>
                          {lineMeta.category ? (
                            <span className="text-[11px] uppercase tracking-wide text-gray-600 bg-gray-100 border border-gray-200 rounded px-2 py-0.5">
                              {lineMeta.category}
                            </span>
                          ) : null}
                          {lineMeta.substituted ? (
                            <span className="text-[11px] uppercase tracking-wide text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">
                              Substituted
                            </span>
                          ) : null}
                        </div>
                        <div className="text-sm font-semibold text-gray-900 leading-snug">
                          {lineMeta.name}
                        </div>
                        <div className="min-w-[360px] w-full">
                          <SearchableSelect
                            options={itemOptions}
                            value={selectedItemId}
                            onChange={async (value) => {
                              const next = String(value || "");
                              setSelectedItemByNodeKey((prev) => ({
                                ...prev,
                                [key]: next,
                              }));
                              const nextCategory =
                                allItemsById.get(next)?.product_category || "";
                              if (nextCategory) {
                                setSelectedCategoryByNodeKey((prev) => ({
                                  ...prev,
                                  [key]: nextCategory,
                                }));
                              }
                              await fetchItemStockAvailable(next);
                            }}
                            placeholder={
                              itemsLoading
                                ? "Loading items..."
                                : "Select item..."
                            }
                            disabled={itemsLoading || itemOptions.length === 0}
                          />
                        </div>
                        {hasProductCategory && (
                          <select
                            value={categoryValue}
                            onChange={(e) => {
                              const nextCategory = e.target.value;
                              setSelectedCategoryByNodeKey((prev) => ({
                                ...prev,
                                [key]: nextCategory,
                              }));
                              if (nextCategory) {
                                const currentItemCategory =
                                  allItemsById.get(String(selectedItemId))
                                    ?.product_category || "";
                                if (currentItemCategory !== nextCategory) {
                                  setSelectedItemByNodeKey((prev) => ({
                                    ...prev,
                                    [key]: String(node.itemId || ""),
                                  }));
                                }
                              }
                            }}
                            className="w-48 border rounded px-2 py-1 text-sm"
                          >
                            <option value="">All Product Categories</option>
                            {allItemCategories.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat.replace(/_/g, " ")}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-sm text-right text-gray-900">
                      {formatQuantity(node.requiredQuantity)}
                    </td>
                    <td
                      className="px-4 py-2 text-sm text-right text-gray-900"
                      title={stockState?.error || ""}
                    >
                      {inStockLabel}
                    </td>
                    <td
                      className={`px-4 py-2 text-sm text-right font-semibold ${
                        short > 0 ? "text-red-600" : "text-green-600"
                      }`}
                    >
                      {short > 0 ? formatQuantity(short) : "OK"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}

        {topChildren.map((id, idx) => renderBom(id, idx === 0))}

        {rootNonSerializedItems.length > 0 ? (
          <table className="min-w-full border-t border-gray-100">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-20">
                  S.No
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  Item
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase w-24">
                  Required
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase w-24">
                  In Stock
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase w-24">
                  Short
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rootNonSerializedItems.map((node, idx) => {
                const key = nodeKey(node);
                const selectedItemId = String(
                  selectedItemByNodeKey[key] || node.itemId || "",
                ).trim();
                const categoryValue =
                  selectedCategoryByNodeKey[key] ||
                  allItemsById.get(String(node.itemId))?.product_category ||
                  "";
                const hasProductCategory = Boolean(
                  allItemsById.get(String(selectedItemId || node.itemId))
                    ?.product_category,
                );
                const itemOptions = getFilteredItemOptions(
                  String(node.itemId || ""),
                  categoryValue,
                  selectedItemId,
                );
                const stockState = selectedItemId
                  ? stockByItemId[selectedItemId]
                  : undefined;
                const available =
                  stockState?.available ?? node.availableQuantity;
                const inStockLabel = stockState?.loading
                  ? "..."
                  : formatQuantity(available);
                const requiredQty = Number(node.requiredQuantity || 0);
                const short = Math.max(0, requiredQty - Number(available || 0));
                const serial = node.sequence ?? idx + 1;
                const lineMeta = getBomLineMeta(node, selectedItemId);

                return (
                  <tr
                    key={`${node.bomId}:${node.itemId}:${idx}`}
                    className={`${short > 0 ? "bg-red-50 hover:bg-red-100" : "hover:bg-gray-50"}`}
                  >
                    <td className="px-4 py-2 text-sm text-gray-600">
                      {serial}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Package
                            size={14}
                            className="text-amber-600 flex-shrink-0"
                          />
                          <span className="font-mono text-xs font-semibold text-[#8B4513] bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                            {lineMeta.code}
                          </span>
                          {lineMeta.category ? (
                            <span className="text-[11px] uppercase tracking-wide text-gray-600 bg-gray-100 border border-gray-200 rounded px-2 py-0.5">
                              {lineMeta.category}
                            </span>
                          ) : null}
                          {lineMeta.substituted ? (
                            <span className="text-[11px] uppercase tracking-wide text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">
                              Substituted
                            </span>
                          ) : null}
                        </div>
                        <div className="text-sm font-semibold text-gray-900 leading-snug">
                          {lineMeta.name}
                        </div>
                        <div className="min-w-[360px] w-full">
                          <SearchableSelect
                            options={itemOptions}
                            value={selectedItemId}
                            onChange={async (value) => {
                              const next = String(value || "");
                              setSelectedItemByNodeKey((prev) => ({
                                ...prev,
                                [key]: next,
                              }));
                              const nextCategory =
                                allItemsById.get(next)?.product_category || "";
                              if (nextCategory) {
                                setSelectedCategoryByNodeKey((prev) => ({
                                  ...prev,
                                  [key]: nextCategory,
                                }));
                              }
                              await fetchItemStockAvailable(next);
                            }}
                            placeholder={
                              itemsLoading
                                ? "Loading items..."
                                : "Select item..."
                            }
                            disabled={itemsLoading || itemOptions.length === 0}
                          />
                        </div>
                        {hasProductCategory && (
                          <select
                            value={categoryValue}
                            onChange={(e) => {
                              const nextCategory = e.target.value;
                              setSelectedCategoryByNodeKey((prev) => ({
                                ...prev,
                                [key]: nextCategory,
                              }));
                              if (nextCategory) {
                                const currentItemCategory =
                                  allItemsById.get(String(selectedItemId))
                                    ?.product_category || "";
                                if (currentItemCategory !== nextCategory) {
                                  setSelectedItemByNodeKey((prev) => ({
                                    ...prev,
                                    [key]: String(node.itemId || ""),
                                  }));
                                }
                              }
                            }}
                            className="w-48 border rounded px-2 py-1 text-sm"
                          >
                            <option value="">All Product Categories</option>
                            {allItemCategories.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat.replace(/_/g, " ")}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-sm text-right text-gray-900">
                      {formatQuantity(node.requiredQuantity)}
                    </td>
                    <td
                      className="px-4 py-2 text-sm text-right text-gray-900"
                      title={stockState?.error || ""}
                    >
                      {inStockLabel}
                    </td>
                    <td
                      className={`px-4 py-2 text-sm text-right font-semibold ${
                        short > 0 ? "text-red-600" : "text-green-600"
                      }`}
                    >
                      {short > 0 ? formatQuantity(short) : "OK"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </div>
    );
  };

  if (!mounted || !canCreate) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#FAF9F6] to-[#E8DCC4] p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6 rounded-xl border border-[#E8DCC4] bg-white shadow-sm">
          <div className="flex flex-col gap-4 border-b border-[#E8DCC4] px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#D8C8AA] bg-[#FFF8E8] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
                <ClipboardList className="h-3.5 w-3.5" />
                Production Planning
              </div>
              <h1 className="text-3xl font-bold text-[#2F241D]">
                Create Job Order
              </h1>
              <p className="mt-1 max-w-3xl text-sm text-[#6F4E37]">
                {headerSubtitle}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={async () => {
                  const shouldClear = await confirmDialog({
                    title: "Clear Planning Workspace",
                    message:
                      "Clear this planning workspace? You will need to reload the BOM.",
                    confirmLabel: "Clear",
                    cancelLabel: "Cancel",
                    variant: "warning",
                  });
                  if (shouldClear) {
                    try {
                      localStorage.removeItem(CACHE_KEY);
                      setPreview(null);
                      setSelectedItemByNodeKey({});
                      setSelectedCategoryByNodeKey({});
                      setStockByItemId({});
                      setExpandedBoms(new Set());
                      setItemId("");
                      setQuantity(1);
                      setPreviewError("");
                    } catch (e) {}
                  }
                }}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#D8C8AA] bg-white px-4 text-sm font-semibold text-[#5E4635] hover:bg-[#F5EFE3]"
                title="Clear cached planning data"
              >
                <RefreshCw className="h-4 w-4" />
                Clear
              </button>
              <button
                onClick={fetchPreview}
                disabled={!canPreview || loadingPreview}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#8B6F47] px-5 text-sm font-semibold text-white shadow-sm hover:bg-[#6F4E37] disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                <Search className="h-4 w-4" />
                {loadingPreview
                  ? "Loading..."
                  : preview
                    ? "Reload BOM"
                    : "Load BOM"}
              </button>
            </div>
          </div>

          <div className="grid gap-px bg-[#E8DCC4] text-sm md:grid-cols-3">
            {[
              [
                "1",
                "Choose output",
                "Select the finished good and quantity to make.",
              ],
              [
                "2",
                "Check readiness",
                "Mizantra reads the approved BOM, stock and shortages.",
              ],
              [
                "3",
                "Create the work",
                "Create one controlled job order; purchasing follows only for shortages.",
              ],
            ].map(([step, title, helper]) => (
              <div key={step} className="bg-[#FFFDF8] p-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#8B6F47] text-xs font-bold text-white">
                    {step}
                  </span>
                  <span className="font-bold text-[#4A3426]">{title}</span>
                </div>
                <p className="text-xs text-[#7A6555]">{helper}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-[#E8DCC4] bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-1">
            <h2 className="text-lg font-bold text-[#2F241D]">Planning Input</h2>
            <p className="text-sm text-[#7A6555]">
              Choose what to make and how many. Mizantra uses the approved BOM
              to check stock, child work and purchase gaps.
            </p>
          </div>

          <div className="grid grid-cols-12 gap-4 items-end">
            <div className="col-span-12 lg:col-span-9">
              <label className="block text-xs font-bold uppercase tracking-wide text-[#5E4635] mb-2">
                Product to make *
              </label>
              <SearchableSelect
                options={finishedGoodsOptions}
                value={itemId}
                onChange={(value) => {
                  setItemId(value);
                  setPreview(null);
                }}
                placeholder={
                  itemsLoading
                    ? "Loading items..."
                    : "Search item code, name, or category..."
                }
                truncateInput={false}
                dropdownClassName="min-w-[32rem] max-w-[90vw]"
                required
                disabled={itemsLoading}
              />
              <p className="mt-2 text-xs text-[#7A6555]">
                Select the product you need. Mizantra brings in its approved
                intermediate parts and material requirements automatically.
              </p>
              {itemsError ? (
                <div className="mt-2 text-xs text-red-700">{itemsError}</div>
              ) : null}
            </div>
            <div className="col-span-12 sm:col-span-6 lg:col-span-3">
              <label className="block text-xs font-bold uppercase tracking-wide text-[#5E4635] mb-2">
                Quantity *
              </label>
              <input
                type="number"
                value={quantity}
                min={1}
                onChange={(e) => {
                  setQuantity(Number(e.target.value || 0));
                  setPreview(null);
                }}
                className="min-h-11 w-full rounded-lg border border-[#D8C8AA] px-4 py-2 text-sm text-[#2F241D] focus:border-[#8B6F47] focus:ring-2 focus:ring-[#8B6F47]/20"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowSalesOrderMapping((value) => !value)}
            className="mt-4 text-sm font-semibold text-[#6F4E37] underline decoration-[#D8C8AA] underline-offset-4 hover:text-[#2F241D]"
          >
            {showSalesOrderMapping
              ? "Hide sales-order link"
              : "Link this job order to a sales order (optional)"}
          </button>

          {showSalesOrderMapping ? (
            <div className="mt-3 grid grid-cols-12 gap-4 rounded-lg border border-[#E8DCC4] bg-[#FFFDF8] p-4">
              <div className="col-span-12 lg:col-span-6">
                <label className="block text-xs font-bold uppercase tracking-wide text-[#5E4635] mb-2">
                  Sales Order
                </label>
                <select
                  value={mappedSalesOrderId}
                  onChange={(e) => {
                    setMappedSalesOrderId(e.target.value);
                    setMappedSalesOrderItemId("");
                    setPreview(null);
                  }}
                  className="min-h-11 w-full rounded-lg border border-[#D8C8AA] bg-white px-3 py-2 text-sm text-[#2F241D] focus:border-[#8B6F47] focus:ring-2 focus:ring-[#8B6F47]/20"
                  disabled={loadingOpenSalesOrders}
                >
                  <option value="">Choose sales order</option>
                  {openSalesOrders.map((so) => (
                    <option key={so.id} value={so.id}>
                      {so.soNumber} - {so.customerName || "Customer"} (
                      {so.status})
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-span-12 lg:col-span-6">
                <label className="block text-xs font-bold uppercase tracking-wide text-[#5E4635] mb-2">
                  Sales Order Item
                </label>
                <select
                  value={mappedSalesOrderItemId}
                  onChange={(e) => {
                    setMappedSalesOrderItemId(e.target.value);
                    setPreview(null);
                  }}
                  className="min-h-11 w-full rounded-lg border border-[#D8C8AA] bg-white px-3 py-2 text-sm text-[#2F241D] focus:border-[#8B6F47] focus:ring-2 focus:ring-[#8B6F47]/20"
                  disabled={!mappedSalesOrderId || loadingSalesOrderItems}
                >
                  <option value="">Choose order item</option>
                  {salesOrderItems.map((soItem) => (
                    <option key={soItem.id} value={soItem.id}>
                      {soItem.itemLabel} | Open{" "}
                      {formatQuantity(soItem.remainingQty)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}

          {selectedSalesOrderItem ? (
            <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              <span className="font-semibold">SO reservation:</span> Blocked{" "}
              {formatQuantity(selectedSalesOrderItem.blockedQty)} · Open{" "}
              {formatQuantity(selectedSalesOrderItem.remainingQty)}
            </div>
          ) : null}

          {preview ? (
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                <div className="text-xs font-bold uppercase tracking-wide text-emerald-800">
                  Can Make Now
                </div>
                <div className="mt-1 text-2xl font-bold text-emerald-900">
                  {formatQuantity(preview.makeNowQuantity || 0)}
                </div>
                <div className="text-xs text-emerald-700">
                  out of {formatQuantity(preview.quantity)} requested
                </div>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="text-xs font-bold uppercase tracking-wide text-amber-800">
                  Shortage to Target
                </div>
                <div className="mt-1 text-2xl font-bold text-amber-900">
                  {formatQuantity(preview.shortageToTargetQuantity || 0)}
                </div>
                <div className="text-xs text-amber-700">
                  one master PR planned when needed
                </div>
              </div>
              <div className="rounded-lg border border-[#E8DCC4] bg-[#FFFDF8] px-4 py-3">
                <div className="text-xs font-bold uppercase tracking-wide text-[#7A6555]">
                  BOM Status
                </div>
                <div className="mt-1 text-lg font-bold text-[#4A3426]">
                  {preview.topBom?.is_active ? "Active BOM" : "Inactive BOM"}
                </div>
                <div className="text-xs text-[#7A6555]">
                  v{preview.topBom?.version || "-"}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {previewError ? (
          <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
            {previewError}
          </div>
        ) : null}

        {loadingPreview && (
          <div className="mt-6 p-6 rounded-lg border border-[#E8DCC4] bg-[#FAF9F6]">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-lg font-semibold text-[#36454F]">
                  {loadingMessage}
                </span>
                <span className="text-sm font-medium text-[#6F4E37]">
                  {Math.min(99, Math.floor(loadingProgress))}% ·{" "}
                  {loadingElapsedSeconds}s
                </span>
              </div>
              <div className="w-full bg-[#E8DCC4] rounded-full h-3 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-[#8B6F47] to-[#6F4E37] h-3 rounded-full transition-all duration-500 ease-linear"
                  style={{ width: `${loadingProgress}%` }}
                />
              </div>
              <div className="flex items-center justify-center text-[#6F4E37] text-sm">
                <svg
                  className="animate-spin h-5 w-5 mr-2"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                {loadingElapsedSeconds > 20
                  ? "Large BOM detected. Still calculating shortages, stock and sub-assembly demand..."
                  : "Processing BOM expansion..."}
              </div>
              {loadingElapsedSeconds > 45 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  This is taking longer than usual. If it fails, review
                  duplicate/circular BOM links or very deep sub-assemblies.
                </div>
              ) : null}
            </div>
          </div>
        )}

        {preview ? (
          <>
            <div className="mt-6 rounded-xl border border-[#E8DCC4] bg-white shadow-sm">
              <div className="border-b border-[#E8DCC4] bg-[#FFF8E8] px-5 py-3">
                <h2 className="text-base font-bold text-[#2F241D]">
                  BOM Summary
                </h2>
                <p className="text-xs text-[#7A6555]">
                  Selected output, requested quantity, and active routing
                  source.
                </p>
              </div>
              <div className="grid gap-4 p-5 md:grid-cols-3">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-[#7A6555]">
                    Output Item
                  </div>
                  <div className="mt-1 font-semibold text-[#2F241D]">
                    {preview.finishedItem.code} - {preview.finishedItem.name}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-[#7A6555]">
                    Job Quantity
                  </div>
                  <div className="mt-1 text-xl font-bold text-[#2F241D]">
                    {preview.quantity}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-[#7A6555]">
                    BOM Version
                  </div>
                  <div className="mt-1 font-semibold text-[#2F241D]">
                    v{preview.topBom.version}{" "}
                    {preview.topBom.is_active ? "(Active)" : ""}
                  </div>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowStructureDetails((value) => !value)}
              className="mt-6 w-full rounded-xl border border-[#D8C8AA] bg-[#FFF8E8] px-5 py-3 text-left text-sm font-semibold text-[#5E4635] hover:bg-[#F5EFE3]"
            >
              {showStructureDetails
                ? "Hide detailed material and sub-assembly plan"
                : "Review detailed material and sub-assembly plan (optional)"}
            </button>

            {showStructureDetails && preview.subAssembliesToMake?.length ? (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h3 className="text-lg font-bold text-[#2F241D]">
                      Sub-assemblies to Auto-Make
                    </h3>
                    <p className="text-sm text-[#7A6555]">
                      Ready sub-assemblies can be converted into child job
                      orders in bulk.
                    </p>
                  </div>
                  {(() => {
                    const readyCount = getReadySubAssemblies().length;
                    const selectedCount = preview.subAssembliesToMake.filter(
                      (sa) => selectedSABatchKeys.has(getSAKey(sa)),
                    ).length;
                    const allReadySelected =
                      readyCount > 0 &&
                      getReadySubAssemblies().every((sa) =>
                        selectedSABatchKeys.has(getSAKey(sa)),
                      );
                    return (
                      <div className="flex items-center gap-3">
                        {readyCount > 0 ? (
                          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              checked={allReadySelected}
                              onChange={toggleSelectAllReadySAs}
                              className="h-4 w-4"
                            />
                            Select All Ready ({readyCount})
                          </label>
                        ) : null}
                        <button
                          onClick={openSelectedSAPrompt}
                          disabled={creatingSAJobs || selectedCount === 0}
                          className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M13 10V3L4 14h7v7l9-11h-7z"
                            />
                          </svg>
                          Create JO for Selected ({selectedCount})
                        </button>
                      </div>
                    );
                  })()}
                </div>
                <div className="overflow-hidden rounded-xl border border-[#E8DCC4] bg-white shadow-sm">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-[#F5EFE3]">
                      <tr>
                        <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wide text-[#5E4635] w-16">
                          Sel
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#5E4635] w-20">
                          S.No
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#5E4635]">
                          Item
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#5E4635]">
                          Required
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#5E4635]">
                          In Stock
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#5E4635]">
                          To Make
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wide text-[#5E4635] w-24">
                          Decision
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {(() => {
                        // Build hierarchical serial numbers (1, 1.1, 1.2, 2, 2.1...)
                        // using parentBomId from the explosion nodes
                        const bomParentMap = new Map<string, string>();
                        for (const node of preview.nodes || []) {
                          if (
                            node.componentType === "BOM" &&
                            node.parentBomId
                          ) {
                            bomParentMap.set(node.bomId, node.parentBomId);
                          }
                        }
                        const saBomIdSet = new Set(
                          (preview.subAssembliesToMake || []).map(
                            (sa) => sa.bomId,
                          ),
                        );
                        const saChildrenOf = new Map<string | null, string[]>();
                        for (const sa of preview.subAssembliesToMake || []) {
                          const parentBomId = bomParentMap.get(sa.bomId);
                          const parentKey =
                            parentBomId && saBomIdSet.has(parentBomId)
                              ? parentBomId
                              : null;
                          if (!saChildrenOf.has(parentKey))
                            saChildrenOf.set(parentKey, []);
                          const ch = saChildrenOf.get(parentKey)!;
                          if (!ch.includes(sa.bomId)) ch.push(sa.bomId);
                        }
                        const saSerialNum = new Map<string, string>();
                        const assignNums = (
                          parentKey: string | null,
                          prefix: string,
                        ) => {
                          (saChildrenOf.get(parentKey) || []).forEach(
                            (bomId, i) => {
                              const num = prefix
                                ? `${prefix}.${i + 1}`
                                : `${i + 1}`;
                              saSerialNum.set(bomId, num);
                              assignNums(bomId, num);
                            },
                          );
                        };
                        assignNums(null, "");

                        return preview.subAssembliesToMake.map((sa, idx) => {
                          const ready = isSubAssemblyReady(sa.bomId);
                          const selected = selectedSABatchKeys.has(
                            getSAKey(sa),
                          );
                          const shortageQty = Math.max(
                            0,
                            (Number(sa.requiredQuantity || 0) || 0) -
                              getAvailableForItemId(
                                String(sa.itemId || ""),
                                Number(sa.availableQuantity || 0) || 0,
                              ),
                          );
                          return (
                            <tr
                              key={`${sa.bomId}:${sa.itemId}`}
                              className={ready ? "bg-green-50" : ""}
                            >
                              <td className="px-4 py-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={() => toggleSASelection(sa)}
                                  disabled={!ready || creatingSAJobs}
                                  className="h-4 w-4"
                                />
                              </td>
                              <td className="px-4 py-2 text-sm text-gray-600">
                                {saSerialNum.get(sa.bomId) ?? idx + 1}
                              </td>
                              <td className="px-4 py-2 text-sm text-gray-900">
                                {sa.itemCode} - {sa.itemName}
                              </td>
                              <td className="px-4 py-2 text-sm text-right text-gray-900">
                                {sa.requiredQuantity}
                              </td>
                              <td className="px-4 py-2 text-sm text-right text-gray-900">
                                {sa.availableQuantity}
                              </td>
                              <td className="px-4 py-2 text-sm text-right font-semibold text-amber-700">
                                {sa.toMakeQuantity}
                              </td>
                              <td className="px-4 py-2 text-center">
                                {ready ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                    Ready
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                                    Short {formatQuantity(shortageQty)}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {showStructureDetails
              ? (() => {
                  const autoMakeItemIds = new Set(
                    (preview.subAssembliesToMake || []).map((sa) =>
                      String(sa.itemId),
                    ),
                  );
                  const shortageRows = groupShortagesByItem(
                    preview.nodes || [],
                    autoMakeItemIds,
                  );
                  const itemLines = (preview.nodes || []).filter(
                    (node) => node.componentType === "ITEM",
                  );
                  const readyLines = itemLines.filter((node) => {
                    const selectedItemId = effectiveSelectedItemId(node);
                    if (!selectedItemId || autoMakeItemIds.has(selectedItemId))
                      return false;
                    const available = getAvailableForItemId(
                      selectedItemId,
                      Number(node.availableQuantity || 0) || 0,
                    );
                    return (
                      Number(available || 0) >=
                      Number(node.requiredQuantity || 0)
                    );
                  }).length;
                  const subAssemblyCount =
                    preview.subAssembliesToMake?.length || 0;
                  const hasPurchaseShortage = shortageRows.length > 0;
                  const nextAction = hasPurchaseShortage
                    ? "Create JO tree + master PR"
                    : subAssemblyCount > 0
                      ? "Create JO + child sub-assembly JOs"
                      : "Create JO for SIV issue";
                  const nextOwner = hasPurchaseShortage
                    ? "Purchase team"
                    : subAssemblyCount > 0
                      ? "Production planner"
                      : "Stores";
                  const nextInstruction = hasPurchaseShortage
                    ? "Review the consolidated master PR, then complete PR -> PO -> GRN for unavailable material; available stock can still be issued by Stores."
                    : subAssemblyCount > 0
                      ? "Create/complete the required child job orders, then issue material and receive output."
                      : "Issue components by SIV, start production, receive finished goods by SRV, then complete QC.";

                  return (
                    <div className="mt-6 rounded-xl border border-[#E8DCC4] bg-white shadow-sm">
                      <div className="border-b border-[#E8DCC4] bg-[#FFF8E8] px-5 py-3">
                        <h3 className="text-base font-bold text-[#2F241D]">
                          Production Control Checkpoint
                        </h3>
                        <p className="text-xs text-[#7A6555]">
                          Review the SAP-style handoff before creating the job
                          order.
                        </p>
                      </div>
                      <div className="grid gap-px bg-[#E8DCC4] md:grid-cols-4">
                        <div className="bg-white p-4">
                          <div className="text-xs font-bold uppercase tracking-wide text-[#7A6555]">
                            SIV-ready Lines
                          </div>
                          <div className="mt-1 text-2xl font-bold text-emerald-700">
                            {readyLines}
                          </div>
                          <div className="text-xs text-[#7A6555]">
                            components available for store issue
                          </div>
                        </div>
                        <div className="bg-white p-4">
                          <div className="text-xs font-bold uppercase tracking-wide text-[#7A6555]">
                            Purchase Shortages
                          </div>
                          <div
                            className={`mt-1 text-2xl font-bold ${hasPurchaseShortage ? "text-amber-700" : "text-emerald-700"}`}
                          >
                            {shortageRows.length}
                          </div>
                          <div className="text-xs text-[#7A6555]">
                            grouped by item and preferred vendor
                          </div>
                        </div>
                        <div className="bg-white p-4">
                          <div className="text-xs font-bold uppercase tracking-wide text-[#7A6555]">
                            Child Sub-JOs
                          </div>
                          <div
                            className={`mt-1 text-2xl font-bold ${subAssemblyCount > 0 ? "text-blue-700" : "text-[#4A3426]"}`}
                          >
                            {subAssemblyCount}
                          </div>
                          <div className="text-xs text-[#7A6555]">
                            sub-assemblies planned separately when needed
                          </div>
                        </div>
                        <div className="bg-white p-4">
                          <div className="text-xs font-bold uppercase tracking-wide text-[#7A6555]">
                            Next Control
                          </div>
                          <div className="mt-1 text-sm font-bold text-[#4A3426]">
                            {nextAction}
                          </div>
                          <div className="mt-1 text-xs text-[#7A6555]">
                            Owner: {nextOwner}
                          </div>
                        </div>
                      </div>
                      <div className="border-t border-[#E8DCC4] bg-[#FAF9F6] px-5 py-3 text-sm text-[#5E4635]">
                        <span className="font-semibold text-[#2F241D]">
                          System action:
                        </span>{" "}
                        {nextInstruction}
                      </div>
                    </div>
                  );
                })()
              : null}

            {showStructureDetails ? (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-gray-900">
                    BOM Expansion
                  </h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        const allBomIds = [
                          preview.topBom.id,
                          ...preview.nodes
                            .filter((n) => n.componentType === "BOM")
                            .map((n) => n.bomId),
                        ];
                        setExpandedBoms(new Set(allBomIds));
                      }}
                      className="px-3 py-1 text-xs rounded border border-amber-300 text-amber-700 hover:bg-amber-50"
                    >
                      Expand All
                    </button>
                    <button
                      onClick={() => setExpandedBoms(new Set())}
                      className="px-3 py-1 text-xs rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                    >
                      Collapse All
                    </button>
                  </div>
                </div>
                <div
                  className="bg-white border border-gray-200 rounded-lg overflow-hidden max-h-[500px] overflow-y-scroll"
                  style={{
                    scrollbarWidth: "thin",
                    scrollbarColor: "#d97706 #f3f4f6",
                  }}
                >
                  {renderExplosionTree()}
                </div>
              </div>
            ) : null}

            <div
              id="job-order-action"
              className="mt-6 sticky bottom-0 bg-white border-t-2 border-amber-200 shadow-lg rounded-lg"
            >
              {(() => {
                const autoMakeItemIds = new Set(
                  (preview.subAssembliesToMake || []).map((sa) =>
                    String(sa.itemId),
                  ),
                );
                const rawMaterialShortages = groupShortagesByItem(
                  preview.nodes || [],
                  autoMakeItemIds,
                );

                const rawMaterialComponentLines = (preview.nodes || []).filter(
                  (n) => {
                    if (n?.componentType !== "ITEM") return false;
                    const selectedItemId = effectiveSelectedItemId(n);
                    if (!selectedItemId) return false;
                    if (autoMakeItemIds.has(selectedItemId)) return false;
                    const required = Number(n.requiredQuantity || 0) || 0;
                    return required > 0;
                  },
                ).length;

                // For the banner count only: count unique auto-make sub-assembly items that are short.
                const subAssemblyShortageItemIds = new Set<string>();
                for (const sa of preview.subAssembliesToMake || []) {
                  const id = String(sa?.itemId || "").trim();
                  if (!id) continue;
                  const available = getAvailableForItemId(
                    id,
                    Number(sa.availableQuantity || 0) || 0,
                  );
                  const required = Number(sa.requiredQuantity || 0) || 0;
                  if (required > available) subAssemblyShortageItemIds.add(id);
                }
                const subAssemblyShortagesCount =
                  subAssemblyShortageItemIds.size;

                if (rawMaterialShortages.length > 0) {
                  return (
                    <div className="p-4">
                      <div
                        className="flex items-center justify-between cursor-pointer hover:bg-amber-50 p-2 rounded transition-colors"
                        onClick={() =>
                          setShowShortageDetails(!showShortageDetails)
                        }
                      >
                        <div className="flex items-center gap-2 text-amber-800 font-semibold">
                          <svg
                            className="w-5 h-5"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                              clipRule="evenodd"
                            />
                          </svg>
                          <span>
                            Stock exception: {rawMaterialShortages.length} raw
                            material{rawMaterialShortages.length > 1 ? "s" : ""}{" "}
                            need purchase planning.
                            <span className="ml-2 text-xs font-normal text-amber-700">
                              (grouped from {rawMaterialComponentLines}{" "}
                              component line
                              {rawMaterialComponentLines !== 1 ? "s" : ""})
                            </span>
                          </span>
                        </div>
                        <svg
                          className={`w-5 h-5 text-amber-800 transition-transform ${showShortageDetails ? "rotate-180" : ""}`}
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </div>

                      {showShortageDetails && (
                        <div className="mt-4 border-t border-amber-200 pt-4">
                          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                            Job Order can still be created. The system will
                            generate one linked master shortage PR for the full
                            parent-and-child BOM. Repeated items are combined
                            into one PR line; available stock remains ready for
                            SIV issue.
                          </div>
                          <div className="flex items-center gap-2 mb-3">
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  const lines = rawMaterialShortages
                                    .map((row) => {
                                      return `${row.itemCode} | Required: ${formatQuantity(row.requiredQuantity)} | InStock: ${formatQuantity(row.availableQuantity)} | Short: ${formatQuantity(row.shortageQuantity)}`;
                                    })
                                    .join("\n");
                                  await navigator.clipboard.writeText(lines);
                                  await confirmDialog({
                                    title: "Copied",
                                    message:
                                      "Grouped shortage list copied to clipboard.",
                                    confirmLabel: "OK",
                                    cancelLabel: "Close",
                                    variant: "info",
                                  });
                                } catch {
                                  await confirmDialog({
                                    title: "Copy Failed",
                                    message:
                                      "Could not copy the shortage list to clipboard.",
                                    confirmLabel: "OK",
                                    cancelLabel: "Close",
                                    variant: "warning",
                                  });
                                }
                              }}
                              className="px-3 py-1.5 text-xs rounded border border-amber-300 text-amber-800 hover:bg-amber-50"
                            >
                              Copy List
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const header = [
                                  "Item Code",
                                  "Item Name",
                                  "Required",
                                  "In Stock",
                                  "Shortage",
                                ]
                                  .map(escapeCsv)
                                  .join(",");
                                const rows = rawMaterialShortages
                                  .map((row) => {
                                    return [
                                      escapeCsv(row.itemCode),
                                      escapeCsv(row.itemName),
                                      escapeCsv(row.requiredQuantity),
                                      escapeCsv(row.availableQuantity),
                                      escapeCsv(row.shortageQuantity),
                                    ].join(",");
                                  })
                                  .join("\n");
                                const csv = `${header}\n${rows}\n`;
                                const name = `shortages_${preview.finishedItem?.code || "job_order"}.csv`;
                                downloadCsv(name, csv);
                              }}
                              className="px-3 py-1.5 text-xs rounded border border-amber-300 text-amber-800 hover:bg-amber-50"
                            >
                              Download CSV
                            </button>
                          </div>
                          <div className="max-h-60 overflow-y-auto mb-4">
                            <table className="min-w-full text-sm">
                              <thead className="bg-amber-50">
                                <tr>
                                  <th className="px-3 py-2 text-left text-xs font-medium text-amber-900">
                                    Item
                                  </th>
                                  <th className="px-3 py-2 text-right text-xs font-medium text-amber-900">
                                    Required
                                  </th>
                                  <th className="px-3 py-2 text-right text-xs font-medium text-amber-900">
                                    In Stock
                                  </th>
                                  <th className="px-3 py-2 text-right text-xs font-medium text-amber-900">
                                    Shortage
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-amber-100">
                                {rawMaterialShortages.map((row, idx) => {
                                  return (
                                    <tr key={idx} className="hover:bg-amber-50">
                                      <td className="px-3 py-2 text-gray-900">
                                        <div className="font-medium">
                                          {row.itemCode}
                                        </div>
                                        <div className="text-xs text-gray-600">
                                          {row.itemName}
                                        </div>
                                      </td>
                                      <td className="px-3 py-2 text-right text-gray-900">
                                        {formatQuantity(row.requiredQuantity)}
                                      </td>
                                      <td className="px-3 py-2 text-right text-gray-900">
                                        {formatQuantity(row.availableQuantity)}
                                      </td>
                                      <td className="px-3 py-2 text-right font-semibold text-amber-800">
                                        {formatQuantity(row.shortageQuantity)}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePurchaseShortageItems();
                            }}
                            disabled={creatingPR || creating}
                            className="w-full px-4 py-2 bg-[#8B6F47] hover:bg-[#6F4E37] text-white font-semibold rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                          >
                            {creatingPR || creating
                              ? "Creating Job Order and linked PR..."
                              : "Create JO + linked shortage PR"}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                } else {
                  return (
                    <div className="p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="text-sm text-gray-700">
                        {subAssemblyShortagesCount > 0 ? (
                          <span className="flex items-center gap-2 text-amber-700 font-semibold">
                            <svg
                              className="w-5 h-5"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                                clipRule="evenodd"
                              />
                            </svg>
                            {subAssemblyShortagesCount} sub-assembl
                            {subAssemblyShortagesCount > 1 ? "ies" : "y"} need
                            child JO planning before final completion
                          </span>
                        ) : (
                          <div>
                            <span className="flex items-center gap-2 text-green-700 font-semibold">
                              <svg
                                className="w-5 h-5"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                  clipRule="evenodd"
                                />
                              </svg>
                              All materials available in stock
                            </span>
                            <div className="mt-1 text-xs text-gray-500">
                              Next: create JO, issue SIV, receive SRV, then QC
                              release.
                            </div>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          void handleCreate();
                        }}
                        disabled={creating || !canPreview}
                        className={`px-6 py-3 rounded-lg font-semibold text-white transition-colors ${
                          creating || !canPreview
                            ? "bg-gray-400 cursor-not-allowed"
                            : "bg-[#8B6F47] hover:bg-[#6F4E37] shadow-md hover:shadow-lg"
                        }`}
                      >
                        {creating
                          ? "Creating..."
                          : subAssemblyShortagesCount > 0
                            ? "Create JO + child planning"
                            : "Create JO for SIV"}
                      </button>
                    </div>
                  );
                }
              })()}
            </div>
          </>
        ) : null}
      </div>
      {showCreateSummary ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-4xl max-h-[90vh] rounded-xl shadow-xl border border-amber-200 overflow-hidden flex flex-col">
            <div className="px-6 py-4 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold text-amber-900">
                  Smart Job Order Created
                </div>
                <div className="text-sm text-amber-800">
                  Materials below will appear in{" "}
                  <span className="font-semibold">SIV</span> for manual issue by
                  storekeeper.
                </div>
              </div>
              <button
                onClick={() => setShowCreateSummary(false)}
                className="px-3 py-1.5 rounded-md border border-amber-300 text-amber-800 hover:bg-amber-100"
              >
                Close
              </button>
            </div>

            {(() => {
              const jo =
                (createSummary as any)?.jobOrder ||
                (createSummary as any)?.job_order;
              const joNumber = jo?.job_order_number || jo?.jobOrderNumber || "";
              const joStatus =
                jo?.workflow_status || jo?.workflowStatus || jo?.status || "-";
              const joItemCode = jo?.item_code || jo?.itemCode || "";
              const joItemName = jo?.item_name || jo?.itemName || "";
              const joQty = Number(jo?.quantity ?? 0) || 0;

              const materials = Array.isArray(jo?.materials)
                ? jo.materials
                : [];
              const totalRequired = materials.reduce(
                (sum: number, m: any) =>
                  sum +
                  (Number(m?.required_quantity ?? m?.requiredQuantity ?? 0) ||
                    0),
                0,
              );
              const totalIssued = materials.reduce(
                (sum: number, m: any) =>
                  sum +
                  (Number(m?.issued_quantity ?? m?.issuedQuantity ?? 0) || 0),
                0,
              );
              const totalPending = Math.max(0, totalRequired - totalIssued);
              const linkedPr = getLinkedPurchaseRequisition(createSummary);

              const subJobs = Array.isArray(
                (createSummary as any)?.autoCompletedSubJobOrders,
              )
                ? (createSummary as any).autoCompletedSubJobOrders
                : [];

              return (
                <div className="flex-1 overflow-y-auto overscroll-contain p-6">
                  <div className="grid grid-cols-2 gap-4 bg-gray-50 rounded-lg p-4">
                    <div className="text-sm">
                      <div className="text-gray-600">Job Order</div>
                      <div className="font-semibold text-gray-900">
                        {joNumber || "-"}
                      </div>
                    </div>
                    <div className="text-sm">
                      <div className="text-gray-600">Status</div>
                      <div className="font-semibold text-gray-900">
                        {joStatus}
                      </div>
                    </div>
                    <div className="text-sm col-span-2">
                      <div className="text-gray-600">Item</div>
                      <div className="font-semibold text-gray-900">
                        {joItemCode
                          ? `${joItemCode} - ${joItemName}`
                          : joItemName || "-"}
                      </div>
                    </div>
                    <div className="text-sm">
                      <div className="text-gray-600">Quantity</div>
                      <div className="font-semibold text-gray-900">{joQty}</div>
                    </div>
                    <div className="text-sm">
                      <div className="text-gray-600">Pending Issue (SIV)</div>
                      <div className="font-semibold text-amber-700">
                        {totalPending > 0 ? totalPending : "No pending issue"}
                      </div>
                    </div>
                  </div>

                  <div
                    className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
                      linkedPr.hasLinkedPr
                        ? "border-amber-200 bg-amber-50 text-amber-900"
                        : "border-emerald-200 bg-emerald-50 text-emerald-900"
                    }`}
                  >
                    <div className="font-semibold">
                      {linkedPr.hasLinkedPr
                        ? "Shortage purchase flow started"
                        : "Stock available flow started"}
                    </div>
                    <div className="mt-1">
                      {linkedPr.hasLinkedPr ? (
                        <>
                          Master PR{" "}
                          <span className="font-semibold">
                            {linkedPr.prNumber || "created"}
                          </span>{" "}
                          was generated for the complete Job Order tree. Complete
                          PR to PO to GRN, then issue the material through SIV.
                        </>
                      ) : (
                        <>
                          No shortage PR was created because material is
                          available. Stores can issue the required components
                          through SIV.
                        </>
                      )}
                    </div>
                  </div>

                  {subJobs.length ? (
                    <div className="mt-5">
                      <div className="font-medium text-gray-800 mb-2">
                        Auto-completed Sub-Assemblies
                      </div>
                      <div className="text-sm text-gray-700">
                        {subJobs.map((s: any, idx: number) => {
                          const n =
                            s?.job_order_number ||
                            s?.jobOrderNumber ||
                            s?.jobOrder?.job_order_number;
                          const code = s?.item_code || s?.itemCode;
                          const name = s?.item_name || s?.itemName;
                          const q = Number(s?.quantity ?? 0) || 0;
                          return (
                            <div key={idx} className="py-1">
                              <span className="font-semibold text-gray-900">
                                {n || "JO"}
                              </span>
                              {code || name ? (
                                <span className="text-gray-700">
                                  {" "}
                                  - {code} {name ? `(${name})` : ""}
                                </span>
                              ) : null}
                              {q ? (
                                <span className="text-gray-600">
                                  {" "}
                                  - Qty {q}
                                </span>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-5">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-medium text-gray-800">
                        Materials Required
                      </div>
                      <div className="text-xs text-gray-600">
                        Issue materials via SIV (Store Issue Voucher).
                      </div>
                    </div>
                    <div className="overflow-x-auto border rounded-lg">
                      <table className="min-w-full text-sm">
                        <thead className="bg-gray-50 border-b">
                          <tr className="text-left text-gray-600">
                            <th className="py-2 px-3">Item</th>
                            <th className="py-2 px-3 text-right">Required</th>
                            <th className="py-2 px-3 text-right">
                              Issued (Reduced)
                            </th>
                            <th className="py-2 px-3">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {materials.map((m: any) => {
                            const code = m?.item_code || m?.itemCode || "";
                            const name = m?.item_name || m?.itemName || "";
                            const reqQty =
                              Number(
                                m?.required_quantity ??
                                  m?.requiredQuantity ??
                                  0,
                              ) || 0;
                            const issuedQty =
                              Number(
                                m?.issued_quantity ?? m?.issuedQuantity ?? 0,
                              ) || 0;
                            const st = m?.status || "-";
                            return (
                              <tr
                                key={m?.id || `${code}-${name}`}
                                className="border-b last:border-b-0"
                              >
                                <td className="py-2 px-3">
                                  <div className="text-gray-900">
                                    {code || "-"}
                                  </div>
                                  <div className="text-xs text-gray-600">
                                    {name}
                                  </div>
                                </td>
                                <td className="py-2 px-3 text-right text-gray-900">
                                  {reqQty}
                                </td>
                                <td className="py-2 px-3 text-right font-semibold text-gray-900">
                                  {issuedQty}
                                </td>
                                <td className="py-2 px-3 text-gray-700">
                                  {st}
                                </td>
                              </tr>
                            );
                          })}
                          {materials.length === 0 ? (
                            <tr>
                              <td
                                colSpan={4}
                                className="py-4 px-3 text-center text-gray-600"
                              >
                                No materials returned for this job order.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                        {materials.length ? (
                          <tfoot className="bg-gray-50 border-t">
                            <tr>
                              <td className="py-2 px-3 font-medium text-gray-700">
                                Totals
                              </td>
                              <td className="py-2 px-3 text-right font-medium text-gray-900">
                                {totalRequired}
                              </td>
                              <td className="py-2 px-3 text-right font-semibold text-gray-900">
                                {totalIssued}
                              </td>
                              <td className="py-2 px-3" />
                            </tr>
                          </tfoot>
                        ) : null}
                      </table>
                    </div>

                    <div className="mt-3 text-xs text-gray-600">
                      Finished goods (UIDs/stock add) happens when the job order
                      is <span className="font-semibold">COMPLETED</span>.
                    </div>
                  </div>
                </div>
              );
            })()}
            {(() => {
              const jo =
                (createSummary as any)?.jobOrder ||
                (createSummary as any)?.job_order;
              const joId = String(jo?.id || "").trim();
              const joNumber = String(
                jo?.job_order_number || jo?.jobOrderNumber || "",
              ).trim();
              const linkedPr = getLinkedPurchaseRequisition(createSummary);
              return (
                <div className="border-t border-amber-200 bg-white px-6 py-4">
                  {linkedPr.hasLinkedPr ? (
                    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      Master shortage PR{" "}
                      <span className="font-semibold">
                        {linkedPr.prNumber || "created"}
                      </span>{" "}
                      was generated. Complete the normal PR to PO to GRN cycle,
                      then issue available material through SIV.
                    </div>
                  ) : (
                    <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                      No shortage PR is required. Materials are ready for SIV
                      issue.
                    </div>
                  )}
                  <div className="flex flex-wrap justify-end gap-2">
                    {linkedPr.prNumber ? (
                      <button
                        type="button"
                        onClick={() =>
                          router.push(
                            `/dashboard/purchase/requisitions?search=${encodeURIComponent(linkedPr.prNumber)}`,
                          )
                        }
                        className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100"
                      >
                        Open Master PR
                      </button>
                    ) : null}
                    {joId ? (
                      <button
                        type="button"
                        onClick={() =>
                          router.push(
                            `/dashboard/inventory/siv?jobId=${encodeURIComponent(joId)}&joNumber=${encodeURIComponent(joNumber)}`,
                          )
                        }
                        className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-900 hover:bg-blue-100"
                      >
                        Open SIV
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() =>
                        router.push("/dashboard/production/job-orders")
                      }
                      className="rounded-lg bg-[#8B6F47] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6F4E37]"
                    >
                      Go to Job Orders
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      ) : null}

      {showCreateProgress ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-xl rounded-xl shadow-xl border border-amber-200 overflow-hidden">
            <div className="px-6 py-4 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold text-amber-900">
                  Creating Smart Job Order
                </div>
                <div className="text-sm text-amber-800">
                  This may take a few minutes for large BOMs.
                </div>
              </div>
              <button
                onClick={() => setShowCreateProgress(false)}
                className="px-3 py-1.5 rounded-md border border-amber-300 text-amber-800 hover:bg-amber-100"
              >
                Hide
              </button>
            </div>

            {(() => {
              const st = createJobStatus;
              const total = Number(st?.progress?.total ?? 0) || 0;
              const current = Number(st?.progress?.current ?? 0) || 0;
              const pct =
                total > 0
                  ? Math.min(
                      100,
                      Math.max(0, Math.round((current / total) * 100)),
                    )
                  : 5;

              const itemLine = st?.progress?.itemCode
                ? `${st.progress.itemCode}${st.progress.itemName ? ` - ${st.progress.itemName}` : ""}`
                : "";

              const statusLabel = st?.status || "PENDING";

              // Show sub-assembly count (total - 1 for FG)
              const subAssemblyCount = total > 1 ? total - 1 : 0;
              const progressText = (() => {
                if (total <= 0) return statusLabel;
                if (st?.progress?.phase === "ISSUE_MATERIALS") {
                  return `Issuing for ${subAssemblyCount} sub-assemblies + 1 FG`;
                }
                if (st?.progress?.phase === "SUB_ASSEMBLIES") {
                  return `${Math.min(current, subAssemblyCount)} / ${subAssemblyCount} sub-assemblies`;
                }
                return `${Math.min(current, total)} / ${total}`;
              })();

              return (
                <div className="p-6">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium text-amber-900">
                      {st?.progress?.message || "Starting..."}
                    </div>
                    <div className="text-xs text-amber-800">{progressText}</div>
                  </div>

                  {itemLine ? (
                    <div className="text-xs text-gray-700 mb-3">{itemLine}</div>
                  ) : null}

                  <div className="w-full bg-amber-100 rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-amber-700 to-amber-800 h-3 rounded-full transition-all duration-500 ease-linear"
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  <div className="mt-4 text-xs text-gray-600">
                    Status: <span className="font-semibold">{statusLabel}</span>
                    {st?.error ? (
                      <span className="text-red-700"> - {st.error}</span>
                    ) : null}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      ) : null}

      {/* Sub-Assembly Quantity Prompt Modal */}
      {subAssemblyQtyModal.open ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-xl shadow-xl border border-green-200 overflow-hidden">
            <div className="px-6 py-4 bg-green-50 border-b border-green-200 flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold text-green-900">
                  {subAssemblyQtyModal.mode === "batch"
                    ? `Create ${subAssemblyQtyModal.items.length} Sub-Assembly Job Order${subAssemblyQtyModal.items.length > 1 ? "s" : ""}`
                    : "Create Sub-Assembly Job Order"}
                </div>
                <div className="text-sm text-green-800">
                  Set quantity for each sub-assembly
                </div>
              </div>
              <button
                onClick={() =>
                  setSubAssemblyQtyModal({
                    open: false,
                    mode: "single",
                    items: [],
                  })
                }
                className="px-3 py-1.5 rounded-md border border-green-300 text-green-800 hover:bg-green-100"
              >
                Cancel
              </button>
            </div>
            <div className="p-6 max-h-[60vh] overflow-y-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      Item
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase w-32">
                      Quantity
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {subAssemblyQtyModal.items.map((item, idx) => (
                    <tr
                      key={`${item.bomId}:${item.itemId}`}
                      className="hover:bg-gray-50"
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900">
                          {item.itemCode}
                        </div>
                        <div className="text-xs text-gray-600">
                          {item.itemName}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={1}
                          value={item.qty}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 0;
                            setSubAssemblyQtyModal((prev) => ({
                              ...prev,
                              items: prev.items.map((it, i) =>
                                i === idx ? { ...it, qty: val } : it,
                              ),
                            }));
                          }}
                          className="w-24 border border-gray-300 rounded px-2 py-1 text-right text-sm"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t flex items-center justify-end gap-3">
              <button
                onClick={() =>
                  setSubAssemblyQtyModal({
                    open: false,
                    mode: "single",
                    items: [],
                  })
                }
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={processSubAssemblyJOs}
                disabled={
                  creatingSAJobs ||
                  subAssemblyQtyModal.items.every((i) => Number(i.qty) <= 0)
                }
                className="px-4 py-2 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {creatingSAJobs ? (
                  <>
                    <svg
                      className="animate-spin h-4 w-4"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      ></path>
                    </svg>
                    Creating...
                  </>
                ) : (
                  `Create ${subAssemblyQtyModal.items.filter((i) => Number(i.qty) > 0).length} Job Order${subAssemblyQtyModal.items.filter((i) => Number(i.qty) > 0).length > 1 ? "s" : ""}`
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Sub-Assembly JO Results Modal */}
      {showSAJobResults ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-xl shadow-xl border border-green-200 overflow-hidden">
            <div className="px-6 py-4 bg-green-50 border-b border-green-200 flex items-center justify-between">
              <div className="text-lg font-semibold text-green-900">
                Sub-Assembly Job Orders - Results
              </div>
              <button
                onClick={() => {
                  setShowSAJobResults(false);
                  const allSuccess = saJobResults.every((r) => r.success);
                  if (allSuccess && saJobResults.length > 0) {
                    router.push("/dashboard/production/job-orders");
                  }
                }}
                className="px-3 py-1.5 rounded-md border border-green-300 text-green-800 hover:bg-green-100"
              >
                Close
              </button>
            </div>
            <div className="p-6">
              <div className="space-y-2">
                {saJobResults.map((r, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center justify-between px-4 py-3 rounded-lg border ${
                      r.success
                        ? "border-green-200 bg-green-50"
                        : "border-red-200 bg-red-50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {r.success ? (
                        <span className="text-green-600 font-bold">OK</span>
                      ) : (
                        <span className="text-red-600 font-bold">✗</span>
                      )}
                      <span className="text-sm font-medium text-gray-900">
                        {r.itemCode}
                      </span>
                    </div>
                    <div className="text-sm">
                      {r.success ? (
                        <span className="text-green-700 font-semibold">
                          {r.joNumber}
                        </span>
                      ) : (
                        <span className="text-red-700">{r.error}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowSAJobResults(false);
                    router.push("/dashboard/production/job-orders");
                  }}
                  className="px-4 py-2 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700"
                >
                  Go to Job Orders
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
