// ui-spec.md 1장: 480x270 고정 논리 해상도, 정수 배율 확대, 서브픽셀 금지, 폰트 로드 후 첫 렌더.
//
// 글자가 깨지는 문제 메모: 예전엔 캔버스 백킹 스토어를 480x270로 고정해두고
// CSS width/height만 정수 배율로 키운 뒤 image-rendering:pixelated로 확대했다.
// 사각형(R)은 축에 맞는 단색이라 확대해도 멀쩡하지만, 글자(fillText)는 브라우저가
// 480x270의 "작은" 해상도에서 이미 안티에일리어싱(부드러운 회색 경계)을 입힌 뒤라,
// 그걸 2~4배 nearest-neighbor로 확대하면 그 경계 픽셀이 뭉개진 덩어리로 보인다 —
// 이게 "글자가 깨진다"는 증상의 원인이다.
// 해결: 백킹 스토어 자체를 최종 화면 배율(scale)만큼 키우고 ctx.scale(scale,scale)을
// 걸어서, 기존 논리 좌표 그대로 그리되 실제로는 최종 해상도에서 한 번만 래스터라이즈한다.
// 사각형은 정수 배율이라 여전히 칼같이 떨어지고, 글자는 최종 크기에서 정상적으로
// anti-alias되어 선명하게 보인다.
import galmuri11Url from "galmuri/dist/Galmuri11.woff2?url";
import galmuri9Url from "galmuri/dist/Galmuri9.woff2?url";
import { ALWAYS_REDRAW, setRedrawHandler } from "./frame";
import { VIEW_H, VIEW_W, bind, integerScale, logicalPoint } from "./primitives";

export interface LogicalPoint {
  x: number;
  y: number;
}

export interface CanvasMount {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** 다음 애니메이션 프레임에 scene 다시 그리기를 예약한다 (render/frame의 requestRedraw와 같다). */
  requestRedraw: () => void;
  /** 개발용 그리기 통계: 누적 그리기 횟수, 최근 한 번 그리는 데 걸린 ms. */
  stats: { draws: number; lastMs: number; idle: boolean };
  /** 캔버스 클라이언트 좌표 → 논리 좌표(480x270 기준) 변환. */
  toLogical: (clientX: number, clientY: number) => LogicalPoint;
}

async function loadFonts() {
  // Galmuri11(본문), Galmuri9(보조) 로드 완료 후 렌더해야 글자가 폰트 대체 없이 한 번에 그려진다.
  // 폰트는 npm galmuri(버전 고정)에서 쓰는 두 개만 번들한다. CDN·전체 galmuri.css는 안 쓴다.
  const faces = [new FontFace("Galmuri11", `url(${galmuri11Url}) format("woff2")`), new FontFace("Galmuri9", `url(${galmuri9Url}) format("woff2")`)];
  for (const f of faces) document.fonts.add(f);
  const specs = ["8px Galmuri11", "7px Galmuri9"];
  try {
    await Promise.all(faces.map((f) => f.load()));
    await Promise.all(specs.map((spec) => document.fonts.load(spec)));
    await document.fonts.ready;
  } catch {
    // 폰트 로드 API가 없거나 실패해도 렌더는 진행한다 (fallback: monospace).
  }
}

/**
 * frame(dtMs)는 tick + draw를 하고, 화면의 isAnimating() 값을 돌려준다
 * (true: 다음 프레임도, 숫자: 그 ms 뒤에, false: 다음 requestRedraw까지 멈춤).
 */
export async function mountCanvas(
  container: HTMLElement,
  frame: (dtMs: number) => boolean | number
): Promise<CanvasMount> {
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  container.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D 컨텍스트를 만들 수 없다");
  bind(ctx);

  let scale = 1;
  /** 기기 픽셀 비율 (정수로 반올림). 백킹 스토어 = 논리 × scale × dpr, 화면에 보이는 크기 = 논리 × scale (2026-11-08 고해상도) */
  let dpr = 1;

  const stats = { draws: 0, lastMs: 0, idle: true };

  // ui-spec.md 9장: 변경이 있을 때만 그린다. requestRedraw()가 dirty를 세우고 RAF를 한 번 예약하며,
  // 화면이 애니메이션 중이라고 답하는 동안만 다음 프레임을 이어서 예약한다. 가만히 있으면 RAF도 멈춘다.
  let dirty = false;
  let scheduled = false;
  let wakeAt = 0; // 간격(ms)을 돌려준 느린 애니메이션의 다음 그릴 시각
  let lastDraw = 0;
  let animating = false; // 직전 프레임이 애니메이션 중이었나 (dt 계산용)

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(onFrame);
  }

  function requestRedraw() {
    dirty = true;
    schedule();
  }

  function onFrame(now: number) {
    scheduled = false;
    if (!dirty && now < wakeAt) {
      schedule();
      return;
    }
    dirty = false;
    // 쉬다가 깨어난 첫 프레임은 한 프레임 분량만 흐르게 한다 (멈춰 있던 시간이 한꺼번에 흐르지 않게).
    const dt = animating ? Math.min(250, now - lastDraw) : 16;
    lastDraw = now;
    ctx!.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    ctx!.imageSmoothingEnabled = false;
    const t0 = performance.now();
    const anim = frame(dt);
    stats.lastMs = performance.now() - t0;
    stats.draws++;
    if (ALWAYS_REDRAW || anim === true) {
      animating = true;
      requestRedraw();
    } else if (typeof anim === "number" && anim > 0) {
      animating = true;
      wakeAt = now + anim;
      schedule();
    } else {
      animating = false;
    }
    stats.idle = !scheduled;
  }

  function resize() {
    const next = integerScale(container.clientWidth, container.clientHeight);
    const nextDpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    if (next === scale && nextDpr === dpr && canvas.width === VIEW_W * scale * dpr) return;
    scale = next;
    dpr = nextDpr;
    // 백킹 스토어를 최종 표시 해상도(기기 화소)로 직접 키운다 (CSS로 나중에 늘리지 않는다).
    canvas.width = VIEW_W * scale * dpr;
    canvas.height = VIEW_H * scale * dpr;
    canvas.style.width = `${VIEW_W * scale}px`;
    canvas.style.height = `${VIEW_H * scale}px`;
    // 백킹 스토어 크기를 바꾸면 그림이 지워지므로 다시 그린다.
    requestRedraw();
  }
  resize();
  window.addEventListener("resize", resize);
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(resize).observe(container);
  }

  function toLogical(clientX: number, clientY: number): LogicalPoint {
    const rect = canvas.getBoundingClientRect();
    const s = Math.max(1, rect.width / VIEW_W);
    return logicalPoint(clientX, clientY, rect, s);
  }

  await loadFonts();
  setRedrawHandler(requestRedraw);
  requestRedraw();

  return { canvas, ctx, requestRedraw, stats, toLogical };
}
