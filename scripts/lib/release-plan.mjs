/**
 * 发布计划纯函数（可单测；Publish workflow 的 plan 阶段与本地脚本共用）。
 * 只做判定，不读文件、不写输出——渠道推断、安全阀、tag 校验都在这里，便于用 node -e 直接验证。
 */

export class ReleasePlanError extends Error {}

/**
 * @param {object} input
 * @param {Array<{name: string, version: string}>} input.packages 可发布包（版本须一致）
 * @param {"auto"|"next"|"latest"} [input.channelArg]
 * @param {string} [input.tag] 形如 `v0.7.0-alpha.1`；空串表示非 tag 触发
 */
export function resolvePlan({ packages, channelArg = "auto", tag = "" }) {
  if (!Array.isArray(packages) || packages.length === 0) {
    throw new ReleasePlanError("没找到可发布的 @vuagent/* 包");
  }
  const versions = new Set(packages.map((p) => p.version));
  if (versions.size !== 1) {
    const detail = [...versions].join(" / ");
    throw new ReleasePlanError(`可发布包版本不一致（fixed 组要求同版本）→ ${detail}`);
  }
  const version = [...versions][0];
  const prerelease = String(version).includes("-");

  if (!["auto", "next", "latest"].includes(channelArg)) {
    throw new ReleasePlanError(`未知 channel「${channelArg}」（只支持 auto / next / latest）`);
  }
  const channel = channelArg === "auto" ? (prerelease ? "next" : "latest") : channelArg;

  // 安全阀：预发布版本绝不允许占用 latest（一旦占用，`npm i` 会装到 alpha）
  if (channel === "latest" && prerelease) {
    throw new ReleasePlanError(
      `版本 ${version} 是预发布版，不允许发到 latest（用 --channel next，或先 changeset pre exit 出正式版）`,
    );
  }

  // tag 校验：push tag 触发时，tag 必须与包版本严格对应
  if (tag) {
    const expected = `v${version}`;
    if (tag !== expected) {
      throw new ReleasePlanError(
        `tag「${tag}」与包版本不一致（应为「${expected}」）——先在 Version Packages PR 里对齐版本再打 tag`,
      );
    }
  }

  return {
    version,
    channel,
    prerelease,
    tagValidated: tag || null,
    packages: packages.map((p) => ({ name: p.name, version: p.version })),
  };
}
