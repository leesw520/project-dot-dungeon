// 도감(J01) 항목 형식. 2026-11-08: 샘플 대신 지금 게임 데이터로 자동 작성 (buildDex).
// 획득 경로는 따로 저장하지 않고 recipe / gatherAt / droppedBy 유무로 판단한다 (docs/items.md 1장).
import { PIECES, type Cell } from "./pieces";
import { RECIPES } from "./recipes";
import { DUNGEONS } from "./dungeons";
import { PIECE } from "../render/primitives";
import { MONSTER_DB, type MonsterRecord } from "./monsters";
import { isCraftOnlyCategory, type Category, type ElementId, type ItemKind } from "./itemTaxonomy";

export type Ingredient = { itemId: string; count: number } | { category: Category; count: number };

export interface DexEntry {
  id: string;
  no: number;
  name: string;
  kind: ItemKind;
  /** public/ 기준 이미지 경로. 없거나 아직 못 받았으면 자리표시 그림을 그린다. */
  image?: string;
  /** 가방·배치판에서 차지하는 도트 형태 — (0,0) 기준 칸 좌표와 칸 색 */
  shape: { cells: Cell[]; color: keyof typeof PIECE };
  categories: Category[];
  elements: ElementId[];
  desc: string;
  recipe?: Ingredient[];
  gatherAt?: string[];
  droppedBy?: string[];
}

export interface Place {
  id: string;
  name: string;
  /** 썸네일 자리 — 하늘색, 땅색 두 띠로 대신 그린다 */
  sky: string;
  ground: string;
}
/** 채집 장소 = 던전 구획 (buildDex가 채운다). 썸네일은 구획 색 띠로 대신 그린다. */
export const PLACES: Record<string, Place> = {};

/** 드롭 몬스터 탭에 보이는 몬스터 = 몬스터 DB (data/monsters.ts) 그대로. droppedBy는 그 id를 쓴다. */
export const MONSTERS: Record<string, MonsterRecord> = MONSTER_DB;

/** 도감 번호순 (2026-11-08: 지금 게임에 있는 아이템으로 자동 작성 — buildDex). 처음 쓸 때 채운다 (코어 레시피가 스킬북에서 다 만들어진 뒤). */
export const DEX: DexEntry[] = [];

/** 지금 게임 데이터(PIECES·레시피·구획 채집·몬스터 드롭)로 도감 항목을 만든다. 얻을 길이 없는 아이템은 뺀다 (테스트 모드 제외 소재 등). */
export function buildDex() {
  if (DEX.length) return;
  // 채집지·타일 아이템·상자 → 구획
  const gather = new Map<string, Set<string>>();
  const add = (item: string, place: string) => (gather.get(item) ?? gather.set(item, new Set()).get(item)!).add(place);
  for (const f of DUNGEONS[0].floors)
    for (const d of f.districts) {
      PLACES[d.id] = { id: d.id, name: `${f.name.replace(/^.*?(B\dF)$/, "$1")} ${d.name}`, sky: "#1A1712", ground: d.color };
      for (const list of Object.values(d.gatherLoot ?? {})) for (const [id] of list) add(id, d.id);
      d.symbols.loot.forEach((id) => add(id, d.id));
      d.chests.forEach((c) => add(c.item, d.id));
    }
  const drops = new Map<string, string[]>();
  for (const m of Object.values(MONSTER_DB))
    for (const r of [...m.drops, ...(m.coreDrops ?? [])]) drops.set(r.itemId, [...(drops.get(r.itemId) ?? []), m.id]);
  const recipeOf = new Map<string, Ingredient[]>();
  for (const r of RECIPES) {
    const ing: Ingredient[] = (r.slots ?? [])
      .filter((sl) => sl.t !== "any" && !sl.opt)
      .map((sl): Ingredient => (sl.t === "item" ? { itemId: sl.id!, count: 1 } : { category: sl.cat as Category, count: 1 }));
    if (!r.slots) r.required.forEach((q) => ing.push({ category: "원석" as Category, count: q.count })); // 코어 도안: 재료 설명만 (아래에서 이름으로 바꾼다)
    recipeOf.set(r.resultItemId, r.slots ? ing.slice(0, 4) : coreIngredients(r.required.map((q) => q.desc)));
  }
  for (const d of Object.values(PIECES)) {
    const e: DexEntry = {
      id: d.id, no: d.dex ?? 999, name: d.name, kind: d.kind,
      shape: { cells: d.cells, color: d.color },
      categories: d.categories, elements: d.elements, desc: d.desc,
      recipe: recipeOf.get(d.id), gatherAt: gather.has(d.id) ? [...gather.get(d.id)!] : undefined, droppedBy: drops.get(d.id),
    };
    if (d.kind !== "key" && !sourcesOf(e).length && !SALVAGE_ONLY.has(d.id)) continue;
    DEX.push(e);
  }
  DEX.sort((a, b) => a.no - b.no || a.name.localeCompare(b.name));
}
/** 분해로만 얻는 자원 (코어·장비 재료·촉매) — 도감에는 넣는다 */
const SALVAGE_ONLY = new Set(["mat_gear", "mat_cat1", "mat_cat2", "mat_cat3"]);
/** 코어 도안 재료 문구("코어 2개", "금속 소재 1개") → 재료 표기 */
function coreIngredients(descs: string[]): Ingredient[] {
  return descs.map((t) => {
    const n = Number(/(\d+)개/.exec(t)?.[1] ?? 1);
    if (t.startsWith("코어 조각")) return { category: "원석" as Category, count: n };
    const cat = /^(\S+?)( 속성)? 소재/.exec(t)?.[1] ?? "원석";
    return { category: cat as Category, count: n };
  });
}

export type SourceKind = "recipe" | "gather" | "drop";

export function sourcesOf(e: DexEntry): SourceKind[] {
  const out: SourceKind[] = [];
  if (e.recipe?.length) out.push("recipe");
  if (e.gatherAt?.length) out.push("gather");
  if (e.droppedBy?.length) out.push("drop");
  return out;
}

export function dexById(id: string) {
  return DEX.find((e) => e.id === id);
}

/** docs/items.md 4장 검사 규칙. 위반 항목을 문자열로 돌려준다. */
export function validateEntry(e: DexEntry): string[] {
  const errs: string[] = [];
  if (!e.elements.length && !e.categories.includes("촉매" as Category) && e.id !== "mat_gear") errs.push("속성이 없다");
  if (e.categories.length < 1 || e.categories.length > 4) errs.push("카테고리는 1~4개");
  if (e.kind === "material" && e.recipe) errs.push("소재에 조합식이 있다");
  if (e.kind === "compound" && !e.recipe) errs.push("조합 아이템에 조합식이 없다");
  if (!e.recipe && e.categories.some(isCraftOnlyCategory)) errs.push("조합 전용 카테고리가 조합식 없는 아이템에 있다");
  if (e.kind !== "key" && !sourcesOf(e).length) errs.push("얻을 방법이 없다");
  if ((e.recipe?.length ?? 0) > 4) errs.push("조합 재료는 4종까지");
  if (e.shape.cells.some(([c, r]) => c >= 5 || r >= 5)) errs.push("도트 형태는 5×5 안에 들어가야 한다");
  return errs;
}

if (import.meta.env.DEV) {
  DEX.forEach((e) => validateEntry(e).forEach((msg) => console.warn(`[dex] No.${e.no} ${e.name}: ${msg}`)));
}
