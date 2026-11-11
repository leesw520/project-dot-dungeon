// 제작 도면 — 요구 재료를 "정확히 이 아이템" 또는 "이 카테고리/속성의 넓은 범위"로 정의한다.
// 필수 재료(required)는 최대 4개까지. 전부 채워야 제작 버튼이 켜진다. 부가 재료로 빈 칸을
// 채워도 되지만, 필수 조건은 반드시 '매칭되는 조각'으로 채워야 완성된다.
import { PIECES, type Cell, type ItemKind } from "./pieces";
import { CRAFT_RECIPES, type BonusSpec, type CraftRecipeData, type CraftSlot } from "./craftData";

export interface RequiredSlot {
  desc: string;
  match: (itemId: string) => boolean;
  count: number;
  /** 정보 칸 아이콘: 특정 아이템이면 그 아이템, 카테고리·속성이면 그 이름 (2026-11-08) */
  itemId?: string;
  cat?: string;
}
/** 창고·가방에서 이 칸에 쓸 수 있는 개수 */
export function slotHave(slot: RequiredSlot, stock: Array<{ itemId: string; count: number }>): number {
  return stock.reduce((n, s) => (slot.match(s.itemId) ? n + s.count : n), 0);
}

export interface OptionalNode {
  /** 옛 형식(코어 도안 등): 칸 하나에 연결/색 조건. 새 제작 보너스는 spec을 쓴다. */
  cell?: Cell;
  kind: "link" | "color" | "spec";
  color?: string;
  /** 조건 문구 */
  desc: string;
  /** 달성하면 붙는 효과 문구 (개체 보너스로 저장된다) */
  bonus: string;
  match?: (itemId: string) => boolean;
  /** 제작 보너스 조건 (docs/crafting.md 4장) */
  spec?: BonusSpec | CoreBonusSpec;
  level?: string;
  /** 단계 보너스 (2026-11-08): 기준값(at)을 넘을수록 큰 효과. fewPieces는 at 이하일수록. 있으면 bonus 대신 이걸 쓴다. */
  tiers?: Array<{ at: number; bonus: string }>;
  /** 잠긴 보너스(변형 미해금)면 이유 문장 — 잠긴 동안 달성할 수 없다 */
  lockedFn?: () => string | null;
}

/** 스킬 코어 도면 보너스 조건 (2026-11-08, docs/skill-cores.md 4장). 값을 재서 단계로 나눈다. */
export type CoreBonusSpec =
  | { type: "elCount"; el: string }
  | { type: "matGrade"; cat?: string; el?: string }
  | { type: "fewPieces" };

export interface Recipe {
  id: string;
  name: string;
  kind: ItemKind;
  resultItemId: string;
  boardCells: Cell[];
  required: RequiredSlot[];
  optional: OptionalNode[];
  previewStat: string;
  /** C01 목록 묶음 이름 (중간재, 포션, 장비 · 한손검 …). 코어는 적성으로 묶는다. */
  group?: string;
  tier?: number;
  /** 재료 칸 원본 (설명용) */
  slots?: CraftSlot[];
  /** 이 아이템(제작 노트)을 가지고 있어야 목록에 나온다. 없으면 처음부터 안다 (docs/materials.md 5장) */
  unlock?: string;
  /** 필요한 작업대 레벨 (docs/materials.md 5.4). 코어 도안 등은 1. */
  bench?: number;
}

const catLabel = (s: CraftSlot) => (s.t === "item" ? PIECES[s.id!]?.name ?? s.id! : s.t === "cat" ? `(${s.cat})` : "아무 재료");

/** 생성 데이터(craftData.ts) → 레시피. 필수 재료 = 선택이 아닌 지정·카테고리 칸, 자유 칸(@)은 아무 조각. */
function fromData(d: CraftRecipeData): Recipe {
  const required: RequiredSlot[] = d.slots
    .filter((s) => !s.opt && s.t !== "any")
    .map((s) => ({
      desc: catLabel(s),
      count: 1,
      ...(s.t === "item" ? { itemId: s.id } : { cat: s.cat }),
      match: s.t === "item" ? (id: string) => id === s.id : (id: string) => !!PIECES[id]?.categories.includes(s.cat as never),
    }));
  // 고급 장비(3단계~)는 장비 재료(장비 분해로 얻는다)가 필수: 3단계 1개 · 4단계 2개 · 5단계 3개 (2026-11-08, data/salvage.ts)
  if (d.kind === "equipment" && d.tier >= 3) {
    const n = d.tier - 2;
    required.push({ desc: `장비 재료 ${n}개`, count: n, itemId: "mat_gear", match: (id: string) => id === "mat_gear" });
  }
  return {
    id: d.id, name: d.name, kind: d.kind, resultItemId: d.result, boardCells: d.cells as Cell[], required,
    optional: d.bonuses.map((b) => ({ kind: "spec" as const, desc: b.cond, bonus: b.effect, spec: b.spec, level: b.level })),
    previewStat: d.slots.map(catLabel).join(" + "), group: d.group, tier: d.tier, slots: d.slots, unlock: d.unlock, bench: d.bench,
  };
}

// 2026-11-08: 임시 레시피 3개를 지우고 생성 데이터로 바꿨다. 코어 도안은 skillCores.ts가 뒤에 더한다.
// 테스트 모드에서 숨긴 레시피(폭탄·마포·쓰지 않는 무기 등, tools/test_mode.json)는 데이터만 두고 목록에서 뺀다.
export const RECIPES: Recipe[] = CRAFT_RECIPES.filter((d) => !d.hidden).map(fromData);

let activeRecipeId: string | null = RECIPES[0]?.id ?? null;
export function setActiveRecipe(id: string) {
  activeRecipeId = id;
}
export function getActiveRecipe(): Recipe | null {
  return RECIPES.find((r) => r.id === activeRecipeId) ?? null;
}

// C02 → C03 인계. C03 연출(도면 칸이 녹아드는 장면)에 쓸 칸별 색과, 달성한 추가 옵션만 넘긴다.
export interface CraftResult {
  recipeId: string;
  cells: Array<{ cell: Cell; color: string }>;
  bonuses: string[];
  /** 완성품이 들어간 보유 목록 줄의 uid (C03 "창고에서 보기"가 H03에서 골라 둔다). */
  resultUid?: string;
}

let lastCraft: CraftResult | null = null;
export function setLastCraft(result: CraftResult) {
  lastCraft = result;
}
export function getLastCraft(): CraftResult | null {
  return lastCraft;
}
