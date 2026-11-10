import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Password gate for the daily hot list (/hoy) and its API. Uses HTTP Basic
 * auth so the phone browser asks once and remembers it. Any username works;
 * the password must match HOY_PASSWORD. Fails closed: if HOY_PASSWORD is not
 * set, nobody gets in.
 *
 * /api/cron/hot-list is NOT matched here; it has its own CRON_SECRET check.
 */

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function passwordFrom(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    return sep === -1 ? null : decoded.slice(sep + 1);
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest) {
  const expected = process.env.HOY_PASSWORD;
  if (!expected) {
    return new NextResponse("HOY_PASSWORD is not configured.", { status: 503 });
  }

  const given = passwordFrom(request);
  if (given !== null && safeEqual(given, expected)) {
    return NextResponse.next();
  }

  return new NextResponse("Autenticación requerida.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Aura Link CRM", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/hoy", "/hoy/:path*", "/api/hot-list/:path*", "/api/hot-list"],
};
