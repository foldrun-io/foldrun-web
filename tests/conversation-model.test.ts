// The run page's line about a conversation (FOL-162): what it says before
// the first step starts, after it read earlier runs, and for an A2A caller's.
//
//   node --import ./tests/register.mjs --test tests/conversation-model.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { conversationNote } from "../components/conversation-model.ts";

const step = (over: Record<string, unknown> = {}) => ({ agent: "a", instruction: "", group: 1, optional: false, status: "completed", events: [], result: null, costUsd: null, ...over }) as never;

test("no context, no line; waiting, first, and given runs each say so", () => {
  assert.equal(conversationNote({ steps: [step()] }), "");
  const ctx = { id: "c", key: "k" };
  assert.match(conversationNote({ context: ctx, steps: [step({ conversationTurn: true, status: "pending" })] }), /reads the earlier runs when it starts/);
  assert.match(conversationNote({ context: ctx, steps: [step({ conversationTurn: true })] }), /first run in it/);
  const given = conversationNote({ context: ctx, steps: [step({ conversationTurn: true, history: { context: "c", runs: ["r1", "r2"], omitted: 3, truncated: 1, chars: 900, hash: "h" } })] });
  assert.match(given, /read 2 earlier runs \(3 older did not fit\), 1 cut short/);
  assert.match(conversationNote({ context: { ...ctx, a2a: true }, steps: [step()] }), /^An outside agent's conversation \(A2A\)/);
});
