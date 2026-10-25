// Time-based one-time passwords, RFC 6238 over RFC 4226 — the thing every
// authenticator app speaks. Implemented here rather than depended on: it is
// forty lines of HMAC and base32, and a second factor is the one place a
// supply-chain surprise is least welcome.

import crypto from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** 20 random bytes, as apps expect — 160 bits, base32. */
export function newSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function hotp(secret: string, counter: number, digits = 6): string {
  const key = base32Decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac("sha1", key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const code = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(code % 10 ** digits).padStart(digits, "0");
}

export function totp(secret: string, at = Date.now(), step = 30): string {
  return hotp(secret, Math.floor(at / 1000 / step));
}

/** Accept the current step and one either side — clocks drift, people are
 *  slow. Constant-time on the compare; the window is the only leniency. */
export function verifyTotp(secret: string, code: string, at = Date.now(), window = 1): boolean {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  const step = Math.floor(at / 1000 / 30);
  for (let w = -window; w <= window; w++) {
    const expected = hotp(secret, step + w);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return true;
  }
  return false;
}

export function otpauthUri(secret: string, account: string, issuer = "foldrun"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** Eight codes, shown once; only their hashes are kept. Ten characters from
 *  an alphabet without 0/O/1/I, grouped for reading aloud over a phone. */
export function newBackupCodes(n = 8): string[] {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: n }, () => {
    const b = crypto.randomBytes(10);
    const s = [...b].map((x) => alphabet[x % alphabet.length]).join("");
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

export const hashBackup = (code: string) =>
  crypto.createHash("sha256").update(code.toLowerCase().replace(/[^a-z0-9]/g, "")).digest("hex");
