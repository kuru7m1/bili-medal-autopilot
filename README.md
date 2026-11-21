# bilibili粉丝团任务工具

> bili-medal-autopilot · [GitHub 仓库](https://github.com/kuru7m1/bili-medal-autopilot)

运行于 Tampermonkey 的 B 站直播粉丝团任务脚本。维护一份直播间白名单，脚本按队列完成各房间的粉丝团每日任务。

- 运行域：`https://live.bilibili.com/*`
- 权限：`@grant none`
- 当前版本：见脚本头部 `@version`

## 功能

- 自动完成 B 站粉丝团五项每日任务：点亮 / 点赞 / 弹幕 / 观时 / 分享
- 每个直播间的任务状态可视化：开播状态、粉丝牌等级与亲密度、任务进度与今日统计
- 可自定义节奏：点赞批量与间隔、弹幕间隔、每日任务上限

## 安装

| 方式 | 操作 |
| --- | --- |
| 在线安装（推荐） | 打开 [`bili-medal-autopilot.user.js`](https://raw.githubusercontent.com/kuru7m1/bili-medal-autopilot/main/bili-medal-autopilot.user.js)，在安装页点「安装」 |
| 导入文件 | 脚本管理器「实用工具 → 导入」，选择 `bili-medal-autopilot.user.js` |
| 手动新建 | 新建脚本，粘贴文件全文后按 `Ctrl+S` 保存 |

安装后打开任意直播间，主播信息栏出现「任务」按钮；亦可按 `Alt+T` 打开面板。脚本带 `@updateURL`，仓库 `main` 更新后可在脚本管理器「检查更新」获取新版。

## 使用

1. 白名单：添加直播间，或从粉丝牌导入
2. 设置：调整任务开关、节奏与上限
3. 开始：脚本按队列执行，全部完成自动停止

## 注意

- 脚本会真实调用 B 站接口完成点赞、弹幕与观时心跳，属于自动化行为，请自行评估账号风险
- 非官方工具，与哔哩哔哩及其关联公司无任何关系

## 致谢

本项目参考并复用了以下开源项目的部分代码与思路，均以 MIT 协议授权。
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
