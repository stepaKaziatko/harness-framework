// The shape of change classification tables. A table is data from a closed
// set of rules, so it can be checked by a test and serialized; the function
// that compares two versions of a contract reads it (src/versioning, ADR 0006).

import { hasOwn, isPlainArray, isPlainObject } from "./json.js";

/** The class of a change. */
export type ChangeClass = "breaking" | "compatible";

/** Classes of adding and removing an element or an entry. */
export interface AddRemoveClasses {
  readonly added: ChangeClass;
  readonly removed: ChangeClass;
}

/** Any change of the field is breaking. */
export interface BreakingRule {
  readonly rule: "breaking";
}

/** Any change of the field is compatible. */
export interface CompatibleRule {
  readonly rule: "compatible";
}

/** The field holds a JSON Schema; the direction says how to compare it. */
export interface SchemaRule {
  readonly rule: "schema";
  readonly direction: "input" | "output";
}

/** The field is a set (a sorted array without repeats). */
export interface SetRule extends AddRemoveClasses {
  readonly rule: "set";
}

/** The field takes one of ordered values; `order` lists them from lowest. */
export interface OrderedRule {
  readonly rule: "ordered";
  readonly order: readonly string[];
  readonly raised: ChangeClass;
  readonly lowered: ChangeClass;
}

/**
 * The field is an object described by a nested table. If the nested table
 * has `entry`, the field is a dictionary keyed by name and each value is
 * described by the table. In the core table only, `table: "kind"` means the
 * table of the declaration kind named by the entry's `kind` field, and
 * `table: "extension"` means a dictionary of extension sections by id: a
 * section added is compatible, removed is breaking, and its value is compared
 * by the table of the extension with that id.
 */
export interface NestedRule {
  readonly rule: "nested";
  readonly table: ChangeTable | "kind" | "extension";
}

/** One rule of the closed set. */
export type ChangeRule =
  | BreakingRule
  | CompatibleRule
  | SchemaRule
  | SetRule
  | OrderedRule
  | NestedRule;

/**
 * A change classification table. A field without a rule is breaking.
 * `entry` gives the classes of adding and removing a whole entry when the
 * table describes the values of a dictionary.
 */
export interface ChangeTable {
  readonly entry?: AddRemoveClasses;
  readonly fields: Readonly<Record<string, ChangeRule>>;
}

const breaking = { rule: "breaking" } as const;
const compatible = { rule: "compatible" } as const;

/**
 * The classification table of the root and of the declaration envelope.
 * `formatVersion` is not in it: a different format version is reported on its
 * own by the function that compares versions.
 */
export const coreChangeTable: ChangeTable = deepFreeze({
  fields: {
    contract: {
      rule: "nested",
      table: { fields: { name: breaking, version: compatible } },
    },
    imports: {
      rule: "nested",
      table: {
        entry: { added: "compatible", removed: "compatible" },
        fields: { range: breaking },
      },
    },
    permissions: {
      rule: "nested",
      table: {
        entry: { added: "compatible", removed: "breaking" },
        fields: {
          subjects: { rule: "set", added: "compatible", removed: "breaking" },
          description: compatible,
        },
      },
    },
    declarations: {
      rule: "nested",
      table: {
        entry: { added: "compatible", removed: "breaking" },
        fields: {
          kind: breaking,
          stability: {
            rule: "ordered",
            order: ["internal", "beta", "public"],
            raised: "compatible",
            lowered: "breaking",
          },
          requires: { rule: "set", added: "breaking", removed: "compatible" },
          description: compatible,
          spec: { rule: "nested", table: "kind" },
        },
      },
    },
    extensions: { rule: "nested", table: "extension" },
  },
} satisfies ChangeTable);

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

const CLASSES: ReadonlySet<unknown> = new Set(["breaking", "compatible"]);

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return (
    own.length === keys.length &&
    keys.every((key) => hasOwn(value, key)) &&
    Object.getOwnPropertySymbols(value).length === 0
  );
}

function isAddRemove(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, ["added", "removed"]) &&
    CLASSES.has(value.added) &&
    CLASSES.has(value.removed)
  );
}

function isRule(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  switch (value.rule) {
    case "breaking":
    case "compatible":
      return hasExactKeys(value, ["rule"]);
    case "schema":
      return (
        hasExactKeys(value, ["rule", "direction"]) &&
        (value.direction === "input" || value.direction === "output")
      );
    case "set":
      return (
        hasExactKeys(value, ["rule", "added", "removed"]) &&
        CLASSES.has(value.added) &&
        CLASSES.has(value.removed)
      );
    case "ordered": {
      if (!hasExactKeys(value, ["rule", "order", "raised", "lowered"])) {
        return false;
      }
      const order = value.order;
      return (
        isPlainArray(order) &&
        order.length > 0 &&
        order.every((item) => typeof item === "string") &&
        new Set(order).size === order.length &&
        CLASSES.has(value.raised) &&
        CLASSES.has(value.lowered)
      );
    }
    case "nested":
      return hasExactKeys(value, ["rule", "table"]) && isTable(value.table);
    default:
      return false;
  }
}

/**
 * True when `value` is a table of the closed set: only the listed rules with
 * exactly their fields, nested tables included. `table: "kind"` and
 * `table: "extension"` are reserved for the core table and are refused here.
 */
export function isTable(value: unknown): value is ChangeTable {
  if (!isPlainObject(value)) return false;
  const keys = hasOwn(value, "entry") ? ["entry", "fields"] : ["fields"];
  if (!hasExactKeys(value, keys)) return false;
  if (hasOwn(value, "entry") && !isAddRemove(value.entry)) return false;
  const fields = value.fields;
  if (!isPlainObject(fields) || Object.getOwnPropertySymbols(fields).length) {
    return false;
  }
  return Object.keys(fields).every((key) => isRule(fields[key]));
}
