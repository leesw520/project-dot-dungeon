import { describe, expect, it } from "vitest";
import { addCard, createTimeline, removeCard, requeue, step } from "./timeline";

const card = (ownerId: string, value: number, interval = value) =>
  ({ ownerId, kind: "unit", side: "ally", label: ownerId, color: "#fff", value, interval }) as const;

describe("타임라인 (engine/timeline.ts)", () => {
  it("0인 카드가 없으면 가장 작은 턴 값만큼 한 번에 당기고 null을 돌려준다", () => {
    const tl = createTimeline();
    addCard(tl, card("a", 30));
    addCard(tl, card("b", 50));
    expect(step(tl)).toBeNull();
    expect(tl.cards.map((c) => c.value)).toEqual([0, 20]);
  });

  it("0인 카드가 여럿이면 먼저 만든 카드가 먼저 처리된다", () => {
    const tl = createTimeline();
    const first = addCard(tl, card("a", 0));
    addCard(tl, card("b", 0));
    expect(step(tl)?.id).toBe(first.id);
  });

  it("requeue는 처리한 카드를 interval로 되돌린다", () => {
    const tl = createTimeline();
    const a = addCard(tl, card("a", 30));
    addCard(tl, card("b", 50));
    step(tl);
    expect(step(tl)?.id).toBe(a.id);
    requeue(tl, a.id);
    expect(tl.cards.find((c) => c.id === a.id)?.value).toBe(30);
    expect(step(tl)).toBeNull(); // b가 20 남았으므로 20만큼 당긴다
    expect(step(tl)?.ownerId).toBe("b");
  });

  it("removeCard는 일회성 카드를 없앤다", () => {
    const tl = createTimeline();
    const a = addCard(tl, card("a", 0));
    removeCard(tl, a.id);
    expect(tl.cards).toHaveLength(0);
  });
});
