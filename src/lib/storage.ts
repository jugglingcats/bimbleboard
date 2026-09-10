import type { Board } from "@/types"

/** Persistence backend interface. */
export interface BoardStorage {
  listBoards(): Promise<Board[]>
  getBoard(id: string): Promise<Board | undefined>
  putBoard(board: Board): Promise<void>
  deleteBoard(id: string): Promise<void>
}
