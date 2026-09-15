-- Controlled service-contract renewal chain.
-- A renewal is a new DRAFT contract; the source contract remains immutable for audit.

ALTER TABLE public.service_contracts
  ADD COLUMN IF NOT EXISTS renewed_from_contract_id UUID
    REFERENCES public.service_contracts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS renewal_sequence INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_service_contracts_renewed_from
  ON public.service_contracts(tenant_id, renewed_from_contract_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_contracts_open_renewal
  ON public.service_contracts(tenant_id, renewed_from_contract_id)
  WHERE renewed_from_contract_id IS NOT NULL AND status <> 'CANCELLED';

COMMENT ON COLUMN public.service_contracts.renewed_from_contract_id IS
  'Prior contract in the controlled renewal/revision chain.';
