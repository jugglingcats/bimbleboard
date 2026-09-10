export type Tool =
  | "select"
  | "pen"
  | "eraser"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "postit"

export interface Point {
  x: number
  y: number
}

/** A freehand stroke point with pen pressure (0..1). */
export interface StrokePoint extends Point {
  p: number
}

export interface PathElement {
  id: string
  type: "path"
  points: StrokePoint[]
  color: string
  strokeWidth: number
  /** Containing element, when fully inside one. */
  containerId?: string
}

export interface ShapeElement {
  id: string
  type: "rect" | "ellipse"
  x: number
  y: number
  w: number
  h: number
  color: string
  strokeWidth: number
  containerId?: string
}

export interface LineElement {
  id: string
  type: "line" | "arrow"
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  strokeWidth: number
  containerId?: string
}

export interface ImageElement {
  id: string
  type: "image"
  x: number
  y: number
  w: number
  h: number
  src: string
  containerId?: string
}

export interface PostitElement {
  id: string
  type: "postit"
  x: number
  y: number
  w: number
  h: number
  text: string
  align: "left" | "center" | "right"
  fontSize: number
  /** Never set — containers cannot be contained (single-level hierarchy). */
  containerId?: string
}

export type BoardElement =
  | PathElement
  | ShapeElement
  | LineElement
  | ImageElement
  | PostitElement

export interface Camera {
  x: number
  y: number
  zoom: number
}

export interface Board {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  camera: Camera
  elements: BoardElement[]
}
