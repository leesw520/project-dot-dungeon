// 스킬 코어 판(P03)에 놓인 코어. 코어 개체는 보유 목록(inventory.ts)의 uid로 가리킨다 —
// 같은 코어를 두 개 가지면 두 캐릭터가 하나씩 쓸 수 있고, 하나뿐이면 한 번에 한 캐릭터만 쓴다.
// 세이브: engine/save.ts "coreBoards" 칸.
import { registerSave } from "../engine/save";
import { RENAMED_ITEMS, ownedByUid, ownedOfKind, registerHolder } from "./inventory";
import type { Cell } from "./pieces";
import { CLASS_KEYS, CLASS_NAME, type ClassKey } from "./skills";

export interface PlacedCore {
  /** 화면 안에서 집기/옮기기용 번호 */
  uid: number;
  /** 보유 목록의 uid */
  ownedUid: string;
  itemId: string;
  origin: Cell;
  rot: 0 | 1 | 2 | 3;
  flip: boolean;
}

export const CORE_BOARDS = Object.fromEntries(CLASS_KEYS.map((k) => [k, []])) as unknown as Record<ClassKey, PlacedCore[]>;

export function coreUserOf(ownedUid: string): ClassKey | null {
  return CLASS_KEYS.find((k) => CORE_BOARDS[k].some((p) => p.ownedUid === ownedUid)) ?? null;
}
registerHolder((uid) => {
  const k = coreUserOf(uid);
  return k ? CLASS_NAME[k] : null;
});

registerSave("coreBoards", () => CORE_BOARDS, (v) => {
  const d = v as Record<ClassKey, PlacedCore[]>;
  for (const k of CLASS_KEYS) CORE_BOARDS[k] = (d[k] ?? []).map((p) => ({ ...p, itemId: RENAMED_ITEMS[p.itemId] ?? p.itemId }));
});

/** 판에 안 놓인 이 코어 개체들 (보유 목록 기준). */
export function freeCores(itemId: string): string[] {
  return ownedOfKind("core")
    .filter((o) => o.itemId === itemId && !coreUserOf(o.uid))
    .map((o) => o.uid);
}

/** 보유 목록에서 사라진 코어는 판에서도 뺀다. */
export function pruneBoards() {
  for (const k of CLASS_KEYS) CORE_BOARDS[k] = CORE_BOARDS[k].filter((p) => ownedByUid(p.ownedUid));
}
