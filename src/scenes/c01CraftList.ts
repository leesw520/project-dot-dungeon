// C01 제작 목록 — 작업대(H01)에서 들어오는 ListDetail 화면. 행을 클릭하면 선택만 되고,
// 오른쪽 '조합' 버튼을 눌러야 조합 단계(C02)로 넘어간다.
import { RECIPES, setActiveRecipe, slotHave, type Recipe, type RequiredSlot } from "../data/recipes";
import { APTITUDE, type CoreReq } from "../data/aptitude";
import { drawTempIcon } from "../render/tempIcon";
import { allStock, getCount } from "../data/inventory";
import { KIND_LABEL, PIECES, pieceColors, type ItemKind } from "../data/pieces";
import { goTo } from "../engine/nav";
import { hasLearned } from "../data/recipeBook";
import { coreRecipeOpen } from "../data/coreUnlock";
import { getLevel } from "../data/facilities";
import { skillOfCore } from "../data/skillCores";
import { C, R, T, W, btn, disc, piece, textWidth } from "../render/primitives";
import type { LogicalPoint, Scene } from "./types";

const TABS: Array<{ label: string; kind: ItemKind | null }> = [
  { label: "전체", kind: null },
  { label: "조합", kind: "compound" },
  { label: "사용", kind: "consumable" },
  { label: "장비", kind: "equipment" },
  { label: "코어", kind: "core" },
];

/** 코어 탭 하위 탭 (2026-11-08): 적성 종류별 */
const CORE_SUBS: Array<{ label: string; type: CoreReq["type"] }> = [
  { label: "직업 적성", type: "job" },
  { label: "무기 적성", type: "weapon" },
  { label: "속성 적성", type: "element" },
  { label: "하위 적성", type: "sub" },
  { label: "공용", type: "common" },
];
/** 이 적성 이름을 가진 직업들 (머리 행 옆 작은 글씨) */
function classesWithApt(apt: string): string[] {
  // 묶음 적성 "한손검/방패"처럼 "/"로 합친 이름은 각 무기를 가진 직업 (2026-11-09)
  const parts = apt.split("/");
  return Object.entries(APTITUDE).filter(([, a]) => parts.some((x) => [...a.weapons, ...a.elements, ...a.subs].includes(x))).map(([n]) => n);
}

export function createC01Scene(): Scene {
  let tabIndex = 0;
  let coreSub = 0;
  let selectedId: string | null = null;
  /** 목록이 길면 (코어 도안 100여 개) 휠로 스크롤 */
  let scroll = 0;
  const isCoreTab = () => TABS[tabIndex].kind === "core";
  const listY = () => (isCoreTab() ? 64 : 48);
  const visible = () => (isCoreTab() ? 7 : 8);
  const clampScroll = () => (scroll = Math.max(0, Math.min(scroll, rows().length - visible())));
  /** 펼친 적성 묶음 (코어 레시피는 적성마다 접기/펼치기, 처음엔 모두 접힘) */
  const opened = new Set<string>();

  function list(): Recipe[] {
    const kind = TABS[tabIndex].kind;
    // 제작 노트로 해금되는 레시피는 노트를 얻어 배운 뒤에만 보인다 (recipeBook.ts). 배우지 않은 것은 아예 안 보인다.
    // 스킬 코어는 레벨(직업·무기 코어) 또는 원정에서 한 번 얻기(속성·보조 코어)로 열린다 (data/coreUnlock.ts)
    const known = RECIPES.filter((r) => hasLearned(r.unlock) && (r.kind !== "core" || coreRecipeOpen(r.resultItemId)));
    if (kind === "core") return known.filter((r) => r.kind === "core" && (skillOfCore(r.resultItemId)?.req.type ?? "common") === CORE_SUBS[coreSub].type);
    return kind ? known.filter((r) => r.kind === kind) : known;
  }
  type Row = { kind: "head"; apt: string; n: number } | { kind: "recipe"; r: Recipe; sub: boolean };
  /** 화면 행: 코어가 아닌 레시피는 그대로, 코어 레시피는 적성 머리 행 아래에 (펼쳤을 때만). */
  function rows(): Row[] {
    const out: Row[] = [];
    const groups = new Map<string, Recipe[]>();
    for (const r of list()) {
      // 코어는 적성, 나머지는 레시피 묶음(중간재·포션·장비 · 한손검 …)으로 접는다
      const apt = r.kind === "core" ? skillOfCore(r.resultItemId)?.apt : r.group;
      if (!apt) {
        out.push({ kind: "recipe", r, sub: false });
        continue;
      }
      if (!groups.has(apt)) groups.set(apt, []);
      groups.get(apt)!.push(r);
    }
    for (const [apt, rs] of groups) {
      out.push({ kind: "head", apt, n: rs.length });
      if (opened.has(apt)) rs.forEach((r) => out.push({ kind: "recipe", r, sub: true }));
    }
    return out;
  }

  /** 작업대 레벨이 모자라 아직 못 만드는 레시피의 필요 레벨 (만들 수 있으면 0) */
  const benchNeed = (r: Recipe) => ((r.bench ?? 1) > getLevel("workshop") ? r.bench ?? 1 : 0);
  /** 묶음 머리 이름: 장비는 무기/방어구/장신구로 앞에 붙인다 */
  function headLabel(g: string) {
    const m = /^장비 · (.+)$/.exec(g);
    if (!m) return g;
    const t = m[1];
    const cat = ["방패", "갑옷", "옷"].includes(t) ? "방어구" : t === "반지" ? "장신구" : t === "가방" ? "가방" : "무기";
    return cat === t ? t : `${cat} · ${t}`;
  }

  function hitRect(p: LogicalPoint, x: number, y: number, w: number, h: number) {
    return p.x >= x && p.x < x + w && p.y >= y && p.y < y + h;
  }
  function tabRect(i: number) {
    return { x: 20 + i * 52, y: 26, w: 48, h: 14 };
  }
  function rowRect(i: number) {
    return { x: 20, y: listY() + i * 24, w: 270, h: 22 };
  }
  function subTabRect(i: number) {
    return { x: 20 + i * 54, y: 44, w: 52, h: 14 };
  }
  /** 필수 재료가 모두 있는가 (창고 기준) */
  const stock = () => allStock();
  const missing = (r: Recipe, st = stock()) => r.required.filter((sl) => slotHave(sl, st) < sl.count);
  function backRect() {
    return { x: 396, y: 10, w: 64, h: 12 };
  }
  /** 분해 화면(C04)으로 — 창고 아이템을 모아 한 번에 분해 */
  function salvageRect() {
    return { x: 326, y: 10, w: 64, h: 12 };
  }
  function craftButtonRect() {
    return { x: 312, y: 230, w: 136, h: 16 };
  }

  function onPointerDown(p: LogicalPoint, button: number) {
    if (button !== 0) return;
    const br = backRect();
    if (hitRect(p, br.x, br.y, br.w, br.h)) {
      goTo("h01");
      return;
    }
    const sr = salvageRect();
    if (hitRect(p, sr.x, sr.y, sr.w, sr.h)) {
      goTo("c04");
      return;
    }
    for (let i = 0; i < TABS.length; i++) {
      const r = tabRect(i);
      if (hitRect(p, r.x, r.y, r.w, r.h)) {
        tabIndex = i;
        scroll = 0;
        return;
      }
    }
    if (isCoreTab())
      for (let i = 0; i < CORE_SUBS.length; i++) {
        const r = subTabRect(i);
        if (hitRect(p, r.x, r.y, r.w, r.h)) {
          coreSub = i;
          scroll = 0;
          return;
        }
      }
    const items = list();
    const rs = rows();
    for (let i = 0; i < Math.min(visible(), rs.length - scroll); i++) {
      const r = rowRect(i);
      if (hitRect(p, r.x, r.y, r.w, r.h)) {
        const row = rs[i + scroll];
        if (row.kind === "head") {
          if (opened.has(row.apt)) opened.delete(row.apt);
          else opened.add(row.apt);
          clampScroll();
        } else selectedId = row.r.id;
        return;
      }
    }
    const sel = items.find((r) => r.id === selectedId);
    if (sel) {
      const cr = craftButtonRect();
      if (hitRect(p, cr.x, cr.y, cr.w, cr.h) && !benchNeed(sel) && !missing(sel).length) {
        setActiveRecipe(sel.id);
        goTo("c02");
      }
    }
  }

  function draw() {
    R(0, 0, 480, 270, C.screenBg);
    W(10, 8, 460, 254, "작업대");
    const br = backRect();
    R(br.x, br.y, br.w, br.h, C.woodL);
    T(br.x + br.w / 2, br.y + 10, "◀ 거점으로", 7, C.woodD, "middle");
    const sr = salvageRect();
    R(sr.x, sr.y, sr.w, sr.h, C.woodL);
    T(sr.x + sr.w / 2, sr.y + 10, "분해", 7, C.woodD, "middle");

    TABS.forEach((t, i) => {
      const r = tabRect(i);
      R(r.x, r.y, r.w, r.h, i === tabIndex ? C.gold : C.woodL);
      T(r.x + r.w / 2, r.y + 10, t.label, 8, C.woodD, "middle");
    });

    if (isCoreTab())
      CORE_SUBS.forEach((t, i) => {
        const r = subTabRect(i);
        R(r.x, r.y, r.w, r.h, i === coreSub ? C.listRowSel : C.listRow);
        T(r.x + r.w / 2, r.y + 10, t.label, 7, i === coreSub ? C.gold : C.sub, "middle");
      });

    const items = list();
    if (selectedId && !items.some((r) => r.id === selectedId)) selectedId = null;
    clampScroll();
    const st = stock();
    const rs = rows();
    const VIS = visible();
    rs.slice(scroll, scroll + VIS).forEach((it, i) => {
      const row = rowRect(i);
      if (it.kind === "head") {
        const open = opened.has(it.apt);
        R(row.x, row.y, row.w, row.h, C.woodD);
        R(row.x + 1, row.y + 1, row.w - 2, row.h - 2, open ? C.listRowSel : C.listRow);
        T(row.x + 8, row.y + 14, open ? "▼" : "▶", 7, C.gold);
        const core = isCoreTab() || list().find((r) => (r.kind === "core" ? skillOfCore(r.resultItemId)?.apt : r.group) === it.apt)?.kind === "core";
        const label = core ? `적성: ${it.apt}` : headLabel(it.apt);
        T(row.x + 22, row.y + 14, label, 8, C.gold);
        // 이 적성을 쓰는 직업 (직업 적성은 자기 자신이라 생략)
        if (core) {
          const who = classesWithApt(it.apt);
          if (who.length) T(row.x + 28 + textWidth(label, 8), row.y + 14, who.join("·"), 6, C.sub);
        }
        T(row.x + row.w - 10, row.y + 14, `${it.n}종`, 7, C.sub, "end");
        return;
      }
      const r = it.r;
      const ix = it.sub ? 10 : 0;
      const need = benchNeed(r);
      const lack = missing(r, st).length > 0;
      const off = !!need || lack; // 만들 수 없으면 회색
      R(row.x + ix, row.y, row.w - ix, row.h, r.id === selectedId ? C.listRowSel : off ? C.cellLocked : C.listRow);
      const def = PIECES[r.resultItemId];
      if (def) piece(row.x + ix + 6, row.y + 4, 7, def.cells, off ? C.cellExt : pieceColors(def));
      T(row.x + ix + 40, row.y + 14, r.name, 8, off ? C.sub : C.txt);
      if (need) T(row.x + row.w - 10, row.y + 14, `작업대 Lv ${need}`, 7, C.hp, "end");
      else if (lack) T(row.x + row.w - 10, row.y + 14, "재료 부족", 7, C.sub, "end");
      else T(row.x + row.w - 10, row.y + 14, `보유 ${getCount(r.resultItemId)}`, 7, C.sub, "end");
    });

    if (rs.length > VIS) {
      const trackH = VIS * 24 - 2, bh = Math.max(10, Math.round((trackH * VIS) / rs.length));
      R(292, listY(), 3, trackH, C.listRow);
      R(292, listY() + Math.round(((trackH - bh) * scroll) / (rs.length - VIS)), 3, bh, C.woodL);
    }
    W(300, 48, 160, 206, "정보", 1);
    const sel = items.find((r) => r.id === selectedId);
    if (!sel) {
      T(312, 70, "왼쪽 목록에서", 8, C.txt);
      T(312, 84, "제작할 아이템을", 8, C.txt);
      T(312, 98, "고르세요.", 8, C.txt);
      T(312, 124, `작업대 Lv ${getLevel("workshop")}`, 7, C.sub);
      return;
    }
    const def = PIECES[sel.resultItemId];
    if (def) piece(312, 64, 16, def.cells, pieceColors(def));
    T(312, 136, `[${KIND_LABEL[sel.kind]}]`, 7, C.sub);
    T(312, 150, sel.name, 9, C.gold);
    // 필요 재료: 원 4개 — 아이템이면 그 아이템 그림, 카테고리면 카테고리 글자. 없으면 X
    T(312, 170, "필요 재료", 7, C.sub);
    for (let i = 0; i < 4; i++) reqCircle(324 + i * 36, 194, sel.required[i], st);
    T(312, 224, `완성품 보유 ${getCount(sel.resultItemId)}개`, 7, C.sub);

    const need = benchNeed(sel);
    const lack = missing(sel, st).length > 0;
    if (need || lack) {
      const cr = craftButtonRect();
      R(cr.x, cr.y, cr.w, cr.h, C.cellLocked);
      T(cr.x + cr.w / 2, cr.y + 11, need ? `작업대 Lv ${need} 필요` : "재료 부족", 8, need ? C.hp : C.sub, "middle");
    } else btn(craftButtonRect().x, craftButtonRect().y, craftButtonRect().w, "조합", true);
  }

  /** 필요 재료 원 하나: 특정 아이템이면 그 아이템 그림, 카테고리·속성이면 글자. 창고에 모자라면 빨간 X */
  function reqCircle(cx: number, cy: number, slot: RequiredSlot | undefined, st: Array<{ itemId: string; count: number }>) {
    const r = 14;
    disc(cx, cy, r, C.woodD);
    disc(cx, cy, r - 1, slot ? C.panelIn : C.listRow);
    if (!slot) return;
    if (slot.itemId && PIECES[slot.itemId]) drawTempIcon(slot.itemId, cx - 10, cy - 10, 20);
    else T(cx, cy + 4, (slot.cat ?? "?").slice(0, 2), 8, C.txt, "middle");
    if (slot.count > 1) T(cx + r, cy + r + 2, `×${slot.count}`, 6, C.gold, "end");
    if (slotHave(slot, st) < slot.count)
      for (let k = -7; k <= 7; k++) {
        R(cx + k - 1, cy + k - 1, 2, 2, C.hp);
        R(cx + k - 1, cy - k - 1, 2, 2, C.hp);
      }
  }

  return {
    id: "c01", label: "C01 제작 목록", draw, onPointerDown,
    onWheel: (dy) => { scroll += dy > 0 ? 1 : -1; clampScroll(); },
  };
}
