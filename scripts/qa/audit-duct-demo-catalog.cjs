const path = require("path");
const { Client } = require("pg");
const dotenv = require("dotenv");

const envPath = process.argv[2] || "apps/api/.env";
dotenv.config({ path: path.resolve(envPath), quiet: true });
const rawUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!rawUrl) throw new Error("DIRECT_URL or DATABASE_URL is required");
const url = new URL(rawUrl);
if (url.hostname !== "db.nwkaruzvzwwuftjquypk.supabase.co") {
  throw new Error(`Refusing non-Mizantra database: ${url.hostname}`);
}
["sslmode", "sslrootcert", "sslcert", "sslkey"].forEach((key) =>
  url.searchParams.delete(key),
);

async function main() {
  const client = new Client({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const [items, boms, components, routes, stations, enums, sampleSiv] = await Promise.all([
      client.query(`SELECT tenant_id, id, code, name, type::text, item_type, uom,
          is_active, is_verified, approval_status, standard_cost, metadata
        FROM public.items
        WHERE metadata->>'demoPack'='AC_DUCT_DEMO_V1'
        ORDER BY code`),
      client.query(`SELECT bh.id AS bom_id, bh.tenant_id, i.code, i.name,
          bh.version, bh.is_active, bh.lifecycle_status, bh.output_quantity, bh.output_uom,
          COUNT(DISTINCT bi.id)::int AS components,
          COUNT(DISTINCT br.id)::int AS routes
        FROM public.bom_headers bh
        JOIN public.items i ON i.id=bh.item_id
        LEFT JOIN public.bom_items bi ON bi.bom_id=bh.id
        LEFT JOIN public.bom_routing br ON br.bom_id=bh.id
        WHERE bh.source_pack_code='AC_DUCT_DEMO_V1'
        GROUP BY bh.id, i.code, i.name
        ORDER BY i.code, bh.version`),
      client.query(`SELECT bi.bom_id, parent.code AS parent_code, component.code AS component_code,
          component.name AS component_name, bi.quantity, bi.scrap_percentage,
          bi.consumption_uom, bi.issue_method, bi.sequence
        FROM public.bom_items bi
        JOIN public.bom_headers bh ON bh.id=bi.bom_id
        JOIN public.items parent ON parent.id=bh.item_id
        LEFT JOIN public.items component ON component.id=bi.item_id
        WHERE bh.source_pack_code='AC_DUCT_DEMO_V1'
        ORDER BY parent.code, bi.sequence`),
      client.query(`SELECT br.bom_id, parent.code AS parent_code, br.id, br.operation_sequence,
          br.operation_name, ws.station_code, ws.station_name, br.cycle_time, br.setup_time
        FROM public.bom_routing br
        JOIN public.bom_headers bh ON bh.id=br.bom_id
        JOIN public.items parent ON parent.id=bh.item_id
        LEFT JOIN public.work_stations ws ON ws.id=br.workstation_id
        WHERE bh.source_pack_code='AC_DUCT_DEMO_V1'
        ORDER BY parent.code, br.operation_sequence`),
      client.query(`SELECT tenant_id, id, station_code, station_name, station_type, capacity_per_hour, is_active
        FROM public.work_stations
        WHERE lower(coalesce(station_name,'')) ~ 'cut|form|bend|assembly|insul|seal|quality|pack'
        AND station_code NOT LIKE 'QA-S3-%'
        ORDER BY station_code`),
      client.query(`SELECT t.typname, e.enumlabel
        FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
        WHERE t.typname IN ('item_type','inventory_category')
        ORDER BY t.typname, e.enumsortorder`),
      client.query(`SELECT component.code, component.name,
          CASE WHEN bi.rounding_rule='UP'
            THEN ceil(bi.quantity * 10 * (1 + coalesce(bi.scrap_percentage,0) / 100))
            ELSE round(bi.quantity * 10 * (1 + coalesce(bi.scrap_percentage,0) / 100), 3)
          END AS required_for_10,
          coalesce(bi.consumption_uom, component.uom) AS uom
        FROM public.bom_headers bh
        JOIN public.items parent ON parent.id=bh.item_id
        JOIN public.bom_items bi ON bi.bom_id=bh.id
        JOIN public.items component ON component.id=bi.item_id
        WHERE parent.code='700-0104' AND bh.version=1 AND bh.is_active=true
        ORDER BY bi.sequence`),
    ]);
    const productRows = boms.rows;
    const invalidProducts = productRows.filter((row) =>
      row.lifecycle_status !== "APPROVED" || row.is_active !== true ||
      Number(row.components) < 5 || Number(row.routes) < 8
    );
    if (productRows.length !== 6 || invalidProducts.length > 0) {
      throw new Error(`Duct catalogue incomplete: ${JSON.stringify({
        products: productRows.length,
        invalidProducts: invalidProducts.map((row) => row.code),
      })}`);
    }
    console.log(JSON.stringify({
      database: url.hostname,
      summary: {
        demoItems: items.rows.length,
        products: productRows.length,
        components: components.rows.length,
        routes: routes.rows.length,
      },
      items: items.rows,
      boms: boms.rows,
      components: components.rows,
      routes: routes.rows,
      stations: stations.rows,
      enums: enums.rows,
      sampleSivFor10TeeFittings: sampleSiv.rows,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
