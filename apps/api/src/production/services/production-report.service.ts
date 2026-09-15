import { BadRequestException, Injectable } from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type Period = "daily" | "weekly" | "monthly";
type Metric = {
  period: string;
  key: string;
  code: string;
  name: string;
  good_quantity: number;
  rejected_quantity: number;
  run_minutes: number;
  downtime_minutes: number;
  operations: number;
};

@Injectable()
export class ProductionReportService {
  private readonly db: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );

  private number(value: unknown) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private bucket(value: string, period: Period) {
    const date = new Date(value);
    if (period === "monthly") return date.toISOString().slice(0, 7);
    if (period === "weekly") {
      const day = date.getUTCDay() || 7;
      date.setUTCDate(date.getUTCDate() - day + 1);
      return date.toISOString().slice(0, 10);
    }
    return date.toISOString().slice(0, 10);
  }

  private add(
    map: Map<string, Metric>,
    period: string,
    dimension: { key: string; code: string; name: string },
    values: Partial<Metric>,
  ) {
    const mapKey = `${period}|${dimension.key}`;
    const current = map.get(mapKey) || {
      period,
      ...dimension,
      good_quantity: 0,
      rejected_quantity: 0,
      run_minutes: 0,
      downtime_minutes: 0,
      operations: 0,
    };
    current.good_quantity += this.number(values.good_quantity);
    current.rejected_quantity += this.number(values.rejected_quantity);
    current.run_minutes += this.number(values.run_minutes);
    current.downtime_minutes += this.number(values.downtime_minutes);
    current.operations += this.number(values.operations);
    map.set(mapKey, current);
  }

  private finish(map: Map<string, Metric>) {
    return [...map.values()]
      .map((row) => {
        const processed = row.good_quantity + row.rejected_quantity;
        const elapsed = row.run_minutes + row.downtime_minutes;
        return {
          ...row,
          processed_quantity: processed,
          rejection_pct: processed
            ? (row.rejected_quantity / processed) * 100
            : 0,
          units_per_hour: row.run_minutes
            ? (row.good_quantity / row.run_minutes) * 60
            : 0,
          availability_pct: elapsed ? (row.run_minutes / elapsed) * 100 : 0,
        };
      })
      .sort(
        (a, b) =>
          b.period.localeCompare(a.period) || a.code.localeCompare(b.code),
      );
  }

  async report(tenantId: string, query: any) {
    const period = String(query.period || "daily").toLowerCase() as Period;
    if (!["daily", "weekly", "monthly"].includes(period))
      throw new BadRequestException("Period must be daily, weekly or monthly");
    const today = new Date().toISOString().slice(0, 10);
    const defaultDays = period === "monthly" ? 365 : 31;
    const from = String(
      query.from ||
        new Date(Date.now() - defaultDays * 86400000)
          .toISOString()
          .slice(0, 10),
    ).slice(0, 10);
    const to = String(query.to || today).slice(0, 10);
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T00:00:00.000Z`);
    if (
      !Number.isFinite(fromDate.getTime()) ||
      !Number.isFinite(toDate.getTime()) ||
      toDate < fromDate
    )
      throw new BadRequestException("Select a valid report date range");
    if ((toDate.getTime() - fromDate.getTime()) / 86400000 > 730)
      throw new BadRequestException(
        "Production reports are limited to a two-year range",
      );
    const endExclusive = new Date(toDate.getTime() + 86400000).toISOString();

    const { data: completions, error: completionError } = await this.db
      .from("station_completions")
      .select(
        "id,production_order_id,routing_id,work_station_id,quantity_completed,quantity_rejected,start_time,end_time,actual_time_minutes,status",
      )
      .eq("tenant_id", tenantId)
      .eq("status", "COMPLETED")
      .gte("start_time", fromDate.toISOString())
      .lt("start_time", endExclusive)
      .order("start_time", { ascending: false });
    if (completionError) throw new BadRequestException(completionError.message);

    const { data: downtime, error: downtimeError } = await this.db
      .from("manufacturing_downtime_events")
      .select(
        "id,production_order_id,routing_id,work_station_id,loss_category,downtime_minutes,source,started_at,created_at",
      )
      .eq("tenant_id", tenantId)
      .gte("created_at", fromDate.toISOString())
      .lt("created_at", endExclusive);
    if (downtimeError) throw new BadRequestException(downtimeError.message);

    const executionRows = [...(completions || []), ...(downtime || [])];

    const orderIds = [
      ...new Set(
        executionRows.map((x: any) => x.production_order_id).filter(Boolean),
      ),
    ];
    const routingIds = [
      ...new Set(executionRows.map((x: any) => x.routing_id).filter(Boolean)),
    ];
    const stationIds = [
      ...new Set(
        executionRows.map((x: any) => x.work_station_id).filter(Boolean),
      ),
    ];
    const [orderResult, routingResult, stationResult] = await Promise.all([
      orderIds.length
        ? this.db
            .from("production_orders")
            .select("id,order_number,item_id")
            .eq("tenant_id", tenantId)
            .in("id", orderIds)
        : Promise.resolve({ data: [] } as any),
      routingIds.length
        ? this.db
            .from("production_routing")
            .select("id,operation_name,sequence_no")
            .eq("tenant_id", tenantId)
            .in("id", routingIds)
        : Promise.resolve({ data: [] } as any),
      stationIds.length
        ? this.db
            .from("work_stations")
            .select("id,station_code,station_name")
            .eq("tenant_id", tenantId)
            .in("id", stationIds)
        : Promise.resolve({ data: [] } as any),
    ]);
    if (orderResult.error)
      throw new BadRequestException(orderResult.error.message);
    if (routingResult.error)
      throw new BadRequestException(routingResult.error.message);
    if (stationResult.error)
      throw new BadRequestException(stationResult.error.message);
    const orders = orderResult.data;
    const routings = routingResult.data;
    const stations = stationResult.data;
    const itemIds = [
      ...new Set((orders || []).map((x: any) => x.item_id).filter(Boolean)),
    ];
    const itemResult = itemIds.length
      ? await this.db
          .from("items")
          .select("id,code,name,uom")
          .eq("tenant_id", tenantId)
          .in("id", itemIds)
      : ({ data: [] } as any);
    if (itemResult.error)
      throw new BadRequestException(itemResult.error.message);
    const items = itemResult.data;
    const orderMap = new Map((orders || []).map((x: any) => [String(x.id), x]));
    const itemMap = new Map((items || []).map((x: any) => [String(x.id), x]));
    const routingMap = new Map(
      (routings || []).map((x: any) => [String(x.id), x]),
    );
    const stationMap = new Map(
      (stations || []).map((x: any) => [String(x.id), x]),
    );
    const byProduct = new Map<string, Metric>();
    const byMachine = new Map<string, Metric>();
    const byProcess = new Map<string, Metric>();

    for (const row of completions || []) {
      const bucket = this.bucket(row.start_time, period);
      const order: any = orderMap.get(String(row.production_order_id));
      const item: any = itemMap.get(String(order?.item_id));
      const routing: any = routingMap.get(String(row.routing_id));
      const station: any = stationMap.get(String(row.work_station_id));
      const values = {
        good_quantity: row.quantity_completed,
        rejected_quantity: row.quantity_rejected,
        run_minutes: row.actual_time_minutes,
        operations: 1,
      };
      this.add(
        byProduct,
        bucket,
        {
          key: String(item?.id || "UNASSIGNED"),
          code: item?.code || "UNASSIGNED",
          name: item?.name || "Unassigned product",
        },
        values,
      );
      this.add(
        byMachine,
        bucket,
        {
          key: String(station?.id || "UNASSIGNED"),
          code: station?.station_code || "UNASSIGNED",
          name: station?.station_name || "Unassigned machine",
        },
        values,
      );
      this.add(
        byProcess,
        bucket,
        {
          key: String(routing?.id || "UNASSIGNED"),
          code: routing ? `OP-${routing.sequence_no}` : "UNASSIGNED",
          name: routing?.operation_name || "Unassigned process",
        },
        values,
      );
    }
    for (const row of downtime || []) {
      const bucket = this.bucket(row.started_at || row.created_at, period);
      const order: any = orderMap.get(String(row.production_order_id));
      const item: any = itemMap.get(String(order?.item_id));
      const routing: any = routingMap.get(String(row.routing_id));
      const station: any = stationMap.get(String(row.work_station_id));
      const values = { downtime_minutes: row.downtime_minutes };
      this.add(
        byProduct,
        bucket,
        {
          key: String(item?.id || "UNASSIGNED"),
          code: item?.code || "UNASSIGNED",
          name: item?.name || "Unassigned product",
        },
        values,
      );
      this.add(
        byMachine,
        bucket,
        {
          key: String(station?.id || "UNASSIGNED"),
          code: station?.station_code || "UNASSIGNED",
          name: station?.station_name || "Unassigned machine",
        },
        values,
      );
      this.add(
        byProcess,
        bucket,
        {
          key: String(routing?.id || "UNASSIGNED"),
          code: routing ? `OP-${routing.sequence_no}` : "UNASSIGNED",
          name: routing?.operation_name || "Unassigned process",
        },
        values,
      );
    }

    const product = this.finish(byProduct);
    const machine = this.finish(byMachine);
    const process = this.finish(byProcess);
    const totals = product.reduce(
      (sum, row) => ({
        good_quantity: sum.good_quantity + row.good_quantity,
        rejected_quantity: sum.rejected_quantity + row.rejected_quantity,
        run_minutes: sum.run_minutes + row.run_minutes,
        downtime_minutes: sum.downtime_minutes + row.downtime_minutes,
      }),
      {
        good_quantity: 0,
        rejected_quantity: 0,
        run_minutes: 0,
        downtime_minutes: 0,
      },
    );
    return {
      period,
      from,
      to,
      totals,
      by_product: product,
      by_machine: machine,
      by_process: process,
    };
  }
}
