import { useCallback, useEffect, useRef, useState } from "react"
import { isTauri } from "@tauri-apps/api/core"
import { getBoard, putBoard } from "@/lib/db"
import type { Board, BoardElement, Camera } from "@/types"

const HISTORY_LIMIT = 50
const SAVE_DEBOUNCE_MS = 600

type Mutator = (elements: BoardElement[]) => BoardElement[]

export interface BoardState {
  board: Board | null
  loading: boolean
  error: string | null
  /** Apply an element mutation; commits an undo entry. */
  commit: (mutate: Mutator, opts?: { history?: boolean }) => void
  /** Live-update elements without touching history (used while dragging/drawing). */
  update: (mutate: Mutator) => void
  /** Take a history snapshot before a live drag begins. */
  beginAction: () => void
  setCamera: (camera: Camera) => void
  rename: (name: string) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

export function useBoard(id: string | null): BoardState {
  const [board, setBoard] = useState<Board | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const boardRef = useRef<Board | null>(null)
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 })
  const undoStack = useRef<BoardElement[][]>([])
  const redoStack = useRef<BoardElement[][]>([])
  const [version, setVersion] = useState(0)
  const saveTimer = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    boardRef.current = null
    setBoard(null)
    undoStack.current = []
    redoStack.current = []
    if (!id) {
      setLoading(false)
      return
    }
    getBoard(id)
      .then((b) => {
        if (cancelled) return
        if (!b) {
          setError("Whiteboard not found.")
        } else {
          cameraRef.current = b.camera
          boardRef.current = b
          setBoard(b)
        }
      })
      .catch(() => !cancelled && setError("Could not open the whiteboard."))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [id])

  const scheduleSave = useCallback((b: Board) => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      putBoard({ ...b, camera: cameraRef.current, updatedAt: Date.now() }).catch(console.error)
    }, SAVE_DEBOUNCE_MS)
  }, [])

  const setBoardState = useCallback(
    (next: Board) => {
      boardRef.current = next
      setBoard(next)
      setVersion((v) => v + 1)
    },
    [],
  )

  const apply = useCallback(
    (mutate: Mutator, history: boolean) => {
      const prev = boardRef.current
      if (!prev) return
      const nextElements = mutate(prev.elements)
      if (nextElements === prev.elements) return
      if (history) {
        undoStack.current.push(prev.elements)
        if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift()
        redoStack.current = []
      }
      const next = { ...prev, elements: nextElements, updatedAt: Date.now() }
      setBoardState(next)
      scheduleSave(next)
    },
    [scheduleSave, setBoardState],
  )

  const commit = useCallback(
    (mutate: Mutator, opts?: { history?: boolean }) => apply(mutate, opts?.history ?? true),
    [apply],
  )
  const update = useCallback((mutate: Mutator) => apply(mutate, false), [apply])

  const beginAction = useCallback(() => {
    const prev = boardRef.current
    if (!prev) return
    undoStack.current.push(prev.elements)
    if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift()
    redoStack.current = []
    setVersion((v) => v + 1)
  }, [])

  const setCamera = useCallback(
    (camera: Camera) => {
      cameraRef.current = camera
      const prev = boardRef.current
      if (!prev) return
      const next = { ...prev, camera }
      boardRef.current = next
      setBoard(next)
      scheduleSave(next)
    },
    [scheduleSave],
  )

  const rename = useCallback(
    (name: string) => {
      const prev = boardRef.current
      if (!prev) return
      const next = { ...prev, name, updatedAt: Date.now() }
      boardRef.current = next
      setBoard(next)
      scheduleSave(next)
    },
    [scheduleSave],
  )

  const undo = useCallback(() => {
    const prev = boardRef.current
    if (!prev || undoStack.current.length === 0) return
    const restored = undoStack.current.pop()!
    redoStack.current.push(prev.elements)
    const next = { ...prev, elements: restored, updatedAt: Date.now() }
    setBoardState(next)
    scheduleSave(next)
  }, [scheduleSave, setBoardState])

  const redo = useCallback(() => {
    const prev = boardRef.current
    if (!prev || redoStack.current.length === 0) return
    const restored = redoStack.current.pop()!
    undoStack.current.push(prev.elements)
    const next = { ...prev, elements: restored, updatedAt: Date.now() }
    setBoardState(next)
    scheduleSave(next)
  }, [scheduleSave, setBoardState])

  // Flush pending saves when leaving the board.
  useEffect(() => {
    const flush = (): Promise<void> => {
      const b = boardRef.current
      if (saveTimer.current === null || !b) return Promise.resolve()
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
      return putBoard({ ...b, camera: cameraRef.current, updatedAt: Date.now() }).catch(console.error)
    }

    const teardowns: Array<() => void> = []

    // Web fallbacks: best-effort flush when the page hides or unloads.
    const onBeforeUnload = () => void flush()
    window.addEventListener("beforeunload", onBeforeUnload)
    teardowns.push(() => window.removeEventListener("beforeunload", onBeforeUnload))

    const onVisibility = () => {
      if (document.visibilityState === "hidden") void flush()
    }
    document.addEventListener("visibilitychange", onVisibility)
    teardowns.push(() => document.removeEventListener("visibilitychange", onVisibility))

    // In Tauri the OS close button kills the webview without firing
    // beforeunload — intercept the close, flush, then destroy the window.
    let unlistenClose: (() => void) | null = null
    if (isTauri()) {
      import("@tauri-apps/api/window")
        .then(async ({ getCurrentWindow }) => {
          const win = getCurrentWindow()
          const unlisten = await win.onCloseRequested(async (event) => {
            event.preventDefault()
            try {
              await flush()
            } finally {
              await win.destroy()
            }
          })
          unlistenClose = unlisten
        })
        .catch(console.error)
    }

    return () => {
      teardowns.forEach((t) => t())
      unlistenClose?.()
      void flush()
    }
  }, [])

  // version keeps canUndo/canRedo fresh after stack changes
  void version

  return {
    board,
    loading,
    error,
    commit,
    update,
    beginAction,
    setCamera,
    rename,
    undo,
    redo,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
  }
}
