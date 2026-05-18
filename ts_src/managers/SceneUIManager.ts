import { log } from "@common/utils"
import { EventBus } from "@common/event_bus"
import { PrefabRegistry, getPlotTypeById } from "../config"
import { MapGenerator, PlotData, EconomySystem, AnimalSystem, PlotSystem, PlayerSaveSystem } from "../systems"
import { GameEvents } from "../utils"
import { PlotKey, makePlotKey, parsePlotKey } from "../utils/plotKey"

type BuyPanel = {
  plotKey: PlotKey
  layer: E3DLayer
  priceButton: EButton
  priceNode: ENode
}

// roleId -> current focused buy panel
const buyPanels: Map<RoleID, BuyPanel> = new Map()
const sceneUiEventScopeId = EventBus.createScope()

const COLOR_GOLD: Color = 0xFFD700
const COLOR_PURPLE: Color = 0x8A2BE2
const COLOR_GRAY: Color = 0x808080
const AD_UNLOCK_PLOT_IDS = new Set<string>(["premium_1", "premium_2"])

function destroyBuyPanel(roleId: RoleID): void {
  const existing = buyPanels.get(roleId)
  if (existing === undefined) return
  buyPanels.delete(roleId)
  try {
    GameAPI.destroy_scene_ui(existing.layer)
  } catch {
    // ignore
  }
}

function setBuyPanelText(role: Role, panel: BuyPanel, text: string): void {
  try {
    role.set_button_text(panel.priceButton, text)
  } catch {
    try {
      role.set_label_text(panel.priceNode as unknown as ELabel, text)
    } catch {
      // ignore
    }
  }
}

export const SceneUIManager = {
  initAllUI(): void {
    this.registerEventListeners()
  },

  createPlotPriceLabels(): void {
    // Deprecated: we now use a single focused buy panel per role.
  },

  handlePlotPurchaseClicked(role: Role, actor: unknown, nodeId: ENode): void {
    const roleId = role.get_roleid()
    log(`[PlotBuy] click event role=${tostring(roleId)} nodeId=${tostring(nodeId)} actor=${tostring(actor)}`)

    const panel = buyPanels.get(roleId)
    if (panel === undefined) {
      // No focused plot currently.
      return
    }

    const parsed = parsePlotKey(panel.plotKey)
    if (parsed === null || parsed.ownerRoleId !== roleId) {
      destroyBuyPanel(roleId)
      return
    }

    const plotId = parsed.plotId
    log(`[PlotBuy] resolved plotId=${plotId} role=${tostring(roleId)} via=focus`)

    const success = PlotSystem.unlockPlot(role, plotId)
    if (success) {
      role.show_tips("Plot unlocked!", 1.5 as Fixed)
      destroyBuyPanel(roleId)
    } else {
      role.show_tips("Not enough coins", 1.5 as Fixed)
    }
  },

  showIncomeFloat(role: Role, position: Vector3, amount: number): void {
    const floatPos = math.Vector3(position.x, position.y + 1.2, position.z)
    
    role.show_dynamic_text(
      `+$${amount}`,
      floatPos,
      COLOR_GOLD,
      1.5 as Fixed,
      1
    )
  },

  showMutationResult(role: Role, position: Vector3, success: boolean, animalName?: string): void {
    const floatPos = math.Vector3(position.x, position.y + 1.5, position.z)
    
    if (success && animalName !== undefined) {
      role.show_dynamic_text(
        `${animalName}!`,
        floatPos,
        COLOR_PURPLE,
        2.0 as Fixed,
        1
      )
    } else {
      role.show_dynamic_text(
        "Failed",
        floatPos,
        COLOR_GRAY,
        1.5 as Fixed,
        1
      )
    }
  },

  registerEventListeners(): void {
    EventBus.on(GameEvents.PLOT_UNLOCKED, (plot: unknown) => {
      // If the currently focused plot gets unlocked, close the buy panel.
      const plotData = plot as PlotData
      const key = makePlotKey(plotData.ownerRoleId, plotData.id)
      for (const [roleId, panel] of buyPanels) {
        if (panel.plotKey === key) {
          destroyBuyPanel(roleId)
        }
      }
    }, { scopeId: sceneUiEventScopeId })

    EventBus.on(GameEvents.PLOT_SELECTED, (plotKey: unknown, role: unknown) => {
      if (typeof plotKey !== "string") return
      const r = role as Role
      const roleId = r.get_roleid()
      const parsed = parsePlotKey(plotKey)
      if (parsed === null || parsed.ownerRoleId !== roleId) {
        destroyBuyPanel(roleId)
        return
      }

      const plot = MapGenerator.getPlotById(parsed.ownerRoleId, parsed.plotId)
      if (plot === undefined || plot.isUnlocked) {
        destroyBuyPanel(roleId)
        return
      }
      if (AD_UNLOCK_PLOT_IDS.has(parsed.plotId)) {
        destroyBuyPanel(roleId)
        return
      }
      const plotType = getPlotTypeById(plot.plotTypeId)
      if (plotType === undefined) {
        destroyBuyPanel(roleId)
        return
      }

      // Recreate panel for this focused plot.
      destroyBuyPanel(roleId)
      const layer = plot.obstacle.create_scene_ui_bind_unit(
        PrefabRegistry.sceneUI.floorBuyPricePanel as E3DLayerKey,
        Enums.ModelSocket.socket_body,
        math.Vector3(0, 1.5, 0),
        math.tofixed(-1),
        false, // bind_event: MUST remain false (engine-specific constraint)
        true
      )

      const priceNode = GameAPI.get_eui_node_at_scene_ui(
        layer,
        PrefabRegistry.floorBuyPriceUINodes["地板购买价格面板-价格"] as unknown as ENode
      )
      const priceButton = priceNode as unknown as EButton

      // Only show to the owning role.
      try {
        const roles = GameAPI.get_all_roles()
        for (const rr of roles) {
          GameAPI.set_scene_ui_visible(layer, rr, rr.get_roleid() === roleId)
        }
      } catch {
        GameAPI.set_scene_ui_visible(layer, r, true)
      }

      const price = `$${plotType.unlockPrice}`
      const panel: BuyPanel = { plotKey: plotKey as unknown as PlotKey, layer, priceButton, priceNode }
      buyPanels.set(roleId, panel)
      setBuyPanelText(r, panel, price)
    }, { scopeId: sceneUiEventScopeId })

    EventBus.on(GameEvents.PLOT_UNSELECTED, (_plotKey: unknown, role: unknown) => {
      const r = role as Role
      const roleId = r.get_roleid()
      const panel = buyPanels.get(roleId)
      if (panel === undefined) return
      const plotKey = typeof _plotKey === "string" ? _plotKey : null
      if (plotKey === null || panel.plotKey === (plotKey as unknown as PlotKey)) {
        destroyBuyPanel(roleId)
      }
    }, { scopeId: sceneUiEventScopeId })

    EventBus.on(GameEvents.INCOME_TICK, (role: unknown, income: unknown) => {
      const roleData = role as Role
      const animals = AnimalSystem.getAnimalsByOwner(roleData)
      
      for (const animalData of animals) {
        const pos = animalData.creature.get_position()
        const animalIncome = animalData.creature.get_kv_by_type(Enums.ValueType.Int, "baseIncome") as number
        
        if (animalIncome > 0) {
          GameAPI.play_sfx_by_key(
            PrefabRegistry.sfx.coin as SfxKey,
            pos,
            math.Quaternion(0, 0, 0),
            math.tofixed(0.5),
            math.tofixed(0.5)
          )
        }
      }
    }, { scopeId: sceneUiEventScopeId })

    EventBus.on(GameEvents.ANIMAL_MUTATED, (
      newAnimal: unknown,
      newConfig: unknown,
    ) => {
      const animal = newAnimal as Creature
      const config = newConfig as { name: string }
      const pos = animal.get_position()
      const roles = GameAPI.get_all_roles()
      for (const role of roles) {
        this.showMutationResult(role, pos, true, config.name)
      }
    }, { scopeId: sceneUiEventScopeId })
  },

  updatePlayerUI(role: Role, uiNodes: {
    coinsLabel?: ELabel
    stonesLabel?: ELabel
    incomeLabel?: ELabel
    collectionLabel?: ELabel
  }): void {
    const stats = EconomySystem.getData(role)
    const income = AnimalSystem.calculateTotalIncome(role)
    const collectionCount = PlayerSaveSystem.getEncyclopediaAnimalCount(role)

    if (uiNodes.coinsLabel !== undefined) {
      role.set_label_text(uiNodes.coinsLabel, `$${stats.coins}`)
    }
    
    if (uiNodes.stonesLabel !== undefined) {
      role.set_label_text(uiNodes.stonesLabel, `${stats.mutationStones}`)
    }
    
    if (uiNodes.incomeLabel !== undefined) {
      role.set_label_text(uiNodes.incomeLabel, `$${income}/s`)
    }
    
    if (uiNodes.collectionLabel !== undefined) {
      role.set_label_text(uiNodes.collectionLabel, `${collectionCount}`)
    }
  },

  cleanup(): void {
    for (const roleId of buyPanels.keys()) {
      destroyBuyPanel(roleId)
    }
    
    EventBus.disposeScope(sceneUiEventScopeId)
  },

  cleanupOwner(ownerRoleId: RoleID): void {
    for (const [roleId, panel] of buyPanels) {
      const parsed = parsePlotKey(panel.plotKey)
      if (parsed !== null && parsed.ownerRoleId === ownerRoleId) {
        destroyBuyPanel(roleId)
      }
    }
  },
}
