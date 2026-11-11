// P03 스킬 코어 — 2026-10-31 2차 개편. 세 가지 상태를 같은 레이아웃 위에서 오간다.
//   보기: 판 + 적용 중 효과. 판 위 코어에 마우스를 올리면 툴팁.
//   수정: 오른쪽 위에 "사용 가능한 코어" 트레이, 판에 코어를 놓고 옮긴다 (해금된 칸만).
//   판 확장: 레벨업으로 쌓인 스택만큼 열린 칸에 붙은 잠긴 칸을 연다. 연 칸 옆으로 바로 이어서 열 수
//            있고, 완료 확인창에서 확정하기 전까지는 되돌릴 수 있다. 확정하면 캐릭터 데이터에 반영.
// 코어는 캐릭터 전용 태그를 가져서 한 번에 한 캐릭터만 쓸 수 있다 — 다른 캐릭터가 쓰는 중이면 트레이에 회색.
//
// 영역은 전부 아래 L에 고정 사각형으로 잡아두고, 글자는 그 안에서만 그린다 (넘치면 fitText / "외 n개").
import { CLASS_KEYS, CLASS_NAME, type ClassKey } from "../data/skills";
import { PARTY } from "../data/battle";
import { coreBlockReason } from "../data/aptitude";
import { coreStackable, skillOfCore } from "../data/skillCores";
import { weaponSkillBlocked, weaponsOf } from "../engine/party";
import { PIECES, listByKind, type Cell, type PieceDef } from "../data/pieces";
import { ownedOfKind } from "../data/inventory";
import { CORE_BOARDS, freeCores, pruneBoards, type PlacedCore } from "../data/coreBoards";
import { CORE_COLS, CORE_ROWS, cellKey, commitCoreExpansion, getCharacter, parseKey } from "../data/characters";
import { debugLevelUp } from "../engine/battleResult";
import { PLAY } from "../engine/mode";
import { applyRotFlip, silhouetteEdges } from "../engine/transform";
import { goTo, takeNavChar } from "../engine/nav";
import { C, PIECE, R, T, W, btn, fitText, piece, silhouette } from "../render/primitives";
import { CONTROLS_HINT_H, drawControlsHint, drawTooltip, pieceTooltip } from "../ui/tooltip";
import type { LogicalPoint, Scene } from "./types";

type Rect = { x: number; y: number; w: number; h: number };

const CS = 26;
const BOARD_W = CORE_COLS * CS;
const BOARD_H = CORE_ROWS * CS;

// ---- 레이아웃 (480×270). 아래쪽 256~266은 조작 안내 자리로 항상 비워둔다. ----
const L = {
  tab: (i: number): Rect => ({ x: 10 + i * 60, y: 6, w: 56, h: 18 }),
  btnA: { x: 316, y: 8, w: 74, h: 14 }, // 보기: 판 확장 · 확장: 취소
  btnB: { x: 396, y: 8, w: 74, h: 14 }, // 보기: 수정 · 수정: 완료 · 확장: 완료
  backBtn: { x: 10, y: 256, w: 64, h: 14 }, // 보기 상태에서만: P01로 돌아가기 (조작 안내 줄 자리)
  boardWin: { x: 10, y: 28, w: 290, h: 226 },
  status: { x: 16, y: 236, w: 278, h: 14 }, // 판 창 안 맨 아래 한 줄
  levelBtn: { x: 222, y: 236, w: 72, h: 14 }, // 보기 상태에서만, status 줄 오른쪽
  hint: { x: 12, y: 256, w: 288, h: CONTROLS_HINT_H },
  rightFull: { x: 306, y: 28, w: 164, h: 226 },
  tray: { x: 306, y: 28, w: 164, h: 118 },
  resetBtn: { x: 316, y: 150, w: 144, h: 14 },
  expandWin: { x: 306, y: 28, w: 164, h: 136 },
  undoBtn: { x: 314, y: 144, w: 72, h: 14 },
  undoAllBtn: { x: 390, y: 144, w: 72, h: 14 },
  rightBottom: { x: 306, y: 168, w: 164, h: 86 },
  modal: { x: 120, y: 80, w: 240, h: 110 },
  modalOk: { x: 166, y: 166, w: 70, h: 14 },
  modalBack: { x: 244, y: 166, w: 70, h: 14 },
};
const BX = L.boardWin.x + (L.boardWin.w - BOARD_W) / 2;
const BY = L.boardWin.y + 18; // 제목 띠(14) 아래 여백 4 — 판 아래 끝 BY+BOARD_H는 status 줄 위에서 멈춘다
const TRAY_SLOT = 44;
const TRAY_PITCH_X = 50;
const TRAY_PITCH_Y = 48;
const TRAY_MAX = 6; // 3열 × 2줄. 넘치면 휠로 한 줄씩 스크롤 (2026-11-07: 스킬 코어 100여 종)

type Source = { kind: "tray" } | { kind: "board"; origin: Cell; rot: 0 | 1 | 2 | 3; flip: boolean };
interface Floating {
  uid: number;
  ownedUid: string;
  itemId: string;
  rot: 0 | 1 | 2 | 3;
  flip: boolean;
  pointer: LogicalPoint;
  source: Source;
}

let uidSeq = 1;

function hitRect(p: LogicalPoint, r: Rect) {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

function dimBtn(r: Rect, s: string) {
  R(r.x, r.y, r.w, 14, C.woodD);
  R(r.x + 1, r.y + 1, r.w - 2, 12, C.cellExt);
  T(r.x + r.w / 2, r.y + 10, s, 8, C.sub, "middle");
}

export function createP03Scene(): Scene {
  // 판 배치는 data/coreBoards.ts에 둔다 — 창고(H03)에서 "누가 쓰는 중"을 같이 보려고.
  const boards = CORE_BOARDS;
  let current: ClassKey = "knight";
  let mode: "view" | "edit" | "expand" = "view";
  let press: Floating | null = null;
  let pressStart: LogicalPoint | null = null;
  let pressMoved = false;
  let floating: Floating | null = null;
  let hoverTray: PieceDef | null = null;
  let hoverBoardUid: number | null = null;
  let hoverPointer: LogicalPoint = { x: 0, y: 0 };
  // 판 확장 상태
  let draft: string[] = []; // 이번에 새로 연 칸 (연 순서대로)
  let hoverCell: string | null = null;
  let confirmOpen = false;
  let message = "";
  /** 적용 중 효과 창: 스킬 목록 탭(액티브/패시브)과 스크롤 (2026-11-07) */
  let effTab: "active" | "passive" = "active";
  let effScroll = 0;
  // 열 수 있는 칸의 숨쉬기 깜빡임. 시계는 tick의 dt로 쌓고, 그 칸이 보일 때만 애니메이션 중으로 친다.
  let clock = 0;
  let pulsing = false;

  function def(id: string) {
    return PIECES[id];
  }
  function board() {
    return boards[current];
  }
  function ch() {
    return getCharacter(current);
  }

  // ---- 코어 사용 가능 수 ----
  function usedByOtherClass(itemId: string): ClassKey | null {
    for (const k of CLASS_KEYS) {
      if (k === current) continue;
      if (boards[k].some((p) => p.itemId === itemId)) return k;
    }
    return null;
  }
  function availableCount(itemId: string) {
    return freeCores(itemId).filter((u) => u !== (press ?? floating)?.ownedUid).length;
  }
  /** 보유 목록에 있는 코어 종류 — 제작으로 새로 생긴 코어도 바로 나온다. 장착 불가 코어도 회색으로 보여준다. */
  function allTrayItems(): PieceDef[] {
    const ids = new Set(ownedOfKind("core").map((o) => o.itemId));
    // 이 캐릭터가 쓸 수 있는 코어 → 남은 개수 있는 것 먼저
    return listByKind("core")
      .filter((d) => ids.has(d.id))
      .sort((a, b) => +!!blockReason(a) - +!!blockReason(b) || +(availableCount(a.id) === 0) - +(availableCount(b.id) === 0));
  }
  let trayRow = 0;
  function trayItems(): PieceDef[] {
    const all = allTrayItems();
    trayRow = Math.max(0, Math.min(trayRow, Math.ceil(all.length / 3) - 2));
    return all.slice(trayRow * 3, trayRow * 3 + TRAY_MAX);
  }
  /** 적성(직업 전용 / 무기·속성·보조 / 공용) 때문에 이 캐릭터가 못 쓰면 이유. */
  function blockReason(d: PieceDef) {
    const r = coreBlockReason(CLASS_NAME[current], d.coreReq);
    if (r) return r;
    // 무기 적성 스킬(액티브·패시브)은 그 무기를 들고 있어야 꽂는다
    const s = skillOfCore(d.id);
    if (s && weaponSkillBlocked(s, weaponsOf(CLASS_NAME[current]).types)) return `${s.req.type === "weapon" ? s.req.tags.join("/") : ""} 착용 필요`;
    // 스킬·패시브 코어는 한 판에 하나 (능력치 코어만 중복 가능)
    if (!coreStackable(d.id) && CORE_BOARDS[current].some((p) => p.itemId === d.id)) return "이미 꽂은 코어 (중복 불가)";
    return null;
  }

  // ---- 판 칸 상태 ----
  function inBoard(k: string) {
    return ch().coreBoard.has(k);
  }
  function isUnlocked(k: string) {
    return ch().coreUnlocked.has(k);
  }
  function isOpenInDraft(k: string) {
    return isUnlocked(k) || draft.includes(k);
  }
  function remainingStacks() {
    return ch().coreExpandStacks - draft.length;
  }
  function isExpandable(k: string) {
    if (mode !== "expand" || remainingStacks() <= 0) return false;
    if (!inBoard(k) || isOpenInDraft(k)) return false;
    const [c, r] = parseKey(k);
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => isOpenInDraft(cellKey(c + dc, r + dr)));
  }
  /** 새 칸 하나를 되돌리면, 그 칸을 통해서만 이어져 있던 새 칸들도 같이 되돌린다. */
  function removeDraft(k: string) {
    const rest = draft.filter((d) => d !== k);
    const reach = new Set(ch().coreUnlocked);
    let grew = true;
    while (grew) {
      grew = false;
      for (const d of rest) {
        if (reach.has(d)) continue;
        const [c, r] = parseKey(d);
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => reach.has(cellKey(c + dc, r + dr)))) {
          reach.add(d);
          grew = true;
        }
      }
    }
    draft = rest.filter((d) => reach.has(d));
  }

  function boardOccupied(excludeUid?: number): Set<string> {
    const set = new Set<string>();
    board().forEach((p) => {
      if (p.uid === excludeUid) return;
      applyRotFlip(def(p.itemId).cells, p.rot, p.flip).forEach(([c, r]) => set.add(cellKey(p.origin[0] + c, p.origin[1] + r)));
    });
    return set;
  }
  function isValidPlacement(shape: Cell[], origin: Cell): boolean {
    const occ = boardOccupied();
    return shape.every(([dc, dr]) => {
      const k = cellKey(origin[0] + dc, origin[1] + dr);
      return isUnlocked(k) && !occ.has(k);
    });
  }

  function effectTotals() {
    const stats = new Map<string, number>();
    const skills: Array<{ name: string; passive: boolean }> = [];
    board().forEach((p) => {
      const eff = def(p.itemId).coreEffect;
      if (!eff) return;
      eff.stats.forEach((s) => stats.set(s.label, (stats.get(s.label) ?? 0) + s.value));
      // 액티브·패시브가 섞인 복합 스킬은 액티브로 친다
      eff.skills.forEach((s) => skills.push({ name: s.label.replace(/^(스킬|패시브): /, ""), passive: s.passive }));
    });
    return { stats: [...stats.entries()].map(([k, v]) => `${k} +${v}`), skills };
  }

  // ---- 좌표 ----
  function trayRect(i: number): Rect {
    return { x: L.tray.x + 10 + (i % 3) * TRAY_PITCH_X, y: L.tray.y + 18 + Math.floor(i / 3) * TRAY_PITCH_Y, w: TRAY_SLOT, h: TRAY_SLOT };
  }
  function cellRect(c: number, r: number): Rect {
    return { x: BX + c * CS, y: BY + r * CS, w: CS - 2, h: CS - 2 };
  }
  function cellAt(p: LogicalPoint): string | null {
    const c = Math.floor((p.x - BX) / CS);
    const r = Math.floor((p.y - BY) / CS);
    if (c < 0 || r < 0 || c >= CORE_COLS || r >= CORE_ROWS) return null;
    if (p.x - BX - c * CS >= CS - 2 || p.y - BY - r * CS >= CS - 2) return null; // 칸 사이 틈
    return cellKey(c, r);
  }
  function boardCellFromPointer(p: LogicalPoint): Cell {
    return [Math.round((p.x - CS / 2 - BX) / CS), Math.round((p.y - CS / 2 - BY) / CS)];
  }
  function hitBoardPiece(p: LogicalPoint): PlacedCore | null {
    for (let i = board().length - 1; i >= 0; i--) {
      const pc = board()[i];
      const shape = applyRotFlip(def(pc.itemId).cells, pc.rot, pc.flip);
      if (shape.some(([c, r]) => hitRect(p, cellRect(pc.origin[0] + c, pc.origin[1] + r)))) return pc;
    }
    return null;
  }

  // ---- 상태 전환 ----
  function cancelFloating() {
    const f = press ?? floating;
    if (f && f.source.kind === "board") {
      board().push({ uid: f.uid, ownedUid: f.ownedUid, itemId: f.itemId, origin: f.source.origin, rot: f.source.rot, flip: f.source.flip });
    }
    press = null;
    floating = null;
    pressStart = null;
    pressMoved = false;
  }
  function setMode(next: typeof mode) {
    cancelFloating();
    draft = [];
    hoverCell = null;
    confirmOpen = false;
    mode = next;
  }
  function confirmExpansion() {
    const n = draft.length;
    if (commitCoreExpansion(current, draft)) message = `${CLASS_NAME[current]}의 코어 판이 ${n}칸 넓어졌어요`;
    else message = "확장할 수 없는 칸이 섞여 있어요";
    setMode("view");
  }

  // ---- 입력 ----
  function onPointerDown(p: LogicalPoint, button: number) {
    if (confirmOpen) {
      if (button !== 0) return;
      if (hitRect(p, L.modalOk)) confirmExpansion();
      else if (hitRect(p, L.modalBack)) confirmOpen = false;
      return;
    }

    if (button === 0) {
      const { tabs } = effLayout(effRect());
      const k = tabs.findIndex((r) => hitRect(p, r));
      if (k >= 0) {
        effTab = k === 0 ? "active" : "passive";
        effScroll = 0;
        return;
      }
    }
    if (mode !== "expand") {
      for (let i = 0; i < CLASS_KEYS.length; i++) {
        if (button === 0 && hitRect(p, L.tab(i))) {
          cancelFloating();
          current = CLASS_KEYS[i];
          message = "";
          return;
        }
      }
    }

    if (button === 0 && mode === "view" && hitRect(p, L.backBtn)) {
      goTo("p01", CLASS_NAME[current]);
      return;
    }
    if (button === 0 && hitRect(p, L.btnA)) {
      if (mode === "view" && ch().coreExpandStacks > 0) {
        setMode("expand");
        message = "";
      } else if (mode === "expand") setMode("view");
      return;
    }
    if (button === 0 && hitRect(p, L.btnB)) {
      if (mode === "view") setMode("edit");
      else if (mode === "edit") setMode("view");
      else if (draft.length > 0) confirmOpen = true;
      message = "";
      return;
    }

    if (mode === "view") {
      if (button === 0 && !PLAY && hitRect(p, L.levelBtn)) {
        debugLevelUp(CLASS_NAME[current]);
        message = `레벨업! 확장 스택 +1 (Lv ${ch().level})`;
      }
      return;
    }
    if (mode === "expand") return onExpandPointerDown(p, button);
    onEditPointerDown(p, button);
  }

  function onExpandPointerDown(p: LogicalPoint, button: number) {
    if (button === 2) {
      draft.pop();
      return;
    }
    if (button !== 0) return;
    if (hitRect(p, L.undoBtn)) {
      draft.pop();
      return;
    }
    if (hitRect(p, L.undoAllBtn)) {
      draft = [];
      return;
    }
    const k = cellAt(p);
    if (!k) return;
    if (draft.includes(k)) removeDraft(k);
    else if (isExpandable(k)) draft.push(k);
  }

  function onEditPointerDown(p: LogicalPoint, button: number) {
    if (button === 2) {
      cancelFloating();
      return;
    }
    if (button !== 0) return;

    if (hitRect(p, L.resetBtn)) {
      cancelFloating();
      boards[current] = [];
      return;
    }

    if (floating) {
      const shape = applyRotFlip(def(floating.itemId).cells, floating.rot, floating.flip);
      const origin = boardCellFromPointer(p);
      if (isValidPlacement(shape, origin)) {
        board().push({ uid: floating.uid, ownedUid: floating.ownedUid, itemId: floating.itemId, origin, rot: floating.rot, flip: floating.flip });
        floating = null;
      } else cancelFloating();
      return;
    }

    const boardHit = hitBoardPiece(p);
    if (boardHit) {
      boards[current] = board().filter((x) => x.uid !== boardHit.uid);
      press = { uid: boardHit.uid, ownedUid: boardHit.ownedUid, itemId: boardHit.itemId, rot: boardHit.rot, flip: boardHit.flip, pointer: p, source: { kind: "board", origin: boardHit.origin, rot: boardHit.rot, flip: boardHit.flip } };
      pressStart = p;
      pressMoved = false;
      return;
    }
    const items = trayItems();
    for (let i = 0; i < items.length; i++) {
      if (hitRect(p, trayRect(i)) && availableCount(items[i].id) > 0 && !blockReason(items[i])) {
        press = { uid: uidSeq++, ownedUid: freeCores(items[i].id)[0], itemId: items[i].id, rot: 0, flip: false, pointer: p, source: { kind: "tray" } };
        pressStart = p;
        pressMoved = false;
        return;
      }
    }
  }

  function onPointerMove(p: LogicalPoint) {
    hoverPointer = p;
    hoverTray = null;
    hoverBoardUid = null;
    hoverCell = null;
    if (confirmOpen) return;
    if (press) {
      if (!pressMoved && pressStart && Math.hypot(p.x - pressStart.x, p.y - pressStart.y) > 4) pressMoved = true;
      press.pointer = p;
      return;
    }
    if (floating) {
      floating.pointer = p;
      return;
    }
    if (mode === "expand") {
      const k = cellAt(p);
      if (k && (isExpandable(k) || draft.includes(k))) hoverCell = k;
      return;
    }
    const boardHit = hitBoardPiece(p);
    if (boardHit) {
      hoverBoardUid = boardHit.uid;
      return;
    }
    if (mode !== "edit") return;
    trayItems().forEach((d, i) => {
      if (hitRect(p, trayRect(i))) hoverTray = d;
    });
  }

  function onPointerUp(p: LogicalPoint, button: number) {
    if (button !== 0 || !press) return;
    if (pressMoved) {
      const shape = applyRotFlip(def(press.itemId).cells, press.rot, press.flip);
      const origin = boardCellFromPointer(p);
      if (isValidPlacement(shape, origin)) {
        board().push({ uid: press.uid, ownedUid: press.ownedUid, itemId: press.itemId, origin, rot: press.rot, flip: press.flip });
        press = null;
      } else cancelFloating();
    } else {
      floating = press;
      floating.pointer = p;
      press = null;
    }
    pressStart = null;
    pressMoved = false;
  }

  function onWheel(deltaY: number) {
    const f = press ?? floating;
    if (!f && hitRect(hoverPointer, effLayout(effRect()).list)) {
      effScroll += deltaY > 0 ? 1 : -1;
      effScroll = Math.max(0, Math.min(effScroll, effMaxScroll()));
      return;
    }
    if (!f) {
      trayRow += deltaY > 0 ? 1 : -1;
      trayItems();
      return;
    }
    const dir: 1 | 3 = deltaY > 0 ? 1 : 3;
    f.rot = ((f.rot + dir) % 4) as 0 | 1 | 2 | 3;
  }
  function onKeyDown(key: string) {
    if (key === "Escape") {
      if (confirmOpen) confirmOpen = false;
      else cancelFloating();
      return;
    }
    if (key.toLowerCase() === "f") {
      const f = press ?? floating;
      if (f) f.flip = !f.flip;
    }
  }

  // ---- 그리기 ----
  function drawTopBar() {
    CLASS_KEYS.forEach((k, i) => {
      const r = L.tab(i);
      const locked = mode === "expand" && k !== current;
      R(r.x, r.y, r.w, r.h, k === current ? C.gold : locked ? C.cellExt : C.woodL);
      R(r.x + 4, r.y + 3, 12, 12, PARTY[i].color, locked ? "opacity='.4'" : undefined);
      T(r.x + 20, r.y + 13, CLASS_NAME[k], 8, locked ? C.sub : C.woodD);
    });

    const stacks = ch().coreExpandStacks;
    if (mode === "view") {
      if (stacks > 0) btn(L.btnA.x, L.btnA.y, L.btnA.w, `판 확장 ${stacks}`, 1);
      else dimBtn(L.btnA, "판 확장");
      btn(L.btnB.x, L.btnB.y, L.btnB.w, "코어 수정");
      btn(L.backBtn.x, L.backBtn.y, L.backBtn.w, "◀ 돌아가기");
    } else if (mode === "edit") {
      btn(L.btnB.x, L.btnB.y, L.btnB.w, "완료", 1);
    } else {
      btn(L.btnA.x, L.btnA.y, L.btnA.w, "취소");
      if (draft.length > 0) btn(L.btnB.x, L.btnB.y, L.btnB.w, "완료", 1);
      else dimBtn(L.btnB, "완료");
    }
  }

  function drawBoard() {
    const title = `코어 판 · ${CLASS_NAME[current]} Lv ${ch().level}`;
    W(L.boardWin.x, L.boardWin.y, L.boardWin.w, L.boardWin.h, fitText(title, L.boardWin.w - 12, 8));
    const pulse = 0.22 + 0.18 * Math.sin(clock / 160);
    pulsing = false;

    for (let r = 0; r < CORE_ROWS; r++) {
      for (let c = 0; c < CORE_COLS; c++) {
        const k = cellKey(c, r);
        if (!inBoard(k)) continue;
        const { x, y, w, h } = cellRect(c, r);
        if (isUnlocked(k)) {
          R(x, y, w, h, C.cell);
        } else if (draft.includes(k)) {
          // 이번에 새로 연 칸 — 확정 전이라 금색 테두리로 구분
          R(x, y, w, h, C.cell);
          R(x, y, w, h, "none", `stroke='${C.gold}' stroke-width='1'`);
          R(x + w - 5, y + 2, 3, 3, C.gold);
        } else if (isExpandable(k)) {
          pulsing = true;
          // 열 수 있는 칸 — 금색으로 숨쉬듯 깜빡인다
          R(x, y, w, h, C.cellLocked);
          R(x, y, w, h, C.gold, `opacity='${pulse.toFixed(2)}'`);
          R(x, y, w, h, "none", `stroke='${C.lim}' stroke-width='1'`);
        } else {
          R(x, y, w, h, C.cellLocked);
          // 잠긴 칸 표시: 가운데 작은 자물쇠 점
          R(x + w / 2 - 2, y + h / 2 - 1, 4, 3, "#3A3A37");
        }
        if (hoverCell === k && !confirmOpen) {
          if (draft.includes(k)) {
            // 되돌릴 칸 미리보기
            R(x, y, w, h, C.hp, "opacity='.35'");
            T(x + w / 2, y + h / 2 + 3, "×", 8, C.txt, "middle");
          } else {
            // 이 자리에 칸이 열린다는 미리보기
            R(x, y, w, h, C.cell, "opacity='.9'");
            R(x, y, w, h, "none", "stroke='#ffffff' stroke-width='1'");
            T(x + w / 2, y + h / 2 + 4, "+", 9, "#ffffff", "middle");
          }
        }
      }
    }

    board().forEach((p) => {
      const shape = applyRotFlip(def(p.itemId).cells, p.rot, p.flip);
      const px = BX + p.origin[0] * CS;
      const py = BY + p.origin[1] * CS;
      piece(px, py, CS, shape, PIECE[def(p.itemId).color]);
      if (hoverBoardUid === p.uid) silhouette(px, py, CS, silhouetteEdges(shape), C.gold, { width: 1, alpha: 0.9 });
    });

    drawStatusLine();
  }

  function drawStatusLine() {
    const s = L.status;
    const base = s.y + 10;
    const total = ch().coreBoard.size;
    const open = ch().coreUnlocked.size;
    let left: string;
    let color: string = C.sub;
    if (mode === "expand") {
      left = `해금 ${open + draft.length}/${total}칸 · 새로 연 칸 ${draft.length}`;
      color = C.gold;
    } else if (message) {
      left = message;
      color = C.good;
    } else {
      left = `해금 ${open}/${total}칸`;
    }
    const leftW = mode === "view" ? L.levelBtn.x - s.x - 6 : s.w;
    T(s.x, base, fitText(left, leftW, 7), 7, color);
    if (mode === "view" && !PLAY) btn(L.levelBtn.x, L.levelBtn.y, L.levelBtn.w, "레벨업 (테스트)");
  }

  function drawTray() {
    W(L.tray.x, L.tray.y, L.tray.w, L.tray.h, "사용 가능한 코어");
    trayItems().forEach((d, i) => {
      const r = trayRect(i);
      const blocked = !!blockReason(d);
      const avail = blocked ? 0 : availableCount(d.id);
      const usedBy = !blocked && avail <= 0 ? usedByOtherClass(d.id) : null;
      R(r.x, r.y, r.w, r.h, hoverTray === d ? C.listRowSel : C.listRow);
      const mini = 10;
      const cols = Math.max(...d.cells.map(([c]) => c)) + 1;
      const rows = Math.max(...d.cells.map(([, rr]) => rr)) + 1;
      // 미리보기 영역: 슬롯 위 30px (3칸까지), 가운데 정렬
      piece(r.x + (r.w - cols * mini + 2) / 2, r.y + 3 + (30 - rows * mini) / 2, mini, d.cells, avail > 0 ? PIECE[d.color] : C.cellExt);
      const label = blocked ? "장착 불가" : usedBy ? `${CLASS_NAME[usedBy]} 사용중` : avail > 0 ? d.name : "장착 중";
      T(r.x + r.w / 2, r.y + r.h - 4, fitText(label, r.w - 4, 7), 7, usedBy ? C.hp : avail > 0 ? C.sub : C.cellExt, "middle");
    });
    const total = Math.ceil(allTrayItems().length / 3);
    if (total > 2) T(L.tray.x + L.tray.w - 6, L.tray.y + 10, `휠 ${trayRow + 1}/${total - 1}`, 6, C.woodD, "end");
    btn(L.resetBtn.x, L.resetBtn.y, L.resetBtn.w, "배치 초기화");
  }

  function drawExpandPanel() {
    const w = L.expandWin;
    W(w.x, w.y, w.w, w.h, "판 확장");
    const x = w.x + 10;
    const inner = w.w - 20;
    const stacks = ch().coreExpandStacks;
    const rem = remainingStacks();

    T(x, w.y + 28, "남은 확장", 7, C.gold);
    T(x + inner, w.y + 28, `${rem} / ${stacks}`, 8, C.txt, "end");
    // 스택 칸: 한 줄 최대 12개 (12×12px = 144 ≤ inner). 넘으면 앞 11개 + "+n"
    const pipCount = Math.min(stacks, 12);
    for (let i = 0; i < pipCount; i++) {
      if (stacks > 12 && i === 11) {
        T(x + i * 12, w.y + 42, `+${stacks - 11}`, 7, C.sub);
        break;
      }
      R(x + i * 12, w.y + 34, 10, 8, i < rem ? C.gold : C.cellExt);
    }

    const tips = ["빛나는 칸을 눌러서 열어요", "새로 연 칸 옆으로 계속 열 수 있어요", "새 칸을 다시 누르면 되돌려요", "완료를 눌러야 확정돼요"];
    tips.forEach((t, i) => T(x, w.y + 62 + i * 12, fitText(t, inner, 7), 7, i === 3 ? C.lim : C.sub));

    if (draft.length) {
      btn(L.undoBtn.x, L.undoBtn.y, L.undoBtn.w, "되돌리기");
      btn(L.undoAllBtn.x, L.undoAllBtn.y, L.undoAllBtn.w, "모두 되돌리기");
    } else {
      dimBtn(L.undoBtn, "되돌리기");
      dimBtn(L.undoAllBtn, "모두 되돌리기");
    }
  }

  /** 적용 중 효과 창 안의 칸 나누기: 위 능력치 상자 · 아래 스킬 탭 + 목록 (보기 상태는 넓게, 편집 상태는 작게). */
  function effLayout(rect: Rect) {
    const x = rect.x + 6, w = rect.w - 12;
    const big = rect.h > 120;
    const stat = { x, y: rect.y + 18, w, h: big ? 64 : 14 };
    const tabY = stat.y + stat.h + 4;
    const tabW = Math.floor((w - 2) / 2);
    const tabs = [{ x, y: tabY, w: tabW, h: 12 }, { x: x + tabW + 2, y: tabY, w: tabW, h: 12 }];
    const list = { x, y: tabY + 13, w, h: rect.y + rect.h - 5 - (tabY + 13) };
    // 편집 상태(작은 창)는 능력치를 한 줄로, 스킬 목록을 2열로
    return { stat, tabs, list, cols: big ? 1 : 2, inline: !big };
  }
  const EFF_LH = 10;
  function effRect(): Rect {
    return mode === "view" ? L.rightFull : L.rightBottom;
  }
  function effSkills() {
    return effectTotals().skills.filter((s) => s.passive === (effTab === "passive"));
  }
  function effMaxScroll() {
    const { list, cols } = effLayout(effRect());
    return Math.max(0, Math.ceil(effSkills().length / cols) - Math.floor((list.h - 4) / EFF_LH));
  }

  /** 효과 요약: 능력치 상자(2열, 넘치면 "외 n개") + 스킬 탭(액티브/패시브) 목록(휠 스크롤). */
  function drawEffects(rect: Rect) {
    W(rect.x, rect.y, rect.w, rect.h, "적용 중 효과", 1);
    const { stats, skills } = effectTotals();
    const { stat, tabs, list, cols, inline } = effLayout(rect);

    // 능력치 상자
    R(stat.x, stat.y, stat.w, stat.h, C.listRow);
    T(stat.x + 4, stat.y + 9, "능력치", 7, C.gold);
    const sx = inline ? stat.x + 36 : stat.x + 4;
    const sy = inline ? stat.y + 10 : stat.y + 19;
    const colW = (stat.x + stat.w - 4 - sx) / 2;
    const rows = inline ? 1 : Math.max(1, Math.floor((stat.h - 12) / EFF_LH));
    const slots = rows * 2;
    if (!stats.length) T(sx, sy, "없음", 7, C.sub);
    stats.forEach((s, i) => {
      if (i >= slots) return;
      const over = stats.length > slots && i === slots - 1;
      T(sx + (i % 2) * colW, sy + Math.floor(i / 2) * EFF_LH, fitText(over ? `외 ${stats.length - slots + 1}개` : s, colW - 4, 7), 7, over ? C.sub : C.txt);
    });

    // 스킬 탭
    const nA = skills.filter((s) => !s.passive).length;
    const nP = skills.length - nA;
    ([["active", `액티브 ${nA}`], ["passive", `패시브 ${nP}`]] as const).forEach(([k, label], i) => {
      const r = tabs[i];
      const on = effTab === k;
      R(r.x, r.y, r.w, r.h, on ? C.woodL : C.woodD);
      R(r.x + 1, r.y + 1, r.w - 2, r.h - 1, on ? C.listRowSel : C.listRow);
      T(r.x + r.w / 2, r.y + 9, label, 7, on ? (k === "active" ? C.gold : C.good) : C.sub, "middle");
    });

    // 스킬 목록
    R(list.x, list.y, list.w, list.h, C.listRowSel);
    const shown = effSkills();
    effScroll = Math.max(0, Math.min(effScroll, effMaxScroll()));
    const fit = Math.floor((list.h - 4) / EFF_LH);
    if (!shown.length) T(list.x + 4, list.y + 10, "없음", 7, C.sub);
    const lw = (list.w - 8) / cols;
    shown.slice(effScroll * cols, (effScroll + fit) * cols).forEach((s, i) => {
      T(list.x + 4 + (i % cols) * lw, list.y + 10 + Math.floor(i / cols) * EFF_LH, fitText(s.name, lw - 4, 7), 7, s.passive ? C.good : C.txt);
    });
    const max = effMaxScroll();
    if (max > 0) {
      const barH = Math.max(6, Math.round(((list.h - 2) * fit) / Math.ceil(shown.length / cols)));
      R(list.x + list.w - 3, list.y + 1 + Math.round(((list.h - 2 - barH) * effScroll) / max), 2, barH, C.woodL);
    }
  }

  function drawFloating() {
    const f = press ?? floating;
    if (!f) return;
    const shape = applyRotFlip(def(f.itemId).cells, f.rot, f.flip);
    const origin = boardCellFromPointer(f.pointer);
    const onBoard = f.pointer.x > BX - 10 && f.pointer.x < BX + BOARD_W + 10 && f.pointer.y > BY - 10 && f.pointer.y < BY + BOARD_H + 10;
    if (onBoard) {
      const valid = isValidPlacement(shape, origin);
      const px = BX + origin[0] * CS;
      const py = BY + origin[1] * CS;
      piece(px, py, CS, shape, PIECE[def(f.itemId).color]);
      silhouette(px, py, CS, silhouetteEdges(shape), valid ? "#ffffff" : C.hp, { width: 1, alpha: 0.9 });
    } else {
      piece(f.pointer.x - CS / 2, f.pointer.y - CS / 2, CS, shape, PIECE[def(f.itemId).color]);
    }
  }

  function drawHoverTooltip() {
    if (press || floating || confirmOpen) return;
    if (hoverTray) {
      const reason = blockReason(hoverTray);
      const tip = pieceTooltip(hoverTray, "", !reason && availableCount(hoverTray.id) > 0 ? "클릭해서 배치" : undefined, CLASS_NAME[current]);
      if (reason) tip.sections = [{ heading: "장착 불가", lines: [{ text: reason, color: C.hp }] }, ...(tip.sections ?? [])];
      drawTooltip(hoverPointer.x, hoverPointer.y, tip);
      return;
    }
    const placed = hoverBoardUid != null ? board().find((p) => p.uid === hoverBoardUid) : null;
    if (placed) drawTooltip(hoverPointer.x, hoverPointer.y, pieceTooltip(def(placed.itemId), "", mode === "edit" ? "클릭해서 이동" : undefined, CLASS_NAME[current]));
  }

  function drawConfirm() {
    R(0, 0, 480, 270, "#000000", "opacity='.55'");
    const m = L.modal;
    W(m.x, m.y, m.w, m.h, "판 확장 확정");
    const cx = m.x + m.w / 2;
    const inner = m.w - 20;
    T(cx, m.y + 34, fitText(`새로 연 칸 ${draft.length}칸을 확정할까요?`, inner, 8), 8, C.txt, "middle");
    T(cx, m.y + 50, fitText("확정하면 되돌릴 수 없어요.", inner, 8), 8, C.hp, "middle");
    const rem = remainingStacks();
    if (rem > 0) T(cx, m.y + 66, fitText(`남은 확장 ${rem}개는 나중에 써도 돼요`, inner, 7), 7, C.sub, "middle");
    btn(L.modalOk.x, L.modalOk.y, L.modalOk.w, "확정", 1);
    btn(L.modalBack.x, L.modalBack.y, L.modalBack.w, "돌아가기");
  }

  function draw() {
    R(0, 0, 480, 270, C.screenBg);
    drawTopBar();
    drawBoard();
    if (mode === "view") drawEffects(L.rightFull);
    else {
      if (mode === "edit") drawTray();
      else drawExpandPanel();
      drawEffects(L.rightBottom);
    }
    if (mode === "edit") drawControlsHint(L.hint.x, L.hint.y);
    else if (mode === "expand") drawControlsHint(L.hint.x, L.hint.y, "클릭 열기 · 새 칸 클릭/우클릭 되돌리기");
    drawFloating();
    drawHoverTooltip();
    if (confirmOpen) drawConfirm();
  }

  return {
    id: "p03",
    label: "P03 스킬 코어",
    draw,
    tick: (dt) => (clock += dt),
    // 느린 숨쉬기라 30fps면 충분하다.
    isAnimating: () => (pulsing ? 33 : false),
    onEnter: () => {
      pruneBoards();
      setMode("view");
      // P01 스킬 탭 "스킬 코어"로 들어오면 그 캐릭터의 판으로.
      const name = takeNavChar();
      const k = CLASS_KEYS.find((c) => CLASS_NAME[c] === name);
      if (k) {
        current = k;
        message = "";
      }
    },
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onWheel,
    onKeyDown,
  };
}
