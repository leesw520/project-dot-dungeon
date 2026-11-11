// 탐색 규칙 데이터 (docs/exploration.md): 길 타일, 심볼 종류, 체류 시간, 시야, 탐색 스킬.
// 던전·층·구획 자체는 data/dungeons.ts.
import type { Cell } from "./pieces";

// ---------- 길 타일 ----------
export interface PathPiece {
  id: string;
  name: string;
  cells: Cell[];
  /** 1 테트로미노·트로미노(초반) / 2 펜토미노 / 3 복잡한 모양(후반) */
  tier: 1 | 2 | 3;
}

export const PATH_PIECES: Record<string, PathPiece> = {
  i3: { id: "i3", name: "3칸 직선", cells: [[0, 0], [1, 0], [2, 0]], tier: 1 },
  l3: { id: "l3", name: "3칸 ㄴ자", cells: [[0, 0], [0, 1], [1, 1]], tier: 1 },
  i4: { id: "i4", name: "긴 막대", cells: [[0, 0], [1, 0], [2, 0], [3, 0]], tier: 1 },
  o4: { id: "o4", name: "네모", cells: [[0, 0], [1, 0], [0, 1], [1, 1]], tier: 1 },
  t4: { id: "t4", name: "T자", cells: [[0, 0], [1, 0], [2, 0], [1, 1]], tier: 1 },
  s4: { id: "s4", name: "S자", cells: [[1, 0], [2, 0], [0, 1], [1, 1]], tier: 1 },
  z4: { id: "z4", name: "Z자", cells: [[0, 0], [1, 0], [1, 1], [2, 1]], tier: 1 },
  l4: { id: "l4", name: "L자", cells: [[0, 0], [0, 1], [0, 2], [1, 2]], tier: 1 },
  j4: { id: "j4", name: "J자", cells: [[1, 0], [1, 1], [1, 2], [0, 2]], tier: 1 },
  u5: { id: "u5", name: "U자", cells: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]], tier: 2 },
  p5: { id: "p5", name: "P자", cells: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]], tier: 2 },
  v5: { id: "v5", name: "큰 꺾쇠", cells: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]], tier: 2 },
  w5: { id: "w5", name: "계단", cells: [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2]], tier: 2 },
  x5: { id: "x5", name: "십자", cells: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], tier: 2 },
  hook6: { id: "hook6", name: "갈고리", cells: [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2]], tier: 3 },
  ring7: { id: "ring7", name: "고리", cells: [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2]], tier: 3 },
};

// ---------- 심볼 ----------
// 맵(구획)에 고정으로 놓이는 것: 채집 포인트, 보물상자, 휴식 포인트. 위치는 층·구획마다 고정.
// 길 타일에 붙어 나오는 것: 적 심볼, 아이템 심볼. 그 타일을 놓으면 적 심볼마다 전투, 아이템은 바로 획득.
export type EnemySize = "s" | "m" | "l";
export const ENEMY_SIZE_LABEL: Record<EnemySize, string> = { s: "소", m: "중", l: "대" };
/** 옛 규칙(심볼 크기 → 마리 수). 2026-11-08부터 안 쓴다: 팀은 구획 전투력 범위(DistrictDef.power)로 짜고 심볼은 1칸 하나. */
export const ENEMY_SIZE_COUNT: Record<EnemySize, number> = { s: 1, m: 2, l: 3 };

/** 채집지 종류. 맵에는 종류만 보이고, 무슨 조각이 나올지는 캐 봐야 안다 (종류마다 나올 법한 소재 목록). */
export type GatherKind = "bush" | "tree" | "flower" | "rubble" | "pool" | "crystal" | "mushroom" | "sand" | "corpse" | "web";
export interface GatherKindDef {
  name: string;
  /** 툴팁 한 줄 — 대략 어떤 계열이 나올지 */
  hint: string;
  /** 기본으로 나오는 소재 (data/pieces.ts id, 같은 확률). 구획에 gatherLoot가 있으면 그쪽(가중치)을 쓴다 — docs/dungeon-themes.md */
  loot: string[];
}
export const GATHER_KINDS: Record<GatherKind, GatherKindDef> = {
  bush: { name: "덤불", hint: "풀·줄기 같은 식물 소재가 나올 것 같다.", loot: ["m:이름 없는 풀", "m:마른 풀", "m:마력초", "m:튼튼한 덩굴", "m:쓴뿌리", "m:야생감자", "m:야생 보리", "m:솜털풀", "m:소금풀", "m:칠점 무당벌레"] },
  tree: { name: "나무", hint: "열매나 가지가 걸려 있을지도.", loot: ["m:나뭇가지", "m:나무껍질", "m:단풍 수액", "m:벌집", "m:마른 톱밥", "m:가연성 나무껍질", "m:동굴제비 알", "m:올레아 열매", "m:들딸기"] },
  flower: { name: "꽃밭", hint: "꽃잎·약초 계열 소재가 날 것 같다.", loot: ["m:화염초", "m:서리초", "m:뇌명초", "m:산들초", "m:마나 이슬"] },
  rubble: { name: "돌무더기", hint: "돌조각이나 광석이 섞여 있다.", loot: ["m:동굴 돌멩이", "m:풍화된 돌", "m:종유석 파편", "m:철광석", "m:적열광", "m:청수광", "m:동굴 암염"] },
  pool: { name: "물웅덩이", hint: "차가운 물. 얼음 결정이 가라앉아 있을지도.", loot: ["m:깨끗한 물", "m:약초 우린 물", "m:동굴 새우", "m:조개껍데기", "m:청류 강돌"] },
  crystal: { name: "결정 덩어리", hint: "빛나는 원석 계열. 가끔 귀한 것이 나온다.", loot: ["m:원소 가루", "m:마석 파편", "m:작은 결정"] },
  mushroom: { name: "버섯 군락", hint: "묘한 기운이 도는 버섯. 무엇이 나올지 모른다.", loot: ["m:동굴 버섯", "m:바삭바삭 버섯", "m:검은 독버섯"] },
  sand: { name: "모래", hint: "모래와 화약 같은 가루가 섞여 있다.", loot: ["m:고운 모래", "m:가연성 모래", "m:잿빛 모래", "m:흑화 모래", "m:썩은 부엽토"] },
  corpse: { name: "시체", hint: "쓰러진 짐승의 잔해. 뼈나 가죽이 남아 있을지도.", loot: ["m:커다란 뼈", "m:종잇조각"] },
  web: { name: "거미줄", hint: "끈적한 거미줄. 실이나 벌레가 걸려 있다.", loot: ["m:거미줄"] },
};

// ---------- 체류 시간 ----------
/**
 * 남은 배치 횟수 = 체류 시간 (주인공 일행이 도트의 힘을 오래 못 버틴다). 타일을 하나 놓을 때마다 1 줄고, 0이면 귀환.
 * TODO(spec): 성장에 따른 증가식. 지금은 기본 + 파티 평균 레벨 × perLevel.
 */
export const STAY = {
  base: 16,
  perLevel: 1,
  /** 문을 지나 다른 구획으로 넘어갈 때 드는 횟수 (진행도 1) */
  doorCost: 1,
  /** 휴식 포인트를 길로 덮으면 */
  restBonus: 6,
};

// ---------- 시야 ----------
/**
 * 시야(밝기): 깐 길과 입구에서 이 거리(칸)까지는 선명하고, 그 밖은 1칸마다 한 단계씩 어두워지며 해상도가 낮아진다.
 * 파티 기본값 + 수정값(탐색 능력·스킬·층 특성). TODO(spec): 캐릭터별 시야, 시야를 늘리고 줄이는 스킬·장비.
 */
export const VISION = {
  base: 2.5,
  min: 0.5,
  max: 12,
  /** 단계별 모자이크 블록 크기(px)와 어둡기 (0단계 = 선명). 칸(16px)의 약수만. */
  blocks: [1, 2, 4, 8, 16],
  dims: [0, 0.3, 0.55, 0.78, 0.94],
};

/** 시야 수정값 합산 (min~max로 묶는다). */
export function visionRange(mods: number[]): number {
  return Math.max(VISION.min, Math.min(VISION.max, VISION.base + mods.reduce((t, v) => t + v, 0)));
}

/** 길 타일 풀 (구획의 deck이 이 이름을 가리킨다). id, 가중치. */
const EARLY: Array<[string, number]> = [["i3", 2], ["l3", 2], ["i4", 2], ["o4", 2], ["t4", 2], ["s4", 1], ["z4", 1], ["l4", 2], ["j4", 2]];
const MID: Array<[string, number]> = [...EARLY, ["u5", 1], ["p5", 1], ["v5", 1], ["w5", 1], ["x5", 1]];
export const DECKS: Record<string, Array<[string, number]>> = {
  /** 1층: 4칸 테트리스 모양 + 3칸 직선 · 3칸 ㄴ자 */
  early: EARLY,
  mid: MID,
  deep: [...MID, ["hook6", 1], ["ring7", 1]],
};

/** 탐색 스킬 (캐릭터별). 배치를 돕는 효과. TODO(spec): 사용 횟수 회복 규칙, 스킬 습득 경로(코어 판 연동) */
export type ExploreSkillId = "skip" | "swap" | "erase" | "foresee" | "mirror";
export interface ExploreSkill {
  id: ExploreSkillId;
  /** PARTY name */
  owner: string;
  name: string;
  desc: string;
  /** 층마다 사용 횟수 */
  uses: number;
}

// 2026-11-07: 캐릭터만 있으면 쓰던 탐색 스킬(강행·길잡이·기척 지우기·예지·거울 걸음)은 뺐다.
// 탐색 스킬은 스킬 코어로만 얻는다 (지금은 패시브 이해·예지와 사용형 라이트(MP), d01 flyRows). 사용형 코어가 생기면 여기에 다시 둔다.
export const EXPLORE_SKILLS: ExploreSkill[] = [];
