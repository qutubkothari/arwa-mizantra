-- Shared project-manufacturing foundation.
-- Keeps industry-specific terms in JSON metadata while providing one controlled
-- project -> work package -> item-demand chain for planning and execution.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS site_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS site_address TEXT,
  ADD COLUMN IF NOT EXISTS committed_delivery_date DATE,
  ADD COLUMN IF NOT EXISTS project_type VARCHAR(40) NOT NULL DEFAULT 'MANUFACTURING',
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.project_work_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  package_code VARCHAR(80) NOT NULL,
  package_name VARCHAR(255) NOT NULL,
  package_type VARCHAR(60) NOT NULL DEFAULT 'MANUFACTURING',
  location_name VARCHAR(255),
  required_date DATE,
  priority INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 1 AND 100),
  status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','READY','RELEASED','IN_PROGRESS','COMPLETED','ON_HOLD','CANCELLED')),
  owner_user_id UUID,
  notes TEXT,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, project_id, package_code)
);

CREATE TABLE IF NOT EXISTS public.project_work_package_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  work_package_id UUID NOT NULL REFERENCES public.project_work_packages(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  item_code VARCHAR(120),
  item_name TEXT,
  quantity NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  uom VARCHAR(30) NOT NULL,
  required_date DATE,
  demand_status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
    CHECK (demand_status IN ('DRAFT','READY','RELEASED','PLANNED','IN_PRODUCTION','COMPLETED','CANCELLED')),
  specification_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_reference VARCHAR(160),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, work_package_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_projects_customer_delivery
  ON public.projects (tenant_id, customer_id, committed_delivery_date);
CREATE INDEX IF NOT EXISTS idx_project_work_packages_project
  ON public.project_work_packages (tenant_id, project_id, status, required_date);
CREATE INDEX IF NOT EXISTS idx_project_work_package_lines_package
  ON public.project_work_package_lines (tenant_id, work_package_id, demand_status, required_date);
CREATE INDEX IF NOT EXISTS idx_project_work_package_lines_item
  ON public.project_work_package_lines (tenant_id, item_id, demand_status);

ALTER TABLE public.production_programs
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS work_package_id UUID REFERENCES public.project_work_packages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS work_package_line_id UUID REFERENCES public.project_work_package_lines(id) ON DELETE SET NULL;

ALTER TABLE public.production_job_orders
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS work_package_id UUID REFERENCES public.project_work_packages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS work_package_line_id UUID REFERENCES public.project_work_package_lines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_production_programs_project_demand
  ON public.production_programs (tenant_id, project_id, work_package_id, work_package_line_id);
CREATE INDEX IF NOT EXISTS idx_production_job_orders_project_demand
  ON public.production_job_orders (tenant_id, project_id, work_package_id, work_package_line_id);

NOTIFY pgrst, 'reload schema';
