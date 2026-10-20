/**
 * Desk-pet photo insertion (web implementation).
 *
 * The web build has no media library. The overlay still compiles and double
 * taps are simply ignored, which keeps the shared renderer platform-agnostic.
 *
 * @module paseo/pets/pet-latest-photo
 */

export type PetPhotoInsertResult =
  | "inserted"
  | "no-target"
  | "permission-denied"
  | "no-photos"
  | "unavailable"
  | "failed";

export async function insertLatestPhotoIntoDraft(
  _draftKey: string | null,
): Promise<PetPhotoInsertResult> {
  return "unavailable";
}
