import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyConflicts,
  conflictResolutionKind,
  mergePackageJson,
} from "./sync-upstream-resolve.mjs";

const forkManifest = {
  name: "@getpaseo/app",
  dependencies: {
    expo: "~57.0.0",
    "expo-media-library": "~57.0.2",
    react: "19.1.0",
  },
  devDependencies: {
    typescript: "5.9.0",
  },
};

const upstreamManifest = {
  name: "@getpaseo/app",
  dependencies: {
    expo: "~58.0.0",
    react: "19.2.0",
  },
  devDependencies: {
    typescript: "5.9.3",
  },
  scripts: {
    test: "vitest run",
  },
};

test("restores fork-only dependencies from ours", () => {
  const merged = mergePackageJson(forkManifest, upstreamManifest, ["expo-media-library"]);

  assert.equal(merged.dependencies["expo-media-library"], "~57.0.2");
  assert.equal(merged.dependencies.expo, "~58.0.0");
  assert.equal(merged.dependencies.react, "19.2.0");
  assert.equal(merged.devDependencies.typescript, "5.9.3");
  assert.equal(merged.scripts.test, "vitest run");
});

test("takes theirs for every difference outside the allowlist", () => {
  const merged = mergePackageJson(forkManifest, upstreamManifest, []);

  assert.deepEqual(merged, upstreamManifest);
  assert.equal(merged.dependencies["expo-media-library"], undefined);
});

test("keeps theirs when an allowlisted dependency is absent from ours", () => {
  const ours = { dependencies: { react: "19.1.0" } };
  const theirs = { dependencies: { react: "19.2.0", expo: "~58.0.0" } };

  assert.deepEqual(mergePackageJson(ours, theirs, ["expo-media-library"]), theirs);
});

test("restores the dependency in the section that holds it in ours", () => {
  const ours = { devDependencies: { "expo-media-library": "~57.0.2" } };
  const theirs = { devDependencies: { typescript: "5.9.3" } };

  const merged = mergePackageJson(ours, theirs, ["expo-media-library"]);

  assert.deepEqual(merged.devDependencies, {
    typescript: "5.9.3",
    "expo-media-library": "~57.0.2",
  });
  assert.equal(merged.dependencies, undefined);
});

test("an allowlisted dependency that upstream also ships still takes the fork version", () => {
  const ours = { dependencies: { "expo-media-library": "~57.0.2" } };
  const theirs = { dependencies: { "expo-media-library": "~58.0.0" } };

  assert.deepEqual(mergePackageJson(ours, theirs, ["expo-media-library"]), {
    dependencies: { "expo-media-library": "~57.0.2" },
  });
});

test("does not mutate the inputs", () => {
  const ours = structuredClone(forkManifest);
  const theirs = structuredClone(upstreamManifest);

  mergePackageJson(ours, theirs, ["expo-media-library"]);

  assert.deepEqual(ours, forkManifest);
  assert.deepEqual(theirs, upstreamManifest);
});

test("classifies only whitelisted conflict files as mechanical", () => {
  assert.equal(conflictResolutionKind("package-lock.json"), "lockfile");
  assert.equal(conflictResolutionKind("nix/npm-deps.hash"), "theirs");
  assert.equal(conflictResolutionKind("package.json"), "package-json");
  assert.equal(conflictResolutionKind("packages/app/package.json"), "package-json");
  assert.equal(conflictResolutionKind("packages/server/package.json"), "package-json");
  assert.equal(conflictResolutionKind("packages/app/src/app.tsx"), null);
  assert.equal(conflictResolutionKind("README.md"), null);
  assert.equal(conflictResolutionKind("scripts/fix-lockfile.mjs"), null);
});

test("splits conflicts into mechanical and human work, lockfile last", () => {
  const { mechanical, remaining } = classifyConflicts(
    [
      "packages/app/src/app.tsx",
      "package-lock.json",
      "packages/app/package.json",
      "nix/npm-deps.hash",
      "packages/server/src/server.ts",
    ],
    new Map([["packages/app/package.json", ["expo-media-library"]]]),
  );

  assert.deepEqual(
    mechanical.map(({ path, kind }) => `${kind}:${path}`),
    [
      "package-json:packages/app/package.json",
      "theirs:nix/npm-deps.hash",
      "lockfile:package-lock.json",
    ],
  );
  assert.deepEqual(mechanical[0].dependencies, ["expo-media-library"]);
  assert.deepEqual(mechanical[1].dependencies, []);
  assert.deepEqual(remaining, ["packages/app/src/app.tsx", "packages/server/src/server.ts"]);
});

test("an empty conflict list resolves nothing and leaves nothing", () => {
  assert.deepEqual(classifyConflicts([], new Map()), { mechanical: [], remaining: [] });
});
