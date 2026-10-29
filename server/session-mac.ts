// The MAC every browser token carries: HMAC-SHA256 of its payload under the
// install key, hex. Sessions (v1, v2), invites, and — on the hosted
// platform — support views (s1, minted by foldrun-admin's view-as.ts) are
// all signed with it, and server/users.ts verifySession checks it before it
// reads anything else. Trusted server code only: whoever calls this can
// mint a token the install will accept.

import crypto from "node:crypto";
import { installKey } from "@/lib/webhook.ts";

export const sessionMac = (payload: string): string => crypto.createHmac("sha256", installKey()).update(payload).digest("hex");
