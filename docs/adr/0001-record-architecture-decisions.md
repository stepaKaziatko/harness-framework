# 1. Record architecture decisions

## Status

Accepted

## Context

Architecture decisions for this repository are discussed in pull requests,
in task cards and in chat. None of those places travels with the code: they
are hard to find later, they do not say which option was chosen in the end,
and a reader of the code cannot tell why a rule holds or whether it was ever
reconsidered.

## Decision

We record architecture decisions in `docs/adr/` as short Markdown files named
`NNNN-<slug>.md`, where `NNNN` is the next free four-digit number. A record
follows the structure of this one: Status, Context, Decision, Consequences.

A decision that changes the architecture, a repository rule or a public API
gets a record. An accepted record is not rewritten. When a decision is
reversed or replaced, a new record is added that refers to the old one, and
the old file stays as it was.

## Consequences

A reader who wants to know why something is the way it is finds the answer in
`docs/adr/` next to the code, not in a chat or a card that may be gone. Writing
a record costs a short file in the same pull request as the decision. Changing
an old record is not an option, so the history of the decisions stays readable.
