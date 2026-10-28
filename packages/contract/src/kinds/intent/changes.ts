// How changes of the `spec` of an intent are classified (ADR 0005). Removing
// an intent and changes of `kind`, `stability` and `requires` are classified
// by the core table; this table covers only `spec`.
//
// A window of `limits` protects the owner, so every change of it is
// compatible (ADR 0005); its rules give each change its own code (ADR 0007):
// a limit removed is field.removed, tightened is number.decreased.

import type { ChangeTable, OptionalRule } from "../../core/changes.js";

const window: OptionalRule = {
  rule: "optional",
  added: "compatible",
  removed: "compatible",
  value: { rule: "number", increased: "compatible", decreased: "compatible" },
};

/** The change classification table of the intent kind. */
export const intentChangeTable: ChangeTable = {
  fields: {
    params: { rule: "schema", direction: "input" },
    result: { rule: "schema", direction: "output" },
    confirmation: {
      rule: "nested",
      table: {
        fields: {
          policy: {
            rule: "ordered",
            order: ["none", "user", "step-up"],
            raised: "compatible",
            lowered: "breaking",
          },
        },
      },
    },
    limits: {
      rule: "nested",
      table: {
        fields: {
          perMinute: window,
          perHour: window,
          perDay: window,
        },
      },
    },
    invalidates: { rule: "set", added: "compatible", removed: "compatible" },
  },
};
