import type { PathElement, Point, StrokePoint } from "@/types"
import { distToSegment, type BBox } from "@/lib/geometry"
import { newId } from "@/lib/db"

/** Does an eraser circle touch an element's bbox at all? Cheap reject before
 * per-point work. */
export function circleHitsBBox(c: Point, r: number, b: BBox): boolean {
  const nx = Math.max(b.x, Math.min(c.x, b.x + b.w))
  const ny = Math.max(b.y, Math.min(c.y, b.y + b.h))
  return Math.hypot(c.x - nx, c.y - ny) <= r
}

/** Partial erase of a freehand stroke: points inside the eraser circle are
 * cut out and each surviving run becomes its own stroke — new id, same
 * style and container. Returns the element untouched when nothing was
 * erased. */
export function eraseStroke(el: PathElement, c: Point, radius: number): PathElement[] {
  const reach = radius + el.strokeWidth / 2
  const pts = el.points
  // A single-segment stroke can't survive a cut — any remainder would be a
  // lone point — so it erases whole. Testing the segment itself (not just the
  // endpoints) also makes a wipe across its middle take in one pass.
  if (pts.length === 2) {
    return distToSegment(c.x, c.y, pts[0].x, pts[0].y, pts[1].x, pts[1].y) <= reach ? [] : [el]
  }
  const keep: boolean[] = new Array(pts.length)
  let anyErased = false
  let anyKept = false
  for (let i = 0; i < pts.length; i++) {
    const inside = Math.hypot(pts[i].x - c.x, pts[i].y - c.y) <= reach
    keep[i] = !inside
    if (inside) anyErased = true
    else anyKept = true
  }
  if (!anyErased) return [el]
  if (!anyKept) return []
  const pieces: PathElement[] = []
  let run: StrokePoint[] = []
  const flush = () => {
    // A cut that leaves a single point would strand a stray dot the user has
    // to erase separately — too small to be a wanted remainder, so drop it.
    if (run.length > 1) pieces.push({ ...el, id: newId(), points: run })
    run = []
  }
  for (let i = 0; i < pts.length; i++) {
    if (keep[i]) run.push(pts[i])
    else if (run.length > 0) flush()
  }
  flush()
  return pieces
}
