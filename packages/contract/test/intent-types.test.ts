// Type-level checks of defineIntent, run by `pnpm typecheck`. Each line marked
// `@ts-expect-error` must stay a type error; the runtime part only makes sure
// the calls do not throw.

import { z } from "zod";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  defineIntent,
  type ConfirmationPolicy,
  type IntentInput,
  type IntentLimits,
  type IntentSpec,
} from "../src/index.js";

const params = z.object({ symbol: z.string(), quantity: z.number() });
const result = z.object({ id: z.number() });

describe("the types of defineIntent (T16)", () => {
  it("refuses an intent without confirmation, with an unknown one, without requires or with an extra key", () => {
    const calls = () => [
      // @ts-expect-error confirmation is required
      defineIntent({ name: "a", requires: ["p"] }),
      // @ts-expect-error "always" is not a policy
      defineIntent({ name: "a", requires: ["p"], confirmation: "always" }),
      // @ts-expect-error requires is required
      defineIntent({ name: "a", confirmation: "user" }),
      // @ts-expect-error requires may not be empty
      defineIntent({ name: "a", requires: [], confirmation: "user" }),
      defineIntent({
        name: "a",
        requires: ["p"],
        confirmation: "user",
        // @ts-expect-error an intent has no handler
        handler: () => undefined,
      }),
      defineIntent({
        name: "a",
        requires: ["p"],
        confirmation: "user",
        // @ts-expect-error perWeek is not a window
        limits: { perWeek: 1 },
      }),
    ];
    expect(calls).not.toThrow();
  });

  it("keeps the concrete types of the params and result schemas", () => {
    const intent = defineIntent({
      name: "orders.place",
      requires: ["orders.place"],
      confirmation: "user",
      params,
      result,
    });
    expectTypeOf(intent.kind).toEqualTypeOf<"intent">();
    expectTypeOf(intent.params).toEqualTypeOf<typeof params | undefined>();
    expectTypeOf(intent.result).toEqualTypeOf<typeof result | undefined>();
    expectTypeOf<z.output<NonNullable<typeof intent.params>>>().toEqualTypeOf<{
      symbol: string;
      quantity: number;
    }>();
  });

  it("exports the policy, limits, input and spec types", () => {
    expectTypeOf<ConfirmationPolicy>().toEqualTypeOf<
      "none" | "user" | "step-up"
    >();
    expectTypeOf<IntentLimits>().toEqualTypeOf<{
      readonly perMinute?: number;
      readonly perHour?: number;
      readonly perDay?: number;
    }>();
    expectTypeOf<IntentInput["requires"]>().toEqualTypeOf<
      readonly [string, ...string[]]
    >();
    expectTypeOf<IntentSpec["confirmation"]>().toEqualTypeOf<{
      readonly policy: ConfirmationPolicy;
    }>();
  });
});
