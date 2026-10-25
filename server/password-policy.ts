// What a password has to be. NIST 800-63B, not the 1990s: length over
// composition rules, no forced rotation, and a check against passwords that
// have already leaked — which is the one rule that measurably matters.
//
// The breach check is Have I Been Pwned's k-anonymity range API: the first
// five hex characters of the SHA-1 go over the wire, the password never does,
// and the answer is a list of suffixes to compare locally. It fails OPEN on a
// network error — a sign-up that cannot complete because a third party is
// down is worse than one that skipped this check, and the failure is logged.

import crypto from "node:crypto";

export const MIN_PASSWORD = 10;

export async function assertPasswordPolicy(password: string, email?: string): Promise<void> {
  if (password.length < MIN_PASSWORD) throw new PolicyError(`password must be at least ${MIN_PASSWORD} characters`);
  if (password.length > 256) throw new PolicyError("password is too long");
  const lower = password.toLowerCase();
  if (email) {
    const local = email.toLowerCase().split("@")[0];
    if (local.length >= 4 && lower.includes(local)) throw new PolicyError("password must not contain your email address");
  }
  if (/^(.)\1+$/.test(password) || /^(0123456789|1234567890|qwertyuiop|password|letmein)/i.test(password)) {
    throw new PolicyError("that password is too easy to guess");
  }
  if (await breached(password)) {
    throw new PolicyError("that password has appeared in a data breach — choose one that has not");
  }
}

export class PolicyError extends Error {
  status = 400;
}

async function breached(password: string): Promise<boolean> {
  if (process.env.FOLDRUN_SKIP_BREACH_CHECK === "1") return false; // tests, air-gapped installs
  const sha = crypto.createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = sha.slice(0, 5), suffix = sha.slice(5);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "foldrun" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const body = await res.text();
    return body.split("\n").some((line) => {
      const [suf, count] = line.trim().split(":");
      return suf === suffix && Number(count) > 0;
    });
  } catch (err) {
    console.warn("[password] breach check unavailable:", err instanceof Error ? err.message : err);
    return false;
  }
}
