// ui-spec.md 5장 "구현 순서" 그대로. 화면 하나 끝낼 때마다 참조 파일과 비교한다.
import type { Scene } from "./types";
import { createB01Scene } from "./b01Battle";
import { createB02Scene } from "./b02Result";
import { createB03Scene } from "./b03Loot";
import { createD03Scene } from "./d03Rebag";
import { createD01Scene } from "./d01Explore";
import { createE01Scene } from "./e01ExpeditionResult";
import { createH01Scene } from "./h01Hub";
import { createH03Scene } from "./h03Warehouse";
import { createH04Scene } from "./h04Prep";
import { createH05Scene } from "./h05Temple";
import { createC01Scene } from "./c01CraftList";
import { createC02Scene } from "./c02CraftBoard";
import { createC03Scene } from "./c03CraftDone";
import { createC04Scene } from "./c04Salvage";
import { createP01Scene } from "./p01Status";
import { createP02Scene } from "./p02Equip";
import { createP03Scene } from "./p03SkillCore";
import { createP04Scene } from "./p04SkillList";
import { createJ01Scene } from "./j01Dex";
import { createD06Scene } from "./d06Formation";
import { createJ02Scene } from "./j02MonsterDex";
import { createX01Scene } from "./x01Effects";
import { createT01Scene } from "./t01Title";

export const SCENES: Scene[] = [
  createB01Scene(),
  createB02Scene(),
  createB03Scene(true),
  createD03Scene(),
  createD06Scene(),
  createD01Scene(),
  createE01Scene(),
  createH01Scene(),
  createH03Scene(),
  createH04Scene(),
  createH05Scene(),
  createC01Scene(),
  createC02Scene(),
  createC03Scene(),
  createC04Scene(),
  createP01Scene(),
  createP02Scene(),
  createP03Scene(),
  createP04Scene(),
  createJ01Scene(),
  createJ02Scene(),
  createX01Scene(),
  createT01Scene(),
];
