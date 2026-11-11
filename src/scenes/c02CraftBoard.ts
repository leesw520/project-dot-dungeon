// C02 조합 단계 — 2026-11-01 개편판. 좌(아이템 설명: 필요 재료 + 완성 시 효과) / 중앙(정사각형
// 도면, 상하좌우 중앙 정렬) / 우(투입 재료, 스크롤 + 맨 아래 "+ 재료 추가") 3단 구성으로 다시 짰다.
import { getActiveRecipe, setLastCraft, type OptionalNode, type Recipe } from "../data/recipes";
import { addItem, holderOf, ownedItems, removeItem, removeUid } from "../data/inventory";
import { PIECES, cellElement, pieceColors, type Cell, type PieceDef } from "../data/pieces";
import { applyRotFlip, silhouetteEdges } from "../engine/transform";
import { goTo } from "../engine/nav";
import { C, PIECE, R, T, W, btn, fitText, pen, piece, silhouette } from "../render/primitives";
import { drawControlsHint, drawTooltip, pieceTooltip } from "../ui/tooltip";
import type { LogicalPoint, Scene } from "./types";

// 좌/우 패널을 좁히고 글자를 줄인 만큼, 중앙 정사각형 도면 영역을 훨씬 크게 잡았다.
// 가장 큰 도면(검, 9줄)도 칸 크기 22(다른 화면과 동일)로 넉넉히 들어간다.
const SQUARE = { x: 130, y: 28, size: 220 };
const BOARD_CS = 22;

const LEFT = { x: 4, y: 20, w: 112, h: 236 };
const RIGHT = { x: 364, y: 20, w: 112, h: 236 };
// 제목 띠(y+14에서 끝남) 바로 아래 내용이 붙어 보이지 않도록 어두운 배경을 8px 띄운다.
const TRAY_TOP = RIGHT.y + 22;
const TRAY_BOTTOM = RIGHT.y + 190;
const TRAY_ROW_H = 16;
// '필요 재료'는 처음부터 4칸을 고정으로 그린다 — 레시피마다 칸 수가 달라도 레이아웃이 안 흔들리게.
const REQUIRED_SLOTS = 4;
// 재료 가져오기 창: 카테고리 칩 2줄(8개씩) + 목록 7줄. 목록이 넘치면 휠/▲▼로 스크롤.
const PICKER_ROWS = 7;
const PICKER_CHIPS_PER_ROW = 8;
/** 재료로 꺼낼 수 있는 종류 — 장비·코어·중요는 재료 목록에 안 나온다. */
const INGREDIENT_KINDS = new Set(["material", "compound", "consumable"]);

interface PlacedPiece {
  uid: number;
  itemId: string;
  origin: Cell;
  rot: 0 | 1 | 2 | 3;
  flip: boolean;
}
interface TrayItem {
  uid: number;
  itemId: string;
}
type Source = { kind: "board" } | { kind: "tray"; uid: number };
interface Floating {
  uid: number;
  itemId: string;
  rot: 0 | 1 | 2 | 3;
  flip: boolean;
  pointer: LogicalPoint;
  source: Source;
  revertOrigin?: Cell;
  revertRot?: 0 | 1 | 2 | 3;
  revertFlip?: boolean;
}

let uidSeq = 1;

/** 창고에서 꺼낼 줄: 보너스 없는 것은 아이템마다 한 줄(묶음), 보너스가 붙은 개체는 개체마다 한 줄 (2026-11-08 개체 고르기). */
interface PickRow {
  key: string;
  itemId: string;
  count: number;
  /** 보너스 개체 줄이면 그 보유 목록 uid와 보너스 */
  ownedUid?: string;
  bonuses?: string[];
}

export function createC02Scene(): Scene {
  let recipeId: string | null = null;
  let placed: PlacedPiece[] = [];
  let tray: TrayItem[] = [];
  let trayScroll = 0;
  let floating: Floating | null = null;
  let press: Floating | null = null;
  let pressStart: LogicalPoint | null = null;
  let pressMoved = false;
  let hover: { uid: number; itemId: string; pointer: LogicalPoint; source: Source } | null = null;
  let pickerOpen = false;
  let pickerScroll = 0;
  const pickerSelected = new Map<string, number>();
  /** 조각 uid → 그 개체의 제작 보너스 (보너스 개체를 꺼냈을 때). 트레이·판·집은 조각이 같은 uid를 쓴다. */
  const bonusOf = new Map<number, string[]>();
  const giveBack = (uid: number, itemId: string) => {
    addItem(itemId, 1, "warehouse", bonusOf.get(uid));
    bonusOf.delete(uid);
  };
  const pickerCategoryFilter = new Set<string>();
  let message = "";
  /** 도면이 영역(SQUARE)보다 클 때만 쓰는 화면 이동 (px). 탐색 화면처럼 WASD·방향키·가운데 버튼 끌기. */
  const pan = { x: 0, y: 0 };
  let panDrag: { x: number; y: number; px: number; py: number } | null = null;

  function def(id: string): PieceDef {
    return PIECES[id];
  }

  function returnAllToWarehouse() {
    tray.forEach((t) => giveBack(t.uid, t.itemId));
    placed.forEach((p) => giveBack(p.uid, p.itemId));
    tray = [];
    placed = [];
    if (floating) {
      giveBack(floating.uid, floating.itemId);
      floating = null;
    }
  }

  function syncRecipe() {
    const r = getActiveRecipe();
    if (!r || r.id === recipeId) return;
    returnAllToWarehouse();
    recipeId = r.id;
    pan.x = 0;
    pan.y = 0;
    pickerSelected.clear();
    trayScroll = 0;
    message = "";
  }

  function recipe(): Recipe | null {
    return getActiveRecipe();
  }

  // 도면을 정사각형 영역 한가운데(상하좌우 전부)에 오도록 칸 좌표를 픽셀로 바꿀 bx/by를 계산한다.
  function boardMetrics(r: Recipe) {
    const cols = r.boardCells.map((c) => c[0]);
    const rows = r.boardCells.map((c) => c[1]);
    const minC = Math.min(...cols);
    const maxC = Math.max(...cols);
    const minR = Math.min(...rows);
    const maxR = Math.max(...rows);
    const w = (maxC - minC + 1) * BOARD_CS;
    const h = (maxR - minR + 1) * BOARD_CS;
    const overX = w > SQUARE.size, overY = h > SQUARE.size;
    pan.x = overX ? Math.max(0, Math.min(w - SQUARE.size, pan.x)) : 0;
    pan.y = overY ? Math.max(0, Math.min(h - SQUARE.size, pan.y)) : 0;
    const bx = (overX ? SQUARE.x - pan.x : SQUARE.x + (SQUARE.size - w) / 2) - minC * BOARD_CS;
    const by = (overY ? SQUARE.y - pan.y : SQUARE.y + (SQUARE.size - h) / 2) - minR * BOARD_CS;
    return { cs: BOARD_CS, bx, by, over: overX || overY, w, h };
  }

  function boardOccupied(excludeUid?: number): Set<string> {
    const set = new Set<string>();
    placed.forEach((p) => {
      if (p.uid === excludeUid) return;
      applyRotFlip(def(p.itemId).cells, p.rot, p.flip).forEach(([c, r]) => set.add(`${p.origin[0] + c},${p.origin[1] + r}`));
    });
    return set;
  }

  function isValidPlacement(shape: Cell[], origin: Cell, excludeUid?: number): boolean {
    const r = recipe();
    if (!r) return false;
    const boardSet = new Set(r.boardCells.map(([c, rr]) => `${c},${rr}`));
    const occupied = boardOccupied(excludeUid);
    return shape.every(([dc, dr]) => {
      const c = origin[0] + dc;
      const rr = origin[1] + dr;
      const key = `${c},${rr}`;
      return boardSet.has(key) && !occupied.has(key);
    });
  }

  function requiredProgress() {
    const r = recipe();
    if (!r) return [];
    return r.required.map((slot) => ({
      slot,
      have: placed.filter((p) => slot.match(p.itemId)).length,
    }));
  }

  /** 판 위 칸 → (그 칸을 덮은 조각의) 속성. 칸별 속성이 없는 조각은 첫 속성. */
  function cellElementMap(): Map<string, string> {
    const m = new Map<string, string>();
    placed.forEach((p) => {
      const d = def(p.itemId);
      applyRotFlip(d.cells, p.rot, p.flip).forEach(([c, rr], i) => m.set(`${p.origin[0] + c},${p.origin[1] + rr}`, cellElement(d, i)));
    });
    return m;
  }

  /** 단계 보너스의 잰 값 (속성 칸 수 · 소재 등급 · 조각 수). */
  function measure(node: OptionalNode): number {
    const sp = node.spec;
    if (!sp) return 0;
    if (sp.type === "elCount") return [...cellElementMap().values()].filter((e) => e === sp.el).length;
    if (sp.type === "matGrade") {
      const rank: Record<string, number> = { common: 1, rare: 2, epic: 3, legend: 4 };
      return placed.reduce((m, p) => {
        const d = def(p.itemId);
        const ok = sp.cat ? d.categories.includes(sp.cat as never) : sp.el ? d.elements.includes(sp.el as never) : false;
        return ok ? Math.max(m, rank[d.grade] ?? 0) : m;
      }, 0);
    }
    if (sp.type === "fewPieces") return placed.length;
    return 0;
  }
  /** 단계 보너스에서 달성한 단계 (없으면 −1). 조각 수는 판을 다 채운 뒤 적을수록. */
  function tierOf(node: OptionalNode): number {
    if (!node.tiers || node.lockedFn?.() || !placed.length) return -1;
    const v = measure(node);
    let t = -1;
    node.tiers.forEach((st, i) => {
      if (node.spec?.type === "fewPieces" ? boardFull() && v <= st.at : v >= st.at) t = i;
    });
    return t;
  }
  /** 달성했을 때 붙는 효과 문구 (단계 보너스는 달성한 단계 것) */
  function bonusText(node: OptionalNode): string {
    return node.tiers ? node.tiers[Math.max(0, tierOf(node))].bonus : node.bonus;
  }

  function optionalMet(node: OptionalNode): boolean {
    if (node.lockedFn?.()) return false;
    if (node.tiers) return tierOf(node) >= 0;
    if (node.spec) {
      const sp = node.spec;
      if (!placed.length) return false;
      if (sp.type === "elCount" || sp.type === "matGrade" || sp.type === "fewPieces") return false;
      if (sp.type === "useItem") return placed.some((p) => p.itemId === sp.item);
      if (sp.type === "maxPieces") return boardFull() && placed.length <= sp.n;
      if (sp.type === "category") return placed.every((p) => def(p.itemId).categories.includes(sp.cat as never));
      const els = cellElementMap();
      if (sp.type === "noElement") return boardFull() && ![...els.values()].includes(sp.el);
      return sp.cells.every(([c, rr, e]) => els.has(`${c},${rr}`) && (e === "any" || els.get(`${c},${rr}`) === e));
    }
    const cell = node.cell;
    if (!cell) return false;
    const occ = placed.find((p) => applyRotFlip(def(p.itemId).cells, p.rot, p.flip).some(([c, rr]) => p.origin[0] + c === cell[0] && p.origin[1] + rr === cell[1]));
    return node.kind === "link" ? !!occ : !!occ && def(occ.itemId).color === node.color;
  }

  function boardFull(): boolean {
    const r = recipe();
    if (!r) return false;
    const filled = placed.reduce((sum, p) => sum + def(p.itemId).cells.length, 0);
    return filled >= r.boardCells.length;
  }

  function canCraft(): boolean {
    return boardFull() && requiredProgress().every((rp) => rp.have >= rp.slot.count);
  }

  /** 제작 버튼이 꺼져 있는 이유 (켜져 있으면 null). */
  function craftBlockReason(): string | null {
    const r = recipe();
    if (!r) return "도면 없음";
    const filled = placed.reduce((sum, p) => sum + def(p.itemId).cells.length, 0);
    if (filled < r.boardCells.length) return `빈 칸 ${r.boardCells.length - filled}개 남음`;
    const miss = requiredProgress().find((rp) => rp.have < rp.slot.count);
    return miss ? `필수 부족: ${miss.slot.desc}` : null;
  }

  function craft() {
    const r = recipe();
    if (!r) return;
    const reason = craftBlockReason();
    if (reason) {
      message = reason;
      return;
    }
    // 완성품은 보유 목록(창고)으로. 재료는 C02 트레이로 꺼낼 때 이미 보유 목록에서 빠졌다.
    // 장착은 여기서 하지 않는다 — P02/P03이 같은 보유 목록을 보고 고른다.
    const got = r.optional.filter(optionalMet).map(bonusText);
    // 재료 개체의 "재료로 쓰면 완성 개수 +1" 보너스: 넣은 개체마다 완성품 +1 (docs/crafting.md 4장)
    const extra = placed.reduce((n, p) => n + (bonusOf.get(p.uid) ?? []).reduce((m, b) => m + (/완성 개수 \+(\d+)/.exec(b) ? Number(/완성 개수 \+(\d+)/.exec(b)![1]) : 0), 0), 0);
    const made = addItem(r.resultItemId, 1 + extra, "warehouse", got)[0];
    placed.forEach((p) => bonusOf.delete(p.uid));
    if (extra) message = `재료 보너스로 ${1 + extra}개 완성`;
    setLastCraft({
      recipeId: r.id,
      resultUid: made?.uid,
      cells: placed.flatMap((p) => {
        const cols = pieceColors(def(p.itemId));
        return applyRotFlip(def(p.itemId).cells, p.rot, p.flip).map(([c, rr], i) => ({ cell: [p.origin[0] + c, p.origin[1] + rr] as Cell, color: typeof cols === "string" ? cols : cols[i] }));
      }),
      bonuses: got,
    });
    // 배치한 재료는 소모. 트레이에 남은(안 쓴) 재료는 창고로 돌려보내 C01 보유 수가 맞게 한다.
    placed = [];
    tray.forEach((t) => giveBack(t.uid, t.itemId));
    tray = [];
    pickerSelected.clear();
    message = "";
    goTo("c03");
  }

  function resetPlacement() {
    placed.forEach((p) => tray.push({ uid: p.uid, itemId: p.itemId }));
    placed = [];
  }

  // ---- 입력 ----
  function hitRect(p: LogicalPoint, x: number, y: number, w: number, h: number) {
    return p.x >= x && p.x < x + w && p.y >= y && p.y < y + h;
  }

  function trayVisibleRows() {
    return Math.floor((TRAY_BOTTOM - TRAY_TOP) / TRAY_ROW_H);
  }
  function trayTotalRows() {
    return tray.length + 1; // 마지막 한 칸은 "+ 재료 추가"
  }
  function clampTrayScroll() {
    trayScroll = Math.max(0, Math.min(trayScroll, Math.max(0, trayTotalRows() - trayVisibleRows())));
  }
  function trayRowRect(slot: number) {
    return { x: RIGHT.x + 4, y: TRAY_TOP + slot * TRAY_ROW_H, w: RIGHT.w - 8 - 16, h: TRAY_ROW_H - 2 };
  }
  function trayScrollUpRect() {
    return { x: RIGHT.x + RIGHT.w - 14, y: TRAY_TOP, w: 14, h: 14 };
  }
  function trayScrollDownRect() {
    return { x: RIGHT.x + RIGHT.w - 14, y: TRAY_BOTTOM - 14, w: 14, h: 14 };
  }
  function resetButtonRect() {
    return { x: RIGHT.x + 2, y: TRAY_BOTTOM + 8, w: 52, h: 16 };
  }
  function craftButtonRect() {
    return { x: RIGHT.x + 58, y: TRAY_BOTTOM + 8, w: 52, h: 16 };
  }
  function backButtonRect() {
    return { x: 400, y: 2, w: 74, h: 14 };
  }

  function hitBoardPiece(p: LogicalPoint): PlacedPiece | null {
    const r = recipe();
    if (!r) return null;
    const { cs, bx, by } = boardMetrics(r);
    for (let i = placed.length - 1; i >= 0; i--) {
      const piecee = placed[i];
      const shape = applyRotFlip(def(piecee.itemId).cells, piecee.rot, piecee.flip);
      const hit = shape.some(([c, rr]) => p.x >= bx + (piecee.origin[0] + c) * cs && p.x < bx + (piecee.origin[0] + c + 1) * cs - 2 && p.y >= by + (piecee.origin[1] + rr) * cs && p.y < by + (piecee.origin[1] + rr + 1) * cs - 2);
      if (hit) return piecee;
    }
    return null;
  }

  function boardCellFromPointer(p: LogicalPoint): Cell {
    const r = recipe();
    if (!r) return [0, 0];
    const { cs, bx, by } = boardMetrics(r);
    return [Math.round((p.x - cs / 2 - bx) / cs), Math.round((p.y - cs / 2 - by) / cs)];
  }

  function pickUpBoard(piecee: PlacedPiece, p: LogicalPoint): Floating {
    placed = placed.filter((x) => x.uid !== piecee.uid);
    return { uid: piecee.uid, itemId: piecee.itemId, rot: piecee.rot, flip: piecee.flip, pointer: p, source: { kind: "board" }, revertOrigin: piecee.origin, revertRot: piecee.rot, revertFlip: piecee.flip };
  }
  function pickUpTray(idx: number, p: LogicalPoint): Floating {
    const item = tray[idx];
    tray = tray.filter((_, i) => i !== idx);
    return { uid: item.uid, itemId: item.itemId, rot: 0, flip: false, pointer: p, source: { kind: "tray", uid: item.uid } };
  }

  function revert(f: Floating) {
    if (f.source.kind === "board" && f.revertOrigin && f.revertRot !== undefined && f.revertFlip !== undefined) {
      placed.push({ uid: f.uid, itemId: f.itemId, origin: f.revertOrigin, rot: f.revertRot, flip: f.revertFlip });
    } else {
      tray.push({ uid: f.uid, itemId: f.itemId });
    }
  }

  function tryCommit(f: Floating, p: LogicalPoint, isDrag: boolean): boolean {
    const shape = applyRotFlip(def(f.itemId).cells, f.rot, f.flip);
    const origin = boardCellFromPointer(p);
    if (isValidPlacement(shape, origin, f.source.kind === "board" ? f.uid : undefined)) {
      placed.push({ uid: f.uid, itemId: f.itemId, origin, rot: f.rot, flip: f.flip });
      message = "";
      return true;
    }
    if (hitRect(p, RIGHT.x, RIGHT.y, RIGHT.w, RIGHT.h)) {
      tray.push({ uid: f.uid, itemId: f.itemId });
      return true;
    }
    if (isDrag) {
      revert(f);
      return true;
    }
    return false;
  }

  function onPointerDown(p: LogicalPoint, button: number) {
    syncRecipe();
    if (button === 1) {
      panDrag = { x: p.x, y: p.y, px: pan.x, py: pan.y };
      return;
    }
    if (pickerOpen) {
      handlePickerClick(p, button);
      return;
    }
    if (button === 2) {
      if (floating) {
        revert(floating);
        floating = null;
      }
      return;
    }
    if (button !== 0) return;

    const back = backButtonRect();
    if (hitRect(p, back.x, back.y, back.w, back.h)) {
      returnAllToWarehouse();
      goTo("c01");
      return;
    }
    const rr = resetButtonRect();
    if (hitRect(p, rr.x, rr.y, rr.w, rr.h)) {
      resetPlacement();
      return;
    }
    const cr = craftButtonRect();
    if (hitRect(p, cr.x, cr.y, cr.w, cr.h)) {
      // 판 위 조각을 클릭하면 "들린" 상태가 되는데, 제자리에 그대로 그려져서 놓인 것처럼 보인다.
      // 그 상태로 제작을 누르면 칸이 빈 것으로 계산돼 안 넘어갔다 — 들고 있던 조각은 원래 자리로 돌려놓고 판정한다.
      if (floating) {
        revert(floating);
        floating = null;
      }
      craft();
      return;
    }
    const sUp = trayScrollUpRect();
    if (hitRect(p, sUp.x, sUp.y, sUp.w, sUp.h)) {
      trayScroll -= 1;
      clampTrayScroll();
      return;
    }
    const sDown = trayScrollDownRect();
    if (hitRect(p, sDown.x, sDown.y, sDown.w, sDown.h)) {
      trayScroll += 1;
      clampTrayScroll();
      return;
    }

    if (floating) {
      if (tryCommit(floating, p, false)) floating = null;
      return;
    }

    const boardHit = hitBoardPiece(p);
    if (boardHit) {
      press = pickUpBoard(boardHit, p);
      pressStart = p;
      pressMoved = false;
      return;
    }

    // 투입 재료 목록(스크롤 포함) + 맨 아래 "+ 재료 추가"
    const visible = trayVisibleRows();
    for (let i = 0; i < visible; i++) {
      const slotIdx = i + trayScroll;
      if (slotIdx >= trayTotalRows()) break;
      const r = trayRowRect(i);
      if (!hitRect(p, r.x, r.y, r.w, r.h)) continue;
      if (slotIdx === tray.length) {
        pickerOpen = true;
        pickerScroll = 0;
        return;
      }
      press = pickUpTray(slotIdx, p);
      pressStart = p;
      pressMoved = false;
      return;
    }
  }

  function onPointerMove(p: LogicalPoint) {
    hover = null;
    if (panDrag) {
      pan.x = panDrag.px - (p.x - panDrag.x);
      pan.y = panDrag.py - (p.y - panDrag.y);
      return;
    }
    if (press) {
      if (!pressMoved && pressStart && Math.hypot(p.x - pressStart.x, p.y - pressStart.y) > 4) pressMoved = true;
      press.pointer = p;
      return;
    }
    if (floating) {
      floating.pointer = p;
      return;
    }
    const boardHit = hitBoardPiece(p);
    if (boardHit) {
      hover = { uid: boardHit.uid, itemId: boardHit.itemId, pointer: p, source: { kind: "board" } };
      return;
    }
    const visible = trayVisibleRows();
    for (let i = 0; i < visible; i++) {
      const slotIdx = i + trayScroll;
      if (slotIdx >= tray.length) break;
      const r = trayRowRect(i);
      if (hitRect(p, r.x, r.y, r.w, r.h)) {
        hover = { uid: tray[slotIdx].uid, itemId: tray[slotIdx].itemId, pointer: p, source: { kind: "tray", uid: tray[slotIdx].uid } };
        return;
      }
    }
  }

  function onPointerUp(p: LogicalPoint, button: number) {
    if (button === 1) {
      panDrag = null;
      return;
    }
    if (button !== 0 || !press) return;
    if (pressMoved) {
      if (!tryCommit(press, p, true)) revert(press);
      press = null;
    } else {
      floating = press;
      floating.pointer = p;
      press = null;
    }
    pressStart = null;
    pressMoved = false;
  }

  function onWheel(deltaY: number) {
    if (pickerOpen) {
      scrollPicker(deltaY > 0 ? 1 : -1);
      return;
    }
    const f = press ?? floating;
    if (f) {
      const dir: 1 | 3 = deltaY > 0 ? 1 : 3;
      f.rot = ((f.rot + dir) % 4) as 0 | 1 | 2 | 3;
      return;
    }
    trayScroll += deltaY > 0 ? 1 : -1;
    clampTrayScroll();
  }
  const PAN_STEP: Record<string, [number, number]> = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0], W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0],
    "ㅈ": [0, -1], "ㄴ": [0, 1], "ㅁ": [-1, 0], "ㅇ": [1, 0],
  };
  function onKeyDown(key: string) {
    const step = PAN_STEP[key];
    if (step && !pickerOpen) {
      pan.x += step[0] * BOARD_CS * 2;
      pan.y += step[1] * BOARD_CS * 2;
      return;
    }
    if (key.toLowerCase() === "f") {
      const f = press ?? floating;
      if (f) f.flip = !f.flip;
    }
    if (key === "Escape" && pickerOpen) pickerOpen = false;
  }

  // ---- picker 팝업 (창고에서 재료 가져오기 — 기존과 동일) ----
  function pickerRows(): PickRow[] {
    let rows = ingredientStock();
    if (pickerCategoryFilter.size) rows = rows.filter((s) => PIECES[s.itemId].categories.some((c) => pickerCategoryFilter.has(c)));
    // 이 도면의 필수 재료에 맞는 것을 위로.
    const req = recipe()?.required ?? [];
    const fits = (id: string) => (req.some((slot) => slot.match(id)) ? 0 : 1);
    return rows.sort((a, b) => fits(a.itemId) - fits(b.itemId));
  }
  function ingredientStock(): PickRow[] {
    const plain = new Map<string, PickRow>();
    const indiv: PickRow[] = [];
    for (const o of ownedItems()) {
      const d = PIECES[o.itemId];
      if (!d || !INGREDIENT_KINDS.has(d.kind) || holderOf(o.uid) || o.count <= 0) continue;
      if (o.bonuses?.length) indiv.push({ key: `u:${o.uid}`, itemId: o.itemId, count: 1, ownedUid: o.uid, bonuses: o.bonuses });
      else {
        const cur = plain.get(o.itemId) ?? { key: o.itemId, itemId: o.itemId, count: 0 };
        cur.count += o.count;
        plain.set(o.itemId, cur);
      }
    }
    return [...plain.values(), ...indiv];
  }
  function pickerCategories() {
    return [...new Set(ingredientStock().flatMap((s) => PIECES[s.itemId].categories))].slice(0, PICKER_CHIPS_PER_ROW * 2);
  }
  /** 화면에 보이는 i번째 줄 (스크롤 반영 전 위치). */
  function pickerRowRect(i: number) {
    return { x: 52, y: 76 + i * 20, w: 360, h: 18 };
  }
  function pickerChipRect(i: number) {
    return { x: 52 + (i % PICKER_CHIPS_PER_ROW) * 47, y: 40 + Math.floor(i / PICKER_CHIPS_PER_ROW) * 16, w: 44, h: 14 };
  }
  const PICKER_UP = { x: 418, y: 76, w: 14, h: 14 };
  const PICKER_DOWN = { x: 418, y: 76 + PICKER_ROWS * 20 - 16, w: 14, h: 14 };
  function scrollPicker(d: number) {
    pickerScroll = Math.max(0, Math.min(Math.max(0, pickerRows().length - PICKER_ROWS), pickerScroll + d));
  }
  function handlePickerClick(p: LogicalPoint, button: number) {
    if (hitRect(p, 380, 240, 50, 16)) {
      pickerOpen = false;
      pickerSelected.clear();
      return;
    }
    if (hitRect(p, 300, 240, 70, 16)) {
      const all = ingredientStock();
      pickerSelected.forEach((n, key) => {
        const row = all.find((r) => r.key === key);
        if (!row || n <= 0) return;
        if (row.ownedUid) {
          // 보너스 개체: 그 줄을 빼고, 조각에 보너스를 기억해 둔다 (완성품에 이어지는 효과용)
          if (!removeUid(row.ownedUid)) return;
          const uid = uidSeq++;
          bonusOf.set(uid, [...(row.bonuses ?? [])]);
          tray.push({ uid, itemId: row.itemId });
          return;
        }
        const got = removeItem(row.itemId, n);
        for (let i = 0; i < got; i++) tray.push({ uid: uidSeq++, itemId: row.itemId });
      });
      pickerSelected.clear();
      pickerOpen = false;
      return;
    }
    pickerCategories().forEach((cat, i) => {
      const r = pickerChipRect(i);
      if (hitRect(p, r.x, r.y, r.w, r.h)) {
        if (pickerCategoryFilter.has(cat)) pickerCategoryFilter.delete(cat);
        else pickerCategoryFilter.add(cat);
        pickerScroll = 0;
      }
    });
    if (hitRect(p, PICKER_UP.x, PICKER_UP.y, PICKER_UP.w, PICKER_UP.h)) return scrollPicker(-1);
    if (hitRect(p, PICKER_DOWN.x, PICKER_DOWN.y, PICKER_DOWN.w, PICKER_DOWN.h)) return scrollPicker(1);
    const rows = pickerRows().slice(pickerScroll, pickerScroll + PICKER_ROWS);
    rows.forEach((row, i) => {
      const r = pickerRowRect(i);
      if (!hitRect(p, r.x, r.y, r.w, r.h)) return;
      const cur = pickerSelected.get(row.key) ?? 0;
      if (button === 2) {
        if (cur > 0) pickerSelected.set(row.key, cur - 1);
      } else {
        if (cur < row.count) pickerSelected.set(row.key, cur + 1);
      }
    });
  }

  // ---- 그리기 ----
  function drawBoard(r: Recipe) {
    const { cs, bx, by, over, w, h } = boardMetrics(r);
    const g = pen();
    if (over) {
      g.save();
      g.beginPath();
      g.rect(SQUARE.x, SQUARE.y, SQUARE.size, SQUARE.size);
      g.clip();
    }
    r.boardCells.forEach(([c, rr]) => R(bx + c * cs, by + rr * cs, cs - 2, cs - 2, C.cell));
    r.optional.forEach((node) => {
      // 보너스 칸: 속성 색 테두리 (그 칸을 이 속성 도트로 채우면 보너스)
      if (node.spec?.type === "cells") {
        node.spec.cells.forEach(([c, rr, e]) => {
          const col = e === "any" ? C.node : PIECE[e as keyof typeof PIECE] ?? C.node;
          R(bx + c * cs + 2, by + rr * cs + 2, cs - 6, cs - 6, "none", `stroke='${col}' stroke-width='2'`);
        });
        return;
      }
      if (!node.cell) return;
      const col = node.kind === "color" ? C.hp : C.node;
      R(bx + node.cell[0] * cs + 2, by + node.cell[1] * cs + 2, cs - 6, cs - 6, "none", `stroke='${col}' stroke-width='2'`);
    });
    placed.forEach((p) => {
      const shape = applyRotFlip(def(p.itemId).cells, p.rot, p.flip);
      const px = bx + p.origin[0] * cs;
      const py = by + p.origin[1] * cs;
      piece(px, py, cs, shape, pieceColors(def(p.itemId)));
      if (hover?.uid === p.uid) silhouette(px, py, cs, silhouetteEdges(shape), C.gold, { width: 1, alpha: 0.9 });
    });
    if (over) {
      g.restore();
      // 보이는 범위 막대 (오른쪽·아래 2px) + 안내
      if (h > SQUARE.size) {
        const bh = Math.max(12, Math.round((SQUARE.size * SQUARE.size) / h));
        R(SQUARE.x + SQUARE.size + 2, SQUARE.y, 2, SQUARE.size, C.listRow);
        R(SQUARE.x + SQUARE.size + 2, SQUARE.y + Math.round(((SQUARE.size - bh) * pan.y) / (h - SQUARE.size)), 2, bh, C.woodL);
      }
      if (w > SQUARE.size) {
        const bw = Math.max(12, Math.round((SQUARE.size * SQUARE.size) / w));
        R(SQUARE.x, SQUARE.y + SQUARE.size + 2, SQUARE.size, 2, C.listRow);
        R(SQUARE.x + Math.round(((SQUARE.size - bw) * pan.x) / (w - SQUARE.size)), SQUARE.y + SQUARE.size + 2, bw, 2, C.woodL);
      }
      T(SQUARE.x + SQUARE.size / 2, SQUARE.y - 3, "도면이 커서 일부만 보인다 · WASD/방향키 또는 가운데 버튼 끌기로 이동", 6, C.gold, "middle");
    }

    const filled = placed.reduce((sum, p) => sum + def(p.itemId).cells.length, 0);
    T(SQUARE.x + SQUARE.size / 2, SQUARE.y + SQUARE.size + 13, `${r.name} · 채움 ${filled}/${r.boardCells.length}`, 6, C.sub, "middle");
  }

  // 필요 재료는 항상 REQUIRED_SLOTS(4)칸을 그린다. 레시피에 n번째 재료가 없으면 빈 칸(placeholder).
  function drawLeftPanel(r: Recipe) {
    W(LEFT.x, LEFT.y, LEFT.w, LEFT.h, "아이템 설명", 1);
    const x = LEFT.x + 5;
    const w = LEFT.w - 10;
    let y = LEFT.y + 22;

    T(x, y, "필요 재료", 7, C.gold);
    y += 10;
    const progress = requiredProgress();
    for (let i = 0; i < REQUIRED_SLOTS; i++) {
      const rp = progress[i];
      if (rp) {
        const ok = rp.have >= rp.slot.count;
        R(x, y, w, 13, C.panelIn, `stroke='${ok ? C.good : C.hp}' stroke-width='1'`);
        T(x + 3, y + 9, rp.slot.desc, 6, ok ? C.txt : C.hp);
        T(x + w - 3, y + 9, `${rp.have}/${rp.slot.count}`, 6, ok ? C.good : C.hp, "end");
      } else {
        R(x, y, w, 13, C.panelIn, `stroke='${C.woodD}' stroke-width='1'`);
        T(x + w / 2, y + 9, "-", 6, C.cellExt, "middle");
      }
      y += 15;
    }
    y += 3;
    R(x, y, w, 1, C.woodD);
    y += 7;

    T(x, y, "완성 시 효과", 7, C.gold);
    y += 10;
    if (!r.optional.length) {
      T(x, y, "없음", 6, C.sub);
    } else {
      r.optional.forEach((node) => {
        const met = optionalMet(node);
        const lock = node.lockedFn?.();
        if (lock) {
          // 잠긴 변형: 회색, 해금 레벨 안내
          R(x, y, w, 22, C.cellLocked, `stroke='${C.woodD}' stroke-width='1'`);
          T(x + 3, y + 8, fitText(`[잠김] ${node.bonus}`, w - 6, 6), 6, C.sub);
          T(x + 3, y + 17, fitText(lock, w - 6, 6), 6, C.cellExt);
          y += 24;
          return;
        }
        if (node.tiers) {
          // 단계 보너스: 조건(지금 값) + 단계별 효과 (달성한 단계는 초록)
          const t = tierOf(node);
          R(x, y, w, 22, C.panelIn, `stroke='${met ? C.gold : C.woodD}' stroke-width='1'`);
          T(x + 3, y + 8, fitText(`${node.desc} · 지금 ${measure(node)}`, w - 6, 6), 6, met ? C.txt : C.sub);
          let tx = x + 3;
          node.tiers.forEach((st, i) => {
            const label = i === 0 ? st.bonus : st.bonus.replace(/^.*?([+−-]\d+%?)$/, "$1");
            T(tx, y + 17, label, 6, i === t ? C.good : i < t ? C.sub : C.cellExt);
            tx += Math.min(w / 3, label.length * 6 + 6);
          });
          y += 24;
          return;
        }
        if (node.spec) {
          // 새 제작 보너스: 조건 + 효과 두 줄 (달성하면 금색 테두리 + 초록 효과)
          R(x, y, w, 22, C.panelIn, `stroke='${met ? C.gold : C.woodD}' stroke-width='1'`);
          T(x + 3, y + 8, fitText(`${node.level ?? ""} ${node.desc}`, w - 6, 6), 6, met ? C.txt : C.sub);
          T(x + 3, y + 17, fitText(node.bonus, w - 6, 6), 6, met ? C.good : C.cellExt);
          y += 24;
          return;
        }
        R(x, y, w, 13, C.panelIn, `stroke='${met ? C.gold : C.woodD}' stroke-width='1'`);
        if (met) T(x + 3, y + 9, node.bonus, 6, C.good);
        else T(x + 3, y + 9, `? ${node.desc}`, 6, C.cellExt);
        y += 15;
      });
    }
  }

  function drawRightPanel() {
    W(RIGHT.x, RIGHT.y, RIGHT.w, RIGHT.h, "투입 재료", 1);
    const visible = trayVisibleRows();
    clampTrayScroll();
    for (let i = 0; i < visible; i++) {
      const slotIdx = i + trayScroll;
      if (slotIdx >= trayTotalRows()) break;
      const row = trayRowRect(i);
      if (slotIdx === tray.length) {
        btn(row.x, row.y, row.w, "+ 재료 추가", true);
        continue;
      }
      const t = tray[slotIdx];
      R(row.x, row.y, row.w, row.h, C.listRow);
      piece(row.x + 2, row.y + 1, 6, def(t.itemId).cells, pieceColors(def(t.itemId)));
      T(row.x + 11, row.y + 10, def(t.itemId).name, 6, C.txt);
      if (hover?.source.kind === "tray" && hover.uid === t.uid) R(row.x, row.y, row.w, row.h, "none", `stroke='${C.gold}' stroke-width='1'`);
    }
    if (trayTotalRows() > visible) {
      const sUp = trayScrollUpRect();
      const sDown = trayScrollDownRect();
      R(sUp.x, sUp.y, sUp.w, sUp.h, trayScroll > 0 ? C.listRow : C.cellLocked);
      T(sUp.x + 7, sUp.y + 10, "▲", 7, trayScroll > 0 ? C.txt : C.cellExt, "middle");
      R(sDown.x, sDown.y, sDown.w, sDown.h, trayScroll < trayTotalRows() - visible ? C.listRow : C.cellLocked);
      T(sDown.x + 7, sDown.y + 10, "▼", 7, trayScroll < trayTotalRows() - visible ? C.txt : C.cellExt, "middle");
    }

    btn(resetButtonRect().x, resetButtonRect().y, resetButtonRect().w, "배치 초기화");
    btn(craftButtonRect().x, craftButtonRect().y, craftButtonRect().w, "제작", canCraft());
    if (message) T(RIGHT.x + RIGHT.w / 2, RIGHT.y + RIGHT.h - 6, message, 6, C.hp, "middle");
  }

  function drawFloating(r: Recipe) {
    const f = press ?? floating;
    if (!f) return;
    const { cs, bx, by } = boardMetrics(r);
    const shape = applyRotFlip(def(f.itemId).cells, f.rot, f.flip);
    const origin = boardCellFromPointer(f.pointer);
    const onBoard = hitRect(f.pointer, SQUARE.x - 10, SQUARE.y - 10, SQUARE.size + 20, SQUARE.size + 20);
    if (onBoard) {
      const valid = isValidPlacement(shape, origin, f.source.kind === "board" ? f.uid : undefined);
      const px = bx + origin[0] * cs;
      const py = by + origin[1] * cs;
      piece(px, py, cs, shape, pieceColors(def(f.itemId)));
      silhouette(px, py, cs, silhouetteEdges(shape), valid ? "#ffffff" : C.hp, { width: 1, alpha: 0.9 });
    } else {
      piece(f.pointer.x - cs / 2, f.pointer.y - cs / 2, cs, shape, pieceColors(def(f.itemId)));
    }
  }

  function drawHoverTooltip() {
    if (!hover || press || floating) return;
    const d = def(hover.itemId);
    drawTooltip(hover.pointer.x, hover.pointer.y, pieceTooltip(d, "", "클릭해서 이동"));
  }

  function drawPicker() {
    R(0, 0, 480, 270, C.screenBg, "opacity='.9'");
    W(40, 20, 400, 240, "창고에서 재료 가져오기", 1);
    pickerCategories().forEach((cat, i) => {
      const r = pickerChipRect(i);
      const on = pickerCategoryFilter.has(cat);
      R(r.x, r.y, r.w, r.h, on ? C.gold : C.listRow);
      T(r.x + r.w / 2, r.y + 10, cat, 7, on ? C.woodD : C.sub, "middle");
    });
    const all = pickerRows();
    const req = recipe()?.required ?? [];
    all.slice(pickerScroll, pickerScroll + PICKER_ROWS).forEach((row, i) => {
      const r = pickerRowRect(i);
      const d = def(row.itemId);
      R(r.x, r.y, r.w, r.h, C.listRow);
      piece(r.x + 4, r.y + 2, 7, d.cells, pieceColors(d));
      T(r.x + 30, r.y + 13, row.bonuses ? `${d.name} ★${row.bonuses.length}` : d.name, 8, row.bonuses ? C.gold : C.txt);
      if (row.bonuses) T(r.x + 150, r.y + 13, fitText(row.bonuses.join(" · "), 110, 6), 6, C.good);
      const sel = pickerSelected.get(row.key) ?? 0;
      T(r.x + r.w - 90, r.y + 13, `보유 ${row.count}`, 7, C.sub, "end");
      T(r.x + r.w - 10, r.y + 13, `선택 ${sel}`, 8, sel ? C.gold : C.sub, "end");
      if (req.some((slot) => slot.match(row.itemId))) T(r.x + r.w - 140, r.y + 13, "필수", 7, C.good, "end");
    });
    if (!all.length) T(60, 96, "꺼낼 수 있는 재료가 없어요", 8, C.sub);
    if (all.length > PICKER_ROWS) {
      const canUp = pickerScroll > 0;
      const canDown = pickerScroll < all.length - PICKER_ROWS;
      R(PICKER_UP.x, PICKER_UP.y, PICKER_UP.w, PICKER_UP.h, canUp ? C.listRow : C.cellLocked);
      T(PICKER_UP.x + 7, PICKER_UP.y + 10, "▲", 7, canUp ? C.txt : C.cellExt, "middle");
      R(PICKER_DOWN.x, PICKER_DOWN.y, PICKER_DOWN.w, PICKER_DOWN.h, canDown ? C.listRow : C.cellLocked);
      T(PICKER_DOWN.x + 7, PICKER_DOWN.y + 10, "▼", 7, canDown ? C.txt : C.cellExt, "middle");
      T(PICKER_UP.x + 7, PICKER_UP.y + 34, `${pickerScroll + 1}-`, 6, C.sub, "middle");
      T(PICKER_UP.x + 7, PICKER_UP.y + 44, `${Math.min(all.length, pickerScroll + PICKER_ROWS)}`, 6, C.sub, "middle");
      T(PICKER_UP.x + 7, PICKER_UP.y + 54, `/${all.length}`, 6, C.sub, "middle");
    }
    T(60, 254, "클릭: 선택 +1 · 우클릭: 선택 -1", 7, C.sub);
    btn(300, 240, 70, "확인", true);
    btn(380, 240, 50, "닫기");
  }

  function draw() {
    syncRecipe();
    R(0, 0, 480, 270, C.screenBg);
    const r = recipe();
    const back = backButtonRect();
    R(back.x, back.y, back.w, back.h, C.woodL);
    T(back.x + back.w / 2, back.y + 10, "◀ 목록으로", 7, C.woodD, "middle");
    if (!r) {
      T(20, 30, "제작 목록에서 먼저 아이템을 골라주세요", 8, C.sub);
      return;
    }
    drawLeftPanel(r);
    drawBoard(r);
    drawRightPanel();
    // 왼쪽 패널(4,20,112,236) 아래 258~268 띠는 조작 안내 자리로 비워둔다.
    drawControlsHint(LEFT.x, LEFT.y + LEFT.h + 2);
    drawFloating(r);
    drawHoverTooltip();

    if (pickerOpen) drawPicker();
  }

  return {
    id: "c02",
    label: "C02 제작 배치",
    draw,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onWheel,
    onKeyDown,
  };
}
