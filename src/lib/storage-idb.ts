import { openDB, type IDBPDatabase } from "idb"
import type { Board } from "@/types"
import type { BoardStorage } from "@/lib/storage"

const DB_NAME = "bimbleboard"
const DB_VERSION = 1
const BOARDS_STORE = "boards"

let dbPromise: Promise<IDBPDatabase> | null = null

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(BOARDS_STORE)) {
          const store = db.createObjectStore(BOARDS_STORE, { keyPath: "id" })
          store.createIndex("updatedAt", "updatedAt")
        }
      },
    })
  }
  return dbPromise
}

/** Browser fallback: IndexedDB (used when running as a plain web app). */
export const idbStorage: BoardStorage = {
  async listBoards(): Promise<Board[]> {
    const db = await getDB()
    const all = (await db.getAll(BOARDS_STORE)) as Board[]
    return all.sort((a, b) => b.updatedAt - a.updatedAt)
  },

  async getBoard(id: string): Promise<Board | undefined> {
    const db = await getDB()
    return (await db.get(BOARDS_STORE, id)) as Board | undefined
  },

  async putBoard(board: Board): Promise<void> {
    const db = await getDB()
    await db.put(BOARDS_STORE, board)
  },

  async deleteBoard(id: string): Promise<void> {
    const db = await getDB()
    await db.delete(BOARDS_STORE, id)
  },
}
