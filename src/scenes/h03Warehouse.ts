// H03 창고 — 2026-11-01 2차 수정. 드롭다운 호버 하이라이트, 더 작은 필터 팝업(임시값 편집 후
// '완료'로만 적용), 목록 줄 수 확대, 상세 패널을 한 줄짜리 라벨+값 폼으로 다시 짰다.
// 2026-11-02: 보유 목록(inventory.ts) 한 줄 = 목록 한 줄. 장비·코어는 개체마다 따로 보이고,
// 장착·배치 중이면 쓰는 캐릭터 이름이 붙는다. C03 "창고에서 보기"로 들어오면 그 줄을 골라 둔다.
import { KIND_LABEL, PIECES, pieceColors, elementLabels, gradeLabel, type Grade, type ItemKind, type PieceDef } from "../data/pieces";
import { ELEMENT_DEFS, ELEMENT_ORDER, type Category, type ElementId } from "../data/itemTaxonomy";
import { holderOf, isIndividual, ownedByUid, ownedItems } from "../data/inventory";
import { goTo, takeNavItem } from "../engine/nav";
import { registerSave } from "../engine/save";
import { C, R, T, W, btn, piece } from "../render/primitives";
import type { LogicalPoint, Scene } from "./types";

/** 거점으로 돌아가기 (창 제목 띠 오른쪽) */
const BACK_BTN = { x: 396, y: 9, w: 70, h: 14 };

const TABS: Array<{ label: string; kind: ItemKind | null }> = [
  { label: "전체", kind: null },
  { label: "소재", kind: "material" },
  { label: "조합", kind: "compound" },
  { label: "사용", kind: "consumable" },
  { label: "장비", kind: "equipment" },
  { label: "코어", kind: "core" },
  { label: "중요", kind: "key" }, // 중요 아이템은 창고에서만 보인다 (docs/items.md 1장)
];

type SortKey = "acquired" | "dex" | "size" | "count";
const SORTS: Array<{ label: string; key: SortKey }> = [
  { label: "입수순", key: "acquired" },
  { label: "도감순", key: "dex" },
  { label: "사이즈순", key: "size" },
  { label: "보유순", key: "count" },
];

/** 정렬 기준·방향 — 세이브에 남겨 다음에 창고를 열 때 그대로 (2026-11-08) */
const sortPref: { key: SortKey; desc: boolean } = { key: "acquired", desc: false };
registerSave("warehouseSort", () => sortPref, (v) => {
  const d = v as Partial<typeof sortPref>;
  if (d.key && SORTS.some((x) => x.key === d.key)) sortPref.key = d.key;
  sortPref.desc = !!d.desc;
});

const ANY = "__ANY__";
const ALL_CATEGORIES: string[] = [...new Set(Object.values(PIECES).flatMap((d) => d.categories))];
const MAX_SIZE = Math.max(...Object.values(PIECES).map((d) => d.cells.length));
const GRADES: Grade[] = ["common", "rare", "epic", "legend"];

type DropdownId = "sort" | "category" | "grade" | "element";
type Row = { uid: string; def: PieceDef; count: number; acquiredSeq: number; holder: string | null };

const LIST_X = 20;
const LIST_Y = 60;
const LIST_W = 254;
const ROW_H = 18;
const VISIBLE_ROWS = 11;

interface FilterValues {
  category: string;
  grade: string;
  element: string;
  size: number;
}
function freshFilter(): FilterValues {
  return { category: ANY, grade: ANY, element: ANY, size: 0 };
}

export function createH03Scene(): Scene {
  let tabIndex = 0;
  let selectedUid: string | null = null;
  let filterOpen = false;
  let openDropdown: DropdownId | null = null;
  let hoverOptionIndex: number | null = null;
  let scroll = 0;
  let lastPointer: LogicalPoint = { x: 0, y: 0 };

  const applied: FilterValues = freshFilter(); // 실제 목록에 쓰이는 값
  let draft: FilterValues = freshFilter(); // 필터 창 안에서만 편집되는 값 — '완료'를 눌러야 applied로 넘어간다

  function filterActive() {
    return applied.category !== ANY || applied.grade !== ANY || applied.element !== ANY || applied.size !== 0;
  }

  function rows(): Row[] {
    const kind = TABS[tabIndex].kind;
    // TODO(spec): 가방(던전 반입) 칸이 생기면 위치(창고/가방) 탭 또는 표시를 붙인다.
    let list: Row[] = ownedItems().map((o) => ({ uid: o.uid, def: PIECES[o.itemId], count: o.count, acquiredSeq: o.acquiredSeq, holder: holderOf(o.uid) }));
    if (kind) list = list.filter((r) => r.def.kind === kind);
    if (applied.category !== ANY) list = list.filter((r) => r.def.categories.includes(applied.category as Category));
    if (applied.grade !== ANY) list = list.filter((r) => r.def.grade === applied.grade);
    if (applied.element !== ANY) list = list.filter((r) => r.def.elements.includes(applied.element as ElementId));
    if (applied.size !== 0) list = list.filter((r) => r.def.cells.length === applied.size);

    const cmp: Record<SortKey, (a: Row, b: Row) => number> = {
      acquired: (a, b) => a.acquiredSeq - b.acquiredSeq,
      dex: (a, b) => a.def.dex - b.def.dex,
      size: (a, b) => a.def.cells.length - b.def.cells.length,
      count: (a, b) => a.count - b.count,
    };
    // 오름차순 기본, 내림차순이면 뒤집는다 (같은 값은 입수순)
    const dir = sortPref.desc ? -1 : 1;
    return list.sort((a, b) => dir * (cmp[sortPref.key](a, b) || a.acquiredSeq - b.acquiredSeq));
  }

  function clampScroll(total: number) {
    scroll = Math.max(0, Math.min(scroll, Math.max(0, total - VISIBLE_ROWS)));
  }

  function hitRect(p: LogicalPoint, x: number, y: number, w: number, h: number) {
    return p.x >= x && p.x < x + w && p.y >= y && p.y < y + h;
  }
  function tabRect(i: number) {
    return { x: 20 + i * 38, y: 26, w: 34, h: 14 };
  }
  function sortComboRect() {
    return { x: 20, y: 42, w: 82, h: 14 };
  }
  /** 정렬 방향 버튼 (▲ 오름차순 / ▼ 내림차순) */
  function sortDirRect() {
    return { x: 104, y: 42, w: 14, h: 14 };
  }
  function filterButtonRect() {
    return { x: 122, y: 42, w: 50, h: 14 };
  }
  function scrollUpRect() {
    return { x: LIST_X + LIST_W + 4, y: LIST_Y, w: 14, h: 14 };
  }
  function scrollDownRect() {
    return { x: LIST_X + LIST_W + 4, y: LIST_Y + VISIBLE_ROWS * ROW_H - 14, w: 14, h: 14 };
  }
  function rowRect(i: number) {
    return { x: LIST_X, y: LIST_Y + i * ROW_H, w: LIST_W, h: ROW_H - 2 };
  }

  function dropdownOptions(id: DropdownId): Array<{ value: string; label: string }> {
    if (id === "sort") return SORTS.map((s) => ({ value: s.key, label: s.label }));
    if (id === "category") return [{ value: ANY, label: "전체" }, ...ALL_CATEGORIES.map((c) => ({ value: c, label: c }))];
    if (id === "grade") return [{ value: ANY, label: "전체" }, ...GRADES.map((g) => ({ value: g, label: gradeLabel(g) }))];
    return [
      { value: ANY, label: "전체" },
      ...ELEMENT_ORDER.map((e) => ({ value: e as string, label: ELEMENT_DEFS[e].label })),
    ];
  }
  const FILTER_COMBO_Y: Record<"category" | "grade" | "element", number> = { category: 66, grade: 86, element: 106 };
  function filterComboRect(id: "category" | "grade" | "element") {
    return { x: 180, y: FILTER_COMBO_Y[id], w: 100, h: 14 };
  }
  function dropdownAnchor(id: DropdownId): { x: number; y: number; w: number } {
    if (id === "sort") {
      const r = sortComboRect();
      return { x: r.x, y: r.y + r.h, w: r.w };
    }
    const r = filterComboRect(id);
    return { x: r.x, y: r.y + r.h, w: r.w };
  }
  // 카테고리가 늘어나 한 줄로는 화면 밖으로 넘친다 — 10줄을 넘으면 옆 칸으로 꺾는다
  const DROPDOWN_MAX_ROWS = 10;
  function dropdownLayout(id: DropdownId) {
    const n = dropdownOptions(id).length;
    const cols = Math.ceil(n / DROPDOWN_MAX_ROWS);
    return { cols, rows: Math.ceil(n / cols) };
  }
  function dropdownOptionRect(id: DropdownId, i: number) {
    const a = dropdownAnchor(id);
    const { rows } = dropdownLayout(id);
    return { x: a.x + Math.floor(i / rows) * a.w, y: a.y + (i % rows) * 14, w: a.w, h: 14 };
  }

  function setDropdownValue(id: DropdownId, value: string) {
    if (id === "sort") {
      // 같은 기준을 다시 고르면 방향을 뒤집는다
      if (sortPref.key === value) sortPref.desc = !sortPref.desc;
      else sortPref.key = value as SortKey;
    }
    else if (id === "category") draft.category = value;
    else if (id === "grade") draft.grade = value;
    else draft.element = value;
  }

  function onPointerDown(p: LogicalPoint, button: number) {
    if (button !== 0) return;

    if (openDropdown) {
      const opts = dropdownOptions(openDropdown);
      for (let i = 0; i < opts.length; i++) {
        const r = dropdownOptionRect(openDropdown, i);
        if (hitRect(p, r.x, r.y, r.w, r.h)) {
          setDropdownValue(openDropdown, opts[i].value);
          openDropdown = null;
          return;
        }
      }
      openDropdown = null; // 바깥 클릭은 닫기만 한다
      return;
    }

    if (!filterOpen && hitRect(p, BACK_BTN.x, BACK_BTN.y, BACK_BTN.w, BACK_BTN.h)) return goTo("h01");

    if (filterOpen) {
      handleFilterPopupClick(p);
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
    const sr = sortComboRect();
    if (hitRect(p, sr.x, sr.y, sr.w, sr.h)) {
      openDropdown = "sort";
      return;
    }
    const sd = sortDirRect();
    if (hitRect(p, sd.x, sd.y, sd.w, sd.h)) {
      sortPref.desc = !sortPref.desc;
      return;
    }
    const fr = filterButtonRect();
    if (hitRect(p, fr.x, fr.y, fr.w, fr.h)) {
      draft = { ...applied }; // 적용된 값으로 임시본 초기화
      filterOpen = true;
      return;
    }
    const sUp = scrollUpRect();
    if (hitRect(p, sUp.x, sUp.y, sUp.w, sUp.h)) {
      scroll -= 1;
      clampScroll(rows().length);
      return;
    }
    const sDown = scrollDownRect();
    if (hitRect(p, sDown.x, sDown.y, sDown.w, sDown.h)) {
      scroll += 1;
      clampScroll(rows().length);
      return;
    }
    const list = rows();
    for (let i = 0; i < VISIBLE_ROWS; i++) {
      const idx = i + scroll;
      if (idx >= list.length) break;
      const r = rowRect(i);
      if (hitRect(p, r.x, r.y, r.w, r.h)) {
        selectedUid = list[idx].uid;
        return;
      }
    }
  }

  function onPointerMove(p: LogicalPoint) {
    lastPointer = p;
    hoverOptionIndex = null;
    if (openDropdown) {
      const opts = dropdownOptions(openDropdown);
      for (let i = 0; i < opts.length; i++) {
        const r = dropdownOptionRect(openDropdown, i);
        if (hitRect(p, r.x, r.y, r.w, r.h)) {
          hoverOptionIndex = i;
          break;
        }
      }
    }
  }

  function onWheel(deltaY: number) {
    if (!hitRect(lastPointer, LIST_X, LIST_Y, LIST_W, VISIBLE_ROWS * ROW_H)) return;
    scroll += deltaY > 0 ? 1 : -1;
    clampScroll(rows().length);
  }

  // ---- 고급 필터 팝업 (더 작게, '완료'를 눌러야 적용) ----
  const POPUP = { x: 100, y: 34, w: 280, h: 134 };
  function sizeStepperRect() {
    return { minus: { x: 180, y: 126, w: 16, h: 14 }, plus: { x: 240, y: 126, w: 16, h: 14 } };
  }
  function resetButtonRect() {
    return { x: POPUP.x + 16, y: POPUP.y + POPUP.h - 24, w: 70, h: 16 };
  }
  function applyButtonRect() {
    return { x: POPUP.x + POPUP.w - 86, y: POPUP.y + POPUP.h - 24, w: 70, h: 16 };
  }
  function handleFilterPopupClick(p: LogicalPoint) {
    const comboIds: Array<"category" | "grade" | "element"> = ["category", "grade", "element"];
    for (const id of comboIds) {
      const r = filterComboRect(id);
      if (hitRect(p, r.x, r.y, r.w, r.h)) {
        openDropdown = id;
        return;
      }
    }
    const step = sizeStepperRect();
    if (hitRect(p, step.minus.x, step.minus.y, step.minus.w, step.minus.h)) {
      draft.size = Math.max(0, draft.size - 1);
      return;
    }
    if (hitRect(p, step.plus.x, step.plus.y, step.plus.w, step.plus.h)) {
      draft.size = Math.min(MAX_SIZE, draft.size + 1);
      return;
    }
    const rb = resetButtonRect();
    if (hitRect(p, rb.x, rb.y, rb.w, rb.h)) {
      draft = freshFilter();
      return;
    }
    const ab = applyButtonRect();
    if (hitRect(p, ab.x, ab.y, ab.w, ab.h)) {
      Object.assign(applied, draft);
      filterOpen = false;
      return;
    }
  }

  // ---- 그리기 ----
  function drawCombo(x: number, y: number, w: number, label: string, highlighted: boolean) {
    R(x, y, w, 14, highlighted ? C.gold : C.listRow);
    T(x + 6, y + 10, label, 7, highlighted ? C.woodD : C.txt);
    T(x + w - 6, y + 10, "▾", 7, highlighted ? C.woodD : C.sub, "end");
  }
  function drawDropdownList(id: DropdownId, current: string) {
    const opts = dropdownOptions(id);
    const a = dropdownAnchor(id);
    const { cols, rows } = dropdownLayout(id);
    R(a.x, a.y, a.w * cols, rows * 14, C.night, `stroke='${C.woodL}' stroke-width='1'`);
    opts.forEach((o, i) => {
      const r = dropdownOptionRect(id, i);
      const sel = o.value === current;
      const hovered = i === hoverOptionIndex;
      if (sel) R(r.x, r.y, r.w, r.h, C.listRowSel);
      else if (hovered) R(r.x, r.y, r.w, r.h, C.woodL, "opacity='.4'");
      T(r.x + 6, r.y + 10, o.label, 7, sel || hovered ? C.gold : C.txt);
    });
  }

  function draw() {
    R(0, 0, 480, 270, C.screenBg);
    W(10, 8, 460, 254, "창고");
    btn(BACK_BTN.x, BACK_BTN.y, BACK_BTN.w, "◀ 거점으로");

    TABS.forEach((t, i) => {
      const r = tabRect(i);
      R(r.x, r.y, r.w, r.h, i === tabIndex ? C.gold : C.woodL);
      T(r.x + r.w / 2, r.y + 10, t.label, 7, C.woodD, "middle");
    });

    const sr = sortComboRect();
    drawCombo(sr.x, sr.y, sr.w, "정렬: " + (SORTS.find((s) => s.key === sortPref.key)?.label ?? ""), false);
    const sd = sortDirRect();
    R(sd.x, sd.y, sd.w, sd.h, C.listRow);
    T(sd.x + sd.w / 2, sd.y + 10, sortPref.desc ? "▼" : "▲", 7, C.gold, "middle");
    const fr = filterButtonRect();
    R(fr.x, fr.y, fr.w, fr.h, filterActive() ? C.gold : C.listRow);
    T(fr.x + fr.w / 2, fr.y + 10, "필터", 7, filterActive() ? C.woodD : C.sub, "middle");

    const list = rows();
    clampScroll(list.length);
    for (let i = 0; i < VISIBLE_ROWS; i++) {
      const idx = i + scroll;
      if (idx >= list.length) break;
      const row = list[idx];
      const r = rowRect(i);
      R(r.x, r.y, r.w, r.h, row.uid === selectedUid ? C.listRowSel : C.listRow);
      piece(r.x + 6, r.y + 2, 7, row.def.cells, pieceColors(row.def));
      const nb = ownedByUid(row.uid)?.bonuses?.length ?? 0;
      T(r.x + 40, r.y + 12, `${row.def.name}${nb ? `  ★${nb}` : ""}`, 8, nb ? C.gold : undefined);
      if (row.holder) T(r.x + r.w - 10, r.y + 12, `E ${row.holder}`, 7, C.good, "end");
      else if (!isIndividual(row.def.kind)) T(r.x + r.w - 10, r.y + 12, `×${row.count}`, 8, C.sub, "end");
    }
    if (!list.length) T(LIST_X + 10, LIST_Y + 20, "조건에 맞는 아이템이 없어요", 8, C.sub);
    if (list.length > VISIBLE_ROWS) {
      const sUp = scrollUpRect();
      const sDown = scrollDownRect();
      R(sUp.x, sUp.y, sUp.w, sUp.h, scroll > 0 ? C.listRow : C.cellLocked);
      T(sUp.x + sUp.w / 2, sUp.y + 10, "▲", 7, scroll > 0 ? C.txt : C.cellExt, "middle");
      R(sDown.x, sDown.y, sDown.w, sDown.h, scroll < list.length - VISIBLE_ROWS ? C.listRow : C.cellLocked);
      T(sDown.x + sDown.w / 2, sDown.y + 10, "▼", 7, scroll < list.length - VISIBLE_ROWS ? C.txt : C.cellExt, "middle");
      T(sUp.x + sUp.w / 2, sUp.y + 28, `${scroll + 1}-${Math.min(list.length, scroll + VISIBLE_ROWS)}`, 7, C.sub, "middle");
      T(sUp.x + sUp.w / 2, sUp.y + 38, `/${list.length}`, 7, C.sub, "middle");
    }

    drawDetail();
    if (openDropdown === "sort") drawDropdownList("sort", sortPref.key);
    if (filterOpen) drawFilterPopup();
  }

  function wrapText(text: string, maxChars: number): string[] {
    const lines: string[] = [];
    let line = "";
    for (const ch of text) {
      line += ch;
      if (line.length >= maxChars) {
        lines.push(line);
        line = "";
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  // 상세 패널 (2026-11-08 개편): 위 그림 자리(지금은 도트 형태) → 카테고리·사이즈·속성·수량 2×2 → 짧은 설명.
  /** 2×2 칸 하나: 위 작은 라벨, 아래 값 */
  function infoCell(x: number, y: number, w: number, h: number, label: string, value?: string) {
    R(x, y, w, h, C.panelIn, `stroke='${C.woodD}' stroke-width='1'`);
    T(x + 4, y + 9, label, 6, C.sub);
    if (value) T(x + w / 2, y + h - 6, value, 7, C.txt, "middle");
  }
  /** 칸 크기 안에 맞춰 도트 형태를 가운데 그린다 */
  function shapeIn(def: PieceDef, x: number, y: number, w: number, h: number, maxCell: number) {
    const cw = Math.max(...def.cells.map(([c]) => c)) + 1, ch = Math.max(...def.cells.map(([, r]) => r)) + 1;
    const cs = Math.max(2, Math.min(maxCell, Math.floor(w / cw), Math.floor(h / ch)));
    piece(Math.round(x + (w - cw * cs) / 2), Math.round(y + (h - ch * cs) / 2), cs, def.cells, pieceColors(def));
  }

  function drawDetail() {
    W(300, 48, 160, 206, "상세", 1);
    const owned = selectedUid ? ownedByUid(selectedUid) : undefined;
    const def = owned ? PIECES[owned.itemId] : null;
    if (!owned || !def) {
      T(312, 70, "아이템을 선택하세요", 7, C.sub);
      return;
    }
    const x = 310;
    const w = 142;
    let y = 64;
    // 그림 자리 (아이템 그림이 생기면 여기에). 지금은 도트 형태를 크게
    R(x, y, w, 62, C.panelIn, `stroke='${C.woodD}' stroke-width='1'`);
    shapeIn(def, x + 4, y + 4, w - 8, 54, 12);
    y += 64;
    T(x + 2, y + 9, def.name, 8, C.gold);
    T(x + w - 2, y + 9, KIND_LABEL[def.kind], 7, C.sub, "end");
    y += 13;

    const cw = (w - 2) / 2, chh = 26;
    const holder = holderOf(owned.uid);
    infoCell(x, y, cw, chh, "카테고리", def.categories.length ? def.categories.join("·") : "-");
    infoCell(x + cw + 2, y, cw, chh, "사이즈");
    shapeIn(def, x + cw + 2 + 4, y + 10, cw - 8, chh - 12, 4);
    infoCell(x, y + chh + 2, cw, chh, "속성", elementLabels(def.elements).join("·") || "-");
    infoCell(x + cw + 2, y + chh + 2, cw, chh, isIndividual(def.kind) ? "사용" : "수량", isIndividual(def.kind) ? (holder ? `${holder} 장착` : "-") : `${owned.count}개`);
    y += chh * 2 + 6;

    // 제작 보너스 + 설명 (짧게)
    R(x, y, w, 250 - y, C.panelIn, `stroke='${C.woodD}' stroke-width='1'`);
    const bonus = owned.bonuses ?? [];
    let by = y + 10;
    bonus.slice(0, 2).forEach((b) => { T(x + 5, by, "★ " + b, 7, C.good); by += 10; });
    const room = Math.max(1, Math.floor((250 - by) / 10));
    wrapText(def.desc, 22).slice(0, room).forEach((line, i) => T(x + 5, by + i * 10, line, 7, C.txt));
  }

  function drawFilterPopup() {
    R(0, 0, 480, 270, C.screenBg, "opacity='.85'");
    W(POPUP.x, POPUP.y, POPUP.w, POPUP.h, "고급 필터", 1);

    const catR = filterComboRect("category");
    T(POPUP.x + 10, catR.y + 10, "카테고리", 7, C.sub);
    drawCombo(catR.x, catR.y, catR.w, ALL_CATEGORIES.includes(draft.category) ? draft.category : "전체", draft.category !== ANY);
    const gradeR = filterComboRect("grade");
    T(POPUP.x + 10, gradeR.y + 10, "등급", 7, C.sub);
    drawCombo(gradeR.x, gradeR.y, gradeR.w, draft.grade === ANY ? "전체" : gradeLabel(draft.grade as Grade), draft.grade !== ANY);
    const elemR = filterComboRect("element");
    T(POPUP.x + 10, elemR.y + 10, "속성", 7, C.sub);
    drawCombo(elemR.x, elemR.y, elemR.w, draft.element === ANY ? "전체" : ELEMENT_DEFS[draft.element as ElementId].label, draft.element !== ANY);

    T(POPUP.x + 10, 137, "사이즈", 7, C.sub);
    const step = sizeStepperRect();
    R(step.minus.x, step.minus.y, step.minus.w, step.minus.h, C.listRow);
    T(step.minus.x + 8, step.minus.y + 10, "−", 8, C.txt, "middle");
    T(218, 137, draft.size === 0 ? "전체" : `${draft.size}칸`, 7, C.gold, "middle");
    R(step.plus.x, step.plus.y, step.plus.w, step.plus.h, C.listRow);
    T(step.plus.x + 8, step.plus.y + 10, "+", 8, C.txt, "middle");

    const rb = resetButtonRect();
    R(rb.x, rb.y, rb.w, rb.h, C.listRow);
    T(rb.x + rb.w / 2, rb.y + 11, "초기화", 7, C.sub, "middle");
    const ab = applyButtonRect();
    R(ab.x, ab.y, ab.w, ab.h, C.gold);
    T(ab.x + ab.w / 2, ab.y + 11, "완료", 7, C.woodD, "middle");

    if (openDropdown === "category") drawDropdownList("category", draft.category);
    if (openDropdown === "grade") drawDropdownList("grade", draft.grade);
    if (openDropdown === "element") drawDropdownList("element", draft.element);
  }

  return {
    id: "h03",
    label: "H03 창고",
    draw,
    onEnter: () => {
      const uid = takeNavItem();
      const o = uid ? ownedByUid(uid) : undefined;
      if (!o) return;
      // 그 아이템 종류 탭으로, 필터는 풀고, 줄이 보이게 스크롤.
      selectedUid = o.uid;
      tabIndex = Math.max(0, TABS.findIndex((t) => t.kind === PIECES[o.itemId].kind));
      Object.assign(applied, freshFilter());
      filterOpen = false;
      openDropdown = null;
      const idx = rows().findIndex((r) => r.uid === o.uid);
      scroll = Math.max(0, idx - VISIBLE_ROWS + 1);
      clampScroll(rows().length);
    },
    onPointerDown,
    onPointerMove,
    onWheel,
  };
}
