// 파티 공유 상태 (2026-11-07). 거점·탐색·전투가 같은 파티를 본다.
// 파티 정보는 이미 여러 모듈에 나뉘어 있다 — 기본값(data/battle PARTY), 레벨(engine/battleResult), 대열(data/formation),
// 장비(data/equipment), 코어 판(data/coreBoards), 원정 중 HP·MP(engine/partyVitals). 이 모듈은 그것들을 합쳐
// "지금 이 캐릭터의 최종 능력치와 스킬"을 한 곳에서 계산한다. 화면은 여기만 부르면 된다.
import { ATTACK, PARTY, type ActDef, type AllyDef } from "../data/battle";
import { CORE_BOARDS } from "../data/coreBoards";
import { SLOT_ORDER, equipBonus, equipByUid, getLoadout } from "../data/equipment";
import { ownedByUid } from "../data/inventory";
import { classKeyOf } from "../data/skills";
import type { SkillDef } from "../data/skillbook";
import { coreStackable, skillOfCore } from "../data/skillCores";
import { VARIANTS, modeOfBonus } from "../data/coreVariants";
import { STAT_ORDER, TURN_BASE, type Affinity, type AffinityStep, type StatKey } from "../data/stats";
import type { ElementId } from "../data/itemTaxonomy";

export const partyNames = () => PARTY.map((p) => p.name);
export const partyDef = (name: string): AllyDef => PARTY.find((p) => p.name === name)!;

/** 판에 꽂힌 코어가 주는 스킬 (판 배치 순서). 같은 스킬 코어를 두 개 꽂아도 한 번만. */
export function equippedSkills(name: string): SkillDef[] {
  const k = classKeyOf(name);
  if (!k) return [];
  const out: SkillDef[] = [];
  for (const p of CORE_BOARDS[k]) {
    let s = skillOfCore(p.itemId);
    // 능력치 코어는 여러 개 꽂으면 그만큼 더해진다 (중복 허용). 그 밖은 하나만 (P03이 막지만 옛 세이브 대비)
    if (!s || (!coreStackable(p.itemId) && out.some((x) => x.id === s!.id))) continue;
    // 변형: 제작한 코어 개체에 "변형: …" 보너스가 있으면 변형 정의로 (data/coreVariants.ts)
    for (const b of ownedByUid(p.ownedUid)?.bonuses ?? []) {
      const mode = modeOfBonus(b);
      const make = mode ? VARIANTS[`${s.id}:${mode}`] : undefined;
      if (make) { s = make(s); break; }
    }
    out.push(s);
  }
  return out;
}
/** 무기 적성 스킬(액티브·패시브 모두)은 그 무기를 들고 있어야 쓴다 (2026-11-07) */
export const weaponSkillBlocked = (s: SkillDef, types: string[]) => s.req.type === "weapon" && !s.req.tags.some((t) => types.includes(t));
export const activeSkills = (name: string) => {
  const types = weaponsOf(name).types;
  return equippedSkills(name).filter((s) => !s.passive && !weaponSkillBlocked(s, types));
};
/** 무기 종류 목록 (장착표 기준) */
export function weaponTypesOfLoadout(lo: Readonly<Record<string, string | undefined>>): string[] {
  return (["w0", "w1"] as const).map((s) => lo[s] && equipByUid(lo[s]!)?.def.type).filter((t): t is string => !!t);
}
/** 이 무기 구성이면 판에서 빠져야 하는 코어 (무기 적성 액티브) */
export function coresLostWith(name: string, types: string[]) {
  const k = classKeyOf(name);
  if (!k) return [];
  return CORE_BOARDS[k].filter((p) => { const s = skillOfCore(p.itemId); return !!s && weaponSkillBlocked(s, types); });
}
/** 그 코어들을 판에서 뺀다 (창고로 돌아간다) */
export function removeCores(name: string, uids: number[]) {
  const k = classKeyOf(name);
  if (!k) return;
  CORE_BOARDS[k] = CORE_BOARDS[k].filter((p) => !uids.includes(p.uid));
}

// 아군 속성 상성 (2026-11-08): 직업 기본 상성은 없다 — 스킬(공용 코어 내성·속성학)과 장비로만 바뀐다.
export function allyAffinity(name: string): Affinity {
  const base: Affinity = { ...(partyDef(name)?.affinity ?? {}) };
  // 공용 코어 속성 내성: 단계 +n (최대 +3)
  for (const s of passiveSkills(name))
    for (const [e, n] of Object.entries(s.party?.resist ?? {})) {
      const v = base[e as ElementId];
      if (v === "null" || v === "absorb") continue;
      base[e as ElementId] = Math.min(3, (typeof v === "number" ? v : 0) + (n ?? 0)) as AffinityStep;
    }
  const up = passiveSkills(name).filter((s) => s.special === "elemResist").length;
  if (up) for (const e of ["red", "blue", "green", "yellow"] as ElementId[]) {
    const v = base[e];
    if (v === "null" || v === "absorb") continue;
    base[e] = Math.min(3, (typeof v === "number" ? v : 0) + up) as AffinityStep;
  }
  return base;
}
export const passiveSkills = (name: string) => {
  const types = weaponsOf(name).types;
  return equippedSkills(name).filter((s) => s.passive && !weaponSkillBlocked(s, types));
};

/** 든 무기 종류와 양손 여부. */
export function weaponsOf(name: string): { types: string[]; twoHanded: boolean } {
  const lo = getLoadout(name);
  const defs = (["w0", "w1"] as const).map((s) => lo[s] && equipByUid(lo[s]!)?.def).filter((d) => !!d);
  return { types: defs.map((d) => d!.type), twoHanded: defs.some((d) => d!.hands === 2) };
}

export interface FinalStats {
  hp: number;
  mp: number;
  tpMax: number;
  atk: number;
  spl: number;
  def: number;
  agi: number;
  /** 1단계 합산 고정값 (직업 기본 + 장비 + 제작 보너스 + 코어 고정 증가) */
  flat: Record<StatKey, number>;
  /** 2단계 % 합계 (코어 패시브, 같은 능력치끼리 더한다) */
  pct: Record<StatKey, number>;
  /** 3단계 전환으로 더해진 값 */
  conv: Record<StatKey, number>;
  /** 기본값 대비 보정 (장비 + 코어) — P01 "+n" 표시용 */
  bonus: Record<StatKey | "hp" | "mp", number>;
}

/** 최종 능력치 = 직업 기본값 + 장비 보정 + 코어(패시브) 보정. TODO(spec): 레벨 성장 */
// ---- 제작 보너스 적용 (2026-11-08, docs/crafting.md 4장 · docs/skill-cores.md 4장) ----
// 개체에 붙은 보너스 문구("공격력 +4", "HP +25", "공격력 +2·민첩성 +1", "전능 +3")를 읽어 능력치에 더한다.
// 대상: 장착한 장비 + 이 캐릭터 판에 꽂힌 스킬 코어. 능력치가 아닌 효과(완성 개수·위력·변형)는 여기서 다루지 않는다 (TODO).
const BONUS_STAT: Record<string, StatKey | "hp" | "mp" | "all"> = { 공격력: "atk", 주문력: "spl", 방어력: "def", 민첩성: "agi", HP: "hp", MP: "mp", 전능: "all" };
export function bonusMods(name: string) {
  const sum = { atk: 0, spl: 0, def: 0, agi: 0, hp: 0, mp: 0 };
  const lines: string[] = [];
  const lo = getLoadout(name);
  for (const sl of SLOT_ORDER) if (lo[sl]) lines.push(...(ownedByUid(lo[sl]!)?.bonuses ?? []));
  const k = classKeyOf(name);
  if (k) for (const p of CORE_BOARDS[k]) lines.push(...(ownedByUid(p.ownedUid)?.bonuses ?? []));
  for (const line of lines)
    for (const part of line.split("·")) {
      const m = /(공격력|주문력|방어력|민첩성|HP|MP|전능)\s*\+(\d+)/.exec(part);
      if (!m) continue;
      const key = BONUS_STAT[m[1]], v = Number(m[2]);
      if (key === "all") { sum.atk += v; sum.spl += v; sum.def += v; sum.agi += v; } else sum[key] += v;
    }
  return sum;
}

// 능력치 계산 순서 (2026-11-08, docs/character-system.md 2.2):
//  1) 합산: 직업 기본 + 장비 + 제작 보너스 + 코어 고정 증가(능력치 코어 등)
//  2) %: 코어 패시브 %를 능력치별로 **더해서** 한 번 곱한다 (20% 둘 = ×1.4)
//  3) 전환: "A의 n%만큼 B 증가"는 2)까지 끝난 값을 기준으로 한 번만 더한다 (전환끼리 다시 물리지 않는다)
type Key6 = StatKey | "hp" | "mp";
export function finalStats(name: string): FinalStats {
  const p = partyDef(name);
  const eq = equipBonus(getLoadout(name));
  const w = weaponsOf(name);
  const bm = bonusMods(name);
  const flat: Record<Key6, number> = {
    atk: p.atk + eq.atk + bm.atk, spl: p.spl + eq.spl + bm.spl, def: p.def + eq.def + bm.def, agi: p.agi + eq.agi + bm.agi,
    hp: p.hp + eq.hp + bm.hp, mp: p.mp + eq.mp + bm.mp,
  };
  const pct: Record<Key6, number> = { atk: 0, spl: 0, def: 0, agi: 0, hp: 0, mp: 0 };
  const convs: NonNullable<NonNullable<SkillDef["party"]>["conv"]> = [];
  let tpAdd = 0;
  for (const s of passiveSkills(name)) {
    const m = s.party;
    if (!m || (m.needWeapon && !w.types.includes(m.needWeapon))) continue;
    flat.hp += m.hpAdd ?? 0; flat.mp += m.mpAdd ?? 0; flat.def += m.defAdd ?? 0;
    flat.atk += m.atkAdd ?? 0; flat.spl += m.splAdd ?? 0; flat.agi += m.agiAdd ?? 0; tpAdd += m.tpMaxAdd ?? 0;
    pct.hp += m.hpPct ?? 0; pct.mp += m.mpPct ?? 0; pct.spl += m.splPct ?? 0; pct.atk += m.atkPct ?? 0; pct.def += m.defPct ?? 0; pct.agi += m.agiPct ?? 0;
    if (m.mpSplPct) convs.push({ from: "spl", to: "mp", pct: m.mpSplPct });
    convs.push(...(m.conv ?? []));
  }
  const mid = {} as Record<Key6, number>;
  for (const k of Object.keys(flat) as Key6[]) mid[k] = Math.round(flat[k] * (1 + pct[k] / 100));
  const conv: Record<Key6, number> = { atk: 0, spl: 0, def: 0, agi: 0, hp: 0, mp: 0 };
  for (const c of convs) conv[c.to] += Math.round((mid[c.from] * c.pct) / 100);
  const fin = {} as Record<Key6, number>;
  for (const k of Object.keys(flat) as Key6[]) fin[k] = mid[k] + conv[k];
  const bonus = {} as FinalStats["bonus"];
  for (const k of [...STAT_ORDER, "hp", "mp"] as Key6[]) bonus[k] = fin[k] - p[k];
  const pick = (r: Record<Key6, number>) => ({ atk: r.atk, spl: r.spl, def: r.def, agi: r.agi });
  return { hp: fin.hp, mp: fin.mp, tpMax: Math.min(10, p.tpMax + tpAdd), ...pick(fin), flat: pick(flat), pct: pick(pct), conv: pick(conv), bonus };
}
/** 턴 속도 (표시용) = 기본 턴 수치 + 민첩성 */
export const turnSpeedOfChar = (name: string) => TURN_BASE + finalStats(name).agi;

/** 기본 공격: 마력 화살 같은 대체 패시브가 있으면 그것. */
export function basicAttackOf(name: string): ActDef {
  return passiveSkills(name).find((s) => s.basic)?.basic ?? ATTACK;
}

/** 탐색 패시브 합계 (시야, 이해 경험치, 예지; 라이트는 owners로만). */
export function exploreMods() {
  let vision = 0, expPct = 0, foresee = 0, stay = 0, rest = 0, enemyDown = 0, itemUp = 0, dropPct = 0, butcher = false;
  const gather = { rock: 0, wood: 0, herb: 0 };
  const owners: { name: string; skill: SkillDef }[] = [];
  for (const n of partyNames())
    for (const s of passiveSkills(n)) {
      const e = s.explore;
      if (!e) continue;
      vision += e.vision ?? 0;
      expPct += e.expPct ?? 0;
      foresee += e.foresee ?? 0; // 2026-11-08: 합산 (예지 2 + 공용 1 = 3, 화면 최대 3)
      // 공용 코어 (docs/common-cores.md 4장) — 파티 안 같은 옵션은 합산
      stay += e.stay ?? 0; rest += e.rest ?? 0; enemyDown += e.enemyDown ?? 0; itemUp += e.itemUp ?? 0; dropPct += e.dropPct ?? 0;
      gather.rock += e.gather?.rock ?? 0; gather.wood += e.gather?.wood ?? 0; gather.herb += e.gather?.herb ?? 0;
      butcher ||= !!e.butcher;
      owners.push({ name: n, skill: s });
    }
  return { vision, expPct, foresee, stay, rest, enemyDown, itemUp, dropPct, butcher, gather, owners };
}
