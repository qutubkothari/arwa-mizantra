-- SAP-style material master controls: maker-checker and approval history.

alter table public.items
  add column if not exists created_by uuid,
  add column if not exists approval_status varchar(30) default 'PENDING',
  add column if not exists approval_reason text,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid;

update public.items
set approval_status = case when coalesce(is_verified, false) then 'APPROVED' else coalesce(approval_status, 'PENDING') end,
    approved_at = case when coalesce(is_verified, false) then coalesce(approved_at, verified_at) else approved_at end,
    approved_by = case when coalesce(is_verified, false) then coalesce(approved_by, verified_by) else approved_by end
where approval_status is null
   or (coalesce(is_verified, false) and approval_status <> 'APPROVED');

create table if not exists public.item_approval_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  item_id uuid not null references public.items(id) on delete cascade,
  action varchar(50) not null,
  from_status varchar(30),
  to_status varchar(30),
  reason text,
  metadata jsonb default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_item_approval_history_item
  on public.item_approval_history(tenant_id, item_id, created_at desc);

comment on table public.item_approval_history is 'Audit trail for material master creation, verification, edit reapproval, and status reset.';
