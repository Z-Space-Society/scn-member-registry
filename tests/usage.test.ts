import { describe, expect, it, vi } from "vitest";
import {
  emptyTotals,
  formatInt,
  getMyUsage,
  sortUsageRows,
  type UsageRow,
} from "../src/usage";
import { NSID } from "../src/lexicons";

const row = (date: string, model?: string): UsageRow => ({
  date,
  model,
  promptTokens: 1,
  completionTokens: 2,
  totalTokens: 3,
  spend: 0,
  requests: 1,
});

describe("sortUsageRows", () => {
  it("puts the newest day first", () => {
    const sorted = sortUsageRows([row("2026-08-01"), row("2026-08-09")]);
    expect(sorted.map((r) => r.date)).toEqual(["2026-08-09", "2026-08-01"]);
  });

  it("orders models alphabetically within a day", () => {
    const sorted = sortUsageRows([
      row("2026-08-09", "zeta"),
      row("2026-08-09", "alpha"),
    ]);
    expect(sorted.map((r) => r.model)).toEqual(["alpha", "zeta"]);
  });

  it("handles rows with no model without throwing", () => {
    const sorted = sortUsageRows([row("2026-08-09", "alpha"), row("2026-08-09")]);
    expect(sorted).toHaveLength(2);
  });

  it("does not mutate the input", () => {
    const input = [row("2026-08-01"), row("2026-08-09")];
    sortUsageRows(input);
    expect(input[0].date).toBe("2026-08-01");
  });
});

describe("formatInt", () => {
  it("groups thousands", () => {
    expect(formatInt(1204880)).toBe("1,204,880");
  });

  it("rounds fractional values", () => {
    expect(formatInt(12.6)).toBe("13");
  });

  it("renders zero", () => {
    expect(formatInt(0)).toBe("0");
  });
});

describe("getMyUsage", () => {
  it("omits date params when not given", async () => {
    const xrpc = {
      call: vi.fn(async () => ({
        data: { rows: [], totals: emptyTotals(), startDate: "a", endDate: "b" },
      })),
    };
    const usage = await getMyUsage(xrpc);
    expect(xrpc.call).toHaveBeenCalledWith(NSID.getMyUsage, {});
    expect(usage.startDate).toBe("a");
  });

  it("passes through an explicit date range", async () => {
    const xrpc = { call: vi.fn(async () => ({ data: {} })) };
    await getMyUsage(xrpc, "2026-08-01", "2026-08-09");
    expect(xrpc.call).toHaveBeenCalledWith(NSID.getMyUsage, {
      startDate: "2026-08-01",
      endDate: "2026-08-09",
    });
  });

  it("defaults missing rows and totals", async () => {
    const xrpc = { call: async () => ({ data: {} }) };
    const usage = await getMyUsage(xrpc);
    expect(usage.rows).toEqual([]);
    expect(usage.totals).toEqual(emptyTotals());
  });
});
