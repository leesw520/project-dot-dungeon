// 공용 스킬 코어 (2026-11-08, docs/common-cores.md). 누구나 장착. 스킬북(SKILL_BOOK)에 더해 skillCores.ts가 코어 아이템·도면을 만든다.
// 크기 I~IV = 1~4칸, 단위 = N² − (N − 1) → 1 · 3 · 7 · 13. 제작은 드롭으로 한 번 얻어야 열린다 (data/coreUnlock.ts).
// id 규칙: co_<계열>_<단계 1~4> (단일 크기는 co_<이름>). cm_은 지휘 적성이 쓴다.
import { SKILL_BOOK, type SkillDef, type PartyMods, type ExploreMods, type Hooks } from "./skillbook";
import type { ElementId } from "./itemTaxonomy";

const UNITS = [0, 1, 3, 7, 13];
const ROMAN = ["", "I", "II", "III", "IV"];
const COMMON = { type: "common" } as const;

function passiveCore(id: string, name: string, slots: number, lines: string[], extra: Partial<SkillDef>): SkillDef {
  return { id, name, apt: "공용", req: COMMON, slots, passive: true, tgt: "self", dmgType: "none", wait: 0, cat: "패시브", desc: lines, lines, ...extra } as SkillDef;
}
/** I~IV 단계 코어 묶음. make(단계, 단위) → [설명 줄, 추가 필드] */
function tiers(key: string, name: string, which: number[], make: (t: number, u: number) => [string, Partial<SkillDef>]) {
  return which.map((t) => {
    const [line, extra] = make(t, UNITS[t]);
    return passiveCore(`co_${key}_${t}`, `${name} ${ROMAN[t]}`, t, [line], extra);
  });
}
const r = (x: number) => Math.round(x);
const party = (m: PartyMods): Partial<SkillDef> => ({ party: m });
const explore = (m: ExploreMods): Partial<SkillDef> => ({ explore: m });

// ---- 2. 능력치 ----
type StatK = "hp" | "mp" | "atk" | "spl" | "def" | "agi";
const STAT_UNIT: Record<StatK, number> = { hp: 20, mp: 5, atk: 4, spl: 4, def: 4, agi: 1.5 };
const STAT_NAME: Record<StatK, string> = { hp: "HP", mp: "MP", atk: "공격력", spl: "주문력", def: "방어력", agi: "민첩성" };
function statMods(vals: Partial<Record<StatK, number>>): PartyMods {
  return { hpAdd: vals.hp, mpAdd: vals.mp, atkAdd: vals.atk, splAdd: vals.spl, defAdd: vals.def, agiAdd: vals.agi };
}
const statLine = (vals: Partial<Record<StatK, number>>) =>
  (Object.keys(vals) as StatK[]).map((k) => `${STAT_NAME[k]} +${vals[k]}`).join(", ") + ".";
function statCore(key: string, name: string, stats: StatK[], share: number, which = [1, 2, 3, 4]) {
  return tiers(key, name, which, (_t, u) => {
    const vals = Object.fromEntries(stats.map((k) => [k, Math.max(1, r(STAT_UNIT[k] * u * share))])) as Partial<Record<StatK, number>>;
    return [statLine(vals), party(statMods(vals))];
  });
}

const CORES: SkillDef[] = [
  ...statCore("hp", "체력", ["hp"], 1),
  ...statCore("mp", "마력", ["mp"], 1),
  ...statCore("atk", "공격", ["atk"], 1),
  ...statCore("spl", "주문", ["spl"], 1),
  ...statCore("def", "방어", ["def"], 1),
  ...statCore("agi", "민첩", ["agi"], 1),
  ...tiers("tp", "집중", [2, 3, 4], (t) => [`TP 최대 +${t - 1}.`, party({ tpMaxAdd: t - 1 })]),
  // 복합: 2종 70%씩 · 3종 50%씩
  ...statCore("atkhp", "공격·체력", ["atk", "hp"], 0.7),
  ...statCore("defhp", "방어·체력", ["def", "hp"], 0.7),
  ...statCore("splmp", "주문·마력", ["spl", "mp"], 0.7),
  ...statCore("atkagi", "공격·민첩", ["atk", "agi"], 0.7),
  ...statCore("atkspl", "공격·주문", ["atk", "spl"], 0.7),
  ...statCore("hpmp", "체력·마력", ["hp", "mp"], 0.7),
  ...statCore("atkdefhp", "공격·방어·체력", ["atk", "def", "hp"], 0.5, [2, 3, 4]),
  ...statCore("splmpagi", "주문·마력·민첩", ["spl", "mp", "agi"], 0.5, [2, 3, 4]),
  ...statCore("atksplagi", "공격·주문·민첩", ["atk", "spl", "agi"], 0.5, [2, 3, 4]),
  ...statCore("defhpmp", "방어·체력·마력", ["def", "hp", "mp"], 0.5, [2, 3, 4]),
  // 전능력: 주 스탯 4종 모두 +N
  ...tiers("all", "전능력", [2, 3, 4], (t) => {
    const n = [0, 1, 2, 6, 11][t];
    return [`공격력·주문력·방어력·민첩성 +${n}.`, party({ atkAdd: n, splAdd: n, defAdd: n, agiAdd: n })];
  }),
];

// ---- 3.1 속성 내성 ----
const EL: Array<[ElementId, string]> = [["red", "불꽃"], ["blue", "얼음"], ["yellow", "번개"], ["green", "바람"], ["white", "빛"], ["black", "어둠"]];
for (const [e, n] of EL) CORES.push(...tiers(`res_${e}`, `${n} 내성`, [2, 4], (t) => [`${n} 상성 +${t / 2}단계 (받는 피해 ${25 * (t / 2)}% 감소).`, party({ resist: { [e]: t / 2 } })]));
for (const [[a, an], [b, bn]] of [[EL[0], EL[1]], [EL[2], EL[3]], [EL[4], EL[5]]] as const)
  CORES.push(passiveCore(`co_res_${a}${b}`, `${an}·${bn} 내성`, 3, [`${an}·${bn} 상성 +1단계.`], party({ resist: { [a]: 1, [b]: 1 } })));
CORES.push(passiveCore("co_res_all", "전속성 내성", 4, ["6속성 상성 모두 +1단계."], party({ resist: Object.fromEntries(EL.map(([e]) => [e, 1])) })));

// ---- 3.2 기본 행동 · 3.3 위협·도주 ----
const baseWait = (agi: number) => 36 * (0.5 + 100 / Math.max(1, agi));
const hookCore = (id: string, name: string, slots: number, line: string, hooks: Hooks) => passiveCore(id, name, slots, [line], { hooks });
CORES.push(
  hookCore("co_quick", "날랜 손", 2, "기본 공격 후 대기 −20%.", { waitAdj: (c, a) => (a.id === "attack" ? -r(baseWait(c.stat(c.u, "agi")) * 0.2) : 0) }),
  hookCore("co_heavy", "힘껏 치기", 2, "기본 공격 위력 +50%, 대신 대기 +30%.", {
    dmgPct: (_c, a) => (a.id === "attack" ? 50 : 0),
    waitAdj: (c, a) => (a.id === "attack" ? r(baseWait(c.stat(c.u, "agi")) * 0.3) : 0),
  }),
  hookCore("co_breath", "숨 돌리기", 2, "대기 행동 때 MP +3.", { onWait: (c) => c.mp(c.u, 3) }),
  hookCore("co_tune", "정비", 2, "대기 행동 때 재사용 대기 중인 내 기술의 남은 턴 −1.", {
    onWait: (c) => { for (const k of Object.keys(c.u.cds)) c.u.cds[k] = Math.max(0, c.u.cds[k] - 1); },
  }),
  ...tiers("sturdy", "굳건함", [1, 2, 3, 4], (_t, u) => [`방어 행동 때 방어도 +${3 * u}.`, { hooks: { onGuard: (c) => c.shield(c.u, 3 * u) } }]),
  // 2026-11-08 위험도 개편: 프레셔 = 전투 시작 위험도 +단계, 기척 죽이기 = 턴 종료 때 위험도가 단계만큼 더 줄어든다
  ...tiers("press", "프레셔", [1, 2, 3, 4], (t) => [`전투 시작 때 위험도 +${t}.`, { dangerStart: t }]),
  ...tiers("stealth", "기척 죽이기", [1, 2, 3, 4], (t) => [`턴이 끝날 때 위험도가 ${t} 더 줄어든다.`, { dangerDecay: t }]),
  passiveCore("co_flee", "도주", 1, ["도주 성공률 +10%. (도주 규칙 준비 중)"], {}),
);

// ---- 4. 탐색 ----
const half = (u: number) => Math.ceil(u / 2);
CORES.push(
  ...tiers("camp", "야영", [1, 2, 3, 4], (_t, u) => [`체류 횟수 +${half(u)}.`, explore({ stay: half(u) })]),
  ...tiers("rest", "휴식", [1, 2, 3, 4], (_t, u) => [`휴식 포인트 체류 보너스 +${half(u)}.`, explore({ rest: half(u) })]),
  ...tiers("torch", "횃불", [1, 2, 3, 4], (_t, u) => [`시야 +${u / 4}.`, explore({ vision: u / 4 })]),
  ...tiers("mine", "채광", [1, 2, 3, 4], (_t, u) => [`바위·결정·모래에서 채집할 때 ${5 * u}% 확률로 1개 더.`, explore({ gather: { rock: 5 * u } })]),
  ...tiers("log", "벌목", [1, 2, 3, 4], (_t, u) => [`나무·시체·거미줄에서 채집할 때 ${5 * u}% 확률로 1개 더.`, explore({ gather: { wood: 5 * u } })]),
  ...tiers("herb", "채취", [1, 2, 3, 4], (_t, u) => [`덤불·꽃·버섯·물에서 채집할 때 ${5 * u}% 확률로 1개 더.`, explore({ gather: { herb: 5 * u } })]),
  ...tiers("scout", "사전 정찰", [1, 2, 3, 4], (_t, u) => [`길 타일에 적 심볼이 붙을 확률 −${3 * u}%.`, explore({ enemyDown: 3 * u })]),
  ...tiers("learn", "학습", [1, 2, 3, 4], (_t, u) => [`얻는 경험치 +${2 * u}%.`, explore({ expPct: 2 * u })]),
  ...tiers("loot", "약탈", [1, 2, 3, 4], (_t, u) => [`몬스터 드롭 확률 +${3 * u}% (곱).`, explore({ dropPct: 3 * u })]),
  ...tiers("treasure", "보물찾기", [1, 2, 3, 4], (_t, u) => [`길 타일에 아이템 심볼이 붙을 확률 +${5 * u}%.`, explore({ itemUp: 5 * u })]),
  passiveCore("co_path", "길찾기", 2, ["탐색 중 다음에 놓을 타일을 1개 미리 본다."], explore({ foresee: 1 })),
);

// ---- 5. 기술 ----
CORES.push(
  { id: "co_strike", name: "강타", apt: "공용", req: COMMON, slots: 3, tgt: "one", dmgType: "physical", power: { flat: 24, pct: 60 }, wait: 10, seal: "weapon",
    cat: "물리 · 적 단일", lines: ["적 하나에 물리 (24 + 공격력 60%). 비용 없음."], desc: ["적 하나에 물리 (24 + 공격력 60%). 비용 없음."] } as SkillDef,
  { id: "co_firstaid", name: "응급 처치", apt: "공용", req: COMMON, slots: 2, tgt: "self", dmgType: "heal", power: { flat: 30, pct: 20 }, cost: { mp: 5 }, wait: 0, cd: 6, supportSkill: true,
    cat: "회복 · 자신", lines: ["자신의 HP를 (30 + 주문력 20%) 회복한다. 재사용 대기 6턴."], desc: ["자신의 HP를 (30 + 주문력 20%) 회복한다. 재사용 대기 6턴."] } as SkillDef,
  hookCore("co_brace", "버티기", 2, "방어 행동 중(방어도가 있을 때) 받는 피해 −6.", { takenFlat: () => 6 }),
  hookCore("co_initiative", "선수치기", 2, "전투 시작 시 첫 대기 −50%.", { battleStart: (c) => { c.u.wait = r(c.u.wait * 0.5); } }),
  passiveCore("co_butcher", "도축", 2, ["처치에 관여한 적의 동물소재 드롭 확률 ×1.5."], explore({ butcher: true })),
  passiveCore("co_observe", "관찰", 2, ["전투로 얻는 도감 정보 +30%. (도감 정보 규칙 준비 중)"], explore({ dexPct: 30 })),
);

/** 공용 코어 id 목록 (드롭 표·문서용) */
export const COMMON_CORE_IDS = CORES.map((c) => c.id);
SKILL_BOOK.push(...CORES);
