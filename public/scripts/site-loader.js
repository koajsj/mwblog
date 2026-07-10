(function () {
  "use strict";

  var root = document.documentElement;
  var done = false;

  function sameSite(url) {
    return url.origin === location.origin;
  }

  function shouldShowForLink(link, event) {
    if (!link || event.defaultPrevented || event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    if (link.target && link.target !== "_self") return false;
    if (link.hasAttribute("download")) return false;
    var href = link.getAttribute("href");
    if (!href || href.charAt(0) === "#") return false;
    var url;
    try {
      url = new URL(href, location.href);
    } catch (error) {
      return false;
    }
    if (!sameSite(url)) return false;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return false;
    return true;
  }

  function hideLoader() {
    if (done) return;
    done = true;
    root.classList.add("site-loaded");
    root.classList.remove("site-loading", "site-leaving");
  }

  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest("a");
    if (!shouldShowForLink(link, event)) return;
    root.classList.add("site-loading", "site-leaving");
    root.classList.remove("site-loaded");
  }, true);

  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form || form.target && form.target !== "_self") return;
    queueMicrotask(function () {
      if (event.defaultPrevented) return;
      root.classList.add("site-loading", "site-leaving");
      root.classList.remove("site-loaded");
    });
  });

  if (document.readyState === "complete") {
    hideLoader();
  } else {
    window.addEventListener("load", hideLoader, { once: true });
  }
})();
