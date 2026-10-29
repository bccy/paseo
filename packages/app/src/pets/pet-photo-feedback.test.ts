import { describe, expect, it } from "vitest";
import { resolvePetPhotoFeedback } from "./pet-photo-feedback";

/**
 * The double-tap "add the newest photo" feedback.
 *
 * Before this existed the result was discarded, so a missing permission, an empty
 * library and a real failure all looked like nothing happened. Each result now has
 * to say something different, and the success case has to stay silent (the photo
 * appearing in the composer is the feedback).
 */
describe("resolvePetPhotoFeedback", () => {
  it("says nothing on success", () => {
    expect(resolvePetPhotoFeedback("inserted")).toBeNull();
  });

  it("tells the user to open a conversation when there is no target", () => {
    expect(resolvePetPhotoFeedback("no-target")).toEqual({
      message: "先打开一个会话或草稿，再加入照片",
      variant: "warning",
    });
  });

  it("points at the system settings for a denied permission", () => {
    // The OS prompt will not appear again, so this is the only actionable case.
    const feedback = resolvePetPhotoFeedback("permission-denied");
    expect(feedback?.variant).toBe("warning");
    expect(feedback?.message).toContain("系统设置");
  });

  it("reports an empty library separately from a failure", () => {
    const empty = resolvePetPhotoFeedback("no-photos");
    const failed = resolvePetPhotoFeedback("failed");
    expect(empty?.message).not.toBe(failed?.message);
    expect(failed?.variant).toBe("error");
  });

  it("gives every non-success result a distinct message", () => {
    const results = [
      "no-target",
      "permission-denied",
      "no-photos",
      "unavailable",
      "failed",
    ] as const;
    const messages = results.map((result) => resolvePetPhotoFeedback(result)?.message);
    expect(new Set(messages).size).toBe(results.length);
    expect(messages.every((message) => message !== undefined)).toBe(true);
  });
});
