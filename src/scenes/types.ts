export interface LogicalPoint {
  x: number;
  y: number;
}

/**
 * 그리기 규칙 (ui-spec.md 9장): draw()는 "변경이 있을 때만" 불린다.
 * - 입력 핸들러·onEnter·화면 전환·창 크기 변경·img() 로딩 완료 뒤에는 루프가 알아서 다시 그린다.
 * - 그 밖의 계기(타이머, 비동기 결과 등)로 그림이 바뀌면 render/frame의 requestRedraw()를 부른다.
 * - 시간에 따라 움직이는 동안은 isAnimating()이 참을 돌려줘야 매 프레임 tick + draw가 이어진다.
 * - draw() 안에서 performance.now() 같은 시계를 직접 읽지 말고 tick의 dt로 시간을 쌓는다.
 */
export interface Scene {
  id: string;
  label: string;
  draw: () => void;
  /**
   * 지금 시간에 따라 그림이 바뀌는 중인가 (연출, 파티클, 보간, 이동, 깜빡임, 남은 타이머).
   * 매 프레임 tick → draw 뒤에 물어본다. true면 다음 프레임도 그린다. 숫자를 돌려주면 그 간격(ms)마다만
   * 그린다 — 느린 숨쉬기·대기 연출을 30fps 이하로 돌려 저사양 기기 부담을 줄일 때. false/생략이면 멈춘다.
   */
  isAnimating?: () => boolean | number;
  /** 탭이나 goTo로 이 화면에 들어올 때마다 호출. 진입 연출을 처음부터 다시 틀어야 하는 화면만 구현. */
  onEnter?: () => void;
  /** button: 0 left, 1 middle(wheel click), 2 right. */
  onPointerDown?: (p: LogicalPoint, button: number) => void;
  onPointerMove?: (p: LogicalPoint) => void;
  onPointerUp?: (p: LogicalPoint, button: number) => void;
  onKeyDown?: (key: string) => void;
  onKeyUp?: (key: string) => void;
  onWheel?: (deltaY: number) => void;
  /** 그리는 프레임마다 draw 직전에 호출 (ms 단위 델타, 최대 250). 쉬다가 다시 깨어난 첫 프레임은 약 16. */
  tick?: (dtMs: number) => void;
}
