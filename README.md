# mt - 示例工程

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
cd /home/zhangyuwen/eggy_space/mt
npm ci
npm run build
```

## 运行/联调（推荐）

启动/同步链路统一参考 platform 文档：`../platform/AGENTS.md`、`../platform/docs/bridge-v2/USAGE.md`。

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
