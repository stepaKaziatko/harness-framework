# 0003. Contract core

## Status

Accepted; amended by ADR 0006

## Date

2026-10-28

## Context

`@paddockjs/contract` was an empty module. A product team could not write a
single promise: no identity, no names, no permissions, no way to say what is
public, and no way for data sources, intents and the presentation layer to
plug into a contract without each of them editing the same core.

The core is the base of everything else in the first milestone. Codegen and
the CLI build `contract.json` and `llm-tools.json` from it, the runtime binds
handlers by its names, and the function that compares versions reads its
change classification tables. Each of those consumers needs the core to be
deterministic, serializable and free of code, and none of them may be known
to the core itself.

The decision was designed and approved in task HAF-19 (Cadence Lab, project
HAF); the parts that matter are restated here so that this record does not
depend on the tracker.

## Decision

### Root

- The contract of a product lives in `paddock/contract.ts` and is its default
  export: `export default defineContract({ ... })`. The loader (a later CLI
  task) can take another path from a flag.
- `paddock.config.ts`, the working name, is not used for the contract. A
  `*.config.ts` file conventionally holds the settings of a tool (vite,
  vitest, eslint), and the `paddock` CLI will have such settings: the output
  directory, the registry address, the plugin mode. The contract is the
  product's promise and is imported by both the front end and the back end, so
  it should not share a file or a name with build settings. The name stays
  free for the CLI settings.
- `defineContract` belongs to the same `define*` family as the functions of
  declaration kinds. It checks nothing and never throws; it returns a deeply
  frozen copy of the plain objects and arrays of its input. Checking is done by
  `normalize`.
- Root fields: `name`, `version`, `imports`, `permissions`, `declarations`,
  `extensions`. Any other key is an error, so a typo such as `permisions` does
  not silently give a contract without permissions. Unknown fields of imports,
  permissions and subjects are errors for the same reason.

### Names, versions and ranges

- A segment matches `^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*$` and has 1 to 32
  characters. A contract name is one segment.
- A local name (of a declaration, a permission or a name an extension adds) is
  1 to 3 segments joined by `.`. Its qualified name is `<contract>.<local>` and
  has at most 64 characters.
- The grammar is narrow on purpose. Without `_`, the mapping of `.` to `_`
  gives an injective LLM tool name within 64 characters. With a letter after
  every `-`, the kebab-case to camelCase mapping of codegen is injective.
  Lowercase only, there are no collisions on case-insensitive file systems and
  in registry URLs. Widening the grammar later is compatible; narrowing it is
  breaking.
- A contract version is SemVer 2.0.0. A pre-release is allowed; build metadata
  is not, because two contracts would then share one precedence.
- An import range uses its own narrow grammar: `X.Y.Z`, `^X.Y.Z`, `~X.Y.Z` or
  `>=X.Y.Z <X.Y.Z`, joined by `||` with a space on each side, without
  pre-releases and without leading zeros. `^1.0.0||^2.0.0` is refused, although
  node-semver accepts it. Every accepted range is a valid node-semver range
  with the same meaning, so switching to `semver` later is compatible. The
  package does not depend on `semver`.

### Namespaces and references

- Declarations of all kinds and the names extensions add share one namespace
  per contract. Permissions have their own namespace, so an intent and a
  permission may both be called `orders.place`.
- The first segment of a local name may not equal the name of an import, and a
  contract may not import itself or the same contract twice.
- A reference is written one way: a local path (`quotes.feed`) for this
  contract, or `<import>.<path>` (`auth.users.get`) for an import. The model
  always stores the full qualified name. A reference into an import is checked
  for syntax and for the import only; whether the imported contract declares
  the name is not checked until imported contracts can be loaded.
- `requires` names permissions of this contract only.

### Permissions and subjects

- `permissions: { "<local name>": { subjects?, description? } }`.
- A subject is a union discriminated by `kind`. Today the only kind is
  `{ kind: "end-user" }`. Without `subjects` a permission gets
  `[{ kind: "end-user" }]`, written out in the model, so the narrowest default
  stays the narrowest when other subject kinds appear.
- `subjects: []` is an error: a permission that cannot be granted to anyone is
  a mistake, not a narrow variant.
- Subject kinds are not extensible by kinds or extensions. Who can receive
  access is decided only by a task of type `contract`, in the core.

### Stability

- One axis: `stability: "internal" | "beta" | "public"` on every declaration,
  `internal` by default and always written in the model. Only `public` is meant
  to leave the product (the public slice of `contract.json`). The core has no
  `visibility` field; the visibility of a widget on screen belongs to the
  presentation layer.
- Extensions use the same values for their named elements through
  `context.stability`.

### Declaration kinds and extensions

- There is no registry. `defineDeclarationKind({ kind, normalize, changes,
diagnostics })` returns a descriptor, and its `declare(input)` creates a
  frozen declaration with the descriptor attached under a symbol key
  (`Symbol.for("@paddockjs/contract/descriptor")`). JSON serialization does not
  see the key, a spread copy keeps it, and two copies of the package agree on
  it. A kind module builds its own `define*` on top of `declare`.
- A declaration is the core envelope `{ kind, name, stability?, requires?,
description? }` plus the payload of its kind.
- `defineExtension({ id, names, normalize, changes, diagnostics })` does the
  same for sections placed in `extensions` of the root.
- Kind names and extension ids share one space, follow the segment grammar
  and may not take a reserved area of core codes, because they prefix the
  codes of their owner. Two different descriptors with one id, or one extension
  given twice, is an error.
- `normalize(root)` runs in a fixed order:
  1. the shape of the root, identity, imports and permissions;
  2. declaration envelopes and names, `requires`, and the descriptors of
     declarations and extension sections;
  3. each declaration's kind turns it into the JSON `spec` of the model;
  4. each extension lists the names it adds to the namespace (`names`), then
     each extension turns its section into JSON (`normalize`).

  Phases 3 and 4 run only if phases 1 and 2 found no errors, so kinds never
  resolve against an incomplete namespace. An error in the spec of one
  declaration does not stop the others.

- Kinds see each other only through references by name; extensions also see
  the normalized declarations; the core sees neither.
- The context given to kinds and extensions:
  - `resolve(reference, { kind?, path? })` returns the qualified name or
    reports `reference.invalid`, `reference.unknown` or
    `reference.kind-mismatch`. The kind filter is checked for names of this
    contract only.
  - `schema(zodSchema, "input" | "output", path?)` returns JSON Schema or
    reports `schema.invalid` or `schema.unrepresentable`.
  - `report(code, path, message)` reports a code of the caller's own catalog.
  - `stability(value, path?)` checks a stability value and defaults it.
  - `contract`, the contract name; for kinds, `name`, the qualified name of the
    declaration; for extensions, `declarations`, the normalized declarations.

  Every `path` given by a kind or an extension is relative to the value it
  normalizes; the core prefixes `["declarations", i]` or `["extensions", i]`.
  Calls made after the kind or extension returned are ignored.

- The core keeps kinds and extensions in line, so that "no code in the model"
  holds by construction and not by the discipline of authors: their output must
  be plain JSON (objects with the prototype `Object.prototype` or `null`,
  arrays, strings, finite numbers, booleans, `null`); a reported code must be
  in the owner's catalog and start with `<kind>.` or `<id>.`; the change table
  must use only the closed set of rules; an exception becomes a diagnostic.

### Model

```json
{
  "contract": { "name": "trading", "version": "0.1.0" },
  "declarations": {
    "trading.quotes.feed": {
      "kind": "source",
      "requires": ["trading.quotes.read"],
      "spec": {},
      "stability": "internal"
    }
  },
  "extensions": { "presentation": {} },
  "formatVersion": 1,
  "imports": { "auth": { "range": "^1.4.0" } },
  "permissions": {
    "trading.quotes.read": { "subjects": [{ "kind": "end-user" }] }
  }
}
```

- `formatVersion`, `contract`, `imports`, `permissions` and `declarations` are
  always present, empty sections as `{}`. `extensions` is present only when
  the root has extension sections, so the model of a contract without them is
  the model with them minus the `extensions` key, byte for byte.
- `formatVersion` starts at `1` (`MODEL_FORMAT_VERSION`). It grows when a
  change cannot be ignored by an older reader (a rename, a change of meaning, a
  new required field), and every such change gets a record. An additive
  optional field does not raise it. Readers check it and answer an unknown
  value with a diagnostic instead of guessing.
- Determinism: dictionaries by name instead of arrays; object keys inserted in
  Unicode code point order at every level, so `JSON.stringify(model)` gives the
  same text without a custom serializer (JavaScript itself puts integer-like
  keys first, in numeric order, which is also deterministic); sets (`requires`,
  `subjects`, `required` in JSON Schema) sorted and without repeats; ordered
  arrays (tuples, `enum`) left as they are. `description` is absent when it is
  not given.
- Schemas: zod 4 `toJSONSchema` from `zod/v4/core` with fixed options: target
  draft 2020-12, `io` from the direction the kind gives, `unrepresentable:
"throw"`, caught and turned into a diagnostic. The dialect is one per model,
  so schemas in the model carry no `$schema` key. Each schema is a standalone
  JSON Schema document: a `$ref` inside it resolves against that schema.

### Diagnostics

- A diagnostic is `{ code, severity: "error" | "warning", path, message }`.
  `path` is a list of keys and indexes from the root of the object passed to
  `defineContract`; a permission key is one element (`"orders.place"`).
  `message` is for people and is not part of the contract.
- `normalize` returns `{ ok: true, model, diagnostics }` with warnings only, or
  `{ ok: false, diagnostics }`. It never throws on any input.
- Diagnostics come in the order of the phases, and within a phase in a fixed
  order of fields and in the order of arrays and keys of the input.
- `diagnosticCodes` maps each core code to `{ severity, summary }`; the
  severity of a diagnostic is always the severity of its code. A code is
  `<area>.<detail>` in kebab case. Reserved areas of the core: `root`,
  `contract`, `name`, `import`, `reference`, `permission`, `declaration`,
  `descriptor`, `schema`. Codes of kinds and extensions are prefixed with their
  kind or id and listed in their descriptors.
- The 28 core codes, all errors: `root.invalid-shape`, `root.unknown-field`,
  `contract.invalid-name`, `contract.invalid-version`,
  `import.invalid-contract`, `import.invalid-range`, `import.self`,
  `import.duplicate`, `name.invalid`, `name.duplicate`,
  `name.import-conflict`, `reference.invalid`, `reference.unknown`,
  `reference.kind-mismatch`, `permission.unknown`,
  `permission.unknown-subject`, `permission.empty-subjects`,
  `declaration.invalid-envelope`, `declaration.invalid-stability`,
  `declaration.unknown-kind`, `descriptor.conflict`, `descriptor.reserved-id`,
  `descriptor.invalid-changes`, `descriptor.undeclared-code`,
  `descriptor.non-json-output`, `descriptor.failed`, `schema.invalid`,
  `schema.unrepresentable`. Renaming or removing a code after a release is a
  breaking change of the package.

### Change classification tables

- A table is data from a closed set, not a function, so a test can check it
  and it can be serialized. It is
  `{ entry?: { added, removed }, fields: { <field>: <rule> } }`, where a class
  is `"breaking"` or `"compatible"` and a rule is one of:
  - `{ rule: "breaking" }`, `{ rule: "compatible" }`;
  - `{ rule: "schema", direction: "input" | "output" }`;
  - `{ rule: "set", added, removed }`;
  - `{ rule: "ordered", order: [...lowest to highest], raised, lowered }`;
  - `{ rule: "nested", table }`: a nested object; a nested table with
    `entry` describes a dictionary keyed by name.

  A field without a rule is breaking.

- Each descriptor carries its table in `changes`. The core exports its own,
  `coreChangeTable`: `contract.name` breaking, `contract.version` compatible;
  an import entry added or removed compatible, `range` breaking; a permission
  entry added compatible and removed breaking, `subjects` a set (added
  compatible, removed breaking), `description` compatible; a declaration entry
  added compatible and removed breaking, `kind` breaking, `stability` ordered
  `internal < beta < public` (raised compatible, lowered breaking), `requires`
  a set (added breaking, removed compatible), `description` compatible, and
  `spec` nested with `table: "kind"`, meaning the table of the declaration's
  kind. `formatVersion` is not in the table: a different format version is a
  diagnostic of its own.
- The function that reads the tables belongs to a later task.

### zod

- `zod` is a peer dependency, `^4.6.0`, and a development dependency pinned to
  `4.6.7`, on which the model fixtures are pinned. Products write schemas with
  their own copy of zod; the package's type declarations use `zod/v4/core`
  types, and two copies would give incompatible schema types.
- The package imports only from `zod/v4/core`, the path zod recommends for
  libraries; it accepts schemas of both `zod` and `zod/mini`.
- The lower bound is 4.6, not 4.0: the output of `toJSONSchema` differs
  between zod minors, so the bytes of the model are guaranteed only on a
  checked version. Widening the peer range later is compatible; narrowing it
  is breaking.
- Installing the packed tarballs now pulls zod from the npm registry, so
  `pnpm verify:publish`, and with it the `local/verify` status, needs network
  access to the registry.

### Entry points and direction of dependencies

- The package keeps the entry points `"."` and `"./package.json"`. The
  presentation layer will get its own entry point,
  `@paddockjs/contract/presentation`, added by the task that writes it; `"."`
  will not re-export it, so the runtime and the LLM channel do not load UI code.
- Layout of `src/`: `core/` (this record), `kinds/<kind>/` and `versioning/`
  later, `presentation/` later, `index.ts`. `eslint.config.js` enforces the
  direction with `no-restricted-imports`: `src/core/**` imports only its own
  modules and `zod/v4/core`; `src/kinds/**` and `src/versioning/**` import only
  the core; `src/index.ts` does not import the presentation layer. A test lints
  probe imports through the ESLint API, so the rule cannot disappear silently.
- `"."` exports exactly seven values, pinned by `test/smoke.test.ts`:
  `defineContract`, `normalize`, `defineDeclarationKind`, `defineExtension`,
  `diagnosticCodes`, `coreChangeTable` and `MODEL_FORMAT_VERSION`.
- `"."` exports these types:
  - root: `ContractInput`, `ContractRoot`, `ImportInput`, `PermissionInput`,
    `Subject`, `EndUserSubject`;
  - kinds and extensions: `DeclarationKindOptions`, `DeclarationKind`,
    `Declaration`, `DeclarationEnvelope`, `DeclarationContext`,
    `ExtensionOptions`, `Extension`, `ExtensionSection`, `ExtensionName`,
    `ExtensionContext`, `NormalizeContext`, `ResolveOptions`,
    `ModelDeclaration`, `Stability`;
  - model: `ContractModel`, `ModelImport`, `ModelPermission`,
    `NormalizeResult`, `JsonValue`, `JsonObject`, `JsonArray`, `JsonPrimitive`;
  - diagnostics: `Diagnostic`, `DiagnosticPath`, `DiagnosticCatalog`,
    `DiagnosticCodeInfo`, `CoreDiagnosticCode`, `Severity`;
  - change tables: `ChangeTable`, `ChangeRule`, `ChangeClass`,
    `AddRemoveClasses`, `BreakingRule`, `CompatibleRule`, `NestedRule`,
    `OrderedRule`, `SchemaRule`, `SetRule`.

## Consequences

- Sources, intents and the presentation layer are added as kinds and an
  extension without changing `src/core/**`. A later task that needs to change
  the core has found a gap in this mechanism and goes back to a design.
- The model is a stable input for codegen, the runtime and version comparison.
  Byte-for-byte comparison is a tool for fixtures on the pinned zod version;
  inside the peer range a zod minor may change the JSON Schema it emits, so
  comparing a product's contract with a published one must be semantic, not
  textual.
- Defaults (`stability: "internal"`, `subjects: [{ kind: "end-user" }]`, empty
  `requires`) are written into the model, so a later change of a default does
  not silently change the meaning of stored models.
- `local/verify` needs access to the npm registry.
- Changes to anything in this record are changes to the contract and go
  through tasks of type `contract`.
