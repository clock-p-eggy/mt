import { safeCall, safeVoid } from "@common/engine_safe"
import * as MonsterManager from "./MonsterManager"

interface GateTarget {
  id: UnitID
  name: string
}

interface KillGateRule {
  name: string
  targets: GateTarget[]
  preserveTargets?: GateTarget[]
  requiredMonsterIds: number[]
  actionText: string
}

const KILL_GATE_RULES: KillGateRule[] = [
  {
    name: "欧式方形窄门1",
    targets: [{ id: 1594492577 as UnitID, name: "欧式方形窄门1" }],
    preserveTargets: [{ id: 1487962612 as UnitID, name: "穿梭电门17" }],
    requiredMonsterIds: [1115853218, 1643323093, 1743679626],
    actionText: "消失",
  },
  {
    name: "欧式方形窄门2与机械墙6",
    targets: [
      { id: 1050532163 as UnitID, name: "欧式方形窄门2" },
      { id: 1687330069 as UnitID, name: "机械墙6" },
    ],
    requiredMonsterIds: [1854567188, 1760381794, 1080764999, 1881048733],
    actionText: "消失",
  },
  {
    name: "机械墙4与方墙46",
    targets: [
      { id: 1381759788 as UnitID, name: "机械墙4" },
      { id: 1925646933 as UnitID, name: "方墙46" },
    ],
    requiredMonsterIds: [1101855552, 2115675148, 1502667218, 2105425904],
    actionText: "消失",
  },
]

const unlockedByName: Record<string, boolean> = {}
const killedMonsterIds: Record<number, boolean> = {}
let initialized = false

function queryGateUnit(target: GateTarget): Unit | undefined {
  const unitById = safeCall(
    () => GameAPI.get_unit(target.id),
    { tag: `Stage7 get_unit ${target.name}`, fallback: undefined, logger: (msg: string) => print(msg) }
  ) as Unit | undefined

  if (unitById !== undefined) {
    return unitById
  }

  const unit = LuaAPI.query_unit(target.name) as unknown as Unit | undefined
  if (unit === undefined) {
    print(`[Stage7][GateSystem] gate missing name=${target.name} id=${tostring(target.id)}`)
    return undefined
  }
  return unit
}

function setGateTargetVisible(target: GateTarget, visible: boolean, reason: string): boolean {
  const unit = queryGateUnit(target)
  if (unit === undefined) {
    return false
  }

  const ok = safeVoid(
    () => {
      unit.set_model_visible(visible)
      unit.set_physics_active(visible)
      for (const role of GameAPI.get_all_valid_roles()) {
        role.set_unit_visible(unit, visible, false)
      }
    },
    { tag: `Stage7 visible ${target.name}`, logger: (msg: string) => print(msg) }
  )

  print(
    `[Stage7][GateSystem] visible target name=${target.name}` +
      ` id=${tostring(target.id)}` +
      ` visible=${tostring(visible)}` +
      ` reason=${reason}` +
      ` ok=${tostring(ok)}`
  )
  return ok
}

function resetRule(rule: KillGateRule): void {
  for (const target of rule.targets) {
    setGateTargetVisible(target, true, "init locked")
  }

  if (rule.preserveTargets !== undefined) {
    for (const target of rule.preserveTargets) {
      setGateTargetVisible(target, true, "init preserve")
    }
  }
}

function openGate(rule: KillGateRule, role: Role | undefined): void {
  if (unlockedByName[rule.name] === true) {
    return
  }

  let openedAny = false
  for (const target of rule.targets) {
    if (setGateTargetVisible(target, false, "required monsters killed")) {
      openedAny = true
    }
  }

  if (rule.preserveTargets !== undefined) {
    for (const target of rule.preserveTargets) {
      setGateTargetVisible(target, true, "preserve overlap")
    }
  }

  if (openedAny === false) {
    return
  }

  unlockedByName[rule.name] = true

  if (role !== undefined) {
    role.show_tips(`${rule.name}${rule.actionText}`, math.tofixed(1.5))
  }

  print(
    `[Stage7][GateSystem] unlock ${rule.name}` +
      " trigger=monster_kill_progress" +
      ` required=${rule.requiredMonsterIds.join(",")}` +
      ` role=${role === undefined ? "nil" : tostring(role.get_roleid())}`
  )
}

function isRuleComplete(rule: KillGateRule): boolean {
  for (const id of rule.requiredMonsterIds) {
    if (killedMonsterIds[id] !== true) {
      return false
    }
  }
  return true
}

function checkRules(role: Role | undefined): void {
  for (const rule of KILL_GATE_RULES) {
    if (isRuleComplete(rule)) {
      openGate(rule, role)
    }
  }
}

function handleMonsterKilled(name: string, unitId: UnitID, role: Role | undefined): void {
  killedMonsterIds[unitId] = true
  print(
    `[Stage7][GateSystem] monster killed name=${name}` +
      ` id=${tostring(unitId)}` +
      ` role=${role === undefined ? "nil" : tostring(role.get_roleid())}`
  )
  checkRules(role)
}

export function Init(): void {
  if (initialized) {
    return
  }
  initialized = true

  for (const rule of KILL_GATE_RULES) {
    resetRule(rule)
  }
  MonsterManager.OnMonsterKilled(handleMonsterKilled)

  print("[Stage7][GateSystem] init end mode=monster_kill_progress")
}
