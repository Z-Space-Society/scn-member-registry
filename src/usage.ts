import { NSID } from "./lexicons";
import type { XrpcLike } from "./membership";

/**
 * Gateway usage for the signed-in member.
 */

export interface UsageRow {
  date: string;
  /** Absent when the day's requests never reached a model. */
  model?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  spend: number;
  requests: number;
}

export interface UsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  spend: number;
  requests: number;
}

export interface Usage {
  rows: UsageRow[];
  totals: UsageTotals;
  startDate: string;
  endDate: string;
}

export async function getMyUsage(
  xrpc: XrpcLike,
  startDate?: string,
  endDate?: string
): Promise<Usage> {
  const params: Record<string, unknown> = {};
  if (startDate) params.startDate = startDate;
  if (endDate) params.endDate = endDate;
  const res = await xrpc.call(NSID.getMyUsage, params);
  return {
    rows: res.data.rows ?? [],
    totals: res.data.totals ?? emptyTotals(),
    startDate: res.data.startDate,
    endDate: res.data.endDate,
  };
}

export function emptyTotals(): UsageTotals {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    spend: 0,
    requests: 0,
  };
}

/** Newest day first, then model name, so the table reads like a statement. */
export function sortUsageRows(rows: UsageRow[]): UsageRow[] {
  return [...rows].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      (a.model ?? "").localeCompare(b.model ?? "")
  );
}

export function formatInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
