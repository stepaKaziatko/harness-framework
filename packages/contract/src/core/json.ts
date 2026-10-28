// JSON values and the helpers that keep the model plain, sorted and frozen.

/** A JSON primitive. Numbers are finite. */
export type JsonPrimitive = string | number | boolean | null;

/** A JSON object: string keys, JSON values. */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** A JSON array. */
export type JsonArray = readonly JsonValue[];

/** A value that survives `JSON.parse(JSON.stringify(value))` unchanged. */
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/** True for objects whose prototype is `Object.prototype` or `null`. */
export function isPlainObject(
  value: unknown,
): value is Record<string | symbol, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** True for arrays created by the `Array` constructor of this realm. */
export function isPlainArray(value: unknown): value is readonly unknown[] {
  return (
    Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype
  );
}

/** True when `value` is an own property of `object`. */
export function hasOwn(object: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** Compares two strings by Unicode code points, not by UTF-16 code units. */
export function compareCodePoints(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference =
      (left[index] as string).codePointAt(0)! -
      (right[index] as string).codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

/** Thrown by {@link toCanonicalJson} when a value is not plain JSON. */
export class NotJsonError extends Error {
  readonly path: readonly (string | number)[];

  constructor(message: string, path: readonly (string | number)[]) {
    super(message);
    this.name = "NotJsonError";
    this.path = path;
  }
}

/**
 * Copies a value into plain JSON with object keys inserted in code point
 * order, and `-0` written as `0`. Throws {@link NotJsonError} on anything that
 * is not plain JSON: functions, `undefined`, symbols, bigints, non-finite
 * numbers, class instances, array holes and cycles.
 */
export function toCanonicalJson(value: unknown): JsonValue {
  return canonical(value, [], new Set());
}

function canonical(
  value: unknown,
  path: (string | number)[],
  ancestors: Set<object>,
): JsonValue {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      if (!Number.isFinite(value)) {
        throw new NotJsonError(`${String(value)} is not a JSON number`, path);
      }
      return value === 0 ? 0 : value;
    case "object":
      break;
    default:
      throw new NotJsonError(
        `a value of type ${typeof value} is not JSON`,
        path,
      );
  }
  if (ancestors.has(value)) {
    throw new NotJsonError("the value contains a cycle", path);
  }
  if (isPlainArray(value)) {
    ancestors.add(value);
    const items: JsonValue[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!hasOwn(value, index)) {
        throw new NotJsonError("the array has a hole", [...path, index]);
      }
      items.push(canonical(value[index], [...path, index], ancestors));
    }
    ancestors.delete(value);
    return items;
  }
  if (!isPlainObject(value)) {
    throw new NotJsonError(
      "an object with a prototype other than Object.prototype is not JSON",
      path,
    );
  }
  ancestors.add(value);
  const result: Record<string, JsonValue> = {};
  for (const key of Object.keys(value).sort(compareCodePoints)) {
    result[key] = canonical(value[key], [...path, key], ancestors);
  }
  ancestors.delete(value);
  return result;
}

/** The JSON text of a value with sorted keys, used to compare and sort. */
export function canonicalText(value: unknown): string {
  return JSON.stringify(toCanonicalJson(value));
}

/**
 * Returns a deeply frozen copy of plain objects and arrays. Other values
 * (functions, zod schemas, class instances) are kept by reference and are not
 * frozen, because freezing them could break their own lazy state. The listed
 * symbol keys are copied along with string keys. Never throws: if a value
 * cannot be copied, the original value is returned as it is.
 */
export function freezeCopy<T>(value: T, symbolKeys: readonly symbol[] = []): T {
  try {
    return copy(value, symbolKeys, new Map()) as T;
  } catch {
    return value;
  }
}

function copy(
  value: unknown,
  symbolKeys: readonly symbol[],
  seen: Map<object, unknown>,
): unknown {
  if (typeof value !== "object" || value === null) return value;
  const known = seen.get(value);
  if (known !== undefined) return known;
  if (isPlainArray(value)) {
    const items: unknown[] = [];
    seen.set(value, items);
    for (const item of value) items.push(copy(item, symbolKeys, seen));
    return Object.freeze(items);
  }
  if (!isPlainObject(value)) return value;
  const result: Record<string | symbol, unknown> = {};
  seen.set(value, result);
  for (const key of Object.keys(value)) {
    result[key] = copy(value[key], symbolKeys, seen);
  }
  for (const key of symbolKeys) {
    if (hasOwn(value, key)) result[key] = value[key];
  }
  return Object.freeze(result);
}
