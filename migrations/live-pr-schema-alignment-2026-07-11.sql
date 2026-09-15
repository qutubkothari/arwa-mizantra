ALTER TABLE public.purchase_requisitions
  ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'MEDIUM',
  ADD COLUMN IF NOT EXISTS delivery_address TEXT,
  ADD COLUMN IF NOT EXISTS project_id UUID,
  ADD COLUMN IF NOT EXISTS project_name VARCHAR(255);

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS project_id UUID,
  ADD COLUMN IF NOT EXISTS project_name VARCHAR(255);

ALTER TABLE public.grns
  ADD COLUMN IF NOT EXISTS project_id UUID,
  ADD COLUMN IF NOT EXISTS project_name VARCHAR(255);

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS project_id UUID,
  ADD COLUMN IF NOT EXISTS project_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS is_rnd_item BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_pr_project ON public.purchase_requisitions(tenant_id, project_id);

ALTER TABLE public.purchase_requisition_items
  ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES public.items(id);

CREATE INDEX IF NOT EXISTS idx_pr_items_item_id ON public.purchase_requisition_items(item_id);

NOTIFY pgrst, 'reload schema';
