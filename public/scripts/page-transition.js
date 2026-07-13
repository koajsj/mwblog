/* ============================================================
   我们的小窝：全站页面跳转动画
   拦截站内普通链接，先播放离场动画，再进入目标页面。
   ============================================================ */
(function () {
  "use strict";

  var PIECES = [
    ".site-nav", ".home-profile",
    ".rec-back", ".rec-main", ".rec-header", ".rec-timeline",
    ".pw-back", ".pw-main",
    ".places-main",
    ".bi-top", ".bi-shell",
    ".blog-top", ".blog-tags", ".blog-shell",
    ".act-top", ".act-shell",
    ".todo-shell"
  ].join(",");

  var leaving = false;
  var lastScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
  var navHidden = false;
  var navTicking = false;

  function markPieces() {
    Array.prototype.slice.call(document.querySelectorAll(PIECES)).forEach(function (el) {
      el.classList.add("pt-page-piece");
    });
  }

  function enter() {
    markPieces();
    updateNavState(true);
    initNavIndicator();
    window.requestAnimationFrame(revealActiveMobileNavLink);
    // 一次性切换：旧态 = .pt-loading 把元素卡在隐藏；新态 =
    // .pt-ready + .pt-entered + .pt-page-piece 给出显示样式 + transition。
    // 浏览器对比前后样式后会触发 opacity / transform / filter 过渡。
    // 单纯 rAF 把两者拆开会被合并成"无变化"，过渡反而跑不起来。
    document.documentElement.classList.add("pt-ready");
    document.documentElement.classList.add("pt-entered");
    document.documentElement.classList.remove("pt-loading");
  }

  function samePageHash(url) {
    return url.pathname === location.pathname &&
      url.search === location.search &&
      url.hash &&
      url.hash !== location.hash;
  }

  function sameLocalFolder(url) {
    if (location.protocol !== "file:" || url.protocol !== "file:") return false;
    var currentPath = location.pathname.replace(/\\/g, "/");
    var targetPath = url.pathname.replace(/\\/g, "/");
    return currentPath.slice(0, currentPath.lastIndexOf("/") + 1) ===
      targetPath.slice(0, targetPath.lastIndexOf("/") + 1);
  }

  function sameSite(url) {
    if (sameLocalFolder(url)) return true;
    return url.origin === location.origin;
  }

  function shouldSkipLink(a, ev) {
    if (!a || leaving) return true;
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return true;
    if (a.target && a.target !== "_self") return true;
    if (a.hasAttribute("download")) return true;
    var raw = a.getAttribute("href");
    if (!raw || raw.charAt(0) === "#") return true;
    var url = new URL(raw, location.href);
    if (!sameSite(url)) return true;
    if (samePageHash(url)) return true;
    return false;
  }

  function shouldSkipHomeCover(href) {
    var url = new URL(href, location.href);
    var path = url.pathname.replace(/\\/g, "/");
    // Astro 路由首页就是 "/"
    return /(^|\/)index\.html$/.test(path) || path === "/" || path === "";
  }

  function homeHrefWithSkipFlag(href) {
    var url = new URL(href, location.href);
    if (shouldSkipHomeCover(url.href)) {
      url.searchParams.set("skipCover", "1");
      url.hash = "home";
    }
    return url.href;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function navContentWidth(nav, mobile, pillPad) {
    var brand = nav.querySelector(".site-nav__brand");
    var links = nav.querySelector(".site-nav__links");
    if (!brand || !links) return mobile ? 366 : 680;

    var linkItems = Array.prototype.slice.call(links.querySelectorAll("a"));
    var linkStyle = window.getComputedStyle(links);
    var linkGap = parseFloat(linkStyle.columnGap || linkStyle.gap || "0") || 0;
    var linksWidth = 0;

    linkItems.forEach(function (item) {
      linksWidth += item.getBoundingClientRect().width;
    });
    if (linkItems.length > 1) linksWidth += linkGap * (linkItems.length - 1);

    // 已登录时右侧还会渲染 .site-nav__auth（用户胶囊 + 退出），
    // 也得算进胶囊收缩的目标宽度，否则会跟品牌/首页字面挤在一起
    var auth = nav.querySelector(".site-nav__auth");
    var authWidth = 0;
    var gapCount = 1; // brand 与 links 之间默认有 1 个 gap
    if (auth) {
      authWidth = auth.getBoundingClientRect().width;
      if (authWidth > 0) {
        var authStyle = window.getComputedStyle(auth);
        authWidth += parseFloat(authStyle.marginLeft || "0") || 0;
        gapCount = 2; // brand-links, links-auth 两道 gap
      }
    }

    var barGap = mobile ? 14 : 24;
    return Math.ceil(
      brand.getBoundingClientRect().width +
      linksWidth +
      authWidth +
      barGap * gapCount +
      // 额外缓冲：避免 px 取整在 transition 中产生 0-2px 的轻微重叠
      18 +
      pillPad * 2
    );
  }

  function updateNavState(force) {
    var nav = document.querySelector(".site-nav");
    if (!nav) return;

    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    var viewport = window.innerWidth || document.documentElement.clientWidth || 0;
    var progress = y > 36 ? 1 : 0;
    var mobile = viewport < 680;
    var sideGap = mobile ? 10 : 14;
    var fullWidth = viewport;
    var fullPad = mobile ? 14 : 46;
    var pillPad = mobile ? 11 : 13;
    var contentWidth = navContentWidth(nav, mobile, pillPad);
    var pillWidth = Math.min(viewport - sideGap * 2, Math.max(contentWidth, mobile ? viewport - 24 : 0));
    var width = fullWidth + (pillWidth - fullWidth) * progress;
    var top = (mobile ? 8 : 14) * progress;
    var pad = fullPad + (pillPad - fullPad) * progress;
    var fullHeight = mobile ? 64 : 74;
    var pillHeight = mobile ? 50 : 56;
    var height = fullHeight + (pillHeight - fullHeight) * progress;
    var fullGap = mobile ? 16 : clamp(viewport * 0.12, 76, 220);
    var pillGap = mobile ? 14 : 24;
    var gap = fullGap + (pillGap - fullGap) * progress;
    var movingDown = y > lastScrollY + 2;
    var movingUp = y < lastScrollY - 2;

    nav.style.setProperty("--site-nav-progress", progress.toFixed(3));
    nav.style.setProperty("--site-nav-width", Math.max(width, 0).toFixed(1) + "px");
    nav.style.setProperty("--site-nav-top", top.toFixed(1) + "px");
    nav.style.setProperty("--site-nav-pad-x", pad.toFixed(1) + "px");
    nav.style.setProperty("--site-nav-height", height.toFixed(1) + "px");
    nav.style.setProperty("--site-nav-gap", gap.toFixed(1) + "px");

    if (y < 300) {
      navHidden = false;
    } else if (movingDown && y > 320) {
      navHidden = true;
    } else if (movingUp) {
      navHidden = false;
    } else if (force && y > 320) {
      navHidden = false;
    }

    nav.classList.toggle("is-nav-hidden", navHidden);
    lastScrollY = y;

    // 导航布局变了，指示器要重新对齐目标 tab（snap 模式不抖）
    if (navIndicator) {
      positionIndicator(hoveredNavLink || getActiveNavLink(), false);
    }
  }

  function scheduleNavUpdate() {
    if (navTicking) return;
    navTicking = true;
    window.requestAnimationFrame(function () {
      navTicking = false;
      updateNavState(false);
    });
  }

  /* ============================================================
     滑动指示器：hover 不同 tab 时浮条滑过去，颜色同步变化
     ============================================================ */
  var NAV_COLORS = {
    "index.html":    "#7aa6d4",   // 首页     - 白狗蓝
    "places.html":   "#83d0bc",   // 今年想去 - 薄荷绿
    "blog.html":     "#d49356",   // 双人博客 - 棕狗橙
    "records.html":  "#f5c1b6",   // 生活记录 - 粉
    "photos.html":   "#ffd186",   // 照片墙   - 黄
    "activity.html": "#b4a3da",   // 时段活动 - 紫
    "todo.html":     "#8fb47f",
    // Astro 干净路由
    "":          "#7aa6d4",
    "places":    "#83d0bc",
    "blog":      "#d49356",
    "records":   "#f5c1b6",
    "photos":    "#ffd186",
    "activity":  "#b4a3da",
    "todo":      "#8fb47f"
  };
  var navIndicator = null;
  var navIndicatorPet = null;
  var hoveredNavLink = null;

  function pageOf(href) {
    if (!href) return "";
    var url;
    try { url = new URL(href, location.href); } catch (e) { return ""; }
    var path = url.pathname.replace(/\/$/, "").replace(/^.*\//, "");
    if (path && NAV_COLORS[path] !== undefined) return path;
    return path || "index.html";
  }

  function getActiveNavLink() {
    var navLinks = document.querySelector(".site-nav__links");
    if (!navLinks) return null;
    return navLinks.querySelector("a.is-active, a[aria-current=page]") ||
           navLinks.querySelector("a");
  }

  function revealActiveMobileNavLink() {
    if (!window.matchMedia || !window.matchMedia("(max-width: 680px)").matches) return;
    var navLinks = document.querySelector(".site-nav__links");
    var active = getActiveNavLink();
    if (!navLinks || !active) return;
    var target = active.offsetLeft - (navLinks.clientWidth - active.offsetWidth) / 2;
    navLinks.scrollLeft = Math.max(0, target);
  }

  function positionIndicator(link, animate) {
    if (!navIndicator || !link || link.offsetWidth < 1) return;
    if (animate) navIndicator.classList.remove("is-snap");
    else         navIndicator.classList.add("is-snap");
    navIndicator.style.left = link.offsetLeft + "px";
    navIndicator.style.width = link.offsetWidth + "px";
    navIndicator.style.background =
      NAV_COLORS[pageOf(link.getAttribute("href"))] || "#7aa6d4";
    navIndicator.style.opacity = "1";
  }

  function initNavIndicator() {
    var navLinks = document.querySelector(".site-nav__links");
    if (!navLinks || navIndicator) return;       // 已初始化就跳过
    var links = navLinks.querySelectorAll("a");
    if (!links.length) return;

    navIndicator = document.createElement("span");
    navIndicator.className = "site-nav__indicator is-snap";
    navIndicator.setAttribute("aria-hidden", "true");
    navIndicatorPet = document.createElement("span");
    navIndicatorPet.className = "site-nav__pet";
    navIndicatorPet.textContent = "🐾";   // 🐾
    navIndicator.appendChild(navIndicatorPet);
    navLinks.appendChild(navIndicator);

    Array.prototype.forEach.call(links, function (link) {
      link.addEventListener("mouseenter", function () {
        hoveredNavLink = link;
        positionIndicator(link, true);
      });
    });
    navLinks.addEventListener("mouseleave", function () {
      hoveredNavLink = null;
      positionIndicator(getActiveNavLink(), true);
    });

    // 初次定位：snap，避免从 0 滑过来
    positionIndicator(getActiveNavLink(), false);
    // 进入动画 + 字体加载后再校准几次
    [220, 900, 1600].forEach(function (ms) {
      window.setTimeout(function () {
        positionIndicator(hoveredNavLink || getActiveNavLink(), false);
      }, ms);
    });
  }

  function leaveTo(href) {
    leaving = true;
    if (shouldSkipHomeCover(href)) {
      window.name = "cuteblog.skipHomeCover";
      try {
        sessionStorage.setItem("cuteblog.skipHomeCover", "1");
      } catch (e) {}
      try {
        localStorage.setItem("cuteblog.skipHomeCoverAt", String(Date.now()));
      } catch (e) {}
      href = homeHrefWithSkipFlag(href);
    }
    document.documentElement.classList.add("pt-leaving");
    location.href = href;
  }

  function onClick(ev) {
    var link = ev.target.closest && ev.target.closest("a");
    if (shouldSkipLink(link, ev)) return;
    ev.preventDefault();
    leaveTo(link.href);
  }

  window.addEventListener("pageshow", function () {
    leaving = false;
    document.documentElement.classList.remove("pt-leaving");
    updateNavState(true);
    if (!document.documentElement.classList.contains("pt-ready")) enter();
  });
  window.addEventListener("scroll", scheduleNavUpdate, { passive: true });
  window.addEventListener("resize", function () {
    updateNavState(true);
    revealActiveMobileNavLink();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enter);
  } else {
    enter();
  }
  document.addEventListener("click", onClick);
})();
