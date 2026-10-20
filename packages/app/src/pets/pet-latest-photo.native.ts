/**
 * Desk-pet photo insertion (native implementation).
 *
 * The pet's double tap adds the newest photo from the device library to the
 * focused chat draft. It does not send anything: the composer keeps its normal
 * "attachment pill + send button" flow.
 *
 * `expo-media-library` is imported from its main entry: the 18.x line (what
 * Expo SDK 54 resolves) still exports `getAssetsAsync` / `getAssetInfoAsync`
 * there and they are the working API — the `/legacy` subpath only exists on
 * later majors that moved these functions out of the root.
 *
 * @module paseo/pets/pet-latest-photo
 */

import * as MediaLibrary from "expo-media-library";
import { persistAttachmentFromFileUri } from "@/attachments/service";
import type { AttachmentMetadata } from "@/attachments/types";
import { useDraftStore } from "@/stores/draft-store";

export type PetPhotoInsertResult =
  | "inserted"
  | "no-target"
  | "permission-denied"
  | "no-photos"
  | "unavailable"
  | "failed";

function mimeTypeForFilename(filename: string): string {
  const name = filename.toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".heic") || name.endsWith(".heif")) return "image/heic";
  if (name.endsWith(".bmp")) return "image/bmp";
  return "image/jpeg";
}

/**
 * Append an image pill to a draft without touching its text.
 *
 * The draft is hydrated first because drafts are lazy: writing a partial draft
 * would otherwise drop the persisted text/attachments that have not been read
 * yet.
 */
async function appendImageToDraft(
  draftKey: string,
  metadata: AttachmentMetadata,
): Promise<void> {
  const store = useDraftStore.getState();
  await store.hydrateDraftInput({ draftKey });
  const current = store.getDraftInput(draftKey) ?? { text: "", attachments: [] };
  store.saveDraftInput({
    draftKey,
    draft: {
      text: current.text,
      attachments: [...current.attachments, { kind: "image", metadata }],
    },
  });
}

/**
 * Add the newest photo in the device library to `draftKey`.
 *
 * Every failure mode returns a value instead of throwing: the pet must never
 * crash a screen because the library is empty or the permission was denied.
 */
export async function insertLatestPhotoIntoDraft(
  draftKey: string | null,
): Promise<PetPhotoInsertResult> {
  if (draftKey === null) return "no-target";
  try {
    const permission = await MediaLibrary.requestPermissionsAsync();
    if (!permission.granted) return "permission-denied";

    // String literals are part of the legacy API surface; using the enums would
    // tie this module to enum exports that moved around between major versions.
    const page = await MediaLibrary.getAssetsAsync({
      first: 1,
      mediaType: ["photo"],
      sortBy: [["creationTime", false]],
    });
    const asset = page.assets[0];
    if (asset === undefined) return "no-photos";

    // iOS exposes the library asset via ph:// in `uri`; `localUri` is the
    // readable file copy when the platform provides one (Android always does).
    const info = await MediaLibrary.getAssetInfoAsync(asset);
    const metadata = await persistAttachmentFromFileUri({
      uri: info?.localUri ?? asset.uri,
      mimeType: mimeTypeForFilename(asset.filename),
      fileName: asset.filename,
    });
    await appendImageToDraft(draftKey, metadata);
    return "inserted";
  } catch (error) {
    console.warn("[PetOverlay] Could not add the newest photo to the draft", error);
    return "failed";
  }
}
