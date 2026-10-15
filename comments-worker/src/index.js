import { classify } from "./rules.js";
import { judge } from "./ai.js";

const MAX_NAME = 30;
const MAX_BODY = 2000;
const RATE_PER_MINUTE = 3;
const RATE_PER_HOUR = 20;
// 메일 링크가 유효한 기간. 서명에 만료 시각이 들어가 있어 링크를 고쳐 연장할 수 없다.
const LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000;
// 메일로 따로 요청한 목록 링크는 바로 쓰는 용도라 짧게 둔다.
const REQUESTED_LIST_TTL_MS = 2 * 60 * 60 * 1000;
const LIST_REQUEST_INTERVAL_MS = 10 * 60 * 1000;
const PAGE_SIZE = 50;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname === "/comments" && request.method === "GET") return await list(url, env, cors);
      if (url.pathname === "/comments" && request.method === "POST") return await create(request, env, ctx, cors);
      if (url.pathname === "/admin") return await admin(request, url, env);
      if (url.pathname === "/manage") return await manage(request, url, env);
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

async function sign(env, id, action, exp) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.ADMIN_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}:${action}:${exp}`));
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

// 숨긴 댓글의 답글은 함께 감춘다(부모가 공개 상태일 때만 답글을 보여 준다).
async function list(url, env, cors) {
  const slug = url.searchParams.get("slug");
  if (!validSlug(slug)) return json({ error: "bad_slug" }, 400, cors);

  const { results } = await env.DB.prepare(
    `SELECT c.id, c.parent_id, c.name, c.body, c.created_at, c.is_owner
       FROM comments c
       LEFT JOIN comments p ON p.id = c.parent_id
      WHERE c.slug = ? AND c.status = 'visible' AND (c.parent_id IS NULL OR p.status = 'visible')
      ORDER BY c.created_at ASC LIMIT 300`,
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
  const name = String(input.name ?? "").trim().slice(0, MAX_NAME);
  const body = String(input.body ?? "").trim();

  if (!validSlug(slug)) return json({ error: "bad_slug" }, 400, cors);
  if (!name) return json({ error: "bad_name" }, 400, cors);
  if (body.length < 2 || body.length > MAX_BODY) return json({ error: "bad_body" }, 400, cors);

  // 봇이 채우는 숨은 칸. 채워져 있으면 저장하지 않고 성공한 척한다.
  if (input.website) return json({ status: "held", reason: "review" }, 200, cors);

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";

  if (env.TURNSTILE_SECRET) {
    const ok = await verifyTurnstile(env.TURNSTILE_SECRET, input.turnstile, ip);
    if (!ok) return json({ error: "captcha" }, 400, cors);
  }

  // 답글이면 부모를 확인하고, 답글에 대한 답글은 맨 위 댓글 묶음에 붙인다(한 단계까지만).
  let parentId = null;
  if (input.parent_id) {
    const parent = await env.DB.prepare("SELECT id, parent_id, slug, status FROM comments WHERE id = ?")
      .bind(String(input.parent_id))
      .first();
    if (!parent || parent.slug !== slug || parent.status !== "visible") return json({ error: "bad_parent" }, 400, cors);
    parentId = parent.parent_id ?? parent.id;
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

  let { status, reason, code } = classify({ name, body, isDuplicate: Boolean(duplicate) });

  // 규칙을 통과한 댓글만 AI로 한 번 더 본다. 한도 소진이나 오류 때는 건너뛰고 그대로 공개하되,
  // 알림 메일에 "AI 검사를 건너뜀"이라고 표시해 조용히 실패하는 일이 없게 한다.
  let aiFailure = null;
  if (status === "visible") {
    if (!env.AI) {
      aiFailure = "AI 연결이 없음";
    } else {
      try {
        const { verdict } = await judge(env, `${name}\n${body}`);
        if (verdict === "ABUSIVE") ({ status, reason, code } = { status: "hidden", reason: "AI 판별: 욕설·시비", code: "review" });
        else if (verdict === "SPAM") ({ status, reason, code } = { status: "hidden", reason: "AI 판별: 스팸", code: "review" });
      } catch (err) {
        aiFailure = String(err?.message ?? err).replace(/\s+/g, " ").slice(0, 160);
        console.error("AI 판별 실패(건너뜀)", aiFailure);
      }
    }
  }

  const id = crypto.randomUUID();

  await env.DB.prepare(
    "INSERT INTO comments (id, slug, name, body, status, reason, parent_id, is_owner, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
  )
    .bind(id, slug, name, body, status, reason, parentId, ipHash, now)
    .run();

  ctx.waitUntil(
    notify(env, new URL(request.url).origin, { id, slug, name, body, status, reason, aiFailure, isReply: Boolean(parentId) }),
  );

  if (status === "visible") {
    return json(
      { status: "visible", comment: { id, parent_id: parentId, name, body, created_at: now, is_owner: 0 } },
      201,
      cors,
    );
  }
  return json({ status: "held", reason: code ?? "review" }, 202, cors);
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

async function adminLink(env, origin, id, action, ttl = LINK_TTL_MS) {
  const exp = Date.now() + ttl;
  return `${origin}/admin?id=${id}&action=${action}&e=${exp}&t=${await sign(env, id, action, exp)}`;
}

async function sendMail(env, subject, text) {
  const message = { from: env.MAIL_FROM, to: env.NOTIFY_TO, subject, text };
  if (!env.EMAIL || !env.NOTIFY_TO) {
    console.log("메일 설정이 없어 콘솔에만 남깁니다.\n" + text);
    return;
  }
  try {
    await env.EMAIL.send(message);
  } catch (err) {
    console.error("알림 메일 발송 실패", err.code, err.message);
  }
}

// 독자가 남긴 댓글·답글 알림
async function notify(env, workerOrigin, c) {
  const link = (action) => adminLink(env, workerOrigin, c.id, action);

  const hidden = c.status === "hidden";
  const kind = c.isReply ? "답글" : "댓글";
  const lines = [
    ...(c.aiFailure
      ? [`⚠ AI 검사를 건너뜀: ${c.aiFailure}`, "이 댓글은 AI 검사 없이 처리되었습니다. 직접 확인해 주세요.", ""]
      : []),
    hidden ? `자동 숨김: ${c.reason}` : "공개됨",
    "",
    `글: ${env.SITE_ORIGIN}${c.slug}`,
    `이름: ${c.name.replace(/[\r\n]+/g, " ")}`,
    "",
    c.body,
    "",
    ...(hidden
      ? [`복원: ${await link("restore")}`, `삭제: ${await link("delete")}`]
      : [`답글 쓰기: ${await link("reply")}`, `숨기기: ${await link("hide")}`, `삭제: ${await link("delete")}`]),
    "",
    `전체 목록: ${await adminLink(env, workerOrigin, "list", "list")}`,
  ];

  const tags = [hidden ? "자동 숨김" : null, c.aiFailure ? "AI 검사 건너뜀" : null].filter(Boolean);
  await sendMail(env, `[${kind}${tags.length ? `, ${tags.join(", ")}` : ""}] ${c.slug}`, lines.join("\n"));
}

// 글쓴이가 올린 답글에 대한 확인 메일. 나중에 고치거나 숨기거나 지울 수 있게 링크를 남긴다.
async function notifyOwnerReply(env, workerOrigin, c) {
  const link = (action) => adminLink(env, workerOrigin, c.id, action);
  const lines = [
    "글쓴이 답글을 올렸습니다.",
    "",
    `글: ${env.SITE_ORIGIN}${c.slug}`,
    "",
    c.body,
    "",
    `수정: ${await link("edit")}`,
    `숨기기: ${await link("hide")}`,
    `삭제: ${await link("delete")}`,
    "",
    `전체 목록: ${await adminLink(env, workerOrigin, "list", "list")}`,
  ];
  await sendMail(env, `[글쓴이 답글] ${c.slug}`, lines.join("\n"));
}

// ---------- 관리(메일 링크) ----------
// 메일 링크를 미리 열어 보는 프로그램이 있어서, GET은 확인 화면만 보여 주고 실제 처리는 버튼(POST)이 한다.

const ACTIONS = {
  delete: { label: "삭제", done: "삭제했습니다." },
  hide: { label: "숨기기", done: "숨겼습니다." },
  restore: { label: "복원", done: "복원했습니다." },
  reply: { label: "답글 올리기", done: "답글을 올렸습니다." },
  edit: { label: "수정 저장", done: "수정했습니다." },
  list: { label: "목록", done: "" },
};

async function admin(request, url, env) {
  const params = request.method === "POST" ? new URLSearchParams(await request.text()) : url.searchParams;
  const id = params.get("id") ?? "";
  const action = params.get("action") ?? "";
  const token = params.get("t") ?? "";
  const exp = params.get("e") ?? "";
  const origin = url.origin;

  if (!ACTIONS[action] || !id || !/^\d{10,15}$/.test(exp)) return page("잘못된 링크입니다.", 400);
  if (!timingSafeEqual(token, await sign(env, id, action, exp))) return page("링크가 올바르지 않습니다.", 403);
  if (Number(exp) < Date.now()) return page(`링크가 만료되었습니다. <a href="${escapeHtml(origin)}/manage">관리 링크 다시 받기</a>`, 403, true);

  if (action === "list") {
    if (id !== "list" || request.method !== "GET") return page("잘못된 요청입니다.", 400);
    return listPage(env, origin, params, exp, token);
  }

  const comment = await env.DB.prepare("SELECT slug, name, body, status, parent_id, is_owner FROM comments WHERE id = ?")
    .bind(id)
    .first();
  if (!comment) return page("이미 삭제되었거나 없는 댓글입니다.", 404);

  // 수정은 글쓴이 답글에만 허용한다(독자 댓글을 고쳐 쓰는 일이 없도록).
  if (action === "edit" && !comment.is_owner) return page("글쓴이 답글만 수정할 수 있습니다.", 403);

  const postLink = `<p><a href="${escapeHtml(env.SITE_ORIGIN + comment.slug)}">글로 가기</a></p>`;
  const listHref = await adminLink(env, origin, "list", "list");
  const backLink = `<p><a href="${escapeHtml(listHref)}">목록으로</a></p>`;

  if (request.method === "POST") {
    if (action === "delete") {
      // 답글도 함께 지운다.
      await env.DB.prepare("DELETE FROM comments WHERE id = ? OR parent_id = ?").bind(id, id).run();
    } else if (action === "reply") {
      const reply = (params.get("reply") ?? "").trim();
      if (reply.length < 1 || reply.length > MAX_BODY) return page("답글은 1자 이상 2,000자 이하로 써 주세요.", 400);
      const replyId = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO comments (id, slug, name, body, status, reason, parent_id, is_owner, ip_hash, created_at) VALUES (?, ?, ?, ?, 'visible', NULL, ?, 1, 'owner', ?)",
      )
        .bind(replyId, comment.slug, env.OWNER_NAME || "글쓴이", reply, comment.parent_id ?? id, Date.now())
        .run();
      await notifyOwnerReply(env, origin, { id: replyId, slug: comment.slug, body: reply });
      return page(`<p>${ACTIONS.reply.done} 수정·숨김·삭제 링크를 메일로 보냈습니다.</p>${postLink}${backLink}`, 200, true);
    } else if (action === "edit") {
      const text = (params.get("reply") ?? "").trim();
      if (text.length < 1 || text.length > MAX_BODY) return page("답글은 1자 이상 2,000자 이하로 써 주세요.", 400);
      await env.DB.prepare("UPDATE comments SET body = ? WHERE id = ?").bind(text, id).run();
      return page(`<p>${ACTIONS.edit.done}</p>${postLink}${backLink}`, 200, true);
    } else {
      const next = action === "hide" ? "hidden" : "visible";
      await env.DB.prepare("UPDATE comments SET status = ?, reason = ? WHERE id = ?")
        .bind(next, action === "hide" ? "직접 숨김" : null, id)
        .run();
      // 직접 숨긴 뒤에도 되돌릴 수 있게 복원 링크를 보여 준다.
      if (action === "hide") {
        const restore = await adminLink(env, origin, id, "restore");
        return page(`<p>${ACTIONS.hide.done}</p><p><a href="${escapeHtml(restore)}">복원하기</a></p>${backLink}`, 200, true);
      }
    }
    return page(`<p>${ACTIONS[action].done}</p>${backLink}`, 200, true);
  }

  const textField =
    action === "reply" || action === "edit"
      ? `<textarea name="reply" rows="6" maxlength="${MAX_BODY}" required autofocus>${action === "edit" ? escapeHtml(comment.body) : ""}</textarea>`
      : "";
  const form = `
    <p><b>${escapeHtml(comment.name)}</b> · ${escapeHtml(comment.slug)} · ${comment.status === "visible" ? "공개" : "숨김"}</p>
    ${action === "edit" ? "" : `<blockquote>${escapeHtml(comment.body).replace(/\n/g, "<br>")}</blockquote>`}
    <form method="post">
      <input type="hidden" name="id" value="${escapeHtml(id)}">
      <input type="hidden" name="action" value="${escapeHtml(action)}">
      <input type="hidden" name="e" value="${escapeHtml(exp)}">
      <input type="hidden" name="t" value="${escapeHtml(token)}">
      ${textField}
      <button type="submit">${ACTIONS[action].label}</button>
    </form>`;
  return page(form, 200, true);
}

// ---------- 관리 화면(목록) ----------
// 목록 링크로 들어오면 댓글마다 새 링크(14일)를 만들어 보여 준다. 알림 메일의 링크가 만료돼도 여기서 처리할 수 있다.

const ROW_LABELS = { reply: "답글", edit: "수정", hide: "숨기기", restore: "복원", delete: "삭제" };

function formatTime(ms) {
  return new Date(ms).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16);
}

async function listPage(env, origin, params, exp, token) {
  const view = params.get("view") === "hidden" ? "hidden" : "all";
  const offset = Math.max(0, Number.parseInt(params.get("offset") ?? "0", 10) || 0);
  const where = view === "hidden" ? "WHERE status = 'hidden'" : "";

  const { results } = await env.DB.prepare(
    `SELECT id, slug, name, body, status, reason, parent_id, is_owner, created_at
       FROM comments ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(PAGE_SIZE + 1, offset)
    .all();
  const rows = results.slice(0, PAGE_SIZE);
  const more = results.length > PAGE_SIZE;

  const base = `${origin}/admin?id=list&action=list&e=${exp}&t=${token}`;
  const nav = [
    `<a href="${escapeHtml(base)}">전체</a>`,
    `<a href="${escapeHtml(base)}&amp;view=hidden">숨김만</a>`,
  ];

  const items = await Promise.all(
    rows.map(async (c) => {
      const actions = c.is_owner
        ? ["edit", c.status === "visible" ? "hide" : "restore", "delete"]
        : c.status === "visible"
          ? ["reply", "hide", "delete"]
          : ["restore", "delete"];
      const links = await Promise.all(
        actions.map(async (a) => `<a href="${escapeHtml(await adminLink(env, origin, c.id, a))}">${ROW_LABELS[a]}</a>`),
      );
      const flags = [
        c.is_owner ? "글쓴이" : null,
        c.parent_id ? "답글" : null,
        c.status === "hidden" ? `숨김${c.reason ? ` (${c.reason})` : ""}` : null,
      ].filter(Boolean);
      const shown = c.body.length > 300 ? `${c.body.slice(0, 300)}…` : c.body;
      return `<div class="c${c.status === "hidden" ? " hid" : ""}">
        <div class="m">${formatTime(c.created_at)} · ${escapeHtml(c.slug)} · <b>${escapeHtml(c.name)}</b>${flags.length ? ` · ${escapeHtml(flags.join(" · "))}` : ""}</div>
        <div class="b">${escapeHtml(shown)}</div>
        <div class="a">${links.join("")}</div>
      </div>`;
    }),
  );

  const pager = [
    offset > 0
      ? `<a href="${escapeHtml(base)}&amp;view=${view}&amp;offset=${Math.max(0, offset - PAGE_SIZE)}">← 이전</a>`
      : "",
    more ? `<a href="${escapeHtml(base)}&amp;view=${view}&amp;offset=${offset + PAGE_SIZE}">다음 →</a>` : "",
  ].join("");

  const title = view === "hidden" ? "숨긴 댓글" : "전체 댓글";
  const body = `<h2>${title}</h2><nav>${nav.join("")}</nav>${
    items.length ? items.join("") : "<p>댓글이 없습니다.</p>"
  }<nav>${pager}</nav>`;
  return page(body, 200, true, true);
}

// 관리 링크를 메일로 다시 받는 화면. 받는 사람은 항상 알림 메일 주소 하나뿐이고, 요청은 10분에 한 번만 받는다.
async function manage(request, url, env) {
  if (request.method === "POST") {
    const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'list_link_sent'").first();
    if (row && Date.now() - Number(row.value) < LIST_REQUEST_INTERVAL_MS) {
      return page("방금 링크를 보냈습니다. 메일함을 확인하거나 10분 뒤에 다시 요청해 주세요.", 429);
    }
    await env.DB.prepare(
      "INSERT INTO meta (key, value) VALUES ('list_link_sent', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
      .bind(String(Date.now()))
      .run();
    const link = await adminLink(env, url.origin, "list", "list", REQUESTED_LIST_TTL_MS);
    await sendMail(env, "[댓글 관리] 목록 링크", `아래 링크는 2시간 동안 쓸 수 있습니다.\n\n${link}`);
    return page("관리 링크를 메일로 보냈습니다. 받은편지함을 확인해 주세요.", 200);
  }
  return page(
    `<p>댓글 관리 링크를 알림 메일 주소로 보냅니다.</p><form method="post"><button type="submit">메일로 받기</button></form>`,
    200,
    true,
  );
}

function page(content, status, raw = false, wide = false) {
  const body = raw ? content : `<p>${escapeHtml(content)}</p>`;
  return new Response(
    `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>댓글 관리</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:${wide ? "46rem" : "32rem"};margin:3rem auto;padding:0 1rem}.c{padding:.8rem 0;border-bottom:1px solid #ddd}.m{font-size:.85rem;color:#666}.b{margin:.3rem 0;white-space:pre-wrap;overflow-wrap:anywhere}.a a{margin-right:1rem}.hid{opacity:.6}nav a{margin-right:1rem}blockquote{margin:1rem 0;padding-left:1rem;border-left:3px solid #ccc;white-space:pre-wrap}textarea{display:block;width:100%;box-sizing:border-box;margin-bottom:1rem;font:inherit;padding:.5rem}button{font:inherit;padding:.5rem 1.2rem}</style>
${body}</html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}
