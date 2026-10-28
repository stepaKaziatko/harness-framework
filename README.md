# Harness framework

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
packages/cli        harness init / gen / check / publish
packages/react      HarnessProvider, Slot, layout renderer
packages/server     config storage API, permission gate, intents bridge
packages/sandbox    host for code plugins (Worker + remote-ui protocol)
```

Package names on npm are a working name until the naming decision lands.

## Status

Pre-alpha. Nothing is published yet. The first milestone is the contract
format, the CLI with codegen and the web renderer, proven on one real pilot
application ([harness-pilot](https://github.com/stepaKaziatko/harness-pilot)).

## Development

Verification runs on the developer's machine, not on a hosted CI: `pnpm verify`
runs typecheck, build, lint and tests, and its result is attached to the commit
as the `local/verify` status. Pull requests into `main` require that status.
Run `node scripts/local-verify.mjs` on a clean, pushed commit to do both.

## License

MIT.
