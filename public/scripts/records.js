/* ============================================================
   我们的小窝 — 生活记录页
   读取两人的日记（localStorage）+ 照片（IndexedDB / window.CBPhoto），
   按天分组渲染成便签时间线。便签上显示当天该作者的照片，点开看大图。
   ============================================================ */
(function () {
  "use strict";

  var AUTHORS = {
    white: { name: "白狗", emoji: "🐶" },
    brown: { name: "棕狗", emoji: "🐕" }
  };
  var MOODS = {
    happy: "😄 开心", loved: "🥰 幸福", calm: "😌 平静",
    tired: "🥱 疲惫", down: "😢 难过", moody: "😤 烦躁"
  };

  // 读取某人的日记（与 diary.js 的 Store 同一套 localStorage 键）
  function loadDiary(who) {
    try {
      var arr = JSON.parse(localStorage.getItem("cuteblog.diary." + who) || "[]");
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveDiary(who, date, mood, text) {
    var arr = loadDiary(who);
    var now = Date.now();
    arr.push({ id: "rec-" + now, date: date, mood: mood, text: text, ts: now });
    localStorage.setItem("cuteblog.diary." + who, JSON.stringify(arr));
  }

  function prettyDate(s) {
    var p = s.split("-");
    return Number(p[1]) + "月" + Number(p[2]) + "日";
  }
  function todayStr() {
    var d = new Date();
    function pad2(n) { return n < 10 ? "0" + n : String(n); }
    return d.getFullYear() + "-" +
      pad2(d.getMonth() + 1) + "-" +
      pad2(d.getDate());
  }
  function keyOf(who, date) { return who + "|" + date; }

  var timelineEl = document.getElementById("recTimeline");
  var filterEl   = document.getElementById("recFilter");
  var addToggle  = document.getElementById("recAddToggle");
  var formEl     = document.getElementById("recForm");
  var dateEl     = document.getElementById("recDate");
  var whoEl      = document.getElementById("recWho");
  var moodsEl    = document.getElementById("recMoods");
  var textEl     = document.getElementById("recText");
  var photosEl   = document.getElementById("recPhotos");
  var photoHint  = document.getElementById("recPhotoHint");
  var cancelBtn  = document.getElementById("recCancel");
  var filterWho  = "all";
  var formWho    = "white";
  var formMood   = "happy";

  var photoMap = {};   // "who|date" -> [photo, ...]
  var recUrls  = [];   // 便签缩略图的 objectURL，重渲染时回收

  function revokeUrls() {
    recUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    recUrls = [];
  }

  function collect() {
    var list = [];
    Object.keys(AUTHORS).forEach(function (who) {
      loadDiary(who).forEach(function (e, index) {
        list.push({
          id: e.id || (who + "-" + e.date + "-" + index),
          who: who,
          date: e.date,
          mood: e.mood,
          text: e.text,
          ts: e.ts || 0
        });
      });
    });
    return list;
  }

  function buildNote(entry) {
    var a = AUTHORS[entry.who];

    var note = document.createElement("article");
    note.className = "note note--" + entry.who;
    note.style.setProperty("--tilt", (Math.random() * 11 - 5.5).toFixed(1) + "deg");

    var card = document.createElement("div");
    card.className = "note__card";
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-expanded", "false");

    var tape = document.createElement("span");
    tape.className = "note__tape";

    var top = document.createElement("div");
    top.className = "note__top";
    var author = document.createElement("span");
    author.className = "note__author";
    author.textContent = a.emoji + " " + a.name;
    var mood = document.createElement("span");
    mood.className = "note__mood";
    mood.textContent = MOODS[entry.mood] || "";
    top.appendChild(author);
    top.appendChild(mood);

    card.appendChild(tape);
    card.appendChild(top);

    // 照片条：当天该作者的照片（一直可见，点开看大图）
    var photos = photoMap[keyOf(entry.who, entry.date)] || [];
    if (photos.length) {
      var strip = document.createElement("div");
      strip.className = "note__photos";
      photos.forEach(function (p, idx) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "note__photo";
        var img = document.createElement("img");
        var u = URL.createObjectURL(p.thumb);
        recUrls.push(u);
        img.src = u;
        img.alt = "照片";
        img.loading = "lazy";
        btn.appendChild(img);
        btn.addEventListener("click", function (ev) {
          ev.stopPropagation();              // 不触发便签展开
          openLightbox(photos, idx);
        });
        strip.appendChild(btn);
      });
      card.appendChild(strip);
    }

    var body = document.createElement("div");
    body.className = "note__body";
    var text = document.createElement("p");
    text.className = "note__text";
    text.textContent = entry.text;
    body.appendChild(text);

    var hint = document.createElement("span");
    hint.className = "note__hint";
    hint.textContent = "点击展开 ▾";

    card.appendChild(body);
    card.appendChild(hint);
    note.appendChild(card);

    function toggle() {
      var open = note.classList.toggle("is-open");
      card.setAttribute("aria-expanded", String(open));
      hint.textContent = open ? "点击收起 ▴" : "点击展开 ▾";
    }
    card.addEventListener("click", toggle);
    card.addEventListener("keydown", function (ev) {
      if (ev.target !== card) return;        // 缩略图按钮的按键不触发展开
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggle(); }
    });

    return note;
  }

  function renderTimeline() {
    revokeUrls();
    var list = collect();
    if (filterWho !== "all") {
      list = list.filter(function (e) { return e.who === filterWho; });
    }

    var byDate = {};
    list.forEach(function (e) {
      (byDate[e.date] = byDate[e.date] || []).push(e);
    });
    var dates = Object.keys(byDate).sort().reverse();

    timelineEl.textContent = "";

    if (!dates.length) {
      var empty = document.createElement("div");
      empty.className = "rec-empty";
      empty.textContent = "还没有生活记录，点上方按钮写一篇吧~";
      timelineEl.appendChild(empty);
      return;
    }

    dates.forEach(function (date) {
      var notes = byDate[date].slice().sort(function (a, b) {
        if (a.who !== b.who) return a.who < b.who ? -1 : 1;   // 白狗在前、棕狗在后
        return (b.ts || 0) - (a.ts || 0);
      });

      var day = document.createElement("section");
      day.className = "rec-day";

      var label = document.createElement("div");
      label.className = "rec-day__label";
      var ds = document.createElement("span");
      ds.className = "rec-day__date";
      ds.textContent = prettyDate(date);
      var dc = document.createElement("span");
      dc.className = "rec-day__count";
      dc.textContent = notes.length + " 条";
      label.appendChild(ds);
      label.appendChild(dc);

      var wrap = document.createElement("div");
      wrap.className = "rec-day__notes";
      notes.forEach(function (e) { wrap.appendChild(buildNote(e)); });

      day.appendChild(label);
      day.appendChild(wrap);
      timelineEl.appendChild(day);
    });
  }

  /* ---- 照片灯箱 ---- */
  var lbEl   = document.getElementById("recLb");
  var lbImg  = document.getElementById("recLbImg");
  var lbPrev = document.getElementById("recLbPrev");
  var lbNext = document.getElementById("recLbNext");
  var lbList = [], lbIndex = 0, lbUrl = null;

  function openLightbox(list, idx) {
    lbList = list;
    lbIndex = idx;
    var many = list.length > 1;
    lbPrev.style.display = many ? "" : "none";
    lbNext.style.display = many ? "" : "none";
    showLb();
    lbEl.classList.remove("is-hidden");
    document.addEventListener("keydown", lbKey);
  }
  function showLb() {
    if (lbUrl) { URL.revokeObjectURL(lbUrl); lbUrl = null; }
    var p = lbList[lbIndex];
    if (!p) return;
    lbUrl = URL.createObjectURL(p.full);
    lbImg.src = lbUrl;
  }
  function lbStep(d) {
    if (lbList.length < 2) return;
    lbIndex = (lbIndex + d + lbList.length) % lbList.length;
    showLb();
  }
  function closeLb() {
    lbEl.classList.add("is-hidden");
    if (lbUrl) { URL.revokeObjectURL(lbUrl); lbUrl = null; }
    document.removeEventListener("keydown", lbKey);
  }
  function lbKey(e) {
    if (e.key === "Escape") closeLb();
    else if (e.key === "ArrowLeft") lbStep(-1);
    else if (e.key === "ArrowRight") lbStep(1);
  }
  if (lbEl) {
    document.getElementById("recLbClose").addEventListener("click", closeLb);
    lbPrev.addEventListener("click", function () { lbStep(-1); });
    lbNext.addEventListener("click", function () { lbStep(1); });
    lbEl.addEventListener("click", function (e) { if (e.target === lbEl) closeLb(); });
  }

  /* ---- 筛选 ---- */
  filterEl.addEventListener("click", function (ev) {
    var btn = ev.target.closest(".rec-filter__btn");
    if (!btn) return;
    filterWho = btn.dataset.who;
    filterEl.querySelectorAll(".rec-filter__btn").forEach(function (b) {
      b.classList.toggle("is-active", b === btn);
    });
    renderTimeline();
  });

  /* ---- 添加生活记录 ---- */
  function setFormOpen(open) {
    formEl.classList.toggle("is-hidden", !open);
    addToggle.setAttribute("aria-expanded", open ? "true" : "false");
    addToggle.textContent = open ? "收起添加面板" : "＋ 添加生活记录";
  }

  function setFormWho(nextWho) {
    formWho = nextWho;
    whoEl.querySelectorAll(".rec-who__btn").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.dataset.who === formWho);
    });
  }

  function setFormMood(nextMood) {
    formMood = nextMood;
    moodsEl.querySelectorAll(".rec-mood").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.dataset.mood === formMood);
    });
  }

  function setFilter(nextWho) {
    filterWho = nextWho;
    filterEl.querySelectorAll(".rec-filter__btn").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.dataset.who === filterWho);
    });
  }

  function uploadSelectedPhotos(who, date) {
    var files = Array.prototype.slice.call(photosEl.files || []);
    if (!files.length || !window.CBPhoto) return Promise.resolve();
    photoHint.textContent = "正在保存照片…";
    return files.reduce(function (chain, file) {
      return chain.then(function () {
        if (file.type && file.type.indexOf("image/") !== 0) return;
        return window.CBPhoto.upload(file, who, date);
      });
    }, Promise.resolve()).then(function () {
      photoHint.textContent = "照片已同步进入照片墙。";
    });
  }

  addToggle.addEventListener("click", function () {
    setFormOpen(formEl.classList.contains("is-hidden"));
  });

  cancelBtn.addEventListener("click", function () {
    setFormOpen(false);
  });

  whoEl.addEventListener("click", function (ev) {
    var btn = ev.target.closest(".rec-who__btn");
    if (!btn) return;
    setFormWho(btn.dataset.who);
  });

  moodsEl.addEventListener("click", function (ev) {
    var btn = ev.target.closest(".rec-mood");
    if (!btn) return;
    setFormMood(btn.dataset.mood);
  });

  photosEl.addEventListener("change", function () {
    var count = photosEl.files ? photosEl.files.length : 0;
    photoHint.textContent = count ? "已选择 " + count + " 张照片，保存后同步进入照片墙。" : "照片会同步进入照片墙。";
  });

  formEl.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var text = textEl.value.trim();
    if (!text) return;
    saveDiary(formWho, dateEl.value, formMood, text);
    uploadSelectedPhotos(formWho, dateEl.value).then(loadPhotos).then(function (m) {
      photoMap = m;
      textEl.value = "";
      photosEl.value = "";
      photoHint.textContent = "照片会同步进入照片墙。";
      setFilter(formWho);
      setFormOpen(false);
      renderTimeline();
    }).catch(function () {
      textEl.value = "";
      photosEl.value = "";
      photoHint.textContent = "照片保存失败，可以稍后再试。";
      setFilter(formWho);
      setFormOpen(false);
      renderTimeline();
    });
  });

  /* ---- 启动：先读照片，再渲染 ---- */
  function loadPhotos() {
    if (!window.CBPhoto) return Promise.resolve({});
    return window.CBPhoto.all().then(function (list) {
      var m = {};
      list.forEach(function (p) {
        var k = keyOf(p.who, p.date);
        (m[k] = m[k] || []).push(p);
      });
      Object.keys(m).forEach(function (k) {
        m[k].sort(function (a, b) { return a.addedAt - b.addedAt; });
      });
      return m;
    }).catch(function () { return {}; });
  }

  loadPhotos().then(function (m) {
    photoMap = m;
    dateEl.value = todayStr();
    setFormOpen(false);
    renderTimeline();
  });
})();
