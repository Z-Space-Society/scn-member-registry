import { describe, expect, it } from "vitest";
import { parseAdminList } from "../src/adminList";

const A = "did:plc:tmxbvcho3zysvtadtextctxw";
const B = "did:web:example.com";

describe("parseAdminList", () => {
  it("puts active admins in both views", () => {
    const roster = parseAdminList({
      admins: [{ did: A, addedAt: "2026-07-28T00:00:00Z" }],
      updatedAt: "2026-07-28T00:00:00Z",
    });
    expect(roster).toEqual({ current: [A], ever: [A] });
  });

  it("keeps removed admins in ever but not current", () => {
    const roster = parseAdminList({
      admins: [
        { did: A, addedAt: "2026-01-01T00:00:00Z" },
        {
          did: B,
          addedAt: "2026-01-01T00:00:00Z",
          removedAt: "2026-06-01T00:00:00Z",
        },
      ],
      updatedAt: "2026-07-28T00:00:00Z",
    });
    expect(roster.current).toEqual([A]);
    expect(roster.ever).toEqual([A, B]);
  });

  it("accepts an empty roster", () => {
    expect(parseAdminList({ admins: [], updatedAt: "x" })).toEqual({
      current: [],
      ever: [],
    });
  });

  it("throws when the admins array is missing", () => {
    expect(() => parseAdminList({})).toThrow(/no admins array/);
    expect(() => parseAdminList(null)).toThrow(/no admins array/);
  });

  it("throws on an entry with a non-DID subject", () => {
    expect(() =>
      parseAdminList({ admins: [{ did: "hadsie.com", addedAt: "x" }] })
    ).toThrow(/malformed admin entry/);
  });

  it("throws on an entry missing addedAt", () => {
    expect(() => parseAdminList({ admins: [{ did: A }] })).toThrow(
      /malformed admin entry/
    );
  });
});
