import { PrefabRegistry } from "../config"
import { AnimalSystem } from "./AnimalSystem"
import { AnimalWalletSystem } from "./AnimalWalletSystem"

type UnitId = number

interface PanelData {
  unitId: UnitId
  creature: Creature
  layer: E3DLayer
  nameNode: ENode
  nameLabel: ELabel
  storedLabel: ELabel
  rateLabel: ELabel
}

const panels: Map<UnitId, PanelData> = new Map()

// Hysteresis: show at 20, hide at 22.
const SHOW_DISTANCE = 20
const HIDE_DISTANCE = 22
const SHOW_DISTANCE_SQ = SHOW_DISTANCE * SHOW_DISTANCE
const HIDE_DISTANCE_SQ = HIDE_DISTANCE * HIDE_DISTANCE

// roleId -> (unitId -> visible)
const visibleState: Map<RoleID, Map<UnitId, boolean>> = new Map()

function distSq(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

function getOrCreateRoleState(roleId: RoleID): Map<UnitId, boolean> {
  let state = visibleState.get(roleId)
  if (state === undefined) {
    state = new Map()
    visibleState.set(roleId, state)
  }
  return state
}

function safeDestroySceneUi(layer: E3DLayer): void {
  try {
    GameAPI.destroy_scene_ui(layer)
  } catch {
    // ignore
  }
}

function ensurePanelForAnimal(creature: Creature, unitId: UnitId): PanelData | null {
  const cached = panels.get(unitId)
  if (cached !== undefined) return cached

  const layer = creature.create_scene_ui_bind_unit(
    PrefabRegistry.sceneUI.eggPanel,
    Enums.ModelSocket.socket_body,
    math.Vector3(0, 1.95, 0),
    math.tofixed(-1),
    true,
    true
  )

  const nameNode = GameAPI.get_eui_node_at_scene_ui(
    layer,
    PrefabRegistry.sceneUINodes["蛋面板-名字"] as unknown as ENode
  )
  const storedNode = GameAPI.get_eui_node_at_scene_ui(
    layer,
    PrefabRegistry.sceneUINodes["蛋面板-待提款数额"] as unknown as ENode
  )
  const rateNode = GameAPI.get_eui_node_at_scene_ui(
    layer,
    PrefabRegistry.sceneUINodes["蛋面板-钱每秒"] as unknown as ENode
  )

  const panel: PanelData = {
    unitId,
    creature,
    layer,
    nameNode: nameNode as unknown as ENode,
    nameLabel: nameNode as unknown as ELabel,
    storedLabel: storedNode as unknown as ELabel,
    rateLabel: rateNode as unknown as ELabel,
  }

  panels.set(unitId, panel)
  return panel
}

function cleanupDeadPanels(): void {
  // If an animal is removed from AnimalSystem, we should destroy its panel.
  const alive = new Set<number>()
  for (const data of AnimalSystem.getAllAnimals()) {
    alive.add(LuaAPI.get_unit_id(data.creature))
  }

  for (const [unitId, panel] of panels) {
    if (!alive.has(unitId)) {
      safeDestroySceneUi(panel.layer)
      panels.delete(unitId)
      for (const state of visibleState.values()) {
        state.delete(unitId)
      }
    }
  }
}

function updateRoleVisibilityAndText(role: Role): void {
  const roleId = role.get_roleid()
  const roleState = getOrCreateRoleState(roleId)

  const ctrl = role.get_ctrl_unit()
  const rolePos = ctrl.get_position()

  const animals = AnimalSystem.getAllAnimals()
  for (const animal of animals) {
    const unitId = LuaAPI.get_unit_id(animal.creature)
    const panel = ensurePanelForAnimal(animal.creature, unitId)
    if (panel === null) continue

    const animalPos = animal.creature.get_position()
    const d2 = distSq(rolePos, animalPos)

    const lastVisible = roleState.get(unitId) === true
    let nextVisible = lastVisible

    if (d2 <= SHOW_DISTANCE_SQ) {
      nextVisible = true
    } else if (d2 >= HIDE_DISTANCE_SQ) {
      nextVisible = false
    }

    if (nextVisible !== lastVisible) {
      roleState.set(unitId, nextVisible)
      GameAPI.set_scene_ui_visible(panel.layer, role, nextVisible)
    }

    if (!nextVisible) continue

    role.set_node_visible(panel.nameNode, false)

    const stored = AnimalWalletSystem.getStoredCoins(unitId)
    const rate = AnimalWalletSystem.getIncomePerSecond(unitId)

    role.set_label_text(panel.rateLabel, `$${rate}/s`)
    role.set_label_text(panel.storedLabel, `$${stored}`)
  }
}

let started = false

export const AnimalPanelSystem = {
  init(): void {
    if (started) return
    started = true

    const tickInterval = math.toreal(0.2)

    function tick(): void {
      cleanupDeadPanels()

      const roles = GameAPI.get_all_roles()
      for (const role of roles) {
        updateRoleVisibilityAndText(role)
      }

      LuaAPI.call_delay_time(tickInterval, tick)
    }

    LuaAPI.call_delay_time(tickInterval, tick)
  },

  cleanupOwner(ownerRoleId: RoleID): void {
    const toDelete: number[] = []
    for (const [unitId] of panels) {
      const data = AnimalSystem.getAnimal(unitId)
      if (data !== undefined && data.owner.get_roleid() === ownerRoleId) {
        toDelete.push(unitId)
      }
    }

    for (const unitId of toDelete) {
      const panel = panels.get(unitId)
      if (panel !== undefined) {
        safeDestroySceneUi(panel.layer)
        panels.delete(unitId)
      }
      for (const state of visibleState.values()) {
        state.delete(unitId)
      }
    }
  },
}
