import { describe, expect, it } from "vitest";
import { transformSync } from "@babel/core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guards the worklet definition order in the pet modules that run on the UI thread
 * (`pose-map.ts` and `ledge.ts`).
 *
 * The worklet compiler turns every `"worklet"` function into a factory that runs
 * at its definition site and snapshots the values it closes over:
 *
 *     var settleCancelledDrag = function settleCancelledDrag_poseMapTs4Factory(_ref) {
 *       var snapToPeekEdge = _ref.snapToPeekEdge;   // value snapshot, not a live binding
 *       ...
 *     }
 *
 * So a worklet that calls another worklet defined *later* in the file captures
 * `undefined`. Function hoisting does not save it — the capture already happened.
 * On the UI thread that surfaces as `TypeError: x is not a function`, which Hermes
 * reports as an uncaught error and the app aborts.
 *
 * `vitest` runs the file through esbuild, which ignores the `"worklet"` directive
 * and leaves ordinary hoisted functions, so no behavioural test can see this. This
 * one compiles the file the way Metro does and reads the output.
 */
const SOURCES = ["pose-map.ts", "ledge.ts"] as const;

interface WorkletDefinition {
  readonly name: string;
  readonly at: number;
}

function compileWithWorklets(source: string): string {
  const code = readFileSync(source, "utf8");
  const result = transformSync(code, {
    filename: source,
    // `platform` is honoured by babel-preset-expo at runtime but is not part of
    // Babel's `TransformCaller` type.
    caller: { name: "metro", platform: "ios", isDev: false, isServer: false } as never,
    presets: [["babel-preset-expo", {}]],
    plugins: [["react-native-worklets/plugin", {}]],
    babelrc: false,
    configFile: false,
  });
  if (result?.code == null) throw new Error("babel produced no output");
  return result.code;
}

/** Every worklet factory in the compiled output, in definition order. */
function workletDefinitions(compiled: string): WorkletDefinition[] {
  const pattern = /var ([A-Za-z_$][\w$]*)=exports\.\1=function \1_\w+Factory/g;
  const found: WorkletDefinition[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(compiled)) !== null) {
    found.push({ name: match[1], at: match.index });
  }
  return found;
}

/** Names a worklet snapshots, read out of the `__closure` it records. */
function closureNames(compiled: string, definition: WorkletDefinition): string[] {
  const window = compiled.slice(definition.at, definition.at + 1200);
  const match = /__closure=\{([^}]*)\}/.exec(window);
  if (match === null) return [];
  return match[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

describe.each(SOURCES)("worklet definition order in %s", (file) => {
  const compiled = compileWithWorklets(resolve(__dirname, file));
  const definitions = workletDefinitions(compiled);
  const positionOf = new Map(definitions.map((d) => [d.name, d.at]));

  it("compiles the module into worklet factories", () => {
    // If the plugin stops being applied this test would pass vacuously, so assert
    // it actually ran.
    expect(definitions.length).toBeGreaterThan(0);
    expect(compiled).toContain("__closure");
  });

  it("never captures another worklet defined later in the file", () => {
    const violations: string[] = [];
    for (const definition of definitions) {
      for (const captured of closureNames(compiled, definition)) {
        const capturedAt = positionOf.get(captured);
        if (capturedAt === undefined) continue; // not a worklet; a plain value
        if (capturedAt > definition.at) {
          violations.push(
            `${definition.name} (${definition.at}) captures ${captured} (${capturedAt}), which is defined later`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
