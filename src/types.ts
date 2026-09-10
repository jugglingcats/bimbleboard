export type Tool =
  | "select"
  | "pen"
  | "eraser"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"

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
}

export interface ImageElement {
  id: string
  type: "image"
  x: number
  y: number
  w: number
  h: number
  src: string
}

export type BoardElement =
  | PathElement
  | ShapeElement
  | LineElement
  | ImageElement

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
