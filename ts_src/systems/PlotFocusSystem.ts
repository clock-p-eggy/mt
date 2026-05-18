/**
 * PlotFocusSystem
 *
 * Maintains which plot(s) a player is currently standing in.
 * Handles overlap edge cases by tracking an active set and choosing a stable current plot.
 */

import { EventBus } from "@common/event_bus"
import { GameEvents } from "../utils"
import { MapGenerator } from "./MapGenerator"
import { PlotKey, makePlotKey, parsePlotKey } from "../utils/plotKey"

const roleActivePlotIds: Map<RoleID, Set<PlotKey>> = new Map()
const roleCurrentPlotId: Map<RoleID, PlotKey | null> = new Map()
const roleLastEnteredPlotId: Map<RoleID, PlotKey | null> = new Map()

let initialized = false

function getRoleKey(role: Role): RoleID {
  return role.get_roleid()
}

function chooseBestPlotId(roleId: RoleID): PlotKey | null {
  const active = roleActivePlotIds.get(roleId)
  if (active === undefined || active.size === 0) return null

  // Prefer an unlocked plot.
  for (const key of active) {
    const parsed = parsePlotKey(key)
    if (parsed === null) continue
    const plot = MapGenerator.getPlotById(parsed.ownerRoleId, parsed.plotId)
    if (plot !== undefined && plot.isUnlocked) return key
  }

  // Fallback: any active plot.
  for (const key of active) {
    return key
  }
  return null
}

function setCurrentPlot(role: Role, next: PlotKey | null): void {
  const roleId = getRoleKey(role)
  const prev = roleCurrentPlotId.get(roleId)
  if (prev === next) return
  roleCurrentPlotId.set(roleId, next)
  EventBus.emit(GameEvents.PLOT_FOCUS_CHANGED, role, next)
}

export const PlotFocusSystem = {
  init(): void {
    if (initialized) return
    initialized = true

    EventBus.on(GameEvents.PLOT_SELECTED, (plotId: unknown, role: unknown) => {
      if (typeof plotId !== "string") return
      const r = role as Role
      const roleId = getRoleKey(r)
      let active = roleActivePlotIds.get(roleId)
      if (active === undefined) {
        active = new Set()
        roleActivePlotIds.set(roleId, active)
      }
      const key: PlotKey = plotId.indexOf(":") >= 0 ? (plotId as unknown as PlotKey) : makePlotKey(roleId, plotId)
      roleLastEnteredPlotId.set(roleId, key)
      active.add(key)

      const current = roleCurrentPlotId.get(roleId)
      if (current === undefined || current === null || !active.has(current)) {
        setCurrentPlot(r, chooseBestPlotId(roleId))
      } else {
        // Keep current; do not churn.
        setCurrentPlot(r, current)
      }
    })

    EventBus.on(GameEvents.PLOT_UNSELECTED, (_plotId: unknown, role: unknown) => {
      const r = role as Role
      const roleId = getRoleKey(r)
      const plotId = typeof _plotId === "string" ? _plotId : null

      const active = roleActivePlotIds.get(roleId)
      if (active !== undefined && plotId !== null) {
        const key: PlotKey = plotId.indexOf(":") >= 0 ? (plotId as unknown as PlotKey) : makePlotKey(roleId, plotId)
        active.delete(key)
      }

      setCurrentPlot(r, chooseBestPlotId(roleId))
    })
  },

  initPlayer(role: Role): void {
    const roleId = getRoleKey(role)
    if (!roleActivePlotIds.has(roleId)) {
      roleActivePlotIds.set(roleId, new Set())
    }
    roleCurrentPlotId.set(roleId, null)
    roleLastEnteredPlotId.set(roleId, null)
  },

  cleanupPlayer(role: Role): void {
    const roleId = getRoleKey(role)
    roleActivePlotIds.delete(roleId)
    roleCurrentPlotId.delete(roleId)
    roleLastEnteredPlotId.delete(roleId)
  },

  getCurrentPlotKey(role: Role): PlotKey | null {
    const id = roleCurrentPlotId.get(getRoleKey(role))
    return id === undefined ? null : id
  },

  getLastEnteredPlotKey(role: Role): PlotKey | null {
    const id = roleLastEnteredPlotId.get(getRoleKey(role))
    return id === undefined ? null : id
  },

  getCurrentPlotId(role: Role): string | null {
    const key = this.getCurrentPlotKey(role)
    if (key === null) return null
    const parsed = parsePlotKey(key)
    return parsed === null ? null : parsed.plotId
  },
}
