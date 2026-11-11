// 캐릭터 스탯 공용 정의. docs/character-system.md 2장 (2.1 주 스탯, 2.3 파생값, 2.4 전투 파라미터, 2.5 상성).
// 전투(B01)와 스테이터스(P01) 등 여러 화면이 같은 필드 이름을 쓴다.
import type { ElementId } from "./itemTaxonomy";

/** 주 스탯 4종. 저항·명중·회피·운은 없다. */
export type StatKey = "atk" | "spl" | "def" | "agi";

export interface MainStats {
  /** 공격력: 물리 피해 */
  atk: number;
  /** 주문력: 속성(마법) 피해·회복량. 전원 0에서 시작 (장비·코어로 얻는다) */
  spl: number;
  /** 방어력: 방어 행동 시 얻는 방어도. 받는 피해는 줄이지 않는다 */
  def: number;
  /** 민첩성: 턴 속도 = 기본 턴 수치(TURN_BASE) + 민첩성. 직업 기본값은 한 자릿수, 장비·코어로 더한다 */
  agi: number;
}

/** 캐릭터 기본 스탯. 2026-11-06 자원 개편: 전원 MP(원정 예산) + TP(택틱 스택)를 함께 가진다. */
export interface BaseStats extends MainStats {
  hp: number;
  /** 최대 MP (1레벨) */
  mp: number;
  /** 최대 TP (기본 5) */
  tpMax: number;
}

/** 화면 표시 순서와 이름·툴팁 (2.1 스탯 이름 툴팁). */
export const STAT_ORDER: StatKey[] = ["atk", "spl", "def", "agi"];
export const STAT_INFO: Record<StatKey, { name: string; abbr: string; tip: string }> = {
  atk: { name: "공격력", abbr: "ATK", tip: "공격력은 물리 공격의 전반에 영향을 준다." },
  spl: { name: "주문력", abbr: "SPL", tip: "주문력은 마법 공격의 피해량, 회복 스킬의 회복량에 영향을 주며 0에서 시작한다." },
  def: { name: "방어력", abbr: "DEF", tip: "캐릭터가 방어 행동 시 획득하는 방어도의 수치다." },
  agi: { name: "민첩성", abbr: "AGI", tip: "턴 속도 = 기본 턴 수치 32 + 민첩성. 턴 속도가 높을수록 차례가 빨리 온다." },
};

/** 기본 턴 수치 (2026-11-08). 턴 속도 = TURN_BASE + 민첩성 — 아군·적 공통 */
export const TURN_BASE = 32;
export const turnSpeedOf = (agi: number) => TURN_BASE + agi;
/** 턴 대기 시간 (기본 대기) = round(36 × (0.5 + 100 ÷ 턴 속도)) (2.3) */
export const baseWaitOf = (speed: number) => Math.round(36 * (0.5 + 100 / speed));

/** 상시 전투 파라미터 (화면에 표시하지 않음, 2.4). 대기 감소율·고정 어그로는 여기 없다 — 스킬·상태 효과로만. */
export interface CombatParams {
  /** 위협 생성 보정 % */
  threatGen: number;
}
export const DEFAULT_PARAMS: CombatParams = { threatGen: 0 };

/** 속성 상성 단계 −3(약점) ~ +3(내성). 무효·흡수는 특수 (보스·특수 적). */
export type AffinityStep = -3 | -2 | -1 | 0 | 1 | 2 | 3;
export type Affinity = Partial<Record<ElementId, AffinityStep | "null" | "absorb">>;

/** 받는 피해 배율. TODO(spec): 배율 확정 (2.5, 지금은 잠정). */
export const AFFINITY_RATE: Record<AffinityStep, number> = { [-3]: 1.75, [-2]: 1.5, [-1]: 1.25, 0: 1, 1: 0.75, 2: 0.5, 3: 0.25 };

/** 대상 상성에 따른 배율. 흡수는 −1 (호출 쪽에서 회복으로 처리). */
export function affinityRate(aff: Affinity | undefined, el: ElementId | undefined): number {
  const s = el ? aff?.[el] : undefined;
  if (s == null) return 1;
  if (s === "null") return 0;
  if (s === "absorb") return -1;
  return AFFINITY_RATE[s];
}
