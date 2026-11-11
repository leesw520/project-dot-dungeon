// C04 분해 (2026-11-08, docs/skill-cores.md 5장 · data/salvage.ts). 작업대(C01)의 "분해" 버튼으로 들어온다.
// 창고의 아이템을 여러 개 골라 한 번에 분해한다: 고르는 동안 오른쪽에 나올 재료를 미리 보여주고,
// "분해하기"를 누르면 완료 창(얻은 재료)이 뜬 뒤 창고에 들어간다. 사용 중(장착·판)·중요 아이템은 목록에 없다.
import { PIECES, pieceColors, type ItemKind } from "../data/pieces";
import { addItem, holderOf, ownedItems, removeUid, type OwnedItem } from "../data/inventory";
import { salvageYield } from "../data/salvage";
import { goTo } from "../engine/nav";
import { C, R, T, W, btn, fitText, piece } from "../render/primitives";
import type { LogicalPoint, Scene } from "./types";

const TABS: Array<{ label: string; kind: ItemKind | null }> = [
  { label: "전체", kind: null },
  { label: "소재", kind: "material" },
  { label: "조합", kind: "compound" },
  { label: "사용", kind: "consumable" },
  { label: "장비", kind: "equipment" },
  { label: "코어", kind: "core" },
];
const VISIBLE = 8;
const BACK = { x: 382, y: 10, w: 78, h: 12 };
const GO = { x: 312, y: 232, w: 136, h: 16 };
const OK = { x: 200, y: 196, w: 80, h: 16 };

export function createC04Scene(): Scene {
  let tab = 0;
  let scroll = 0;
  /** 보유 줄 uid → 고른 개수 */
  const picked = new Map<string, number>();
  /** 분해 완료 창에 보일 얻은 재료 (없으면 창 닫힘) */
  let result: Array<[string, number]> | null = null;
  let resultCount = 0;

  /** 분해할 수 있는 창고 줄 (사용 중·중요·분해 결과물 제외) */
  function rows(): OwnedItem[] {
    const kind = TABS[tab].kind;
    return ownedItems((o) => {
      const d = PIECES[o.itemId];
      return !!d && o.location === "warehouse" && o.count > 0 && !holderOf(o.uid) && salvageYield(o.itemId).length > 0 && (!kind || d.kind === kind);
    });
  }
  const clampScroll = () => (scroll = Math.max(0, Math.min(scroll, rows().length - VISIBLE)));
  const rowRect = (i: number) => ({ x: 20, y: 48 + i * 24, w: 270, h: 22 });
  const tabRect = (i: number) => ({ x: 20 + i * 45, y: 26, w: 42, h: 14 });
  const hit = (p: LogicalPoint, r: { x: number; y: number; w: number; h: number }) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

  /** 고른 것 전부를 분해하면 나오는 재료 합계 */
  function preview(): Array<[string, number]> {
    const sum = new Map<string, number>();
    for (const [uid, n] of picked) {
      const o = ownedItems((x) => x.uid === uid)[0];
      if (!o) continue;
      for (const [id, k] of salvageYield(o.itemId)) sum.set(id, (sum.get(id) ?? 0) + k * n);
    }
    return [...sum.entries()];
  }
  const pickedTotal = () => [...picked.values()].reduce((a, b) => a + b, 0);

  function salvage() {
    const gain = preview();
    let count = 0;
    for (const [uid, n] of picked) for (let i = 0; i < n; i++) if (removeUid(uid)) count++;
    gain.forEach(([id, n]) => addItem(id, n, "warehouse"));
    picked.clear();
    result = gain;
    resultCount = count;
    clampScroll();
  }

  function onPointerDown(p: LogicalPoint, button: number) {
    if (result) {
      if (hit(p, OK)) result = null; // 완료 창은 확인으로 닫는다
      return;
    }
    if (button === 0 && hit(p, BACK)) return goTo("c01");
    for (let i = 0; i < TABS.length; i++)
      if (button === 0 && hit(p, tabRect(i))) {
        tab = i;
        scroll = 0;
        return;
      }
    if (button === 0 && hit(p, GO) && pickedTotal() > 0) return salvage();
    const list = rows();
    for (let i = 0; i < Math.min(VISIBLE, list.length - scroll); i++) {
      if (!hit(p, rowRect(i))) continue;
      const o = list[i + scroll];
      const cur = picked.get(o.uid) ?? 0;
      // 클릭 +1 · 우클릭 −1
      const next = button === 2 ? cur - 1 : cur + 1;
      if (next <= 0) picked.delete(o.uid);
      else picked.set(o.uid, Math.min(o.count, next));
      return;
    }
  }

  function draw() {
    R(0, 0, 480, 270, C.screenBg);
    W(10, 8, 460, 254, "작업대 — 분해");
    R(BACK.x, BACK.y, BACK.w, BACK.h, C.woodL);
    T(BACK.x + BACK.w / 2, BACK.y + 10, "◀ 제작 목록", 7, C.woodD, "middle");
    TABS.forEach((t, i) => {
      const r = tabRect(i);
      R(r.x, r.y, r.w, r.h, i === tab ? C.gold : C.woodL);
      T(r.x + r.w / 2, r.y + 10, t.label, 8, C.woodD, "middle");
    });

    const list = rows();
    clampScroll();
    for (const uid of [...picked.keys()]) if (!ownedItems((x) => x.uid === uid).length) picked.delete(uid);
    list.slice(scroll, scroll + VISIBLE).forEach((o, i) => {
      const r = rowRect(i), d = PIECES[o.itemId], n = picked.get(o.uid) ?? 0;
      R(r.x, r.y, r.w, r.h, n ? C.listRowSel : C.listRow);
      piece(r.x + 6, r.y + 4, 7, d.cells, pieceColors(d));
      T(r.x + 40, r.y + 14, fitText(o.bonuses?.length ? `${d.name} ★${o.bonuses.length}` : d.name, 140, 8), 8, o.bonuses?.length ? C.gold : C.txt);
      T(r.x + r.w - 10, r.y + 14, n ? `선택 ${n} / ${o.count}` : `보유 ${o.count}`, 7, n ? C.gold : C.sub, "end");
    });
    if (!list.length) T(30, 70, "분해할 수 있는 아이템이 없다", 8, C.sub);
    if (list.length > VISIBLE) {
      const trackH = VISIBLE * 24 - 2, bh = Math.max(10, Math.round((trackH * VISIBLE) / list.length));
      R(292, 48, 3, trackH, C.listRow);
      R(292, 48 + Math.round(((trackH - bh) * scroll) / (list.length - VISIBLE)), 3, bh, C.woodL);
    }
    T(20, 252, "클릭: 선택 +1 · 우클릭: −1 · 휠: 스크롤", 7, C.sub);

    // 오른쪽: 분해하면 나오는 것 미리보기
    W(300, 48, 160, 206, "분해 결과 미리보기", 1);
    const pv = preview(), total = pickedTotal();
    T(312, 70, total ? `고른 아이템 ${total}개` : "왼쪽에서 분해할 것을 고르세요.", 7, total ? C.txt : C.sub);
    pv.slice(0, 7).forEach(([id, n], i) => {
      const d = PIECES[id], y = 82 + i * 20;
      R(310, y, 140, 18, C.panelIn);
      piece(314, y + 3, 6, d.cells, pieceColors(d));
      T(340, y + 12, d.name, 7, C.txt);
      T(446, y + 12, `+${n}`, 8, C.good, "end");
    });
    T(312, 226, "코어 → 코어 · 장비 → 장비 재료 · 그 외 → 촉매", 6, C.sub);
    if (total) btn(GO.x, GO.y, GO.w, "분해하기", true);
    else { R(GO.x, GO.y, GO.w, GO.h, C.cellLocked); T(GO.x + GO.w / 2, GO.y + 11, "분해하기", 8, C.sub, "middle"); }

    // 분해 완료 창
    if (result) {
      R(0, 0, 480, 270, C.screenBg, "opacity='.75'");
      W(110, 50, 260, 170, "분해 완료", 1);
      T(120, 76, `${resultCount}개를 분해해 얻었다 — 창고에 넣었다`, 7, C.txt);
      result.slice(0, 5).forEach(([id, n], i) => {
        const d = PIECES[id], y = 86 + i * 20;
        R(120, y, 240, 18, C.panelIn);
        piece(126, y + 3, 6, d.cells, pieceColors(d));
        T(152, y + 12, d.name, 8, C.txt);
        T(354, y + 12, `+${n}`, 8, C.good, "end");
      });
      btn(OK.x, OK.y, OK.w, "확인", true);
    }
  }

  return {
    id: "c04", label: "C04 분해", draw, onPointerDown,
    onEnter: () => { picked.clear(); result = null; },
    onWheel: (dy) => { if (!result) { scroll += dy > 0 ? 1 : -1; clampScroll(); } },
  };
}
