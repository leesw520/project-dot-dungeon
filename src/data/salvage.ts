// 분해 (2026-11-08, docs/skill-cores.md 5장 · docs/items.md). 창고(H03)에서 아이템 하나를 특징 없는 도트 자원으로 바꾼다.
// - 스킬 코어 → 코어 (칸 수만큼)
// - 장비 → 장비 재료 (단계·등급만큼) — 고급 장비(3단계~) 제작의 필수 재료
// - 소재·조합·사용 → 촉매 (무속성 도트 1~3칸). 도트 수 = 칸 수 × 등급 배율(하급 1 · 중급 2 · 상급 3), 큰 조각부터 채운다
// - 중요 아이템은 분해할 수 없다.
import { PIECES } from "./pieces";
import { CRAFT_RECIPES } from "./craftData";
import { coreElementOf, coreFragOf, isCoreFrag } from "./skillCores";

export const GEAR_MATERIAL = "mat_gear";
export const CATALYST = ["mat_cat1", "mat_cat2", "mat_cat3"] as const;

// 장비 재료·촉매 아이템 정의는 pieces.ts (세이브 복원 전에 있어야 해서 의존 없는 곳에 둔다).

const GRADE_MUL: Record<string, number> = { common: 1, rare: 2, epic: 3, legend: 4 };
/** 제작 장비의 단계 (레시피에서). 옛 임시 장비는 크기로 어림. */
function gearTier(id: string): number {
  const r = CRAFT_RECIPES.find((x) => x.result === id);
  return r ? r.tier : Math.ceil((PIECES[id]?.cells.length ?? 2) / 2);
}

/** 분해하면 나오는 것 [아이템 id, 개수]. 분해할 수 없으면 빈 배열. */
export function salvageYield(itemId: string): Array<[string, number]> {
  const d = PIECES[itemId];
  if (!d || d.kind === "key" || isCoreFrag(itemId) || itemId === GEAR_MATERIAL || CATALYST.includes(itemId as never)) return [];
  if (d.kind === "core") return [[coreFragOf(coreElementOf(itemId)), d.cells.length]];
  if (d.kind === "equipment") return [[GEAR_MATERIAL, Math.max(1, gearTier(itemId)) + (d.grade === "epic" ? 1 : 0)]];
  let dots = d.cells.length * (GRADE_MUL[d.grade] ?? 1);
  const out: Array<[string, number]> = [];
  for (const [id, size] of [[CATALYST[2], 3], [CATALYST[1], 2], [CATALYST[0], 1]] as const) {
    const n = Math.floor(dots / size);
    if (n) out.push([id, n]);
    dots -= n * size;
  }
  return out;
}
export const salvageText = (itemId: string) =>
  salvageYield(itemId).map(([id, n]) => `${PIECES[id].name} ${n}`).join(" · ");
