-- Quick Apply: Sales Module Tables
-- Run this if sales tables don't exist

\i create-sales-dispatch.sql

-- Verify tables exist
SELECT 
    'customers' as table_name, 
    COUNT(*) as count 
FROM customers 
WHERE tenant_id IS NOT NULL
UNION ALL
SELECT 
    'quotations', 
    COUNT(*) 
FROM quotations 
WHERE tenant_id IS NOT NULL
UNION ALL
SELECT 
    'sales_orders', 
    COUNT(*) 
FROM sales_orders 
WHERE tenant_id IS NOT NULL
UNION ALL
SELECT 
    'dispatch_notes', 
    COUNT(*) 
FROM dispatch_notes 
WHERE tenant_id IS NOT NULL
UNION ALL
SELECT 
    'warranties', 
    COUNT(*) 
FROM warranties 
WHERE tenant_id IS NOT NULL;

-- Success message
SELECT 'Sales module tables ready!' as status;
