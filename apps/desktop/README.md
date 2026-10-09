# BBPlayer Windows Desktop

首版桌面应用，React + Vite + Electron。需要 Windows 10/11 x64。

## 已实现

- 关键词、BV 号和完整 B 站视频链接搜索，结果分页。
- AAC 音频播放、拖动进度、音量、播放队列、随机和单曲/列表循环。
- 多分 P 视频选择（播放队列弹窗）。
- B 站扫码登录、账户退出、创建的收藏夹及分页。
- 本地歌单、喜欢、最近播放，自动保存。
- 手动 LRC 歌词、时间同步、歌单 JSON 导入/导出。
- Windows 媒体按键、空格暂停、Ctrl + 左右切歌。
- Windows 安装包和便携程序构建。
- 0.1.2：音频错误和缓冲超时后刷新地址，断网重连恢复，保留分 P 和进度；最多重试 3 次，暂停取消自动恢复。
- 托盘后台播放和菜单控制，关闭时询问或按偏好后台播放/退出。
- 启动后恢复队列、当前歌曲、进度、随机模式、本地页面、窗口和关闭偏好，保持暂停。
- 0.1.3：正式 Release 版本检查，安装版下载后校验 SHA256、由用户确认安装；便携版提供发布页入口，GitHub API 限流时使用发布页备用版本检查。

## 开发与构建

在仓库根目录运行，使用 Node 24 + pnpm 11.21 或兼容版本：

```powershell
pnpm --dir apps/desktop install
pnpm --dir apps/desktop dev
pnpm --dir apps/desktop build
pnpm --dir apps/desktop start
pnpm --dir apps/desktop type-check
pnpm --dir apps/desktop lint
pnpm --dir apps/desktop test
pnpm --dir apps/desktop smoke
pnpm --dir apps/desktop smoke:portable
pnpm --dir apps/desktop dist:win
pnpm --dir apps/desktop smoke:update
```

安装包在 `apps/desktop/release`。桌面有独立的 pnpm workspace/lockfile，避免安装 Android/Expo 工具链；根 workspace 的已有 mobile 检查仍需根依赖。

## 图标与主题

0.1.1 使用蓝白主题，主色为 `#0099ff`。用户提供的原始图标保存在 `build/icon-source.png`，界面图标为 `public/app-icon.png`，Windows 图标为 `build/icon.ico`，含 16、24、32、48、64、128、256 像素尺寸。

替换原图后，在 Windows PowerShell 中重新生成图标，再打包：

```powershell
& ./apps/desktop/scripts/build-icon.ps1
pnpm --dir apps/desktop dist:win
```

生成脚本只缩放原图并裁出透明圆角，不重绘图案。界面主题样式位于 `src/style.css`。

## 架构

- `electron/api.mjs`：固定 B 站 API，WBI 签名沿用 mobile 算法。网络在主进程执行。
- `electron/main.mjs`：窄 IPC 接口、Windows 凭据加密、本地原子写入、资源协议。
- `bbmedia://audio/<token>`：仅转发 API 返回的可信 B 站 CDN，支持 Range/206；不向渲染进程暴露 Cookie，不向 CDN 发送账户凭据。
- `src`：桌面 UI 和 HTMLAudio 播放。纯 Web 版需要另配 API/音频服务。
- `src/player.ts`：带请求代次的播放控制器，负责新地址加载、进度恢复、有界重试与断网恢复；`usePlayback.ts` 将它接入 React。
- `electron/updater.mjs`：固定 GitHub Release 来源、语义版本比较、可信下载重定向、文件大小与 SHA256 校验。主进程使用 Electron net 获取更新，以支持系统代理。
- `tests`：签名、存储往返、登录、CDN/重定向限制、Range 流和歌词解析检查。
- `scripts/smoke.mjs`：启动真实 Electron，播放公开 MV、拖动进度、保存歌单和重启验收；使用独立临时数据目录，不改变用户账号。

账户用 Electron safeStorage（Windows DPAPI）加密，歌单保存在 Electron userData 目录。JSON 备份不包含登录凭据。

`session.json` 单独保存队列和使用状态，每 5 秒保存进度，正常退出前再保存一次；`window.json` 保存窗口位置和大小。重启时不复用临时音频 URL，点击播放后获取新地址。JSON 歌单备份不包含这两种状态文件。

旧版需先手动覆盖安装 0.1.3 一次，后续可通过左下角“检查更新”下载并校验安装包。点击安装后保存状态、打开 NSIS 向导并退出程序，需完成向导；便携版需退出后自行替换程序。启动后 10 秒检查更新，此后每 6 小时检查，仅正式 Release 生效。开发环境只检查版本，不下载或安装。

## 首版范围

还未移植离线下载、音频文件导出、自动歌词匹配、桌面悬浮歌词、网易云/QQ 歌单导入和 Android 主题装扮。登录完成及私人收藏夹需用户本人扫码验收；未登录也能搜索/播放公开视频。B 站接口限流或视频下架会显示错误。

构建产物当前没有代码签名。原项目 MIT 许可证继续适用。

已完成的测试、产物和未验证范围见 [VERIFICATION.md](./VERIFICATION.md)。
