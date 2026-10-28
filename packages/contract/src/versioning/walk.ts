// The walk over two models by the change tables (ADR 0006, "Reading the
// tables"). Each rule of the closed set has one handler; a new rule adds a
// handler here and nothing else.

import {
  coreChangeTable,
  type ChangeClass,
  type ChangeRule,
  type ChangeTable,
} from "../core/changes.js";
import type { DiagnosticPath } from "../core/diagnostics.js";
import {
  compareCodePoints,
  hasOwn,
  isPlainArray,
  isPlainObject,
  type JsonObject,
  type JsonValue,
} from "../core/json.js";
import type { ChangeCode } from "./codes.js";

/** One change between two models. */
export interface Change {
  readonly code: ChangeCode;
  /**
   * Where the change is, from the root of the model. For an element of a set
   * or a branch of `anyOf`/`oneOf`, the index is in the model that has it.
   */
  readonly path: DiagnosticPath;
  readonly class: ChangeClass;
  /** Human-readable explanation; not part of the contract. */
  readonly message: string;
}

/** The tables of kinds and extensions, by id. */
export interface Tables {
  readonly kinds: ReadonlyMap<string, ChangeTable>;
  readonly extensions: ReadonlyMap<string, ChangeTable>;
}

type Path = readonly (string | number)[];

/** The objects that hold the compared field, for rules that look around. */
interface Parents {
  readonly before: JsonObject;
  readonly after: JsonObject;
}

/** Collects changes in the order they are found. */
export class ChangeList {
  readonly items: Change[] = [];

  add(code: ChangeCode, path: Path, changeClass: ChangeClass, message: string) {
    this.items.push(
      Object.freeze({
        code,
        path: Object.freeze([...path]),
        class: changeClass,
        message,
      }),
    );
  }
}

/** The models are canonical JSON, so equal values have equal text. */
export function same(
  a: JsonValue | undefined,
  b: JsonValue | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The own value of a key, or `undefined` when the key is absent. */
export function own(
  object: JsonObject | undefined,
  key: string,
): JsonValue | undefined {
  return object !== undefined && hasOwn(object, key) ? object[key] : undefined;
}

/** True for a JSON object of a canonical model. */
export function isObject(value: JsonValue | undefined): value is JsonObject {
  return isPlainObject(value);
}

/** The keys of both objects, in code point order. */
export function unionKeys(
  a: JsonObject | undefined,
  b: JsonObject | undefined,
): string[] {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  return [...keys].sort(compareCodePoints);
}

const show = (path: Path): string => path.join(".");

type Handler<R extends ChangeRule> = (
  walker: Walker,
  rule: R,
  before: JsonValue | undefined,
  after: JsonValue | undefined,
  path: Path,
  parents: Parents,
) => void;

type Handlers = {
  readonly [K in ChangeRule["rule"]]: Handler<Extract<ChangeRule, { rule: K }>>;
};

/** The schema rule's handler, given by the module of schema rules. */
export type SchemaComparer = (
  before: JsonObject,
  after: JsonObject,
  path: Path,
  direction: "input" | "output",
  changes: ChangeList,
) => void;

const handlers: Handlers = {
  breaking: (walker, _rule, _before, _after, path) =>
    walker.changes.add(
      "value.changed",
      path,
      "breaking",
      `${show(path)} changed`,
    ),
  compatible: (walker, _rule, _before, _after, path) =>
    walker.changes.add(
      "value.changed",
      path,
      "compatible",
      `${show(path)} changed`,
    ),
  set: (walker, rule, before, after, path) => {
    const a = before ?? [];
    const b = after ?? [];
    if (!isPlainArray(a) || !isPlainArray(b)) {
      walker.unclassified(path, "is not an array, as its set rule needs");
      return;
    }
    const textsA = new Set(a.map((item) => JSON.stringify(item)));
    const textsB = new Set(b.map((item) => JSON.stringify(item)));
    a.forEach((item, index) => {
      if (!textsB.has(JSON.stringify(item))) {
        walker.changes.add(
          "set.removed",
          [...path, index],
          rule.removed,
          `${JSON.stringify(item)} was removed from ${show(path)}`,
        );
      }
    });
    b.forEach((item, index) => {
      if (!textsA.has(JSON.stringify(item))) {
        walker.changes.add(
          "set.added",
          [...path, index],
          rule.added,
          `${JSON.stringify(item)} was added to ${show(path)}`,
        );
      }
    });
  },
  ordered: (walker, rule, before, after, path) => {
    const from = typeof before === "string" ? rule.order.indexOf(before) : -1;
    const to = typeof after === "string" ? rule.order.indexOf(after) : -1;
    if (from < 0 || to < 0) {
      walker.unclassified(
        path,
        "appeared, disappeared or holds a value outside its order",
      );
      return;
    }
    if (to > from) {
      walker.changes.add(
        "order.raised",
        path,
        rule.raised,
        `${show(path)} was raised from ${String(before)} to ${String(after)}`,
      );
    } else {
      walker.changes.add(
        "order.lowered",
        path,
        rule.lowered,
        `${show(path)} was lowered from ${String(before)} to ${String(after)}`,
      );
    }
  },
  schema: (walker, rule, before, after, path) => {
    if (!isObject(before) || !isObject(after)) {
      walker.unclassified(path, "appeared, disappeared or is not a schema");
      return;
    }
    walker.schema(before, after, path, rule.direction, walker.changes);
  },
  nested: (walker, rule, before, after, path, parents) => {
    if (rule.table === "kind") {
      const kind = own(parents.before, "kind");
      if (!same(kind, own(parents.after, "kind")) || typeof kind !== "string") {
        // The kind changed: that change is breaking already, and the tables
        // of two kinds cannot be compared.
        return;
      }
      const table = walker.tables.kinds.get(kind);
      if (table === undefined) {
        walker.changes.add(
          "table.missing",
          path,
          "breaking",
          `${show(path)} changed and the table of the kind "${kind}" was not given`,
        );
        return;
      }
      walker.value(table, before, after, path);
    } else if (rule.table === "extension") {
      walker.sections(before, after, path);
    } else {
      walker.value(rule.table, before, after, path);
    }
  },
};

/** Walks two canonical models by the core table and the given tables. */
export class Walker {
  readonly changes = new ChangeList();

  constructor(
    readonly tables: Tables,
    readonly schema: SchemaComparer,
  ) {}

  unclassified(path: Path, why: string): void {
    this.changes.add(
      "value.unclassified",
      path,
      "breaking",
      `${show(path)} ${why}`,
    );
  }

  /** Compares two objects field by field by `table`. */
  fields(
    table: ChangeTable,
    before: JsonObject,
    after: JsonObject,
    path: Path,
  ): void {
    for (const key of unionKeys(before, after)) {
      const a = own(before, key);
      const b = own(after, key);
      if (same(a, b)) continue;
      // The version is the subject of the bump check, not a change.
      if (path.length === 1 && path[0] === "contract" && key === "version") {
        continue;
      }
      const at = [...path, key];
      const rule = hasOwn(table.fields, key) ? table.fields[key] : undefined;
      if (rule === undefined) {
        this.unclassified(at, "has no rule in its table");
        continue;
      }
      (handlers[rule.rule] as Handler<ChangeRule>)(this, rule, a, b, at, {
        before,
        after,
      });
    }
  }

  /**
   * Compares a value described by a nested table: a dictionary when the table
   * has `entry` (a missing dictionary is an empty one), an object otherwise.
   */
  value(
    table: ChangeTable,
    before: JsonValue | undefined,
    after: JsonValue | undefined,
    path: Path,
  ): void {
    if (table.entry === undefined) {
      if (!isObject(before) || !isObject(after)) {
        this.unclassified(path, "appeared, disappeared or is not an object");
        return;
      }
      this.fields(table, before, after, path);
      return;
    }
    const entry = table.entry;
    const a = before ?? {};
    const b = after ?? {};
    if (!isObject(a) || !isObject(b)) {
      this.unclassified(path, "is not an object, as its dictionary rule needs");
      return;
    }
    for (const key of unionKeys(a, b)) {
      const at = [...path, key];
      const itemA = own(a, key);
      const itemB = own(b, key);
      if (same(itemA, itemB)) continue;
      if (itemB === undefined) {
        this.changes.add(
          "entry.removed",
          at,
          entry.removed,
          `${show(at)} was removed`,
        );
      } else if (itemA === undefined) {
        this.changes.add(
          "entry.added",
          at,
          entry.added,
          `${show(at)} was added`,
        );
      } else if (!isObject(itemA) || !isObject(itemB)) {
        this.unclassified(at, "is not an object");
      } else {
        this.fields(table, itemA, itemB, at);
      }
    }
  }

  /**
   * Compares extension sections: a section added is compatible, removed is
   * breaking, and a changed section is compared by its extension's table.
   */
  sections(
    before: JsonValue | undefined,
    after: JsonValue | undefined,
    path: Path,
  ): void {
    const a = before ?? {};
    const b = after ?? {};
    if (!isObject(a) || !isObject(b)) {
      this.unclassified(path, "is not an object of extension sections");
      return;
    }
    for (const id of unionKeys(a, b)) {
      const at = [...path, id];
      const sectionA = own(a, id);
      const sectionB = own(b, id);
      if (same(sectionA, sectionB)) continue;
      if (sectionB === undefined) {
        this.changes.add(
          "entry.removed",
          at,
          "breaking",
          `${show(at)} was removed`,
        );
        continue;
      }
      if (sectionA === undefined) {
        this.changes.add(
          "entry.added",
          at,
          "compatible",
          `${show(at)} was added`,
        );
        continue;
      }
      const table = this.tables.extensions.get(id);
      if (table === undefined) {
        this.changes.add(
          "table.missing",
          at,
          "breaking",
          `${show(at)} changed and the table of the extension "${id}" was not given`,
        );
        continue;
      }
      this.value(table, sectionA, sectionB, at);
    }
  }
}

/** The changes between two canonical models, in a deterministic order. */
export function walkModels(
  before: JsonObject,
  after: JsonObject,
  tables: Tables,
  schema: SchemaComparer,
): Change[] {
  const walker = new Walker(tables, schema);
  walker.fields(coreChangeTable, before, after, []);
  return walker.changes.items;
}
