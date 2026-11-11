// 직업 키와 이름. 2026-11-07: 편성은 기본 4직업(기사·전사·마법사·사제)만 쓴다. 나머지 직업은 문서(docs/classes.md)에만 있고 미구현.
// 스킬 카탈로그는 data/skillbook.ts (스킬마다 코어 하나, data/skillCores.ts).
import { SKILL_BOOK } from "./skillbook";

export const CLASS_KEYS = ["knight", "warrior", "mage", "priest"] as const;
export type ClassKey = (typeof CLASS_KEYS)[number];
export const CLASS_NAME: Record<ClassKey, string> = { knight: "기사", warrior: "전사", mage: "마법사", priest: "사제" };
export const classKeyOf = (name: string): ClassKey | undefined => CLASS_KEYS.find((k) => CLASS_NAME[k] === name);

export interface SkillInfo {
  name: string;
  passive: boolean;
  /** 액티브 스킬만. "대상 · 비용 · 대기 · 재사용" 한 줄. */
  meta?: string;
  desc: string;
}

/** 코어 효과 라벨("스킬: 강타", "패시브: 진격") 또는 스킬 이름으로 스킬북을 찾는다. 없으면 이름만. */
export function skillInfo(label: string, passive: boolean): SkillInfo {
  const name = label.includes(":") ? label.slice(label.indexOf(":") + 1).trim() : label;
  const s = SKILL_BOOK.find((x) => x.name === name);
  if (!s) return { name, passive, desc: "" };
  return { name, passive: !!s.passive, meta: s.passive ? undefined : s.cat, desc: s.desc.join(" ") };
}
