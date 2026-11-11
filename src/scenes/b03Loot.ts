// ui-spec.md 5장 2번(B03), 4.3(BagGrid). reference_wireframes.html 81~99행의 레이아웃을 바탕으로
// 실제 드래그/클릭 배치, 휠 회전, F 좌우반전, 자동 배치, 완료가 동작하는 상태 저장형 화면.
// B02 "전리품 분배"로 들어오면 이번 전투 전리품(engine/battleResult.ts takeLoot)을 바닥에 깔고 시작한다.
// 완료하면 이번에 가방에 넣은 전리품이 보유 목록(data/inventory.ts, 위치 "bag")에 들어가고 D01로 돌아간다.
// 가방 4열은 4인 파티(PARTY) 순서·이름·색. 가방은 B03과 D03 인벤토리가 함께 쓴다 (세션 동안, 캐릭터 데이터와 연결 전).
// withFloor=false면 D03 인벤토리: 끌면 단일 이동, 클릭하면 아이템 메뉴(사용·버린다), '재배치' 버튼을 누르면 B03처럼 클릭으로 집어 옮기는 배치 모드.
import { PARTY } from "../data/battle";
import { addItem, removeFromBag, removeItem } from "../data/inventory";
import { BAG_COLS, bagRowsOf, setBagLock } from "../data/equipment";
import { ITEM_USE } from "../data/itemUse";
import { PIECES, pieceColors, gradeLabel, type Cell, type PieceDef } from "../data/pieces";
import { takeLoot, type DropLine } from "../engine/battleResult";
import { goTo, takeNavBack } from "../engine/nav";
import { registerSave } from "../engine/save";
import { healVital, vitalsOf } from "../engine/partyVitals";
import { addStay, expeditionActive } from "./d01Explore";
import { applyRotFlip, bounds, silhouetteEdges } from "../engine/transform";
import { C, R, T, W, btn, piece, silhouette } from "../render/primitives";
import { CONTROLS_HINT_H, drawControlsHint, drawTooltip, pieceTooltip } from "../ui/tooltip";
import type { LogicalPoint, Scene } from "./types";

const NAMES = PARTY.map((p) => p.name);
// 2026-11-08: 가방 크기 = 장착한 가방 (data/equipment.ts bagRowsOf). 가방이 없으면 0줄 — 넣을 수 없다. 패널 안에서 최대 9줄.
const rowsOf = (i: number) => bagRowsOf(NAMES[i]);
const COLS = BAG_COLS;
const CS = 14; // 가방 칸 피치 (바닥 조각도 같은 피치로 그려 드래그 중 크기가 안 바뀐다)
// 바닥 왼쪽 아래 조작 안내 띠. 바닥 조각은 이 띠 위(FLOOR_BOTTOM)까지만 놓인다.
const HINT_RECT = { x: 6, y: 270 - CONTROLS_HINT_H - 1, w: 220, h: CONTROLS_HINT_H };
const FLOOR_TOP = 188;
const FLOOR_BOTTOM = HINT_RECT.y - 2;

interface PlacedItem {
  uid: number;
  pieceId: string;
  origin: Cell;
  rot: 0 | 1 | 2 | 3;
  flip: boolean;
}

interface FloorItem {
  uid: number;
  pieceId: string;
  x: number;
  y: number;
  rot: 0 | 1 | 2 | 3;
  flip: boolean;
}

type DragSource = { kind: "bag"; bagIndex: number } | { kind: "floor" };

interface FloatingPiece {
  uid: number;
  source: DragSource;
  pieceId: string;
  rot: 0 | 1 | 2 | 3;
  flip: boolean;
  pointer: LogicalPoint;
  revert: PlacedItem | FloorItem;
}

type HoverInfo =
  | { kind: "bag"; bagIndex: number; uid: number; pieceId: string; pointer: LogicalPoint }
  | { kind: "floor"; uid: number; pieceId: string; pointer: LogicalPoint };

let uidSeq = 1;

/** 캐릭터별 가방 (B03·D03 공유). 원정을 떠날 때 비어 있고, 귀환·패배하면 비운다 (2026-11-07).
 *  출발 준비(H04)에서 창고 → 가방으로 챙긴다 (packIntoBags). */
const bags: PlacedItem[][] = NAMES.map(() => []);
setBagLock(() => expeditionActive());

/** 귀환·패배: 가방 칸을 비운다 (보유 목록 쪽은 inventory의 moveBagToWarehouse / loseBag). */
export function clearBags() {
  bags.forEach((b) => (b.length = 0));
}

// 세이브 "bags" 칸 — 원정 중 가방 배치.
registerSave("bags", () => ({ bags, uidSeq }), (v) => {
  const d = v as { bags: PlacedItem[][]; uidSeq: number };
  bags.forEach((b, i) => {
    b.length = 0;
    b.push(...(d.bags[i] ?? []).filter((it) => PIECES[it.pieceId]));
  });
  uidSeq = Math.max(uidSeq, d.uidSeq);
});

// ---- 출발 준비(H04)용: 창고에서 챙긴 아이템을 가방에 자동으로 넣고 빼기 (2026-11-08) ----
function occupiedOf(i: number) {
  const occ = new Set<string>();
  bags[i].forEach((it) => applyRotFlip(PIECES[it.pieceId].cells, it.rot, it.flip).forEach(([c, r]) => occ.add(`${c},${r}`)));
  return occ;
}
/** 아무 캐릭터 가방이든 빈자리에 넣는다 (2026-11-09: 회전 없음 — 소재 모양 그대로). 넣었으면 그 줄 uid, 자리가 없으면 null. 보유 목록 쪽 위치 이동은 부르는 쪽이 한다. */
export function packIntoBags(pieceId: string): number | null {
  for (let bi = 0; bi < NAMES.length; bi++) {
    const { cols, rows } = bagGrid(bi);
    const occ = occupiedOf(bi);
    for (const rot of [0] as const) {
      const shape = applyRotFlip(PIECES[pieceId].cells, rot, false);
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          if (shape.every(([dc, dr]) => c + dc < cols && r + dr < rows && !occ.has(`${c + dc},${r + dr}`))) {
            const uid = uidSeq++;
            bags[bi].push({ uid, pieceId, origin: [c, r], rot, flip: false });
            return uid;
          }
    }
  }
  return null;
}
/** 가방에서 그 줄을 뺀다. 뺐으면 아이템 id */
export function unpackFromBags(uid: number): string | null {
  for (const b of bags) {
    const i = b.findIndex((it) => it.uid === uid);
    if (i >= 0) return b.splice(i, 1)[0].pieceId;
  }
  return null;
}
/** 가방 내용 (캐릭터 이름 · 줄) */
export function bagContents(): Array<{ owner: string; uid: number; pieceId: string }> {
  return bags.flatMap((b, i) => b.map((it) => ({ owner: NAMES[i], uid: it.uid, pieceId: it.pieceId })));
}
/** 전투에서 쓴 아이템: 가방 칸 하나 + 보유 목록(가방 위치) 하나를 뺀다 (2026-11-08). 뺐으면 true. */
export function consumeBagItem(pieceId: string): boolean {
  for (const b of bags) {
    const i = b.findIndex((it) => it.pieceId === pieceId);
    if (i >= 0) {
      b.splice(i, 1);
      removeFromBag(pieceId);
      return true;
    }
  }
  return false;
}
/** 가방에 든 아이템 id별 개수 */
export function bagCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  bags.forEach((b) => b.forEach((it) => (out[it.pieceId] = (out[it.pieceId] ?? 0) + 1)));
  return out;
}
/** 가방 칸 사용량 */
export function bagUsage(): Array<{ owner: string; filled: number; total: number }> {
  return bags.map((b, i) => ({ owner: NAMES[i], filled: b.reduce((n, it) => n + PIECES[it.pieceId].cells.length, 0), total: rowsOf(i) * COLS }));
}

function bagX(i: number) {
  return 6 + i * 118;
}
function bagGrid(i: number) {
  const x = bagX(i);
  return { gx: x + 15, gy: 48, cols: COLS, rows: rowsOf(i) };
}

function initialFloor(): FloorItem[] {
  return [
    // 탭으로 바로 열었을 때의 예시 전리품 (새 소재)
    { uid: uidSeq++, pieceId: "m:마력초", x: 40, y: 212, rot: 0, flip: false },
    { uid: uidSeq++, pieceId: "m:철광석", x: 110, y: 214, rot: 0, flip: false },
    { uid: uidSeq++, pieceId: "m:깨끗한 물", x: 150, y: 206, rot: 0, flip: false },
    { uid: uidSeq++, pieceId: "m:짐승 가죽", x: 250, y: 220, rot: 0, flip: false },
    { uid: uidSeq++, pieceId: "m:작은 결정", x: 200, y: 238, rot: 0, flip: false },
    { uid: uidSeq++, pieceId: "m:나뭇가지", x: 320, y: 226, rot: 0, flip: false },
    { uid: uidSeq++, pieceId: "c:HP 회복약", x: 400, y: 205, rot: 0, flip: false },
  ];
}

/** 전리품을 바닥에 흩어 깐다. 왼쪽부터 줄지어 놓고, 바닥이 모자라면 조금씩 비켜 겹쳐 놓는다 (screens.md 바닥 영역). */
function scatterLoot(drops: DropLine[]): FloorItem[] {
  const ids = drops.flatMap((d) => Array.from({ length: d.count }, () => d.itemId)).filter((id) => PIECES[id]);
  const out: FloorItem[] = [];
  const top = FLOOR_TOP + 16, right = 390; // 오른쪽 아래 완료 버튼 자리는 비운다
  let x = 8, y = top, rowH = 0, layer = 0;
  for (const id of ids) {
    const b = bounds(PIECES[id].cells);
    const w = (b.maxC + 1) * CS, h = (b.maxR + 1) * CS;
    if (x + w > right) { x = 8 + layer * 9; y += rowH + 4; rowH = 0; }
    if (y + h > FLOOR_BOTTOM + 2) { layer++; x = 8 + layer * 9; y = top + (layer % 3) * 5; rowH = 0; }
    out.push({ uid: uidSeq++, pieceId: id, x, y, rot: 0, flip: false });
    x += w + 6;
    rowH = Math.max(rowH, h);
  }
  return out;
}

function dist(a: LogicalPoint, b: LogicalPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function createB03Scene(withFloor = true): Scene {
  let floor: FloorItem[] = withFloor ? initialFloor() : [];
  /** 이번 분배에서 바닥에 깔린 전리품 uid. 완료 때 가방에 들어간 것만 보유 목록에 더한다. */
  let lootUids = new Set(floor.map((f) => f.uid));
  let title = "전리품 분배 · 테스트 조각";

  let press: FloatingPiece | null = null; // 마우스를 누르고 있는 동안의 후보 상태 (클릭인지 드래그인지 아직 모름)
  let pressStart: LogicalPoint | null = null;
  let pressMoved = false;
  let selected: FloatingPiece | null = null; // 클릭으로 집어 든 뒤 다음 클릭을 기다리는 상태
  let hover: HoverInfo | null = null;
  let message = "";

  // ---- D03 인벤토리 ----
  /** 재배치(배치 모드): 클릭으로 집고 놓는다. 꺼져 있으면 클릭은 아이템 메뉴, 끌기는 단일 이동. */
  let arrange = false;
  let backTo: string | null = null;
  /** 열린 아이템 메뉴. target이면 회복 대상 고르는 단계 */
  let menu: { bagIndex: number; uid: number; pieceId: string; x: number; y: number; target: boolean } | null = null;
  const BTN_ARRANGE = { x: 304, y: 4, w: 84, h: 14 };
  const BTN_BACK = { x: 392, y: 4, w: 80, h: 14 };
  const inRect = (p: LogicalPoint, r: { x: number; y: number; w: number; h: number }) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
  const MENU_W = 92;
  const MENU_ROW = 14;

  // ---- B03 완료 확인창 ----
  let askDiscard = false;
  const ASK_BOX = { x: 120, y: 95, w: 240, h: 80 };
  const ASK_YES = { x: 150, y: 148, w: 84, h: 14 };
  const ASK_NO = { x: 246, y: 148, w: 84, h: 14 };

  interface MenuRow { label: string; enabled: boolean; run: () => void }

  function menuRows(): MenuRow[] {
    if (!menu) return [];
    const m = menu;
    const use = ITEM_USE[m.pieceId];
    if (m.target) {
      return NAMES.map((n) => {
        const v = vitalsOf(n);
        const cur = use.stat === "hp" ? v.hp : v.mp, max = use.stat === "hp" ? v.hpMax : v.mpMax;
        return { label: `${n} ${cur}/${max}`, enabled: max > 0 && cur < max, run: () => applyUse(m, n) };
      });
    }
    return [
      // 식품은 대상 없이 파티 전원 + 체류 (탐색 중에만). 포션은 대상 고르기
      { label: "사용", enabled: !!use && (!use.food || expeditionActive()), run: () => (use.food ? applyFood(m) : (m.target = true)) },
      { label: "버린다", enabled: true, run: () => { discard(m); message = `${PIECES[m.pieceId].name}을(를) 버렸어요`; menu = null; } },
    ];
  }

  function discard(m: NonNullable<typeof menu>) {
    bags[m.bagIndex] = bags[m.bagIndex].filter((it) => it.uid !== m.uid);
    if (!removeFromBag(m.pieceId)) removeItem(m.pieceId, 1); // 가방 위치의 것부터
  }

  function applyFood(m: NonNullable<typeof menu>) {
    const f = ITEM_USE[m.pieceId].food!;
    const stay = addStay(f.stay);
    NAMES.forEach((n) => { if (f.hp) healVital(n, "hp", f.hp); if (f.mp) healVital(n, "mp", f.mp); });
    discard(m);
    message = [`체류 +${stay}`, f.hp ? `전원 HP +${f.hp}` : "", f.mp ? `전원 MP +${f.mp}` : ""].filter(Boolean).join(" · ");
    menu = null;
  }

  function applyUse(m: NonNullable<typeof menu>, name: string) {
    const use = ITEM_USE[m.pieceId];
    const gain = healVital(name, use.stat!, use.amount!);
    discard(m);
    message = `${name} ${use.stat === "hp" ? "HP" : "MP"} +${gain}`;
    menu = null;
  }

  function menuBox() {
    const h = menuRows().length * MENU_ROW + 4;
    return { x: Math.min(480 - MENU_W - 2, menu!.x), y: Math.min(270 - h - 2, menu!.y), w: MENU_W, h };
  }

  function onMenuClick(p: LogicalPoint) {
    const b = menuBox();
    if (!inRect(p, b)) { menu = null; return; }
    const row = menuRows()[Math.floor((p.y - b.y - 2) / MENU_ROW)];
    if (row?.enabled) row.run();
  }

  function drawMenu() {
    if (!menu) return;
    const b = menuBox();
    R(b.x, b.y, b.w, b.h, C.tipBg, `stroke='${C.tipLine}' stroke-width='1'`);
    menuRows().forEach((row, i) => {
      const ry = b.y + 2 + i * MENU_ROW;
      if (row.enabled && hoverPoint && inRect(hoverPoint, { x: b.x, y: ry, w: b.w, h: MENU_ROW })) R(b.x + 1, ry, b.w - 2, MENU_ROW, C.tipLine, "opacity='.3'");
      T(b.x + 6, ry + 10, row.label, 7, row.enabled ? C.txt : C.cellExt);
    });
  }
  let hoverPoint: LogicalPoint | null = null;

  function setArrange(on: boolean) {
    if (selected) { revertFloating(selected); selected = null; }
    arrange = on;
    menu = null;
    message = "";
  }

  function floating(): FloatingPiece | null {
    return press ?? selected;
  }

  function pieceDef(id: string): PieceDef {
    return PIECES[id];
  }

  function absCellsBag(item: PlacedItem): Cell[] {
    const shape = applyRotFlip(pieceDef(item.pieceId).cells, item.rot, item.flip);
    return shape.map(([c, r]) => [item.origin[0] + c, item.origin[1] + r]);
  }

  function isValidPlacement(bagIndex: number, shape: Cell[], origin: Cell) {
    const { cols, rows } = bagGrid(bagIndex);
    const occupied = new Set<string>();
    bags[bagIndex].forEach((it) => absCellsBag(it).forEach(([c, r]) => occupied.add(`${c},${r}`)));
    for (const [dc, dr] of shape) {
      const c = origin[0] + dc;
      const r = origin[1] + dr;
      if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
      if (occupied.has(`${c},${r}`)) return false;
    }
    return true;
  }

  function bagAt(p: LogicalPoint) {
    for (let i = 0; i < NAMES.length; i++) {
      const { gx, gy, cols, rows } = bagGrid(i);
      if (p.x >= gx && p.x < gx + cols * CS && p.y >= gy && p.y < gy + rows * CS) return i;
    }
    return -1;
  }

  function capacityOf(i: number) {
    const total = rowsOf(i) * COLS;
    const filled = bags[i].reduce((sum, it) => sum + pieceDef(it.pieceId).cells.length, 0);
    return { filled, total };
  }

  function hitBagItem(p: LogicalPoint): { bagIndex: number; item: PlacedItem } | null {
    for (let i = bags.length - 1; i >= 0; i--) {
      const { gx, gy } = bagGrid(i);
      const list = bags[i];
      for (let k = list.length - 1; k >= 0; k--) {
        const item = list[k];
        const hit = absCellsBag(item).some(
          ([c, r]) => p.x >= gx + c * CS && p.x < gx + (c + 1) * CS - 2 && p.y >= gy + r * CS && p.y < gy + (r + 1) * CS - 2
        );
        if (hit) return { bagIndex: i, item };
      }
    }
    return null;
  }

  function hitFloorItem(p: LogicalPoint): FloorItem | null {
    for (let k = floor.length - 1; k >= 0; k--) {
      const item = floor[k];
      const shape = applyRotFlip(pieceDef(item.pieceId).cells, item.rot, item.flip);
      const hit = shape.some(
        ([c, r]) =>
          p.x >= item.x + c * CS && p.x < item.x + (c + 1) * CS - 2 && p.y >= item.y + r * CS && p.y < item.y + (r + 1) * CS - 2
      );
      if (hit) return item;
    }
    return null;
  }

  function autoPlace() {
    const remaining: FloorItem[] = [];
    floor.forEach((item) => {
      const shape = applyRotFlip(pieceDef(item.pieceId).cells, item.rot, item.flip);
      const b = bounds(shape);
      let placed = false;
      for (let bi = 0; bi < NAMES.length && !placed; bi++) {
        const { cols, rows } = bagGrid(bi);
        for (let r = 0; r <= rows - 1 - b.maxR && !placed; r++) {
          for (let c = 0; c <= cols - 1 - b.maxC && !placed; c++) {
            if (isValidPlacement(bi, shape, [c, r])) {
              bags[bi].push({ uid: item.uid, pieceId: item.pieceId, origin: [c, r], rot: item.rot, flip: item.flip });
              placed = true;
            }
          }
        }
      }
      if (!placed) remaining.push(item);
    });
    floor = remaining;
    message = floor.length === 0 ? "모두 배치했어요" : `${floor.length}개는 공간이 부족해 바닥에 남았어요`;
  }

  function complete() {
    if (selected) {
      revertFloating(selected);
      selected = null;
    }
    if (floor.length > 0) {
      askDiscard = true;
      return;
    }
    finish();
  }

  /** 바닥에 조각이 남았을 때 띄우는 도트 확인창. 열려 있는 동안 다른 입력은 막는다. */
  function onAskClick(p: LogicalPoint) {
    if (inRect(p, ASK_YES)) { askDiscard = false; finish(); }
    else if (inRect(p, ASK_NO)) askDiscard = false;
  }

  function drawAsk() {
    if (!askDiscard) return;
    R(0, 0, 480, 270, "#000000", "opacity='.55'");
    W(ASK_BOX.x, ASK_BOX.y, ASK_BOX.w, ASK_BOX.h, "");
    T(240, ASK_BOX.y + 24, `바닥에 남은 조각 ${floor.length}개를 버릴까요?`, 8, C.txt, "middle");
    T(240, ASK_BOX.y + 38, "버리면 되찾을 수 없어요", 7, C.sub, "middle");
    btn(ASK_YES.x, ASK_YES.y, ASK_YES.w, "버린다", !!hoverPoint && inRect(hoverPoint, ASK_YES));
    btn(ASK_NO.x, ASK_NO.y, ASK_NO.w, "돌아가기", !!hoverPoint && inRect(hoverPoint, ASK_NO));
  }

  function finish() {
    // 이번 전리품 중 가방에 들어간 것 → 보유 목록(위치 가방). 원래 가방에 있던 걸 바닥에 내려놓았으면 버린 것.
    let kept = 0;
    bags.forEach((b) => b.forEach((it) => { if (lootUids.has(it.uid)) { addItem(it.pieceId, 1, "bag"); kept++; } }));
    floor.forEach((it) => { if (!lootUids.has(it.uid)) removeItem(it.pieceId, 1); }); // TODO(spec): 가방 위치의 개체부터 빼기
    floor = [];
    lootUids = new Set();
    title = "전리품 분배";
    message = `${kept}개를 가방에 넣었어요`;
    // TODO(spec): 원래는 D01 탐색으로 복귀 (D01이 아직 정적 화면)
    goTo("d01");
  }

  function onEnter() {
    if (!withFloor) {
      backTo = takeNavBack();
      setArrange(false);
      return;
    }
    const loot = takeLoot();
    if (!loot) return; // 탭으로 바로 들어오면 지금 상태 그대로
    if (selected) { revertFloating(selected); selected = null; }
    floor = scatterLoot(loot);
    lootUids = new Set(floor.map((f) => f.uid));
    title = `전리품 분배 · 획득 ${floor.length}개`;
    message = floor.length ? "" : "이번 전투의 전리품이 없어요";
  }

  function revertFloating(f: FloatingPiece) {
    if (f.source.kind === "bag") bags[f.source.bagIndex].push(f.revert as PlacedItem);
    else floor.push(f.revert as FloorItem);
  }

  /** 반환값: 배치에 성공했는지. 실패하면(드래그 해제가 아닌 한) 계속 떠 있는 채로 둔다. */
  function tryCommit(f: FloatingPiece, p: LogicalPoint, isDragRelease: boolean): boolean {
    const anchor: Cell = [p.x - CS / 2, p.y - CS / 2];
    const bagIndex = bagAt(p);
    const shape = applyRotFlip(pieceDef(f.pieceId).cells, f.rot, f.flip);

    if (bagIndex >= 0) {
      const { gx, gy } = bagGrid(bagIndex);
      const origin: Cell = [Math.round((anchor[0] - gx) / CS), Math.round((anchor[1] - gy) / CS)];
      if (isValidPlacement(bagIndex, shape, origin)) {
        bags[bagIndex].push({ uid: f.uid, pieceId: f.pieceId, origin, rot: f.rot, flip: f.flip });
        return true;
      }
      if (isDragRelease) revertFloating(f);
      return false;
    }

    if (withFloor && p.y >= FLOOR_TOP) {
      // 조각 전체(회전 반영)가 바닥 안, 조작 안내 띠 위에 들어오게 맞춘다.
      const b = bounds(shape);
      const fx = Math.max(0, Math.min(480 - (b.maxC + 1) * CS, p.x - CS / 2));
      const fy = Math.max(FLOOR_TOP + 16, Math.min(FLOOR_BOTTOM - (b.maxR + 1) * CS + 2, p.y - CS / 2));
      floor.push({ uid: f.uid, pieceId: f.pieceId, x: fx, y: fy, rot: f.rot, flip: f.flip });
      return true;
    }

    if (isDragRelease) revertFloating(f);
    return false;
  }

  function pickUp(p: LogicalPoint): FloatingPiece | null {
    const bagHit = hitBagItem(p);
    if (bagHit) {
      bags[bagHit.bagIndex] = bags[bagHit.bagIndex].filter((it) => it.uid !== bagHit.item.uid);
      return { uid: bagHit.item.uid, source: { kind: "bag", bagIndex: bagHit.bagIndex }, pieceId: bagHit.item.pieceId, rot: bagHit.item.rot, flip: bagHit.item.flip, pointer: p, revert: bagHit.item };
    }
    const floorHit = hitFloorItem(p);
    if (floorHit) {
      floor = floor.filter((it) => it.uid !== floorHit.uid);
      return { uid: floorHit.uid, source: { kind: "floor" }, pieceId: floorHit.pieceId, rot: floorHit.rot, flip: floorHit.flip, pointer: p, revert: floorHit };
    }
    return null;
  }

  function onPointerDown(p: LogicalPoint, button: number) {
    if (askDiscard) {
      if (button === 2) askDiscard = false;
      else if (button === 0) onAskClick(p);
      return;
    }
    if (button === 0 && withFloor && p.x >= 392 && p.x < 472 && p.y >= 4 && p.y < 18) return autoPlace();
    if (button === 0 && withFloor && p.x >= 400 && p.x < 472 && p.y >= 250 && p.y < 264) return complete();
    if (!withFloor) {
      if (menu) {
        if (button === 2) menu = null;
        else if (button === 0) onMenuClick(p);
        return;
      }
      if (button === 0 && inRect(p, BTN_ARRANGE)) return setArrange(!arrange);
      if (button === 0 && backTo && inRect(p, BTN_BACK)) { setArrange(false); return goTo(backTo); }
    }

    if (button === 2) {
      if (selected) {
        revertFloating(selected);
        selected = null;
      }
      return;
    }
    if (button !== 0) return;

    if (selected) {
      if (tryCommit(selected, p, false)) selected = null;
      return;
    }

    const picked = pickUp(p);
    if (!picked) return;
    press = picked;
    pressStart = p;
    pressMoved = false;
    hover = null;
  }

  function onPointerMove(p: LogicalPoint) {
    hoverPoint = p;
    if (press) {
      if (!pressMoved && pressStart && dist(p, pressStart) > 4) pressMoved = true;
      press.pointer = p;
      return;
    }
    if (selected) {
      selected.pointer = p;
      return;
    }
    const bagHit = hitBagItem(p);
    const floorHit = !bagHit && hitFloorItem(p);
    hover = bagHit
      ? { kind: "bag", bagIndex: bagHit.bagIndex, uid: bagHit.item.uid, pieceId: bagHit.item.pieceId, pointer: p }
      : floorHit
      ? { kind: "floor", uid: floorHit.uid, pieceId: floorHit.pieceId, pointer: p }
      : null;
  }

  function onPointerUp(p: LogicalPoint, button: number) {
    if (button !== 0 || !press) return;
    if (pressMoved) {
      tryCommit(press, p, true);
      press = null;
    } else if (!withFloor && !arrange) {
      // 인벤토리: 움직이지 않은 클릭은 집지 않고 아이템 메뉴
      const f = press;
      revertFloating(f);
      press = null;
      if (f.source.kind === "bag") menu = { bagIndex: f.source.bagIndex, uid: f.uid, pieceId: f.pieceId, x: p.x + 4, y: p.y + 4, target: false };
    } else {
      selected = press;
      selected.pointer = p;
      press = null;
    }
    pressStart = null;
    pressMoved = false;
  }





  function onKeyDown(key: string) {
    if (askDiscard) {
      if (key === "Escape") askDiscard = false;
      else if (key === "Enter") { askDiscard = false; finish(); }
      return;
    }
    if (key === "Escape" && !withFloor) {
      if (menu) menu = null;
      else if (selected) setArrange(arrange);
      else if (backTo) goTo(backTo);
      return;
    }
    // 2026-11-09: 가방은 회전·반전 없음 (소재 모양 그대로 배치) — F 키는 쓰지 않는다
  }

  /** 2026-11-09: 가방은 회전 없음 — 휠은 쓰지 않는다 */
  function onWheel(_deltaY: number) {}

  /** 마우스가 올라간 조각 하나만, 칸별 격자선이 아니라 전체 실루엣으로 얇게 강조. */
  function highlight(x: number, y: number, shape: Cell[]) {
    silhouette(x, y, CS, silhouetteEdges(shape), C.gold, { width: 1, alpha: 0.9 });
  }

  function drawBagColumn(i: number) {
    const n = NAMES[i];
    const x = bagX(i);
    W(x, 26, 114, 158, "");
    R(x + 6, 31, 12, 12, PARTY[i].color);
    T(x + 22, 41, n, 8);
    const { filled, total } = capacityOf(i);
    T(x + 108, 41, `${filled}/${total}`, 8, C.sub, "end");

    const { gx, gy, cols, rows } = bagGrid(i);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) R(gx + c * CS, gy + r * CS, CS - 2, CS - 2, C.cell);
    }
    if (!rows) T(x + 57, gy + 40, "가방 없음", 8, C.sub, "middle");
    bags[i].forEach((item) => {
      const shape = applyRotFlip(pieceDef(item.pieceId).cells, item.rot, item.flip);
      const px = gx + item.origin[0] * CS;
      const py = gy + item.origin[1] * CS;
      piece(px, py, CS, shape, pieceColors(pieceDef(item.pieceId)));
      if (hover?.kind === "bag" && hover.bagIndex === i && hover.uid === item.uid) highlight(px, py, shape);
    });
  }

  function drawFloor() {
    R(0, 188, 480, 82, C.floorLoot);
    for (let i = 0; i < 24; i++) R((i * 53) % 470, 192 + ((i * 29) % 70), 3, 2, C.woodD);
    T(8, 200, "바닥 · 완료하면 남은 조각은 버려져요", 8, C.sub);
    floor.forEach((item) => {
      const shape = applyRotFlip(pieceDef(item.pieceId).cells, item.rot, item.flip);
      piece(item.x, item.y, CS, shape, pieceColors(pieceDef(item.pieceId)));
      if (hover?.kind === "floor" && hover.uid === item.uid) highlight(item.x, item.y, shape);
    });
  }

  function drawFloating() {
    const f = floating();
    if (!f) return;
    const shape = applyRotFlip(pieceDef(f.pieceId).cells, f.rot, f.flip);
    const anchor: Cell = [f.pointer.x - CS / 2, f.pointer.y - CS / 2];
    const bagIndex = bagAt(f.pointer);

    if (bagIndex >= 0) {
      const { gx, gy } = bagGrid(bagIndex);
      const origin: Cell = [Math.round((anchor[0] - gx) / CS), Math.round((anchor[1] - gy) / CS)];
      const valid = isValidPlacement(bagIndex, shape, origin);
      const px = gx + origin[0] * CS;
      const py = gy + origin[1] * CS;
      piece(px, py, CS, shape, pieceColors(pieceDef(f.pieceId)));
      silhouette(px, py, CS, silhouetteEdges(shape), valid ? "#ffffff" : C.hp, { width: 1, alpha: 0.9 });
    } else {
      piece(anchor[0], anchor[1], CS, shape, pieceColors(pieceDef(f.pieceId)));
    }
  }

  function drawHoverTooltip() {
    if (!hover || floating() || menu || askDiscard) return;
    const def = pieceDef(hover.pieceId);
    const hint = withFloor || arrange ? "클릭해서 배치" : "클릭: 메뉴 · 끌기: 이동";
    drawTooltip(hover.pointer.x, hover.pointer.y, pieceTooltip(def, gradeLabel(def.grade), hint));
  }

  function draw() {
    R(0, 0, 480, 270, C.screenBg);
    R(0, 0, 480, 22, C.woodD);
    T(8, 15, withFloor ? title : "인벤토리", 8, C.gold);
    if (withFloor) btn(392, 4, 80, "자동 배치");
    else {
      btn(BTN_ARRANGE.x, BTN_ARRANGE.y, BTN_ARRANGE.w, arrange ? "재배치 끝" : "재배치", arrange);
      if (backTo) btn(BTN_BACK.x, BTN_BACK.y, BTN_BACK.w, "◀ 탐색으로");
    }

    NAMES.forEach((_, i) => drawBagColumn(i));
    if (withFloor) drawFloor();
    if (withFloor) btn(400, 250, 72, "완료", 1);
    if (withFloor || arrange) drawControlsHint(HINT_RECT.x, HINT_RECT.y, "클릭: 집기·놓기 · 우클릭 취소 · 모양 그대로 넣는다");
    else drawControlsHint(HINT_RECT.x, HINT_RECT.y, "클릭: 사용·버리기 · 끌기: 이동 · 재배치: 여러 개 옮기기");

    drawFloating();
    drawHoverTooltip();
    drawMenu();
    if (message) T(withFloor ? 150 : 70, 15, message, 7, C.good);
    drawAsk();
  }

  return {
    id: withFloor ? "b03" : "d03",
    label: withFloor ? "B03 전리품 분배" : "D03 인벤토리",
    draw,
    onEnter,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onKeyDown,
    onWheel,
  };
}
