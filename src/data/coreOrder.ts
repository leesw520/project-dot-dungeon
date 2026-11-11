// 직업별 레벨 습득 순서 (2026-11-08 2차, docs/skill-cores.md). 순수 데이터 — 다른 상태를 읽지 않는다.
// - 순서에 들어가는 것: 그 직업 전용 코어 + 그 직업이 쓰는 코어(직업·무기·하위·속성 적성)의 **변형**.
// - 처음 두 직업 코어는 Lv1 (기본 해금·기본 장착). 그 뒤 직업 코어와 변형을 번갈아.
// - 무기·하위·속성 적성 코어 자체는 레벨 순서에 없다 — 기본 해금 (data/coreUnlock.ts).
import { SKILL_BOOK, type SkillDef } from "./skillbook";
import { aptElements, aptitudeOf } from "./aptitude";
import { CLASS_KEYS, CLASS_NAME, type ClassKey } from "./skills";
import { CORE_MODES as ALL_MODES, type CoreMode } from "./coreModes";
import { VARIANTS } from "./coreVariants";

/** 전투 정의가 있는 변형만 (data/coreVariants.ts) — 2026-11-08: 적성 코어 변형 13개 */
const CORE_MODES = ALL_MODES.filter((m) => VARIANTS[`${m.skill}:${m.mode}`]);

/** lv = 습득 레벨 (테스트 압축 적용), designLv = 설계 레벨 (도면 크기 기준) */
export type OrderEntry = { lv: number; designLv: number; skill: SkillDef; mode?: CoreMode };

/** 변형을 레벨 순서·도면 보너스에 넣을지. 2026-11-08: 적성 코어 변형만 전투 정의를 만들어 켰다 (직업 코어 변형은 coreVariants.ts에 없어 빠진다). */
export const MODES_ENABLED = true;

/** 순서 i번째의 레벨 (처음 둘 Lv1). 초안 TODO(spec) */
const LEVEL_STEPS = MODES_ENABLED
  ? [1, 1, 3, 5, 7, 10, 13, 16, 20, 24, 28, 32, 36, 40, 44, 48]
  : [1, 1, 5, 10, 16, 24, 32, 40]; // 직업 코어만 (6~7개)일 때: 몬스터 레벨 구간(B1F 2~5 … B5F 34~40)에 맞춰 층마다 하나쯤
/** 2026-11-08 테스트 버전: 레벨 습득을 Lv1~5에 몰아넣는다 (순서 i번째 → 이 레벨). 도면 크기는 설계 레벨(LEVEL_STEPS) 그대로. */
export const TEST_COMPRESS = true;
const TEST_STEPS = [1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5];
const stepAt = (i: number) => {
  const designLv = LEVEL_STEPS[Math.min(i, LEVEL_STEPS.length - 1)];
  return { designLv, lv: TEST_COMPRESS ? TEST_STEPS[Math.min(i, TEST_STEPS.length - 1)] : designLv };
};

/** 이 직업이 장착할 수 있는 코어인가 (직업 전용 또는 적성) */
function usableBy(name: string, s: SkillDef): boolean {
  const a = aptitudeOf(name);
  const tags = s.req.type === "common" ? [] : (s.req.tags as string[]);
  if (s.req.type === "job") return tags.includes(name);
  if (s.req.type === "weapon") return tags.some((t) => a.weapons.includes(t));
  if (s.req.type === "element") return tags.some((t) => (aptElements(a.elements) as string[]).includes(t));
  if (s.req.type === "sub") return tags.some((t) => a.subs.includes(t));
  return false;
}

/** 직업별 손으로 정한 순서 (2026-11-08). 있으면 자동 배치 대신 이것 — "스킬 id" 또는 "스킬 id:변형". 레벨은 LEVEL_STEPS 순서대로.
 *  사제: 치유(하위 적성)를 예외로 Lv1에 (처음부터 장착), 가호는 뒤로, 마력 화살: 연사(마법사 쪽)는 뺀다. */
const MANUAL_ORDER: Partial<Record<ClassKey, string[]>> = {
  // 치유·축복·빛 계열 패시브(라이트·치유 숙련·치유의 물결·축문 강화·광휘)도 레벨로 (액티브는 신전, data/coreUnlock.ts TEMPLE_CORES)
  priest: ["pr_prayer", "hl_heal", "pr_devotion", "lt_light", "hm_crush:갑옷 깨기", "hl_mastery", "pr_grace", "pr_faith", "hl_heal:광역", "hl_wave", "pr_revive", "bl_prayer", "pr_miracle", "lt_radiance", "lt_judge:섬광", "pr_salvation"],
};

export const LEVEL_ORDER: Record<ClassKey, OrderEntry[]> = Object.fromEntries(
  CLASS_KEYS.map((k) => {
    const name = CLASS_NAME[k];
    const manual = MANUAL_ORDER[k];
    if (manual) {
      const seq = manual.flatMap((key) => {
        const [sid, mode] = key.split(":");
        const skill = SKILL_BOOK.find((x) => x.id === sid);
        const m = mode ? CORE_MODES.find((x) => x.skill === sid && x.mode === mode) : undefined;
        return skill && (!mode || m) ? [{ skill, mode: m }] : [];
      });
      return [k, seq.map((e, i) => ({ ...e, ...stepAt(i) }))];
    }
    const jobs = SKILL_BOOK.filter((s) => s.req.type === "job" && (s.req.tags as string[]).includes(name)).sort((a, b) => a.slots - b.slots);
    const modes = MODES_ENABLED ? CORE_MODES.map((m) => ({ m, s: SKILL_BOOK.find((x) => x.id === m.skill) })).filter((x) => x.s && usableBy(name, x.s)) : [];
    const seq: Array<{ skill: SkillDef; mode?: CoreMode }> = jobs.slice(0, 2).map((skill) => ({ skill }));
    const restJobs = jobs.slice(2);
    for (let i = 0; i < Math.max(restJobs.length, modes.length); i++) {
      if (restJobs[i]) seq.push({ skill: restJobs[i] });
      if (modes[i]) seq.push({ skill: modes[i].s!, mode: modes[i].m });
    }
    return [k, seq.map((e, i) => ({ ...e, ...stepAt(i) }))];
  })
) as Record<ClassKey, OrderEntry[]>;

/** 직업 코어가 열리는 (직업, 레벨) */
export function jobCoreLevels(skillId: string) {
  return CLASS_KEYS.flatMap((k) => LEVEL_ORDER[k].filter((e) => !e.mode && e.skill.id === skillId).map((e) => ({ cls: k, lv: e.lv })));
}
/** 변형이 열리는 (직업, 레벨) — 여러 직업이 쓰는 코어면 여러 줄 */
export function modeLevels(skillId: string, mode: string) {
  return CLASS_KEYS.flatMap((k) => LEVEL_ORDER[k].filter((e) => e.mode?.mode === mode && e.skill.id === skillId).map((e) => ({ cls: k, lv: e.lv })));
}
/** 코어의 "적정 레벨" — 도면 크기용. 직업 코어는 설계 해금 레벨 (테스트 압축 전), 그 밖은 1 (기본 해금). */
export function coreLevel(skillId: string): number {
  const l = CLASS_KEYS.flatMap((k) => LEVEL_ORDER[k].filter((e) => !e.mode && e.skill.id === skillId).map((e) => e.designLv));
  return l.length ? Math.min(...l) : 1;
}
export const modesOf = (skillId: string) => (MODES_ENABLED ? CORE_MODES.filter((m) => m.skill === skillId) : []);
