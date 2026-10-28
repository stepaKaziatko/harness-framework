---
"@paddockjs/contract": minor
---

The first public API of the contract core: `defineContract` declares the root
that a product exports from `paddock/contract.ts`; `normalize` checks it and
returns a deterministic, serializable model (`formatVersion` 1) or diagnostics
with codes from `diagnosticCodes`; `defineDeclarationKind` and
`defineExtension` let declaration kinds and extensions plug in without
changing the core; `coreChangeTable` gives the change classification of the
root and the declaration envelope. `zod` `^4.6.0` is a peer dependency.
