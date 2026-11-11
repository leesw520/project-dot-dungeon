// P02 장비 변경 — 2026-11-05 끌어다 놓기 개편 (docs/screens.md P02).
// 캐릭터 탭은 P01과 같은 PARTY, 슬롯 규칙·장착 계산은 data/equipment.ts.
// 위: 장비 칸 (양옆 무기, 가운데 신체·가방·머리 + 악세 4칸). 아래: 상세, 능력치 미리보기. 오른쪽: 장비 목록.
import { PARTY } from "../data/battle";
import {
  SLOT_INFO, SLOT_ORDER, equip, equipBlockReason, unequipBlockReason, equipBonus, getLoadout, isBlocked, isLocked, modsText,
  equipByUid, ownedEquips, simulateEquip, simulateUnequip, unequip, wearerOf, BAG_COLS, bagRowsOfItem,
  type EquipDef, type EquipKind, type OwnedEquip, type SlotId,
} from "../data/equipment";
import { PIECES, itemImage } from "../data/pieces";
import { ownedByUid } from "../data/inventory";
import { STAT_INFO, STAT_ORDER } from "../data/stats";
import { goTo, takeNavChar } from "../engine/nav";
import { coresLostWith, removeCores, weaponTypesOfLoadout } from "../engine/party";
import { skillOfCore } from "../data/skillCores";
import { C, R, T, W, btn, fitText, img, pen, piece, textWidth } from "../render/primitives";
import type { LogicalPoint, Scene } from "./types";

const SLOT_RECT: Record<SlotId, { x: number; y: number; w: number; h: number }> = {
  w0: { x: 16, y: 36, w: 52, h: 134 },
  body: { x: 74, y: 36, w: 86, h: 66 },
  bag: { x: 164, y: 36, w: 86, h: 66 },
  w1: { x: 256, y: 36, w: 52, h: 134 },
  a0: { x: 74, y: 106, w: 41, h: 64 },
  a1: { x: 119, y: 106, w: 41, h: 64 },
  a2: { x: 164, y: 106, w: 41, h: 64 },
  a3: { x: 209, y: 106, w: 41, h: 64 },
};
/** 방향키 이동표 [왼쪽, 오른쪽, 위, 아래]. */
const SLOT_NAV: Record<SlotId, [SlotId, SlotId, SlotId, SlotId]> = {
  w0: ["w1", "body", "w0", "w0"],
  body: ["w0", "bag", "a0", "a0"],
  bag: ["body", "w1", "a2", "a2"],
  w1: ["bag", "w0", "w1", "w1"],
  a0: ["w0", "a1", "body", "body"],
  a1: ["a0", "a2", "bag", "bag"],
  a2: ["a1", "a3", "bag", "bag"],
  a3: ["a2", "w1", "bag", "bag"],
};
const FILTERS: { label: string; kind: EquipKind | null }[] = [
  { label: "전체", kind: null },
  { label: "무기", kind: "weapon" },
  { label: "신체", kind: "body" },
  { label: "가방", kind: "bag" },
  { label: "악세", kind: "acc" },
];
const ROW_X = 326;
const ROW_Y0 = 61;
const ROW_DY = 19;
const ROWS = 8;
const ROW_W = 134;
const ACT_BTN = { x: 326, y: 244, w: 138 };
/** P01로 돌아가기 (캐릭터 탭 줄 오른쪽 끝). */
const BACK_BTN = { x: 396, y: 8, w: 74 };
/** 누른 뒤 이만큼 움직여야 끌기로 본다. */
const DRAG_START = 3;

/** 공백 단위로 maxW 안에 줄바꿈. */
function wrap(s: string, maxW: number, sz: number) {
  const out: string[] = [];
  let line = "";
  for (const w of s.split(" ")) {
    const next = line ? `${line} ${w}` : w;
    if (line && textWidth(next, sz) > maxW) {
      out.push(line);
      line = w;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

function hit(p: LogicalPoint, x: number, y: number, w: number, h: number) {
  return p.x >= x && p.x < x + w && p.y >= y && p.y < y + h;
}

/** (cx,cy) 가운데에 장비 그림. 그림 파일이 없으면 큰 칸은 조각 모양, 작은 칸(16 이하)은 색 사각형 자리표시. */
function drawIcon(cx: number, cy: number, box: number, d: EquipDef, alpha = 1) {
  const g = pen();
  g.save();
  g.globalAlpha = alpha;
  const x = cx - Math.floor(box / 2);
  const y = cy - Math.floor(box / 2);
  if (!img(x, y, box, box, itemImage(d.id))) {
    if (box <= 16) R(x, y, box, box, d.color);
    else {
      const cells = PIECES[d.id]?.cells ?? [[0, 0]];
      const cols = Math.max(...cells.map((c) => c[0])) + 1;
      const rows = Math.max(...cells.map((c) => c[1])) + 1;
      const cs = Math.min(12, Math.floor(box / Math.max(cols, rows)));
      piece(cx - Math.floor((cols * cs) / 2) + 1, cy - Math.floor((rows * cs) / 2) + 1, cs, cells, d.color);
    }
  }
  g.restore();
}

interface Drag {
  uid: string;
  /** 슬롯에서 끌기 시작했으면 그 슬롯, 목록에서면 null. */
  from: SlotId | null;
  start: LogicalPoint;
  /** DRAG_START 넘게 움직였는지. false면 뗄 때 클릭으로 처리. */
  moving: boolean;
}

export function createP02Scene(): Scene {
  let current = 0;
  let slot: SlotId = "w0";
  let filter = 0;
  let focus: "slot" | "list" = "slot";
  /** 목록에서 고른 장비 uid. null이면 상세는 슬롯의 장비. */
  let picked: string | null = null;
  let scroll = 0;
  let mouse: LogicalPoint = { x: -1, y: -1 };
  let drag: Drag | null = null;
  /** 장비를 바꾸면 무기 적성 액티브 코어가 빠질 때: 확인 창 (2026-11-07) */
  let pending: { run: () => void; lost: { char: string; uids: number[]; names: string[] }[] } | null = null;
  const MODAL = { x: 110, y: 78, w: 260, h: 112 };
  const MODAL_OK = { x: 150, y: 168, w: 80 };
  const MODAL_NO = { x: 250, y: 168, w: 80 };

  const char = () => PARTY[current].name;
  const moving = () => (drag?.moving ? drag : null);

  function charTabRect(i: number) {
    return { x: 10 + i * 60, y: 6, w: 56, h: 18 };
  }
  function filterRect(i: number) {
    return { x: ROW_X + i * 23, y: 45, w: 22, h: 13 };
  }
  function slotAt(p: LogicalPoint): SlotId | null {
    return SLOT_ORDER.find((s) => {
      const r = SLOT_RECT[s];
      return hit(p, r.x, r.y, r.w, r.h);
    }) ?? null;
  }
  /** 이 칸에 보이는 장비의 슬롯. 비활성 무기 2 칸은 무기 1의 양손 무기를 가리킨다. */
  function ownerSlot(s: SlotId): SlotId {
    return s === "w1" && isBlocked(getLoadout(char()), "w1") ? "w0" : s;
  }

  /** 필터에 맞는 보유 장비. 이 캐릭터가 낀 것 → 빈 것 → 남이 낀 것 순. */
  function candidates(): OwnedEquip[] {
    const kind = FILTERS[filter].kind;
    const rank = (o: OwnedEquip) => {
      const w = wearerOf(o.uid);
      return !w ? 1 : w.char === char() ? 0 : 2;
    };
    return ownedEquips().filter((o) => !kind || o.def.kind === kind).sort((a, b) => rank(a) - rank(b));
  }

  function rowAt(p: LogicalPoint): OwnedEquip | null {
    const list = candidates();
    for (let i = 0; i < ROWS; i++) {
      const o = list[scroll + i];
      if (o && hit(p, ROW_X, ROW_Y0 + i * ROW_DY, ROW_W, 17)) return o;
    }
    return null;
  }

  /** 상세·미리보기 대상: 끄는 장비 → 마우스 아래 행 → 목록에서 고른 것 → 마우스 아래 슬롯 → 고른 슬롯. */
  function focused(): OwnedEquip | null {
    const d = moving();
    if (d) return equipByUid(d.uid) ?? null;
    const row = rowAt(mouse);
    if (row) return row;
    if (picked) return equipByUid(picked) ?? null;
    const lo = getLoadout(char());
    const over = slotAt(mouse);
    const uid = (over && lo[ownerSlot(over)]) || lo[ownerSlot(slot)];
    return uid ? equipByUid(uid) ?? null : null;
  }

  /** 슬롯을 지정하지 않고 장착할 때 들어갈 칸: 고른 슬롯 → 빈 칸 → 첫 칸. */
  function autoSlot(o: OwnedEquip): SlotId {
    if (SLOT_INFO[slot].kind === o.def.kind) return slot;
    const lo = getLoadout(char());
    const fit = SLOT_ORDER.filter((s) => SLOT_INFO[s].kind === o.def.kind && !isLocked(char(), s));
    return fit.find((s) => !lo[s] && !isBlocked(lo, s)) ?? fit[0];
  }

  /** 대상 장비에 대한 동작. 끄는 중이면 마우스 아래 슬롯 기준, 아니면 낀 장비는 해제·안 낀 장비는 장착. */
  function actionFor(o: OwnedEquip | null) {
    if (!o) return null;
    const w = wearerOf(o.uid);
    const mine = w?.char === char() ? w : null;
    const off = () => ({ kind: "off" as const, slot: mine!.slot, reason: unequipBlockReason(char(), mine!.slot), after: simulateUnequip(char(), mine!.slot) });
    const d = moving();
    let target: SlotId;
    if (d) {
      const over = slotAt(mouse);
      if (!over) return d.from && mine ? off() : null;
      if (ownerSlot(over) === d.from) return null;
      target = over;
    } else {
      if (mine) return off();
      target = autoSlot(o);
    }
    const reason = equipBlockReason(char(), target, o.uid);
    return { kind: "on" as const, slot: target, reason, after: reason ? null : simulateEquip(char(), target, o.uid) };
  }

  /** 바뀐 장착표들로 판에서 빠질 코어 (캐릭터별) */
  function lossOf(after: { char: string; lo: Record<string, string | undefined> }[]) {
    return after
      .map(({ char: c, lo }) => {
        const lost = coresLostWith(c, weaponTypesOfLoadout(lo));
        return { char: c, uids: lost.map((p) => p.uid), names: lost.map((p) => skillOfCore(p.itemId)?.name ?? p.itemId) };
      })
      .filter((x) => x.uids.length);
  }
  /** 장비 동작의 결과 장착표 (다른 캐릭터에게서 가져오면 그쪽도) */
  function afterOf(o: OwnedEquip | null, a: NonNullable<ReturnType<typeof actionFor>>) {
    const out = [{ char: char(), lo: a.kind === "off" ? simulateUnequip(char(), a.slot) : simulateEquip(char(), a.slot, o!.uid) }];
    const w = o && a.kind === "on" ? wearerOf(o.uid) : null;
    if (w && w.char !== char()) out.push({ char: w.char, lo: simulateUnequip(w.char, w.slot) });
    return out;
  }
  /** 코어가 빠지면 확인 창을 띄우고, 아니면 바로 실행 */
  function guarded(run: () => void, after: { char: string; lo: Record<string, string | undefined> }[]) {
    const lost = lossOf(after);
    if (!lost.length) return run();
    pending = { run, lost };
  }
  function act(o: OwnedEquip | null) {
    const a = actionFor(o);
    if (!a || a.reason) return;
    guarded(() => (a.kind === "off" ? unequip(char(), a.slot) : equip(char(), a.slot, o!.uid)), afterOf(o, a));
  }
  function safeUnequip(s: SlotId) {
    if (unequipBlockReason(char(), s)) return;
    guarded(() => unequip(char(), s), [{ char: char(), lo: simulateUnequip(char(), s) }]);
  }
  function confirmPending(ok: boolean) {
    if (ok && pending) {
      pending.run();
      for (const l of pending.lost) removeCores(l.char, l.uids);
    }
    pending = null;
  }

  function selectSlot(s: SlotId) {
    slot = s;
    picked = null;
    scroll = 0;
    filter = FILTERS.findIndex((f) => f.kind === SLOT_INFO[s].kind);
  }

  function switchChar(i: number) {
    current = (i + PARTY.length) % PARTY.length;
    picked = null;
    scroll = 0;
    focus = "slot";
    drag = null;
  }

  function moveCursor(d: number) {
    const list = candidates();
    if (!list.length) return;
    const now = list.findIndex((o) => o.uid === picked);
    const i = now < 0 ? 0 : Math.max(0, Math.min(list.length - 1, now + d));
    picked = list[i].uid;
    if (i < scroll) scroll = i;
    if (i >= scroll + ROWS) scroll = i - ROWS + 1;
  }

  function enterList() {
    if (!candidates().length) return;
    focus = "list";
    picked = getLoadout(char())[slot] ?? null;
    moveCursor(0);
  }

  function onPointerDown(p: LogicalPoint, button: number) {
    if (pending) {
      if (button === 0 && hit(p, MODAL_OK.x, MODAL_OK.y, MODAL_OK.w, 14)) confirmPending(true);
      else if (button === 0 && hit(p, MODAL_NO.x, MODAL_NO.y, MODAL_NO.w, 14)) confirmPending(false);
      return;
    }
    drag = null;
    const over = slotAt(p);
    if (over) {
      const from = ownerSlot(over);
      if (button === 2) safeUnequip(from);
      else if (button === 0) {
        const uid = getLoadout(char())[from];
        selectSlot(over);
        focus = "slot";
        if (uid) drag = { uid, from, start: p, moving: false };
      }
      return;
    }
    if (button !== 0) return;
    for (let i = 0; i < PARTY.length; i++) {
      const r = charTabRect(i);
      if (hit(p, r.x, r.y, r.w, r.h)) return switchChar(i);
    }
    if (hit(p, BACK_BTN.x, BACK_BTN.y, BACK_BTN.w, 14)) return goTo("p01", char());
    for (let i = 0; i < FILTERS.length; i++) {
      const r = filterRect(i);
      if (hit(p, r.x, r.y, r.w, r.h)) {
        filter = i;
        scroll = 0;
        picked = null;
        return;
      }
    }
    const row = rowAt(p);
    if (row) {
      drag = { uid: row.uid, from: null, start: p, moving: false };
      return;
    }
    if (hit(p, ACT_BTN.x, ACT_BTN.y, ACT_BTN.w, 14)) act(focused());
  }

  function onPointerMove(p: LogicalPoint) {
    mouse = p;
    if (drag && !drag.moving && Math.max(Math.abs(p.x - drag.start.x), Math.abs(p.y - drag.start.y)) >= DRAG_START) drag.moving = true;
  }

  function onPointerUp(p: LogicalPoint, button: number) {
    if (button !== 0 || !drag) return;
    mouse = p;
    const d = drag;
    if (!d.moving) {
      drag = null;
      // 끌지 않고 뗐으면 클릭. 목록 행: 고르기, 고른 행을 다시 클릭하면 장착/해제.
      if (d.from) return;
      if (picked === d.uid) act(equipByUid(d.uid) ?? null);
      else picked = d.uid;
      focus = "list";
      return;
    }
    const o = equipByUid(d.uid) ?? null;
    const reason = actionFor(o)?.reason;
    const over = slotAt(p);
    act(o);
    drag = null;
    // 놓지 못했으면 그 칸과 장비를 골라 둔다 → 상세에 불가 이유가 남는다.
    if (reason && over) {
      slot = over;
      picked = d.uid;
    }
  }

  function onKeyDown(k: string) {
    if (pending) {
      if (k === "Enter" || k === "z" || k === "Z") confirmPending(true);
      else if (k === "Escape" || k === "x" || k === "X") confirmPending(false);
      return;
    }
    if (k === "q" || k === "Q" || k === "PageUp") return switchChar(current - 1);
    if (k === "e" || k === "E" || k === "PageDown") return switchChar(current + 1);
    if (focus === "slot") {
      const nav = SLOT_NAV[slot];
      if (k === "ArrowLeft") selectSlot(nav[0]);
      else if (k === "ArrowRight") selectSlot(nav[1]);
      else if (k === "ArrowUp") selectSlot(nav[2]);
      else if (k === "ArrowDown") selectSlot(nav[3]);
      else if (k === "Enter" || k === " " || k === "z" || k === "Z") enterList();
      else if (k === "x" || k === "X" || k === "Delete" || k === "Backspace") safeUnequip(ownerSlot(slot));
    } else {
      if (k === "ArrowUp") moveCursor(-1);
      else if (k === "ArrowDown") moveCursor(1);
      else if (k === "Enter" || k === " " || k === "z" || k === "Z") {
        act(picked ? equipByUid(picked) ?? null : null);
        focus = "slot";
        picked = null;
      } else if (k === "Escape" || k === "x" || k === "X" || k === "Backspace") {
        focus = "slot";
        picked = null;
      }
    }
  }

  function onWheel(dy: number) {
    const n = candidates().length;
    scroll = Math.max(0, Math.min(Math.max(0, n - ROWS), scroll + (dy > 0 ? 1 : -1)));
  }

  function drawCharTabs() {
    PARTY.forEach((a, i) => {
      const r = charTabRect(i);
      R(r.x, r.y, r.w, r.h, i === current ? C.gold : C.woodL);
      R(r.x + 4, r.y + 3, 12, 12, a.color);
      T(r.x + 20, r.y + 13, a.name, 8, C.woodD);
    });
  }

  function drawSlot(s: SlotId) {
    const lo = getLoadout(char());
    const r = SLOT_RECT[s];
    const cx = r.x + Math.floor(r.w / 2);
    const cy = r.y + Math.floor(r.h / 2) + 1;
    const box = Math.min(r.w - 8, 40);
    const blocked = isBlocked(lo, s);
    const locked = isLocked(char(), s);
    const d = moving();
    const dragged = d ? equipByUid(d.uid) ?? null : null;
    R(r.x, r.y, r.w, r.h, blocked || locked ? C.cellLocked : s === slot && !d ? C.listRowSel : C.listRow);
    // 끄는 동안: 맞는 칸만 테두리, 마우스 아래 칸은 놓을 수 있으면 흰색·없으면 빨강 (가방 그리드와 같은 규칙).
    if (d) {
      const fits = dragged?.def.kind === SLOT_INFO[s].kind && !locked;
      if (slotAt(mouse) === s) R(r.x, r.y, r.w, r.h, "none", `stroke='${actionFor(dragged)?.reason ? C.hp : C.txt}'`);
      else if (fits) R(r.x, r.y, r.w, r.h, "none", `stroke='${C.woodL}'`);
    } else if (s === slot) R(r.x, r.y, r.w, r.h, "none", `stroke='${focus === "slot" ? C.gold : C.woodL}'`);
    T(r.x + 3, r.y + 9, SLOT_INFO[s].label, 7, blocked || locked ? C.cellExt : C.sub);
    if (locked) {
      T(cx, cy + 3, "잠김", 7, C.cellExt, "middle");
      return;
    }
    if (blocked) {
      // 양손 무기가 무기 1과 함께 쓰는 칸: 같은 그림을 흐리게.
      drawIcon(cx, cy, box, equipByUid(lo.w0!)!.def, 0.3);
      T(cx, r.y + r.h - 4, "착용 불가", 7, C.cellExt, "middle");
      return;
    }
    const e = lo[s] ? equipByUid(lo[s]!)?.def : undefined;
    if (!e) return;
    drawIcon(cx, cy, box, e, d?.uid === lo[s] ? 0.3 : 1);
    T(cx, r.y + r.h - 4, fitText(e.name, r.w - 4, 7), 7, C.txt, "middle");
    if (e.hands === 2) T(r.x + r.w - 3, r.y + 9, "양손", 7, C.gold, "end");
  }

  function drawDetail() {
    W(10, 180, 164, 82, "");
    const o = focused();
    if (!o) {
      const text = isLocked(char(), slot) ? `${SLOT_INFO[slot].label} 칸은 코어로 열린다` : "목록에서 장비를 끌어 칸에 놓는다";
      wrap(text, 148, 7).forEach((l, i) => T(16, 196 + i * 12, l, 7, C.sub));
      return;
    }
    const d = o.def;
    const a = actionFor(o);
    drawIcon(24, 194, 16, d);
    T(36, 195, fitText(d.name, 132, 9), 9, C.gold);
    const kindLine = d.hands ? `${d.type} · ${d.hands === 2 ? "양손" : "한손"}` : d.kind === "bag" ? `${d.type} · ${BAG_COLS}×${bagRowsOfItem(d.id)}` : d.type;
    T(36, 206, kindLine, 7, C.sub);
    T(16, 219, fitText(modsText(d.mods) || "보정 없음", 152, 8), 8, C.txt);
    if (a?.reason) {
      wrap(`장착 불가: ${a.reason}`, 152, 7).slice(0, 3).forEach((l, i) => T(16, 231 + i * 11, l, 7, C.hp));
      return;
    }
    const lost = a ? lossOf(afterOf(o, a)) : [];
    if (lost.length) {
      const n = lost.reduce((s, l) => s + l.uids.length, 0);
      wrap(`주의: 무기 스킬 코어 ${n}개가 해제된다`, 152, 7).slice(0, 2).forEach((l, i) => T(16, 231 + i * 11, l, 7, C.hp));
      return;
    }
    // 제작 보너스가 있으면 설명 대신 보너스 (docs/crafting.md 5장)
    const bonus = ownedByUid(o.uid)?.bonuses ?? [];
    if (bonus.length) T(16, 231, fitText("★ " + bonus.join(" · "), 152, 7), 7, C.good);
    else wrap(d.desc, 152, 7).slice(0, 2).forEach((l, i) => T(16, 231 + i * 11, l, 7, C.sub));
    const w = wearerOf(o.uid);
    if (w && w.char !== char()) T(16, 254, `${w.char}에게서 가져온다`, 7, C.sub);
  }

  // 장착 미리보기: 현재 → 이후 (초록 상승, 빨강 하락).
  function drawStats() {
    const a = PARTY[current];
    W(178, 180, 136, 82, "");
    const now = equipBonus(getLoadout(char()));
    const act = actionFor(focused());
    const next = act?.after ? equipBonus(act.after) : null;
    T(184, 193, "능력치", 7, C.sub);
    if (next) T(308, 193, act?.kind === "off" ? "해제 후" : "장착 후", 7, C.sub, "end");
    STAT_ORDER.forEach((k, i) => {
      const y = 207 + i * 14;
      const v0 = a[k] + now[k];
      T(184, y, STAT_INFO[k].name, 8, C.sub);
      T(236, y, String(v0), 8, C.txt, "end");
      if (!next) {
        if (now[k]) T(240, y, `${now[k] > 0 ? "+" : "−"}${Math.abs(now[k])}`, 7, now[k] > 0 ? C.good : C.hp);
        return;
      }
      const v1 = a[k] + next[k];
      const col = v1 > v0 ? C.good : v1 < v0 ? C.hp : C.txt;
      T(240, y, "→", 8, C.sub);
      T(272, y, String(v1), 8, col, "end");
      if (v1 !== v0) T(308, y, `${v1 > v0 ? "▲" : "▼"}${Math.abs(v1 - v0)}`, 7, col, "end");
    });
  }

  function drawList() {
    const list = candidates();
    W(320, 28, 150, 234, "장비 목록");
    FILTERS.forEach((f, i) => {
      const r = filterRect(i);
      R(r.x, r.y, r.w, r.h, i === filter ? C.gold : C.woodL);
      T(r.x + r.w / 2, r.y + 10, f.label, 7, C.woodD, "middle");
    });
    if (!list.length) T(ROW_X, ROW_Y0 + 12, "가진 장비가 없다", 8, C.sub);
    const hov = moving() ? null : rowAt(mouse);
    for (let i = 0; i < ROWS; i++) {
      const o = list[scroll + i];
      if (!o) break;
      const y = ROW_Y0 + i * ROW_DY;
      R(ROW_X, y, ROW_W, 17, o.uid === picked || o.uid === hov?.uid ? C.listRowSel : C.listRow);
      if (o.uid === picked && focus === "list") R(ROW_X, y, ROW_W, 17, "none", `stroke='${C.gold}'`);
      const w = wearerOf(o.uid);
      const mine = w?.char === char();
      const blocked = !mine && !!equipBlockReason(char(), autoSlot(o), o.uid);
      const tag = mine ? "E" : w ? w.char : o.def.hands === 2 ? "양손" : "";
      const tagW = tag ? textWidth(tag, 7) + 3 : 0;
      drawIcon(ROW_X + 9, y + 8, 12, o.def, blocked || o.uid === moving()?.uid ? 0.35 : 1);
      T(ROW_X + 18, y + 12, fitText(o.def.name, ROW_W - 21 - tagW, 8), 8, blocked ? C.cellExt : C.txt);
      if (tag) T(ROW_X + ROW_W - 3, y + 12, tag, 7, mine ? C.good : w ? C.sub : C.gold, "end");
    }
    // 목록이 넘치면 오른쪽에 2px 스크롤 막대.
    if (list.length > ROWS) {
      const trackH = ROWS * ROW_DY - 2;
      R(ROW_X + ROW_W + 2, ROW_Y0, 2, trackH, C.cell);
      R(ROW_X + ROW_W + 2, ROW_Y0 + Math.round((trackH * scroll) / list.length), 2, Math.round((trackH * ROWS) / list.length), C.gold);
    }
    T(ROW_X, 225, "끌어 놓기 · 칸 밖으로 끌면 해제", 7, C.sub);
    T(ROW_X, 237, "우클릭·X 해제 · Q/E 캐릭터", 7, C.sub);
    const o = focused();
    if (!o || moving()) return;
    const a = actionFor(o);
    if (a?.reason) {
      R(ACT_BTN.x, ACT_BTN.y, ACT_BTN.w, 14, C.cellLocked);
      T(ACT_BTN.x + ACT_BTN.w / 2, ACT_BTN.y + 10, "장착", 8, C.cellExt, "middle");
    } else btn(ACT_BTN.x, ACT_BTN.y, ACT_BTN.w, a?.kind === "off" ? "해제" : "장착", focus === "list");
  }

  function draw() {
    R(0, 0, 480, 270, C.screenBg);
    drawCharTabs();
    btn(BACK_BTN.x, BACK_BTN.y, BACK_BTN.w, "◀ 스테이터스");
    W(10, 28, 304, 148, "");
    SLOT_ORDER.forEach(drawSlot);
    drawDetail();
    drawStats();
    drawList();
    const d = moving();
    const e = d && equipByUid(d.uid);
    if (e) drawIcon(mouse.x, mouse.y, 32, e.def, 0.85);
    if (pending) drawConfirm();
  }
  function drawConfirm() {
    const p = pending!;
    R(0, 0, 480, 270, "#000000", "opacity='.55'");
    W(MODAL.x, MODAL.y, MODAL.w, MODAL.h, "스킬 코어 해제");
    T(MODAL.x + 10, MODAL.y + 30, "이 무기가 없으면 쓸 수 없는 코어가 해제된다.", 7, C.txt);
    let y = MODAL.y + 46;
    for (const l of p.lost.slice(0, 4)) {
      T(MODAL.x + 10, y, fitText(`${l.char}: ${l.names.join(", ")}`, MODAL.w - 20, 7), 7, C.hp);
      y += 11;
    }
    T(MODAL.x + 10, MODAL.y + 84, "해제된 코어는 창고로 돌아간다.", 7, C.sub);
    btn(MODAL_OK.x, MODAL_OK.y, MODAL_OK.w, "바꾸기", true);
    btn(MODAL_NO.x, MODAL_NO.y, MODAL_NO.w, "취소");
  }

  return {
    id: "p02",
    label: "P02 장비",
    draw,
    onEnter: () => {
      // P01 "장비 변경"으로 들어오면 P01에서 보던 캐릭터로.
      const name = takeNavChar();
      const i = PARTY.findIndex((a) => a.name === name);
      if (i >= 0) switchChar(i);
    },
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onKeyDown,
    onWheel,
  };
}
