// D06 대열 편성 — 4인 파티를 3×2 칸(전열·후열)에 세운다. data/formation.ts.
// 진입 위치는 미정 (던전 탐색 메뉴 D02와 거점 양쪽에서 쓸 예정). TODO(spec): 진입 버튼, 돌아가기.
// 칸 규칙: 6칸 어디든 자유. 전열에 최소 1명 (그렇게 안 되는 이동은 막고 안내한다).
// 조작: 캐릭터 클릭(또는 끌기) → 다른 칸 클릭(또는 놓기). 캐릭터 칸이면 서로 바꾸고, 빈칸이면 그 칸으로 옮긴다.
import { PARTY } from "../data/battle";
import { COL_LABEL, MIN_FRONT, colCounts, displayRow, memberAt, moveMember, slotOf, type Col } from "../data/formation";
import { goTo, takeNavBack } from "../engine/nav";
import { C, R, T, W, btn, img } from "../render/primitives";
import { charArt } from "../data/charArt";
import type { LogicalPoint, Scene } from "./types";

// 왼쪽 창: 후열(왼쪽)·전열(오른쪽) — 전투 화면처럼 적은 오른쪽에 있다.
const COL_CX: Record<Col, number> = { b: 90, f: 220 };
const SLOT_W = 96;
const SLOT_H = 62;
const SLOT_Y0 = 46;
const SLOT_DY = 66;
// 오른쪽 창 미리보기 (B01 아군 쪽을 줄인 것)
const PV = { x: 326, y: 28, w: 134, h: 100 };
const PV_CX: Record<Col, number> = { b: 368, f: 418 };
const pvFeet = (row: number) => PV.y + 30 + Math.round(row * 30);


export function createD06Scene(): Scene {
  let sel: string | null = null;
  let dragFrom: LogicalPoint | null = null;
  let mouse: LogicalPoint = { x: -1, y: -1 };
  /** 막힌 이동 안내 (다음 조작까지) */
  let warn = "";
  /** 탐색 메뉴에서 왔으면 돌아갈 화면 */
  let backTo: string | null = null;
  const BACK = { x: 326, y: 240, w: 134, h: 14 };
  const inBack = (p: LogicalPoint) => !!backTo && p.x >= BACK.x && p.x < BACK.x + BACK.w && p.y >= BACK.y && p.y < BACK.y + BACK.h;

  const colorOf = (name: string) => PARTY.find((p) => p.name === name)?.color ?? C.cellExt;

  function slotRect(col: Col, row: number) {
    return { x: COL_CX[col] - SLOT_W / 2, y: SLOT_Y0 + row * SLOT_DY, w: SLOT_W, h: SLOT_H };
  }
  function slotAt(p: LogicalPoint): { col: Col; row: number } | null {
    for (const col of ["b", "f"] as Col[])
      for (let row = 0; row < 3; row++) {
        const r = slotRect(col, row);
        if (p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h) return { col, row };
      }
    return null;
  }
  function moveTo(col: Col, row: number) {
    if (sel && !moveMember(sel, col, row) && memberAt(col, row) !== sel) warn = `전열에 최소 ${MIN_FRONT}명은 있어야 한다`;
  }

  function onPointerDown(p: LogicalPoint, button: number) {
    warn = "";
    if (button === 0 && inBack(p)) {
      goTo(backTo!);
      return;
    }
    if (button === 2) {
      sel = null;
      return;
    }
    if (button !== 0) return;
    const s = slotAt(p);
    if (!s) {
      sel = null;
      return;
    }
    const m = memberAt(s.col, s.row);
    if (sel) {
      if (m === sel) sel = null;
      else {
        moveTo(s.col, s.row);
        sel = null;
      }
      return;
    }
    if (m) {
      sel = m;
      dragFrom = p;
    }
  }

  function onPointerUp(p: LogicalPoint, button: number) {
    if (button !== 0 || !dragFrom || !sel) return;
    const moved = Math.hypot(p.x - dragFrom.x, p.y - dragFrom.y) > 4;
    dragFrom = null;
    if (!moved) return; // 클릭: 고른 채로 두고 다음 클릭을 기다린다
    const s = slotAt(p);
    if (s) moveTo(s.col, s.row);
    sel = null;
  }

  function drawSlot(col: Col, row: number) {
    const r = slotRect(col, row);
    const m = memberAt(col, row);
    const hov = slotAt(mouse);
    const isHov = !!hov && hov.col === col && hov.row === row;
    R(r.x, r.y, r.w, r.h, m ? C.listRowSel : C.listRow);
    if (m) {
      const dragging = m === sel && dragFrom && Math.hypot(mouse.x - dragFrom.x, mouse.y - dragFrom.y) > 4;
      // 전투 스프라이트 (data/charArt.ts, 2026-11-09). 없으면 색 상자
      const art = charArt(m, "battle");
      if (!art || !img(Math.round(r.x + r.w / 2 - 22), r.y + 2, 44, 44, art, dragging ? 0.35 : 1, true))
        R(r.x + r.w / 2 - 12, r.y + 8, 24, 34, colorOf(m), dragging ? "opacity='.35'" : undefined);
      T(r.x + r.w / 2, r.y + 54, m, 8, C.txt, "middle");
      // 전열: 전투 시작 때 위험도 1 (battle-rules.md 7장)
      if (col === "f") T(r.x + r.w - 4, r.y + 10, "위험도 1", 6, C.hp, "end");
    }
    if (m && m === sel) R(r.x, r.y, r.w, r.h, "none", `stroke='${C.gold}'`);
    else if (sel && isHov) R(r.x, r.y, r.w, r.h, "none", `stroke='${C.woodL}'`);
  }

  function drawPreview() {
    W(316, 8, 154, 254, "전투 미리보기");
    R(PV.x, PV.y, PV.w, PV.h, C.dark);
    // 3줄 기준선 — 서 있는 칸 그대로
    for (let k = 0; k < 3; k++) for (const col of ["b", "f"] as Col[]) R(PV_CX[col] - 12, pvFeet(k) - 1, 24, 2, C.cell);
    const slots = PARTY.map((p) => slotOf(p.name));
    PARTY.forEach((p) => {
      const s = slotOf(p.name);
      const col: Col = s < 3 ? "f" : "b";
      const fy = pvFeet(displayRow(s));
      const art = charArt(p.name, "battle");
      if (!art || !img(PV_CX[col] - 12, fy - 24, 24, 24, art, 1, true)) R(PV_CX[col] - 6, fy - 18, 12, 18, p.color);
    });
    T(PV.x + PV.w - 4, PV.y + PV.h - 4, "적 ▶", 7, C.sub, "end");

    const cnt = colCounts(slots);
    const x = 326;
    T(x, 146, `전열 ${cnt.f} · 후열 ${cnt.b}`, 8, C.txt);
    T(x, 160, "6칸 어디든 자유 배치", 7, C.gold);
    [`전열에 최소 ${MIN_FRONT}명`, "전열은 전투 시작 때", "위험도 1을 쌓고 시작한다.", "위험도가 높을수록", "적이 노릴 확률이 높다."].forEach((l, i) => T(x, 180 + i * 12, l, 7, C.sub));
  }

  function draw() {
    R(0, 0, 480, 270, C.screenBg);
    W(10, 8, 300, 254, "대열 편성");
    (["b", "f"] as Col[]).forEach((col) => {
      T(COL_CX[col], 36, COL_LABEL[col], 7, C.sub, "middle");
      for (let row = 0; row < 3; row++) drawSlot(col, row);
    });
    T(302, 36, "적 ▶", 7, C.sub, "end");
    if (warn) T(18, 254, warn, 7, C.hp);
    else T(18, 254, sel ? `${sel}: 옮길 칸을 클릭 · 우클릭 취소` : "캐릭터를 클릭하거나 끌어서 옮기기 · 바꾸기", 7, sel ? C.gold : C.sub);
    drawPreview();
    if (backTo) btn(BACK.x, BACK.y, BACK.w, backTo === "h01" ? "◀ 거점으로" : "◀ 탐색으로", inBack(mouse));
  }

  return {
    id: "d06",
    label: "D06 대열 편성",
    draw,
    onEnter: () => {
      backTo = takeNavBack();
      sel = null;
    },
    onPointerDown,
    onPointerUp,
    onPointerMove: (p) => {
      mouse = p;
    },
    onKeyDown: (k) => {
      if (k !== "Escape") return;
      if (sel) sel = null;
      else if (backTo) goTo(backTo);
    },
  };
}
