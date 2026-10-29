import type { PetPhotoInsertResult } from "./pet-latest-photo";

/**
 * What the double-tap "add the newest photo" flow tells the user.
 *
 * The result used to be discarded with `void`, so every failure looked like a
 * no-op: no draft on screen, no photo library permission, an empty library and a
 * real error were indistinguishable from success. `null` means "say nothing" —
 * a successful insert is visible in the composer itself, and a toast on top of it
 * is noise.
 *
 * `variant` matches the toast API's own vocabulary rather than inventing one, so
 * the caller can hand it straight to `toast.show(message, { variant })`.
 */
export interface PetPhotoFeedback {
  readonly message: string;
  readonly variant: "success" | "warning" | "error";
}

/**
 * The message for one insert result, or `null` when the user needs no telling.
 *
 * `permission-denied` is the one that has to point somewhere: the OS prompt will
 * not appear again, so the user has to open Settings themselves.
 */
export function resolvePetPhotoFeedback(result: PetPhotoInsertResult): PetPhotoFeedback | null {
  switch (result) {
    case "inserted":
      // The photo is in the composer. Nothing to announce.
      return null;
    case "no-target":
      return { message: "先打开一个会话或草稿，再加入照片", variant: "warning" };
    case "permission-denied":
      return { message: "没有相册权限，请到系统设置里允许访问照片", variant: "warning" };
    case "no-photos":
      return { message: "相册里还没有照片", variant: "warning" };
    case "unavailable":
      return { message: "这台设备上无法读取相册", variant: "warning" };
    case "failed":
      return { message: "加入照片失败，请再试一次", variant: "error" };
    default: {
      // Exhaustiveness: a new result value must be handled, not silently dropped.
      const unreachable: never = result;
      return unreachable;
    }
  }
}
