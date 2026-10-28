---
"@paddockjs/contract": minor
---

The source kind: `defineSource` declares a named read of data with
parameters, a result schema and an optional subscription whose update interval
(100 ms to 1 hour) is declared by the owner of the data. `normalize` turns it
into a `source` entry of the model with JSON Schemas of the parameters and of
the result, and reports `source.*` diagnostics. `sourceKind` exposes the
descriptor with its change classification table and its catalog of codes.
