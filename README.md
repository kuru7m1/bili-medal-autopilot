# bilibili粉丝团任务工具

> bili-medal-autopilot

运行于 [Tampermonkey](https://www.tampermonkey.net/) 的 B 站直播辅助脚本。用户维护一份直播间白名单，脚本按序完成各房间的粉丝团每日任务。单文件实现，无外部依赖。

- 运行域：`https://live.bilibili.com/*`
- 权限：`@grant none`（运行于页面上下文，不申请任何 GM 权限）
- 当前版本：见脚本头部的 `@version`

## 功能

- **粉丝团任务**：点亮熄灭勋章、点赞、发送弹幕、观看直播、分享直播间，按白名单顺序依次执行。
- **任务看板**：白名单中每个直播间对应一张卡片，实时显示开播状态、粉丝牌等级与亲密度进度（`Lv.8 ▰▰▰ 23 / 28`，可在设置「看板显示」里关闭）、各项任务的执行进度、当日点赞次数、弹幕条数与观时时长，以及当前执行的动作与等待的条件。支持拖拽排序、黑白名单管理与从粉丝牌批量导入；任务状态以 B 站返回的进度为准。
- **节奏可调**：点赞的单次条数与间隔秒数、弹幕内容均可在设置中调整，用于在推进速度与风控风险之间自行取舍。
- **任务上限**：点赞、弹幕、观时可在各自的任务卡片里设置每日上限；留空或填 0 时跟随 B 站任务上限，填写数字则按该值执行（关闭「允许超过服务端上限」时不会超过 B 站上限）。每个直播间还可以在看板卡片的「任务开关」里单独调小。
- **满储省时**：储蓄亲密度达到 100 时，该房间只维持点亮（点亮、点赞、弹幕），自动跳过观时与分享；领取后自动恢复。可在设置页「储蓄亲密度」中关闭。
- **首页自动暂停**：打开 `live.bilibili.com` 首页时，自动暂停轮播里自动播放的直播，避免后台标签页持续拉流；手动点播放不会被再次打断。可在设置页「体验优化」关闭。
- **其他**：亲密度面板。

## 环境要求

- 浏览器：Chrome、Edge、Firefox 等主流浏览器
- 用户脚本管理器：[Tampermonkey](https://www.tampermonkey.net/)（推荐）或 [Violentmonkey](https://violentmonkey.github.io/)

## 安装

当前未发布到脚本托管站点，使用本地构建产物安装：

| 方式 | 操作 |
| --- | --- |
| 导入文件（推荐） | 打开脚本管理器的「实用工具 → 导入」，选择本目录下的 `bili-medal-autopilot.user.js`；或直接把该文件拖入浏览器窗口 |
| 手动新建 | 脚本管理器「新建脚本」，清空模板内容，把 `bili-medal-autopilot.user.js` 全文粘贴后按 `Ctrl+S` 保存 |

安装完成后打开任意直播间，主播信息栏将出现「任务」按钮；亦可按 `Alt+T` 打开控制面板。

## 注意

脚本会实际调用 B 站接口完成点赞、发送弹幕与观看心跳，属于自动化行为。请自行评估风险并承担相应后果，作者不承担责任。

- 本项目为非官方工具，与哔哩哔哩及其关联公司无任何关系。
- 建议先在单个直播间试用，确认任务进度确有增长后，再扩展至完整白名单。
- 观时任务默认在页面切到后台时继续发送心跳，但浏览器会把定时器压到 1 次/分钟，进度会变慢，也可能因时间戳过期短暂中断（会自动重新对齐）。如希望后台完全暂停、回到前台再续挂，可在设置页「观看直播 → 切到后台时继续观时」关闭该开关。
- 最小化、被其他窗口完全遮挡同样属于后台，效果与切换标签页一致；让页面出声（非静音）可免除浏览器的后台节流。
- 每日任务于 23:55 停止，次日 00:05 自动恢复，跨天期间的进度不会丢失。
- 同时打开多个直播间页面时，仅其中一个标签页执行任务：后开的标签页默认待命，在它上面点「开始」会接管执行权，原主控自动停止；关闭主控标签不会让其他标签自动开始，需要手动点一次「开始」。执行权基于 Web Locks 互斥，不支持时会回退到 localStorage 租约。若主控标签被浏览器冻结但仍存活，执行锁不会释放，接管会一直等待；关闭该标签后等待中的标签即可接手。
- 配置与每日进度存储于 `localStorage`（前缀 `bma.`），清除站点数据即重置。

## 致谢

本项目在实现过程中参考并复用了以下开源项目的部分代码与思路，均以 MIT 协议授权。
按 MIT 要求，完整版权声明附在下方折叠区，分发本软件时请一并保留。

- [B站直播间亲密度面板](https://github.com/bingwaa/qmdmb) — bingwaa
- [Bilibili Live Tasks Helper](https://github.com/andywang425/BLTH) — andywang425

<details>
<summary>第三方许可全文（MIT）</summary>

```
MIT License

Copyright (c) 2026 bingwaa
Copyright (c) 2023 andywang425

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>

## 许可

[MIT](LICENSE) © kuru7m1
