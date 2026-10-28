// zod schemas to JSON Schema draft 2020-12, with fixed options.

import { toJSONSchema, type $ZodType } from "zod/v4/core";
import {
  compareCodePoints,
  isPlainArray,
  isPlainObject,
  toCanonicalJson,
  type JsonObject,
} from "./json.js";

/** True for a zod 4 schema, classic or mini. */
export function isZodSchema(value: unknown): value is $ZodType {
  if (typeof value !== "object" || value === null) return false;
  const internals: unknown = (value as { _zod?: unknown })._zod;
  return (
    typeof internals === "object" &&
    internals !== null &&
    "def" in internals &&
    typeof (internals as { def?: unknown }).def === "object"
  );
}

/** The outcome of a conversion. */
export type JsonSchemaResult =
  | { readonly ok: true; readonly schema: JsonObject }
  | {
      readonly ok: false;
      readonly reason: "invalid" | "unrepresentable";
      readonly message: string;
    };

/**
 * Converts a zod schema for the given direction. The result has no
 * `$schema` key: the dialect is one per model and is fixed by ADR 0003. Every
 * `required` list is sorted and without repeats.
 */
export function zodToJsonSchema(
  schema: unknown,
  direction: "input" | "output",
): JsonSchemaResult {
  if (!isZodSchema(schema)) {
    return {
      ok: false,
      reason: "invalid",
      message: "the value is not a zod schema",
    };
  }
  let converted: unknown;
  try {
    converted = toJSONSchema(schema, {
      target: "draft-2020-12",
      io: direction,
      unrepresentable: "throw",
    });
  } catch (error) {
    return {
      ok: false,
      reason: "unrepresentable",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  try {
    const json = toCanonicalJson(converted);
    if (!isPlainObject(json))
      throw new Error("the JSON Schema is not an object");
    const rest: Record<string, unknown> = {
      ...(json as Record<string, unknown>),
    };
    delete rest.$schema;
    return { ok: true, schema: sortRequired(rest) as JsonObject };
  } catch (error) {
    return {
      ok: false,
      reason: "unrepresentable",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Keywords whose value is a schema. */
const SCHEMA_KEYWORDS = new Set([
  "additionalProperties",
  "contains",
  "else",
  "if",
  "items",
  "not",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties",
]);

/** Keywords whose value is an array of schemas. */
const SCHEMA_ARRAY_KEYWORDS = new Set([
  "allOf",
  "anyOf",
  "oneOf",
  "prefixItems",
]);

/** Keywords whose value maps names to schemas. */
const SCHEMA_MAP_KEYWORDS = new Set([
  "$defs",
  "definitions",
  "dependentSchemas",
  "patternProperties",
  "properties",
]);

/**
 * Sorts `required` at every schema level. Only schema positions are walked,
 * so `default`, `const`, `enum` and `examples` values stay as they are.
 */
function sortRequired(schema: unknown): unknown {
  if (!isPlainObject(schema)) return schema;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (
      key === "required" &&
      isPlainArray(value) &&
      value.every((item) => typeof item === "string")
    ) {
      result[key] = [...new Set(value as string[])].sort(compareCodePoints);
    } else if (SCHEMA_KEYWORDS.has(key)) {
      result[key] = isPlainArray(value)
        ? value.map(sortRequired)
        : sortRequired(value);
    } else if (SCHEMA_ARRAY_KEYWORDS.has(key) && isPlainArray(value)) {
      result[key] = value.map(sortRequired);
    } else if (SCHEMA_MAP_KEYWORDS.has(key) && isPlainObject(value)) {
      result[key] = Object.fromEntries(
        Object.entries(value).map(([name, sub]) => [name, sortRequired(sub)]),
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}
