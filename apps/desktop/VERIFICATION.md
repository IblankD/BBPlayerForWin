# Windows 0.1.2 验收记录

验收日期：2026-10-09。平台：Windows x64，Node 24.12.0，Electron 44.6.0。

## 已通过

- `pnpm --dir apps/desktop type-check`：TypeScript 检查通过。
- `pnpm --dir apps/desktop lint`：桌面 UI、主进程、预加载和测试脚本检查通过。
- `pnpm --dir apps/desktop test`：18 项测试全部通过，包括 WBI 签名、账户凭据隔离、CDN 重定向限制、Range/206、存储往返、歌词解析，以及使用状态迁移、过期地址恢复、断网恢复、旧请求隔离、暂停取消重试、不可用视频停止重试、有界重试和缓冲超时。
- `pnpm --dir apps/desktop dist:win`：安装包、便携程序和解包后的应用全部生成。
- 开发 Electron 和打包后 `release/win-unpacked/BBPlayer.exe` 均通过完整烟雾测试。
- 发布便携程序通过 `pnpm --dir apps/desktop smoke:portable` 的实际启动、搜索、播放、拖动进度、暂停和关闭测试。

真实接口验收使用公开 MV `BV1GJ411x7h7`。HTMLAudio 识别的时长为 212.308833 秒，播放后 readyState 为 4。便携版实际跳转到 60.011303 秒并暂停，渲染进程没有运行错误。

沿用 0.1.1 的蓝白主题和 7 尺寸 ICO；新增关闭偏好设置，已检查实际界面显示。

完整烟雾测试还验证了：

- 真正的登录二维码生成和 UI 展示（未扫码确认）。
- 新建歌单、喜欢、最近播放、添加歌曲和手动 LRC。
- 重启后歌单、作者元数据、喜欢、历史和歌词恢复。
- JSON 导出、导入并合并歌单，备份不包含 Cookie。此处由测试替换系统文件选择对话框返回路径，实际 IPC 和文件读写代码仍正常执行。
- 沙箱界面中没有 Node `require`。
- 注入 HTMLAudio 错误事件后，获取新音频地址并从原进度继续真实播放；模拟 offline/online 事件，验证自动暂停与联网恢复。未通过物理拔网线模拟断网，持续缓冲和失败重试边界由控制器测试覆盖。
- 取消关闭、记住后台播放选择、实际隐藏窗口后继续播放；调用真实托盘菜单回调暂停、继续、显示窗口和退出。系统对话框选择由测试替换返回值，原关闭处理、菜单和托盘代码正常执行；尚未人工点击系统托盘图标。
- 重启后恢复队列、当前视频与分 P、60 秒进度、随机模式、音量、本地歌单页面、关闭偏好和窗口位置/尺寸；保持暂停且不加载旧音频地址，点击播放后取得新地址继续。
- Windows 分数缩放允许最多 2 像素的窗口恢复舍入差异；验证连续保存不会累积尺寸偏差。

## 产物

| 文件 | 字节数 | SHA256 |
| --- | ---: | --- |
| `release/BBPlayer-0.1.2-x64-Portable.exe` | 114254647 | `C3BDFEA688BD6A97EB8C93B85B1BC9FA2386FEF49F495035C3BF051D7C70D3E3` |
| `release/BBPlayer-0.1.2-x64-Setup.exe` | 114554814 | `E19C5D0D3E876093B4FB28ED06939DCAF004CFA7C2E4D0147D74FBD84B20F1FC` |

界面截图位于 `test-results/desktop-home.png`、`desktop-playback.png`、`desktop-settings.png` 和 `portable-playback.png`。主页截图另有根目录 `docs/images/desktop-home.png`，供 README 展示；其余验收截图和构建产物在本地保留，不纳入源码。

## 尚未验证或实现

- 扫码后的真实账号登录、私有收藏夹访问需要用户本人确认；当前只验证了二维码接口及登录代码的模拟响应处理。
- 安装包已成功构建，未在这台机器执行安装向导；打包的主程序和便携启动器已实际启动。
- 本首版未包含离线下载、自动歌词匹配、悬浮歌词、网易云/QQ 歌单导入。
- 产物尚未代码签名。
- 仓库根目录的 `pnpm type-check` 和 `pnpm lint` 已尝试运行，因根目录移动端依赖未安装而缺少 `tsgo` / `oxlint`，未通过全仓检查。桌面应用采用独立 workspace，上述桌面检查均通过；未改动 Android 原生代码。

## 重现打包后验收

在仓库根目录运行：

```powershell
$env:BBPLAYER_SMOKE_EXECUTABLE = "$PWD/apps/desktop/release/win-unpacked/BBPlayer.exe"
pnpm --dir apps/desktop smoke
Remove-Item Env:BBPLAYER_SMOKE_EXECUTABLE
pnpm --dir apps/desktop smoke:portable
```

测试使用临时独立用户数据目录，不需要扫码，也不修改用户已有账号。便携启动器不会转发 Playwright 的 inspector pipe，所以使用专门的 `smoke:portable` 脚本通过临时本机调试端口验收。
