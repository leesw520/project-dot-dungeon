// 탐색(D01)의 계산 규칙 — 화면 코드에서 떼어 낸 순수 함수 (2026-11-11, 테스트: exploreRules.test.ts).
// 난수(원정 시드), 입구 연결 칸, 채집지 무작위 배치, 적 심볼 비율.
import type { DistrictDef, ExitDef, GatherPoint } from "../data/dungeons";
import type { Cell } from "../data/pieces";

export const cellKey = (c: number, r: number) => `${c},${r}`;

// ---------- 난수 (원정 시드) ----------
/** state()는 지금 내부 값 — mulberry(state())로 같은 자리에서 이어 굴린다 (세이브). */
export type Rng = (() => number) & { state: () => number };
export function mulberry(seed: number): Rng {
  let a = seed >>> 0;
  const f = (() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  f.state = () => a;
  return f;
}

/** 출구의 연결 지점 = 바깥 칸에서 구획 쪽으로 한 칸 안 */
export function inner(e: ExitDef): Cell {
  const [c, r] = e.cell;
  return e.side === "left" ? [c + 1, r] : e.side === "right" ? [c - 1, r] : e.side === "top" ? [c, r + 1] : [c, r - 1];
}

/** 구획의 입구·통로·계단 (연결 지점을 가진 것 전부) */
export const exitsOf = (def: DistrictDef): ExitDef[] => [...def.doors, ...(def.start ? [def.start] : []), ...(def.stairs ? [def.stairs] : [])];

const isFloor = (def: DistrictDef, c: number, r: number) => def.shape[r]?.[c] === ".";

/** 입구·통로·계단의 연결 지점에서 빈 칸을 따라 걸어서 닿을 수 있는 칸 */
export function reachableCells(def: DistrictDef): Set<string> {
  const seen = new Set<string>();
  const q: Cell[] = [];
  for (const e of exitsOf(def)) {
    const [c, r] = inner(e);
    if (isFloor(def, c, r) && !seen.has(cellKey(c, r))) { seen.add(cellKey(c, r)); q.push([c, r]); }
  }
  for (let i = 0; i < q.length; i++) {
    const [c, r] = q[i];
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n: Cell = [c + dc, r + dr];
      if (!isFloor(def, n[0], n[1]) || seen.has(cellKey(n[0], n[1]))) continue;
      seen.add(cellKey(n[0], n[1]));
      q.push(n);
    }
  }
  return seen;
}

/**
 * 채집지 무작위 배치 (2026-11-08): 구획 견본(def.gathers)의 종류·비율로, 원정 시드마다 다른 자리·개수.
 * 바위·구획 밖·입구/통로/계단 연결 칸 둘레·상자·휴식 자리를 피하고, 채집지끼리는 붙지 않게 (8방향 이웃 금지).
 * 2026-11-11: 입구에서 걸어서 닿을 수 없는 칸(바위로 막힌 주머니)에도 놓지 않는다.
 * 같은 원정 안에서는 늘 같은 결과 (세이브를 불러와도 같다).
 */
export function rollGathers(def: DistrictDef, seed: number): GatherPoint[] {
  if (!def.gathers.length) return [];
  let h = seed | 0;
  for (const ch of def.id) h = Math.imul(h ^ ch.charCodeAt(0), 2654435761);
  const rng = mulberry(h ^ 0x5bd1e995);
  // 2026-11-08 2차: 개수를 줄였다 (견본 수 × 0.8~1.2) — 대신 한 곳에서 2~3개
  const [lo, hi] = def.gatherCount ?? [Math.max(2, Math.round(def.gathers.length * 0.8)), Math.max(2, Math.round(def.gathers.length * 1.2))];
  const want = lo + Math.floor(rng() * (hi - lo + 1));
  const block = new Set<string>([...def.chests.map((c) => cellKey(...c.cell)), ...def.rests.map((r) => cellKey(...r))]);
  for (const e of exitsOf(def)) {
    const [c, r] = inner(e);
    for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) block.add(cellKey(c + dc, r + dr));
  }
  const reach = reachableCells(def);
  const free: Cell[] = [];
  def.shape.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === "." && !block.has(cellKey(c, r)) && reach.has(cellKey(c, r))) free.push([c, r]); }));
  const out: GatherPoint[] = [];
  const near = (c: number, r: number) => out.some((g) => Math.abs(g.cell[0] - c) <= 1 && Math.abs(g.cell[1] - r) <= 1);
  while (out.length < want && free.length) {
    const [c, r] = free.splice(Math.floor(rng() * free.length), 1)[0];
    if (near(c, r)) continue;
    out.push({ cell: [c, r], kind: def.gathers[Math.floor(rng() * def.gathers.length)].kind });
  }
  return out;
}

// ---------- 적 심볼 비율 ----------
/**
 * 적 출현 조정 (2026-11-11). 구획의 symbols.enemy(타일 칸마다 굴리는 비율)에 곱한다.
 * - scale: 전체 배율. 1.3 = 예전보다 30% 더 자주.
 * - perTile: 이번 원정에서 타일을 하나 놓을 때마다 비율이 이만큼(1.5%) 더 오른다 — 오래 머물수록 적이 는다.
 * - maxGrowth: 그렇게 오르는 한도 (×1.5).
 * - maxPerTile: 타일 하나에 붙는 적 심볼 수 상한 — 한 번에 전투가 몰리지 않게.
 */
export const ENEMY_PRESSURE = { scale: 1.3, perTile: 0.015, maxGrowth: 1.5, maxPerTile: 2 };

/**
 * 타일 칸 하나에 적 심볼이 붙을 확률.
 * base = 구획 symbols.enemy, tilesPlaced = 이번 원정에서 지금까지 놓은 타일 수, enemyDownPct = 공용 [사전 정찰] 감소 %.
 */
export function enemySymbolRate(base: number, tilesPlaced: number, enemyDownPct = 0): number {
  const growth = Math.min(ENEMY_PRESSURE.maxGrowth, 1 + ENEMY_PRESSURE.perTile * Math.max(0, tilesPlaced));
  return base * ENEMY_PRESSURE.scale * growth * Math.max(0, 1 - enemyDownPct / 100);
}
