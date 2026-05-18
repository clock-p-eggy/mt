# mt - 模板工程

TSTL 项目模板（layered workspace），展示如何使用 TypeScript 开发蛋仔 Lua 脚本。

## 目录结构

```
mt/
├── ts_src/           # 游戏 TypeScript 源码
├── project/          # 工程输出/资源根
│   ├── Data/
│   ├── lua_src/
│   └── ts_out/       # 编译输出（下划线）
└── tsconfig.json
```

## 编译

通用编译/联调链路、路径别名等 platform 级约定，统一参考：

- `../platform/AGENTS.md`
- `../platform/README.md`
- `../platform/docs/bridge-v2/USAGE.md`

本项目常用命令：

```bash
cd /root/eggy_space/mt
npm ci
npm run build
```

## 运行/联调（推荐）

启动/同步链路统一参考 platform 文档：`../platform/AGENTS.md`、`../platform/docs/bridge-v2/USAGE.md`。

## 编辑器调用方式

`eggitor_vscode_extension` 原本是 VSCode 插件目录，用来通过 VSCode 触发编辑器操作。当前给 AI 或自动化脚本调用编辑器时，不再要求走 VSCode 插件界面，应优先使用 `editor-cli.exe`。

本机能直接访问编辑器所在机器时，在项目根目录下调用 CLI：

```powershell
$CLI = ".codemaker\editor-cli.exe"

# 检查编辑器状态
& $CLI --json status

# 执行编辑器侧 EditorAPI
& $CLI exec "EditorAPI.run_game()"

# 在试玩运行时执行 Lua
& $CLI exec "EditorAPI.game_execute('print([[hello from cli]])')"
```

远端 AI 不能直接访问本机命令行时，让本机先启动桥接脚本，再由远端通过 WebSocket 发送 `local-agent` 请求间接调用 CLI：

```powershell
cd ..\eggitor_vscode_extension\eggitor_cli
python .\connect_eggitor_agent.py --repo mt --user <你的用户名>
```

桥接脚本会读取 `%APPDATA%\dev.clock-p.com\feishu-token`，连接到：

```text
wss://mt-eggitorbackend-<你的用户名>-user.dev.clock-p.com/ws
```

远端 AI 查询当前状态时，只允许使用 `local-agent` 的 `editor.status` 或 `local.command` 调用 `["editor-cli", "--json", "status"]`。不要调用 backend 的 `game-status`、`/game/status`、`game.status` 或 `query_game_status`：这些接口依赖 VSCode 插件的游戏/插件 bridge 通道，`ws_clients: 1` 只能说明 backend 有 WebSocket 客户端连接，不能说明游戏/插件 bridge 已连接；失败时常见错误是 `{"error":"bridge_not_connected","success":false}`。

远端请求必须使用 JSON 数组形式的命令，例如：

```json
{
  "id": 1,
  "type": "request",
  "channel": "local-agent",
  "method": "local.command",
  "params": {
    "command": ["editor-cli", "exec", "EditorAPI.run_game()"]
  }
}
```

远端连接协议和允许的命令白名单见：`skills/eggy-editor-ops/references/remote-agent-bridge.md`。

## 存档约束

存档方案固定为“单个 JSON 字符串根”，保存在 `ArchiveKeys.PLAYER_SAVE_JSON(1010)`。

- 读取/写入：`Role.{get,set}_archive_by_type(Enums.ArchiveType.Str, ArchiveKeys.PLAYER_SAVE_JSON, ...)`
- 约束：业务侧不要引入其他 archive key / 其他存档结构；需要扩展时再单独设计迁移与兼容。

输出目录：`project/ts_out/`

## 每日签到（简化版：每日奖励面板）

当前实现是极简版本：只有一个面板（关闭/签到）。

- 入口：每次玩家进入并完成 `PlayerManager.loadPlayerData()` 后，都会弹出 `每日奖励面板`。
- 领取规则：
  - 点击 `每日奖励面板-签到按钮` 才算领取（同一天只会成功一次）。
  - 点击 `每日奖励面板-关闭按钮` 或直接退游戏都不算领取。
  - 若“今日已领取”，会隐藏 `每日奖励面板-签到按钮`。
- 文本节点：`每日奖励面板-desc`（显示“点击签到领取奖励”/“今日已领取”）。
- 奖励数值：`GameConfig.DAILY_SIGN_IN_COINS`（当前固定金币奖励，后续可改成配表驱动）。
