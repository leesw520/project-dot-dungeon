// combat.md "턴과 타임라인". 캐릭터도 지연 효과도 전부 "타임카드"로 다루는 단일 처리 루프.
export type CardKind = "unit" | "effect";

export interface TimeCard {
  id: number; // 생성 순서. 동률일 때 낮은 쪽이 먼저 처리된다.
  ownerId: string;
  kind: CardKind;
  side: "ally" | "enemy";
  label: string;
  color: string;
  value: number; // 턴 값. 0이면 처리 대상.
  interval: number; // 상시 카드가 처리된 뒤 다시 받는 턴 값.
}

export interface Timeline {
  cards: TimeCard[];
  seq: number;
}

export function createTimeline(): Timeline {
  return { cards: [], seq: 1 };
}

export function addCard(tl: Timeline, card: Omit<TimeCard, "id">): TimeCard {
  const c: TimeCard = { ...card, id: tl.seq++ };
  tl.cards.push(c);
  return c;
}

export function removeCard(tl: Timeline, id: number) {
  tl.cards = tl.cards.filter((c) => c.id !== id);
}

/**
 * 한 스텝 진행. 0인 카드가 있으면 그중 ID가 가장 작은 하나를 반환한다 (처리는 호출자 몫 —
 * 상시 카드면 requeue, 일회성이면 removeCard). 0인 카드가 없으면, 가장 작은 턴 값만큼
 * 모든 카드의 턴 값을 한 번에 줄여서 다음 차례로 곧장 당기고 null을 반환한다 — 호출자는
 * 곧바로 다시 step()을 부르면 된다 (이번엔 반드시 0인 카드가 있다). 화면에 보여주는
 * "천천히 흘러가는" 움직임은 호출자가 따로 표시값을 보간해서 만든다 — 엔진 자체는
 * 느리게 돌 이유가 없다.
 */
export function step(tl: Timeline): TimeCard | null {
  const zero = tl.cards.filter((c) => c.value <= 0).sort((a, b) => a.id - b.id);
  if (zero.length) return zero[0];
  const minVal = Math.min(...tl.cards.map((c) => c.value));
  tl.cards.forEach((c) => (c.value -= minVal));
  return null;
}

export function requeue(tl: Timeline, id: number) {
  const card = tl.cards.find((c) => c.id === id);
  if (card) card.value = card.interval;
}
