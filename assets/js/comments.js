(function () {
  var root = document.getElementById("comments");
  if (!root) return;

  var STRINGS = {
    ko: {
      empty: "아직 댓글이 없습니다.",
      name: "이름",
      body: "댓글",
      submit: "남기기",
      reply: "답글",
      owner: "글쓴이",
      replyingTo: "답글 대상: ",
      cancel: "취소",
      sending: "보내는 중…",
      visible: "등록했습니다.",
      held: "검토 후 공개됩니다.",
      rate: "너무 자주 남기고 있습니다. 잠시 후 다시 시도해 주세요.",
      captcha: "확인 절차를 통과하지 못했습니다. 다시 시도해 주세요.",
      parent: "답글을 달 댓글을 찾을 수 없습니다. 새로고침한 뒤 다시 시도해 주세요.",
      error: "등록하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      loadError: "댓글을 불러오지 못했습니다."
    },
    en: {
      empty: "No comments yet.",
      name: "Name",
      body: "Comment",
      submit: "Post",
      reply: "Reply",
      owner: "Author",
      replyingTo: "Replying to ",
      cancel: "Cancel",
      sending: "Sending…",
      visible: "Posted.",
      held: "It will appear after review.",
      rate: "You are posting too often. Please try again shortly.",
      captcha: "Verification failed. Please try again.",
      parent: "The comment you are replying to could not be found. Please reload and try again.",
      error: "Could not post. Please try again later.",
      loadError: "Could not load comments."
    }
  };

  var api = root.dataset.api.replace(/\/$/, "");
  var slug = root.dataset.slug;
  var t = STRINGS[root.dataset.lang] || STRINGS.ko;

  var list = root.querySelector(".comment-list");
  var form = root.querySelector(".comment-form");
  var statusEl = root.querySelector(".comment-status");
  var replyBar = root.querySelector(".comment-replying");
  var button = form.querySelector("button[type=submit]");
  var captchaToken = "";
  var replyTo = null; // { id, name } 답글 대상(없으면 새 댓글)

  form.querySelector(".comment-name").placeholder = t.name;
  form.querySelector(".comment-body").placeholder = t.body;
  button.textContent = t.submit;

  function formatDate(ms) {
    return new Date(ms).toLocaleDateString("sv-SE");
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  // 댓글 하나를 그린다. 답글(reply)은 부모 아래 들여쓴 목록에 넣는다.
  function build(c, isReply) {
    var li = document.createElement("li");
    li.dataset.id = c.id;
    if (isReply) li.className = "comment-reply";

    var head = document.createElement("div");
    head.className = "comment-head mono";
    var name = document.createElement("span");
    name.textContent = c.name;
    head.appendChild(name);
    if (c.is_owner) {
      var badge = document.createElement("span");
      badge.className = "comment-owner";
      badge.textContent = t.owner;
      head.appendChild(badge);
    }
    var date = document.createElement("time");
    date.textContent = formatDate(c.created_at);
    head.appendChild(date);

    var body = document.createElement("p");
    body.textContent = c.body;

    var reply = document.createElement("button");
    reply.type = "button";
    reply.className = "comment-reply-btn mono";
    reply.textContent = t.reply;
    reply.addEventListener("click", function () { startReply(c); });

    li.appendChild(head);
    li.appendChild(body);
    li.appendChild(reply);
    return li;
  }

  function repliesOf(li) {
    var ul = li.querySelector(":scope > .comment-replies");
    if (!ul) {
      ul = document.createElement("ul");
      ul.className = "comment-replies";
      li.appendChild(ul);
    }
    return ul;
  }

  function append(c) {
    var empty = list.querySelector(".comment-empty");
    if (empty) empty.remove();
    if (c.parent_id) {
      var parent = list.querySelector('li[data-id="' + c.parent_id + '"]');
      if (parent) { repliesOf(parent).appendChild(build(c, true)); return; }
    }
    list.appendChild(build(c, false));
  }

  function render(comments) {
    list.textContent = "";
    if (!comments.length) {
      var empty = document.createElement("li");
      empty.className = "comment-empty";
      empty.textContent = t.empty;
      list.appendChild(empty);
      return;
    }
    // 부모가 먼저 그려져야 하므로 최상위 → 답글 순으로 넣는다.
    comments.filter(function (c) { return !c.parent_id; }).forEach(append);
    comments.filter(function (c) { return c.parent_id; }).forEach(append);
  }

  function startReply(c) {
    replyTo = { id: c.id, name: c.name };
    replyBar.querySelector(".comment-replying-name").textContent = t.replyingTo + c.name;
    replyBar.hidden = false;
    var body = form.elements.body;
    // 답글에 대한 답글이면 @이름을 붙여 누구에게 하는 말인지 남긴다.
    if (c.parent_id && !body.value) body.value = "@" + c.name + " ";
    form.scrollIntoView({ behavior: "smooth", block: "center" });
    body.focus();
  }

  function cancelReply() {
    replyTo = null;
    replyBar.hidden = true;
  }

  replyBar.querySelector("button").textContent = t.cancel;
  replyBar.querySelector("button").addEventListener("click", cancelReply);

  fetch(api + "/comments?slug=" + encodeURIComponent(slug))
    .then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); })
    .then(function (data) { render(data.comments || []); form.hidden = false; })
    .catch(function () { setStatus(t.loadError); });

  // Turnstile: sitekey가 있으면 확인 위젯을 붙인다.
  if (root.dataset.sitekey) {
    var s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = function () {
      window.turnstile.render(form.querySelector(".comment-captcha"), {
        sitekey: root.dataset.sitekey,
        // 평소에는 숨기고, 사람인지 의심스러운 방문자에게만 확인 상자를 보인다.
        appearance: "interaction-only",
        callback: function (token) { captchaToken = token; }
      });
    };
    document.head.appendChild(s);
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    button.disabled = true;
    setStatus(t.sending);

    fetch(api + "/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: slug,
        name: form.elements.name.value,
        body: form.elements.body.value,
        parent_id: replyTo ? replyTo.id : undefined,
        website: form.elements.website.value,
        turnstile: captchaToken
      })
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) { return { res: res, data: data }; });
      })
      .then(function (r) {
        if (r.res.ok && r.data.status === "visible") {
          append(r.data.comment);
          setStatus(t.visible);
        } else if (r.res.ok) {
          setStatus(t.held);
        } else if (r.res.status === 429) {
          setStatus(t.rate);
          return;
        } else if (r.data.error === "captcha") {
          setStatus(t.captcha);
          if (window.turnstile) window.turnstile.reset();
          captchaToken = "";
          return;
        } else if (r.data.error === "bad_parent") {
          setStatus(t.parent);
          return;
        } else {
          setStatus(t.error);
          return;
        }
        form.elements.body.value = "";
        cancelReply();
        if (window.turnstile) { window.turnstile.reset(); captchaToken = ""; }
        track("comment_submit", { result: r.data.status, reply: replyTo ? "yes" : "no" });
      })
      .catch(function () { setStatus(t.error); })
      .then(function () { button.disabled = false; });
  });
})();
