# Windows 0.1.1 验收记录

验收日期：2026-10-09。平台：Windows x64，Node 24.12.0，Electron 44.6.0。

## 已通过

- `pnpm --dir apps/desktop type-check`：TypeScript 检查通过。
- `pnpm --dir apps/desktop lint`：桌面 UI、主进程、预加载和测试脚本检查通过。
- `pnpm --dir apps/desktop test`：10 项测试全部通过，包括 WBI 签名、账户凭据隔离、CDN 重定向限制、Range/206、存储往返、歌词解析。
- `pnpm --dir apps/desktop dist:win`：安装包、便携程序和解包后的应用全部生成。
- 开发 Electron 和打包后 `release/win-unpacked/BBPlayer.exe` 均通过完整烟雾测试。
- 发布便携程序通过 `pnpm --dir apps/desktop smoke:portable` 的实际启动、搜索、播放、拖动进度、暂停和关闭测试。

真实接口验收使用公开 MV `BV1GJ411x7h7`。HTMLAudio 识别的时长为 212.308833 秒，播放后 readyState 为 4。Range 请求返回 HTTP 206 和 1024 字节。便携版实际跳转到 60.003194 秒并暂停，渲染进程没有运行错误。

本次更新还验证了蓝白主题与原图一致的界面标识，检查了 7 尺寸 ICO，并从打包后的主程序、安装包和便携程序提取关联图标，均为新图标；可执行文件版本为 0.1.1。

完整烟雾测试还验证了：

- 真正的登录二维码生成和 UI 展示（未扫码确认）。
- 新建歌单、喜欢、最近播放、添加歌曲和手动 LRC。
- 重启后歌单、作者元数据、喜欢、历史和歌词恢复。
- JSON 导出、导入并合并歌单，备份不包含 Cookie。此处由测试替换系统文件选择对话框返回路径，实际 IPC 和文件读写代码仍正常执行。
- 沙箱界面中没有 Node `require`。

## 产物

| 文件 | 字节数 | SHA256 |
| --- | ---: | --- |
| `release/BBPlayer-0.1.1-x64-Portable.exe` | 114251110 | `0F64C426C0F5032EEAF0A53226D125ABD01B8D846E2AEF7ACFA334F2216896C8` |
| `release/BBPlayer-0.1.1-x64-Setup.exe` | 114551262 | `B8DF3B8B21ED2F7A2C49DB945AEDE632A502E664BECED1A3B51212568E83C95E` |

界面截图位于 `test-results/desktop-home.png`、`desktop-playback.png` 和 `portable-playback.png`。主页截图同时复制到根目录 `docs/images/desktop-home.png`，供 README 展示；其余验收截图和构建产物在本地保留，不纳入源码。

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
