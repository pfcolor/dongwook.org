import { classify } from "./rules.js";
import { judge } from "./ai.js";

const MAX_NAME = 30;
const MAX_BODY = 2000;
const RATE_PER_MINUTE = 3;
const RATE_PER_HOUR = 20;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname === "/comments" && request.method === "GET") return await list(url, env, cors);
      if (url.pathname === "/comments" && request.method === "POST") return await create(request, env, ctx, cors);
      if (url.pathname === "/admin") return await admin(request, url, env);
      // 로컬 개발에서만 열리는 판별 시험용 경로(배포본에는 DEV가 없어 404)
      if (url.pathname === "/_ai-eval" && request.method === "POST" && env.DEV === "1") {
        const { model, texts } = await request.json();
        const out = [];
        for (const text of texts) out.push({ text, ...(await judge(env, text, model)) });
        return json({ results: out }, 200, cors);
      }
    } catch (err) {
      console.error(err);
      return json({ error: "server" }, 500, cors);
    }
    return new Response("not found", { status: 404 });
  },
};

// ---------- 공통 ----------

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  if (origin === env.SITE_ORIGIN) return origin;
  if (env.DEV === "1" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

function corsHeaders(request, env) {
  const origin = allowedOrigin(request, env);
  const headers = { Vary: "Origin" };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
  }
  return headers;
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors },
  });
}

function validSlug(slug) {
  return typeof slug === "string" && slug.length <= 200 && /^\/[\w\-\/%.~]*$/.test(slug);
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sign(env, id, action) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.ADMIN_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}:${action}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// ---------- 목록 ----------

async function list(url, env, cors) {
  const slug = url.searchParams.get("slug");
  if (!validSlug(slug)) return json({ error: "bad_slug" }, 400, cors);

  const { results } = await env.DB.prepare(
    "SELECT id, name, body, created_at FROM comments WHERE slug = ? AND status = 'visible' ORDER BY created_at ASC LIMIT 200",
  )
    .bind(slug)
    .all();

  return json({ comments: results }, 200, cors);
}

// ---------- 작성 ----------

async function create(request, env, ctx, cors) {
  if (!allowedOrigin(request, env)) return json({ error: "origin" }, 403, cors);

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: "bad_json" }, 400, cors);
  }

  const slug = input.slug;
  const name = String(input.name ?? "").trim().slice(0, MAX_NAME) || "익명";
  const body = String(input.body ?? "").trim();

  if (!validSlug(slug)) return json({ error: "bad_slug" }, 400, cors);
  if (body.length < 2 || body.length > MAX_BODY) return json({ error: "bad_body" }, 400, cors);

  // 봇이 채우는 숨은 칸. 채워져 있으면 저장하지 않고 성공한 척한다.
  if (input.website) return json({ status: "held" }, 200, cors);

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";

  if (env.TURNSTILE_SECRET) {
    const ok = await verifyTurnstile(env.TURNSTILE_SECRET, input.turnstile, ip);
    if (!ok) return json({ error: "captcha" }, 400, cors);
  }

  const ipHash = (await sha256Hex(`${env.HASH_SALT ?? ""}${ip}`)).slice(0, 32);
  const now = Date.now();

  const rate = await env.DB.prepare(
    "SELECT SUM(created_at > ?) AS minute, COUNT(*) AS hour FROM comments WHERE ip_hash = ? AND created_at > ?",
  )
    .bind(now - 60_000, ipHash, now - 3_600_000)
    .first();
  if ((rate?.minute ?? 0) >= RATE_PER_MINUTE || (rate?.hour ?? 0) >= RATE_PER_HOUR) {
    return json({ error: "rate" }, 429, cors);
  }

  const duplicate = await env.DB.prepare(
    "SELECT 1 FROM comments WHERE ip_hash = ? AND body = ? AND created_at > ? LIMIT 1",
  )
    .bind(ipHash, body, now - 86_400_000)
    .first();

  let { status, reason } = classify({ name, body, isDuplicate: Boolean(duplicate) });

  // 규칙을 통과한 댓글만 AI로 한 번 더 본다. 한도 소진이나 오류 때는 건너뛰고 그대로 공개한다.
  if (status === "visible" && env.AI) {
    try {
      const { verdict } = await judge(env, `${name}\n${body}`);
      if (verdict === "ABUSIVE") ({ status, reason } = { status: "hidden", reason: "AI 판별: 욕설·시비" });
    } catch (err) {
      console.error("AI 판별 실패(건너뜀)", err.message);
    }
  }

  const id = crypto.randomUUID();

  await env.DB.prepare(
    "INSERT INTO comments (id, slug, name, body, status, reason, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, slug, name, body, status, reason, ipHash, now)
    .run();

  ctx.waitUntil(notify(env, new URL(request.url).origin, { id, slug, name, body, status, reason }));

  if (status === "visible") {
    return json({ status: "visible", comment: { id, name, body, created_at: now } }, 201, cors);
  }
  return json({ status: "held" }, 202, cors);
}

async function verifyTurnstile(secret, token, ip) {
  if (!token) return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const data = await res.json();
  return data.success === true;
}

// ---------- 알림 메일 ----------

async function notify(env, workerOrigin, c) {
  const link = async (action) => `${workerOrigin}/admin?id=${c.id}&action=${action}&t=${await sign(env, c.id, action)}`;

  const hidden = c.status === "hidden";
  const lines = [
    hidden ? `자동 숨김: ${c.reason}` : "공개됨",
    "",
    `글: ${env.SITE_ORIGIN}${c.slug}`,
    `이름: ${c.name}`,
    "",
    c.body,
    "",
    ...(hidden
      ? [`복원: ${await link("restore")}`, `삭제: ${await link("delete")}`]
      : [`숨기기: ${await link("hide")}`, `삭제: ${await link("delete")}`]),
  ];

  const message = {
    from: env.MAIL_FROM,
    to: env.NOTIFY_TO,
    subject: `[댓글${hidden ? ", 자동 숨김" : ""}] ${c.slug}`,
    text: lines.join("\n"),
  };

  if (!env.EMAIL || !env.NOTIFY_TO) {
    console.log("메일 설정이 없어 콘솔에만 남깁니다.\n" + message.text);
    return;
  }
  try {
    await env.EMAIL.send(message);
  } catch (err) {
    console.error("알림 메일 발송 실패", err.code, err.message);
  }
}

// ---------- 관리(메일 링크) ----------
// 메일 링크를 미리 열어 보는 프로그램이 있어서, GET은 확인 화면만 보여 주고 실제 처리는 버튼(POST)이 한다.

const ACTIONS = {
  delete: { label: "삭제", done: "삭제했습니다." },
  hide: { label: "숨기기", done: "숨겼습니다." },
  restore: { label: "복원", done: "복원했습니다." },
};

async function admin(request, url, env) {
  const params = request.method === "POST" ? new URLSearchParams(await request.text()) : url.searchParams;
  const id = params.get("id") ?? "";
  const action = params.get("action") ?? "";
  const token = params.get("t") ?? "";

  if (!ACTIONS[action] || !id) return page("잘못된 링크입니다.", 400);
  if (!timingSafeEqual(token, await sign(env, id, action))) return page("링크가 올바르지 않습니다.", 403);

  const comment = await env.DB.prepare("SELECT slug, name, body, status FROM comments WHERE id = ?").bind(id).first();
  if (!comment) return page("이미 삭제되었거나 없는 댓글입니다.", 404);

  if (request.method === "POST") {
    if (action === "delete") await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(id).run();
    else {
      const next = action === "hide" ? "hidden" : "visible";
      await env.DB.prepare("UPDATE comments SET status = ?, reason = ? WHERE id = ?")
        .bind(next, action === "hide" ? "직접 숨김" : null, id)
        .run();
    }
    return page(ACTIONS[action].done, 200);
  }

  const form = `
    <p><b>${escapeHtml(comment.name)}</b> · ${escapeHtml(comment.slug)} · ${comment.status === "visible" ? "공개" : "숨김"}</p>
    <blockquote>${escapeHtml(comment.body).replace(/\n/g, "<br>")}</blockquote>
    <form method="post">
      <input type="hidden" name="id" value="${escapeHtml(id)}">
      <input type="hidden" name="action" value="${escapeHtml(action)}">
      <input type="hidden" name="t" value="${escapeHtml(token)}">
      <button type="submit">${ACTIONS[action].label}</button>
    </form>`;
  return page(form, 200, true);
}

function page(content, status, raw = false) {
  const body = raw ? content : `<p>${escapeHtml(content)}</p>`;
  return new Response(
    `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>댓글 관리</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem}blockquote{margin:1rem 0;padding-left:1rem;border-left:3px solid #ccc;white-space:pre-wrap}button{font:inherit;padding:.5rem 1.2rem}</style>
${body}</html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}
