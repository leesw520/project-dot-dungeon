// 맵 규칙 검사 (2026-11-11 사용자 지정). 맵을 고치면 여기서 바로 걸린다 — 몇 ms.
// 1) 심볼(상자·휴식·통로·계단)은 바위 위에 두지 않는다
// 2) 고정 심볼끼리 같은 칸에 겹치지 않는다 (타일 심볼은 놓을 때 고정 심볼 칸에서 사라진다 — d01Explore place)
// 3) 입구 둘레는 바위를 피한다: 타일 풀의 어떤 타일이 나와도 입구에 이어 첫 타일을 놓을 수 있다
// 4) 칸이 끊기지 않는다: 어느 입구에서든 다른 출구·상자·휴식까지 빈 칸으로 이어진다
// 무작위로 놓았을 때의 성공률(어려움)은 의도한 것이라 검사하지 않는다 — 참고용 표는 tools/check-dungeons.mjs.
import { describe, expect, it } from "vitest";
import { DUNGEONS, type DistrictDef } from "./dungeons";
import { DECKS, PATH_PIECES } from "./explore";
import type { Cell } from "./pieces";
import { cellKey, exitsOf, inner, reachableCells, rollGathers } from "../engine/exploreRules";

const districts: Array<{ label: string; d: DistrictDef }> = DUNGEONS.flatMap((dg) => dg.floors.flatMap((f) => f.districts.map((d) => ({ label: `${f.name} ${d.name} (${d.id})`, d }))));
const isFloor = (d: DistrictDef, [c, r]: Cell) => d.shape[r]?.[c] === ".";

function rotations(cells: Cell[]): Cell[][] {
  const out: Cell[][] = [];
  let cur = cells;
  for (let i = 0; i < 4; i++) {
    out.push(cur);
    cur = cur.map(([c, r]): Cell => [-r, c]);
  }
  return out;
}

/** 고정 심볼: [이름, 칸] */
const fixedSymbols = (d: DistrictDef): Array<[string, Cell]> => [
  ...d.chests.map((c): [string, Cell] => [`상자 ${c.id}`, c.cell]),
  ...d.rests.map((r): [string, Cell] => ["휴식", r]),
  ...d.doors.map((x): [string, Cell] => [`통로>${x.to} 연결 칸`, inner(x)]),
  ...(d.start ? [["입구 연결 칸", inner(d.start)] as [string, Cell]] : []),
  ...(d.stairs ? [["계단 연결 칸(중간 보스 자리)", inner(d.stairs)] as [string, Cell]] : []),
];

describe("맵 규칙 (data/dungeons.ts)", () => {
  it("구획이 하나 이상 있다", () => {
    expect(districts.length).toBeGreaterThan(0);
  });

  it("1) 심볼은 바위·구획 밖에 두지 않는다", () => {
    const bad = districts.flatMap(({ label, d }) => fixedSymbols(d).filter(([, cell]) => !isFloor(d, cell)).map(([name, cell]) => `${label}: ${name} [${cell}]`));
    expect(bad).toEqual([]);
  });

  it("2) 고정 심볼끼리 겹치지 않는다", () => {
    const bad: string[] = [];
    for (const { label, d } of districts) {
      const seen = new Map<string, string>();
      for (const [name, cell] of fixedSymbols(d)) {
        const k = cellKey(...cell);
        if (seen.has(k)) bad.push(`${label}: ${name} 와 ${seen.get(k)} 가 같은 칸 [${cell}]`);
        seen.set(k, name);
      }
    }
    expect(bad).toEqual([]);
  });

  it("3) 어떤 타일이 나와도 입구에 첫 타일을 놓을 수 있다", () => {
    const bad: string[] = [];
    for (const { label, d } of districts) for (const e of exitsOf(d)) {
      const [sc, sr] = inner(e);
      for (const [id] of DECKS[d.deck]) {
        const fits = rotations(PATH_PIECES[id].cells).some((shape) => shape.some(([ax, ay]) => shape.every(([x, y]) => isFloor(d, [x - ax + sc, y - ay + sr]))));
        if (!fits) bad.push(`${label}: [${e.cell}] 쪽 입구에 ${PATH_PIECES[id].name}을 놓을 수 없다`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("4) 칸이 끊기지 않는다 — 모든 연결 칸·상자·휴식이 서로 이어져 있다", () => {
    const bad: string[] = [];
    for (const { label, d } of districts) {
      // 한 입구에서만 퍼뜨려 본다: 거기서 나머지 전부에 닿으면 서로 다 이어진 것
      const first = exitsOf(d)[0];
      const reach = reachableCells({ ...d, doors: [], start: first, stairs: undefined });
      for (const [name, cell] of fixedSymbols(d)) if (isFloor(d, cell) && !reach.has(cellKey(...cell))) bad.push(`${label}: ${name} [${cell}] 에 닿을 수 없다`);
    }
    expect(bad).toEqual([]);
  });

  it("채집지는 원정마다 무작위지만 바위·고정 심볼·닿을 수 없는 칸을 피하고 서로 붙지 않는다", () => {
    const bad: string[] = [];
    for (const { label, d } of districts) {
      const taken = new Set(fixedSymbols(d).map(([, cell]) => cellKey(...cell)));
      const reach = reachableCells(d);
      for (let seed = 1; seed <= 40; seed++) {
        const gs = rollGathers(d, seed * 7919);
        gs.forEach((g, i) => {
          const k = cellKey(...g.cell);
          if (!isFloor(d, g.cell)) bad.push(`${label} 시드 ${seed}: 채집지가 바위 위 [${g.cell}]`);
          if (taken.has(k)) bad.push(`${label} 시드 ${seed}: 채집지가 고정 심볼과 같은 칸 [${g.cell}]`);
          if (!reach.has(k)) bad.push(`${label} 시드 ${seed}: 닿을 수 없는 채집지 [${g.cell}]`);
          if (gs.some((o, j) => j < i && Math.abs(o.cell[0] - g.cell[0]) <= 1 && Math.abs(o.cell[1] - g.cell[1]) <= 1)) bad.push(`${label} 시드 ${seed}: 채집지끼리 붙음 [${g.cell}]`);
        });
      }
    }
    expect(bad).toEqual([]);
  });
});
