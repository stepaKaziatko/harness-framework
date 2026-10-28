import { describe, expect, it } from "vitest";
import { normalize, type ChangeTable } from "../src/index.js";
import { isTable } from "../src/core/changes.js";
import {
  compareModels,
  type CompareOptions,
} from "../src/versioning/compare.js";
import { changesOf, edited, model, type Model } from "./support/compare.js";
import { coreRootWithLayout } from "./fixtures/core-root.js";
import { probe } from "./support/test-kind.js";
import { layout } from "./support/test-extension.js";

const PLACE = ["declarations", "trading.orders.place", "spec"];
const FEED = ["declarations", "trading.quotes.feed", "spec"];
const HISTORY = ["declarations", "trading.orders.history", "spec"];

function changes(
  edit: (m: Model) => void,
  options: CompareOptions = { kinds: [probe] },
) {
  return changesOf(compareModels(model(), edited(edit), options));
}

describe("the rules of a kind's table, on the probe kind (C8)", () => {
  it.each([
    [
      "refs changed",
      (m: Model) => {
        m.declarations["trading.orders.place"].spec.refs.pop();
      },
      [{ code: "value.changed", path: [...PLACE, "refs"], class: "breaking" }],
    ],
    [
      "note changed",
      (m: Model) => {
        m.declarations["trading.orders.history"].spec.note = "x";
      },
      [
        {
          code: "value.changed",
          path: [...HISTORY, "note"],
          class: "compatible",
        },
      ],
    ],
    [
      "note appeared",
      (m: Model) => {
        m.declarations["trading.quotes.feed"].spec.note = "x";
      },
      [{ code: "value.changed", path: [...FEED, "note"], class: "compatible" }],
    ],
    [
      "a tag added",
      (m: Model) => {
        m.declarations["trading.quotes.feed"].spec.tags = [
          "live",
          "market",
          "news",
        ];
      },
      [{ code: "set.added", path: [...FEED, "tags", 2], class: "compatible" }],
    ],
    [
      "a tag removed",
      (m: Model) => {
        m.declarations["trading.quotes.feed"].spec.tags = ["market"];
      },
      [{ code: "set.removed", path: [...FEED, "tags", 0], class: "breaking" }],
    ],
    [
      "level raised",
      (m: Model) => {
        m.declarations["trading.orders.history"].spec.level = "high";
      },
      [
        {
          code: "order.raised",
          path: [...HISTORY, "level"],
          class: "compatible",
        },
      ],
    ],
    [
      "level lowered",
      (m: Model) => {
        m.declarations["trading.quotes.feed"].spec.level = "low";
      },
      [{ code: "order.lowered", path: [...FEED, "level"], class: "breaking" }],
    ],
    [
      "options.retries changed",
      (m: Model) => {
        m.declarations["trading.orders.place"].spec.options.retries = 3;
      },
      [
        {
          code: "value.changed",
          path: [...PLACE, "options", "retries"],
          class: "compatible",
        },
      ],
    ],
    [
      "a spec field without a rule appeared",
      (m: Model) => {
        m.declarations["trading.orders.history"].spec.extra = 1;
      },
      [
        {
          code: "value.unclassified",
          path: [...HISTORY, "extra"],
          class: "breaking",
        },
      ],
    ],
    [
      "a field without a rule inside a nested object",
      (m: Model) => {
        m.declarations["trading.orders.place"].spec.options.timeout = 1;
      },
      [
        {
          code: "value.unclassified",
          path: [...PLACE, "options", "timeout"],
          class: "breaking",
        },
      ],
    ],
    [
      "tags as a string",
      (m: Model) => {
        m.declarations["trading.quotes.feed"].spec.tags = "live";
      },
      [
        {
          code: "value.unclassified",
          path: [...FEED, "tags"],
          class: "breaking",
        },
      ],
    ],
    [
      "level outside its order",
      (m: Model) => {
        m.declarations["trading.quotes.feed"].spec.level = "medium";
      },
      [
        {
          code: "value.unclassified",
          path: [...FEED, "level"],
          class: "breaking",
        },
      ],
    ],
    [
      "options as a number",
      (m: Model) => {
        m.declarations["trading.orders.place"].spec.options = 5;
      },
      [
        {
          code: "value.unclassified",
          path: [...PLACE, "options"],
          class: "breaking",
        },
      ],
    ],
  ])("%s", (_title, edit, expected) => {
    expect(changes(edit)).toEqual(expected);
  });

  it("note disappeared", () => {
    const previous = edited((m) => {
      m.declarations["trading.quotes.feed"].spec.note = "x";
    });
    expect(
      changesOf(compareModels(previous, model(), { kinds: [probe] })),
    ).toEqual([
      { code: "value.changed", path: [...FEED, "note"], class: "compatible" },
    ]);
  });
});

describe("missing collections and values of the wrong form (R4)", () => {
  it.each([
    [
      "a set that appears is compared with an empty one",
      (m: Model) => {
        delete m.declarations["trading.orders.history"].spec.tags;
      },
      (m: Model) => {
        m.declarations["trading.orders.history"].spec.tags = ["a"];
      },
      [
        {
          code: "set.added",
          path: [...HISTORY, "tags", 0],
          class: "compatible",
        },
      ],
    ],
    [
      "a set that disappears is compared with an empty one",
      (m: Model) => {
        m.declarations["trading.orders.history"].spec.tags = ["a"];
      },
      (m: Model) => {
        delete m.declarations["trading.orders.history"].spec.tags;
      },
      [
        {
          code: "set.removed",
          path: [...HISTORY, "tags", 0],
          class: "breaking",
        },
      ],
    ],
    [
      "an ordered value that appears",
      (m: Model) => {
        delete m.declarations["trading.orders.history"].spec.level;
      },
      () => {},
      [
        {
          code: "value.unclassified",
          path: [...HISTORY, "level"],
          class: "breaking",
        },
      ],
    ],
    [
      "a schema that is not an object",
      () => {},
      (m: Model) => {
        m.declarations["trading.quotes.feed"].spec.output = "object";
      },
      [
        {
          code: "value.unclassified",
          path: [...FEED, "output"],
          class: "breaking",
        },
      ],
    ],
    [
      "an entry of a dictionary that is not an object",
      () => {},
      (m: Model) => {
        m.permissions["trading.quotes.read"] = "read";
      },
      [
        {
          code: "value.unclassified",
          path: ["permissions", "trading.quotes.read"],
          class: "breaking",
        },
      ],
    ],
  ])("%s", (_title, before, after, expected) => {
    expect(
      changesOf(
        compareModels(edited(before), edited(after), { kinds: [probe] }),
      ),
    ).toEqual(expected);
  });

  it("a dictionary of an extension that is not an object", () => {
    const section = (panels: unknown) =>
      edited((m) => {
        m.extensions = { layout: { panels } };
      });
    expect(
      changesOf(
        compareModels(section({}), section([]), { extensions: [layout] }),
      ),
    ).toEqual([
      {
        code: "value.unclassified",
        path: ["extensions", "layout", "panels"],
        class: "breaking",
      },
    ]);
  });
});

describe("a kind's table that was not given (C9)", () => {
  it("makes a changed spec breaking", () => {
    expect(
      changes((m) => {
        m.declarations["trading.quotes.feed"].spec.note = "x";
      }, {}),
    ).toEqual([{ code: "table.missing", path: FEED, class: "breaking" }]);
  });

  it("is not needed when no spec changed", () => {
    expect(compareModels(model(), model())).toEqual({
      ok: true,
      changes: [],
      requiredBump: "none",
      diagnostics: [],
    });
    expect(
      changes((m) => {
        m.declarations["trading.quotes.feed"].stability = "beta";
      }, {}),
    ).toEqual([
      {
        code: "order.lowered",
        path: ["declarations", "trading.quotes.feed", "stability"],
        class: "breaking",
      },
    ]);
  });

  it("is not needed when a declaration is added or removed", () => {
    expect(
      changes((m) => {
        delete m.declarations["trading.orders.place"];
        m.declarations["trading.orders.cancel"] = {
          kind: "probe",
          requires: [],
          spec: { level: "low", refs: [], tags: [] },
          stability: "internal",
        };
      }, {}),
    ).toEqual([
      {
        code: "entry.added",
        path: ["declarations", "trading.orders.cancel"],
        class: "compatible",
      },
      {
        code: "entry.removed",
        path: ["declarations", "trading.orders.place"],
        class: "breaking",
      },
    ]);
  });

  it("is looked up by the kind of the declaration", () => {
    const other = { kind: "other", changes: probe.changes };
    expect(
      changes(
        (m) => {
          m.declarations["trading.quotes.feed"].spec.note = "x";
        },
        { kinds: [other] },
      ),
    ).toEqual([{ code: "table.missing", path: FEED, class: "breaking" }]);
  });
});

describe("extension sections (C10)", () => {
  const withLayout = (): Model => {
    const result = normalize(coreRootWithLayout);
    if (!result.ok) throw new Error("the layout fixture does not normalize");
    return JSON.parse(JSON.stringify(result.model)) as Model;
  };

  it("gives exactly entry.added for a new section, without its table", () => {
    expect(changesOf(compareModels(model(), withLayout()))).toEqual([
      {
        code: "entry.added",
        path: ["extensions", "layout"],
        class: "compatible",
      },
    ]);
  });

  it("gives entry.removed for a removed section", () => {
    expect(changesOf(compareModels(withLayout(), model()))).toEqual([
      {
        code: "entry.removed",
        path: ["extensions", "layout"],
        class: "breaking",
      },
    ]);
  });

  it("compares a changed section by the extension's table", () => {
    const next = withLayout();
    delete next.extensions.layout.panels["trading.orders.panel"];
    expect(
      changesOf(compareModels(withLayout(), next, { extensions: [layout] })),
    ).toEqual([
      {
        code: "entry.removed",
        path: ["extensions", "layout", "panels", "trading.orders.panel"],
        class: "breaking",
      },
    ]);
  });

  it("makes a changed section breaking without the extension's table", () => {
    const next = withLayout();
    delete next.extensions.layout.panels["trading.orders.panel"];
    expect(changesOf(compareModels(withLayout(), next))).toEqual([
      {
        code: "table.missing",
        path: ["extensions", "layout"],
        class: "breaking",
      },
    ]);
  });

  it("looks the table up by the id of the section", () => {
    const next = withLayout();
    delete next.extensions.layout.panels["trading.orders.panel"];
    const other = { id: "other", changes: layout.changes };
    expect(
      changesOf(compareModels(withLayout(), next, { extensions: [other] })),
    ).toEqual([
      {
        code: "table.missing",
        path: ["extensions", "layout"],
        class: "breaking",
      },
    ]);
  });

  it("treats an empty extensions object as a missing one", () => {
    const empty = edited((m) => {
      m.extensions = {};
    });
    expect(changesOf(compareModels(model(), empty))).toEqual([]);
    expect(changesOf(compareModels(empty, model()))).toEqual([]);
  });
});

describe("the known gap of the closed set of rules, pinned (C11)", () => {
  // These pins describe today's behaviour on purpose. The closed set of rules
  // cannot say "an optional object appeared — compatible" or "a number grew —
  // compatible" (ADR 0006, known limitations). A later task of type contract
  // adds such rules and changes these expectations deliberately.
  it("makes an optional object that appears or disappears unclassified", () => {
    expect(
      changes((m) => {
        m.declarations["trading.orders.history"].spec.options = { retries: 1 };
      }),
    ).toEqual([
      {
        code: "value.unclassified",
        path: [...HISTORY, "options"],
        class: "breaking",
      },
    ]);
    expect(
      changes((m) => {
        delete m.declarations["trading.orders.place"].spec.options;
      }),
    ).toEqual([
      {
        code: "value.unclassified",
        path: [...PLACE, "options"],
        class: "breaking",
      },
    ]);
  });

  it("makes an input schema that appears unclassified", () => {
    expect(
      changes((m) => {
        m.declarations["trading.orders.history"].spec.input = {
          type: "object",
        };
      }),
    ).toEqual([
      {
        code: "value.unclassified",
        path: [...HISTORY, "input"],
        class: "breaking",
      },
    ]);
  });

  it.each([
    [
      "a numeric rule",
      {
        fields: {
          interval: {
            rule: "numeric",
            raised: "compatible",
            lowered: "breaking",
          },
        },
      },
    ],
    [
      "a nested rule with presence",
      {
        fields: {
          options: {
            rule: "nested",
            table: { fields: {} },
            presence: { added: "compatible", removed: "breaking" },
          },
        },
      },
    ],
  ])("refuses a table with %s", (_title, table) => {
    expect(isTable(table)).toBe(false);
    const result = compareModels(model(), model(), {
      kinds: [{ kind: "probe", changes: table as unknown as ChangeTable }],
    });
    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "compare.invalid-table",
          severity: "error",
          path: ["kinds", 0],
          message: expect.any(String),
        },
      ],
    });
  });
});
