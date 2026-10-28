---
"@paddockjs/contract": minor
---

Change tables get two rules (ADR 0007): `number`, with the classes of a value
growing and shrinking, and `optional`, with the classes of a field appearing
and disappearing around a rule that compares two present values; the types
`NumberRule` and `OptionalRule` are exported, and `compareModels` reports the
codes `number.increased`, `number.decreased`, `field.added` and
`field.removed`. A subscription added to a source or a lower `intervalMs` is
now compatible, and the windows of intent limits get these precise codes.
Schemas are no longer compatible when a removed property becomes required, a
new property is narrower than the previous `additionalProperties` schema, or
an output declares as optional a name it required without a declaration.
An own key `__proto__` is reported instead of being lost, and
`ComparisonResult` narrows by its literal `ok`.
