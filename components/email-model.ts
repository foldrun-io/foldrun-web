// The logic behind components/email.tsx, as plain functions a test can run.

/** An address split at its last "@": [local, domain], or null when it is not one. */
export function splitAddress(value: string | null | undefined): [string, string] | null {
  const v = value ?? "";
  const at = v.lastIndexOf("@");
  return at > 0 && at < v.length - 1 ? [v.slice(0, at), v.slice(at + 1)] : null;
}

const ADDRESS_IN_TEXT = /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

/** A sentence split around the addresses in it: odd indexes are addresses. */
export function splitSentence(text: string): string[] {
  return text.split(ADDRESS_IN_TEXT);
}
