// 대열 (docs/character-system.md 1장, battle-rules.md 2장). 4인 파티 + 3×2 칸 = 빈칸 2개.
// 칸 번호: 전열 0~2, 후열 3~5 (각각 위→아래). 줄 = 칸 % 3 (0 위, 1 가운데, 2 아래).
// 2026-11-04: 6칸(2열×3줄) 어디든 자유 배치. 규칙은 하나 — 전열에 최소 1명.
// 빈칸은 소환·설치 자리. 세이브 "formation" 칸. D06 대열 편성에서 바꾼다 (거점 헤더 "편성" · 탐색 메뉴).
import { PARTY } from "./battle";
import { registerSave } from "../engine/save";

export type Col = "f" | "b";
export const COLS: Col[] = ["f", "b"];
export const COL_LABEL: Record<Col, string> = { f: "전열", b: "후열" };
export const ROWS_PER_COL = 3;

const colOf = (slot: number): Col => (slot < ROWS_PER_COL ? "f" : "b");
const rowOf = (slot: number) => slot % ROWS_PER_COL;
const slotAt = (col: Col, row: number) => (col === "f" ? 0 : ROWS_PER_COL) + row;

// 기본 2:2 — 기사·전사 전열 위·가운데, 마법사·사제 후열 위·가운데.
const slots: Record<string, number> = { 기사: 0, 전사: 1, 마법사: 3, 사제: 4 };

registerSave("formation", () => slots, (v) => Object.assign(slots, v as Record<string, number>));

/** 이 캐릭터의 대열 칸 (0~5). 파티에 없으면 −1. */
export const slotOf = (name: string): number => slots[name] ?? -1;

/** (col,row)에 선 캐릭터. 없으면 null. */
export function memberAt(col: Col, row: number): string | null {
  const s = slotAt(col, row);
  return PARTY.find((p) => slots[p.name] === s)?.name ?? null;
}

/** 전열이 비면 안 된다 (유일한 대열 규칙). */
export const MIN_FRONT = 1;

/** 고른 캐릭터를 (col,row)로: 다른 캐릭터가 있으면 서로 바꾸고, 빈칸이면 옮긴다. 전열이 비게 되면 거절. */
export function moveMember(name: string, col: Col, row: number): boolean {
  if (!(name in slots)) return false;
  const next = { ...slots };
  const target = memberAt(col, row);
  if (target) {
    if (target === name) return false;
    [next[name], next[target]] = [next[target], next[name]];
  } else next[name] = slotAt(col, row);
  if (Object.values(next).filter((s) => colOf(s) === "f").length < MIN_FRONT) return false;
  Object.assign(slots, next);
  return true;
}

/** 열별 인원 수. */
export function colCounts(occupied: number[]): Record<Col, number> {
  return { f: occupied.filter((s) => colOf(s) === "f").length, b: occupied.filter((s) => colOf(s) === "b").length };
}

/**
 * 엄호 (2026-11-04): 후열 캐릭터는 앞(전열)에 선 아군이 대신 맞아 주는 만큼 어그로 보정이 줄어든다.
 * 바로 앞(같은 줄 전열)에 아군 −0.5, 대각선 앞(위·아래 줄 전열)에 아군 −0.25. 대각선은 둘이어도 한 번만.
 * 최대 −0.75 (전열이 셋이어도 100%는 아니다). 전열 캐릭터는 엄호 없음.
 * 예 (키패드 78/45/12, 왼쪽 열이 후열): 기사 8, 마법사 7 → −0.5 · 사제 4 → −0.25 · 도적 1 → 0.
 * 도적이 5에 서면 마법사 7은 −0.75.
 * occupied: 엄호해 줄 수 있는 아군 칸 (살아 있는 아군·소환물).
 */
export const COVER = { direct: 0.5, diagonal: 0.25 };
export function coverOf(slot: number, occupied: number[]): number {
  if (colOf(slot) === "f") return 0;
  const row = rowOf(slot);
  const front = (r: number) => r >= 0 && r < ROWS_PER_COL && occupied.includes(slotAt("f", r));
  return (front(row) ? COVER.direct : 0) + (front(row - 1) || front(row + 1) ? COVER.diagonal : 0);
}

/** 화면에 그릴 줄 위치. 자유 배치라 서 있는 칸 그대로 (예전 2:2 가운데 모으기는 없앴다). */
export function displayRow(slot: number): number {
  return rowOf(slot);
}
