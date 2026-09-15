-- Additive cloud-style feature entitlement control.
-- Safety: every active feature is enabled for every existing tenant. Nothing
-- becomes hidden until a Master Admin explicitly changes an entitlement.
CREATE TABLE IF NOT EXISTS public.app_feature_catalogue (
  feature_key TEXT PRIMARY KEY,
  feature_name TEXT NOT NULL,
  module_name TEXT NOT NULL,
  description TEXT,
  screen_route TEXT,
  route_match TEXT NOT NULL DEFAULT 'EXACT' CHECK (route_match IN ('EXACT','PREFIX')),
  api_prefixes TEXT[] NOT NULL DEFAULT '{}',
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tenant_feature_entitlements (
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL REFERENCES public.app_feature_catalogue(feature_key) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, feature_key)
);

CREATE TABLE IF NOT EXISTS public.feature_entitlement_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL REFERENCES public.app_feature_catalogue(feature_key),
  previous_enabled BOOLEAN NOT NULL,
  new_enabled BOOLEAN NOT NULL,
  changed_by UUID,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_feature_entitlements_enabled
  ON public.tenant_feature_entitlements (tenant_id, is_enabled, feature_key);
CREATE INDEX IF NOT EXISTS idx_feature_entitlement_audit_tenant
  ON public.feature_entitlement_audit (tenant_id, changed_at DESC);

INSERT INTO public.app_feature_catalogue
  (feature_key, feature_name, module_name, description, screen_route, route_match, api_prefixes, display_order)
VALUES
  ('reports-cockpit','Reports Cockpit','Reports','Operational and management reporting workspace.','/dashboard/reports','EXACT',ARRAY['/reports'],10),
  ('manager-dashboard','Manager Approvals','Reports','Manager approval worklist.','/dashboard/manager','EXACT',ARRAY['/manager'],20),
  ('production-projects','Project Master','Projects','Project master and execution workspace.','/dashboard/projects','EXACT',ARRAY['/projects'],30),
  ('project-performance','Margin & EVM Control','Projects','Project earned-value and margin controls.','/dashboard/projects/performance','PREFIX',ARRAY['/project-performance'],40),

  ('purchase-overview','Procurement Overview','Procurement','Procurement overview and operational indicators.','/dashboard/purchase','EXACT',ARRAY[]::TEXT[],100),
  ('purchase-vendors','Vendors','Procurement','Supplier master and governance.','/dashboard/purchase/vendors','EXACT',ARRAY['/purchase/vendors'],110),
  ('purchase-requisitions','Purchase Requisitions','Procurement','Purchase request and approval workflow.','/dashboard/purchase/requisitions','EXACT',ARRAY['/purchase/requisitions'],120),
  ('purchase-orders','Purchase Orders','Procurement','Purchase order creation and controls.','/dashboard/purchase/orders','EXACT',ARRAY['/purchase/orders'],130),
  ('purchase-spend-intelligence','Spend Intelligence','Procurement','Procurement spend and savings intelligence.','/dashboard/purchase/spend-intelligence','PREFIX',ARRAY['/purchase/spend-intelligence'],140),
  ('purchase-strategic-sourcing','Strategic Sourcing','Procurement','Supplier evaluation and sourcing awards.','/dashboard/purchase/strategic-sourcing','PREFIX',ARRAY['/purchase/strategic-sourcing'],150),
  ('purchase-contracts','Contract Control','Procurement','Supplier contract commitment controls.','/dashboard/purchase/contracts','PREFIX',ARRAY['/purchase/contracts'],160),
  ('purchase-import-files','Import Files','Procurement','Import file, landed cost and customs workspace.','/dashboard/purchase/import-files','PREFIX',ARRAY['/purchase/import-files'],170),
  ('purchase-service-entries','Service Entry Sheets','Procurement','Service acceptance and supplier invoice workflow.','/dashboard/purchase/service-entries','PREFIX',ARRAY['/purchase/service-entry-sheets'],180),
  ('purchase-debit-notes','Debit Notes','Procurement','Supplier debit note and recovery workflow.','/dashboard/purchase/debit-notes','PREFIX',ARRAY['/purchase/debit-notes'],190),

  ('inventory-items','Stock Master','Inventory','Item and stock master.','/dashboard/inventory/items','EXACT',ARRAY['/inventory/items','/items'],200),
  ('inventory-low-stock','Low Stock Planning','Inventory','Shortage and replenishment planning.','/dashboard/inventory/low-stock','PREFIX',ARRAY['/inventory/low-stock'],210),
  ('inventory-warehouse-control','Warehouse Control','Inventory','Warehouse operating controls.','/dashboard/inventory/warehouse-control','PREFIX',ARRAY['/inventory/warehouse-control'],220),
  ('inventory-warehouse-optimization','Warehouse Optimization','Inventory','Warehouse slotting and optimization.','/dashboard/inventory/warehouse-optimization','PREFIX',ARRAY['/inventory/warehouse-optimization'],230),
  ('inventory-working-capital','Working Capital & SLOB','Inventory','Slow-moving inventory and working-capital analysis.','/dashboard/inventory/working-capital','PREFIX',ARRAY['/inventory/working-capital'],240),
  ('inventory-stock-adjustments','Stock Adjustments','Inventory','Controlled stock correction workflow.','/dashboard/inventory/stock-adjustments','PREFIX',ARRAY['/inventory/stock-adjustments'],250),
  ('purchase-grn','Goods Receipt (GRN)','Inventory','Material goods receipt and QC workflow.','/dashboard/purchase/grn','EXACT',ARRAY['/purchase/grn'],260),
  ('inventory-siv','Store Issue Voucher','Inventory','Material issue workflow.','/dashboard/inventory/siv','PREFIX',ARRAY['/inventory/siv'],270),
  ('inventory-srv','Store Receipt Voucher','Inventory','Store return receipt workflow.','/dashboard/inventory/srv','PREFIX',ARRAY['/inventory/srv'],280),
  ('uid-overview','UID Management','Inventory','UID registry and lifecycle.','/dashboard/uid','EXACT',ARRAY['/uid'],290),
  ('uid-traceability','UID Traceability','Inventory','UID genealogy and trace.','/dashboard/uid/trace','PREFIX',ARRAY['/uid/traceability'],300),
  ('uid-deployment','UID Deployment','Inventory','UID deployment controls.','/dashboard/uid/deployment','PREFIX',ARRAY['/uid/deployment'],310),

  ('production-create-job-order','Create Job Order','Production','Create manufacturing job orders.','/dashboard/production/job-orders/smart-items','EXACT',ARRAY['/production/job-orders'],400),
  ('production-job-orders','View Job Orders','Production','Job order register and execution.','/dashboard/production/job-orders','EXACT',ARRAY['/production/job-orders'],410),
  ('production-mrp','Material Planning (MRP)','Production','Material requirements planning.','/dashboard/production/mrp','PREFIX',ARRAY['/mrp'],420),
  ('production-smart-planning','Smart Production Planning','Production','Advanced production planning recommendations.','/dashboard/production/smart-planning','PREFIX',ARRAY['/advanced-production-planning'],430),
  ('production-control-tower','Planning Control Tower','Production','Production planning command centre.','/dashboard/production/planning-control-tower','PREFIX',ARRAY['/production-planning'],440),
  ('production-planning-config','MRP & APS Configuration','Production','Planning policies and configuration.','/dashboard/production/planning-configuration','PREFIX',ARRAY['/production-planning/configuration'],450),
  ('production-demand-planning','Demand & S&OP','Production','Demand planning and consensus cycles.','/dashboard/production/demand-planning','PREFIX',ARRAY['/demand-planning'],460),
  ('production-capacity','Capacity Planning','Production','Work-centre capacity planning.','/dashboard/production/capacity-planning','PREFIX',ARRAY['/production/capacity-planning'],470),
  ('production-oee','OEE & Loss Control','Production','Equipment effectiveness and loss actions.','/dashboard/production/oee','PREFIX',ARRAY['/production/oee'],480),
  ('production-autonomy','Production Autonomy','Production','Governed autonomous production actions.','/dashboard/production/autonomy','PREFIX',ARRAY['/production-autonomy'],490),
  ('production-engineering-changes','Engineering Changes','Production','Engineering change control.','/dashboard/production/engineering-changes','PREFIX',ARRAY['/production/engineering-changes'],500),
  ('production-maintenance','Plant Maintenance','Production','Maintenance assets, plans and work orders.','/dashboard/production/maintenance','PREFIX',ARRAY['/plant-maintenance'],510),
  ('production-subcontracting','Subcontracting','Production','Subcontract material, receipt, QC and settlement.','/dashboard/production/subcontracting','PREFIX',ARRAY['/production/subcontracting'],520),
  ('bom-overview','BOM & Routing','Production','Bills of material and manufacturing routing.','/dashboard/bom','PREFIX',ARRAY['/bom'],530),

  ('accounts-control-centre','Accounting','Accounts','General ledger and finance control centre.','/dashboard/accounts','EXACT',ARRAY['/accounting'],600),
  ('accounts-margin-control','Margin-to-Cash','Accounts','Commercial margin leakage controls.','/dashboard/accounts/margin-control','PREFIX',ARRAY['/margin-control'],610),
  ('accounts-costing','Cost & Margin','Accounts','Product and job costing.','/dashboard/accounts/costing','PREFIX',ARRAY['/costing'],620),
  ('accounts-collections','Collections','Accounts','Receivables collection worklist.','/dashboard/accounts/collections','PREFIX',ARRAY['/collections'],630),
  ('accounts-payment-runs','Payment Runs','Accounts','Governed supplier payment batches.','/dashboard/accounts/payment-runs','PREFIX',ARRAY['/accounting/payment-runs'],640),
  ('accounts-cash-forecast','Cash Forecast','Accounts','Liquidity forecast workspace.','/dashboard/accounts/cash-forecast','PREFIX',ARRAY['/accounting/cash-forecast'],650),
  ('accounts-treasury-control','Treasury & FX Control','Accounts','Treasury liquidity and FX controls.','/dashboard/accounts/treasury-control','PREFIX',ARRAY['/enterprise-edge/treasury'],660),
  ('accounts-value-realization','Value Realization','Accounts','Enterprise value realization register.','/dashboard/accounts/value-realization','PREFIX',ARRAY['/enterprise-edge/value-realization'],670),
  ('accounts-fpna-control','FP&A Scenarios','Accounts','Driver-based planning scenarios.','/dashboard/accounts/fpna-control','PREFIX',ARRAY['/enterprise-edge/fpna'],680),
  ('accounts-lease-accounting','IFRS 16 Leases','Accounts','Lease accounting controls.','/dashboard/accounts/lease-accounting','PREFIX',ARRAY['/enterprise-edge/leases'],690),
  ('accounts-revenue-recognition','IFRS 15 Revenue','Accounts','Revenue recognition controls.','/dashboard/accounts/revenue-recognition','PREFIX',ARRAY['/enterprise-edge/revenue'],700),
  ('accounts-ecl-control','IFRS 9 ECL','Accounts','Expected-credit-loss controls.','/dashboard/accounts/ecl-control','PREFIX',ARRAY['/enterprise-edge/ecl'],710),
  ('accounts-provision-control','IAS 37 Provisions','Accounts','Provision and contingency controls.','/dashboard/accounts/provision-control','PREFIX',ARRAY['/enterprise-edge/provisions'],720),
  ('accounts-expense-control','Expense Control','Accounts','Expense governance and analysis.','/dashboard/accounts/expense-control','PREFIX',ARRAY['/expense-control'],730),
  ('accounts-bank-reconciliation','Bank Reconciliation','Accounts','Bank statement and reconciliation workflow.','/dashboard/accounts/bank-reconciliation','PREFIX',ARRAY['/accounting/bank'],740),
  ('accounts-fixed-assets','Fixed Assets','Accounts','Fixed asset accounting.','/dashboard/accounts/fixed-assets','PREFIX',ARRAY['/accounting/fixed-assets'],750),
  ('accounts-budgets','Budgets','Accounts','Budget preparation and controls.','/dashboard/accounts/budgets','PREFIX',ARRAY['/accounting/budgets'],760),
  ('accounts-statutory-returns','Statutory Returns','Accounts','Tax and statutory return controls.','/dashboard/accounts/statutory-returns','PREFIX',ARRAY['/accounting/statutory'],770),
  ('accounts-fx-revaluation','FX Revaluation','Accounts','Foreign currency revaluation.','/dashboard/accounts/fx-revaluation','PREFIX',ARRAY['/accounting/fx'],780),
  ('accounts-cost-centres','Cost Centres','Accounts','Cost-centre master and allocation.','/dashboard/accounts/cost-centres','PREFIX',ARRAY['/accounting/cost-centres'],790),
  ('accounts-report-schedules','Report Schedules','Accounts','Scheduled finance reporting.','/dashboard/accounts/report-schedules','PREFIX',ARRAY['/accounting/report-schedules'],800),
  ('accounts-opening-balances','Opening Balances','Accounts','Controlled opening balance import.','/dashboard/accounts/opening-balances','PREFIX',ARRAY['/accounting/opening-balances'],810),
  ('accounts-uae-compliance','UAE Compliance','Accounts','UAE VAT and compliance profile.','/dashboard/accounts/uae-compliance','PREFIX',ARRAY['/uae-compliance'],820),
  ('accounts-consolidation','Group Consolidation','Accounts','Multi-entity consolidation.','/dashboard/accounts/consolidation','PREFIX',ARRAY['/accounting/consolidation'],830),
  ('accounts-supplier-invoices','Supplier Invoices','Accounts','Supplier invoice register and approval.','/dashboard/accounts/supplier-invoices','PREFIX',ARRAY['/accounting/supplier-invoices'],840),
  ('accounts-subcontract-payables','Subcontract Payables','Accounts','Subcontract supplier settlement.','/dashboard/accounts/subcontract-payables','PREFIX',ARRAY['/accounting/subcontract-payables'],850),
  ('accounts-payables','Accounts Payable','Accounts','Accounts-payable operations.','/dashboard/accounts/payables','PREFIX',ARRAY['/accounting/payables'],860),

  ('sales-overview','Sales','Sales','Sales operations and commercial documents.','/dashboard/sales','EXACT',ARRAY['/sales'],900),
  ('sales-logistics','Logistics Control','Sales','Transportation and delivery controls.','/dashboard/sales/logistics-control','PREFIX',ARRAY['/sales/logistics'],910),
  ('quality-overview','Quality Overview','Quality','Quality inspection workspace.','/dashboard/quality','EXACT',ARRAY['/quality'],1000),
  ('quality-capa','CAPA & Supplier Recovery','Quality','Corrective action and supplier recovery.','/dashboard/quality/capa','PREFIX',ARRAY['/quality/capa'],1010),
  ('quality-ehs','EHS & Sustainability','Quality','Safety and sustainability controls.','/dashboard/quality/ehs-sustainability','PREFIX',ARRAY['/quality/ehs'],1020),
  ('quality-cost','Cost of Quality','Quality','Quality cost and loss analysis.','/dashboard/quality/cost-of-quality','PREFIX',ARRAY['/quality/cost'],1030),
  ('service-overview','Service Management','Service','Service operations and entitlements.','/dashboard/service','PREFIX',ARRAY['/service'],1100),
  ('hr-self-service','Employee Self-Service','HR','Attendance, leave and employee self-service.','/dashboard/hr/employees','PREFIX',ARRAY['/hr/employees'],1200),
  ('hr-management','HR Management & Payroll','HR','HR management and payroll.','/dashboard/hr/management','PREFIX',ARRAY['/hr'],1210),
  ('hr-workforce-skills','Skills & Capacity Risk','HR','Workforce skills and capacity risk.','/dashboard/hr/workforce-skills','PREFIX',ARRAY['/hr/workforce-skills'],1220),
  ('documents-overview','Documents','Documents','Document management.','/dashboard/documents','PREFIX',ARRAY['/documents'],1300),

  ('settings-organization','Organization Settings','Settings','Organization and company setup.','/dashboard/settings/organization','EXACT',ARRAY['/tenant'],1400),
  ('settings-company-header','Company Header','Settings','Document branding and letterhead.','/dashboard/settings/company-header','EXACT',ARRAY['/tenant'],1410),
  ('settings-email-configuration','Email Configuration','Settings','Outbound email configuration.','/dashboard/settings/email-configuration','EXACT',ARRAY['/email'],1420),
  ('settings-automation','Automation & Communication','Settings','Governed workflow automations.','/dashboard/automation','PREFIX',ARRAY['/automation'],1430),
  ('settings-master-data-governance','Master Data Governance','Settings','Master-data approval controls.','/dashboard/settings/master-data-governance','PREFIX',ARRAY['/master-data-governance'],1440),
  ('settings-segregation-of-duties','Segregation of Duties','Settings','Finance duty-conflict review.','/dashboard/settings/segregation-of-duties','PREFIX',ARRAY['/accounting/segregation-of-duties'],1450),
  ('settings-integration-hub','Integration Hub','Settings','External integration management.','/dashboard/settings/integration-hub','PREFIX',ARRAY['/integration-hub'],1460),
  ('settings-whatsapp','WhatsApp Business','Settings','WhatsApp connection and governed messaging.','/dashboard/settings/whatsapp','EXACT',ARRAY['/whatsapp'],1470),
  ('settings-whatsapp-automation','WhatsApp Automation','Settings','WhatsApp automation rules.','/dashboard/settings/whatsapp/automation','PREFIX',ARRAY['/whatsapp/automation'],1480),
  ('audit-trails','Audit Trails','Settings','Application activity audit trail.','/dashboard/audit-trails','EXACT',ARRAY['/audit'],1490),
  ('continuous-controls','Continuous Controls','Settings','Continuous control monitoring.','/dashboard/audit-trails/continuous-controls','PREFIX',ARRAY['/enterprise-edge/continuous-controls'],1500)
ON CONFLICT (feature_key) DO UPDATE SET
  feature_name = EXCLUDED.feature_name,
  module_name = EXCLUDED.module_name,
  description = EXCLUDED.description,
  screen_route = EXCLUDED.screen_route,
  route_match = EXCLUDED.route_match,
  api_prefixes = EXCLUDED.api_prefixes,
  display_order = EXCLUDED.display_order,
  is_active = TRUE,
  updated_at = NOW();

-- Preserve every existing deployment exactly as-is on first installation.
INSERT INTO public.tenant_feature_entitlements (tenant_id, feature_key, is_enabled)
SELECT tenant.id, feature.feature_key, TRUE
FROM public.tenants tenant
CROSS JOIN public.app_feature_catalogue feature
WHERE feature.is_active = TRUE
ON CONFLICT (tenant_id, feature_key) DO NOTHING;

COMMENT ON TABLE public.app_feature_catalogue IS
  'Deployable application screen/feature catalogue shared by each independent customer installation.';
COMMENT ON TABLE public.tenant_feature_entitlements IS
  'Per-client feature availability. Role/user permissions are applied as a second, narrower access layer.';
