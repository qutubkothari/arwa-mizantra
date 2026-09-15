-- Atomic ATP reservations for commercially released sales orders.
-- Reservations reduce inventory_stock.available_quantity but never move physical stock.
ALTER TABLE public.stock_reservations
  ADD COLUMN IF NOT EXISTS inventory_stock_id UUID REFERENCES public.inventory_stock(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reference_line_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_order_active_stock_reservation
  ON public.stock_reservations (tenant_id, reference_type, reference_id, reference_line_id, inventory_stock_id)
  WHERE released = FALSE AND reference_type = 'SALES_ORDER';

CREATE INDEX IF NOT EXISTS idx_stock_reservations_active_reference_line
  ON public.stock_reservations (tenant_id, reference_type, reference_id, reference_line_id)
  WHERE released = FALSE;

CREATE OR REPLACE FUNCTION public.reserve_sales_order_atp(
  p_tenant_id UUID,
  p_sales_order_id UUID,
  p_sales_order_number TEXT,
  p_reserved_by UUID,
  p_allocations JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allocation JSONB;
  v_stock public.inventory_stock%ROWTYPE;
  v_quantity NUMERIC;
  v_existing UUID;
  v_count INTEGER := 0;
  v_total NUMERIC := 0;
BEGIN
  IF jsonb_typeof(p_allocations) <> 'array' THEN RAISE EXCEPTION 'ATP allocations must be an array.'; END IF;
  IF EXISTS (SELECT 1 FROM public.sales_orders WHERE tenant_id=p_tenant_id AND id=p_sales_order_id AND release_status='RELEASED') THEN
    RAISE EXCEPTION 'Sales order is already commercially released.';
  END IF;

  -- Validate and lock every stock row before changing any balance.
  FOR v_allocation IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
    v_quantity := (v_allocation->>'quantity')::NUMERIC;
    IF v_quantity <= 0 THEN RAISE EXCEPTION 'ATP allocation quantity must be positive.'; END IF;
    SELECT * INTO v_stock FROM public.inventory_stock
      WHERE tenant_id=p_tenant_id AND id=(v_allocation->>'inventory_stock_id')::UUID FOR UPDATE;
    IF NOT FOUND OR v_stock.item_id <> (v_allocation->>'item_id')::UUID THEN RAISE EXCEPTION 'ATP stock allocation is invalid.'; END IF;
    IF v_stock.available_quantity < v_quantity THEN
      RAISE EXCEPTION 'ATP changed during release. Available %, requested % for item %.', v_stock.available_quantity, v_quantity, v_stock.item_id;
    END IF;
  END LOOP;

  FOR v_allocation IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
    v_quantity := (v_allocation->>'quantity')::NUMERIC;
    SELECT id INTO v_existing FROM public.stock_reservations
      WHERE tenant_id=p_tenant_id AND reference_type='SALES_ORDER' AND reference_id=p_sales_order_id
        AND reference_line_id=(v_allocation->>'reference_line_id')::UUID
        AND inventory_stock_id=(v_allocation->>'inventory_stock_id')::UUID AND released=FALSE;
    IF v_existing IS NOT NULL THEN RAISE EXCEPTION 'An active ATP reservation already exists for this sales-order allocation.'; END IF;
    INSERT INTO public.stock_reservations
      (tenant_id,item_id,warehouse_id,inventory_stock_id,reserved_quantity,reference_type,reference_id,reference_line_id,reference_number,reserved_by)
    VALUES
      (p_tenant_id,(v_allocation->>'item_id')::UUID,(v_allocation->>'warehouse_id')::UUID,(v_allocation->>'inventory_stock_id')::UUID,v_quantity,'SALES_ORDER',p_sales_order_id,(v_allocation->>'reference_line_id')::UUID,p_sales_order_number,p_reserved_by);
    UPDATE public.inventory_stock SET reserved_quantity=reserved_quantity+v_quantity,updated_at=NOW()
      WHERE tenant_id=p_tenant_id AND id=(v_allocation->>'inventory_stock_id')::UUID;
    v_count := v_count + 1; v_total := v_total + v_quantity;
  END LOOP;
  RETURN jsonb_build_object('reservation_count',v_count,'reserved_quantity',v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_sales_order_atp(
  p_tenant_id UUID,
  p_sales_order_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.stock_reservations%ROWTYPE; v_total NUMERIC := 0;
BEGIN
  FOR v_row IN SELECT * FROM public.stock_reservations
    WHERE tenant_id=p_tenant_id AND reference_type='SALES_ORDER' AND reference_id=p_sales_order_id AND released=FALSE
    ORDER BY id FOR UPDATE
  LOOP
    IF v_row.inventory_stock_id IS NOT NULL THEN
      UPDATE public.inventory_stock SET reserved_quantity=GREATEST(0,reserved_quantity-v_row.reserved_quantity),updated_at=NOW()
        WHERE tenant_id=p_tenant_id AND id=v_row.inventory_stock_id;
    END IF;
    UPDATE public.stock_reservations SET released=TRUE,released_at=NOW() WHERE id=v_row.id;
    v_total := v_total + v_row.reserved_quantity;
  END LOOP;
  RETURN jsonb_build_object('released_quantity',v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_sales_order_atp(
  p_tenant_id UUID,
  p_sales_order_id UUID,
  p_sales_order_line_id UUID,
  p_quantity NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.stock_reservations%ROWTYPE; v_take NUMERIC; v_remaining NUMERIC := p_quantity; v_consumed NUMERIC := 0;
BEGIN
  IF p_quantity <= 0 THEN RAISE EXCEPTION 'Consumption quantity must be positive.'; END IF;
  FOR v_row IN SELECT * FROM public.stock_reservations
    WHERE tenant_id=p_tenant_id AND reference_type='SALES_ORDER' AND reference_id=p_sales_order_id
      AND reference_line_id=p_sales_order_line_id AND released=FALSE
    ORDER BY reserved_at,id FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_remaining,v_row.reserved_quantity);
    IF v_row.inventory_stock_id IS NOT NULL THEN
      UPDATE public.inventory_stock SET reserved_quantity=GREATEST(0,reserved_quantity-v_take),updated_at=NOW()
        WHERE tenant_id=p_tenant_id AND id=v_row.inventory_stock_id;
    END IF;
    IF v_take >= v_row.reserved_quantity THEN
      UPDATE public.stock_reservations SET released=TRUE,released_at=NOW() WHERE id=v_row.id;
    ELSE
      UPDATE public.stock_reservations SET reserved_quantity=reserved_quantity-v_take WHERE id=v_row.id;
    END IF;
    v_remaining := v_remaining-v_take; v_consumed := v_consumed+v_take;
  END LOOP;
  RETURN jsonb_build_object('consumed_reservation_quantity',v_consumed,'unreserved_dispatch_quantity',GREATEST(0,v_remaining));
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_sales_order_atp_bulk(
  p_tenant_id UUID,
  p_sales_order_id UUID,
  p_lines JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_line JSONB; v_result JSONB; v_consumed NUMERIC := 0; v_unreserved NUMERIC := 0;
BEGIN
  IF jsonb_typeof(p_lines) <> 'array' THEN RAISE EXCEPTION 'Dispatch reservation lines must be an array.'; END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_result := public.consume_sales_order_atp(
      p_tenant_id,p_sales_order_id,(v_line->>'sales_order_line_id')::UUID,(v_line->>'quantity')::NUMERIC
    );
    v_consumed := v_consumed + coalesce((v_result->>'consumed_reservation_quantity')::NUMERIC,0);
    v_unreserved := v_unreserved + coalesce((v_result->>'unreserved_dispatch_quantity')::NUMERIC,0);
  END LOOP;
  RETURN jsonb_build_object('consumed_reservation_quantity',v_consumed,'unreserved_dispatch_quantity',v_unreserved);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_sales_order_atp(UUID,UUID,TEXT,UUID,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_sales_order_atp(UUID,UUID,TEXT,UUID,JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.release_sales_order_atp(UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_sales_order_atp(UUID,UUID) TO service_role;
REVOKE ALL ON FUNCTION public.consume_sales_order_atp(UUID,UUID,UUID,NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_sales_order_atp(UUID,UUID,UUID,NUMERIC) TO service_role;
REVOKE ALL ON FUNCTION public.consume_sales_order_atp_bulk(UUID,UUID,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_sales_order_atp_bulk(UUID,UUID,JSONB) TO service_role;

COMMENT ON FUNCTION public.reserve_sales_order_atp(UUID,UUID,TEXT,UUID,JSONB) IS
  'Atomically converts sales ATP allocations into warehouse stock reservations without moving stock.';
