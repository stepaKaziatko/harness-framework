// The rules of JSON Schema by direction (ADR 0006, "Schemas by direction").
// Every recognized change of a schema node narrows or widens the set of
// values it accepts; `input` holds values the product receives, `output`
// values it gives. Anything not recognized is breaking.

import type { ChangeClass } from "../core/changes.js";
import {
  hasOwn,
  isPlainArray,
  type JsonObject,
  type JsonValue,
} from "../core/json.js";
import type { ChangeCode } from "./codes.js";
import {
  isObject,
  own,
  same,
  unionKeys,
  type ChangeList,
  type SchemaComparer,
} from "./walk.js";

type Direction = "input" | "output";
type Path = readonly (string | number)[];

const LOWER_BOUNDS: ReadonlySet<string> = new Set([
  "minimum",
  "exclusiveMinimum",
  "minLength",
  "minItems",
  "minProperties",
]);
const UPPER_BOUNDS: ReadonlySet<string> = new Set([
  "maximum",
  "exclusiveMaximum",
  "maxLength",
  "maxItems",
  "maxProperties",
]);
/** Keywords that narrow when they appear and whose change is unrecognized. */
const CONSTRAINTS: ReadonlySet<string> = new Set([
  "pattern",
  "format",
  "multipleOf",
]);
const ANNOTATIONS: ReadonlySet<string> = new Set([
  "title",
  "description",
  "examples",
  "deprecated",
  "$comment",
]);

const show = (path: Path): string => path.join(".");

/** Absent, `true` and `{}` all accept any additional property. */
function isOpen(value: JsonValue | undefined): boolean {
  return (
    value === undefined ||
    value === true ||
    (isObject(value) && Object.keys(value).length === 0)
  );
}

/** The set of `type` names; `undefined` when absent, `null` when malformed. */
function typeSet(value: JsonValue | undefined): Set<string> | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value === "string") return new Set([value]);
  if (
    isPlainArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string")
  ) {
    return new Set(value as readonly string[]);
  }
  return null;
}

function isStringArray(value: JsonValue): value is readonly string[] {
  return isPlainArray(value) && value.every((item) => typeof item === "string");
}

class SchemaWalk {
  constructor(
    readonly direction: Direction,
    readonly changes: ChangeList,
  ) {}

  add(code: ChangeCode, path: Path, changeClass: ChangeClass, message: string) {
    this.changes.add(code, path, changeClass, message);
  }

  narrowed(path: Path): void {
    this.add(
      "schema.narrowed",
      path,
      this.direction === "input" ? "breaking" : "compatible",
      `${show(path)} accepts fewer values`,
    );
  }

  widened(path: Path): void {
    this.add(
      "schema.widened",
      path,
      this.direction === "input" ? "compatible" : "breaking",
      `${show(path)} accepts more values`,
    );
  }

  unrecognized(path: Path): void {
    this.add(
      "schema.unrecognized",
      path,
      "breaking",
      `${show(path)} changed in a way the rules do not recognize`,
    );
  }

  /** Compares two schema nodes that are objects. */
  node(before: JsonObject, after: JsonObject, path: Path): void {
    if (same(before, after)) return;
    const typesBefore = typeSet(own(before, "type"));
    const typesAfter = typeSet(own(after, "type"));
    if (
      typesBefore instanceof Set &&
      typesAfter instanceof Set &&
      ![...typesBefore].some((type) => typesAfter.has(type))
    ) {
      // Nothing is accepted by both: one change, without looking inside.
      this.add(
        "schema.type-changed",
        [...path, "type"],
        "breaking",
        `${show(path)} changed its type`,
      );
      return;
    }
    const done = new Set<string>();
    for (const key of unionKeys(before, after)) {
      // `properties` and `required` are compared together, per property.
      const keyword = key === "required" ? "properties" : key;
      if (done.has(keyword)) continue;
      done.add(keyword);
      if (keyword === "properties") {
        this.properties(before, after, path);
        continue;
      }
      const a = own(before, keyword);
      const b = own(after, keyword);
      if (same(a, b)) continue;
      this.keyword(keyword, a, b, [...path, keyword], typesBefore, typesAfter);
    }
  }

  keyword(
    keyword: string,
    a: JsonValue | undefined,
    b: JsonValue | undefined,
    path: Path,
    typesBefore: Set<string> | undefined | null,
    typesAfter: Set<string> | undefined | null,
  ): void {
    if (keyword === "type") {
      this.types(typesBefore, typesAfter, path);
    } else if (keyword === "additionalProperties") {
      this.additionalProperties(a, b, path);
    } else if (keyword === "items" || keyword === "propertyNames") {
      this.subschema(a, b, path);
    } else if (keyword === "prefixItems") {
      if (isPlainArray(a) && isPlainArray(b) && a.length === b.length) {
        a.forEach((item, index) =>
          this.subschema(item, b[index], [...path, index]),
        );
      } else {
        this.unrecognized(path);
      }
    } else if (keyword === "anyOf" || keyword === "oneOf") {
      this.branches(a, b, path);
    } else if (keyword === "enum") {
      this.enumeration(a, b, path);
    } else if (keyword === "const") {
      if (a === undefined) this.narrowed(path);
      else if (b === undefined) this.widened(path);
      else this.unrecognized(path);
    } else if (LOWER_BOUNDS.has(keyword) || UPPER_BOUNDS.has(keyword)) {
      this.bound(LOWER_BOUNDS.has(keyword), a, b, path);
    } else if (keyword === "uniqueItems") {
      const from = a ?? false;
      const to = b ?? false;
      if (typeof from !== "boolean" || typeof to !== "boolean") {
        this.unrecognized(path);
      } else if (from === to) {
        // Absent and false both allow repeated items.
      } else if (to) {
        this.narrowed(path);
      } else {
        this.widened(path);
      }
    } else if (CONSTRAINTS.has(keyword)) {
      if (a === undefined) this.narrowed(path);
      else if (b === undefined) this.widened(path);
      else this.unrecognized(path);
    } else if (keyword === "default") {
      if (this.direction === "input") {
        this.add(
          "schema.default-changed",
          path,
          "breaking",
          `${show(path)} changed for callers that leave the value out`,
        );
      } else {
        this.annotation(path);
      }
    } else if (ANNOTATIONS.has(keyword)) {
      this.annotation(path);
    } else {
      this.unrecognized(path);
    }
  }

  annotation(path: Path): void {
    this.add(
      "schema.annotation-changed",
      path,
      "compatible",
      `${show(path)} changed`,
    );
  }

  types(
    before: Set<string> | undefined | null,
    after: Set<string> | undefined | null,
    path: Path,
  ): void {
    if (before === null || after === null) {
      this.unrecognized(path);
    } else if (before === undefined) {
      this.narrowed(path);
    } else if (after === undefined) {
      this.widened(path);
    } else {
      if ([...before].some((type) => !after.has(type))) this.narrowed(path);
      if ([...after].some((type) => !before.has(type))) this.widened(path);
    }
  }

  properties(before: JsonObject, after: JsonObject, path: Path): void {
    const propertiesA = own(before, "properties") ?? {};
    const propertiesB = own(after, "properties") ?? {};
    const requiredA = own(before, "required") ?? [];
    const requiredB = own(after, "required") ?? [];
    if (!isObject(propertiesA) || !isObject(propertiesB)) {
      if (!same(propertiesA, propertiesB)) {
        this.unrecognized([...path, "properties"]);
      }
      return;
    }
    if (!isStringArray(requiredA) || !isStringArray(requiredB)) {
      if (!same(requiredA, requiredB)) this.unrecognized([...path, "required"]);
      return;
    }
    const wasRequired = new Set(requiredA);
    const isRequired = new Set(requiredB);
    const names = unionKeys(
      Object.fromEntries(
        [...Object.keys(propertiesA), ...requiredA].map((name) => [name, 0]),
      ),
      Object.fromEntries(
        [...Object.keys(propertiesB), ...requiredB].map((name) => [name, 0]),
      ),
    );
    // A removed property falls under the additionalProperties of the next
    // object; a new one was covered by those of the previous object.
    const open = isOpen(own(after, "additionalProperties"));
    const previousAdditional = own(before, "additionalProperties");
    const previousSchema =
      isObject(previousAdditional) && !isOpen(previousAdditional)
        ? previousAdditional
        : undefined;
    for (const name of names) {
      const at = [...path, "properties", name];
      const inA = hasOwn(propertiesA, name);
      const inB = hasOwn(propertiesB, name);
      if (inA && !inB) {
        this.add(
          "schema.property-removed",
          at,
          this.direction === "input" && open ? "compatible" : "breaking",
          `${show(at)} was removed`,
        );
        if (isRequired.has(name) && !wasRequired.has(name)) {
          this.requiredAdded(at);
        }
        continue;
      }
      if (!inA && inB) {
        if (isRequired.has(name)) this.requiredAdded(at);
        else {
          this.add(
            "schema.property-added",
            at,
            "compatible",
            `${show(at)} was added as an optional property`,
          );
          // A name required without a declaration is now optional.
          if (wasRequired.has(name)) this.requiredRemoved(at);
        }
        // Values of the property were accepted by the previous
        // additionalProperties schema: compare that schema with the new one.
        if (previousSchema !== undefined) {
          this.subschema(previousSchema, propertiesB[name], at);
        }
        continue;
      }
      if (isRequired.has(name) && !wasRequired.has(name)) {
        this.requiredAdded(at);
      } else if (wasRequired.has(name) && !isRequired.has(name)) {
        this.requiredRemoved(at);
      }
      if (inA && inB) {
        this.subschema(propertiesA[name], propertiesB[name], at);
      }
    }
  }

  requiredAdded(path: Path): void {
    this.add(
      "schema.required-added",
      path,
      this.direction === "input" ? "breaking" : "compatible",
      `${show(path)} is required`,
    );
  }

  requiredRemoved(path: Path): void {
    this.add(
      "schema.required-removed",
      path,
      this.direction === "input" ? "compatible" : "breaking",
      `${show(path)} is no longer required`,
    );
  }

  additionalProperties(
    a: JsonValue | undefined,
    b: JsonValue | undefined,
    path: Path,
  ): void {
    const form = (value: JsonValue | undefined) =>
      isOpen(value)
        ? "open"
        : value === false
          ? "closed"
          : isObject(value)
            ? "schema"
            : "other";
    const from = form(a);
    const to = form(b);
    if (from === "open" && to === "open") return;
    if (from === "schema" && to === "schema") {
      this.node(a as JsonObject, b as JsonObject, path);
    } else if (from === "open" && to === "closed") {
      this.narrowed(path);
    } else if (from === "closed" && to === "open") {
      this.widened(path);
    } else {
      this.unrecognized(path);
    }
  }

  /** Compares two subschemas, objects or booleans, found at `path`. */
  subschema(
    a: JsonValue | undefined,
    b: JsonValue | undefined,
    path: Path,
  ): void {
    if (same(a, b)) return;
    if (isObject(a) && isObject(b)) {
      this.node(a, b, path);
    } else if (a === true && b === false) {
      this.narrowed(path);
    } else if (a === false && b === true) {
      this.widened(path);
    } else {
      this.unrecognized(path);
    }
  }

  branches(
    a: JsonValue | undefined,
    b: JsonValue | undefined,
    path: Path,
  ): void {
    if (!isPlainArray(a) || !isPlainArray(b)) {
      this.unrecognized(path);
      return;
    }
    const textsA = new Set(a.map((branch) => JSON.stringify(branch)));
    const textsB = new Set(b.map((branch) => JSON.stringify(branch)));
    a.forEach((branch, index) => {
      if (!textsB.has(JSON.stringify(branch))) this.narrowed([...path, index]);
    });
    b.forEach((branch, index) => {
      if (!textsA.has(JSON.stringify(branch))) this.widened([...path, index]);
    });
  }

  enumeration(
    a: JsonValue | undefined,
    b: JsonValue | undefined,
    path: Path,
  ): void {
    if (a === undefined && isPlainArray(b)) {
      this.narrowed(path);
    } else if (b === undefined && isPlainArray(a)) {
      this.widened(path);
    } else if (isPlainArray(a) && isPlainArray(b)) {
      const textsA = new Set(a.map((item) => JSON.stringify(item)));
      const textsB = new Set(b.map((item) => JSON.stringify(item)));
      if ([...textsA].some((text) => !textsB.has(text))) this.narrowed(path);
      if ([...textsB].some((text) => !textsA.has(text))) this.widened(path);
    } else {
      this.unrecognized(path);
    }
  }

  bound(
    lower: boolean,
    a: JsonValue | undefined,
    b: JsonValue | undefined,
    path: Path,
  ): void {
    if (
      (a !== undefined && typeof a !== "number") ||
      (b !== undefined && typeof b !== "number")
    ) {
      this.unrecognized(path);
    } else if (a === undefined) {
      this.narrowed(path);
    } else if (b === undefined) {
      this.widened(path);
    } else if (lower ? b > a : b < a) {
      this.narrowed(path);
    } else {
      this.widened(path);
    }
  }
}

/** Compares two JSON Schemas of one field in the given direction. */
export const compareSchemas: SchemaComparer = (
  before,
  after,
  path,
  direction,
  changes,
) => new SchemaWalk(direction, changes).node(before, after, path);
