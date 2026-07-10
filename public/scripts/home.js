/* 首页主体交互：时段背景、照片聚焦、状态短句和想去地点 */
(function () {
  "use strict";

  var BG = {
    morning: "/assets/早晨草地.webp",
    forenoon: "/assets/上午草地.webp",
    noon: "/assets/中午草地.webp",
    afternoon: "/assets/下午草地.webp",
    dusk: "/assets/傍晚草地.webp",
    evening: "/assets/晚上草地.webp",
    midnight: "/assets/半夜草地.webp"
  };
  var STATUS_KEY = "cuteblog.home.status.v1";
  var WEATHER_CACHE_MS = 30 * 60 * 1000;
  var privateSpace = window.OurNestPrivate || null;
  var QUOTES = {
    white: ["Keep the little things carefully today.", "Take it slowly; the nest will grow bit by bit.", "If the breeze is right, stay in the sun a little longer."],
    brown: ["Write down the places first; the road will appear slowly.", "Today is good for one small cute thing.", "Before leaving, tuck the anticipation into your pocket."]
  };
  var STATUS_IDEAS = {
    mood: ["Softly happy", "A little tired", "Full of energy", "Calm and cozy", "Missing you", "Ready for small joys"],
    doing: ["Writing today's note", "Sorting small things", "Planning dinner", "On the way home", "Taking a soft break", "Waiting for you"]
  };
  var WEATHER_LABELS = {
    0: "Clear",
    1: "Mostly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Rime fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Dense drizzle",
    56: "Freezing drizzle",
    57: "Heavy freezing drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    66: "Freezing rain",
    67: "Heavy freezing rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Rain showers",
    81: "Heavy showers",
    82: "Violent showers",
    85: "Snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with hail",
    99: "Heavy thunderstorm with hail"
  };
  var quoteTimers = {};

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

  function readJson(key, fallback) {
    try {
      var data = JSON.parse(localStorage.getItem(key) || "");
      return data || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  }

  function todayStr() {
    var d = new Date();
    var pad = function (n) { return n < 10 ? "0" + n : String(n); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function manualValue(saved, who, field) {
    var item = saved[who] && saved[who][field];
    return item && item.date === todayStr() ? String(item.value || "").trim() : "";
  }

  function storedWeatherText(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    return String(value.text || "").trim();
  }

  function saveManualValue(who, field, value) {
    var saved = readJson(STATUS_KEY, {});
    saved[who] = saved[who] || {};
    if (value) saved[who][field] = { date: todayStr(), value: value };
    else delete saved[who][field];
    writeJson(STATUS_KEY, saved);
  }

  function saveWeatherValue(who, weather) {
    var saved = readJson(STATUS_KEY, {});
    saved[who] = saved[who] || {};
    saved[who].weather = weather;
    writeJson(STATUS_KEY, saved);
  }

  function setWeatherText(who, text) {
    var prefix = who === "brown" ? "brown" : "white";
    var weather = document.getElementById(prefix + "Weather");
    if (weather && text) weather.textContent = text;
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
    if (!window.fetch || !privateSpace || !privateSpace.encryptText) return;
    try {
      privateSpace.encryptText(value || "").then(function (encrypted) {
        return fetch("/api/status/field", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ field: field, value: encrypted })
        });
      }).catch(function () {});
    } catch (e) {}
  }

  function currentWeatherWho() {
    var home = document.getElementById("home");
    var who = home && home.getAttribute("data-current-weather-who");
    return who === "white" || who === "brown" ? who : "";
  }

  function postWeatherToServer(text, location) {
    if (!window.fetch || !text || !privateSpace || !privateSpace.encryptText) return;
    try {
      privateSpace.encryptText(text).then(function (encrypted) {
        return fetch("/api/status/weather", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: encrypted })
        });
      }).catch(function () {});
    } catch (e) {}
  }

  function serverLocationFor(who) {
    var prefix = who === "brown" ? "brown" : "white";
    var el = document.getElementById(prefix + "Weather");
    if (!el) return null;
    var lat = parseFloat(el.getAttribute("data-lat") || "");
    var lng = parseFloat(el.getAttribute("data-lng") || "");
    var label = el.getAttribute("data-label") || "";
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { latitude: lat, longitude: lng, label: label || "Current location" };
  }

  function serverWeatherLabelFor(who) {
    var prefix = who === "brown" ? "brown" : "white";
    var el = document.getElementById(prefix + "Weather");
    if (!el) return "";
    var explicit = (el.getAttribute("data-label") || "").trim();
    if (explicit) return explicit;
    var raw = (el.getAttribute("data-server-weather") || el.textContent || "").trim();
    if (!raw || /pending/i.test(raw)) return "";
    return raw.split("·")[0].split("路")[0].trim();
  }

  function updateServerLocationAttrs(who, location) {
    var prefix = who === "brown" ? "brown" : "white";
    var el = document.getElementById(prefix + "Weather");
    if (!el || !location) return;
    if (Number.isFinite(location.latitude)) el.setAttribute("data-lat", String(location.latitude));
    if (Number.isFinite(location.longitude)) el.setAttribute("data-lng", String(location.longitude));
    if (location.label) el.setAttribute("data-label", location.label);
  }

  function renderStatus() {
    var saved = readJson(STATUS_KEY, {});
    var meWho = currentWeatherWho();
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
        if (meWho === item.who) {
          mood.textContent = manualValue(saved, item.who, "mood") || serverMood || item.mood;
        } else {
          mood.textContent = serverMood || item.mood;
        }
      }
      if (doing) {
        var serverDoing = serverFieldText(item.who, "doing");
        if (meWho === item.who) {
          doing.textContent = manualValue(saved, item.who, "doing") || serverDoing || item.doing;
        } else {
          doing.textContent = serverDoing || item.doing;
        }
      }

      // 天气：当前用户优先用本地缓存（更新鲜），其次服务器值；对方只看服务器值
      if (weather) {
        var serverText = serverWeatherFor(item.who);
        if (meWho === item.who) {
          var cached = storedWeatherText(saved[item.who] && saved[item.who].weather);
          weather.textContent = cached || serverText || "Location pending · Weather pending";
        } else {
          weather.textContent = serverText || "Location pending · Weather pending";
        }
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
          return privateSpace.decryptText(encrypted).then(function (value) {
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

  function weatherLabel(code) {
    return WEATHER_LABELS[Number(code)] || "Weather";
  }

  function roundedTemp(value) {
    var num = Number(value);
    return Number.isFinite(num) ? Math.round(num) : null;
  }

  function buildLocationLabel(location) {
    if (!location) return "Current location";
    return (
      location.city ||
      location.locality ||
      location.principalSubdivision ||
      location.countryName ||
      "Current location"
    );
  }

  function fetchJson(url) {
    return fetch(url).then(function (response) {
      if (!response.ok) throw new Error("request failed");
      return response.json();
    });
  }

  function geocodeUrl(latitude, longitude) {
    var url = "";
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      url += "&latitude=" + encodeURIComponent(latitude) + "&longitude=" + encodeURIComponent(longitude);
    }
    return url;
  }

  function geocodeLabel(label) {
    if (!label || !window.fetch) return Promise.resolve(null);
    var names = [label];
    var simplified = label.replace(/[市区县]$/g, "").trim();
    if (simplified && simplified !== label) names.push(simplified);

    function tryName(index) {
      if (index >= names.length) return Promise.resolve(null);
      var url = "";
      return fetchJson(url)
        .then(function (data) {
          var item = data && data.results && data.results[0];
          if (!item) return tryName(index + 1);
          return {
            latitude: Number(item.latitude),
            longitude: Number(item.longitude),
            label: item.name || label
          };
        })
        .catch(function () {
          return tryName(index + 1);
        });
    }

    return tryName(0)
      .then(function (location) {
        if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return null;
        return location;
      })
      .catch(function () { return null; });
  }

  function browserPosition() {
    return new Promise(function (resolve, reject) {
      if (true) {
        reject(new Error("geolocation unavailable"));
        return;
      }
      return;
      ({ disabled: function () {} }).disabled(
        function (position) {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
        },
        reject,
        {
          enableHighAccuracy: false,
          maximumAge: WEATHER_CACHE_MS,
          timeout: 8000
        }
      );
    });
  }

  function detectLocation() {
    return browserPosition()
      .then(function (coords) {
        return fetchJson(geocodeUrl(coords.latitude, coords.longitude))
          .then(function (location) {
            return {
              latitude: coords.latitude,
              longitude: coords.longitude,
              label: buildLocationLabel(location)
            };
          })
          .catch(function () {
            return {
              latitude: coords.latitude,
              longitude: coords.longitude,
              label: "Current location"
            };
          });
      })
      .catch(function () {
        return fetchJson(geocodeUrl()).then(function (location) {
          return {
            latitude: Number(location.latitude),
            longitude: Number(location.longitude),
            label: buildLocationLabel(location)
          };
        });
      });
  }

  function fetchWeather(latitude, longitude) {
    var params = [
      "latitude=" + encodeURIComponent(latitude),
      "longitude=" + encodeURIComponent(longitude),
      "current=temperature_2m,apparent_temperature,weather_code",
      "timezone=auto",
      "forecast_days=1"
    ];
    return Promise.reject(new Error("weather sync disabled"));
  }

  function weatherText(location, weather) {
    var current = weather && weather.current;
    var temp = roundedTemp(current && current.temperature_2m);
    if (temp === null) return "";
    return location.label + " · " + weatherLabel(current.weather_code) + " " + temp + "°C";
  }

  function refreshWeatherFromSavedLocation(who, shouldPersist) {
    // 只要服务端 profile 里存过坐标，就可以实时拉天气；不要求这个用户当前在线。
    var loc = serverLocationFor(who);
    var locationPromise = loc ? Promise.resolve(loc) : geocodeLabel(serverWeatherLabelFor(who));
    if (!window.fetch) return Promise.resolve("");
    return locationPromise
      .then(function (location) {
        if (!location) return "";
        return fetchWeather(location.latitude, location.longitude).then(function (weather) {
          return { location: location, weather: weather };
        });
      })
      .then(function (result) {
        if (!result) return "";
        var location = result.location;
        var weather = result.weather;
        updateServerLocationAttrs(who, location);
        return { location: location, text: weatherText(location, weather) };
      })
      .then(function (weather) {
        var text = weather && weather.text;
        if (text) {
          setWeatherText(who, text);
          if (shouldPersist) postWeatherToServer(text, weather.location);
        }
        return text;
      })
      .catch(function () {
        return "";
      });
  }

  function setupWeather() {
    decryptHomeContent().then(function () {
      renderStatus();
    }).catch(function () {
      renderStatus();
    });
    return;
    var home = document.getElementById("home");
    var who = home && home.getAttribute("data-current-weather-who");
    var loggedInWho = who === "white" || who === "brown" ? who : "";

    // 不论是否登录，双方都优先用 profile 里上次保存的位置实时刷新一遍天气。
    ["white", "brown"].forEach(function (item) {
      refreshWeatherFromSavedLocation(item, item === loggedInWho);
    });

    if (!loggedInWho) return;

    var saved = readJson(STATUS_KEY, {});
    var cached = saved[loggedInWho] && saved[loggedInWho].weather;
    var cachedText = storedWeatherText(cached);
    var cachedLocation = cached && typeof cached === "object" ? cached.location : null;
    if (cachedText) setWeatherText(loggedInWho, cachedText);
    // 服务器若还没拿到我的天气或坐标，用本地缓存先 sync 一份。
    var serverText = serverWeatherFor(loggedInWho);
    var serverLocation = serverLocationFor(loggedInWho);
    if (cachedText && cachedLocation && (cachedText !== serverText || !serverLocation)) {
      postWeatherToServer(cachedText, cachedLocation);
      updateServerLocationAttrs(loggedInWho, cachedLocation);
    }
    if (cached && typeof cached === "object" && Date.now() - Number(cached.updatedAt || 0) < WEATHER_CACHE_MS && serverLocation) return;
    if (!window.fetch) return;

    setWeatherText(loggedInWho, cachedText || "Syncing local weather");
    detectLocation()
      .then(function (location) {
        if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
          throw new Error("missing coordinates");
        }
        return fetchWeather(location.latitude, location.longitude).then(function (weather) {
          return { text: weatherText(location, weather), location: location };
        });
      })
      .then(function (result) {
        if (!result.text) throw new Error("empty weather");
        setWeatherText(loggedInWho, result.text);
        // 把坐标也存进本地缓存，下次进首页时一并同步给服务器
        saveWeatherValue(loggedInWho, { text: result.text, updatedAt: Date.now(), location: result.location });
        updateServerLocationAttrs(loggedInWho, result.location);
        // 同步到服务器（含坐标），让对方设备能用这些坐标拉实时天气
        postWeatherToServer(result.text, result.location);
      })
      .catch(function () {
        if (!cachedText) setWeatherText(loggedInWho, "Location pending · Weather pending");
      });
  }

  function typeQuote(id, text) {
    var el = document.getElementById(id);
    if (!el) return;
    if (quoteTimers[id]) window.clearInterval(quoteTimers[id]);
    el.setAttribute("data-full-text", text);
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
      activeEdit = { who: who, field: field };
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
      var trimmed = String(value || "").trim();
      saveManualValue(activeEdit.who, activeEdit.field, trimmed);
      if (currentWeatherWho() === activeEdit.who) {
        postFieldToServer(activeEdit.field, trimmed);
      }
      renderStatus();
      setSync(trimmed ? "Saved" : "Default restored", "saved");
      closeEditor();
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
  renderStatus();
  setupWeather();
  setupStatusActions();
  setupPhotos();
  setupRandomMemory();
})();
