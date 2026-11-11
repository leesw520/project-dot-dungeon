# art_src — 이미지 원본 (게임에 바로 쓰지 않는다)

게임이 읽는 이미지는 `public/` (지연 로드, 게임 크기로 줄인 것). 여기는 그 전 단계의 **원본**이다.
2026-11-08: `D:\workspace\project_dot_dungeon\images_src`의 knight · priest · warrior · wizard 폴더를 복사해 왔다 (원본 폴더는 그대로 둠).
폴더 이름은 코드의 직업 키에 맞췄다 (wizard → `mage`). 파일 이름의 오타 `protrait` → `portrait`.

| 직업 | 일러스트 | 초상화 | 스프라이트 | 애니메이션 프레임 |
| --- | --- | --- | --- | --- |
| knight | `knight_full_image.png` 1355×1160 | `_portrait_64` · `_portrait_96` (실제 1254×1254) | `knight_sprite.png` 313×313 | `animation_frames/` attack · hit · idle (313×313, 16~18장, `meta.txt` = 프레임 수·크기·프레임별 ms) |
| warrior | `warrior_full_image.png` 1122×1402 | `_portrait_64` · `_portrait_96` (실제 1254×1254) | `warrior_sprite.png` 1254×1254 | `animation_frames/idle` (313×313, 16장, meta 없음) |
| mage | `mage_full_image.png` 1355×1160 | `_portrait_64` 64×64 · `_portrait_96` 96×96 | `mage_sprite.png` 1254×1254 | 없음 |
| priest | `priest_full_image.png` 1086×1448 | `_portrait_64` · `_portrait_96` (실제 1254×1254) | `priest_sprite.png` 1254×1254 | 없음 |

- 이름에 64·96이 붙은 초상화도 마법사 것 말고는 원본 크기(1254)다.
- 애니메이션 프레임은 아직 미완성이라 쓰지 않는다.

## 게임용 변환 (2026-11-08 고해상도)

`python tools/gen_char_images.py` → `public/characters/<직업>/`. **원본 해상도를 그대로 쓴다** — 그림이 있는 부분만 잘라(전신 일러스트 아래 직업 이름 글자는 잘라 냄) 칸 비율에 맞춘 투명 여백을 붙이고, 칸의 8배(화면 4배 × 기기 2배)보다 크면 그만큼만 줄인다.
게임은 칸 크기(논리 좌표)에 `img(…, smooth=true)`로 그린다 — 캔버스가 화면 실제 화소(배율 × devicePixelRatio)로 그리므로 원본 세부가 살아 있다. 도트 UI·타일은 그대로 보간 끔.

| 출력 | 원본 | 칸 (논리) | 파일 크기 예 | 쓰는 곳 |
| --- | --- | --- | --- | --- |
| `illust.png` | `_full_image` | 120×156 (아래 정렬) | 608×791 ~ 917×1192 | P01 왼쪽 일러스트 영역 |
| `battle.png` | `_sprite` | 48×48 (발 = 아래 가운데) | 264 ~ 384 | B01 무대 아군 |
| `portrait.png` | `_portrait_96` | 28×28 | 92 ~ 224 | B01 왼쪽 아군 카드 (카드 폭 46 → 60) |
| `mini.png` | `_portrait_64` | 14×14 | 60 ~ 112 | B01 위 타임라인 카드 |

경로는 `src/data/charArt.ts` `charArt(이름, 종류)`. 이미지를 못 불러오면 예전 색 상자로 그린다. 마법사 초상화 원본은 64·96px라 작은 칸에서도 원본 해상도가 한계다.

## 몬스터 (2026-11-09)

`art_src/monster/` — `images_src/monster` 폴더를 통째로 옮겨 왔다 (원본 폴더는 이제 없다). 이름 정리: `_sprite`가 없던 8개(golem · horn_rabbit · king_slime · ogre · spider_queen · treant · troll · wyvern)에 `_sprite`를 붙이고, `protrait` → `portrait`.

`python tools/gen_monster_images.py` → `public/monsters/<몬스터 id>/` (`battle.png` 정사각·발 아래 가운데 · `portrait.png` · `mini.png`, 원본 해상도 · 최대 512/224/112px). 적은 왼쪽(아군 쪽)을 보게 — 오른쪽을 보는 원본은 좌우 반전 (`FLIP`, 2026-11-09 지금은 없음: 슬라임 원본은 이미 왼쪽을 봐서 반전하면 오른쪽을 봤다).

| 원본 | 몬스터 id | 스프라이트 | 초상화 |
| --- | --- | --- | --- |
| bat · goblin · goblin_archer · wolf | 같은 id | O | O |
| horn_rabbit | horned_hare | O | O |
| slime | slime | O (반전) | O |
| dragon · golem · king_slime · ogre · troll · wyvern | 같은 id | O | – |
| spider · spider_queen · treant | cave_spider · queen_spider · elder_treant | O | – |
| alraune | (맞는 몬스터 없음 — 가시꽃 후보, 아직 안 씀) | – | – |

전투 화면(B01): 스프라이트는 차지 칸 수별 정사각 48 · 72 · 104 · 150 (발 = 아래 가운데), 같은 몬스터 구분 글자(A·B)는 발밑 꼬리표. 적 카드는 초상화 14×14, 타임라인도 초상화. 그림이 없는 몬스터는 예전 색 상자. 경로는 `src/data/monsterArt.ts`.

## 전투 배경 (2026-11-09)

`art_src/backgrounds/battle_cave.webp` · `battle_meadow.webp` (1672×941, 16:9). 게임은 `public/backgrounds/`의 같은 파일을 화면 전체에 투명도 0.6으로 깐다 (B01). 구획마다 `battleBg` (`data/dungeons.ts`, 없으면 cave).

## 거점 (2026-11-09)

`art_src/hub/` = 받은 패키지 "거점 고정 배경 + 독립 건물 PNG v0.3" 그대로 (설명 `hub/README_ko.md`). 빈 배경 `background/hub_empty_1672x941.png`, 건물 `buildings/master/*.png`, 건설 마커 `markers/`, 배치 좌표 `maps/hub_placements.json`, 소품 `objects/`, 미리보기 `previews/`.
게임용 변환: `python tools/gen_hub_images.py` → `public/hub/` (배경 `hub_bg.webp`, 건물·마커 PNG 복사). 부지·건물 칸은 `src/data/facilities.ts` `PLOTS`·`HUB_ART`에 옮겨 적었다 (배치 파일 크기는 원본 비율과 달라 쓰지 않는다 — 부지를 덮게 같은 비율로 키우고, 전송장치는 돌 광장 가운데) (패키지 좌표가 바뀌면 거기도 고친다). 던전 게이트는 배경에 그려져 있어 `dungeon_gate.png`는 쓰지 않는다.
