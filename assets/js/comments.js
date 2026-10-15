(function () {
  var root = document.getElementById("comments");
  if (!root) return;

  var STRINGS = {
    ko: {
      empty: "아직 댓글이 없습니다.",
      anonymous: "익명",
      name: "이름 (선택)",
      body: "댓글",
      submit: "남기기",
      note: "욕설이나 시비 등은 숨김 처리될 수 있습니다.",
      sending: "보내는 중…",
      visible: "등록했습니다.",
      held: "검토 후 공개됩니다.",
      rate: "너무 자주 남기고 있습니다. 잠시 후 다시 시도해 주세요.",
      captcha: "확인 절차를 통과하지 못했습니다. 다시 시도해 주세요.",
      error: "등록하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      loadError: "댓글을 불러오지 못했습니다."
    },
    en: {
      empty: "No comments yet.",
      anonymous: "Anonymous",
      name: "Name (optional)",
      body: "Comment",
      submit: "Post",
      note: "Abusive or hostile comments may be hidden.",
      sending: "Sending…",
      visible: "Posted.",
      held: "It will appear after review.",
      rate: "You are posting too often. Please try again shortly.",
      captcha: "Verification failed. Please try again.",
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
  var button = form.querySelector("button");
  var captchaToken = "";

  form.querySelector(".comment-name").placeholder = t.name;
  form.querySelector(".comment-body").placeholder = t.body;
  form.querySelector(".comment-note").textContent = t.note;
  button.textContent = t.submit;

  function formatDate(ms) {
    return new Date(ms).toLocaleDateString("sv-SE");
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
    comments.forEach(append);
  }

  function append(c) {
    var empty = list.querySelector(".comment-empty");
    if (empty) empty.remove();
    var li = document.createElement("li");
    var head = document.createElement("div");
    head.className = "comment-head mono";
    var name = document.createElement("span");
    name.textContent = c.name || t.anonymous;
    var date = document.createElement("time");
    date.textContent = formatDate(c.created_at);
    head.appendChild(name);
    head.appendChild(date);
    var body = document.createElement("p");
    body.textContent = c.body;
    li.appendChild(head);
    li.appendChild(body);
    list.appendChild(li);
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  fetch(api + "/comments?slug=" + encodeURIComponent(slug))
    .then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); })
    .then(function (data) { render(data.comments || []); form.hidden = false; })
    .catch(function () { setStatus(t.loadError); });

  // Turnstile(선택): sitekey가 있으면 확인 위젯을 붙인다.
  if (root.dataset.sitekey) {
    var s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = function () {
      window.turnstile.render(form.querySelector(".comment-captcha"), {
        sitekey: root.dataset.sitekey,
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
        } else {
          setStatus(t.error);
          return;
        }
        form.elements.body.value = "";
        if (window.turnstile) { window.turnstile.reset(); captchaToken = ""; }
        track("comment_submit", { result: r.data.status });
      })
      .catch(function () { setStatus(t.error); })
      .then(function () { button.disabled = false; });
  });
})();
