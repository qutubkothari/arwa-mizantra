import { BadRequestException } from "@nestjs/common";
import { NoFutureDatesPipe } from "./no-future-dates.pipe";

describe("NoFutureDatesPipe", () => {
  const pipe = new NoFutureDatesPipe();

  it("allows a future quotation validity date", () => {
    const body = { quotation_date: "2026-08-16", valid_until: "2999-12-31" };
    expect(pipe.transform(body)).toBe(body);
  });

  it("allows the camel-case validity field used by external clients", () => {
    const body = { validUntil: "2999-12-31" };
    expect(pipe.transform(body)).toBe(body);
  });

  it("allows future contract and warranty validity boundaries", () => {
    const body = {
      start_date: "2999-01-01",
      end_date: "2999-12-31",
      warranty_until: "2999-12-31",
    };
    expect(pipe.transform(body)).toBe(body);
  });

  it("allows future production planning boundaries inside build waves", () => {
    const body = {
      waves: [{ required_by: "2999-09-10" }],
      planned_start: "2999-09-01",
      planned_end: "2999-09-30",
    };
    expect(pipe.transform(body)).toBe(body);
  });

  it("allows a future promised delivery date on a sales-order line", () => {
    const body = {
      expected_delivery_date: "2999-09-30",
      items: [{ promised_date: "2999-09-30" }],
    };
    expect(pipe.transform(body)).toBe(body);
  });

  it("allows a future committed delivery date on a project", () => {
    const camelCaseBody = { committedDeliveryDate: "2999-09-30" };
    const snakeCaseBody = { committed_delivery_date: "2999-09-30" };

    expect(pipe.transform(camelCaseBody)).toBe(camelCaseBody);
    expect(pipe.transform(snakeCaseBody)).toBe(snakeCaseBody);
  });

  it("allows a future production planning freeze horizon", () => {
    const body = { action: "FREEZE", freeze_horizon_date: "2999-09-30" };
    expect(pipe.transform(body)).toBe(body);
  });

  it("allows future CRM commitments and activity scheduling", () => {
    const body = {
      expected_close_date: "2999-09-30",
      next_follow_up_at: "2999-09-10T10:30:00.000Z",
      activity: {
        scheduled_at: "2999-09-11T10:30:00.000Z",
        next_action_at: "2999-09-12T10:30:00.000Z",
      },
    };
    expect(pipe.transform(body)).toBe(body);
  });

  it("allows future FSM visit start and end timestamps, including offline batches", () => {
    const body = {
      scheduled_start: "2999-09-11T10:30:00.000Z",
      scheduled_end: "2999-09-11T11:15:00.000Z",
      operations: [
        {
          payload: {
            scheduledStart: "2999-09-12T10:30:00.000Z",
            scheduledEnd: "2999-09-12T11:15:00.000Z",
          },
        },
      ],
    };

    expect(pipe.transform(body)).toBe(body);
  });

  it("continues to reject future transaction and posting dates", () => {
    expect(() => pipe.transform({ invoice_date: "2999-12-31" })).toThrow(
      BadRequestException,
    );
  });
});
