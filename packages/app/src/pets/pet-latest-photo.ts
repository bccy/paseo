/**
 * Platform-neutral entry for the desk pet's "add newest photo" action.
 *
 * Metro picks `pet-latest-photo.native.ts` on iOS/Android and
 * `pet-latest-photo.web.ts` on web; TypeScript resolves this file, which
 * re-exports the native surface (the web module mirrors it).
 *
 * @module paseo/pets/pet-latest-photo
 */

export * from "./pet-latest-photo.native";
