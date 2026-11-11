// 레시피 습득 (2026-11-08, docs/materials.md 5장 · docs/skill-cores.md).
// - 제작 노트(k:…)를 얻는 순간 그 노트의 레시피를 영구히 배운다. 노트를 잃어도 배운 것은 남는다.
// - 스킬 코어: 원정에서 (가방으로) 처음 얻은 코어를 기록한다 → 드롭 전용 코어의 제작 해금 (data/coreUnlock.ts).
import { registerSave } from "../engine/save";

const learned = new Set<string>();
const foundCores = new Set<string>();

/** 제작 노트 id를 배운 것으로 기록한다. */
export function learnNote(id: string) {
  if (id.startsWith("k:")) learned.add(id);
}
export const hasLearned = (note: string | undefined) => !note || learned.has(note);

/** 원정에서 얻은 스킬 코어를 기록한다 (드롭 전용 코어 제작 해금). */
export function noteCoreFound(itemId: string) {
  foundCores.add(itemId);
}
export const hasFoundCore = (itemId: string) => foundCores.has(itemId);

registerSave(
  "recipeBook",
  () => ({ notes: [...learned], cores: [...foundCores] }),
  (v) => {
    // 옛 형식: 노트 id 배열
    const d = Array.isArray(v) ? { notes: v as string[], cores: [] as string[] } : (v as { notes: string[]; cores: string[] });
    d.notes.forEach(learnNote);
    (d.cores ?? []).forEach(noteCoreFound);
  }
);
