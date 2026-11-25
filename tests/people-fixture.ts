// Real logins for a test's people. Since FOL-320 a key minted for a person (the keys
// route, `foldrun login`, rotation) is written only while that person is on the team,
// so a fixture that names one must have made them.
export async function ensurePeople(tenant: string, people: { email: string; role?: "owner" | "admin" | "editor" | "viewer"; workspaces?: string[] | null }[]): Promise<void> {
  process.env.FOLDRUN_OPEN_SIGNUP = "1";
  const users = await import("../server/users.ts");
  const password = "fixture password long enough 1";
  for (const p of people) {
    if (await users.findUser(p.email)) continue;
    const owner = !p.role || p.role === "owner";
    const exists = (await users.listMembers(tenant).catch(() => [])).length > 0;
    const join = () => users.createUser(p.email, password, tenant, { joining: true, role: owner ? "admin" : (p.role as "admin" | "editor" | "viewer"), workspaces: p.workspaces ?? null });
    // A tenant whose folder the test made first reads as a taken name: join it instead.
    const u = owner && !exists ? await users.createUser(p.email, password, tenant, { request: "free" }).catch(join) : await join();
    await users.setEmailVerified(u.id);
  }
}
