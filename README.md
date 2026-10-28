# Paddock

A contract-first customization layer for existing products. The product team
describes its core once — data sources, intents, widgets, slots, permissions —
as a thin typed contract over the code it already has. End users then arrange
the interface for themselves strictly inside that contract: by hand, through an
LLM that generates validated configs, or (optionally) with code plugins that run
in a sandbox.

The core is described, not rewritten.

## Layers

| Layer        | Purpose                                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| Contract     | `defineWidget` / `defineSource` / `defineIntent` in TypeScript + zod                                            |
| Codegen      | types, widget registry, config validator, LLM tool schema, fixtures, `contract.json`                            |
| Runtime      | config and grant storage on the product's backend, layout resolver, permission gate, intents bridge, migrations |
| Renderer SDK | web first, React Native next                                                                                    |

## Packages

```
packages/contract   defineWidget / defineSource / defineIntent, shared types
packages/cli        paddock init / gen / check / publish
packages/react      PaddockProvider, Slot, layout renderer
packages/server     config storage API, permission gate, intents bridge
packages/sandbox    host for code plugins (Worker + remote-ui protocol)
```

The packages are published under the `@paddockjs` npm scope, as
`@paddockjs/<package>`; the CLI binary is `paddock`. The decision and its
evidence are in `docs/adr/0002-package-name-and-npm-scope.md`. The repositories
are still named `harness-framework` and `harness-pilot`.

## Status

Pre-alpha. Nothing is published yet. The first milestone is the contract
format, the CLI with codegen and the web renderer, proven on one real pilot
application ([harness-pilot](https://github.com/stepaKaziatko/harness-pilot)).

## Development

Verification runs on the developer's machine, not on a hosted CI: `pnpm verify`
runs typecheck, build, lint and tests, and `pnpm verify:publish` packs every
package, installs the tarballs into a temporary project outside the repository
and checks that each one imports from `dist`, type-checks on `nodenext`
resolution and refuses deep imports past its `exports`. The result of both is
attached to the commit as the `local/verify` status. Pull requests into `main`
require that status. Run `node scripts/local-verify.mjs` on a clean, pushed
commit to do both. `pnpm verify:publish`, and so `local/verify`, needs network
access to the npm registry, because installing the tarballs fetches their
dependencies from it.

## License

MIT.
