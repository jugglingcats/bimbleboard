import { isTauri } from "@tauri-apps/api/core"
import type { Board } from "@/types"
import { idbStorage } from "@/lib/storage-idb"
import { tauriStorage } from "@/lib/storage-tauri"
import type { BoardStorage } from "@/lib/storage"

// In Tauri, boards are stored as JSON files under the app data dir so they
// survive browser/webview storage clears. On the web, fall back to IndexedDB.
export const storage: BoardStorage = isTauri() ? tauriStorage : idbStorage

export function newId(): string {
  return crypto.randomUUID()
}

export async function listBoards(): Promise<Board[]> {
  return storage.listBoards()
}

export async function getBoard(id: string): Promise<Board | undefined> {
  return storage.getBoard(id)
}

export async function putBoard(board: Board): Promise<void> {
  return storage.putBoard(board)
}

export async function deleteBoard(id: string): Promise<void> {
  return storage.deleteBoard(id)
}

export async function createBoard(name: string): Promise<Board> {
  const now = Date.now()
  const board: Board = {
    id: newId(),
    name: name.trim() || "Untitled whiteboard",
    createdAt: now,
    updatedAt: now,
    camera: { x: 0, y: 0, zoom: 1 },
    elements: [],
  }
  await putBoard(board)
  return board
}
