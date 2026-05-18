export const GameEvents = {
  COINS_CHANGED: "coins_changed",
  MUTATION_STONES_CHANGED: "mutation_stones_changed",
  INCOME_TICK: "income_tick",
  WALLET_COINS_COLLECTED: "wallet_coins_collected",

  PLOT_UNLOCKED: "plot_unlocked",
  PLOT_SELECTED: "plot_selected",
  PLOT_UNSELECTED: "plot_unselected",
  PLOT_FOCUS_CHANGED: "plot_focus_changed",

  ANIMAL_CREATED: "animal_created",
  ANIMAL_RECYCLED: "animal_recycled",
  ANIMAL_MUTATED: "animal_mutated",
  COLLECTION_UPDATED: "collection_updated",

  EGG_PURCHASED: "egg_purchased",
  EGG_HATCHING: "egg_hatching",
  EGG_HATCHED: "egg_hatched",

  INVENTORY_CHANGED: "inventory_changed",

  MINING_STARTED: "mining_started",
  MINING_COMPLETED: "mining_completed",
  ORE_SOLD: "ore_sold",

  SUPER_PLOT_UNLOCKED: "super_plot_unlocked",
  SUPER_PLOT_UPGRADED: "super_plot_upgraded",

  TASK_COMPLETED: "task_completed",
  GUIDE_STEP_CHANGED: "guide_step_changed",

  SIGN_IN_REWARD_DAY_1: "第一天签到奖励",
  SIGN_IN_REWARD_DAY_2: "第二天签到奖励",
  SIGN_IN_REWARD_DAY_3: "第三天签到奖励",
  SIGN_IN_REWARD_DAY_4: "第四天签到奖励",
  SIGN_IN_REWARD_DAY_5: "第五天签到奖励",
  SIGN_IN_REWARD_DAY_6: "第六天签到奖励",
  SIGN_IN_REWARD_DAY_7: "第七天签到奖励",
} as const

export type GameEventType = typeof GameEvents[keyof typeof GameEvents]
