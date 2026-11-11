// 캐릭터별 진행 데이터 (세이브 "characters" 칸).
// 코어 판: 직업마다 7×7 안의 판 모양이 다르고, 가운데 2×2만 열린 채로 시작한다 (2026-11-08).
// 레벨이 오르면 확장 스택이 쌓이고 (레벨당 1), P03 '판 확장'에서 이미 열린 칸에 붙은 칸만 스택 1개당 1칸씩 연다.
import type { Cell } from "./pieces";
import { CLASS_KEYS, type ClassKey } from "./skills";
import { registerSave } from "../engine/save";

export const CORE_COLS = 7;
export const CORE_ROWS = 7;
export const CORE_STACKS_PER_LEVEL = 1;

export interface CharacterData {
  cls: ClassKey;
  /** 캐릭터 레벨 (경험치 진행에서 읽는다, 읽기 전용) */
  readonly level: number;
  /** 판에 존재하는 칸 (잠김 포함). "c,r" 키. */
  coreBoard: Set<string>;
  /** 해금된 칸. 항상 coreBoard의 부분집합. */
  coreUnlocked: Set<string>;
  /** 아직 쓰지 않은 확장 스택 = (레벨 − 1) − 넓힌 칸 (읽기 전용). */
  readonly coreExpandStacks: number;
}

export function cellKey(c: number, r: number) {
  return `${c},${r}`;
}
export function parseKey(k: string): Cell {
  const [c, r] = k.split(",").map(Number);
  return [c, r];
}

// '.' 판 밖, '#' 잠긴 칸. 2026-11-08: 처음 열린 칸은 가운데 2×2 (BASE_OPEN)뿐 — 레벨이 오를 때마다 1칸씩 넓힌다.
const LAYOUTS: Record<ClassKey, string[]> = {
  knight: [".#####.", "#######", "#######", "#######", "#######", "#######", "..###.."],
  warrior: ["..###..", ".#####.", "#######", "#######", "#######", ".#####.", "..###.."],
  mage: ["..###..", ".#####.", "#######", "#######", "#######", ".#####.", "..###.."],
  priest: ["..###..", ".#####.", "#######", "#######", "#######", ".#####.", "..###.."],
};
/** 처음부터 열린 칸 (모든 직업 같은 자리) */
const BASE_OPEN = [cellKey(2, 2), cellKey(3, 2), cellKey(2, 3), cellKey(3, 3)];

/** 캐릭터 레벨 — 경험치 진행(engine/battleResult)이 등록한다. 순환 import를 피하려고 주입식. */
let levelOf: (cls: ClassKey) => number = () => 1;
export function setLevelSource(fn: (cls: ClassKey) => number) {
  levelOf = fn;
}

function build(cls: ClassKey): CharacterData {
  const coreBoard = new Set<string>();
  LAYOUTS[cls].forEach((row, r) => [...row].forEach((ch, c) => { if (ch !== ".") coreBoard.add(cellKey(c, r)); }));
  BASE_OPEN.forEach((k) => coreBoard.add(k));
  const ch = { cls, coreBoard, coreUnlocked: new Set(BASE_OPEN) } as CharacterData;
  Object.defineProperty(ch, "level", { get: () => levelOf(cls), enumerable: true });
  // 남은 확장 스택 = (레벨 − 1) × 레벨당 칸 − 이미 넓힌 칸
  Object.defineProperty(ch, "coreExpandStacks", {
    get: () => Math.max(0, (levelOf(cls) - 1) * CORE_STACKS_PER_LEVEL - (ch.coreUnlocked.size - BASE_OPEN.length)),
    enumerable: true,
  });
  return ch;
}

const characters = Object.fromEntries(CLASS_KEYS.map((k) => [k, build(k)])) as Record<ClassKey, CharacterData>;

registerSave(
  "characters",
  () => Object.fromEntries(CLASS_KEYS.map((k) => [k, { unlocked: [...characters[k].coreUnlocked] }])),
  (v) => {
    const d = v as Record<ClassKey, { unlocked: string[] }>;
    for (const k of CLASS_KEYS) {
      const s = d[k];
      if (!s) continue;
      const ch = characters[k];
      ch.coreUnlocked = new Set([...BASE_OPEN, ...s.unlocked.filter((c) => ch.coreBoard.has(c))]);
    }
  }
);

export function getCharacter(cls: ClassKey): Readonly<CharacterData> {
  return characters[cls];
}


/**
 * 판 확장 확정. 넘겨받은 칸들이 판 안이고, 잠겨 있고, 기존 해금 칸에서 이어지며, 스택 이내일 때만
 * 반영한다 (화면 쪽 검증을 믿지 않고 한 번 더 확인). 반영하면 true.
 */
export function commitCoreExpansion(cls: ClassKey, keys: string[]): boolean {
  const ch = characters[cls];
  if (!keys.length || keys.length > ch.coreExpandStacks) return false;
  const open = new Set(ch.coreUnlocked);
  const pending = new Set(keys);
  if (keys.some((k) => !ch.coreBoard.has(k) || open.has(k))) return false;
  // 기존 해금 칸에서 출발해 pending 칸을 이웃으로 하나씩 흡수 — 다 흡수되면 전부 이어진 것.
  let grew = true;
  while (grew && pending.size) {
    grew = false;
    for (const k of [...pending]) {
      const [c, r] = parseKey(k);
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => open.has(cellKey(c + dc, r + dr)))) {
        open.add(k);
        pending.delete(k);
        grew = true;
      }
    }
  }
  if (pending.size) return false;
  keys.forEach((k) => ch.coreUnlocked.add(k));
  return true;
}
