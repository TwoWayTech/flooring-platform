import type { FloorPattern } from "@workspace/shared";

/** One plank in pattern units, with its laying order from 0 (first) to 1 (last). */
export interface Plank {
  x: number;
  y: number;
  width: number;
  height: number;
  tone: 1 | 2 | 3;
  order: number;
}

/** A pattern laid over a field, plus the rotation the whole field is drawn at. */
export interface PatternLayout {
  planks: Plank[];
  rotate: number;
}

/** Deterministic plank tone so the pattern looks like real boards, not a checkerboard. */
function tone(a: number, b: number): 1 | 2 | 3 {
  return (((((a * 73856093) ^ (b * 19349663)) >>> 0) % 3) + 1) as 1 | 2 | 3;
}

/**
 * Herringbone: planks 1 × 4 laid in diagonal chains of alternating horizontal and vertical
 * boards. Chain k steps by (1, 1); neighbouring chains are offset by (4, -4), which tiles the
 * plane without gaps. The field is drawn rotated 45° so the chains read as the familiar zigzag.
 */
function herringbone(width: number, height: number, unit: number): Plank[] {
  const length = unit * 4;
  const reach = Math.ceil((width + height) / unit) + 8;
  const planks: Plank[] = [];
  for (let m = -reach; m <= reach; m++) {
    for (let k = -reach; k <= reach; k++) {
      const x = (k + 4 * m) * unit;
      const y = (k - 4 * m) * unit;
      if (Math.abs(x) > width * 1.5 || Math.abs(y) > width * 1.5) continue;
      planks.push({ x, y, width: length, height: unit, tone: tone(k, m), order: 0 });
      planks.push({ x, y: y + unit, width: unit, height: length, tone: tone(m, k + 7), order: 0 });
    }
  }
  return planks;
}

/** Running bond: long planks in rows, each row's joints staggered from the row before. */
function runningBond(width: number, height: number, unit: number): Plank[] {
  const length = unit * 6;
  const planks: Plank[] = [];
  for (let row = 0; row * unit < height; row++) {
    const offset = ((row * 7) % 6) * unit;
    for (let x = -offset; x < width; x += length) {
      planks.push({ x, y: row * unit, width: length, height: unit, tone: tone(row, Math.round(x / unit)), order: 0 });
    }
  }
  return planks;
}

/**
 * Basketweave: square cells of three planks, alternating direction like a woven mat. A cell's
 * planks share a tone so the change of direction, not the color, carries the pattern.
 */
function basketweave(width: number, height: number, unit: number): Plank[] {
  const cell = unit * 3;
  const planks: Plank[] = [];
  for (let row = 0; row * cell < height; row++) {
    for (let col = 0; col * cell < width; col++) {
      const across = (row + col) % 2 === 0;
      for (let i = 0; i < 3; i++) {
        const x = col * cell + (across ? 0 : i * unit);
        const y = row * cell + (across ? i * unit : 0);
        planks.push({
          x,
          y,
          width: across ? cell : unit,
          height: across ? unit : cell,
          tone: tone(row, col),
          order: 0,
        });
      }
    }
  }
  return planks;
}

/** Plank centre after the field's rotation about its middle, for laying order. */
function screenPoint(p: Plank, rotate: number, cx: number, cy: number) {
  const rad = (rotate * Math.PI) / 180;
  const px = p.x + p.width / 2 - cx;
  const py = p.y + p.height / 2 - cy;
  return { x: px * Math.cos(rad) - py * Math.sin(rad) + cx, y: px * Math.sin(rad) + py * Math.cos(rad) + cy };
}

/**
 * Lays a pattern over a width × height field. Order runs from the bottom-left corner outwards,
 * the way an installer works across a room, which drives the login animation (design brief
 * "The signature element"). Planks fully outside the field are dropped.
 */
export function layPattern(pattern: FloorPattern, width: number, height: number, unit: number): PatternLayout {
  const rotate = pattern === "herringbone" ? 45 : 0;
  const raw =
    pattern === "herringbone"
      ? herringbone(width, height, unit)
      : pattern === "running-bond"
        ? runningBond(width, height, unit)
        : basketweave(width, height, unit);
  const cx = width / 2;
  const cy = height / 2;
  const margin = unit * 4;
  const visible = raw
    .map((p) => ({ plank: p, at: screenPoint(p, rotate, cx, cy) }))
    .filter(({ at }) => at.x > -margin && at.x < width + margin && at.y > -margin && at.y < height + margin);
  const span = width + height;
  return {
    rotate,
    planks: visible.map(({ plank, at }) => ({
      ...plank,
      order: Math.min(1, Math.max(0, (at.x + (height - at.y)) / span)),
    })),
  };
}
