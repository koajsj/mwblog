/* ============================================================
   我们的小窝：全站滚动进入动画
   每次元素重新进入视口都会淡入并向上归位。
   ============================================================ */
(function () {
  "use strict";

  var SELECTORS = [
    ".home-about", ".home-posts",
    ".home-post-list a",
    ".rec-header", ".rec-filter", ".rec-timeline > *",
    ".pw-header", ".pw-toolbar", ".pw-stacks > *", ".pw-detail__bar", ".pw-grid > *",
    ".bi-head", ".bi-toolbar", ".post-item", ".tag-panel", ".archive-panel", ".bi-pager",
    ".article-head", ".quote-pair__item",
    ".act-head", ".act-form", ".act-section", ".act-stat", ".time-block", ".act-periods > *", ".act-bars > *"
  ].join(",");

  var observer = null;
  var watched = [];
  var startTimer = null;

  function visibleElement(el) {
    if (!el || el.classList.contains("sr-reveal")) return false;
    if (el.closest(".is-hidden, [hidden], .diary-backdrop, .pw-modal, .pw-lb, .rec-lb")) return false;
    if (el.closest(".corner-dogs")) return false;
    return true;
  }

  function prepare(el, index) {
    if (!visibleElement(el)) return;
    el.classList.add("sr-reveal");
    el.style.setProperty("--sr-delay", Math.min((index % 5) * 45, 180) + "ms");
    watched.push(el);
    if (observer) observer.observe(el);
  }

  function collect() {
    Array.prototype.slice.call(document.querySelectorAll(SELECTORS)).forEach(prepare);
    if (watched.length) document.documentElement.classList.add("sr-ready");
  }

  function start() {
    if (observer || startTimer) return;
    startTimer = window.setTimeout(function () {
      startTimer = null;
      if (!("IntersectionObserver" in window)) {
        collect();
        watched.forEach(function (el) { el.classList.add("is-visible"); });
        return;
      }

      observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          entry.target.classList.toggle("is-visible", entry.isIntersecting);
        });
      }, {
        threshold: 0.12,
        rootMargin: "0px 0px -8% 0px"
      });

      collect();
      watchMutations();
    }, 80);
  }

  function watchMutations() {
    if (!("MutationObserver" in window)) return;
    var mutationTimer = null;
    var mo = new MutationObserver(function () {
      window.clearTimeout(mutationTimer);
      mutationTimer = window.setTimeout(collect, 80);
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  function boot() {
    if (document.body.classList.contains("home-cover-open")) {
      window.addEventListener("home:revealed", start, { once: true });
    } else {
      start();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
