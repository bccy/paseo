// 在 `git merge upstream/main` 留下冲突后，只自动解决白名单里的机械冲突：
//   - package-lock.json：取 theirs，再按已解决的 package.json 重新生成；
//   - nix/npm-deps.hash：取 theirs；
//   - 各 package.json：取 theirs，再把 fork 独有的依赖从 ours 补回。
// 其它文件（真实代码冲突）原样留给人工，脚本只报告剩余数量。
// 退出码：0 = 没有剩余冲突；1 = 仍有冲突需要人工；2 = 自动解决过程出错。

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { isMainModule } from "./is-main-module.mjs";

export const PACKAGE_LOCK_PATH = "package-lock.json";
export const NIX_DEPS_HASH_PATH = "nix/npm-deps.hash";

// fork 独有的依赖：合并时以 theirs（上游）为准，但这些依赖要从 ours（fork）补回，版本取 ours 的值。
// 新增 fork 独有依赖时只改这张表，其它差异一律跟随上游。
export const FORK_ONLY_DEPENDENCIES = new Map([
  ["packages/app/package.json", ["expo-media-library"]],
]);

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

export function conflictResolutionKind(filePath) {
  if (filePath === PACKAGE_LOCK_PATH) return "lockfile";
  if (filePath === NIX_DEPS_HASH_PATH) return "theirs";
  if (filePath === "package.json" || filePath.endsWith("/package.json")) return "package-json";
  return null;
}

// 纯逻辑：theirs 是合并结果，allowlist 里的依赖从 ours 补回（按 ours 所在的依赖段）。
export function mergePackageJson(ours, theirs, forkDependencies = []) {
  const merged = structuredClone(theirs);
  for (const name of forkDependencies) {
    const field = DEPENDENCY_FIELDS.find((candidate) => ours?.[candidate]?.[name] !== undefined);
    if (!field) continue;
    merged[field] = { ...merged[field], [name]: ours[field][name] };
  }
  return merged;
}

// 纯逻辑：把冲突文件分成「可机械解决」和「留给人工」，lockfile 排最后（它依赖已解决的 package.json）。
export function classifyConflicts(conflictPaths, forkDependencies = FORK_ONLY_DEPENDENCIES) {
  const mechanical = [];
  const remaining = [];
  for (const filePath of conflictPaths) {
    const kind = conflictResolutionKind(filePath);
    if (kind === null) {
      remaining.push(filePath);
      continue;
    }
    mechanical.push({ path: filePath, kind, dependencies: forkDependencies.get(filePath) ?? [] });
  }
  mechanical.sort((left, right) => (left.kind === "lockfile") - (right.kind === "lockfile"));
  return { mechanical, remaining };
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function stage(filePath) {
  execFileSync("git", ["add", "--", filePath], { stdio: "inherit" });
}

function conflictedPaths() {
  return git(["diff", "--name-only", "--diff-filter=U"])
    .split("\n")
    .filter((line) => line.length > 0);
}

function resolveFromTheirs(filePath) {
  execFileSync("git", ["checkout", "--theirs", "--", filePath], { stdio: "inherit" });
  stage(filePath);
}

function resolvePackageJson(filePath, forkDependencies) {
  const ours = JSON.parse(git(["show", `:2:${filePath}`]));
  const theirs = JSON.parse(git(["show", `:3:${filePath}`]));
  const merged = mergePackageJson(ours, theirs, forkDependencies);
  writeFileSync(filePath, `${JSON.stringify(merged, null, 2)}\n`);
  stage(filePath);
}

function resolveLockfile() {
  // 先取 theirs 但不 stage：npm 重新生成成功后才算解决。失败时保持冲突状态，避免提交没重生成的 lock。
  execFileSync("git", ["checkout", "--theirs", "--", PACKAGE_LOCK_PATH], { stdio: "inherit" });
  execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts"], {
    stdio: "inherit",
  });
  stage(PACKAGE_LOCK_PATH);
}

function resolveOne({ path, kind, dependencies }) {
  if (kind === "theirs") {
    resolveFromTheirs(path);
    return;
  }
  if (kind === "package-json") {
    resolvePackageJson(path, dependencies);
    return;
  }
  resolveLockfile();
}

export function resolveMechanicalConflicts({ forkDependencies = FORK_ONLY_DEPENDENCIES } = {}) {
  const { mechanical } = classifyConflicts(conflictedPaths(), forkDependencies);
  const failures = [];
  const resolved = [];

  for (const conflict of mechanical) {
    try {
      resolveOne(conflict);
      resolved.push(conflict.path);
      console.log(`已自动解决（${conflict.kind}）：${conflict.path}`);
    } catch (error) {
      failures.push({ path: conflict.path, message: String(error) });
      console.error(`::error::自动解决 ${conflict.path} 失败：${String(error)}`);
    }
  }

  return { resolved, remaining: conflictedPaths(), failures };
}

if (isMainModule(import.meta.url)) {
  const { resolved, remaining, failures } = resolveMechanicalConflicts();
  console.log(`resolved=${resolved.length}`);
  console.log(`remaining=${remaining.length}`);
  if (remaining.length > 0) {
    console.log("剩余冲突（需要人工解决）：");
    for (const filePath of remaining) console.log(`- ${filePath}`);
  }
  if (failures.length > 0) {
    process.exitCode = 2;
  } else if (remaining.length > 0) {
    process.exitCode = 1;
  }
}
