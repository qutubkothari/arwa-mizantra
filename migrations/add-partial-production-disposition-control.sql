-- Controlled disposition of a production run completed below its planned quantity.
-- This records the operator decision and a Stores-facing return request without
-- changing physical inventory. Stores remains responsible for the stock posting.

alter table public.production_orders
  add column if not exists closed_short_quantity numeric(18,4),
  add column if not exists closed_short_reason text,
  add column if not exists closed_short_at timestamptz,
  add column if not exists closed_short_by uuid;

create table if not exists public.production_partial_dispositions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  production_order_id uuid not null references public.production_orders(id) on delete cascade,
  station_completion_id uuid references public.station_completions(id) on delete set null,
  routing_id uuid references public.production_routing(id) on delete set null,
  planned_quantity numeric(18,4) not null,
  good_quantity numeric(18,4) not null default 0,
  rejected_quantity numeric(18,4) not null default 0,
  remaining_quantity numeric(18,4) not null default 0,
  decision varchar(32) not null default 'PENDING'
    check (decision in ('PENDING','CONTINUE_NOW','NEXT_SHIFT','NEXT_DAY','CLOSE_SHORT','RETURN_TO_STORE')),
  scheduled_date date,
  reason text,
  material_reconciliation jsonb not null default '[]'::jsonb,
  actual_evidence jsonb not null default '{}'::jsonb,
  status varchar(32) not null default 'PENDING'
    check (status in ('PENDING','PLANNED','RETURN_REQUESTED','CLOSED','RESOLVED')),
  created_by uuid,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_production_partial_disposition_completion
  on public.production_partial_dispositions(tenant_id, station_completion_id);
create index if not exists ix_production_partial_disposition_order
  on public.production_partial_dispositions(tenant_id, production_order_id, created_at desc);

create table if not exists public.production_material_return_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  disposition_id uuid not null references public.production_partial_dispositions(id) on delete cascade,
  production_order_id uuid not null references public.production_orders(id) on delete cascade,
  request_number varchar(64) not null,
  status varchar(40) not null default 'PENDING_STORE_CONFIRMATION'
    check (status in ('PENDING_STORE_CONFIRMATION','CONFIRMED','CANCELLED')),
  suggested_lines jsonb not null default '[]'::jsonb,
  requested_by uuid,
  requested_at timestamptz not null default now(),
  confirmed_by uuid,
  confirmed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, disposition_id),
  unique (tenant_id, request_number)
);

create index if not exists ix_production_material_return_request_status
  on public.production_material_return_requests(tenant_id, status, requested_at desc);
