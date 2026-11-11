// ui-spec.md 6장: "회전·반전은 cells를 변환해 정규화(최소 좌표를 0,0으로)한 뒤 판정한다."
import type { Cell } from "../data/pieces";

export function normalize(cells: Cell[]): Cell[] {
  const minC = Math.min(...cells.map(([c]) => c));
  const minR = Math.min(...cells.map(([, r]) => r));
  return cells.map(([c, r]) => [c - minC, r - minR] as Cell);
}

/** 90도 시계 방향 회전: (c, r) -> (-r, c) */
export function rotateCW(cells: Cell[]): Cell[] {
  return normalize(cells.map(([c, r]) => [-r, c] as Cell));
}

/** 좌우 반전: (c, r) -> (-c, r) */
export function flipH(cells: Cell[]): Cell[] {
  return normalize(cells.map(([c, r]) => [-c, r] as Cell));
}

export function applyRotFlip(base: Cell[], rot: 0 | 1 | 2 | 3, flip: boolean): Cell[] {
  let cells = flip ? flipH(base) : base;
  for (let i = 0; i < rot; i++) cells = rotateCW(cells);
  return normalize(cells);
}

export function bounds(cells: Cell[]) {
  const cs = cells.map(([c]) => c);
  const rs = cells.map(([, r]) => r);
  return { minC: Math.min(...cs), maxC: Math.max(...cs), minR: Math.min(...rs), maxR: Math.max(...rs) };
}

/**
 * side별로 이어 붙인 한 구간. top/bottom은 (c, r)에서 시작해 len칸만큼 오른쪽으로,
 * left/right는 (c, r)에서 시작해 len칸만큼 아래로 뻗는다.
 */
export type SilhouetteEdge = { side: "top" | "bottom" | "left" | "right"; c: number; r: number; len: number };

function mergeRuns(values: number[]): Array<[number, number]> {
  const sorted = [...values].sort((a, b) => a - b);
  const runs: Array<[number, number]> = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i];
      continue;
    }
    runs.push([start, prev]);
    start = sorted[i];
    prev = sorted[i];
  }
  runs.push([start, prev]);
  return runs;
}

/**
 * 조각의 "구멍 뚫린 안쪽"이 아니라 바깥 윤곽선만 뽑는다. 같은 조각에 속하지 않은
 * 이웃이 있는 변만 모아서, ㄱ자/T자 조각이 칸별 격자선이 아니라 실루엣 하나로 보이게 한다.
 * 칸과 칸 사이에는 piece()가 그리는 2px 틈이 있어서(각 칸이 cs-2 크기라) 한 줄로 늘어선
 * 변을 칸 단위로 따로 두면 그 틈만큼 끊겨 보인다. 그래서 같은 side·같은 줄에서 연속된
 * 칸은 하나의 긴 구간으로 합쳐, 끊김 없이 이어진 테두리가 나오게 한다.
 */
export function silhouetteEdges(cells: Cell[]): SilhouetteEdge[] {
  const set = new Set(cells.map(([c, r]) => `${c},${r}`));
  const raw: { side: SilhouetteEdge["side"]; c: number; r: number }[] = [];
  cells.forEach(([c, r]) => {
    if (!set.has(`${c},${r - 1}`)) raw.push({ side: "top", c, r });
    if (!set.has(`${c},${r + 1}`)) raw.push({ side: "bottom", c, r });
    if (!set.has(`${c - 1},${r}`)) raw.push({ side: "left", c, r });
    if (!set.has(`${c + 1},${r}`)) raw.push({ side: "right", c, r });
  });

  const merged: SilhouetteEdge[] = [];
  (["top", "bottom"] as const).forEach((side) => {
    const byRow = new Map<number, number[]>();
    raw.filter((e) => e.side === side).forEach((e) => byRow.set(e.r, [...(byRow.get(e.r) ?? []), e.c]));
    byRow.forEach((cols, r) => mergeRuns(cols).forEach(([start, end]) => merged.push({ side, c: start, r, len: end - start + 1 })));
  });
  (["left", "right"] as const).forEach((side) => {
    const byCol = new Map<number, number[]>();
    raw.filter((e) => e.side === side).forEach((e) => byCol.set(e.c, [...(byCol.get(e.c) ?? []), e.r]));
    byCol.forEach((rows, c) => mergeRuns(rows).forEach(([start, end]) => merged.push({ side, c, r: start, len: end - start + 1 })));
  });
  return merged;
}
