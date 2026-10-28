// The catalogs of version comparison: the codes of changes and the codes of
// its diagnostics. Codes of changes come from the closed set of rules of the
// change tables, not from kinds, so a new kind adds no codes.

import type {
  DiagnosticCatalog,
  DiagnosticCodeInfo,
} from "../core/diagnostics.js";

const change = (summary: string): { readonly summary: string } =>
  Object.freeze({ summary });

/**
 * The catalog of change codes. The class of a change is not here: it comes
 * from the rule of the table and, for schemas, from the direction. Renaming or
 * removing a code after a release is a breaking change of the package.
 */
export const changeCodes = Object.freeze({
  "entry.added": change("An entry was added to a dictionary."),
  "entry.removed": change("An entry was removed from a dictionary."),
  "value.changed": change(
    "A field with a breaking or compatible rule changed, appeared or disappeared.",
  ),
  "value.unclassified": change(
    "A field has no rule, its value does not fit its rule, or a field whose rule needs both values appeared or disappeared.",
  ),
  "set.added": change("An element was added to a set."),
  "set.removed": change("An element was removed from a set."),
  "order.raised": change("An ordered value moved higher in its order."),
  "order.lowered": change("An ordered value moved lower in its order."),
  "table.missing": change(
    "A declaration spec or an extension section changed, and the table of its kind or extension was not given.",
  ),
  "schema.property-added": change("A schema got a new optional property."),
  "schema.property-removed": change("A schema lost a property."),
  "schema.required-added": change(
    "A schema got a new required property, or a property became required.",
  ),
  "schema.required-removed": change(
    "A required property of a schema became optional.",
  ),
  "schema.narrowed": change("A schema keyword now accepts fewer values."),
  "schema.widened": change("A schema keyword now accepts more values."),
  "schema.type-changed": change(
    "The types of a schema node do not overlap with the previous ones.",
  ),
  "schema.default-changed": change(
    "The default of an input schema changed, appeared or disappeared.",
  ),
  "schema.annotation-changed": change(
    "An annotation of a schema changed: title, description, examples, deprecated, $comment, or default in output.",
  ),
  "schema.unrecognized": change(
    "A schema changed in a way the rules do not recognize.",
  ),
} as const);

/** A code of {@link changeCodes}. */
export type ChangeCode = keyof typeof changeCodes;

const error = (summary: string): DiagnosticCodeInfo =>
  Object.freeze({ severity: "error", summary });

/**
 * The catalog of diagnostic codes of version comparison. Renaming or removing
 * a code after a release is a breaking change of the package.
 */
export const comparisonDiagnosticCodes = Object.freeze({
  "compare.invalid-model": error(
    "A compared value is not plain JSON or does not have the shape of a contract model.",
  ),
  "compare.unsupported-format": error(
    "A compared model has a missing or unknown `formatVersion`.",
  ),
  "compare.invalid-table": error(
    "A kind or an extension given to the comparison has no id or a table outside the closed set of rules.",
  ),
  "compare.table-conflict": error(
    "Two kinds or two extensions with one id are given with different tables.",
  ),
  "compare.insufficient-bump": error(
    "The version of the next model is not raised enough for its changes.",
  ),
} as const satisfies DiagnosticCatalog);

/** A code of {@link comparisonDiagnosticCodes}. */
export type ComparisonDiagnosticCode = keyof typeof comparisonDiagnosticCodes;
