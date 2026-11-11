// ui-spec.md 6장 데이터 형식에서 출발했지만, 창고/제작/코어 화면이 전부 같은 카탈로그를
// 보도록 범위를 넓혔다. cells는 (0,0) 기준 정규화된 상대 좌표.
// 종류·카테고리·속성은 docs/items.md / itemTaxonomy.ts 기준 (2026-10-31 개편).
import { PIECE } from "../render/primitives";
import { ELEMENT_DEFS, ELEMENT_ORDER, KIND_LABEL, type Category, type ElementId, type ItemKind } from "./itemTaxonomy";
import type { CoreReq } from "./aptitude";
import type { MainStats } from "./stats";
import { CRAFT_ITEMS } from "./craftData";
import { ITEM_USE } from "./itemUse";
import { ITEM_FLAVOR } from "./itemFlavor";

export { KIND_LABEL, type ItemKind };

export type Cell = [number, number];
export type Grade = "common" | "rare" | "epic" | "legend";
/** 2026-11-08: 머리 칸 삭제 — 모자·투구·장갑·신발은 악세(acc) 칸 장신구. */
export type EquipKind = "body" | "bag" | "weapon" | "acc";

/** 장비 전용 — 슬롯 종류와 주 스탯 보정. docs/screens.md P02, docs/character-system.md 2.1. */
export interface EquipInfo {
  slot: EquipKind;
  /** 세부 종류 이름 (투구, 한손검, 방패, 반지 …). */
  type: string;
  /** 무기 칸 수. 1 = 한손 무기·방패, 2 = 양손 무기·쌍검. 무기 외에는 없음. */
  hands?: 1 | 2;
  mods: EquipMods;
}
/** 장비 보정: 주 스탯 + 최대 HP·MP (2026-11-08 기본 옷 HP) */
export type EquipMods = Partial<MainStats & { hp: number; mp: number }>;

export interface PieceDef {
  id: string;
  name: string;
  kind: ItemKind;
  cells: Cell[];
  color: keyof typeof PIECE;
  grade: Grade;
  categories: Category[]; // 1~4개
  /** 1개 이상 — 속성 없는 아이템은 없다 */
  elements: ElementId[];
  /** 칸마다 속성 (cells와 같은 순서). 있으면 조각을 칸별 속성 색으로 그린다 (docs/crafting.md 1장). */
  cellEls?: ElementId[];
  desc: string;
  /** 코어 전용 — 장착 조건 (직업 전용 / 적성 / 공용). 없으면 공용. aptitude.ts */
  coreReq?: CoreReq;
  /** 코어 전용 — 판에 놓이면 더해지는 능력치/스킬. */
  coreEffect?: { stats: Array<{ label: string; value: number }>; skills: Array<{ label: string; passive: boolean }> };
  /** 장비 전용 (kind === "equipment"면 반드시 있다). */
  equip?: EquipInfo;
  /** 도감 번호 — 정렬용. */
  dex: number;
}

const GRADE_LABEL: Record<Grade, string> = {
  common: "일반",
  rare: "희귀",
  epic: "정예",
  legend: "전설",
};
export function gradeLabel(grade: Grade): string {
  return GRADE_LABEL[grade];
}

/** 속성 이름을 표시 순서(불꽃·번개·바람·얼음·빛·어둠)대로 */
export function elementLabels(ids: ElementId[]): string[] {
  return ELEMENT_ORDER.filter((id) => ids.includes(id)).map((id) => ELEMENT_DEFS[id].label);
}

// 2026-11-08: 옛 임시 조각·장비·포션(red_l3, eq_*, potion_* …)은 지웠다. 세이브에 남은 것은 불러올 때 사라진다 (PIECES에 없는 id).
export const PIECES: Record<string, PieceDef> = {};

/**
 * 아이템 그림 규칙: public/items/<아이템 id>.png. 파일이 없으면 img()가 false를 돌려주므로
 * 부르는 쪽이 조각 모양 자리표시로 대신 그린다. 그림을 추가할 때는 파일만 넣으면 된다.
 */
/** 조각 그림 색 — 칸별 속성이 있으면 칸마다, 없으면 한 색 (primitives.piece에 그대로 넘긴다). */
export function pieceColors(d: PieceDef): string | string[] {
  return d.cellEls ? d.cellEls.map((e) => PIECE[e]) : PIECE[d.color];
}
/** 회전·반전된 조각의 i번째 칸 속성 (applyRotFlip은 칸 순서를 지킨다). */
export function cellElement(d: PieceDef, i: number): ElementId {
  return d.cellEls?.[i] ?? d.elements[0];
}

// 제작 데이터 (소재 136 · 조합 · 장비, tools/gen_craft_data.py 생성) — 같은 카탈로그에 합친다.
Object.assign(PIECES, CRAFT_ITEMS);

// 사용 아이템 설명 = 플레이어가 보는 실제 효과 (2026-11-08). 생성 데이터의 설계 메모("회복량 = …")는 쓰지 않는다.
const USE_DESC: Record<string, string> = {
  "c:강화 포션": "힘·집중·견고·가속 중 하나를 얻는다. 만들 때 넣은 강화 소재에 따라 달라진다.",
  "c:마포": "넣은 원소 소재의 속성으로 쏘는 대포.",
  "c:폭약통": "속성 없는 폭탄.",
};
for (const [id, u] of Object.entries(ITEM_USE)) {
  const d = PIECES[id];
  if (!d) continue;
  if (u.stat && u.amount) d.desc = `아군 하나의 ${u.stat === "hp" ? "HP" : "MP"}를 ${u.amount} 회복한다.`;
  else if (u.food) {
    const heal = [u.food.hp ? `HP ${u.food.hp}` : "", u.food.mp ? `MP ${u.food.mp}` : ""].filter(Boolean).join("·");
    d.desc = `던전 체류 시간을 ${u.food.stay} 늘린다.` + (heal ? ` 파티 전원 ${heal} 회복.` : "");
  }
}
for (const [id, t] of Object.entries(USE_DESC)) if (PIECES[id]) PIECES[id].desc = t;
// 소재 설명: 획득 경로("채집 바위") 대신 아이템에 대한 설명 (data/itemFlavor.ts). 획득 경로는 도감 획득 칸이 따로 보여 준다
for (const d of Object.values(PIECES)) if (d.kind === "material" && ITEM_FLAVOR[d.name]) d.desc = ITEM_FLAVOR[d.name];

// 분해로 나오는 특징 없는 도트 자원 (2026-11-08, data/salvage.ts). 무속성 = 속성 없음.
for (const d of [
  { id: "mat_gear", name: "장비 재료", cells: [[0, 0], [1, 0]], grade: "rare", categories: ["금속"], desc: "장비를 분해하면 나오는 부품 덩어리. 고급 장비(3단계 이상)를 만들 때 꼭 들어간다.", dex: 96 },
  { id: "mat_cat1", name: "촉매 알갱이", cells: [[0, 0]], grade: "common", categories: ["촉매"], desc: "아이템을 분해하면 남는 무속성 도트. 빈칸을 메우는 데 쓴다.", dex: 97 },
  // 2026-11-09: 촉매만 대각선 모양 (다른 아이템은 변으로만 이어진다)
  { id: "mat_cat2", name: "촉매 막대", cells: [[0, 0], [1, 1]], grade: "common", categories: ["촉매"], desc: "아이템을 분해하면 남는 무속성 도트 두 칸. 대각선으로 이어져 틈을 메우기 좋다.", dex: 98 },
  { id: "mat_cat3", name: "촉매 덩이", cells: [[0, 0], [1, 1], [2, 2]], grade: "common", categories: ["촉매"], desc: "아이템을 분해하면 남는 무속성 도트 세 칸. 대각선으로 이어져 있다.", dex: 95 },
] as const) PIECES[d.id] = { ...d, kind: "material", color: "steel", elements: [], cells: d.cells.map((c) => [...c] as Cell), categories: [...d.categories] };

// 0단계 기본 장비 (2026-11-08): 새 게임 시작 장착. 옷은 HP +10, 가방은 기본 가방 크기 (data/equipment.ts BAG_ROWS).
PIECES["e:낡은 옷"] = {
  id: "e:낡은 옷", name: "낡은 옷", kind: "equipment", cells: [[0, 0], [1, 0], [0, 1], [1, 1]], color: "purple", grade: "common", categories: ["직물"], elements: ["yellow"],
  desc: "여기저기 기운 평상복. 없는 것보다는 낫다.", dex: 525, equip: { slot: "body", type: "옷", mods: { hp: 10 } },
};
PIECES["e:낡은 가방"] = {
  id: "e:낡은 가방", name: "낡은 가방", kind: "equipment", cells: [[0, 0], [1, 0], [0, 1], [1, 1]], color: "purple", grade: "common", categories: ["직물"], elements: ["yellow"],
  desc: "원정에 들고 가는 작은 가방. 가방이 없으면 아무것도 들고 다닐 수 없다.", dex: 535, equip: { slot: "bag", type: "가방", mods: {} },
};

export function itemImage(id: string): string {
  return `${import.meta.env.BASE_URL}items/${id}.png`;
}

export function listByKind(kind?: ItemKind): PieceDef[] {
  const all = Object.values(PIECES);
  return kind ? all.filter((d) => d.kind === kind) : all;
}
