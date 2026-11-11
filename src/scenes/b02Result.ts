// B02 전투 결과 — 쓰러뜨린 적, 아군 경험치, 전리품 목록. docs/screens.md B02, 계산은 engine/battleResult.ts.
// B01 승리 오버레이의 "결과 보기"로 들어온다. 줄이 하나씩 나타나고 경험치 막대가 차오른 뒤 멈춘다.
// "전리품 분배 ▶"(또는 Enter)로 이번 전투 전리품을 B03에 넘긴다 (engine/battleResult.ts handOverLoot).
import { PIECES, pieceColors, itemImage } from "../data/pieces";
import { expToNext, getLastResult, handOverLoot, type BattleResult, type MemberGain } from "../engine/battleResult";
import { goTo } from "../engine/nav";
import { cached } from "../render/layerCache";
import { C, R, T, W, btn, fitText, img, piece } from "../render/primitives";
import type { LogicalPoint, Scene } from "./types";

const FOES = { x: 8, y: 24, w: 228, h: 108 };
const EXP = { x: 8, y: 136, w: 228, h: 94 };
const LOOT = { x: 244, y: 24, w: 228, h: 206 };
const BTN_BACK = { x: 8, y: 240, w: 90, h: 14 };
const BTN_LOOT = { x: 382, y: 240, w: 90, h: 14 };
const LOOT_ROWS = 8;

// 타임라인 (ms)
const ROW_GAP = 70;
const LOOT_START = 250;
const BAR_START = 550;
const BAR_DUR = 900;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** 경험치를 gained만큼 더했을 때의 레벨과 남은 경험치. */
function walk(lv: number, exp: number, gained: number) {
  let e = exp + gained;
  while (e >= expToNext(lv)) { e -= expToNext(lv); lv++; }
  return { lv, exp: e };
}

export function createB02Scene(): Scene {
  let t = 0;
  let over: "back" | "loot" | "" = "";

  const res = () => getLastResult();
  const doneAt = (r: BattleResult) => Math.max(BAR_START + BAR_DUR, LOOT_START + Math.min(r.drops.length, LOOT_ROWS) * ROW_GAP + 200);
  const shown = (start: number) => clamp01((t - start) / 180);

  function base() {
    R(0, 0, 480, 270, C.screenBg);
    R(0, 0, 480, 20, C.dark);
    T(10, 14, "전투 결과", 9, C.gold);
    W(FOES.x, FOES.y, FOES.w, FOES.h, "쓰러뜨린 적");
    W(EXP.x, EXP.y, EXP.w, EXP.h, "경험치");
    W(LOOT.x, LOOT.y, LOOT.w, LOOT.h, "전리품");
  }

  function foeRows(r: BattleResult) {
    const x = FOES.x + 8;
    r.defeated.slice(0, 6).forEach((d, i) => {
      const a = shown(i * ROW_GAP);
      if (a <= 0) return;
      const y = FOES.y + 26 + i * 11;
      R(x, y - 7, 8, 8, d.color);
      T(x + 12, y, d.label, 7, C.txt);
      T(x + 120, y, `Lv${d.lv}`, 7, C.sub);
      T(FOES.x + FOES.w - 10, y, `+${d.exp}`, 7, C.good, "end");
      if (a < 1) R(x - 2, y - 8, FOES.w - 12, 10, C.panelIn, `opacity='${(1 - a).toFixed(2)}'`);
    });
    if (r.defeated.length > 6) T(x, FOES.y + 92, `외 ${r.defeated.length - 6}`, 7, C.sub);
    R(FOES.x + 6, FOES.y + 90, FOES.w - 12, 1, C.woodD);
    T(x, FOES.y + 101, "합계 경험치", 7, C.sub);
    T(FOES.x + FOES.w - 10, FOES.y + 101, `${r.expTotal} EXP · ${r.gold ?? 0} G`, 8, C.gold, "end");
  }

  function memberRow(m: MemberGain, i: number) {
    const x = EXP.x + 8, y = EXP.y + 28 + i * 14;
    R(x, y - 8, 9, 9, m.alive ? m.color : C.cellExt);
    T(x + 13, y, m.name, 7, m.alive ? C.txt : C.sub);
    const k = easeOutCubic(clamp01((t - BAR_START) / BAR_DUR));
    const cur = walk(m.lv0, m.exp0, Math.round(m.gain * k));
    const up = cur.lv > m.lv0;
    T(x + 56, y, `Lv${cur.lv}`, 7, up ? C.gold : C.sub);
    const bx = x + 84, bw = 84;
    R(bx, y - 6, bw, 5, C.cell);
    R(bx, y - 6, Math.round(bw * cur.exp / expToNext(cur.lv)), 5, up ? C.gold : C.good);
    if (!m.alive) T(EXP.x + EXP.w - 10, y, "전투 불능", 7, C.hp, "end");
    else if (up) T(EXP.x + EXP.w - 10, y, "LEVEL UP", 7, C.gold, "end");
    else T(EXP.x + EXP.w - 10, y, `+${m.gain}`, 7, C.good, "end");
  }

  function lootIcon(id: string, x: number, y: number) {
    R(x, y, 18, 18, C.listRow);
    if (img(x + 1, y + 1, 16, 16, itemImage(id))) return;
    const d = PIECES[id];
    if (!d) return;
    const w = Math.max(...d.cells.map(([c]) => c)) + 1, h = Math.max(...d.cells.map(([, rr]) => rr)) + 1;
    const cs = Math.max(3, Math.floor(16 / Math.max(w, h)));
    piece(Math.round(x + 9 - (w * cs - 2) / 2), Math.round(y + 9 - (h * cs - 2) / 2), cs, d.cells, pieceColors(d));
  }

  function lootRows(r: BattleResult) {
    const ax = LOOT.x + 8;
    if (r.forced) T(LOOT.x + LOOT.w - 8, LOOT.y + 11, "확정 드롭 (테스트)", 7, C.woodD, "end");
    if (!r.drops.length) {
      if (t >= LOOT_START) T(LOOT.x + LOOT.w / 2, LOOT.y + 100, "떨어진 전리품이 없다", 7, C.sub, "middle");
      return;
    }
    r.drops.slice(0, LOOT_ROWS).forEach((d, i) => {
      const a = shown(LOOT_START + i * ROW_GAP);
      if (a <= 0) return;
      const y = LOOT.y + 18 + i * 23;
      const def = PIECES[d.itemId];
      lootIcon(d.itemId, ax, y);
      T(ax + 24, y + 9, def?.name ?? d.itemId, 8, C.txt);
      T(ax + 24, y + 18, fitText(d.from.join(" · "), 150, 7), 7, C.sub);
      T(LOOT.x + LOOT.w - 10, y + 13, `×${d.count}`, 8, C.gold, "end");
      if (a < 1) R(ax - 2, y - 1, LOOT.w - 12, 21, C.panelIn, `opacity='${(1 - a).toFixed(2)}'`);
    });
    // TODO(spec): 9종 이상이면 스크롤
    if (r.drops.length > LOOT_ROWS) T(ax, LOOT.y + LOOT.h - 6, `외 ${r.drops.length - LOOT_ROWS}종`, 7, C.sub);
  }

  function buttons() {
    btn(BTN_BACK.x, BTN_BACK.y, BTN_BACK.w, "다시 전투", over === "back");
    if (res()) btn(BTN_LOOT.x, BTN_LOOT.y, BTN_LOOT.w, "전리품 분배 ▶", over === "loot");
    if (import.meta.env.DEV) T(8, 266, "개발용: B01에서 Shift+W 승리 · Shift+L 패배 · 주소 #drop=all 확정 드롭", 7, C.cellExt);
  }

  function draw() {
    cached("b02.base", 0, 0, 480, 270, base);
    const r = res();
    if (!r) {
      T(FOES.x + 10, FOES.y + 30, "아직 전투 결과가 없다.", 7, C.sub);
      T(FOES.x + 10, FOES.y + 42, "B01에서 이기면 여기로 온다.", 7, C.sub);
      buttons();
      return;
    }
    foeRows(r);
    r.members.forEach(memberRow);
    lootRows(r);
    buttons();
  }

  const inRect = (p: LogicalPoint, q: { x: number; y: number; w: number; h: number }) => p.x >= q.x && p.x < q.x + q.w && p.y >= q.y && p.y < q.y + q.h;
  const toLoot = () => { if (!res()) return; handOverLoot(); goTo("b03"); };
  const skip = () => { const r = res(); if (r && t < doneAt(r)) { t = doneAt(r); return true; } return false; };

  return {
    id: "b02",
    label: "B02 전투 결과",
    draw,
    tick: (dt) => { t += dt; },
    isAnimating: () => { const r = res(); return !!r && t < doneAt(r); },
    onEnter: () => { t = 0; over = ""; },
    onPointerMove: (p) => { over = inRect(p, BTN_BACK) ? "back" : inRect(p, BTN_LOOT) ? "loot" : ""; },
    onPointerDown: (p, button) => {
      if (button !== 0 || skip()) return;
      if (inRect(p, BTN_BACK)) goTo("b01");
      else if (inRect(p, BTN_LOOT)) toLoot();
    },
    onKeyDown: (k) => {
      if (skip()) return;
      if (k === "Enter" || k === " " || k === "z" || k === "Z") toLoot();
    },
  };
}
