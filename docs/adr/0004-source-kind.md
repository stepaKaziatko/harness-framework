# 0004. Source kind

## Status

Accepted; amended by ADR 0007

## Date

2026-10-28

## Context

[ADR 0003](0003-contract-core.md) gave the contract a core and a mechanism for
declaration kinds, but no kind. A product could not say "there is a quotes
feed, it needs the permission `quotes.read`, and a client may subscribe to it
at most once a second". Widgets, intents, the runtime and the LLM tools all
need that statement in the same shape: a widget refers to a source by its
qualified name, the runtime binds a read handler to it, and the generator
builds a read tool for the LLM from it.

A product could describe a source itself with `defineDeclarationKind`, but then
every product would have its own shape of `spec`, its own codes and its own
change table, and nothing downstream could rely on the meaning of a source. The
kind of a source is part of the promise of the framework, not of a product.

The decision was designed and approved in task HAF-20 (Cadence Lab, project
HAF); the parts that matter are restated here so that this record does not
depend on the tracker. The core is not changed: the kind is built with the
mechanism of ADR 0003, in `src/kinds/source/`.

## Decision

### API

`defineSource(input)` creates a declaration of kind `source` on top of
`sourceKind.declare`. It checks nothing and never throws; `normalize` checks.
The input is the core envelope plus the payload:

| Field                                          | Required       | Meaning                                                                                                  |
| ---------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------- |
| `params`                                       | no             | A zod schema of the parameters, converted as `input`. Its JSON Schema must have `type: "object"`.        |
| `result`                                       | yes            | A zod schema of the value, converted as `output`. Any schema that JSON Schema can represent.             |
| `subscription`                                 | no             | `{ intervalMs }`: the source can be streamed, and the owner sends updates at most once per `intervalMs`. |
| `name`, `stability`, `requires`, `description` | as in the core | The core envelope, checked by the core, including `permission.unknown` for `requires`.                   |

Any other key is `source.unknown-field`, as a misspelled key of the root is in
ADR 0003.

### Meaning

- Every source can be read once: parameters in, one value of `result` out. A
  subscription is an additional capability of the same source with the same
  parameters, not a separate kind of stream.
- Every update of a subscription is the full value of `result` for the same
  parameters (a snapshot, not a delta). A delivery mode for deltas, if it is
  ever needed, is a new optional field whose absence keeps meaning "snapshot".
- The owner declares the frequency. `intervalMs` is the lower bound of the
  interval between updates, that is, the upper bound of the frequency. A
  consumer only declares a subscription with parameters and cannot ask for
  more; the owner may send less often when the value did not change. Merging
  subscribers with equal parameters and backpressure belong to the runtime and
  are not in the format.
- `intervalMs` is an integer with `100 <= intervalMs <= 3 600 000`: from ten
  updates a second to one an hour. Rarer than an hour is a single read, and
  faster than 10 Hz is a tick stream that the UI channel does not need.
  Widening the bounds later is compatible; narrowing them is breaking, as with
  the name grammar in ADR 0003.
- Parameters are an object, because they become the arguments of an LLM tool
  (providers accept only objects), the query of a read and the key under which
  the runtime merges subscriptions. A union, an array or a scalar is
  `source.params-not-object`.
- A result is JSON as it goes over the wire: transforms, `Date` and `Map` in
  `result` cannot be converted for the `output` direction and give the core
  code `schema.unrepresentable`.

### The `spec` in the model

```json
{
  "params": { "JSON Schema, always an object": "…" },
  "result": { "JSON Schema": "…" },
  "subscription": { "intervalMs": 1000 }
}
```

- `params` and `result` are always present. A source without `params` gets
  `{ "properties": {}, "type": "object" }`, which is what zod 4.6.7 gives for
  `z.object({})`, so "no parameters" has one spelling.
- `subscription` is present only when the source declares one.
- `formatVersion` stays `1`: a new kind is a new value of `kind` and a new
  shape of `spec`; the fields of the model core do not change.

### Diagnostics

All codes are errors. Paths are relative to the declaration; the core prefixes
`["declarations", i]`. Diagnostics of the kind come in a fixed order: unknown
keys in the order of the input, then `params`, `result` and `subscription`.

| Code                           | When                                                                                               | Path                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `source.unknown-field`         | a key outside the envelope, `params`, `result` and `subscription`                                  | `[<key>]`                                                                         |
| `source.missing-result`        | no `result`                                                                                        | `[]`                                                                              |
| `source.params-not-object`     | the JSON Schema of `params` is not `type: "object"`                                                | `["params"]`                                                                      |
| `source.invalid-subscription`  | `subscription` is not an object, has a key besides `intervalMs`, lacks it, or it is not an integer | `["subscription"]`, `["subscription", <key>]` or `["subscription", "intervalMs"]` |
| `source.interval-out-of-range` | an integer `intervalMs` outside `[100, 3 600 000]`                                                 | `["subscription", "intervalMs"]`                                                  |

The kind reports no code of its own for problems the core already reports:
`schema.invalid` and `schema.unrepresentable` for `params` and `result`,
`permission.unknown` for `requires`, `declaration.invalid-stability`, `name.*`.
Adding a code is a minor change of the package; renaming or removing one is
breaking.

### Change classification

`sourceKind.changes` is a table from the closed set of ADR 0003:

```ts
{
  fields: {
    params: { rule: "schema", direction: "input" },
    result: { rule: "schema", direction: "output" },
    subscription: {
      rule: "nested",
      table: { fields: { intervalMs: { rule: "breaking" } } },
    },
  },
}
```

A new required parameter is breaking, an optional one compatible; a removed
field of the result or a changed type is breaking, a new optional field is
compatible. Adding or removing a source is classified by the core table.

### Entry points

`"."` exports two more values, `defineSource` and the descriptor `sourceKind`,
so it exports nine values in all (this adds to "Entry points and direction of
dependencies" in ADR 0003; the allowlist in `test/smoke.test.ts` pins them).
The descriptor is exported because the function that compares versions and the
CLI read its `changes` and `diagnostics`; there is no registry.

It also exports the types `SourceInput`, `Source`, `SourceSubscription`,
`SourceSpec` and `SourceDiagnosticCode`. The string `"source"` is part of the
contract: widgets filter their references by it (`resolve(ref, { kind:
"source" })`).

### Where the code is

`packages/contract/src/kinds/source/`: `index.ts` (`defineSource`,
`sourceKind`, types), `normalize.ts`, `changes.ts` and `diagnostics.ts`. The
module imports only `../../core/*` and `zod/v4/core`, as the lint rule for
`src/kinds/**` requires.

## Known limitations

The closed set of change rules in ADR 0003 has no class for a field that
appears or disappears, and no rule that gives a direction to a number
(`ordered` takes strings). Two changes are therefore classified on the safe
side, as `breaking`:

- adding a `subscription` to an existing source, which is really compatible;
- any change of `intervalMs`, including making a feed faster, which is really
  compatible.

A false `breaking` is noisy but safe; a false `compatible` would break the
promise to consumers. Fixing this needs a presence class in the `nested` rule
and a directional rule for numbers in the core, which is a task of type
`contract` that follows the design of the version comparison function. The
table of the source kind will then be refined additively. The tests pin
today's behaviour, so the refinement shows up as a deliberate change.

## Consequences

- Widgets, intents, the runtime and codegen can rely on one shape of a source
  and on the string `"source"`.
- The format of a model does not change, so there is nothing to migrate: no
  stored configs or models of sources exist yet.
- `src/core/**` is untouched, which confirms that the mechanism of ADR 0003 is
  enough for a kind with its own codes and its own change table.
- Executing sources, streams and backpressure are the runtime's, not the
  format's: the model holds no handler.
- Changes to anything in this record are changes to the contract and go
  through tasks of type `contract`.
