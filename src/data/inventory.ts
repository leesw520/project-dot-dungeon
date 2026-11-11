// 보유 아이템 목록 — 게임 안에서 "가진 것"은 전부 여기 한 곳에만 있다 (docs/items.md 4장).
// 창고(H03)·제작(C01~C03)·장비(P02)·스킬 코어(P03)·거점 건설(H01)이 모두 이 목록을 읽고 쓴다.
// 세이브: engine/save.ts "inventory" 칸 (보유 목록·uid 번호·건설 자원).
//
// - 쌓이는 아이템(소재·조합·사용·중요)은 (아이템 id, 위치)마다 묶음 1개에 count.
// - 장비·코어는 개체마다 따로 1줄 (count 1). 장착·배치는 uid로 가리킨다.
// - "누가 쓰는 중인지"는 이 목록에 따로 적지 않고, 장착표(equipment.ts)·코어 판(coreBoards.ts)이
//   registerHolder로 알려준다. 그래서 장착 중인 개체도 위치는 그대로 창고/가방이다.
import { learnNote, noteCoreFound } from "./recipeBook";
import { PIECES, type ItemKind } from "./pieces";
import { registerSave } from "../engine/save";
import { PLAY } from "../engine/mode";

/** TODO(spec): 가방(던전 반입) 용량·반입 규칙 미정. 지금은 전부 창고에 들어간다. */
export type Location = "warehouse" | "bag";

export interface OwnedItem {
  uid: string;
  itemId: string;
  count: number;
  acquiredSeq: number;
  location: Location;
  /** 제작 보너스 효과 (docs/crafting.md 4·5장). 있으면 이 줄은 개체 하나 — 같은 아이템이라도 다른 줄로 둔다. */
  bonuses?: string[];
}

const owned: OwnedItem[] = [];
let seq = 1;

/** 장비·코어는 개체 단위, 나머지는 묶음 단위. */
export function isIndividual(kind: ItemKind) {
  return kind === "equipment" || kind === "core";
}

// ---- 사용 중 표시 (장착·배치) ----
type Holder = (uid: string) => string | null;
const holders: Holder[] = [];
/** 장착표·코어 판이 "이 uid는 누가 쓰는 중"을 알려주는 함수를 등록한다. */
export function registerHolder(fn: Holder) {
  holders.push(fn);
}
/** 이 개체를 쓰는 중인 캐릭터 이름 (없으면 null). */
export function holderOf(uid: string): string | null {
  for (const h of holders) {
    const who = h(uid);
    if (who) return who;
  }
  return null;
}

// ---- 조회 ----
export function ownedItems(filter?: (o: OwnedItem) => boolean): OwnedItem[] {
  const live = owned.filter((o) => o.count > 0 && PIECES[o.itemId]);
  return filter ? live.filter(filter) : live;
}
export function ownedOfKind(kind: ItemKind): OwnedItem[] {
  return ownedItems((o) => PIECES[o.itemId].kind === kind);
}
export function ownedByUid(uid: string): OwnedItem | undefined {
  return owned.find((o) => o.uid === uid && o.count > 0);
}
/** 보유 수 (사용 중 포함). */
export function getCount(id: string): number {
  return owned.reduce((n, o) => (o.itemId === id ? n + o.count : n), 0);
}
/** 재료로 빼 쓸 수 있는 수 — 장착·배치 중인 개체는 뺀다. */
export function freeCount(id: string): number {
  return owned.reduce((n, o) => (o.itemId === id && !holderOf(o.uid) ? n + o.count : n), 0);
}
export function hasAtLeast(id: string, n: number) {
  return freeCount(id) >= n;
}

// ---- 넣기 / 빼기 ----
/** 넣은(또는 늘어난) 줄을 돌려준다. 제작 완료 화면이 "창고에서 보기"로 이 uid를 넘긴다. */
export function addItem(id: string, n = 1, location: Location = "warehouse", bonuses?: string[]): OwnedItem[] {
  const d = PIECES[id];
  if (n <= 0 || !d) return [];
  learnNote(id); // 제작 노트는 얻는 순간 배운다 (recipeBook.ts)
  if (d.kind === "core" && location === "bag") noteCoreFound(id); // 원정에서 얻은 코어 = 드롭 전용 코어 제작 해금
  const withBonus = !!bonuses?.length;
  if (isIndividual(d.kind) || withBonus) {
    const made: OwnedItem[] = [];
    for (let i = 0; i < n; i++) {
      const o: OwnedItem = { uid: `u${seq}`, itemId: id, count: 1, acquiredSeq: seq++, location, ...(withBonus ? { bonuses: [...bonuses!] } : {}) };
      owned.push(o);
      made.push(o);
    }
    return made;
  }
  const cur = owned.find((o) => o.itemId === id && o.location === location && !o.bonuses?.length);
  if (cur) {
    cur.count += n;
    return [cur];
  }
  const o = { uid: `u${seq}`, itemId: id, count: n, acquiredSeq: seq++, location };
  owned.push(o);
  return [o];
}

/** 사용 중이 아닌 것부터 n개 뺀다. 실제로 뺀 수를 돌려준다. */
export function removeItem(id: string, n = 1): number {
  let left = n;
  // 보너스 없는 줄부터 쓴다 (보너스가 붙은 개체는 남긴다). TODO: C02에서 개체를 골라 넣기
  const order = [...owned].sort((a, b) => (a.bonuses?.length ? 1 : 0) - (b.bonuses?.length ? 1 : 0));
  for (const o of order) {
    if (left <= 0) break;
    if (o.itemId !== id || o.count <= 0 || holderOf(o.uid)) continue;
    const take = Math.min(o.count, left);
    o.count -= take;
    left -= take;
  }
  for (let i = owned.length - 1; i >= 0; i--) if (owned[i].count <= 0) owned.splice(i, 1);
  return n - left;
}

/** 창고에서 조건에 맞는 것 (사용 중·보너스 개체 제외) 합계 — 거점 건설 비용(등급·카테고리 소재)용. */
export function warehouseCount(match: (itemId: string) => boolean): number {
  return owned.reduce((n, o) => (o.location === "warehouse" && !o.bonuses?.length && !holderOf(o.uid) && match(o.itemId) ? n + o.count : n), 0);
}
/** 창고에서 조건에 맞는 것을 n개 뺀다. 많이 가진 종류부터 쓴다 (귀한 1개짜리를 남기려고). 뺀 수. */
export function warehouseRemove(match: (itemId: string) => boolean, n: number): number {
  let left = n;
  const rows = owned.filter((o) => o.location === "warehouse" && !o.bonuses?.length && !holderOf(o.uid) && match(o.itemId)).sort((a, b) => b.count - a.count);
  for (const o of rows) {
    if (left <= 0) break;
    const take = Math.min(o.count, left);
    o.count -= take;
    left -= take;
  }
  for (let i = owned.length - 1; i >= 0; i--) if (owned[i].count <= 0) owned.splice(i, 1);
  return n - left;
}

// ---- 골드 (2026-11-08): 전투에서 얻고, 신전에서 스킬 코어 해금에 쓴다 ----
let gold = 0;
export const getGold = () => gold;
export function addGold(n: number) {
  gold += Math.max(0, Math.round(n));
}
export function spendGold(n: number): boolean {
  if (gold < n) return false;
  gold -= n;
  return true;
}

/** 원정 가방(위치 bag)에서 이 아이템 1개를 뺀다 — 가방에서 쓰거나 버릴 때. 뺐으면 true. */
export function removeFromBag(id: string): boolean {
  const o = owned.find((x) => x.location === "bag" && x.itemId === id && x.count > 0);
  if (!o) return false;
  o.count -= 1;
  if (o.count <= 0) owned.splice(owned.indexOf(o), 1);
  return true;
}

/** 이 줄(uid)을 통째로 뺀다 — 분해처럼 개체를 고른 경우. 사용 중이면 빼지 않는다. 뺐으면 true. */
export function removeUid(uid: string): boolean {
  const i = owned.findIndex((o) => o.uid === uid);
  if (i < 0 || holderOf(uid)) return false;
  owned[i].count -= 1;
  if (owned[i].count <= 0) owned.splice(i, 1);
  return true;
}

/** 아이템 id별 합계 (빼 쓸 수 있는 수 기준). 제작 재료 고르기(C02)용. */
export interface StockEntry {
  itemId: string;
  count: number;
  acquiredSeq: number;
}
export function allStock(): StockEntry[] {
  const by = new Map<string, StockEntry>();
  for (const o of ownedItems()) {
    if (holderOf(o.uid)) continue;
    const cur = by.get(o.itemId);
    if (cur) cur.count += o.count;
    else by.set(o.itemId, { itemId: o.itemId, count: o.count, acquiredSeq: o.acquiredSeq });
  }
  return [...by.values()];
}

// ---- 거점 건설용 간단 자원 (소재 카탈로그와는 별개) ----
export type Resource = "wood" | "stone" | "misc";
export const RESOURCE_LABEL: Record<Resource, string> = { wood: "목재", stone: "석재", misc: "기타 재료" };
const resources: Record<Resource, number> = { wood: 500, stone: 500, misc: 300 };

export function getResource(r: Resource) {
  return resources[r];
}
export function canAfford(cost: Partial<Record<Resource, number>>) {
  return (Object.keys(cost) as Resource[]).every((k) => resources[k] >= (cost[k] ?? 0));
}
export function spendResources(cost: Partial<Record<Resource, number>>): boolean {
  if (!canAfford(cost)) return false;
  (Object.keys(cost) as Resource[]).forEach((k) => (resources[k] -= cost[k] ?? 0));
  return true;
}

function seedInventory() {
  // 2026-11-08: 옛 임시 아이템을 지우고 새 데이터로. 시작 장비 = 0단계 나무 무기 (장착은 equipment.ts seedLoadouts),
  // 회복약 조금, 소재 (하급 3개씩 · 중급 1개씩 — 테스트 편의). 스킬 코어는 skillCores.ts seedCores.
  const counts: Record<string, number> = {
    "e:목검": 1, "e:나무 방패": 1, "e:나무 대검": 1, "e:나무 지팡이": 1, "e:나무 망치": 1,
    "e:낡은 옷": 4, "e:낡은 가방": 4, // 2026-11-08: 4직업 기본 옷·가방 (장착 상태로 시작)
    "c:HP 회복약": 3, "c:MP 회복약": 2,
  };
  // 소재 지급은 개발 모드만 — 테스트 플레이(play)는 빈 창고에서 시작
  if (!PLAY) for (const d of Object.values(PIECES)) if (d.kind === "material" && d.id.startsWith("m:")) counts[d.id] = d.grade === "common" ? 3 : d.grade === "rare" ? 1 : 0;
  Object.entries(counts).forEach(([id, n]) => n > 0 && addItem(id, n));
}
seedInventory();

// ---- 원정 가방 정리 (2026-11-07) ----
/** 귀환: 가방 위치의 모든 것을 창고로 옮긴다 (쌓이는 아이템은 창고 묶음에 합친다). 옮긴 개수. */
export function moveBagToWarehouse(): number {
  let n = 0;
  for (const o of owned.filter((x) => x.location === "bag" && x.count > 0)) {
    n += o.count;
    if (isIndividual(PIECES[o.itemId].kind) || o.bonuses?.length) { o.location = "warehouse"; continue; }
    const cur = owned.find((x) => x.itemId === o.itemId && x.location === "warehouse" && !x.bonuses?.length);
    if (cur) { cur.count += o.count; o.count = 0; }
    else o.location = "warehouse";
  }
  for (let i = owned.length - 1; i >= 0; i--) if (owned[i].count <= 0) owned.splice(i, 1);
  return n;
}
/** 패배: 가방 위치의 모든 것을 잃는다. 잃은 개수. */
export function loseBag(): number {
  let n = 0;
  for (let i = owned.length - 1; i >= 0; i--) if (owned[i].location === "bag") { n += owned[i].count; owned.splice(i, 1); }
  return n;
}

/** 이름이 바뀐 아이템 (옛 세이브를 불러올 때 바꿔 넣는다). 2026-11-08: 등불 코어 → 라이트 코어 */
export const RENAMED_ITEMS: Record<string, string> = { core_lt_lamp: "core_lt_light", mat_core: "mat_core_white" };

registerSave(
  "inventory",
  () => ({ owned, seq, resources, gold }),
  (v) => {
    const d = v as { owned: OwnedItem[]; seq: number; resources: Record<Resource, number>; gold?: number };
    gold = d.gold ?? 0;
    owned.length = 0;
    d.owned.forEach((o) => (o.itemId = RENAMED_ITEMS[o.itemId] ?? o.itemId));
    owned.push(...d.owned.filter((o) => PIECES[o.itemId]));
    owned.forEach((o) => learnNote(o.itemId)); // 습득 기록 이전 세이브: 가진 노트는 배운 것으로
    seq = d.seq;
    Object.assign(resources, d.resources);
  }
);

export function itemDef(id: string) {
  return PIECES[id];
}
