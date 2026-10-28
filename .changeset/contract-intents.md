---
"@paddockjs/contract": minor
---

Intents: `defineIntent` declares an action that a widget, a plugin or an LLM
may ask the host to perform, with `params` and `result` schemas, a required
confirmation policy (`none`, `user` or `step-up`), per-subject `limits`,
required `requires` and the sources it `invalidates`. `normalize` writes it
into the model as a declaration of kind `intent` without a handler, or
reports `intent.*` diagnostics. `intentKind` carries the change
classification table and the catalog of codes of the kind. The model format
stays at `formatVersion` 1.
