import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Bare package specifiers other than `zod/v4/core`. Relative paths start with
// `.`; `zod/v4/core` is the only package the contract core may import.
const OTHER_PACKAGES = "^(?![./])(?!zod/v4/core$)";

const outsideCore = {
  regex: "^\\.\\./",
  message:
    "The contract core (packages/contract/src/core) imports only its own modules and zod/v4/core.",
};

const otherPackages = {
  regex: OTHER_PACKAGES,
  message:
    "The contract core, kinds and versioning import no packages other than zod/v4/core.",
};

export default tseslint.config(
  { ignores: ["**/dist/", "coverage/"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs", "*.js", "*.ts"],
    languageOptions: { globals: globals.node },
  },
  // Direction of dependencies inside @paddockjs/contract (ADR 0003): the core
  // knows nothing about kinds, versioning or the presentation layer. The core
  // is one flat directory, so a core module never imports through `..`.
  {
    files: ["packages/contract/src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [outsideCore, otherPackages] },
      ],
    },
  },
  {
    // src/kinds/<kind>/*.ts: own directory and ../../core only.
    files: ["packages/contract/src/kinds/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^\\.\\./(?!\\.\\./)",
              message: "A declaration kind does not import another kind.",
            },
            {
              regex: "^\\.\\./\\.\\./(?!core/)",
              message:
                "A declaration kind imports only the contract core (src/core).",
            },
            otherPackages,
          ],
        },
      ],
    },
  },
  {
    // src/versioning/*.ts: own directory and ../core only.
    files: ["packages/contract/src/versioning/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^\\.\\./(?!core/)",
              message: "Versioning imports only the contract core (src/core).",
            },
            otherPackages,
          ],
        },
      ],
    },
  },
  {
    files: ["packages/contract/src/index.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^\\./presentation(?:\\.js|/|$)",
              message:
                "The root entry point does not import the presentation layer; it has its own entry point.",
            },
          ],
        },
      ],
    },
  },
);
