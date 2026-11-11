// B01 전투 데이터. docs/character-system.md 3.1 (테스트 직업), docs/battle-rules.md 2.1 (편성), docs/classes.md 2장 (상태).
// 스탯 필드는 ./stats.ts 공용 정의. 적 정보는 ./monsters.ts (몬스터 DB), 스킬은 ./skillbook.ts (코어 하나에 스킬 하나).
// 수치는 시스템 검증용 잠정치다. 캐릭터·적 스펙 기준은 아직 미정 — TODO(spec).
import type { CoreReq } from "./aptitude";
import type { ElementId } from "./itemTaxonomy";
import type { Affinity, BaseStats } from "./stats";

/** 상태 키워드 (docs/classes.md 2장 + 6장 새 상태). 감소 방식은 STATUS[k].decay. */
export type StatusKey =
  | "방어도" | "고양" | "위축" | "재생"
  | "독" | "화상" | "출혈" | "빙결"
  | "기절" | "침묵" | "무장해제" | "속박" | "은신"
  | "암흑" | "무방비" | "경감" | "가호" | "최후의 보루" | "기병 돌격" | "패링" | "가로막기"
  | "기합" | "받아치기" | "자동 방어" | "예방의 축문" | "수호의 축문" | "메아리" | "과충전" | "충전" | "기적" | "균열" | "선견" | "유예"
  | "맹세: 수호" | "맹세: 정복" | "위기"
  | "약화" | "취약"
  | TriggerKey | StatModKey;

/** 스택이 트리거 라인에 차면 발동하는 누적 상태 (docs/classes.md 2장). 마비는 감전(기절)으로 바뀐다 */
export type TriggerKey = "혼란" | "공포" | "마비";

/** 능력치 강화·약화 키워드 (±25%, 지속형). 고양·위축은 모든 능력치 ±10% */
export type StatModKey = "힘" | "탈진" | "집중" | "산만" | "견고" | "손상" | "가속" | "둔화";

export type StatusKind = "buff" | "debuff" | "ctrl";

/** 감소 방식 (classes.md 2장): turn 지속형(n = 남은 턴) / once 1회형(조건에 소모, v = 남은 횟수) / keep 유지형 / perm 영구형 / toggle */
export type Decay = "turn" | "once" | "keep" | "perm" | "toggle";

/** 상태 아이콘 테두리 분류와 툴팁 문구. d(v, n): v = 수치·스택, n = 남은 턴. */
export const STATUS: Record<StatusKey, { t: StatusKind; decay: Decay; d: (v: number, n: number) => string[] }> = {
  방어도: { t: "buff", decay: "turn", d: (v) => [`방어도 ${v}`, `받는 피해를 ${v}까지 먼저 흡수.`, "다음 내 차례 시작 시 사라짐."] },
  고양: { t: "buff", decay: "turn", d: (_v, n) => [`고양 · ${n}턴`, "모든 능력치 +10%."] },
  위축: { t: "debuff", decay: "turn", d: (_v, n) => [`위축 · ${n}턴`, "모든 능력치 −10%."] },
  재생: { t: "buff", decay: "turn", d: (v, n) => [`재생 ${v} · ${n}턴`, `차례 시작 시 HP ${v} 회복.`] },
  은신: { t: "buff", decay: "turn", d: (_v, n) => [`은신 · ${n}턴`, "단일 대상으로 고를 수 없다.", "공격하면 해제."] },
  독: { t: "debuff", decay: "turn", d: (v, n) => [`독 ${v} · ${n}턴`, `차례 시작 시 ${v} 피해 (방어도 무시).`, "받는 회복 감소."] },
  화상: { t: "debuff", decay: "turn", d: (v, n) => [`화상 ${v} · ${n}턴`, `차례 시작 시 ${v} 피해.`, "받는 회복 −50%."] },
  출혈: { t: "debuff", decay: "keep", d: (v) => ["출혈", `차례 시작 시 ${v} 피해.`, "TP 회복 불가. 정화 전까지 유지."] },
  빙결: { t: "debuff", decay: "turn", d: (v, n) => [`빙결 ${v} · ${n}턴`, `행동 후 대기 +${v * 5}.`] },
  기절: { t: "ctrl", decay: "once", d: () => ["기절", "다음 행동 1회 취소."] },
  침묵: { t: "ctrl", decay: "once", d: () => ["침묵", "다음 행동 1번 스킬 사용 불가."] },
  무장해제: { t: "ctrl", decay: "turn", d: (_v, n) => [`무장해제 · ${n}턴`, "공격 행동 불가."] },
  속박: { t: "ctrl", decay: "turn", d: (_v, n) => [`속박 · ${n}턴`, "교대·도주 불가."] },
  암흑: { t: "ctrl", decay: "once", d: () => ["암흑", "다음 대상 지정 공격이 빗나간다.", "턴 종료 시 해제."] },
  무방비: { t: "debuff", decay: "turn", d: (_v, n) => [`무방비 · ${n}턴`, "방어도를 얻을 수 없다."] },
  경감: { t: "buff", decay: "once", d: (v) => [`경감 ${v}`, "받는 피해 −20%.", "피해를 받을 때마다 1 소모."] },
  가호: { t: "buff", decay: "once", d: () => ["가호", "치명적인 피해를 HP 1로 버틴다 (1회)."] },
  "최후의 보루": { t: "buff", decay: "once", d: () => ["최후의 보루", "치명적인 피해를 HP 1로 버틴다 (1회)."] },
  "기병 돌격": { t: "buff", decay: "once", d: (v) => ["기병 돌격", `다음 공격 위력 +${v}%.`, "공격하면 소모, 피해를 받으면 제거."] },
  패링: { t: "buff", decay: "once", d: (v) => [`패링 ${v}`, "다음 단일 대상 공격을 흘린다 (피해 0)."] },
  가로막기: { t: "buff", decay: "once", d: () => ["가로막기", "지정한 아군 대신 공격을 받는다 (1회)."] },
  기합: { t: "buff", decay: "turn", d: (v, n) => [`기합 · ${n}턴`, `공격 위력 +${v}%.`] },
  받아치기: { t: "buff", decay: "once", d: (v) => ["받아치기", `다음 근접 피격 시 물리 ${v}% 반격.`] },
  "자동 방어": { t: "buff", decay: "turn", d: (_v, n) => [`자동 방어 · ${n}턴`, "턴 종료 시 방어 행동."] },
  "예방의 축문": { t: "buff", decay: "turn", d: (_v, n) => [`예방의 축문 · ${n}턴`, "다음에 걸리는 상태이상 1번을 막는다."] },
  "수호의 축문": { t: "buff", decay: "turn", d: (v, n) => [`수호의 축문 · ${n}턴`, `차례 시작 시 방어도 ${v}.`] },
  메아리: { t: "buff", decay: "once", d: () => ["메아리", "다음 마법을 비용 소모 없이 한 번 더 쓴다."] },
  과충전: { t: "buff", decay: "toggle", d: () => ["과충전", "공격 스킬 MP 소모 ×2, 위력 ×1.5.", "스킬을 다시 쓰면 해제."] },
  충전: { t: "buff", decay: "once", d: () => ["충전", "다음 마법 위력 +30%."] },
  기적: { t: "buff", decay: "once", d: () => ["기적", "다음 [지원] 스킬 1번은 MP 비용·재사용 없음."] },
  선견: { t: "buff", decay: "keep", d: (v) => [`선견 ${v}/3`, "대기 행동 시 1 쌓인다.", "3이 되면 다음 공격이 급소: 피해 1.5배, 방어도·피해 감소·회피 무시. 공격하면 소모."] },
  유예: { t: "debuff", decay: "keep", d: (v) => [`유예 ${v}`, "미뤄 둔 피해.", "차례 시작 시 남은 값의 1/3(올림)만큼 피해를 입고 그만큼 줄어든다."] },
  균열: { t: "debuff", decay: "turn", d: (v) => [`균열 ${v}`, `공격을 받을 때마다 ${v * 2} 고정 피해 추가.`, "턴마다 1 감소."] },
  "맹세: 수호": { t: "buff", decay: "perm", d: () => ["맹세: 수호", "방어 행동의 방어도 +30%."] },
  "맹세: 정복": { t: "buff", decay: "perm", d: () => ["맹세: 정복", "공격력 +15%, 방어 행동의 방어도 −20%."] },
  위기: { t: "debuff", decay: "perm", d: () => ["위기", "HP 50% 이하."] },
  약화: { t: "debuff", decay: "turn", d: (v, n) => [`약화 ${v}% · ${n}턴`, `주는 피해 −${v}%.`] },
  취약: { t: "debuff", decay: "turn", d: (v, n) => [`취약 ${v}% · ${n}턴`, `받는 피해 +${v}%.`] },
  혼란: { t: "debuff", decay: "turn", d: (v, n) => [`혼란 ${v} · ${n}턴`, "트리거 라인에 차면 무작위 대상을 기본 공격."] },
  공포: { t: "debuff", decay: "turn", d: (v, n) => [`공포 ${v} · ${n}턴`, "트리거 라인에 차면 도주를 시도."] },
  마비: { t: "debuff", decay: "turn", d: (v, n) => [`마비 ${v} · ${n}턴`, "턴 종료 시 1 증가.", "트리거 라인에 차면 감전(기절)."] },
  힘: { t: "buff", decay: "turn", d: (_v, n) => [`힘 · ${n}턴`, "공격력 +25%."] },
  탈진: { t: "debuff", decay: "turn", d: (_v, n) => [`탈진 · ${n}턴`, "공격력 −25%."] },
  집중: { t: "buff", decay: "turn", d: (_v, n) => [`집중 · ${n}턴`, "주문력 +25%."] },
  산만: { t: "debuff", decay: "turn", d: (_v, n) => [`산만 · ${n}턴`, "주문력 −25%."] },
  견고: { t: "buff", decay: "turn", d: (_v, n) => [`견고 · ${n}턴`, "방어력 +25%."] },
  손상: { t: "debuff", decay: "turn", d: (_v, n) => [`손상 · ${n}턴`, "방어력 −25%."] },
  가속: { t: "buff", decay: "turn", d: (_v, n) => [`가속 · ${n}턴`, "턴 속도 +25%."] },
  둔화: { t: "debuff", decay: "turn", d: (_v, n) => [`둔화 · ${n}턴`, "턴 속도 −25%."] },
};

/** 능력치 강화·약화 % (classes.md 2장: ±25%, 고양·위축 ±10%, 상쇄 없음 = 합산). */
export const STAT_MOD_PCT: Partial<Record<StatusKey, { atk?: number; spl?: number; def?: number; agi?: number; all?: number }>> = {
  힘: { atk: 25 }, 탈진: { atk: -25 }, 집중: { spl: 25 }, 산만: { spl: -25 },
  견고: { def: 25 }, 손상: { def: -25 }, 가속: { agi: 25 }, 둔화: { agi: -25 },
  고양: { all: 10 }, 위축: { all: -10 },
};

const VALUED: StatusKey[] = ["방어도", "재생", "독", "화상", "출혈", "빙결", "경감", "패링", "균열", "수호의 축문", "혼란", "공포", "마비", "약화", "취약"];
/** 스택(수치)이 있는 키워드 (상태 창의 게이지 구역, battle-ui.md 4.6). */
export const STATUS_HAS_VALUE = (k: StatusKey) => VALUED.includes(k);

/** 주요 능력치 강화·약화 짝 (docs/classes.md 2장). 상태 창 막대 한 줄이 짝 하나다. */
export const STAT_PAIRS: { label: string; up: StatusKey; down: StatusKey }[] = [
  { label: "공격력", up: "힘", down: "탈진" },
  { label: "주문력", up: "집중", down: "산만" },
  { label: "방어력", up: "견고", down: "손상" },
  { label: "턴 속도", up: "가속", down: "둔화" },
];
/** 모든 능력치에 합산되는 세트. */
export const STAT_SET: { up: StatusKey; down: StatusKey[] } = { up: "고양", down: ["위축"] };
/** 막대 한쪽 끝에 해당하는 % */
export const STAT_BAR_MAX = 50;

/** 상태 창 구역: 능력치 막대 / 스택 게이지 / 있음 표시. 취약·약화는 옛 키워드라 창에서 뺀다. */
export function statusViewOf(k: StatusKey): "stat" | "stack" | "flag" | "hidden" {
  if (k === "취약" || k === "약화") return "hidden";
  if (k === STAT_SET.up || STAT_SET.down.includes(k) || STAT_PAIRS.some((p) => p.up === k || p.down === k)) return "stat";
  return STATUS_HAS_VALUE(k) ? "stack" : "flag";
}

/**
 * 트리거 라인 기본값 (진영별). 값은 engine/battle.ts triggerLine()으로만 읽는다.
 * TODO(spec): CONFUSE_MAX · FEAR_MAX · PARALYZE_MAX 확정 (classes.md 열린 질문). 5는 자리표시.
 */
export const TRIGGER_LINES: Record<"ally" | "foe", Record<TriggerKey, number>> = {
  ally: { 혼란: 5, 공포: 5, 마비: 5 },
  foe: { 혼란: 5, 공포: 5, 마비: 5 },
};
export const isTriggerKey = (k: StatusKey): k is TriggerKey => k in TRIGGER_LINES.ally;

/** 트리거가 없는 스택 상태의 게이지 전체 길이. TODO(spec): 키워드별 기준값 */
export const STACK_GAUGE_LEN: Partial<Record<StatusKey, number>> = { 방어도: 60, 독: 20, 화상: 20, 재생: 20, 균열: 10, 경감: 3, 패링: 3 };
export const STACK_GAUGE_DEFAULT = 20;

export type Seal = "magic" | "weapon" | "move" | "special";
/**
 * 대상: one 적 단일 / row 적 전열 / all 적 전체 / cross 십자 / line 행 관통(같은 줄 전·후열) / col 적 1열(전열 또는 후열)
 * rand 무작위(타격마다) / ally 아군 단일 / allyAll 아군 전체 / self 자신 / dead 전투 불능 아군
 */
export type TargetKind = "one" | "row" | "all" | "cross" | "line" | "col" | "rand" | "ally" | "allyAll" | "self" | "dead";
export type DmgType = "physical" | "magic" | "fixed" | "heal" | "shield" | "none";

export interface EffectDef {
  key: StatusKey;
  v: number;
  n: number;
  /** 기본은 맞힌 대상. self면 시전자 자신. */
  to?: "self";
}

/** 스킬 출처: 코어 장착 조건 종류(aptitude.ts CoreReq) + 태그 하나 (무기 종류, 속성 이름, 보조 직업 이름). */
export interface SkillSrc {
  type: CoreReq["type"];
  tag?: string;
}

/** 아군 행동 (커맨드·스킬·아이템 공용). */
export interface ActDef {
  /** 4원소를 모두 띤 공격 (원소 방출: 프리즘). 원소 보너스는 모두 받고, 상성(약점·내성)은 계산하지 않는다 */
  elemAll?: boolean;
  id: string;
  name: string;
  /** 커맨드 특수 처리. 없으면 일반 스킬/아이템. */
  cmd?: "guard" | "wait" | "swap" | "flee";
  tgt: TargetKind;
  dmgType: DmgType;
  /** 피해·회복·방어도 = 스탯 × pct% + flat (기본 위력). classes.md 4.5 "기본 위력 + 계수" */
  power?: { pct: number; flat: number };
  /** 속성. 없으면 무속성. */
  element?: ElementId;
  hits?: number;
  /** mp "all" = 남은 MP 전량, mpPct = 최대 MP의 % */
  cost?: { tp?: number | "all"; mp?: number | "all"; mpPct?: number };
  /** 아이템이면 가방 키. */
  item?: string;
  wait: number;
  /** 재사용 대기 (자기 턴 수) */
  cd?: number;
  seal?: Seal;
  effects?: EffectDef[];
  /** 아이템용: 이 상태를 없앤다 */
  cleanse?: StatusKey;
  /** 정화 스킬: 상태이상을 골라 n개 제거 (B01 선택 창) */
  cleanseN?: number;
  /** 방어 행동 n회 (도발·철벽·집중 방어). "방어 행동 시" 효과도 횟수만큼 */
  guards?: number;
  /** 방어도 무시 (일도양단) / 방어도에 주는 피해 배율 (분쇄) */
  ignoreShield?: boolean;
  shieldMul?: number;
  /** 고유 처리 (engine/battle.ts SPECIAL 표) */
  special?: string;
  /** 무기 적성 이름 (마스터리 판정: 한손검·창·대검·망치·지팡이 …) */
  weapon?: string;
  /** 스킬 고유 위험도 (옛 어그로 상수: n 100 = 위험도 1, 7장) */
  aggroConst?: { n: number; scope: "all" | "target" };
  /** 설명 창: 분류·대상 1줄 + 설명 1~2줄. */
  cat: string;
  /** 스킬 출처 분류 (P01 스킬 탭 묶음). */
  src?: SkillSrc;
  desc: string[];
}

export const ATTACK: ActDef = { id: "attack", name: "공격", tgt: "one", dmgType: "physical", power: { pct: 100, flat: 0 }, wait: 0, seal: "weapon", cat: "물리 · 적 단일", desc: ["무기로 적 하나를 벤다.", "TP +1."] };
export const GUARD: ActDef = { id: "guard", name: "방어", cmd: "guard", tgt: "self", dmgType: "none", wait: 0, cat: "자신", desc: ["방어력만큼 방어도를 얻는다.", "다음 차례 시작 시 사라짐."] };
export const WAIT: ActDef = { id: "wait", name: "대기", cmd: "wait", tgt: "self", dmgType: "none", wait: 0, cat: "자신", desc: ["턴 대기 50%만 쓰고", "이번 차례를 넘긴다."] };
// TODO(spec): 교대 대상 선택 화면 미정 (battle-ui.md 8장). 지금은 고를 수 없게 둔다.
export const SWAP: ActDef = { id: "swap", name: "교대", cmd: "swap", tgt: "self", dmgType: "none", wait: 5, seal: "move", cat: "아군 하나와 자리를 바꾼다.", desc: [] };
// TODO(spec): 도주 성공률 공식 미정 (battle-rules.md 12장). 지금은 고를 수 없게 둔다.
export const FLEE: ActDef = { id: "flee", name: "도주", cmd: "flee", tgt: "self", dmgType: "none", wait: 0, seal: "move", cat: "전투에서 벗어난다.", desc: ["실패하면 차례만 쓴다."] };

export const ITEMS: ActDef[] = [
  { id: "potion", name: "회복약", item: "회복약", tgt: "ally", dmgType: "heal", power: { pct: 0, flat: 40 }, wait: 12, cat: "아군 단일", desc: ["HP를 40 회복한다."] },
  { id: "antidote", name: "해독초", item: "해독초", tgt: "ally", dmgType: "none", cleanse: "독", wait: 12, cat: "아군 단일", desc: ["독을 없앤다."] },
  { id: "molotov", name: "화염병", item: "화염병", tgt: "all", dmgType: "fixed", power: { pct: 0, flat: 12 }, wait: 15, effects: [{ key: "화상", v: 4, n: 2 }], cat: "불꽃 · 적 전체", desc: ["불길을 퍼뜨린다. 화상 4."] },
];

export const BAG_START: Record<string, number> = { 회복약: 3, 해독초: 1, 화염병: 2 };

export interface AllyDef extends BaseStats {
  name: string;
  color: string;
  affinity?: Affinity;
}

// character-system.md 3.1 (2026-11-07): 기본 4직업. 전원 MP + TP(최대 5). 주문력은 전원 0에서 시작 (장비·코어로).
export const PARTY: AllyDef[] = [
  // 2026-11-08 2차: HP 절반 (기사·전사 교환 — 기사가 더 높다), 기본 옷 HP +10을 더해 시작. 속성 상성 없음 (스킬·장비로).
  // 민첩성 = 직업 기본 민첩(한 자릿수, 10~20이면 초반에 매우 빠름) — 턴 속도 = 기본 턴 수치 32 + 민첩성 (data/stats.ts).
  // 레벨업 능력치 상승은 없다 — 성장은 스킬 코어 칸 확장과 장비·코어로 (character-system.md 2.1).
  { name: "기사", color: "#1D9E75", hp: 60, mp: 12, tpMax: 5, atk: 14, spl: 0, def: 18, agi: 6 },
  { name: "전사", color: "#D85A30", hp: 55, mp: 12, tpMax: 5, atk: 18, spl: 0, def: 10, agi: 5 },
  { name: "마법사", color: "#378ADD", hp: 33, mp: 50, tpMax: 5, atk: 6, spl: 0, def: 5, agi: 7 },
  { name: "사제", color: "#7F77DD", hp: 38, mp: 45, tpMax: 5, atk: 8, spl: 0, def: 8, agi: 8 },
];

/** 적 인텐트 종류 (battle-ui.md 4.7). */
export type IntentKind = "one" | "multi" | "all" | "row" | "aim" | "guard" | "buff" | "debuff";

export interface FoeAct {
  k: IntentKind;
  dmgType?: "physical" | "magic";
  /** 마법 공격 속성. TODO(spec): 적 마법 공격의 속성 값 */
  element?: ElementId;
  pct?: number;
  hits?: number;
  /** 열 공격 대상 열 */
  row?: "f" | "b";
  effect?: EffectDef;
}

/** 편성 한 칸: 몬스터 DB id, 열. 레벨·수치·패턴은 data/monsters.ts의 고정값 (강한 개체는 별도 레코드). */
export interface FormSlot {
  mon: string;
  col: "f" | "b";
}

/** 편성 패턴. 열 안 순서 = 배열 순서 (battle-rules.md 2.1). TODO(spec): 편성 패턴 데이터 형식 (던전·층별 출현표). */
export const FORMS: Record<string, FormSlot[]> = {
  "소형 1": [{ mon: "goblin", col: "f" }],
  "중형 1 + 소형 1": [{ mon: "golem", col: "f" }, { mon: "goblin", col: "f" }],
  "소형 3 + 중형 1": [{ mon: "goblin", col: "f" }, { mon: "goblin_shaman", col: "f" }, { mon: "goblin", col: "f" }, { mon: "golem", col: "b" }],
  "소형 4": [{ mon: "goblin", col: "f" }, { mon: "goblin", col: "f" }, { mon: "goblin_shaman", col: "b" }, { mon: "bat", col: "b" }],
  "대형 2": [{ mon: "troll", col: "f" }, { mon: "ogre", col: "b" }],
  "소형 6": [{ mon: "goblin", col: "f" }, { mon: "goblin", col: "f" }, { mon: "goblin", col: "f" }, { mon: "bat", col: "b" }, { mon: "bat", col: "b" }, { mon: "bat", col: "b" }],
  "보스 1": [{ mon: "dragon", col: "f" }],
};
export const DEFAULT_FORM = "소형 3 + 중형 1";
