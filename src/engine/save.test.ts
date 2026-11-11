import { describe, expect, it } from "vitest";
import { SAVE_VERSION, checkSaveText } from "./save";

describe("세이브 파일 검사 (engine/save.ts checkSaveText)", () => {
  it("지금 버전의 세이브는 통과한다", () => {
    expect(checkSaveText(JSON.stringify({ version: SAVE_VERSION, savedAt: 1, formation: {} }))).toBeNull();
  });

  it("JSON이 아니면 읽을 수 없다고 알린다", () => {
    expect(checkSaveText("")).toBe("세이브 파일을 읽을 수 없다");
    expect(checkSaveText("{ version: 1")).toBe("세이브 파일을 읽을 수 없다");
  });

  it("객체가 아닌 JSON(null·배열·숫자·글자)은 형식이 아니라고 알린다", () => {
    for (const text of ["null", "[]", "[1,2]", "3", '"save"', "true"]) expect(checkSaveText(text)).toBe("세이브 파일 형식이 아니다");
  });

  it("버전이 없거나 다르면 버전이 다르다고 알린다", () => {
    expect(checkSaveText("{}")).toBe("버전이 다른 세이브 파일이다");
    expect(checkSaveText(JSON.stringify({ version: SAVE_VERSION + 1 }))).toBe("버전이 다른 세이브 파일이다");
    expect(checkSaveText(JSON.stringify({ version: String(SAVE_VERSION) }))).toBe("버전이 다른 세이브 파일이다");
  });
});
