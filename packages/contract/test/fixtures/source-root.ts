// The reference contract of the source kind tests: the quotes feed that the
// pilot dashboard polls once per second, and the history with parameters.
// Its model is pinned in source-model.json.

import { z } from "zod";
import { defineContract, defineSource } from "../../src/index.js";

export const Quote = z.object({
  symbol: z.string(),
  name: z.string(),
  priceCents: z.number().int(),
  prevCloseCents: z.number().int(),
  updatedAt: z.iso.datetime(),
});

export const HistoryParams = z.object({
  symbol: z.string().min(1),
  limit: z.number().int().min(1).max(500).default(120),
});

export const History = z.object({
  symbol: z.string(),
  points: z.array(
    z.object({ ts: z.iso.datetime(), priceCents: z.number().int() }),
  ),
});

/** One subscription per screen, no parameters, at most one update per second. */
export const quotesFeed = defineSource({
  name: "quotes.feed",
  description: "Latest quotes of all instruments",
  result: z.array(Quote),
  subscription: { intervalMs: 1000 },
  requires: ["quotes.read"],
  stability: "beta",
});

/** A single read with the parameters symbol and limit. */
export const quotesHistory = defineSource({
  name: "quotes.history",
  params: HistoryParams,
  result: History,
  requires: ["quotes.read"],
});

export const sourceRootInput = {
  name: "trading",
  version: "0.1.0",
  permissions: { "quotes.read": { description: "Read market quotes" } },
  declarations: [quotesFeed, quotesHistory],
} as const;

export const sourceRoot = defineContract(sourceRootInput);

/** The same declarations in the other order. */
export const sourceRootReordered = defineContract({
  ...sourceRootInput,
  declarations: [quotesHistory, quotesFeed],
});
