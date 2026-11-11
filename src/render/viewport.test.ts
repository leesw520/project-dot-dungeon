// docs/DECISIONS.md D2·D3: 논리 해상도 480×270(16:9), 정수 배율, 남는 공간은 레터박스.
import { beforeAll, describe, expect, it, vi } from "vitest";

let p: typeof import("./primitives");

beforeAll(async () => {
  // render/frame.ts가 불러올 때 주소(?redraw=always)를 읽는다. 브라우저 없이 돌리려고 빈 주소를 넣어 둔다.
  vi.stubGlobal("location", { search: "" });
  p = await import("./primitives");
});

describe("화면 기준 (render/primitives.ts)", () => {
  it("논리 해상도는 480×270, 16:9", () => {
    expect([p.VIEW_W, p.VIEW_H]).toEqual([480, 270]);
    expect(p.VIEW_W * 9).toBe(p.VIEW_H * 16);
  });

  it("integerScale: 창에 들어가는 가장 큰 정수 배율", () => {
    expect(p.integerScale(1920, 1080)).toBe(4);
    expect(p.integerScale(1280, 720)).toBe(2);
    expect(p.integerScale(1919, 1080)).toBe(3); // 한쪽이라도 모자라면 내림 → 레터박스
    expect(p.integerScale(2560, 600)).toBe(2); // 좁은 쪽 기준
  });

  it("integerScale: 480×270보다 작은 창에서도 1배 아래로 내려가지 않는다", () => {
    expect(p.integerScale(375, 812)).toBe(1);
    expect(p.integerScale(0, 0)).toBe(1);
  });

  it("logicalPoint: 화면 좌표 → 논리 좌표 (배율로 나누고 내림)", () => {
    const rect = { left: 100, top: 50 } as DOMRect;
    expect(p.logicalPoint(100, 50, rect, 3)).toEqual({ x: 0, y: 0 });
    expect(p.logicalPoint(100 + 3 * 479 + 2, 50 + 3 * 269 + 2, rect, 3)).toEqual({ x: 479, y: 269 });
  });
});
