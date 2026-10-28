# 0002. Package name and npm scope

## Status

Accepted

## Date

2026-10-28

## Context

The packages were created under a temporary working scope, which the README
marked as such. Before the first release the project needs a name that can be
used on npm and on GitHub, and that does not collide with a product of someone
else.

The word "harness" is heavily used in AI tooling and is already taken around
this project's space:

- the npm scope `@harness` exists on the registry: the endpoint
  `GET https://registry.npmjs.org/-/org/harness/package` returns `200 {}`, and
  the scope has no public packages;
- the GitHub organization `harness` belongs to Harness Inc.

Four candidates were checked as a short list. The evidence was gathered in
spike HAF-15 (Cadence Lab, project HAF) and is restated here, so that the
record does not depend on that tracker. The snapshot is dated 2026-10-28.

| Candidate | Scope checked                               | Finding                                                                            | Outcome  |
| --------- | ------------------------------------------- | ---------------------------------------------------------------------------------- | -------- |
| Harness   | `@useharness` (fallback: the working scope) | Overlaps with Harness Inc. (GitHub `harness`) and with its former `harness` binary | Rejected |
| Paddock   | `@paddockjs`                                | npm scope and GitHub name are free (see below); unscoped `paddock` on npm is taken | Chosen   |
| Bridle    | `@bridlejs`                                 | Collides with the `bridle-cli` package and the `neiii/bridle` project              | Rejected |
| Corral    | `@corraljs`                                 | The `corral` binary is the dependency manager of the Pony language                 | Rejected |

Method of the scope check: the npm scope is free when
`GET https://registry.npmjs.org/-/org/<scope>/package` returns `404` with
`Scope not found`. The GitHub name is free when both
`https://api.github.com/orgs/<name>` and `https://api.github.com/users/<name>`
return `404`. The unscoped CLI name is checked with
`GET https://registry.npmjs.org/<name>`.

State recorded on the day this ADR was written (2026-10-28):

- npm scope `@paddockjs`: `404 {"error":"Scope not found"}`, free.
- npm package `paddockjs`: `404`, free.
- npm package `paddock`: taken. The package was last modified in 2022-06-23,
  and its latest version is `0.0.2`.
- GitHub `paddockjs`: user and organization endpoints both return `404`, free.
- npm scope `@harnessjs` and GitHub `HarnessJs`: they exist (npm returns `200`,
  GitHub organization and user endpoints return `200`). The project does not
  own them and does not use them. Nothing is claimed here about who does.

Trademarks were not searched formally. The check above is a check of the public
registries only.

## Decision

The product is called **Paddock**.

- npm scope: `@paddockjs`.
- Packages: `@paddockjs/contract`, `@paddockjs/cli`, `@paddockjs/react`,
  `@paddockjs/server`, `@paddockjs/sandbox`.
- CLI binary: `paddock`, with the commands `paddock init`, `paddock gen`,
  `paddock check` and `paddock publish`.
- The repositories keep their names: `harness-framework` and `harness-pilot`.
- The root package of the monorepo keeps the name `harness-framework-monorepo`.
  It is private and is never published.
- The `bin` field is not added to `packages/cli/package.json` yet, because
  there is no executable to point at. It is added together with the first CLI
  code.

## Consequences

- The scope `@paddockjs` was free on 2026-10-28 and is not reserved. Registering
  the npm organization and the GitHub organization is an action of the
  maintainer and is not part of this decision. Until it is done, the name can be
  taken by someone else. This ADR records the state at the time of writing and
  is not a reservation.
- The unscoped `paddock` name on npm is taken by an existing package last modified in 2022. The
  CLI is therefore not published under the unscoped name. Documentation refers to
  the binary as `pnpm exec paddock` inside a project, and to the package as
  `npx @paddockjs/cli`.
- Terms and paths that still say "harness" are not changed by this decision:
  the product vision document, the `.harness/generated/` output directory (which
  is git-ignored), and the repository names. They are listed here so that the
  remaining names are known.
- The organization `HarnessJs` and the scope `@harnessjs` are not owned by this
  project and are not used by it.
- Trademarks are not checked. A formal check must be done before the first
  public release.
- The contract format is not affected. `contract.json`, `llm-tools.json`, stored
  configuration, migrations and the sandbox protocol do not change because of a
  package rename. Identifiers that carry the name inside schemas (for example
  `$id` values or namespaces) take the Paddock name when they are introduced.
