import type { BoardElement, Point } from "@/types"

export interface BBox {
  x: number
  y: number
  w: number
  h: number
}

export function elementBBox(el: BoardElement): BBox {
  switch (el.type) {
    case "path": {
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const pt of el.points) {
        if (pt.x < minX) minX = pt.x
        if (pt.y < minY) minY = pt.y
        if (pt.x > maxX) maxX = pt.x
        if (pt.y > maxY) maxY = pt.y
      }
      const pad = el.strokeWidth / 2
      return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 }
    }
    case "rect":
    case "ellipse":
      return { x: Math.min(el.x, el.x + el.w), y: Math.min(el.y, el.y + el.h), w: Math.abs(el.w), h: Math.abs(el.h) }
    case "line":
    case "arrow": {
      const pad = el.strokeWidth / 2
      return {
        x: Math.min(el.x1, el.x2) - pad,
        y: Math.min(el.y1, el.y2) - pad,
        w: Math.abs(el.x2 - el.x1) + pad * 2,
        h: Math.abs(el.y2 - el.y1) + pad * 2,
      }
    }
    case "image":
      return { x: el.x, y: el.y, w: el.w, h: el.h }
  }
}

export function unionBBox(boxes: BBox[]): BBox | null {
  if (boxes.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const b of boxes) {
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w)
    maxY = Math.max(maxY, b.y + b.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function boardsBBox(elements: BoardElement[]): BBox | null {
  return unionBBox(elements.map(elementBBox))
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const cx = x1 + t * dx
  const cy = y1 + t * dy
  return Math.hypot(px - cx, py - cy)
}

/** Hit-test a world-space point against an element with a tolerance in world units. */
export function hitTest(el: BoardElement, pt: Point, tol: number): boolean {
  switch (el.type) {
    case "path": {
      for (let i = 0; i < el.points.length - 1; i++) {
        const a = el.points[i]
        const b = el.points[i + 1]
        if (distToSegment(pt.x, pt.y, a.x, a.y, b.x, b.y) <= tol + el.strokeWidth / 2) return true
      }
      if (el.points.length === 1) {
        const a = el.points[0]
        return Math.hypot(pt.x - a.x, pt.y - a.y) <= tol + el.strokeWidth / 2
      }
      return false
    }
    case "rect":
    case "ellipse": {
      const x = Math.min(el.x, el.x + el.w)
      const y = Math.min(el.y, el.y + el.h)
      const w = Math.abs(el.w)
      const h = Math.abs(el.h)
      return pt.x >= x - tol && pt.x <= x + w + tol && pt.y >= y - tol && pt.y <= y + h + tol
    }
    case "line":
    case "arrow":
      return distToSegment(pt.x, pt.y, el.x1, el.y1, el.x2, el.y2) <= tol + el.strokeWidth / 2
    case "image":
      return pt.x >= el.x - tol && pt.x <= el.x + el.w + tol && pt.y >= el.y - tol && pt.y <= el.y + el.h + tol
  }
}

export function intersectsBBox(el: BoardElement, box: BBox): boolean {
  const b = elementBBox(el)
  return b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y
}

/** Scale an element's geometry by (sx, sy) around an anchor point (fixed corner). */
export function scaleElement<T extends BoardElement>(el: T, ax: number, ay: number, sx: number, sy: number): T {
  const tx = (x: number) => ax + (x - ax) * sx
  const ty = (y: number) => ay + (y - ay) * sy
  switch (el.type) {
    case "path":
      return { ...el, points: el.points.map((p) => ({ x: tx(p.x), y: ty(p.y), p: p.p })) }
    case "rect":
    case "ellipse":
      return { ...el, x: tx(el.x), y: ty(el.y), w: el.w * sx, h: el.h * sy }
    case "line":
    case "arrow":
      return { ...el, x1: tx(el.x1), y1: ty(el.y1), x2: tx(el.x2), y2: ty(el.y2) }
    case "image":
      return { ...el, x: tx(el.x), y: ty(el.y), w: el.w * sx, h: el.h * sy }
  }
}

export function translateElement<T extends BoardElement>(el: T, dx: number, dy: number): T {
  switch (el.type) {
    case "path":
      return { ...el, points: el.points.map((p) => ({ x: p.x + dx, y: p.y + dy, p: p.p })) }
    case "rect":
    case "ellipse":
    case "image":
      return { ...el, x: el.x + dx, y: el.y + dy }
    case "line":
    case "arrow":
      return { ...el, x1: el.x1 + dx, y1: el.y1 + dy, x2: el.x2 + dx, y2: el.y2 + dy }
  }
}

export type ReorderAction = "front" | "back" | "forward" | "backward"

/** Reorder selected elements within the stack (later = on top), preserving
 * their relative order. Returns null when the selection is already at the
 * requested position, so callers can skip empty history entries. */
export function reorderElements<T extends BoardElement>(
  elements: T[],
  ids: Set<string>,
  action: ReorderAction,
): T[] | null {
  if (ids.size === 0) return null
  const sel = (el: T) => ids.has(el.id)
  switch (action) {
    case "front":
    case "back": {
      const picked = elements.filter(sel)
      const rest = elements.filter((el) => !sel(el))
      const atEnd = action === "front"
      const ordered = atEnd ? [...rest, ...picked] : [...picked, ...rest]
      // No-op when the selection already sits flush at the target edge.
      const offset = atEnd ? elements.length - picked.length : 0
      for (let i = 0; i < picked.length; i++) {
        if (elements[offset + i] !== picked[i]) return ordered
      }
      return null
    }
    case "forward":
    case "backward": {
      const next = [...elements]
      let changed = false
      if (action === "forward") {
        // Iterate away from the top so a selected group moves as a block.
        for (let i = next.length - 2; i >= 0; i--) {
          if (sel(next[i]) && !sel(next[i + 1])) {
            ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
            changed = true
          }
        }
      } else {
        for (let i = 1; i < next.length; i++) {
          if (sel(next[i]) && !sel(next[i - 1])) {
            ;[next[i], next[i - 1]] = [next[i - 1], next[i]]
            changed = true
          }
        }
      }
      return changed ? next : null
    }
  }
}
