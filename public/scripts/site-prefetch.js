(function () {
  "use strict";

  var prefetched = new Set();
  var canPrefetch = "HTMLLinkElement" in window;

  function shouldPrefetch(link) {
    if (!canPrefetch || !link) return false;
    if (link.target && link.target !== "_self") return false;
    if (link.hasAttribute("download")) return false;
    var raw = link.getAttribute("href");
    if (!raw || raw.charAt(0) === "#") return false;

    var url;
    try {
      url = new URL(raw, location.href);
    } catch (error) {
      return false;
    }

    if (url.origin !== location.origin) return false;
    if (url.pathname.startsWith("/api/")) return false;
    if (url.pathname === location.pathname && url.search === location.search) return false;

    return url;
  }

  function prefetch(link) {
    var url = shouldPrefetch(link);
    if (!url) return;

    var key = url.href;
    if (prefetched.has(key)) return;
    prefetched.add(key);

    var hint = document.createElement("link");
    hint.rel = "prefetch";
    hint.href = key;
    hint.as = "document";
    document.head.appendChild(hint);
  }

  document.addEventListener("pointerenter", function (event) {
    var link = event.target.closest && event.target.closest("a");
    prefetch(link);
  }, true);

  document.addEventListener("focusin", function (event) {
    var link = event.target.closest && event.target.closest("a");
    prefetch(link);
  });

  document.addEventListener("touchstart", function (event) {
    var link = event.target.closest && event.target.closest("a");
    prefetch(link);
  }, { passive: true, capture: true });
})();
