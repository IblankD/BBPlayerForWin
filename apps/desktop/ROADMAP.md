# Windows 桌面版里程碑

更新日期：2026-10-15。版本计划以范围和验收条件为准，未来版本暂不设发布日期。

| 版本 | 状态 | 范围 | 跟踪 |
| --- | --- | --- | --- |
| 0.1.5 | 验收通过 | 数据恢复与失败一致性、队列操作、删除保护、保存失败提示 | [里程碑 1](https://github.com/IblankD/BBPlayerForWin/milestone/1) |
| 0.2.0 | 规划 | 歌单重命名、批量操作、歌曲排序、队列编辑 | [里程碑 2](https://github.com/IblankD/BBPlayerForWin/milestone/2) |
| 0.2.1 | 规划 | 深色主题、歌词自动滚动、字体设置；评估自动匹配 | [里程碑 3](https://github.com/IblankD/BBPlayerForWin/milestone/3) |

## 0.1.5 验收范围

- [#1](https://github.com/IblankD/BBPlayerForWin/issues/1)：存在有效备份时，音乐库丢失不创建空库；恢复并提示。无备份首次启动正常，未知 schema 保留原文件。
- [#2](https://github.com/IblankD/BBPlayerForWin/issues/2)：恢复中备份失败或原子替换失败，内存与磁盘原状态不变；成功后保留前后快照。
- [#3](https://github.com/IblankD/BBPlayerForWin/issues/3)：追加去重、明确替换、下一首移动已有歌曲；保持当前歌曲与进度，队列上限 10000 首。
- [#4](https://github.com/IblankD/BBPlayerForWin/issues/4)：删除确认、备份、撤销；保存失败持续提示，可重试。取消删除不改歌单，撤销恢复歌曲及原位置。
- 桌面类型检查、lint、回归测试、真实 Electron 烟雾测试、旧版数据升级、Windows 两种包及 SHA256 验证通过后发布。

## 尚待人工验收

实际 NSIS 覆盖安装向导、扫码后的真实账户与私有收藏夹、人工操作系统托盘。自动化测试覆盖的边界和模拟方式记录在 [VERIFICATION.md](./VERIFICATION.md)。

代码签名、自动构建发布、大歌单性能、诊断日志、离线下载和跨平台版本留在后续候选清单中，尚未承诺版本范围。
