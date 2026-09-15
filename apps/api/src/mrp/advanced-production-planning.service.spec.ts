import {
  allocateCapacityBackward,
  buildExecutionVarianceSnapshot,
  buildProductionTransformationQueue,
  buildDailyCapacityCalendar,
  projectCapacityRecoveryDate,
  salesOrderDemandDate,
  salesOrderOpenQuantity,
  simulatePlanningScenario,
  toolResourceUsable,
} from "./advanced-production-planning.service";

describe("APS tool lifecycle availability", () => {
  const tool = {
    status: "AVAILABLE",
    available_quantity: 1,
    valid_until: "2026-12-31",
    life_limit_cycles: 1000,
    cycles_used: 200,
    calibration_required: true,
    calibration_status: "VALID",
    next_calibration_due: "2026-10-31",
  };

  it("accepts only a life-valid, calibration-valid resource on the scheduled date", () => {
    expect(toolResourceUsable(tool, "2026-09-01")).toBe(true);
    expect(
      toolResourceUsable({ ...tool, cycles_used: 1000 }, "2026-09-01"),
    ).toBe(false);
    expect(
      toolResourceUsable(
        { ...tool, next_calibration_due: "2026-08-31" },
        "2026-09-01",
      ),
    ).toBe(false);
    expect(
      toolResourceUsable(
        { ...tool, calibration_status: "FAILED" },
        "2026-09-01",
      ),
    ).toBe(false);
  });

  it("allows a non-calibrated resource only when its other controls are valid", () => {
    expect(
      toolResourceUsable(
        {
          ...tool,
          calibration_required: false,
          calibration_status: "NOT_REQUIRED",
          next_calibration_due: null,
        },
        "2026-09-01",
      ),
    ).toBe(true);
    expect(
      toolResourceUsable({ ...tool, status: "BLOCKED" }, "2026-09-01"),
    ).toBe(false);
  });
});

describe("sales-order production demand", () => {
  it("uses only the undispatched sales-order quantity", () => {
    expect(
      salesOrderOpenQuantity({ quantity: 100, dispatched_quantity: 35 }),
    ).toBe(65);
    expect(
      salesOrderOpenQuantity({ quantity: 10, dispatched_quantity: 12 }),
    ).toBe(0);
  });

  it("prefers the line promise date and falls back to the order delivery date", () => {
    const order = { expected_delivery_date: "2026-09-30" };
    expect(salesOrderDemandDate(order, { promised_date: "2026-09-20" })).toBe(
      "2026-09-20",
    );
    expect(salesOrderDemandDate(order, {})).toBe("2026-09-30");
    expect(salesOrderDemandDate({}, {})).toBe("");
  });
});

describe("finite capacity calendar", () => {
  it("honours explicit capacity, shift downtime, maintenance, weekends and holidays", () => {
    const calendar = buildDailyCapacityCalendar({
      stationId: "station-1",
      startDate: "2026-08-31",
      endDate: "2026-09-06",
      defaultDailyMinutes: 480,
      slots: [
        {
          work_station_id: "station-1",
          work_date: "2026-08-31",
          available_minutes: 600,
        },
      ],
      shifts: [
        {
          id: "shift-1",
          work_station_id: "station-1",
          work_date: "2026-09-01",
          planned_production_minutes: 480,
        },
      ],
      downtimes: [{ shift_id: "shift-1", downtime_minutes: 60 }],
      maintenance: [{ date: "2026-08-31", minutes: 120 }],
      holidays: ["2026-09-02"],
    });

    expect(
      calendar.map((day) => [day.work_date, day.source, day.available_minutes]),
    ).toEqual([
      ["2026-08-31", "CAPACITY_SLOT", 480],
      ["2026-09-01", "SHIFT_PLAN", 420],
      ["2026-09-02", "CLOSED", 0],
      ["2026-09-03", "DEFAULT_WEEKDAY", 480],
      ["2026-09-04", "DEFAULT_WEEKDAY", 480],
      ["2026-09-05", "CLOSED", 0],
      ["2026-09-06", "CLOSED", 0],
    ]);
  });

  it("allocates a stage backwards without placing work on closed dates", () => {
    const calendar = buildDailyCapacityCalendar({
      stationId: "station-1",
      startDate: "2026-09-03",
      endDate: "2026-09-07",
      defaultDailyMinutes: 480,
    });
    const result = allocateCapacityBackward(600, "2026-09-07", calendar);

    expect(result.planned_start).toBe("2026-09-04");
    expect(result.planned_end).toBe("2026-09-07");
    expect(result.unallocated_minutes).toBe(0);
    expect(result.allocations.map((row) => row.work_date)).toEqual([
      "2026-09-07",
      "2026-09-04",
    ]);
  });

  it("projects uncovered capacity onto the next available working dates", () => {
    expect(projectCapacityRecoveryDate("2026-09-04", 600, 480)).toBe(
      "2026-09-08",
    );
  });
});

describe("APS what-if delivery simulation", () => {
  it("shows the recovery from added capacity, supplier acceleration and budget", () => {
    const result = simulatePlanningScenario(
      {
        dueDate: "2026-09-10",
        projectedCompletionDate: "2026-09-13",
        requiredOvertimeMinutes: 960,
        deliveryConfidencePct: 45,
        materialCashRequired: 100000,
        cashBudget: 70000,
        criticalMaterialCount: 2,
        defaultDailyMinutes: 480,
      },
      {
        overtimeMinutes: 480,
        alternateCapacityMinutes: 480,
        supplierAccelerationDays: 1,
        additionalBudget: 30000,
        dueDateExtensionDays: 0,
      },
    );

    expect(result.projected_completion_date).toBe("2026-09-10");
    expect(result.delivery_status).toBe("ON_TIME");
    expect(result.residual_capacity_shortage_minutes).toBe(0);
    expect(result.residual_cash_gap).toBe(0);
    expect(result.confidence_pct).toBeGreaterThan(45);
  });

  it("keeps the scenario at risk when capacity remains uncovered", () => {
    const result = simulatePlanningScenario(
      {
        dueDate: "2026-09-10",
        projectedCompletionDate: "2026-09-12",
        requiredOvertimeMinutes: 960,
        deliveryConfidencePct: 40,
        materialCashRequired: 0,
        criticalMaterialCount: 0,
      },
      { overtimeMinutes: 120 },
    );

    expect(result.delivery_status).toBe("AT_RISK");
    expect(result.residual_capacity_shortage_minutes).toBe(840);
  });
});

describe("APS execution variance", () => {
  it("reconciles job progress, schedule, rejection and net material issue", () => {
    const snapshot = buildExecutionVarianceSnapshot({
      today: "2026-09-12",
      conversions: [
        {
          id: "conversion-1",
          wave_id: "wave-1",
          bom_id: "bom-1",
          job_order_id: "job-1",
          job_order_number: "JO-001",
        },
      ],
      stages: [
        {
          wave_id: "wave-1",
          bom_id: "bom-1",
          quantity: 100,
          required_capacity_minutes: 300,
          planned_start: "2026-09-05T00:00:00Z",
          planned_end: "2026-09-10T00:00:00Z",
        },
        {
          wave_id: "wave-1",
          bom_id: "bom-1",
          quantity: 100,
          required_capacity_minutes: 200,
          planned_start: "2026-09-06T00:00:00Z",
          planned_end: "2026-09-10T00:00:00Z",
        },
      ],
      jobs: [
        {
          id: "job-1",
          job_order_number: "JO-001",
          quantity: 100,
          completed_quantity: 95,
          rejected_quantity: 5,
          status: "COMPLETED",
          actual_start_date: "2026-09-06T08:00:00Z",
          actual_end_date: "2026-09-11T18:00:00Z",
        },
      ],
      materials: [
        {
          job_order_id: "job-1",
          required_quantity: 250,
          issued_quantity: 260,
          returned_quantity: 10,
        },
      ],
    });

    expect(snapshot.summary.completed_job_orders).toBe(1);
    expect(snapshot.summary.rejected_quantity).toBe(5);
    expect(snapshot.rows[0]).toMatchObject({
      planned_quantity: 100,
      planned_capacity_minutes: 500,
      progress_pct: 95,
      start_variance_days: 1,
      finish_variance_days: 1,
      material_net_issued_quantity: 250,
      material_issue_variance_quantity: 0,
      schedule_status: "COMPLETED_LATE",
    });
    expect(snapshot.rows[0].risks).toEqual(
      expect.arrayContaining([
        "COMPLETED_LATE",
        "REJECTION_REPORTED",
        "COMPLETED_SHORT",
      ]),
    );
  });

  it("marks an incomplete job overdue without inventing a completion", () => {
    const snapshot = buildExecutionVarianceSnapshot({
      today: "2026-09-15",
      conversions: [
        {
          id: "conversion-1",
          wave_id: "wave-1",
          bom_id: "bom-1",
          job_order_id: "job-1",
        },
      ],
      stages: [
        {
          wave_id: "wave-1",
          bom_id: "bom-1",
          quantity: 50,
          planned_start: "2026-09-08",
          planned_end: "2026-09-12",
        },
      ],
      jobs: [
        {
          id: "job-1",
          quantity: 50,
          completed_quantity: 20,
          status: "IN_PROGRESS",
          actual_start_date: "2026-09-09",
        },
      ],
    });

    expect(snapshot.rows[0].actual_end).toBeNull();
    expect(snapshot.rows[0].finish_variance_days).toBe(3);
    expect(snapshot.rows[0].schedule_status).toBe("OVERDUE");
  });
});

describe("production transformation action queue", () => {
  it("ranks delivery, execution and material risks ahead of governance", () => {
    const queue = buildProductionTransformationQueue([
      {
        program_id: "program-1",
        program_code: "PLAN-001",
        program_name: "Customer build",
        due_date: "2026-09-20",
        latest_run_id: "run-1",
        feasible: false,
        confidence_pct: 42,
        projected_completion_date: "2026-09-24",
        critical_materials: 3,
        required_overtime_minutes: 600,
        excess_wip_cash_risk: 25000,
        approved: false,
        frozen: false,
        execution: { jobs_at_risk: 2 },
      },
    ]);

    expect(queue.map((row) => row.domain)).toEqual([
      "DELIVERY",
      "EXECUTION",
      "MATERIAL",
      "CAPACITY",
      "CASH",
      "GOVERNANCE",
    ]);
    expect(queue[0]).toMatchObject({
      priority_score: 100,
      evidence_source: "production_planning_runs",
    });
  });

  it("returns no action for a healthy approved and frozen program", () => {
    expect(
      buildProductionTransformationQueue([
        {
          program_id: "program-2",
          program_code: "PLAN-002",
          feasible: true,
          confidence_pct: 92,
          critical_materials: 0,
          required_overtime_minutes: 0,
          excess_wip_cash_risk: 0,
          approved: true,
          frozen: true,
          execution: { jobs_at_risk: 0 },
        },
      ]),
    ).toEqual([]);
  });
});
