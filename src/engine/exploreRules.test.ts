import { describe, expect, it } from "vitest";
import { ENEMY_PRESSURE, enemySymbolRate, mulberry } from "./exploreRules";

describe("적 심볼 비율 (engine/exploreRules.ts)", () => {
  it("원정을 막 시작했을 때는 구획 비율 × 전체 배율", () => {
    expect(enemySymbolRate(0.1, 0)).toBeCloseTo(0.1 * ENEMY_PRESSURE.scale);
  });

  it("타일을 놓을수록 오르고, 한도에서 멈춘다", () => {
    const start = enemySymbolRate(0.1, 0);
    const later = enemySymbolRate(0.1, 10);
    expect(later).toBeGreaterThan(start);
    expect(later).toBeCloseTo(start * (1 + ENEMY_PRESSURE.perTile * 10));
    const cap = start * ENEMY_PRESSURE.maxGrowth;
    expect(enemySymbolRate(0.1, 1000)).toBeCloseTo(cap);
    expect(enemySymbolRate(0.1, 100000)).toBeCloseTo(cap);
  });

  it("[사전 정찰] 감소 %가 그대로 곱해지고 0 아래로 내려가지 않는다", () => {
    expect(enemySymbolRate(0.1, 0, 50)).toBeCloseTo(enemySymbolRate(0.1, 0) / 2);
    expect(enemySymbolRate(0.1, 0, 150)).toBe(0);
  });
});

describe("원정 난수 (mulberry)", () => {
  it("같은 시드는 같은 순서, state()에서 이어 굴릴 수 있다", () => {
    const a = mulberry(42);
    const first = [a(), a(), a()];
    const b = mulberry(42);
    expect([b(), b(), b()]).toEqual(first);
    const resumed = mulberry(a.state());
    expect(resumed()).toBe(a());
  });
});
