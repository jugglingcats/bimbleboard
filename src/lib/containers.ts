import type { BoardElement, PostitElement } from "@/types"
import { elementBBox, intersectsBBox, type BBox } from "@/lib/geometry"

/**
 * Single-level container hierarchy: container-type elements may fully contain
 * other elements, but never other containers. Containment is stored on the
 * child (`containerId`); array order stays the z-order and children always
 * render just above their container.
 *
 * To add a new container type: extend the `isContainer` check — everything
 * else here is type-agnostic.
 */

export function isContainer(el: BoardElement): el is PostitElement {
  return el.type === "postit"
}

function bboxInside(child: BBox, parent: BBox): boolean {
  return child.x >= parent.x && child.y >= parent.y && child.x + child.w <= parent.x + parent.w && child.y + child.h <= parent.y + parent.h
}

/** Topmost container whose bounds fully contain `box`, or null. */
export function findContainer(elements: BoardElement[], box: BBox): BoardElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i]
    if (isContainer(el) && bboxInside(box, elementBBox(el))) return el
  }
  return null
}

/** Containment for a freshly created element: containers cannot nest, so a
 * container is never contained; anything else is contained when fully inside
 * one. */
export function withContainment(elements: BoardElement[], el: BoardElement): BoardElement {
  if (isContainer(el)) return el
  const parent = findContainer(elements, elementBBox(el))
  return parent ? { ...el, containerId: parent.id } : el
}

/** Re-evaluate containment after a drag: fully inside a container → that
 * container; still overlapping the previous container → keep it (so a small
 * overhang doesn't detach the element — drag fully out to free it). */
export function recontainAfterDrag(elements: BoardElement[], el: BoardElement): BoardElement {
  if (isContainer(el)) return el
  const box = elementBBox(el)
  const parent = findContainer(elements, box)
  if (parent) {
    return parent.id === el.containerId ? el : { ...el, containerId: parent.id }
  }
  if (el.containerId) {
    const prev = elements.find((e) => e.id === el.containerId)
    if (prev && intersectsBBox(el, elementBBox(prev))) return el
    return { ...el, containerId: undefined }
  }
  return el
}

/** Draw order: children always render just above their container, whatever
 * their array position; everything else keeps array order. Hit-testing uses
 * the same order so clicks resolve top-down visually. */
export function renderOrder(elements: BoardElement[]): BoardElement[] {
  const present = new Set(elements.map((e) => e.id))
  const children = new Map<string, BoardElement[]>()
  const hoisted = new Set<BoardElement>()
  for (const el of elements) {
    const cid = el.containerId
    if (!cid || !present.has(cid)) continue
    const list = children.get(cid)
    if (list) list.push(el)
    else children.set(cid, [el])
    hoisted.add(el)
  }
  const out: BoardElement[] = []
  for (const el of elements) {
    if (hoisted.has(el)) continue
    out.push(el)
    if (isContainer(el)) {
      const kids = children.get(el.id)
      if (kids) out.push(...kids)
    }
  }
  return out
}

/** Ids to translate when the selection moves: the selection plus children of
 * selected containers — moving a container carries its children along. */
export function idsToMoveWith(selected: Set<string>, elements: BoardElement[]): Set<string> {
  const ids = new Set(selected)
  for (const el of elements) {
    if (el.containerId && selected.has(el.containerId)) ids.add(el.id)
  }
  return ids
}

/** Remove elements, clearing containerId references to them so children of a
 * deleted container stay on the board as free elements. */
export function withoutElements(elements: BoardElement[], removedIds: Set<string>): BoardElement[] {
  return elements
    .filter((el) => !removedIds.has(el.id))
    .map((el) => (el.containerId && removedIds.has(el.containerId) ? { ...el, containerId: undefined } : el))
}
