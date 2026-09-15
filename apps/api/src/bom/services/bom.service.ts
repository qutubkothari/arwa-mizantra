import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

@Injectable()
export class BomService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_KEY!,
    );
  }

  async create(tenantId: string, userId: string, data: any) {
    console.log(
      "[BomService] create - Input data:",
      JSON.stringify(data, null, 2),
    );

    // Check for duplicate BOM (same item + version)
    const { data: existingBom, error: checkError } = await this.supabase
      .from("bom_headers")
      .select("id, version")
      .eq("tenant_id", tenantId)
      .eq("item_id", data.itemId)
      .eq("version", data.version || 1)
      .maybeSingle();

    if (checkError) {
      console.error(
        "[BomService] create - Error checking for duplicates:",
        checkError,
      );
    }

    if (existingBom) {
      throw new BadRequestException(
        `A BOM already exists for this item with version ${data.version || 1}. Please use a different version number or update the existing BOM.`,
      );
    }

    const { data: bom, error } = await this.supabase
      .from("bom_headers")
      .insert({
        tenant_id: tenantId,
        item_id: data.itemId,
        version: data.version || 1,
        is_active: false,
        lifecycle_status: "DRAFT",
        revision_reason: data.revisionReason || data.notes || null,
        created_by: userId,
        effective_from: data.effectiveFrom || new Date().toISOString(),
        effective_to: data.effectiveTo,
        notes: data.notes,
      })
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    console.log("[BomService] create - BOM header created:", bom.id);

    // Insert BOM items (filter out any with empty/null itemId or childBomId)
    if (data.items && data.items.length > 0) {
      const filteredItems = data.items.filter((item: any) => {
        if (item.componentType === "ITEM") return !!item.itemId;
        if (item.componentType === "BOM") return !!item.childBomId;
        return false;
      });
      if (filteredItems.length === 0) {
        throw new BadRequestException("No valid BOM components to insert.");
      }
      console.log(
        "[BomService] create - Components:",
        filteredItems.map(
          (i: any) => `${i.componentType}:${i.itemId || i.childBomId}`,
        ),
      );

      // Validate no circular references for child BOMs
      const childBomIds = filteredItems
        .filter((i: any) => i.componentType === "BOM")
        .map((i: any) => i.childBomId);
      for (const childId of childBomIds) {
        const hasCycle = await this.validateNoCycle(bom.id, childId);
        if (hasCycle) {
          throw new BadRequestException(
            `Circular BOM reference detected: Cannot add BOM as it would create a cycle`,
          );
        }
      }

      const items = filteredItems.map((item: any, index: number) => ({
        bom_id: bom.id,
        item_id: item.componentType === "ITEM" ? item.itemId : null,
        child_bom_id: item.componentType === "BOM" ? item.childBomId : null,
        quantity: item.quantity,
        scrap_percentage: item.scrapPercentage || 0,
        sequence: item.sequence || index + 1,
        notes: item.notes,
        drawing_url: item.drawingUrl, // Drawing attachment URL
      }));

      const { error: itemsError } = await this.supabase
        .from("bom_items")
        .insert(items);

      if (itemsError) throw new BadRequestException(itemsError.message);
    }

    await this.recordRevisionEvent(
      tenantId,
      bom.id,
      "CREATED",
      null,
      "DRAFT",
      userId,
      data.revisionReason || data.notes,
    );
    return this.findOne(tenantId, bom.id);
  }

  async findAll(tenantId: string, filters?: any) {
    // Fetch BOM headers
    let query = this.supabase
      .from("bom_headers")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (filters?.itemId || filters?.productId) {
      query = query.eq("item_id", filters.itemId || filters.productId);
    }

    if (filters?.isActive !== undefined) {
      query = query.eq("is_active", filters.isActive);
    }

    const { data: headers, error } = await query;
    if (error) throw new BadRequestException(error.message);

    if (!headers || headers.length === 0) return [];

    // Fetch all related items and bom_items in parallel
    const itemIds = headers.map((h: any) => h.item_id);
    const bomIds = headers.map((h: any) => h.id);

    console.log("[BomService] findAll - fetching main items for IDs:", itemIds);
    console.log(
      "[BomService] findAll - fetching bom_items for BOM IDs:",
      bomIds,
    );

    const [itemsRes, bomItemsRes] = await Promise.all([
      this.supabase.from("items").select("*").in("id", itemIds),
      this.supabase.from("bom_items").select("*").in("bom_id", bomIds),
    ]);

    if (itemsRes.error) {
      console.error("[BomService] Items query error:", itemsRes.error);
      throw new BadRequestException(itemsRes.error.message);
    }
    if (bomItemsRes.error) {
      console.error("[BomService] BOM items query error:", bomItemsRes.error);
      throw new BadRequestException(bomItemsRes.error.message);
    }

    console.log("[BomService] Main items found:", itemsRes.data?.length);
    console.log("[BomService] BOM items found:", bomItemsRes.data?.length);
    if (bomItemsRes.data && bomItemsRes.data.length > 0) {
      bomItemsRes.data.slice(0, 25).forEach((item: any) => {
        console.log("[BomService] Raw bom_item snapshot", {
          id: item.id,
          bomId: item.bom_id,
          componentType: item.component_type,
          itemId: item.item_id,
          childBomId: item.child_bom_id,
        });
      });
    }

    // Fetch component items (all bom_items reference items via item_id)
    const componentItemIds =
      bomItemsRes.data?.map((bi: any) => bi.item_id).filter(Boolean) || [];
    const childBomIds =
      bomItemsRes.data?.map((bi: any) => bi.child_bom_id).filter(Boolean) || [];
    console.log(
      "[BomService] findAll - fetching component items for IDs:",
      componentItemIds,
    );
    console.log(
      "[BomService] findAll - fetching child BOMs for IDs:",
      childBomIds,
    );

    let componentItems = [];
    if (componentItemIds.length > 0) {
      const { data: compItems, error: compError } = await this.supabase
        .from("items")
        .select("*")
        .in("id", componentItemIds);

      if (compError) {
        console.error("[BomService] Component items query error:", compError);
      } else {
        componentItems = compItems || [];
        console.log(
          "[BomService] Component items found:",
          componentItems.length,
        );
      }
    }

    // Fetch child BOMs
    let childBoms = [];
    if (childBomIds.length > 0) {
      const { data: boms, error: bomsError } = await this.supabase
        .from("bom_headers")
        .select("*")
        .in("id", childBomIds);

      if (bomsError) {
        console.error("[BomService] Child BOMs query error:", bomsError);
      } else {
        // Fetch items for child BOMs
        const childBomItemIds = boms?.map((b: any) => b.item_id) || [];
        if (childBomItemIds.length > 0) {
          const { data: childItems } = await this.supabase
            .from("items")
            .select("*")
            .in("id", childBomItemIds);

          const childItemsMap = new Map(childItems?.map((i: any) => [i.id, i]));
          childBoms =
            boms?.map((b: any) => ({
              ...b,
              item: childItemsMap.get(b.item_id),
            })) || [];
        }
        console.log("[BomService] Child BOMs found:", childBoms.length);
      }
    }

    // Create maps
    const mainItemsMap = new Map(itemsRes.data?.map((i: any) => [i.id, i]));
    const componentItemsMap = new Map(
      componentItems.map((i: any) => [i.id, i]),
    );
    const childBomsMap = new Map(childBoms.map((b: any) => [b.id, b]));

    // Infer subassembly BOMs: if an item is a SUBASSEMBLY and has no child_bom_id, fetch its BOM
    const subassemblyItemIds = componentItems
      .filter(
        (i: any) => i.category === "SUBASSEMBLY" || i.type === "SUBASSEMBLY",
      )
      .map((i: any) => i.id);

    const inferredBomsMap = new Map<string, any>();
    if (subassemblyItemIds.length > 0) {
      const { data: subBoms } = await this.supabase
        .from("bom_headers")
        .select("*, items(*)")
        .in("item_id", subassemblyItemIds)
        .eq("is_active", true)
        .order("version", { ascending: false });

      if (subBoms && subBoms.length > 0) {
        const seen = new Set<string>();
        subBoms.forEach((sb: any) => {
          if (!seen.has(sb.item_id)) {
            inferredBomsMap.set(sb.item_id, sb);
            seen.add(sb.item_id);
          }
        });
      }
    }

    const bomItemsMap = new Map();

    // Group bom_items by bom_id and attach component item details
    bomItemsRes.data?.forEach((bi: any) => {
      if (!bomItemsMap.has(bi.bom_id)) {
        bomItemsMap.set(bi.bom_id, []);
      }

      // Check if it references a child BOM or an item
      if (bi.child_bom_id) {
        const resolvedChild = childBomsMap.get(bi.child_bom_id);
        if (!resolvedChild) {
          console.warn("[BomService] Missing child BOM details for component", {
            bomId: bi.bom_id,
            childBomId: bi.child_bom_id,
          });
        }
        bomItemsMap.get(bi.bom_id).push({
          ...bi,
          component_type: "BOM",
          child_bom: resolvedChild,
        });
      } else {
        const resolvedItem = componentItemsMap.get(bi.item_id);
        const inferredBom = inferredBomsMap.get(bi.item_id);
        const isSubassembly =
          resolvedItem &&
          (resolvedItem.category === "SUBASSEMBLY" ||
            resolvedItem.type === "SUBASSEMBLY");

        if (!resolvedItem) {
          console.warn("[BomService] Missing component item details", {
            bomId: bi.bom_id,
            itemId: bi.item_id,
          });
        }

        if (isSubassembly && inferredBom) {
          // Promote to BOM component
          bomItemsMap.get(bi.bom_id).push({
            ...bi,
            component_type: "BOM",
            item: resolvedItem,
            child_bom: inferredBom,
          });
        } else {
          bomItemsMap.get(bi.bom_id).push({
            ...bi,
            component_type: "ITEM",
            item: resolvedItem,
          });
        }
      }
    });

    // Combine everything
    return headers.map((h: any) => ({
      ...h,
      item: mainItemsMap.get(h.item_id),
      bom_items: bomItemsMap.get(h.id) || [],
    }));
  }

  async getBomItems(tenantId: string, bomId: string) {
    // Verify BOM belongs to tenant
    const { data: header } = await this.supabase
      .from("bom_headers")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", bomId)
      .single();

    if (!header) throw new NotFoundException("BOM not found");

    // Fetch BOM items
    const { data: bomItems, error } = await this.supabase
      .from("bom_items")
      .select("*")
      .eq("bom_id", bomId);

    if (error) throw new BadRequestException(error.message);

    console.log("[BomService] getBomItems - Raw BOM items:", bomItems);

    // Fetch component items and child BOMs (all have item_id, some may have child_bom_id)
    const itemIds =
      bomItems?.map((bi: any) => bi.item_id).filter(Boolean) || [];
    const childBomIds =
      bomItems?.map((bi: any) => bi.child_bom_id).filter(Boolean) || [];

    console.log("[BomService] getBomItems - Item IDs to fetch:", itemIds);
    console.log("[BomService] getBomItems - Child BOM IDs:", childBomIds);

    let items: any[] = [];
    let childBoms: any[] = [];

    if (itemIds.length > 0) {
      const { data } = await this.supabase
        .from("items")
        .select("*")
        .in("id", itemIds);
      items = data || [];
      console.log("[BomService] getBomItems - Fetched items:", items);
    }

    if (childBomIds.length > 0) {
      // Hardening: do not rely on nested joins; always fetch BOM header item_id directly.
      const { data } = await this.supabase
        .from("bom_headers")
        .select("id, item_id, version, is_active")
        .eq("tenant_id", tenantId)
        .in("id", childBomIds);
      childBoms = data || [];
    }

    const childBomItemIds = Array.from(
      new Set((childBoms || []).map((b: any) => b?.item_id).filter(Boolean)),
    );
    let childBomItems: any[] = [];
    if (childBomItemIds.length > 0) {
      const { data } = await this.supabase
        .from("items")
        .select("*")
        .eq("tenant_id", tenantId)
        .in("id", childBomItemIds);
      childBomItems = data || [];
    }

    // Map items to include details
    const itemsMap = new Map(items.map((i: any) => [i.id, i]));
    const childBomsMap = new Map(childBoms.map((b: any) => [b.id, b]));
    const childBomItemsMap = new Map(childBomItems.map((i: any) => [i.id, i]));

    // Infer subassembly BOMs: if an item with only item_id is a SUBASSEMBLY, fetch its BOM to promote to BOM component
    const subassemblyItemIds = items
      .filter(
        (i: any) =>
          !childBomIds.includes(i.id) &&
          (i.category === "SUBASSEMBLY" || i.type === "SUBASSEMBLY"),
      )
      .map((i: any) => i.id);

    const inferredBomsMap = new Map<string, any>();
    if (subassemblyItemIds.length > 0) {
      const { data: subBoms } = await this.supabase
        .from("bom_headers")
        .select("*, items(*)")
        .eq("tenant_id", tenantId)
        .in("item_id", subassemblyItemIds)
        .eq("is_active", true)
        .order("version", { ascending: false });

      if (subBoms && subBoms.length > 0) {
        // Pick the first (latest active) BOM for each subassembly item
        const seen = new Set<string>();
        subBoms.forEach((sb: any) => {
          if (!seen.has(sb.item_id)) {
            inferredBomsMap.set(sb.item_id, sb);
            seen.add(sb.item_id);
          }
        });
      }
    }

    const result = bomItems.map((bi: any) => {
      if (bi.child_bom_id) {
        const childBom = childBomsMap.get(bi.child_bom_id);
        const childItem = childBom
          ? childBomItemsMap.get(childBom.item_id)
          : null;
        return {
          ...bi,
          // IMPORTANT: component_id must be an item.id (never a bom_headers.id)
          component_id: childBom?.item_id || null,
          component_code: childItem?.code || "N/A",
          component_name: childItem?.name || "Unknown BOM",
          component_type: "BOM",
        };
      } else {
        const item = itemsMap.get(bi.item_id);
        const inferredBom = inferredBomsMap.get(bi.item_id);
        const isSubassembly =
          item &&
          (item.category === "SUBASSEMBLY" || item.type === "SUBASSEMBLY");

        if (isSubassembly && inferredBom) {
          // Promote to BOM component
          return {
            ...bi,
            component_id: item.id,
            component_code: item.code || "N/A",
            component_name: item.name || "Unknown",
            component_type: "BOM",
            child_bom: inferredBom,
          };
        }

        console.log("[BomService] getBomItems - Mapping item:", {
          bomItemId: bi.item_id,
          foundItem: item,
        });
        return {
          ...bi,
          component_id: bi.item_id,
          component_code: item?.code || "N/A",
          component_name: item?.name || "Unknown",
          component_type: "ITEM",
        };
      }
    });

    console.log("[BomService] getBomItems - Final result:", result);
    return result;
  }

  async findOne(tenantId: string, id: string) {
    // Fetch BOM header
    const { data: header, error } = await this.supabase
      .from("bom_headers")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .single();

    if (error) throw new NotFoundException("BOM not found");

    // Fetch item and bom_items
    const [itemRes, bomItemsRes] = await Promise.all([
      this.supabase.from("items").select("*").eq("id", header.item_id).single(),
      this.supabase.from("bom_items").select("*").eq("bom_id", id),
    ]);

    if (itemRes.error) throw new BadRequestException(itemRes.error.message);
    if (bomItemsRes.error)
      throw new BadRequestException(bomItemsRes.error.message);

    // Fetch items and child BOMs for bom_items (all have item_id, some may have child_bom_id)
    const bomItemIds =
      bomItemsRes.data?.map((bi: any) => bi.item_id).filter(Boolean) || [];
    const childBomIds =
      bomItemsRes.data?.map((bi: any) => bi.child_bom_id).filter(Boolean) || [];
    console.log("[BomService] findOne - Component item IDs:", bomItemIds);
    console.log("[BomService] findOne - Child BOM IDs:", childBomIds);

    // Fetch items
    let bomItems = [];
    if (bomItemIds.length > 0) {
      const { data: items, error: itemsError } = await this.supabase
        .from("items")
        .select("*")
        .in("id", bomItemIds);

      if (itemsError) {
        console.error(
          "[BomService] findOne - Error fetching component items:",
          itemsError,
        );
        throw new BadRequestException(itemsError.message);
      }
      bomItems = items || [];
    }

    // Fetch child BOMs
    let childBoms = [];
    if (childBomIds.length > 0) {
      const { data: boms, error: bomsError } = await this.supabase
        .from("bom_headers")
        .select("*")
        .in("id", childBomIds);

      if (bomsError) {
        console.error(
          "[BomService] findOne - Error fetching child BOMs:",
          bomsError,
        );
      } else {
        // Fetch items for child BOMs
        const childBomItemIds = boms?.map((b: any) => b.item_id) || [];
        if (childBomItemIds.length > 0) {
          const { data: childItems } = await this.supabase
            .from("items")
            .select("*")
            .in("id", childBomItemIds);

          const childItemsMap = new Map(childItems?.map((i: any) => [i.id, i]));
          childBoms =
            boms?.map((b: any) => ({
              ...b,
              item: childItemsMap.get(b.item_id),
            })) || [];
        }
      }
    }

    const itemsMap = new Map(bomItems.map((i: any) => [i.id, i]));
    const childBomsMap = new Map(childBoms.map((b: any) => [b.id, b]));
    console.log("[BomService] findOne - Items map size:", itemsMap.size);
    console.log(
      "[BomService] findOne - Child BOMs map size:",
      childBomsMap.size,
    );

    // Infer subassembly BOMs: if an item has only item_id and is a SUBASSEMBLY, fetch its BOM to promote to BOM component
    const subassemblyItemIds = bomItems
      .filter(
        (i: any) =>
          !childBomIds.includes(i.id) &&
          (i.category === "SUBASSEMBLY" || i.type === "SUBASSEMBLY"),
      )
      .map((i: any) => i.id);

    const inferredBomsMap = new Map<string, any>();
    if (subassemblyItemIds.length > 0) {
      const { data: subBoms } = await this.supabase
        .from("bom_headers")
        .select("*, items(*)")
        .eq("tenant_id", tenantId)
        .in("item_id", subassemblyItemIds)
        .eq("is_active", true)
        .order("version", { ascending: false });

      if (subBoms && subBoms.length > 0) {
        const seen = new Set<string>();
        subBoms.forEach((sb: any) => {
          if (!seen.has(sb.item_id)) {
            inferredBomsMap.set(sb.item_id, sb);
            seen.add(sb.item_id);
          }
        });
      }
    }

    const result = {
      ...header,
      item: itemRes.data,
      bom_items:
        bomItemsRes.data?.map((bi: any) => {
          if (bi.child_bom_id) {
            const childBom = childBomsMap.get(bi.child_bom_id);
            return {
              ...bi,
              component_type: "BOM",
              child_bom: childBom,
            };
          } else {
            const item = itemsMap.get(bi.item_id);
            const inferredBom = inferredBomsMap.get(bi.item_id);
            const isSubassembly =
              item &&
              (item.category === "SUBASSEMBLY" || item.type === "SUBASSEMBLY");

            if (isSubassembly && inferredBom) {
              return {
                ...bi,
                component_type: "BOM",
                item,
                child_bom: inferredBom,
              };
            }

            return {
              ...bi,
              component_type: "ITEM",
              item,
            };
          }
        }) || [],
    };

    console.log(
      "[BomService] findOne - Final result bom_items count:",
      result.bom_items.length,
    );
    return result;
  }

  async update(tenantId: string, userId: string, id: string, data: any) {
    const header = await this.getRevisionHeader(tenantId, id);
    if (header.lifecycle_status !== "DRAFT") {
      throw new BadRequestException(
        "Only a draft BOM revision can be edited. Create a new revision for an approved structure.",
      );
    }
    const { error } = await this.supabase
      .from("bom_headers")
      .update({
        effective_from: data.effectiveFrom,
        effective_to: data.effectiveTo,
        notes: data.notes,
        revision_reason: data.revisionReason || data.notes || null,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", id);

    if (error) throw new BadRequestException(error.message);

    // Update items if provided
    if (data.items) {
      await this.supabase.from("bom_items").delete().eq("bom_id", id);

      if (data.items.length > 0) {
        // Validate no circular references for child BOMs
        const childBomIds = data.items
          .filter((i: any) => i.componentType === "BOM")
          .map((i: any) => i.childBomId);
        for (const childId of childBomIds) {
          const hasCycle = await this.validateNoCycle(id, childId);
          if (hasCycle) {
            throw new BadRequestException(
              `Circular BOM reference detected: Cannot add BOM as it would create a cycle`,
            );
          }
        }

        const items = data.items.map((item: any, index: number) => ({
          bom_id: id,
          item_id: item.componentType === "ITEM" ? item.itemId : null,
          child_bom_id: item.componentType === "BOM" ? item.childBomId : null,
          quantity: item.quantity,
          scrap_percentage: item.scrapPercentage || 0,
          sequence: item.sequence || index + 1,
          notes: item.notes,
          drawing_url: item.drawingUrl,
        }));

        await this.supabase.from("bom_items").insert(items);
      }
    }

    await this.recordRevisionEvent(
      tenantId,
      id,
      "UPDATED",
      "DRAFT",
      "DRAFT",
      userId,
      data.revisionReason || data.notes,
    );
    return this.findOne(tenantId, id);
  }

  async submit(tenantId: string, userId: string, id: string) {
    const header = await this.getRevisionHeader(tenantId, id);
    if (header.lifecycle_status !== "DRAFT") {
      throw new BadRequestException(
        "Only a draft BOM revision can be submitted.",
      );
    }
    if (!String(header.revision_reason || header.notes || "").trim()) {
      throw new BadRequestException(
        "Revision reason is required before submission.",
      );
    }
    const { count, error: componentError } = await this.supabase
      .from("bom_items")
      .select("id", { count: "exact", head: true })
      .eq("bom_id", id);
    if (componentError) throw new BadRequestException(componentError.message);
    if (!count)
      throw new BadRequestException(
        "A BOM must contain at least one component.",
      );
    const submittedAt = new Date().toISOString();
    const { error } = await this.supabase
      .from("bom_headers")
      .update({
        lifecycle_status: "SUBMITTED",
        submitted_by: userId,
        submitted_at: submittedAt,
        updated_at: submittedAt,
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .eq("lifecycle_status", "DRAFT");
    if (error) throw new BadRequestException(error.message);
    await this.recordRevisionEvent(
      tenantId,
      id,
      "SUBMITTED",
      "DRAFT",
      "SUBMITTED",
      userId,
      "Submitted for independent engineering approval.",
    );
    return this.findOne(tenantId, id);
  }

  async approve(
    tenantId: string,
    userId: string,
    id: string,
    approvalNote?: string,
  ) {
    const header = await this.getRevisionHeader(tenantId, id);
    if (header.lifecycle_status !== "SUBMITTED") {
      throw new BadRequestException(
        "Only a submitted BOM revision can be approved.",
      );
    }
    if (String(header.created_by || "") === String(userId)) {
      throw new BadRequestException(
        "Maker-checker control prevents self-approval.",
      );
    }
    const note = String(approvalNote || "").trim();
    if (!note) throw new BadRequestException("Approval note is required.");
    const approvedAt = new Date().toISOString();
    const { error } = await this.supabase
      .from("bom_headers")
      .update({
        lifecycle_status: "APPROVED",
        is_active: true,
        approved_by: userId,
        approved_at: approvedAt,
        approval_note: note,
        updated_at: approvedAt,
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .eq("lifecycle_status", "SUBMITTED");
    if (error) throw new BadRequestException(error.message);
    await this.recordRevisionEvent(
      tenantId,
      id,
      "APPROVED",
      "SUBMITTED",
      "APPROVED",
      userId,
      note,
    );
    return this.findOne(tenantId, id);
  }

  async retire(
    tenantId: string,
    userId: string,
    id: string,
    retirementNote?: string,
  ) {
    const header = await this.getRevisionHeader(tenantId, id);
    if (header.lifecycle_status !== "APPROVED") {
      throw new BadRequestException(
        "Only an approved BOM revision can be retired.",
      );
    }
    const note = String(retirementNote || "").trim();
    if (!note) throw new BadRequestException("Retirement reason is required.");
    const retiredAt = new Date().toISOString();
    const { error } = await this.supabase
      .from("bom_headers")
      .update({
        lifecycle_status: "RETIRED",
        is_active: false,
        retired_by: userId,
        retired_at: retiredAt,
        retirement_note: note,
        updated_at: retiredAt,
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .eq("lifecycle_status", "APPROVED");
    if (error) throw new BadRequestException(error.message);
    await this.recordRevisionEvent(
      tenantId,
      id,
      "RETIRED",
      "APPROVED",
      "RETIRED",
      userId,
      note,
    );
    return this.findOne(tenantId, id);
  }

  async generatePurchaseRequisition(
    tenantId: string,
    userId: string,
    bomId: string,
    quantity: number,
  ) {
    // Get BOM with all items
    const bom = await this.findOne(tenantId, bomId);

    if (!bom.bom_items || bom.bom_items.length === 0) {
      throw new BadRequestException("BOM has no items");
    }

    // First, expand BOM to get all actual items (handles nested BOMs)
    console.log(
      `[BOM PR] Starting BOM expansion for BOM ${bomId} with quantity ${quantity}`,
    );
    const expandedItems = await this.expandBOMForPR(bomId, quantity, 0);
    console.log(
      `[BOM PR] Expansion complete. Got ${expandedItems.length} unique items:`,
      expandedItems.map((i) => `${i.itemId}:${i.quantity}`).join(", "),
    );

    // Check stock availability for each expanded item
    const itemsToOrder = [];
    const stockStatus = []; // Track all items with stock info

    for (const expandedItem of expandedItems) {
      // Check current operational stock from inventory_stock. stock_entries is a
      // receipt-lot/FIFO table and can legitimately miss opening/manual/SRV
      // balances, so using it here causes BOM/PR shortages to disagree with the
      // Stock Master and Stock Adjustment screens.
      const [stockRes, itemRes] = await Promise.all([
        this.supabase
          .from("inventory_stock")
          .select("quantity, available_quantity, reserved_quantity")
          .eq("tenant_id", tenantId)
          .eq("item_id", expandedItem.itemId)
          .order("created_at", { ascending: true }),
        this.supabase
          .from("items")
          .select("code, name, reorder_level")
          .eq("id", expandedItem.itemId)
          .single(),
      ]);

      if (stockRes.error) {
        console.error("[BOM PR] inventory_stock lookup error:", stockRes.error);
        throw new BadRequestException(stockRes.error.message);
      }

      const stockRows = Array.isArray(stockRes.data) ? stockRes.data : [];
      const totalQty = stockRows.reduce(
        (sum: number, row: any) =>
          sum + (parseFloat(String(row.quantity ?? "0")) || 0),
        0,
      );
      const availableQty = stockRows.reduce(
        (sum: number, row: any) =>
          sum +
          (parseFloat(String(row.available_quantity ?? row.quantity ?? "0")) ||
            0),
        0,
      );
      const reservedQty = stockRows.reduce(
        (sum: number, row: any) =>
          sum + (parseFloat(String(row.reserved_quantity ?? "0")) || 0),
        0,
      );
      const reorderLevel = itemRes.data?.reorder_level
        ? parseFloat(itemRes.data.reorder_level.toString())
        : 0;

      // Calculate usable stock (available minus reorder level safety stock)
      const usableStock = Math.max(0, availableQty - reorderLevel);
      const shortfall = expandedItem.quantity - usableStock;

      console.log(
        `[BOM PR] Item ${expandedItem.itemId}: Required=${expandedItem.quantity}, Total=${totalQty}, Available=${availableQty}, Reserved=${reservedQty}, ReorderLevel=${reorderLevel}, Usable=${usableStock}, Shortfall=${shortfall}`,
      );

      // Add to stock status for display
      stockStatus.push({
        itemId: expandedItem.itemId,
        itemCode: itemRes.data?.code || "Unknown",
        itemName: itemRes.data?.name || "Unknown",
        required: expandedItem.quantity,
        totalStock: totalQty,
        availableStock: availableQty,
        reservedStock: reservedQty,
        reorderLevel: reorderLevel,
        usableStock: usableStock,
        shortfall: Math.max(0, shortfall),
        needsPR: shortfall > 0,
      });

      if (shortfall > 0) {
        if (itemRes.data) {
          itemsToOrder.push({
            itemId: expandedItem.itemId,
            itemCode: itemRes.data.code,
            itemName: itemRes.data.name,
            quantity: Math.ceil(shortfall),
            specifications: expandedItem.notes,
            drawingUrl: expandedItem.drawingUrl,
          });
        }
      }
    }

    if (itemsToOrder.length === 0) {
      return {
        message: "All items are in stock",
        itemsToOrder: [],
        stockStatus: stockStatus, // Include stock status even when no PR needed
      };
    }

    // Create Purchase Requisition
    const prData = {
      department: "PRODUCTION",
      purpose: `Manufacturing ${bom.item.code} - ${bom.item.name}`,
      requiredDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0], // 7 days from now
      remarks: `Auto-generated from BOM for production quantity: ${quantity}`,
      items: itemsToOrder.map((item) => ({
        itemId: item.itemId,
        quantity: item.quantity,
        specifications: item.specifications,
        drawingUrl: item.drawingUrl,
      })),
    };

    // Call PR service to create
    const { data: pr, error } = await this.supabase
      .from("purchase_requisitions")
      .insert({
        tenant_id: tenantId,
        pr_number: await this.generatePRNumber(tenantId),
        request_date: new Date().toISOString().split("T")[0],
        department: prData.department,
        purpose: prData.purpose,
        requested_by: userId,
        required_date: prData.requiredDate,
        status: "DRAFT",
        remarks: prData.remarks,
      })
      .select()
      .single();

    if (error) {
      console.error("[BomService] PR creation error:", error);
      throw new BadRequestException(error.message);
    }

    // Insert PR items with proper field names for purchase_requisition_items table
    const prItems = itemsToOrder.map((item: any) => ({
      pr_id: pr.id,
      item_code: item.itemCode,
      item_name: item.itemName,
      description: item.specifications || "",
      uom: "Nos", // Default UOM, could be fetched from item
      requested_qty: item.quantity,
      estimated_rate: 0,
      required_date: prData.requiredDate,
      remarks: `BOM: ${bom.item.code} (Qty: ${quantity}). Drawing: ${item.drawingUrl || "Not attached"}`,
    }));

    const { error: itemsError } = await this.supabase
      .from("purchase_requisition_items")
      .insert(prItems);

    if (itemsError) {
      console.error("[BomService] PR items creation error:", itemsError);
      throw new BadRequestException(itemsError.message);
    }

    // Fetch item prices and update PR items with estimated_rate
    for (const prItem of prItems) {
      const { data: itemData } = await this.supabase
        .from("items")
        .select("standard_cost, selling_price")
        .eq("code", prItem.item_code)
        .single();

      if (itemData) {
        const estimatedRate =
          itemData.standard_cost || itemData.selling_price || 0;
        await this.supabase
          .from("purchase_requisition_items")
          .update({ estimated_rate: estimatedRate })
          .eq("pr_id", pr.id)
          .eq("item_code", prItem.item_code);

        console.log(
          `[BOM PR] Updated price for ${prItem.item_code}: ${estimatedRate}`,
        );
      }
    }

    return {
      message: "Purchase Requisition generated from BOM",
      prNumber: pr.pr_number,
      prId: pr.id,
      itemsToOrder,
      stockStatus, // Include detailed stock status
    };
  }

  async delete(tenantId: string, id: string) {
    const header = await this.getRevisionHeader(tenantId, id);
    if (header.lifecycle_status !== "DRAFT") {
      throw new BadRequestException(
        "Submitted, approved or retired BOM revisions cannot be deleted.",
      );
    }
    const { error } = await this.supabase
      .from("bom_headers")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", id);

    if (error) throw new BadRequestException(error.message);
    return { message: "BOM deleted successfully" };
  }

  private async getRevisionHeader(tenantId: string, id: string) {
    const { data, error } = await this.supabase
      .from("bom_headers")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException("BOM not found");
    return data;
  }

  private async recordRevisionEvent(
    tenantId: string,
    bomId: string,
    eventType: string,
    fromStatus: string | null,
    toStatus: string,
    userId: string | null,
    note?: string,
  ) {
    const { error } = await this.supabase.from("bom_revision_events").insert({
      tenant_id: tenantId,
      bom_id: bomId,
      event_type: eventType,
      from_status: fromStatus,
      to_status: toStatus,
      note: String(note || "").trim() || null,
      acted_by: userId,
    });
    if (error) throw new BadRequestException(error.message);
  }

  /**
   * Expand BOM recursively to get all actual items needed (for PR generation)
   */
  private async expandBOMForPR(
    bomId: string,
    quantity: number,
    level: number = 0,
  ): Promise<
    Array<{
      itemId: string;
      quantity: number;
      notes: string;
      drawingUrl: string;
    }>
  > {
    const indent = "  ".repeat(level);
    console.log(
      `${indent}[BOM EXPAND] Level ${level}: BOM ID=${bomId}, Quantity=${quantity}`,
    );

    const { data: bomItems } = await this.supabase
      .from("bom_items")
      .select(
        "item_id, child_bom_id, quantity, scrap_percentage, notes, drawing_url",
      )
      .eq("bom_id", bomId);

    console.log(
      `${indent}[BOM EXPAND] Found ${bomItems?.length || 0} components`,
    );

    if (!bomItems || bomItems.length === 0) return [];

    const allItems: Map<
      string,
      { quantity: number; notes: string; drawingUrl: string }
    > = new Map();

    for (const bomItem of bomItems) {
      const scrapFactor = 1 + (bomItem.scrap_percentage || 0) / 100;
      const adjustedQty = bomItem.quantity * quantity * scrapFactor;
      const componentType = bomItem.child_bom_id ? "BOM" : "ITEM";

      console.log(
        `${indent}[BOM EXPAND] Component: type=${componentType}, qty=${bomItem.quantity}, scrap=${bomItem.scrap_percentage}%, adjustedQty=${adjustedQty}`,
      );

      if (componentType === "ITEM" && bomItem.item_id) {
        // Direct item
        console.log(
          `${indent}[BOM EXPAND] → Adding ITEM ${bomItem.item_id}: ${adjustedQty} units`,
        );
        const existing = allItems.get(bomItem.item_id);
        allItems.set(bomItem.item_id, {
          quantity: (existing?.quantity || 0) + adjustedQty,
          notes: bomItem.notes || existing?.notes || "",
          drawingUrl: bomItem.drawing_url || existing?.drawingUrl || "",
        });
      } else if (componentType === "BOM" && bomItem.child_bom_id) {
        // Recursively expand child BOM
        console.log(
          `${indent}[BOM EXPAND] → Recursing into child BOM ${bomItem.child_bom_id} with qty=${adjustedQty}`,
        );
        const childItems = await this.expandBOMForPR(
          bomItem.child_bom_id,
          adjustedQty,
          level + 1,
        );
        console.log(
          `${indent}[BOM EXPAND] ← Child BOM returned ${childItems.length} items`,
        );

        childItems.forEach((childItem) => {
          const existing = allItems.get(childItem.itemId);
          const newQty = (existing?.quantity || 0) + childItem.quantity;
          console.log(
            `${indent}[BOM EXPAND]   Aggregating item ${childItem.itemId}: +${childItem.quantity} = ${newQty}`,
          );
          allItems.set(childItem.itemId, {
            quantity: newQty,
            notes: childItem.notes || existing?.notes || "",
            drawingUrl: childItem.drawingUrl || existing?.drawingUrl || "",
          });
        });
      }
    }

    const result = Array.from(allItems.entries()).map(([itemId, details]) => ({
      itemId,
      quantity: details.quantity,
      notes: details.notes,
      drawingUrl: details.drawingUrl,
    }));

    console.log(
      `${indent}[BOM EXPAND] Level ${level} returning ${result.length} unique items:`,
      result.map((r) => `${r.itemId}:${r.quantity}`).join(", "),
    );

    return result;
  }

  /**
   * Validate that adding childBomId to parentBomId won't create a circular reference
   * Uses DFS to check if childBomId already contains parentBomId in its hierarchy
   */
  private async validateNoCycle(
    parentBomId: string,
    childBomId: string,
  ): Promise<boolean> {
    const visited = new Set<string>();
    const stack = [childBomId];

    while (stack.length > 0) {
      const currentBomId = stack.pop()!;

      // If we've reached the parent, there's a cycle
      if (currentBomId === parentBomId) {
        return true;
      }

      // Skip if already visited
      if (visited.has(currentBomId)) {
        continue;
      }
      visited.add(currentBomId);

      // Get child BOMs of current BOM
      const { data: bomItems } = await this.supabase
        .from("bom_items")
        .select("child_bom_id")
        .eq("bom_id", currentBomId)
        .not("child_bom_id", "is", null);

      if (bomItems && bomItems.length > 0) {
        bomItems.forEach((bi: any) => {
          if (bi.child_bom_id) {
            stack.push(bi.child_bom_id);
          }
        });
      }
    }

    return false;
  }

  private async generatePRNumber(tenantId: string): Promise<string> {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const prefix = `PR-${year}-${month}`;

    const { data } = await this.supabase
      .from("purchase_requisitions")
      .select("pr_number")
      .eq("tenant_id", tenantId)
      .like("pr_number", "PR-%");

    let maxSeq = 0;
    for (const row of data || []) {
      const match = /^PR-\d{4}-\d{2}-(\d+)$/.exec(row.pr_number || "");
      if (match) {
        const seq = parseInt(match[1], 10);
        if (seq > maxSeq) maxSeq = seq;
      }
    }

    return `${prefix}-${String(maxSeq + 1).padStart(3, "0")}`;
  }
}
