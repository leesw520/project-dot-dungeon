// D01 발견 연출 — 탐색 화면 위에 검은 반투명 막을 깔고, 가운데 더 짙은 검은 띠 안에서 효과를 띄운다 (C03 제작 완료 느낌).
// 띠 높이는 연출마다 다르다: 채집은 낮게, 보물상자는 빛줄기가 올라갈 자리까지 높게.
// 채집: 돋보기가 Z자로 훑다가 가운데에서 멈추고, 렌즈 안에서 소재가 반짝이며 나타난다 → "채집 성공!"
// 보물상자: 상자가 덜컹, 덜컹 흔들리다 뚜껑이 열리며 빛줄기와 불꽃이 뿜어져 나온다 → "보물상자 발견!"
// 연출이 끝나면 멈춰서(그리기 중단) 클릭/Enter를 기다린다. 연출 중 클릭은 끝 장면으로 건너뛴다.
import { createConfetti } from "../render/confetti";
import { C, PIECE, R, T, disc, pen } from "../render/primitives";
import { PIECES } from "../data/pieces";

export interface Discovery {
  kind: "gather" | "chest";
  item: string;
  /** 얻은 개수 (2개 이상이면 이름 뒤 ×n) */
  count?: number;
  /** 중요 아이템 — 전리품 분배 없이 바로 창고에 들어갔다 */
  key?: boolean;
}

const CX = 240;
const CY = 128;
/** 효과가 나오는 짙은 띠 (y, 높이) */
const BAND: Record<Discovery["kind"], { y: number; h: number }> = { gather: { y: 80, h: 96 }, chest: { y: 40, h: 172 } };
const END: Record<Discovery["kind"], number> = { gather: 2100, chest: 2400 };
const HINT_AT: Record<Discovery["kind"], number> = { gather: 1900, chest: 2200 };

// 돋보기 Z 경로: 왼쪽 위 → 오른쪽 위 → 왼쪽 아래 → 오른쪽 아래 → 가운데에서 멈춤
const Z_PATH: Array<[number, number]> = [[CX - 32, CY - 12], [CX + 32, CY - 12], [CX - 32, CY + 12], [CX + 32, CY + 12], [CX, CY]];
const Z_SEG_MS = 300;

/** 글자 둘레 1px 테두리 (어두운 막 위에서 읽히게) */
function outlined(x: number, y: number, s: string, size: number, col: string, edge = "#1A1208") {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]]) T(x + dx, y + dy, s, size, edge, "middle");
  T(x, y, s, size, col, "middle");
}

/** 소재·아이템 그림 자리표시: 조각 모양을 cs 칸으로, (cx,cy) 가운데에. */
function drawItem(id: string, cx: number, cy: number, cs: number) {
  const d = PIECES[id];
  const xs = d.cells.map(([c]) => c), ys = d.cells.map(([, r]) => r);
  const w = (Math.max(...xs) + 1) * cs, h = (Math.max(...ys) + 1) * cs;
  const x0 = Math.round(cx - w / 2), y0 = Math.round(cy - h / 2);
  d.cells.forEach(([c, r]) => {
    R(x0 + c * cs, y0 + r * cs, cs - 1, cs - 1, PIECE[d.color]);
    R(x0 + c * cs, y0 + r * cs, cs - 1, 2, "#ffffff", "opacity='.4'");
  });
}

function lerp(a: number, b: number, k: number) {
  return a + (b - a) * k;
}

export function createDiscoveryFx() {
  const fx = createConfetti();
  let cur: Discovery | null = null;
  let t = 0;
  let burst1 = false;
  let burst2 = false;

  function start(d: Discovery) {
    cur = d;
    t = 0;
    burst1 = burst2 = false;
    fx.clear();
  }

  function tick(dt: number) {
    if (!cur) return;
    t += dt;
    if (cur.kind === "gather" && !burst1 && t >= Z_SEG_MS * 4 + 150) {
      burst1 = true;
      fx.explode(CX, CY, 18, [C.txt, C.gold, PIECE[PIECES[cur.item].color]]);
    }
    if (cur.kind === "chest") {
      if (!burst1 && t >= 1250) { burst1 = true; fx.explode(CX, CY - 6, 28, [C.gold, "#FFF3C4", C.txt]); }
      if (!burst2 && t >= 1450) { burst2 = true; fx.explode(CX, CY - 20, 22, [C.gold, C.lim, C.txt]); }
    }
    fx.tick(dt);
  }

  function drawMagnifier(x: number, y: number, glint: boolean) {
    // 손잡이 (오른쪽 아래로 도트 대각선)
    for (let i = 0; i < 6; i++) R(x + 7 + i * 2, y + 7 + i * 2, 3, 3, "#6B4A22");
    for (let i = 0; i < 6; i++) R(x + 8 + i * 2, y + 7 + i * 2, 1, 2, "#A8763A");
    disc(x, y, 11, "#C9CDD4");
    disc(x, y, 9, "#2A3B4C");
    R(x - 5, y - 6, 3, 2, "#ffffff", "opacity='.7'");
    R(x - 6, y - 4, 2, 3, "#ffffff", "opacity='.5'");
    if (glint) R(x + 3, y - 7, 2, 2, "#ffffff");
  }

  function drawGather(d: Discovery) {
    const zEnd = Z_SEG_MS * 4;
    let mx = CX, my = CY;
    if (t < zEnd) {
      const seg = Math.floor(t / Z_SEG_MS), k = (t % Z_SEG_MS) / Z_SEG_MS;
      const [ax, ay] = Z_PATH[seg], [bx, by] = Z_PATH[seg + 1];
      mx = lerp(ax, bx, k);
      my = lerp(ay, by, k);
      // 지나간 자리에 옅은 흔적
      for (let i = 0; i <= seg; i++) {
        const [px, py] = Z_PATH[i];
        R(px - 1, py - 1, 2, 2, C.tipLine, "opacity='.35'");
      }
    }
    mx = Math.round(mx);
    my = Math.round(my);
    const found = t >= zEnd + 150;
    if (found) {
      // 렌즈 안에서 소재가 반짝 — 십자 빛 + 소재
      const k = Math.min(1, (t - zEnd - 150) / 300);
      const arm = Math.round(4 + k * 14);
      R(CX - arm, CY, arm * 2 + 1, 1, "#FFF3C4", `opacity='${(1 - k * 0.6).toFixed(2)}'`);
      R(CX, CY - arm, 1, arm * 2 + 1, "#FFF3C4", `opacity='${(1 - k * 0.6).toFixed(2)}'`);
    }
    drawMagnifier(mx, my, found);
    if (found) drawItem(d.item, CX, CY, 6);
    if (t >= 1450) {
      outlined(CX, 101, "채집 성공!", 16, C.gold);
      outlined(CX, 170, PIECES[d.item].name + ((d.count ?? 1) > 1 ? ` ×${d.count}` : ""), 10, C.txt);
    }
  }

  function drawChest(d: Discovery) {
    // 덜컹 1: 300~520ms, 덜컹 2: 800~1080ms (더 세게). 1250ms에 열린다.
    let ox = 0, lid = 0;
    const jolt = (a: number, b: number, amp: number) => {
      if (t < a || t >= b) return;
      const ph = Math.floor((t - a) / 45);
      ox = ph % 2 ? amp : -amp;
      lid = amp;
    };
    jolt(300, 520, 1);
    jolt(800, 1080, 2);
    const open = t >= 1250;
    const x = CX - 16 + ox, y = CY - 4;
    if (open) {
      // 빛: 뒤쪽 후광 + 위로 퍼지는 도트 빛줄기
      const k = Math.min(1, (t - 1250) / 500);
      const pulse = 0.25 + 0.1 * Math.sin(t / 90);
      const g = pen();
      g.save();
      g.globalAlpha = 0.22 + pulse * 0.4;
      disc(CX, y, Math.round(14 + k * 30), "#FFE9A8");
      g.globalAlpha = 0.35 + pulse * 0.4;
      disc(CX, y, Math.round(8 + k * 16), "#FFF6D8");
      g.restore();
      const rays = 9;
      for (let i = 0; i < rays; i++) {
        const a = Math.PI * (0.1 + (0.8 * i) / (rays - 1));
        const len = (40 + (i % 2) * 18) * k;
        for (let s = 6; s < len; s += 3) {
          const op = Math.max(0, 0.9 - s / (len + 10)) * (0.7 + pulse);
          R(Math.round(CX + Math.cos(a) * s), Math.round(y - Math.sin(a) * s), 2, 2, "#FFF3C4", `opacity='${op.toFixed(2)}'`);
        }
      }
    }
    // 상자 몸통
    R(x, y, 32, 18, "#2C1A08");
    R(x + 1, y + 1, 30, 16, "#8A5A22");
    R(x + 1, y + 1, 30, 2, "#B07A3A");
    R(x + 1, y + 8, 30, 2, "#5A3A14");
    R(x + 4, y + 1, 2, 16, "#C9A24A");
    R(x + 26, y + 1, 2, 16, "#C9A24A");
    if (!open) {
      // 닫힌 뚜껑 (덜컹일 때 살짝 들린다)
      R(x - 1, y - 9 - lid, 34, 10, "#2C1A08");
      R(x, y - 8 - lid, 32, 8, "#9A6A2A");
      R(x, y - 8 - lid, 32, 2, "#C08A48");
      R(x + 4, y - 8 - lid, 2, 8, "#C9A24A");
      R(x + 26, y - 8 - lid, 2, 8, "#C9A24A");
      R(x + 14, y - 3 - lid, 4, 5, C.gold);
      if (lid) R(x + 2, y - 1, 28, 1, "#FFE9A8"); // 틈으로 새는 빛
    } else {
      // 젖혀진 뚜껑 (뒤쪽으로)
      R(x - 1, y - 16, 34, 8, "#2C1A08");
      R(x, y - 15, 32, 6, "#7A5220");
      R(x, y - 15, 32, 1, "#C08A48");
      R(x + 2, y - 1, 28, 2, "#FFF6D8");
      // 아이템이 떠오른다
      const k = Math.min(1, (t - 1400) / 500);
      if (t >= 1400) drawItem(d.item, CX, Math.round(y - 10 - k * 26), 5);
    }
    if (t >= 1600) {
      outlined(CX, 63, "보물상자 발견!", 16, C.gold);
      outlined(CX, 174, PIECES[d.item].name, 10, C.txt);
      if (d.key) T(CX, 192, "중요 아이템 — 거점 창고에 바로 보관했다", 7, C.good, "middle");
    }
  }

  function draw() {
    if (!cur) return;
    const band = BAND[cur.kind];
    R(0, 0, 480, 270, "#000000", "opacity='.5'");
    R(0, band.y, 480, band.h, "#000000", "opacity='.6'");
    R(0, band.y, 480, 1, "#000000");
    R(0, band.y + band.h - 1, 480, 1, "#000000");
    if (cur.kind === "gather") drawGather(cur);
    else drawChest(cur);
    fx.draw();
    if (t >= HINT_AT[cur.kind]) T(CX, band.y + band.h + 12, "클릭 · Enter 로 계속", 7, C.sub, "middle");
  }

  return {
    start,
    tick,
    draw,
    get active() {
      return cur !== null;
    },
    /** 연출 중이면 true (매 프레임), 끝나서 클릭을 기다리면 false */
    animating: () => !!cur && (t < END[cur.kind] || fx.count > 0),
    /** 클릭/Enter: 연출 중이면 끝 장면으로, 끝났으면 닫고 true */
    advance(): boolean {
      if (!cur) return true;
      if (t < END[cur.kind]) {
        t = END[cur.kind];
        burst1 = burst2 = true;
        return false;
      }
      cur = null;
      fx.clear();
      return true;
    },
  };
}
