# Contributing

This file describes the path of a change from a branch to a merge into `main`.
Verification runs on the developer's machine, not on a hosted service: there are
no GitHub Actions workflows here, and nothing is built or tested on GitHub.

## Setup

- Node 20 or newer (the `engines` field). pnpm is pinned by the
  `packageManager` field; enable it with `corepack enable`.
- Run `pnpm install`. Inside a git checkout its `prepare` script sets
  `core.hooksPath` to `.githooks`, which installs the pre-push hook described
  below.

## Branches and worktrees

- The main clone stays on `main`. Do not switch branches in it.
- Each change is developed in its own worktree, created from a fresh
  `origin/main`:

  ```sh
  git fetch origin
  git worktree add ../.worktrees/<key>/<repo> -b clab/<key>-<slug> origin/main
  ```

  Run it from the main clone. `<key>` is the task key and `<slug>` is a short
  description, for example `clab/HAF-14-contributing-adr`. The task key goes
  into the branch name and into the card link in the pull request body, not
  into commit subjects or pull request titles. `.worktrees/` is listed in
  `.gitignore`.

- If the branch already exists (a change returned to development), continue
  on it instead of creating it again.
- After the first push, history is not rewritten: no rebase, no amend, no
  force-push. To bring in a newer `main`, merge it:

  ```sh
  git fetch origin && git merge origin/main
  ```

## Verification

`pnpm verify` runs four steps in this order and stops at the first failure
with a non-zero exit code:

1. `pnpm typecheck`: `tsc -p tsconfig.typecheck.json`.
2. `pnpm build`: `tsc -b`.
3. `pnpm lint`: `eslint .`, then `prettier --check .`. Prettier also checks
   Markdown; `pnpm format` rewrites files to the expected form.
4. `pnpm test`: `vitest run`.

Tests travel in the same commit as the behaviour they cover. New behaviour
without a test is not ready for review.

The result of the local run is attached to the commit as the `local/verify`
commit status by `scripts/local-verify.mjs`:

```sh
node scripts/local-verify.mjs [--target-url <url>] [--dry-run]
```

- The script runs the verify steps listed in `scripts/local-verify.mjs` on
  `HEAD`, then sets `local/verify` on that commit with `gh api`: `success` if
  the run passed, `failure` if it did not.
- It needs `gh` installed and authenticated with access that can write commit
  statuses on the repository. The owner and repository are read from `origin`.
- `--target-url` attaches a link to the status. For a task, use the task card:
  `https://sdlc.food-cart.ru/p/HAF/tasks/<key>`.
- `--dry-run` runs the steps and prints the status request without setting it.
- The script refuses, sets no status and exits with code 2 when the working
  tree is not clean, including untracked files, or when `HEAD` is not on any
  remote branch. Commit or push the work and run it again. It also refuses if
  `HEAD` or the working tree changes during the run.
- A status describes one commit. A new commit needs a new run and a new status.
- `pnpm verify:publish`, one of those steps, installs the packed tarballs with
  `npm install`, which fetches their dependencies (such as the `zod` peer of
  `@paddockjs/contract`) from the npm registry. It and therefore
  `scripts/local-verify.mjs` need network access to the registry; there is no
  offline mode.

The pre-push hook (`.githooks/pre-push`) only prints a reminder to run
`scripts/local-verify.mjs`. It does not block a push and does not set a commit
status.

## Pull requests

- Open the pull request once the branch is pushed, and keep it open until the
  task is done. One pull request per repository for a change.
- The title is one sentence about what is true after the change. It has no
  task key, no `feat:` or `fix:` prefix, and is at most about 72 characters.
  The task key lives in the branch name and in the card link in the body.
- The body follows `.github/pull_request_template.md`: the sections "What is
  true after this change", "Why it was allowed" and "How it was verified", and
  the link to the task card.
- If the change alters behaviour that the docs describe, update the docs in
  the same pull request.
- Before asking for a merge, bring in `origin/main`, run `pnpm verify` on the
  result and run `scripts/local-verify.mjs` on the new head commit. The
  `local/verify` status must be `success` on the head commit.
- Check that the pull request is mergeable:
  `gh pr view <number> --json mergeable,mergeStateStatus`.

### Branch protection on `main`

As of this writing, branch protection on `main` requires the `local/verify`
status and requires the branch to be up to date with `main` (`strict`). Only
squash merges are enabled in the repository settings, and the branch is deleted
after the merge. Repository administrators are not bound by the protection at
the moment (`enforce_admins` is off), so the rules above are kept by the
author and the reviewer of each change as well as by GitHub.

## Commits and squash subjects

- A commit subject is one sentence about what is true after the change, in
  English, at most about 72 characters. It has no `feat:` or `fix:` prefix and
  no task key.
- A body, if there is one, says why the change was allowed.
- A commit written with an AI agent carries a `Co-Authored-By:` trailer that
  names the model which wrote it.
- Every change reaches `main` as one squash commit. Its subject follows the
  same rule as the pull request title, because it is the only line of that
  change that stays in the history of `main`.

## Changesets

- A pull request that changes the public API of a package under `packages/`
  adds a changeset in the same pull request: run `pnpm changeset` and commit the
  file it creates. A pull request that changes no package does not need one.
  An empty changeset (`pnpm changeset add --empty`) is allowed.
- `pnpm changeset status` is not part of `pnpm verify`. The reviewer runs it on
  the pull request as `pnpm changeset status --since=origin/main`. That form
  exits with code 1 when a package changed without a changeset, and with code 0
  when no package changed or every changed package has one. Without `--since`
  the command exits with code 0 even when a package changed, so do not use it
  for this check.
- Publishing to npm is a separate task and is done locally. A change does not
  publish a package.

## Contract

The contract is made of `packages/contract`, `contract.json`, `llm-tools.json`,
the format of stored configs and grants, the format of migrations, and the
sandbox protocol. These change only in tasks of type `contract`, which begin
with a design by the contract keeper and get a second review from it. Until
the second pilot the format is not frozen, but every change to it must be
migratable.

If a task of type `task` seems to require a change to the contract, stop and
return the task with a description of what would change and why.

## Language

Everything in the repository is in English: code, comments, README, docs, ADRs,
commit messages, pull request titles and bodies, and issues.

## Architecture decisions

Architecture decisions are recorded in `docs/adr/`, following the format in
[docs/adr/0001-record-architecture-decisions.md](docs/adr/0001-record-architecture-decisions.md).
An accepted record is not rewritten; a reversal is a new record that refers to
the old one.
