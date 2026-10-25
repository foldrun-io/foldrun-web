// The assistant panel's logic: the streamed reply is read frame by frame
// however the bytes are cut, a [doc › section] citation becomes a link to
// that heading, the page the person is on is named, and a conversation read
// back from the tab survives anything unreadable.
//
//   node --import ./tests/register.mjs --test tests/assistant-model.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { conversationTitle, groupConversations, historyOf, issuesFor, linkCitations, pageContext, parseSse, readSavedChat, saveMessage } from "../components/assistant-model.ts";
import { sseFrame } from "../components/live-run-model.ts";

test("SSE frames are read whole, wherever the bytes were cut", () => {
  const wire =
    sseFrame("status", JSON.stringify({ text: "Reading flows" })) +
    ": keepalive\n\n" +
    sseFrame("text", JSON.stringify({ text: "line one\nline two" })) +
    sseFrame("done", JSON.stringify({ ok: true, reply: "hi", files: [], issues: [], sources: [] })) +
    sseFrame("error", JSON.stringify({ error: "nope", status: 402 }));
  const all = [];
  let buffer = "";
  for (let i = 0; i < wire.length; i += 7) {
    buffer += wire.slice(i, i + 7);
    const { events, rest } = parseSse(buffer);
    all.push(...events);
    buffer = rest;
  }
  assert.deepEqual(
    all.map((e) => e.event),
    ["status", "text", "done", "error"],
  );
  assert.equal((all[1] as { text: string }).text, "line one\nline two");
  assert.equal((all[2] as { reply: { reply: string } }).reply.reply, "hi");
  assert.equal((all[3] as { status?: number }).status, 402);
});

test("CRLF frames read the same as LF", () => {
  const { events, rest } = parseSse('event: text\r\ndata: {"text":"hi"}\r\n\r\nevent: done\r\ndata: {"reply":"x"}\r\n\r\n');
  assert.deepEqual(events.map((e) => e.event), ["text", "done"]);
  assert.equal(rest, "");
});

test("citations become links to the heading on the docs page", () => {
  assert.equal(
    linkCitations("Use it [flows › Every step option › Routing]."),
    "Use it [flows › Every step option › Routing](/dashboard/docs/flows#routing).",
  );
  assert.equal(linkCitations("See [tools]."), "See [tools](/dashboard/docs/tools).");
  assert.equal(linkCitations("[already](/x) stays"), "[already](/x) stays");
  assert.equal(linkCitations("[flows › x]", new Set(["agents"])), "[flows › x]");
  assert.equal(
    linkCitations("[tools › `transport: script`]"),
    "[tools › `transport: script`](/dashboard/docs/tools#transport-script)",
  );
});

test("the page the person is on, from the URL", () => {
  assert.equal(pageContext("/dashboard/desk/flows", "", "desk"), "flows");
  assert.equal(pageContext("/dashboard/desk", "", "desk"), "overview");
  assert.equal(pageContext("/dashboard/desk/edit", "?path=agents/writer/agent.md", "desk"), "edit — agents/writer/agent.md");
  assert.equal(pageContext("/dashboard/desk/assets", "?kind=tools", "desk"), "assets (tools)");
  assert.equal(pageContext("/dashboard/other/flows", "", "desk"), null);
});

test("history leaves out failures; a saved chat survives junk", () => {
  assert.deepEqual(
    historyOf([
      { role: "user", content: "hi" },
      { role: "assistant", content: "the wallet is empty", error: true },
      { role: "user", content: "again" },
    ]),
    [
      { role: "user", content: "hi" },
      { role: "user", content: "again" },
    ],
  );
  assert.deepEqual(readSavedChat("{not json"), { messages: [], files: [], issues: [], conversation: null });
  assert.deepEqual(readSavedChat(JSON.stringify({ messages: [{ role: "x", content: 1 }, { role: "user", content: "ok" }], files: "no" })).messages, [{ role: "user", content: "ok" }]);
});

test("a file's issues, and the revision note", () => {
  const issues = [
    { where: "flows/a.md:3", message: "m", level: "error" as const },
    { where: "flows/a.md", message: "n", level: "warn" as const },
    { where: "flows/ab.md", message: "o", level: "error" as const },
  ];
  assert.equal(issuesFor(issues, "flows/a.md").length, 2);
  assert.equal(saveMessage([{ role: "user", content: "  make\n a flow " }]), "written with the assistant: make a flow");
});

test("history: a title is the first question; the list is grouped by the viewer's day, newest first", () => {
  assert.equal(conversationTitle([{ role: "assistant", content: "hi" }, { role: "user", content: "  make\n a flow  " }]), "make a flow");
  assert.equal(conversationTitle([]), "(empty)");
  assert.equal(conversationTitle([{ role: "user", content: "x".repeat(120) }]).length, 80);
  const now = new Date(2026, 9, 15, 20, 0);
  const at = (d: number, h = 9) => new Date(2026, 9, d, h, 0).toISOString();
  const c = (id: string, updatedAt: string) => ({ id, workspace: "desk", title: id, updatedAt, messages: 2, unsaved: 0 });
  const groups = groupConversations([c("old", at(1)), c("today-early", at(15, 8)), c("today-late", at(15, 19)), c("yesterday", at(14)), c("week", at(11))], now);
  assert.deepEqual(groups.map((g) => [g.label, g.items.map((i) => i.id)]), [
    ["Today", ["today-late", "today-early"]],
    ["Yesterday", ["yesterday"]],
    ["This week", ["week"]],
    ["Earlier", ["old"]],
  ]);
});
