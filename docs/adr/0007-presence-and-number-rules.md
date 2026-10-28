# 0007. Presence and number rules

## Status

Accepted

## Date

2026-10-29

## Context

The closed set of change rules (ADR 0003) could not say that a field which
may be absent appeared or disappeared, nor that a number grew or shrank. ADR
0004, ADR 0005 and ADR 0006 recorded this as a known limitation and resolved
it on the safe side: adding a subscription to a source and any change of its
`intervalMs` were breaking, and the windows of intent limits were compatible
but came as one `value.changed`, so a limit removed and a limit tightened
could not be told apart. A false breaking change is not harmless: a major
version disables plugins on a caret range, so an owner who made a feed faster
would disable other people's plugins.

The review of the comparison of versions also found two false compatible
results in the comparison of schemas, which break the promise of ADR 0006,
and the testing found that an own key `__proto__` of a model was lost
silently. `ComparisonResult` did not narrow by `ok`.

All of this is cheap to change only before the first release, 0.1.0. The
decision was designed and approved in task HAF-25 (Cadence Lab, project HAF);
the parts that matter are restated here so that this record does not depend
on the tracker.

## Decision

### Two rules of the closed set

```ts
interface NumberRule {
  readonly rule: "number";
  readonly increased: ChangeClass;
  readonly decreased: ChangeClass;
}

interface OptionalRule extends AddRemoveClasses {
  readonly rule: "optional";
  readonly value: NestedRule | OrderedRule | SchemaRule | NumberRule;
}
```

- Neither rule has a default class: the author of a table writes both
  classes, as an intent writes its confirmation.
- `optional.value` is a rule that cannot classify an absent value itself:
  `number`, `ordered`, `schema` or `nested` with a table without `entry` (an
  object). `isTable` refuses `optional` around `breaking`, `compatible`,
  `set`, a dictionary (`nested` with `entry`), the core-only labels `"kind"`
  and `"extension"`, and another `optional`: these already define absence
  (`value.changed`, an empty set, an empty dictionary), and a wrapper would be
  a second way to say the same thing.
- `isTable` checks the exact keys and the classes of both rules, as it does
  for the others: a missing class, an extra key or a class outside
  `breaking | compatible` is refused (`descriptor.invalid-changes` in a
  descriptor, `compare.invalid-table` in the comparison).
- `coreChangeTable` does not change. `"."` exports the types `NumberRule` and
  `OptionalRule`; the values it exports stay the same fourteen.

### Reading the rules

| Rule       | Change                                                     | Code                                     | Class                 |
| ---------- | ---------------------------------------------------------- | ---------------------------------------- | --------------------- |
| `number`   | the value grew / shrank                                    | `number.increased` / `number.decreased`  | from the rule         |
| `number`   | a value is not a number, or the field appeared or vanished | `value.unclassified`                     | breaking              |
| `optional` | the key appeared / disappeared                             | `field.added` / `field.removed`          | `added` / `removed`   |
| `optional` | both values are present                                    | the codes of the `value` rule, same path | from the `value` rule |

- Absent means the key is missing. `null` is a present value and goes to the
  `value` rule, so `null` against a number is `value.unclassified` from
  `number`, not `field.*`.
- When both values are present, `optional` gives no change of its own; the
  changes of an object found by `nested` are deeper, depth first.
- Each rule has one handler in the walk, as ADR 0006 promised. The catalog
  `changeCodes` has 23 codes: the 19 of ADR 0006 and `number.increased`,
  `number.decreased`, `field.added`, `field.removed`.

### The tables of kinds

The source kind (ADR 0004):

```ts
subscription: {
  rule: "optional", added: "compatible", removed: "breaking",
  value: { rule: "nested", table: { fields: {
    intervalMs: { rule: "number", increased: "breaking", decreased: "compatible" },
  } } },
},
```

A subscription added is compatible, removed is breaking. `intervalMs` is the
least interval between updates: lowering it (a faster feed) is compatible,
raising it is breaking.

The intent kind (ADR 0005) keeps its classes, compatible in every cell, and
gets precise codes. Each window of `limits` is:

```ts
{ rule: "optional", added: "compatible", removed: "compatible",
  value: { rule: "number", increased: "compatible", decreased: "compatible" } }
```

A limit removed comes as `field.removed`, tightened as `number.decreased`,
loosened as `number.increased` and introduced as `field.added`, all minor. A
consumer that shows changes, such as the presentation layer, must not show
`field.removed` on a window as an ordinary compatible change: it means the
owner no longer limits the calls.

The other rows of both tables do not change: the other fields of `spec` are
always written.

### Schemas: two false compatible results fixed

- **A property removed from `properties` and added to `required`.** Input
  `{ properties: { a: {…} }, required: [] }` to `{ properties: {},
required: ["a"] }` gave only `schema.property-removed`, compatible in an
  open input object. It now also gives `schema.required-added` at the same
  path, after the removal: input breaking, output compatible.
- **A new property under a previous `additionalProperties` schema.** When the
  previous object has an `additionalProperties` schema (an object that is not
  open), the values of a new property were accepted by that schema. After
  `schema.property-added` or `schema.required-added`, that schema is compared
  with the schema of the new property in the same direction, for an optional
  and a required property alike. Input `{ additionalProperties: { type:
"number" } }` with a new `b: { type: "string" }` gives
  `schema.type-changed` at `[…, "properties", "b", "type"]`, breaking; in
  output a previous `{ type: "string", minLength: 1 }` against a new
  `b: { type: "string" }` gives `schema.widened`, breaking. A previous
  `additionalProperties` that is open or `false` adds nothing.
- One false breaking result is left: a new property whose schema is `true`
  against a previous object `additionalProperties` schema is
  `schema.unrecognized`.

### Schemas: two assumptions, now stated

- The class of a removed property is decided by the `additionalProperties`
  of the **next** object. Removed together with open to `false` in input:
  `schema.narrowed` and a breaking `schema.property-removed`; `false` to
  open: `schema.widened` and a compatible removal; open to a schema:
  `schema.unrecognized` and a breaking removal.
- An optional property with a narrowing schema added to an **open** input
  object is compatible. A value of an undeclared property was never part of
  the promise: zod writes no `additionalProperties` in the input direction
  and drops unknown keys.

So the promise of ADR 0006 reads: the rules give false breaking changes and
never a false compatible one, **apart from an undeclared property of an open
input object**, whose values were not part of the contract.

### An own key `__proto__`

`JSON.parse` creates `__proto__` as a plain own key; an assignment while
copying either set the prototype of the copy or dropped the key, silently.

- `toCanonicalJson` refuses an own key `__proto__` with a `NotJsonError` at
  its path. `compareModels` answers `compare.invalid-model` at
  `["previous" | "next", …, "__proto__"]`, without changes; a kind or an
  extension whose output has the key gets `descriptor.non-json-output`.
- `freezeCopy` defines the key instead of assigning it, so `define*` keeps it
  and `normalize` reports it with the existing codes: `root.unknown-field`,
  `<kind>.unknown-field`, `intent.invalid-limit`, and so on. The prototype of
  the copy stays `Object.prototype`.
- zod keeps an own `__proto__` key of an object shape when it converts the
  schema to JSON Schema, so such a schema reaches `toCanonicalJson` and is
  reported as `schema.unrepresentable`. A test pins this; if a later zod
  dropped the key itself, the test shows it.
- No new diagnostic codes.

### A literal `ok`

`ComparisonResult` has three members: `{ ok: true, changes, requiredBump,
diagnostics }`, `{ ok: false, changes, requiredBump, diagnostics }` (compared,
and the version is not raised enough) and `{ ok: false, diagnostics }`
(nothing was compared). `if (result.ok)` narrows to the changes; when `ok` is
false, `"changes" in result` tells the two failures apart. Only the type
changed.

### Amendments to ADR 0003

- The closed set of rules has eight rules: the six of ADR 0003,
  `number` and `optional`. `"."` exports the types `NumberRule` and
  `OptionalRule`.
- `toCanonicalJson` and `freezeCopy` treat an own key `__proto__` as above.

### Amendments to ADR 0004

- The table of the source kind is the one above. The section "Known
  limitations" is closed.

### Amendments to ADR 0005

- The windows of `limits` use `optional` around `number`, compatible in every
  cell. The section "Known limitation" is closed.
- "A key whose value is `undefined` counts as absent" applies to the fields
  an intent declares. An unknown key whose value is `undefined`, such as
  `handler: undefined`, is still `intent.unknown-field`, as the core reports
  `root.unknown-field`.

### Amendments to ADR 0006

- The reading table gains the rows of `number` and `optional`; the catalog
  has 23 change codes.
- In "Schemas by direction", a removed property also gives
  `schema.required-added` when it became required, and a new property is
  compared with the previous `additionalProperties` schema. The promise is
  the one stated above, with the exception of an open input object.
- `ComparisonResult` has a literal `ok`.
- The section "Known limitations" is closed: presence and numbers with a
  direction are expressible. The false breaking changes listed in "Schemas by
  direction" (`integer` to `number`, `exclusiveMinimum` to `minimum`, `$ref`,
  `patternProperties`) and the `true` property above remain.

## Consequences

- An owner can add a subscription to a source or make a feed faster in a
  minor version, and plugins on a caret range keep working.
- `paddock check` and the presentation layer can tell a removed limit from a
  tightened one by its code.
- A kind or an extension that has fields which may be absent wraps their
  rules in `optional` instead of accepting `value.unclassified`.
- Comparisons that were minor become major where a schema got a new required
  value or a narrower property under `additionalProperties`; such results
  were wrong before.
- A model or an input with an own key `__proto__` is refused instead of being
  changed silently.
- Changes to anything in this record are changes to the contract and go
  through tasks of type `contract`.
