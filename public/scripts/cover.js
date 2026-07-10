/* 首页封面花瓣和发现页动效 */
(function () {
  "use strict";

  var cover = document.getElementById("homeCover");
  var canvas = document.getElementById("coverPetals");
  var explore = document.getElementById("exploreHome");
  var discovery = document.getElementById("homeDiscoveryIntro");
  var discoveryLineOne = document.getElementById("discoveryLineOne");
  var discoveryLineTwo = document.getElementById("discoveryLineTwo");
  if (!cover || !canvas || !explore) return;

  var DISCOVERY_KEY = "cuteblog.discoveryIntro.v1";
  var DISCOVERY_LINES = [
    "Oh, how did you find this place?",
    "Come in and take a look at our little world."
  ];
  var ctx = canvas.getContext("2d");
  var petals = [];
  var raf = null;
  var pointer = { x: -9999, y: -9999, active: false };
  var palette = [
    "rgba(255, 218, 226, 0.86)",
    "rgba(255, 241, 217, 0.82)",
    "rgba(255, 250, 255, 0.76)",
    "rgba(247, 193, 210, 0.68)"
  ];

  function cleanSkipAddress(params, keepHash) {
    var clean = location.pathname + (params.toString() ? "?" + params.toString() : "") + keepHash;
    try {
      if (history.replaceState) history.replaceState(null, "", clean);
    } catch (e) {}
  }

  function referrerSaysHome() {
    if (!document.referrer) return false;
    try {
      var from = new URL(document.referrer);
      var fromPath = from.pathname.replace(/\\/g, "/");
      var sameHost = from.protocol === location.protocol && from.host === location.host;
      var fromProjectPage = /^\/(blog|records|photos|activity)(\/|$)/.test(fromPath);
      return sameHost && fromProjectPage;
    } catch (e) {
      return false;
    }
  }

  function shouldSkipCover() {
    var params = new URLSearchParams(location.search);
    var hash = (location.hash || "").toLowerCase();
    var hashSaysHome = hash === "#home" || hash === "#main" || hash === "#skipcover";
    var querySaysHome = params.get("skipCover") === "1";
    var referrerSaysMainHome = referrerSaysHome();
    var windowSaysHome = window.name === "cuteblog.skipHomeCover";
    var storageSaysHome = false;
    var localSaysHome = false;

    if (windowSaysHome) {
      window.name = "";
    }

    try {
      storageSaysHome = sessionStorage.getItem("cuteblog.skipHomeCover") === "1";
      if (storageSaysHome || querySaysHome || hashSaysHome || referrerSaysMainHome) {
        sessionStorage.removeItem("cuteblog.skipHomeCover");
      }
    } catch (e) {}

    try {
      var localMark = parseInt(localStorage.getItem("cuteblog.skipHomeCoverAt") || "0", 10);
      localSaysHome = localMark && Date.now() - localMark < 15000;
      if (localSaysHome || querySaysHome || hashSaysHome || referrerSaysMainHome) {
        localStorage.removeItem("cuteblog.skipHomeCoverAt");
      }
    } catch (e) {}

    if (querySaysHome || hashSaysHome || storageSaysHome || localSaysHome || referrerSaysMainHome || windowSaysHome) {
      if (querySaysHome) params.delete("skipCover");
      cleanSkipAddress(params, hashSaysHome ? "" : location.hash);
      return true;
    }

    return false;
  }

  function revealHomeNow() {
    if (discovery) discovery.hidden = true;
    cover.hidden = true;
    document.body.classList.remove("home-cover-open");
    document.body.classList.add("home-revealed");
    window.dispatchEvent(new CustomEvent("home:revealed"));
  }

  function discoverySeen() {
    try {
      return localStorage.getItem(DISCOVERY_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function markDiscoverySeen() {
    try {
      localStorage.setItem(DISCOVERY_KEY, "1");
    } catch (e) {}
  }

  function reducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function typeLine(el, text, done) {
    if (!el) {
      done();
      return;
    }
    if (reducedMotion()) {
      el.textContent = text;
      el.classList.add("is-done");
      done();
      return;
    }
    var i = 0;
    el.textContent = "";
    el.classList.add("is-typing");
    var timer = window.setInterval(function () {
      i += 1;
      el.textContent = text.slice(0, i);
      if (i >= text.length) {
        window.clearInterval(timer);
        el.classList.remove("is-typing");
        el.classList.add("is-done");
        window.setTimeout(done, 360);
      }
    }, 76);
  }

  function runDiscoveryIntro(done) {
    if (!discovery || discovery.hidden || discoverySeen() || document.documentElement.classList.contains("home-intro-seen")) {
      if (discovery) discovery.hidden = true;
      done();
      return;
    }

    typeLine(discoveryLineOne, DISCOVERY_LINES[0], function () {
      typeLine(discoveryLineTwo, DISCOVERY_LINES[1], function () {
        window.setTimeout(function () {
          discovery.classList.add("is-leaving");
          markDiscoverySeen();
          window.setTimeout(function () {
            discovery.hidden = true;
            document.documentElement.classList.add("home-intro-seen");
            done();
          }, reducedMotion() ? 80 : 980);
        }, reducedMotion() ? 80 : 620);
      });
    });
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = window.innerWidth;
    var h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildPetals();
  }

  function buildPetals() {
    var count = window.innerWidth < 620 ? 34 : 62;
    petals = [];
    for (var i = 0; i < count; i++) {
      petals.push({
        x: rand(0, window.innerWidth),
        y: rand(-window.innerHeight * 0.2, window.innerHeight),
        r: rand(3.2, 8.5),
        vx: rand(-0.2, 0.35),
        vy: rand(0.22, 0.78),
        swing: rand(0.012, 0.032),
        spin: rand(-0.025, 0.025),
        angle: rand(0, Math.PI * 2),
        phase: rand(0, Math.PI * 2),
        color: palette[i % palette.length]
      });
    }
  }

  function drawPetal(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, p.r * 0.72, p.r * 1.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function tick() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);

    for (var i = 0; i < petals.length; i++) {
      var p = petals[i];
      var dx = p.x - pointer.x;
      var dy = p.y - pointer.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (pointer.active && dist < 150) {
        var force = (150 - dist) / 150;
        p.x += (dx / Math.max(dist, 1)) * force * 5.2;
        p.y += (dy / Math.max(dist, 1)) * force * 4.4;
      }

      p.phase += p.swing;
      p.angle += p.spin;
      p.x += p.vx + Math.sin(p.phase) * 0.34;
      p.y += p.vy;

      if (p.y > h + 28 || p.x < -36 || p.x > w + 36) {
        p.x = rand(0, w);
        p.y = rand(-90, -24);
        p.vx = rand(-0.2, 0.35);
        p.vy = rand(0.22, 0.78);
      }

      drawPetal(p);
    }

    raf = window.requestAnimationFrame(tick);
  }

  function enterHome() {
    if (cover.classList.contains("is-leaving")) return;
    cover.classList.add("is-leaving");
    explore.disabled = true;

    window.setTimeout(function () {
      document.body.classList.remove("home-cover-open");
      document.body.classList.add("home-revealed");
      window.dispatchEvent(new CustomEvent("home:revealed"));
      cover.classList.add("is-hidden");
    }, 520);

    window.setTimeout(function () {
      cover.hidden = true;
      if (raf) window.cancelAnimationFrame(raf);
    }, 980);
  }

  window.addEventListener("resize", resize);
  window.addEventListener("mousemove", function (ev) {
    pointer.x = ev.clientX;
    pointer.y = ev.clientY;
    pointer.active = true;
  });
  window.addEventListener("mouseleave", function () {
    pointer.active = false;
  });
  explore.addEventListener("click", enterHome);

  if (shouldSkipCover()) {
    revealHomeNow();
    return;
  }

  runDiscoveryIntro(function () {
    resize();
    if (!reducedMotion()) tick();
  });
})();
