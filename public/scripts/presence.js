/* Report recent activity only while a private page is visible. */
(function () {
  "use strict";

  var HEARTBEAT_MS = 45 * 1000;
  var heartbeatTimer = null;

  function reportPresence() {
    if (document.hidden || !window.fetch) return;
    fetch("/api/status/presence", {
      method: "POST",
      credentials: "same-origin"
    }).then(function (response) {
      if (!response.ok) return;
      window.dispatchEvent(new CustomEvent("our-nest:presence"));
    }).catch(function () {
      // A transient network failure should not interrupt the current page.
    });
  }

  function startHeartbeat() {
    reportPresence();
    if (heartbeatTimer) window.clearInterval(heartbeatTimer);
    heartbeatTimer = window.setInterval(reportPresence, HEARTBEAT_MS);
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) reportPresence();
  });
  window.addEventListener("pageshow", reportPresence);
  startHeartbeat();
})();
