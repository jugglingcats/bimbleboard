import { appDataDir, join } from "@tauri-apps/api/path"
import { exists, mkdir, readDir, readTextFile, remove, rename, writeTextFile } from "@tauri-apps/plugin-fs"
import type { Board } from "@/types"
import type { BoardStorage } from "@/lib/storage"

let boardsDirPromise: Promise<string> | null = null

async function boardsDir(): Promise<string> {
  if (!boardsDirPromise) {
    boardsDirPromise = (async () => {
      const dir = await join(await appDataDir(), "boards")
      if (!(await exists(dir))) {
        await mkdir(dir, { recursive: true })
      }
      return dir
    })()
  }
  return boardsDirPromise
}

async function boardPath(id: string): Promise<string> {
  return join(await boardsDir(), `${id}.json`)
}

// Serialize writes per board so overlapping saves can't interleave tmp/rename.
const locks = new Map<string, Promise<unknown>>()
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(fn)
  locks.set(key, next)
  return next
}

function parseBoard(text: string): Board | null {
  try {
    const parsed = JSON.parse(text) as Board
    return parsed && typeof parsed.id === "string" && Array.isArray(parsed.elements) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Tauri backend: one JSON file per board under {appDataDir}/boards.
 * Lives on disk, so the data survives browser/webview storage clears.
 */
export const tauriStorage: BoardStorage = {
  async listBoards(): Promise<Board[]> {
    const dir = await boardsDir()
    const entries = await readDir(dir)
    const boards: Board[] = []
    for (const entry of entries) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue
      const path = await join(dir, entry.name)
      try {
        const parsed = parseBoard(await readTextFile(path))
        if (parsed) boards.push(parsed)
      } catch {
        // unreadable/corrupt file — skip it rather than failing the listing
      }
    }
    return boards.sort((a, b) => b.updatedAt - a.updatedAt)
  },

  async getBoard(id: string): Promise<Board | undefined> {
    const path = await boardPath(id)
    if (!(await exists(path))) return undefined
    try {
      return parseBoard(await readTextFile(path)) ?? undefined
    } catch {
      return undefined
    }
  },

  async putBoard(board: Board): Promise<void> {
    await withLock(board.id, async () => {
      const path = await boardPath(board.id)
      const tmp = `${path}.tmp`
      const data = JSON.stringify(board)
      try {
        // tmp + rename keeps the file atomic: a crash mid-write can't corrupt
        // the previous copy (std::fs::rename replaces the destination on Windows).
        await writeTextFile(tmp, data)
        await rename(tmp, path)
      } catch {
        await writeTextFile(path, data)
      }
    })
  },

  async deleteBoard(id: string): Promise<void> {
    try {
      await remove(await boardPath(id))
    } catch {
      // already gone
    }
  },
}
