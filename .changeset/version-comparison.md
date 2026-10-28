---
"@paddockjs/contract": minor
---

Version comparison: `compareModels(previous, next, { kinds, extensions })`
compares two normalized models and returns every change with its path, code
and class (breaking or compatible), the bump the changes require and a
`compare.insufficient-bump` diagnostic when the next version is not raised
enough by caret ranges. Schemas are classified by direction; kinds and
extensions pass their change tables. `changeCodes` and
`comparisonDiagnosticCodes` list the codes. The core table now classifies
extension sections, `normalize` refuses empty import ranges with
`import.empty-range`, and `compare` is a reserved code area.
