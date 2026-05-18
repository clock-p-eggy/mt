/**
 * 游戏全局配置
 * 核心数值参数，方便统一调整
 */

export const GameConfig = {
  // ==================== 货币 ====================
  /** 初始金币 */
  INITIAL_COINS: 0,

  ENABLE_ARCHIVES: true,

  // Debug: enable fixed/number runtime probes.
  DEBUG_FIXED_RUNTIME: false,
  /** 变异石每日上限 */
  MUTATION_STONE_DAILY_LIMIT: 4,

  // ==================== 物品栏 ====================
  /** 物品栏格数 */
  INVENTORY_SIZE: 8,

  // ==================== 每日签到 ====================
  /** 每日签到奖励：金币（临时固定值，后续可改成配表驱动） */
  DAILY_SIGN_IN_COINS: 200,

  /** 传送带上最多同时存在的蛋数量（防止堆积/性能问题） */
  CONVEYOR_EGG_CAP: 40,

  // ==================== 挖矿 ====================
  /** 挖矿冷却时间(秒) */
  MINING_COOLDOWN: 4.7,
  /** 矿石出售价格 */
  ORE_SELL_PRICE: 10950,

  // ==================== 变异 ====================
  /** 基础变异成功率 */
  BASE_MUTATION_RATE: 0.25,
  /** 基础变异金币消耗 */
  MUTATION_BASE_COST: 4800,
  /** 每多花1000金币提升的成功率 */
  MUTATION_RATE_PER_1000_COINS: 0.05,
  /** 最高变异成功率 */
  MUTATION_MAX_RATE: 0.75,

  // ==================== 超级地块 ====================
  /** 超级地块解锁所需收集数 (max 12 animal types exist) */
  SUPER_PLOT_UNLOCK_COLLECTION: 10,
  /** 超级地块初始倍率 */
  SUPER_PLOT_BASE_MULTIPLIER: 2.0,
  /** 超级地块每级增加倍率 */
  SUPER_PLOT_MULTIPLIER_PER_LEVEL: 1.0,
  /** 超级地块升级费用 */
  SUPER_PLOT_UPGRADE_COST: 2500,

  // ==================== 产金 ====================
  /** 产金间隔(秒) */
  INCOME_INTERVAL: 1.01,

  // ==================== 回收 ====================
  /** 动物回收：按来源蛋基础价计算的基础回收比例 */
  RECYCLE_FROM_EGG_BASE_RATIO: 0.1,

  // ==================== 地图布局 ====================
  /** 地块网格行数 */
  PLOT_ROWS: 4,
  /** 地块网格列数 */
  PLOT_COLS: 5,
  /** 地块间距 */
  PLOT_SPACING: 2.5,

  /** 地块起始位置 X */
  PLOT_START_X: -5,
  /** 地块起始位置 Z */
  PLOT_START_Z: -5,

  // ==================== 付费 ====================
  /** 挖矿特权价格(珍珠) */
  MINING_PRIVILEGE_PRICE: 60,
  /** 挖矿特权倍率 */
  MINING_PRIVILEGE_MULTIPLIER: 2,
} as const

export type GameConfigType = typeof GameConfig

export const ArchiveKeys = {
  ECONOMY: 1009 as Archive,
  // Player save root as a single JSON string.
  // NOTE: ID is manually assigned.
  PLAYER_SAVE_JSON: 1010 as Archive,
} as const
