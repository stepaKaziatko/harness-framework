#!/usr/bin/env node
// Runs the local verification and attaches its result to HEAD as the
// `local/verify` commit status. There is no hosted CI: this status is what
// branch protection on `main` requires.
//
// Usage: node scripts/local-verify.mjs [--dry-run] [--target-url <url>]

import { spawnSync } from "node:child_process";
import {
  STATUS_CONTEXT,
  VERIFY_STEPS,
  parseArgs,
  parseRemoteUrl,
  postRunRefusal,
  preflightRefusal,
  statusDescription,
  statusRequestArgs,
} from "./lib/local-verify.mjs";

const EXIT_REFUSED = 2;

const USAGE = `Usage: node scripts/local-verify.mjs [--dry-run] [--target-url <url>]

Runs ${VERIFY_STEPS.map((step) => step.name).join(", ")} on a clean, pushed HEAD
and sets the ${STATUS_CONTEXT} commit status on it with gh.

  --dry-run           do everything except setting the status; print it instead
  --target-url <url>  link attached to the status (for example the task card)`;

/** @param {string} message */
function log(message) {
  process.stderr.write(`local-verify: ${message}\n`);
}

/**
 * @param {string} message
 * @returns {never}
 */
function refuse(message) {
  log(`refused, no status was set: ${message}`);
  process.exit(EXIT_REFUSED);
}

/**
 * Runs git and returns its stdout; refuses on failure.
 *
 * @param {string[]} args
 * @returns {string}
 */
function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? result.stderr.trim();
    refuse(`git ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout;
}

/** @returns {string} */
function workingTreeState() {
  return git(["status", "--porcelain", "--untracked-files=all"]);
}

/** @returns {string | undefined} */
function mergedMainSha() {
  const result = spawnSync("git", ["merge-base", "HEAD", "origin/main"], {
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function main() {
  /** @type {import("./lib/local-verify.mjs").CliOptions} */
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
    process.stderr.write(`${USAGE}\n`);
    process.exit(EXIT_REFUSED);
  }
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const originUrl = git(["remote", "get-url", "origin"]);
  const remote = parseRemoteUrl(originUrl);
  if (!remote) {
    refuse(`cannot read owner/repo from the origin URL "${originUrl.trim()}"`);
  }

  git(["fetch", "--quiet", "origin"]);
  const sha = git(["rev-parse", "HEAD"]).trim();
  const preflight = preflightRefusal({
    porcelain: workingTreeState(),
    remoteBranches: git(["branch", "-r", "--contains", sha]),
  });
  if (preflight) {
    refuse(preflight);
  }

  log(`verifying ${sha} of ${remote.owner}/${remote.repo}`);
  /** @type {string | undefined} */
  let failedStep;
  let exitCode = 0;
  for (const step of VERIFY_STEPS) {
    log(`running ${step.name}`);
    const result = spawnSync(step.command, step.args, { stdio: "inherit" });
    if (result.error) {
      log(`${step.name} could not start: ${result.error.message}`);
    }
    if (result.error || result.status !== 0) {
      failedStep = step.name;
      exitCode = result.status || 1;
      break;
    }
  }

  const postRun = postRunRefusal({
    shaBefore: sha,
    shaAfter: git(["rev-parse", "HEAD"]).trim(),
    porcelain: workingTreeState(),
  });
  if (postRun) {
    refuse(postRun);
  }

  const passed = exitCode === 0;
  const state = passed ? "success" : "failure";
  const description = statusDescription({
    passed,
    failedStep,
    mainSha: mergedMainSha(),
  });
  const ghArgs = statusRequestArgs({
    remote,
    sha,
    state,
    description,
    targetUrl: options.targetUrl,
  });

  if (options.dryRun) {
    log(`dry run, would set ${STATUS_CONTEXT}=${state} on ${sha}`);
    log(`gh ${ghArgs.join(" ")}`);
    process.exit(exitCode);
  }

  const gh = spawnSync("gh", ghArgs, { encoding: "utf8" });
  if (gh.error || gh.status !== 0) {
    const detail = gh.error?.message ?? gh.stderr.trim();
    log(`setting ${STATUS_CONTEXT}=${state} on ${sha} failed: ${detail}`);
    process.exit(exitCode || 1);
  }
  log(`${STATUS_CONTEXT}=${state} set on ${sha}: ${description}`);
  process.exit(exitCode);
}

main();
