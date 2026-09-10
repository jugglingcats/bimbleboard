import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react"
import {
  boardsBBox,
  elementBBox,
  hitTest,
  intersectsBBox,
  scaleElement,
  translateElement,
  type BBox,
} from "@/lib/geometry"
import type { BoardElement, Camera, ImageElement, LineElement, PathElement, ShapeElement, Tool } from "@/types"
import { newId } from "@/lib/db"
import { sampleStroke, StrokeSmoother, type StrokeSample } from "@/lib/smoothing"

export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 20
export const PALETTE = [
  "#1e1e1e",
  "#e11d48",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#78716c",
  "#ffffff",
]

export interface CanvasHandle {
  zoomBy: (factor: number, center?: { x: number; y: number }) => void
  resetZoom: () => void
  fitAll: () => void
  getCamera: () => Camera
  setCameraAbsolute: (cam: Camera) => void
  viewportCenter: () => { x: number; y: number }
}

interface Props {
  elements: BoardElement[]
  tool: Tool
  color: string
  strokeWidth: number
  selectedIds: Set<string>
  onSelectionChange: (ids: Set<string>) => void
  onElementsChange: (elements: BoardElement[]) => void
  onCommit: (updater: (els: BoardElement[]) => BoardElement[], opts?: { history?: boolean }) => void
  onBeginAction: () => void
  onCameraChange: (camera: Camera) => void
}

type Mode = "idle" | "pan" | "draw" | "shape" | "marquee" | "move" | "resize" | "erase"

interface ResizeState {
  handle: string
  startBBox: BBox
  startPointer: { x: number; y: number }
  snapshot: BoardElement[]
}

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const
const HANDLE_SIZE = 9

/** Stroke one polyline of spline samples at a constant width. */
function strokeRun(ctx: CanvasRenderingContext2D, samples: StrokeSample[], from: number, to: number, w: number) {
  ctx.lineWidth = w
  ctx.beginPath()
  ctx.moveTo(samples[from].x, samples[from].y)
  for (let i = from + 1; i <= to; i++) ctx.lineTo(samples[i].x, samples[i].y)
  ctx.stroke()
}

function selectionBox(elements: BoardElement[], ids: Set<string>): BBox | null {
  const sel = elements.filter((e) => ids.has(e.id))
  if (sel.length === 0) return null
  const boxes = sel.map(elementBBox)
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

const BoardCanvas = forwardRef<CanvasHandle, Props>(function BoardCanvas(props, ref) {
  const {
    elements,
    tool,
    color,
    strokeWidth,
    selectedIds,
    onSelectionChange,
    onElementsChange,
    onCommit,
    onBeginAction,
    onCameraChange,
  } = props

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 })
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 })
  const dirtyRef = useRef(true)
  const rafRef = useRef(0)

  // Interaction state
  const modeRef = useRef<Mode>("idle")
  const activePointerRef = useRef<number | null>(null)
  const panButtonRef = useRef(false)
  const spaceRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const dragLastRef = useRef({ x: 0, y: 0 })
  const liveElementRef = useRef<BoardElement | null>(null)
  const marqueeRef = useRef<BBox | null>(null)
  const moveSnapshotRef = useRef<BoardElement[]>([])
  const moveStartedRef = useRef(false)
  const resizeRef = useRef<ResizeState | null>(null)
  const resizeStartedRef = useRef(false)
  const eraseDoneRef = useRef(false)
  const strokeSmootherRef = useRef<StrokeSmoother | null>(null)

  // Keep latest props in refs for event handlers
  const elementsRef = useRef(elements)
  elementsRef.current = elements
  const toolRef = useRef(tool)
  toolRef.current = tool
  const colorRef = useRef(color)
  colorRef.current = color
  const strokeRef = useRef(strokeWidth)
  strokeRef.current = strokeWidth
  const selectedRef = useRef(selectedIds)
  selectedRef.current = selectedIds

  const imageCache = useRef(new Map<string, HTMLImageElement>())

  const invalidate = useCallback(() => {
    dirtyRef.current = true
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0
        if (dirtyRef.current) {
          dirtyRef.current = false
          draw()
        }
      })
    }
  }, [])

  const toWorld = useCallback((sx: number, sy: number) => {
    const cam = cameraRef.current
    return { x: (sx - cam.x) / cam.zoom, y: (sy - cam.y) / cam.zoom }
  }, [])

  const setCamera = useCallback(
    (cam: Camera) => {
      cameraRef.current = cam
      onCameraChange(cam)
      invalidate()
    },
    [invalidate, onCameraChange],
  )

  const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

  const zoomAt = useCallback(
    (factor: number, center?: { x: number; y: number }) => {
      const cam = cameraRef.current
      const { w, h } = sizeRef.current
      const cx = center?.x ?? w / 2
      const cy = center?.y ?? h / 2
      const world = { x: (cx - cam.x) / cam.zoom, y: (cy - cam.y) / cam.zoom }
      const zoom = clampZoom(cam.zoom * factor)
      setCamera({ x: cx - world.x * zoom, y: cy - world.y * zoom, zoom })
    },
    [setCamera],
  )

  const fitAll = useCallback(() => {
    const { w, h } = sizeRef.current
    const bbox = boardsBBox(elementsRef.current)
    if (!bbox || bbox.w === 0 || bbox.h === 0) {
      setCamera({ x: 0, y: 0, zoom: 1 })
      return
    }
    const pad = 80
    const zoom = clampZoom(Math.min((w - pad) / bbox.w, (h - pad) / bbox.h))
    setCamera({
      x: w / 2 - (bbox.x + bbox.w / 2) * zoom,
      y: h / 2 - (bbox.y + bbox.h / 2) * zoom,
      zoom,
    })
  }, [setCamera])

  useImperativeHandle(ref, () => ({
    zoomBy: zoomAt,
    resetZoom: () => setCamera({ x: sizeRef.current.w / 2, y: sizeRef.current.h / 2, zoom: 1 }),
    fitAll,
    getCamera: () => cameraRef.current,
    setCameraAbsolute: (cam: Camera) => setCamera(cam),
    viewportCenter: () => toWorld(sizeRef.current.w / 2, sizeRef.current.h / 2),
  }))

  // ---------- Drawing ----------

  const drawPath = (ctx: CanvasRenderingContext2D, el: PathElement) => {
    const pts = el.points
    if (pts.length === 0) return
    ctx.strokeStyle = el.color
    ctx.fillStyle = el.color
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    if (pts.length === 1) {
      const p = pts[0]
      ctx.beginPath()
      ctx.arc(p.x, p.y, (el.strokeWidth * (0.5 + p.p)) / 2, 0, Math.PI * 2)
      ctx.fill()
      return
    }
    const zoom = cameraRef.current.zoom
    const samples = sampleStroke(pts, el.strokeWidth, zoom)
    // Batch consecutive samples of near-identical width (≤ half a screen px
    // apart) into one polyline — constant-pressure strokes then stroke as a
    // single path instead of one draw call per sample.
    const eps = 0.5 / zoom
    let start = 0
    let runW = samples[0].w
    for (let i = 1; i < samples.length; i++) {
      if (Math.abs(samples[i].w - runW) > eps) {
        strokeRun(ctx, samples, start, i, runW)
        start = i - 1 // overlap one sample so the runs join seamlessly
        runW = samples[i].w
      }
    }
    strokeRun(ctx, samples, start, samples.length - 1, runW)
  }

  const drawShape = (ctx: CanvasRenderingContext2D, el: ShapeElement) => {
    ctx.strokeStyle = el.color
    ctx.lineWidth = el.strokeWidth
    ctx.beginPath()
    if (el.type === "rect") {
      ctx.rect(el.x, el.y, el.w, el.h)
    } else {
      ctx.ellipse(el.x + el.w / 2, el.y + el.h / 2, Math.abs(el.w / 2), Math.abs(el.h / 2), 0, 0, Math.PI * 2)
    }
    ctx.stroke()
  }

  const drawLine = (ctx: CanvasRenderingContext2D, el: LineElement) => {
    ctx.strokeStyle = el.color
    ctx.lineWidth = el.strokeWidth
    ctx.lineCap = "round"
    ctx.beginPath()
    ctx.moveTo(el.x1, el.y1)
    ctx.lineTo(el.x2, el.y2)
    ctx.stroke()
    if (el.type === "arrow") {
      const angle = Math.atan2(el.y2 - el.y1, el.x2 - el.x1)
      const len = Math.max(12, el.strokeWidth * 4)
      ctx.beginPath()
      ctx.moveTo(el.x2, el.y2)
      ctx.lineTo(el.x2 - len * Math.cos(angle - Math.PI / 6), el.y2 - len * Math.sin(angle - Math.PI / 6))
      ctx.lineTo(el.x2 - len * Math.cos(angle + Math.PI / 6), el.y2 - len * Math.sin(angle + Math.PI / 6))
      ctx.closePath()
      ctx.fillStyle = el.color
      ctx.fill()
    }
  }

  const drawImageEl = (ctx: CanvasRenderingContext2D, el: ImageElement) => {
    let img = imageCache.current.get(el.id)
    if (!img) {
      img = new Image()
      img.onload = () => invalidate()
      img.src = el.src
      imageCache.current.set(el.id, img)
    }
    if (img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, el.x, el.y, el.w, el.h)
    } else {
      ctx.fillStyle = "#e5e5e5"
      ctx.fillRect(el.x, el.y, el.w, el.h)
    }
  }

  const drawElement = (ctx: CanvasRenderingContext2D, el: BoardElement) => {
    switch (el.type) {
      case "path":
        return drawPath(ctx, el)
      case "rect":
      case "ellipse":
        return drawShape(ctx, el)
      case "line":
      case "arrow":
        return drawLine(ctx, el)
      case "image":
        return drawImageEl(ctx, el)
    }
  }

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const { w, h, dpr } = sizeRef.current
    const cam = cameraRef.current

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = "#fafafa"
    ctx.fillRect(0, 0, w, h)

    // Dot grid — spacing adapts to zoom so it stays readable at any scale.
    const baseStep = 32
    let step = baseStep * cam.zoom
    while (step < 16) step *= 4
    while (step > 80) step /= 2
    const worldStep = step / cam.zoom
    const startX = Math.floor((-cam.x / cam.zoom) / worldStep) * worldStep
    const startY = Math.floor((-cam.y / cam.zoom) / worldStep) * worldStep
    const endX = (w - cam.x) / cam.zoom
    const endY = (h - cam.y) / cam.zoom
    ctx.fillStyle = "rgba(0,0,0,0.14)"
    for (let wx = startX; wx < endX; wx += worldStep) {
      for (let wy = startY; wy < endY; wy += worldStep) {
        const sx = wx * cam.zoom + cam.x
        const sy = wy * cam.zoom + cam.y
        ctx.fillRect(sx, sy, 1.2, 1.2)
      }
    }

    // World-space elements
    ctx.save()
    ctx.translate(cam.x, cam.y)
    ctx.scale(cam.zoom, cam.zoom)

    const visible = {
      x0: -cam.x / cam.zoom,
      y0: -cam.y / cam.zoom,
      x1: (w - cam.x) / cam.zoom,
      y1: (h - cam.y) / cam.zoom,
    }

    const all = [...elementsRef.current]
    if (liveElementRef.current) all.push(liveElementRef.current)
    for (const el of all) {
      const b = elementBBox(el)
      if (b.x + b.w < visible.x0 || b.x > visible.x1 || b.y + b.h < visible.y0 || b.y > visible.y1) continue
      drawElement(ctx, el)
    }
    ctx.restore()

    // Selection overlay (screen space, constant-size handles)
    const selBox = selectionBox(elementsRef.current, selectedRef.current)
    if (selBox && toolRef.current !== "pen" && toolRef.current !== "eraser") {
      const sx = selBox.x * cam.zoom + cam.x
      const sy = selBox.y * cam.zoom + cam.y
      const sw = selBox.w * cam.zoom
      const sh = selBox.h * cam.zoom
      ctx.strokeStyle = "#3b82f6"
      ctx.lineWidth = 1.5
      ctx.setLineDash([5, 4])
      ctx.strokeRect(sx - 3, sy - 3, sw + 6, sh + 6)
      ctx.setLineDash([])
      ctx.fillStyle = "#ffffff"
      ctx.strokeStyle = "#3b82f6"
      for (const handle of HANDLES) {
        const pos = handlePosition(sx - 3, sy - 3, sw + 6, sh + 6, handle)
        ctx.beginPath()
        ctx.rect(pos.x - HANDLE_SIZE / 2, pos.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE)
        ctx.fill()
        ctx.stroke()
      }
    }

    // Live marquee
    if (marqueeRef.current) {
      const m = marqueeRef.current
      const mx = Math.min(m.x, m.x + m.w)
      const my = Math.min(m.y, m.y + m.h)
      ctx.strokeStyle = "#3b82f6"
      ctx.fillStyle = "rgba(59,130,246,0.08)"
      ctx.lineWidth = 1
      ctx.fillRect(mx * cam.zoom + cam.x, my * cam.zoom + cam.y, Math.abs(m.w) * cam.zoom, Math.abs(m.h) * cam.zoom)
      ctx.strokeRect(mx * cam.zoom + cam.x, my * cam.zoom + cam.y, Math.abs(m.w) * cam.zoom, Math.abs(m.h) * cam.zoom)
    }
  }, [invalidate])

  function handlePosition(x: number, y: number, w: number, h: number, handle: string) {
    switch (handle) {
      case "nw":
        return { x, y }
      case "n":
        return { x: x + w / 2, y }
      case "ne":
        return { x: x + w, y }
      case "e":
        return { x: x + w, y: y + h / 2 }
      case "se":
        return { x: x + w, y: y + h }
      case "s":
        return { x: x + w / 2, y: y + h }
      case "sw":
        return { x, y: y + h }
      case "w":
        return { x, y: y + h / 2 }
    }
    return { x, y }
  }

  // ---------- Resize helpers ----------

  const handleAt = useCallback((worldX: number, worldY: number): string | null => {
    if (selectedRef.current.size === 0) return null
    const cam = cameraRef.current
    const selBox = selectionBox(elementsRef.current, selectedRef.current)
    if (!selBox) return null
    const sx = selBox.x * cam.zoom + cam.x
    const sy = selBox.y * cam.zoom + cam.y
    const sw = selBox.w * cam.zoom
    const sh = selBox.h * cam.zoom
    const px = worldX * cam.zoom + cam.x
    const py = worldY * cam.zoom + cam.y
    const tol = HANDLE_SIZE + 4
    for (const handle of HANDLES) {
      const pos = handlePosition(sx - 3, sy - 3, sw + 6, sh + 6, handle)
      if (Math.abs(px - pos.x) <= tol && Math.abs(py - pos.y) <= tol) return handle
    }
    return null
  }, [])

  const applyResize = (state: ResizeState, handle: string, worldX: number, worldY: number): BoardElement[] => {
    const b = state.startBBox
    const minSize = 2
    // Track the drag delta from where the pointer grabbed the handle —
    // not its absolute position, which is offset from the bbox by the handle's
    // screen-space padding. Edges then follow the cursor exactly.
    const dx = worldX - state.startPointer.x
    const dy = worldY - state.startPointer.y
    let { x, y, w, h } = b
    if (handle.includes("e")) w = Math.max(minSize, b.w + dx)
    if (handle.includes("s")) h = Math.max(minSize, b.h + dy)
    if (handle.includes("w")) {
      x = Math.min(b.x + b.w - minSize, b.x + dx)
      w = b.x + b.w - x
    }
    if (handle.includes("n")) {
      y = Math.min(b.y + b.h - minSize, b.y + dy)
      h = b.y + b.h - y
    }
    const sx = w / Math.max(b.w, 1)
    const sy = h / Math.max(b.h, 1)
    const ax = handle.includes("w") ? b.x + b.w : b.x
    const ay = handle.includes("n") ? b.y + b.h : b.y
    const ids = selectedRef.current
    // Scale from the gesture-start snapshot — elementsRef.current is already
    // scaled by earlier moves in this drag, so scaling it again compounds.
    const snapMap = new Map(state.snapshot.map((el) => [el.id, el]))
    return elementsRef.current.map((el) => {
      if (!ids.has(el.id)) return el
      const orig = snapMap.get(el.id)
      if (!orig) return el
      const scaled = scaleElement(orig, ax, ay, sx, sy)
      // Scale stroke width for strokes/shapes so they stay proportional.
      if (scaled.type !== "image") {
        const f = Math.sqrt(Math.abs(sx * sy))
        return { ...scaled, strokeWidth: Math.max(0.5, (scaled as PathElement).strokeWidth * f) } as BoardElement
      }
      return scaled
    })
  }

  // ---------- Pointer interaction ----------

  const pointerPos = (e: ReactPointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {
      screen: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      world: toWorld(e.clientX - rect.left, e.clientY - rect.top),
    }
  }

  const topElementAt = (worldX: number, worldY: number): BoardElement | null => {
    const tol = 8 / cameraRef.current.zoom
    for (let i = elementsRef.current.length - 1; i >= 0; i--) {
      if (hitTest(elementsRef.current[i], { x: worldX, y: worldY }, tol)) return elementsRef.current[i]
    }
    return null
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (modeRef.current !== "idle") return
    if (activePointerRef.current !== null) return // single active pointer
    const { screen, world } = pointerPos(e)
    const t = toolRef.current

    const wantPan = e.button === 1 || e.button === 2 || spaceRef.current || (e.pointerType === "touch" && e.isPrimary === false)
    if (wantPan) {
      activePointerRef.current = e.pointerId
      modeRef.current = "pan"
      panButtonRef.current = true
      dragStartRef.current = screen
      dragLastRef.current = screen
      canvasRef.current!.setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0) return

    activePointerRef.current = e.pointerId
    canvasRef.current!.setPointerCapture(e.pointerId)
    dragStartRef.current = world
    dragLastRef.current = world

    switch (t) {
      case "pen": {
        const pressure = e.pointerType === "pen" ? e.pressure : 0.5
        strokeSmootherRef.current = new StrokeSmoother()
        const smooth = strokeSmootherRef.current.add(screen.x, screen.y, pressure, e.nativeEvent.timeStamp)
        liveElementRef.current = {
          id: newId(),
          type: "path",
          points: [{ x: world.x, y: world.y, p: smooth.p }],
          color: colorRef.current,
          strokeWidth: strokeRef.current,
        }
        modeRef.current = "draw"
        invalidate()
        break
      }
      case "rect":
      case "ellipse":
      case "line":
      case "arrow": {
        const isLine = t === "line" || t === "arrow"
        liveElementRef.current = {
          id: newId(),
          type: isLine ? (t as "line" | "arrow") : (t as "rect" | "ellipse"),
          ...(isLine
            ? { x1: world.x, y1: world.y, x2: world.x, y2: world.y }
            : { x: world.x, y: world.y, w: 0, h: 0 }),
          color: colorRef.current,
          strokeWidth: strokeRef.current,
        } as BoardElement
        modeRef.current = "shape"
        invalidate()
        break
      }
      case "eraser": {
        modeRef.current = "erase"
        eraseDoneRef.current = false
        eraseAt(world)
        break
      }
      case "select": {
        // Resize handle?
        const handle = handleAt(world.x, world.y)
        if (handle) {
          const selBox = selectionBox(elementsRef.current, selectedRef.current)!
          resizeRef.current = {
            handle,
            startBBox: selBox,
            startPointer: world,
            snapshot: elementsRef.current,
          }
          resizeStartedRef.current = false
          modeRef.current = "resize"
          return
        }
        const hit = topElementAt(world.x, world.y)
        if (hit) {
          let nextSel: Set<string>
          if (e.shiftKey) {
            nextSel = new Set(selectedRef.current)
            if (nextSel.has(hit.id)) nextSel.delete(hit.id)
            else nextSel.add(hit.id)
          } else if (!selectedRef.current.has(hit.id)) {
            nextSel = new Set([hit.id])
          } else {
            nextSel = selectedRef.current
          }
          onSelectionChange(nextSel)
          selectedRef.current = nextSel
          moveSnapshotRef.current = elementsRef.current.filter((el) => nextSel.has(el.id)).map((el) => ({ ...el }))
          moveStartedRef.current = false
          modeRef.current = "move"
        } else {
          if (!e.shiftKey) onSelectionChange(new Set())
          selectedRef.current = new Set()
          marqueeRef.current = { x: world.x, y: world.y, w: 0, h: 0 }
          modeRef.current = "marquee"
          invalidate()
        }
        break
      }
    }
  }

  const eraseAt = (world: { x: number; y: number }) => {
    const tol = 10 / cameraRef.current.zoom
    const hitIds = new Set<string>()
    for (const el of elementsRef.current) {
      if (hitTest(el, world, tol)) hitIds.add(el.id)
    }
    if (hitIds.size > 0) {
      // Take one history entry for the whole erase drag, on first contact.
      if (!eraseDoneRef.current) {
        onBeginAction()
        eraseDoneRef.current = true
      }
      onElementsChange(elementsRef.current.filter((el) => !hitIds.has(el.id)))
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (modeRef.current === "idle") return
    if (e.pointerId !== activePointerRef.current) return
    const { screen, world } = pointerPos(e)
    const start = dragStartRef.current

    switch (modeRef.current) {
      case "pan": {
        const cam = cameraRef.current
        cameraRef.current = { ...cam, x: cam.x + (screen.x - dragLastRef.current.x), y: cam.y + (screen.y - dragLastRef.current.y) }
        dragLastRef.current = screen
        invalidate()
        break
      }
      case "draw": {
        const live = liveElementRef.current as PathElement
        const smoother = strokeSmootherRef.current
        if (!smoother) break
        // Coalesced events give smooth high-frequency pen input (Chrome).
        const events = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? []
        const samples = events.length > 0 ? events : [e.nativeEvent as PointerEvent]
        const rect = canvasRef.current!.getBoundingClientRect()
        const cam = cameraRef.current
        for (const ev of samples) {
          // Filter in screen space (where device jitter lives), then convert.
          const smooth = smoother.add(
            ev.clientX - rect.left,
            ev.clientY - rect.top,
            ev.pointerType === "pen" ? ev.pressure : 0.5,
            ev.timeStamp,
          )
          const wx = (smooth.x - cam.x) / cam.zoom
          const wy = (smooth.y - cam.y) / cam.zoom
          const last = live.points[live.points.length - 1]
          if (last && Math.hypot(wx - last.x, wy - last.y) < 0.75 / cam.zoom) continue
          live.points.push({ x: wx, y: wy, p: smooth.p })
        }
        invalidate()
        break
      }
      case "shape": {
        const live = liveElementRef.current
        if (live && (live.type === "rect" || live.type === "ellipse")) {
          if (e.shiftKey) {
            // Shift: square
            const s = Math.max(Math.abs(world.x - start.x), Math.abs(world.y - start.y))
            live.w = Math.sign(world.x - start.x) * s || s
            live.h = Math.sign(world.y - start.y) * s || s
          } else {
            live.w = world.x - start.x
            live.h = world.y - start.y
          }
        } else if (live && (live.type === "line" || live.type === "arrow")) {
          let x2 = world.x
          let y2 = world.y
          if (e.shiftKey) {
            // Shift: snap to 45° increments
            const dx = x2 - start.x
            const dy = y2 - start.y
            const angle = Math.atan2(dy, dx)
            const snap = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4)
            const len = Math.hypot(dx, dy)
            x2 = start.x + Math.cos(snap) * len
            y2 = start.y + Math.sin(snap) * len
          }
          live.x2 = x2
          live.y2 = y2
        }
        invalidate()
        break
      }
      case "erase": {
        eraseAt(world)
        break
      }
      case "move": {
        const dx = world.x - start.x
        const dy = world.y - start.y
        if (dx === 0 && dy === 0) break
        if (!moveStartedRef.current) {
          onBeginAction()
          moveStartedRef.current = true
        }
        // Translate the gesture-start snapshot, not the live elements —
        // elementsRef.current already carries earlier deltas from this drag,
        // so translating it again would compound the movement.
        const snapMap = new Map(moveSnapshotRef.current.map((el) => [el.id, el]))
        onElementsChange(
          elementsRef.current.map((el) => {
            const orig = snapMap.get(el.id)
            return orig ? translateElement(orig, dx, dy) : el
          }),
        )
        break
      }
      case "resize": {
        if (resizeRef.current) {
          if (!resizeStartedRef.current) {
            onBeginAction()
            resizeStartedRef.current = true
          }
          onElementsChange(applyResize(resizeRef.current, resizeRef.current.handle, world.x, world.y))
        }
        break
      }
      case "marquee": {
        marqueeRef.current = { x: start.x, y: start.y, w: world.x - start.x, h: world.y - start.y }
        invalidate()
        break
      }
    }
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerId !== activePointerRef.current) return
    const mode = modeRef.current
    modeRef.current = "idle"
    activePointerRef.current = null
    panButtonRef.current = false
    strokeSmootherRef.current = null
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      // pointer already released
    }

    switch (mode) {
      case "pan": {
        onCameraChange(cameraRef.current)
        break
      }
      case "draw":
      case "shape": {
        const live = liveElementRef.current
        liveElementRef.current = null
        if (live) {
          const b = elementBBox(live)
          const tooSmall = b.w < 2 && b.h < 2 && live.type !== "path"
          const emptyPath = live.type === "path" && live.points.length < 2
          if (!tooSmall && !emptyPath) {
            onCommit((els) => [...els, live])
          }
        }
        invalidate()
        break
      }
      case "marquee": {
        const m = marqueeRef.current
        marqueeRef.current = null
        if (m) {
          const box: BBox = {
            x: Math.min(m.x, m.x + m.w),
            y: Math.min(m.y, m.y + m.h),
            w: Math.abs(m.w),
            h: Math.abs(m.h),
          }
          if (box.w > 3 || box.h > 3) {
            const ids = new Set(elementsRef.current.filter((el) => intersectsBBox(el, box)).map((el) => el.id))
            onSelectionChange(ids)
            selectedRef.current = ids
          }
        }
        invalidate()
        break
      }
      case "erase": {
        break
      }
      case "move":
      case "resize": {
        // history was taken at gesture start via onBeginAction
        break
      }
    }
  }

  // ---------- Wheel: pan + zoom ----------

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const cam = cameraRef.current
      if (e.ctrlKey || e.metaKey) {
        const rect = canvas.getBoundingClientRect()
        const cx = e.clientX - rect.left
        const cy = e.clientY - rect.top
        const world = { x: (cx - cam.x) / cam.zoom, y: (cy - cam.y) / cam.zoom }
        const scale = Math.exp(-e.deltaY * 0.0018)
        const zoom = clampZoom(cam.zoom * scale)
        cameraRef.current = { x: cx - world.x * zoom, y: cy - world.y * zoom, zoom }
      } else {
        const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1
        cameraRef.current = { ...cam, x: cam.x - e.deltaX * scale, y: cam.y - e.deltaY * scale }
      }
      dirtyRef.current = true
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0
          if (dirtyRef.current) {
            dirtyRef.current = false
            draw()
          }
          onCameraChange(cameraRef.current)
        })
      }
    }
    canvas.addEventListener("wheel", onWheel, { passive: false })
    return () => canvas.removeEventListener("wheel", onWheel)
  }, [draw, onCameraChange])

  // ---------- Resize observer ----------

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3)
      const w = container.clientWidth
      const h = container.clientHeight
      sizeRef.current = { w, h, dpr }
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      invalidate()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(container)
    return () => ro.disconnect()
  }, [invalidate])

  // Redraw when elements/selection/tool props change
  useEffect(() => {
    invalidate()
  }, [elements, selectedIds, tool, color, strokeWidth, invalidate])

  // ---------- Keyboard: space to pan ----------

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        spaceRef.current = true
        e.preventDefault()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceRef.current = false
    }
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
    }
  }, [])

  const cursor = (() => {
    if (spaceRef.current || modeRef.current === "pan") return "grab"
    switch (tool) {
      case "select":
        return "default"
      case "eraser":
        return "crosshair"
      default:
        return "crosshair"
    }
  })()

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden">
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none select-none"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  )
})

export default BoardCanvas
