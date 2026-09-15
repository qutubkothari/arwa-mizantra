-- Mizantra 2.0 completion controls: governed native actions, durable AI telemetry,
-- onboarding exception staging, operational knowledge graph and connector inbox.

create table if not exists public.mizantra_governed_action_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  insight_id text not null,
  insight_title text,
  tool_code text not null,
  risk text not null check (risk in ('LOW','MEDIUM','HIGH')),
  effect text not null check (effect in ('TASK_ONLY','NATIVE_DRAFT','NATIVE_TRANSACTION')),
  required_permission text,
  input_payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  status text not null default 'PENDING_APPROVAL' check (status in ('PENDING_APPROVAL','APPROVED','REJECTED','EXECUTING','EXECUTED','FAILED')),
  created_by uuid not null,
  approved_by uuid,
  approved_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  rejection_reason text,
  executed_by uuid,
  execution_started_at timestamptz,
  executed_at timestamptz,
  native_resource_type text,
  native_resource_id uuid,
  native_result jsonb,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);
create index if not exists idx_mizantra_action_requests_queue on public.mizantra_governed_action_requests(tenant_id,status,created_at desc);

create table if not exists public.mizantra_ai_call_metrics (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  capability text not null,
  provider text not null,
  model text,
  fallback_used boolean not null default false,
  cache_hit boolean not null default false,
  latency_ms integer not null default 0 check (latency_ms >= 0),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  total_tokens integer not null default 0 check (total_tokens >= 0),
  failure_reason text,
  created_at timestamptz not null default now()
);
create index if not exists idx_mizantra_ai_metrics_window on public.mizantra_ai_call_metrics(tenant_id,created_at desc);

create table if not exists public.mizantra_onboarding_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  dataset_type text not null check (dataset_type in ('CUSTOMERS','SUPPLIERS','ITEMS','BOMS','OPENING_BALANCES','INVENTORY','CHART_OF_ACCOUNTS','PURCHASE_HISTORY','SALES_HISTORY')),
  source_name text,
  status text not null default 'ANALYSED' check (status in ('ANALYSED','REVIEW_REQUIRED','APPROVED','APPLIED','REJECTED')),
  inferred_mapping jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  created_by uuid not null,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.mizantra_onboarding_rows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  batch_id uuid not null references public.mizantra_onboarding_batches(id) on delete cascade,
  row_number integer not null check (row_number > 0),
  source_data jsonb not null,
  normalized_data jsonb not null default '{}'::jsonb,
  disposition text not null check (disposition in ('AUTO_ACCEPTED','REVIEW_REQUIRED','REJECTED','APPLIED')),
  issues jsonb not null default '[]'::jsonb,
  duplicate_key text,
  created_at timestamptz not null default now(),
  unique (batch_id,row_number)
);
create index if not exists idx_mizantra_onboarding_review on public.mizantra_onboarding_rows(tenant_id,batch_id,disposition);

create table if not exists public.mizantra_knowledge_nodes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  node_key text not null,
  node_type text not null,
  label text not null,
  source_table text,
  source_id text,
  route text,
  attributes jsonb not null default '{}'::jsonb,
  last_observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,node_key)
);
create table if not exists public.mizantra_knowledge_edges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  edge_key text not null,
  from_node_key text not null,
  to_node_key text not null,
  relationship_type text not null,
  confidence text not null default 'HIGH' check (confidence in ('LOW','MEDIUM','HIGH')),
  evidence jsonb not null default '{}'::jsonb,
  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,edge_key)
);
create index if not exists idx_mizantra_knowledge_edges_from on public.mizantra_knowledge_edges(tenant_id,from_node_key);
create index if not exists idx_mizantra_knowledge_edges_to on public.mizantra_knowledge_edges(tenant_id,to_node_key);

create table if not exists public.mizantra_connector_inbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  gateway_id uuid not null,
  source_event_id text not null,
  event_type text not null,
  occurred_at timestamptz not null,
  payload_hash text not null,
  normalized_event jsonb not null,
  transaction_intent text,
  status text not null default 'RECEIVED' check (status in ('RECEIVED','VALIDATED','DUPLICATE','REVIEW_REQUIRED','PROCESSED','REJECTED','FAILED')),
  native_resource_type text,
  native_resource_id uuid,
  failure_reason text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (tenant_id,gateway_id,source_event_id)
);
create index if not exists idx_mizantra_connector_inbox_queue on public.mizantra_connector_inbox(tenant_id,status,received_at);

create table if not exists public.mizantra_agent_policies (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  policy_name text not null, agent_type text not null check (agent_type in ('OPERATIONS','COLLECTIONS','SUPPLIER','CUSTOMER')),
  mode text not null default 'PROPOSE_ONLY' check (mode in ('PROPOSE_ONLY')),
  allowed_tool_codes jsonb not null default '[]'::jsonb, maximum_proposals integer not null default 5 check (maximum_proposals between 1 and 20),
  status text not null default 'DRAFT' check (status in ('DRAFT','APPROVED','PAUSED','REJECTED')),
  created_by uuid not null, approved_by uuid, approved_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.mizantra_agent_runs (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  policy_id uuid not null references public.mizantra_agent_policies(id) on delete cascade, status text not null check (status in ('RUNNING','COMPLETED','FAILED')),
  evidence_snapshot jsonb not null default '{}'::jsonb, proposal_count integer not null default 0, failure_reason text,
  started_by uuid not null, started_at timestamptz not null default now(), completed_at timestamptz
);
create table if not exists public.mizantra_agent_proposals (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null references public.mizantra_agent_runs(id) on delete cascade, insight_id text not null, tool_code text not null,
  title text not null, rationale text not null, evidence jsonb not null default '{}'::jsonb,
  status text not null default 'WAITING_HUMAN' check (status in ('WAITING_HUMAN','ACCEPTED','REJECTED')),
  external_delivery_performed boolean not null default false, created_at timestamptz not null default now()
);

alter table public.production_device_gateways add column if not exists public_key_id text;
alter table public.production_device_gateways add column if not exists api_key_hash text;
create unique index if not exists idx_production_gateway_public_key on public.production_device_gateways(public_key_id) where public_key_id is not null;

alter table public.mizantra_governed_action_requests enable row level security;
alter table public.mizantra_ai_call_metrics enable row level security;
alter table public.mizantra_onboarding_batches enable row level security;
alter table public.mizantra_onboarding_rows enable row level security;
alter table public.mizantra_knowledge_nodes enable row level security;
alter table public.mizantra_knowledge_edges enable row level security;
alter table public.mizantra_connector_inbox enable row level security;
alter table public.mizantra_agent_policies enable row level security;
alter table public.mizantra_agent_runs enable row level security;
alter table public.mizantra_agent_proposals enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array['mizantra_governed_action_requests','mizantra_ai_call_metrics','mizantra_onboarding_batches','mizantra_onboarding_rows','mizantra_knowledge_nodes','mizantra_knowledge_edges','mizantra_connector_inbox','mizantra_agent_policies','mizantra_agent_runs','mizantra_agent_proposals']
  loop
    execute format('drop policy if exists tenant_isolation on public.%I', table_name);
    execute format('create policy tenant_isolation on public.%I using (tenant_id::text = auth.jwt()->>''tenant_id'') with check (tenant_id::text = auth.jwt()->>''tenant_id'')', table_name);
  end loop;
end $$;
