/**
 * EggHatchingSystem
 *
 * Responsible for the hatching animation timing (shake) and completion callback.
 * Does not decide what the egg becomes.
 */

type HatchAnimState = {
  egg: Obstacle
  basePos: Vector3
  baseRot: Quaternion
  elapsed: number
  tickS: number
  durationS: number
  freqHz: number
  rollRad: number
  pitchRad: number
  baseYaw: number
  onComplete: () => void
}

const hatchingByKey: Map<string, HatchAnimState> = new Map()

function computeYawToPlayerRad(role: Role, eggPos: Vector3): number {
  // Returns radians.
  try {
    const p = role.get_ctrl_unit().get_position()
    const dx = p.x - eggPos.x
    const dz = p.z - eggPos.z
    const len = Math.sqrt(dx * dx + dz * dz)
    if (len > 0.00001) {
      return Math.atan2(dx, dz)
    }
  } catch {
    // ignore
  }
  return 0
}

export const EggHatchingSystem = {
  cancel(key: string): void {
    hatchingByKey.delete(key)
  },

  startShake(args: {
    key: string
    role: Role
    egg: Obstacle
    basePos: Vector3
    baseRot: Quaternion
    onComplete: () => void
    // Tunables
    durationS?: number
    freqHz?: number
    rollRad?: number
    pitchRad?: number
    tickS?: number
  }): void {
    // Ensure there is at most one shake for a given key.
    // Deleting the state acts as a soft-cancel for any pending ticks.
    hatchingByKey.delete(args.key)

    const durationS = args.durationS !== undefined ? args.durationS : 3.2
    const freqHz = args.freqHz !== undefined ? args.freqHz : 2.6
    const rollRad = args.rollRad !== undefined ? args.rollRad : 0.24
    const pitchRad = args.pitchRad !== undefined ? args.pitchRad : 0.08
    const tickS = args.tickS !== undefined ? args.tickS : 0.033

    const baseYaw = computeYawToPlayerRad(args.role, args.basePos)

    const state: HatchAnimState = {
      egg: args.egg,
      basePos: args.basePos,
      baseRot: args.baseRot,
      elapsed: 0,
      tickS,
      durationS,
      freqHz,
      rollRad,
      pitchRad,
      baseYaw,
      onComplete: args.onComplete,
    }

    hatchingByKey.set(args.key, state)

    const tick = () => {
      const cur = hatchingByKey.get(args.key)
      if (cur === undefined || cur.egg !== args.egg) return

      cur.elapsed += cur.tickS
      const t = cur.elapsed

      if (t >= cur.durationS) {
        hatchingByKey.delete(args.key)
        try {
          args.egg.set_position(cur.basePos)
        } catch {
          // ignore
        }
        try {
          args.egg.set_orientation(cur.baseRot)
        } catch {
          // ignore
        }
        try {
          cur.onComplete()
        } catch {
          // ignore
        }
        return
      }

      // Envelope: ease in/out so it doesn't instantly snap.
      const edge = 0.35
      const inW = Math.min(1, t / edge)
      const outW = Math.min(1, (cur.durationS - t) / edge)
      const w = Math.max(0, Math.min(1, inW * outW))

      const phase = t * cur.freqHz * 2 * Math.PI
      const roll = Math.sin(phase) * (cur.rollRad * w)
      const pitch = Math.sin(phase * 0.5) * (cur.pitchRad * w)

      try {
        // Keep position stable; shake by rotation only.
        args.egg.set_position(cur.basePos)
        // math.Quaternion(pitch, yaw, roll) (radians)
        args.egg.set_orientation(math.Quaternion(pitch, cur.baseYaw, roll))
      } catch {
        // ignore
      }

      LuaAPI.call_delay_time(cur.tickS as unknown as Fixed, tick)
    }

    LuaAPI.call_delay_time(tickS as unknown as Fixed, tick)
  },
}
