# 0005. Intents

## Status

Accepted

## Date

2026-10-28

## Context

The contract core ([ADR 0003](0003-contract-core.md)) gives a mechanism for
declaration kinds but no kind. A product cannot declare an action, such as
placing an order (`POST /api/orders` with a symbol, a side and a quantity
between 1 and 10 000), so that a widget, a plugin or an LLM may ask for it
while the owner of the contract keeps confirmation, limits and authentication.
The vision is explicit: a widget or a plugin only declares the action; the
host confirms it, limits it and checks who may perform it.

An intent is the second piece of the contract that the runtime, codegen and
`llm-tools.json` read. The runtime binds a handler to it by its qualified
name, shows the confirmation dialog, counts calls and checks grants; codegen
turns its parameters into the input of an LLM tool; the function that
compares versions classifies its changes. None of them may find code in the
model.

The decision was designed and approved in task HAF-21 (Cadence Lab, project
HAF); the parts that matter are restated here so that this record does not
depend on the tracker.

## Decision

### Module and exports

- The kind lives in `packages/contract/src/kinds/intent/`. It imports only the
  core (`../../core/*`) and `zod/v4/core`, never another kind; the existing
  ESLint rule for `src/kinds/**` enforces it. The core does not change.
- `"."` exports two more values, so nine in total: `defineIntent` and
  `intentKind`, the descriptor created with `defineDeclarationKind({ kind:
"intent", ... })`. Its `changes` is the change table below and its
  `diagnostics` the catalog of `intent.*` codes; the function that compares
  versions and the generators take them from there.
- `"."` exports four more types: `IntentInput` (the input of `defineIntent`),
  `ConfirmationPolicy`, `IntentLimits` and `IntentSpec` (the shape of `spec`
  in the model). This extends the list of exports in ADR 0003, which is not
  edited.
- `defineIntent` wraps `intentKind.declare`. Like `defineContract`, it checks
  nothing and never throws; `normalize` does the checking. The types of the
  `params` and `result` schemas stay in the type of the declaration, so the
  runtime bridge can derive a handler type from it without a second
  declaration.

### Fields and defaults

| Field          | Input                                                                   | `spec` in the model                      | When absent                              |
| -------------- | ----------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------- |
| `params`       | zod schema, `input` direction, `type: "object"` at the top level        | JSON Schema                              | `{ "properties": {}, "type": "object" }` |
| `result`       | zod schema, `output` direction                                          | JSON Schema                              | `{}` (any value)                         |
| `confirmation` | `"none"`, `"user"` or `"step-up"`; required                             | `{ "policy": "<value>" }`                | `intent.missing-confirmation`            |
| `limits`       | `{ perMinute?, perHour?, perDay? }`                                     | the same object                          | `{}`                                     |
| `invalidates`  | references to sources of this contract                                  | qualified names, sorted, without repeats | `[]`                                     |
| envelope       | `name`, `stability`, `requires` (required, at least one), `description` | the core envelope                        | `intent.missing-requires` for `requires` |

- Defaults are written into the model, as in ADR 0003: a later change of a
  default does not change the meaning of stored models, and the comparison of
  versions sees "no result declared" turn into "a result declared" as a
  narrowing of the output schema.
- A key whose value is `undefined` counts as absent, as in the core envelope.
- The set of keys is closed: `kind`, `name`, `stability`, `requires`,
  `description`, `params`, `result`, `confirmation`, `limits`,
  `invalidates`. Any other key is `intent.unknown-field` at the path of that
  key, one diagnostic per key. A handler (`handler`, `execute`) cannot be put
  into a declaration, and a typo such as `confirm` does not silently give an
  intent without confirmation.

### Parameters and result

- `params` is optional. It is converted with `context.schema(..., "input")`;
  a value that is not a zod schema is `schema.invalid` and a schema that
  cannot be represented is `schema.unrepresentable` (core codes). A converted
  schema without `type: "object"` at the top level, such as a string or a
  union of objects, is `intent.params-not-object`: the input of an LLM tool
  and the body of a call through the intent proxy are objects with named
  fields. `z.record(...)` is an object and passes. One diagnostic per field:
  when the core has already reported `schema.*`, `intent.params-not-object`
  is not added.
- `result` is optional, converted in the `output` direction, and may have any
  shape.

### Confirmation

- `none`: the host performs the intent without a question. `user`: before it
  performs the intent, the host shows its own confirmation dialog to the end
  user, with the parameters of the call. `step-up`: the host asks the subject
  to authenticate again (a PIN, a second factor) first.
- There is no default. A missing `confirmation` is
  `intent.missing-confirmation`; any other value (`"always"`, `true`, the
  object form `{ policy: "user" }`) is `intent.unknown-confirmation`. Like an
  allowlist, the owner has to decide whether a question is needed instead of
  getting no question by default.
- The model holds an object `{ policy }`, not a string, so later refinements
  (for example how long a confirmation stays valid) can be added as optional
  fields without raising `formatVersion`. The input is a string only.

### Limits

- `limits` bounds the number of calls of one intent by one subject (today the
  end user) per window. Whether the window slides or is fixed is up to the
  runtime. A bound on a parameter value, such as "at most 10 000 shares",
  belongs to `params` (`.max(10_000)`), not here.
- `intent.invalid-limit`:
  - `limits` is not an object, at `limits`;
  - an unknown window (`perWeek`), at the path of the window;
  - a value that is not a positive safe integer, at the path of the window;
  - windows out of order: among the windows that are present and valid,
    taken from the smallest (minute, hour, day) and skipping the absent ones,
    a smaller window that allows more calls than the next larger one. That
    bound could never be reached. The diagnostic is at the smaller window,
    one per pair; equal values are allowed. `{ perMinute: 100, perDay: 50 }`
    is an error even without `perHour`.

### `requires` is required

- An intent names at least one permission. A missing or empty `requires` is
  `intent.missing-requires` at `["declarations", i, "requires"]`, and the input
  type is a non-empty tuple, so `tsc` sees the mistake too.
- An intent is an action with a side effect on behalf of a subject. Without a
  permission, anyone who is shown a widget or given a plugin could act, while
  the vision requires an allowlist by default and grants checked by the host.
  An action that every end user may perform is expressed by a permission
  without narrowed subjects: explicit, and with a name the grants screen can
  show.
- Whether each permission exists is checked by the core in phase 2
  (`permission.unknown`). Phases 3 and 4 do not run after an error in phases 1
  and 2, so `requires: ["nope"]` gives only `permission.unknown`.

### `invalidates`: sources of its own contract

- After an intent succeeds, the sources listed in `invalidates` are stale.
  What to do about it (read again, drop a cache, notify subscribers) is up to
  the delivery channel or the runtime, but the knowledge lives in the
  contract instead of being guessed by every channel. An LLM is told "read the
  balance again after this call", and so is any later service.
- A value that is not an array, or an entry that is not a string, is
  `intent.invalid-invalidates`. Each entry is resolved with
  `context.resolve(ref, { kind: "source", path: ["invalidates", j] })`: an
  undeclared name is `reference.unknown`, a name of another kind (an intent,
  the intent itself) is `reference.kind-mismatch`, a malformed name is
  `reference.invalid`.
- Only sources of this contract: a reference into an import
  (`auth.users.get`) is `intent.foreign-invalidates`. The owner cannot promise
  that its action changes data of another contract, and the core cannot check
  the kind of an imported name. Allowing it later is compatible.
- Repeats collapse silently, as in `requires`.
- The intent kind depends on the source kind only through the kind name
  `"source"`.

### Diagnostics

- `intentKind.diagnostics` holds exactly eight codes, all errors:
  `intent.unknown-field`, `intent.params-not-object`,
  `intent.missing-confirmation`, `intent.unknown-confirmation`,
  `intent.invalid-limit`, `intent.missing-requires`,
  `intent.invalid-invalidates`, `intent.foreign-invalidates`. The core
  catalog `diagnosticCodes` does not change.
- The kind also reports core codes through the context: `schema.invalid` and
  `schema.unrepresentable` on `params` and `result`, `reference.*` on
  `invalidates`.
- All problems of one declaration are reported in one pass, in a fixed order
  of fields: unknown keys, `requires`, `params`, `result`, `confirmation`,
  `limits`, `invalidates`. A problem in one intent does not stop the check of
  another.
- Renaming or removing a code after a release is a breaking change of the
  package; adding one is a minor change.

### Change classification table

`intentKind.changes` uses only the closed set of rules of ADR 0003:

| `spec` field   | Rule                                                                                       | Why                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `params`       | `schema`, `input`                                                                          | A new required parameter breaks callers; a new optional one does not.                                                                                                                 |
| `result`       | `schema`, `output`                                                                         | Removing a field or changing its type breaks readers of the result; `{}` turning into a concrete schema is a narrowing.                                                               |
| `confirmation` | `nested`, `policy`: `ordered` `none < user < step-up`, raised compatible, lowered breaking | Lowering weakens what the user granted (a call without a question) and needs a major version and new grants. Raising breaks no caller: the host confirms, a plugin only waits longer. |
| `limits`       | `nested`, `perMinute`, `perHour`, `perDay`: `compatible`                                   | Limits protect the owner. Tightening them against abuse should not need a major version that disables every plugin. A caller must handle a refusal by limit in any case.              |
| `invalidates`  | `set`, added compatible, removed compatible                                                | A freshness hint carried out by the host; changing it either way breaks no caller.                                                                                                    |

Removing an intent and changes of `kind`, `requires` and `stability` are
classified by `coreChangeTable`; the kind does not repeat them. A future
`spec` field without a row is breaking, as ADR 0003 says.

### Conventions of the second wave

Sources, intents and the comparison of versions are written in parallel.
They agree on:

- a kind exports `define<Kind>` and `<kind>Kind`;
- `params` is an optional `input` schema with an object at the top level,
  an empty object schema by default. Kinds do not import each other and this
  check does not move into the core, so each kind has its own copy of it.

### Known limitation

The closed set of rules has no classes for presence ("the field appeared")
and no directional numeric rule. For intents this matters only for the keys
`limits.perMinute`, `perHour` and `perDay`, which may appear or disappear;
every other field of `spec` is always written (`params`, `result` and
`invalidates` with their defaults, `confirmation` because it is required).
The table makes each window compatible in either direction, so intents need
no numeric rule. How a `nested` rule classifies a key that appears or
disappears is decided by the design of the comparison of versions, not
here.

## Consequences

- A product declares an action with `defineIntent` and gets a model entry of
  kind `intent` with JSON Schema of its parameters and result, its
  confirmation policy, its limits, its permissions and the sources it makes
  stale, and no handler. The host has everything it needs to confirm, limit
  and authorize a call; the widget or plugin has no way to skip it.
- The default `stability` of the core (`internal`), a confirmation without a
  default and a required `requires` keep the allowlist: none of the defaults
  (`limits: {}`, `invalidates: []`, `result: {}`) gives a caller more than it
  had.
- The model format stays at `formatVersion` 1: a new kind is a new value of
  `kind` inside the existing shape of `declarations`.
- The tests of `invalidates` use a stand-in source kind until the source kind
  is merged; replacing it does not change the expected codes and paths.
- Changes to anything in this record are changes to the contract and go
  through tasks of type `contract`.
