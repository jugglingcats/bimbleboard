import type { Point, StrokePoint } from "@/types"

// ---------- Input filtering (capture time) ----------

// One-euro tuning: rest smoothing vs. speed responsiveness.
const MIN_CUTOFF = 1.1 // Hz — low-pass cutoff when the pointer is nearly still
const BETA = 0.022 // how fast the cutoff rises with speed, so quick strokes don't lag
const D_CUTOFF = 1.2 // Hz — cutoff for the velocity estimate itself
const MAX_DT = 0.1 // s — clamp event gaps so pauses don't over-relax the filter
const PRESSURE_SMOOTHING = 0.35 // EMA factor for pressure

/** One-euro filter (Casiez et al. 2012): an adaptive low-pass that smooths
 * aggressively at low speed — killing hand jitter — and relaxes as velocity
 * rises, so quick strokes stay responsive instead of lagging behind. */
class OneEuroFilter {
  private xPrev = 0
  private dxPrev = 0
  private started = false

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff)
    return 1 / (1 + tau / dt)
  }

  filter(x: number, dt: number): number {
    if (!this.started) {
      this.started = true
      this.xPrev = x
      return x
    }
    const dx = (x - this.xPrev) / dt
    const dxAlpha = OneEuroFilter.alpha(D_CUTOFF, dt)
    this.dxPrev = dxAlpha * dx + (1 - dxAlpha) * this.dxPrev
    const cutoff = MIN_CUTOFF + BETA * Math.abs(this.dxPrev)
    const xAlpha = OneEuroFilter.alpha(cutoff, dt)
    this.xPrev = xAlpha * x + (1 - xAlpha) * this.xPrev
    return this.xPrev
  }
}

export interface SmoothedSample {
  x: number
  y: number
  p: number
}

/** Filters raw screen-space pointer samples into smooth stroke input.
 * Runs in screen space, not world: device jitter is a screen-scale
 * phenomenon, and this keeps the speed→cutoff response identical at every
 * zoom level. */
export class StrokeSmoother {
  private fx = new OneEuroFilter()
  private fy = new OneEuroFilter()
  private lastTime: number | null = null
  private pPrev = 0
  private pressureSeen = false

  add(x: number, y: number, pressure: number, timeMs: number): SmoothedSample {
    let dt = this.lastTime === null ? 1 / 60 : (timeMs - this.lastTime) / 1000
    if (!(dt > 0)) dt = 1 / 240
    else if (dt > MAX_DT) dt = MAX_DT
    this.lastTime = timeMs
    this.pPrev = this.pressureSeen ? this.pPrev + (pressure - this.pPrev) * PRESSURE_SMOOTHING : pressure
    this.pressureSeen = true
    return { x: this.fx.filter(x, dt), y: this.fy.filter(y, dt), p: this.pPrev }
  }
}

// ---------- Curve fitting (render time) ----------

export interface StrokeSample {
  x: number
  y: number
  w: number
}

const MIN_SAMPLE_PX = 3 // screen px between spline samples
const MAX_SAMPLES_PER_SEG = 24
const KNOT_EPS = 1e-6

function pointWidth(strokeWidth: number, p: number): number {
  return strokeWidth * (0.5 + p * 0.9)
}

function lerpXY(a: Point, b: Point, t: number): Point {
  const k = Math.max(0, Math.min(1, t))
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
}

/** Centripetal Catmull-Rom (Barry–Goldman recursion) at parameter s in [0,1]
 * between p1 and p2. Passes exactly through the input points, and the
 * centripetal knot spacing keeps it from overshooting on sharp turns. */
function crPoint(p0: Point, p1: Point, p2: Point, p3: Point, s: number): Point {
  const knot = (a: Point, b: Point) => Math.max(KNOT_EPS, Math.hypot(b.x - a.x, b.y - a.y) ** 0.5)
  const t0 = 0
  const t1 = knot(p0, p1)
  const t2 = t1 + knot(p1, p2)
  const t3 = t2 + knot(p2, p3)
  const t = t1 + s * (t2 - t1)
  const a1 = lerpXY(p0, p1, (t - t0) / (t1 - t0))
  const a2 = lerpXY(p1, p2, (t - t1) / (t2 - t1))
  const a3 = lerpXY(p2, p3, (t - t2) / (t3 - t2))
  const b1 = lerpXY(a1, a2, (t - t0) / (t2 - t0))
  const b2 = lerpXY(a2, a3, (t - t1) / (t3 - t1))
  return lerpXY(b1, b2, (t - t1) / (t2 - t1))
}

/** Sample a stroke's points as a smooth spline for rendering. Pressure is
 * interpolated along the curve and turned into per-sample stroke widths. */
export function sampleStroke(points: StrokePoint[], strokeWidth: number, zoom = 1): StrokeSample[] {
  if (points.length === 0) return []
  const [first] = points
  const out: StrokeSample[] = [{ x: first.x, y: first.y, w: pointWidth(strokeWidth, first.p) }]
  for (let j = 0; j < points.length - 1; j++) {
    const p0 = points[j - 1] ?? points[j]
    const p1 = points[j]
    const p2 = points[j + 1]
    const p3 = points[j + 2] ?? points[j + 1]
    // Densify by screen size so curves stay smooth when zoomed in.
    const n = Math.min(
      MAX_SAMPLES_PER_SEG,
      Math.max(1, Math.ceil((Math.hypot(p2.x - p1.x, p2.y - p1.y) * zoom) / MIN_SAMPLE_PX)),
    )
    for (let i = 1; i <= n; i++) {
      const s = i / n
      const pt = i === n ? p2 : crPoint(p0, p1, p2, p3, s)
      out.push({ x: pt.x, y: pt.y, w: pointWidth(strokeWidth, p1.p + (p2.p - p1.p) * s) })
    }
  }
  return out
}
