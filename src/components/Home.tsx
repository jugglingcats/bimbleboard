import { useCallback, useEffect, useState } from "react"
import { Plus, Trash2, Pencil, FolderOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { createBoard, deleteBoard, listBoards } from "@/lib/db"
import { navigate } from "@/lib/router"
import type { Board } from "@/types"

export default function Home() {
  const [boards, setBoards] = useState<Board[] | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<Board | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    listBoards()
      .then(setBoards)
      .catch(() => setBoards([]))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleCreate = async () => {
    if (busy) return
    setBusy(true)
    try {
      const board = await createBoard(newName)
      navigate(`/board/${board.id}`)
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    await deleteBoard(deleteTarget.id)
    setDeleteTarget(null)
    refresh()
  }

  const fmtDate = (ts: number) =>
    new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })

  return (
    <div className="h-full w-full overflow-auto bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-900 text-white">
              <Pencil className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight">Bimbleboard</h1>
              <p className="text-xs text-neutral-500">Infinite whiteboard — everything stays on your device</p>
            </div>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            New whiteboard
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {boards === null ? (
          <div className="py-24 text-center text-sm text-neutral-400">Loading…</div>
        ) : boards.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-neutral-200 bg-white py-24">
            <FolderOpen className="h-10 w-10 text-neutral-300" />
            <div className="text-center">
              <p className="font-medium text-neutral-700">No whiteboards yet</p>
              <p className="text-sm text-neutral-500">Create your first whiteboard and start sketching.</p>
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              New whiteboard
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
            {boards.map((board) => (
              <div
                key={board.id}
                className="group relative cursor-pointer rounded-xl border border-neutral-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
                onClick={() => navigate(`/board/${board.id}`)}
              >
                <div className="mb-3 flex h-28 items-center justify-center rounded-lg bg-neutral-50 bg-[radial-gradient(circle,rgba(0,0,0,0.12)_1px,transparent_1px)] [background-size:16px_16px]">
                  <Pencil className="h-6 w-6 text-neutral-200 transition-colors group-hover:text-neutral-400" />
                </div>
                <div className="truncate font-medium text-neutral-900">{board.name}</div>
                <div className="mt-0.5 flex items-center justify-between text-xs text-neutral-500">
                  <span>{board.elements.length} item{board.elements.length === 1 ? "" : "s"}</span>
                  <span>{fmtDate(board.updatedAt)}</span>
                </div>
                <Button
                  variant="secondary"
                  size="icon-sm"
                  className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100"
                  title="Delete whiteboard"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteTarget(board)
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </main>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New whiteboard</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Whiteboard name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) handleCreate()
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || busy}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete whiteboard?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.name}” and everything on it will be permanently removed from this browser.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={handleDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
