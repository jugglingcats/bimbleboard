import Home from "@/components/Home"
import BoardEditor from "@/components/BoardEditor"
import { useHashRoute, navigate } from "@/lib/router"
import { useBoard } from "@/hooks/useBoard"

export default function App() {
  const route = useHashRoute()

  if (route.view === "board" && route.boardId) {
    return <BoardScreen key={route.boardId} boardId={route.boardId} />
  }
  return <Home />
}

function BoardScreen({ boardId }: { boardId: string }) {
  const state = useBoard(boardId)

  if (state.loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-neutral-50 text-sm text-neutral-400">
        Opening whiteboard…
      </div>
    )
  }

  if (state.error || !state.board) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-neutral-50">
        <p className="text-sm text-neutral-500">{state.error ?? "Whiteboard not found."}</p>
        <button
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
          onClick={() => navigate("/")}
        >
          Back to Bimbleboard
        </button>
      </div>
    )
  }

  return <BoardEditor state={state} />
}
