---
layout: page
title: photos
permalink: /photos/
subtitle: shot on a whim. kept on purpose.
---

<ul class="photo-grid">
{%- assign list = page.photos | default: site.data.photos %}
{%- for p in list %}
  <li>
    <a href="{{ '/assets/img/photos/' | append: p.file | append: '.jpg' | relative_url }}" data-date="{{ p.date }}" data-track="photo_open" data-item="{{ p.file }}">
      <img src="{{ '/assets/img/photos/' | append: p.file | append: '-thumb.jpg' | relative_url }}" width="{{ p.width }}" height="{{ p.height }}" alt="" loading="lazy">
    </a>
  </li>
{%- endfor %}
</ul>

{{ page.pager }}

<dialog class="photo-viewer" tabindex="-1">
  <img alt="">
  <div class="photo-meta mono">
    <span class="photo-date"></span>
    <button type="button" class="photo-close" aria-label="닫기">×</button>
  </div>
</dialog>

<script>
  (function () {
    var dlg = document.querySelector(".photo-viewer");
    var img = dlg.querySelector("img");
    var date = dlg.querySelector(".photo-date");
    document.querySelector(".photo-grid").addEventListener("click", function (e) {
      var a = e.target.closest("a");
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      img.src = a.href;
      date.textContent = a.dataset.date;
      dlg.showModal();
      dlg.focus();
    });
    dlg.addEventListener("click", function () { dlg.close(); });
    dlg.addEventListener("close", function () { img.removeAttribute("src"); });
  })();
</script>
