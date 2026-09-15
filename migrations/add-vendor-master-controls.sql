-- SAP-style vendor master controls: maker-checker, approval history, attachments, and bank verification.

alter table public.vendors
  add column if not exists created_by uuid,
  add column if not exists approval_status varchar(30) default 'PENDING',
  add column if not exists approval_reason text,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by uuid,
  add column if not exists bank_verified_at timestamptz,
  add column if not exists bank_verified_by uuid,
  add column if not exists bank_verification_status varchar(30) default 'PENDING';

update public.vendors
set approval_status = case when coalesce(is_verified, false) then 'APPROVED' else coalesce(approval_status, 'PENDING') end,
    approved_at = case when coalesce(is_verified, false) then coalesce(approved_at, verified_at) else approved_at end,
    approved_by = case when coalesce(is_verified, false) then coalesce(approved_by, verified_by) else approved_by end
where approval_status is null
   or (coalesce(is_verified, false) and approval_status <> 'APPROVED');

create table if not exists public.vendor_approval_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  action varchar(40) not null,
  from_status varchar(30),
  to_status varchar(30),
  reason text,
  metadata jsonb default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_vendor_approval_history_vendor
  on public.vendor_approval_history(tenant_id, vendor_id, created_at desc);

create table if not exists public.vendor_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  document_type varchar(40) not null,
  file_name text not null,
  file_url text not null,
  mime_type text,
  file_size bigint,
  uploaded_by uuid,
  uploaded_at timestamptz not null default now(),
  verified_at timestamptz,
  verified_by uuid,
  status varchar(30) not null default 'UPLOADED',
  metadata jsonb default '{}'::jsonb
);

create index if not exists idx_vendor_attachments_vendor
  on public.vendor_attachments(tenant_id, vendor_id, document_type);

comment on table public.vendor_approval_history is 'Audit trail for vendor master approval, rejection, edit reapproval, and bank verification.';
comment on table public.vendor_attachments is 'Vendor onboarding document checklist files such as GST, PAN, MSME, cancelled cheque.';
