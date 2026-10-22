import { NextResponse, type NextRequest } from "next/server";

/**
 * Route guard. Presence of the session cookie gates the authenticated shell; the API performs the
 * real authorization on every request (a forged cookie only yields 401s from the API, after which
 * the client redirects to /login).
 */
const SESSION_COOKIE = "cs_session";
const AUTH_PAGES = new Set(["/login", "/register", "/forgot-password", "/reset-password"]);

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);

  if ((pathname === "/app" || pathname.startsWith("/app/") || pathname === "/admin" || pathname.startsWith("/admin/")) && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  if (AUTH_PAGES.has(pathname) && hasSession && !req.nextUrl.searchParams.has("switch")) {
    const url = req.nextUrl.clone();
    url.pathname = "/app";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/admin/:path*", "/login", "/register", "/forgot-password", "/reset-password"],
};
