# Windows 0.1.4 验收记录

验收日期：2026-10-10。平台：Windows x64，Node 24.12.0，Electron 44.6.0。

## 已通过

- `pnpm --dir apps/desktop type-check`：TypeScript 检查通过。
- `pnpm --dir apps/desktop lint`：桌面 UI、主进程、预加载和测试脚本检查通过。
- `pnpm --dir apps/desktop test`：33 项测试全部通过。覆盖签名、账户隔离、CDN/Range、存储、歌词和播放恢复，以及语义版本比较、更新来源限制、文件大小和 SHA256、安装前再次校验、取消下载、可信重定向、限流备用检查、开发/便携模式限制和安装请求顺序。
- `pnpm --dir apps/desktop dist:win`：安装包、便携程序和解包后的应用全部生成。
- 开发 Electron 和打包后 `release/win-unpacked/BBPlayer.exe` 均通过完整烟雾测试。
- 发布便携程序通过 `pnpm --dir apps/desktop smoke:portable` 的实际启动、搜索、播放、拖动进度、暂停和关闭测试。

真实接口验收使用公开 MV `BV1GJ411x7h7`。HTMLAudio 识别的时长为 212.308833 秒，播放后 readyState 为 4。便携版实际跳转到 60.01613 秒并暂停，渲染进程没有运行错误。

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

## 更新功能验收

- `pnpm --dir apps/desktop smoke:update`：在真实打包应用中打开更新界面，读取正式发布版本。验收时公共 API 限流，通过 GitHub 最新发布页确认版本；发布前检查读到当前 0.1.4、已发布的 0.1.3。
- 使用模拟未来版本和小型安装包数据，执行实际 IPC、文件下载、SHA256 校验、安装按钮及退出前保存流程；仅在网络和系统执行边界替换响应，确认下载后不会自行运行安装包。
- 点击“退出并安装更新”后，再次校验文件、保存歌单，并请求打开指定安装包和退出。系统启动函数由测试记录代替，**未执行真实安装向导或覆盖现有安装**。
- 更新界面截图保存在 `test-results/desktop-updates.png`。版本说明按普通文本显示。

## 产物

| 文件 | 字节数 | SHA256 |
| --- | ---: | --- |
| `release/BBPlayer-0.1.4-x64-Portable.exe` | 114261122 | `FFCA37703318C226DCE452F009293A333BEC759C2AF4F097ABCAF45CE25BA0D9` |
| `release/BBPlayer-0.1.4-x64-Setup.exe` | 114561275 | `7509B880C6AD119988EDAFFCF024A24B42118D4AB6A482702EC91C8720F8BA13` |

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

## 0.1.4 迁移、备份与缓存验收

- 33 项单元测试通过，新增旧格式迁移、歌词/历史/设置保留、未来 schema 拒绝覆盖、损坏原文件保留、自动恢复、备份间隔、10 份保留上限、恢复前数据保护与缓存清理保护检查。
- `smoke:migration` 实际启动 0.1.3 便携版创建歌单并设置音量，正常退出后启动 0.1.4 打包主程序读取同一临时目录。旧音乐库、会话和当前页面保留；library.json/session.json 添加 schemaVersion:1。
- 在真实界面点击立即备份，创建新歌单，再点击恢复；确认界面移除新歌单，原状态进入备份。随后在两次启动之间故意损坏 library.json，验证自动恢复最近快照并保留损坏原文件。确认对话框返回值由测试替换，文件与 IPC 流程使用生产代码。
- `smoke:update` 新增真实更新界面清理已校验安装包，再重新下载及请求安装的验收。验证退出安装前写入音量 0.37。安装执行边界仍只记录调用，未执行真实 NSIS 向导。
- 实际打包主程序通过完整播放、网络恢复、托盘和重启验收；最终便携 EXE 实际播放并拖动至 60 秒，渲染进程无错误。
- 自动更新计时器只在应用启动时创建一次，播放状态回调只刷新托盘；下载/安装期间缓存清理被拒绝，未知名称文件不删除。
- 设置恢复界面截图：test-results/desktop-backups.png。备份仅覆盖音乐库；实际账号扫码及 NSIS 覆盖安装后登录状态保留仍需人工验收。