// 키워드 설명 — 스킬 효과 문장에는 키워드 이름만 쓰고, 뜻은 툴팁 아래 보조 창에 따로 보여준다 (2026-11-07).
// 상태는 data/battle.ts STATUS 설명을 그대로 쓰고, 상태가 아닌 용어(처치 관여·대기 행동 …)는 여기 GLOSSARY에 둔다.
import { STATUS, type StatusKey } from "./battle";

const GLOSSARY: Record<string, string> = {
  "처치 관여": "그 적에게 이번 전투에서 피해를 준 적이 있는 아군 전원이 처치에 관여한 것으로 친다.",
  "대기 행동": "기본 대기의 50%만 쓰고 차례를 넘긴다. 그 자체 효과는 없다.",
  "방어 행동": "방어력만큼 방어도를 얻는다.",
  "기본 공격": "무기로 적 하나를 공격한다. TP +1.",
  "[지원]": "아군 회복·강화·상태이상 제거. 행동당 1번 발동한다.",
  급소: "피해 1.5배. 방어도·피해 감소·회피를 무시한다.",
  "정신 이상": "혼란·공포.",
  스택: "마법사 원소 스택: 불꽃·얼음·바람·번개 마법을 쓰면 그 원소가 쌓인다 (최대 4, 넘으면 오래된 것부터 밀려남). 쌓인 같은 원소 1개당 그 원소 마법 위력 +10%.",
};

/** 상태 하나의 설명 (이름 줄을 뺀 나머지). 수치는 대표값으로 채운다. */
function statusText(k: StatusKey): string {
  return STATUS[k].d(25, 2).slice(1).join(" ");
}

/** 한 글자 상태(힘 등)는 "힘 2턴"처럼 뒤에 공백 + 숫자가 올 때만 키워드로 본다 (다른 낱말 속 글자와 헷갈리지 않게). */
function appears(text: string, k: string): boolean {
  if (k.length === 1) return new RegExp(`(^|[\\s\\[(·,])${k}(\\]|\\s\\d)`).test(text);
  return text.includes(k);
}

/** 문장에 나오는 키워드와 그 설명. 같은 키워드는 한 번만, 나온 순서대로. */
export function keywordNotes(text: string): Array<{ title: string; text: string }> {
  const found: Array<{ title: string; text: string; at: number }> = [];
  const add = (title: string, desc: string, key: string) => {
    if (!appears(text, key) || found.some((f) => f.title === title)) return;
    found.push({ title, text: desc, at: text.indexOf(key) });
  };
  for (const [k, v] of Object.entries(GLOSSARY)) add(k.replace(/[[\]]/g, ""), v, k);
  for (const k of Object.keys(STATUS) as StatusKey[]) {
    add(k, statusText(k), k);
  }
  return found.sort((a, b) => a.at - b.at).map(({ title, text }) => ({ title, text }));
}
