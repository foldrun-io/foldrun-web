// The OpenAPI 3.1 description of this API — server/openapi.ts. Open, like
// /api/healthz: a code generator or an API client reads it before it has a
// key, and it says nothing about any account.

import { NextRequest, NextResponse } from "next/server";
import { openapiDocument } from "@/server/openapi";
import { publicOrigin } from "@/server/auth-flows";

export async function GET(req: NextRequest) {
  return NextResponse.json(openapiDocument(publicOrigin(req)), {
    headers: { "cache-control": "public, max-age=300" },
  });
}
