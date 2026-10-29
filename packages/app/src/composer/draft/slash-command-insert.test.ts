import { describe, expect, it } from "vitest";
import { composeSlashCommandInsert } from "./slash-command-insert";

describe("composeSlashCommandInsert", () => {
  it("inserts the command alone into an empty draft", () => {
    expect(composeSlashCommandInsert({ currentText: "", insert: "/model " })).toBe("/model ");
  });

  it("keeps the user's text behind the command", () => {
    expect(
      composeSlashCommandInsert({ currentText: "帮我把登录页改成暗色", insert: "/model " }),
    ).toBe("/model 帮我把登录页改成暗色");
  });

  it("swaps a leading command token instead of stacking commands", () => {
    expect(composeSlashCommandInsert({ currentText: "/clear 原文", insert: "/model " })).toBe(
      "/model 原文",
    );
  });

  it("swaps a bare leading command token", () => {
    expect(composeSlashCommandInsert({ currentText: "/clear", insert: "/model " })).toBe("/model ");
  });

  it("treats a leading slash command followed by newlines as a token swap", () => {
    expect(composeSlashCommandInsert({ currentText: "/clear\n\n原文", insert: "/model " })).toBe(
      "/model 原文",
    );
  });

  it("replaces a lone slash the user was still typing", () => {
    expect(composeSlashCommandInsert({ currentText: "/", insert: "/model " })).toBe("/model ");
  });

  it("does not treat a slash in the middle of the draft as a command token", () => {
    expect(composeSlashCommandInsert({ currentText: "看看 src/app.ts", insert: "/model " })).toBe(
      "/model 看看 src/app.ts",
    );
  });

  it("drops the whitespace the draft starts with so the insert's own space is the separator", () => {
    expect(composeSlashCommandInsert({ currentText: "  原文", insert: "/model " })).toBe(
      "/model 原文",
    );
  });

  it("keeps a multi-line draft intact", () => {
    expect(composeSlashCommandInsert({ currentText: "第一行\n第二行", insert: "/plan " })).toBe(
      "/plan 第一行\n第二行",
    );
  });
});
