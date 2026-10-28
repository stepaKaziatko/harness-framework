# 0006. Version comparison

## Status

Accepted

## Date

2026-10-28

## Context

ADR 0003 gave the contract core change classification tables, but only as
data: `coreChangeTable` and the `changes` of each descriptor. Nothing read
them, so nobody could tell before a release whether a change of a contract
breaks its consumers, or which version to publish it under. `paddock check
--against registry:latest` (a later CLI task) and the decision whether stored
configurations need a migration (a later runtime task) both need that answer
as a function, not as text.

The review of the core left two gaps that this decision closes: the core
table had no row for `extensions`, so by "a field without a rule is breaking"
every change of an extension section was breaking; and an import range such
as `>=2.0.0 <1.0.0`, which matches no version, was accepted.

The decision was designed and approved in task HAF-22 (Cadence Lab, project
HAF); the parts that matter are restated here so that this record does not
depend on the tracker.

## Decision

### API and result

- The engine lives in `packages/contract/src/versioning/` and imports only
  the core (`eslint.config.js` already enforces it). It knows no concrete
  kind: the tables of kinds and extensions are passed in.
- `compareModels(previous, next, options?) → ComparisonResult`. It never
  throws and never changes its inputs.
- `options = { kinds?: { kind, changes }[], extensions?: { id, changes }[] }`.
  The type is structural, so a kind descriptor and an extension descriptor
  fit as they are. Tables are passed rather than taken from the model because
  a model is JSON without code and a model from a registry carries no
  descriptors; there is no registry of kinds (ADR 0003). The table of a kind
  or extension is needed only when a value of that kind or extension changed.
- The result is `{ ok, changes, requiredBump, diagnostics }`; `ok` is true
  when there is no error among the diagnostics. A change is
  `{ code, path, class, message }`: `path` goes from the root of the model,
  `class` is `"breaking"` or `"compatible"`, `message` is for people and not
  part of the contract. `requiredBump` is `"major"`, `"minor"` or `"none"`.
- If a model cannot be read or a table is invalid, the result is
  `{ ok: false, diagnostics }` without `changes` and `requiredBump`: nothing
  was compared, which is not the same as "everything is breaking".
- Each model is checked, and no deeper (that is the job of `normalize`): it
  must be plain JSON (the core's `toCanonicalJson`); a `formatVersion` that is
  present and not `1` is `compare.unsupported-format` without looking at the
  shape, since another format may have another shape; then `contract.name`
  and `contract.version` must follow the core grammar, `imports`,
  `permissions` and `declarations` must be objects, every declaration an
  object with a string `kind`, and `extensions` an object or absent, each
  problem a `compare.invalid-model` at its field; finally a value of that
  shape without `formatVersion` is `compare.unsupported-format`. Paths of
  these diagnostics start with `"previous"` or `"next"`.
- Each table of the options is checked with the core's `isTable`, which also
  refuses the core-only labels: `compare.invalid-table` at `["kinds", i]` or
  `["extensions", i]` (at `["kinds"]` when the list is not an array, at `[]`
  when the options are not an object). Two entries with one id and tables
  that are not deeply equal are `compare.table-conflict` at the later entry;
  the same table twice is not an error.
- The order of changes is deterministic: depth first, keys in code point
  order (the model is canonical), and within one set or one list of branches
  every removed element before every added one.

### Reading the tables

| Rule                                                                                                                                                                                                                                      | Change                                      | Code                             | Class         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------- | ------------- |
| dictionary (`nested` with a table that has `entry`)                                                                                                                                                                                       | an entry appeared / disappeared             | `entry.added` / `entry.removed`  | from `entry`  |
| `breaking` / `compatible`                                                                                                                                                                                                                 | the value differs, appeared or disappeared  | `value.changed`                  | from the rule |
| `set`                                                                                                                                                                                                                                     | an element added / removed                  | `set.added` / `set.removed`      | from the rule |
| `ordered`                                                                                                                                                                                                                                 | the value moved higher / lower in `order`   | `order.raised` / `order.lowered` | from the rule |
| `schema`                                                                                                                                                                                                                                  | see "Schemas by direction"                  | `schema.*`                       | by direction  |
| `nested` (object)                                                                                                                                                                                                                         | the fields are compared by the nested table | —                                | —             |
| no rule for the field; a value of the wrong form for its rule (not an array for `set`, outside `order`, not an object for `schema` or `nested`); a field with an `ordered`, `schema` or `nested` object rule that appeared or disappeared |                                             | `value.unclassified`             | breaking      |
| `table: "kind"` or `"extension"` whose table was not given, and the value changed                                                                                                                                                         |                                             | `table.missing`                  | breaking      |

- A missing collection equals an empty one: a dictionary without its key is
  `{}`, a set without its key is `[]`. So a model without extensions and the
  same model with a section differ by exactly one compatible `entry.added`.
- Values are compared as canonical JSON, so elements of sets that are objects
  (subjects) are compared deeply.
- The path of a set element is its index in the model that has it: in the
  next model for `set.added`, in the previous one for `set.removed`.
- `["contract", "version"]` gives no change: the version is the subject of the
  bump check. `formatVersion` is not in the core table and never differs
  between two readable models.
- When the `kind` of a declaration changes (`value.changed`, breaking), its
  `spec` is not compared: the tables of two kinds cannot be compared and the
  change is breaking already.
- The walk has one handler per rule of the closed set, so a new rule adds a
  handler and nothing else.

### Schemas by direction

The kind gives the direction (ADR 0003): `input` holds values the product
receives, `output` values it gives. Each recognized change of a schema node
narrows or widens the set of values it accepts.

| Code                                                                                                            | `input`                                                                                                          | `output`   |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------- |
| `schema.property-added` (a new optional property)                                                               | compatible                                                                                                       | compatible |
| `schema.required-added` (a new required property, or a property became required)                                | breaking                                                                                                         | compatible |
| `schema.required-removed` (a property became optional)                                                          | compatible                                                                                                       | breaking   |
| `schema.property-removed`                                                                                       | compatible when the next object is open (`additionalProperties` absent, `true` or `{}`), breaking when it is not | breaking   |
| `schema.narrowed`                                                                                               | breaking                                                                                                         | compatible |
| `schema.widened`                                                                                                | compatible                                                                                                       | breaking   |
| `schema.type-changed` (the sets of `type` do not overlap)                                                       | breaking                                                                                                         | breaking   |
| `schema.default-changed`                                                                                        | breaking                                                                                                         | —          |
| `schema.annotation-changed` (`title`, `description`, `examples`, `deprecated`, `$comment`; `default` in output) | compatible                                                                                                       | compatible |
| `schema.unrecognized`                                                                                           | breaking                                                                                                         | breaking   |

- `type` is a set (`"string"` equals `["string"]`): a type removed narrows,
  added widens, `type` appearing narrows and disappearing widens; sets that
  do not overlap are one `schema.type-changed`, without looking inside.
- `enum` is a set of values: a value removed or `enum` appearing narrows, a
  value added or `enum` disappearing widens. `const` appearing narrows,
  disappearing widens, changing is unrecognized.
- Lower bounds (`minimum`, `exclusiveMinimum`, `minLength`, `minItems`,
  `minProperties`) narrow when they appear or grow and widen when they
  disappear or shrink; upper bounds (`maximum`, `exclusiveMaximum`,
  `maxLength`, `maxItems`, `maxProperties`) mirror them. `uniqueItems: true`
  appearing narrows (absent equals `false`).
- `pattern`, `format` and `multipleOf` narrow when they appear, widen when
  they disappear, and are unrecognized when they change.
- `additionalProperties`: absent, `true` and `{}` are one open object; open
  to `false` narrows, back widens; a schema against a schema is compared
  inside; a boolean or an open object against a schema is unrecognized.
  Boolean subschemas: `true` to `false` narrows, back widens.
- The comparison goes inside `properties.<name>`, `items`, `prefixItems.<i>`
  (when both have the same length, otherwise unrecognized),
  `additionalProperties` and `propertyNames`, in the same direction.
  `properties` and `required` are compared together, per property, at
  `[…, "properties", <name>]`; a removed property gives only
  `schema.property-removed`.
- `anyOf` and `oneOf` are sets of branches by deep equality: a branch removed
  narrows, added widens, at `[…, "anyOf" | "oneOf", i]` with the index in the
  model that has the branch; a changed branch is one removed and one added.
  `anyOf` or `oneOf` appearing or disappearing is unrecognized.
- Any other keyword (`allOf`, `not`, `$ref`, `$defs`, `if`/`then`/`else`,
  `patternProperties`, `dependentRequired`, …) that appears, disappears or
  changes is `schema.unrecognized`, breaking. The rules give false breaking
  changes (`integer` to `number`, `exclusiveMinimum: 0` to `minimum: 0`, a
  `pattern` of a zod format that changed between zod minors, any change
  through `$ref`) and never a false compatible one.

**Tolerant readers of results.** zod writes `additionalProperties: false` on
every object in the output direction, so read literally, every new field of a
result would break the old schema. A new optional output property is
nevertheless compatible, and so consumers of results — the validators that
codegen generates, the runtime, the plugin SDK and the sandbox — must ignore
fields of a result they do not know instead of refusing them. This is an
obligation of every consumer of the model.

### Required bump and the version check

- `requiredBump` is `major` when there is a breaking change, `minor` when
  there are compatible changes only, `none` without changes. There is no
  patch class: a change of a description requires `minor`.
- The check follows caret ranges, the form of `imports.range` and of the
  future `contractRange` of plugins: a breaking version must leave `^P`, a
  compatible one must stay in it and grow. For a previous version
  `P = M.m.p` without a pre-release, the `X.Y.Z` of the next version `N`,
  compared without its pre-release, must be at least:

  | `requiredBump` | `M ≥ 1`     | `M = 0, m ≥ 1` | `M = 0, m = 0` |
  | -------------- | ----------- | -------------- | -------------- |
  | `major`        | `(M+1).0.0` | `0.(m+1).0`    | `0.0.(p+1)`    |
  | `minor`        | `M.(m+1).0` | `0.m.(p+1)`    | `0.0.(p+1)`    |
  | `none`         | —           | —              | —              |

  and in every case `N ≥ P` by SemVer 2.0.0 precedence. So `2.0.0-rc.1` is
  enough for a breaking change from `1.4.0`, and `1.4.0-rc.1` is not enough
  for no change from `1.4.0`.

- When `P` is a pre-release, which SemVer calls unstable, any change needs
  `N > P` by precedence, and no change needs `N ≥ P`.
- A version that is not enough, a lower one included, is one
  `compare.insufficient-bump` error at `["next", "contract", "version"]`; the
  changes and the required bump stay in the result.
- Precedence is computed by an internal `compareVersions` of the core
  (`src/core/semver.ts`), which owns the grammar of versions; it is not
  exported.

### Catalogs

- `changeCodes`, 19 codes, each `{ summary }`: `entry.added`,
  `entry.removed`, `value.changed`, `value.unclassified`, `set.added`,
  `set.removed`, `order.raised`, `order.lowered`, `table.missing`,
  `schema.property-added`, `schema.property-removed`,
  `schema.required-added`, `schema.required-removed`, `schema.narrowed`,
  `schema.widened`, `schema.type-changed`, `schema.default-changed`,
  `schema.annotation-changed`, `schema.unrecognized`. The class is not in the
  catalog: it comes from the rule and the direction. The codes come from the
  closed set of rules, so a new kind adds no codes. They are a catalog of
  their own: the `schema.` prefix of change codes is unrelated to the core
  diagnostics `schema.*`.
- `comparisonDiagnosticCodes`, 5 codes, all errors, a `DiagnosticCatalog`:
  `compare.invalid-model`, `compare.unsupported-format`,
  `compare.invalid-table`, `compare.table-conflict`,
  `compare.insufficient-bump`. Their paths go from
  `{ previous, next, kinds, extensions }`.
- Both catalogs and their entries are frozen. Renaming or removing a code
  after a release is a breaking change of the package.

### Known limitations

The closed set of rules cannot say that an optional object field appearing is
compatible and disappearing is breaking (presence), nor that a number growing
is compatible and shrinking is breaking (a number with a direction). Today
such changes are `value.unclassified`, breaking: false breaking changes, never
false compatible ones. Tests pin this behaviour on purpose. A later task of
type `contract`, after the declaration kinds of the first milestone, adds such
rules to the closed set and changes those tests deliberately; the tables of
kinds can then be made more precise, which only turns breaking into
compatible.

### Amendments to ADR 0003

ADR 0003 stays as it was apart from its Status line; these points amend it:

- `coreChangeTable` has an `extensions` row, `{ rule: "nested", table:
"extension" }`, and `NestedRule.table` is `ChangeTable | "kind" |
"extension"`. Like `"kind"`, the `"extension"` label is for the core table
  only and `isTable` refuses it (`descriptor.invalid-changes` in a
  descriptor). It means a dictionary of sections by extension id: a section
  added is compatible, removed is breaking, and its value is compared by the
  table of the extension with that id.
- `normalize` reports `import.empty-range` (error) at `["imports", i,
"range"]` for a range of the grammar with any alternative `>=A <B` where
  `B ≤ A`, once per range. The core catalog has 29 codes.
- `compare` is a reserved code area: no kind or extension may take it as its
  id (`descriptor.reserved-id`).
- `"."` exports ten values: the seven of ADR 0003 and `compareModels`,
  `changeCodes` and `comparisonDiagnosticCodes`; and the types
  `CompareOptions`, `ComparisonResult`, `Change`, `ChangeCode`,
  `RequiredBump` and `ComparisonDiagnosticCode`.
- The function that reads the tables is the one this record describes.

## Consequences

- `paddock check --against` can be built on `compareModels`: the CLI chooses
  what to compare (a registry keeps the public slice, so a slice is compared
  with a slice), the engine compares what it is given and does not look at
  `stability`.
- A runtime can tell which stored configurations a change touches from the
  path and the class of each change.
- Validators of results must be tolerant readers; refusing unknown fields of
  a result would break on compatible changes.
- Consumers that write ranges as `^X.Y.Z` are guaranteed not to receive a
  breaking version that passed the check.
- A product that wants precise classes for its own kinds needs the later
  rules for presence and numbers; until then its table is conservative.
- Changes to anything in this record are changes to the contract and go
  through tasks of type `contract`.
