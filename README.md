# Rename Project

版本：4.3.8（见 `VERSION`；GitHub 已发布版本为 4.3.7）。

预览并批量整理音效／影视交付目录的文件名，按目标类型归位，保留操作日志并支持撤销。规则可改并存为默认；识别模型为「目标（MIX／BUS／STEM／AIFX）＋轨道信息（原样保留）」两段。

## 目录

```text
rename-project/
├── src/
│   ├── rename-project/    主工具：code/（main.py、core_rules.py、naming_formats.py 等）、scripts/（按集归位.ps1）
│   ├── v4/              H 版外壳与 API（与 JY Tools 共用同一套外壳）
│   └── pt-tools/        与 PT 工具箱共用的扫描／导出代码
├── tests/               识别与分组回归（test_master_group.py、test_episode_recognition.py）
├── tools/               打包入口：build.py、v4_pack/build_v4.py、verify_exe.py
├── web/                 内嵌界面（index／re／jy 入口页）
├── packaging/           依赖安装脚本、锁定版本清单、使用说明
└── README.md · CHANGELOG.md · VERSION · LICENSE
```

## 跑起来

主工具 GUI：

```bash
python src/rename-project/code/main.py
```

首次运行先按 `packaging/build-requirements.txt` 装依赖；缺组件时用 `packaging/Install-Dependencies.cmd`。

## 测试与构建

```bash
python -m pytest tests -q            # 识别与分组回归
python tools/build.py re             # 构建 Rename Project
python tools/v4_pack/build_v4.py re  # H 版包
python tools/verify_exe.py           # 构建后校验
```

依赖精确版本见 `packaging/build-requirements.txt`。发行包在 [GitHub Releases](https://github.com/l7feng/rename-project/releases)，下载 ZIP 完整解压后运行 Rename Project 的 EXE（保留 `_internal`）。详细依赖与验证边界见 [使用说明](packaging/使用说明.md)。

## 已知边界

- 面向 Windows 10/11 x64；未在全新 Windows 上验收，真实交付目录只做过样本回归。
- 4.3.8 的界面细化已提交（`ec925ad`），本轮更名未动该批界面；本机另有排版样式改动未提交，发布状态以 Releases 与 tag 为准。
- `src/v4` 的 Web 界面真源在本仓之外（`D:/Ai-Files/Tools/Html/pt-audio-toolkit/source`，2026-10-14 人类裁决迁出），clone 后不能完整复现 H 版界面。
- 本仓是多工具合仓（与 JY Tools 共用 `web/`、`tools/`）；`tests/` 引用 `src/v4` 与 `src/rename-project` 两侧代码，单工具独立运行未验证。
- 撤销只覆盖最近一次操作；外部工具同时改动文件时行为未实测。

## 验证

- 回归：`python -m pytest tests -q`，覆盖识别与集数分组；不覆盖真实目录的批量改名。
- 构建：`tools/build.py` + `verify_exe.py`；当前状态以本页与 `CHANGELOG.md` 为准。
