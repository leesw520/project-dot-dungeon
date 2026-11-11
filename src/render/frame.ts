// 변경 시에만 다시 그리기 (ui-spec.md 9장 "그리기 규칙").
// 렌더 루프는 상시 돌지 않는다. requestRedraw()가 불리면 다음 애니메이션 프레임에 한 번 그리고,
// 그 화면의 isAnimating()이 참인 동안만 프레임을 이어간다. 가만히 있으면 RAF 자체가 멈춘다.
//
// 입력(포인터·휠·키), 화면 전환, 창 크기 변경, 이미지 로딩 완료는 루프 쪽(main.ts, canvas.ts,
// primitives.img)에서 알아서 부른다. 화면 코드는 그 밖의 계기(타이머, 비동기 데이터 등)로 그림이
// 바뀔 때만 직접 부르면 된다.

let handler: (() => void) | null = null;
let pending = false;

/** 다음 프레임에 현재 화면을 다시 그린다. 여러 번 불러도 한 번만 그린다. */
export function requestRedraw() {
  if (handler) handler();
  else pending = true;
}

/** canvas.ts가 루프를 붙일 때 한 번 부른다. 붙기 전에 들어온 요청은 바로 넘긴다. */
export function setRedrawHandler(fn: () => void) {
  handler = fn;
  if (pending) {
    pending = false;
    fn();
  }
}

/**
 * 디버그용 강제 상시 그리기. 주소에 ?redraw=always 를 붙이면 예전처럼 매 프레임 그린다.
 * "그림이 안 바뀌는" 버그가 dirty 플래그 탓인지 가를 때 쓴다.
 */
export const ALWAYS_REDRAW = new URLSearchParams(location.search).get("redraw") === "always";
