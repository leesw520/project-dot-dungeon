// 전투 정산 (battle-rules.md 9장 → B02). 쓰러뜨린 적의 몬스터 DB 레코드로 경험치와 전리품을 계산한다.
// 화면과 분리된 순수 계산 + 마지막 결과 보관. B02가 getLastResult()로 읽는다 (C03의 getLastCraft와 같은 방식).
//
// 테스트 스위치 (개발용, 주소 # 뒤, B01 form과 같이 씀):
//   #drop=all    확률 무시하고 모든 드롭(공용 포함)을 확정
import { PARTY } from "../data/battle";
import { exploreMods, passiveSkills } from "./party";
import { PIECES } from "../data/pieces";
import { addGold } from "../data/inventory";
import { monster } from "../data/monsters";
import type { Battle } from "./battle";
import { registerSave } from "./save";
import { setLevelSource } from "../data/characters";
import { CLASS_NAME } from "../data/skills";

// ---- 아군 경험치 진행 (세이브 "progress" 칸) ----
// TODO(spec): 캐릭터 진행 데이터(data/characters.ts)와 합치기. 지금 B01 파티는 그쪽과 별개의 테스트 직업이다.
const progress: Record<string, { lv: number; exp: number }> = Object.fromEntries(PARTY.map((p) => [p.name, { lv: 1, exp: 0 }])); // 2026-11-08: 새 게임 Lv1

registerSave("progress", () => progress, (v) => Object.assign(progress, v as typeof progress));

/** 다음 레벨까지 필요한 경험치. TODO(spec): 성장 곡선 */
export const expToNext = (lv: number) => 50 + lv * 25;
export const partyLv = (name: string) => progress[name]?.lv ?? 1;
/** 현재 레벨과 이번 레벨에서 쌓인 경험치 (B02에서 오른 값 그대로). P01 왼쪽 패널. */
export const partyExp = (name: string) => progress[name] ?? { lv: 1, exp: 0 };
// 코어 판 확장 스택은 이 레벨을 따른다 (data/characters.ts)
setLevelSource((cls) => partyLv(CLASS_NAME[cls]));
/** 개발용: 레벨 1 올리기 (P03 "레벨업 (테스트)") */
export function debugLevelUp(name: string) {
  const p = (progress[name] ??= { lv: 1, exp: 0 });
  p.lv += 1;
  p.exp = 0;
}

export interface DefeatedFoe {
  label: string;
  monId: string;
  name: string;
  color: string;
  lv: number;
  exp: number;
}
export interface DropLine {
  itemId: string;
  count: number;
  /** 떨어뜨린 적 라벨들 (고블린A, 고블린B …) */
  from: string[];
}
export interface MemberGain {
  name: string;
  color: string;
  alive: boolean;
  gain: number;
  lv0: number;
  exp0: number;
  lv1: number;
  exp1: number;
}
export interface BattleResult {
  outcome: "win" | "lose";
  form: string;
  forced: boolean;
  defeated: DefeatedFoe[];
  expTotal: number;
  /** 얻은 골드 (승리 시 쓰러뜨린 적마다 1~10 × 레벨) */
  gold: number;
  members: MemberGain[];
  drops: DropLine[];
}

let last: BattleResult | null = null;
export const getLastResult = () => last;

// ---- B02 → B03 전리품 넘기기 ----
// B02 "전리품 분배"가 이번 전투 전리품을 맡겨 두고, B03이 onEnter에서 한 번 꺼내 바닥에 깐다.
let pendingLoot: DropLine[] | null = null;
export function handOverLoot() {
  pendingLoot = last?.outcome === "win" ? last.drops : [];
}
/** D01 탐색에서 발견한 것(채집·보물상자·조각 아이템)을 B03 전리품 분배로 넘긴다. */
export function handOverFoundLoot(itemIds: string[]) {
  const by = new Map<string, DropLine>();
  itemIds.forEach((id) => {
    const l = by.get(id) ?? { itemId: id, count: 0, from: ["탐색"] };
    l.count++;
    by.set(id, l);
  });
  pendingLoot = [...by.values()];
}
/** 넘겨받은 전리품. 받는 화면에서 한 번 읽으면 비운다. 넘겨받은 게 없으면 null. */
export function takeLoot(): DropLine[] | null {
  const l = pendingLoot;
  pendingLoot = null;
  return l;
}

export interface SettleOpts {
  forceDrops?: boolean;
}

/**
 * 전투 종료 정산. 승리면 아군 경험치를 실제로 올린다 (한 전투에 한 번만 부를 것).
 * 경험치: 쓰러뜨린 적마다 레코드 exp(고정값)의 합. 살아 있는 아군 전원이 합계를 그대로 받는다.
 * TODO(spec): 나눠 받기 여부, 쓰러진 아군 경험치, 레벨 차 보정.
 * 패배: 경험치·전리품 없음 (B04 규칙 미정, battle-rules.md 9장).
 */
export function settleBattle(b: Battle, res: "win" | "lose", opts: SettleOpts = {}): BattleResult {
  const defeated: DefeatedFoe[] = b.foes.filter((f) => !f.alive).map((f) => {
    const r = monster(f.type!.id);
    return { label: f.name + f.tag, monId: r.id, name: r.name, color: r.color, lv: f.lv, exp: r.exp };
  });
  const win = res === "win";
  const expTotal = win ? defeated.reduce((t, d) => t + d.exp, 0) : 0;

  // 쓰러뜨린 개체마다 그 종류의 드롭 테이블을 한 번 굴린다. 줄마다 따로 판정하고(확률 합은 상관없음), 붙으면 1개.
  const byItem = new Map<string, DropLine>();
  if (win) {
    // 공용 [약탈]: 드롭 확률 ×(1+%), [도축]: 동물소재 ×1.5 (파티에 누가 끼고 있으면. TODO(spec): 처치 관여한 캐릭터만)
    const em = exploreMods();
    const chanceOf = (itemId: string, c: number) => Math.min(1, c * (1 + em.dropPct / 100) * (em.butcher && PIECES[itemId]?.categories.includes("동물소재" as never) ? 1.5 : 1));
    for (const d of defeated) {
      const m = monster(d.monId);
      for (const rule of [...m.drops, ...(m.coreDrops ?? [])]) { // 스킬 코어 드롭도 같은 방식 (코어는 개체 하나씩)
        if (!opts.forceDrops && Math.random() >= chanceOf(rule.itemId, rule.chance)) continue;
        const line = byItem.get(rule.itemId) ?? { itemId: rule.itemId, count: 0, from: [] };
        line.count += 1;
        if (!line.from.includes(d.label)) line.from.push(d.label);
        byItem.set(rule.itemId, line);
      }
    }
  }

  const members: MemberGain[] = b.allies.map((a) => {
    const p = progress[a.name] ?? (progress[a.name] = { lv: a.lv, exp: 0 });
    // 학습(학자) 같은 탐색 패시브: 얻는 경험치 +% (그 캐릭터만)
    const expPct = passiveSkills(a.name).reduce((s, k) => s + (k.explore?.expPct ?? 0), 0);
    const gain = win && a.alive ? Math.round(expTotal * (1 + expPct / 100)) : 0;
    const before = { lv0: p.lv, exp0: p.exp };
    p.exp += gain;
    while (p.exp >= expToNext(p.lv)) { p.exp -= expToNext(p.lv); p.lv += 1; } // 레벨업 능력치 상승 없음 — 코어 칸 확장·직업 코어 해금으로 성장 (2026-11-08)
    return { name: a.name, color: a.color, alive: a.alive, gain, ...before, lv1: p.lv, exp1: p.exp };
  });

  // 골드 (2026-11-08): 쓰러뜨린 적마다 (1~10 무작위 × 그 적 레벨)
  const gold = win ? defeated.reduce((t, d) => t + (1 + Math.floor(Math.random() * 10)) * d.lv, 0) : 0;
  addGold(gold);
  last = { outcome: res, form: b.form, forced: !!opts.forceDrops, defeated, expTotal, gold, members, drops: [...byItem.values()] };
  return last;
}
