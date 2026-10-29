// Type-level checks of ComparisonResult, run by `pnpm typecheck`. Each line
// marked `@ts-expect-error` must stay a type error; the runtime part only
// makes sure the comparison runs.

import { describe, expect, expectTypeOf, it } from "vitest";
import {
  compareModels,
  type Change,
  type ComparisonResult,
  type RequiredBump,
} from "../src/index.js";
import { edited, model } from "./support/compare.js";

describe("the type of a comparison result", () => {
  it("narrows by ok to a comparison that was made", () => {
    const result: ComparisonResult = compareModels(
      model(),
      edited((m) => {
        m.contract.version = "0.2.0";
      }),
    );
    if (result.ok) {
      expectTypeOf(result.changes).toEqualTypeOf<readonly Change[]>();
      expectTypeOf(result.requiredBump).toEqualTypeOf<RequiredBump>();
      expect(result.changes).toEqual([]);
    } else {
      throw new Error("the comparison must succeed");
    }
  });

  it("does not give changes without narrowing", () => {
    const result = compareModels(model(), model());
    // @ts-expect-error changes exist only when ok or "changes" in result
    const changes: readonly Change[] = result.changes;
    expect(changes).toEqual([]);
    if (!result.ok) {
      // @ts-expect-error a failed result may have no changes
      void result.changes;
      if ("changes" in result) {
        expectTypeOf(result.changes).toEqualTypeOf<readonly Change[]>();
      }
    }
  });

  it("has a literal ok in each member", () => {
    expectTypeOf<ComparisonResult["ok"]>().toEqualTypeOf<boolean>();
    expectTypeOf<Extract<ComparisonResult, { ok: true }>>().toHaveProperty(
      "changes",
    );
    expectTypeOf<
      Extract<ComparisonResult, { ok: true }>["ok"]
    >().toEqualTypeOf<true>();
  });
});
