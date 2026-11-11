// 고정 레이어 캐시 (ui-spec.md 9장 "그리기 규칙").
// 거의 안 바뀌는 그림(배경, 창 틀, 무대 바닥, 같은 값의 분할 막대 등)을 오프스크린 캔버스에 한 번 그려 두고,
// 다음부터는 그 이미지를 한 번에 붙인다. 오프스크린은 최종 화면 배율로 만들어서 붙일 때 1:1로 복사된다
// (확대·보간 없음 → 사각형도 글자도 직접 그린 것과 같은 픽셀).
//
//   cached(`b01.base`, 0, 0, 480, 270, () => { R(...); W(...); });
//   cached(`sbar:${L}:${h}:${n}:${fillsKey}`, x, y, L, h, () => rawSbar(x, y, ...));
//
// paint는 평소처럼 논리 좌표 그대로 그린다. (x,y,w,h) 영역만 잘라 저장하므로, 같은 key면 다른 자리에
// 붙여도 된다 (위치는 key에 넣지 않는다). 그림 내용을 바꾸는 값(편성, 레벨, 색 등)은 전부 key에 넣는다.
// 화면 배율은 여기서 key에 자동으로 붙인다.
//
// 주의: 투명 배경 위에 쓴 글자는 불투명 배경 위에 쓴 글자와 안티에일리어싱이 조금 다를 수 있다.
// 글자를 넣을 레이어는 그 영역의 바탕부터 불투명하게 칠해 둔다.
import { pen, withPen } from "./primitives";

interface Entry {
  canvas: HTMLCanvasElement;
  pixels: number;
}

// 오래 안 쓴 것부터 버린다. Map은 넣은 순서를 지키므로, 쓸 때마다 지웠다 다시 넣어 맨 뒤로 보낸다.
const entries = new Map<string, Entry>();
const MAX_ENTRIES = 400;
const MAX_PIXELS = 24_000_000; // 대략 96MB. 배율 4 전체 화면(1920×1080) 약 11장
let totalPixels = 0;

let hits = 0;
let misses = 0;

function evict() {
  for (const [k, e] of entries) {
    if (entries.size <= MAX_ENTRIES && totalPixels <= MAX_PIXELS) break;
    entries.delete(k);
    totalPixels -= e.pixels;
  }
}

/** 지금 그리는 캔버스의 배율 (canvas.ts가 setTransform(scale,…)으로 걸어 둔 값). */
function currentScale() {
  return pen().getTransform().a || 1;
}

/**
 * key가 같으면 저장해 둔 그림을 (x,y)에 붙이고, 처음이거나 key가 바뀌면 paint로 새로 그려 저장한다.
 * x, y, w, h는 정수 논리 좌표.
 */
export function cached(key: string, x: number, y: number, w: number, h: number, paint: () => void) {
  const g = pen();
  const scale = currentScale();
  const full = `${scale}|${key}`;
  let e = entries.get(full);
  if (e) {
    hits++;
    entries.delete(full);
    entries.set(full, e);
  } else {
    misses++;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const off = canvas.getContext("2d")!;
    off.setTransform(scale, 0, 0, scale, -x * scale, -y * scale);
    off.imageSmoothingEnabled = false;
    withPen(off, paint);
    e = { canvas, pixels: canvas.width * canvas.height };
    entries.set(full, e);
    totalPixels += e.pixels;
    evict();
  }
  // 정수 논리 좌표 × 정수 배율 → 백킹 스토어 픽셀에 정확히 맞는다.
  g.drawImage(e.canvas, Math.round(x), Math.round(y), w, h);
}

/** 화면이 통째로 바뀌어 예전 레이어가 쓸모없을 때(예: 폰트 교체). 평소엔 부를 필요 없다. */
export function clearLayerCache() {
  entries.clear();
  totalPixels = 0;
}

/** 개발용 통계 (main.ts의 그리기 카운터가 표시). */
export function layerCacheStats() {
  return { entries: entries.size, pixels: totalPixels, hits, misses };
}
