UPDATE public.tenants
SET
  name = CASE
    WHEN lower(name) LIKE '%qa%' OR lower(name) LIKE '%uat%' THEN 'Mizantra QA UAT'
    ELSE 'SAK Solutions'
  END,
  domain = CASE
    WHEN lower(coalesce(domain, '')) LIKE '%saif%' THEN 'mizantra.ae'
    ELSE domain
  END,
  subdomain = CASE
    WHEN lower(coalesce(subdomain, '')) LIKE '%saif%' THEN 'mizantra'
    ELSE subdomain
  END,
  settings = CASE
    WHEN lower(coalesce(settings::text, '')) LIKE '%saif%' THEN
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                replace(settings::text, 'saif.automations@gmail.com', 'info@mizantra.ae'),
                'saifautomations\.com', 'mizantra.ae', 'gi'
              ),
              'saifseas\.com', 'mizantra.ae', 'gi'
            ),
            'saif[[:space:]_-]+automations([[:space:]]+services[[:space:]]+llp)?', 'SAK Solutions', 'gi'
          ),
          'saif[[:space:]_-]*seas', 'SAK Solutions', 'gi'
        ),
        'saif[[:space:]_-]+erp', 'Mizantra ERP', 'gi'
      )::jsonb
    ELSE settings
  END,
  updated_at = now()
WHERE lower(coalesce(name, '')) LIKE '%saif%'
   OR lower(coalesce(domain, '')) LIKE '%saif%'
   OR lower(coalesce(subdomain, '')) LIKE '%saif%'
   OR lower(coalesce(settings::text, '')) LIKE '%saif%';
