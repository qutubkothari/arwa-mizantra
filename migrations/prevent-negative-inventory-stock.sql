-- Prevent negative inventory balances and allocate deductions across stock rows.
--
-- The legacy function applied every deduction to a single location. When stock
-- existed in a different location/category row, that target row could become
-- negative while another row remained positive. This replacement locks the
-- applicable rows, consumes available quantities deterministically, and rejects
-- any deduction that exceeds the total unreserved balance.

CREATE OR REPLACE FUNCTION public.adjust_inventory_stock(
  p_tenant_id uuid,
  p_item_id uuid,
  p_warehouse_id uuid,
  p_location_id uuid,
  p_quantity_change numeric,
  p_category text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_location_id uuid;
  v_default_code text;
  v_warehouse_tenant_id uuid;
  v_category inventory_category;
  v_remaining numeric;
  v_available numeric;
  v_deduct numeric;
  v_stock record;
BEGIN
  IF p_quantity_change IS NULL OR p_quantity_change = 0 THEN
    RETURN;
  END IF;

  v_category := p_category::inventory_category;

  SELECT tenant_id
  INTO v_warehouse_tenant_id
  FROM public.warehouses
  WHERE id = p_warehouse_id
  LIMIT 1;

  IF v_warehouse_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse % not found', p_warehouse_id;
  END IF;

  IF v_warehouse_tenant_id <> p_tenant_id THEN
    RAISE EXCEPTION 'Warehouse % does not belong to tenant %', p_warehouse_id, p_tenant_id;
  END IF;

  v_location_id := p_location_id;
  IF v_location_id IS NOT NULL THEN
    PERFORM 1
    FROM public.storage_locations
    WHERE id = v_location_id
      AND warehouse_id = p_warehouse_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Location % does not belong to warehouse %', v_location_id, p_warehouse_id;
    END IF;
  ELSE
    v_default_code := 'DEFAULT-' || SUBSTRING(REPLACE(p_warehouse_id::text, '-', ''), 1, 12);
    SELECT id
    INTO v_location_id
    FROM public.storage_locations
    WHERE warehouse_id = p_warehouse_id
      AND location_code = v_default_code
    LIMIT 1;
  END IF;

  IF p_quantity_change < 0 THEN
    -- Serialize deductions for this stock bucket before checking availability.
    PERFORM id
    FROM public.inventory_stock
    WHERE tenant_id = p_tenant_id
      AND item_id = p_item_id
      AND warehouse_id = p_warehouse_id
      AND category = v_category
    ORDER BY id
    FOR UPDATE;

    SELECT COALESCE(SUM(GREATEST(quantity - reserved_quantity, 0)), 0)
    INTO v_available
    FROM public.inventory_stock
    WHERE tenant_id = p_tenant_id
      AND item_id = p_item_id
      AND warehouse_id = p_warehouse_id
      AND category = v_category;

    v_remaining := ABS(p_quantity_change);
    IF v_available + 0.000001 < v_remaining THEN
      RAISE EXCEPTION
        'Insufficient stock for item % in warehouse %: available %, requested %',
        p_item_id,
        p_warehouse_id,
        v_available,
        v_remaining;
    END IF;

    FOR v_stock IN
      SELECT id, quantity, reserved_quantity
      FROM public.inventory_stock
      WHERE tenant_id = p_tenant_id
        AND item_id = p_item_id
        AND warehouse_id = p_warehouse_id
        AND category = v_category
        AND quantity > reserved_quantity
      ORDER BY
        CASE WHEN location_id = v_location_id THEN 0 ELSE 1 END,
        (quantity - reserved_quantity) DESC,
        id
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0.000001;
      v_deduct := LEAST(
        GREATEST(v_stock.quantity - v_stock.reserved_quantity, 0),
        v_remaining
      );

      IF v_deduct > 0 THEN
        UPDATE public.inventory_stock
        SET quantity = quantity - v_deduct,
            last_movement_date = NOW(),
            updated_at = NOW()
        WHERE id = v_stock.id;
        v_remaining := v_remaining - v_deduct;
      END IF;
    END LOOP;

    IF v_remaining > 0.000001 THEN
      RAISE EXCEPTION 'Inventory deduction was not fully allocated; remaining %', v_remaining;
    END IF;

    RETURN;
  END IF;

  IF v_location_id IS NULL THEN
    INSERT INTO public.storage_locations (
      warehouse_id,
      location_code,
      location_name,
      is_active,
      created_at
    )
    VALUES (
      p_warehouse_id,
      v_default_code,
      'Default Location',
      true,
      NOW()
    )
    ON CONFLICT (location_code)
    DO UPDATE SET location_name = EXCLUDED.location_name
    RETURNING id INTO v_location_id;
  END IF;

  INSERT INTO public.inventory_stock (
    tenant_id,
    item_id,
    warehouse_id,
    location_id,
    quantity,
    category,
    last_movement_date
  )
  VALUES (
    p_tenant_id,
    p_item_id,
    p_warehouse_id,
    v_location_id,
    p_quantity_change,
    v_category,
    NOW()
  )
  ON CONFLICT (tenant_id, item_id, warehouse_id, location_id, category)
  DO UPDATE SET
    quantity = public.inventory_stock.quantity + EXCLUDED.quantity,
    last_movement_date = NOW(),
    updated_at = NOW();
END;
$function$;
