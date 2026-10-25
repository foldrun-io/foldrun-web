// The dashboard's assistant. The engine — its tools, its prompt, its checks,
// one reply — lives in the platform (foldrun-platform/src/assistant/), where
// the worker tier runs it as queued work; the web enqueues and streams
// (app/api/workspaces/[workspace]/assistant/route.ts). Re-exported here for
// the web's own callers and tests.

import "@/server/assistant-docs";

export * from "@/platform/assistant/engine";
