import { describe, expect, it } from "vitest";
import {
  eventRkey,
  parseEventRkey,
  resolveMembership,
  tidNow,
} from "../src/rkey";

const PLC = "did:plc:tmxbvcho3zysvtadtextctxw";
const WEB = "did:web:view.sharedcomputer.network";

describe("tidNow", () => {
  it("returns 13 chars from the base32-sortable alphabet", () => {
    expect(tidNow()).toMatch(/^[2-7a-z]{13}$/);
  });

  it("returns strictly increasing values in a tight loop", () => {
    const tids = Array.from({ length: 100 }, () => tidNow());
    const sorted = [...tids].sort();
    expect(tids).toEqual(sorted);
    expect(new Set(tids).size).toBe(tids.length);
  });
});

describe("eventRkey / parseEventRkey", () => {
  it("round-trips a did:plc subject", () => {
    const tid = tidNow();
    expect(parseEventRkey(eventRkey(PLC, tid))).toEqual({ did: PLC, tid });
  });

  it("round-trips a did:web subject despite internal colons", () => {
    const tid = tidNow();
    expect(parseEventRkey(eventRkey(WEB, tid))).toEqual({ did: WEB, tid });
  });

  it("rejects a non-DID subject", () => {
    expect(() => eventRkey("hadsie.com")).toThrow(/not a DID/);
  });

  it("rejects a malformed TID", () => {
    expect(() => eventRkey(PLC, "not-a-tid")).toThrow(/not a TID/);
  });

  it("throws on a malformed rkey instead of skipping it", () => {
    expect(() => parseEventRkey("garbage")).toThrow(/malformed/);
    expect(() => parseEventRkey(`${PLC}:tooshort`)).toThrow(/malformed/);
  });
});

describe("resolveMembership", () => {
  const t1 = "3mrqo575gjaaa";
  const t2 = "3mrqo575gjbbb";
  const t3 = "3mrqo575gjccc";

  it("returns empty map when there are no events", () => {
    expect(resolveMembership([], []).size).toBe(0);
  });

  it("marks a member active on grant with no revocation", () => {
    const state = resolveMembership([`${PLC}:${t1}`], []);
    expect(state.get(PLC)).toEqual({
      active: true,
      tid: t1,
      grantRkey: `${PLC}:${t1}`,
    });
  });

  it("marks a member inactive when a revocation follows the grant", () => {
    const state = resolveMembership([`${PLC}:${t1}`], [`${PLC}:${t2}`]);
    expect(state.get(PLC)?.active).toBe(false);
    expect(state.get(PLC)?.grantRkey).toBe(`${PLC}:${t1}`);
  });

  it("marks a member active again on re-grant after revocation", () => {
    const state = resolveMembership(
      [`${PLC}:${t1}`, `${PLC}:${t3}`],
      [`${PLC}:${t2}`]
    );
    expect(state.get(PLC)).toEqual({
      active: true,
      tid: t3,
      grantRkey: `${PLC}:${t3}`,
    });
  });

  it("treats a revocation with no grant as inactive", () => {
    const state = resolveMembership([], [`${PLC}:${t1}`]);
    expect(state.get(PLC)?.active).toBe(false);
  });

  it("lets revocation win an exact TID tie", () => {
    const state = resolveMembership([`${PLC}:${t1}`], [`${PLC}:${t1}`]);
    expect(state.get(PLC)?.active).toBe(false);
  });

  it("resolves multiple members independently", () => {
    const state = resolveMembership(
      [`${PLC}:${t1}`, `${WEB}:${t1}`],
      [`${WEB}:${t2}`]
    );
    expect(state.get(PLC)?.active).toBe(true);
    expect(state.get(WEB)?.active).toBe(false);
  });

  it("propagates malformed rkeys as errors", () => {
    expect(() => resolveMembership(["garbage"], [])).toThrow(/malformed/);
  });
});
