/* v4.3.8 UI 精简层（运行时重组，不改任何既定节点 id / 事件绑定）
   - 页 3「批量分组改名」：步骤条 + 双模式按钮平铺（完整打包 / 仅命名 Master）+ 状态胶囊；左栏三组折叠
   - 页 5「新建工程目录」：四组折叠 + 预览实时化
   - 两页预览常驻展开，启动恢复上一次内容（目录树 / 计划），随后自动按已恢复参数刷新
   依赖：re.js 的全局 state / doPlan / ftPlan；缺失时自动降级，不抛错。 */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const K_TREE = "re-ui-refine/tree/v1";
  const K_PLAN = "re-ui-refine/plan/v1";
  let booted = false, autoPlanDone = false, liveTimer = null;

  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function stamp() {
    const d = new Date();
    return String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") +
      " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  function makeGroup(id, idx, title, sum, open) {
    const d = el("details", "ui-group");
    d.id = id;
    if (open) d.open = true;
    const s = el("summary", null,
      '<span class="ui-gidx">' + idx + "</span>" + title + '<span class="ui-sum"></span>');
    s.querySelector(".ui-sum").textContent = sum || "";
    d.appendChild(s);
    d.appendChild(el("div", "ui-body"));
    return d;
  }
  function moveInto(body, nodes) {
    nodes.forEach((n) => { if (n) body.appendChild(n); });
  }

  /* ── 右侧预览卡片：加类、加标签与脚注 ── */
  function refinePreviews() {
    const run = document.querySelector("#page-run .cols > .card:nth-child(2)");
    const ft = document.querySelector("#page-folder .cols > .card:nth-child(2)");
    const undo = document.querySelector("#page-undo .cols > .card:nth-child(2)");
    [run, ft, undo].forEach((c) => { if (c) c.classList.add("ui-preview"); });
    const pre = $("ftPreview");
    if (pre) pre.classList.add("ui-tree");
    [["run", "模式：完整打包 · 分组格式：{集数} · 文件改名：关"],
     ["folder", "模板根 / 输出路径 / 工程文件按左侧参数生成"]].forEach(([page, text]) => {
      const card = document.querySelector("#page-" + page + " .ui-preview");
      if (!card) return;
      const foot = el("div", "ui-preview-foot", text);
      foot.id = "uiFoot-" + page;
      card.appendChild(foot);
    });
  }
  function ensureLast(page) {
    const card = document.querySelector("#page-" + page + " .ui-preview h2");
    if (!card) return null;
    let s = card.querySelector(".ui-last");
    if (!s) { s = el("span", "ui-last", ""); card.appendChild(s); }
    return s;
  }
  function setLast(page, text) { const s = ensureLast(page); if (s) s.textContent = text; }

  /* ── 页 3 工具栏 ── */
  function refineRunToolbar() {
    const bar = document.querySelector("#page-run .action-toolbar");
    if (!bar || bar.dataset.uiDone) return;
    bar.dataset.uiDone = "1";
    bar.classList.add("ui-actionbar");

    const steps = el("div", "ui-steps",
      '<span class="ui-step" data-s="1"><i>1</i>选择目录</span><span class="ui-arrow">→</span>' +
      '<span class="ui-step" data-s="2"><i>2</i>生成计划</span><span class="ui-arrow">→</span>' +
      '<span class="ui-step" data-s="3"><i>3</i>执行重命名</span>');
    bar.insertBefore(steps, bar.firstChild);

    const acts = bar.querySelector(".action-buttons");
    if (!acts) return;
    /* 两个平铺模式按钮：点击直接按该模式生成计划；计划就绪且模式未变时点击 = 执行。 */
    const cancel = $("btnCancelPlan");
    const btnAll = el("button", "btn primary ui-mode-btn", "完整打包");
    btnAll.type = "button"; btnAll.id = "uiModeAll";
    btnAll.title = "生成完整打包计划：分组文件夹、分轨一起改名移动";
    const btnMaster = el("button", "btn ghost ui-mode-btn", "仅命名 Master（不打包）");
    btnMaster.type = "button"; btnMaster.id = "uiModeMaster";
    btnMaster.title = "仅重命名 Master 文件，不移动或打包其他文件";
    acts.insertBefore(btnAll, cancel || null);
    acts.insertBefore(btnMaster, cancel || null);

    /* 原控件保留在 DOM 中，仅视觉隐藏：radio 供 syncPlanControls 读写，
       btnApply 供模式按钮在计划就绪时以 .click() 触发，事件链完全不变。 */
    const fs = bar.querySelector(".plan-mode");
    if (fs) fs.classList.add("ui-keep");
    const apply = $("btnApply");
    if (apply) apply.classList.add("ui-keep");

    const hint = $("runModeHint");
    const statePill = el("div", "ui-state");
    statePill.appendChild(el("span", "ui-dot"));
    if (hint) statePill.appendChild(hint);
    bar.appendChild(statePill);

    [btnAll, btnMaster].forEach((btn) => {
      btn.onclick = () => {
        const S = (typeof state === "undefined") ? null : state;
        const mode = btn.id === "uiModeAll" ? "all" : "master-only";
        const apply = $("btnApply");
        if (S && S.planReady && S.planMode === mode && apply && !apply.disabled) { apply.click(); return; }
        const radio = $(mode === "master-only" ? "planModeMaster" : "planModeAll");
        if (radio) radio.checked = true;
        if (typeof doPlan === "function") doPlan(mode);
      };
    });
  }

  /* ── 页 3 左栏分组 ── */
  function refineRun() {
    const card = document.querySelector("#page-run .cols > .card:first-child");
    if (!card || card.dataset.uiDone) return;
    const need = ["runRoot", "runScanDetails", "runRenameDirs", "runGroupDetails",
      "runGroupMaster", "runRenameSubtracks", "runRenameFiles", "runFileDetails", "batchProjectDetails"];
    if (need.some((id) => !$(id))) return;
    card.dataset.uiDone = "1";

    const notes = Array.from(card.children).filter((n) => n.classList.contains("note"));
    const rootField = $("runRoot").closest(".field");
    const scan = $("runScanDetails");
    const dirs = $("runRenameDirs").closest("label.check");
    const dirFmt = $("runGroupDetails");
    const master = $("runGroupMaster").closest("label.check");
    const sub = $("runRenameSubtracks").closest("label.check");
    const files = $("runRenameFiles").closest("label.check");
    const fileFmt = $("runFileDetails");
    const project = $("batchProjectDetails");

    card.querySelectorAll("label.check").forEach((n) => n.classList.add("ui-switch"));
    notes.forEach((n) => n.classList.add("ui-note"));
    if (scan) { scan.classList.add("ui-flat-fold"); scan.open = true; }
    if (dirFmt) dirFmt.classList.add("ui-subfield");
    if (fileFmt) fileFmt.classList.add("ui-subfield");

    const g1 = makeGroup("uiGroupRun1", "1", "扫描范围", "", true);
    const g2 = makeGroup("uiGroupRun2", "2", "改名规则", "", true);
    const g3 = makeGroup("uiGroupRun3", "3", "高级规则", "默认收起 · 不常用设置", false);
    moveInto(g1.querySelector(".ui-body"), [rootField, scan]);
    moveInto(g2.querySelector(".ui-body"), [dirs, dirFmt, files, fileFmt]);
    moveInto(g3.querySelector(".ui-body"), [master, notes[0], sub, notes[1], project]);
    if (notes[2]) notes[2].classList.add("ui-keep");
    if (notes[3]) notes[3].classList.add("ui-keep");

    const foot = el("div", "ui-footnote",
      "执行前自动保存恢复记录；新分组建立后原空目录仅提示、不自动删除。需要恢复原名时打开「改名记录」。");
    [g1, g2, g3, foot].forEach((n) => card.appendChild(n));

    /* 联动：勾选「分组文件夹改名」时模式默认切回完整打包 */
    const dirsBox = $("runRenameDirs");
    if (dirsBox) dirsBox.addEventListener("change", () => {
      const S = (typeof state === "undefined") ? null : state;
      if (!dirsBox.checked || !S || S.planMode !== "master-only") return;
      const radio = $("planModeAll");
      if (radio) radio.checked = true;
      if (S.planReady || S.planPending) {
        S.planMode = "all";
        if (typeof doPlan === "function") doPlan("all");
      } else {
        S.planMode = "all";
        if (typeof syncPlanControls === "function") syncPlanControls();
      }
    });
  }

  /* ── 页 5 工具栏 + 左栏分组 ── */
  function refineFolderToolbar() {
    const bar = document.querySelector("#page-folder .action-toolbar");
    if (!bar || bar.dataset.uiDone) return;
    bar.dataset.uiDone = "1";
    bar.classList.add("ui-actionbar");
    const pill = el("div", "ui-state");
    pill.appendChild(el("span", "ui-dot"));
    pill.appendChild(el("span", null, "目录树预览默认展开 · 随参数实时更新"));
    bar.appendChild(pill);
  }
  function refineFolder() {
    const card = document.querySelector("#page-folder .cols > .card:first-child");
    if (!card || card.dataset.uiDone) return;
    const need = ["ftTemplateDetails", "ftOutputField", "ftDropParent", "ftName", "ftLevel",
      "ftEps", "ftProjectDetails", "ftEpisodeDetails", "ftFileDetails", "ftSkip"];
    if (need.some((id) => !$(id))) return;
    card.dataset.uiDone = "1";

    const kids = Array.from(card.children);
    const h2 = card.querySelector("h2");
    if (h2) h2.classList.add("ui-keep");
    const notes = kids.filter((n) => n.classList.contains("note"));
    const lastNote = notes[notes.length - 1];
    notes.forEach((n) => n.classList.add("ui-note"));
    const drop = $("ftDropParent").closest("label.check");
    const skip = $("ftSkip").closest("label.check");
    card.querySelectorAll("label.check").forEach((n) => n.classList.add("ui-switch"));
    const tplFold = $("ftTemplateDetails");
    if (tplFold) { tplFold.classList.add("ui-flat-fold"); tplFold.open = true; }

    const g1 = makeGroup("uiGroupFt1", "1", "模板与输出", "", true);
    const g2 = makeGroup("uiGroupFt2", "2", "项目信息", "", true);
    const g3 = makeGroup("uiGroupFt3", "3", "命名格式", "", false);
    const g4 = makeGroup("uiGroupFt4", "4", "工程文件", "", false);
    moveInto(g1.querySelector(".ui-body"),
      [$("ftTemplateDetails"), $("ftOutputField"), drop, $("ftDropHint"), $("ftDropStatus")]);
    moveInto(g2.querySelector(".ui-body"),
      [$("ftName").closest(".field"), $("ftLevel").closest(".field"), $("ftEps").closest(".field")]);
    moveInto(g3.querySelector(".ui-body"), [$("ftProjectDetails"), $("ftEpisodeDetails")]);
    moveInto(g4.querySelector(".ui-body"), [$("ftFileDetails"), skip, lastNote]);
    [g1, g2, g3, g4].forEach((n) => card.appendChild(n));
  }

  /* ═══ A 布局（2026-11-10）：顶栏合并导航 · 固定视口 · 预览吃满 · 日志抽屉 ═══ */

  function refineChrome() {
    const header = document.querySelector("header.hero");
    const nav = document.querySelector("nav.naming-nav");
    if (!header || !nav) return;
    /* header 补 naming-nav 类：nav 移入顶栏后，既有的 .naming-nav~main 样式链不断。 */
    header.classList.add("naming-nav");
    if (nav.parentElement !== header) {
      header.insertBefore(nav, header.querySelector(".spacer") || null);
    }
  }

  /* 页 2 右侧「落点预览」：按当前分类去向推导，不改配置 */
  function targetTreeLines() {
    const S = (typeof state === "undefined") ? null : state;
    const tgts = (S && S.cfg && S.cfg.targets) || [];
    const root = (($("runRoot") && $("runRoot").value.trim()) || "目标目录").replace(/[\\/]+$/, "");
    const on = tgts.filter((t) => t.enabled !== false);
    const dirs = [];
    on.forEach((t) => {
      const d = (t.dir || "").trim();
      if (d && dirs.indexOf(d) < 0) dirs.push(d);
    });
    const stay = on.filter((t) => !(t.dir || "").trim());
    const lines = [root + "\\"];
    dirs.forEach((d, i) => { lines.push((i === dirs.length - 1 && !stay.length ? "└─ " : "├─ ") + d + "\\"); });
    stay.forEach((t, i) => {
      lines.push((i === stay.length - 1 ? "└─ " : "├─ ") + t.name + "（留在原目录）");
    });
    return { lines, on: on.length, total: tgts.length, stay: stay.length };
  }
  function renderTargetTree() {
    const pre = $("uiTargetTree");
    if (!pre) return;
    const r = targetTreeLines();
    pre.textContent = r.lines.join("\n");
    const foot = $("uiFoot-target");
    if (foot) foot.textContent = "启用 " + r.on + " / " + r.total + " 个分类" + (r.stay ? " · " + r.stay + " 个不归位" : "") + " · 实际落点以生成计划为准";
  }
  function refineTarget() {
    const page = $("page-target");
    if (!page || page.dataset.uiDone) return;
    const card = page.querySelector(":scope > .card");
    if (!card) return;
    page.dataset.uiDone = "1";
    const grid = el("div", "cols ui-target-grid");
    page.insertBefore(grid, card);
    grid.appendChild(card);
    const side = el("section", "card px-hl ui-preview",
      '<h2>落点预览 <span class="tag">按分类去向推导</span></h2><pre class="ui-tree" id="uiTargetTree"></pre><div class="ui-preview-foot" id="uiFoot-target"></div>');
    grid.appendChild(side);
    renderTargetTree();
    refineTgtFields();
    const tbl = $("tgtTbl");
    if (tbl) new MutationObserver(() => { renderTargetTree(); refineTgtFields(); }).observe(tbl, { childList: true, subtree: true });
    const root = $("runRoot");
    if (root) { root.addEventListener("input", renderTargetTree); root.addEventListener("change", renderTargetTree); }
  }
  /* 目标表重绘后补占位提示（表格结构由 re.js 生成，不在此处改数据） */
  function refineTgtFields() {
    const tbl = $("tgtTbl");
    if (!tbl) return;
    tbl.querySelectorAll("[data-dir]").forEach((n) => { n.placeholder = "原地"; });
    tbl.querySelectorAll("[data-note]").forEach((n) => { n.placeholder = "可选"; });
    tbl.querySelectorAll("[data-format]").forEach((n) => { n.placeholder = "{片名}_{集数}"; });
  }

  /* 页 3 预览工具条：状态筛选 + 搜索（纯前端，不改计划数据） */
  let planFilter = "all", planQuery = "";
  function applyPlanTools() {
    const tbl = $("planTbl");
    if (!tbl) return;
    const rows = tbl.querySelectorAll("tbody tr");
    const shown = $("uiPlanShown");
    if (!rows.length) { if (shown) shown.textContent = ""; return; }
    let visible = 0;
    rows.forEach((tr) => {
      const st = tr.classList.contains("err") ? "bad" : tr.classList.contains("dim") ? "dim" : "ok";
      const okState = planFilter === "all" || (planFilter === "ok" ? st === "ok" : st === "bad");
      const okText = !planQuery || tr.textContent.toLowerCase().indexOf(planQuery) >= 0;
      tr.classList.toggle("ui-hide", !(okState && okText));
      if (okState && okText) visible++;
    });
    if (shown) shown.textContent = visible === rows.length ? rows.length + " 项" : "显示 " + visible + " / " + rows.length;
  }
  /* 全列没有说明时收起该列，把宽度让给两条路径 */
  function applyPlanNoteCol() {
    const tbl = $("planTbl");
    if (!tbl) return;
    const rows = tbl.querySelectorAll("tbody tr");
    let hasNote = false;
    rows.forEach((tr) => {
      const c = tr.children[4];
      if (!c) return;
      const t = c.textContent.trim();
      if (t) { hasNote = true; c.title = t; }
    });
    tbl.classList.toggle("no-note", rows.length > 0 && !hasNote);
  }
  function refinePlanTools() {
    const card = document.querySelector("#page-run .cols > .card:nth-child(2)");
    const tbl = $("planTbl");
    if (!card || !tbl || card.dataset.toolsDone) return;
    card.dataset.toolsDone = "1";
    const tools = el("div", "ui-preview-tools",
      '<div class="ui-seg" id="uiPlanFilters"><button type="button" data-f="all" class="on">全部</button>' +
      '<button type="button" data-f="ok">就绪</button><button type="button" data-f="bad">需处理</button></div>' +
      '<input class="ui-search" id="uiPlanSearch" type="search" placeholder="搜索文件 / 目标">' +
      '<span class="ui-shown" id="uiPlanShown"></span>');
    tbl.parentNode.insertBefore(tools, tbl);
    tools.addEventListener("click", (e) => {
      const b = e.target.closest("#uiPlanFilters button");
      if (!b) return;
      planFilter = b.dataset.f;
      tools.querySelectorAll("#uiPlanFilters button").forEach((x) => x.classList.toggle("on", x === b));
      applyPlanTools();
    });
    const q = $("uiPlanSearch");
    q.addEventListener("input", () => { planQuery = q.value.trim().toLowerCase(); applyPlanTools(); });
    new MutationObserver(() => { applyPlanTools(); applyPlanNoteCol(); }).observe(tbl, { childList: true, subtree: true });
    applyPlanNoteCol();
  }

  /* 日志抽屉：跟随当前页，放进右侧预览底部；规则页放页尾并默认收起 */
  function logDockHost(page) {
    if (page === "run" || page === "folder") return document.querySelector("#page-" + page + " .ui-preview");
    if (page === "undo" || page === "target") return document.querySelector("#page-" + page + " .ui-preview");
    if (page === "rule") return $("page-rule");
    return null;
  }
  function placeLogDock() {
    const wrap = document.querySelector(".logwrap");
    if (!wrap) return;
    const page = ["run", "folder", "undo", "target", "rule"].find((p) => {
      const n = $("page-" + p);
      return n && n.classList.contains("on");
    });
    const host = page ? logDockHost(page) : null;
    if (!host) return;
    wrap.classList.add("ui-dock");
    wrap.classList.toggle("dock-bottom", page === "rule");
    if (host !== wrap.parentElement) host.appendChild(wrap);
    if (page === "rule" && !wrap.dataset.userToggled) wrap.classList.add("closed");
    wrap.dataset.page = page || "";
  }
  function wireLogDock() {
    const wrap = document.querySelector(".logwrap");
    if (!wrap || wrap.dataset.uiDock) return;
    wrap.dataset.uiDock = "1";
    const head = wrap.querySelector(".loghead");
    const clear = $("btnClear");
    if (head) {
      const hint = head.querySelector(".spacer + span");
      if (hint) hint.classList.add("dock-hint");
      if (clear) {
        clear.classList.add("dock-clear");
        head.appendChild(clear);
      }
      const chev = el("span", "dock-chev", "⌃");
      head.appendChild(chev);
      head.title = "展开 / 收起运行日志";
      head.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        wrap.classList.toggle("closed");
        wrap.dataset.userToggled = "1";
      });
    }
  }

  /* 预览容器自带行内 max-height，A 布局里改由 flex 撑满 */
  function relaxHeights() {
    ["planTbl", "logTbl", "logPreview", "ftPreview"].forEach((id) => {
      const n = $(id);
      if (n) n.style.maxHeight = "";
    });
  }

  /* ── 预览记忆：启动恢复 + 变化落盘 ── */
  function restorePreviews() {
    const tree = lsGet(K_TREE);
    if (tree && tree.text && !/（点|演示态|规划失败/.test(tree.text)) {
      const pre = $("ftPreview");
      if (pre) pre.textContent = tree.text;
      setLast("folder", "上一次目录树 · " + tree.at);
    }
    const plan = lsGet(K_PLAN);
    if (plan && plan.html) {
      const tbl = $("planTbl");
      if (tbl) {
        tbl.innerHTML = plan.html;
        tbl.classList.add("ui-last-table");
        tbl.querySelectorAll("button").forEach((b) => b.remove());
        const tag = $("planTag");
        if (tag) tag.textContent = "上次计划（只读）";
        setLast("run", "上一次计划 · " + plan.at);
      }
    }
  }
  function observePreviews() {
    const pre = $("ftPreview");
    if (pre) new MutationObserver(() => {
      const t = pre.textContent.trim();
      if (!t || /（点|演示态|规划失败/.test(t)) return;
      lsSet(K_TREE, { text: pre.textContent, at: stamp() });
    }).observe(pre, { childList: true, characterData: true, subtree: true });

    const tbl = $("planTbl");
    if (tbl) new MutationObserver(() => {
      if (tbl.querySelector(".empty")) return;
      lsSet(K_PLAN, { html: tbl.innerHTML, at: stamp() });
    }).observe(tbl, { childList: true, subtree: true });
  }

  /* ── 目录树：启动自动刷新 + 输入 debounce 实时刷新 ── */
  function canAutoPlan() {
    const out = $("ftOutRoot"), tpl = $("ftTplRoot");
    return !!(window.pywebview && window.pywebview.api && out && tpl &&
      out.value.trim() && tpl.value.trim() && typeof ftPlan === "function");
  }
  function refreshTree() {
    if (!canAutoPlan()) return;
    try {
      const r = ftPlan(true);
      if (r && r.then) r.then(() => setLast("folder", "当前参数 · 已自动刷新")).catch(() => {});
    } catch (e) { /* 演示态或参数未就绪，保留上一次内容 */ }
  }
  function autoRefreshTree() {
    if (autoPlanDone) return;
    autoPlanDone = true;
    setTimeout(refreshTree, 1400);
  }
  function bindLiveTree() {
    const card = document.querySelector("#page-folder .cols > .card:first-child");
    if (!card) return;
    const onEdit = () => {
      clearTimeout(liveTimer);
      liveTimer = setTimeout(refreshTree, 700);
    };
    card.addEventListener("input", onEdit);
    card.addEventListener("change", onEdit);
  }

  /* ── 步骤条 / 主按钮 / 摘要 ── */
  function updateSummaries() {
    [["runRenameDirs", "runGroupDetails"], ["runRenameFiles", "runFileDetails"]].forEach(([cid, gid]) => {
      const c = $(cid), g = $(gid);
      if (c && g) g.classList.toggle("off", !c.checked);
    });
    const put = (id, text) => {
      const g = $(id);
      const s = g && g.querySelector(".ui-sum");
      if (s) s.textContent = text;
    };
    const rec = $("runRecursive"), exts = $("runExts"), dirFmt = $("runDirFormat"), rf = $("runRenameFiles");
    put("uiGroupRun1", (rec && rec.checked ? "含子目录" : "仅当前目录") + " · " + (exts ? exts.value.trim() : ""));
    put("uiGroupRun2", (dirFmt ? dirFmt.value.trim() : "") + " · 文件" + (rf && rf.checked ? "改名" : "保持原名"));
    const tpl = $("ftTplRoot"), name = $("ftName"), eps = $("ftEps");
    put("uiGroupFt1", tpl ? tpl.value.trim().split(/[\\/]/).pop() : "");
    put("uiGroupFt2", (name ? name.value.trim() : "") + " · " + (eps ? eps.value.trim() : "") + " 集");
    const pf = $("ftProjectFormat");
    put("uiGroupFt3", pf ? pf.value.trim() : "");
    const ptx = $("ftPtx");
    put("uiGroupFt4", ptx && ptx.selectedOptions[0] ? ptx.selectedOptions[0].textContent : "");

    const foot = $("uiFoot-run");
    if (foot) {
      const S = (typeof state === "undefined") ? null : state;
      const masterRadio = $("planModeMaster");
      const cur = S ? S.planMode : (masterRadio && masterRadio.checked ? "master-only" : "all");
      const total = S ? (S.items || []).length : 0;
      const bad = S ? ((S.stats.error || 0) + (S.stats.conflict || 0)) : 0;
      foot.textContent = "模式：" + (cur === "master-only" ? "仅命名 Master（不打包）" : "完整打包") +
        " · 分组格式：" + (dirFmt ? dirFmt.value.trim() : "") +
        " · 文件改名：" + (rf && rf.checked ? "开" : "关") +
        (total ? " · 共 " + total + " 项" + (bad ? " · " + bad + " 项需处理" : "") : "");
    }
    const ftFoot = $("uiFoot-folder");
    if (ftFoot && tpl) ftFoot.textContent = "模板根：" + tpl.value.trim() + " · 输出：" + ($("ftOutRoot") ? $("ftOutRoot").value.trim() : "");
  }
  function updateFlow() {
    const S = (typeof state === "undefined") ? null : state;
    const pending = !!(S && (S.planPending || S.busy));
    const ready = !!(S && S.planReady);
    const n = S ? (S.stats.rename ?? S.stats[""] ?? 0) : 0;
    const cur = ready ? 3 : 2;
    document.querySelectorAll("#page-run .ui-steps .ui-step").forEach((s) => {
      const i = +s.dataset.s;
      s.classList.toggle("done", i < cur);
      s.classList.toggle("on", i === cur);
      const ic = s.querySelector("i");
      if (ic) ic.textContent = i < cur ? "✓" : String(i);
    });
    /* 双模式按钮：高亮当前模式；计划就绪且模式未变时标签变为执行。 */
    const masterRadio = $("planModeMaster");
    const curMode = S ? S.planMode : (masterRadio && masterRadio.checked ? "master-only" : "all");
    const locked = !!(S && (S.busy || S.planPending || S.planApplying));
    [["uiModeAll", "all", "完整打包", "▶ 执行重命名"],
     ["uiModeMaster", "master-only", "仅命名 Master（不打包）", "▶ 执行 Master 改名"]].forEach(([id, mode, label, execLabel]) => {
      const b = $(id);
      if (!b) return;
      const active = curMode === mode;
      const executable = active && ready && n > 0 && !locked;
      b.textContent = executable ? execLabel + " · " + n + " 项" : label;
      b.classList.toggle("primary", active);
      b.classList.toggle("ghost", !active);
      b.disabled = locked;
      b.setAttribute("aria-pressed", String(active));
    });
    const pill = document.querySelector("#page-run .ui-state");
    if (pill) pill.classList.toggle("ok", ready);
    updateSummaries();
  }
  function bindFlow() {
    ["runModeHint", "planTag"].forEach((id) => {
      const n = $(id);
      if (n) new MutationObserver(updateFlow).observe(n, { childList: true, characterData: true, subtree: true });
    });
    const card = document.querySelector("#page-run .cols > .card:first-child");
    if (card) {
      card.addEventListener("input", updateSummaries);
      card.addEventListener("change", updateSummaries);
    }
    const fc = document.querySelector("#page-folder .cols > .card:first-child");
    if (fc) fc.addEventListener("input", updateSummaries);
  }

  function boot() {
    if (booted) return;
    booted = true;
    document.body.classList.add("ui-refine", "ui-a");
    try {
      refineChrome();
      refinePreviews();
      refineRunToolbar();
      refineFolderToolbar();
      refineRun();
      refineFolder();
      refineTarget();
      refinePlanTools();
      relaxHeights();
      wireLogDock();
      placeLogDock();
      restorePreviews();
      observePreviews();
      bindLiveTree();
      bindFlow();
      updateFlow();
      /* 页签切换后把日志抽屉移到当前页：点击与代码内 goto() 两种切换都要跟。 */
      document.addEventListener("click", (e) => {
        if (e.target.closest("nav.naming-nav [id^='tab-']")) setTimeout(placeLogDock, 0);
      }, true);
      ["run", "folder", "undo", "target", "rule"].forEach((p) => {
        const n = $("page-" + p);
        if (n) new MutationObserver(placeLogDock).observe(n, { attributes: true, attributeFilter: ["class"] });
      });
    } catch (e) {
      if (window.console) console.error("[ui-refine] boot failed:", e);
    }
  }

  window.addEventListener("toolready", () => { boot(); autoRefreshTree(); });
  window.addEventListener("parametersrestored", () => {
    if (booted) { updateFlow(); updateSummaries(); renderTargetTree(); }
    autoRefreshTree();
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  setTimeout(boot, 700);
})();
