(function () {
  "use strict";

  var POLICIES = window.POLICY_DATA || [];
  var TEMPLATES = window.POLICY_TEMPLATES || {};
  var CATEGORIES = ["就业创业", "人才落户", "住房安居", "社保医保", "民生消费", "政务办事"];
  var CAT_ICONS = {
    "就业创业": "briefcase",
    "人才落户": "graduation-cap",
    "住房安居": "home",
    "社保医保": "stethoscope",
    "民生消费": "wallet",
    "政务办事": "landmark"
  };
  var STATUS_META = {
    "待核验": ["pending", "alert-triangle"],
    "有效": ["valid", "badge-check"],
    "即将到期": ["expiring", "clock"],
    "已废止": ["ended", "circle-x"]
  };
  var KEYS = {
    selected: "gzb_selected_v1",
    events: "gzb_events_v1",
    corrections: "gzb_corrections_v1",
    subs: "gzb_subs_v1",
    verifications: "gzb_verifications_v1",
    material: "gzb_material_v1",
    guide: "gzb_guide_v1",
    quiz: "gzb_quiz_v1"
  };
  var API_BASE = window.API_BASE || "";

  var currentRoute = "home";
  var CITY_NAMES = { gz: "广州", sh: "上海" }; // 城市代码 → 显示名；新增城市在此登记（如 sz: "深圳"）
  var filters = { cat: "全部", status: "全部", sort: "deadline", q: "", city: "全部" };
  var policyVisible = 200;
  var compareAId = "";
  var compareBId = "";
  var radarLimit = 60;
  var quizStep = 0;
  var quizAnswers = readJSON(KEYS.quiz, {}) || {};
  var quizResults = null;
  var wsTab = "verify";
  var clView = "policy";
  var calYear = new Date().getFullYear();
  var calMonth = new Date().getMonth();
  var calMode = "deadline"; // 日历模式：deadline（截止日）| publish（发布日期）

  /* ---------- storage helpers ---------- */

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function mapApiPolicy(raw) {
    return {
      id: raw.id,
      city: raw.city || "gz",
      title: raw.title,
      category: raw.category,
      summary: raw.summary || "",
      amount: raw.amount || "",
      audience: raw.audience || [],
      conditions: raw.conditions || [],
      materials: raw.materials || [],
      channels: raw.channels || [],
      deadline: raw.deadline || "长期有效",
      source: raw.source || "",
      sourceUrl: raw.source_url || raw.sourceUrl || "",
      documentNumber: raw.document_number || raw.documentNumber || "",
      publishDate: raw.publish_date || raw.publishDate || "",
      attachmentUrl: raw.attachment_url || raw.attachmentUrl || "",
      status: raw.status_label || raw.status || "待核验",
      status_label: raw.status_label || "",
      verifiedAt: raw.verified_at || raw.verifiedAt || "",
      verifiedBy: raw.verified_by || "",
      reviewedBy: raw.reviewed_by || "",
      version: raw.version || 1,
      changeLog: raw.change_log || raw.changeLog || [],
      steps: raw.steps || [],
      tags: raw.tags || [],
      templateIds: raw.template_ids || raw.templateIds || [],
      updatedAt: raw.updated_at || raw.updatedAt || ""
    };
  }

  function loadRemotePolicies() {
    if (!API_BASE) return;
    if (window.__remoteLoaded) return;
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 5000) : null;
  fetch(API_BASE + "/policies?page_size=200&sort=deadline", ctrl ? { signal: ctrl.signal } : undefined)
      .then(function (resp) {
        if (!resp.ok) throw new Error("bad status");
        return resp.json();
      })
      .then(function (data) {
        window.__remoteLoaded = true;
        if (data && Array.isArray(data.items) && data.items.length) {
          POLICIES = data.items.map(mapApiPolicy);
          CATEGORIES = Array.from(new Set(POLICIES.map(function (p) { return p.category; }))).filter(Boolean);
          rerender();
          toast("已连接后端数据服务");
        }
      })
      .catch(function () { /* 后端不可用时继续使用本地种子数据 */ })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  /* ---------- small helpers ---------- */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function icon(name) {
    return '<i data-lucide="' + esc(name) + '" aria-hidden="true"></i>';
  }

  function refreshIcons() {
    if (window.lucide && window.lucide.createIcons) {
      try {
        window.lucide.createIcons();
      } catch (e) { /* ignore */ }
    }
  }

  function fmtDate(ts) {
    if (!ts) return "";
    var d = new Date(ts);
    var pad = function (n) { return n < 10 ? "0" + n : String(n); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function parseDeadline(p) {
    if (!p.deadline || p.deadline === "长期有效") return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.deadline);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function daysUntil(d) {
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.round((d - now) / 86400000);
  }

  function deadlineInfo(p) {
    var d = parseDeadline(p);
    if (!d) return { text: "长期有效", urgent: false };
    var n = daysUntil(d);
    return {
      text: p.deadline,
      urgent: n >= 0 && n <= 90,
      days: n
    };
  }

  function statusBadge(p) {
    var statusText = p.status_label || p.status;
    var meta = STATUS_META[statusText] || STATUS_META["待核验"];
    return '<span class="badge badge-status-' + meta[0] + '">' + icon(meta[1]) + esc(statusText) + "</span>";
  }

  function catBadge(p) {
    return '<span class="badge badge-cat" data-cat="' + esc(p.category) + '">' + esc(p.category) + "</span>";
  }

  function deadlineBadge(p) {
    var info = deadlineInfo(p);
    return '<span class="badge badge-deadline">' + icon("calendar-clock") + esc(info.text) + "</span>";
  }

  function track(event, payload) {
    var list = readJSON(KEYS.events, []);
    list.push({ t: Date.now(), e: event, p: payload || {} });
    if (list.length > 5000) list.splice(0, list.length - 5000);
    writeJSON(KEYS.events, list);
  }

  /* ---------- 新手指引 ---------- */

  var GUIDE_STEPS = [
    { no: "01", key: "1", icon: "circle-help", title: "了解我能办什么", desc: "1 分钟自测，看你能办哪些补贴和事项。", btn: "开始自测", href: "#/quiz" },
    { no: "02", key: "2", icon: "sparkles", title: "查看推荐事项", desc: "按匹配度和截止时间查看推荐结果。", btn: "查看推荐", href: "#/quiz", action: "guide-recommend" },
    { no: "03", key: "3", icon: "clipboard-list", title: "生成材料清单", desc: "把要办的事项整理成材料清单，按单准备。", btn: "去清单", href: "#/checklist" },
    { no: "04", key: "4", icon: "calendar-days", title: "关注截止时间", desc: "查看政策日历，别错过申请截止日期。", btn: "查看日历", href: "#/calendar" }
  ];

  var GUIDE_SHORTCUTS = [
    { label: "我想领补贴", href: "#/quiz" },
    { label: "我想落户", href: "#/policies", cat: "人才落户" },
    { label: "我想申请住房", href: "#/policies", cat: "住房安居" },
    { label: "我想办社保医保", href: "#/policies", cat: "社保医保" },
    { label: "我想准备材料", href: "#/checklist" }
  ];

  function guideState() {
    var s = readJSON(KEYS.guide, null);
    if (!s || typeof s !== "object") s = { collapsed: false, steps: {} };
    if (!s.steps || typeof s.steps !== "object") s.steps = {};
    return s;
  }

  function guideMarkStep(key) {
    var s = guideState();
    if (s.steps[key]) return;
    s.steps[key] = true;
    writeJSON(KEYS.guide, s);
    track("guide_step_done", { step: key });
  }

  function guideDoneCount() {
    var s = guideState();
    var n = 0;
    GUIDE_STEPS.forEach(function (st) { if (s.steps[st.key]) n++; });
    return n;
  }

  function saveQuizAnswers() {
    writeJSON(KEYS.quiz, quizAnswers);
  }

  function guideShortcutHtml(item) {
    var attrs = item.cat
      ? ' data-action="cat-filter" data-cat="' + esc(item.cat) + '" data-cat-label="' + esc(item.cat) + '"'
      : "";
    return '<a class="guide-shortcut" href="' + esc(item.href) + '"' + attrs + ">" + esc(item.label) + "</a>";
  }

  function renderGuide() {
    var s = guideState();
    var done = guideDoneCount();
    var steps = '<div class="guide-steps">' + GUIDE_STEPS.map(function (st) {
      var isDone = !!s.steps[st.key];
      var stateHtml = isDone ? '<span class="guide-step-state">' + icon("check") + " 已完成</span>" : "";
      var action = st.action ? ' data-action="' + st.action + '"' : "";
      return '<div class="guide-step' + (isDone ? " done" : "") + '">' +
        '<div class="guide-step-top">' +
          '<span class="guide-step-no">' + st.no + "</span>" +
          '<span class="guide-step-ic">' + icon(st.icon) + "</span>" +
        "</div>" +
        "<h3>" + esc(st.title) + "</h3>" +
        "<p>" + esc(st.desc) + "</p>" +
        '<div class="guide-step-foot">' + stateHtml +
          '<a class="btn btn-primary btn-sm" href="' + esc(st.href) + '"' + action + ">" + icon(st.icon) + " " + esc(st.btn) + "</a>" +
        "</div>" +
      "</div>";
    }).join("") + "</div>";

    var shortcuts = '<div class="guide-shortcuts">' +
      '<span class="guide-shortcuts-label">我想办……</span>' +
      '<div class="guide-shortcut-list">' + GUIDE_SHORTCUTS.map(guideShortcutHtml).join("") + "</div>" +
    "</div>";

    var body = s.collapsed
      ? '<div class="band-body guide-collapsed-hint">新手需要帮助？<button class="btn btn-ghost btn-sm" data-action="guide-toggle">重新查看新手指引</button></div>'
      : '<div class="guide-body"><div class="band-body">' + steps + shortcuts + "</div></div>";

    return (
      '<section class="band section-gap guide-panel" aria-label="新手指引">' +
        '<div class="band-head guide-head">' +
          '<div class="guide-heading"><h2>' + icon("compass") + " 新手指引</h2><p>第一次来，按这 4 步就能开始使用。</p></div>" +
          '<div class="guide-meta">' +
            '<span class="guide-progress">' + done + ' / 4 已完成</span>' +
            '<button class="btn btn-sm guide-toggle-btn" data-action="guide-toggle" aria-expanded="' + (!s.collapsed) + '">' +
              icon(s.collapsed ? "chevron-down" : "chevron-up") + (s.collapsed ? " 展开" : " 收起") +
            "</button>" +
          "</div>" +
        "</div>" +
        body +
      "</section>"
    );
  }

  function selectedIds() {
    return readJSON(KEYS.selected, []);
  }

  function saveSelected(ids) {
    writeJSON(KEYS.selected, ids);
    refreshCount();
  }

  function toggleSelect(id) {
    var ids = selectedIds();
    var idx = ids.indexOf(id);
    if (idx >= 0) ids.splice(idx, 1);
    else ids.push(id);
    saveSelected(ids);
    track("toggle_select", { id: id, on: idx < 0 });
  }

  function getSelectedPolicies() {
    var ids = selectedIds();
    return POLICIES.filter(function (p) { return ids.indexOf(p.id) >= 0; });
  }

  function materialKey(p, material) {
    return p.id + "::" + material;
  }

  function doneMaterials() {
    return readJSON(KEYS.material, []);
  }

  function toggleMaterial(key) {
    var list = doneMaterials();
    var idx = list.indexOf(key);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(key);
    writeJSON(KEYS.material, list);
  }

  function verifications() {
    return readJSON(KEYS.verifications, {});
  }

  function verifiedCount() {
    return Object.keys(verifications()).length;
  }

  function upcomingDeadlines(days) {
    return POLICIES.filter(function (p) {
      var d = parseDeadline(p);
      return d && daysUntil(d) >= 0 && daysUntil(d) <= days;
    }).sort(function (a, b) {
      return parseDeadline(a) - parseDeadline(b);
    });
  }

  function toast(msg) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { el.classList.remove("show"); }, 2400);
  }

  function refreshCount() {
    var el = document.getElementById("checklistCount");
    if (el) el.textContent = String(selectedIds().length);
  }

  function refreshNav() {
    var map = { policies: "policies", policy: "policies", quiz: "quiz", checklist: "checklist", calendar: "calendar", workspace: "workspace", home: "home" };
    var active = map[currentRoute] || "home";
    var links = document.querySelectorAll(".main-nav a");
    links.forEach(function (a) {
      a.classList.toggle("active", a.getAttribute("data-route") === active);
    });
  }

  function emptyState(text, actionHtml) {
    return '<div class="empty">' + icon("inbox") + "<div>" + esc(text) + "</div>" + (actionHtml || "") + "</div>";
  }

  function csvCell(v) {
    return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  }

  function downloadBlob(filename, text, mime) {
    try {
      var blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 500);
    } catch (e) {
      toast("导出失败，请重试");
    }
  }

  function downloadCsv(filename, rows) {
    var csv = "\uFEFF" + rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n");
    downloadBlob(filename, csv, "text/csv;charset=utf-8");
  }

  function copyText(text, msg) {
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); toast(msg || "已复制"); } catch (e) { toast("复制失败，请手动复制"); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(msg || "已复制"); }, fallback);
    } else {
      fallback();
    }
  }

  /* ---------- home ---------- */

  function rowListItem(p, meta, urgent) {
    return '<div class="row-list-item">' +
      '<span class="icon-tile">' + icon(CAT_ICONS[p.category] || "file-text") + "</span>" +
      '<div class="row-list-main"><a href="#/policy/' + esc(p.id) + '">' + esc(p.title) + "</a>" +
      '<div class="row-list-meta">' + esc(meta) + "</div></div>" +
      (urgent ? '<span class="urgency-dot" title="即将截止"></span>' : "") +
      "</div>";
  }

  function renderHome() {
    var total = POLICIES.length;
    var pending = POLICIES.filter(function (p) { return p.status === "待核验"; }).length;
    var verified = total - pending;
    var localVerified = Object.keys(verifications()).length;
    var combinedVerified = Math.min(total, verified + localVerified);
    var verifyPct = total ? Math.round((combinedVerified / total) * 100) : 0;
    var expiring = upcomingDeadlines(60).length;
    var urgent = upcomingDeadlines(90).slice(0, 6);
    var recentPubs = POLICIES.filter(function (p) { return p.publishDate; })
      .sort(function (a, b) { return String(b.publishDate).localeCompare(String(a.publishDate)); })
      .slice(0, 6);
    var recent = POLICIES.slice().sort(function (a, b) {
      return String(b.updatedAt).localeCompare(String(a.updatedAt));
    }).slice(0, 6);

    return (
      '<section class="band home-top">' +
        '<div class="home-intro">' +
          '<span class="eyebrow">' + icon("map-pin") + " 全国 · 补贴与办事数据站</span>" +
          '<h1>把“能办什么、怎么办、带什么”一次查清楚</h1>' +
          "<p>穗易办把分散在各部门官网的补贴和办事信息整理成结构化数据：适用条件、材料清单、办理流程、截止日期和官方来源一目了然。</p>" +
          '<div class="search-row">' +
            '<div class="search-box">' + icon("search") +
              '<input id="homeSearch" type="search" placeholder="搜补贴，如：社保补贴、创业、落户…" aria-label="搜索政策">' +
            "</div>" +
            '<button class="btn btn-primary" data-action="home-search">' + icon("search") + " 搜索</button>" +
          "</div>" +
        "</div>" +
        '<div class="home-stats">' +
          '<div class="home-stat"><span class="num">' + total + '</span><span class="label">条政策数据</span></div>' +
          '<div class="home-stat"><span class="num">' + combinedVerified + '</span><span class="label">已核验条目</span></div>' +
          '<div class="home-stat"><span class="num">' + pending + '</span><span class="label">待核验条目</span></div>' +
          '<div class="home-stat"><span class="num">' + expiring + '</span><span class="label">60 天内截止</span></div>' +
        "</div>" +
        '<div class="home-progress"><div class="progress-wrap"><div class="progress-bar"><div class="progress-fill" style="width:' + verifyPct + '%"></div></div>' +
          '<span class="progress-text">核验进度 ' + combinedVerified + " / " + total + "（" + verifyPct + "%）</span></div>" +
          '<p class="small">上线前需完成双人核验；核验台可标记“本人/复核人”核验。</p></div>' +
      "</section>" +
      renderGuide() +
      '<section class="cat-grid" aria-label="政策分类">' +
        CATEGORIES.map(function (c) {
          var n = POLICIES.filter(function (p) { return p.category === c; }).length;
          return '<a class="cat-tile" href="#/policies" data-action="cat-filter" data-cat="' + esc(c) + '" data-cat-label="' + esc(c) + '">' +
            icon(CAT_ICONS[c] || "file-text") +
            '<span class="name">' + esc(c) + "</span>" +
            '<span class="count">' + n + " 条</span></a>";
        }).join("") +
      "</section>" +
      '<section class="home-cols">' +
        '<div class="band"><div class="band-head"><h2>' + icon("clock") + (urgent.length ? " 90 天内将截止" : " 最近发布") + '</h2><a class="small" href="' + (urgent.length ? "#/policies" : "#/calendar") + '">查看全部</a></div>' +
          (urgent.length
            ? '<div class="row-list">' + urgent.map(function (p) { return rowListItem(p, "截止 " + p.deadline + " · " + p.category, true); }).join("") + "</div>"
            : recentPubs.length
              ? '<div class="row-list">' + recentPubs.map(function (p) { return rowListItem(p, "发布于 " + p.publishDate + " · " + p.category); }).join("") + "</div>"
              : emptyState("近期没有即将到期的条目")) +
        "</div>" +
        '<div class="band"><div class="band-head"><h2>' + icon("refresh-cw") + " 最近更新</h2><a class=\"small\" href=\"#/workspace\">核验台</a></div>" +
          (recent.length ? '<div class="row-list">' + recent.map(function (p) { return rowListItem(p, (p.updatedAt || "") + " 更新 · " + p.category); }).join("") + "</div>" : emptyState("暂无更新记录")) +
        "</div>" +
      "</section>" +
      '<section class="band section-gap">' +
        '<div class="band-head"><h2>' + icon("info") + " 这个网站是做什么的？</h2></div>" +
        '<div class="band-body home-about">' +
          '<p><strong>一句话：</strong>它把“办这件事要符合什么条件、准备什么材料、去哪办、什么时候截止”整理成一份能直接照着做的清单。</p>' +
          '<p><strong>为什么要做：</strong>官方政策分散在各部门网站和公众号里，普通人搜不全、看不懂、容易错过截止时间。穗易办把这些信息结构化，并标注官方来源和核验状态，方便你快速定位。</p>' +
          '<p><strong>怎么用：</strong>先搜政策，再用“条件自测”看自己能办哪些，把要办的事项加入清单，最后生成材料清单带走。网站右上角的“核验台”是给内容维护者用的，用来逐条核对官方来源。</p>' +
        "</div>" +
      "</section>"
    );
  }

  /* ---------- policies list ---------- */

  function policyRow(p) {
    var sel = selectedIds().indexOf(p.id) >= 0;
    var info = deadlineInfo(p);
    var metaLine = [p.source, p.publishDate, p.documentNumber].filter(Boolean).join(" · ");
    return (
      '<div class="policy-row" data-cat="' + esc(p.category) + '">' +
        "<div>" +
          '<a class="policy-title" href="#/policy/' + esc(p.id) + '">' + esc(p.title) + "</a>" +
          '<div class="policy-meta">' + catBadge(p) + statusBadge(p) + deadlineBadge(p) + "</div>" +
        "</div>" +
        '<div class="policy-audience">' + (esc((p.audience || []).join("、")) || esc(metaLine)) + "</div>" +
        '<div class="policy-deadline">' + (info.urgent ? '<strong>' + esc(info.text) + "</strong>" : esc(info.text)) + "</div>" +
        '<div class="policy-actions">' +
          (p.attachmentUrl ? '<a class="btn btn-sm" href="' + esc(p.attachmentUrl) + '" target="_blank" rel="noopener noreferrer" title="下载官方原文附件">' + icon("download") + " 原文</a>" : "") +
          '<button class="btn btn-sm" data-action="open-policy" data-id="' + esc(p.id) + '">' + icon("eye") + " 详情</button>" +
          '<button class="btn btn-sm ' + (sel ? "btn-primary" : "") + '" data-action="toggle-select" data-id="' + esc(p.id) + '">' +
            icon(sel ? "check" : "plus") + (sel ? " 已加入" : " 加入清单") +
          "</button>" +
        "</div>" +
      "</div>"
    );
  }

  function renderPolicies() {
    var list = POLICIES.filter(function (p) {
      if (filters.city !== "全部" && (p.city || "gz") !== filters.city) return false;
      if (filters.cat !== "全部" && p.category !== filters.cat) return false;
      if (filters.status !== "全部" && (p.status_label || p.status) !== filters.status) return false;
      if (filters.q) {
        var q = filters.q.toLowerCase();
        var hay = (p.title + " " + (p.summary || "") + " " + (p.audience || []).join(" ") + " " + p.category).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });

    list.sort(function (a, b) {
      if (filters.sort === "title") return String(a.title).localeCompare(String(b.title), "zh");
      if (filters.sort === "updated") return String(b.updatedAt || b.updated_at || "").localeCompare(String(a.updatedAt || a.updated_at || ""));
      var da = parseDeadline(a) ? parseDeadline(a).getTime() : Infinity;
      var db = parseDeadline(b) ? parseDeadline(b).getTime() : Infinity;
      return da - db;
    });
    var visible = list.slice(0, policyVisible);

    var cityOpts = ['<option value="全部">全部城市</option>'].concat(
      Array.from(new Set(POLICIES.map(function (p) { return p.city || "gz"; }))).map(function (c) {
        return '<option value="' + esc(c) + '"' + (filters.city === c ? " selected" : "") + ">" + esc(CITY_NAMES[c] || c) + "</option>";
      })
    ).join("");
    var catOpts = ['<option value="全部">全部分类</option>'].concat(CATEGORIES.map(function (c) {
      return '<option value="' + esc(c) + '"' + (filters.cat === c ? " selected" : "") + ">" + esc(c) + "</option>";
    })).join("");
    var statusOpts = ["全部", "待核验", "有效", "即将到期", "已废止"].map(function (s) {
      return '<option value="' + esc(s) + '"' + (filters.status === s ? " selected" : "") + ">" + (s === "全部" ? "全部状态" : esc(s)) + "</option>";
    }).join("");
    var sortOpts = [
      ["deadline", "按截止临近"],
      ["updated", "按最近更新"],
      ["title", "按名称"]
    ].map(function (pair) {
      return '<option value="' + pair[0] + '"' + (filters.sort === pair[0] ? " selected" : "") + ">" + pair[1] + "</option>";
    }).join("");

    return (
      '<div class="page-head"><div><span class="eyebrow">' + icon("file-text") + " 政策库</span><h1>全国补贴与办事政策</h1>" +
        "<p>全部 " + POLICIES.length + " 条初稿数据，每条都标注官方来源与核验状态。</p></div></div>" +
      '<div class="band">' +
        '<div class="filter-bar">' +
        '<div class="field search-flex"><label for="policySearch">关键词</label>' +
            '<input id="policySearch" type="search" value="' + esc(filters.q) + '" placeholder="搜索政策名称、人群或摘要">' +
          "</div>" +
          '<div class="field"><label for="cityFilter">城市</label><select id="cityFilter" data-filter="city">' + cityOpts + "</select></div>" +
          '<div class="field"><label for="catFilter">分类</label><select id="catFilter" data-filter="cat">' + catOpts + "</select></div>" +
          '<div class="field"><label for="statusFilter">状态</label><select id="statusFilter" data-filter="status">' + statusOpts + "</select></div>" +
          '<div class="field sort-select"><label for="sortFilter">排序</label><select id="sortFilter" data-filter="sort">' + sortOpts + "</select></div>" +
          '<div class="filter-actions"><button class="btn btn-ghost" data-action="clear-filters">' + icon("x") + " 清空</button></div>" +
        "</div>" +
        '<div class="result-count">显示 ' + visible.length + " / " + list.length + " 条</div>" +
        (list.length ? visible.map(policyRow).join("") : emptyState(
          filters.q ? "没有匹配 “" + filters.q + "” 的政策" : "没有符合条件的政策",
          '<button class="btn btn-sm" data-action="clear-filters">' + icon("x") + " 清空筛选</button>")) +
        (list.length > visible.length ? '<div class="band-body" style="text-align:center"><button class="btn" data-action="load-more-policies">' + icon("chevron-down") + " 加载更多（" + (list.length - visible.length) + "）</button></div>" : "") +
      "</div>"
    );
  }

  /* ---------- detail ---------- */

  function renderDetail(id) {
    var p = POLICIES.filter(function (x) { return x.id === id; })[0];
    if (!p) {
      return '<div class="band"><div class="band-body">' + emptyState("未找到这条政策",
        '<a class="btn btn-sm" href="#/policies">' + icon("arrow-left") + " 返回政策库</a>") + "</div></div>";
    }
    var sel = selectedIds().indexOf(p.id) >= 0;
    var ver = verifications()[p.id];
    var done = doneMaterials();
    var info = deadlineInfo(p);
    var related = POLICIES.filter(function (x) { return x.category === p.category && x.id !== p.id; }).slice(0, 3);

    var stepsHtml = (p.steps || []).map(function (s, i) {
      return '<li class="step-item"><span class="step-dot">' + (i + 1) + "</span>" +
        "<h3>" + esc(s.title) + "</h3><p>" + esc(s.detail) + "</p>" +
        (s.pitfall ? '<div class="step-pitfall">' + icon("alert-triangle") + " 常见坑：" + esc(s.pitfall) + "</div>" : "") +
        "</li>";
    }).join("");

    var materialsHtml = (p.materials || []).map(function (m) {
      var key = materialKey(p, m);
      var checked = done.indexOf(key) >= 0;
      return '<label class="check-item ' + (checked ? "done" : "") + '">' +
        '<input type="checkbox" class="js-material" data-key="' + esc(key) + '"' + (checked ? " checked" : "") + ">" +
        "<span>" + esc(m) + "</span></label>";
    }).join("");

    var channelsHtml = (p.channels || []).map(function (c) {
      return '<div class="channel-row">' + icon("building-2") +
        "<div><strong>" + esc(c.name) + "</strong><span>" + esc(c.detail) + "</span></div></div>";
    }).join("");

    var templatesHtml = (p.templateIds || []).map(function (tkey) {
      var t = TEMPLATES[tkey];
      if (!t) return "";
      return '<div class="template-row"><span class="t-name">' + icon("file-text") + esc(t.name) + "</span>" +
        '<span class="policy-actions">' +
        '<button class="btn btn-sm" data-action="template-copy" data-id="' + esc(p.id) + '" data-tkey="' + esc(tkey) + '">' + icon("copy") + " 复制</button>" +
        '<button class="btn btn-sm" data-action="template-download" data-id="' + esc(p.id) + '" data-tkey="' + esc(tkey) + '">' + icon("download") + " 下载</button>" +
        "</span></div>";
    }).join("");

    var sourceUrl = ver && ver.url ? ver.url : p.sourceUrl;

    return (
      '<div class="detail-head">' +
        "<div>" +
          '<div class="policy-meta">' + catBadge(p) + statusBadge(p) + deadlineBadge(p) + "</div>" +
          '<div class="detail-title"><h1>' + esc(p.title) + "</h1><p class=\"muted\">" + esc(p.summary) + "</p></div>" +
        "</div>" +
        '<div class="detail-actions">' +
          '<button class="btn ' + (sel ? "btn-primary" : "") + '" data-action="toggle-select" data-id="' + esc(p.id) + '">' +
            icon(sel ? "check" : "plus") + (sel ? " 已加入清单" : " 加入清单") + "</button>" +
          '<a class="btn" href="#/policies">' + icon("arrow-left") + " 返回列表</a>" +
        "</div>" +
      "</div>" +
      '<dl class="fact-grid">' +
        fact("users", "适用人群", esc((p.audience || []).join("、"))) +
        fact("circle-dollar-sign", "补贴 / 标准", esc(p.amount || "不涉及")) +
        fact("calendar-clock", "办理时限", esc(p.processDuration || p.process_duration || info.text) + (info.days >= 0 ? "（截止剩 " + info.days + " 天）" : "")) +
        fact("route", "办理渠道", esc((p.channels || []).map(function (c) { return c.name; }).join("、"))) +
        fact("building-2", "发文部门", esc(p.source)) +
        fact("stamp", "文号", esc(p.documentNumber || "—")) +
        fact("calendar", "发布日期", esc(p.publishDate || "—")) +
        fact("shield-check", "数据状态", p.auto_filled ? "自动填充待核验（置信度 " + Math.round((p.confidence || 0) * 100) + "%）" : (ver ? "已于 " + ver.at + " 由" + ver.by + "核验" : "尚未人工核验")) +
      "</dl>" +
      '<div class="detail-cols">' +
        '<section class="band"><div class="band-head"><h2>' + icon("list-ordered") + " 办理流程</h2></div>" +
          '<div class="band-body"><ol class="step-list">' + stepsHtml + "</ol></div></section>" +
        '<div class="stack">' +
          '<section class="band"><div class="band-head"><h2>' + icon("clipboard-check") + " 材料清单</h2></div>" +
            '<div class="band-body">' + (materialsHtml || emptyState("材料清单待核验补充")) + "</div></section>" +
          '<section class="band section-gap"><div class="band-head"><h2>' + icon("building-2") + " 办理渠道总览</h2></div>" +
            '<div class="band-body">' + (channelsHtml || emptyState("渠道信息待核验补充")) + "</div></section>" +
          (templatesHtml ? '<section class="band section-gap"><div class="band-head"><h2>' + icon("file-text") + " 模板下载</h2></div>" +
            '<div class="band-body">' + templatesHtml + "</div></section>" : "") +
          '<section class="band section-gap"><div class="band-head"><h2>' + icon("external-link") + " 官方来源</h2></div>" +
            '<div class="band-body">' +
              '<div class="source-row"><span>' + esc(p.source) + "</span>" +
                '<a href="' + esc(sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + icon("external-link") + " 打开来源页面</a></div>" +
              (p.attachmentUrl ? '<div class="source-row"><span>官方原文附件</span>' +
                '<a class="btn btn-sm" href="' + esc(p.attachmentUrl) + '" target="_blank" rel="noopener noreferrer">' + icon("download") + " 下载原文</a></div>" : "") +
              '<div class="verify-note">' + icon("info") +
                (p.auto_filled ? "本条由规则自动分类与字段填充（fill_source=" + esc(p.fill_source || "rule") + "），金额/材料/流程仍需人工核验后再发布。" : (ver ? "本条已于 " + ver.at + " 核验。" : "本条为整理初稿，核验时请替换为具体政策页面。")) +
                "</div>" +
            "</div></section>" +
          '<section class="band section-gap"><div class="band-head"><h2>' + icon("message-square-warning") + " 纠错 / 补充</h2></div>" +
            '<div class="band-body">' + correctionForm(p) + "</div></section>" +
        "</div>" +
      "</div>" +
      (related.length
        ? '<section class="band section-gap"><div class="band-head"><h2>' + icon("folder-open") + " 同分类政策</h2>" +
          '<a class="small" href="#/policies" data-action="cat-filter" data-cat="' + esc(p.category) + '">查看全部</a></div>' +
          '<div class="band-body"><div class="row-list">' + related.map(function (x) { return rowListItem(x, esc(x.category)); }).join("") + "</div></div></section>"
        : "")
    );
  }

  function fact(ic, label, value) {
    return '<div class="fact"><dt>' + icon(ic) + esc(label) + "</dt><dd>" + value + "</dd></div>";
  }

  function correctionForm(p) {
    return (
      '<form class="correction-form js-form" data-policy="' + esc(p.id) + '">' +
        '<div class="inline-form-grid">' +
          '<div class="field"><label for="corrType">问题类型</label>' +
            '<select id="corrType">' +
              '<option>内容错误</option><option>已过期 / 政策调整</option><option>补充信息</option><option>其他</option>' +
            "</select></div>" +
          '<div class="field"><label for="corrContact">联系方式（选填）</label>' +
            '<input id="corrContact" type="text" placeholder="邮箱或电话，方便跟进">' +
          "</div>" +
          '<div class="field full"><label for="corrDesc">请描述问题</label>' +
            '<textarea id="corrDesc" required placeholder="例如：申请材料新增了 XX 证明，链接已失效…"></textarea>' +
          "</div>" +
        "</div>" +
        '<div class="correction-actions"><button class="btn btn-primary" data-action="submit-correction" data-id="' + esc(p.id) + '">' +
          icon("send") + " 提交纠错</button></div>" +
      "</form>"
    );
  }

  /* ---------- quiz ---------- */

  var QUIZ = [
    // ---- 主问题（顺序作答）----
    {
      id: "city",
      title: "你所在的城市是？",
      region: true,
      options: []
    },
    {
      id: "work",
      title: "你现在的工作状态是？",
      options: [
        { label: "求职中 / 找工作中", tags: ["就业"] },
        { label: "在职上班", tags: ["就业"] },
        { label: "正在失业 / 待业", tags: ["失业"] },
        { label: "毕业 2 年内 / 应届生", tags: ["毕业生", "就业"] },
        { label: "想创业或已在创业", tags: ["创业", "就业"] },
        { label: "灵活就业 / 自由职业", tags: ["灵活就业", "就业"] },
        { label: "网约车 / 外卖 / 快递等新就业形态", tags: ["灵活就业"] },
        { label: "已退休或临近退休", tags: ["长者"] }
      ]
    },
    {
      id: "identity",
      title: "你的户籍和身份是？",
      options: [
        { label: "本市户籍", tags: [] },
        { label: "非本市户籍，想了解落户", tags: ["落户"] },
        { label: "高层次人才 / 博士后 / 急需紧缺人才", tags: ["人才"] },
        { label: "港澳台同胞 / 外籍人才", tags: ["人才"] },
        { label: "低保 / 困难家庭", tags: ["困难"] },
        { label: "非本市户籍，暂不考虑落户", tags: [] }
      ]
    },
    {
      id: "social",
      title: "你的社保缴纳情况是？",
      options: [
        { label: "单位帮我缴", tags: ["社保"] },
        { label: "自己以灵活就业身份缴", tags: ["社保", "灵活就业"] },
        { label: "还没有缴", tags: [] },
        { label: "不清楚", tags: [] }
      ]
    },
    {
      id: "housing",
      title: "你的住房情况是？",
      options: [
        { label: "租房居住", tags: ["租房"] },
        { label: "无房，想申请保障性住房", tags: ["住房"] },
        { label: "已有自有住房", tags: [] },
        { label: "正在考虑买房", tags: ["购房"] }
      ]
    },
    {
      id: "focus",
      title: "你最关心哪类事项？",
      options: [
        { label: "领补贴、省钱", tags: ["民生", "消费"] },
        { label: "人才政策与落户", tags: ["人才", "落户"] },
        { label: "住房保障（租房 / 保障房 / 买房）", tags: ["住房", "租房", "购房"] },
        { label: "医保、生育、就医报销", tags: ["医保", "生育"] },
        { label: "公积金提取与转移", tags: ["公积金"] },
        { label: "技能 / 学历提升", tags: ["技能", "学生"] },
        { label: "创业支持", tags: ["创业"] },
        { label: "老人、家庭、学生民生事项", tags: ["长者", "民生", "学生"] }
      ]
    },
    // ---- 动态追问（按答案触发，主问题答完后出现）----
    {
      id: "fq-difficult",
      title: "你是否属于就业困难人员？",
      desc: "如 4050 人员、登记失业 1 年以上、低保家庭等",
      options: [
        { label: "是", tags: ["就业困难", "失业", "困难"] },
        { label: "否", tags: [] }
      ],
      when: function (a) { return a.work === 2; }
    },
    {
      id: "fq-grad",
      title: "你毕业多久了？",
      options: [
        { label: "1 年内", tags: ["毕业生"] },
        { label: "2 年内", tags: ["毕业生"] },
        { label: "3 年以上", tags: [] }
      ],
      when: function (a) { return a.work === 3; }
    },
    {
      id: "fq-startup",
      title: "你的创业处于什么阶段？",
      options: [
        { label: "已注册公司 / 个体户", tags: ["创业"] },
        { label: "筹备中", tags: ["创业"] },
        { label: "刚有想法", tags: [] }
      ],
      when: function (a) { return a.work === 4; }
    },
    {
      id: "fq-talent",
      title: "你属于哪类人才？",
      options: [
        { label: "高层次人才 / 领军人才", tags: ["人才"] },
        { label: "博士后 / 博士", tags: ["人才"] },
        { label: "技能人才 / 技师", tags: ["技能"] },
        { label: "青年人才 / 应届毕业生", tags: ["人才", "毕业生"] }
      ],
      when: function (a) { return a.identity === 2 || a.identity === 3; }
    },
    {
      id: "fq-subsidy",
      title: "你想领哪类补贴？",
      options: [
        { label: "就业 / 社保类补贴", tags: ["就业", "社保"] },
        { label: "购车 / 以旧换新", tags: ["消费"] },
        { label: "租房 / 住房类", tags: ["租房", "住房"] },
        { label: "教育 / 培训类", tags: ["技能", "学生"] }
      ],
      when: function (a) { return a.focus === 0; }
    },
    {
      id: "fq-district",
      title: "你是否在黄埔、南沙、白云等区工作或居住？",
      desc: "这些区有区级人才 / 产业补贴",
      options: [
        { label: "是", tags: ["区级"] },
        { label: "否", tags: [] }
      ],
      when: function (a) {
        var c = a.city;
        return !!(c && (c.city || "").indexOf("广州") === 0);
      }
    }
  ];

  var QUIZ_MAIN = 6; // 前 6 题为主问题（city/work/identity/social/housing/focus），其后为动态追问

  function quizAnsweredCount() {
    var n = 0;
    for (var i = 0; i < QUIZ.length; i++) {
      var q = QUIZ[i];
      if (q.region) { if (quizAnswers[q.id] && quizAnswers[q.id].city) n++; }
      else if (quizAnswers[q.id] !== undefined) n++;
    }
    return n;
  }

  function quizIsAnswered(q) {
    if (!q) return false;
    return q.region ? !!(quizAnswers[q.id] && quizAnswers[q.id].city) : quizAnswers[q.id] !== undefined;
  }

  function quizMainDone() {
    for (var i = 0; i < QUIZ_MAIN; i++) {
      if (!quizIsAnswered(QUIZ[i])) return false;
    }
    return true;
  }

  // 下一题索引：主问题按顺序；主问题答完后按 when 规则找第一个未答的追问；无则 -1（完成）
  function quizNextIndex() {
    if (!quizMainDone()) {
      for (var i = 0; i < QUIZ_MAIN; i++) {
        if (!quizIsAnswered(QUIZ[i])) return i;
      }
    }
    for (var i = QUIZ_MAIN; i < QUIZ.length; i++) {
      var q = QUIZ[i];
      if (quizIsAnswered(q)) continue;
      if (q.when && q.when(quizAnswers)) return i;
    }
    return -1;
  }

  // 当前路径总题数（主问题 + 按当前答案会触发的追问数），用于进度条
  function quizTotalSteps() {
    var n = QUIZ_MAIN;
    for (var i = QUIZ_MAIN; i < QUIZ.length; i++) {
      if (QUIZ[i].when && QUIZ[i].when(quizAnswers)) n++;
    }
    return n;
  }

  function cityNameToCode(name) {
    if (!name) return null;
    for (var k in CITY_NAMES) {
      if (CITY_NAMES[k] === name || name.indexOf(CITY_NAMES[k]) === 0) return k;
    }
    return null;
  }

  function scorePolicies() {
    var tags = [];
    Object.keys(quizAnswers).forEach(function (k) {
      var q = QUIZ.filter(function (x) { return x.id === k; })[0];
      if (!q) return;
      // 追问题仅当触发条件仍满足时计入（防残留答案污染推荐）
      if (QUIZ.indexOf(q) >= QUIZ_MAIN && q.when && !q.when(quizAnswers)) return;
      var opt = q.options ? q.options[quizAnswers[k]] : null;
      (opt ? opt.tags || [] : []).forEach(function (t) { if (tags.indexOf(t) < 0) tags.push(t); });
    });
    var cityAns = quizAnswers.city;
    var cityCode = cityAns ? cityNameToCode(cityAns.city) : null;
    return POLICIES.map(function (p) {
      var matched = (p.tags || []).filter(function (t) { return tags.indexOf(t) >= 0; });
      var cityMatch = !!cityCode && p.city === cityCode;
      return { p: p, score: matched.length + (cityMatch ? 3 : 0), matched: matched, cityMatch: cityMatch };
    }).filter(function (r) { return r.score > 0 && r.matched.length > 0 && r.p.status !== "已废止"; })
      .sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        var da = parseDeadline(a.p), db = parseDeadline(b.p);
        if (!da && db) return 1;
        if (da && !db) return -1;
        if (da && db) return da - db;
        return String(a.p.title).localeCompare(String(b.p.title), "zh");
      });
  }

  function regionSelectHtml() {
    var saved = quizAnswers.city || {};
    var provs = Object.keys(window.CHINA_REGIONS || {});
    var provOptions = ['<option value="">请选择省份</option>'].concat(provs.map(function (p) {
      return '<option value="' + esc(p) + '"' + (saved.province === p ? " selected" : "") + ">" + esc(p) + "</option>";
    })).join("");
    var cities = saved.province ? (window.CHINA_REGIONS[saved.province] || []) : [];
    var cityOptions = ['<option value="">' + (saved.province ? "请选择城市" : "请先选择省份") + "</option>"].concat(cities.map(function (c) {
      return '<option value="' + esc(c) + '"' + (saved.city === c ? " selected" : "") + ">" + esc(c) + "</option>";
    })).join("");
    return (
      '<div class="region-selects">' +
        '<div class="field"><label for="quizProvince">省份 / 直辖市 / 自治区 / 特别行政区</label>' +
          '<select id="quizProvince" class="quiz-region-input">' + provOptions + "</select></div>" +
        '<div class="field"><label for="quizCity">城市</label>' +
          '<select id="quizCity" class="quiz-region-input"' + (saved.province ? "" : " disabled") + ">" + cityOptions + "</select></div>" +
      "</div>"
    );
  }

  function quizOptionButton(opt, index) {
    var answer = quizAnswers[QUIZ[quizStep].id];
    var selected = answer !== undefined && answer !== null && answer === index;
    return '<button class="quiz-option' + (selected ? " selected" : "") + '" data-action="quiz-option" data-index="' + index + '">' +
      '<span class="opt-mark">' + (selected ? icon("check") : "") + "</span>" + esc(opt.label) + "</button>";
  }

  function renderQuiz() {
    if (quizResults) return renderQuizResult();
    var q = QUIZ[quizStep];
    var answered = quizIsAnswered(q);
    var total = quizTotalSteps();
    var done = quizAnsweredCount();
    var progress = Math.round((done / total) * 100);
    var isLast = quizNextIndex() === -1;
    var stepNo = Math.min(done + (answered ? 0 : 1), total);
    return (
      '<div class="quiz-shell">' +
        '<div class="page-head"><div><span class="eyebrow">' + icon("circle-help") + " 条件自测</span>" +
          "<h1>测一测你能办哪些</h1><p>先选城市，再回答几个问题，系统会按匹配度给你推荐政策，并给出办理顺序。</p></div></div>" +
        '<div class="band"><div class="band-body">' +
          '<div class="quiz-progress"><div class="quiz-progress-fill" style="width:' + progress + '%"></div></div>' +
          '<div class="quiz-question">' +
            '<span class="eyebrow">第 ' + stepNo + " / " + total + " 题</span>" +
            "<h2>" + esc(q.title) + "</h2>" +
            (q.desc ? '<p class="muted">' + esc(q.desc) + "</p>" : "") +
          "</div>" +
          (q.region ? regionSelectHtml() : '<div class="quiz-options">' + q.options.map(function (opt, i) { return quizOptionButton(opt, i); }).join("") + "</div>") +
          '<div class="quiz-nav">' +
            (quizStep > 0 ? '<button class="btn" data-action="quiz-prev">' + icon("arrow-left") + " 上一步</button>" : "<span></span>") +
            '<button class="btn btn-primary" data-action="' + (isLast ? "quiz-complete" : "quiz-next") + '"' + (answered ? "" : " disabled") + ">" +
              (isLast ? icon("sparkles") + " 查看结果" : "下一步 " + icon("arrow-right")) +
            "</button>" +
          "</div>" +
        "</div></div>" +
      "</div>"
    );
  }

  function renderQuizResult() {
    guideMarkStep("2");
    var results = quizResults || scorePolicies();
    var top = results.slice(0, 8);
    var matchedCount = results.length;
    return (
      '<div class="quiz-shell">' +
        '<div class="page-head"><div><span class="eyebrow">' + icon("sparkles") + " 自测结果</span>" +
          "<h1>根据你的情况，推荐这些事项</h1>" +
          "<p>所在城市：" + esc((quizAnswers.city || {}).city || "未选择") + " · 匹配 " + matchedCount + " 条政策，先办“快截止 + 匹配度最高”的。</p></div>" +
          '<div class="detail-actions"><button class="btn" data-action="quiz-restart">' + icon("rotate-ccw") + " 重新自测</button></div></div>" +
      '<div class="band">' +
        (top.length ?
          '<div class="result-summary">' + icon("badge-check") +
            "建议按下面的顺序查看：先处理即将到期的补贴，再办理与身份相关的落户、社保和住房事项。</div>" +
          '<div class="row-list">' + top.map(function (r, i) {
            return '<div class="match-row"><span class="match-rank">' + (i + 1) + "</span>" +
              '<div class="match-main"><a href="#/policy/' + esc(r.p.id) + '">' + esc(r.p.title) + "</a>" +
              '<div class="match-reason">' + (r.cityMatch ? "本市政策 · " : "") + "匹配：" + esc(r.matched.join("、")) + " · " + esc(r.p.category) + "</div></div>" +
              '<span class="policy-actions">' +
                '<button class="btn btn-sm" data-action="open-policy" data-id="' + esc(r.p.id) + '">' + icon("eye") + " 详情</button>" +
                '<button class="btn btn-sm" data-action="toggle-select" data-id="' + esc(r.p.id) + '">' + icon("plus") + " 加入</button>" +
              "</span></div>";
          }).join("") + "</div>" +
          '<div class="band-body"><button class="btn btn-block" data-action="add-results">' + icon("clipboard-list") + " 把推荐事项全部加入清单</button></div>"
          : emptyState("没有匹配到政策，试试换个答案或直接浏览政策库",
            '<a class="btn btn-sm" href="#/policies">' + icon("file-text") + " 浏览全部政策</a>")) +
      "</div></div>"
    );
  }

  /* ---------- checklist ---------- */

  function buildChecklistText() {
    var selected = getSelectedPolicies();
    var lines = [];
    lines.push("穗易办 · 我的办理清单");
    lines.push("生成时间：" + new Date().toLocaleString("zh-CN"));
    lines.push("");
    selected.forEach(function (p, i) {
      lines.push((i + 1) + ". " + p.title + "（" + p.category + "）");
      lines.push("   条件：" + (p.audience || []).join("、"));
      lines.push("   标准：" + (p.amount || "不涉及"));
      lines.push("   截止：" + p.deadline);
      lines.push("   材料：" + (p.materials || []).join("、"));
      lines.push("   渠道：" + (p.channels || []).map(function (c) { return c.name + "（" + c.detail + "）"; }).join("；"));
      lines.push("");
    });
    lines.push("提示：以上为整理初稿，办理前请以官方最新要求为准，并在核验台确认数据状态。");
    return lines.join("\n");
  }

  function renderChecklist() {
    var selected = getSelectedPolicies();
    var allMaterials = [];
    var channels = {};
    selected.forEach(function (p) {
      (p.materials || []).forEach(function (m) { if (allMaterials.indexOf(m) < 0) allMaterials.push(m); });
      (p.channels || []).forEach(function (c) { channels[c.name] = true; });
    });
    var done = doneMaterials();

    var body = "";
    if (!selected.length) {
      body = '<div class="band"><div class="band-body">' + emptyState("清单还是空的，先去政策库或自测里添加") +
        '<p style="text-align:center"><a class="btn" href="#/policies">' + icon("file-text") + " 去政策库</a></p></div></div>";
    } else if (clView === "material") {
      body = '<div class="checklist-sections"><div class="cl-section"><div class="cl-section-head"><h3>全部材料（去重）</h3>' +
        '<span class="count">' + allMaterials.length + " 项</span></div><div class=\"cl-body\">" +
        allMaterials.map(function (m) {
          var key = "dedup::" + m;
          var checked = done.indexOf(key) >= 0;
          return '<label class="check-item ' + (checked ? "done" : "") + '"><input type="checkbox" class="js-material" data-key="' + esc(key) + '"' + (checked ? " checked" : "") + "><span>" + esc(m) + "</span></label>";
        }).join("") + "</div></div></div>";
    } else {
      body = '<div class="checklist-sections">' + selected.map(function (p) {
        return '<div class="cl-section"><div class="cl-section-head"><h3>' + esc(p.title) + "</h3>" +
          '<span class="count">' + (p.materials || []).length + " 项材料</span></div>" +
          '<div class="cl-body">' +
            (p.materials || []).map(function (m) {
              var key = materialKey(p, m);
              var checked = done.indexOf(key) >= 0;
              return '<label class="check-item ' + (checked ? "done" : "") + '"><input type="checkbox" class="js-material" data-key="' + esc(key) + '"' + (checked ? " checked" : "") + "><span>" + esc(m) + "</span></label>";
            }).join("") +
            '<div class="channel-row">' + icon("building-2") + "<div><strong>办理渠道</strong><span>" +
              esc((p.channels || []).map(function (c) { return c.name + "：" + c.detail; }).join("；")) +
            "</span></div></div>" +
          "</div></div>";
      }).join("") + "</div>";
    }

    return (
      '<div class="page-head"><div><span class="eyebrow">' + icon("clipboard-list") + " 清单生成</span>" +
        "<h1>我的办理清单</h1><p>把要办的事项整理成一份材料清单，可以复制、下载或打印。</p></div>" +
        '<div class="checklist-toolbar">' +
          '<button class="btn ' + (clView === "policy" ? "btn-primary" : "") + '" data-action="cl-view" data-view="policy">' + icon("list") + " 按政策</button>" +
          '<button class="btn ' + (clView === "material" ? "btn-primary" : "") + '" data-action="cl-view" data-view="material">' + icon("layers") + " 按材料</button>" +
          '<button class="btn" data-action="checklist-copy">' + icon("copy") + " 复制文本</button>" +
          '<button class="btn" data-action="checklist-download">' + icon("download") + " 下载 TXT</button>" +
          '<button class="btn" data-action="checklist-print">' + icon("printer") + " 打印</button>" +
        "</div></div>" +
      '<div class="selected-summary">' +
        "<div><span class=\"num\">" + selected.length + '</span><span class="label">条政策</span></div>' +
        "<div><span class=\"num\">" + allMaterials.length + '</span><span class="label">项材料（去重）</span></div>' +
        "<div><span class=\"num\">" + Object.keys(channels).length + '</span><span class="label">个办理渠道</span></div>' +
      "</div>" +
      (selected.length ? '<div class="checklist-meta">材料清单为整理初稿，最终以受理部门最新要求为准。</div>' : "") +
      body
    );
  }

  /* ---------- calendar ---------- */

  function monthEvents(year, month) {
    var map = {};
    POLICIES.forEach(function (p) {
      var d = calMode === "publish" ? parseDateStr(p.publishDate) : parseDeadline(p);
      if (d && d.getFullYear() === year && d.getMonth() === month) {
        var key = d.getDate();
        if (!map[key]) map[key] = [];
        map[key].push(p);
      }
    });
    return map;
  }

  function parseDateStr(s) {
    if (!s) return null;
    var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d.getTime()) ? null : d;
  }

  /* ---------- radar & compare ---------- */

  function radarItems() {
    return POLICIES.slice().sort(function (a, b) {
      return String(b.publishDate || b.publish_date || b.updatedAt || "").localeCompare(String(a.publishDate || a.publish_date || a.updatedAt || ""));
    }).slice(0, radarLimit);
  }

  function renderRadar() {
    var items = radarItems();
    var autoDeadline = POLICIES.filter(function (p) { return p.deadline && p.deadline !== "长期有效"; }).length;
    var verified = POLICIES.filter(function (p) { return p.verifiedAt || p.verified_at; }).length;
    var published30 = POLICIES.filter(function (p) {
      var d = String(p.publishDate || p.publish_date || "");
      return d && d >= "2026-07-01";
    }).length;
    var rows = items.map(function (p) {
      return '<div class="row-list-item">' +
        '<span class="icon-tile">' + icon(p.attachmentUrl || p.attachment_url ? "file-down" : "file-text") + "</span>" +
        '<div class="row-list-main"><a href="#/policy/' + esc(p.id) + '">' + esc(p.title) + "</a>" +
        '<div class="row-list-meta">' + esc(p.source || "未知来源") + " · " + esc(p.publishDate || p.publish_date || p.updatedAt || "") + " · " + esc(p.category) + "</div></div>" +
        (p.deadline && p.deadline !== "长期有效" ? '<span class="badge badge-deadline">' + icon("calendar-clock") + " 截止 " + esc(p.deadline) + "</span>" : "") +
      "</div>";
    }).join("");
    return (
      '<div class="page-head"><div><span class="eyebrow">' + icon("radar") + " 政策变化雷达</span>" +
        "<h1>政策变化雷达</h1><p>追踪最新发布、自动提取的截止日和核验进展；正式版接入后端后，这里会显示政策原文 diff。</p></div>" +
        '<div class="checklist-toolbar"><button class="btn" data-action="radar-export">' + icon("download") + " 导出变化摘要</button></div></div>" +
      '<div class="home-stats band" style="grid-template-columns:repeat(4,1fr)">' +
        radarStatBox(POLICIES.length, "政策总量") + radarStatBox(published30, "近30天发布") +
        radarStatBox(autoDeadline, "已提取截止日") + radarStatBox(verified, "已核验") +
      "</div>" +
      '<section class="band section-gap"><div class="band-head"><h2>' + icon("activity") + " 最新变化</h2>" +
        '<span class="small">最近 ' + items.length + " 条（按发布日期排序）</span></div>" +
        (rows ? '<div class="row-list">' + rows + "</div>" : emptyState("暂无变化记录")) +
      "</section>" +
      '<section class="band section-gap subscribe-band">' +
        '<form class="subscribe-form js-form">' +
          "<h3>" + icon("bell-ring") + " 订阅变化提醒</h3>" +
          '<div class="inline-form-grid">' +
            '<div class="field"><label for="subName">称呼（选填）</label><input id="subName" type="text" placeholder="怎么称呼你"></div>' +
            '<div class="field"><label for="subEmail">邮箱</label><input id="subEmail" type="email" required placeholder="you@example.com"></div>' +
          "</div>" +
          '<div class="field"><label>关注类别</label><div class="interest-chips">' +
            ["补贴", "落户", "住房", "医保", "公积金", "截止提醒"].map(function (it) {
              return '<button type="button" class="chip" data-action="interest-toggle" data-value="' + esc(it) + '">' + esc(it) + "</button>";
            }).join("") +
          "</div></div>" +
          '<button class="btn btn-primary" data-action="subscribe">' + icon("send") + " 订阅提醒</button>" +
        "</form>" +
        '<div class="subscribe-note"><h3>说明</h3><p>当前变化流基于发布/更新日期生成，属于演示版；正式版由后端每日采集并生成真实 diff，再通过邮件或公众号推送。</p></div>' +
      "</section>"
    );
  }

  function radarStatBox(num, label) {
    return '<div class="home-stat"><span class="num">' + num + '</span><span class="label">' + esc(label) + "</span></div>";
  }

  function buildRadarText() {
    var lines = ["穗易办 · 政策变化摘要", "生成时间：" + new Date().toLocaleString("zh-CN"), ""];
    radarItems().forEach(function (p, i) {
      lines.push((i + 1) + ". " + p.title);
      lines.push("   来源：" + (p.source || "") + " | 发布：" + (p.publishDate || p.publish_date || p.updatedAt || "") + " | 分类：" + p.category);
      if (p.deadline && p.deadline !== "长期有效") lines.push("   截止：" + p.deadline);
      if (p.attachmentUrl || p.attachment_url) lines.push("   原文：" + (p.attachmentUrl || p.attachment_url));
    });
    lines.push("");
    lines.push("提示：本摘要由整理初稿生成，正式版将包含政策原文变更 diff。");
    return lines.join("\n");
  }

  function compareRows(a, b) {
    var fields = [
      ["分类", "category", "category"],
      ["城市", "city", "city"],
      ["适用人群", "audience", "audience"],
      ["补贴 / 标准", "amount", "amount"],
      ["截止时间", "deadline", "deadline"],
      ["发文部门", "source", "source"],
      ["发布日期", "publishDate", "publish_date"],
      ["文号", "documentNumber", "document_number"],
      ["材料清单", "materials", "materials"],
      ["办理渠道", "channels", "channels"]
    ];
    return fields.map(function (f) {
      var va = fmtCompare(a, f[1], f[2]);
      var vb = fmtCompare(b, f[1], f[2]);
      return { label: f[0], a: va, b: vb, diff: va !== vb };
    });
  }

  function fmtCompare(p, cKey, sKey) {
    var v = p[cKey] != null && p[cKey] !== "" ? p[cKey] : p[sKey];
    if (Array.isArray(v)) return v.join("、");
    if (v === null || v === undefined || v === "") return "—";
    return String(v);
  }

  function renderCompare() {
    var opts = function (selected) {
      return ['<option value="">请选择政策</option>'].concat(POLICIES.map(function (p) {
        return '<option value="' + esc(p.id) + '"' + (selected === p.id ? " selected" : "") + ">" + esc(p.title.slice(0, 38)) + "</option>";
      })).join("");
    };
    var a = POLICIES.filter(function (p) { return p.id === compareAId; })[0];
    var b = POLICIES.filter(function (p) { return p.id === compareBId; })[0];
    var rows = a && b ? compareRows(a, b) : [];
    var preset = [
      ["黄埔 vs 南沙 · 人才补贴", "gz-huangpu-new-resident", "gz-nansha-key-talent"],
      ["广州灵活就业 vs 上海就业见习", "gz-flexible-subsidy", "sh-rsj-https-rsj-sh-gov-cn-tgsgg_17341-20260706-t0035_1442120-html"]
    ];
    var presetHtml = preset.map(function (pr) {
      return '<button class="btn btn-sm" data-action="compare-preset" data-a="' + esc(pr[1]) + '" data-b="' + esc(pr[2]) + '">' + icon("git-compare") + " " + esc(pr[0]) + "</button>";
    }).join("");
    return (
      '<div class="page-head"><div><span class="eyebrow">' + icon("git-compare") + " 政策对比</span>" +
        "<h1>跨区 / 同主题对比</h1><p>选择两条政策，逐项对比适用人群、标准、截止时间和材料清单，差异项会高亮。</p></div>" +
        '<div class="checklist-toolbar">' + presetHtml +
          '<button class="btn" data-action="compare-copy">' + icon("copy") + " 复制对比</button></div></div>" +
      '<div class="band"><div class="band-body">' +
        '<div class="inline-form-grid">' +
          '<div class="field"><label for="compareA">政策 A</label><select id="compareA">' + opts(compareAId) + "</select></div>" +
          '<div class="field"><label for="compareB">政策 B</label><select id="compareB">' + opts(compareBId) + "</select></div>" +
        "</div>" +
        (rows.length ?
          '<div class="compare-table-wrap"><table class="compare-table">' +
            "<thead><tr><th>对比项</th><th>政策 A</th><th>政策 B</th></tr></thead><tbody>" +
            rows.map(function (r) {
              return '<tr class="' + (r.diff ? "diff-row" : "") + '"><td>' + esc(r.label) + "</td><td>" + esc(r.a) + "</td><td>" + esc(r.b) + "</td></tr>";
            }).join("") +
          "</tbody></table></div>"
          : emptyState("请先选择两条政策；也可以点击上方预设对比")) +
      "</div></div>"
    );
  }

  function buildCompareText() {
    var a = POLICIES.filter(function (p) { return p.id === compareAId; })[0];
    var b = POLICIES.filter(function (p) { return p.id === compareBId; })[0];
    if (!a || !b) return "请先选择两条政策";
    var lines = ["穗易办 · 政策对比", "A：" + a.title, "B：" + b.title, ""];
    compareRows(a, b).forEach(function (r) {
      lines.push(r.label + "：" + (r.diff ? "（不同）" : ""));
      lines.push("  A：" + r.a);
      lines.push("  B：" + r.b);
    });
    return lines.join("\n");
  }

  function renderCalendar() {
    var year = calYear, month = calMonth;
    var first = new Date(year, month, 1);
    var mondayIndex = (first.getDay() + 6) % 7;
    var start = new Date(year, month, 1 - mondayIndex);
    var today = new Date();
    var events = monthEvents(year, month);
    var dows = ["一", "二", "三", "四", "五", "六", "日"];

    var cells = [];
    for (var i = 0; i < 42; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var inMonth = d.getMonth() === month;
      var isToday = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
      var evs = events[d.getDate()] || [];
      cells.push(
        '<div class="cal-cell' + (inMonth ? "" : " other-month") + (isToday ? " today" : "") + (evs.length ? " has-events" : "") + '">' +
          '<span class="cal-day">' + d.getDate() + "</span>" +
          evs.slice(0, 3).map(function (p) {
            return '<a class="cal-event' + (p.status === "待核验" ? " pending" : "") + '" href="#/policy/' + esc(p.id) + '" title="' + esc(p.title) + " · " + esc(calMode === "publish" ? (p.publishDate || "") : p.deadline) + '">' + esc(p.title) + "</a>";
          }).join("") +
          (evs.length > 3 ? '<span class="cal-event pending">+' + (evs.length - 3) + " 更多</span>" : "") +
        "</div>"
      );
    }

    var interests = ["补贴", "落户", "住房", "医保", "公积金"];
    var modeLabel = calMode === "publish" ? "政策发布日期" : "补贴与办事截止日";
    var modeDesc = calMode === "publish"
      ? "按官方发布日期查看政策动态，追踪新政策落地。"
      : "按月查看可申请、即将截止的事项，避免错过申报窗口。";
    return (
      '<div class="page-head"><div><span class="eyebrow">' + icon("calendar-days") + " 政策日历</span>" +
        "<h1>" + (calMode === "publish" ? "政策发布日历" : "补贴与办事截止日历") + "</h1><p>" + modeDesc + "</p></div></div>" +
      '<div class="band"><div class="band-head calendar-head">' +
        '<div class="cal-mode-switch">' +
          '<button class="btn btn-sm' + (calMode === "deadline" ? " btn-primary" : "") + '" data-action="cal-mode-deadline">' + icon("calendar-clock") + " 截止日</button>" +
          '<button class="btn btn-sm' + (calMode === "publish" ? " btn-primary" : "") + '" data-action="cal-mode-publish">' + icon("calendar-plus") + " 发布日期</button>" +
        "</div>" +
        '<h2>' + icon("calendar-days") + " " + year + " 年 " + (month + 1) + " 月</h2>" +
        '<div class="calendar-nav">' +
          '<button class="icon-btn" data-action="cal-prev" aria-label="上个月">' + icon("chevron-left") + "</button>" +
          '<span class="month-label">' + year + "-" + String(month + 1).padStart(2, "0") + "</span>" +
          '<button class="icon-btn" data-action="cal-next" aria-label="下个月">' + icon("chevron-right") + "</button>" +
        "</div>" +
      "</div>" +
      '<div class="band-body">' +
        '<div class="calendar-grid">' +
          dows.map(function (d) { return '<div class="cal-dow">' + d + "</div>"; }).join("") + cells.join("") +
        "</div>" +
        '<div class="cal-legend"><span><i></i>有截止事项</span><span><i class="pending"></i>待核验</span><span>' + icon("info") + " 点击事项可看详情</span></div>" +
      "</div></div>" +
      '<section class="band subscribe-band">' +
        '<form class="subscribe-form js-form">' +
          "<h3>" + icon("bell-ring") + " 订阅截止提醒</h3>" +
          '<div class="inline-form-grid">' +
            '<div class="field"><label for="subName">称呼（选填）</label><input id="subName" type="text" placeholder="怎么称呼你"></div>' +
            '<div class="field"><label for="subEmail">邮箱</label><input id="subEmail" type="email" required placeholder="you@example.com"></div>' +
          "</div>" +
          '<div class="field"><label>关注类别</label><div class="interest-chips">' +
            interests.map(function (it) {
              return '<button type="button" class="chip" data-action="interest-toggle" data-value="' + esc(it) + '">' + esc(it) + "</button>";
            }).join("") +
          "</div></div>" +
          '<button class="btn btn-primary" data-action="subscribe">' + icon("send") + " 订阅提醒</button>" +
        "</form>" +
        '<div class="subscribe-note">' +
          "<h3>订阅后你会收到什么？</h3>" +
          "<p>每月一次：当月可申请事项、即将截止的补贴、政策更新摘要。演示版把订阅记录保存在本机浏览器中，正式上线时接入邮件服务即可发送。</p>" +
          "<p>" + icon("alert-triangle") + " 日历中的日期均为整理初稿，上线前需要逐条核对官方公告。</p>" +
        "</div>" +
      "</section>"
    );
  }

  /* ---------- workspace ---------- */

  function renderWorkspace() {
    var tabs = [
      { id: "verify", label: "数据核验", ic: "shield-check" },
      { id: "stats", label: "本地统计", ic: "bar-chart-3" },
      { id: "inbox", label: "提交记录", ic: "inbox" }
    ];
    var body = "";
    if (wsTab === "verify") body = wsVerify();
    else if (wsTab === "stats") body = wsStats();
    else body = wsInbox();

    return (
      '<div class="page-head"><div><span class="eyebrow">' + icon("settings-2") + " 维护工作台</span>" +
        "<h1>核验台</h1><p>给内容维护者使用：逐条核对官方来源、看用户使用数据、处理纠错提交。</p></div></div>" +
      '<div class="ws-tabs" role="tablist">' +
        tabs.map(function (t) {
          return '<button class="ws-tab' + (wsTab === t.id ? " active" : "") + '" data-action="ws-tab" data-tab="' + t.id + '">' +
            icon(t.ic) + " " + t.label + "</button>";
        }).join("") +
      "</div>" + body
    );
  }

  function wsVerify() {
    var ver = verifications();
    var total = POLICIES.length;
    var done = Object.keys(ver).length;
    var pct = total ? Math.round((done / total) * 100) : 0;
    var rows = POLICIES.map(function (p) {
      var v = ver[p.id];
      var url = v && v.url ? v.url : p.sourceUrl;
      return (
        '<div class="ws-row' + (v ? " verified" : "") + '">' +
          '<div class="ws-row-title">' + esc(p.title) +
            '<span class="source">' + esc(p.source) + " · " + esc(p.category) + "</span></div>" +
          '<div class="ws-url"><input class="ws-url-input" type="url" value="' + esc(url) + '" placeholder="官方政策页 URL" aria-label="官方来源链接"></div>' +
          '<div class="ws-actions">' +
            (v ? '<span class="badge badge-status-valid">' + icon("badge-check") + " 已核验 " + esc(v.at) + "</span>" : "") +
            (v ?
              '<button class="btn btn-sm btn-danger" data-action="unverify" data-id="' + esc(p.id) + '">' + icon("rotate-ccw") + " 撤销</button>"
              :
              '<button class="btn btn-sm" data-action="verify" data-id="' + esc(p.id) + '" data-by="本人">' + icon("check") + " 本人核验</button>" +
              '<button class="btn btn-sm" data-action="verify" data-id="' + esc(p.id) + '" data-by="复核人">' + icon("user-check") + " 复核人核验</button>") +
          "</div>" +
        "</div>"
      );
    }).join("");

    return (
      '<div class="progress-wrap"><div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
        '<span class="progress-text">' + done + " / " + total + " 已核验</span></div>" +
      '<div class="band section-gap"><div class="band-head"><h2>' + icon("shield-check") + " 逐条核验</h2>" +
        '<div class="checklist-toolbar"><button class="btn btn-sm" data-action="export-csv" data-kind="pending">' + icon("download") + " 导出待核验 CSV</button></div></div>" +
        '<div class="ws-table-wrap"><div class="ws-table-head"><span>政策</span><span>官方来源 URL</span><span>核验操作</span><span></span></div>' + rows + "</div>" +
        '<div class="band-body verify-note">' + icon("info") +
          "核验标准：打开官方来源页，确认金额、条件、材料、截止时间与页面一致；如链接是部门首页，请替换为具体政策页。先完成 20 条双人核验即可对外发布 v0.1.6 验证版。</div>" +
      "</div>"
    );
  }

  function wsStats() {
    var events = readJSON(KEYS.events, []);
    function count(prefix) {
      return events.filter(function (ev) { return ev.e.indexOf(prefix) === 0; }).length;
    }
    var views = count("view_");
    var checklist = count("checklist_");
    var corrections = count("correction_");
    var subs = count("subscribe");
    var quizzes = count("quiz_");
    var verifies = count("verify");
    var recent = events.slice(-30).reverse();

    return (
      '<div class="stat-grid">' +
        statItem("eye", views, "页面浏览") +
        statItem("clipboard-list", checklist, "清单操作") +
        statItem("message-square-warning", corrections, "纠错提交") +
        statItem("bell-ring", subs, "订阅数") +
        statItem("sparkles", quizzes, "自测完成") +
        statItem("shield-check", verifies, "核验操作") +
      "</div>" +
      '<div class="band"><div class="band-head"><h2>' + icon("activity") + " 最近事件</h2>" +
        '<div class="checklist-toolbar">' +
          '<button class="btn btn-sm" data-action="export-csv" data-kind="events">' + icon("download") + " 导出 CSV</button>" +
          '<button class="btn btn-sm btn-danger" data-action="clear-events">' + icon("trash-2") + " 清空记录</button>" +
        "</div></div>" +
        '<div class="event-list">' +
          (recent.length ? recent.map(function (ev) {
            return '<div class="event-row"><span class="time">' + fmtDate(ev.t) + " " + new Date(ev.t).toTimeString().slice(0, 8) + "</span>" +
              '<span class="event">' + esc(ev.e) + "</span><span class=\"muted\">" + esc(JSON.stringify(ev.p)) + "</span></div>";
          }).join("") : emptyState("还没有事件记录")) +
        "</div>" +
        '<div class="band-body verify-note">' + icon("info") +
          "演示版统计保存在本机浏览器 localStorage；正式上线时替换为百度统计、Umami 或自建埋点即可。</div>" +
      "</div>"
    );
  }

  function statItem(ic, num, label) {
    return '<div class="stat-item"><span class="icon-tile">' + icon(ic) + "</span>" +
      "<div><div class=\"num\">" + num + '</div><div class="label">' + esc(label) + "</div></div></div>";
  }

  function wsInbox() {
    var items = readJSON(KEYS.corrections, []);
    return (
      '<div class="band"><div class="band-head"><h2>' + icon("inbox") + " 纠错与补充提交</h2>" +
        '<div class="checklist-toolbar"><button class="btn btn-sm" data-action="export-csv" data-kind="corrections">' + icon("download") + " 导出 CSV</button></div></div>" +
        (items.length ? items.slice().reverse().map(function (c) {
          return '<div class="correction-item"><div class="top"><strong>' + esc(c.policyTitle || "全局") + "</strong>" +
            (c.handled ?
              '<button class="btn btn-sm" data-action="mark-correction" data-id="' + esc(c.id) + '">' + icon("check") + " 已处理</button>"
              :
              '<button class="btn btn-sm" data-action="mark-correction" data-id="' + esc(c.id) + '">' + icon("circle-check") + " 标记已处理</button>") +
          "</div>" +
          '<div class="desc">' + esc(c.desc) + "</div>" +
          '<div class="meta">' + esc(c.type) + " · " + esc(c.contact || "未留联系方式") + " · " + fmtDate(c.createdAt) + "</div></div>";
        }).join("") : emptyState("还没有纠错提交")) +
      "</div>"
    );
  }

  /* ---------- router ---------- */

  function currentRouteName() {
    var parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    return parts[0] || "home";
  }

  function render() {
    var parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    var name = parts[0] || "home";
    currentRoute = name;
    var html = "";
    if (name === "policies") html = renderPolicies();
    else if (name === "policy" && parts[1]) html = renderDetail(parts[1]);
    else if (name === "quiz") html = renderQuiz();
    else if (name === "checklist") html = renderChecklist();
    else if (name === "calendar") html = renderCalendar();
    else if (name === "radar") html = renderRadar();
    else if (name === "compare") html = renderCompare();
    else if (name === "workspace") html = renderWorkspace();
    else html = renderHome();

    var app = document.getElementById("app");
    app.innerHTML = html;
    window.scrollTo(0, 0);
    refreshNav();
    refreshCount();
    refreshIcons();

    // 页面标题跟随路由
    var titles = {
      home: "穗易办 · 全国补贴办事指南",
      policies: "政策库 · 穗易办",
      policy: "政策详情 · 穗易办",
      quiz: "条件自测 · 穗易办",
      checklist: "清单生成 · 穗易办",
      calendar: "政策日历 · 穗易办",
      radar: "变化雷达 · 穗易办",
      compare: "政策对比 · 穗易办",
      workspace: "核验台 · 穗易办"
    };
    document.title = titles[name] || titles.home;

    if (name === "calendar") guideMarkStep("4");
    if (name === "policy" && parts[1]) track("view_detail", { id: parts[1] });
    else track("view_" + (name === "" ? "home" : name), {});
  }

  /* ---------- actions ---------- */

  function rerender() {
    var y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }

  function handleAction(action, el) {
    var id = el.getAttribute("data-id");
    var key = el.getAttribute("data-key");

    if (action === "home-search") {
      var q = document.getElementById("homeSearch");
      filters.q = q ? q.value.trim() : "";
      filters.cat = "全部";
      policyVisible = 200;
      location.hash = "#/policies";
      return;
    }
    if (action === "cat-filter") {
      filters.cat = el.getAttribute("data-cat") || "全部";
      filters.q = "";
      policyVisible = 200;
      location.hash = "#/policies";
      return;
    }
    if (action === "guide-toggle") {
      var gs = guideState();
      gs.collapsed = !gs.collapsed;
      writeJSON(KEYS.guide, gs);
      track("guide_toggle", { collapsed: gs.collapsed });
      rerender();
      return;
    }
    if (action === "guide-recommend") {
      if (!quizResults && quizMainDone()) quizResults = scorePolicies();
      location.hash = "#/quiz";
      return;
    }
    if (action === "clear-filters") {
      filters = { cat: "全部", status: "全部", sort: "deadline", q: "" };
      policyVisible = 200;
      rerender();
      return;
    }
    if (action === "load-more-policies") {
      policyVisible += 200;
      rerender();
      return;
    }
    if (action === "radar-export") {
      downloadBlob("政策变化摘要-" + fmtDate(Date.now()) + ".txt", buildRadarText());
      track("radar_export", {});
      toast("变化摘要已下载");
      return;
    }
    if (action === "compare-preset") {
      compareAId = el.getAttribute("data-a") || "";
      compareBId = el.getAttribute("data-b") || "";
      rerender();
      return;
    }
    if (action === "compare-copy") {
      copyText(buildCompareText(), "对比结果已复制");
      track("compare_copy", {});
      return;
    }
    if (action === "open-policy") {
      location.hash = "#/policy/" + id;
      return;
    }
    if (action === "toggle-select") {
      toggleSelect(id);
      guideMarkStep("3");
      rerender();
      return;
    }
    if (action === "quiz-option") {
      var qid = QUIZ[quizStep].id;
      quizAnswers[qid] = parseInt(el.getAttribute("data-index") || "0", 10);
      // 答案变化后，清除因条件失效的追问答案（避免残留标签计入推荐）
      for (var qi = QUIZ_MAIN; qi < QUIZ.length; qi++) {
        var fq = QUIZ[qi];
        if (quizAnswers[fq.id] !== undefined && fq.when && !fq.when(quizAnswers)) {
          delete quizAnswers[fq.id];
        }
      }
      saveQuizAnswers();
      rerender();
      return;
    }
    if (action === "quiz-next") {
      var ni = quizNextIndex();
      if (ni >= 0) {
        quizStep = ni;
        rerender();
      } else {
        quizResults = scorePolicies();
        track("quiz_complete", { results: quizResults.length });
        guideMarkStep("1");
        rerender();
      }
      return;
    }
    if (action === "quiz-prev") {
      // 回退到上一道已答题（主问题倒序 / 追问链回退）
      var prev = -1;
      for (var pi = 0; pi < quizStep; pi++) {
        if (quizIsAnswered(QUIZ[pi])) prev = pi;
      }
      if (prev >= 0) {
        quizStep = prev;
        rerender();
      }
      return;
    }
    if (action === "quiz-restart") {
      quizStep = 0;
      quizAnswers = {};
      quizResults = null;
      saveQuizAnswers();
      rerender();
      return;
    }
    if (action === "quiz-complete") {
      quizResults = scorePolicies();
      track("quiz_complete", { results: quizResults.length });
      guideMarkStep("1");
      rerender();
      return;
    }
    if (action === "add-results") {
      var ids = (quizResults || scorePolicies()).slice(0, 8).map(function (r) { return r.p.id; });
      var merged = selectedIds();
      ids.forEach(function (x) { if (merged.indexOf(x) < 0) merged.push(x); });
      saveSelected(merged);
      track("checklist_add_all", { count: ids.length });
      guideMarkStep("3");
      toast("已把推荐事项加入清单");
      rerender();
      return;
    }
    if (action === "cl-view") {
      clView = el.getAttribute("data-view") || "policy";
      guideMarkStep("3");
      rerender();
      return;
    }
    if (action === "checklist-copy") {
      copyText(buildChecklistText(), "清单已复制");
      track("checklist_copy", {});
      guideMarkStep("3");
      return;
    }
    if (action === "checklist-download") {
      downloadBlob("我的办理清单-" + fmtDate(Date.now()) + ".txt", buildChecklistText());
      track("checklist_download", {});
      guideMarkStep("3");
      toast("清单已下载");
      return;
    }
    if (action === "checklist-print") {
      track("checklist_print", {});
      guideMarkStep("3");
      window.print();
      return;
    }
    if (action === "template-copy") {
      var t1 = TEMPLATES[el.getAttribute("data-tkey")];
      if (t1) copyText(t1.text, "模板已复制");
      guideMarkStep("3");
      return;
    }
    if (action === "template-download") {
      var t2 = TEMPLATES[el.getAttribute("data-tkey")];
      if (t2) {
        downloadBlob(t2.name + ".txt", t2.text);
        track("template_download", { id: id, tkey: el.getAttribute("data-tkey") });
        guideMarkStep("3");
        toast("模板已下载");
      }
      return;
    }
    if (action === "cal-prev") {
      calMonth--;
      if (calMonth < 0) { calMonth = 11; calYear--; }
      rerender();
      return;
    }
    if (action === "cal-next") {
      calMonth++;
      if (calMonth > 11) { calMonth = 0; calYear++; }
      rerender();
      return;
    }
    if (action === "cal-mode-deadline") {
      calMode = "deadline";
      rerender();
      return;
    }
    if (action === "cal-mode-publish") {
      calMode = "publish";
      rerender();
      return;
    }
    if (action === "interest-toggle") {
      el.classList.toggle("active");
      return;
    }
    if (action === "subscribe") {
      var form = el.closest("form");
      var email = form ? form.querySelector("#subEmail").value.trim() : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        toast("请填写有效邮箱");
        return;
      }
      var interests = Array.prototype.slice.call(form.querySelectorAll(".chip.active")).map(function (c) {
        return c.getAttribute("data-value");
      });
      var subs = readJSON(KEYS.subs, []);
      subs.push({ email: email, name: form.querySelector("#subName").value.trim(), interests: interests, createdAt: Date.now() });
      writeJSON(KEYS.subs, subs);
      track("subscribe", { email: email });
      form.reset();
      form.querySelectorAll(".chip").forEach(function (c) { c.classList.remove("active"); });
      toast("订阅成功，记得查收确认邮件（演示版保存在本地）");
      return;
    }
    if (action === "submit-correction") {
      var cform = el.closest("form");
      if (!cform) return;
      var desc = cform.querySelector("#corrDesc").value.trim();
      if (!desc) { toast("请填写问题描述"); return; }
      var items = readJSON(KEYS.corrections, []);
      items.push({
        id: "c" + Date.now(),
        policyId: id,
        policyTitle: (POLICIES.filter(function (p) { return p.id === id; })[0] || {}).title || "全局",
        type: cform.querySelector("#corrType").value,
        desc: desc,
        contact: cform.querySelector("#corrContact").value.trim(),
        createdAt: Date.now(),
        handled: false
      });
      writeJSON(KEYS.corrections, items);
      track("correction_submit", { id: id });
      cform.reset();
      toast("已收到纠错，感谢反馈");
      return;
    }
    if (action === "verify") {
      var by = el.getAttribute("data-by") || "本人";
      var row = el.closest(".ws-row");
      var urlInput = row ? row.querySelector(".ws-url-input") : null;
      var url = urlInput ? urlInput.value.trim() : "";
      if (!url) { toast("请先填写官方来源 URL"); return; }
      var ver = verifications();
      ver[id] = { by: by, at: fmtDate(Date.now()), url: url };
      writeJSON(KEYS.verifications, ver);
      track("verify", { id: id, by: by });
      toast("已标记核验：" + by);
      rerender();
      return;
    }
    if (action === "unverify") {
      var ver2 = verifications();
      delete ver2[id];
      writeJSON(KEYS.verifications, ver2);
      toast("已撤销核验");
      rerender();
      return;
    }
    if (action === "ws-tab") {
      wsTab = el.getAttribute("data-tab") || "verify";
      rerender();
      return;
    }
    if (action === "mark-correction") {
      var items2 = readJSON(KEYS.corrections, []);
      items2.forEach(function (c) { if (c.id === id) c.handled = !c.handled; });
      writeJSON(KEYS.corrections, items2);
      toast("状态已更新");
      rerender();
      return;
    }
    if (action === "export-csv") {
      var kind = el.getAttribute("data-kind");
      if (kind === "pending") {
        var ver3 = verifications();
        var rows = POLICIES.filter(function (p) { return !ver3[p.id]; }).map(function (p) {
          return [p.id, p.title, p.category, p.source, p.deadline, p.status];
        });
        downloadCsv("待核验清单-" + fmtDate(Date.now()) + ".csv", [["id", "标题", "分类", "来源部门", "截止", "状态"]].concat(rows));
      } else if (kind === "events") {
        var evs = readJSON(KEYS.events, []);
        downloadCsv("事件记录-" + fmtDate(Date.now()) + ".csv", [["时间", "事件", "详情"]].concat(evs.map(function (ev) {
          return [fmtDate(ev.t) + " " + new Date(ev.t).toTimeString().slice(0, 8), ev.e, JSON.stringify(ev.p)];
        })));
      } else if (kind === "corrections") {
        var cors = readJSON(KEYS.corrections, []);
        downloadCsv("纠错记录-" + fmtDate(Date.now()) + ".csv", [["时间", "政策", "类型", "描述", "联系方式", "状态"]].concat(cors.map(function (c) {
          return [fmtDate(c.createdAt), c.policyTitle, c.type, c.desc, c.contact, c.handled ? "已处理" : "待处理"];
        })));
      }
      return;
    }
    if (action === "clear-events") {
      if (window.confirm("确定清空本机统计记录？此操作不可撤销。")) {
        writeJSON(KEYS.events, []);
        toast("统计记录已清空");
        rerender();
      }
      return;
    }
  }

  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-action]");
    if (!el) return;
    if (el.tagName === "A") e.preventDefault();
    handleAction(el.getAttribute("data-action"), el);
  });

  // 回到顶部：滚动超过 400px 显示，点击平滑回顶
  var backTopBtn = document.getElementById("backTop");
  if (backTopBtn) {
    window.addEventListener("scroll", function () {
      backTopBtn.classList.toggle("show", window.scrollY > 400);
    }, { passive: true });
    backTopBtn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  /* ---------- 背景音乐 ---------- */
  var bgmOn = localStorage.getItem("gzb_bgm_v1") === "1";
  var bgmAudio = null;

  function initBgm() {
    if (bgmAudio) return bgmAudio;
    bgmAudio = new Audio("assets/music/bgm.m4a");
    bgmAudio.loop = true;           // 循环播放
    bgmAudio.volume = 0.4;          // 适中音量
    bgmAudio.addEventListener("error", function () {
      bgmOn = false;
      localStorage.setItem("gzb_bgm_v1", "0");
      refreshBgmBtn();
      toast("未找到背景音乐文件（assets/music/bgm.m4a）");
    });
    return bgmAudio;
  }

  function refreshBgmBtn() {
    var btn = document.getElementById("bgmToggle");
    if (!btn) return;
    // lucide.createIcons 会把 <i> 替换为 <svg>，故直接重建按钮内容（含图标），再统一渲染
    btn.innerHTML = icon(bgmOn ? "music" : "music-off");
    btn.classList.toggle("playing", bgmOn);
    btn.setAttribute("aria-label", bgmOn ? "关闭背景音乐" : "开启背景音乐");
    btn.setAttribute("title", bgmOn ? "关闭背景音乐" : "开启背景音乐");
    refreshIcons();
  }

  function toggleBgm() {
    bgmOn = !bgmOn;
    localStorage.setItem("gzb_bgm_v1", bgmOn ? "1" : "0");
    if (bgmOn) {
      var pr = initBgm().play();
      if (pr && pr.catch) pr.catch(function () { /* 自动播放被浏览器拦截 */ });
    } else if (bgmAudio) {
      bgmAudio.pause();
    }
    refreshBgmBtn();
  }

  function tryResumeBgm() {
    if (bgmOn && bgmAudio) {
      var pr = bgmAudio.play();
      if (pr && pr.catch) pr.catch(function () {});
    }
  }

  var bgmBtnEl = document.getElementById("bgmToggle");
  if (bgmBtnEl) bgmBtnEl.addEventListener("click", toggleBgm);
  refreshBgmBtn();

  // 自动播放策略：偏好开启时，等首次用户交互（点击/滚动）再尝试播放
  if (bgmOn) {
    var resumeOnce = function () {
      tryResumeBgm();
      document.removeEventListener("click", resumeOnce);
      document.removeEventListener("scroll", resumeOnce);
    };
    document.addEventListener("click", resumeOnce);
    document.addEventListener("scroll", resumeOnce);
  }

  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.classList && t.classList.contains("js-material")) {
      toggleMaterial(t.getAttribute("data-key"));
      t.closest(".check-item").classList.toggle("done", t.checked);
      return;
    }
    if (t.id === "quizProvince" || t.id === "quizCity") {
      var provSel = document.getElementById("quizProvince");
      var citySel = document.getElementById("quizCity");
      if (t.id === "quizProvince") {
        var prov = provSel.value;
        citySel.innerHTML = '<option value="">请选择城市</option>' + (window.CHINA_REGIONS[prov] || []).map(function (c) {
          return '<option value="' + esc(c) + '">' + esc(c) + "</option>";
        }).join("");
        citySel.disabled = !prov;
        delete quizAnswers.city;
      } else {
        if (provSel.value && citySel.value) {
          quizAnswers.city = { province: provSel.value, city: citySel.value };
        } else {
          delete quizAnswers.city;
        }
      }
      var nextBtn = document.querySelector('.quiz-nav [data-action="quiz-next"], .quiz-nav [data-action="quiz-complete"]');
      if (nextBtn) nextBtn.disabled = !(quizAnswers.city && quizAnswers.city.city);
      saveQuizAnswers();
      return;
    }
    if (t.id === "compareA" || t.id === "compareB") {
      if (t.id === "compareA") compareAId = t.value;
      else compareBId = t.value;
      rerender();
      return;
    }
    var filter = t.getAttribute && t.getAttribute("data-filter");
    if (filter) {
      filters[filter] = t.value;
      policyVisible = 200;
      rerender();
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target && e.target.id === "homeSearch") {
      e.preventDefault();
      filters.q = e.target.value.trim();
      filters.cat = "全部";
      policyVisible = 200;
      location.hash = "#/policies";
    }
    if (e.key === "Enter" && e.target && e.target.id === "policySearch") {
      e.preventDefault();
      filters.q = e.target.value.trim();
      policyVisible = 200;
      rerender();
    }
  });

  document.addEventListener("submit", function (e) {
    if (e.target.classList && e.target.classList.contains("js-form")) e.preventDefault();
  });

  window.addEventListener("hashchange", render);

  render();
  refreshNav();
  refreshCount();
  refreshIcons();
  loadRemotePolicies();
})();
