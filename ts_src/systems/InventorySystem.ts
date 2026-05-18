import { log } from "@common/utils"
import { EventBus } from "@common/event_bus"
import { PrefabRegistry } from "../config"
import { GameEvents } from "../utils"

export const INVENTORY_UI_EVENT = "click_slot"

type SlotIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

type EggItem = {
  eggTypeId: number
  rarityId: number
}

type InventoryState = {
  slots: Record<SlotIndex, EggItem | null>
  selectedSlot: SlotIndex | null
  previewBindId: string | null
}

const roleInventories: Map<RoleID, InventoryState> = new Map()
const INVENTORY_SELECTED_IMAGE = 16612 as ImageKey

function getRoleKey(role: Role): RoleID {
  return role.get_roleid()
}

function createEmptyState(): InventoryState {
  return {
    slots: {
      1: null,
      2: null,
      3: null,
      4: null,
      5: null,
      6: null,
      7: null,
      8: null,
    },
    selectedSlot: null,
    previewBindId: null,
  }
}

function getOrCreateState(role: Role): InventoryState {
  const key = getRoleKey(role)
  let state = roleInventories.get(key)
  if (state === undefined) {
    state = createEmptyState()
    roleInventories.set(key, state)
  }
  return state
}

function setSlotImage(role: Role, slot: SlotIndex, image: ImageKey): void {
  const btnKey = `背包slot${slot}` as const
  const btn = (PrefabRegistry.inventoryButtons as Record<string, EButton>)[btnKey]
  role.set_button_normal_image(btn, image)
  role.set_button_pressed_image(btn, image)
}

function setSlotEmpty(role: Role, slot: SlotIndex): void {
  setSlotImage(role, slot, PrefabRegistry.inventoryIcons.empty)
}

function setSlotEgg(role: Role, slot: SlotIndex, eggTypeId: number): void {
  const image = (PrefabRegistry.inventoryIcons.egg as Record<number, ImageKey>)[eggTypeId]
  if (image === undefined) {
    log(`[Inventory] missing egg icon: eggTypeId=${tostring(eggTypeId)}`)
    setSlotEmpty(role, slot)
    return
  }
  setSlotImage(role, slot, image)
}

function refreshInventoryButtons(role: Role, state: InventoryState): void {
  for (let i = 1; i <= 8; i++) {
    const slot = i as SlotIndex
    const item = state.slots[slot]
    if (item === null) {
      setSlotEmpty(role, slot)
      continue
    }

    if (state.selectedSlot === slot) {
      setSlotImage(role, slot, INVENTORY_SELECTED_IMAGE)
      continue
    }

    setSlotEgg(role, slot, item.eggTypeId)
  }
}

function clearPreview(role: Role, state: InventoryState): void {
  if (state.previewBindId === null) {
    state.selectedSlot = null
    refreshInventoryButtons(role, state)
    EventBus.emit(GameEvents.INVENTORY_CHANGED, role)
    return
  }

  const ctrl = role.get_ctrl_unit()
  try {
    ctrl.unbind_model(state.previewBindId)
  } catch (e) {
    log(`[Inventory] unbind preview failed: ${tostring(e)}`)
  }

  state.previewBindId = null
  state.selectedSlot = null
  refreshInventoryButtons(role, state)
  EventBus.emit(GameEvents.INVENTORY_CHANGED, role)
}

function showPreview(role: Role, state: InventoryState, eggTypeId: number, slot: SlotIndex): void {
  clearPreview(role, state)

  const modelId = (PrefabRegistry.egg as Record<number, number>)[eggTypeId]
  if (modelId === undefined) {
    log(`[Inventory] missing egg prefab for eggTypeId=${tostring(eggTypeId)}`)
    return
  }

  const ctrl = role.get_ctrl_unit()
  const offset = math.Vector3(0, 0.8, 0)
  const rot = math.Quaternion(0, 0, 0)

  // Bind a preview model to the controlled unit.
  // This avoids spawning an interactable unit; it is purely visual.
  const bindId = ctrl.bind_model(modelId as unknown as UnitKey, Enums.ModelSocket.socket_head, offset, rot)
  state.previewBindId = bindId
  state.selectedSlot = slot
  refreshInventoryButtons(role, state)
  EventBus.emit(GameEvents.INVENTORY_CHANGED, role)
}

function getSelected(role: Role): { slot: SlotIndex; eggTypeId: number; rarityId: number } | null {
  const state = getOrCreateState(role)
  const slot = state.selectedSlot
  if (slot === null) return null
  const it = state.slots[slot]
  if (it === null) return null
  return { slot, eggTypeId: it.eggTypeId, rarityId: it.rarityId }
}

function findSlotByNodeId(nodeId: ENode): SlotIndex | null {
  const buttons = PrefabRegistry.inventoryButtons as unknown as Record<string, EButton>
  for (let i = 1; i <= 8; i++) {
    const key = `背包slot${i}`
    if (buttons[key] === nodeId) {
      return i as SlotIndex
    }
  }
  return null
}

export const InventorySystem = {
  initPlayer(role: Role): void {
    const state = getOrCreateState(role)
    clearPreview(role, state)
    for (let i = 1; i <= 8; i++) {
      state.slots[i as SlotIndex] = null
      setSlotEmpty(role, i as SlotIndex)
    }
    refreshInventoryButtons(role, state)
    EventBus.emit(GameEvents.INVENTORY_CHANGED, role)
  },

  selectSlot(role: Role, slot: number): void {
    if (slot < 1 || slot > 8) return
    const s = slot as SlotIndex

    const state = getOrCreateState(role)
    const it = state.slots[s]

    // Empty slot: clear selection/preview.
    if (it === null) {
      clearPreview(role, state)
      return
    }

    showPreview(role, state, it.eggTypeId, s)
  },

  hasEmptySlot(role: Role): boolean {
    const state = getOrCreateState(role)
    for (let i = 1; i <= 8; i++) {
      if (state.slots[i as SlotIndex] === null) return true
    }
    return false
  },

  addEggToFirstEmptySlot(
    role: Role,
    eggTypeId: number,
    rarityId: number
  ): { ok: true; slot: SlotIndex } | { ok: false } {
    const state = getOrCreateState(role)
    for (let i = 1; i <= 8; i++) {
      const slot = i as SlotIndex
      if (state.slots[slot] !== null) continue

      state.slots[slot] = { eggTypeId, rarityId }
      refreshInventoryButtons(role, state)
      EventBus.emit(GameEvents.INVENTORY_CHANGED, role)
      return { ok: true, slot }
    }
    return { ok: false }
  },

  handleSlotClicked(role: Role, nodeId: ENode): void {
    const slot = findSlotByNodeId(nodeId)
    if (slot === null) return

    const state = getOrCreateState(role)
    const it = state.slots[slot]

    log(
      `[Inventory] role=${role.get_roleid()} clicked slot=${slot} eggTypeId=${tostring(it === null ? null : it.eggTypeId)} rarityId=${tostring(
        it === null ? null : it.rarityId
      )}`
    )

    // Empty slot: just clear selection/preview.
    if (it === null) {
      clearPreview(role, state)
      return
    }

    // Toggle selection.
    if (state.selectedSlot === slot) {
      clearPreview(role, state)
      return
    }

    // Switch selection to another egg.
    showPreview(role, state, it.eggTypeId, slot)
  },

  getSelectedEgg(role: Role): { slot: SlotIndex; eggTypeId: number; rarityId: number } | null {
    return getSelected(role)
  },

  clearSelection(role: Role): void {
    const state = getOrCreateState(role)
    clearPreview(role, state)
  },

  consumeSelectedEgg(role: Role): { slot: SlotIndex; eggTypeId: number; rarityId: number } | null {
    const state = getOrCreateState(role)
    const selected = getSelected(role)
    if (selected === null) return null

    const { slot, eggTypeId, rarityId } = selected
    // Clear preview first to avoid leaving bound model around.
    clearPreview(role, state)

    state.slots[slot] = null
    refreshInventoryButtons(role, state)
    EventBus.emit(GameEvents.INVENTORY_CHANGED, role)

    return { slot, eggTypeId, rarityId }
  },

  cleanupPlayer(role: Role): void {
    const roleId = getRoleKey(role)
    const state = roleInventories.get(roleId)
    if (state !== undefined) {
      // Best-effort unbind preview model.
      clearPreview(role, state)
      roleInventories.delete(roleId)
    }
  },

  exportToSave(role: Role): { eggTypeIds: number[]; rarityIds: number[] } {
    const state = getOrCreateState(role)
    const eggTypeIds: number[] = []
    const rarityIds: number[] = []
    for (let i = 1; i <= 8; i++) {
      const slot = i as SlotIndex
      const it = state.slots[slot]
      eggTypeIds.push(it === null ? 0 : it.eggTypeId)
      rarityIds.push(it === null ? 0 : it.rarityId)
    }
    return { eggTypeIds, rarityIds }
  },

  loadFromSave(role: Role, eggTypeIds: number[], rarityIds?: number[]): void {
    const state = getOrCreateState(role)
    clearPreview(role, state)

    for (let i = 1; i <= 8; i++) {
      const slot = i as SlotIndex
      const eggTypeId = eggTypeIds[i - 1]
      const rarityIdRaw = rarityIds === undefined ? undefined : rarityIds[i - 1]
      const rarityId = typeof rarityIdRaw === "number" && rarityIdRaw > 0 ? Math.floor(rarityIdRaw) : 1
      if (eggTypeId === undefined || eggTypeId <= 0) {
        state.slots[slot] = null
      } else {
        state.slots[slot] = { eggTypeId, rarityId }
      }
    }

    refreshInventoryButtons(role, state)
    EventBus.emit(GameEvents.INVENTORY_CHANGED, role)
  },
}
