"""Apply the same release-file policy to each independent application."""
from pathlib import Path
import fnmatch
import importlib.metadata
import json
import shutil
import sys

#: 发布包不该带的东西（本地备份、字节码、编辑器残留）。与 build_v4.EXCLUDE_PATTERNS 同口径。
EXCLUDE_PATTERNS = ("*.bak*", "*.pyc", "*.pyo", "*.tmp", "*.orig", "*.rej", "*~")

#: 各 App 自己的页面与脚本。
OWN_FILES = {
    "pt": ("index.html", "js/app.js"),
    "jy": ("jy.html", "js/jy.js"),
    "re": ("re.html", "js/re.js"),
}

#: 只属于其他 App 的静态资源：本包用不到，删掉可省 291 KB。
#: re.html 只引 branding/brand.png（仓库版）或 branding/r.svg（旧版）与 icons/re/app.ico。
FOREIGN_ASSETS = {
    "pt": ("branding/p.png", "branding/p.svg", "branding/j.png", "branding/j.svg",
           "branding/brand.png", "branding/r.png", "branding/r.svg", "icons/jy", "icons/re",
           "jy-workbench.css"),
    "jy": ("branding/p.png", "branding/p.svg", "branding/j.png", "branding/j.svg",
           "branding/brand.png", "branding/r.png", "branding/r.svg", "icons/pt", "icons/re",
           "jy-workbench.css"),
    "re": ("branding/p.png", "branding/p.svg", "branding/j.png", "branding/j.svg",
           "branding/r.png", "branding/r.svg", "icons/pt", "icons/jy", "jy-workbench.css"),
}


def _is_excluded(path: Path) -> bool:
    return any(fnmatch.fnmatch(path.name, pat) for pat in EXCLUDE_PATTERNS)


#: 许可文件名主干（不区分大小写）。
LICENSE_STEMS = ("license", "licence", "copying", "notice", "authors", "unlicense")
#: 编译产物永远不是许可文本：packaging/licenses/__init__.pyc 这类会被误判。
SKIP_SUFFIXES = (".pyc", ".pyo", ".pyd", ".so", ".dll", ".pdb")


def _is_license(relative) -> bool:
    """判断 pip 记录里的一条路径是不是许可文本。

    旧写法只看路径里有没有 "license" 字样，于是 4.3.9 的构建把
    ``packaging/licenses/__init__.cpython-312.pyc`` 当成许可去复制，
    在只读缓存上抛 WinError 32 直接中断整个发布。
    """
    if relative.suffix.lower() in SKIP_SUFFIXES:
        return False
    if relative.stem.lower().split(".")[0] in LICENSE_STEMS:
        return True
    # PEP 639：<dist-info>/licenses/ 下的纯文本才算
    parts = [p.lower() for p in relative.parts]
    if "licenses" in parts and relative.suffix.lower() in (".txt", ".md", ".rst"):
        return True
    return False


def _prune_web(web: Path, key: str) -> list:
    """删除备份件、其他 App 的页面与资源，返回被删的相对路径清单。"""
    removed = []
    for path in sorted(web.rglob("*"), key=lambda p: -len(p.parts)):
        if not path.exists():
            continue
        rel = path.relative_to(web).as_posix()
        if _is_excluded(path):
            if path.is_file():
                path.unlink()
                removed.append(rel)
            continue
        for other, files in OWN_FILES.items():
            if other == key:
                continue
            if rel in files:
                path.unlink()
                removed.append(rel)
                break
        else:
            for asset in FOREIGN_ASSETS.get(key, ()):
                if rel == "assets/" + asset or rel.startswith("assets/" + asset + "/"):
                    if path.is_dir():
                        shutil.rmtree(path)
                    else:
                        path.unlink()
                    removed.append(rel)
                    break
    return removed


def finish_distribution(app, repo, key):
    app, repo = Path(app), Path(repo)
    for filename in ("使用说明.md", "Install-Dependencies.ps1", "Install-Dependencies.cmd"):
        shutil.copy2(repo / "packaging" / filename, app / filename)
    shutil.copy2(repo / "LICENSE", app / "LICENSE")
    web = app / "_internal/web"
    _prune_web(web, key)
    for folder in (app / "_internal/api", app / "_internal/shell"):
        for path in folder.rglob("*"):
            if path.is_file() and path.suffix in (".pyc", ".pyo"):
                path.unlink()
    third = app / "THIRD_PARTY"
    third.mkdir(exist_ok=True)
    records = []
    skipped = []
    for distribution in importlib.metadata.distributions():
        name = distribution.metadata["Name"]
        for relative in distribution.files or ():
            if ".." in relative.parts or not _is_license(relative):
                continue
            source = Path(distribution.locate_file(relative))
            if not source.is_file():
                continue
            target = third / name / relative
            try:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
            except OSError as exc:
                # 单个许可文件被占用/只读不该让整个发布失败；记下来最后统一提示
                skipped.append("%s / %s（%s）" % (name, relative.as_posix(),
                                                 getattr(exc, "strerror", None) or exc))
        records.append({"name": name, "version": distribution.version})
    (third / "build-dependencies.json").write_text(
        json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    if skipped:
        print("[v4-pack] WARN 有 %d 个第三方许可文件未能归档（已跳过，不影响发布）：" % len(skipped))
        for line in skipped[:10]:
            print("  - " + line)
    shutil.copy2(Path(sys.base_prefix) / "LICENSE.txt", third / "Python-LICENSE.txt")
