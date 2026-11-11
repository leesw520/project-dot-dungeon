// 적성 — 코어를 분류하고 장착 가능 여부를 정하는 카테고리 (docs/character-system.md 3.2, 4.1).
// 직업마다 직업 / 무기 / 속성 / 보조 직업 적성을 목록으로 가진다. 캐릭터 키는 PARTY의 name.
//   직업: 지금은 자기 직업 하나. 상위직은 하위 직업 적성을 포함하는 식으로 늘어난다 (그래서 목록).
//   무기: 착용할 수 있는 무기 종류 (P02) + 그 무기와 연관된 코어 (P03).
//   속성: 0개일 수 있다 (근접 무기직). 있으면 그 속성 스킬 코어를 장착할 수 있다.
//   보조 직업: 서로 다른 직업을 효과·컨셉으로 묶는 범주.
import { ELEMENT_DEFS, type ElementId } from "./itemTaxonomy";

export interface Aptitude {
  jobs: string[];
  /** 무기 종류 이름 — pieces.ts equip.type과 같은 문자열 (한손검, 방패, 완드 …). */
  weapons: string[];
  /** 속성 적성 이름 (원소·빛·어둠). 한 적성이 여러 속성을 묶는다 (ELEMENT_APT). */
  elements: string[];
  subs: string[];
}

// 2026-11-07: 기본 4직업 (docs/classes.md 직업별 적성 요약). 보조 직업 = 하위 적성(수호·지휘·강습 …).
// 2026-11-08: 속성 적성은 묶음 이름 — 원소(불꽃·번개·바람·얼음) / 빛 / 어둠. 마법사는 원소 하나만 (4원소를 따로 두지 않는다).
export const ELEMENT_APT: Record<string, ElementId[]> = { 원소: ["red", "yellow", "green", "blue"], 빛: ["white"], 어둠: ["black"] };
/** 속성 → 그 속성을 묶는 적성 이름 */
export const elementAptOf = (e: ElementId) => Object.keys(ELEMENT_APT).find((k) => ELEMENT_APT[k].includes(e)) ?? ELEMENT_DEFS[e].label;
/** 적성 목록이 덮는 속성들 */
export const aptElements = (apts: readonly string[]): ElementId[] => apts.flatMap((a) => ELEMENT_APT[a] ?? []);

export const APTITUDE: Record<string, Aptitude> = {
  기사: { jobs: ["기사"], weapons: ["한손검", "방패", "창"], elements: [], subs: ["수호", "지휘", "강습"] },
  전사: { jobs: ["전사"], weapons: ["대검", "망치"], elements: [], subs: ["야만", "투지", "강습"] },
  마법사: { jobs: ["마법사"], weapons: ["지팡이", "오브"], elements: ["원소"], subs: ["마법", "비전", "학자"] },
  사제: { jobs: ["사제"], weapons: ["지팡이", "망치"], elements: ["빛"], subs: ["치유", "축복"] },
};

const NONE: Aptitude = { jobs: [], weapons: [], elements: [], subs: [] };
export const aptitudeOf = (char: string): Aptitude => APTITUDE[char] ?? NONE;

/** 코어 장착 조건 3종류: 직업 전용 / 적성(무기·속성·보조) / 공용. tags 중 하나만 맞으면 된다. */
export type CoreReq =
  | { type: "job"; tags: string[] }
  | { type: "weapon"; tags: string[] }
  | { type: "element"; tags: ElementId[] }
  | { type: "sub"; tags: string[] }
  | { type: "common" };

export const CORE_REQ_LABEL: Record<CoreReq["type"], string> = {
  job: "직업 전용",
  weapon: "무기 적성",
  element: "속성 적성",
  sub: "보조 직업",
  common: "공용",
};

/** "적성: 기사", "적성: 방패", "적성: 얼음/빛", "공용" 같은 한 줄 (직업·무기·속성·보조 구분 없이 같은 표기, 2026-11-07). */
export function coreReqText(req: CoreReq | undefined): string {
  if (!req || req.type === "common") return CORE_REQ_LABEL.common;
  const tags = req.type === "element" ? [...new Set(req.tags.map(elementAptOf))] : req.tags;
  return `적성: ${tags.join("/")}`;
}

/** 장착할 수 없으면 이유 문장, 가능하면 null. 조건이 없으면 공용으로 본다. */
export function coreBlockReason(char: string, req: CoreReq | undefined): string | null {
  if (!req || req.type === "common") return null;
  const a = aptitudeOf(char);
  const own: readonly string[] =
    req.type === "job" ? a.jobs : req.type === "weapon" ? a.weapons : req.type === "element" ? aptElements(a.elements) : a.subs;
  if ((req.tags as readonly string[]).some((t) => own.includes(t))) return null;
  const tags = req.type === "element" ? [...new Set(req.tags.map(elementAptOf))] : req.tags;
  if (req.type === "job") return `${tags.join("/")} 전용 코어`;
  return `${CORE_REQ_LABEL[req.type]} 필요: ${tags.join("/")}`;
}

/** 무기 적성에 없는 무기 종류면 이유 문장. */
export function weaponBlockReason(char: string, weaponType: string): string | null {
  return aptitudeOf(char).weapons.includes(weaponType) ? null : `무기 적성 없음: ${weaponType}`;
}
