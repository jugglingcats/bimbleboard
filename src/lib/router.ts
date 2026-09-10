import { useEffect, useState } from "react"

/** Minimal hash router: "#/" for home, "#/board/<id>" for the editor. */
export function useHashRoute(): { view: "home" | "board"; boardId: string | null } {
  const parse = () => {
    const hash = window.location.hash.replace(/^#/, "")
    const m = hash.match(/^\/board\/([^/?]+)/)
    if (m) return { view: "board" as const, boardId: m[1] }
    return { view: "home" as const, boardId: null }
  }
  const [route, setRoute] = useState(parse)

  useEffect(() => {
    const onChange = () => setRoute(parse())
    window.addEventListener("hashchange", onChange)
    return () => window.removeEventListener("hashchange", onChange)
  }, [])

  return route
}

export function navigate(path: string): void {
  window.location.hash = path
}
