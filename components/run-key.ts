// The id a selected run travels under. Plain module, no React: the runs
// table (server) and the runs bulk bar (client) both import it, and a helper
// exported from a "use client" file cannot be called on the server.

export const runKey = (r: { workspace: string; id: string }) => `${r.workspace}/${r.id}`;
