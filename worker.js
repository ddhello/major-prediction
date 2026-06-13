const STATE_KEY = "published-default";
const LOGO_ORIGIN = "https://img.majors.im/logos/2606_cs2_cologne";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function handleStateApi(request, env) {
  if (request.method === "GET") {
    if (!env.MAJOR_STATE) return json({ state: null });
    return json({ state: await env.MAJOR_STATE.get(STATE_KEY, "json") });
  }

  if (request.method === "POST") {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
      return json({ error: "管理员 Token 无效。" }, 401);
    }
    if (!env.MAJOR_STATE) return json({ error: "未配置 MAJOR_STATE KV 绑定。" }, 500);

    let state;
    try {
      state = await request.json();
    } catch {
      return json({ error: "状态数据格式无效。" }, 400);
    }

    const serialized = JSON.stringify(state);
    if (serialized.length > 100_000) return json({ error: "状态数据过大。" }, 413);
    await env.MAJOR_STATE.put(STATE_KEY, serialized);
    return json({ ok: true, publishedAt: new Date().toISOString() });
  }

  return json({ error: "Method not allowed." }, 405);
}

async function handleLogo(request, url, ctx) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed.", { status: 405 });
  const filename = url.pathname.slice("/logos/".length);
  if (!filename || filename.includes("/") || !filename.endsWith(".png")) return new Response("Not found.", { status: 404 });

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return request.method === "HEAD"
    ? new Response(null, { status: cached.status, statusText: cached.statusText, headers: cached.headers })
    : cached;

  const upstream = await fetch(`${LOGO_ORIGIN}/${filename}`, { cf: { cacheEverything: true, cacheTtl: 2592000 } });
  if (!upstream.ok) return new Response("Logo not found.", { status: upstream.status });
  const headers = new Headers(upstream.headers);
  headers.set("cache-control", "public, max-age=2592000, immutable");
  headers.set("cdn-cache-control", "public, max-age=2592000");
  const response = new Response(upstream.body, { status: upstream.status, headers });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return request.method === "HEAD"
    ? new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers })
    : response;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/state") return handleStateApi(request, env);
    if (url.pathname.startsWith("/logos/")) return handleLogo(request, url, ctx);
    return env.ASSETS.fetch(request);
  },
};
