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
  /* 组头图标：替代原来的灰色装饰编号（编号会被读成流程步骤，而流程只在工具栏的步骤条里）。
     直接内联 svg 片段，避免引入图标字体或额外请求。 */
  const GICO = {
    scan: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    rule: '<rect x="5" y="5" width="14" height="14" rx="1.5"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
    adv: '<path d="M4 7h16M4 13h10M4 19h7"/><circle cx="18" cy="13" r="1.8"/><circle cx="13" cy="19" r="1.8"/>',
    tpl: '<path d="M3 7h7l2-3h9v16H3z"/>',
    info: '<path d="M4 6h16M4 12h16M4 18h9"/>',
    fmt: '<path d="M9 4 7 20M17 4l2 16M4 9h16M3 15h16"/>',
    file: '<path d="M6 3h9l3 3v15H6z"/><path d="M12 10v7M9 13h6"/>',
  };
  function makeGroup(id, icon, title, sum, open) {
    const d = el("details", "ui-group");
    d.id = id;
    if (open) d.open = true;
    const s = el("summary", null,
      '<span class="ui-gico"><svg viewBox="0 0 24 24">' + (GICO[icon] || "") + "</svg></span>" +
      title + '<span class="ui-sum"></span>');
    s.querySelector(".ui-sum").textContent = sum || "";
    d.appendChild(s);
    d.appendChild(el("div", "ui-body"));
    return d;
  }
  function moveInto(body, nodes) {
    nodes.forEach((n) => { if (n) body.appendChild(n); });
  }

  /* ── 版式：把「一行里挤好几个输入」拆成图上那种「标签在上、输入在下」 ──
     只搬节点、加包装，不动任何 id 与事件绑定。
     rowify：标签保留，向下补一个 flex 行（输入 + 按钮）
     splitRow：一个 .field 里塞了多个输入时，各自配一个自己的标签 */
  function rowify(fieldNode, nodes) {
    if (!fieldNode) return null;
    const row = el("div", "ui-frow");
    nodes.forEach((n) => { if (n) row.appendChild(n); });
    fieldNode.appendChild(row);
    return row;
  }
  function miniField(text, input, flex) {
    const w = el("div", "ui-mini");
    if (flex) w.style.flex = flex;
    w.appendChild(el("label", null, text));
    if (input) w.appendChild(input);
    return w;
  }
  function splitRow(fieldNode, specs) {
    if (!fieldNode) return fieldNode;
    const row = el("div", "ui-frow");
    specs.forEach(([text, id, flex]) => {
      const inp = $(id);
      if (inp) row.appendChild(miniField(text, inp, flex));
    });
    /* 输入已被搬进新行，清掉原 field 里的旧标签与残留 */
    fieldNode.innerHTML = "";
    fieldNode.appendChild(row);
    return fieldNode;
  }

  /* ── 右侧预览卡片：加类、加标签与脚注 ── */
  function refinePreviews() {
    const run = document.querySelector("#page-run .cols > .card:nth-child(2)");
    const ft = document.querySelector("#page-folder .cols > .card:nth-child(2)");
    const undo = document.querySelector("#page-undo .cols > .card:nth-child(2)");
    [run, ft, undo].forEach((c) => { if (c) c.classList.add("ui-preview"); });
    const pre = $("ftPreview");
    if (pre) pre.classList.add("ui-tree");
    /* 页 5 的脚注「模板根 / 输出路径 / …」2026-11-18 删除：
       右栏「路径」块已写同样两条，重复且白占一行高度 */
    [["run", "模式：完整打包 · 分组格式：{集数} · 文件改名：关"]].forEach(([page, text]) => {
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

    /* 执行独立出一个主按钮：模式控件已搬进左栏，工具栏只留一个主操作，
       避免「模式按钮兼作执行」这种一键两义。 */
    const exec = el("button", "btn primary", "▶ 执行重命名");
    exec.type = "button";
    exec.id = "uiExec";
    exec.disabled = true;
    exec.onclick = () => {
      const S = (typeof state === "undefined") ? null : state;
      const id = (S && S.planMode === "master-only") ? "uiModeMaster" : "uiModeAll";
      const b = $(id);
      if (b && !b.disabled) b.click();
    };
    if (cancel) acts.insertBefore(exec, cancel); else acts.appendChild(exec);

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
    if (scan) {
      scan.classList.add("ui-flat-fold");
      scan.open = true;
      /* 折叠区里的开关另包一层：基础样式给 label.check 压了 margin:0!important，
         单靠选择器加间距会被压掉，用容器 gap 才稳 */
      const sws = Array.from(scan.querySelectorAll("label.check"));
      if (sws.length) {
        const box = el("div", "ui-sws");
        sws.forEach((n) => box.appendChild(n));
        scan.appendChild(box);
      }
    }
    if (dirFmt) {
      dirFmt.classList.add("ui-subfield"); dirFmt.classList.add("ui-flat-fold"); dirFmt.open = true;
      chipsToMenu(dirFmt, "分组文件夹格式");
    }
    if (fileFmt) fileFmt.classList.add("ui-subfield");
    if (project) project.classList.add("ui-flat-fold");

    const g1 = makeGroup("uiGroupRun1", "scan", "扫描范围", "", true);
    const g2 = makeGroup("uiGroupRun2", "rule", "改名规则", "", true);
    const g3 = makeGroup("uiGroupRun3", "adv", "高级规则", "默认收起 · 不常用设置", false);

    /* 开关与它控制的格式合成一张设置卡：卡头是开关，卡内是格式。
       关闭时整卡降权（.off 由 updateSummaries 维护），不再靠 2px 缩进表达从属。 */
    const card1 = el("div", "ui-swcard");
    card1.id = "uiSwDir";
    card1.appendChild(dirs);
    card1.appendChild(dirFmt);
    const card2 = el("div", "ui-swcard");
    card2.id = "uiSwFile";
    card2.appendChild(files);
    card2.appendChild(fileFmt);

    rowify(rootField, [$("runRoot"), $("runBrowseRoot")]);
    iconifyBrowse($("runBrowseRoot"));
    moveInto(g1.querySelector(".ui-body"), [rootField, scan]);
    moveInto(g2.querySelector(".ui-body"), [card1, card2]);
    moveInto(g3.querySelector(".ui-body"), [master, notes[0], sub, notes[1], project]);
    /* 这两条与底部脚注重复，收掉（节点留着，只是不显示） */
    if (notes[2]) notes[2].classList.add("ui-keep");
    if (notes[3]) notes[3].classList.add("ui-keep");

    /* 模式分段控件搬到左栏顶部：模式决定这一栏露出哪些组，所以它属于左栏，
       而不是和「执行」按钮并排躺在工具栏里。两个按钮仍是原先那两个节点，
       事件链不变，只是换了宿主。 */
    const seg = el("div", "ui-modeseg");
    seg.id = "uiModeSeg";

    const foot = el("div", "ui-footnote",
      "执行前自动保存恢复记录；新分组建立后原空目录仅提示、不自动删除。需要恢复原名时打开「改名记录」。");
    const scroll = el("div", "ui-scroll");
    [g1, g2, g3, foot].forEach((n) => scroll.appendChild(n));
    [seg, scroll].forEach((n) => card.appendChild(n));
    polishCard(card);
    compactBatchProject(card);
    /* 第二页的格式块与第一页同款：标题降为说明标签、规则与样例同一行两列 */
    wrapRuleRow($("runGroupDetails"));
    wrapRuleRow($("runFileDetails"));

    const modeAll = $("uiModeAll"), modeMaster = $("uiModeMaster");
    if (modeAll && modeMaster) { seg.appendChild(modeAll); seg.appendChild(modeMaster); }

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

  /* ── 页 3 模式联动：仅命名 Master 时，锁定不参与打包的规则 ──
     锁定范围（runParams("master-only") 中被强制覆盖的项）：
     G3「高级规则」整组 + G2 内「分组文件夹改名」开关及其「命名格式」子项。
     由 re.js syncPlanControls 在每次模式/状态同步时调用；初始态在 boot 里补一次。 */
  function applyModeLock(mode) {
    const masterOnly = mode === "master-only";
    const g3 = $("uiGroupRun3");
    const swDir = $("uiSwDir");
    const hint = document.querySelector("#page-run .ui-modehint");
    /* 直接隐藏不参与打包的设置，而不是整组半透明遮罩再压一句说明：
       遮罩要求用户读完那句话才知道被禁了什么，隐藏则是「这里根本没有这一项」。 */
    [g3, swDir].forEach((n) => {
      if (!n) return;
      n.style.display = masterOnly ? "none" : "";
      n.classList.remove("ui-locked", "ui-locked-item");
    });
    if (hint) {
      hint.textContent = masterOnly
        ? "当前为「仅命名 Master」：分组文件夹改名与高级规则已隐藏，不参与打包。"
        : "切到「仅命名 Master」会隐藏「分组文件夹改名」与「高级规则」——它们不参与打包。";
    }
  }
  window.uiApplyModeLock = applyModeLock;

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

    const g1 = makeGroup("uiGroupFt1", "tpl", "模板与输出", "", true);
    const g2 = makeGroup("uiGroupFt2", "info", "项目信息", "", true);
    const g3 = makeGroup("uiGroupFt3", "fmt", "命名格式", "", true);
    const g4 = makeGroup("uiGroupFt4", "file", "工程文件", "", false);
    /* 三处多输入行拆成各自带标签的小格：原先是「等级 / 日期 / 用户」一个标签带三个框，
       第三个框被挤到下一行还拉满宽度，最难看的就是这里 */
    splitRow($("ftName").closest(".field"),
      [["项目名", "ftName", "1 1 0"], ["序号", "ftSeq", "0 0 96px"]]);
    splitRow($("ftLevel").closest(".field"),
      [["等级", "ftLevel", "1 1 0"], ["日期", "ftDate", "1 1 0"], ["用户", "ftUser", "1 1 0"]],
      );
    rowify($("ftOutputField"), [$("ftOutRoot"), $("ftBrowseOut")]);
    rowify($("ftTplRoot").closest(".field"), [$("ftTplRoot"), $("ftBrowseTpl")]);
    iconifyBrowse($("ftBrowseOut"));
    iconifyBrowse($("ftBrowseTpl"));
    /* 等级 / 日期 / 用户 / 集数 收进同一行四格：右边一律落在栏右，不再出现四种右边界。
       集数独占一整行是最大的宽度浪费（只放「1-60」却吃掉 340px）。
       注意：这一步必须放在任何 moveInto 之前，节点一旦被搬进未入文档的组里，
       getElementById 就查不到了。 */
    const lv = $("ftLevel"), eps = $("ftEps");
    if (lv && eps) {
      const row = lv.closest(".ui-frow");
      const epsField = eps.closest(".field");
      if (row) {
        row.appendChild(miniField("集数", eps, "1.35 1 0"));
        row.classList.remove("ui-frow-3up");
        row.classList.add("ui-frow-4col");
        if (epsField) epsField.remove();
      }
    }
    /* 命名格式两个子项：删重复标题、合「集数位数 + 实时样例」、收「快捷填入」 */
    tidyNameFormat();
    /* 三级块默认展开 */
    ["ftProjectDetails", "ftEpisodeDetails", "ftFileDetails"].forEach((id) => {
      const d = $(id);
      if (d) d.open = true;
    });

    moveInto(g1.querySelector(".ui-body"),
      [$("ftTemplateDetails"), $("ftOutputField"), drop, $("ftDropHint"), $("ftDropStatus")]);
    moveInto(g2.querySelector(".ui-body"),
      [$("ftName").closest(".field"), $("ftLevel").closest(".ui-frow") || $("ftLevel").closest(".field")]);
    /* 集数格式提示：收成行下小字（原来贴着输入框，在 1/4 栏宽里会折三行） */
    const g2body = g2.querySelector(".ui-body");
    if (g2body && !g2body.querySelector(".ui-fhint")) {
      g2body.appendChild(el("div", "ui-fhint", "集数支持 1-60、1,5,9-20（逗号或顿号分隔）"));
    }
    /* 工程文件格式并入「命名格式」：三级块里第三个格式，跟项目根、集数同一层。
       注意：g3 此时还没挂到文档里，移动后再用 getElementById 会取不到，
       所以先把引用抓在手上，并就地加 nf-block、把「跳过已存在」塞进块内。 */
    const fileBlock = $("ftFileDetails");
    if (fileBlock) {
      fileBlock.classList.add("nf-block");
      if (skip) fileBlock.appendChild(skip);
    }
    moveInto(g3.querySelector(".ui-body"),
      [$("ftProjectDetails"), $("ftEpisodeDetails"), fileBlock, lastNote]);
    /* 2026-11-19：左栏底部「将建 N 步 / 未预检·冲突未确认」结论条撤掉——
       同样的信息右栏「本次建立」「预检」已各有一份，这里只占高度 */
    const scroll = el("div", "ui-scroll");
    [g1, g2, g3].forEach((n) => scroll.appendChild(n));
    card.appendChild(scroll);
    polishCard(card);
  }

  /* ── 全软件统一行规 ────────────────────────────────────────────────────────
     一个参数＝一行：说明文字在左、状态/开关在右；「结果」一律写成 → 值 的浅色行，
     不再用带边框的小盒子；折叠子项里与标题重复的 label 删掉。
     在卡片已经拼好之后调用，内部只用 card.querySelector，节点搬走了也查得到。 */
  function polishCard(card) {
    /* 1) 开关行：左字右闸，一行到底 */
    card.querySelectorAll("label.check").forEach((n) => n.classList.add("ui-swrow"));

    /* 2) 「实时样例 / 当前格式」盒子 → 一行结果。code 与按钮原地搬进结果行，
          应用对 code 的持续写入照旧生效 */
    card.querySelectorAll(".inner").forEach((inn) => {
      if (inn.classList.contains("nf-hide")) return;      /* 命名格式已有自己的结果行 */
      const code = inn.querySelector("code");
      if (!code) return;
      const res = el("div", "nf-res");
      const arrow = el("i", null, "→");
      const val = el("b");
      res.appendChild(arrow);
      res.appendChild(val);
      val.appendChild(code);                              /* 搬节点，不复制：绑定和写入都在 */
      const btn = inn.querySelector("button");
      if (btn) { btn.classList.add("nf-btn"); res.appendChild(btn); }
      /* 结果行紧跟它描述的那个输入框，别被后面那排字段按钮隔开 */
      const fold = inn.closest(".setting-fold");
      const fld = fold && fold.querySelector(".field");
      if (fld && fld.parentElement === inn.parentElement) fld.insertAdjacentElement("afterend", res);
      else if (inn.parentElement) inn.parentElement.insertBefore(res, inn);
      inn.remove();
    });

    /* 3) 折叠子项里重复的 label：标题已经把名字写过了。
        但标题本身被藏起来的（.ui-flat-fold）不能删，否则这个输入框就没名字了。 */
    card.querySelectorAll(".setting-fold>.field>label").forEach((lab) => {
      const fold = lab.closest(".setting-fold");
      const sum = fold && fold.querySelector("summary");
      if (!sum || fold.classList.contains("ui-flat-fold")) return;
      const flat = (s) => s.replace(/\s+/g, "");
      if (flat(sum.textContent).indexOf(flat(lab.textContent)) > -1) lab.remove();
    });
  }

  /* 批量页「项目信息（可选）」：四个输入原来各占一整行，收成一行四格 */
  function compactBatchProject(card) {
    const fold = card.querySelector("#batchProjectDetails");
    if (!fold || fold.dataset.nfBuilt) return;
    fold.dataset.nfBuilt = "1";
    const specs = [["片名", "fProject", "1 1 0"], ["日期", "fDate", "0 0 88px"],
      ["版本", "fVer", "0 0 76px"], ["用户", "fUser", "0 0 76px"]];
    const row = el("div", "ui-frow ui-frow-4up");
    specs.forEach(([txt, id, flex]) => {
      const inp = card.querySelector("#" + id);
      if (!inp) return;
      const field = inp.closest(".field");
      row.appendChild(miniField(txt, inp, flex));
      if (id === "fProject" && !inp.placeholder) inp.placeholder = "如 因灾失明";
      if (field) field.remove();
    });
    /* 标题被藏起来了，补一行小标题，否则这四格没有来由 */
    fold.appendChild(el("div", "nf-cap", "项目信息（可选）"));
    fold.appendChild(row);
  }

  /* 字段按钮那排「片名 / 集数 / 日期…」也按行规收进 ＋ 菜单：
     整块容器搬进去，按钮上原有的 onclick 不会丢。 */
  function chipsToMenu(fold, title) {
    if (!fold || fold.dataset.nfChips) return;
    const chips = fold.querySelector(".format-fields");
    if (!chips) return;
    fold.dataset.nfChips = "1";

    const head = el("div", "nf-head");
    head.appendChild(el("span", null, title));
    const add = el("button", "nf-add", "＋");
    add.type = "button";
    add.title = "插入字段";
    head.appendChild(add);

    const pop = el("div", "nf-pop nf-pop-chips");
    pop.style.display = "none";
    const sec = el("div", "nf-sec", "插入字段");
    pop.appendChild(sec);
    pop.appendChild(chips);

    add.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      pop.style.display = pop.style.display === "none" ? "block" : "none";
    });
    document.addEventListener("click", (e) => {
      if (!pop.contains(e.target) && !head.contains(e.target)) pop.style.display = "none";
    });

    const lab = fold.querySelector(".field > label");
    if (lab) lab.remove();
    const field = fold.querySelector(".field");
    if (field) {
      field.insertAdjacentElement("beforebegin", head);
      field.insertAdjacentElement("afterend", pop);
    } else {
      fold.appendChild(head);
      fold.appendChild(pop);
    }
  }

  /* 「浏览…」占 70px，把最该看全的路径挤成半截。改成 30×30 图标钮，标题栏留 tooltip */
  function iconifyBrowse(btn) {
    if (!btn || btn.dataset.ico) return;
    btn.dataset.ico = "1";
    btn.classList.add("ui-iconbtn");
    btn.title = "浏览…";
    btn.setAttribute("aria-label", "浏览");
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M3 7h6l2-2h10v14H3z"/><path d="M3 9h18"/></svg>';
  }

  /* ── 命名格式组：换成「标题 + 格式 + 结果」三行式 ──────────────────────────
     原来一个格式要占五行：输入框 / 字段条 / 快捷填入 / 位数 / 样例盒子，四个控件各自
     吃一行，420 的窄栏里怎么排都挤。现在一个格式只留三行：
       ① 标题行（右侧放 ＋ 菜单、集数位数）
       ② 格式输入框
       ③ 结果行（→ 实际会生成的文件夹名）
     字段条、分隔符、快捷预设全部收进 ＋ 的浮层里，用的时候才出现。
     仍不改任何 id 与既有绑定：浮层里就是原来的按钮节点，只是搬了位置。 */
  function tidyNameFormat() {
    const projFold = $("ftProjectDetails");
    const epFold = $("ftEpisodeDetails");
    if (!projFold || !epFold) return;

    buildFormatBlock(projFold, "ftProjectFormat", "cfgProjectSample", false);
    buildFormatBlock(epFold, "ftEpFormat", "ftNameSample", true);

    /* 结果行：跟着真实输入刷新（应用自己在写样例文本，这里只读）。
       应用那侧有 60ms 防抖，读早了会拿到旧值，所以这边也延后一点再取。 */
    const paint = () => {
      /* 项目根：用带序号的完整目录名（应用自带的 cfgProjectSample 不含序号） */
      paintRes(projFold, projectRootName() || $("cfgProjectSample"));
      paintRes(epFold, $("ftNameSample"));
    };
    let pt = 0;
    const paintSoon = () => {
      if (pt) return;
      pt = setTimeout(() => { pt = 0; paint(); }, 140);
    };
    ["ftProjectFormat", "ftEpFormat", "ftName", "ftLevel", "ftDate", "ftUser", "ftEps", "ftEpPadding"]
      .forEach((id) => {
        const n = $(id);
        if (n) { n.addEventListener("input", paintSoon); n.addEventListener("change", paintSoon); }
      });
    setTimeout(paint, 200);
    setTimeout(paint, 700);
  }

  function paintRes(fold, sampleNode) {
    const res = fold.querySelector(".nf-res b");
    if (!res) return;
    const txt = typeof sampleNode === "string"
      ? sampleNode.trim()
      : (sampleNode && sampleNode.textContent ? sampleNode.textContent.trim() : "");
    res.textContent = txt && txt !== "—" ? txt : "（填完参数后显示）";
  }

  /* 第二页（批量分组）的格式块：不重建结构，只把它拉齐成第一页的三级行形态
     ——标题行降级由 CSS 负责，这里只把「规则输入」和「样例/编辑」并进同一行两列。 */
  function wrapRuleRow(fold) {
    if (!fold || fold.querySelector(".nf-line")) return;
    const field = fold.querySelector(".field");
    const res = fold.querySelector(".nf-res") || fold.querySelector(".inner");
    if (!field || !res) return;
    fold.classList.add("nf-block");
    const line = el("div", "nf-line");
    field.parentNode.insertBefore(line, field);
    line.appendChild(field);
    line.appendChild(res);
  }

  /* 一个格式块：标题行 + 输入 + 结果 + ＋ 浮层 */  function buildFormatBlock(fold, inputId, sampleId, isEpisode) {
    if (fold.dataset.nfBuilt) return;
    fold.dataset.nfBuilt = "1";
    const inp = $(inputId);
    if (!inp) return;
    const field = inp.closest(".field");
    const summary = fold.querySelector("summary");

    /* 旧标题右侧那个「{片名}{等级}…」速览：结果行已经给了真实样例，它只会重复 */
    const fv = summary && summary.querySelector(".fold-value");
    if (fv) fv.classList.add("nf-hide");

    /* 标题行右侧：＋ 菜单（集数块再加位数选择） */
    const add = el("button", "nf-add", "＋");
    add.type = "button";
    add.title = "插入字段 / 分隔符 / 预设";
    add.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pop = fold.querySelector(".nf-pop");
      if (!pop) return;
      const on = pop.classList.toggle("on");
      /* 两个格式块的浮层别同时开着 */
      if (on) document.querySelectorAll(".nf-pop.on").forEach((p) => { if (p !== pop) p.classList.remove("on"); });
    });
    if (summary) {
      summary.appendChild(add);
      if (isEpisode) {
        const pad = $("ftEpPadding");
        const padField = pad && pad.closest(".field");   /* 先记下原位置，搬走之后就查不到了 */
        if (pad) {
          const wrap = el("span", "nf-pad");
          wrap.appendChild(el("i", null, "位数"));
          wrap.appendChild(pad);
          summary.insertBefore(wrap, add);
          if (padField) padField.classList.add("nf-hide");
        }
      }
    }

    /* 结果行：挂在格式串同一行的右侧（宽窗同行、窄窗回落到下一行，见 CSS .nf-line） */
    if (field && !fold.querySelector(".nf-res")) {
      field.insertAdjacentHTML("afterend",
        '<div class="nf-res"><i>→</i><b>（填完参数后显示）</b></div>');
    }
    const resLine = fold.querySelector(".nf-res");
    if (field && resLine && !fold.querySelector(".nf-line")) {
      const line = el("div", "nf-line");
      field.parentNode.insertBefore(line, field);
      line.appendChild(field);
      line.appendChild(resLine);
    }

    /* ＋ 浮层：字段条 / 分隔符 / 预设都搬进来 */
    const pop = el("div", "nf-pop");
    const chips = fold.querySelector(".format-fields");
    const presets = fold.querySelector(".format-presets");
    if (chips) {
      pop.appendChild(el("div", "nf-sec", "插入字段"));
      const box = el("div", "nf-row");
      box.appendChild(chips);
      pop.appendChild(box);
    }
    pop.appendChild(el("div", "nf-sec", "分隔符"));
    const seps = el("div", "nf-row nf-seps");
    [["_", "_"], ["-", "-"], ["·", "·"], ["空格", " "]].forEach(([txt, ch]) => {
      const b = el("button", "btn ghost sm", txt);
      b.type = "button";
      b.addEventListener("click", () => {
        inp.focus();
        inp.setRangeText(ch, inp.selectionStart, inp.selectionEnd, "end");
        inp.dispatchEvent(new Event("input", { bubbles: true }));
      });
      seps.appendChild(b);
    });
    pop.appendChild(seps);
    if (presets) {
      pop.appendChild(el("div", "nf-sec", "快捷预设"));
      const box = el("div", "nf-row");
      box.appendChild(presets);
      pop.appendChild(box);
    }
    fold.appendChild(pop);
    fold.classList.add("nf-block");
    /* 点浮层以外的地方收起 */
    document.addEventListener("click", (e) => {
      if (!fold.contains(e.target)) pop.classList.remove("on");
    });
    /* 应用写样例的元素留在原地别删，只是不显示；结果行读它的文本 */
    const sample = sampleId && $(sampleId);
    if (sample) {
      const holder = sample.closest(".inner");
      if (holder) holder.classList.add("nf-hide");
    }
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
    /* 提案图左角是 30px 的「RE」方块 + 版本胶囊，不是位图 logo：
       位图缩到 30px 后「RENAME PROJECT」挤成一团灰糊，也是看着丑的一处 */
    const logo = header.querySelector("img.brand-mark");
    if (logo && !header.querySelector(".ui-rebadge")) {
      const verText = (($("statusVersion") && $("statusVersion").textContent) || "").split("|").pop().trim() || "v4.3.9";
      const badge = el("div", "ui-rebadge", "RE");
      logo.replaceWith(badge);
      badge.after(el("span", "ver", verText));
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
    /* 示例表不是真实计划，计数位写「示例」，别让人误以为有 4 个待处理 */
    if (tbl.querySelector("table.ui-demo")) { if (shown) shown.textContent = "示例"; return; }
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
    if (plan && plan.html && !/ui-demo/.test(plan.html)) {
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
      /* 示例表不进「上一次计划」，否则下次启动会把示例当真实记录恢复 */
      if (tbl.querySelector("table.ui-demo")) return;
      if (tbl.querySelector(".empty")) return;
      lsSet(K_PLAN, { html: tbl.innerHTML, at: stamp() });
    }).observe(tbl, { childList: true, subtree: true });
    /* 示例态的「示例预览（未生成）」标签由 ui-refine.css 的 :has 规则给出，
       应用 renderPlan 频繁改写 #planTag，JS 抢不过也没必要抢 */
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
    /* 组头不再回显项目根格式：它和折叠里的输入框是同一个值，重复写三遍反而看不清这组管什么 */
    put("uiGroupFt3", "项目根 · 集数 · 工程文件");
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
    updateFolderRail();
  }
  /* ═══ 右侧建立信息栏（2026-11-18）═══════════════════════════════════════
     只读左侧参数与目录树文本，不参与计划计算；拿不到数据时显示「—」而不是猜数字。 */
  function treeLines() {
    const pre = $("ftPreview");
    const txt = pre ? (pre.textContent || "") : "";
    return txt ? txt.split("\n") : [];
  }
  function countTree() {
    const c = { cats: [], eps: 0, ptx: 0 };
    const pre = $("ftPreview");
    if (pre && pre.classList.contains("ui-demo")) return c;   /* 示例不算数 */
    treeLines().forEach((l) => {
      const s = l.trim();
      if (!s) return;
      /* 顶部分类行：只有一个「├── / └──」前缀且后面没有反斜杠（Project 也在其中） */
      const m = s.match(/^[├└]──\s+(?!.*\\)([^\\]+)$/);
      if (m) { if (c.cats.indexOf(m[1]) < 0) c.cats.push(m[1]); return; }
      if (/\.ptx$/i.test(s)) { c.ptx += 1; return; }
      if (/Project\\/.test(s) && /集$/.test(s)) c.eps += 1;
    });
    return c;
  }
  function escHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  /* 分类行加粗：只把行包进 span，文字一字不改；下次 re.js 重写文本后自动重刷 */
  function paintCatLines() {
    const pre = $("ftPreview");
    if (!pre) return;
    const txt = pre.textContent || "";
    if (!txt.trim() || pre.querySelector(".catline")) return;
    const top = pre.scrollTop;
    pre.innerHTML = txt.split("\n").map((l) =>
      (/^[├└]──\s+(?!.*\\)([^\\]+)$/.test(l.trim()) ? '<span class="catline">' + escHtml(l) + "</span>" : escHtml(l))
    ).join("\n");
    pre.scrollTop = top;
  }
  function put(id, text) { const n = $(id); if (n) n.textContent = text; }
  function updateFolderRail() {
    if (!booted) return;
    const c = countTree();
    const steps = c.cats.length + c.eps + c.ptx;
    const has = steps > 0;
    put("railSteps", has ? steps : "—");
    put("railUnit", has ? "步" : "");
    put("railCats", c.cats.length || "—");
    put("railEps", c.eps || "—");
    put("railPtx", c.ptx || "—");
    put("railExpr", has ? c.cats.length + " + " + c.eps + " + " + c.ptx : "—");
    put("railTotal", has ? "= " + steps : "= —");
    /* 预检状态：只认日志里出现的结论，不猜 */
    const pv = $("railPrecheck");
    if (pv) {
      pv.classList.remove("ok", "bad");
      if (precheckState === "ok") { pv.textContent = "预检通过 · 可建立"; pv.classList.add("ok"); }
      else if (precheckState === "bad") { pv.textContent = "预检发现问题 · 先修正"; pv.classList.add("bad"); }
      else pv.textContent = "未预检 · 冲突未确认";
    }
    const dp = $("ftDropParent");
    put("railOutRule", dp ? (dp.checked ? "工程根父级" : "工程根") : "—");
    const sk = $("ftSkip");
    put("railExistRule", sk ? (sk.checked ? "跳过" : "不跳过") : "—");
    const eps = $("ftEps") ? $("ftEps").value.trim() : "";
    put("railEpsRule", eps ? eps + (c.eps ? " · " + c.eps + " 集" : "") : "—");
    put("railTplPath", ($("ftTplRoot") && $("ftTplRoot").value.trim()) || "—");
    put("railOutPath", ($("ftOutRoot") && $("ftOutRoot").value.trim()) || "—");
    const chips = $("railCatChips");
    if (chips) chips.innerHTML = c.cats.map((n) => "<span>" + escHtml(n) + "</span>").join("");
    paintCatLines();
  }
  /* 树文本一变就重算右栏与结论条；文本没变（例如自己刚插入 span）不重算，防循环 */
  let lastTreeText = null;
  function observeTreeForRail() {
    const pre = $("ftPreview");
    if (!pre || pre.dataset.railObserved) return;
    pre.dataset.railObserved = "1";
    new MutationObserver(() => {
      const pre2 = $("ftPreview");
      if (!pre2) return;
      const now = pre2.textContent || "";
      const isDemo = !!pre2.dataset.demoText && now === pre2.dataset.demoText;
      if (isDemo) return;
      pre2.classList.remove("ui-demo");
      delete pre2.dataset.demoText;
      if (now === lastTreeText) return;
      lastTreeText = now;
      if (looksPlaceholder(now)) { renderFolderDemo(); return; }
      updateFolderRail();
      if (typeof updateVerdicts === "function") updateVerdicts();
    }).observe(pre, { childList: true, characterData: true, subtree: true });
  }
  /* 左栏参数变化 → 右栏跟着变（含开关与路径输入） */
  function bindRailInputs() {
    ["ftTplRoot", "ftOutRoot", "ftEps", "ftSkip", "ftDropParent"].forEach((id) => {
      const n = $(id);
      if (!n || n.dataset.railBound) return;
      n.dataset.railBound = "1";
      ["input", "change"].forEach((ev) => n.addEventListener(ev, updateFolderRail));
    });
  }
  /* ═══ 项目根实时预览行 + 集数格式提示 ═══ */
  function projectRootName() {
    const v = (id) => ($(id) ? $(id).value.trim() : "");
    const seq = v("ftSeq"), name = v("ftName"), lv = v("ftLevel"), dt = v("ftDate"), us = v("ftUser");
    if (!name) return "";
    return (seq ? seq + "-" : "") + name + lv + (dt ? "_" + dt : "") + (us ? "_" + us : "");
  }
  function updateRootLive() {
    const box = $("uiRootLive");
    if (!box) return;
    const root = ($("ftOutRoot") && $("ftOutRoot").value.trim()) || "";
    const nm = projectRootName();
    const b = box.querySelector("b");
    if (!b) return;
    if (!nm) { b.textContent = "（填项目名后显示）"; return; }
    b.textContent = root ? root.replace(/[\\/]+$/, "") + "\\" + nm : nm;
  }
  function bindRootLive() {
    ["ftName", "ftSeq", "ftLevel", "ftDate", "ftUser", "ftOutRoot"].forEach((id) => {
      const n = $(id);
      if (!n || n.dataset.rootBound) return;
      n.dataset.rootBound = "1";
      ["input", "change"].forEach((ev) => n.addEventListener(ev, updateRootLive));
    });
  }
  /* ── 结论条：把「改了参数会怎样」写回左栏底部，而不是只进右侧标签或日志 ── */
  let precheckState = "";          // "" 未预检 | "ok" 通过 | "bad" 有问题
  function updateVerdicts() {
    const S = (typeof state === "undefined") ? null : state;
    const vr = $("uiVerdict-run");
    if (vr) {
      const t = vr.querySelector(".ui-vt"), sub = vr.querySelector(".ui-vsub");
      const total = S ? (S.items || []).length : 0;
      const conf = S ? (S.stats.conflict || 0) : 0;
      const err = S ? (S.stats.error || 0) : 0;
      const ready = !!(S && S.planReady);
      vr.classList.toggle("ok", ready && !conf && !err);
      vr.classList.toggle("warn", !!(ready && (conf || err)));
      if (t) {
        t.textContent = ready ? "共 " + total + " 项待处理"
          : (S && S.planPending ? "正在生成计划…" : "尚未生成计划");
      }
      if (sub) {
        sub.textContent = ready
          ? "冲突 " + conf + " · 错误 " + err + " · " + (S.planMode === "master-only" ? "仅命名 Master" : "完整打包")
          : "选目录 → 生成计划 → 执行";
      }
    }
    const vf = $("uiVerdict-folder");
    if (vf) {
      const t = vf.querySelector(".ui-vt"), sub = vf.querySelector(".ui-vsub");
      /* 2026-11-18：结论条只留「将建几步 + 能不能建」。原先把「示例：31-…（126 步）」
         整串塞进副标题，和右栏「本次建立」重复；数字统一由 countTree() 数出来。 */
      const c = countTree();
      const steps = c.cats.length + c.eps + c.ptx;
      const okTree = steps > 0;
      vf.classList.toggle("ok", !!okTree && precheckState === "ok");
      vf.classList.toggle("warn", precheckState === "bad");
      if (t) t.textContent = okTree ? "将建 " + steps + " 步" : "尚未生成目录树";
      if (sub) {
        sub.textContent = okTree
          ? (precheckState === "ok" ? "预检通过 · 可建立"
            : precheckState === "bad" ? "预检发现问题 · 先修正"
            : "未预检 · 冲突未确认")
          : "刷新预览后可预检";
      }
    }
    updateFolderRail();
  }
  /* 预检结果只写进日志（re.js 里没有可读的返回字段），这里回读日志末条，
     把结论搬到左栏；只认「预检通过 / 预检发现」，不猜。 */
  function watchPrecheck() {
    const box = $("log");
    if (!box) return;
    new MutationObserver(() => {
      const lines = Array.from(box.children).map((n) => n.textContent || "");
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (lines[i].indexOf("预检通过") > -1) { precheckState = "ok"; break; }
        if (lines[i].indexOf("预检发现") > -1) { precheckState = "bad"; break; }
      }
      updateVerdicts();
    }).observe(box, { childList: true, subtree: true, characterData: true });
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
    [["uiModeAll", "all", "完整打包"],
     ["uiModeMaster", "master-only", "仅命名 Master"]].forEach(([id, mode, label]) => {
      const b = $(id);
      if (!b) return;
      const active = curMode === mode;
      b.textContent = label;
      b.classList.toggle("primary", active);
      b.classList.toggle("ghost", !active);
      b.disabled = locked;
      b.setAttribute("aria-pressed", String(active));
    });
    /* 执行按钮：只在计划就绪、模式未变、有可改名项时可用。 */
    const exec = $("uiExec");
    if (exec) {
      const canRun = ready && n > 0 && !locked;
      exec.disabled = !canRun;
      exec.textContent = "▶ 执行重命名" + (ready && n > 0 ? " · " + n + " 项" : "");
    }
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

  /* ═══ 2026-11-18 · 默认页 / 上次页 / 说明气泡 / 示例预览 ═══════════════════
     1) 启动默认落在「新建工程目录」；若上次用过别的页，恢复上次那页
     2) 左栏说明文字收进组头「i」气泡，hover 才出现
     3) 两页没有真实数据时给浅色示例，避免大片空白 */
  const KNOWN_PAGES = ["rule", "target", "run", "undo", "folder"];
  const K_PAGE = "re-ui-refine/page/v1";

  function rememberPage() {
    document.addEventListener("click", (e) => {
      const tab = e.target.closest('nav.naming-nav [id^="tab-"], nav.tabs [id^="tab-"]');
      if (!tab) return;
      const p = tab.id.slice(4);
      if (p && KNOWN_PAGES.indexOf(p) > -1) lsSet(K_PAGE, p);
      if (p === "run") setTimeout(renderRunDemo, 60);
      if (p === "folder") setTimeout(renderFolderDemo, 60);
    }, true);
  }
  function restoreStartPage() {
    if (typeof goto !== "function") return;
    const saved = lsGet(K_PAGE);
    const page = (saved && KNOWN_PAGES.indexOf(saved) > -1) ? saved : "folder";
    try { goto(page); } catch (e) {}
  }

  /* 说明气泡：hover「i」才展开，点击不触发组折叠 */
  function initTipLayer() {
    if ($("uiTip")) return;
    const tip = el("div", null, "");
    tip.id = "uiTip";
    document.body.appendChild(tip);
    document.addEventListener("mouseover", (e) => {
      const t = e.target.closest(".ui-info");
      if (!t) return;
      const txt = t.dataset.tip || "";
      if (!txt) return;
      tip.textContent = txt;
      tip.style.display = "block";
      tip.style.left = "0px";
      tip.style.top = "0px";
      const r = t.getBoundingClientRect();
      const w = Math.min(330, window.innerWidth - 24);
      tip.style.maxWidth = w + "px";
      const bw = tip.offsetWidth || w, bh = tip.offsetHeight || 0;
      /* 优先放「i」右侧；若仍落在卡片内部会压住控件，就推到卡片右外侧 */
      let left = r.right + 10;
      const card = t.closest(".card");
      if (card) {
        const cr = card.getBoundingClientRect();
        if (left < cr.right + 8) left = cr.right + 14;
      }
      if (left + bw > window.innerWidth - 12) left = r.left - bw - 10;
      if (left < 12) left = Math.max(12, Math.min(r.left - 8, window.innerWidth - bw - 12));
      let top = r.bottom + 8;
      if (top + bh > window.innerHeight - 12) top = Math.max(12, r.top - bh - 8);
      tip.style.left = left + "px";
      tip.style.top = top + "px";
    });
    document.addEventListener("mouseout", (e) => {
      if (e.target.closest(".ui-info")) tip.style.display = "none";
    });
    window.addEventListener("scroll", () => { tip.style.display = "none"; }, true);
  }
  /* 把组内所有说明收进组头的「i」；动态状态行（如拖入提示）保留可见 */
  function tipifyNotes(card) {
    if (!card) return;
    card.querySelectorAll(".ui-group").forEach((g) => {
      if (g.dataset.tipped) return;
      const notes = Array.from(g.querySelectorAll(".ui-note, .note, .ui-fhint"))
        .filter((n) => n.id !== "ftDropStatus" && n.id !== "runDropStatus");
      const texts = notes.map((n) => n.textContent.trim()).filter(Boolean);
      if (!texts.length) return;
      g.dataset.tipped = "1";
      notes.forEach((n) => { n.style.display = "none"; });
      const sum = g.querySelector("summary");
      if (!sum) return;
      const dot = el("i", "ui-info", "i");
      dot.dataset.tip = texts.join("\n");
      dot.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); });
      sum.appendChild(dot);
    });
  }

  /* 示例树：浅色，只作形状示意；一旦出现真实树就自动让位 */
  function demoFolderTree() {
    const nm = projectRootName() || "片名D_261116_7F";
    const cats = ["Ai-FX", "Audio", "FinalMix", "Project", "Revision", "Video"];
    const out = ["（示例）分类目录与集数结构如下，刷新预览后替换为真实计划", ""];
    cats.slice(0, 3).forEach((c) => out.push("├── " + c));
    out.push("├── Project");
    [1, 2, 3].forEach((i) => {
      const ep = nm.split("D_")[0] + " " + String(i).padStart(2, "0") + "集";
      out.push("│   ├── Project\\" + ep);
      out.push("│   │   └── Project\\" + ep + "\\" + ep + ".ptx");
    });
    out.push("│   └── …（共 N 集）");
    cats.slice(4).forEach((c) => out.push("└── " + c));
    return out.join("\n");
  }
  function looksPlaceholder(t) {
    const s = (t || "").trim();
    return !s || /^[（(]/.test(s) || /演示态/.test(s);
  }
  function renderFolderDemo() {
    const pre = $("ftPreview");
    if (!pre) return;
    if (!looksPlaceholder(pre.textContent)) {
      pre.classList.remove("ui-demo");
      delete pre.dataset.demoText;
      return;
    }
    if (pre.classList.contains("ui-demo")) return;
    const txt = demoFolderTree();
    pre.textContent = txt;
    pre.dataset.demoText = txt;
    pre.classList.add("ui-demo");
    const tag = $("ftExample");
    if (tag && (!tag.textContent.trim() || tag.textContent.trim() === "规划中")) tag.textContent = "示例（未生成）";
  }

  /* 示例计划表：仅在「还没生成计划」的空态下出现 */
  function renderRunDemo() {
    const host = $("planTbl");
    if (!host) return;
    if (host.querySelector("table")) return;            /* 已有真实计划 */
    const empty = host.querySelector(".empty");
    if (!empty) return;
    const msg = empty.textContent || "";
    if (!/先选目录|点「生成计划」|没有文件/.test(msg)) return;   /* 正在生成/已取消之类不动 */
    if (host.querySelector("table.ui-demo")) return;
    const rows = [
      ["示例", "MIX", "\\31-片名D_261116_7F\\Audio\\片名 01集_MIX.wav", "\\Audio\\片名 01集_MIX.wav", "同名归位"],
      ["示例", "STEM", "\\导出\\片名 02集_DX.wav", "\\Audio\\片名 02集_DX STEM.wav", "分轨改名"],
      ["示例", "AIFX", "\\素材\\枪声.wav", "\\Ai-FX\\片名 03集\\枪声.wav", "按集归位"],
      ["示例", "MIX", "\\旧\\片名 04集_mix.wav", "\\Audio\\片名 04集_MIX.wav", "大小写统一"]
    ];
    host.innerHTML = "<table class=\"ui-demo\"><thead><tr>" +
      "<th style='width:64px'>状态</th><th style='width:56px'>目标</th><th style='width:190px'>原路径</th>" +
      "<th>目标路径</th><th style='width:150px'>说明</th><th style='width:56px'></th>" +
      "</tr></thead><tbody>" +
      rows.map((r) => "<tr><td>" + r[0] + "</td><td>" + r[1] + "</td><td>" + escHtml(r[2]) + "</td><td>" + escHtml(r[3]) + "</td><td>" + r[4] + "</td><td></td></tr>").join("") +
      "</tbody></table><div class=\"ui-demo-note\">示例数据 · 生成计划后替换为真实条目</div>";
    /* 标签交给 ui-refine.css（:has(table.ui-demo)），不与应用抢写 #planTag */
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
      bindRailInputs();
      bindRootLive();
      updateRootLive();
      observeTreeForRail();
      initTipLayer();
      tipifyNotes(document.querySelector("#page-folder .cols>.card:first-child"));
      tipifyNotes(document.querySelector("#page-run .cols>.card:first-child"));
      renderFolderDemo();
      renderRunDemo();
      rememberPage();
      restoreStartPage();
      updateFlow();
      applyModeLock((typeof state !== "undefined" && state) ? state.planMode : "all");
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
    if (booted) { updateFlow(); updateSummaries(); updateVerdicts(); renderTargetTree(); applyModeLock(state ? state.planMode : "all"); }
    autoRefreshTree();
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  setTimeout(boot, 700);
})();


