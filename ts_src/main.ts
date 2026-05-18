import { log } from "@common/utils"
import * as ItemAttackManager from "./ItemAttackManager"
import * as MonsterManager from "./MonsterManager"
import * as PlayerSkillManager from "./PlayerSkillManager"
import * as PlayerStats from "./PlayerStats"
import * as PlayerWeaponManager from "./PlayerWeaponManager"

log("[mt] TypeScript entry loaded")

function initStage1Players(): void {
  log("[Stage1] player base stats init begin")

  PlayerStats.InitAllPlayers()

  log("[Stage1] player base stats init end")
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

LuaAPI.global_register_trigger_event([EVENT.GAME_INIT], () => {
  initStage1Players()
  initStage2Monsters()
  initStage3ItemAttacks()
  initStage6PlayerWeapon()
  initStage7PlayerSkill()
})
