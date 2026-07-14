/* 首页主体交互：时段背景、照片聚焦、状态短句和想去地点 */
(function () {
  "use strict";

  var BG = {
    morning: "/assets/首页封面.webp",
    forenoon: "/assets/首页封面.webp",
    noon: "/assets/首页封面.webp",
    afternoon: "/assets/首页封面.webp",
    dusk: "/assets/首页封面.webp",
    evening: "/assets/首页封面.webp",
    midnight: "/assets/首页封面.webp"
  };
  var privateSpace = window.OurNestPrivate || null;
  var QUOTES = {
    white: ["Keep the little things carefully today.", "Take it slowly; the nest will grow bit by bit.", "If the breeze is right, stay in the sun a little longer."],
    brown: ["Write down the places first; the road will appear slowly.", "Today is good for one small cute thing.", "Before leaving, tuck the anticipation into your pocket."]
  };
  var STATUS_IDEAS = {
    mood: ["Softly happy", "A little tired", "Full of energy", "Calm and cozy", "Missing you", "Ready for small joys"],
    doing: ["Writing today's note", "Sorting small things", "Planning dinner", "On the way home", "Taking a soft break", "Waiting for you"]
  };
  var quoteTimers = {};
  var clockTimer = null;
  var presenceTimer = null;
  var PRESENCE_ONLINE_MS = 90 * 1000;

  try { localStorage.removeItem("cuteblog.home.status.v1"); } catch (error) {}

  function periodForHour(h) {
    if (h >= 5 && h < 8) return "morning";
    if (h >= 8 && h < 11) return "forenoon";
    if (h >= 11 && h < 14) return "noon";
    if (h >= 14 && h < 17) return "afternoon";
    if (h >= 17 && h < 19) return "dusk";
    if (h >= 19 && h < 23) return "evening";
    return "midnight";
  }

  function setPeriod(key) {
    var bg = document.getElementById("homeBg");
    if (bg && BG[key]) bg.style.setProperty("--home-bg-url", 'url("' + BG[key] + '")');
  }

  function greetingForHour(hour) {
    if (hour >= 5 && hour < 11) return "Good morning. A new day for the two of you.";
    if (hour >= 11 && hour < 14) return "Take a little break and remember each other.";
    if (hour >= 14 && hour < 18) return "The afternoon is softer when it is shared.";
    if (hour >= 18 && hour < 23) return "You both did well today. Welcome home.";
    return "It is late. Keep each other company and rest soon.";
  }

  function renderClock() {
    var greeting = document.getElementById("homeGreeting");
    var clock = document.getElementById("homeClock");
    var now = new Date();
    if (greeting) greeting.textContent = greetingForHour(now.getHours());
    if (clock) {
      clock.dateTime = now.toISOString();
      clock.textContent = new Intl.DateTimeFormat("zh-CN", {
        month: "long",
        day: "numeric",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).format(now);
    }
  }

  function setupClock() {
    renderClock();
    if (clockTimer) window.clearInterval(clockTimer);
    clockTimer = window.setInterval(function () {
      renderClock();
      renderPresence();
    }, 60000);
  }

  function formatPresenceTime(value) {
    var date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).format(date).replace(/\//g, "/");
  }

  function renderPresence() {
    ["white", "brown"].forEach(function (who) {
      var element = document.getElementById(who + "Presence");
      if (!element) return;
      var value = element.getAttribute("data-last-seen") || "";
      var date = new Date(value);
      var formatted = formatPresenceTime(value);
      if (!formatted || Number.isNaN(date.getTime())) {
        element.textContent = "No online activity yet";
        element.setAttribute("data-state", "offline");
        return;
      }
      var online = Date.now() - date.getTime() >= 0 && Date.now() - date.getTime() < PRESENCE_ONLINE_MS;
      element.textContent = (online ? "Online now · " : "Last seen · ") + formatted;
      element.setAttribute("data-state", online ? "online" : "offline");
      element.title = formatted;
    });
  }

  function refreshPresence() {
    if (!window.fetch) return;
    fetch("/api/status/presence", { credentials: "same-origin", headers: { accept: "application/json" } })
      .then(function (response) {
        if (!response.ok) throw new Error("Could not refresh online status.");
        return response.json();
      })
      .then(function (payload) {
        var profiles = payload && Array.isArray(payload.profiles) ? payload.profiles : [];
        profiles.forEach(function (profile) {
          if (!profile || (profile.author_key !== "white" && profile.author_key !== "brown")) return;
          var element = document.getElementById(profile.author_key + "Presence");
          if (element) element.setAttribute("data-last-seen", typeof profile.last_seen_at === "string" ? profile.last_seen_at : "");
        });
        renderPresence();
      })
      .catch(function () {
        // Keep the last known state visible while the network is unavailable.
      });
  }

  function setupPresence() {
    renderPresence();
    refreshPresence();
    if (presenceTimer) window.clearInterval(presenceTimer);
    presenceTimer = window.setInterval(refreshPresence, 45000);
    window.addEventListener("our-nest:presence", refreshPresence);
  }

  function showFeedback(message) {
    var feedback = document.getElementById("homeFeedback");
    if (!feedback) return;
    feedback.textContent = message;
    feedback.classList.remove("is-visible");
    window.requestAnimationFrame(function () {
      feedback.classList.add("is-visible");
    });
    window.setTimeout(function () {
      feedback.classList.remove("is-visible");
    }, 2200);
  }

  function serverWeatherFor(who) {
    var prefix = who === "brown" ? "brown" : "white";
    var el = document.getElementById(prefix + "Weather");
    return el ? (el.getAttribute("data-server-weather") || "") : "";
  }

  function serverFieldText(who, field) {
    var prefix = who === "brown" ? "brown" : "white";
    var suffix = field === "mood" ? "Mood" : "Doing";
    var el = document.getElementById(prefix + suffix);
    return el ? (el.getAttribute("data-server-text") || "") : "";
  }

  function postFieldToServer(field, value) {
    if (!window.fetch || !privateSpace || !privateSpace.encryptText) {
      return Promise.reject(new Error("Private-space encryption is not ready."));
    }
    return privateSpace.encryptText(value || "", field === "mood" ? "profile.mood" : "profile.doing").then(function (encrypted) {
      return fetch("/api/status/field", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ field: field, value: encrypted })
      });
    }).then(function (response) {
      if (!response.ok) throw new Error("Could not sync today's status.");
      return response;
    });
  }

  function currentWeatherWho() {
    var home = document.getElementById("home");
    var who = home && home.getAttribute("data-current-weather-who");
    return who === "white" || who === "brown" ? who : "";
  }

  function renderStatus() {
    [
      { who: "white", prefix: "white", mood: "Softly happy", doing: "Sorting today's small notes" },
      { who: "brown", prefix: "brown", mood: "Full of energy", doing: "Planning the next outing" }
    ].forEach(function (item) {
      var mood = document.getElementById(item.prefix + "Mood");
      var doing = document.getElementById(item.prefix + "Doing");
      var weather = document.getElementById(item.prefix + "Weather");

      // mood / doing：自己那侧 localStorage 今日值优先（本人刚改的），否则用服务器 SSR 值（已按当天过滤）；
      // 对方那侧只读 SSR 值（本设备的 localStorage 可能是过期身份留下的，不可信）
      if (mood) {
        var serverMood = serverFieldText(item.who, "mood");
        mood.textContent = serverMood || item.mood;
      }
      if (doing) {
        var serverDoing = serverFieldText(item.who, "doing");
        doing.textContent = serverDoing || item.doing;
      }

      // 天气：当前用户优先用本地缓存（更新鲜），其次服务器值；对方只看服务器值
      if (weather) {
        var serverText = serverWeatherFor(item.who);
        weather.textContent = serverText || "Location pending · Weather pending";
      }
    });
  }

  function decryptHomeContent() {
    if (!privateSpace || !privateSpace.ready) return Promise.resolve();
    return privateSpace.ready().then(function () {
      return Promise.all([
        Promise.all(["whiteWeather", "brownWeather", "whiteMood", "brownMood", "whiteDoing", "brownDoing"].map(function (id) {
          var el = document.getElementById(id);
          if (!el) return Promise.resolve();
          var attr = id.indexOf("Weather") >= 0 ? "data-server-weather" : "data-server-text";
          var encrypted = el.getAttribute(attr) || "";
          if (!encrypted) return Promise.resolve();
          var context = id.indexOf("Weather") >= 0 ? "profile.weather" : (id.indexOf("Mood") >= 0 ? "profile.mood" : "profile.doing");
          return privateSpace.decryptText(encrypted, context).then(function (value) {
            el.setAttribute(attr, value || "");
          });
        })),
        privateSpace.decryptTextNodes(document.getElementById("homeRecentPhotos")),
        privateSpace.decryptTextNodes(document.getElementById("homeMemoryList")),
        privateSpace.decryptTextNodes(document.getElementById("homeJournalList")),
        privateSpace.decryptTextNodes(document.getElementById("homeRandomDeck")),
        privateSpace.decryptTextNodes(document.getElementById("placeList")),
        privateSpace.hydratePhotoNodes(document.getElementById("homeRecentPhotos"))
      ]);
    });
  }

  function setupWeather() {
    decryptHomeContent().then(function () {
      renderStatus();
      refreshIpWeather();
    }).catch(function () {
      renderStatus();
      refreshIpWeather();
    });
  }

  function refreshIpWeather() {
    var who = currentWeatherWho();
    if (!who || !window.fetch) return;
    var target = document.getElementById((who === "brown" ? "brown" : "white") + "Weather");
    if (!target) return;

    fetch("/api/status/ip-weather", { headers: { accept: "application/json" } })
      .then(function (response) {
        return response.json().catch(function () { return null; }).then(function (data) {
          if (!response.ok) throw new Error(data && data.error || "weather temporarily unavailable");
          return data;
        });
      })
      .then(function (data) {
        if (!data || !data.weather) return;
        target.textContent = data.weather;
        target.setAttribute("data-server-weather", data.weather);
      })
      .catch(function (error) {
        if (serverWeatherFor(who)) return;
        var message = error && error.message;
        if (message === "IP weather is disabled for privacy.") target.textContent = "Weather is off for privacy";
        else if (message === "location unavailable") target.textContent = "Location unavailable";
        else target.textContent = "Weather temporarily unavailable";
      });
  }

  function typeQuote(id, text) {
    var el = document.getElementById(id);
    if (!el) return;
    if (quoteTimers[id]) window.clearInterval(quoteTimers[id]);
    el.setAttribute("data-full-text", text);
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.textContent = text;
      quoteTimers[id] = null;
      return;
    }
    var i = 0;
    el.textContent = "";
    quoteTimers[id] = window.setInterval(function () {
      i += 1;
      el.textContent = text.slice(0, i);
      if (i >= text.length) {
        window.clearInterval(quoteTimers[id]);
        quoteTimers[id] = null;
      }
    }, 48);
  }

  function pickAnother(list, current) {
    if (list.length === 1) return list[0];
    var next = list[Math.floor(Math.random() * list.length)];
    var guard = 0;
    while (next === current && guard < 8) {
      next = list[Math.floor(Math.random() * list.length)];
      guard += 1;
    }
    return next;
  }

  function setupStatusActions() {
    var modal = document.getElementById("statusEditor");
    var modalCard = modal && modal.querySelector(".status-editor__card");
    var kicker = document.getElementById("statusEditorKicker");
    var title = document.getElementById("statusEditorTitle");
    var hint = document.getElementById("statusEditorHint");
    var labelEl = document.getElementById("statusEditorLabel");
    var input = document.getElementById("statusEditorInput");
    var count = document.getElementById("statusEditorCount");
    var sync = document.getElementById("statusEditorSync");
    var chips = document.getElementById("statusEditorChips");
    var clearBtn = document.getElementById("statusEditorClear");
    var saveBtn = document.getElementById("statusEditorSave");
    var editorReturnFocus = null;
    var activeEdit = null;

    function statusName(who) {
      var title = document.querySelector('[data-status-name="' + who + '"]');
      return title && title.textContent.trim() ? title.textContent.trim() : (who === "brown" ? "Brown" : "White");
    }

    function fieldTarget(who, field) {
      var prefix = who === "brown" ? "brown" : "white";
      return document.getElementById(prefix + (field === "mood" ? "Mood" : "Doing"));
    }

    function updateCount() {
      if (!input || !count) return;
      count.textContent = input.value.length + " / 80";
    }

    function setSync(text, mode) {
      if (!sync) return;
      sync.textContent = text;
      sync.setAttribute("data-state", mode || "idle");
    }

    function renderChips(field) {
      if (!chips) return;
      chips.textContent = "";
      (STATUS_IDEAS[field] || []).forEach(function (idea) {
        var chip = document.createElement("button");
        chip.type = "button";
        chip.className = "status-editor__chip";
        chip.textContent = idea;
        chip.addEventListener("click", function () {
          input.value = idea;
          updateCount();
          setSync("Ready to save", "idle");
          input.focus();
        });
        chips.appendChild(chip);
      });
    }

    function openEditor(who, field) {
      if (!modal || !input || !saveBtn) return;
      var target = fieldTarget(who, field);
      var name = statusName(who);
      editorReturnFocus = document.activeElement;
      activeEdit = { who: who, field: field, target: target };
      modal.classList.remove("is-hidden", "status-editor--white", "status-editor--brown");
      document.documentElement.classList.add("has-open-dialog");
      modal.classList.add(who === "brown" ? "status-editor--brown" : "status-editor--white");
      if (kicker) kicker.textContent = name + "'s today";
      if (title) title.textContent = field === "mood" ? "Edit mood" : "Edit what you are doing";
      if (hint) hint.textContent = field === "mood"
        ? "Keep it short, sweet, and visible on the home page."
        : "A tiny current-status note for the two-person home.";
      if (labelEl) labelEl.textContent = field === "mood" ? "Mood" : "Doing";
      input.value = target ? target.textContent.trim() : "";
      renderChips(field);
      updateCount();
      setSync("Saved for today", "idle");
      window.setTimeout(function () {
        input.focus();
        input.select();
      }, 40);
    }

    function closeEditor() {
      if (!modal) return;
      modal.classList.add("is-hidden");
      document.documentElement.classList.remove("has-open-dialog");
      activeEdit = null;
      if (editorReturnFocus && typeof editorReturnFocus.focus === "function") editorReturnFocus.focus();
    }

    function saveEditor(value) {
      if (!activeEdit) return;
      var edit = { who: activeEdit.who, field: activeEdit.field, target: activeEdit.target };
      var trimmed = String(value || "").trim();
      if (currentWeatherWho() !== edit.who) return;
      if (saveBtn) saveBtn.disabled = true;
      if (clearBtn) clearBtn.disabled = true;
      setSync("Saving…", "idle");
      postFieldToServer(edit.field, trimmed).then(function () {
        if (edit.target) {
          edit.target.setAttribute("data-server-text", trimmed);
        }
        renderStatus();
        setSync(trimmed ? "Saved" : "Default restored", "saved");
        closeEditor();
        showFeedback(trimmed ? "Today’s note is saved in your little nest." : "The gentle default is back for today.");
      }).catch(function () {
        setSync("Could not sync. Please try again.", "error");
      }).finally(function () {
        if (saveBtn) saveBtn.disabled = false;
        if (clearBtn) clearBtn.disabled = false;
      });
    }

    if (input) {
      input.addEventListener("input", function () {
        updateCount();
        setSync("Ready to save", "idle");
      });
      input.addEventListener("keydown", function (ev) {
        if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
          ev.preventDefault();
          saveEditor(input.value);
        }
      });
    }

    Array.prototype.slice.call(document.querySelectorAll("[data-status-close]")).forEach(function (btn) {
      btn.addEventListener("click", closeEditor);
    });

    if (modalCard) {
      modalCard.addEventListener("click", function (ev) {
        ev.stopPropagation();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        saveEditor("");
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        saveEditor(input ? input.value : "");
      });
    }

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && modal && !modal.classList.contains("is-hidden")) {
        closeEditor();
      }
    });

    Array.prototype.slice.call(document.querySelectorAll(".home-status__edit")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var who = btn.getAttribute("data-who");
        var field = btn.getAttribute("data-field");
        openEditor(who === "brown" ? "brown" : "white", field === "doing" ? "doing" : "mood");
      });
    });

    Array.prototype.slice.call(document.querySelectorAll(".home-status__quote")).forEach(function (quote) {
      var replay = function () {
        var who = quote.getAttribute("data-who") === "brown" ? "brown" : "white";
        typeQuote((who === "brown" ? "brown" : "white") + "Quote", pickAnother(QUOTES[who], quote.getAttribute("data-full-text") || quote.textContent));
      };
      quote.setAttribute("data-full-text", quote.textContent);
      quote.addEventListener("click", replay);
      quote.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          replay();
        }
      });
    });
  }

  function setupPhotos() {
    var stage = document.getElementById("homeRecentPhotos");
    if (!stage) return;
    var cards = Array.prototype.slice.call(stage.querySelectorAll(".home-photo-card"));
    function clear() {
      stage.classList.remove("is-active");
      cards.forEach(function (card) {
        card.classList.remove("is-focus");
        card.style.removeProperty("--lean");
        card.style.removeProperty("--pitch");
        card.style.removeProperty("--lean-x");
        card.style.removeProperty("--depth");
        card.style.removeProperty("--tilt");
      });
    }
    function focus(index) {
      stage.classList.add("is-active");
      cards.forEach(function (card, i) {
        var delta = index - i;
        var abs = Math.abs(delta);
        var side = i < index ? -1 : 1;
        card.classList.toggle("is-focus", i === index);
        if (i === index) return;
        card.style.setProperty("--lean", side * -15 + "deg");
        card.style.setProperty("--pitch", (2 + abs * 0.8).toFixed(1) + "deg");
        card.style.setProperty("--lean-x", String(side * Math.min(24, 6 + abs * 5)));
        card.style.setProperty("--depth", String(-34 - abs * 18));
        card.style.setProperty("--tilt", side * 1.2 + "deg");
      });
    }
    cards.forEach(function (card, index) {
      card.addEventListener("mouseenter", function () { focus(index); });
      card.addEventListener("focus", function () { focus(index); });
      card.addEventListener("click", function () { focus(index); });
    });
    stage.addEventListener("mouseleave", clear);
    stage.addEventListener("focusout", function (ev) {
      if (!stage.contains(ev.relatedTarget)) clear();
    });
  }

  function setupRandomMemory() {
    var deck = document.getElementById("homeRandomDeck");
    if (!deck) return;
    var cards = Array.prototype.slice.call(deck.querySelectorAll("[data-memory-card]"));
    var shuffle = document.getElementById("homeRandomShuffle");
    if (!cards.length) {
      if (shuffle) shuffle.hidden = true;
      return;
    }

    function show(index) {
      cards.forEach(function (card, cardIndex) {
        var active = cardIndex === index;
        card.classList.toggle("is-active", active);
        card.setAttribute("aria-hidden", active ? "false" : "true");
        card.setAttribute("tabindex", active ? "0" : "-1");
      });
      deck.classList.remove("is-shuffling");
      window.requestAnimationFrame(function () {
        deck.classList.add("is-shuffling");
      });
    }

    function nextIndex() {
      if (cards.length === 1) return 0;
      var activeIndex = cards.findIndex(function (card) { return card.classList.contains("is-active"); });
      var picked = Math.floor(Math.random() * cards.length);
      while (picked === activeIndex) {
        picked = Math.floor(Math.random() * cards.length);
      }
      return picked;
    }

    show(Math.floor(Math.random() * cards.length));
    if (shuffle && cards.length > 1) {
      shuffle.addEventListener("click", function () {
        show(nextIndex());
      });
    } else if (shuffle) {
      shuffle.hidden = true;
    }
  }

  setPeriod(periodForHour(new Date().getHours()));
  setupClock();
  setupPresence();
  setupWeather();
  setupStatusActions();
  setupPhotos();
  setupRandomMemory();
})();
