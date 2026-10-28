// How changes of the `spec` of an intent are classified (ADR 0005). Removing
// an intent and changes of `kind`, `stability` and `requires` are classified
// by the core table; this table covers only `spec`.

import type { ChangeTable } from "../../core/changes.js";

const compatible = { rule: "compatible" } as const;

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
          perMinute: compatible,
          perHour: compatible,
          perDay: compatible,
        },
      },
    },
    invalidates: { rule: "set", added: "compatible", removed: "compatible" },
  },
};
