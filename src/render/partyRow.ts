import { C, G, R, T, W } from "./primitives";

/** reference_wireframes.html 77–78행. 파티 상태창의 첫 줄(전사)만. */
export function drawPartyStatusLine() {
  R(0, 0, 480, 270, C.screenBg);
  W(124, 194, 352, 72, "", 1);
  ["전사", "도적", "마법사", "사제"].forEach((n, i) => {
    if (i !== 0) return;
    const y = 204 + i * 15;
    R(132, y - 6, 12, 12, C.allyColors[i]);
    T(150, y + 3, n, 8);
    G(196, y - 3, 30, 26 - i * 5, 30 - i * 3, 4);
    G(352, y - 3, 10, 7, 7, 3);
    for (let k = 0; k < 10; k++) R(394 + k * 4, y, 3, 3, k < i * 3 + 2 ? C.lim : C.cell);
    R(440, y - 4, 10, 8, i == 0 ? C.gold : C.cellExt);
  });
}
