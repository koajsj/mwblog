/* ============================================================
   我们的小窝 — 时段活动记录
   独立 ActivityStore：当前原型使用 localStorage，后续可整体替换为 Supabase
   ============================================================ */
(function () {
  "use strict";

  var PERIODS = [
    { key: "morning", label: "早晨", time: "05:00-08:00", minutes: 180 },
    { key: "forenoon", label: "上午", time: "08:00-11:00", minutes: 180 },
    { key: "noon", label: "中午", time: "11:00-14:00", minutes: 180 },
    { key: "afternoon", label: "下午", time: "14:00-17:00", minutes: 180 },
    { key: "dusk", label: "傍晚", time: "17:00-19:00", minutes: 120 },
    { key: "evening", label: "晚上", time: "19:00-23:00", minutes: 240 },
    { key: "midnight", label: "半夜", time: "23:00-05:00", minutes: 360 }
  ];

  var CATEGORY_COLORS = {
    "学习": "#7aa6d4",
    "工作": "#91c6b6",
    "约会": "#e6a6bd",
    "家务": "#d49356",
    "娱乐": "#a7c978",
    "休息": "#b9aedb",
    "运动": "#efb36f",
    "其他": "#9aa7b7"
  };

  var ActivityStore = {
    key: "cuteblog.activities.v1",
    all: function () {
      try {
        var arr = JSON.parse(localStorage.getItem(this.key) || "[]");
        return Array.isArray(arr) ? arr : [];
      } catch (e) {
        return [];
      }
    },
    saveAll: function (arr) {
      localStorage.setItem(this.key, JSON.stringify(arr));
    },
    add: function (entry) {
      var arr = this.all();
      entry.id = "act-" + Date.now() + "-" + Math.floor(Math.random() * 10000);
      entry.createdAt = Date.now();
      arr.push(entry);
      this.saveAll(arr);
      return entry;
    },
    remove: function (id) {
      this.saveAll(this.all().filter(function (entry) {
        return entry.id !== id;
      }));
    }
  };
  window.CBActivity = ActivityStore;

  var form = document.getElementById("activityForm");
  var dateEl = document.getElementById("actDate");
  var periodEl = document.getElementById("actPeriod");
  var categoryEl = document.getElementById("actCategory");
  var minutesEl = document.getElementById("actMinutes");
  var textEl = document.getElementById("actText");
  var whoEl = document.getElementById("actWho");
  var viewEl = document.getElementById("actView");
  var formToggle = document.getElementById("actFormToggle");
  var summaryEl = document.getElementById("daySummary");
  var timelineTitleEl = document.getElementById("timelineTitle");
  var categoryTitleEl = document.getElementById("categoryTitle");
  var periodTitleEl = document.getElementById("periodTitle");
  var timelineEl = document.getElementById("actTimeline");
  var donutEl = document.getElementById("actDonut");
  var donutTextEl = document.getElementById("actDonutText");
  var barsEl = document.getElementById("actBars");
  var periodsEl = document.getElementById("actPeriods");
  var who = "white";
  var viewWho = "white";

  function today() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function periodForHour(h) {
    if (h >= 5  && h < 8)  return "morning";
    if (h >= 8  && h < 11) return "forenoon";
    if (h >= 11 && h < 14) return "noon";
    if (h >= 14 && h < 17) return "afternoon";
    if (h >= 17 && h < 19) return "dusk";
    if (h >= 19 && h < 23) return "evening";
    return "midnight";
  }

  function periodByKey(key) {
    for (var i = 0; i < PERIODS.length; i++) {
      if (PERIODS[i].key === key) return PERIODS[i];
    }
    return PERIODS[0];
  }

  function fmtMinutes(mins) {
    mins = Number(mins) || 0;
    if (mins < 60) return mins + " 分钟";
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    return h + " 小时" + (m ? " " + m + " 分钟" : "");
  }

  function whoLabel(value) {
    return value === "brown" ? "棕狗" : "白狗";
  }

  function entriesForDay() {
    return ActivityStore.all().filter(function (entry) {
      return entry.date === dateEl.value;
    }).sort(function (a, b) {
      var ai = PERIODS.map(function (p) { return p.key; }).indexOf(a.period);
      var bi = PERIODS.map(function (p) { return p.key; }).indexOf(b.period);
      if (ai !== bi) return ai - bi;
      return a.createdAt - b.createdAt;
    });
  }

  function entriesForView() {
    return entriesForDay().filter(function (entry) {
      return entry.who === viewWho;
    });
  }

  function groupBy(list, key) {
    var map = {};
    list.forEach(function (entry) {
      var k = entry[key];
      map[k] = (map[k] || 0) + Number(entry.minutes || 0);
    });
    return map;
  }

  function renderTimeline(list) {
    timelineEl.textContent = "";
    PERIODS.forEach(function (period) {
      var row = document.createElement("section");
      row.className = "time-row";

      var label = document.createElement("div");
      label.className = "time-row__label";
      var strong = document.createElement("strong");
      strong.textContent = period.label;
      var span = document.createElement("span");
      span.textContent = period.time;
      label.appendChild(strong);
      label.appendChild(span);

      var track = document.createElement("div");
      track.className = "time-row__track";
      var items = document.createElement("div");
      items.className = "time-row__items";

      var periodEntries = list.filter(function (entry) {
        return entry.period === period.key;
      });
      if (!periodEntries.length) {
        var empty = document.createElement("div");
        empty.className = "time-empty";
        empty.textContent = whoLabel(viewWho) + "这个时段还没有记录";
        items.appendChild(empty);
      } else {
        periodEntries.forEach(function (entry) {
          var block = document.createElement("article");
          block.className = "time-block time-block--" + entry.who;
          var width = Math.max(16, Math.min(100, Number(entry.minutes) / period.minutes * 100));
          block.style.setProperty("--w", width.toFixed(1) + "%");

          var cat = document.createElement("span");
          cat.className = "time-block__cat";
          cat.textContent = entry.category;
          var text = document.createElement("span");
          text.className = "time-block__text";
          text.textContent = entry.text;
          var mins = document.createElement("span");
          mins.className = "time-block__mins";
          mins.textContent = fmtMinutes(entry.minutes);
          var del = document.createElement("button");
          del.type = "button";
          del.className = "time-block__del";
          del.setAttribute("aria-label", "删除这条活动");
          del.textContent = "×";
          del.addEventListener("click", function () {
            ActivityStore.remove(entry.id);
            render();
          });

          block.appendChild(cat);
          block.appendChild(text);
          block.appendChild(mins);
          block.appendChild(del);
          items.appendChild(block);
        });
      }

      track.appendChild(items);
      row.appendChild(label);
      row.appendChild(track);
      timelineEl.appendChild(row);
    });
  }

  function renderStats(list) {
    var total = list.reduce(function (sum, entry) {
      return sum + Number(entry.minutes || 0);
    }, 0);
    var label = whoLabel(viewWho);
    summaryEl.textContent = label + "当天共记录 " + fmtMinutes(total) + " · " + list.length + " 条活动";
    timelineTitleEl.textContent = label + "的时间线";
    categoryTitleEl.textContent = label + "分类占比";
    periodTitleEl.textContent = label + "时段概览";
    donutTextEl.textContent = fmtMinutes(total);

    var catMap = groupBy(list, "category");
    var cats = Object.keys(catMap).sort(function (a, b) { return catMap[b] - catMap[a]; });
    barsEl.textContent = "";
    if (!cats.length) {
      donutEl.style.background = "conic-gradient(#dbe5ef 0 100%)";
      var empty = document.createElement("p");
      empty.className = "stat-empty";
      empty.textContent = "添加" + label + "的活动后，这里会显示当天分类占比。";
      barsEl.appendChild(empty);
    } else {
      var start = 0;
      var stops = [];
      cats.forEach(function (cat) {
        var pct = catMap[cat] / total * 100;
        var color = CATEGORY_COLORS[cat] || CATEGORY_COLORS["其他"];
        stops.push(color + " " + start.toFixed(2) + "% " + (start + pct).toFixed(2) + "%");
        start += pct;
      });
      donutEl.style.background = "conic-gradient(" + stops.join(", ") + ")";

      cats.forEach(function (cat) {
        barsEl.appendChild(buildBar(cat, catMap[cat], total, CATEGORY_COLORS[cat] || CATEGORY_COLORS["其他"]));
      });
    }

    periodsEl.textContent = "";
    var periodMap = groupBy(list, "period");
    PERIODS.forEach(function (period) {
      periodsEl.appendChild(buildPeriod(period, periodMap[period.key] || 0));
    });
  }

  function buildBar(name, minutes, total, color) {
    var wrap = document.createElement("div");
    wrap.className = "stat-bar";
    var top = document.createElement("div");
    top.className = "stat-bar__top";
    var n = document.createElement("span");
    n.textContent = name;
    var v = document.createElement("span");
    v.textContent = fmtMinutes(minutes);
    top.appendChild(n);
    top.appendChild(v);

    var rail = document.createElement("div");
    rail.className = "stat-bar__rail";
    var fill = document.createElement("div");
    fill.className = "stat-bar__fill";
    fill.style.setProperty("--w", total ? (minutes / total * 100).toFixed(1) + "%" : "0%");
    fill.style.setProperty("--c", color);
    rail.appendChild(fill);
    wrap.appendChild(top);
    wrap.appendChild(rail);
    return wrap;
  }

  function buildPeriod(period, minutes) {
    var wrap = document.createElement("div");
    wrap.className = "period-pill";
    var top = document.createElement("div");
    top.className = "period-pill__top";
    var n = document.createElement("span");
    n.textContent = period.label;
    var v = document.createElement("span");
    v.textContent = fmtMinutes(minutes);
    top.appendChild(n);
    top.appendChild(v);

    var rail = document.createElement("div");
    rail.className = "period-pill__rail";
    var fill = document.createElement("div");
    fill.className = "period-pill__fill";
    fill.style.setProperty("--w", Math.min(100, minutes / period.minutes * 100).toFixed(1) + "%");
    fill.style.setProperty("--c", "#9fdcc5");
    rail.appendChild(fill);
    wrap.appendChild(top);
    wrap.appendChild(rail);
    return wrap;
  }

  function render() {
    var list = entriesForView();
    renderTimeline(list);
    renderStats(list);
  }

  function setWho(nextWho) {
    who = nextWho;
    whoEl.querySelectorAll(".act-who__btn").forEach(function (item) {
      item.classList.toggle("is-active", item.getAttribute("data-who") === who);
    });
  }

  function setView(nextWho) {
    viewWho = nextWho;
    viewEl.querySelectorAll(".act-view__btn").forEach(function (item) {
      item.classList.toggle("is-active", item.getAttribute("data-view") === viewWho);
    });
    setWho(nextWho);
    render();
  }

  function setFormOpen(open) {
    form.classList.toggle("is-hidden", !open);
    formToggle.setAttribute("aria-expanded", open ? "true" : "false");
    formToggle.textContent = open ? "收起添加面板" : "＋ 添加时间安排";
  }

  function initPeriodSelect() {
    PERIODS.forEach(function (period) {
      var option = document.createElement("option");
      option.value = period.key;
      option.textContent = period.label + " · " + period.time;
      periodEl.appendChild(option);
    });
    periodEl.value = periodForHour(new Date().getHours());
  }

  whoEl.addEventListener("click", function (ev) {
    var btn = ev.target.closest(".act-who__btn");
    if (!btn) return;
    setWho(btn.getAttribute("data-who"));
  });

  viewEl.addEventListener("click", function (ev) {
    var btn = ev.target.closest(".act-view__btn");
    if (!btn) return;
    setView(btn.getAttribute("data-view"));
  });

  formToggle.addEventListener("click", function () {
    setFormOpen(form.classList.contains("is-hidden"));
  });

  dateEl.addEventListener("change", render);

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    ActivityStore.add({
      date: dateEl.value,
      who: who,
      period: periodEl.value,
      category: categoryEl.value,
      minutes: Math.max(1, Math.min(720, Number(minutesEl.value) || 1)),
      text: textEl.value.trim()
    });
    textEl.value = "";
    setView(who);
    setFormOpen(false);
  });

  initPeriodSelect();
  dateEl.value = today();
  setFormOpen(false);
  render();
})();
