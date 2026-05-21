import { log } from "@common/utils"

type BgmManagerModule = typeof import("./BgmManager")
type ItemAttackManagerModule = typeof import("./ItemAttackManager")
type MonsterManagerModule = typeof import("./MonsterManager")
type PlayerSkillManagerModule = typeof import("./PlayerSkillManager")
type PlayerStatsModule = typeof import("./PlayerStats")
type PlayerWeaponManagerModule = typeof import("./PlayerWeaponManager")
type RotatingUnitManagerModule = typeof import("./RotatingUnitManager")
type Stage7GateSystemModule = typeof import("./Stage7GateSystem")
type Stage8To12SystemModule = typeof import("./Stage8To12System")

declare const dofile: ((path: string) => unknown) | undefined
declare const require: (moduleName: string) => unknown
declare const _G: Record<string, unknown>

interface LuaPackage {
  loaded?: Record<string, unknown>
}

const GAME_MODULES = [
  "project/ts_out/game/BgmManager",
  "project/ts_out/game/PlayerStats",
  "project/ts_out/game/MonsterManager",
  "project/ts_out/game/ItemAttackManager",
  "project/ts_out/game/PlayerWeaponManager",
  "project/ts_out/game/PlayerSkillManager",
  "project/ts_out/game/RotatingUnitManager",
  "project/ts_out/game/Stage7GateSystem",
  "project/ts_out/game/Stage8To12System",
]

function clearGameModuleCache(): void {
  const luaPackage = _G["package"] as LuaPackage | undefined
  if (luaPackage === undefined || luaPackage.loaded === undefined) {
    return
  }

  for (const moduleName of GAME_MODULES) {
    luaPackage.loaded[moduleName] = undefined
  }
}

function loadGameModule<T>(moduleName: string): T {
  const luaPackage = _G["package"] as LuaPackage | undefined
  if (luaPackage !== undefined && luaPackage.loaded !== undefined) {
    luaPackage.loaded[moduleName] = undefined
  }

  const moduleExports = dofile === undefined ? require(moduleName) as T : dofile(`${moduleName}.lua`) as T
  if (luaPackage !== undefined && luaPackage.loaded !== undefined) {
    luaPackage.loaded[moduleName] = moduleExports
  }

  return moduleExports
}

clearGameModuleCache()

const BgmManager = loadGameModule<BgmManagerModule>("project/ts_out/game/BgmManager")
const PlayerStats = loadGameModule<PlayerStatsModule>("project/ts_out/game/PlayerStats")
const MonsterManager = loadGameModule<MonsterManagerModule>("project/ts_out/game/MonsterManager")
const ItemAttackManager = loadGameModule<ItemAttackManagerModule>("project/ts_out/game/ItemAttackManager")
const PlayerWeaponManager = loadGameModule<PlayerWeaponManagerModule>("project/ts_out/game/PlayerWeaponManager")
const PlayerSkillManager = loadGameModule<PlayerSkillManagerModule>("project/ts_out/game/PlayerSkillManager")
const RotatingUnitManager = loadGameModule<RotatingUnitManagerModule>("project/ts_out/game/RotatingUnitManager")
const Stage7GateSystem = loadGameModule<Stage7GateSystemModule>("project/ts_out/game/Stage7GateSystem")
const Stage8To12System = loadGameModule<Stage8To12SystemModule>("project/ts_out/game/Stage8To12System")

log("[mt] TypeScript entry loaded build=20260521_password_success_tip_v2")

function initStage0Bgm(): void {
  log("[Stage0] bgm init begin")

  BgmManager.Init()

  log("[Stage0] bgm init end")
}

function initStage1Players(): void {
  log("[Stage1] player runtime init begin")

  PlayerStats.InitAllPlayers()

  log("[Stage1] player runtime init end")
}

function initStage2Monsters(): void {
  log("[Stage2] monster base stats init begin")

  MonsterManager.InitAllMonsters()

  log("[Stage2] monster base stats init end")
}

function initStage3ItemAttacks(): void {
  log("[Stage3] item attack init begin")

  ItemAttackManager.Init()

  log("[Stage3] item attack init end")
}

function initStage6PlayerWeapon(): void {
  log("[Stage6] player starting weapon init begin")

  PlayerWeaponManager.EquipStartingWeaponForAllPlayers()

  log("[Stage6] player starting weapon init end")
}

function initStage7PlayerSkill(): void {
  log("[Stage7] player preset skill init begin")

  PlayerSkillManager.EquipPlayerPresetSkillForAllPlayers()

  log("[Stage7] player preset skill init end")
}

function initStage7LevelGates(): void {
  log("[Stage7] level gate init begin")

  Stage7GateSystem.Init()

  log("[Stage7] level gate init end")
}

function initStage8To12(): void {
  log("[Stage8To12] system init begin")

  Stage8To12System.Init()
  RotatingUnitManager.Init()

  log("[Stage8To12] system init end")
}

LuaAPI.global_register_trigger_event([EVENT.GAME_INIT], () => {
  initStage0Bgm()
  initStage1Players()
  initStage2Monsters()
  initStage3ItemAttacks()
  initStage6PlayerWeapon()
  initStage7PlayerSkill()
  initStage7LevelGates()
  initStage8To12()
})
