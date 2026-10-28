import { describe, expect, it } from "vitest";
import {
  MAX_DESCRIPTION_LENGTH,
  STATUS_CONTEXT,
  VERIFY_STEPS,
  parseArgs,
  parseRemoteUrl,
  postRunRefusal,
  preflightRefusal,
  statusDescription,
  statusRequestArgs,
} from "../lib/local-verify.mjs";

describe("parseRemoteUrl", () => {
  it.each([
    "https://github.com/acme/widgets.git",
    "https://github.com/acme/widgets",
    "https://github.com/acme/widgets/",
    "https://user@github.com/acme/widgets.git",
    "git@github.com:acme/widgets.git",
    "git@github.com:acme/widgets",
    "ssh://git@github.com/acme/widgets.git",
    "ssh://git@github.com:22/acme/widgets.git",
    "https://github.com/acme/widgets.git\n",
  ])("reads owner and repo from %j", (url) => {
    expect(parseRemoteUrl(url)).toEqual({
      host: "github.com",
      owner: "acme",
      repo: "widgets",
    });
  });

  it("keeps the host of a non-github.com remote", () => {
    expect(parseRemoteUrl("git@ghe.example.com:acme/widgets.git")).toEqual({
      host: "ghe.example.com",
      owner: "acme",
      repo: "widgets",
    });
  });

  it.each(["", "widgets", "/local/path/widgets", "https://github.com/acme"])(
    "rejects %j",
    (url) => {
      expect(parseRemoteUrl(url)).toBeNull();
    },
  );
});

describe("parseArgs", () => {
  it("defaults to a real run", () => {
    expect(parseArgs([])).toEqual({
      dryRun: false,
      help: false,
      targetUrl: undefined,
    });
  });

  it("reads --dry-run and --target-url in both forms", () => {
    expect(
      parseArgs(["--dry-run", "--target-url", "https://x.test/t"]),
    ).toEqual({ dryRun: true, help: false, targetUrl: "https://x.test/t" });
    expect(parseArgs(["--target-url=https://x.test/t"]).targetUrl).toBe(
      "https://x.test/t",
    );
  });

  it("rejects unknown arguments, so there is no way to force a status", () => {
    expect(() => parseArgs(["--force"])).toThrow(/unknown argument: --force/);
  });

  it("rejects --target-url without a value", () => {
    expect(() => parseArgs(["--target-url"])).toThrow(/requires a URL/);
    expect(() => parseArgs(["--target-url", "--dry-run"])).toThrow(
      /requires a URL/,
    );
    expect(() => parseArgs(["--target-url="])).toThrow(/requires a URL/);
  });
});

describe("preflightRefusal", () => {
  const pushed = "  origin/clab/HAF-12-monorepo-scaffold\n";

  it("allows a clean tree whose HEAD is on a remote branch", () => {
    expect(preflightRefusal({ porcelain: "", remoteBranches: pushed })).toBe(
      null,
    );
  });

  it("refuses a modified tracked file", () => {
    expect(
      preflightRefusal({ porcelain: " M README.md\n", remoteBranches: pushed }),
    ).toMatch(/not clean[\s\S]*README\.md/);
  });

  it("refuses an untracked file", () => {
    expect(
      preflightRefusal({ porcelain: "?? notes.txt\n", remoteBranches: pushed }),
    ).toMatch(/not clean[\s\S]*notes\.txt/);
  });

  it("refuses a HEAD that is on no remote branch", () => {
    expect(preflightRefusal({ porcelain: "", remoteBranches: "" })).toMatch(
      /not on any remote branch/,
    );
  });
});

describe("postRunRefusal", () => {
  it("allows an unchanged HEAD and a clean tree", () => {
    expect(
      postRunRefusal({ shaBefore: "a", shaAfter: "a", porcelain: "" }),
    ).toBe(null);
  });

  it("refuses when HEAD moved during the run", () => {
    expect(
      postRunRefusal({ shaBefore: "a", shaAfter: "b", porcelain: "" }),
    ).toMatch(/HEAD moved from a to b/);
  });

  it("refuses when the run left changes behind", () => {
    expect(
      postRunRefusal({
        shaBefore: "a",
        shaAfter: "a",
        porcelain: "?? packages/cli/out.js\n",
      }),
    ).toMatch(/left changes[\s\S]*out\.js/);
  });
});

describe("statusDescription", () => {
  const mainSha = "c427604d72a9927eede55806fba8eee75cc519f0";

  it("names the steps and the merged main commit", () => {
    expect(
      statusDescription({ passed: true, failedStep: undefined, mainSha }),
    ).toBe("pnpm verify passed, main@c427604d72a9");
    expect(
      statusDescription({ passed: false, failedStep: "pnpm verify", mainSha }),
    ).toBe("pnpm verify failed, main@c427604d72a9");
  });

  it("omits main when it is unknown", () => {
    expect(
      statusDescription({
        passed: true,
        failedStep: undefined,
        mainSha: undefined,
      }),
    ).toBe("pnpm verify passed");
  });

  it("never exceeds the GitHub limit", () => {
    const description = statusDescription({
      passed: false,
      failedStep: "x".repeat(500),
      mainSha,
    });
    expect(description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
  });
});

describe("statusRequestArgs", () => {
  const remote = { host: "github.com", owner: "acme", repo: "widgets" };

  it("posts the local/verify status on the given commit", () => {
    expect(
      statusRequestArgs({
        remote,
        sha: "abc",
        state: "success",
        description: "pnpm verify passed",
        targetUrl: undefined,
      }),
    ).toEqual([
      "api",
      "--hostname",
      "github.com",
      "-X",
      "POST",
      "repos/acme/widgets/statuses/abc",
      "-f",
      "state=success",
      "-f",
      "context=local/verify",
      "-f",
      "description=pnpm verify passed",
    ]);
  });

  it("adds the target URL when given", () => {
    expect(
      statusRequestArgs({
        remote,
        sha: "abc",
        state: "failure",
        description: "pnpm verify failed",
        targetUrl: "https://x.test/t",
      }).slice(-2),
    ).toEqual(["-f", "target_url=https://x.test/t"]);
  });
});

describe("constants", () => {
  it("uses the context that branch protection requires", () => {
    expect(STATUS_CONTEXT).toBe("local/verify");
  });

  it("runs pnpm verify first", () => {
    expect(VERIFY_STEPS[0]).toEqual({
      name: "pnpm verify",
      command: "pnpm",
      args: ["verify"],
    });
  });
});
