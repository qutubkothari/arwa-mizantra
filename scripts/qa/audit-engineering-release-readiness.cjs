const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

dotenv.config({ path: path.resolve(process.cwd(), process.argv[2] || 'apps/api/.env') });
const raw = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!raw) throw new Error('Missing database connection');
const url = new URL(raw);
['sslmode', 'sslrootcert', 'sslcert', 'sslkey'].forEach((key) => url.searchParams.delete(key));
const pool = new Pool({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });

(async () => {
  const drawing = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM public.production_job_orders jo
    JOIN public.items i ON i.tenant_id=jo.tenant_id AND i.id=jo.item_id
    WHERE UPPER(COALESCE(jo.status::text,'DRAFT')) IN ('DRAFT','SCHEDULED','IN_PROGRESS','STORE_ISSUED')
      AND UPPER(COALESCE(i.drawing_required,'OPTIONAL'))='COMPULSORY'
      AND NOT EXISTS (
        SELECT 1 FROM public.item_drawings d
        WHERE d.tenant_id=jo.tenant_id AND d.item_id=jo.item_id
          AND d.lifecycle_status='APPROVED' AND d.is_active=TRUE
          AND d.effective_from <= CURRENT_DATE
          AND (d.effective_to IS NULL OR d.effective_to >= CURRENT_DATE)
      )`);
  const bom = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM public.production_job_orders jo
    LEFT JOIN public.bom_headers b ON b.tenant_id=jo.tenant_id AND b.id=jo.bom_id
    WHERE UPPER(COALESCE(jo.status::text,'DRAFT')) IN ('DRAFT','SCHEDULED','IN_PROGRESS','STORE_ISSUED')
      AND jo.bom_id IS NOT NULL
      AND (b.id IS NULL OR COALESCE(b.lifecycle_status,'') <> 'APPROVED'
        OR (b.effective_from IS NOT NULL AND b.effective_from > CURRENT_DATE)
        OR (b.effective_to IS NOT NULL AND b.effective_to < CURRENT_DATE))`);
  const statuses = await pool.query(`
    SELECT UPPER(COALESCE(status::text,'DRAFT')) AS status, COUNT(*)::int AS count
    FROM public.production_job_orders
    WHERE UPPER(COALESCE(status::text,'DRAFT')) IN ('DRAFT','SCHEDULED','IN_PROGRESS','STORE_ISSUED')
    GROUP BY 1 ORDER BY 1`);
  console.log(JSON.stringify({
    open_jobs_without_required_drawing: drawing.rows[0].count,
    open_jobs_with_unreleased_bom: bom.rows[0].count,
    open_job_statuses: statuses.rows,
  }));
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => pool.end());
