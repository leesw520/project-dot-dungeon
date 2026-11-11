// 탐색(D01) ↔ 전투(B01) 연결. D01이 적 심볼을 덮으면 편성을 맡기고 B01로 가고,
// B01은 승패를 남긴다. 승리는 B02 → B03 → D01, 패배는 바로 D01로 돌아가 D01이 결과를 읽는다.
import type { FormSlot } from "../data/battle";

let request: FormSlot[] | null = null;
/** 전투 배경 (2026-11-09): "cave" | "meadow" … public/backgrounds/battle_<이름>.webp */
let bg = "cave";
export const battleBg = () => bg;
/** 지금 전투가 탐색에서 온 것인가 (패배 버튼·돌아갈 곳을 바꾼다) */
let active = false;
let result: "win" | "lose" | null = null;

export function requestEncounter(form: FormSlot[], background = "cave") {
  request = form;
  bg = background;
  result = null;
}

/** B01 onEnter에서 한 번 읽으면 비운다. */
export function takeEncounter(): FormSlot[] | null {
  const f = request;
  request = null;
  if (f) active = true;
  return f;
}

export const inEncounter = () => active;

/** B01이 승패가 났을 때 부른다 (탐색 전투일 때만 남는다). */
export function reportEncounter(res: "win" | "lose") {
  if (!active) return;
  result = res;
  active = false;
}

/** D01 onEnter에서 한 번 읽으면 비운다. */
export function takeEncounterResult(): "win" | "lose" | null {
  const r = result;
  result = null;
  return r;
}
