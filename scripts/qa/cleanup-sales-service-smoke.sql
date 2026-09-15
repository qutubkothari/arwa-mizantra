-- Removes only reversible automated Sales/Service QA transactions.
DO $$
DECLARE
  smoke_ticket_ids UUID[];
  smoke_confirmation_ids UUID[];
  smoke_invoice_ids UUID[];
  smoke_sales_order_ids UUID[];
  smoke_dispatch_ids UUID[];
  smoke_sales_invoice_ids UUID[];
  smoke_uid_ids UUID[];
  smoke_seed_movement_ids UUID[];
BEGIN
  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[])
  INTO smoke_ticket_ids
  FROM public.service_tickets
  WHERE complaint_description LIKE 'Automated sales-service smoke %';

  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[])
  INTO smoke_confirmation_ids
  FROM public.service_confirmations
  WHERE service_ticket_id = ANY(smoke_ticket_ids);

  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[])
  INTO smoke_invoice_ids
  FROM public.customer_service_invoices
  WHERE service_ticket_id = ANY(smoke_ticket_ids);

  DELETE FROM public.customer_service_payments WHERE invoice_id = ANY(smoke_invoice_ids);
  DELETE FROM public.customer_service_invoices WHERE id = ANY(smoke_invoice_ids);
  DELETE FROM public.service_feedback WHERE service_ticket_id = ANY(smoke_ticket_ids);
  DELETE FROM public.service_site_visits WHERE service_ticket_id = ANY(smoke_ticket_ids);
  DELETE FROM public.service_ticket_checklist_items WHERE service_ticket_id = ANY(smoke_ticket_ids);
  DELETE FROM public.service_estimate_engagements WHERE service_ticket_id = ANY(smoke_ticket_ids);
  UPDATE public.service_tickets SET approved_estimate_id = NULL WHERE id = ANY(smoke_ticket_ids);
  DELETE FROM public.service_estimates WHERE service_ticket_id = ANY(smoke_ticket_ids);
  DELETE FROM public.service_history WHERE service_ticket_id = ANY(smoke_ticket_ids);
  DELETE FROM public.service_confirmations WHERE id = ANY(smoke_confirmation_ids);
  DELETE FROM public.service_parts_used WHERE service_ticket_id = ANY(smoke_ticket_ids);
  DELETE FROM public.stock_movements
  WHERE reference_id = ANY(smoke_ticket_ids)
    AND reference_type IN ('SERVICE_PART_ISSUE', 'AUTOMATED_SERVICE_PART_RESTORE');
  DELETE FROM public.service_assignments WHERE service_ticket_id = ANY(smoke_ticket_ids);
  DELETE FROM public.service_tickets WHERE id = ANY(smoke_ticket_ids);

  UPDATE public.technicians technician
  SET total_assignments = (
    SELECT COUNT(*) FROM public.service_assignments assignment
    WHERE assignment.technician_id = technician.id
  );

  DELETE FROM public.technicians
  WHERE email = 'automated-service-smoke@example.invalid'
    AND NOT EXISTS (
      SELECT 1 FROM public.service_assignments assignment
      WHERE assignment.technician_id = technicians.id
    );

  DELETE FROM public.service_checklist_template_items
  WHERE template_id IN (
    SELECT id FROM public.service_checklist_templates
    WHERE template_name LIKE 'Automated QA Checklist %'
  );
  DELETE FROM public.service_checklist_templates
  WHERE template_name LIKE 'Automated QA Checklist %';

  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[]) INTO smoke_sales_order_ids
  FROM public.sales_orders WHERE notes LIKE 'Automated sales full smoke %';
  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[]) INTO smoke_dispatch_ids
  FROM public.dispatch_notes WHERE sales_order_id = ANY(smoke_sales_order_ids);
  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[]) INTO smoke_sales_invoice_ids
  FROM public.invoices WHERE sales_order_id = ANY(smoke_sales_order_ids);
  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[]) INTO smoke_uid_ids
  FROM public.uid_registry WHERE metadata->>'source' = 'STOCK_ADJUSTMENT'
    AND metadata->>'movement_number' IN (
      SELECT movement_number FROM public.stock_movements
      WHERE reference_type = 'AUTOMATED_SALES_STOCK_SEED'
    );
  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[]) INTO smoke_seed_movement_ids
  FROM public.stock_movements WHERE reference_type = 'AUTOMATED_SALES_STOCK_SEED';

  DELETE FROM public.sales_invoice_payments WHERE invoice_id = ANY(smoke_sales_invoice_ids);
  DELETE FROM public.sales_document_events WHERE sales_order_id = ANY(smoke_sales_order_ids);
  DELETE FROM public.sales_invoice_items WHERE invoice_id = ANY(smoke_sales_invoice_ids);
  DELETE FROM public.invoices WHERE id = ANY(smoke_sales_invoice_ids);
  DELETE FROM public.warranties WHERE sales_order_id = ANY(smoke_sales_order_ids);
  DELETE FROM public.product_deployment_history WHERE deployment_notes LIKE 'Auto-created from dispatch DN-%'
    AND uid_id = ANY(smoke_uid_ids);
  DELETE FROM public.dispatch_items WHERE dispatch_note_id = ANY(smoke_dispatch_ids);
  DELETE FROM public.stock_entries
  WHERE metadata->>'movement_id' IN (SELECT unnest(smoke_seed_movement_ids)::TEXT)
    AND COALESCE(available_quantity, 0) = 0;
  DELETE FROM public.stock_movements
  WHERE reference_type IN ('AUTOMATED_SALES_STOCK_SEED', 'AUTOMATED_SALES_STOCK_CLEANUP')
     OR reference_number IN (SELECT dn_number FROM public.dispatch_notes WHERE id = ANY(smoke_dispatch_ids));
  DELETE FROM public.dispatch_notes WHERE id = ANY(smoke_dispatch_ids);
  DELETE FROM public.sales_order_items WHERE sales_order_id = ANY(smoke_sales_order_ids);
  DELETE FROM public.sales_orders WHERE id = ANY(smoke_sales_order_ids);
  DELETE FROM public.uid_registry WHERE id = ANY(smoke_uid_ids);
END $$;
