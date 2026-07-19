import { NextRequest } from "next/server";

const upstreamApi = (
  process.env.NIYAM_API_URL ?? "http://127.0.0.1:4000/api"
).replace(/\/$/, "");

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  const target = new URL(`${upstreamApi}/${path.join("/")}`);
  target.search = request.nextUrl.search;
  const hasBody = !["GET", "HEAD"].includes(request.method);

  try {
    const headers = new Headers({
      accept: request.headers.get("accept") ?? "application/json",
      "content-type": request.headers.get("content-type") ?? "application/json",
      "x-niyam-session":
        request.headers.get("x-niyam-session") ?? "public-default",
    });
    const viewerIp = request.headers
      .get("x-forwarded-for")
      ?.split(",")[0]
      ?.trim();
    if (viewerIp) headers.set("x-niyam-client-ip", viewerIp);
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(180_000),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type":
          upstream.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
        "x-niyam-upstream-status": String(upstream.status),
      },
    });
  } catch (error) {
    return Response.json(
      {
        message:
          error instanceof Error
            ? `Niyam API is unavailable: ${error.message}`
            : "Niyam API is unavailable",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
