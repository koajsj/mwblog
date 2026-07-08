/* ============================================================
   我们的小窝 — 双人博客主页面交互
   作者筛选 / 标签筛选 / 文章数量更新
   ============================================================ */
(function () {
  "use strict";

  var postList = document.getElementById("postList");
  var posts = Array.prototype.slice.call(document.querySelectorAll(".post-item"));
  var filters = Array.prototype.slice.call(document.querySelectorAll(".bi-filter"));
  var tagGrid = document.getElementById("tagGrid");
  var tagButtons = Array.prototype.slice.call(document.querySelectorAll("#tagGrid button"));
  var clearTags = document.getElementById("clearTags");
  var postCount = document.getElementById("postCount");
  var empty = document.getElementById("postEmpty");
  var uploadToggle = document.getElementById("blogUploadToggle");
  var uploadPanel = document.getElementById("blogUploadPanel");
  var uploadInput = document.getElementById("blogUploadInput");
  var uploadHint = document.getElementById("blogUploadHint");
  var archiveCount = document.getElementById("archiveCount");
  var authorFilter = "all";
  var tagFilter = "all";

  function hasAuthor(post, who) {
    if (who === "all") return true;
    return post.getAttribute("data-authors").split(" ").indexOf(who) >= 0;
  }

  function hasTag(post, tag) {
    if (tag === "all") return true;
    return post.getAttribute("data-tags").split(" ").indexOf(tag) >= 0;
  }

  function authorLabel(who) {
    var data = window.CBBlog && window.CBBlog.authors[who];
    return data ? data.emoji + " " + data.name : who;
  }

  function addTagButton(tag) {
    if (!tag) return;
    var exists = tagButtons.some(function (btn) {
      return btn.getAttribute("data-tag") === tag;
    });
    if (exists) return;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-tag", tag);
    btn.textContent = tag;
    btn.addEventListener("click", function () {
      tagFilter = tag;
      tagButtons.forEach(function (item) {
        item.classList.toggle("is-active", item === btn);
      });
      render();
      postList.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    tagGrid.appendChild(btn);
    tagButtons.push(btn);
  }

  function buildPost(post) {
    var item = document.createElement("article");
    item.className = "post-item";
    item.setAttribute("data-authors", post.authors.join(" "));
    item.setAttribute("data-tags", post.tags.join(" "));

    var link = document.createElement("a");
    link.className = "post-item__link";
    link.href = "/blog/" + encodeURIComponent(post.id);

    var time = document.createElement("time");
    time.className = "post-item__date";
    time.setAttribute("datetime", post.date);
    time.textContent = window.CBBlog.displayDate(post.date);

    var title = document.createElement("h2");
    title.textContent = post.title;

    var summary = document.createElement("p");
    summary.textContent = post.summary || "A Markdown post newly added to the nest.";

    var meta = document.createElement("div");
    meta.className = "post-item__meta";
    post.authors.forEach(function (who) {
      var span = document.createElement("span");
      span.textContent = authorLabel(who);
      meta.appendChild(span);
    });
    var minutes = document.createElement("span");
    minutes.textContent = post.readMinutes + " min read";
    meta.appendChild(minutes);

    var tags = document.createElement("div");
    tags.className = "post-item__tags";
    post.tags.forEach(function (tag) {
      var span = document.createElement("span");
      span.textContent = tag;
      tags.appendChild(span);
      addTagButton(tag);
    });

    var arrow = document.createElement("span");
    arrow.className = "post-item__arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "›";

    link.appendChild(time);
    link.appendChild(title);
    link.appendChild(summary);
    link.appendChild(meta);
    link.appendChild(tags);
    link.appendChild(arrow);
    item.appendChild(link);
    return item;
  }

  function loadUploadedPosts() {
    if (!window.CBBlog) return;
    var frag = document.createDocumentFragment();
    window.CBBlog.all().forEach(function (post) {
      frag.appendChild(buildPost(post));
    });
    postList.insertBefore(frag, postList.firstChild);
    posts = Array.prototype.slice.call(document.querySelectorAll(".post-item"));
  }

  function render() {
    var visible = 0;
    posts.forEach(function (post) {
      var show = hasAuthor(post, authorFilter) && hasTag(post, tagFilter);
      post.classList.toggle("is-hidden", !show);
      if (show) visible += 1;
    });
    empty.classList.toggle("is-hidden", visible !== 0);
    postCount.textContent = "Page 1 · Showing " + visible + " posts";
    if (archiveCount) {
      archiveCount.textContent = "2026 · " + posts.length + " posts";
    }
  }

  filters.forEach(function (btn) {
    btn.addEventListener("click", function () {
      authorFilter = btn.getAttribute("data-filter");
      filters.forEach(function (item) {
        item.classList.toggle("is-active", item === btn);
      });
      render();
    });
  });

  tagButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      tagFilter = btn.getAttribute("data-tag");
      tagButtons.forEach(function (item) {
        item.classList.toggle("is-active", item === btn);
      });
      render();
      postList.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  clearTags.addEventListener("click", function () {
    tagFilter = "all";
    tagButtons.forEach(function (item) {
      item.classList.remove("is-active");
    });
    render();
  });

  function setUploadOpen(open) {
    uploadPanel.classList.toggle("is-hidden", !open);
    uploadToggle.setAttribute("aria-expanded", open ? "true" : "false");
    uploadToggle.textContent = open ? "Close upload" : "Upload Markdown";
  }

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsText(file, "utf-8");
    });
  }

  if (uploadToggle && uploadPanel && uploadInput) {
    uploadToggle.addEventListener("click", function () {
      setUploadOpen(uploadPanel.classList.contains("is-hidden"));
    });

    uploadInput.addEventListener("change", function () {
      var file = uploadInput.files && uploadInput.files[0];
      uploadHint.textContent = file ? "Selected: " + file.name : "Supports front matter: title, date, authors, tags, summary.";
    });

    uploadPanel.addEventListener("submit", function (ev) {
      // Astro 版本：表单直接 POST 到 /api/blog/upload，不在前端拦截。
      // 仅当存在旧的 window.CBBlog（纯前端原型）时才阻止默认行为。
      if (!window.CBBlog) {
        var file = uploadInput.files && uploadInput.files[0];
        if (file && !/\.(md|markdown|txt)$/i.test(file.name)) {
          ev.preventDefault();
          uploadHint.textContent = "Please choose a .md or .markdown file.";
          return;
        }
        uploadHint.textContent = "Uploading...";
        return;
      }
      ev.preventDefault();
      var file = uploadInput.files && uploadInput.files[0];
      if (!file) return;
      if (!/\.(md|markdown|txt)$/i.test(file.name)) {
        uploadHint.textContent = "Please choose a .md or .markdown file.";
        return;
      }
      uploadHint.textContent = "Reading Markdown...";
      readFileAsText(file).then(function (text) {
        var post = window.CBBlog.save(window.CBBlog.parseMarkdown(text, file.name));
        var card = buildPost(post);
        postList.insertBefore(card, postList.firstChild);
        posts = Array.prototype.slice.call(document.querySelectorAll(".post-item"));
        uploadPanel.reset();
        uploadHint.textContent = "Published: " + post.title;
        setUploadOpen(false);
        authorFilter = "all";
        filters.forEach(function (item) {
          item.classList.toggle("is-active", item.getAttribute("data-filter") === "all");
        });
        tagFilter = "all";
        tagButtons.forEach(function (item) { item.classList.remove("is-active"); });
        render();
      }).catch(function () {
        uploadHint.textContent = "Upload failed. Check the file and try again.";
      });
    });
  }

  loadUploadedPosts();
  render();
})();
