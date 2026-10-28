// The reference contract of the core tests: an identity, two imports, two
// permissions (one without subjects) and declarations of the test kind.
// Its model is pinned in core-model.json.

import { z } from "zod";
import { defineContract } from "../../src/index.js";
import { defineProbe } from "../support/test-kind.js";
import { defineLayout } from "../support/test-extension.js";

export const quotesFeed = defineProbe({
  name: "quotes.feed",
  stability: "public",
  requires: ["quotes.read"],
  description: "Live market quotes",
  output: z.object({
    symbol: z.string().describe("Ticker symbol"),
    price: z.number(),
    venue: z.string().optional(),
  }),
  tags: ["market", "live"],
  level: "high",
});

export const placeOrder = defineProbe({
  name: "orders.place",
  stability: "beta",
  requires: ["orders.place", "quotes.read"],
  input: z.object({
    symbol: z.string(),
    quantity: z.number().int().positive(),
    type: z.enum(["market", "limit"]).default("market"),
  }),
  output: z.object({ orderId: z.string(), status: z.string().default("new") }),
  refs: [
    "quotes.feed",
    { ref: "quotes.feed", kind: "probe" },
    "auth.users.get",
  ],
  options: { retries: 2, note: "idempotent" },
});

export const ordersHistory = defineProbe({ name: "orders.history" });

export const coreRootInput = {
  name: "trading",
  version: "0.1.0",
  imports: [
    { contract: "auth", range: "^1.4.0" },
    { contract: "billing", range: ">=2.0.0 <3.0.0" },
  ],
  permissions: {
    "quotes.read": { description: "Read market quotes" },
    "orders.place": {
      subjects: [{ kind: "end-user" }],
      description: "Place an order",
    },
  },
  declarations: [quotesFeed, placeOrder, ordersHistory],
} as const;

/** The reference contract. */
export const coreRoot = defineContract(coreRootInput);

/** The same contract with sections, keys and sets in another order. */
export const coreRootReordered = defineContract({
  permissions: {
    "orders.place": {
      description: "Place an order",
      subjects: [{ kind: "end-user" }, { kind: "end-user" }],
    },
    "quotes.read": { description: "Read market quotes" },
  },
  declarations: [
    ordersHistory,
    defineProbe({
      refs: [
        "quotes.feed",
        { kind: "probe", ref: "quotes.feed" },
        "auth.users.get",
      ],
      options: { note: "idempotent", retries: 2 },
      output: z.object({
        orderId: z.string(),
        status: z.string().default("new"),
      }),
      input: z.object({
        type: z.enum(["market", "limit"]).default("market"),
        quantity: z.number().int().positive(),
        symbol: z.string(),
      }),
      requires: ["quotes.read", "orders.place", "quotes.read"],
      stability: "beta",
      name: "orders.place",
    }),
    quotesFeed,
  ],
  imports: [
    { range: ">=2.0.0 <3.0.0", contract: "billing" },
    { range: "^1.4.0", contract: "auth" },
  ],
  version: "0.1.0",
  name: "trading",
});

/** The reference contract with a section of the test extension. */
export const coreRootWithLayout = defineContract({
  ...coreRootInput,
  extensions: [
    defineLayout({
      panels: [
        { name: "quotes.panel", source: "quotes.feed", stability: "public" },
        { name: "orders.panel", source: "orders.place" },
      ],
    }),
  ],
});
