-- Separate stores issue from production consumption for auditable WIP.
-- SIV remains the only stock-decrementing action. This control records the
-- final consumption/backflush against quantities already issued to a job.
CREATE TABLE IF NOT EXISTS public.production_material_consumptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_order_id UUID NOT NULL REFERENCES public.production_job_orders(id) ON DELETE RESTRICT,
  material_line_id UUID NOT NULL REFERENCES public.job_order_materials(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  posting_method VARCHAR(20) NOT NULL DEFAULT 'BACKFLUSH'
    CHECK (posting_method IN ('BACKFLUSH','MANUAL')),
  required_quantity NUMERIC(18,4) NOT NULL CHECK (required_quantity >= 0),
  issued_quantity NUMERIC(18,4) NOT NULL CHECK (issued_quantity >= 0),
  consumed_quantity NUMERIC(18,4) NOT NULL CHECK (consumed_quantity >= 0),
  scrap_quantity NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (scrap_quantity >= 0),
  quantity_variance NUMERIC(18,4) NOT NULL DEFAULT 0,
  posted_by UUID NOT NULL,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, material_line_id)
);

CREATE INDEX IF NOT EXISTS idx_production_material_consumptions_job
  ON public.production_material_consumptions (tenant_id, job_order_id, posted_at);

CREATE OR REPLACE FUNCTION public.record_job_order_material_backflush(
  p_tenant_id UUID,
  p_job_order_id UUID,
  p_posted_by UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.production_job_orders%ROWTYPE;
  v_line RECORD;
  v_item_id UUID;
  v_count INTEGER := 0;
  v_required NUMERIC(18,4);
  v_issued NUMERIC(18,4);
BEGIN
  IF p_posted_by IS NULL THEN
    RAISE EXCEPTION 'Production backflush requires an authenticated user';
  END IF;

  SELECT * INTO v_order
  FROM public.production_job_orders
  WHERE tenant_id = p_tenant_id AND id = p_job_order_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Job order not found'; END IF;
  IF v_order.status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Job order must be IN_PROGRESS to post consumption';
  END IF;

  FOR v_line IN
    SELECT * FROM public.job_order_materials
    WHERE job_order_id = p_job_order_id
    ORDER BY id
    FOR UPDATE
  LOOP
    v_required := GREATEST(COALESCE(v_line.required_quantity, 0), 0);
    v_issued := GREATEST(COALESCE(v_line.issued_quantity, 0), 0);
    IF v_issued + 0.0001 < v_required THEN
      RAISE EXCEPTION 'Material % is not fully issued (required %, issued %)',
        COALESCE(v_line.item_code, v_line.id::text), v_required, v_issued;
    END IF;

    v_item_id := COALESCE(v_line.selected_variant_id, v_line.item_id);
    IF v_item_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.items i WHERE i.tenant_id = p_tenant_id AND i.id = v_item_id
    ) THEN
      RAISE EXCEPTION 'Material % has no valid tenant item mapping', v_line.id;
    END IF;

    INSERT INTO public.production_material_consumptions (
      tenant_id, job_order_id, material_line_id, item_id, posting_method,
      required_quantity, issued_quantity, consumed_quantity, scrap_quantity,
      quantity_variance, posted_by, evidence
    ) VALUES (
      p_tenant_id, p_job_order_id, v_line.id, v_item_id,
      CASE WHEN COALESCE(v_line.issue_method, 'MANUAL') = 'BACKFLUSH' THEN 'BACKFLUSH' ELSE 'MANUAL' END,
      v_required, v_issued, v_required, GREATEST(v_issued - v_required, 0),
      v_issued - v_required, p_posted_by,
      jsonb_build_object(
        'job_order_number', v_order.job_order_number,
        'material_status', v_line.status,
        'control', 'SIV_ISSUE_THEN_PRODUCTION_CONSUMPTION',
        'configured_issue_method', COALESCE(v_line.issue_method, 'MANUAL'),
        'route_operation_id', v_line.route_operation_id,
        'input_warehouse_id', v_line.input_warehouse_id
      )
    ) ON CONFLICT (tenant_id, material_line_id) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'job_order_id', p_job_order_id,
    'job_order_number', v_order.job_order_number,
    'material_lines', v_count,
    'posting_method', 'BACKFLUSH'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_production_consumption_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Posted production consumption is immutable; use a controlled reversal';
END;
$$;

DROP TRIGGER IF EXISTS trg_production_consumption_immutable
  ON public.production_material_consumptions;
CREATE TRIGGER trg_production_consumption_immutable
BEFORE UPDATE OR DELETE ON public.production_material_consumptions
FOR EACH ROW EXECUTE FUNCTION public.prevent_production_consumption_mutation();

REVOKE ALL ON FUNCTION public.record_job_order_material_backflush(UUID,UUID,UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_job_order_material_backflush(UUID,UUID,UUID)
  TO service_role;

COMMENT ON TABLE public.production_material_consumptions IS
  'Immutable WIP consumption evidence posted only after SIV has issued every required material line.';
