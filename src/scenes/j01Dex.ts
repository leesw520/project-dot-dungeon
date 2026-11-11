// J01 도감 상세 — 왼쪽은 번호·이름·그림·분류 배지·설명, 오른쪽은 카테고리 2×2, 속성, 획득 패널.
// 획득 패널은 조합식 / 채집 장소 / 드롭 몬스터 중 데이터가 있는 것만 탭으로 보여준다.
// 속성 표시는 A(고정 칸 + 가운데 원) / B(가진 것만 채우기) 두 안을 E 키나 버튼으로 바꿔 비교한다.
import { DEX, MONSTERS, PLACES, buildDex, dexById, sourcesOf, type DexEntry, type Ingredient, type SourceKind } from "../data/dex";
import { drawTempIcon } from "../render/tempIcon";
import { BASE_ELEMENTS, ELEMENT_DEFS, ELEMENT_ORDER, KIND_LABEL, type ElementId } from "../data/itemTaxonomy";
import { goTo } from "../engine/nav";
import { C, PIECE, R, T, W, disc, grid, img, piece, textWidth } from "../render/primitives";
import type { LogicalPoint, Scene } from "./types";

type ElementView = "A" | "B";
type Hit = { x: number; y: number; w: number; h: number; fn: () => void };

const SOURCE_LABEL: Record<SourceKind, string> = { recipe: "조합식", gather: "채집 장소", drop: "드롭 몬스터" };
const SOURCE_BADGE: Record<SourceKind, string> = { recipe: "조합품", gather: "채집물", drop: "드롭품" };
const SOURCE_DOT: Record<SourceKind, string> = { recipe: C.node, gather: C.good, drop: C.foe };

const CARD = "#E8D9A8"; // 원본 도감의 크림색 카드 느낌 — 아이콘 바탕에만 쓴다
const CARD_EDGE = "#C9B27A";
const SHAPE_GRID = 5; // 도감 도트 형태 판 크기 (docs/items.md 4장 — 형태는 5×5 이내)
const EMBLEM = "opacity='.45'";

export function createJ01Scene(): Scene {
  let index = 0;
  let sourceTab: SourceKind | null = null;
  let elementView: ElementView = "A";
  let hits: Hit[] = [];

  function entry(): DexEntry {
    buildDex(); // 지금 게임 데이터로 처음 한 번 채운다
    return DEX[index];
  }
  function show(i: number) {
    index = (i + DEX.length) % DEX.length;
    sourceTab = null;
  }
  function hit(x: number, y: number, w: number, h: number, fn: () => void) {
    hits.push({ x, y, w, h, fn });
  }

  function onPointerDown(p: LogicalPoint, button: number) {
    if (button !== 0) return;
    // 나중에 그린 것이 위에 있으니 뒤에서부터 본다
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      if (p.x >= h.x && p.x < h.x + h.w && p.y >= h.y && p.y < h.y + h.h) {
        h.fn();
        return;
      }
    }
  }

  function onKeyDown(key: string) {
    if (key === "ArrowLeft") show(index - 1);
    else if (key === "ArrowRight") show(index + 1);
    else if (key === "e" || key === "E") elementView = elementView === "A" ? "B" : "A";
  }

  // ---- 공용 조각 ----

  function smallButton(x: number, y: number, w: number, label: string, fn: () => void, on?: boolean) {
    R(x, y, w, 12, on ? C.gold : C.woodL);
    T(x + w / 2, y + 9, label, 7, C.woodD, "middle");
    hit(x, y, w, 12, fn);
  }

  /** 제목 양옆에 장식선이 붙은 패널 — 원본 도감의 "카테고리" 머리 모양 */
  function panel(x: number, y: number, w: number, h: number, title?: string) {
    R(x, y, w, h, C.woodD);
    R(x + 1, y + 1, w - 2, h - 2, C.panelIn);
    if (!title) return;
    ornamentTitle(x + w / 2, y + 11, w - 12, title);
  }
  function ornamentTitle(cx: number, baseline: number, span: number, title: string) {
    const tw = textWidth(title, 8);
    const side = (span - tw) / 2 - 6;
    if (side > 4) {
      R(cx - tw / 2 - 4 - side, baseline - 3, side, 1, C.woodL);
      R(cx + tw / 2 + 4, baseline - 3, side, 1, C.woodL);
      R(cx - tw / 2 - 4 - side - 2, baseline - 4, 2, 3, C.woodL);
      R(cx + tw / 2 + 4 + side, baseline - 4, 2, 3, C.woodL);
    }
    T(cx, baseline, title, 8, C.gold, "middle");
  }

  function wrap(text: string, maxW: number, sz: number): string[] {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, sz) <= maxW) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      // 한 단어가 줄보다 길면 글자 단위로 자른다
      line = "";
      for (const ch of word) {
        if (textWidth(line + ch, sz) > maxW) {
          lines.push(line);
          line = "";
        }
        line += ch;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function centeredPiece(x: number, y: number, size: number, cells: DexEntry["shape"]["cells"], color: string, maxCs: number) {
    const cols = Math.max(...cells.map(([c]) => c)) + 1;
    const rows = Math.max(...cells.map(([, r]) => r)) + 1;
    const cs = Math.max(4, Math.min(maxCs, Math.floor((size - 4) / Math.max(cols, rows))));
    const pw = cols * cs - 2;
    const ph = rows * cs - 2;
    piece(x + Math.floor((size - pw) / 2), y + Math.floor((size - ph) / 2), cs, cells, color);
  }

  /** 카테고리 아이콘 자리 — 아트가 오기 전까지 크림색 카드에 첫 글자 */
  function categoryIcon(x: number, y: number, size: number, cat: string, tint?: string) {
    R(x, y, size, size, C.woodD);
    R(x + 1, y + 1, size - 2, size - 2, tint ?? CARD);
    R(x + 1, y + 1, size - 2, 1, CARD_EDGE);
    T(x + size / 2, y + size / 2 + 4, cat[0], size >= 20 ? 9 : 8, C.woodD, "middle");
  }

  /** 빈 칸 — 원본의 빛바랜 문양 자리. 마름모 점선으로 */
  function emptyEmblem(cx: number, cy: number, r: number) {
    for (let i = 0; i <= r; i += 2) {
      R(cx - r + i, cy - i, 1, 1, C.woodL, EMBLEM);
      R(cx + r - i, cy - i, 1, 1, C.woodL, EMBLEM);
      R(cx - r + i, cy + i, 1, 1, C.woodL, EMBLEM);
      R(cx + r - i, cy + i, 1, 1, C.woodL, EMBLEM);
    }
    R(cx - 1, cy - 1, 2, 2, C.woodL, EMBLEM);
  }

  // ---- 왼쪽: 이름, 그림, 도트 형태, 분류 ----

  function drawIdentity(e: DexEntry) {
    R(20, 28, 48, 12, C.listRow);
    T(44, 37, `No.${String(e.no).padStart(3, "0")}`, 7, C.gold, "middle");

    T(108, 55, e.name, 10, C.txt, "middle");
    R(28, 60, 160, 1, C.woodL);
    R(26, 59, 3, 3, C.woodL);
    R(187, 59, 3, 3, C.woodL);

    // 그림 카드
    R(20, 66, 74, 74, C.woodD);
    R(22, 68, 70, 70, CARD);
    R(22, 68, 70, 2, CARD_EDGE);
    // 아트가 없으면 임시 도트 아이콘 (render/tempIcon.ts), 그것도 안 되면 자리표시
    if (!e.image || !img(23, 71, 68, 66, e.image)) if (!drawTempIcon(e.id, 23, 69, 68)) imagePlaceholder(22, 68, 70, shapeColor(e));

    drawShape(e, 100, 66, 96, 74);

    // 분류 배지: 종류 1개 + 획득 경로를 한 줄로
    let x = 20;
    const kindLabel = `${KIND_LABEL[e.kind]} 아이템`;
    const kw = Math.ceil(textWidth(kindLabel, 7)) + 14;
    R(x, 146, kw, 14, C.woodD);
    R(x + 1, 147, kw - 2, 12, C.woodL);
    T(x + kw / 2, 156, kindLabel, 7, C.woodD, "middle");
    x += kw + 3;
    sourcesOf(e).forEach((src) => {
      const label = SOURCE_BADGE[src];
      const w = Math.ceil(textWidth(label, 7)) + 14;
      R(x, 146, w, 14, C.woodD);
      R(x + 1, 147, w - 2, 12, C.listRowSel);
      R(x + 1, 147, 3, 12, SOURCE_DOT[src]);
      T(x + 3 + (w - 3) / 2, 156, label, 7, C.txt, "middle");
      x += w + 3;
    });
  }

  /** 아트가 없을 때 — 아이템 색 구슬 + "이미지 없음" */
  function imagePlaceholder(x: number, y: number, size: number, color: string) {
    const cx = x + size / 2;
    const cy = y + size / 2 - 4;
    disc(cx, cy, 19, C.woodD);
    disc(cx, cy, 18, color);
    disc(cx - 6, cy - 7, 5, "#ffffff");
    R(cx - 18, cy - 18, 36, 36, CARD, "opacity='.25'");
    T(cx, y + size - 6, "이미지 없음", 7, C.woodL, "middle");
  }

  /** 도트 형태 — 가방·배치판에서 차지하는 칸 모양을 빈 격자 위에 보여준다 */
  function drawShape(e: DexEntry, x: number, y: number, w: number, h: number) {
    panel(x, y, w, h);
    const cells = e.shape.cells;
    T(x + 6, y + 11, "도트 형태", 7, C.gold);
    const cols = Math.max(...cells.map(([c]) => c)) + 1;
    const rows = Math.max(...cells.map(([, r]) => r)) + 1;
    // 모양과 상관없이 늘 같은 5×5 판 — 아이템끼리 크기를 바로 비교할 수 있게
    const gc = SHAPE_GRID;
    const gr = SHAPE_GRID;
    const areaW = w - 12;
    const areaH = h - 20;
    const cs = Math.max(4, Math.min(12, Math.floor((areaW + 2) / gc), Math.floor((areaH + 2) / gr)));
    const gx = x + 6 + Math.floor((areaW - (gc * cs - 2)) / 2);
    const gy = y + 15 + Math.floor((areaH - (gr * cs - 2)) / 2);
    grid(gx, gy, gc, gr, cs, C.cellLocked);
    const ox = Math.floor((gc - cols) / 2);
    const oy = Math.floor((gr - rows) / 2);
    piece(gx + ox * cs, gy + oy * cs, cs, cells, shapeColor(e));
  }

  function shapeColor(e: DexEntry) {
    return PIECE[e.shape.color];
  }

  function drawDescription(e: DexEntry) {
    const x = 20;
    const y = 164;
    const w = 176;
    const h = 82;
    panel(x, y, w, h);
    const lines = wrap(e.desc, w - 16, 7).slice(0, 5);
    for (let i = 0; i < 5; i++) {
      const base = y + 16 + i * 13;
      R(x + 6, base + 3, w - 12, 1, C.listRow);
      if (lines[i]) T(x + 8, base, lines[i], 7, C.txt);
    }
  }

  // ---- 오른쪽 위: 카테고리, 속성 ----

  function drawCategories(e: DexEntry) {
    const px = 204;
    const py = 28;
    panel(px, py, 126, 110, "카테고리");
    for (let i = 0; i < 4; i++) {
      const sx = px + 6 + (i % 2) * 58;
      const sy = py + 20 + Math.floor(i / 2) * 44;
      const cat = e.categories[i];
      if (!cat) {
        emptyEmblem(sx + 28, sy + 16, 9);
        continue;
      }
      categoryIcon(sx + 17, sy + 2, 22, cat);
      T(sx + 28, sy + 36, `(${cat})`, 7, C.txt, "middle");
    }
  }

  function drawElements(e: DexEntry) {
    const px = 334;
    const py = 28;
    panel(px, py, 126, 110, "속성");
    if (elementView === "A") drawElementsFixed(e, px, py);
    else drawElementsPacked(e, px, py);
  }

  /** A안: 기본 4속성은 늘 같은 자리, 빛/어둠은 네 칸이 만나는 가운데 원 */
  function drawElementsFixed(e: DexEntry, px: number, py: number) {
    const S = 26;
    const GAP = 8;
    const gx = px + Math.floor((126 - (S * 2 + GAP)) / 2);
    const gy = py + 20;
    BASE_ELEMENTS.forEach((id, i) => {
      const def = ELEMENT_DEFS[id];
      const x = gx + (i % 2) * (S + GAP);
      const y = gy + Math.floor(i / 2) * (S + GAP);
      const on = e.elements.includes(id);
      R(x, y, S, S, C.woodD);
      if (on) {
        R(x + 1, y + 1, S - 2, S - 2, def.color);
        R(x + 1, y + 1, S - 2, 2, def.light);
        T(x + S / 2, y + S / 2 + 4, def.label[0], 8, C.woodD, "middle");
      } else {
        // 꺼진 칸도 자리 색을 흐리게 남겨서 "여기가 무슨 속성 자리인지" 보이게 한다
        R(x + 1, y + 1, S - 2, S - 2, C.cellLocked);
        R(x + 1, y + 1, S - 2, S - 2, "none", `stroke='${def.color}' opacity='.45'`);
      }
    });
    const cx = gx + S + GAP / 2;
    const cy = gy + S + GAP / 2;
    const hasW = e.elements.includes("white");
    const hasB = e.elements.includes("black");
    disc(cx, cy, 9, C.woodD);
    if (hasW && hasB) {
      disc(cx, cy, 8, ELEMENT_DEFS.white.color, "left");
      disc(cx, cy, 8, ELEMENT_DEFS.black.color, "right");
    } else if (hasW || hasB) {
      const def = ELEMENT_DEFS[hasW ? "white" : "black"];
      disc(cx, cy, 8, def.light);
      disc(cx, cy, 7, def.color);
    } else {
      disc(cx, cy, 8, C.cellLocked);
      disc(cx, cy, 3, C.listRowSel);
    }

    const names = ELEMENT_ORDER.filter((id) => e.elements.includes(id)).map((id) => ELEMENT_DEFS[id].label);
    T(px + 63, py + 102, names.join(" · "), 7, C.sub, "middle");
  }

  /** B안: 가진 속성만 앞에서부터 2×2에 채운다 (원본 도감 방식). 5개 이상이면 +N */
  function drawElementsPacked(e: DexEntry, px: number, py: number) {
    const owned = ELEMENT_ORDER.filter((id) => e.elements.includes(id));
    for (let i = 0; i < 4; i++) {
      const sx = px + 6 + (i % 2) * 58;
      const sy = py + 20 + Math.floor(i / 2) * 44;
      const id: ElementId | undefined = owned[i];
      if (!id) {
        emptyEmblem(sx + 28, sy + 16, 9);
        continue;
      }
      const def = ELEMENT_DEFS[id];
      // 특수 속성은 금색 고리를 하나 더 둘러 기본 속성과 구분
      if (def.special) disc(sx + 28, sy + 13, 13, C.gold);
      disc(sx + 28, sy + 13, 12, C.woodD);
      disc(sx + 28, sy + 13, 11, def.color);
      disc(sx + 28, sy + 10, 4, def.light);
      T(sx + 28, sy + 36, i === 3 && owned.length > 4 ? `${def.label} +${owned.length - 4}` : def.label, 7, C.txt, "middle");
    }
  }

  // ---- 오른쪽 아래: 획득 ----

  function drawSources(e: DexEntry) {
    const px = 204;
    const py = 142;
    const pw = 256;
    const ph = 104;
    const sources = sourcesOf(e);
    if (!sourceTab || !sources.includes(sourceTab)) sourceTab = sources[0] ?? null;
    panel(px, py, pw, ph);

    if (sources.length <= 1) {
      ornamentTitle(px + pw / 2, py + 11, pw - 12, sourceTab ? SOURCE_LABEL[sourceTab] : "획득 방법");
    } else {
      // 경로가 여럿이면 제목 자리를 탭으로
      const tw = 64;
      const total = sources.length * tw + (sources.length - 1) * 4;
      sources.forEach((s, i) => {
        const x = px + Math.floor((pw - total) / 2) + i * (tw + 4);
        const on = s === sourceTab;
        R(x, py + 3, tw, 12, on ? C.gold : C.listRow);
        T(x + tw / 2, py + 12, SOURCE_LABEL[s], 7, on ? C.woodD : C.sub, "middle");
        hit(x, py + 3, tw, 12, () => (sourceTab = s));
      });
    }

    const ax = px + 6;
    const ay = py + 20;
    if (sourceTab === "recipe") drawRecipe(e.recipe ?? [], ax, ay);
    else if (sourceTab === "gather") drawPlaces(e.gatherAt ?? [], ax, ay);
    else if (sourceTab === "drop") drawMonsters(e.droppedBy ?? [], ax, ay);
    else T(px + pw / 2, py + 60, "얻는 방법이 아직 알려지지 않았다", 7, C.sub, "middle");
  }

  function drawRecipe(list: Ingredient[], ax: number, ay: number) {
    for (let i = 0; i < 4; i++) {
      const x = ax + (i % 2) * 124;
      const y = ay + Math.floor(i / 2) * 40;
      const ing = list[i];
      R(x, y, 120, 36, C.listRow);
      if (!ing) {
        emptyEmblem(x + 60, y + 18, 7);
        continue;
      }
      if ("itemId" in ing) {
        const target = dexById(ing.itemId);
        R(x + 4, y + 4, 28, 28, C.woodD);
        R(x + 5, y + 5, 26, 26, CARD);
        if (target && !(target.image && img(x + 5, y + 5, 26, 26, target.image))) centeredPiece(x + 5, y + 5, 26, target.shape.cells, shapeColor(target), 6);
        T(x + 38, y + 16, target?.name ?? ing.itemId, 7, C.txt);
        T(x + 38, y + 28, `×${ing.count}`, 7, C.sub);
        // 특정 아이템 재료는 눌러서 그 항목으로 이동
        if (target) {
          T(x + 114, y + 28, "▶", 7, C.gold, "end");
          hit(x, y, 120, 36, () => show(DEX.indexOf(target)));
        }
      } else {
        categoryIcon(x + 4, y + 4, 28, ing.category, "#C0DD97");
        T(x + 38, y + 16, `(${ing.category})`, 7, C.txt);
        T(x + 38, y + 28, `×${ing.count} · 카테고리`, 7, C.sub);
      }
    }
  }

  function drawPlaces(ids: string[], ax: number, ay: number) {
    for (let i = 0; i < 6; i++) {
      const x = ax + (i % 3) * 82;
      const y = ay + Math.floor(i / 3) * 40;
      const place = PLACES[ids[i]];
      if (!place) {
        R(x, y, 78, 36, C.listRow);
        emptyEmblem(x + 39, y + 18, 7);
        continue;
      }
      R(x, y, 78, 36, C.woodD);
      R(x + 1, y + 1, 76, 16, place.sky);
      R(x + 1, y + 17, 76, 8, place.ground);
      R(x + 1, y + 25, 76, 10, "#000000", "opacity='.55'");
      T(x + 39, y + 33, place.name, 7, C.txt, "middle");
    }
  }

  function drawMonsters(ids: string[], ax: number, ay: number) {
    for (let i = 0; i < 6; i++) {
      const x = ax + (i % 3) * 82;
      const y = ay + Math.floor(i / 3) * 40;
      const mon = MONSTERS[ids[i]];
      R(x, y, 78, 36, C.listRow);
      if (!mon) {
        emptyEmblem(x + 39, y + 18, 7);
        continue;
      }
      // 몬스터 그림 자리 — 동그란 몸통 + 눈 두 개
      disc(x + 16, y + 19, 11, C.woodD);
      disc(x + 16, y + 19, 10, mon.color);
      R(x + 11, y + 15, 3, 3, C.dark);
      R(x + 18, y + 15, 3, 3, C.dark);
      T(x + 32, y + 22, mon.name, 7, C.txt);
    }
  }

  function draw() {
    hits = [];
    const e = entry();
    R(0, 0, 480, 270, C.screenBg);
    W(10, 8, 460, 254, "도감");

    smallButton(128, 10, 64, "몬스터 도감", () => goTo("j02"));
    smallButton(200, 10, 64, `속성 표시 ${elementView}`, () => (elementView = elementView === "A" ? "B" : "A"));
    smallButton(272, 10, 18, "◀", () => show(index - 1));
    T(312, 19, `${index + 1} / ${DEX.length}`, 7, C.woodD, "middle");
    smallButton(334, 10, 18, "▶", () => show(index + 1));
    smallButton(396, 10, 64, "◀ 거점으로", () => goTo("h01"));

    drawIdentity(e);
    drawDescription(e);
    drawCategories(e);
    drawElements(e);
    drawSources(e);
  }

  return { id: "j01", label: "J01 도감", draw, onPointerDown, onKeyDown };
}
