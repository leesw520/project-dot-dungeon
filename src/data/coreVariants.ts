// 적성 코어 변형의 전투 정의 (2026-11-08, docs/skill-cores.md · docs/classes.md "스킬: 변형" 줄).
// 제작한 코어 개체에 "변형: 스킬: 변형" 보너스가 붙어 있으면, 그 코어를 꽂은 캐릭터는 원래 스킬 대신 이 정의를 쓴다 (engine/party.ts).
// 수치는 문서의 3단계 값 중 가운데. 여기 없는 변형(직업 코어 변형, 두 번째 변형)은 아직 꺼 둔다 (coreOrder.ts가 여기 있는 것만 연다).
import type { SkillDef } from "./skillbook";

type Variant = (b: SkillDef) => SkillDef;
const v = (b: SkillDef, mode: string, line: string, over: Partial<SkillDef>): SkillDef =>
  ({ ...b, ...over, name: `${b.name}: ${mode}`, lines: [line], desc: [line] }) as SkillDef;

export const VARIANTS: Record<string, Variant> = {
  "sp_pierce:휘두르기": (b) => v(b, "휘두르기", "적 1열에 물리 (8 + 공격력 70%), 둔화 1턴 (민첩성 −25%).", { tgt: "col", power: { flat: 8, pct: 70 }, effects: [{ key: "둔화", v: 25, n: 1 }], cat: "물리 · 적 1열" }),
  "gs_slash:내려찍기": (b) => v(b, "내려찍기", "물리 (26 + 공격력 245%). 자신 무방비 1턴 (방어도 획득 불가).", { power: { flat: 26, pct: 245 }, effects: [{ key: "무방비", v: 1, n: 1, to: "self" }] }),
  "gs_spirit:칼날 막기": (b) => v(b, "칼날 막기", "[기합] 대신 방어 행동 1회 + [받아치기]: 다음 근접 피격 시 물리 65% 반격.", { guards: 1, effects: [{ key: "받아치기", v: 65, n: 1, to: "self" }], cat: "방어 · 자신" }),
  "hm_crush:갑옷 깨기": (b) => v(b, "갑옷 깨기", "물리 (16 + 공격력 70%). 손상 대신 무방비 1턴 (방어도 획득 불가).", { power: { flat: 16, pct: 70 }, effects: [{ key: "무방비", v: 1, n: 1 }] }),
  "mg_arrow:연사": (b) => v(b, "연사", "기본 공격이 마력 화살 연사: (10 + 주문력 45%) 무속성 마법 피해 3번.", { basic: b.basic ? { ...b.basic, name: "마력 화살 연사", power: { flat: 10, pct: 45 }, hits: 3 } : undefined }),
  // 2026-11-08 위험도 개편: 도발 효과(위험도 3 + 대상 고정)는 그대로, 방어 행동 대신 물리 피해 + 위험도 2 더
  "gd_taunt:위협": (b) => v(b, "위협", "적 하나에 물리 (10 + 공격력 95%). 도발 효과는 그대로, 위험도 2를 더 얻는다. 방어 행동 없음.", { tgt: "one", dmgType: "physical", power: { flat: 10, pct: 95 }, guards: undefined, aggroConst: { n: 200, scope: "target" }, special: "taunt", cat: "물리 · 적 단일" }),
  "gd_mastery:강철": (b) => v(b, "강철", "방어 행동 시 TP 대신 경감 1 (받는 피해 −20%, 피격 때 소모).", { hooks: { onGuard: (c) => c.addSt(c.u, { key: "경감", v: 1, n: 1, to: "self" }) } }),
  "bb_cry:위협": (b) => v(b, "위협", "힘 대신 적 전체 탈진 2턴 (공격력 −25%). TP +1.", { tgt: "all", effects: [{ key: "탈진", v: 25, n: 2 }], cat: "약화 · 적 전체" }),
  "el_fire:작렬": (b) => v(b, "작렬", "대상과 그 십자 범위에 (88 + 주문력 175%) 불꽃 속성 마법 피해.", { power: { flat: 88, pct: 175 } }),
  "el_wind:난무": (b) => v(b, "난무", "적 하나에 (18 + 주문력 35%) 바람 속성 마법 피해 5번.", { tgt: "one", hits: 5, power: { flat: 18, pct: 35 }, cat: "마법 · 바람 · 적 단일" }),
  "el_bolt:폭풍": (b) => v(b, "폭풍", "무작위 적에게 (20 + 주문력 40%) 번개 속성 마법 피해 5번.", { tgt: "rand", hits: 5, power: { flat: 20, pct: 40 }, cat: "마법 · 번개 · 무작위" }),
  "hl_heal:광역": (b) => v(b, "광역", "아군 전체가 (28 + 주문력 55%) HP를 회복한다.", { tgt: "allyAll", power: { flat: 28, pct: 55 }, cat: "회복 · 아군 전체" }),
  "lt_judge:섬광": (b) => v(b, "섬광", "적 하나에 피해 대신 암흑 (다음 대상 지정 공격이 빗나간다).", { dmgType: "none", power: undefined, effects: [{ key: "암흑", v: 1, n: 1 }], cat: "약화 · 적 단일" }),
};

/** 보너스 문구 "변형: 기본 이름: 변형" → 변형 이름 */
export const modeOfBonus = (bonus: string) => (bonus.startsWith("변형: ") ? bonus.slice(bonus.lastIndexOf(": ") + 2) : null);
