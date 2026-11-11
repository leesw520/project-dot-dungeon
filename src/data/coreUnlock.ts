// 스킬 코어 제작 해금 (2026-11-09 4차, docs/skill-cores.md 1장). 스킬 트리는 없앴다 — 성장은 코어 판 칸 수와 제작으로 조절한다.
// - 직업·무기·하위·속성 적성 코어와 변형: 처음부터 전부 해금.
// - 예외: 치유·축복 액티브는 신전(H05)에서 골드로, 빛 액티브(빛의 심판·섬광 폭발)는 원정에서 그 코어를 한 번 얻으면.
// - 공용 코어는 원정에서 한 번 얻어야. 원정에서 얻은 코어(드롭)는 늘 제작 해금으로 친다.
// - 처음 갖고 시작하는 코어 = START_CORES (직업마다 2개, 장착한 상태).
import { SKILL_BOOK } from "./skillbook";
import { hasFoundCore } from "./recipeBook";
import { spendGold } from "./inventory";
import { registerSave } from "../engine/save";
import type { ClassKey } from "./skills";

const coreIdOf = (skillId: string) => `core_${skillId}`;

/** 직업마다 처음부터 갖고 장착한 코어 2개 (Lv1). 시작 코어 판 2×2에 함께 들어간다 */
export const START_CORES: Record<ClassKey, string[]> = {
  knight: ["gd_taunt", "as_finisher"],
  warrior: ["bb_cry", "as_finisher"],
  mage: ["mg_shot_red", "mg_elemental"],
  priest: ["hl_heal", "lt_light"],
};
/** 원정에서 얻어야 열리는 코어 (빛 액티브 — 빛 속성 적이 떨어뜨린다) */
export const DROP_ONLY = new Set(["lt_judge", "lt_flash"]);

/** 이 코어(아이템 id)를 지금 제작할 수 있게 열렸는가. 코어가 아닌 레시피는 늘 true. */
export function coreRecipeOpen(itemId: string): boolean {
  const s = SKILL_BOOK.find((x) => coreIdOf(x.id) === itemId);
  if (!s) return true;
  if (hasFoundCore(itemId) || templeUnlocked.has(s.id)) return true;
  if (s.req.type === "common") return false; // 공용 코어: 원정에서 한 번 얻어야
  if (DROP_ONLY.has(s.id)) return false;
  if (TEMPLE_CORES.some((t) => t.skill.id === s.id)) return false; // 신전에서 해금
  return true;
}
/** 잠긴 코어의 해금 방법 (열렸으면 null) — 스킬 목록(P04) 표시용 */
export function coreLockText(skillId: string): string | null {
  if (coreRecipeOpen(coreIdOf(skillId))) return null;
  if (DROP_ONLY.has(skillId)) return "원정에서 얻으면 해금";
  if (TEMPLE_CORES.some((t) => t.skill.id === skillId)) return "신전에서 해금";
  return "원정에서 얻으면 해금";
}

// ---- 신전 (2026-11-08): 치유·축복 계열 액티브 코어를 골드로 해금 ----
/** 신전에서 파는 해금: 치유·축복 계열 액티브 (처음부터 가진 치유 제외). 값 = 칸 수 × 100 G (첫 안 TODO(spec)) */
export const TEMPLE_CORES = SKILL_BOOK.filter((s) => (s.apt === "치유" || s.apt === "축복") && !s.passive && s.id !== "hl_heal").map((s) => ({ skill: s, price: s.slots * 100 }));
const templeUnlocked = new Set<string>();
registerSave("temple", () => [...templeUnlocked], (v) => (v as string[]).forEach((x) => templeUnlocked.add(x)));
export const isTempleUnlocked = (skillId: string) => templeUnlocked.has(skillId);
/** 골드를 내고 해금한다. 성공하면 true */
export function templeUnlock(skillId: string): boolean {
  const t = TEMPLE_CORES.find((x) => x.skill.id === skillId);
  if (!t || templeUnlocked.has(skillId) || !spendGold(t.price)) return false;
  templeUnlocked.add(skillId);
  return true;
}

/** 변형: 처음부터 전부 열려 있다 (그 보너스 칸 활성) */
export const modeOpen = (_skillId: string, _mode: string) => true;
/** 변형이 잠겨 있으면 이유 — 지금은 늘 null */
export function modeLockText(_skillId: string, _mode: string): string | null {
  return null;
}
