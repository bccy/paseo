/**
 * Persistence for the desk pet.
 *
 * The upstream plugin keeps every piece of this in `localStorage`; React Native
 * has no such store, so it all lives under one AsyncStorage key. The state
 * blobs (`growth`, `gameStats`) are opaque here on purpose: they are owned and
 * shaped by `whale-moe-core.js`, and this module only round-trips them.
 *
 * All reads and writes are best-effort. A pet that forgets its mood is not
 * worth surfacing an error for.
 *
 * @module paseo/pets/pet-storage
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "paseo.pet.save.v1";

/** The five switches the upstream manifest exposes (its `readPref` keys). */
export interface PetSettings {
  /** Dialogue bubbles. */
  chat: boolean;
  /** Mini-games from the long-press menu. */
  game: boolean;
  /** Emoji/particle bursts on interactions. */
  particles: boolean;
  /** Show the pet at all; turning this off is how the upstream hides it. */
  pet: boolean;
  /** Head / belly / tail hit zones instead of one generic reaction. */
  zones: boolean;
}

export const DEFAULT_SETTINGS: PetSettings = {
  chat: true,
  game: true,
  particles: true,
  pet: true,
  zones: true,
};

export interface PetSave {
  settings: PetSettings;
  /** Opaque growth/achievement state owned by the core module. */
  growth: unknown;
  /** Opaque game record state owned by the core module. */
  gameStats: unknown;
}

const DEFAULT_SAVE: PetSave = {
  settings: DEFAULT_SETTINGS,
  growth: undefined,
  gameStats: undefined,
};

/** Coerce whatever was on disk into a usable save without trusting its shape. */
function normalize(raw: unknown): PetSave {
  if (raw === null || typeof raw !== "object") return DEFAULT_SAVE;
  const record = raw as Record<string, unknown>;
  const storedSettings =
    record.settings !== null && typeof record.settings === "object"
      ? (record.settings as Record<string, unknown>)
      : {};
  const settings: PetSettings = {
    chat: typeof storedSettings.chat === "boolean" ? storedSettings.chat : DEFAULT_SETTINGS.chat,
    game: typeof storedSettings.game === "boolean" ? storedSettings.game : DEFAULT_SETTINGS.game,
    particles:
      typeof storedSettings.particles === "boolean"
        ? storedSettings.particles
        : DEFAULT_SETTINGS.particles,
    pet: typeof storedSettings.pet === "boolean" ? storedSettings.pet : DEFAULT_SETTINGS.pet,
    zones: typeof storedSettings.zones === "boolean" ? storedSettings.zones : DEFAULT_SETTINGS.zones,
  };
  return { settings, growth: record.growth, gameStats: record.gameStats };
}

/** Read the save, or defaults when there is nothing readable on disk. */
export async function loadPetSave(): Promise<PetSave> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_SAVE;
    return normalize(JSON.parse(raw));
  } catch {
    return DEFAULT_SAVE;
  }
}

/** Write the save. Failures are swallowed: they only cost progress, not function. */
export async function savePetSave(save: PetSave): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(save));
  } catch {
    // Best-effort by design — see the module note.
  }
}
