// 탐색에서 알아낸 것 — 원정이 끝나도 남는다 (세이브 "knowledge" 칸). docs/exploration.md.
// 미니맵 공개 규칙과 "출현 가능한 적"의 조우 기록을 D01과 미니맵 큰 보기가 함께 쓴다.
import type { FloorDef } from "../data/dungeons";
import { registerSave } from "./save";

const visited = new Set<string>();
const seenDoors = new Set<string>();
const revealed = new Set<string>();
const encountered = new Set<string>();
const SETS = { visited, seenDoors, revealed, encountered };
registerSave(
  "knowledge",
  () => Object.fromEntries(Object.entries(SETS).map(([k, s]) => [k, [...s]])),
  (v) => {
    const d = v as Record<keyof typeof SETS, string[]>;
    for (const [k, s] of Object.entries(SETS)) { s.clear(); (d[k as keyof typeof SETS] ?? []).forEach((x) => s.add(x)); }
  }
);

/** 지금 있거나 지나온 구획 (역대 탐사 전부) */
export const markVisited = (district: string) => visited.add(district);
/** 연결 통로를 시야 안에 둔 적이 있다 */
export const markDoorSeen = (from: string, to: string) => seenDoors.add(`${from}>${to}`);
export const isDoorSeen = (from: string, to: string) => seenDoors.has(`${from}>${to}`);
/** 통로를 안 보고도 구획을 ?로 드러낸다. 다른 능력이 쓸 자리. TODO(spec): 공개 능력, 정보까지 여는 단계 */
export const revealDistrict = (district: string) => revealed.add(district);

export const markEncountered = (monId: string) => encountered.add(monId);
export const isEncountered = (monId: string) => encountered.has(monId);

/** known: 구획 정보 공개, unknown: 있다는 것만 안다(?), hidden: 표시 안 함 */
export type DistrictVisibility = "known" | "unknown" | "hidden";

export function districtVisibility(floor: FloorDef, id: string): DistrictVisibility {
  if (visited.has(id)) return "known";
  if (revealed.has(id)) return "unknown";
  return floor.districts.some((d) => visited.has(d.id) && isDoorSeen(d.id, id)) ? "unknown" : "hidden";
}
