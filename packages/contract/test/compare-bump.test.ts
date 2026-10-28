import { describe, expect, it } from "vitest";
import { compareModels } from "../src/versioning/compare.js";
import { edited, type Model } from "./support/compare.js";
import { probe } from "./support/test-kind.js";

type Bump = "major" | "minor" | "none";

const edits: Record<Bump, (m: Model) => void> = {
  major: (m) => delete m.declarations["trading.orders.history"],
  minor: (m) => {
    m.declarations["trading.orders.cancel"] = {
      kind: "probe",
      requires: [],
      spec: { level: "low", refs: [], tags: [] },
      stability: "internal",
    };
  },
  none: () => {},
};

/** [previous version, required bump, next version, enough] */
const table: [string, Bump, string, boolean][] = [
  ["1.4.0", "major", "1.5.0", false],
  ["1.4.0", "major", "1.9.9", false],
  ["1.4.0", "major", "2.0.0", true],
  ["1.4.0", "major", "2.0.0-rc.1", true],
  ["1.4.0", "minor", "1.4.1", false],
  ["1.4.0", "minor", "1.5.0", true],
  ["1.4.0", "minor", "1.5.0-rc.1", true],
  ["1.4.0", "minor", "2.0.0", true],
  ["1.4.0", "none", "1.4.0", true],
  ["1.4.0", "none", "1.3.9", false],
  ["1.4.0", "none", "1.4.0-rc.1", false],
  ["0.3.1", "major", "0.3.2", false],
  ["0.3.1", "major", "0.4.0", true],
  ["0.3.1", "major", "1.0.0", true],
  ["0.3.1", "minor", "0.3.1", false],
  ["0.3.1", "minor", "0.3.2", true],
  ["0.0.3", "major", "0.0.3", false],
  ["0.0.3", "major", "0.0.4", true],
  ["0.0.3", "minor", "0.0.3", false],
  ["0.0.3", "minor", "0.0.4", true],
  ["2.0.0-rc.1", "major", "2.0.0-rc.1", false],
  ["2.0.0-rc.1", "major", "2.0.0-rc.0", false],
  ["2.0.0-rc.1", "major", "2.0.0-rc.2", true],
  ["2.0.0-rc.1", "major", "2.0.0", true],
  ["2.0.0-rc.1", "none", "2.0.0-rc.1", true],
  // Beyond the acceptance table: the edges of each rule.
  ["1.4.0", "major", "1.4.0", false],
  ["1.4.0", "minor", "1.4.0", false],
  ["1.4.0", "minor", "1.3.0", false],
  ["1.4.0", "none", "1.4.1", true],
  ["0.3.1", "minor", "0.4.0", true],
  ["0.3.1", "major", "0.3.9", false],
  ["0.0.3", "major", "0.1.0", true],
  ["2.0.0-rc.1", "minor", "2.0.0-rc.1", false],
  ["2.0.0-rc.1", "minor", "2.0.0-rc.1.1", true],
  ["2.0.0-rc.1", "none", "2.0.0-rc.0", false],
];

describe("the version check (C15)", () => {
  it.each(table)(
    "%s with a %s bump to %s: enough is %s",
    (previous, bump, next, enough) => {
      const before = edited((m) => {
        m.contract.version = previous;
      });
      const after = edited((m) => {
        edits[bump](m);
        m.contract.version = next;
      });
      const result = compareModels(before, after, { kinds: [probe] });
      expect(result).toMatchObject({ requiredBump: bump });
      expect("changes" in result).toBe(true);
      if (enough) {
        expect(result.ok).toBe(true);
        expect(result.diagnostics).toEqual([]);
      } else {
        expect(result.ok).toBe(false);
        expect(result.diagnostics).toEqual([
          {
            code: "compare.insufficient-bump",
            severity: "error",
            path: ["next", "contract", "version"],
            message: expect.any(String),
          },
        ]);
      }
    },
  );

  it("says in the message which version is needed", () => {
    const before = edited((m) => {
      m.contract.version = "1.4.0";
    });
    const after = edited((m) => {
      edits.major(m);
      m.contract.version = "1.5.0";
    });
    expect(compareModels(before, after).diagnostics[0]?.message).toContain(
      "2.0.0",
    );
  });
});
