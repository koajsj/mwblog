/* ============================================================
   我们的小窝：页面角落陪伴小狗
   ① 待机随机说话（含项目特色的可爱句）
   ② 鼠标悬停 / 聚焦不同按钮说不同的话（支持多句轮换）
   ③ 操作完成（fetch 拦截 + 自定义事件）后小狗会捧场
   ④ 点击小狗播放动作 GIF
   暴露：window.CornerDogs.say(line, opts) / document 事件 'cornerdogs:say'
   ============================================================ */
(function () {
  "use strict";

  var IDLE = {
    white: "/gif/白狗-待机.png",
    brown: "/gif/棕狗-待机.png"
  };

  var DOGS = [
    {
      key: "white",
      label: "White",
      idle: IDLE.white,
      actions: [
        { id: "white-code", src: "/gif/白狗-写出代码.gif", duration: 2500, line: "White is writing code with great focus." },
        { id: "white-sing", src: "/gif/白狗-唱歌.gif", duration: 2300, line: "White hums a tiny song for you." },
        { id: "white-heart", src: "/gif/白狗-抛出爱心.gif", duration: 2100, line: "White tosses out a heart.", after: "brown-catch-heart" },
        { id: "white-crawl", src: "/gif/白狗-爬行.gif", duration: 3600, line: "White quietly crawls over." },
        { id: "white-question", src: "/gif/白狗-翻身问号.gif", duration: 2600, line: "White rolls over: what happened?" },
        { id: "white-jump", src: "/gif/白狗-跳跳.gif", duration: 2300, line: "White jumps up happily." }
      ]
    },
    {
      key: "brown",
      label: "Brown",
      idle: IDLE.brown,
      actions: [
        { id: "brown-workout", src: "/gif/棕狗-健身.gif", duration: 2600, line: "Brown is getting a workout in." },
        { id: "brown-food", src: "/gif/棕狗-想开饭.gif", duration: 2600, line: "Brown is already thinking about dinner." },
        { id: "brown-heart", src: "/gif/棕狗-甩爱心.gif", duration: 2500, line: "Brown tosses out a heart too." },
        { id: "brown-leave", src: "/gif/棕狗-跳走.gif", duration: 2300, line: "Brown hops away to scout ahead." },
        { id: "brown-duck", src: "/gif/棕狗-鸭子跳跳.gif", duration: 2500, line: "Brown jumps along with the little duck." }
      ],
      hiddenActions: {
        "brown-catch-heart": { id: "brown-catch-heart", src: "/gif/棕狗-接住爱心.gif", duration: 2600, line: "Brown catches White's heart." }
      }
    }
  ];

  /* ------------------------------------------------------------
     待机随机闲聊：项目主题 + 可爱碎碎念
     ------------------------------------------------------------ */
  var RANDOM_LINES = [
    // 一般氛围
    "Keep the little things tucked away with care today.",
    "The nest is glowing softly.",
    "Take a sip of water, then keep browsing.",
    "We're keeping you company from the corner.",
    "Today is good for saving a bit of joy.",
    "Take your time. The page can wait.",
    "Today can still be sweet.",
    "Corner patrol complete. All is well.",
    "The breeze is soft. A good time to daydream.",
    "This is a tiny world for two.",
    "If you're tired, rest here for a while.",
    "We just found a good mood.",
    "Today's clouds look very touchable.",
    "The corner is carefully guarded.",
    "No rush. Good things arrive slowly.",
    "The corner pups have plenty of energy today.",
    "Now that you're here, the nest feels livelier.",
    "Stretch a little. The shoulders will thank you.",
    "Blink slowly. The screen will thank you too.",
    "The light here is just right.",
    // 博客
    "White smells a new idea nearby.",
    "Writing a little still counts as moving forward.",
    "Some stories are better written later.",
    "Half a paragraph today is plenty.",
    "Brown is curious what the next post will be.",
    "Drafts deserve cuddles too.",
    // 照片
    "Want to peek at the latest photos?",
    "Remember to leave a photo for today.",
    "The photo wall could use one more memory.",
    "Brown thinks the last photo was very photogenic.",
    // 生活记录 / records
    "Tiny moods belong on the records page.",
    "Save a sentence about today. Future you will smile.",
    "Even a one-line record counts.",
    // Activity
    "How did the morning go? The timeline is listening.",
    "Even five minutes is worth logging.",
    "Brown logged a nap. It counts as rest.",
    "The day fits into little time blocks.",
    // To Do
    "One small task crossed off, one small win.",
    "The list won't bite. Pick the easiest one first.",
    "Heatmap squares are slowly turning warm.",
    "A finished task deserves a hum.",
    "Tomorrow's list can wait until tomorrow.",
    // Places
    "The places you want to visit are getting closer.",
    "Brown added one more place to the dream list.",
    "Pin a spot. We can go there together one day.",
    // 评论
    "A new comment would brighten the page.",
    "Replies are tiny love letters.",
    // 状态 / 心情 / 天气
    "What's the mood today? The nest will remember.",
    "Update the weather chip. It's been a while.",
    "Brown says: today smells like soft sunshine.",
    "White picked a mood word for you already.",
    // 自我吐槽 / 互动
    "Brown thinks this place feels cozy.",
    "White is guarding the bottom-right corner.",
    "We just counted the clouds. There are exactly enough.",
    "Brown sneezed. The page wobbled a little.",
    "White says: don't forget to save.",
    "Brown is keeping the bookmarks warm.",
    "The two of us are very busy doing nothing.",
    "If you scroll past us, we won't be sad. Promise.",
    "We rehearsed a tiny dance just in case.",
    "Brown thinks you should treat yourself today.",
    "White wags a tail for you, very gently.",
    // 时间感
    "If it's late, the nest will keep the light on.",
    "Mornings here are extra soft.",
    "Afternoons are made for tiny breaks.",
    "Evening pages feel cozier somehow.",
    // 鼓励
    "Whatever you're doing, it's enough.",
    "Small steps still arrive somewhere.",
    "We're proud of you for showing up.",
    "Tucked-in thoughts grow stronger.",
    "Be soft with yourself today."
  ];

  /* ------------------------------------------------------------
     悬停 / 聚焦元素时说的话
     - test：在 textContent / aria-label / href / id / className 上匹配
     - line 或 lines（多句随机）
     顺序：精确的放前面，泛化的放后面
     ------------------------------------------------------------ */
  var FEATURE_LINES = [
    // ---- 顶部导航 / 入口 ----
    { test: /\b(home|index)\b|href="\/"/i, lines: [
        "Back home to Our Nest.",
        "Home is where the corner pups are.",
        "The front door is always warm."
      ] },
    { test: /\b(blog|stories|posts?)\b/i, lines: [
        "Let's read the stories you wrote together.",
        "The blog shelf is quietly waiting.",
        "Brown picks the longest one for tonight."
      ] },
    { test: /\b(records?|life)\b|life-records/i, lines: [
        "Today's little moods deserve a place to stay.",
        "Records page is full of tiny days.",
        "White likes scrolling through old entries."
      ] },
    { test: /\bphotos?\b|photo-wall|photowall/i, lines: [
        "Let's flip through the latest photos.",
        "The photo wall is dust-free today.",
        "Brown wants to be in the next photo."
      ] },
    { test: /\b(activity|timeline)\b/i, lines: [
        "Let's see what happened in each part of the day.",
        "The timeline is curious about your morning.",
        "Activity is just life with timestamps."
      ] },
    { test: /\btodo\b|to-?do/i, lines: [
        "Let's tidy the little task list.",
        "The to-do page is patient today.",
        "Brown promises not to add chores."
      ] },
    { test: /\bplaces?\b|want to go/i, lines: [
        "Let's see the places you want to visit this year.",
        "Pin one more dream spot.",
        "White wants to go to all of them."
      ] },

    // ---- 认证 ----
    { test: /\b(login|sign[\s-]?in|log[\s-]?in)\b/i, lines: [
        "Slip back in. We saved your seat.",
        "Welcome back is a sweet phrase.",
        "The nest opens with your key."
      ] },
    { test: /\b(logout|log[\s-]?out|sign[\s-]?out)\b/i, lines: [
        "Sleep well. We'll guard the corner.",
        "Bye-bye for now. The light stays on.",
        "Come back when you miss us."
      ] },

    // ---- 通用动作类（按动词） ----
    { test: /\b(upload|choose (photo|file)|select file|file-input)\b|input\[type="?file"?\]/i, lines: [
        "Adding something new to the nest?",
        "We'll keep the parcel safe.",
        "Brown sniffs the new file curiously."
      ] },
    { test: /\b(publish|post|submit-post)\b/i, lines: [
        "Tuck the new story in carefully.",
        "Press it gently. Stories like that.",
        "The shelf has space for one more."
      ] },
    { test: /\b(save|update|confirm|apply)\b/i, lines: [
        "Saving the little thing carefully.",
        "Keep it. We'll remember it together.",
        "Tucked in tight."
      ] },
    { test: /\b(add|new|create|plus|insert)\b|\+ ?(add|new)/i, lines: [
        "Something new joins the nest.",
        "Brown perks up. Newness!",
        "White wags. A fresh entry."
      ] },
    { test: /\b(edit|rename|modify)\b/i, lines: [
        "A small rewrite is a brave thing.",
        "Soften the corners as you go.",
        "Brown likes the new version already."
      ] },
    { test: /\b(delete|remove|trash|discard)\b/i, lines: [
        "Tuck it away gently.",
        "It's okay to let things go.",
        "We'll keep the spot warm just in case."
      ] },
    { test: /\b(clear|reset|empty)\b/i, lines: [
        "A clean page is a brave page.",
        "Sweep, sweep, all tidy.",
        "Brown helped sweep the dust."
      ] },
    { test: /\b(cancel|close|dismiss)\b/i, lines: [
        "It is fine to tuck it away for now.",
        "No worries. Try again later.",
        "Closing softly. No loud doors."
      ] },
    { test: /\b(back|return)\b/i, lines: [
        "Step back slowly. We'll keep you company.",
        "Going back is also moving.",
        "The previous page kept your spot."
      ] },
    { test: /\b(search|find)\b/i, lines: [
        "Looking for something soft?",
        "White helps you sniff it out.",
        "Brown thinks it's behind a tag."
      ] },
    { test: /\b(filter|all|sort)\b/i, lines: [
        "Try another angle. There may be something new.",
        "Brown likes the all-view best.",
        "Sorting tiny things is oddly relaxing."
      ] },
    { test: /\b(tag|tags|label)\b/i, lines: [
        "Tags are tiny rooms for stories.",
        "Pick a tag, peek inside.",
        "White made a folder out of feelings."
      ] },
    { test: /\b(reply|comment|leave a message)\b/i, lines: [
        "Whisper something nice in the comments.",
        "A reply is a tiny hug.",
        "Brown reads every comment twice."
      ] },

    // ---- 作者切换 ----
    { test: /\b(white)\b|author-?white|\.author--?white/i, lines: [
        "White waves a little hello.",
        "White's side of the nest looks tidy.",
        "Blue-ish skies on White's page today."
      ] },
    { test: /\b(brown)\b|author-?brown|\.author--?brown/i, lines: [
        "Brown thumps a tiny tail.",
        "Brown's corner smells like warm bread.",
        "Sunset colors on Brown's page."
      ] },

    // ---- 页面内细分 ----
    { test: /heat-?map|grid-heat/i, lines: [
        "Heatmap squares glow as you go.",
        "Brown counted the warm squares.",
        "Streaks are cozy little lines."
      ] },
    { test: /\b(start[\s-]?time|begin[\s-]?time)\b/i, lines: [
        "When did the little thing begin?",
        "Type in 24-hour, e.g. 09:30.",
        "Mornings count too, you know."
      ] },
    { test: /\b(end[\s-]?time|finish)\b/i, lines: [
        "And when did it wrap up?",
        "Endings deserve timestamps.",
        "Brown finished a snack at exactly 12:34."
      ] },
    { test: /\b(category|type)\b|category-/i, lines: [
        "Pick a tiny bucket for it.",
        "Even rest is a category here.",
        "White likes the studying bucket."
      ] },
    { test: /\b(mood|feeling)\b/i, lines: [
        "Today's mood deserves a word.",
        "Brown picks 'soft' as today's mood.",
        "Mood is a season inside a day."
      ] },
    { test: /\b(weather|sky|temperature)\b/i, lines: [
        "Sky check is a good habit.",
        "Brown thinks today is cloud-shaped.",
        "Tap the weather chip to update."
      ] },
    { test: /\b(location|where i am)\b/i, lines: [
        "We won't tell anyone where you are.",
        "Brown says: the nest is the place.",
        "A soft little dot on the map."
      ] },
    { test: /\b(complete|done|finish|check)\b/i, lines: [
        "Tiny win incoming.",
        "Cross it off. Feel the click.",
        "Brown does a little cheer."
      ] },
    { test: /\b(undo|restore|uncomplete|reopen)\b/i, lines: [
        "Bringing it back. No rush.",
        "Second chances are nice.",
        "White nods: try again later."
      ] },
    { test: /\b(toggle|switch|view)\b/i, lines: [
        "Different angle, different feeling.",
        "Brown likes toggles. Click click.",
        "Switch on, switch off, repeat."
      ] },
    { test: /\b(day|month|year)\b.*view|view.*\b(day|month|year)\b/i, lines: [
        "Zoom in, zoom out, both are fine.",
        "Months feel like soft pages."
      ] },
    { test: /\b(lightbox|enlarge|fullscreen|expand)\b/i, lines: [
        "Bigger is sometimes softer too.",
        "Brown peeks at the larger photo."
      ] },
    { test: /\b(prev|previous)\b/i, lines: [
        "Look back gently.",
        "The earlier one was good too."
      ] },
    { test: /\b(next|more)\b/i, lines: [
        "One more, just one more.",
        "Brown leans forward in curiosity."
      ] },
    { test: /\b(read more|read|article)\b/i, lines: [
        "A long read is a tiny vacation.",
        "Tuck in, take your time."
      ] }
  ];

  /* ------------------------------------------------------------
     操作完成时说的话（按 API URL 匹配，匹配 fetch 成功/失败）
     ok：操作成功；fail：操作失败
     ------------------------------------------------------------ */
  var ACTION_LINES = [
    { test: /\/api\/blog\/upload/, ok: [
        "A new story is tucked into the nest.",
        "The blog shelf has a fresh page.",
        "Brown bookmarks it already."
      ], fail: [
        "The story refused to land. Try again?",
        "White says: maybe re-check the file?"
      ] },
    { test: /\/api\/blog\/delete/, ok: [
        "Story carefully put away.",
        "The shelf made a little space."
      ] },
    { test: /\/api\/photos\/upload/, ok: [
        "A new photo joined the wall.",
        "Brown poses next to it.",
        "Memory locked in, softly."
      ], fail: [
        "The photo got stuck on the way in.",
        "Maybe a smaller file? White suggests."
      ] },
    { test: /\/api\/photos\/delete/, ok: [
        "Photo gently taken down.",
        "The frame keeps the memory anyway."
      ] },
    { test: /\/api\/records\/create/, ok: [
        "Today has a tiny note now.",
        "Mood saved. Brown approves.",
        "The records page glows a little."
      ] },
    { test: /\/api\/records\/delete/, ok: [
        "That moment is folded away.",
        "Brown gives a quiet nod."
      ] },
    { test: /\/api\/activity\/create/, ok: [
        "Logged in the timeline.",
        "Another little time-block, locked in.",
        "Brown ticks it on the day chart."
      ], fail: [
        "The timeline didn't catch it. Check the times?"
      ] },
    { test: /\/api\/activity\/delete/, ok: [
        "Removed from the day chart.",
        "The timeline breathes again."
      ] },
    { test: /\/api\/todos\/create/, ok: [
        "A new task hops onto the list.",
        "Brown promises moral support.",
        "Future you will thank present you."
      ] },
    { test: /\/api\/todos\/complete/, ok: [
        "Crossed off! Tiny cheer.",
        "Heatmap got a little warmer.",
        "White does a celebratory wiggle.",
        "Another square colored in."
      ], fail: [
        "Completion didn't save. Try once more?"
      ] },
    { test: /\/api\/todos\/uncomplete/, ok: [
        "Brought it back. No rush.",
        "Second chances are welcome here."
      ] },
    { test: /\/api\/todos\/update/, ok: [
        "Refined a little. Looks softer now.",
        "White nods at the new title."
      ] },
    { test: /\/api\/todos\/delete/, ok: [
        "Tucked it away quietly.",
        "Brown waves goodbye to the task."
      ] },
    { test: /\/api\/todos\/clear-completed/, ok: [
        "All clean. Fresh page feeling.",
        "The list is breathing again.",
        "White is very proud of the sweep."
      ] },
    { test: /\/api\/todos\/toggle-all/, ok: [
        "Whole list moved at once. Whoa.",
        "Brown blinks at the change."
      ] },
    { test: /\/api\/comments\/create/, ok: [
        "A new comment found its way home.",
        "The page feels a bit warmer.",
        "Brown reads it slowly twice."
      ] },
    { test: /\/api\/comments\/delete/, ok: [
        "Taken back gently.",
        "No hard feelings. Brown understands."
      ] },
    { test: /\/api\/places\/create/, ok: [
        "Another dream destination pinned.",
        "We can go there together one day.",
        "Brown packs a tiny suitcase."
      ] },
    { test: /\/api\/places\/delete/, ok: [
        "Place quietly unpinned.",
        "Maybe next time, somewhere else."
      ] },
    { test: /\/api\/status\/field/, ok: [
        "Mood updated. Brown approves.",
        "Today's word is on the door.",
        "White waves a little at the new status."
      ] },
    { test: /\/api\/status\/weather/, ok: [
        "Sky check done.",
        "Weather chip is fresh now.",
        "Brown sniffs the new forecast."
      ] },
    { test: /\/api\/auth\/login/, ok: [
        "Welcome back to the nest.",
        "We saved your seat.",
        "The corner pups did a little hop."
      ], fail: [
        "Hmm, the door didn't open. Try again?"
      ] },
    { test: /\/api\/auth\/register/, ok: [
        "A new face in our corner.",
        "Brown brought a tiny welcome cake."
      ] },
    { test: /\/api\/auth\/logout/, ok: [
        "See you soon. Sleep well.",
        "The light stays on for next time."
      ] }
  ];

  var SPEECH_HOLD_MS = 2200;
  var ACTION_SPEECH_HOLD_MS = 2800;

  /* ============================================================
     渲染小狗节点
     ============================================================ */
  var root = document.createElement("div");
  root.className = "corner-dogs";
  root.setAttribute("aria-label", "Corner pups");
  document.body.appendChild(root);

  var dogMap = {};
  var dogButtons = DOGS.map(function (dog) {
    var btn = document.createElement("button");
    btn.className = "corner-dog corner-dog--" + dog.key;
    btn.type = "button";
    btn.setAttribute("aria-label", dog.label + ", play a random action");

    var shadow = document.createElement("span");
    shadow.className = "corner-dog__shadow";

    var img = document.createElement("img");
    img.className = "corner-dog__img";
    img.src = dog.idle;
    img.alt = "";
    img.draggable = false;

    var bubble = document.createElement("span");
    bubble.className = "corner-dog__bubble";

    btn.appendChild(shadow);
    btn.appendChild(img);
    btn.appendChild(bubble);
    root.appendChild(btn);

    dog.el = btn;
    dog.img = img;
    dog.bubble = bubble;
    dogMap[dog.key] = dog;

    btn.addEventListener("click", function () {
      playRandomAction(dog);
    });

    return btn;
  });

  /* ============================================================
     工具函数
     ============================================================ */
  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function pickDistinct(list, lastIdxRef) {
    if (!list || !list.length) return "";
    if (list.length === 1) return list[0];
    var idx;
    do {
      idx = Math.floor(Math.random() * list.length);
    } while (idx === lastIdxRef.value);
    lastIdxRef.value = idx;
    return list[idx];
  }

  function randomDog() {
    return pick(DOGS);
  }

  function lineFromEntry(entry) {
    if (!entry) return "";
    if (entry.lines && entry.lines.length) {
      if (!entry._lastIdx) entry._lastIdx = { value: -1 };
      return pickDistinct(entry.lines, entry._lastIdx);
    }
    return entry.line || "";
  }

  function speak(dog, line, holdMs) {
    if (!dog || !dog.bubble || !line) return;
    clearTimeout(dog._speechTimer);
    dog.bubble.textContent = line;
    dog.el.classList.add("is-speaking");
    dog._speechTimer = setTimeout(function () {
      dog.el.classList.remove("is-speaking");
    }, holdMs || SPEECH_HOLD_MS);
  }

  var lastRandomIdx = { value: -1 };
  function scheduleRandomSpeech() {
    // 25–45 秒之间随机
    var delay = 25000 + Math.floor(Math.random() * 20001);
    clearTimeout(root._randomSpeechTimer);
    root._randomSpeechTimer = setTimeout(function () {
      speak(randomDog(), pickDistinct(RANDOM_LINES, lastRandomIdx), SPEECH_HOLD_MS);
      scheduleRandomSpeech();
    }, delay);
  }

  function playRandomAction(dog) {
    playAction(dog, pick(dog.actions));
  }

  function playAction(dog, action) {
    if (!dog || !action) return;
    clearTimeout(dog._actionTimer);
    dog.el.classList.add("is-playing");
    speak(dog, action.line, SPEECH_HOLD_MS);
    dog.img.src = action.src + "?play=" + Date.now();
    dog._actionTimer = setTimeout(function () {
      dog.img.src = dog.idle;
      dog.el.classList.remove("is-playing");
      if (action.after === "brown-catch-heart") {
        playAction(dogMap.brown, dogMap.brown.hiddenActions["brown-catch-heart"]);
      }
    }, action.duration);
  }

  /* ============================================================
     悬停按钮 → 找到对应台词
     ============================================================ */
  function featureEntryFor(el) {
    var text = [
      el.textContent || "",
      el.getAttribute && (el.getAttribute("aria-label") || ""),
      el.getAttribute && (el.getAttribute("href") || ""),
      el.getAttribute && (el.getAttribute("title") || ""),
      el.id || "",
      el.className || ""
    ].join(" ");
    for (var i = 0; i < FEATURE_LINES.length; i++) {
      if (FEATURE_LINES[i].test.test(text)) return FEATURE_LINES[i];
    }
    return null;
  }

  function bindOne(el) {
    if (!el || el._cornerDogTalkBound) return;
    if (el.closest && el.closest(".corner-dogs")) return;
    var entry = featureEntryFor(el);
    if (!entry) return;
    el._cornerDogTalkBound = true;
    var onShow = function () {
      var line = lineFromEntry(entry);
      if (line) speak(randomDog(), line, SPEECH_HOLD_MS);
    };
    el.addEventListener("mouseenter", onShow);
    el.addEventListener("focus", onShow);
  }

  function bindFeatureTalk(scope) {
    var rootEl = scope && scope.querySelectorAll ? scope : document;
    var nodes = rootEl.querySelectorAll("a, button, [role='button'], input[type='submit'], input[type='button']");
    Array.prototype.slice.call(nodes).forEach(bindOne);
  }

  // 监听 DOM 变化（React 岛 / 动态评论列表 / 待办新增等）
  function watchDynamicNodes() {
    if (typeof MutationObserver === "undefined") return;
    var mo = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== 1) continue;
          if (node.matches && node.matches("a, button, [role='button']")) bindOne(node);
          if (node.querySelectorAll) bindFeatureTalk(node);
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  /* ============================================================
     fetch 拦截：操作完成时小狗捧场
     ============================================================ */
  function findActionEntry(url) {
    for (var i = 0; i < ACTION_LINES.length; i++) {
      if (ACTION_LINES[i].test.test(url)) return ACTION_LINES[i];
    }
    return null;
  }

  function announceAction(url, ok) {
    var entry = findActionEntry(url);
    if (!entry) return;
    var pool = ok ? entry.ok : (entry.fail || []);
    if (!pool || !pool.length) return;
    if (!entry._lastIdx) entry._lastIdx = { value: -1 };
    var line = pickDistinct(pool, entry._lastIdx);
    speak(randomDog(), line, ACTION_SPEECH_HOLD_MS);
  }

  function wrapFetch() {
    if (!window.fetch || window.fetch._cornerDogsWrapped) return;
    var native = window.fetch.bind(window);
    var wrapped = function (input, init) {
      var url = "";
      var method = "GET";
      try {
        if (typeof input === "string") {
          url = input;
          method = (init && init.method) || "GET";
        } else if (input && input.url) {
          url = input.url;
          method = (init && init.method) || input.method || "GET";
        }
      } catch (e) {}
      var promise = native(input, init);
      if (typeof method === "string" && method.toUpperCase() !== "GET" && url) {
        promise.then(function (res) {
          try { announceAction(url, !!(res && res.ok)); } catch (e) {}
        }, function () {
          try { announceAction(url, false); } catch (e) {}
        });
      }
      return promise;
    };
    wrapped._cornerDogsWrapped = true;
    window.fetch = wrapped;
  }

  /* ============================================================
     全局 API + 自定义事件
     - window.CornerDogs.say(line, { dog: "white"|"brown", holdMs })
     - document.dispatchEvent(new CustomEvent("cornerdogs:say", { detail: {...} }))
     ============================================================ */
  window.CornerDogs = {
    say: function (line, opts) {
      opts = opts || {};
      var dog = (opts.dog && dogMap[opts.dog]) || randomDog();
      speak(dog, line, opts.holdMs || SPEECH_HOLD_MS);
    },
    sayRandom: function (lines, opts) {
      if (!lines || !lines.length) return;
      this.say(pick(lines), opts);
    },
    playAction: function (dogKey, actionId) {
      var dog = dogMap[dogKey];
      if (!dog) return;
      var action = null;
      for (var i = 0; i < dog.actions.length; i++) {
        if (dog.actions[i].id === actionId) { action = dog.actions[i]; break; }
      }
      if (!action && dog.hiddenActions && dog.hiddenActions[actionId]) {
        action = dog.hiddenActions[actionId];
      }
      if (action) playAction(dog, action);
    }
  };

  document.addEventListener("cornerdogs:say", function (ev) {
    var d = (ev && ev.detail) || {};
    if (d.line) window.CornerDogs.say(d.line, d);
    else if (d.lines) window.CornerDogs.sayRandom(d.lines, d);
  });

  /* ============================================================
     视线跟随
     ============================================================ */
  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  document.addEventListener("mousemove", function (ev) {
    dogButtons.forEach(function (btn) {
      var rect = btn.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      var x = clamp((ev.clientX - cx) / 360, -1, 1);
      var y = clamp((ev.clientY - cy) / 300, -1, 1);
      btn.style.setProperty("--look-x", x.toFixed(3));
      btn.style.setProperty("--look-y", y.toFixed(3));
    });
  });

  /* ============================================================
     启动
     ============================================================ */
  bindFeatureTalk(document);
  watchDynamicNodes();
  wrapFetch();
  scheduleRandomSpeech();
})();
