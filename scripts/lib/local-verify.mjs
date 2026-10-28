// Pure helpers of scripts/local-verify.mjs: no process spawning, no network.
// Everything here is covered by scripts/test/local-verify.test.ts.

/** Commit status context that branch protection on `main` requires. */
export const STATUS_CONTEXT = "local/verify";

/** GitHub rejects status descriptions longer than this. */
export const MAX_DESCRIPTION_LENGTH = 140;

/**
 * Checks that run before the status is set, in order. The first failing step
 * stops the run. Additional checks are added here as new entries.
 *
 * @type {ReadonlyArray<{ name: string, command: string, args: string[] }>}
 */
export const VERIFY_STEPS = [
  { name: "pnpm verify", command: "pnpm", args: ["verify"] },
];

/**
 * @typedef {object} RemoteRepository
 * @property {string} host
 * @property {string} owner
 * @property {string} repo
 */

/**
 * Parses a git remote URL in https, ssh or scp-like form.
 *
 * @param {string} url
 * @returns {RemoteRepository | null}
 */
export function parseRemoteUrl(url) {
  const trimmed = url.trim();
  const patterns = [
    // https://github.com/owner/repo(.git), optionally with user info
    /^https?:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
    // ssh://git@github.com(:22)/owner/repo(.git)
    /^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
    // git@github.com:owner/repo(.git)
    /^(?:[^@/]+@)?([^/:]+):([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(trimmed);
    if (match) {
      const [, host, owner, repo] = match;
      if (host && owner && repo) {
        return { host, owner, repo };
      }
    }
  }
  return null;
}

/**
 * @typedef {object} CliOptions
 * @property {boolean} dryRun
 * @property {boolean} help
 * @property {string | undefined} targetUrl
 */

/**
 * @param {string[]} argv arguments after the script path
 * @returns {CliOptions}
 */
export function parseArgs(argv) {
  /** @type {CliOptions} */
  const options = { dryRun: false, help: false, targetUrl: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--target-url") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--target-url requires a URL");
      }
      options.targetUrl = value;
      i += 1;
    } else if (arg?.startsWith("--target-url=")) {
      options.targetUrl = arg.slice("--target-url=".length);
      if (!options.targetUrl) {
        throw new Error("--target-url requires a URL");
      }
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

/**
 * Decides whether the run may start. Returns the refusal reason or null.
 *
 * @param {object} state
 * @param {string} state.porcelain output of `git status --porcelain --untracked-files=all`
 * @param {string} state.remoteBranches output of `git branch -r --contains <sha>`
 * @returns {string | null}
 */
export function preflightRefusal({ porcelain, remoteBranches }) {
  if (porcelain.trim() !== "") {
    return `the working tree is not clean; commit or remove these files first:\n${porcelain.trimEnd()}`;
  }
  if (remoteBranches.trim() === "") {
    return "HEAD is not on any remote branch; push it first so the status lands on a commit GitHub knows";
  }
  return null;
}

/**
 * Decides whether the result of the run may be published. Returns the
 * refusal reason or null.
 *
 * @param {object} state
 * @param {string} state.shaBefore HEAD before the run
 * @param {string} state.shaAfter HEAD after the run
 * @param {string} state.porcelain `git status --porcelain --untracked-files=all` after the run
 * @returns {string | null}
 */
export function postRunRefusal({ shaBefore, shaAfter, porcelain }) {
  if (shaBefore !== shaAfter) {
    return `HEAD moved from ${shaBefore} to ${shaAfter} during the run; the result does not describe either commit`;
  }
  if (porcelain.trim() !== "") {
    return `the run left changes in the working tree, so it did not verify the committed state:\n${porcelain.trimEnd()}`;
  }
  return null;
}

/**
 * @param {object} result
 * @param {boolean} result.passed
 * @param {string | undefined} result.failedStep name of the step that failed
 * @param {string | undefined} result.mainSha commit of the default branch merged into HEAD
 * @returns {string}
 */
export function statusDescription({ passed, failedStep, mainSha }) {
  const steps = VERIFY_STEPS.map((step) => step.name).join(" + ");
  const outcome = passed ? `${steps} passed` : `${failedStep ?? steps} failed`;
  const base = mainSha ? `, main@${mainSha.slice(0, 12)}` : "";
  return `${outcome}${base}`.slice(0, MAX_DESCRIPTION_LENGTH);
}

/**
 * Arguments for `gh` that create the commit status.
 *
 * @param {object} request
 * @param {RemoteRepository} request.remote
 * @param {string} request.sha
 * @param {"success" | "failure"} request.state
 * @param {string} request.description
 * @param {string | undefined} request.targetUrl
 * @returns {string[]}
 */
export function statusRequestArgs({
  remote,
  sha,
  state,
  description,
  targetUrl,
}) {
  const args = [
    "api",
    "--hostname",
    remote.host,
    "-X",
    "POST",
    `repos/${remote.owner}/${remote.repo}/statuses/${sha}`,
    "-f",
    `state=${state}`,
    "-f",
    `context=${STATUS_CONTEXT}`,
    "-f",
    `description=${description.slice(0, MAX_DESCRIPTION_LENGTH)}`,
  ];
  if (targetUrl) {
    args.push("-f", `target_url=${targetUrl}`);
  }
  return args;
}
