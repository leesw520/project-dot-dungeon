// 캐릭터 이미지 경로 (2026-11-08). 원본은 art_src/characters, 게임 크기 변환은 tools/gen_char_images.py → public/characters/<직업>/.
//   illust 전신 일러스트 120×156 (P01) · battle 전투 스프라이트 48×48 (B01) · portrait 카드 초상화 28×28 · mini 턴 표시 초상화 14×14
// 크기는 논리 좌표(480×270 기준). 파일은 원본 해상도(최대 8배)라 img(…, smooth=true)로 실제 화소 크기에 맞춰 그린다 (2026-11-08 고해상도).
import { classKeyOf } from "./skills";

export type CharArt = "illust" | "battle" | "portrait" | "mini";
export const CHAR_ART_SIZE: Record<CharArt, [number, number]> = { illust: [120, 156], battle: [48, 48], portrait: [28, 28], mini: [14, 14] };

/** 이 캐릭터(PARTY 이름) 이미지 경로. 이미지가 없는 직업이면 null */
export function charArt(name: string, kind: CharArt): string | null {
  const k = classKeyOf(name);
  return k ? `${import.meta.env.BASE_URL}characters/${k}/${kind}.png` : null;
}
