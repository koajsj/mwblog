/* ============================================================
   我们的小窝 — 照片墙
   照片按日期分组，每天一摞随机角度叠放；点进去看当天网格 + 灯箱。
   照片存取 + 压缩在 photo-store.js 的 window.CBPhoto 里（与生活记录共用）。
   灯箱底部会显示当天该作者写的生活记录文字。
   ============================================================ */
(function () {
  "use strict";

  var CBPhoto = window.CBPhoto;

  var AUTHORS = {
    white: { name: "白狗", emoji: "🐶" },
    brown: { name: "棕狗", emoji: "🐕" }
  };
  var MOODS = {
    happy: "😄 开心", loved: "🥰 幸福", calm: "😌 平静",
    tired: "🥱 疲惫", down: "😢 难过", moody: "😤 烦躁"
  };

  /* ---- 读生活记录（localStorage，与 diary.js 同一套键）---- */
  function loadDiaryEntry(who, date) {
    try {
      var arr = JSON.parse(localStorage.getItem("cuteblog.diary." + who) || "[]");
      if (!Array.isArray(arr)) return null;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].date === date) return arr[i];
      }
      return null;
    } catch (e) { return null; }
  }

  /* ---- 工具 ---- */
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function prettyDate(s) {
    var p = s.split("-");
    return Number(p[1]) + "月" + Number(p[2]) + "日";
  }
  function rand(min, max) { return Math.random() * (max - min) + min; }

  /* ============================================================
     状态 + DOM
     ============================================================ */
  var wallEl        = document.getElementById("pwWall");
  var detailEl      = document.getElementById("pwDetail");
  var stacksEl      = document.getElementById("pwStacks");
  var gridEl        = document.getElementById("pwGrid");
  var detailDateEl  = document.getElementById("pwDetailDate");
  var detailCountEl = document.getElementById("pwDetailCount");

  var modal     = document.getElementById("pwModal");
  var whoEl     = document.getElementById("pwWho");
  var dateInput = document.getElementById("pwDate");
  var fileInput = document.getElementById("pwFile");
  var statusEl  = document.getElementById("pwStatus");

  var lbEl      = document.getElementById("pwLb");
  var lbImg     = document.getElementById("pwLbImg");
  var lbCap     = document.getElementById("pwLbCap");
  var lbDiaryEl = document.getElementById("pwLbDiary");
  var lbPrev    = document.getElementById("pwLbPrev");
  var lbNext    = document.getElementById("pwLbNext");

  var photos      = [];     // 全部记录（含 Blob）
  var wallUrls    = [];     // 照片墙的 objectURL
  var detailUrls  = [];     // 详情网格的 objectURL
  var currentDate = null;   // 当前打开的详情日期
  var uploadWho   = "white";
  var busy        = false;  // 上传处理中

  var lbList = [], lbIndex = 0, lbUrl = null;

  /* 3D 切片翻转的状态 */
  var SLICE_EASE = "cubic-bezier(0.66, 0.02, 0.34, 1)";
  var SHADE_MAX  = "0.6";     // 翻转中背向一面的最深暗度，增强体积感
  var sliceBusy    = false;   // 翻转动画进行中，期间忽略再次切换
  var pendingSlide = null;    // { finish, timer }，未播完时强制收尾用
  var lbGen        = 0;       // 灯箱开/关代数，作废异步预载结果
  var lbFlipIdx    = 0;       // 翻转计数，偶数=切片翻转 / 奇数=整体翻转

  function revoke(arr) {
    arr.forEach(function (u) { URL.revokeObjectURL(u); });
    arr.length = 0;
  }
  function urlOf(blob, bucket) {
    var u = URL.createObjectURL(blob);
    bucket.push(u);
    return u;
  }

  /* ---- 按日期分组，组内按添加时间倒序 ---- */
  function byDate() {
    var map = {};
    photos.forEach(function (p) { (map[p.date] = map[p.date] || []).push(p); });
    Object.keys(map).forEach(function (d) {
      map[d].sort(function (a, b) { return b.addedAt - a.addedAt; });
    });
    return map;
  }
  function authorSummary(list) {
    var w = 0, b = 0;
    list.forEach(function (p) { if (p.who === "brown") b++; else w++; });
    var parts = [];
    if (w) parts.push("🐶 " + w);
    if (b) parts.push("🐕 " + b);
    return parts.join("　");
  }

  /* ============================================================
     照片墙
     ============================================================ */
  function renderWall() {
    revoke(wallUrls);
    stacksEl.textContent = "";
    var map = byDate();
    var dates = Object.keys(map).sort().reverse();

    if (!dates.length) {
      var empty = document.createElement("div");
      empty.className = "pw-empty";
      empty.textContent = "还没有照片，点上面的「＋ 上传照片」添加第一张吧~";
      stacksEl.appendChild(empty);
      return;
    }
    dates.forEach(function (date) {
      stacksEl.appendChild(buildStack(date, map[date]));
    });
  }

  function buildStack(date, list) {
    var cell = document.createElement("div");
    cell.className = "pw-stack-cell";

    var stack = document.createElement("button");
    stack.className = "pw-stack";
    stack.type = "button";
    stack.setAttribute("aria-label", prettyDate(date) + "，共 " + list.length + " 张照片");

    // 取最多 3 张叠放，最新的在最上层
    var fan = list.slice(0, 3);
    for (var i = fan.length - 1; i >= 0; i--) {
      var depth = i;  // 0 = 封面（最新）
      var layer = document.createElement("span");
      layer.className = "pw-stack__layer";
      var rot = depth === 0 ? rand(-3, 3)
              : depth === 1 ? rand(5, 11)
              :               rand(-11, -5);
      layer.style.setProperty("--rot", rot.toFixed(1) + "deg");
      layer.style.setProperty("--tx", (depth === 0 ? 0 : rand(-8, 8)).toFixed(0) + "px");
      layer.style.setProperty("--ty", (depth * rand(2, 5)).toFixed(0) + "px");
      var im = document.createElement("img");
      im.loading = "lazy";
      im.alt = "";
      im.src = urlOf(fan[i].thumb, wallUrls);
      layer.appendChild(im);
      stack.appendChild(layer);
    }

    var count = document.createElement("span");
    count.className = "pw-stack__count";
    count.textContent = list.length + " 张";
    stack.appendChild(count);

    stack.addEventListener("click", function () { openDetail(date); });

    var meta = document.createElement("div");
    meta.className = "pw-stack__meta";
    var name = document.createElement("div");
    name.className = "pw-stack__name";
    name.textContent = prettyDate(date);
    var sub = document.createElement("div");
    sub.className = "pw-stack__sub";
    sub.textContent = authorSummary(list);
    meta.appendChild(name);
    meta.appendChild(sub);

    cell.appendChild(stack);
    cell.appendChild(meta);
    return cell;
  }

  /* ============================================================
     详情视图（某天的网格）
     ============================================================ */
  function openDetail(date) {
    currentDate = date;
    var list = (byDate()[date] || []);
    detailDateEl.textContent = prettyDate(date);
    detailCountEl.textContent = "共 " + list.length + " 张";
    renderGrid(list);
    wallEl.classList.add("is-hidden");
    detailEl.classList.remove("is-hidden");
    window.scrollTo(0, 0);
  }

  function backToWall() {
    revoke(detailUrls);
    currentDate = null;
    detailEl.classList.add("is-hidden");
    wallEl.classList.remove("is-hidden");
  }

  function renderGrid(list) {
    revoke(detailUrls);
    gridEl.textContent = "";
    list.forEach(function (p, idx) {
      gridEl.appendChild(buildPhotoCard(p, list, idx));
    });
  }

  function buildPhotoCard(p, list, idx) {
    var a = AUTHORS[p.who] || AUTHORS.white;

    var fig = document.createElement("figure");
    fig.className = "pw-photo pw-photo--" + (p.who === "brown" ? "brown" : "white");
    fig.style.setProperty("--tilt", rand(-5, 5).toFixed(1) + "deg");

    var tape = document.createElement("span");
    tape.className = "pw-photo__tape";

    var img = document.createElement("img");
    img.className = "pw-photo__img";
    img.loading = "lazy";
    img.alt = a.name + "上传的照片";
    img.src = urlOf(p.thumb, detailUrls);

    var cap = document.createElement("figcaption");
    cap.className = "pw-photo__cap";
    cap.textContent = a.emoji + " " + a.name;

    fig.appendChild(tape);
    fig.appendChild(img);
    fig.appendChild(cap);
    fig.addEventListener("click", function () { openLightbox(list, idx); });
    return fig;
  }

  /* ============================================================
     灯箱
     ============================================================ */
  function openLightbox(list, idx) {
    lbGen++;
    sliceBusy = false;
    lbFlipIdx = 0;              // 每次重新打开，从切片翻转开始
    lbList = list;
    lbIndex = idx;
    var many = list.length > 1;
    lbPrev.style.display = many ? "" : "none";
    lbNext.style.display = many ? "" : "none";
    showLbPhoto();
    lbEl.classList.remove("is-hidden");
    document.addEventListener("keydown", lbKey);
  }
  function showLbPhoto() {
    if (lbUrl) { URL.revokeObjectURL(lbUrl); lbUrl = null; }
    var p = lbList[lbIndex];
    if (!p) return;
    lbUrl = URL.createObjectURL(p.full);
    lbImg.src = lbUrl;
    var a = AUTHORS[p.who] || AUTHORS.white;
    lbImg.alt = a.name + "上传的照片";
    lbCap.textContent = a.emoji + " " + a.name + " · " + prettyDate(p.date) +
                        "　( " + (lbIndex + 1) + " / " + lbList.length + " )";
    renderLbDiary(p);
  }
  /* 灯箱底部展示当天该作者的生活记录 */
  function renderLbDiary(p) {
    lbDiaryEl.textContent = "";
    var entry = loadDiaryEntry(p.who, p.date);
    if (!entry || !entry.text) {
      lbDiaryEl.classList.add("is-hidden");
      return;
    }
    var a = AUTHORS[p.who] || AUTHORS.white;
    var head = document.createElement("div");
    head.className = "pw-lb__diary-head";
    head.textContent = a.emoji + " " + a.name + "这天的记录" +
      (MOODS[entry.mood] ? "　·　" + MOODS[entry.mood] : "");
    var txt = document.createElement("div");
    txt.className = "pw-lb__diary-text";
    txt.textContent = entry.text;
    lbDiaryEl.appendChild(head);
    lbDiaryEl.appendChild(txt);
    lbDiaryEl.classList.remove("is-hidden");
  }
  function prefersReducedMotion() {
    return !!(window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function lbStep(d) {
    if (lbList.length < 2 || sliceBusy) return;
    var nextIndex = (lbIndex + d + lbList.length) % lbList.length;
    if (prefersReducedMotion()) {       // 尊重系统「减少动态效果」
      lbIndex = nextIndex;
      showLbPhoto();
      return;
    }
    sliceTransition(nextIndex, d > 0);
  }

  /* ---- 切换照片：3D 翻转露出下一张；每隔一次做不分块的整体翻转 ---- */
  function sliceTransition(nextIndex, forward) {
    var toPhoto = lbList[nextIndex];
    if (!toPhoto) return;
    var rect = lbImg.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) {   // 兜底：图还没渲染好就直接切
      lbIndex = nextIndex;
      showLbPhoto();
      return;
    }
    sliceBusy = true;
    var whole = (lbFlipIdx % 2) === 1;         // 隔一次：整体翻转(不分块)
    lbFlipIdx++;
    var gen = lbGen;
    var fromUrl = lbUrl;
    var toUrl = URL.createObjectURL(toPhoto.full);
    var pre = new Image();
    pre.onload = function () {
      if (gen !== lbGen) {                     // 灯箱已被关闭，作废
        URL.revokeObjectURL(toUrl);
        return;
      }
      runSlice(rect, fromUrl, toUrl,
               pre.naturalWidth || rect.width,
               pre.naturalHeight || rect.height,
               nextIndex, forward, whole);
    };
    pre.onerror = function () {                // 预载失败：退回直接切换
      URL.revokeObjectURL(toUrl);
      sliceBusy = false;
      if (gen !== lbGen) return;
      lbIndex = nextIndex;
      showLbPhoto();
    };
    pre.src = toUrl;
  }

  /* 造一个长方体的面：贴图 + 一层可调明暗的阴影(增强体积感) */
  function makeFace(url, bgSize, bgPos, transform, dur, delay, shade0) {
    var face = document.createElement("div");
    face.className = "pw-slice__face";
    face.style.backgroundImage = "url(" + url + ")";
    face.style.backgroundSize = bgSize;
    face.style.backgroundPosition = bgPos;
    face.style.transform = transform;
    var shade = document.createElement("div");
    shade.className = "pw-slice__shade";
    shade.style.opacity = shade0;
    shade.style.transition = "opacity " + dur + "ms " + SLICE_EASE;
    shade.style.transitionDelay = delay;
    face.appendChild(shade);
    return { face: face, shade: shade };
  }

  function runSlice(rect, fromUrl, toUrl, nW, nH, nextIndex, forward, whole) {
    var W = rect.width, H = rect.height;
    var vertical = Math.random() < 0.5;        // 竖翻(绕 Y) 还是横翻(绕 X)
    var N = whole ? 1 : (3 + Math.floor(Math.random() * 6)); // 整体翻=1 条
    var step = whole ? 0 : Math.max(55, Math.min(95, Math.round(440 / N)));
    var reverse = Math.random() < 0.5;         // 波浪从哪一端开始
    var dur = whole ? 780 : 660;               // 单条翻转时长(ms)
    var seam = whole ? 0 : 1;                  // 切片相互重叠 1px，遮接缝
    var rotAxis = vertical ? "Y" : "X";

    // 翻转方向整次统一，由「上一张 / 下一张」决定，绕长方体中心轴翻 90°
    var wrapFlip = forward ? (vertical ? -90 : 90) : (vertical ? 90 : -90);
    var sideAngle = -wrapFlip;                 // 侧面预先反向转开 90°

    var unit = (vertical ? W : H) / N;         // 每条的步进宽 / 高
    var depth = unit + seam;                   // 长方体厚度=切片宽，方截面
    var half = depth / 2;

    // 正/侧面都停在 translateZ(+half)，会被透视放大 f 倍；给整个
    // 舞台反向缩放 1/f，使翻转前后都回到真实尺寸，无缩放落差。
    var persp = Math.max(1500, half * 2.6);
    var f = persp / (persp - half);

    var box = document.createElement("div");
    box.className = "pw-slicebox";
    box.style.left = rect.left + "px";
    box.style.top = rect.top + "px";
    box.style.width = W + "px";
    box.style.height = H + "px";
    box.style.perspective = persp + "px";
    box.style.transform = "scale(" + (1 / f) + ")";

    // 下一张图按 cover 适配到当前舞台，避免被拉伸变形
    var cover = Math.max(W / nW, H / nH);
    var drawW = nW * cover, drawH = nH * cover;
    var offX = (W - drawW) / 2, offY = (H - drawH) / 2;

    var slices = [];

    for (var i = 0; i < N; i++) {
      var slice = document.createElement("div");
      slice.className = "pw-slice";
      if (vertical) {
        slice.style.left = (i * unit) + "px";
        slice.style.top = "0";
        slice.style.width = depth + "px";
        slice.style.height = H + "px";
      } else {
        slice.style.left = "0";
        slice.style.top = (i * unit) + "px";
        slice.style.width = W + "px";
        slice.style.height = depth + "px";
      }
      slice.style.transform = "rotate" + rotAxis + "(0deg)";
      slice.style.transition = "transform " + dur + "ms " + SLICE_EASE;
      var delay = ((reverse ? (N - 1 - i) : i) * step) + "ms";
      slice.style.transitionDelay = delay;

      // 正面：当前图，长方体朝外的一面（起始无阴影）
      var front = makeFace(fromUrl, W + "px " + H + "px",
        vertical ? (-(i * unit)) + "px 0px" : "0px " + (-(i * unit)) + "px",
        "translateZ(" + half + "px)", dur, delay, "0");
      // 侧面：下一张图，长方体相邻的一面，翻完正好朝外（起始最暗）
      var side = makeFace(toUrl, drawW + "px " + drawH + "px",
        vertical ? (offX - i * unit) + "px " + offY + "px"
                 : offX + "px " + (offY - i * unit) + "px",
        "rotate" + rotAxis + "(" + sideAngle + "deg) translateZ(" + half + "px)",
        dur, delay, SHADE_MAX);

      slice.appendChild(front.face);
      slice.appendChild(side.face);
      box.appendChild(slice);
      slices.push({ el: slice, frontShade: front.shade, sideShade: side.shade });
    }

    lbEl.appendChild(box);
    lbImg.style.visibility = "hidden";
    void box.offsetWidth;                      // 强制重排，保证过渡能触发

    requestAnimationFrame(function () {
      slices.forEach(function (s) {
        s.el.style.transform = "rotate" + rotAxis + "(" + wrapFlip + "deg)";
        s.frontShade.style.opacity = SHADE_MAX;  // 正面转走→渐暗
        s.sideShade.style.opacity = "0";         // 侧面转入→渐亮
      });
    });

    function finish() {
      if (!pendingSlide) return;
      clearTimeout(pendingSlide.timer);
      pendingSlide = null;
      if (box.parentNode) box.parentNode.removeChild(box);
      URL.revokeObjectURL(fromUrl);
      lbUrl = toUrl;
      lbIndex = nextIndex;
      lbImg.src = toUrl;
      lbImg.style.visibility = "";
      var p = lbList[lbIndex];
      if (p) {
        var a = AUTHORS[p.who] || AUTHORS.white;
        lbImg.alt = a.name + "上传的照片";
        lbCap.textContent = a.emoji + " " + a.name + " · " +
          prettyDate(p.date) +
          "　( " + (lbIndex + 1) + " / " + lbList.length + " )";
        renderLbDiary(p);
      }
      sliceBusy = false;
    }

    pendingSlide = {
      finish: finish,
      timer: setTimeout(finish, (N - 1) * step + dur + 90)
    };
  }

  function closeLightbox() {
    if (pendingSlide) pendingSlide.finish();   // 没播完就强制收尾
    lbGen++;
    sliceBusy = false;
    lbEl.classList.add("is-hidden");
    if (lbUrl) { URL.revokeObjectURL(lbUrl); lbUrl = null; }
    document.removeEventListener("keydown", lbKey);
  }
  function lbKey(e) {
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowLeft") lbStep(-1);
    else if (e.key === "ArrowRight") lbStep(1);
  }
  function deleteCurrent() {
    if (sliceBusy) return;             // 翻转动画期间不处理删除
    var p = lbList[lbIndex];
    if (!p) return;
    if (!window.CBConfirmDelete) return;
    window.CBConfirmDelete("确定删除这张照片吗？删除后无法恢复。", {
      title: "删除照片？",
      confirmText: "删除",
    }).then(function (ok) {
      if (!ok) return;
      CBPhoto.remove(p.id).then(function () {
        photos = photos.filter(function (x) { return x.id !== p.id; });
        closeLightbox();
        renderWall();
        if (currentDate && (byDate()[currentDate] || []).length) {
          openDetail(currentDate);
        } else {
          backToWall();
        }
      }).catch(function (e) {
        window.alert("删除失败：" + (e && e.message || e));
      });
    });
  }

  /* ============================================================
     上传弹窗
     ============================================================ */
  function openModal() {
    uploadWho = "white";
    whoEl.querySelectorAll(".pw-who__btn").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.who === "white");
    });
    dateInput.value = todayStr();
    dateInput.max = todayStr();
    statusEl.textContent = "";
    fileInput.value = "";
    busy = false;
    modal.classList.remove("is-hidden");
  }
  function closeModal() {
    if (busy) return;            // 处理中不关闭
    modal.classList.add("is-hidden");
  }

  whoEl.addEventListener("click", function (e) {
    var btn = e.target.closest(".pw-who__btn");
    if (!btn) return;
    uploadWho = btn.dataset.who;
    whoEl.querySelectorAll(".pw-who__btn").forEach(function (b) {
      b.classList.toggle("is-active", b === btn);
    });
  });

  fileInput.addEventListener("change", function () {
    var files = [].slice.call(fileInput.files || []);
    if (!files.length) return;
    var date = dateInput.value || todayStr();
    var who = uploadWho;

    busy = true;
    var total = files.length, done = 0, ok = 0;
    statusEl.textContent = "正在处理 0 / " + total + " …";

    // 串行处理，避免大图一次性占满内存
    files.reduce(function (chain, file) {
      return chain.then(function () {
        if (file.type && file.type.indexOf("image/") !== 0) { done++; return; }
        return CBPhoto.upload(file, who, date)
          .then(function (rec) { photos.push(rec); ok++; })
          .catch(function () { /* 单张失败跳过 */ })
          .then(function () {
            done++;
            statusEl.textContent = "正在处理 " + done + " / " + total + " …";
          });
      });
    }, Promise.resolve()).then(function () {
      busy = false;
      statusEl.textContent = ok ? ("已添加 " + ok + " 张照片 ✓")
                                : "没有成功添加照片，请换张图片试试";
      renderWall();
      if (ok) setTimeout(function () { modal.classList.add("is-hidden"); }, 800);
    });
  });

  /* ============================================================
     加载 + 事件绑定
     ============================================================ */
  function load() {
    if (!CBPhoto) {
      stacksEl.innerHTML =
        '<div class="pw-empty">照片模块未加载（缺少 photo-store.js）</div>';
      return;
    }
    CBPhoto.all().then(function (list) {
      photos = list;
      renderWall();
    }).catch(function (e) {
      stacksEl.textContent = "";
      var err = document.createElement("div");
      err.className = "pw-empty";
      err.textContent = "照片读取失败：" + (e && e.message || e);
      stacksEl.appendChild(err);
    });
  }

  document.getElementById("pwUploadBtn").addEventListener("click", openModal);
  document.getElementById("pwModalClose").addEventListener("click", closeModal);
  document.getElementById("pwModalMask").addEventListener("click", closeModal);
  document.getElementById("pwBackBtn").addEventListener("click", backToWall);
  document.getElementById("pwLbClose").addEventListener("click", closeLightbox);
  document.getElementById("pwLbDelete").addEventListener("click", deleteCurrent);
  lbPrev.addEventListener("click", function () { lbStep(-1); });
  lbNext.addEventListener("click", function () { lbStep(1); });
  lbEl.addEventListener("click", function (e) { if (e.target === lbEl) closeLightbox(); });

  load();
})();
