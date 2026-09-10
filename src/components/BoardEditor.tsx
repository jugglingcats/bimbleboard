import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  BringToFront,
  Eraser,
  Hand,
  Maximize,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  SendToBack,
  Square,
  StickyNote,
  Trash2,
  Undo2,
  Circle,
  Slash,
  MoveUpRight,
} from "lucide-react"
import BoardCanvas, {
  MAX_ZOOM,
  MIN_ZOOM,
  PALETTE,
  POSTIT_FILL,
  POSTIT_FONT,
  POSTIT_PADDING,
  POSTIT_TEXT,
  type CanvasHandle,
} from "@/components/BoardCanvas"
import { Button } from "@/components/ui/button"
import { elementBBox, reorderElements, type ReorderAction } from "@/lib/geometry"
import { withContainment, withoutElements } from "@/lib/containers"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Slider } from "@/components/ui/slider"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { navigate } from "@/lib/router"
import type { BoardElement, Camera, ImageElement, PostitElement, Tool } from "@/types"
import { newId } from "@/lib/db"
import type { BoardState } from "@/hooks/useBoard"

const TOOLS: { id: Tool; label: string; icon: typeof Pencil; shortcut: string }[] = [
  { id: "select", label: "Select", icon: MousePointer2, shortcut: "V" },
  { id: "pen", label: "Pen", icon: Pencil, shortcut: "P" },
  { id: "eraser", label: "Eraser", icon: Eraser, shortcut: "E" },
  { id: "rect", label: "Rectangle", icon: Square, shortcut: "R" },
  { id: "ellipse", label: "Ellipse", icon: Circle, shortcut: "O" },
  { id: "line", label: "Line", icon: Slash, shortcut: "L" },
  { id: "arrow", label: "Arrow", icon: MoveUpRight, shortcut: "A" },
  { id: "postit", label: "Post-it", icon: StickyNote, shortcut: "N" },
]

const STROKE_WIDTHS = [2, 4, 8, 14]

const POSTIT_ALIGNMENTS = [
  { align: "left", icon: AlignLeft },
  { align: "center", icon: AlignCenter },
  { align: "right", icon: AlignRight },
] as const

const POSTIT_FONT_SIZES = [
  { label: "S", size: 14 },
  { label: "M", size: 20 },
  { label: "L", size: 28 },
]

type MenuAction = "back" | "front" | "delete"

const MENU_ACTIONS: { action: MenuAction; label: string; icon: typeof Pencil }[] = [
  { action: "back", label: "Send to back", icon: SendToBack },
  { action: "front", label: "Bring to front", icon: BringToFront },
  { action: "delete", label: "Delete (Del)", icon: Trash2 },
]

/** Vertical context menu anchored outside an element's top-right corner.
 * `children` hold type-specific settings (e.g. post-it text controls) shown
 * above the actions every element gets. */
function SelectionMenu(props: { left: number; top: number; onAction: (action: MenuAction) => void; children?: ReactNode }) {
  return (
    <div
      className="absolute z-20 flex w-9 flex-col items-center gap-1 rounded-lg border border-neutral-200 bg-white/95 p-1 shadow-lg backdrop-blur"
      style={{ left: props.left, top: props.top }}
    >
      {props.children}
      {props.children ? <Separator className="w-full" /> : null}
      {MENU_ACTIONS.map(({ action, label, icon: Icon }) => (
        <Button key={action} variant="ghost" size="icon-sm" onClick={() => props.onAction(action)} title={label}>
          <Icon className="h-4 w-4" />
        </Button>
      ))}
    </div>
  )
}

interface Props {
  state: BoardState
}

export default function BoardEditor({ state }: Props) {
  const { board, commit, update, beginAction, setCamera, undo, redo, canUndo, canRedo, rename } = state
  const canvasRef = useRef<CanvasHandle>(null)
  const [tool, setTool] = useState<Tool>("pen")
  const [color, setColor] = useState("#1e1e1e")
  const [strokeWidth, setStrokeWidth] = useState(4)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Full camera state so HTML overlays (post-it menu, text editor) can track
  // the canvas transform.
  const [camera, setCameraState] = useState<Camera>({ x: 0, y: 0, zoom: 1 })
  const zoom = camera.zoom
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [nameDialogOpen, setNameDialogOpen] = useState(false)
  const [nameDraft, setNameDraft] = useState("")

  // Keep tool refs current for keyboard shortcuts
  const toolRef = useRef(tool)
  toolRef.current = tool
  const selectedRef = useRef(selectedIds)
  selectedRef.current = selectedIds
  // True while a stroke-width slider drag is in progress, so a selection
  // restyle takes one undo entry for the whole gesture, not one per tick.
  const strokeGestureRef = useRef(false)

  const onCameraChange = useCallback(
    (cam: Camera) => {
      setCameraState(cam)
      setCamera(cam)
    },
    [setCamera],
  )

  const handleElementsChange = useCallback((els: BoardElement[]) => update(() => els), [update])

  const deleteSelected = useCallback(() => {
    if (selectedRef.current.size === 0) return
    const ids = selectedRef.current
    // Children of a deleted container stay, detached.
    commit((els) => withoutElements(els, ids))
    setSelectedIds(new Set())
  }, [commit])

  const reorderSelected = useCallback(
    (action: ReorderAction) => {
      if (selectedRef.current.size === 0) return
      const ids = selectedRef.current
      commit((els) => reorderElements(els, ids, action) ?? els)
    },
    [commit],
  )

  // Restyle the current selection; the value also stays the tool default for
  // whatever is drawn next. Elements without the property (images, post-its)
  // are left untouched.
  const applyToSelection = useCallback(
    (patch: Partial<{ color: string; strokeWidth: number }>, history = true) => {
      const ids = selectedRef.current
      if (ids.size === 0) return
      const mutate = (els: BoardElement[]) => {
        let changed = false
        const next = els.map((el) => {
          if (ids.has(el.id) && "color" in el) {
            changed = true
            return { ...el, ...patch }
          }
          return el
        })
        return changed ? next : els
      }
      if (history) commit(mutate)
      else update(mutate)
    },
    [commit, update],
  )

  const changeColor = (c: string) => {
    setColor(c)
    applyToSelection({ color: c })
  }

  const changeStrokeWidth = (w: number, history = true) => {
    setStrokeWidth(w)
    applyToSelection({ strokeWidth: w }, history)
  }

  // Restore the saved camera once the board is loaded and canvas is mounted.
  const appliedCameraRef = useRef(false)
  useEffect(() => {
    if (board && canvasRef.current && !appliedCameraRef.current) {
      appliedCameraRef.current = true
      canvasRef.current.setCameraAbsolute(board.camera)
      setCameraState(board.camera)
    }
  }, [board])

  // ---------- Clipboard paste ----------

  const pasteImage = useCallback(
    (blob: Blob, index: number) => {
      const reader = new FileReader()
      reader.onload = () => {
        const src = reader.result as string
        const img = new Image()
        img.onload = () => {
          const center = canvasRef.current?.viewportCenter() ?? { x: 0, y: 0 }
          const maxDim = 640
          const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight))
          const w = img.naturalWidth * scale
          const h = img.naturalHeight * scale
          const el: ImageElement = {
            id: newId(),
            type: "image",
            x: center.x - w / 2 + index * 24,
            y: center.y - h / 2 + index * 24,
            w,
            h,
            src,
          }
          commit((els) => [...els, withContainment(els, el)])
          setTool("select")
          setSelectedIds(new Set([el.id]))
        }
        img.src = src
      }
      reader.readAsDataURL(blob)
    },
    [commit],
  )

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      const images: Blob[] = []
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const blob = item.getAsFile()
          if (blob) images.push(blob)
        }
      }
      if (images.length > 0) {
        e.preventDefault()
        images.forEach((blob, i) => pasteImage(blob, i))
      }
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [pasteImage])

  // ---------- Drag & drop images ----------

  useEffect(() => {
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"))
      files.forEach((f, i) => pasteImage(f, i))
    }
    const onDragOver = (e: DragEvent) => e.preventDefault()
    window.addEventListener("drop", onDrop)
    window.addEventListener("dragover", onDragOver)
    return () => {
      window.removeEventListener("drop", onDrop)
      window.removeEventListener("dragover", onDragOver)
    }
  }, [pasteImage])

  // ---------- Keyboard shortcuts ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault()
        redo()
        return
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault()
        deleteSelected()
        return
      }
      if (e.key === "Escape") {
        setSelectedIds(new Set())
        return
      }
      if (e.key === "]") {
        e.preventDefault()
        reorderSelected("forward")
        return
      }
      if (e.key === "[") {
        e.preventDefault()
        reorderSelected("backward")
        return
      }
      if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault()
        canvasRef.current?.zoomBy(1.2)
        return
      }
      if (mod && e.key === "-") {
        e.preventDefault()
        canvasRef.current?.zoomBy(1 / 1.2)
        return
      }
      if (mod && e.key === "0") {
        e.preventDefault()
        canvasRef.current?.resetZoom()
        return
      }
      if (e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault()
        canvasRef.current?.fitAll()
        return
      }
      if (!mod && !e.altKey) {
        const match = TOOLS.find((t) => t.shortcut.toLowerCase() === e.key.toLowerCase())
        if (match) setTool(match.id)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [undo, redo, deleteSelected, reorderSelected])

  if (!board) return null

  const activeColorIndex = PALETTE.indexOf(color)
  const selectedElement = selectedIds.size === 1 ? board.elements.find((e) => e.id === [...selectedIds][0]) : undefined
  const postitMenu = selectedElement?.type === "postit" ? selectedElement : undefined
  const editingTarget = editingId ? board.elements.find((e) => e.id === editingId) : undefined
  const editingPostit = editingTarget?.type === "postit" ? editingTarget : undefined

  const setPostit = (id: string, patch: Partial<PostitElement>) =>
    commit((els) => els.map((e) => (e.type === "postit" && e.id === id ? { ...e, ...patch } : e)))

  const commitDraft = () => {
    if (!editingPostit || !editingId) return
    if (editingPostit.text !== draft) {
      const id = editingId
      commit((els) => els.map((e) => (e.type === "postit" && e.id === id ? { ...e, text: draft } : e)))
    }
    setEditingId(null)
  }

  const menuPos = (box: { x: number; y: number; w: number }) => ({
    left: Math.min((box.x + box.w) * camera.zoom + camera.x + 8, window.innerWidth - 52),
    top: box.y * camera.zoom + camera.y - 8,
  })

  return (
    <TooltipProvider delayDuration={300}>
      <div className="relative h-full w-full overflow-hidden bg-neutral-50">
        <BoardCanvas
          ref={canvasRef}
          elements={board.elements}
          tool={tool}
          color={color}
          strokeWidth={strokeWidth}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          onElementsChange={handleElementsChange}
          onCommit={commit}
          onBeginAction={beginAction}
          onCameraChange={onCameraChange}
          onEditElement={(id) => {
            const el = board.elements.find((e) => e.id === id)
            if (el?.type !== "postit") return
            setSelectedIds(new Set([id]))
            setDraft(el.text)
            setEditingId(id)
          }}
        />

        {/* Context menu — floats outside the top-right corner of the selection */}
        {selectedElement && !editingPostit && (
          <SelectionMenu
            {...menuPos(elementBBox(selectedElement))}
            onAction={(action) => {
              if (action === "delete") deleteSelected()
              else reorderSelected(action)
            }}
          >
            {postitMenu && (
              <>
                {POSTIT_ALIGNMENTS.map(({ align, icon: Icon }) => (
                  <Button
                    key={align}
                    variant="ghost"
                    size="icon-sm"
                    className={postitMenu.align === align ? "bg-neutral-100" : ""}
                    onClick={() => setPostit(postitMenu.id, { align })}
                    title={`Align text ${align}`}
                  >
                    <Icon className="h-4 w-4" />
                  </Button>
                ))}
                <Separator className="w-full" />
                {POSTIT_FONT_SIZES.map(({ label, size }) => (
                  <button
                    key={label}
                    className={`h-7 w-7 rounded-md text-xs font-medium ${
                      postitMenu.fontSize === size ? "bg-neutral-900 text-white" : "hover:bg-neutral-100"
                    }`}
                    onClick={() => setPostit(postitMenu.id, { fontSize: size })}
                    title={`Text size ${label}`}
                  >
                    {label}
                  </button>
                ))}
              </>
            )}
          </SelectionMenu>
        )}

        {/* Post-it text editor — opaque so it covers the canvas-rendered text */}
        {editingPostit && (
          <textarea
            autoFocus
            className="absolute z-20 overflow-hidden rounded-md outline-2 outline-blue-500"
            style={{
              left: editingPostit.x * camera.zoom + camera.x,
              top: editingPostit.y * camera.zoom + camera.y,
              width: editingPostit.w * camera.zoom,
              height: editingPostit.h * camera.zoom,
              fontSize: editingPostit.fontSize * camera.zoom,
              lineHeight: 1.3,
              textAlign: editingPostit.align,
              padding: POSTIT_PADDING * camera.zoom,
              backgroundColor: POSTIT_FILL,
              color: POSTIT_TEXT,
              fontFamily: POSTIT_FONT,
              border: "none",
              resize: "none",
            }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault()
                commitDraft()
              }
            }}
          />
        )}

        {/* Top bar */}
        <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 border-b border-neutral-200 bg-white/90 px-3 py-2 backdrop-blur">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" />
            Bimbleboard
          </Button>
          <Separator orientation="vertical" className="!h-5" />
          <button
            className="max-w-64 truncate rounded-md px-2 py-1 text-sm font-medium hover:bg-neutral-100"
            onClick={() => {
              setNameDraft(board.name)
              setNameDialogOpen(true)
            }}
            title="Rename whiteboard"
          >
            {board.name}
          </button>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
              <Redo2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Rename dialog */}
        {nameDialogOpen && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30" onClick={() => setNameDialogOpen(false)}>
            <div className="w-80 rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <label className="mb-2 block text-sm font-medium">Whiteboard name</label>
              <input
                autoFocus
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    rename(nameDraft)
                    setNameDialogOpen(false)
                  }
                  if (e.key === "Escape") setNameDialogOpen(false)
                }}
              />
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setNameDialogOpen(false)}>Cancel</Button>
                <Button
                  size="sm"
                  onClick={() => {
                    rename(nameDraft)
                    setNameDialogOpen(false)
                  }}
                >
                  Save
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Left toolbar */}
        <div className="absolute left-3 top-1/2 z-10 -translate-y-1/2">
          <div className="flex flex-col items-center gap-1 rounded-xl border border-neutral-200 bg-white/95 p-1.5 shadow-lg backdrop-blur">
            {TOOLS.map(({ id, label, icon: Icon, shortcut }) => (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <Button
                    variant={tool === id ? "secondary" : "ghost"}
                    size="icon"
                    className={tool === id ? "bg-neutral-900 text-white hover:bg-neutral-800 hover:text-white" : ""}
                    onClick={() => setTool(id)}
                    title={`${label} (${shortcut})`}
                  >
                    <Icon className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {label} ({shortcut})
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>

        {/* Bottom bar: color + stroke + zoom */}
        <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur">
            {/* Colors */}
            <div className="flex items-center gap-1">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  className={`h-6 w-6 rounded-full border transition-transform hover:scale-110 ${
                    color === c ? "ring-2 ring-neutral-900 ring-offset-2" : "border-neutral-300"
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                  onClick={() => changeColor(c)}
                />
              ))}
              <label
                className="relative flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-neutral-300 text-[10px] font-bold text-neutral-500 hover:scale-110"
                title="Custom color"
                style={{ backgroundColor: color, color: activeColorIndex >= 0 ? undefined : "#fff" }}
              >
                +
                <input
                  type="color"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  value={color}
                  onChange={(e) => changeColor(e.target.value)}
                />
              </label>
            </div>

            <Separator orientation="vertical" className="!h-6" />

            {/* Stroke width */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2" title="Stroke width">
                  <span
                    className="inline-block rounded-full"
                    style={{ width: Math.min(strokeWidth, 16), height: Math.min(strokeWidth, 16), backgroundColor: color === "#ffffff" ? "#ccc" : color }}
                  />
                  {strokeWidth}px
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-3" side="top">
                <div className="mb-2 text-xs font-medium text-neutral-500">Stroke width</div>
                <div className="mb-3 flex gap-1">
                  {STROKE_WIDTHS.map((w) => (
                    <button
                      key={w}
                      className={`flex h-8 flex-1 items-center justify-center rounded-md border ${
                        strokeWidth === w ? "border-neutral-900 bg-neutral-100" : "border-neutral-200 hover:bg-neutral-50"
                      }`}
                      onClick={() => changeStrokeWidth(w)}
                    >
                      <span className="rounded-full bg-neutral-800" style={{ width: Math.min(w, 14), height: Math.min(w, 14) }} />
                    </button>
                  ))}
                </div>
                <Slider
                  value={[strokeWidth]}
                  min={1}
                  max={32}
                  step={1}
                  onValueChange={([v]) => {
                    if (!strokeGestureRef.current) {
                      strokeGestureRef.current = true
                      // One undo entry for the whole drag, taken before the
                      // first live change.
                      if (selectedRef.current.size > 0) beginAction()
                    }
                    changeStrokeWidth(v, selectedRef.current.size === 0)
                  }}
                  onValueCommit={() => {
                    strokeGestureRef.current = false
                  }}
                />
              </PopoverContent>
            </Popover>

            <Separator orientation="vertical" className="!h-6" />

            {/* Zoom controls */}
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" onClick={() => canvasRef.current?.zoomBy(1 / 1.2)} title="Zoom out (Ctrl+-)">
                <Minus className="h-4 w-4" />
              </Button>
              <button
                className="w-14 rounded-md px-1 py-1 text-center text-xs font-medium tabular-nums hover:bg-neutral-100"
                onClick={() => canvasRef.current?.resetZoom()}
                title="Reset zoom (Ctrl+0)"
              >
                {Math.round(zoom * 100)}%
              </button>
              <Button variant="ghost" size="icon-sm" onClick={() => canvasRef.current?.zoomBy(1.2)} title="Zoom in (Ctrl++)">
                <Plus className="h-4 w-4" />
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" onClick={() => canvasRef.current?.fitAll()} title="Zoom to fit (Shift+F)">
                    <Maximize className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Zoom to fit (Shift+F)</TooltipContent>
              </Tooltip>
            </div>

            <Separator orientation="vertical" className="!h-6" />
            <span className="hidden items-center gap-1 text-xs text-neutral-400 md:flex">
              <Hand className="h-3 w-3" /> Space / wheel / right-drag to pan
            </span>
          </div>
        </div>

        {/* Zoom clamp indicators */}
        {zoom <= MIN_ZOOM || zoom >= MAX_ZOOM ? (
          <div className="absolute bottom-20 left-1/2 z-10 -translate-x-1/2 rounded-full bg-neutral-900/80 px-3 py-1 text-xs text-white">
            Zoom limit reached
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  )
}
