// E01 원정 정산 (2026-11-08, docs/screens.md E01). 탐색(D01)에서 귀환하거나 전멸하면 거점(H01) 전에 들른다.
// 이번 원정에서 있었던 일: 결과 · 층 · 체류 · 전투 · 쓰러뜨린 적 · 골드 · 경험치 · 레벨업 · 채집 · 보물상자 · 가져온(잃은) 아이템.
// "거점으로"를 누르면 H01 (거점은 예전처럼 한 줄 안내도 띄운다).
import { PIECES, pieceColors } from "../data/pieces";
import { PARTY } from "../data/battle";
import { charArt } from "../data/charArt";
import { goTo } from "../engine/nav";
import { C, R, T, W, btn, fitText, img, piece } from "../render/primitives";
import { getExpeditionSummary } from "./d01Explore";
import type { LogicalPoint, Scene } from "./types";

const GO = { x: 330, y: 238, w: 124, h: 16 };
const ITEM_COLS = 2, ITEM_ROWS = 8;

export function createE01Scene(): Scene {
  let mouse: LogicalPoint = { x: -1, y: -1 };
  const hit = (p: LogicalPoint, r: { x: number; y: number; w: number; h: number }) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

  function onPointerDown(p: LogicalPoint, button: number) {
    if (button !== 0) return;
    if (hit(p, GO)) goTo("h01");
  }
  function onKeyDown(key: string) {
    if (key === "Enter" || key === " ") goTo("h01");
  }

  function line(x: number, y: number, label: string, value: string, col: string = C.txt) {
    T(x, y, label, 7, C.sub);
    T(x + 132, y, value, 8, col, "end");
  }

  function draw() {
    R(0, 0, 480, 270, C.screenBg);
    const s = getExpeditionSummary();
    const lose = s?.outcome === "lose";
    W(10, 8, 460, 254, lose ? "원정 실패" : "원정 정산");
    if (!s) {
      T(30, 50, "정산할 원정이 없다", 8, C.sub);
      btn(GO.x, GO.y, GO.w, "거점으로", hit(mouse, GO));
      return;
    }
    // 머리: 결과 한 줄
    T(24, 40, lose ? `${s.floorName}에서 전멸했다` : `${s.floorName}에서 돌아왔다`, 10, lose ? C.hp : C.gold);
    T(24, 54, lose ? "가방에 든 것을 모두 잃었다." : `${s.reason} — 가방에 든 것은 창고로 옮겼다.`, 7, C.sub);

    // 왼쪽: 기록
    const x0 = 24;
    let y = 74;
    R(x0 - 4, y - 10, 148, 1, C.woodD);
    line(x0, y, "탐색한 구획", `${s.districts}곳`); y += 13;
    line(x0, y, "놓은 타일", `${s.stayUsed}개`); y += 13;
    line(x0, y, "전투", `${s.battles}번`); y += 13;
    line(x0, y, "채집", `${s.gathers}곳`); y += 13;
    line(x0, y, "보물상자", `${s.chests}개`); y += 13;
    line(x0, y, "얻은 골드", `${s.gold} G`, C.gold); y += 13;
    line(x0, y, "얻은 경험치", `${s.exp}`, C.good); y += 16;
    T(x0, y, "쓰러뜨린 적", 7, C.sub); y += 11;
    if (!s.kills.length) { T(x0 + 6, y, "없음", 7, C.cellExt); y += 11; }
    s.kills.slice(0, 5).forEach(([name, n]) => { T(x0 + 6, y, fitText(name, 100, 7), 7, C.txt); T(x0 + 132, y, `×${n}`, 7, C.txt, "end"); y += 10; });
    if (s.kills.length > 5) T(x0 + 6, y, `… 외 ${s.kills.length - 5}종`, 6, C.sub);

    // 가운데: 파티 레벨
    const px = 176;
    T(px, 66, "파티", 7, C.sub);
    s.levels.forEach((l, i) => {
      const yy = 74 + i * 38;
      const p = PARTY.find((q) => q.name === l.name);
      R(px, yy, 120, 34, C.panelIn);
      const face = charArt(l.name, "portrait");
      if (!face || !img(px + 3, yy + 3, 28, 28, face, 1, true)) R(px + 3, yy + 3, 28, 28, p?.color ?? C.cell);
      T(px + 36, yy + 13, l.name, 8, C.txt);
      const up = l.to > l.from;
      T(px + 36, yy + 26, up ? `Lv ${l.from} → ${l.to}` : `Lv ${l.to}`, 7, up ? C.gold : C.sub);
      if (up) T(px + 116, yy + 13, "레벨 업!", 7, C.gold, "end");
    });

    // 오른쪽: 아이템
    const ix = 306;
    T(ix, 66, lose ? "잃은 아이템" : "가져온 아이템", 7, lose ? C.hp : C.sub);
    if (!s.items.length) T(ix + 4, 84, "없음", 7, C.cellExt);
    s.items.slice(0, ITEM_COLS * ITEM_ROWS).forEach(([id, n], i) => {
      const d = PIECES[id];
      if (!d) return;
      const x = ix + (i % ITEM_COLS) * 76, yy = 74 + Math.floor(i / ITEM_COLS) * 20;
      R(x, yy, 72, 18, lose ? C.cellLocked : C.panelIn);
      const w = Math.max(...d.cells.map(([c]) => c)) + 1, h = Math.max(...d.cells.map(([, r]) => r)) + 1;
      const cs = Math.max(2, Math.floor(14 / Math.max(w, h)));
      piece(x + 3, yy + 2 + Math.floor((14 - h * cs) / 2), cs, d.cells, pieceColors(d));
      T(x + 20, yy + 12, fitText(d.name, 36, 6), 6, lose ? C.sub : C.txt);
      T(x + 70, yy + 12, `×${n}`, 7, lose ? C.sub : C.gold, "end");
    });
    if (s.items.length > ITEM_COLS * ITEM_ROWS) T(ix, 240, `… 외 ${s.items.length - ITEM_COLS * ITEM_ROWS}종`, 6, C.sub);

    btn(GO.x, GO.y, GO.w, "거점으로", hit(mouse, GO));
  }

  return {
    id: "e01", label: "E01 원정 정산", draw, onPointerDown, onKeyDown,
    onPointerMove: (p) => { mouse = p; },
  };
}
