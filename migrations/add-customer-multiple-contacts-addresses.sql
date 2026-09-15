ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS contacts JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS billing_addresses JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS shipping_addresses JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.customers
SET contacts = jsonb_build_array(
  jsonb_build_object(
    'name', COALESCE(contact_person, ''),
    'mobile', COALESCE(mobile, phone, ''),
    'email', COALESCE(email, '')
  )
)
WHERE contacts = '[]'::jsonb
  AND (NULLIF(contact_person, '') IS NOT NULL
    OR NULLIF(mobile, '') IS NOT NULL
    OR NULLIF(phone, '') IS NOT NULL
    OR NULLIF(email, '') IS NOT NULL);

UPDATE public.customers
SET billing_addresses = jsonb_build_array(billing_address)
WHERE billing_addresses = '[]'::jsonb
  AND NULLIF(billing_address, '') IS NOT NULL;

UPDATE public.customers
SET shipping_addresses = jsonb_build_array(shipping_address)
WHERE shipping_addresses = '[]'::jsonb
  AND NULLIF(shipping_address, '') IS NOT NULL;

COMMENT ON COLUMN public.customers.contacts IS 'Repeatable customer contacts: name, mobile and email. Legacy scalar fields contain the primary contact.';
COMMENT ON COLUMN public.customers.billing_addresses IS 'Repeatable billing addresses. Legacy billing_address contains the primary address.';
COMMENT ON COLUMN public.customers.shipping_addresses IS 'Repeatable shipping addresses. Legacy shipping_address contains the primary address.';
