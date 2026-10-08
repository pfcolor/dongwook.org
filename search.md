---
layout: page
title: search
permalink: /search/
subtitle: somewhere in here. probably.
---

<input id="search-input" class="search-input" type="search" placeholder="검색어를 입력해 주세요…" aria-label="search" autocomplete="off" autofocus>

<ul id="search-results" class="post-list search-results"></ul>

<script>
  (function () {
    var input = document.getElementById("search-input");
    var list = document.getElementById("search-results");
    var docs = [];

    function escape(s) {
      return s.replace(/[&<>"]/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
      });
    }

    /* 제목 속 《》「」〈〉『』의 빈 여백을 줄인다 (_includes/title.html과 같은 규칙) */
    function bracketed(s) {
      return escape(s)
        .replace(/[《「〈『]/g, '<span class="bo">$&</span>\u2060')
        .replace(/[》」〉』]/g, '<span class="bc">$&</span>');
    }

    /* 처음 일치한 곳 앞뒤로 조금 잘라 보여준다 */
    function snippet(text, term) {
      var i = text.toLowerCase().indexOf(term);
      if (i < 0) return "";
      var start = Math.max(0, i - 40);
      var end = Math.min(text.length, i + term.length + 60);
      return (start > 0 ? "…" : "") +
        escape(text.slice(start, i)) + "<mark>" + escape(text.slice(i, i + term.length)) + "</mark>" +
        escape(text.slice(i + term.length, end)) + (end < text.length ? "…" : "");
    }

    /* 입력이 멈춘 뒤 한 번만 검색어와 결과 수를 보낸다 */
    var searchTimer;
    function trackSearch(term, count) {
      clearTimeout(searchTimer);
      if (!term) return;
      searchTimer = setTimeout(function () {
        track("search", { search_term: term, result_count: count });
      }, 1200);
    }

    function render() {
      var query = input.value.trim().toLowerCase();
      var url = new URL(location.href);
      if (query) url.searchParams.set("q", input.value.trim()); else url.searchParams.delete("q");
      history.replaceState(null, "", url);

      list.innerHTML = "";
      if (!query) { trackSearch(""); return; }
      var terms = query.split(/\s+/);
      var hits = docs.filter(function (d) {
        var hay = (d.title + " " + d.content).toLowerCase();
        return terms.every(function (t) { return hay.indexOf(t) >= 0; });
      });
      trackSearch(query, hits.length);
      if (!hits.length) {
        list.innerHTML = '<li class="search-empty">no results.</li>';
        return;
      }
      list.innerHTML = hits.map(function (d) {
        var head = (d.date ? '<time class="mono">' + d.date + '</time> <span class="dash mono">—</span> ' : '') +
          '<a href="' + d.url + '">' + bracketed(d.title) + '</a>';
        var snip = snippet(d.content, terms[0]);
        return '<li>' + head + (snip ? '<div class="search-snippet">' + snip + '</div>' : '') + '</li>';
      }).join("");
    }

    fetch("{{ '/search.json' | relative_url }}")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        docs = data;
        var q = new URL(location.href).searchParams.get("q");
        if (q) input.value = q;
        render();
      });
    input.addEventListener("input", render);
  })();
</script>
