// B01 전투 종료 오버레이 — 승리(B02 진입 연출) / 패배(B04 진입 연출). docs/screens.md B02·B04.
// 전장(B01) 그림을 그대로 배경으로 두고 그 위에 덮는다. B01이 draw 끝에 draw()를, tick에서 tick()을 부른다.
// 승리: 흰 번쩍임 → 가운데 띠가 펼쳐지며 "승리!" → 하늘에 불꽃놀이, 아래에서 종이 폭죽 (C03과 같은 confetti).
// 패배: 붉은 맥박 한 번 → 화면이 차갑게 어두워지고 가장자리가 가라앉는다 → 글자가 한 자씩 떨어지고 잿빛 비가 내린다.
// 모든 그리기 좌표는 정수로 반올림한다 (서브픽셀 금지).
import { createConfetti, rand } from "../render/confetti";
import { C, R, T, btn, textWidth } from "../render/primitives";
import type { LogicalPoint } from "./types";

export type EndKind = "win" | "lose";
export interface EndInfo {
  defeated: number;
  exp: number;
  drops: number;
}

const CX = 240;
const BAND = { y: 96, h: 44 };
const BTN = { y: 150, w: 96 };

// 승리 타임라인 (ms)
const W_FLASH = 220;
const W_BAND = 160;
const W_BAND_END = 420;
const W_SUB = 900;
const W_BTN = 1300;
const W_DONE = 1700;
const FIREWORKS: [number, number, number][] = [
  // [시각, x, y]
  [380, 120, 58], [560, 360, 46], [760, 240, 34], [980, 70, 74], [1120, 410, 70], [1400, 170, 40], [1600, 310, 62],
];

// 패배 타임라인 (ms)
const L_PULSE = 360;
const L_DARK = 1400;
const L_TITLE = 500;
const L_CHAR = 140;
const L_SUB = 1500;
const L_BTN = 1900;
const LOSE_TITLE = "전멸했다…";
const RAIN_N = 70;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number) => { const s = 2.2, u = t - 1; return 1 + (s + 1) * u * u * u + s * u * u; };
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const op = (a: number) => `opacity='${clamp01(a).toFixed(2)}'`;

/** 1px 그림자 4방향 + 본 글자. 큰 제목용 (size는 11의 배수라 Galmuri11이 또렷하다). */
function outlined(x: number, y: number, s: string, size: number, col: string, edge: string) {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]]) T(x + dx, y + dy, s, size, edge, "middle");
  T(x, y, s, size, col, "middle");
}

/** loseLabel: 패배 버튼 글자 (탐색 전투면 "탐색으로"). */
export function createEndOverlay(onAction: (a: "result" | "retry") => void, loseLabel: () => string = () => "다시 도전") {
  let kind: EndKind | null = null;
  let info: EndInfo = { defeated: 0, exp: 0, drops: 0 };
  let t = 0;
  let hover = false;
  let fired = 0;
  const fx = createConfetti();
  let rain: { x: number; y: number; v: number; len: number }[] = [];

  function start(k: EndKind, i: EndInfo) {
    kind = k;
    info = i;
    t = 0;
    hover = false;
    fired = 0;
    fx.clear();
    rain = k === "lose" ? Array.from({ length: RAIN_N }, () => ({ x: rand(0, 500), y: rand(-270, 270), v: rand(0.05, 0.09), len: Math.random() < 0.3 ? 4 : 3 })) : [];
  }
  function reset() {
    kind = null;
    fx.clear();
    rain = [];
  }

  function tick(dt: number) {
    if (!kind) return;
    const step = Math.min(dt, 50);
    t += step;
    if (kind === "win") {
      while (fired < FIREWORKS.length && t >= FIREWORKS[fired][0]) {
        const [, x, y] = FIREWORKS[fired++];
        fx.explode(x, y, 28);
      }
      if (t - step < W_BAND && t >= W_BAND) {
        fx.burst(40, -Math.PI / 2 + 0.35, 0.25, 45, 0.66, 0.95);
        fx.burst(440, -Math.PI / 2 - 0.35, 0.25, 45, 0.66, 0.95);
      }
      if (t - step < 700 && t >= 700) fx.burst(CX, -Math.PI / 2, 0.6, 40, 0.5, 0.85);
      fx.tick(step);
    } else {
      rain.forEach((r) => {
        r.y += r.v * step * 3;
        r.x -= r.v * step;
        if (r.y > 272) { r.y = rand(-20, -4); r.x = rand(0, 520); }
      });
    }
  }

  // ---- 버튼 ----
  const btnRect = () => ({ x: CX - BTN.w / 2, y: BTN.y, w: BTN.w, h: 14 });
  const btnShown = () => (kind === "win" ? t >= W_BTN : t >= L_BTN);
  const inBtn = (p: LogicalPoint) => { const r = btnRect(); return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h; };

  // ---- 승리 ----
  function drawWin() {
    R(0, 0, 480, 270, "#0B0804", op(0.38 * easeOutCubic(clamp01(t / 300))));
    if (t < W_FLASH) R(0, 0, 480, 270, "#ffffff", op(0.45 * (1 - t / W_FLASH)));
    fx.draw();
    const bt = easeOutCubic(clamp01((t - W_BAND) / (W_BAND_END - W_BAND)));
    if (bt > 0) {
      const w = Math.round(480 * bt), x = CX - Math.round(w / 2);
      R(x, BAND.y - 2, w, BAND.h + 4, C.woodD);
      R(x, BAND.y, w, BAND.h, C.wood);
      R(x, BAND.y + 2, w, BAND.h - 4, C.panelIn);
      R(x, BAND.y, w, 1, C.gold, op(0.8));
      R(x, BAND.y + BAND.h - 1, w, 1, C.gold, op(0.8));
    }
    if (t >= W_BAND_END - 120) {
      const k = clamp01((t - (W_BAND_END - 120)) / 380);
      const y = Math.round(BAND.y + 26 - (1 - easeOutBack(k)) * 18);
      outlined(CX, y, "승리!", 22, C.gold, C.woodD);
      // 제목 양옆 반짝임 — 시간차로 하나씩 켜졌다 꺼진다
      ([[-58, -12], [56, -16], [-44, 4], [48, 6]] as const).forEach(([ox, oy], i) => {
        const p = ((t + i * 260) % 1100) / 1100;
        if (p > 0.45) return;
        const arm = p < 0.12 || p > 0.33 ? 1 : 3;
        R(CX + ox, y + oy - arm, 1, arm * 2 + 1, C.txt);
        R(CX + ox - arm, y + oy, arm * 2 + 1, 1, C.txt);
      });
    }
    if (t >= W_SUB) {
      const a = clamp01((t - W_SUB) / 250);
      T(CX, BAND.y + 39, `쓰러뜨린 적 ${info.defeated} · 경험치 +${info.exp} · 전리품 ${info.drops}종`, 7, C.txt, "middle");
      if (a < 1) R(0, BAND.y + 31, 480, 10, C.panelIn, op(1 - a));
    }
    if (btnShown()) {
      btn(btnRect().x, BTN.y, BTN.w, "결과 보기", hover);
      T(CX, BTN.y + 26, "Enter · 클릭", 7, C.sub, "middle");
    }
  }

  // ---- 패배 ----
  function drawLose() {
    // 처음 한 번 붉게 맥박친다
    if (t < L_PULSE) R(0, 0, 480, 270, C.hp, op(0.28 * (1 - t / L_PULSE)));
    // 차갑게 어두워진다
    const d = easeOutCubic(clamp01(t / L_DARK));
    R(0, 0, 480, 270, "#0A0E16", op(0.62 * d));
    // 가장자리가 더 어둡게 가라앉는다 (위·아래 띠, 바깥쪽일수록 진하게)
    for (let i = 0; i < 8; i++) {
      const a = 0.09 * d * (8 - i) / 8;
      R(0, i * 5, 480, 5, "#000000", op(a));
      R(0, 265 - i * 5, 480, 5, "#000000", op(a));
    }
    // 잿빛 비
    const ra = 0.3 * d;
    rain.forEach((r) => {
      for (let k = 0; k < r.len; k++) R(Math.round(r.x + k * 0.33), Math.round(r.y - k), 1, 1, "#8A93A3", op(ra * (1 - k * 0.2)));
    });
    // 제목: 한 자씩 위에서 떨어져 내려앉는다
    const chars = [...LOSE_TITLE];
    const size = 22;
    const total = textWidth(LOSE_TITLE, size);
    let x = CX - total / 2;
    const baseY = BAND.y + 24;
    chars.forEach((ch, i) => {
      const w = textWidth(ch, size);
      const k = clamp01((t - L_TITLE - i * L_CHAR) / 520);
      if (k > 0) {
        const y = Math.round(baseY - (1 - easeOutCubic(k)) * 24);
        const cx = Math.round(x + w / 2);
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1], [1, 1]]) T(cx + dx, y + dy, ch, size, "#05070B", "middle");
        T(cx, y, ch, size, k < 1 ? "#6E7787" : "#A9B1BE", "middle");
      }
      x += w;
    });
    if (t >= L_SUB) {
      T(CX, baseY + 18, "파티가 모두 쓰러졌다.", 8, "#A9B1BE", "middle");
      // 전멸: 가방에 든 것을 모두 잃고 거점으로 (2026-11-07, d01Explore onEnter). screens.md B04
      T(CX, baseY + 30, "가방에 든 것을 모두 잃고 거점으로 돌아간다", 7, "#6E7787", "middle");
    }
    if (btnShown()) btn(btnRect().x, BTN.y + 6, BTN.w, loseLabel(), hover);
  }

  function draw() {
    if (kind === "win") drawWin();
    else if (kind === "lose") drawLose();
  }

  function act() {
    if (!kind) return;
    if (!btnShown()) { t = kind === "win" ? W_BTN : L_BTN; return; } // 연출 중 입력은 건너뛰기
    onAction(kind === "win" ? "result" : "retry");
  }

  return {
    start,
    reset,
    tick,
    draw,
    get active() {
      return kind != null;
    },
    /** 승리: 연출·파티클이 남은 동안만. 패배: 연출 뒤에도 비가 내리므로 30fps로 계속. */
    animating(): boolean | number {
      if (kind === "win") return t < W_DONE || fx.count > 0;
      if (kind === "lose") return t < L_BTN + 200 ? true : 33;
      return false;
    },
    pointerMove(p: LogicalPoint) {
      const r = btnRect();
      hover = btnShown() && inBtn(kind === "lose" ? { x: p.x, y: p.y - 6 } : p) && r.w > 0;
    },
    pointerDown(p: LogicalPoint) {
      if (!btnShown()) return act();
      if (inBtn(kind === "lose" ? { x: p.x, y: p.y - 6 } : p)) act();
    },
    key(k: string) {
      if (k === "Enter" || k === " " || k === "z" || k === "Z") act();
    },
  };
}
