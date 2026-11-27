import fs from "node:fs";
import path from "node:path";

/**
 * workspace 包枚举（发布链脚本共用）。
 * 目录约定：packages/* 、apps/* 、examples/*，各自带 package.json。
 */

/** @typedef {{ dir: string, rel: string, pkg: any }} WorkspacePackage */

/** @returns {WorkspacePackage[]} */
export function listWorkspacePackages(root) {
  const out = [];
  for (const group of ["packages", "apps", "examples"]) {
    const groupDir = path.join(root, group);
    if (!fs.existsSync(groupDir)) continue;
    for (const name of fs.readdirSync(groupDir)) {
      const dir = path.join(groupDir, name);
      const pkgPath = path.join(dir, "package.json");
      if (!fs.existsSync(pkgPath)) continue;
      out.push({ dir, rel: `${group}/${name}`, pkg: JSON.parse(fs.readFileSync(pkgPath, "utf8")) });
    }
  }
  return out;
}

/** 可发布包：非 private 且 name 以 @vuagent/ 开头 */
export function publishablePackages(root) {
  return listWorkspacePackages(root).filter(
    (p) => !p.pkg.private && String(p.pkg.name || "").startsWith("@vuagent/"),
  );
}

/** 版本一致性（changesets fixed 组口径）：返回唯一版本，或抛错列出差异 */
export function uniformVersion(packages) {
  const byVersion = new Map();
  for (const p of packages) {
    const list = byVersion.get(p.pkg.version) ?? [];
    list.push(p.pkg.name);
    byVersion.set(p.pkg.version, list);
  }
  if (byVersion.size !== 1) {
    const detail = [...byVersion.entries()].map(([v, names]) => `${v}: ${names.join(", ")}`).join(" | ");
    throw new Error(`可发布包版本不一致（fixed 组要求同版本）→ ${detail}`);
  }
  return { version: [...byVersion.keys()][0], packages };
}
