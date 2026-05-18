export type PlotKey = string

export function makePlotKey(ownerRoleId: RoleID, plotId: string): PlotKey {
  return `${ownerRoleId}:${plotId}`
}

function parseUnsignedInt10(s: string): number | null {
  if (s.length === 0) return null
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 48 || c > 57) return null
    n = n * 10 + (c - 48)
  }
  return n
}

export function parsePlotKey(key: PlotKey): { ownerRoleId: RoleID; plotId: string } | null {
  const idx = key.indexOf(":")
  if (idx <= 0) return null

  const ownerStr = key.slice(0, idx)
  const plotId = key.slice(idx + 1)
  if (plotId.length === 0) return null

  // NOTE: in this runtime sandbox, tonumber may be unavailable.
  // Avoid Number()/tonumber by parsing digits manually.
  const ownerRoleId = parseUnsignedInt10(ownerStr)
  if (ownerRoleId === null) return null

  return { ownerRoleId: ownerRoleId as unknown as RoleID, plotId }
}
