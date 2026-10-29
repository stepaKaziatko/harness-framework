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

type Rule = Record<string, unknown>;
const ABSENT = Symbol("absent");
/** A value of the field, or {@link ABSENT} for a missing key. */
type Value = unknown;

/**
 * The changes of the field `f` of the spec of `trading.orders.history`
 * between two values, compared by a probe table that has only that field.
 */
function fieldChanges(rule: Rule, before: Value, after: Value) {
  const at = (value: Value) =>
    edited((m) => {
      if (value !== ABSENT)
        m.declarations["trading.orders.history"].spec.f = value;
    });
  const table = { fields: { f: rule } } as unknown as ChangeTable;
  return changesOf(
    compareModels(at(before), at(after), {
      kinds: [{ kind: "probe", changes: table }],
    }),
  );
}

const F = [...HISTORY, "f"];
const number = (increased: string, decreased: string): Rule => ({
  rule: "number",
  increased,
  decreased,
});
const optional = (added: string, removed: string, value: Rule): Rule => ({
  rule: "optional",
  added,
  removed,
  value,
});

describe("the rule number", () => {
  it.each([
    ["breaking", "compatible"],
    ["compatible", "breaking"],
  ])(
    "classifies growth as %s and shrinking as %s by its table",
    (increased, decreased) => {
      const rule = number(increased, decreased);
      expect(fieldChanges(rule, 1000, 5000)).toEqual([
        { code: "number.increased", path: F, class: increased },
      ]);
      expect(fieldChanges(rule, 1000, 500)).toEqual([
        { code: "number.decreased", path: F, class: decreased },
      ]);
    },
  );

  it("compares by value, not by text", () => {
    expect(fieldChanges(number("breaking", "compatible"), 9, 10)).toEqual([
      { code: "number.increased", path: F, class: "breaking" },
    ]);
  });

  it.each<[string, Value, Value]>([
    ["a string before", "1", 2],
    ["a string after", 1, "2"],
    ["null before", null, 2],
    ["null after", 1, null],
    ["the field disappeared", 1, ABSENT],
    ["the field appeared", ABSENT, 1],
  ])("makes %s unclassified", (_title, before, after) => {
    expect(
      fieldChanges(number("compatible", "compatible"), before, after),
    ).toEqual([{ code: "value.unclassified", path: F, class: "breaking" }]);
  });
});

describe("the rule optional", () => {
  const inner = number("breaking", "compatible");

  it.each([
    ["compatible", "breaking"],
    ["breaking", "compatible"],
  ])(
    "classifies appearing as %s and disappearing as %s by its table",
    (added, removed) => {
      const rule = optional(added, removed, inner);
      expect(fieldChanges(rule, ABSENT, 1)).toEqual([
        { code: "field.added", path: F, class: added },
      ]);
      expect(fieldChanges(rule, 1, ABSENT)).toEqual([
        { code: "field.removed", path: F, class: removed },
      ]);
    },
  );

  it("passes two present values to its value rule, without field codes", () => {
    const rule = optional("compatible", "breaking", inner);
    expect(fieldChanges(rule, 1, 2)).toEqual([
      { code: "number.increased", path: F, class: "breaking" },
    ]);
    expect(fieldChanges(rule, 2, 1)).toEqual([
      { code: "number.decreased", path: F, class: "compatible" },
    ]);
    expect(fieldChanges(rule, 1, 1)).toEqual([]);
  });

  it.each<[string, Value, Value]>([
    ["null to a number", null, 1],
    ["a number to null", 1, null],
  ])(
    "treats null as present: %s is unclassified by the value rule",
    (_t, a, b) => {
      expect(
        fieldChanges(optional("compatible", "compatible", inner), a, b),
      ).toEqual([{ code: "value.unclassified", path: F, class: "breaking" }]);
    },
  );

  it("goes into an object of a nested table, depth first", () => {
    const rule = optional("compatible", "breaking", {
      rule: "nested",
      table: {
        fields: {
          x: number("breaking", "compatible"),
          y: { rule: "compatible" },
        },
      },
    });
    expect(fieldChanges(rule, { x: 1 }, { x: 2, y: "a" })).toEqual([
      { code: "number.increased", path: [...F, "x"], class: "breaking" },
      { code: "value.changed", path: [...F, "y"], class: "compatible" },
    ]);
    expect(fieldChanges(rule, ABSENT, { x: 1 })).toEqual([
      { code: "field.added", path: F, class: "compatible" },
    ]);
    expect(fieldChanges(rule, { x: 1 }, ABSENT)).toEqual([
      { code: "field.removed", path: F, class: "breaking" },
    ]);
  });

  it("wraps an ordered value and a schema", () => {
    const ordered = optional("compatible", "breaking", {
      rule: "ordered",
      order: ["low", "high"],
      raised: "compatible",
      lowered: "breaking",
    });
    expect(fieldChanges(ordered, "high", "low")).toEqual([
      { code: "order.lowered", path: F, class: "breaking" },
    ]);
    const schema = optional("compatible", "breaking", {
      rule: "schema",
      direction: "input",
    });
    expect(
      fieldChanges(
        schema,
        { type: "string" },
        { type: "string", minLength: 1 },
      ),
    ).toEqual([
      { code: "schema.narrowed", path: [...F, "minLength"], class: "breaking" },
    ]);
    expect(fieldChanges(schema, ABSENT, { type: "string" })).toEqual([
      { code: "field.added", path: F, class: "compatible" },
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

describe("rules that need both values, not wrapped in optional (C11)", () => {
  // An object of a nested table and a schema need both values: when one side
  // is absent they are unclassified. A field that may be absent says so with
  // the rule optional (ADR 0007); the table of the probe does not wrap
  // `options` or `input`, so these stay unclassified on purpose.
  it("makes an object that appears or disappears unclassified", () => {
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

  // Rules proposed before ADR 0007 and not taken: still outside the set.
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

describe("only the version of the contract is skipped (R4)", () => {
  const versioned = {
    kind: "probe",
    changes: {
      fields: { ...probe.changes.fields, version: { rule: "breaking" } },
    } as ChangeTable,
  };
  const meta = {
    id: "meta",
    changes: { fields: { version: { rule: "compatible" } } } as ChangeTable,
  };

  it("compares a version field in the spec of a declaration", () => {
    expect(
      changesOf(
        compareModels(
          edited((m) => {
            m.declarations["trading.orders.history"].spec.version = 1;
          }),
          edited((m) => {
            m.declarations["trading.orders.history"].spec.version = 2;
          }),
          { kinds: [versioned] },
        ),
      ),
    ).toEqual([
      {
        code: "value.changed",
        path: [...HISTORY, "version"],
        class: "breaking",
      },
    ]);
  });

  it("compares a version field in an extension section", () => {
    const section = (version: number) =>
      edited((m) => {
        m.extensions = { meta: { version } };
      });
    expect(
      changesOf(compareModels(section(1), section(2), { extensions: [meta] })),
    ).toEqual([
      {
        code: "value.changed",
        path: ["extensions", "meta", "version"],
        class: "compatible",
      },
    ]);
  });
});

describe("keys named like Object.prototype members are plain keys (R4)", () => {
  it.each(["constructor", "toString"])(
    "a spec field %s without a rule is unclassified",
    (key) => {
      expect(
        changes((m) => {
          m.declarations["trading.orders.history"].spec[key] = "x";
        }),
      ).toEqual([
        {
          code: "value.unclassified",
          path: [...HISTORY, key],
          class: "breaking",
        },
      ]);
    },
  );

  const declaration = {
    kind: "probe",
    requires: [],
    spec: { level: "low", refs: [], tags: [] },
    stability: "internal",
  };

  it.each(["constructor", "toString"])(
    "a declaration named %s is added and removed",
    (name) => {
      const withIt = edited((m) => {
        m.declarations[name] = declaration;
      });
      expect(changesOf(compareModels(model(), withIt))).toEqual([
        {
          code: "entry.added",
          path: ["declarations", name],
          class: "compatible",
        },
      ]);
      expect(changesOf(compareModels(withIt, model()))).toEqual([
        {
          code: "entry.removed",
          path: ["declarations", name],
          class: "breaking",
        },
      ]);
    },
  );

  it.each(["constructor", "toString"])(
    "a schema property named %s is added",
    (name) => {
      expect(
        changes((m) => {
          m.declarations["trading.orders.place"].spec.input.properties[name] = {
            type: "string",
          };
        }),
      ).toEqual([
        {
          code: "schema.property-added",
          path: [...PLACE, "input", "properties", name],
          class: "compatible",
        },
      ]);
    },
  );
});

describe("a missing dictionary is an empty one (R4)", () => {
  const panel = {
    source: "trading.quotes.feed",
    sourceStability: "public",
    stability: "public",
  };
  const without = () =>
    edited((m) => {
      m.extensions = { layout: {} };
    });
  const withPanel = () =>
    edited((m) => {
      m.extensions = { layout: { panels: { a: panel } } };
    });
  const options = { extensions: [layout] };

  it("gives entry.added when the dictionary appears", () => {
    expect(changesOf(compareModels(without(), withPanel(), options))).toEqual([
      {
        code: "entry.added",
        path: ["extensions", "layout", "panels", "a"],
        class: "compatible",
      },
    ]);
  });

  it("gives entry.removed when the dictionary disappears", () => {
    expect(changesOf(compareModels(withPanel(), without(), options))).toEqual([
      {
        code: "entry.removed",
        path: ["extensions", "layout", "panels", "a"],
        class: "breaking",
      },
    ]);
  });
});

describe("an unchanged extension section needs no table (R4)", () => {
  it("compares only the changed section", () => {
    const sections = (panels: Record<string, unknown>) =>
      edited((m) => {
        m.extensions = { layout: { panels }, other: { anything: [1, 2] } };
      });
    const panel = {
      source: "trading.quotes.feed",
      sourceStability: "public",
      stability: "public",
    };
    expect(
      changesOf(
        compareModels(sections({ a: panel }), sections({}), {
          extensions: [layout],
        }),
      ),
    ).toEqual([
      {
        code: "entry.removed",
        path: ["extensions", "layout", "panels", "a"],
        class: "breaking",
      },
    ]);
  });
});
