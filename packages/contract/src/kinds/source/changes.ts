// How changes of the `spec` of a source are classified (ADR 0004). The rules
// come from the closed set of ADR 0003 and ADR 0007: a subscription added to
// a source is compatible and removed is breaking; `intervalMs` is the least
// interval between updates, so lowering it is compatible and raising it is
// breaking.

import type { ChangeTable } from "../../core/changes.js";

/** The change classification table of the source kind. */
export const sourceChanges: ChangeTable = {
  fields: {
    params: { rule: "schema", direction: "input" },
    result: { rule: "schema", direction: "output" },
    subscription: {
      rule: "optional",
      added: "compatible",
      removed: "breaking",
      value: {
        rule: "nested",
        table: {
          fields: {
            intervalMs: {
              rule: "number",
              increased: "breaking",
              decreased: "compatible",
            },
          },
        },
      },
    },
  },
};
