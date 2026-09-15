const fs = require("fs");
const { Client } = require("pg");
require("dotenv").config({ path: "/var/www/sak-erp-test/apps/api/.env" });

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  if (url.hostname !== "db.nwkaruzvzwwuftjquypk.supabase.co") {
    throw new Error(`Refusing non-Mizantra database host: ${url.hostname}`);
  }
  url.searchParams.set("sslmode", "no-verify");
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      fs.readFileSync(
        "/tmp/mizantra-business-transformation-20260830/migrations/add-business-transformation-control.sql",
        "utf8",
      ),
    );
    const result = await client.query(`SELECT
      (SELECT COUNT(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('transformation_objectives','transformation_kpi_definitions','transformation_kpi_snapshots','transformation_actions')) AS control_tables,
      (SELECT COUNT(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='value_realization_initiatives' AND column_name IN ('transformation_objective_id','primary_kpi_id','target_metric_value','expected_direction')) AS initiative_link_columns,
      (SELECT COUNT(*)::int FROM public.app_feature_catalogue WHERE feature_key='business-transformation' AND is_active=TRUE) AS feature_rows,
      (SELECT COUNT(*)::int FROM public.tenant_feature_entitlements entitlement WHERE entitlement.feature_key='business-transformation' AND entitlement.is_enabled=TRUE) AS enabled_tenants`);
    const row = result.rows[0];
    if (
      row.control_tables !== 4 ||
      row.initiative_link_columns !== 4 ||
      row.feature_rows !== 1 ||
      row.enabled_tenants < 1
    ) {
      throw new Error(
        `Business Transformation schema verification failed: ${JSON.stringify(row)}`,
      );
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({ database_host: url.hostname, ...row }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
