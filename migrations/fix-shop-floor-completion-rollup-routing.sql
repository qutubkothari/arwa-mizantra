-- Repair Shop Floor start/completion roll-up after unified Job Order execution.
-- production_routing has no is_active column; the original trigger referenced it,
-- causing every station_completions insert to fail with PostgreSQL 42703.
BEGIN;

CREATE OR REPLACE FUNCTION public.roll_up_station_completion_to_job_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  execution RECORD;
  route RECORD;
  prior_route_id UUID;
  good_qty NUMERIC := 0;
  reject_qty NUMERIC := 0;
  rework_qty NUMERIC := 0;
  runtime_hours NUMERIC := 0;
  active_count INTEGER := 0;
  input_target NUMERIC := 0;
  final_route_id UUID;
BEGIN
  IF NEW.job_order_id IS NULL OR NEW.job_order_operation_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id, tenant_id, bom_id, quantity, job_order_id
  INTO execution
  FROM public.production_orders
  WHERE id = NEW.production_order_id;

  SELECT id, sequence_no INTO route
  FROM public.production_routing
  WHERE id = NEW.routing_id;

  SELECT id INTO prior_route_id
  FROM public.production_routing
  WHERE tenant_id = execution.tenant_id
    AND bom_id = execution.bom_id
    AND sequence_no < route.sequence_no
  ORDER BY sequence_no DESC
  LIMIT 1;

  SELECT
    COALESCE(SUM(quantity_completed), 0),
    COALESCE(SUM(quantity_rejected), 0),
    COALESCE(SUM(rework_quantity), 0),
    COALESCE(SUM(actual_time_minutes), 0) / 60.0,
    COUNT(*) FILTER (WHERE status IN ('IN_PROGRESS', 'PAUSED'))
  INTO good_qty, reject_qty, rework_qty, runtime_hours, active_count
  FROM public.station_completions
  WHERE tenant_id = execution.tenant_id
    AND production_order_id = execution.id
    AND routing_id = route.id;

  IF prior_route_id IS NULL THEN
    input_target := execution.quantity;
  ELSE
    SELECT COALESCE(SUM(quantity_completed), 0)
    INTO input_target
    FROM public.station_completions
    WHERE tenant_id = execution.tenant_id
      AND production_order_id = execution.id
      AND routing_id = prior_route_id
      AND status = 'COMPLETED';
  END IF;

  UPDATE public.job_order_operations
  SET completed_quantity = good_qty,
      rejected_quantity = reject_qty,
      rework_quantity = rework_qty,
      actual_start_datetime = COALESCE(actual_start_datetime, NEW.start_time),
      actual_end_datetime = CASE
        WHEN active_count = 0 AND good_qty + reject_qty >= input_target AND input_target > 0
          THEN NEW.end_time
        ELSE NULL
      END,
      actual_duration_hours = runtime_hours,
      assigned_user_id = COALESCE(assigned_user_id, NEW.operator_id),
      status = CASE
        WHEN active_count > 0 AND NEW.status = 'PAUSED' THEN 'ON_HOLD'::public.operation_status
        WHEN active_count > 0 THEN 'IN_PROGRESS'::public.operation_status
        WHEN good_qty + reject_qty >= input_target AND input_target > 0
          THEN 'COMPLETED'::public.operation_status
        WHEN good_qty + reject_qty > 0 THEN 'IN_PROGRESS'::public.operation_status
        ELSE 'NOT_STARTED'::public.operation_status
      END,
      updated_at = NOW()
  WHERE id = NEW.job_order_operation_id;

  SELECT id INTO final_route_id
  FROM public.production_routing
  WHERE tenant_id = execution.tenant_id
    AND bom_id = execution.bom_id
  ORDER BY sequence_no DESC
  LIMIT 1;

  IF final_route_id = route.id THEN
    UPDATE public.production_job_orders
    SET completed_quantity = good_qty,
        rejected_quantity = reject_qty,
        actual_start_date = COALESCE(actual_start_date, NEW.start_time),
        updated_at = NOW()
    WHERE id = execution.job_order_id;

    UPDATE public.production_orders
    SET produced_quantity = good_qty,
        status = CASE
          WHEN active_count = 0 AND good_qty + reject_qty >= input_target AND input_target > 0
            THEN 'COMPLETED'::public.production_order_status
          ELSE 'IN_PROGRESS'::public.production_order_status
        END,
        updated_at = NOW()
    WHERE id = execution.id;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
