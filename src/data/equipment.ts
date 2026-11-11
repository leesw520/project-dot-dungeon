// 장비 슬롯과 장착표. docs/screens.md P02 (슬롯 규칙), docs/character-system.md 2.1 (장비 보정 = 주 스탯 보정).
// 장비 정의(슬롯 종류·무기 칸 수·보정)는 카탈로그 pieces.ts의 equip, 보유 개체는 inventory.ts의 보유 목록.
// 여기는 "누가 어느 슬롯에 어떤 uid를 끼고 있나"만 가진다. 장착 상태는 세션 동안만 유지 (세이브/로드 없음).
// 캐릭터 키는 PARTY의 name.
import { registerSave } from "../engine/save";
import { PIECE } from "../render/primitives";
import type { ElementId } from "./itemTaxonomy";
import { weaponBlockReason } from "./aptitude";
import { addItem, ownedByUid, ownedOfKind, registerHolder } from "./inventory";
import { PIECES, type EquipKind, type EquipMods } from "./pieces";
import { STAT_INFO, STAT_ORDER, type StatKey } from "./stats";

export type { EquipKind };
export type SlotId = "w0" | "w1" | "body" | "bag" | "a0" | "a1" | "a2" | "a3";

export const ACC_SLOTS: SlotId[] = ["a0", "a1", "a2", "a3"];
/** 슬롯 전체. 화면 배치는 각 화면이 정한다 (P02는 인형 주변, P01은 3열 표). */
export const SLOT_ORDER: SlotId[] = ["w0", "w1", "body", "bag", ...ACC_SLOTS];
export const SLOT_INFO: Record<SlotId, { kind: EquipKind; label: string }> = {
  w0: { kind: "weapon", label: "무기 1" },
  w1: { kind: "weapon", label: "무기 2" },
  body: { kind: "body", label: "신체" },
  bag: { kind: "bag", label: "가방" },
  a0: { kind: "acc", label: "악세 1" },
  a1: { kind: "acc", label: "악세 2" },
  a2: { kind: "acc", label: "악세 3" },
  a3: { kind: "acc", label: "악세 4" },
};

/** 열린 악세 칸 수 (최대 4). 이 값만 바꾸면 P01·P02가 같이 따라간다. */
const ACC_SLOTS_OPEN = 2;
// TODO(spec): 악세 칸을 늘려 주는 코어 미구현. 코어가 생기면 캐릭터별로 여기서 계산한다.
export const accSlotsOpen = (_char: string) => ACC_SLOTS_OPEN;

/** 아직 열리지 않은 악세 칸인지. */
export function isLocked(char: string, slot: SlotId) {
  const i = ACC_SLOTS.indexOf(slot);
  return i >= accSlotsOpen(char);
}

/** P01·P02가 그리기 쉽게 카탈로그 항목을 펼친 모양. 원본은 PIECES[id].equip. */
export interface EquipDef {
  id: string;
  name: string;
  kind: EquipKind;
  type: string;
  hands?: 1 | 2;
  mods: EquipMods;
  elements: ElementId[];
  /** 색 값 (#rrggbb) */
  color: string;
  desc: string;
}

function equipDef(itemId: string): EquipDef | undefined {
  const p = PIECES[itemId];
  if (!p?.equip) return undefined;
  const e = p.equip;
  return { id: p.id, name: p.name, kind: e.slot, type: e.type, hands: e.hands, mods: e.mods, elements: p.elements, color: PIECE[p.color], desc: p.desc };
}

/** 보유 장비 개체. 같은 장비를 여러 개 가질 수 있어 uid(보유 목록의 uid)로 구분한다. */
export interface OwnedEquip {
  uid: string;
  def: EquipDef;
}

/** 보유 목록에서 장비만. 제작으로 새로 생긴 장비도 바로 여기 나온다. */
export function ownedEquips(): OwnedEquip[] {
  return ownedOfKind("equipment").flatMap((o) => {
    const def = equipDef(o.itemId);
    return def ? [{ uid: o.uid, def }] : [];
  });
}
export function equipByUid(uid: string): OwnedEquip | undefined {
  const o = ownedByUid(uid);
  const def = o && equipDef(o.itemId);
  return def ? { uid, def } : undefined;
}

export type Loadout = Partial<Record<SlotId, string>>;

const loadouts: Record<string, Loadout> = { 기사: {}, 전사: {}, 마법사: {}, 사제: {} };

// 시작 장착표 — 보유 목록의 테스트 장비 중 n번째 개체를 끼운다.
function seedLoadouts() {
  const used = new Set<string>();
  const pick = (itemId: string) => {
    const o = ownedOfKind("equipment").find((x) => x.itemId === itemId && !used.has(x.uid));
    if (o) used.add(o.uid);
    return o?.uid;
  };
  const seed: Record<string, Partial<Record<SlotId, string>>> = {
    // 2026-11-08: 0단계 나무 무기 + 낡은 옷·낡은 가방 (더 좋은 옷·가방·장신구는 제작해서).
    기사: { w0: "e:목검", w1: "e:나무 방패", body: "e:낡은 옷", bag: "e:낡은 가방" },
    전사: { w0: "e:나무 대검", body: "e:낡은 옷", bag: "e:낡은 가방" },
    마법사: { w0: "e:나무 지팡이", body: "e:낡은 옷", bag: "e:낡은 가방" },
    사제: { w0: "e:나무 망치", body: "e:낡은 옷", bag: "e:낡은 가방" },
  };
  for (const [char, slots] of Object.entries(seed))
    for (const [s, itemId] of Object.entries(slots)) {
      const uid = pick(itemId!);
      if (uid) loadouts[char][s as SlotId] = uid;
    }
}
seedLoadouts();

/** 옛 세이브 정리 (2026-11-08): 옛 임시 장비가 사라져 무기 1 칸이 빈 캐릭터에게 0단계 나무 무기를 주고 끼운다. 거점에 들어올 때 부른다. */
export function ensureStarterGear(): string[] {
  const START: Record<string, string> = { 기사: "e:목검", 전사: "e:나무 대검", 마법사: "e:나무 지팡이", 사제: "e:나무 망치" };
  const got: string[] = [];
  for (const [char, itemId] of Object.entries(START)) {
    const lo = loadouts[char];
    if (!lo || (lo.w0 && equipByUid(lo.w0))) continue;
    const o = addItem(itemId, 1, "warehouse")[0];
    if (o) { lo.w0 = o.uid; got.push(char); }
  }
  return got;
}
registerHolder((uid) => wearerOf(uid)?.char ?? null);
registerSave("loadouts", () => loadouts, (v) => {
  for (const k of Object.keys(loadouts)) delete loadouts[k];
  Object.assign(loadouts, v as Record<string, Loadout>);
  // 없어진 칸(2026-11-08 머리 칸 삭제)에 끼워 둔 장비는 장착 해제 (보유 목록에는 남는다)
  for (const lo of Object.values(loadouts)) for (const s of Object.keys(lo)) if (!SLOT_ORDER.includes(s as SlotId)) delete lo[s as SlotId];
});

export function getLoadout(char: string): Readonly<Loadout> {
  const lo = (loadouts[char] ??= {});
  // 보유 목록에서 사라진 개체(버리기·재료로 쓰기 등)는 장착표에서도 뺀다.
  for (const s of SLOT_ORDER) if (lo[s] && !ownedByUid(lo[s]!)) delete lo[s];
  return lo;
}

/** 이 장비를 끼고 있는 캐릭터와 슬롯. */
export function wearerOf(uid: string): { char: string; slot: SlotId } | null {
  for (const [char, lo] of Object.entries(loadouts))
    for (const s of SLOT_ORDER) if (lo[s] === uid) return { char, slot: s };
  return null;
}

/** 무기 2번 칸이 양손 무기 때문에 막혀 있는지. 양손 무기는 항상 1번 칸에 들어간다. */
export function isBlocked(lo: Readonly<Loadout>, slot: SlotId) {
  return slot === "w1" && !!lo.w0 && equipByUid(lo.w0)?.def.hands === 2;
}

/** 장착할 수 없으면 이유 문장, 가능하면 null. 이 캐릭터가 이미 낀 장비는 '해제' 대상이라 여기서 묻지 않는다. */
export function equipBlockReason(char: string, slot: SlotId, uid: string): string | null {
  const o = equipByUid(uid);
  if (!o || o.def.kind !== SLOT_INFO[slot].kind) return "이 칸에 맞지 않는 장비";
  if (isLocked(char, slot)) return "잠긴 칸 (코어로 열린다)";
  if ((slot === "bag" || o.def.kind === "bag") && bagLocked()) return BAG_LOCK_TEXT;
  // 무기는 무기 적성(aptitude.ts)에 있는 종류만. TODO(spec): 방어구·악세 장착 제한 여부.
  if (o.def.kind !== "weapon") return null;
  const apt = weaponBlockReason(char, o.def.type);
  if (apt) return apt;
  const lo = getLoadout(char);
  if (o.def.hands === 2) {
    const ones = (["w0", "w1"] as const)
      .map((s) => lo[s] && equipByUid(lo[s]!)?.def)
      .filter((d): d is EquipDef => !!d && d.hands === 1);
    if (ones.length) return `한손 장비(${ones.map((d) => d.name).join(", ")})를 먼저 빼야 한다`;
    return null;
  }
  if (isBlocked(lo, slot)) return "양손 무기가 무기 칸 2개를 쓰는 중";
  return null;
}

/** 장착 결과 장착표 (원본은 건드리지 않는다). 미리보기와 실제 장착이 같은 계산을 쓴다. 양손 무기는 어느 무기 칸에 놓아도 1번 칸으로 간다. */
export function simulateEquip(char: string, slot: SlotId, uid: string): Loadout {
  const lo: Loadout = { ...getLoadout(char) };
  const o = equipByUid(uid)!;
  const from = SLOT_ORDER.find((s) => lo[s] === uid);
  if (from) delete lo[from];
  if (o.def.hands === 2) {
    lo.w0 = uid;
    delete lo.w1;
    return lo;
  }
  // 같은 캐릭터의 다른 칸에서 옮겨 오면 자리를 맞바꾼다.
  const prev = lo[slot];
  lo[slot] = uid;
  if (from && prev) lo[from] = prev;
  return lo;
}

export function simulateUnequip(char: string, slot: SlotId): Loadout {
  const lo: Loadout = { ...getLoadout(char) };
  delete lo[slot];
  return lo;
}

/** 장착. 다른 캐릭터가 끼고 있던 장비면 그쪽에서 빼 온다. 막혀 있으면 false. */
export function equip(char: string, slot: SlotId, uid: string): boolean {
  if (equipBlockReason(char, slot, uid)) return false;
  const w = wearerOf(uid);
  if (w && w.char !== char) delete loadouts[w.char][w.slot];
  loadouts[char] = simulateEquip(char, slot, uid);
  return true;
}

export function unequip(char: string, slot: SlotId) {
  if (unequipBlockReason(char, slot)) return;
  loadouts[char] = simulateUnequip(char, slot);
}

// ---- 가방 크기 (2026-11-08) ----
/** 가방 줄 수 (한 줄 6칸). 낡은 가방(0단계)이 기본 크기. 가방을 빼면 0 — 원정에서 아무것도 못 든다.
 *  제작 가방은 잠정치 TODO(spec): 단계별 크기. 화면(B03)은 최대 9줄까지 그린다. */
export const BAG_COLS = 6;
const BAG_ROWS: Record<string, number> = { "e:낡은 가방": 4, "e:천 가방": 5, "e:가죽 가방": 6, "e:아라크네 가방": 7, "e:소서리 가방": 8, "e:헤븐즈 가방": 9 };
/** 가방 아이템의 줄 수 */
export const bagRowsOfItem = (itemId: string) => Math.min(9, BAG_ROWS[itemId] ?? 4);
export function bagRowsOf(char: string): number {
  const uid = getLoadout(char).bag;
  const d = uid && equipByUid(uid)?.def;
  return d ? Math.min(9, BAG_ROWS[d.id] ?? 4) : 0;
}
/** 원정 중에는 가방을 바꿀 수 없다 (가방 안 물건이 갈 곳이 없다). 탐색 쪽이 등록한다. */
let bagLocked: () => boolean = () => false;
export function setBagLock(fn: () => boolean) {
  bagLocked = fn;
}
export const BAG_LOCK_TEXT = "원정 중에는 가방을 바꿀 수 없다";
/** 해제할 수 없으면 이유 */
export function unequipBlockReason(_char: string, slot: SlotId): string | null {
  return slot === "bag" && bagLocked() ? BAG_LOCK_TEXT : null;
}

/** 장착표의 주 스탯 보정 합계. */
export function equipBonus(lo: Readonly<Loadout>): Record<StatKey | "hp" | "mp", number> {
  const sum = { atk: 0, spl: 0, def: 0, agi: 0, hp: 0, mp: 0 };
  for (const s of SLOT_ORDER) {
    const d = lo[s] && equipByUid(lo[s]!)?.def;
    if (d) for (const k of [...STAT_ORDER, "hp", "mp"] as const) sum[k] += d.mods[k] ?? 0;
  }
  return sum;
}

/** "공격력 +8 민첩성 −2" 같은 짧은 보정 문장. abbr이면 "ATK+8". */
export function modsText(mods: EquipMods, abbr = false) {
  const NAME = { hp: { name: "HP", abbr: "HP" }, mp: { name: "MP", abbr: "MP" } };
  return (["hp", "mp", ...STAT_ORDER] as const).filter((k) => mods[k])
    .map((k) => {
      const v = mods[k]!;
      const info = k === "hp" || k === "mp" ? NAME[k] : STAT_INFO[k];
      const n = abbr ? info.abbr : info.name;
      return `${n}${abbr ? "" : " "}${v > 0 ? "+" : "−"}${Math.abs(v)}`;
    })
    .join(abbr ? " " : "  ");
}
