import { FactoryHealthScheduler } from "./factory-health.scheduler";
import { ManagementBriefScheduler } from "./management-brief.scheduler";

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || "test-anon-key";

describe("Intelligence daily capture schedulers", () => {
  const tenantsDb = (tenants: any[]) => ({
    from: jest.fn(() => ({
      select: jest.fn(async () => ({ data: tenants, error: null })),
    })),
  });

  it("continues Factory Health capture when one tenant cannot be processed", async () => {
    const scheduler = new FactoryHealthScheduler({} as any);
    (scheduler as any).db = tenantsDb([
      { id: "tenant-good" },
      { id: "tenant-bad" },
    ]);
    jest
      .spyOn(scheduler, "capture")
      .mockResolvedValueOnce({ stored: true })
      .mockRejectedValueOnce(new Error("source data unavailable"));

    await expect(scheduler.captureDailyHealth()).resolves.toEqual({
      captured: 1,
      failed: 1,
      skipped: false,
    });
  });

  it("continues management-brief capture when one tenant cannot be processed", async () => {
    const scheduler = new ManagementBriefScheduler({} as any);
    (scheduler as any).db = tenantsDb([
      { id: "tenant-good" },
      { id: "tenant-bad" },
    ]);
    jest
      .spyOn(scheduler, "capture")
      .mockResolvedValueOnce({ stored: true })
      .mockRejectedValueOnce(new Error("brief source unavailable"));

    await expect(scheduler.captureDailyBriefs()).resolves.toEqual({
      captured: 1,
      failed: 1,
      skipped: false,
    });
  });
});
