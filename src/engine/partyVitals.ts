// 원정 중 파티 HP·MP (docs/exploration.md). 탐색 전투는 여기서 불러와 시작하고 끝나면 저장한다.
// D01 파티 툴팁과 인벤토리 회복약이 같은 값을 본다. 새 원정을 시작하면 가득 찬다.
// TODO(spec): 쓰러진 캐릭터 처리 (지금은 전투가 끝나면 HP 1로 남긴다), 거점 회복 규칙.
import { PARTY } from "../data/battle";
import { finalStats } from "./party";
import type { Unit } from "./battle";
import { registerSave } from "./save";

interface Vitals {
  hp: number;
  mp: number;
}

/** 최대치는 장비·코어까지 합친 최종 능력치 (engine/party.ts). */
const maxOf = (name: string) => {
  const f = finalStats(name);
  return { hp: f.hp, mp: f.mp };
};

const vitals = new Map<string, Vitals>();

// 세이브 "vitals" 칸 — 원정 중 새로고침해도 이어진다. 거점에서는 다음 출발 때 가득 찬다.
registerSave("vitals", () => Object.fromEntries(vitals), (v) => {
  vitals.clear();
  Object.entries(v as Record<string, Vitals>).forEach(([k, x]) => vitals.set(k, x));
});

export function restoreVitals() {
  PARTY.forEach((p) => vitals.set(p.name, maxOf(p.name)));
}

export function vitalsOf(name: string) {
  const m = maxOf(name);
  const v = vitals.get(name) ?? m;
  // 코어·장비가 바뀌어 최대치가 줄었으면 맞춘다
  v.hp = Math.min(v.hp, m.hp);
  v.mp = Math.min(v.mp, m.mp);
  return { hp: v.hp, hpMax: m.hp, mp: v.mp, mpMax: m.mp };
}

/** 실제로 회복한 양을 돌려준다. */
export function healVital(name: string, kind: "hp" | "mp", amount: number) {
  const max = maxOf(name)[kind];
  if (!vitals.has(name)) vitals.set(name, maxOf(name));
  const v = vitals.get(name)!;
  const gain = Math.min(amount, max - v[kind]);
  v[kind] += gain;
  return gain;
}

/** 탐색 중 MP·HP를 쓴다 (라이트 등). 모자라면 쓰지 않고 false. 줄어든 값은 다음 전투에도 그대로. */
export function spendVital(name: string, kind: "hp" | "mp", amount: number): boolean {
  if (!vitals.has(name)) vitals.set(name, maxOf(name));
  const v = vitals.get(name)!;
  if (v[kind] < amount) return false;
  v[kind] -= amount;
  return true;
}

/** 탐색 전투 시작: 아군 유닛에 원정 중 HP·MP를 넣는다. */
export function loadVitals(allies: Unit[]) {
  allies.forEach((u) => {
    const v = vitals.get(u.name);
    if (!v) return;
    u.hp = v.hp;
    u.mp = v.mp;
  });
}

/** 탐색 전투 종료: 남은 HP·MP를 저장한다. */
export function saveVitals(allies: Unit[]) {
  allies.forEach((u) => vitals.set(u.name, { hp: Math.max(1, u.hp), mp: u.mp }));
}
