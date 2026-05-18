// Per-second-output based scaling:
// - outputPerSec = 4  => scale = 1
// - otherwise         => scale = sqrt(outputPerSec / 4)
//
// Guardrails:
// - invalid/<=0 => scale=1 (avoid NaN / negative sqrt)
export function scaleFromOutputPerSec(outputPerSec: number): number {
  if (typeof outputPerSec !== "number" || outputPerSec !== outputPerSec) return 1
  if (outputPerSec <= 0) return 1
  const s = Math.sqrt(outputPerSec / 4)
  return typeof s === "number" && s === s && s > 0 ? s : 1
}
