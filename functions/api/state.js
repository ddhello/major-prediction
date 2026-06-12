const STATE_KEY = "published-default";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function onRequestGet({ env }) {
  if (!env.MAJOR_STATE) return json({ state: null });
  const state = await env.MAJOR_STATE.get(STATE_KEY, "json");
  return json({ state });
}

export async function onRequestPost({ request, env }) {
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
