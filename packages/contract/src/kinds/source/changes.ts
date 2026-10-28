// How changes of the `spec` of a source are classified (ADR 0004). The rules
// come from the closed set of ADR 0003.
//
// Known limitations, both resolved on the safe side: the closed set has no
// class for a field that appears or disappears and no directional rule for a
// number, so adding a subscription and any change of `intervalMs` are
// breaking.

import type { ChangeTable } from "../../core/changes.js";

/** The change classification table of the source kind. */
export const sourceChanges: ChangeTable = {
  fields: {
    params: { rule: "schema", direction: "input" },
    result: { rule: "schema", direction: "output" },
    subscription: {
      rule: "nested",
      table: { fields: { intervalMs: { rule: "breaking" } } },
    },
  },
};
