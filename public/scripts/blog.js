/* ============================================================
   我们的小窝 — 双人博客阅读页交互
   顶部标签收拢 / 目录生成 / 当前章节高亮 / 阅读进度
   ============================================================ */
(function () {
  "use strict";

  var tags = document.getElementById("blogTags");
  var tocList = document.getElementById("tocList");
  var tocFill = document.getElementById("tocFill");
  var sections = [];
  var tocHeadings = [];
  var tocLinks = {};

  function queryParam(name) {
    var m = window.location.search.match(new RegExp("[?&]" + name + "=([^&]+)"));
    return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : "";
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function inlineMarkdown(text) {
    var html = escapeHtml(text);
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return html;
  }

  function slug(text, fallback) {
    return String(text || fallback || "section")
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 42) || fallback;
  }

  function appendParagraph(section, lines) {
    if (!lines.length) return;
    var p = document.createElement("p");
    p.innerHTML = inlineMarkdown(lines.join(" "));
    section.appendChild(p);
    lines.length = 0;
  }

  function appendList(section, lines, ordered) {
    var list = document.createElement(ordered ? "ol" : "ul");
    list.className = "article-list";
    lines.forEach(function (line) {
      var li = document.createElement("li");
      li.innerHTML = inlineMarkdown(line);
      list.appendChild(li);
    });
    section.appendChild(list);
  }

  function renderBlocks(section, lines) {
    var para = [];
    var list = [];
    var ordered = false;
    var quote = [];
    var inCode = false;
    var code = [];

    function flushList() {
      if (!list.length) return;
      appendList(section, list, ordered);
      list = [];
      ordered = false;
    }
    function flushQuote() {
      if (!quote.length) return;
      var block = document.createElement("blockquote");
      block.className = "article-quote";
      block.innerHTML = inlineMarkdown(quote.join(" "));
      section.appendChild(block);
      quote = [];
    }
    function flushCode() {
      if (!code.length) return;
      var pre = document.createElement("pre");
      var codeEl = document.createElement("code");
      codeEl.textContent = code.join("\n");
      pre.appendChild(codeEl);
      section.appendChild(pre);
      code = [];
    }

    lines.forEach(function (raw) {
      var line = raw.replace(/\s+$/, "");
      if (/^```/.test(line)) {
        appendParagraph(section, para);
        flushList();
        flushQuote();
        if (inCode) flushCode();
        inCode = !inCode;
        return;
      }
      if (inCode) {
        code.push(raw);
        return;
      }
      if (!line.trim()) {
        appendParagraph(section, para);
        flushList();
        flushQuote();
        return;
      }
      var heading3 = line.match(/^###\s+(.+)$/);
      if (heading3) {
        appendParagraph(section, para);
        flushList();
        flushQuote();
        var h3 = document.createElement("h3");
        h3.textContent = heading3[1].trim();
        section.appendChild(h3);
        return;
      }
      var unordered = line.match(/^[-*]\s+(.+)$/);
      var orderedHit = line.match(/^\d+\.\s+(.+)$/);
      if (unordered || orderedHit) {
        appendParagraph(section, para);
        flushQuote();
        var nextOrdered = !!orderedHit;
        if (list.length && ordered !== nextOrdered) flushList();
        ordered = nextOrdered;
        list.push((unordered || orderedHit)[1]);
        return;
      }
      var quoteHit = line.match(/^>\s?(.+)$/);
      if (quoteHit) {
        appendParagraph(section, para);
        flushList();
        quote.push(quoteHit[1]);
        return;
      }
      flushList();
      flushQuote();
      para.push(line.trim());
    });

    appendParagraph(section, para);
    flushList();
    flushQuote();
    flushCode();
  }

  function renderMarkdown(post) {
    var article = document.querySelector(".article");
    var lines = String(post.markdown || "").split(/\r?\n/);
    var bodyLines = [];
    var current = null;
    var currentLines = [];
    var sectionCount = 0;

    lines.forEach(function (line) {
      if (/^#\s+/.test(line)) return;
      var h2 = line.match(/^##\s+(.+)$/);
      if (h2) {
        if (current) {
          current.lines = currentLines;
          bodyLines.push(current);
        }
        sectionCount += 1;
        current = { title: h2[1].trim(), id: slug(h2[1], "section-" + sectionCount), lines: [] };
        currentLines = [];
      } else {
        currentLines.push(line);
      }
    });
    if (current) {
      current.lines = currentLines;
      bodyLines.push(current);
    } else {
      bodyLines.push({ title: "Content", id: "content", lines: currentLines });
    }

    article.textContent = "";

    var head = document.createElement("header");
    head.className = "article-head";
    var kicker = document.createElement("p");
    kicker.className = "article-kicker";
    kicker.textContent = "Blog / Markdown upload";
    var title = document.createElement("h1");
    title.textContent = post.title;
    var summary = document.createElement("p");
    summary.className = "article-summary";
    summary.textContent = post.summary;
    var authors = document.createElement("div");
    authors.className = "article-authors";
    authors.setAttribute("aria-label", "Author");
    post.authors.forEach(function (who) {
      var data = window.CBBlog.authors[who];
      var span = document.createElement("span");
      span.className = "article-author article-author--" + who;
      span.textContent = data ? data.emoji + " " + data.name : who;
      authors.appendChild(span);
    });
    head.appendChild(kicker);
    head.appendChild(title);
    head.appendChild(summary);
    head.appendChild(authors);
    article.appendChild(head);

    bodyLines.forEach(function (block) {
      var section = document.createElement("section");
      section.className = "article-section";
      section.id = block.id;
      section.setAttribute("data-toc-title", block.title);
      var h2 = document.createElement("h2");
      h2.textContent = block.title;
      section.appendChild(h2);
      renderBlocks(section, block.lines);
      article.appendChild(section);
    });

    document.title = post.title + " · Our Nest";
  }

  function renderTags(post) {
    if (!tags) return;
    tags.textContent = "";
    post.authors.forEach(function (who) {
      var data = window.CBBlog.authors[who];
      var span = document.createElement("span");
      span.className = "blog-tag blog-tag--" + who;
      span.textContent = data ? data.name + " · Author" : who;
      tags.appendChild(span);
    });
    var date = document.createElement("span");
    date.className = "blog-tag";
    date.textContent = window.CBBlog.displayDate(post.date);
    tags.appendChild(date);
    var minutes = document.createElement("span");
    minutes.className = "blog-tag";
    minutes.textContent = post.readMinutes + " min read";
    tags.appendChild(minutes);
    post.tags.forEach(function (tag) {
      var span = document.createElement("span");
      span.className = "blog-tag";
      span.textContent = tag;
      tags.appendChild(span);
    });
  }

  function maybeRenderUploadedPost() {
    var id = queryParam("id");
    if (!id || !window.CBBlog) return;
    var post = window.CBBlog.find(id);
    if (!post) return;
    renderTags(post);
    renderMarkdown(post);
  }

  function buildToc() {
    sections = Array.prototype.slice.call(document.querySelectorAll(".article-section"));
    tocHeadings = Array.prototype.slice.call(document.querySelectorAll(".article-section h2, .article-section h3, .article-section h4"));
    tocLinks = {};
    tocList.textContent = "";
    var frag = document.createDocumentFragment();
    tocHeadings.forEach(function (heading, index) {
      if (!heading.id) {
        heading.id = slug(heading.textContent, "heading-" + (index + 1));
      }
      var link = document.createElement("a");
      link.className = "toc__link";
      link.href = "#" + heading.id;
      link.dataset.level = String(Math.min(Number(heading.tagName.slice(1)) || 2, 4));
      link.textContent = heading.textContent.trim();
      link.addEventListener("click", function (ev) {
        ev.preventDefault();
        heading.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      tocLinks[heading.id] = link;
      frag.appendChild(link);
    });
    tocList.appendChild(frag);
  }

  function updateTocFill(visibleIds) {
    if (!tocFill) return;
    var visibleLinks = visibleIds.map(function (id) {
      return tocLinks[id];
    }).filter(Boolean);
    if (!visibleLinks.length) {
      tocFill.style.transform = "translateY(0px)";
      tocFill.style.height = "0px";
      return;
    }
    var bodyRect = tocList.getBoundingClientRect();
    var firstRect = visibleLinks[0].getBoundingClientRect();
    var lastRect = visibleLinks[visibleLinks.length - 1].getBoundingClientRect();
    var top = firstRect.top - bodyRect.top + 8;
    var height = Math.max(24, lastRect.bottom - firstRect.top - 16);
    tocFill.style.transform = "translateY(" + top.toFixed(1) + "px)";
    tocFill.style.height = height.toFixed(1) + "px";
  }

  function setTocState(activeId, visibleIds) {
    var firstVisible = visibleIds[0] || "";
    var lastVisible = visibleIds[visibleIds.length - 1] || "";
    Object.keys(tocLinks).forEach(function (key) {
      tocLinks[key].classList.toggle("is-active", key === activeId);
      tocLinks[key].classList.toggle("is-visible", visibleIds.indexOf(key) !== -1);
      tocLinks[key].classList.toggle("is-visible-first", key === firstVisible);
      tocLinks[key].classList.toggle("is-visible-last", key === lastVisible);
    });
    updateTocFill(visibleIds);
  }

  function headingDocumentTop(heading) {
    return heading.getBoundingClientRect().top + (window.scrollY || document.documentElement.scrollTop || 0);
  }

  function readingHeadingIds() {
    if (!tocHeadings.length) return [];
    var scrollY = window.scrollY || document.documentElement.scrollTop || 0;
    var viewportHeight = window.innerHeight || document.documentElement.clientHeight || 720;
    var bandTop = Math.min(150, viewportHeight * 0.22);
    var bandBottom = Math.max(bandTop + 220, viewportHeight * 0.82);
    var visibleIds = [];
    tocHeadings.forEach(function (heading) {
      var top = heading.getBoundingClientRect().top;
      if (top >= bandTop && top <= bandBottom && visibleIds.length < 4) {
        visibleIds.push(heading.id);
      }
    });
    if (visibleIds.length) return visibleIds;

    var readLine = scrollY + bandTop;
    var activeIndex = 0;
    tocHeadings.forEach(function (heading, index) {
      if (headingDocumentTop(heading) <= readLine) activeIndex = index;
    });
    return [tocHeadings[activeIndex].id];
  }

  function updateProgress() {
    updateTocFill(readingHeadingIds());
  }

  function updateTags() {
    if (!tags) return;
    tags.classList.remove("is-gathered", "is-hidden");
  }

  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
      updateTags();
      updateProgress();
      var visibleIds = readingHeadingIds();
      setTocState(visibleIds[0], visibleIds);
      ticking = false;
    });
  }

  maybeRenderUploadedPost();
  buildToc();
  updateTags();
  updateProgress();
  var initialVisibleIds = readingHeadingIds();
  setTocState(initialVisibleIds[0], initialVisibleIds);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  window.addEventListener("load", onScroll);
})();
