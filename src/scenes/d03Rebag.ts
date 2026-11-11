// ui-spec.md 5장 3번: B03과 같은 BagGrid 엔진에서 바닥 영역을 뺀 형태. 탐색 중 '인벤토리' (아이템 사용·버리기·재배치, b03Loot.ts).
import { createB03Scene } from "./b03Loot";
import type { Scene } from "./types";

export function createD03Scene(): Scene {
  return createB03Scene(false);
}
