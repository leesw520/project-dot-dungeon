// 축하 연출용 도트 파티클 — C03 제작 완료, B01 승리에서 같이 쓴다.
// paper: 화면 아래에서 쏘아 올린 오색 종이 조각. 정점을 지나면 팔랑이며 천천히 떨어진다.
// spark: 공중에서 터지는 불꽃놀이 알갱이. 사방으로 퍼졌다가 중력에 처지며 꼬리를 남기고 사라진다.
// 모든 그리기 좌표는 정수로 반올림한다 (서브픽셀 금지).
import { C, PIECE, R } from "./primitives";

export const CONFETTI_COLORS = [...Object.values(PIECE), C.gold, C.txt];
const GRAVITY = 0.0009;

interface Particle {
  kind: "paper" | "spark";
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  /** 앞뒤로 뒤집히며 떨어지는 느낌을 주는 위상. 폭을 size ↔ 1로 바꿔 그린다. */
  phase: number;
  spin: number;
  sway: number;
  age: number;
  life: number;
  /** spark 꼬리용 직전 위치 */
  px: number;
  py: number;
}

export function rand(a: number, b: number) {
  return a + Math.random() * (b - a);
}
const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];

export function createConfetti() {
  let parts: Particle[] = [];

  /** 화면 아래(y 272)에서 angle 방향으로 종이 조각을 쏘아 올린다. */
  function burst(x: number, angle: number, spread: number, count: number, speedMin: number, speedMax: number, colors: readonly string[] = CONFETTI_COLORS) {
    for (let i = 0; i < count; i++) {
      const a = angle + rand(-spread, spread);
      const sp = rand(speedMin, speedMax);
      const px = x + rand(-6, 6);
      parts.push({
        kind: "paper", x: px, y: 272, px, py: 272,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        size: Math.random() < 0.3 ? 3 : 2,
        color: pick(colors),
        phase: rand(0, Math.PI * 2), spin: rand(0.008, 0.02), sway: rand(0, Math.PI * 2),
        age: 0, life: rand(2600, 3600),
      });
    }
  }

  /** (x, y)에서 둥글게 터지는 불꽃놀이. colors 중 하나를 주색으로 쓰고 흰 알갱이를 조금 섞는다. */
  function explode(x: number, y: number, count: number, colors: readonly string[] = CONFETTI_COLORS) {
    const main = pick(colors);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand(-0.08, 0.08);
      const sp = rand(0.07, 0.13);
      parts.push({
        kind: "spark", x, y, px: x, py: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        size: Math.random() < 0.25 ? 2 : 1,
        color: Math.random() < 0.2 ? C.txt : main,
        phase: 0, spin: 0, sway: 0,
        age: 0, life: rand(700, 1100),
      });
    }
  }

  function tick(dt: number) {
    const step = Math.min(dt, 50);
    const drag = Math.pow(0.9985, step);
    const sparkDrag = Math.pow(0.996, step);
    parts.forEach((p) => {
      p.age += step;
      p.px = p.x;
      p.py = p.y;
      if (p.kind === "spark") {
        p.vy += GRAVITY * 0.25 * step;
        p.vx *= sparkDrag;
        p.vy *= sparkDrag;
        p.x += p.vx * step;
        p.y += p.vy * step;
        return;
      }
      p.vy += GRAVITY * step;
      p.vx *= drag;
      p.vy *= drag;
      // 정점을 지나면 종이처럼 천천히 팔랑이며 떨어진다.
      if (p.vy > 0.07) p.vy = 0.07;
      p.sway += step * 0.006;
      p.phase += p.spin * step;
      p.x += p.vx * step + (p.vy > 0 ? Math.sin(p.sway) * 0.03 * step : 0);
      p.y += p.vy * step;
    });
    parts = parts.filter((p) => p.age < p.life && p.y < 280 && p.x > -10 && p.x < 490);
  }

  function draw() {
    parts.forEach((p) => {
      const left = p.life - p.age;
      const fade = left < 400 ? left / 400 : 1;
      const op = fade < 1 ? `opacity='${fade.toFixed(2)}'` : undefined;
      if (p.kind === "spark") {
        // 꼬리: 진행 반대 방향으로 두 점, 점점 옅게
        const dx = p.x - p.px, dy = p.y - p.py, len = Math.hypot(dx, dy) || 1;
        for (let k = 2; k >= 1; k--) {
          R(Math.round(p.x - (dx / len) * k * 2), Math.round(p.y - (dy / len) * k * 2), 1, 1, p.color, `opacity='${(fade * (0.5 - k * 0.15)).toFixed(2)}'`);
        }
        R(Math.round(p.x), Math.round(p.y), p.size, p.size, p.color, op);
        return;
      }
      // cos 위상이 0 근처면 옆면이 보이는 순간 — 1px로 얇게 그린다.
      const w = Math.abs(Math.cos(p.phase)) > 0.35 ? p.size : 1;
      R(Math.round(p.x - w / 2), Math.round(p.y - p.size / 2), w, p.size, p.color, op);
    });
  }

  return {
    burst,
    explode,
    tick,
    draw,
    clear: () => (parts = []),
    get count() {
      return parts.length;
    },
  };
}
