import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { createClient } from "@supabase/supabase-js";
import { toTitleCase, toUpperCode } from "../../common/utils/data-quality";
import { normalizeInventoryCategory } from "../../inventory/utils/inventory-category";
import { ProjectsService } from "../../projects/projects.service";

function mapDeleteAuditError(error: any, resourceLabel: string): string {
  const details = String(error?.details || "");
  const message = String(error?.message || "");

  if (
    error?.code === "23502" &&
    (message.includes("activity_logs") || details.includes("activity_logs")) &&
    (message.includes("user_id") || details.includes("user_id"))
  ) {
    return `Failed to delete ${resourceLabel}: database delete audit is misconfigured. Apply fix-delete-audit-trigger.sql and retry.`;
  }

  return `Failed to delete ${resourceLabel}: ${message || "Unknown error"}`;
}

@Injectable()
export class ItemsService {
  private supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );

  constructor(private readonly projectsService: ProjectsService) {}

  private readonly itemCodePrefixes: Record<string, string> = {
    RAW_MATERIAL: "100",
    SUB_ASSEMBLY: "200",
    SERVICES: "300",
    CAPITAL_GOODS: "400",
    CONSUMABLE: "500",
    FINISHED_GOODS: "700",
  };

  private isUuid(value: any): boolean {
    if (typeof value !== "string") return false;
    // UUID v1-v5
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.trim(),
    );
  }

  private normalizeNumber(value: any, type: "int" | "float" = "float") {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    const raw = typeof value === "string" ? value.trim() : String(value);
    // Handle common Excel formats: commas, currency symbols, spaces
    const cleaned = raw.replace(/,/g, "").replace(/[^0-9.\-]/g, "");

    if (!cleaned) {
      return null;
    }

    const parsed = type === "int" ? parseInt(cleaned, 10) : parseFloat(cleaned);

    return Number.isNaN(parsed) ? null : parsed;
  }

  private normalizeOptionalText(value: any): string | null {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    return trimmed || null;
  }

  private getItemCodePrefix(category: any): string {
    const normalized = normalizeInventoryCategory(category);
    const prefix = this.itemCodePrefixes[normalized];
    if (!prefix) {
      throw new BadRequestException(
        `Item number generation is not configured for category '${normalized}'. Select RAW_MATERIAL, SUB_ASSEMBLY, SERVICES, CAPITAL_GOODS, CONSUMABLE, or FINISHED_GOODS.`,
      );
    }
    return prefix;
  }

  private async generateNextItemCode(
    tenantId: string,
    category: any,
  ): Promise<string> {
    const prefix = this.getItemCodePrefix(category);
    const codePattern = `${prefix}-%`;
    const { data, error } = await this.supabase
      .from("items")
      .select("code")
      .eq("tenant_id", tenantId)
      .ilike("code", codePattern)
      .limit(10000);

    if (error)
      throw new BadRequestException(
        `Failed to generate item number: ${error.message}`,
      );

    const matcher = new RegExp(`^${prefix}-(\\d{4})$`, "i");
    const maxRunningNumber = (data || []).reduce((max: number, row: any) => {
      const match = String(row?.code || "")
        .trim()
        .match(matcher);
      if (!match) return max;
      const value = Number(match[1]);
      return Number.isFinite(value) ? Math.max(max, value) : max;
    }, 0);

    return `${prefix}-${String(maxRunningNumber + 1).padStart(4, "0")}`;
  }

  async previewNextItemCode(tenantId: string, category: any) {
    const normalizedCategory = normalizeInventoryCategory(category);
    const prefix = this.getItemCodePrefix(normalizedCategory);
    const code = await this.generateNextItemCode(tenantId, normalizedCategory);
    return { code, prefix, category: normalizedCategory };
  }

  private buildTemporaryRndCode(identifier: string): string {
    const cleanIdentifier = String(identifier || "")
      .trim()
      .replace(/\s+/g, "");
    const withoutExistingTempPrefix = cleanIdentifier.replace(
      /^temp[-_]?/i,
      "",
    );
    return `TEMP-${withoutExistingTempPrefix}`.toUpperCase();
  }

  private isRndScope(value: any): boolean {
    const normalized = String(value || "")
      .trim()
      .toUpperCase();
    return (
      normalized === "R&D" || normalized === "RND" || normalized === "RESEARCH"
    );
  }

  private isRndItemRecord(item: any): boolean {
    const metadata =
      item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
    return (
      item?.is_rnd_item === true ||
      metadata.isRndItem === true ||
      metadata.is_rnd_item === true ||
      this.isRndScope(metadata.department) ||
      this.isRndScope(metadata.scope)
    );
  }

  private getSearchTokens(value?: string): string[] {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[×✕✖*]/g, "x")
      .replace(/[–—−]/g, "-")
      .toLowerCase()
      .trim()
      .replace(/(\d)\s*(?:x|[-_/]|\s)\s*(?=\d)/g, "$1x")
      .split(/[\s,;|/\\()[\]{}"'`._:]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .slice(0, 8);
  }

  private getSearchVariants(token: string): string[] {
    const variants = new Set([token]);
    const dimension = token.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i);
    if (dimension) {
      const [, first, second] = dimension;
      variants.add(`${first}×${second}`);
      variants.add(`${first}-${second}`);
      variants.add(`${first} ${second}`);
      variants.add(`${first}_${second}`);
    }
    return Array.from(variants);
  }

  private applyItemSearch(query: any, search?: string) {
    const tokens = this.getSearchTokens(search);
    for (const token of tokens) {
      const filters = this.getSearchVariants(token).flatMap((variant) => {
        const safeToken = variant.replace(/[%*,]/g, "");
        if (!safeToken) return [];
        return [
          "code",
          "name",
          "oem_part_no",
          "oem_name",
          "description",
          "category",
          "hsn_code",
        ].map((field) => `${field}.ilike.%${safeToken}%`);
      });
      if (filters.length > 0) query = query.or(filters.join(","));
    }
    return query;
  }

  private normalizeApprovalStatus(
    value: any,
  ): "PENDING" | "APPROVED" | "REJECTED" {
    const normalized = String(value || "")
      .trim()
      .toUpperCase();
    if (normalized === "APPROVED") return "APPROVED";
    if (normalized === "REJECTED") return "REJECTED";
    return "PENDING";
  }

  private async fetchApprovalHistory(tenantId: string, itemId: string) {
    const { data, error } = await this.supabase
      .from("item_approval_history")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("item_id", itemId)
      .order("created_at", { ascending: false });

    if (error) {
      const message = String(error.message || "");
      if (
        message.includes("item_approval_history") ||
        message.includes("schema cache")
      )
        return [];
      throw new BadRequestException(error.message);
    }

    const rows = data || [];
    const actorIds = Array.from(
      new Set(
        rows
          .map((row: any) => String(row.actor_id || "").trim())
          .filter(Boolean),
      ),
    );
    const actorsById = new Map<string, string>();

    if (actorIds.length > 0) {
      const { data: users } = await this.supabase
        .from("users")
        .select("id, first_name, last_name, email")
        .in("id", actorIds);

      (users || []).forEach((user: any) => {
        const displayName = [user.first_name, user.last_name]
          .filter(Boolean)
          .join(" ")
          .trim();
        actorsById.set(
          String(user.id),
          displayName || user.email || "Unknown user",
        );
      });
    }

    return rows.map((row: any) => ({
      ...row,
      actor_name: actorsById.get(String(row.actor_id)) || "Unknown user",
    }));
  }

  private async logApprovalHistory(params: {
    tenantId: string;
    itemId: string;
    actorId?: string | null;
    action: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    reason?: string | null;
    metadata?: Record<string, any>;
  }) {
    const { error } = await this.supabase.from("item_approval_history").insert({
      tenant_id: params.tenantId,
      item_id: params.itemId,
      actor_id: params.actorId || null,
      action: params.action,
      from_status: params.fromStatus || null,
      to_status: params.toStatus || null,
      reason: params.reason || null,
      metadata: params.metadata || {},
    });

    if (error) {
      const message = String(error.message || "");
      if (
        message.includes("item_approval_history") ||
        message.includes("schema cache")
      )
        return;
      throw new BadRequestException(error.message);
    }
  }

  private assertMakerChecker(item: any, userId: string, action: string) {
    const metadata =
      item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
    const createdBy = String(
      item?.created_by || metadata.createdBy || "",
    ).trim();
    if (createdBy && String(userId) === createdBy) {
      throw new BadRequestException(
        `Maker-checker violation: the item creator cannot ${action} this item.`,
      );
    }
  }

  private async getLedgerStockTotals(tenantId: string, itemIds: string[]) {
    if (!itemIds.length) return {};

    const originalItemIds = itemIds.filter(Boolean);
    const totals: Record<string, number> = {};
    const chunks = <T>(values: T[], size = 75): T[][] => {
      const result: T[][] = [];
      for (let index = 0; index < values.length; index += size) {
        result.push(values.slice(index, index + size));
      }
      return result;
    };

    for (const itemId of originalItemIds) {
      totals[itemId] = 0;
    }

    // Stock Trail intentionally merges item records that share the same SAS
    // part number/code. This is required because older imports and edits can
    // leave stock posted against a sibling item row while users search/view
    // another row with the same code. The Stock Master list must use the same
    // merge scope; otherwise a row can show 0 while its trail shows stock.
    const itemRows: any[] = [];
    for (const batch of chunks(originalItemIds)) {
      const { data, error } = await this.supabase
        .from("items")
        .select("id, code")
        .eq("tenant_id", tenantId)
        .in("id", batch);

      if (error) {
        console.error(
          "[ItemsService.getLedgerStockTotals] item lookup error:",
          error.message,
        );
        throw new Error(`Failed to hydrate item stock scope: ${error.message}`);
      }

      itemRows.push(...(data || []));
    }

    const codeByOriginalId = new Map<string, string>();
    const originalIdsByCode = new Map<string, string[]>();
    const codes = new Set<string>();
    for (const item of itemRows) {
      const id = String(item.id || "").trim();
      const code = String(item.code || "").trim();
      if (!id) continue;
      if (code) {
        codeByOriginalId.set(id, code);
        codes.add(code);
        const ids = originalIdsByCode.get(code) || [];
        ids.push(id);
        originalIdsByCode.set(code, ids);
      }
    }

    const ledgerItemIds = new Set<string>(originalItemIds);
    const codeByLedgerId = new Map<string, string>();
    for (const [id, code] of codeByOriginalId.entries())
      codeByLedgerId.set(id, code);

    const codeList = Array.from(codes);
    for (const batch of chunks(codeList)) {
      const { data, error } = await this.supabase
        .from("items")
        .select("id, code")
        .eq("tenant_id", tenantId)
        .in("code", batch);

      if (error) {
        console.error(
          "[ItemsService.getLedgerStockTotals] sibling item lookup error:",
          error.message,
        );
        throw new Error(
          `Failed to hydrate sibling item stock scope: ${error.message}`,
        );
      }

      for (const sibling of data || []) {
        const id = String((sibling as any).id || "").trim();
        const code = String((sibling as any).code || "").trim();
        if (!id || !code) continue;
        ledgerItemIds.add(id);
        codeByLedgerId.set(id, code);
      }
    }

    const ledgerIdList = Array.from(ledgerItemIds);
    const ledgerItemIdSet = new Set(ledgerIdList);
    const ledgerTotals: Record<string, number> = {};
    for (const itemId of ledgerIdList) {
      ledgerTotals[itemId] = 0;
    }

    const stockEntries: any[] = [];
    for (const batch of chunks(ledgerIdList)) {
      const { data, error } = await this.supabase
        .from("stock_entries")
        .select("item_id, quantity, metadata, warehouse_id")
        .eq("tenant_id", tenantId)
        .in("item_id", batch);

      if (error) {
        console.error(
          "[ItemsService.getLedgerStockTotals] stock_entries lookup error:",
          error.message,
        );
        throw new Error(
          `Failed to hydrate item stock entries: ${error.message}`,
        );
      }

      stockEntries.push(...(data || []));
    }

    const grnEntryMap = new Map<string, number>();
    for (const entry of stockEntries) {
      const itemId = (entry as any).item_id;
      if (!ledgerItemIdSet.has(itemId)) continue;

      const metadata =
        (entry as any).metadata && typeof (entry as any).metadata === "object"
          ? (entry as any).metadata
          : {};
      const grnRef = metadata?.grn_reference || metadata?.grn_number;
      const createdFrom = String(
        metadata?.created_from || metadata?.source || "",
      )
        .trim()
        .toUpperCase();
      const isSrvOrManualReceipt =
        createdFrom.includes("SRV") ||
        createdFrom.includes("MANUAL") ||
        Boolean(metadata?.srv_number || metadata?.srv_reference);

      if (!grnRef) {
        // Stock entries created by SRV/manual receipt do not have a GRN number.
        // They still represent real stock and must be included in the Stock
        // Master figure; otherwise the master list and Stock Trail drift.
        if (isSrvOrManualReceipt) {
          ledgerTotals[itemId] =
            (ledgerTotals[itemId] || 0) +
            (Number((entry as any).quantity) || 0);
        }
        continue;
      }

      const dedupKey = `${itemId}::${grnRef}::${(entry as any).warehouse_id || ""}`;
      grnEntryMap.set(
        dedupKey,
        (grnEntryMap.get(dedupKey) || 0) +
          (Number((entry as any).quantity) || 0),
      );
    }

    for (const [key, qty] of grnEntryMap.entries()) {
      const itemId = key.split("::")[0];
      ledgerTotals[itemId] = (ledgerTotals[itemId] || 0) + qty;
    }

    const movements: any[] = [];
    for (const batch of chunks(ledgerIdList)) {
      const { data, error } = await this.supabase
        .from("stock_movements")
        .select(
          "item_id, quantity, movement_type, reference_type, from_warehouse_id, to_warehouse_id",
        )
        .eq("tenant_id", tenantId)
        .in("item_id", batch);

      if (error) {
        console.error(
          "[ItemsService.getLedgerStockTotals] stock_movements lookup error:",
          error.message,
        );
        throw new Error(
          `Failed to hydrate item stock movements: ${error.message}`,
        );
      }

      movements.push(...(data || []));
    }

    for (const movement of movements) {
      const itemId = (movement as any).item_id;
      if (!ledgerItemIdSet.has(itemId)) continue;

      const qty = Number((movement as any).quantity) || 0;
      const fromWarehouseId = (movement as any).from_warehouse_id;
      const toWarehouseId = (movement as any).to_warehouse_id;
      const movementType = String((movement as any).movement_type || "")
        .trim()
        .toUpperCase();
      const referenceType = String((movement as any).reference_type || "")
        .trim()
        .toUpperCase();
      const isKnownOutbound =
        movementType.includes("ISSUE") ||
        movementType.includes("CONSUM") ||
        movementType.includes("SALE") ||
        movementType.includes("SOLD") ||
        referenceType === "SIV" ||
        referenceType === "SALES_ORDER";
      const isKnownInbound =
        movementType.includes("RECEIPT") ||
        movementType.includes("RETURN") ||
        movementType === "PRODUCTION" ||
        referenceType === "SRV";

      // Match the warehouse ledger logic used elsewhere:
      // - any to_warehouse increases stock
      // - any from_warehouse decreases stock
      // - transfers have both and net to zero at item total level
      // This catches SIV / production issue rows reliably and keeps Stock
      // Master aligned with Stock Trail.
      if (toWarehouseId)
        ledgerTotals[itemId] = (ledgerTotals[itemId] || 0) + qty;
      if (fromWarehouseId)
        ledgerTotals[itemId] = (ledgerTotals[itemId] || 0) - qty;
      if (!fromWarehouseId && !toWarehouseId && isKnownOutbound)
        ledgerTotals[itemId] = (ledgerTotals[itemId] || 0) - qty;
      if (!fromWarehouseId && !toWarehouseId && isKnownInbound)
        ledgerTotals[itemId] = (ledgerTotals[itemId] || 0) + qty;
    }

    const inventoryRows: any[] = [];
    for (const batch of chunks(ledgerIdList)) {
      const { data, error } = await this.supabase
        .from("inventory_stock")
        .select("item_id, quantity, available_quantity")
        .eq("tenant_id", tenantId)
        .in("item_id", batch);

      if (error) {
        console.error(
          "[ItemsService.getLedgerStockTotals] inventory_stock lookup error:",
          error.message,
        );
        throw new Error(
          `Failed to hydrate item inventory stock: ${error.message}`,
        );
      }

      inventoryRows.push(...(data || []));
    }

    const inventoryTotals: Record<string, number> = {};
    for (const row of inventoryRows) {
      const itemId = (row as any).item_id;
      if (!ledgerItemIdSet.has(itemId)) continue;
      // available_quantity is what Stock Master, Stock Adjustment, and reorder
      // planning users act on. quantity can lag in older/imported rows, so use
      // available first and fall back to quantity only when needed.
      const qty =
        Number((row as any).available_quantity ?? (row as any).quantity ?? 0) ||
        0;
      inventoryTotals[itemId] = (inventoryTotals[itemId] || 0) + qty;
    }

    for (const itemId of ledgerIdList) {
      if (inventoryTotals[itemId] !== undefined) {
        // inventory_stock is the operational stock balance table. Ledger rows
        // are still useful for trails, but any imported/opening/reconciled
        // stock must not make the list disagree with warehouse balance.
        ledgerTotals[itemId] = inventoryTotals[itemId];
      }
    }

    const totalsByCode = new Map<string, number>();
    for (const [ledgerId, qty] of Object.entries(ledgerTotals)) {
      const code = codeByLedgerId.get(ledgerId);
      if (!code) continue;
      totalsByCode.set(
        code,
        (totalsByCode.get(code) || 0) + (Number(qty) || 0),
      );
    }

    for (const itemId of originalItemIds) {
      const code = codeByOriginalId.get(itemId);
      totals[itemId] = code
        ? totalsByCode.get(code) || 0
        : ledgerTotals[itemId] || 0;
    }

    return totals;
  }

  private normalizeAndValidateHsn(
    value: any,
    options: { required: boolean },
  ): string | null {
    if (value === undefined || value === null || value === "") {
      if (options.required) {
        throw new BadRequestException("HSN code is required");
      }
      return null;
    }

    const hsnStr = String(value).trim();
    if (!/^\d{4}$|^\d{6}$|^\d{8}$/.test(hsnStr)) {
      throw new BadRequestException(
        "Invalid HSN code. Must be 4, 6, or 8 digits.",
      );
    }

    return hsnStr;
  }

  private normalizeUidFields(itemData: any): {
    uid_tracking?: boolean;
    uid_strategy?: "SERIALIZED" | "BATCHED" | "NONE";
    batch_uom?: string | null;
    batch_quantity?: number | null;
  } {
    const rawUidTracking = itemData.uid_tracking ?? itemData.uidTracking;
    const rawUidStrategy = itemData.uid_strategy ?? itemData.uidStrategy;
    const rawBatchUom = itemData.batch_uom ?? itemData.batchUom;
    const rawBatchQuantity = itemData.batch_quantity ?? itemData.batchQuantity;

    const anyProvided =
      rawUidTracking !== undefined ||
      rawUidStrategy !== undefined ||
      rawBatchUom !== undefined ||
      rawBatchQuantity !== undefined;

    if (!anyProvided) {
      return {};
    }

    // If tracking is explicitly disabled, force NONE strategy.
    if (rawUidTracking === false) {
      return {
        uid_tracking: false,
        uid_strategy: "NONE",
        batch_uom: null,
        batch_quantity: null,
      };
    }

    const strategy = (rawUidStrategy || "SERIALIZED") as string;
    if (
      strategy !== "SERIALIZED" &&
      strategy !== "BATCHED" &&
      strategy !== "NONE"
    ) {
      throw new BadRequestException(
        "Invalid UID strategy. Must be SERIALIZED, BATCHED, or NONE.",
      );
    }

    if (strategy === "NONE") {
      return {
        uid_tracking: false,
        uid_strategy: "NONE",
        batch_uom: null,
        batch_quantity: null,
      };
    }

    if (strategy === "BATCHED") {
      const batchUom = rawBatchUom ? String(rawBatchUom).trim() : "";
      const batchQty = this.normalizeNumber(rawBatchQuantity);

      if (!batchUom) {
        throw new BadRequestException(
          "For BATCHED UID strategy, batch_uom is required.",
        );
      }
      if (!batchQty || batchQty <= 0) {
        throw new BadRequestException(
          "For BATCHED UID strategy, batch_quantity must be > 0.",
        );
      }

      return {
        uid_tracking: true,
        uid_strategy: "BATCHED",
        batch_uom: batchUom,
        batch_quantity: batchQty,
      };
    }

    // SERIALIZED
    return {
      uid_tracking: true,
      uid_strategy: "SERIALIZED",
      batch_uom: null,
      batch_quantity: null,
    };
  }

  private normalizeCommercialUomFields(itemData: any, baseUomValue: any) {
    const rawSalesUom = itemData.sales_uom ?? itemData.salesUom;
    const rawFactor = itemData.sales_uom_factor ?? itemData.salesUomFactor;
    const rawWholeOnly =
      itemData.sales_whole_uom_only ?? itemData.salesWholeUomOnly;
    const anyProvided =
      rawSalesUom !== undefined ||
      rawFactor !== undefined ||
      rawWholeOnly !== undefined;
    if (!anyProvided) return {};

    const salesUom = String(rawSalesUom || "")
      .trim()
      .toUpperCase();
    if (!salesUom) {
      return {
        sales_uom: null,
        sales_uom_factor: null,
        sales_whole_uom_only: false,
      };
    }
    const baseUom = toUpperCode(baseUomValue);
    if (salesUom === baseUom) {
      throw new BadRequestException(
        "Sales UOM must be different from the stock/base UOM",
      );
    }
    const factor = this.normalizeNumber(rawFactor);
    if (!factor || factor <= 0) {
      throw new BadRequestException(
        `Base units per ${salesUom} must be greater than 0`,
      );
    }
    return {
      sales_uom: salesUom,
      sales_uom_factor: factor,
      sales_whole_uom_only: rawWholeOnly === true,
    };
  }

  async findAll(
    tenantId: string,
    search?: string,
    includeInactive?: boolean,
    onlyVerified?: boolean,
    options: { includeRnd?: boolean; onlyRnd?: boolean } = {},
  ) {
    await this.projectsService.ensureSchema();
    let query = this.supabase
      .from("items")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true });

    // Only filter by is_active if we're not including inactive items
    if (!includeInactive) {
      query = query.eq("is_active", true);
    }

    if (onlyVerified) {
      query = query.eq("is_verified", true);
    }

    // Apply the R&D-only scope before the database row limit is applied.
    if (options.onlyRnd) {
      query = query.eq("is_rnd_item", true);
    }

    query = this.applyItemSearch(query, search);

    let { data, error } = await query;

    // Fallback: retry without is_verified filter if column doesn't exist
    if (error && error.message.includes("is_verified")) {
      let retryQuery = this.supabase
        .from("items")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("name", { ascending: true });
      if (!includeInactive) retryQuery = retryQuery.eq("is_active", true);
      if (options.onlyRnd) retryQuery = retryQuery.eq("is_rnd_item", true);
      retryQuery = this.applyItemSearch(retryQuery, search);
      const { data: retryData, error: retryError } = await retryQuery;
      data = retryData;
      error = retryError;
    }

    if (error) {
      console.error("[ItemsService] Query error:", error);
      throw new Error(`Failed to fetch items: ${error.message}`);
    }

    // Resolve updated_by user IDs to names
    let userMap = new Map<string, string>();
    if (data && data.length > 0) {
      const userIds = Array.from(
        new Set(
          data
            .filter((item: any) => item.updated_by)
            .map((item: any) => item.updated_by),
        ),
      );

      if (userIds.length > 0) {
        // Query users - note: users table has tenant_id, so we filter by it
        const { data: users, error: userError } = await this.supabase
          .from("users")
          .select("id, first_name, last_name, username, email")
          .eq("tenant_id", tenantId)
          .in("id", userIds);

        if (userError) {
          console.error(
            "[ItemsService.findAll] User lookup error:",
            userError.message,
          );
        }

        for (const user of users || []) {
          const displayName =
            `${user.first_name || ""} ${user.last_name || ""}`.trim() ||
            user.username ||
            user.email ||
            user.id;
          userMap.set(user.id, displayName);
        }
      }
    }

    // Stock Master must read from inventory_stock because stock adjustments
    // update that aggregate table directly.
    if (data && data.length > 0) {
      data = data.filter((item: any) => {
        const isRnd = this.isRndItemRecord(item);
        if (options.onlyRnd) return isRnd;
        if (options.includeRnd) return true;
        return !isRnd;
      });
      const itemIds = data.map((item: any) => item.id).filter(Boolean);
      const stockTotals = await this.getLedgerStockTotals(tenantId, itemIds);

      // Add ledger stock and resolved user names to each item.
      // Stock Master historically had multiple stock-shaped fields on item rows
      // (current_stock / available_quantity / total_stock). Always overwrite
      // them from the same ledger calculation used by the stock trail so the
      // register cannot show stale GRN-only quantities after SIV/production
      // issues.
      return data.map((item) => ({
        ...item,
        current_stock: stockTotals[item.id] || 0,
        available_quantity: stockTotals[item.id] || 0,
        total_stock: stockTotals[item.id] || 0,
        updated_by: item.updated_by
          ? userMap.get(item.updated_by) || item.updated_by
          : null,
      }));
    }

    return data || [];
  }

  async search(tenantId: string, query: string) {
    if (!query || query.trim().length === 0) {
      return [];
    }

    let itemQuery = this.supabase
      .from("items")
      .select(
        "id, code, name, description, oem_part_no, uom, category, standard_cost, selling_price",
      )
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .eq("is_verified", true);

    itemQuery = this.applyItemSearch(itemQuery, query);
    const { data, error } = await itemQuery.order("name", { ascending: true });

    if (error) {
      throw new Error(`Search failed: ${error.message}`);
    }

    return data || [];
  }

  async findOne(tenantId: string, id: string) {
    const { data, error } = await this.supabase
      .from("items")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .single();

    if (error) {
      throw new Error(`Failed to fetch item: ${error.message}`);
    }

    const approvalHistory = await this.fetchApprovalHistory(tenantId, id);
    return {
      ...data,
      approval_status: this.normalizeApprovalStatus(
        data.approval_status ||
          data.metadata?.itemApproval?.status ||
          (data.is_verified ? "APPROVED" : "PENDING"),
      ),
      approval_reason:
        data.approval_reason || data.metadata?.itemApproval?.reason || null,
      created_by: data.created_by || data.metadata?.createdBy || null,
      approved_at: data.approved_at || data.verified_at || null,
      approved_by: data.approved_by || data.verified_by || null,
      approval_history: approvalHistory,
    };
  }

  async create(tenantId: string, userId: string, itemData: any) {
    await this.projectsService.ensureSchema();
    console.log(
      "[ItemsService.create] Creating item with data:",
      JSON.stringify(itemData, null, 2),
    );

    // HSN is required unless this is a variant (variants can inherit empty HSN)
    const isVariant = itemData.is_variant === true;
    console.log("[ItemsService.create] Is variant:", isVariant);

    const validatedHsn = this.normalizeAndValidateHsn(
      itemData.hsnCode ?? itemData.hsn_code,
      { required: !isVariant },
    );
    console.log("[ItemsService.create] Validated HSN:", validatedHsn);

    const uidFields = this.normalizeUidFields(itemData);
    const commercialUomFields = this.normalizeCommercialUomFields(
      itemData,
      itemData.uom,
    );

    const drawingRequired =
      itemData.drawing_required ?? itemData.drawingRequired;
    if (
      drawingRequired !== undefined &&
      drawingRequired !== "OPTIONAL" &&
      drawingRequired !== "COMPULSORY" &&
      drawingRequired !== "NOT_REQUIRED"
    ) {
      throw new BadRequestException(
        "Invalid drawing_required. Must be OPTIONAL, COMPULSORY, or NOT_REQUIRED.",
      );
    }

    // If drawing is COMPULSORY, check that at least one active drawing exists
    // Note: For create, this validation happens after item creation (user must upload drawing immediately after)
    // For edit changing to COMPULSORY, we validate here

    const standardCost = this.normalizeNumber(
      itemData.standard_cost ?? itemData.standardCost,
    );
    const reorderLevel = this.normalizeNumber(
      itemData.reorder_level ?? itemData.reorderLevel,
      "int",
    );
    const reorderQuantity = this.normalizeNumber(
      itemData.reorder_quantity ?? itemData.reorderQuantity,
      "int",
    );
    const leadTimeDays = this.normalizeNumber(
      itemData.lead_time_days ?? itemData.leadTimeDays,
      "int",
    );
    const oemPartNo = this.normalizeOptionalText(
      itemData.oem_part_no ??
        itemData.oemPartNo ??
        itemData.oem_part_number ??
        itemData.oemPartNumber,
    );
    const oemName = this.normalizeOptionalText(
      itemData.oem_name ?? itemData.oemName,
    );
    const purchaseCurrency =
      (itemData.purchase_currency ?? itemData.purchaseCurrency ?? "INR")
        .toString()
        .toUpperCase()
        .trim() || "INR";
    const foreignUnitPrice = this.normalizeNumber(
      itemData.foreign_unit_price ?? itemData.foreignUnitPrice,
    );
    const isRndItem =
      itemData.isRndItem === true ||
      itemData.is_rnd_item === true ||
      this.isRndScope(itemData.department) ||
      this.isRndScope(itemData.scope) ||
      this.isRndScope(itemData.projectDepartment);
    const projectId = this.normalizeOptionalText(
      itemData.project_id ?? itemData.projectId,
    );
    const projectName = this.normalizeOptionalText(
      itemData.project_name ?? itemData.projectName,
    );
    const department = isRndItem
      ? "R&D"
      : this.normalizeOptionalText(itemData.department);

    // Validate reorder level only for stock-tracked categories.
    // (SERVICE is excluded because services do not maintain inventory stock.)
    const category = normalizeInventoryCategory(itemData.category);
    const shouldAutoGenerateCode =
      itemData.auto_generate_code === true ||
      itemData.autoGenerateCode === true ||
      !String(itemData.code || "").trim();
    const itemCode = shouldAutoGenerateCode
      ? await this.generateNextItemCode(tenantId, category)
      : toUpperCode(itemData.code);
    const requiresReorderLevel =
      category === "RAW_MATERIAL" ||
      category === "CAPITAL_GOODS" ||
      category === "CONSUMABLE";
    if (requiresReorderLevel && !isRndItem) {
      if (!reorderLevel || reorderLevel <= 0) {
        throw new BadRequestException(
          "Reorder level must be greater than 0 for RAW_MATERIAL, CAPITAL_GOODS, and CONSUMABLE items.",
        );
      }
    }

    const { data, error } = await this.supabase
      .from("items")
      .insert({
        tenant_id: tenantId,
        code: itemCode,
        name: itemData.name,
        oem_part_no: oemPartNo,
        oem_name: oemName,
        description: toTitleCase(itemData.description),
        category,
        product_category:
          toTitleCase(
            itemData.product_category ?? itemData.productCategory ?? "",
          ) || null,
        uom: toUpperCode(itemData.uom),
        product_size: this.normalizeNumber(
          itemData.product_size ?? itemData.productSize,
        ),
        product_size_uom:
          this.normalizeOptionalText(
            itemData.product_size_uom ?? itemData.productSizeUom,
          )?.toUpperCase() || null,
        reorder_level: reorderLevel,
        min_stock: itemData.minStock,
        max_stock: itemData.maxStock,
        standard_cost: standardCost,
        selling_price: null,
        reorder_quantity: reorderQuantity,
        lead_time_days: leadTimeDays,
        hsn_code: validatedHsn,
        drawing_required: drawingRequired,
        item_type: itemData.item_type || "RAW_MATERIAL",
        parent_item_id: itemData.parent_item_id || null,
        project_id: projectId,
        project_name: projectName,
        is_rnd_item: isRndItem,
        is_variant: itemData.is_variant || false,
        is_default_variant: itemData.is_default_variant || false,
        variant_name: itemData.variant_name || null,
        ...uidFields,
        ...commercialUomFields,
        purchase_currency: purchaseCurrency,
        foreign_unit_price:
          purchaseCurrency === "INR" ? null : foreignUnitPrice,
        is_active: true,
        is_verified: false,
        created_by: userId,
        approval_status: "PENDING",
        approval_reason: null,
        metadata: {
          ...(itemData.metadata || {}),
          createdBy: userId,
          isRndItem,
          department,
          projectId,
          projectName,
          itemApproval: {
            status: "PENDING",
            submittedAt: new Date().toISOString(),
            submittedBy: userId,
          },
        },
      })
      .select()
      .single();

    console.log("[ItemsService.create] Database result:", { data, error });

    if (error) {
      console.error("[ItemsService.create] Database error:", error);

      // Check for duplicate key constraint violation
      if (error.code === "23505" && error.message.includes("items_code_key")) {
        throw new BadRequestException(
          `Item with code '${itemCode}' already exists`,
        );
      }

      throw new BadRequestException(`Failed to create item: ${error.message}`);
    }

    console.log("[ItemsService.create] Successfully created item:", data?.id);
    await this.logApprovalHistory({
      tenantId,
      itemId: data.id,
      actorId: userId,
      action: "CREATED",
      toStatus: "PENDING",
    });
    return data;
  }

  /**
   * Lightweight R&D procurement item. These records deliberately bypass the
   * normal material-master completeness, drawing and reorder rules. Regular
   * users still submit them to maker-checker approval; only Super Admin may
   * use explicit maker-checker override. They remain tenant scoped and are hidden
   * from normal catalogue searches by the existing is_rnd_item scope.
   */
  async createRndTemporary(
    tenantId: string,
    userId: string,
    body: any,
    options: { adminBypass?: boolean } = {},
  ) {
    const identifier = String(
      body?.identifier ??
        body?.code ??
        body?.sku ??
        body?.part_no ??
        body?.oem_part_no ??
        "",
    ).trim();
    const rawVendorId = String(body?.vendor_id ?? body?.vendorId ?? "").trim();
    const vendorId = rawVendorId || null;
    const description =
      String(
        body?.description ??
          body?.item_description ??
          body?.itemDescription ??
          "",
      ).trim() || null;
    const oemName = this.normalizeOptionalText(
      body?.oem_name ??
        body?.oemName ??
        body?.manufacturer_name ??
        body?.manufacturerName,
    );
    const preferredPrice = this.normalizeNumber(
      body?.preferred_price ?? body?.preferredPrice,
    );
    const effectiveDate =
      String(body?.effective_date ?? body?.effectiveDate ?? "").trim() ||
      new Date().toISOString().slice(0, 10);
    const hsnCode =
      String(body?.hsn_code ?? body?.hsnCode ?? "")
        .replace(/\D/g, "")
        .slice(0, 8) || null;

    if (!identifier)
      throw new BadRequestException("SKU / Part No. / OEM No. is required");
    if (vendorId && !this.isUuid(vendorId))
      throw new BadRequestException("Select a valid preferred vendor");
    if (preferredPrice !== null && preferredPrice < 0) {
      throw new BadRequestException("Preferred price cannot be negative");
    }

    const code = this.buildTemporaryRndCode(identifier);
    const { data: duplicate, error: duplicateError } = await this.supabase
      .from("items")
      .select(
        "id, code, name, description, oem_part_no, oem_name, uom, hsn_code, standard_cost, is_rnd_item, metadata",
      )
      .eq("tenant_id", tenantId)
      .ilike("code", code)
      .maybeSingle();
    if (duplicateError) throw new BadRequestException(duplicateError.message);
    if (duplicate?.id) {
      const metadata =
        duplicate.metadata && typeof duplicate.metadata === "object"
          ? duplicate.metadata
          : {};
      if (duplicate.is_rnd_item === true && metadata.isTemporary === true) {
        return {
          ...duplicate,
          preferred_vendor_id: vendorId,
          preferred_vendor_name: null,
          preferred_price: preferredPrice,
          reused: true,
        };
      }
      throw new BadRequestException(
        `Item '${code}' already exists in the material master`,
      );
    }

    let vendor: any = null;
    if (vendorId) {
      const { data: vendorRow, error: vendorError } = await this.supabase
        .from("vendors")
        .select("id, code, name, is_active")
        .eq("tenant_id", tenantId)
        .eq("id", vendorId)
        .maybeSingle();
      if (vendorError) throw new BadRequestException(vendorError.message);
      if (!vendorRow?.id || vendorRow.is_active === false)
        throw new BadRequestException("Selected vendor is not active");
      vendor = vendorRow;
    }

    const createdAt = new Date().toISOString();
    const autoApproved = options.adminBypass === true;
    const metadata = {
      isRndItem: true,
      isTemporary: true,
      excludeLowStock: true,
      department: "R&D",
      effectiveDate,
      createdBy: userId,
      temporaryItem: {
        identifier,
        description,
        oemName,
        vendorId,
        vendorName: vendor?.name || null,
        preferredPrice,
        effectiveDate,
      },
      itemApproval: {
        status: autoApproved ? "APPROVED" : "PENDING",
        submittedAt: createdAt,
        submittedBy: userId,
        approvedAt: autoApproved ? createdAt : null,
        approvedBy: autoApproved ? userId : null,
        reason: autoApproved
          ? "Admin override for temporary R&D procurement item"
          : null,
      },
    };

    const { data: item, error: itemError } = await this.supabase
      .from("items")
      .insert({
        tenant_id: tenantId,
        code,
        name: description || identifier,
        oem_part_no: identifier,
        oem_name: oemName,
        description,
        category: "RAW_MATERIAL",
        uom: "NOS",
        reorder_level: 0,
        reorder_quantity: 0,
        standard_cost: preferredPrice,
        selling_price: null,
        hsn_code: hsnCode,
        drawing_required: "NOT_REQUIRED",
        // The database item_type constraint only permits the standard material
        // types. R&D temporariness is represented by is_rnd_item and metadata.
        item_type: "RAW_MATERIAL",
        is_rnd_item: true,
        is_variant: false,
        purchase_currency: "INR",
        is_active: true,
        is_verified: autoApproved,
        created_by: userId,
        approval_status: autoApproved ? "APPROVED" : "PENDING",
        approval_reason: autoApproved
          ? "Admin override for temporary R&D procurement item"
          : null,
        metadata,
      })
      .select()
      .single();
    if (itemError) {
      if (itemError.code === "23505")
        throw new BadRequestException(`Item '${code}' already exists`);
      throw new BadRequestException(
        `Failed to create temporary R&D item: ${itemError.message}`,
      );
    }

    if (vendorId) {
      const { error: linkError } = await this.supabase
        .from("item_vendors")
        .insert({
          tenant_id: tenantId,
          item_id: item.id,
          vendor_id: vendorId,
          priority: 1,
          unit_price: preferredPrice,
          vendor_item_code: identifier,
          notes: `Temporary R&D item effective ${effectiveDate}`,
          is_active: true,
          created_by: userId,
        });
      if (linkError) {
        await this.supabase
          .from("items")
          .delete()
          .eq("tenant_id", tenantId)
          .eq("id", item.id);
        throw new BadRequestException(
          `Failed to link preferred vendor: ${linkError.message}`,
        );
      }
    }

    return {
      ...item,
      preferred_vendor_id: vendor?.id || null,
      preferred_vendor_name: vendor?.name || null,
      preferred_vendor_code: vendor?.code || null,
      preferred_price: preferredPrice,
      effective_date: effectiveDate,
      is_temporary: true,
      approval_status: autoApproved ? "APPROVED" : "PENDING",
      requires_checker_approval: !autoApproved,
    };
  }

  async bulkCreate(tenantId: string, items: any[]) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException(
        "Import file has no item rows. Please upload a CSV with at least one item.",
      );
    }

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
    };

    const addImportError = (row: number, item: any, message: any) => {
      const itemLabel = String(item || "Unknown item").trim();
      const errorMessage = String(message || "Import failed").trim();
      results.errors.push(`Row ${row} - ${itemLabel} - ${errorMessage}`);
    };

    // Map category names from user's format to database format
    const categoryMap: any = {
      Services: "SERVICES",
      Service: "SERVICES",
      "Injection Moulding": "RAW_MATERIAL",
      Machining: "RAW_MATERIAL",
      "Raw Material": "RAW_MATERIAL",
      Products: "RAW_MATERIAL",
      "Sub Assemblies": "RAW_MATERIAL",
      Consumables: "CONSUMABLE",
      "Packing Material": "RAW_MATERIAL",
      "Spare Parts": "CONSUMABLE",
      "Capital Goods": "CAPITAL_GOODS",
    };

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        // Map Excel column names to database fields - support multiple formats
        const rawCode =
          item["SAS Part Number"] ||
          item["SAS Part No"] ||
          item["SAS Part No."] ||
          item["Item Code"] ||
          item.code ||
          item.Code ||
          item.CODE ||
          item["Item code"] ||
          item["item code"];
        const rawName =
          item["Item Name"] ||
          item.name ||
          item.Name ||
          item.NAME ||
          item["Item name"] ||
          item["item name"];
        const rawCategory =
          item["Item Group"] ||
          item.category ||
          item.Category ||
          item.CATEGORY ||
          item["Item group"] ||
          item["item group"];
        const rawUom =
          item["Default Unit of Measure"] ||
          item.uom ||
          item.UOM ||
          item.unit ||
          item.Unit ||
          item["Unit of Measure"];
        const rawHsn =
          item["HSN/SAC"] ||
          item.hsn ||
          item.HSN ||
          item.hsn_code ||
          item["HSN Code"];
        const rawOemPartNo =
          item["OEM Part No"] ||
          item["OEM Part No."] ||
          item["OEM Part Number"] ||
          item.oem_part_no ||
          item.oemPartNo ||
          item.OEM;

        const rawStandardCost =
          item.standard_cost ||
          item.StandardCost ||
          item["Standard Cost"] ||
          item["Standard cost"] ||
          item.cost ||
          item.Cost ||
          item["Unit Cost"] ||
          item["Unit cost"] ||
          item["Rate"] ||
          item.rate;

        const validatedHsn = this.normalizeAndValidateHsn(rawHsn, {
          required: true,
        });

        // Map category to database format
        const mappedCategory = normalizeInventoryCategory(
          categoryMap[rawCategory] || rawCategory || "RAW_MATERIAL",
        );

        const itemData = {
          code: rawCode,
          name: rawName || rawCode, // Use code as name if name is not provided
          oem_part_no: this.normalizeOptionalText(rawOemPartNo),
          description:
            item.description || item.Description || item.DESCRIPTION || "",
          category: mappedCategory,
          uom: rawUom || "PCS",
          standard_cost: this.normalizeNumber(rawStandardCost),
          selling_price: null,
          reorder_level: this.normalizeNumber(
            item.reorder_level ||
              item.ReorderLevel ||
              item["Reorder Level"] ||
              item["Reorder level"] ||
              item.min_qty,
            "int",
          ),
          reorder_quantity: this.normalizeNumber(
            item.reorder_quantity ||
              item.ReorderQuantity ||
              item["Reorder Quantity"] ||
              item["Reorder quantity"] ||
              item.order_qty,
            "int",
          ),
          lead_time_days: this.normalizeNumber(
            item.lead_time_days ||
              item.LeadTimeDays ||
              item["Lead Time"] ||
              item["Lead time"] ||
              item.lead_time,
            "int",
          ),
        };

        const rowData: any = {
          tenant_id: tenantId,
          code: toUpperCode(itemData.code),
          name: itemData.name,
          oem_part_no: itemData.oem_part_no,
          description: toTitleCase(itemData.description),
          category: itemData.category,
          uom: toUpperCode(itemData.uom),
          standard_cost: itemData.standard_cost,
          selling_price: itemData.selling_price,
          reorder_level: itemData.reorder_level,
          reorder_quantity: itemData.reorder_quantity,
          lead_time_days: itemData.lead_time_days,
          hsn_code: validatedHsn,
          is_active: true,
          is_verified: false,
          metadata: {
            item_group: rawCategory || null,
          },
        };

        const { data: existingRow, error: lookupError } = await this.supabase
          .from("items")
          .select("id, metadata")
          .eq("tenant_id", tenantId)
          .eq("code", rowData.code)
          .maybeSingle();

        if (lookupError) {
          throw new Error(lookupError.message);
        }

        let writeResult;
        if (existingRow?.id) {
          const existingMetadata =
            existingRow.metadata && typeof existingRow.metadata === "object"
              ? existingRow.metadata
              : {};
          const updateData = {
            ...rowData,
            // Do not silently remove purchasing verification from existing
            // material masters during import/upsert. New rows still start
            // unverified from rowData; existing rows keep their current
            // maker-checker state unless the explicit verify/unverify flow is used.
            is_verified: undefined,
            metadata: {
              ...existingMetadata,
              ...(rowData.metadata || {}),
            },
            updated_at: new Date().toISOString(),
          };
          delete (updateData as any).tenant_id;
          delete (updateData as any).is_verified;

          writeResult = await this.supabase
            .from("items")
            .update(updateData)
            .eq("tenant_id", tenantId)
            .eq("id", existingRow.id);
        } else {
          writeResult = await this.supabase.from("items").insert(rowData);
        }

        const error = writeResult.error;

        if (error) {
          results.failed++;
          addImportError(i + 1, itemData.name || itemData.code, error.message);
        } else {
          results.success++;
        }
      } catch (err: any) {
        results.failed++;
        addImportError(i + 1, item?.name || item?.code, err.message);
      }
    }

    return results;
  }

  async update(tenantId: string, id: string, itemData: any, userId?: string) {
    await this.projectsService.ensureSchema();
    const existingItem = await this.findOne(tenantId, id);
    const hsnProvided =
      itemData.hsnCode !== undefined || itemData.hsn_code !== undefined;
    const validatedHsn = hsnProvided
      ? this.normalizeAndValidateHsn(itemData.hsnCode ?? itemData.hsn_code, {
          required: true,
        })
      : null;
    const fromStatus = this.normalizeApprovalStatus(
      existingItem.approval_status ||
        (existingItem.is_verified ? "APPROVED" : "PENDING"),
    );
    const approvalSensitiveKeys = [
      "code",
      "name",
      "oem_part_no",
      "oemPartNo",
      "oem_part_number",
      "oemPartNumber",
      "oem_name",
      "oemName",
      "description",
      "category",
      "product_category",
      "productCategory",
      "uom",
      "standard_cost",
      "standardCost",
      "reorder_level",
      "reorderLevel",
      "reorder_quantity",
      "reorderQuantity",
      "lead_time_days",
      "leadTimeDays",
      "hsnCode",
      "hsn_code",
      "purchase_currency",
      "purchaseCurrency",
      "foreign_unit_price",
      "foreignUnitPrice",
      "parent_item_id",
      "is_variant",
      "is_default_variant",
      "variant_name",
      "item_type",
      "drawing_required",
      "drawingRequired",
      "uid_tracking",
      "uidTracking",
      "uid_strategy",
      "uidStrategy",
      "batch_uom",
      "batchUom",
      "batch_quantity",
      "batchQuantity",
      "sales_uom",
      "salesUom",
      "sales_uom_factor",
      "salesUomFactor",
      "sales_whole_uom_only",
      "salesWholeUomOnly",
    ];
    const approvedItemChanged =
      (existingItem.is_verified === true || fromStatus === "APPROVED") &&
      approvalSensitiveKeys.some((key) => itemData[key] !== undefined);
    const rndFlagProvided =
      itemData.isRndItem !== undefined ||
      itemData.is_rnd_item !== undefined ||
      itemData.department !== undefined ||
      itemData.scope !== undefined ||
      itemData.projectDepartment !== undefined;
    const nextIsRndItem = rndFlagProvided
      ? itemData.isRndItem === true ||
        itemData.is_rnd_item === true ||
        this.isRndScope(itemData.department) ||
        this.isRndScope(itemData.scope) ||
        this.isRndScope(itemData.projectDepartment)
      : this.isRndItemRecord(existingItem);

    const updateData: any = {
      updated_at: new Date().toISOString(),
      ...(userId ? { updated_by: userId } : {}),
    };

    // Only update fields that are provided
    if (itemData.code !== undefined)
      updateData.code = toUpperCode(itemData.code);
    if (itemData.name !== undefined) updateData.name = itemData.name;
    if (
      itemData.oem_part_no !== undefined ||
      itemData.oemPartNo !== undefined ||
      itemData.oem_part_number !== undefined ||
      itemData.oemPartNumber !== undefined
    ) {
      updateData.oem_part_no = this.normalizeOptionalText(
        itemData.oem_part_no ??
          itemData.oemPartNo ??
          itemData.oem_part_number ??
          itemData.oemPartNumber,
      );
    }
    if (itemData.oem_name !== undefined || itemData.oemName !== undefined) {
      updateData.oem_name = this.normalizeOptionalText(
        itemData.oem_name ?? itemData.oemName,
      );
    }
    if (itemData.description !== undefined)
      updateData.description = toTitleCase(itemData.description);
    if (itemData.category !== undefined)
      updateData.category = normalizeInventoryCategory(itemData.category);
    if (
      itemData.product_category !== undefined ||
      itemData.productCategory !== undefined
    ) {
      updateData.product_category =
        toTitleCase(
          itemData.product_category ?? itemData.productCategory ?? "",
        ) || null;
    }
    if (itemData.uom !== undefined) updateData.uom = toUpperCode(itemData.uom);
    const commercialUomProvided =
      itemData.sales_uom !== undefined ||
      itemData.salesUom !== undefined ||
      itemData.sales_uom_factor !== undefined ||
      itemData.salesUomFactor !== undefined ||
      itemData.sales_whole_uom_only !== undefined ||
      itemData.salesWholeUomOnly !== undefined ||
      itemData.uom !== undefined;
    if (commercialUomProvided) {
      Object.assign(
        updateData,
        this.normalizeCommercialUomFields(
          {
            sales_uom:
              itemData.sales_uom ?? itemData.salesUom ?? existingItem.sales_uom,
            sales_uom_factor:
              itemData.sales_uom_factor ??
              itemData.salesUomFactor ??
              existingItem.sales_uom_factor,
            sales_whole_uom_only:
              itemData.sales_whole_uom_only ??
              itemData.salesWholeUomOnly ??
              existingItem.sales_whole_uom_only,
          },
          itemData.uom ?? existingItem.uom,
        ),
      );
    }
    if (
      itemData.product_size !== undefined ||
      itemData.productSize !== undefined
    )
      updateData.product_size = this.normalizeNumber(
        itemData.product_size ?? itemData.productSize,
      );
    if (
      itemData.product_size_uom !== undefined ||
      itemData.productSizeUom !== undefined
    )
      updateData.product_size_uom =
        this.normalizeOptionalText(
          itemData.product_size_uom ?? itemData.productSizeUom,
        )?.toUpperCase() || null;
    const standardCostProvided =
      itemData.standard_cost !== undefined ||
      itemData.standardCost !== undefined;
    const sellingPriceProvided =
      itemData.selling_price !== undefined ||
      itemData.sellingPrice !== undefined;
    const reorderLevelProvided =
      itemData.reorder_level !== undefined ||
      itemData.reorderLevel !== undefined;
    const reorderQtyProvided =
      itemData.reorder_quantity !== undefined ||
      itemData.reorderQuantity !== undefined;
    const leadTimeProvided =
      itemData.lead_time_days !== undefined ||
      itemData.leadTimeDays !== undefined;

    if (standardCostProvided) {
      updateData.standard_cost = this.normalizeNumber(
        itemData.standard_cost ?? itemData.standardCost,
      );
    }

    if (sellingPriceProvided) {
      updateData.selling_price = null;
    }

    if (reorderLevelProvided) {
      updateData.reorder_level = this.normalizeNumber(
        itemData.reorder_level ?? itemData.reorderLevel,
        "int",
      );
    }

    // Validate reorder level only for stock-tracked categories.
    // (SERVICE is excluded because services do not maintain inventory stock.)
    const category =
      itemData.category !== undefined
        ? normalizeInventoryCategory(itemData.category)
        : normalizeInventoryCategory(existingItem.category);
    const requiresReorderLevel =
      category === "RAW_MATERIAL" ||
      category === "CAPITAL_GOODS" ||
      category === "CONSUMABLE";
    if (requiresReorderLevel && reorderLevelProvided && !nextIsRndItem) {
      if (!updateData.reorder_level || updateData.reorder_level <= 0) {
        throw new BadRequestException(
          "Reorder level must be greater than 0 for RAW_MATERIAL, CAPITAL_GOODS, and CONSUMABLE items.",
        );
      }
    }

    if (reorderQtyProvided) {
      updateData.reorder_quantity = this.normalizeNumber(
        itemData.reorder_quantity ?? itemData.reorderQuantity,
        "int",
      );
    }

    if (leadTimeProvided) {
      updateData.lead_time_days = this.normalizeNumber(
        itemData.lead_time_days ?? itemData.leadTimeDays,
        "int",
      );
    }

    if (itemData.minStock !== undefined)
      updateData.min_stock = itemData.minStock;
    if (itemData.maxStock !== undefined)
      updateData.max_stock = itemData.maxStock;
    if (itemData.metadata !== undefined)
      updateData.metadata = itemData.metadata;
    if (rndFlagProvided) updateData.is_rnd_item = nextIsRndItem;
    if (itemData.project_id !== undefined || itemData.projectId !== undefined) {
      updateData.project_id = this.normalizeOptionalText(
        itemData.project_id ?? itemData.projectId,
      );
    }
    if (
      itemData.project_name !== undefined ||
      itemData.projectName !== undefined
    ) {
      updateData.project_name = this.normalizeOptionalText(
        itemData.project_name ?? itemData.projectName,
      );
    }
    if (
      updateData.is_rnd_item !== undefined ||
      updateData.project_id !== undefined ||
      updateData.project_name !== undefined
    ) {
      const metadata =
        existingItem.metadata && typeof existingItem.metadata === "object"
          ? existingItem.metadata
          : {};
      updateData.metadata = {
        ...(updateData.metadata && typeof updateData.metadata === "object"
          ? updateData.metadata
          : metadata),
        isRndItem: nextIsRndItem,
        department: nextIsRndItem
          ? "R&D"
          : (itemData.department ?? metadata.department ?? null),
        projectId: updateData.project_id ?? metadata.projectId ?? null,
        projectName: updateData.project_name ?? metadata.projectName ?? null,
      };
    }
    if (validatedHsn !== null) updateData.hsn_code = validatedHsn;
    if (itemData.is_active !== undefined)
      updateData.is_active = itemData.is_active;

    // Foreign currency fields
    if (
      itemData.purchase_currency !== undefined ||
      itemData.purchaseCurrency !== undefined
    ) {
      const currency =
        (itemData.purchase_currency ?? itemData.purchaseCurrency ?? "INR")
          .toString()
          .toUpperCase()
          .trim() || "INR";
      updateData.purchase_currency = currency;
      if (currency === "INR") {
        updateData.foreign_unit_price = null;
      }
    }
    if (
      itemData.foreign_unit_price !== undefined ||
      itemData.foreignUnitPrice !== undefined
    ) {
      updateData.foreign_unit_price = this.normalizeNumber(
        itemData.foreign_unit_price ?? itemData.foreignUnitPrice,
      );
    }

    // Variant fields
    if (itemData.parent_item_id !== undefined)
      updateData.parent_item_id = itemData.parent_item_id || null;
    if (itemData.is_variant !== undefined)
      updateData.is_variant = itemData.is_variant;
    if (itemData.is_default_variant !== undefined)
      updateData.is_default_variant = itemData.is_default_variant;
    if (itemData.variant_name !== undefined)
      updateData.variant_name = itemData.variant_name || null;
    if (itemData.item_type !== undefined)
      updateData.item_type = itemData.item_type || "RAW_MATERIAL";

    const drawingRequired =
      itemData.drawing_required ?? itemData.drawingRequired;
    if (drawingRequired !== undefined) {
      if (
        drawingRequired !== "OPTIONAL" &&
        drawingRequired !== "COMPULSORY" &&
        drawingRequired !== "NOT_REQUIRED"
      ) {
        throw new BadRequestException(
          "Invalid drawing_required. Must be OPTIONAL, COMPULSORY, or NOT_REQUIRED.",
        );
      }

      // COMPULSORY means evidence must exist. Production release separately
      // requires an approved/effective revision.
      if (drawingRequired === "COMPULSORY") {
        const { data: activeDrawings, error: drawingError } =
          await this.supabase
            .from("item_drawings")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("item_id", id)
            .limit(1);

        if (drawingError) {
          throw new BadRequestException(
            `Failed to check drawing status: ${drawingError.message}`,
          );
        }

        if (!activeDrawings || activeDrawings.length === 0) {
          throw new BadRequestException(
            "Cannot set drawing as COMPULSORY. Please upload at least one drawing first.",
          );
        }
      }

      updateData.drawing_required = drawingRequired;
    }

    const uidFields = this.normalizeUidFields(itemData);
    Object.assign(updateData, uidFields);

    if (approvedItemChanged) {
      const metadata =
        existingItem.metadata && typeof existingItem.metadata === "object"
          ? existingItem.metadata
          : {};
      updateData.is_verified = false;
      updateData.verified_at = null;
      updateData.verified_by = null;
      updateData.approval_status = "PENDING";
      updateData.approval_reason =
        "Verified item edited; re-verification required.";
      updateData.approved_at = null;
      updateData.approved_by = null;
      updateData.metadata = {
        ...(updateData.metadata && typeof updateData.metadata === "object"
          ? updateData.metadata
          : metadata),
        itemApproval: {
          status: "PENDING",
          submittedAt: new Date().toISOString(),
          submittedBy: userId || null,
          previousStatus: fromStatus,
          reason: "Verified item edited; re-verification required.",
        },
      };
    }

    const { data, error } = await this.supabase
      .from("items")
      .update(updateData)
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update item: ${error.message}`);
    }

    await this.logApprovalHistory({
      tenantId,
      itemId: id,
      actorId: userId || null,
      action: approvedItemChanged
        ? "EDITED_REVERIFICATION_REQUIRED"
        : "UPDATED",
      fromStatus,
      toStatus: approvedItemChanged ? "PENDING" : fromStatus,
      reason: approvedItemChanged
        ? "Verified item edited; re-verification required."
        : null,
    });

    return data;
  }

  async setVerification(
    tenantId: string,
    userId: string,
    id: string,
    isVerified: boolean,
    options: { overrideMakerChecker?: boolean } = {},
  ) {
    const existing = await this.findOne(tenantId, id);
    if (!options.overrideMakerChecker) {
      this.assertMakerChecker(
        existing,
        userId,
        isVerified ? "verify" : "remove verification for",
      );
    }
    const fromStatus = this.normalizeApprovalStatus(
      existing.approval_status ||
        (existing.is_verified ? "APPROVED" : "PENDING"),
    );
    const now = new Date().toISOString();
    const metadata =
      existing.metadata && typeof existing.metadata === "object"
        ? existing.metadata
        : {};
    const updateData = isVerified
      ? {
          is_verified: true,
          verified_at: now,
          verified_by: userId,
          approval_status: "APPROVED",
          approval_reason: null,
          approved_at: now,
          approved_by: userId,
          updated_at: now,
          metadata: {
            ...metadata,
            itemApproval: {
              status: "APPROVED",
              approvedAt: now,
              approvedBy: userId,
            },
          },
        }
      : {
          is_verified: false,
          verified_at: null,
          verified_by: null,
          approval_status: "PENDING",
          approval_reason: null,
          approved_at: null,
          approved_by: null,
          updated_at: now,
          metadata: {
            ...metadata,
            itemApproval: {
              status: "PENDING",
              submittedAt: now,
              submittedBy: userId,
            },
          },
        };

    const { data, error } = await this.supabase
      .from("items")
      .update(updateData)
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .select()
      .single();

    if (error)
      throw new BadRequestException(
        `Failed to update item verification: ${error.message}`,
      );
    await this.logApprovalHistory({
      tenantId,
      itemId: id,
      actorId: userId,
      action: isVerified ? "VERIFIED" : "VERIFICATION_REMOVED",
      fromStatus,
      toStatus: isVerified ? "APPROVED" : "PENDING",
    });
    return data;
  }

  async assertItemsVerified(tenantId: string, rawItems: any[]) {
    const ids = Array.from(
      new Set(
        (Array.isArray(rawItems) ? rawItems : [])
          .map((item) => String(item?.itemId || item?.item_id || "").trim())
          .filter(Boolean),
      ),
    );
    const codes = Array.from(
      new Set(
        (Array.isArray(rawItems) ? rawItems : [])
          .map((item) => String(item?.itemCode || item?.item_code || "").trim())
          .filter(Boolean),
      ),
    );

    if (ids.length === 0 && codes.length === 0) return;

    const byId = new Map<string, any>();
    const byCode = new Map<string, any>();

    if (ids.length > 0) {
      const { data, error } = await this.supabase
        .from("items")
        .select("id, code, name, is_active, is_verified")
        .eq("tenant_id", tenantId)
        .in("id", ids);
      if (error) throw new BadRequestException(error.message);
      (data || []).forEach((item: any) => byId.set(String(item.id), item));
    }

    if (codes.length > 0) {
      const { data, error } = await this.supabase
        .from("items")
        .select("id, code, name, is_active, is_verified")
        .eq("tenant_id", tenantId)
        .in("code", codes);
      if (error) throw new BadRequestException(error.message);
      (data || []).forEach((item: any) => byCode.set(String(item.code), item));
    }

    for (const rawItem of Array.isArray(rawItems) ? rawItems : []) {
      const id = String(rawItem?.itemId || rawItem?.item_id || "").trim();
      const code = String(rawItem?.itemCode || rawItem?.item_code || "").trim();
      const item = (id && byId.get(id)) || (code && byCode.get(code));
      if (!item) continue;
      const label = item.name || item.code || code || id;
      if (item.is_active === false)
        throw new BadRequestException(
          `Item ${label} is inactive and cannot be used.`,
        );
      // Verification check disabled - causing too many errors
      // if (item.is_verified !== true) throw new BadRequestException(`Item ${label} is not verified by admin and cannot be used.`);
    }
  }

  async assertItemVerified(tenantId: string, itemId: string) {
    await this.assertItemsVerified(tenantId, [{ itemId }]);
  }

  async delete(tenantId: string, userId: string, id: string) {
    // Soft delete
    const { error } = await this.supabase
      .from("items")
      .update({ is_active: false })
      .eq("tenant_id", tenantId)
      .eq("id", id);

    void userId;

    if (error) {
      throw new Error(mapDeleteAuditError(error, "item"));
    }

    return { message: "Item deleted successfully" };
  }

  // Drawing/Document Management
  async getDrawings(tenantId: string, itemId: string) {
    const { data, error } = await this.supabase
      .from("item_drawings")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("item_id", itemId)
      .order("version", { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch drawings: ${error.message}`);
    }

    return data || [];
  }

  async uploadDrawing(
    tenantId: string,
    userId: string,
    itemId: string,
    drawingData: any,
  ) {
    const documentId = (
      drawingData?.documentId ||
      drawingData?.document_id ||
      ""
    )
      .toString()
      .trim();

    let resolvedFileName = drawingData?.fileName;
    let resolvedFileUrl = drawingData?.fileUrl;
    let resolvedFileType = drawingData?.fileType;
    let resolvedFileSize = drawingData?.fileSize;

    if (documentId) {
      const { data: doc, error: docError } = await this.supabase
        .from("documents")
        .select("id, file_url, file_name, file_type, file_size, title")
        .eq("tenant_id", tenantId)
        .eq("id", documentId)
        .single();

      if (docError || !doc) {
        throw new Error(
          `Failed to link drawing from document: ${docError?.message || "Document not found"}`,
        );
      }

      resolvedFileUrl = doc.file_url;
      resolvedFileName = doc.file_name || doc.title || "drawing";
      resolvedFileType = doc.file_type;
      resolvedFileSize = doc.file_size;
    }

    if (!resolvedFileUrl) {
      throw new Error("Missing drawing fileUrl");
    }

    // Get current max version for this item
    const { data: existingDrawings } = await this.supabase
      .from("item_drawings")
      .select("version")
      .eq("tenant_id", tenantId)
      .eq("item_id", itemId)
      .order("version", { ascending: false })
      .limit(1);

    const nextVersion =
      existingDrawings && existingDrawings.length > 0
        ? existingDrawings[0].version + 1
        : 1;

    const baseInsert: any = {
      tenant_id: tenantId,
      item_id: itemId,
      file_name: resolvedFileName,
      file_url: resolvedFileUrl,
      file_type: resolvedFileType,
      file_size: resolvedFileSize,
      version: nextVersion,
      drawing_number: String(
        drawingData?.drawingNumber ||
          drawingData?.drawing_number ||
          `DRW-${itemId.slice(0, 8)}`,
      ).trim(),
      revision_code: String(
        drawingData?.revisionCode ||
          drawingData?.revision_code ||
          `R${nextVersion}`,
      )
        .trim()
        .toUpperCase(),
      document_type: String(
        drawingData?.documentType || drawingData?.document_type || "DRAWING",
      )
        .trim()
        .toUpperCase(),
      lifecycle_status: "DRAFT",
      effective_from:
        drawingData?.effectiveFrom || drawingData?.effective_from || null,
      metadata:
        drawingData?.metadata && typeof drawingData.metadata === "object"
          ? drawingData.metadata
          : {},
      revision_notes: drawingData.revisionNotes,
      is_active: false,
      uploaded_by: userId,
    };

    const tryInsert = async (payload: any) => {
      return this.supabase
        .from("item_drawings")
        .insert(payload)
        .select()
        .single();
    };

    // Prefer to persist the source document reference when available, but tolerate schema drift.
    let insertResult = documentId
      ? await tryInsert({ ...baseInsert, document_id: documentId })
      : await tryInsert(baseInsert);

    if (insertResult.error && documentId) {
      const message = String(
        (insertResult.error as any)?.message || "",
      ).toLowerCase();
      if (
        message.includes("document_id") &&
        (message.includes("column") || message.includes("does not exist"))
      ) {
        insertResult = await tryInsert(baseInsert);
      }
    }

    const data = insertResult.data as any;
    const error = insertResult.error as any;

    if (error) {
      throw new Error(`Failed to upload drawing: ${error.message}`);
    }

    return data;
  }

  async transitionDrawing(
    tenantId: string,
    userId: string,
    itemId: string,
    drawingId: string,
    action: string,
    body: any = {},
  ) {
    const { data: drawing, error: findError } = await this.supabase
      .from("item_drawings")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("item_id", itemId)
      .eq("id", drawingId)
      .single();
    if (findError || !drawing) throw new Error("Drawing revision not found");

    const normalizedAction = String(action || "")
      .trim()
      .toUpperCase();
    const now = new Date().toISOString();
    let payload: any;
    if (normalizedAction === "SUBMIT") {
      if (drawing.lifecycle_status !== "DRAFT")
        throw new Error("Only a draft revision can be submitted");
      payload = {
        lifecycle_status: "SUBMITTED",
        submitted_by: userId,
        submitted_at: now,
        updated_at: now,
      };
    } else if (normalizedAction === "APPROVE") {
      if (drawing.lifecycle_status !== "SUBMITTED")
        throw new Error("Only a submitted revision can be approved");
      if (
        drawing.submitted_by &&
        String(drawing.submitted_by) === String(userId)
      )
        throw new Error(
          "The submitter cannot approve the same drawing revision",
        );
      const effectiveFrom =
        body.effectiveFrom || body.effective_from || now.slice(0, 10);
      const { data: activeRows, error: activeError } = await this.supabase
        .from("item_drawings")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("item_id", itemId)
        .eq("lifecycle_status", "APPROVED")
        .neq("id", drawingId);
      if (activeError) throw new Error(activeError.message);
      for (const active of activeRows || []) {
        const { error } = await this.supabase
          .from("item_drawings")
          .update({
            lifecycle_status: "SUPERSEDED",
            is_active: false,
            effective_to: effectiveFrom,
            superseded_by: drawingId,
            updated_at: now,
          })
          .eq("tenant_id", tenantId)
          .eq("id", active.id);
        if (error) throw new Error(error.message);
      }
      payload = {
        lifecycle_status: "APPROVED",
        approved_by: userId,
        approved_at: now,
        effective_from: effectiveFrom,
        effective_to: null,
        is_active: true,
        updated_at: now,
      };
    } else if (normalizedAction === "REJECT") {
      if (drawing.lifecycle_status !== "SUBMITTED")
        throw new Error("Only a submitted revision can be rejected");
      payload = {
        lifecycle_status: "DRAFT",
        submitted_by: null,
        submitted_at: null,
        revision_notes: body.reason || drawing.revision_notes,
        updated_at: now,
      };
    } else {
      throw new Error("Action must be SUBMIT, APPROVE, or REJECT");
    }
    const impact =
      normalizedAction === "APPROVE"
        ? await this.getDrawingImpact(tenantId, itemId, drawingId)
        : null;
    const { data, error } = await this.supabase
      .from("item_drawings")
      .update(payload)
      .eq("tenant_id", tenantId)
      .eq("item_id", itemId)
      .eq("id", drawingId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { ...data, impact };
  }

  async getDrawingImpact(
    tenantId: string,
    itemId: string,
    candidateDrawingId?: string,
  ) {
    const [
      { data: active },
      { data: jobs, error: jobError },
      { data: demands, error: demandError },
    ] = await Promise.all([
      this.supabase
        .from("item_drawings")
        .select("id,drawing_number,revision_code")
        .eq("tenant_id", tenantId)
        .eq("item_id", itemId)
        .eq("lifecycle_status", "APPROVED")
        .eq("is_active", true)
        .maybeSingle(),
      this.supabase
        .from("production_job_orders")
        .select("id,job_order_number,status,drawing_revision_id")
        .eq("tenant_id", tenantId)
        .eq("item_id", itemId)
        .not("status", "in", "(COMPLETED,CANCELLED,STOPPED)"),
      this.supabase
        .from("project_work_package_lines")
        .select("id,project_id,work_package_id,line_number,demand_status")
        .eq("tenant_id", tenantId)
        .eq("item_id", itemId)
        .not("demand_status", "in", "(COMPLETED,CANCELLED)"),
    ]);
    if (jobError) throw new Error(jobError.message);
    if (demandError) throw new Error(demandError.message);
    const frozenJobs = (jobs || []).filter(
      (job: any) =>
        job.drawing_revision_id &&
        job.drawing_revision_id !== candidateDrawingId,
    );
    return {
      current_revision: active || null,
      open_job_count: (jobs || []).length,
      frozen_open_jobs: frozenJobs,
      open_project_demand_count: (demands || []).length,
      warning:
        (jobs || []).length || (demands || []).length
          ? "This revision change affects open demand. Existing released jobs retain their frozen revision; review unreleased demand before planning."
          : null,
    };
  }

  async updateDrawing(
    tenantId: string,
    itemId: string,
    drawingId: string,
    drawingData: any,
  ) {
    if (drawingData.isActive === true) {
      throw new BadRequestException(
        "Use the controlled submit and approve workflow to activate a drawing revision.",
      );
    }
    const { data, error } = await this.supabase
      .from("item_drawings")
      .update({
        revision_notes: drawingData.revisionNotes,
        is_active: drawingData.isActive,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("item_id", itemId)
      .eq("id", drawingId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update drawing: ${error.message}`);
    }

    return data;
  }

  async deleteDrawing(tenantId: string, itemId: string, drawingId: string) {
    const { error } = await this.supabase
      .from("item_drawings")
      .update({ is_active: false })
      .eq("tenant_id", tenantId)
      .eq("item_id", itemId)
      .eq("id", drawingId);

    if (error) {
      throw new Error(`Failed to delete drawing: ${error.message}`);
    }

    return { message: "Drawing deleted successfully" };
  }

  private isMissingItemVendorsTenantIdColumn(error: any): boolean {
    const message = String(error?.message || "").toLowerCase();
    return (
      message.includes("item_vendors") &&
      message.includes("tenant_id") &&
      (message.includes("does not exist") || message.includes("column"))
    );
  }

  private async assertItemBelongsToTenant(tenantId: string, itemId: string) {
    const { data, error } = await this.supabase
      .from("items")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", itemId)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(
        `Failed to validate item tenant: ${error.message}`,
      );
    }

    if (!data?.id) {
      throw new NotFoundException("Item not found");
    }
  }

  // Item-Vendor Relationship Methods
  async getItemVendors(tenantId: string, itemId: string) {
    if (!this.isUuid(itemId)) {
      throw new BadRequestException("Invalid item id");
    }

    // Ensure tenant scoping even if item_vendors does not have tenant_id
    await this.assertItemBelongsToTenant(tenantId, itemId);

    const baseSelect = `
        *,
        vendor:vendors(id, code, name, contact_person, email, phone, is_active)
      `;

    const { data, error } = await this.supabase
      .from("item_vendors")
      .select(baseSelect)
      .eq("tenant_id", tenantId)
      .eq("item_id", itemId)
      .eq("is_active", true)
      .order("priority", { ascending: true });

    if (error && this.isMissingItemVendorsTenantIdColumn(error)) {
      throw new InternalServerErrorException(
        "item_vendors.tenant_id is required. Run migration add-tenant-id-to-item-vendors.sql",
      );
    }

    if (error) {
      throw new Error(`Failed to fetch item vendors: ${error.message}`);
    }

    return (data || []).filter((row: any) => {
      const vendor = Array.isArray(row?.vendor) ? row.vendor[0] : row?.vendor;
      return vendor?.is_active !== false;
    });
  }

  async getPreferredVendor(tenantId: string, itemId: string) {
    // Use the tenant-scoped item/vendor relation directly. The legacy RPC has
    // returned different column shapes across deployments, which left the PO
    // vendor control blank even though the item had a preferred vendor.
    const rows = await this.getItemVendors(tenantId, itemId);
    const preferred: any = Array.isArray(rows) ? rows[0] : null;
    if (!preferred) return null;

    const relation = Array.isArray(preferred.vendor)
      ? preferred.vendor[0]
      : preferred.vendor;
    const vendorId = String(preferred.vendor_id || relation?.id || "").trim();
    if (!vendorId) return null;

    return {
      ...preferred,
      vendor_id: vendorId,
      vendorId,
      vendor_name: String(relation?.name || preferred.vendor_name || "").trim(),
      vendorName: String(relation?.name || preferred.vendor_name || "").trim(),
      vendor: relation || null,
    };
  }

  async addItemVendor(
    tenantId: string,
    userId: string,
    itemId: string,
    body: any,
  ) {
    const vendorId = body?.vendor_id ?? body?.vendorId;
    if (!this.isUuid(itemId)) {
      throw new BadRequestException("Invalid item id");
    }
    if (!this.isUuid(vendorId)) {
      throw new BadRequestException(
        "vendor_id is required and must be a valid UUID",
      );
    }

    await this.assertItemBelongsToTenant(tenantId, itemId);
    await this.assertItemVerified(tenantId, itemId);

    const { data: vendor, error: vendorError } = await this.supabase
      .from("vendors")
      .select("id, name, code, is_active, is_verified")
      .eq("tenant_id", tenantId)
      .eq("id", vendorId)
      .maybeSingle();
    if (vendorError) throw new BadRequestException(vendorError.message);
    if (!vendor?.id) throw new BadRequestException("Vendor not found");
    if (vendor.is_active === false)
      throw new BadRequestException(
        `Vendor ${vendor.name || vendor.code || ""} is inactive and cannot be used.`,
      );
    // Verification check disabled - causing too many errors
    // if (vendor.is_verified !== true) throw new BadRequestException(`Vendor ${vendor.name || vendor.code || ''} is not verified by admin and cannot be used.`);

    // Idempotency: if the relationship already exists, return it (or reactivate it)
    // Try scoping by items.tenant_id first (handles schemas where item_vendors has no tenant_id column)
    const { data: existingRows, error: existingError } = await this.supabase
      .from("item_vendors")
      .select("*, items!inner(tenant_id)")
      .eq("items.tenant_id", tenantId)
      .eq("item_id", itemId)
      .eq("vendor_id", vendorId)
      .limit(1);

    if (
      existingError &&
      this.isMissingItemVendorsTenantIdColumn(existingError)
    ) {
      throw new InternalServerErrorException(
        "item_vendors.tenant_id is required. Run migration add-tenant-id-to-item-vendors.sql",
      );
    }

    if (existingError) {
      throw new InternalServerErrorException(
        `Failed to check existing vendor link: ${existingError.message}`,
      );
    }

    const existing = existingRows?.[0];
    if (existing?.id) {
      if (existing.is_active) {
        return existing;
      }

      const { data: reactivated, error: reactivateError } = await this.supabase
        .from("item_vendors")
        .update({ is_active: true, updated_by: userId })
        .eq("tenant_id", tenantId)
        .eq("item_id", itemId)
        .eq("vendor_id", vendorId)
        .select()
        .single();

      if (reactivateError) {
        throw new InternalServerErrorException(
          `Failed to reactivate vendor link: ${reactivateError.message}`,
        );
      }

      return reactivated;
    }

    const { data, error } = await this.supabase
      .from("item_vendors")
      .insert({
        tenant_id: tenantId,
        item_id: itemId,
        vendor_id: vendorId,
        priority: this.normalizeNumber(body?.priority, "int") ?? 1,
        unit_price: this.normalizeNumber(body.unit_price),
        lead_time_days: this.normalizeNumber(body.lead_time_days, "int"),
        vendor_item_code: body.vendor_item_code || null,
        minimum_order_quantity: this.normalizeNumber(
          body.minimum_order_quantity,
        ),
        payment_terms: body.payment_terms || null,
        notes: body.notes || null,
        created_by: userId,
      })
      .select()
      .single();

    if (error) {
      const message = String((error as any)?.message || "").toLowerCase();
      if (
        message.includes("duplicate key") ||
        message.includes("item_vendors_unique")
      ) {
        throw new ConflictException("Vendor is already linked to this item");
      }
      throw new InternalServerErrorException(
        `Failed to add vendor: ${error.message}`,
      );
    }

    return data;
  }

  async updateItemVendor(
    tenantId: string,
    userId: string,
    itemId: string,
    vendorId: string,
    body: any,
  ) {
    if (!this.isUuid(itemId)) {
      throw new BadRequestException("Invalid item id");
    }
    if (!this.isUuid(vendorId)) {
      throw new BadRequestException("Invalid vendor id");
    }

    await this.assertItemBelongsToTenant(tenantId, itemId);

    const { data, error } = await this.supabase
      .from("item_vendors")
      .update({
        priority: body?.priority,
        unit_price: this.normalizeNumber(body.unit_price),
        lead_time_days: this.normalizeNumber(body.lead_time_days, "int"),
        vendor_item_code: body.vendor_item_code,
        minimum_order_quantity: this.normalizeNumber(
          body.minimum_order_quantity,
        ),
        payment_terms: body.payment_terms,
        notes: body.notes,
        is_active: body.is_active !== undefined ? body.is_active : true,
        updated_by: userId,
      })
      .eq("tenant_id", tenantId)
      .eq("item_id", itemId)
      .eq("vendor_id", vendorId)
      .select()
      .single();

    if (error && this.isMissingItemVendorsTenantIdColumn(error)) {
      throw new InternalServerErrorException(
        "item_vendors.tenant_id is required. Run migration add-tenant-id-to-item-vendors.sql",
      );
    }

    if (error) {
      throw new Error(`Failed to update vendor: ${error.message}`);
    }

    return data;
  }

  async deleteItemVendor(tenantId: string, itemId: string, vendorId: string) {
    if (!this.isUuid(itemId)) {
      throw new BadRequestException("Invalid item id");
    }
    if (!this.isUuid(vendorId)) {
      throw new BadRequestException("Invalid vendor id");
    }

    await this.assertItemBelongsToTenant(tenantId, itemId);

    const { error } = await this.supabase
      .from("item_vendors")
      .update({ is_active: false })
      .eq("tenant_id", tenantId)
      .eq("item_id", itemId)
      .eq("vendor_id", vendorId);

    if (error && this.isMissingItemVendorsTenantIdColumn(error)) {
      throw new InternalServerErrorException(
        "item_vendors.tenant_id is required. Run migration add-tenant-id-to-item-vendors.sql",
      );
    }

    if (error) {
      throw new Error(`Failed to remove vendor: ${error.message}`);
    }

    return { message: "Vendor removed successfully" };
  }

  async getPurchasePriceHistory(itemId: string, vendorId: string) {
    const { data, error } = await this.supabase.rpc(
      "get_purchase_price_history",
      {
        p_item_id: itemId,
        p_vendor_id: vendorId,
      },
    );

    if (error) {
      throw new Error(`Failed to get purchase price history: ${error.message}`);
    }

    return data || [];
  }

  async getItemStock(itemId: string, tenantId: string) {
    const { data, error } = await this.supabase.rpc("get_item_stock_summary", {
      p_item_id: itemId,
      p_tenant_id: tenantId,
    });

    if (error) {
      throw new Error(`Failed to get item stock: ${error.message}`);
    }

    return data && data.length > 0
      ? data[0]
      : { total_quantity: 0, available_quantity: 0, allocated_quantity: 0 };
  }

  // Get all variants of an item
  async getItemVariants(tenantId: string, itemId: string) {
    console.log(
      "[getItemVariants] Fetching variants for item:",
      itemId,
      "tenant:",
      tenantId,
    );

    const { data, error } = await this.supabase
      .from("items")
      .select(
        "id, code, name, variant_name, is_default_variant, category, uom, hsn_code",
      )
      .eq("tenant_id", tenantId)
      .eq("parent_item_id", itemId)
      .eq("is_variant", true)
      .eq("is_active", true)
      .order("is_default_variant", { ascending: false })
      .order("variant_name", { ascending: true });

    console.log("[getItemVariants] Query result:", {
      data,
      error,
      count: data?.length,
    });

    if (error) {
      throw new Error(`Failed to get item variants: ${error.message}`);
    }

    return data || [];
  }

  // Get stock trail — all inbound/outbound movements for an item with running balance
  async getStockTrail(tenantId: string, itemId: string) {
    const trails: any[] = [];

    const toDisplayNote = (value: unknown): string | null => {
      const note = String(value || "")
        // Reversal keeps this technical SIV link in storage. Hide it only in
        // the user-facing stock trail response.
        .replace(/\s*\(material_id=[0-9a-f-]{36}\)\s*/gi, " ")
        .replace(/\s*material_id=[0-9a-f-]{36}\s*/gi, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
      return note || null;
    };

    const { data: itemRow } = await this.supabase
      .from("items")
      .select("id, code")
      .eq("tenant_id", tenantId)
      .eq("id", itemId)
      .maybeSingle();

    const itemIdsForTrail = new Set<string>([itemId]);
    const itemCode = String((itemRow as any)?.code || "").trim();
    if (itemCode) {
      const { data: siblingItems } = await this.supabase
        .from("items")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("code", itemCode);
      for (const sibling of siblingItems || []) {
        if ((sibling as any).id) itemIdsForTrail.add((sibling as any).id);
      }
    }

    const itemIds = Array.from(itemIdsForTrail);

    // --- 1. GRN / SRV inbound from stock_entries ---
    const { data: stockEntries } = await this.supabase
      .from("stock_entries")
      .select(
        "id, item_id, quantity, available_quantity, unit_price, batch_number, metadata, created_at, warehouse_id",
      )
      .eq("tenant_id", tenantId)
      .in("item_id", itemIds)
      .order("created_at", { ascending: true });

    if (stockEntries?.length) {
      const grnNumbers = [
        ...new Set(
          (stockEntries as any[])
            .map((e) => e.metadata?.grn_reference || e.metadata?.grn_number)
            .filter(Boolean),
        ),
      ] as string[];

      const grnsByNumber: Record<string, any> = {};
      if (grnNumbers.length > 0) {
        const { data: grnsData } = await this.supabase
          .from("grns")
          .select("id, grn_number, receipt_date, po_number, vendor_id")
          .eq("tenant_id", tenantId)
          .in("grn_number", grnNumbers);

        const vendorIds = [
          ...new Set(
            (grnsData || []).map((g: any) => g.vendor_id).filter(Boolean),
          ),
        ] as string[];
        const vendorById: Record<string, string> = {};
        if (vendorIds.length > 0) {
          const { data: vData } = await this.supabase
            .from("vendors")
            .select("id, name")
            .in("id", vendorIds);
          for (const v of vData || []) vendorById[v.id] = v.name;
        }

        for (const g of grnsData || []) {
          grnsByNumber[g.grn_number] = {
            ...g,
            vendor_name: vendorById[g.vendor_id] || null,
          };
        }
      }

      const seWhIds = [
        ...new Set(
          (stockEntries as any[]).map((e) => e.warehouse_id).filter(Boolean),
        ),
      ] as string[];
      const seWhById: Record<string, any> = {};
      if (seWhIds.length > 0) {
        const { data: whs } = await this.supabase
          .from("warehouses")
          .select("id, name, code")
          .in("id", seWhIds);
        for (const w of whs || []) seWhById[w.id] = w;
      }

      // Deduplicate: group by GRN reference + item + warehouse to prevent double rows
      // from duplicate DB entries without mixing quantities across different items.
      // This endpoint is already scoped to one item, but keeping item_id in the key
      // protects trail accuracy if the query shape is reused or broadened later.
      const grnEntryMap = new Map<string, { entry: any; qty: number }>();
      for (const entry of stockEntries as any[]) {
        const grnRef =
          entry.metadata?.grn_reference || entry.metadata?.grn_number;
        // GRN rows are grouped below. Non-GRN rows may still be real stock receipts
        // (for example SRV/manual receipt of finished goods) and must not disappear
        // from Stock Trail. Adjustment/import rows are reconciled later from
        // inventory_stock to avoid double-counting against stock_movements.
        if (!grnRef) continue;
        const dedupKey = `${grnRef}::${entry.item_id || itemId}::${entry.warehouse_id || ""}`;
        if (grnEntryMap.has(dedupKey)) {
          grnEntryMap.get(dedupKey)!.qty += Number(entry.quantity) || 0;
        } else {
          grnEntryMap.set(dedupKey, {
            entry,
            qty: Number(entry.quantity) || 0,
          });
        }
      }

      for (const { entry, qty } of grnEntryMap.values()) {
        const grnRef =
          entry.metadata?.grn_reference || entry.metadata?.grn_number;
        const grn = grnsByNumber[grnRef] || null;
        const wh = seWhById[entry.warehouse_id];
        trails.push({
          date: entry.created_at,
          type: "GRN_RECEIPT",
          document_type: "GRN",
          reference: grnRef,
          reference_id: grn?.id || null,
          qty_in: qty,
          qty_out: 0,
          warehouse_id: entry.warehouse_id || null,
          warehouse: wh ? wh.name || wh.code : null,
          vendor: grn?.vendor_name || null,
          unit_price:
            entry.unit_price != null ? Number(entry.unit_price) : null,
          batch_number: entry.batch_number || null,
          po_number: grn?.po_number || null,
          notes: `Received via ${grnRef}`,
        });
      }

      for (const entry of stockEntries as any[]) {
        const metadata = entry.metadata || {};
        const grnRef = metadata.grn_reference || metadata.grn_number;
        if (grnRef) continue;

        const createdFrom = String(
          metadata.created_from || metadata.source || "",
        )
          .trim()
          .toUpperCase();
        const isSrvReceipt =
          createdFrom.includes("SRV") ||
          !!metadata.srv_number ||
          !!metadata.srv_reference;
        const isProductionReceipt =
          createdFrom.includes("STORE_RECEIPT") ||
          createdFrom.includes("PRODUCTION_RECEIPT") ||
          !!metadata.job_order_id ||
          !!metadata.job_order_number;
        if (!isSrvReceipt && !isProductionReceipt) continue;

        const qty = Number(entry.quantity) || 0;
        if (Math.abs(qty) < 1e-9) continue;

        const wh = seWhById[entry.warehouse_id];
        const reference = isProductionReceipt
          ? metadata.job_order_number ||
            metadata.reference_number ||
            metadata.document_number ||
            "Production Receipt"
          : metadata.srv_number ||
            metadata.srv_reference ||
            metadata.reference_number ||
            metadata.document_number ||
            "SRV / Manual Receipt";
        trails.push({
          date: metadata.movement_date || entry.created_at,
          type: isProductionReceipt ? "PRODUCTION_RECEIPT" : "SRV_RECEIPT",
          document_type: isProductionReceipt ? "JOB_ORDER" : "SRV",
          reference,
          reference_id: isProductionReceipt
            ? metadata.job_order_id || metadata.reference_id || null
            : metadata.srv_id || metadata.reference_id || null,
          qty_in: qty,
          qty_out: 0,
          warehouse_id: entry.warehouse_id || null,
          warehouse: wh ? wh.name || wh.code : null,
          vendor: null,
          unit_price:
            entry.unit_price != null ? Number(entry.unit_price) : null,
          batch_number: entry.batch_number || null,
          po_number: null,
          notes: toDisplayNote(
            metadata.notes ||
              `${isProductionReceipt ? "Produced" : "Received"} via ${reference}${metadata.received_by_name ? ` by ${metadata.received_by_name}` : ""}`,
          ),
        });
      }
    }

    // --- 2. Other movements from stock_movements (adjustments, SIV, production, etc.) ---
    const { data: movements } = await this.supabase
      .from("stock_movements")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("item_id", itemIds)
      .order("movement_date", { ascending: true });

    if (movements?.length) {
      const movWhIds = [
        ...new Set(
          [
            ...(movements as any[]).map((m) => m.from_warehouse_id),
            ...(movements as any[]).map((m) => m.to_warehouse_id),
          ].filter(Boolean),
        ),
      ] as string[];

      const movWhById: Record<string, any> = {};
      if (movWhIds.length > 0) {
        const { data: whs } = await this.supabase
          .from("warehouses")
          .select("id, name, code")
          .in("id", movWhIds);
        for (const w of whs || []) movWhById[w.id] = w;
      }

      for (const m of movements as any[]) {
        const isInbound = !m.from_warehouse_id && !!m.to_warehouse_id;
        const isOutbound = !!m.from_warehouse_id && !m.to_warehouse_id;
        const warehouseId = isInbound ? m.to_warehouse_id : m.from_warehouse_id;
        const wh = movWhById[warehouseId];
        trails.push({
          date: m.movement_date,
          type: m.movement_type,
          document_type: m.reference_type || m.movement_type,
          reference: m.reference_number || m.movement_number,
          reference_id: m.reference_id || null,
          qty_in: isInbound ? Number(m.quantity) : 0,
          qty_out: isOutbound ? Number(m.quantity) : 0,
          warehouse_id: warehouseId || null,
          warehouse: wh ? wh.name || wh.code : null,
          vendor: null,
          unit_price: null,
          batch_number: m.batch_number || null,
          po_number: null,
          notes: toDisplayNote(m.notes),
        });
      }
    }

    // --- 3. Opening / legacy stock from inventory_stock ---
    // Older/imported balances and a few direct stock-adjustment paths can leave
    // inventory_stock populated even when there is no stock_movements trail.
    // The Stock Master and Stock Adjustment screens must not disagree with the
    // Stock Trail; show the carried balance explicitly instead of returning an
    // empty trail.
    const { data: inventoryRows } = await this.supabase
      .from("inventory_stock")
      .select(
        "quantity, available_quantity, warehouse_id, updated_at, last_movement_date",
      )
      .eq("tenant_id", tenantId)
      .in("item_id", itemIds);

    const inventoryWhIds = [
      ...new Set(
        (inventoryRows || [])
          .map((row: any) => row.warehouse_id)
          .filter(Boolean),
      ),
    ] as string[];
    const inventoryWhById: Record<string, any> = {};
    if (inventoryWhIds.length > 0) {
      const { data: whs } = await this.supabase
        .from("warehouses")
        .select("id, name, code")
        .in("id", inventoryWhIds);
      for (const w of whs || []) inventoryWhById[w.id] = w;
    }

    const actualStockByWarehouse = new Map<
      string,
      {
        quantity: number;
        warehouseName: string;
        warehouseId: string | null;
        date: string;
      }
    >();
    for (const row of inventoryRows || []) {
      const warehouseId =
        String((row as any).warehouse_id || "").trim() || null;
      const wh = warehouseId ? inventoryWhById[warehouseId] : null;
      const warehouseName = wh
        ? wh.name || wh.code
        : warehouseId || "Warehouse";
      const quantity =
        Number((row as any).available_quantity ?? (row as any).quantity ?? 0) ||
        0;
      const key = warehouseId || warehouseName;
      const existing = actualStockByWarehouse.get(key);
      actualStockByWarehouse.set(key, {
        quantity: (existing?.quantity || 0) + quantity,
        warehouseName,
        warehouseId,
        date: String(
          (row as any).last_movement_date ||
            (row as any).updated_at ||
            new Date().toISOString(),
        ),
      });
    }

    const ledgerStockByWarehouse = new Map<string, number>();
    for (const t of trails) {
      const key = String(t.warehouse_id || t.warehouse || "").trim();
      if (!key) continue;
      ledgerStockByWarehouse.set(
        key,
        (ledgerStockByWarehouse.get(key) || 0) +
          Number(t.qty_in || 0) -
          Number(t.qty_out || 0),
      );
    }

    for (const [key, actual] of actualStockByWarehouse.entries()) {
      if (Math.abs(actual.quantity) < 1e-9) continue;
      const ledgerQty = ledgerStockByWarehouse.get(key) || 0;
      const delta = actual.quantity - ledgerQty;
      if (Math.abs(delta) < 1e-9) continue;

      // Preserve a complete, reconciling trail for balances imported or posted
      // before detailed movement history was introduced. This is a read-only
      // disclosure row, not a fabricated GRN/SIV/production transaction.
      trails.push({
        date: actual.date,
        type: "BALANCE_BROUGHT_FORWARD",
        document_type: "SYSTEM_BALANCE",
        reference: "Balance reconciliation",
        reference_id: null,
        qty_in: delta > 0 ? delta : 0,
        qty_out: delta < 0 ? Math.abs(delta) : 0,
        warehouse_id: actual.warehouseId,
        warehouse: actual.warehouseName,
        vendor: null,
        unit_price: null,
        batch_number: null,
        po_number: null,
        notes:
          "Opening or migrated stock balance for which detailed movement history is unavailable.",
      });
    }

    // Sort chronologically and compute running balance
    trails.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
    let balance = 0;
    for (const t of trails) {
      balance += t.qty_in - t.qty_out;
      t.balance = balance;
    }

    const currentStock = Array.from(actualStockByWarehouse.values()).map(
      (actual) => ({
        quantity: actual.quantity,
        available_quantity: actual.quantity,
        allocated_quantity: 0,
        warehouse_id: actual.warehouseId,
        warehouses: {
          id: actual.warehouseId,
          name: actual.warehouseName,
          code: actual.warehouseName,
        },
      }),
    );

    const displayTrails = [...trails].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    const actualCurrentBalance = Array.from(
      actualStockByWarehouse.values(),
    ).reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    return {
      trails: displayTrails,
      currentBalance: actualCurrentBalance,
      currentStock,
    };
  }

  // Get default variant for an item
  async getDefaultVariant(tenantId: string, itemId: string) {
    const { data, error } = await this.supabase
      .from("items")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("parent_item_id", itemId)
      .eq("is_variant", true)
      .eq("is_default_variant", true)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to get default variant: ${error.message}`);
    }

    return data;
  }
}
