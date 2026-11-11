// 몬스터 이미지 경로 (2026-11-09). 원본 art_src/monster, 변환 tools/gen_monster_images.py → public/monsters/<몬스터 id>/.
//   battle 전투 스프라이트 (정사각, 발 = 아래 가운데, 왼쪽을 보게 맞춰 둠) · portrait 적 카드 초상화 · mini 턴 표시 초상화
// 그림이 있는 몬스터만 (없으면 null → 화면은 예전 색 상자). 고해상도 원본이라 img(…, smooth=true)로 그린다.
export type MonsterArt = "battle" | "portrait" | "mini";

const HAS: Record<string, MonsterArt[]> = {
  bat: ["battle", "mini", "portrait"],
  cave_spider: ["battle"],
  dragon: ["battle"],
  elder_treant: ["battle"],
  goblin: ["battle", "mini", "portrait"],
  goblin_archer: ["battle", "mini", "portrait"],
  golem: ["battle"],
  horned_hare: ["battle", "mini", "portrait"],
  king_slime: ["battle"],
  ogre: ["battle"],
  queen_spider: ["battle"],
  slime: ["battle", "mini", "portrait"],
  troll: ["battle"],
  wolf: ["battle", "mini", "portrait"],
  wyvern: ["battle"],
};

export function monsterArt(monId: string, kind: MonsterArt): string | null {
  return HAS[monId]?.includes(kind) ? `${import.meta.env.BASE_URL}monsters/${monId}/${kind}.png` : null;
}
