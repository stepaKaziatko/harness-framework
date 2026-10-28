import { describe, expect, it } from "vitest";
import { compareModels } from "../src/versioning/compare.js";
import { changesOf, edited, model, type Model } from "./support/compare.js";
import { probe } from "./support/test-kind.js";
import { layout } from "./support/test-extension.js";

const PLACE = ["declarations", "trading.orders.place"];
const FEED = ["declarations", "trading.quotes.feed"];
const HISTORY = ["declarations", "trading.orders.history"];
const PLACE_PERMISSION = ["permissions", "trading.orders.place"];
const READ_PERMISSION = ["permissions", "trading.quotes.read"];

/** The changes from the reference model to the edited one. */
function changes(edit: (m: Model) => void, previous: Model = model()) {
  return changesOf(compareModels(previous, edited(edit), { kinds: [probe] }));
}

describe("the rules of the core from the epic (C5)", () => {
  it.each([
    [
      "a declaration removed",
      (m: Model) => delete m.declarations["trading.orders.history"],
      [{ code: "entry.removed", path: HISTORY, class: "breaking" }],
    ],
    [
      "a declaration added",
      (m: Model) => {
        m.declarations["trading.orders.cancel"] = {
          kind: "probe",
          requires: [],
          spec: { level: "low", refs: [], tags: [] },
          stability: "internal",
        };
      },
      [
        {
          code: "entry.added",
          path: ["declarations", "trading.orders.cancel"],
          class: "compatible",
        },
      ],
    ],
    [
      "stability lowered from public to beta",
      (m: Model) => {
        m.declarations["trading.quotes.feed"].stability = "beta";
      },
      [
        {
          code: "order.lowered",
          path: [...FEED, "stability"],
          class: "breaking",
        },
      ],
    ],
    [
      "stability lowered from public to internal",
      (m: Model) => {
        m.declarations["trading.quotes.feed"].stability = "internal";
      },
      [
        {
          code: "order.lowered",
          path: [...FEED, "stability"],
          class: "breaking",
        },
      ],
    ],
    [
      "a permission added to requires",
      (m: Model) => {
        m.declarations["trading.orders.place"].requires.push("trading.zeta");
      },
      [
        {
          code: "set.added",
          path: [...PLACE, "requires", 2],
          class: "breaking",
        },
      ],
    ],
    [
      "a subject kind added to a permission",
      (m: Model) => {
        m.permissions["trading.quotes.read"].subjects.push({ kind: "service" });
      },
      [
        {
          code: "set.added",
          path: [...READ_PERMISSION, "subjects", 1],
          class: "compatible",
        },
      ],
    ],
    [
      "the contract name changed",
      (m: Model) => {
        m.contract.name = "brokerage";
      },
      [
        {
          code: "value.changed",
          path: ["contract", "name"],
          class: "breaking",
        },
      ],
    ],
  ])("%s", (_title, edit, expected) => {
    expect(changes(edit)).toEqual(expected);
  });
});

describe("the other rows of the core table (C6)", () => {
  it.each([
    [
      "stability raised",
      (m: Model) => {
        m.declarations["trading.orders.place"].stability = "public";
      },
      [
        {
          code: "order.raised",
          path: [...PLACE, "stability"],
          class: "compatible",
        },
      ],
    ],
    [
      "a permission removed from requires",
      (m: Model) => {
        m.declarations["trading.orders.place"].requires = [
          "trading.orders.place",
        ];
      },
      [
        {
          code: "set.removed",
          path: [...PLACE, "requires", 1],
          class: "compatible",
        },
      ],
    ],
    [
      "a subject kind removed",
      (m: Model) => {
        m.permissions["trading.quotes.read"].subjects = [];
      },
      [
        {
          code: "set.removed",
          path: [...READ_PERMISSION, "subjects", 0],
          class: "breaking",
        },
      ],
    ],
    [
      "a permission removed",
      (m: Model) => delete m.permissions["trading.quotes.read"],
      [{ code: "entry.removed", path: READ_PERMISSION, class: "breaking" }],
    ],
    [
      "a permission added",
      (m: Model) => {
        m.permissions["trading.orders.cancel"] = {
          subjects: [{ kind: "end-user" }],
        };
      },
      [
        {
          code: "entry.added",
          path: ["permissions", "trading.orders.cancel"],
          class: "compatible",
        },
      ],
    ],
    [
      "an import added and another removed",
      (m: Model) => {
        delete m.imports.auth;
        m.imports.payments = { range: "^1.0.0" };
      },
      [
        {
          code: "entry.removed",
          path: ["imports", "auth"],
          class: "compatible",
        },
        {
          code: "entry.added",
          path: ["imports", "payments"],
          class: "compatible",
        },
      ],
    ],
    [
      "an import range changed",
      (m: Model) => {
        m.imports.auth.range = "^2.0.0";
      },
      [
        {
          code: "value.changed",
          path: ["imports", "auth", "range"],
          class: "breaking",
        },
      ],
    ],
    [
      "the description of a declaration and of a permission changed",
      (m: Model) => {
        m.declarations["trading.quotes.feed"].description = "Quotes";
        m.permissions["trading.orders.place"].description = "Place orders";
      },
      [
        {
          code: "value.changed",
          path: [...FEED, "description"],
          class: "compatible",
        },
        {
          code: "value.changed",
          path: [...PLACE_PERMISSION, "description"],
          class: "compatible",
        },
      ],
    ],
    [
      "a description added and another removed",
      (m: Model) => {
        delete m.declarations["trading.quotes.feed"].description;
        m.declarations["trading.orders.history"].description = "History";
      },
      [
        {
          code: "value.changed",
          path: [...HISTORY, "description"],
          class: "compatible",
        },
        {
          code: "value.changed",
          path: [...FEED, "description"],
          class: "compatible",
        },
      ],
    ],
    [
      "the kind of a declaration changed along with its spec",
      (m: Model) => {
        m.declarations["trading.orders.place"].kind = "other";
        m.declarations["trading.orders.place"].spec = { anything: true };
      },
      [{ code: "value.changed", path: [...PLACE, "kind"], class: "breaking" }],
    ],
    [
      "a field of the root without a rule appeared",
      (m: Model) => {
        m.notes = "x";
      },
      [{ code: "value.unclassified", path: ["notes"], class: "breaking" }],
    ],
    [
      "a field of the envelope without a rule appeared",
      (m: Model) => {
        m.declarations["trading.orders.history"].owner = "team";
      },
      [
        {
          code: "value.unclassified",
          path: [...HISTORY, "owner"],
          class: "breaking",
        },
      ],
    ],
  ])("%s", (_title, edit, expected) => {
    expect(changes(edit)).toEqual(expected);
  });
});

describe("the bump the changes require (C7)", () => {
  const addDeclaration = (m: Model) => {
    m.declarations["trading.orders.cancel"] = {
      kind: "probe",
      requires: [],
      spec: { level: "low", refs: [], tags: [] },
      stability: "internal",
    };
  };

  it("is minor with compatible changes only", () => {
    const next = edited((m) => {
      addDeclaration(m);
      m.contract.version = "0.2.0";
    });
    expect(compareModels(model(), next)).toMatchObject({
      requiredBump: "minor",
    });
  });

  it("is major with one breaking change among compatible ones", () => {
    const next = edited((m) => {
      addDeclaration(m);
      m.declarations["trading.quotes.feed"].stability = "beta";
      m.contract.version = "1.0.0";
    });
    const result = compareModels(model(), next);
    expect(changesOf(result).map((change) => change.class)).toEqual([
      "compatible",
      "breaking",
    ]);
    expect(result).toMatchObject({ requiredBump: "major" });
  });

  it("is none without changes", () => {
    expect(compareModels(model(), model())).toMatchObject({
      requiredBump: "none",
    });
  });
});

describe("inputs, determinism and order (C4)", () => {
  const next = () =>
    edited((m) => {
      m.contract.version = "1.0.0";
      const place = m.declarations["trading.orders.place"];
      place.requires = ["trading.orders.zap", "trading.quotes.read"];
      place.stability = "public";
      m.declarations["trading.quotes.feed"].description = "Quotes";
      m.permissions["trading.orders.place"].description = "Place orders";
      m.permissions["trading.quotes.read"].subjects = [{ kind: "service" }];
    });

  const expected = [
    {
      code: "set.removed",
      path: [...PLACE, "requires", 0],
      class: "compatible",
    },
    { code: "set.added", path: [...PLACE, "requires", 0], class: "breaking" },
    {
      code: "order.raised",
      path: [...PLACE, "stability"],
      class: "compatible",
    },
    {
      code: "value.changed",
      path: [...FEED, "description"],
      class: "compatible",
    },
    {
      code: "value.changed",
      path: [...PLACE_PERMISSION, "description"],
      class: "compatible",
    },
    {
      code: "set.removed",
      path: [...READ_PERMISSION, "subjects", 0],
      class: "breaking",
    },
    {
      code: "set.added",
      path: [...READ_PERMISSION, "subjects", 0],
      class: "compatible",
    },
  ];

  it("lists changes depth first, keys in code point order, removed before added", () => {
    expect(
      changesOf(compareModels(model(), next(), { kinds: [probe] })),
    ).toEqual(expected);
  });

  it("does not change its inputs and gives equal results on equal inputs", () => {
    const previous = model();
    const after = next();
    const options = { kinds: [probe], extensions: [layout] };
    const snapshots = [previous, after, options.kinds[0]!.changes].map(
      (value) => JSON.stringify(value),
    );
    const first = compareModels(previous, after, options);
    const second = compareModels(previous, after, options);
    expect(second).toEqual(first);
    expect(
      [previous, after, options.kinds[0]!.changes].map((value) =>
        JSON.stringify(value),
      ),
    ).toEqual(snapshots);
    expect(options.kinds).toEqual([probe]);
    expect(options.extensions).toEqual([layout]);
  });

  it("freezes its result", () => {
    const result = compareModels(model(), next());
    expect(Object.isFrozen(result)).toBe(true);
    if (!("changes" in result)) throw new Error("no changes");
    expect(Object.isFrozen(result.changes)).toBe(true);
    expect(Object.isFrozen(result.changes[0])).toBe(true);
    expect(Object.isFrozen(result.changes[0]?.path)).toBe(true);
  });

  it("gives every change a message", () => {
    const result = compareModels(model(), next());
    if (!("changes" in result)) throw new Error("no changes");
    for (const change of result.changes) {
      expect(change.message.length).toBeGreaterThan(0);
    }
  });
});
