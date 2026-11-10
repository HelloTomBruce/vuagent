/**
 * M5 组件 SSR smoke 测试：renderToString 全量渲染。
 * 验证两件事：组件可正常渲染（无运行时错误）+ SSR 安全（不触碰 window/document）。
 */
import { describe, expect, it } from "vitest";
import { createSSRApp, h, type Component } from "vue";
import { renderToString } from "@vue/server-renderer";
import {
  VaCheckpointList,
  VaCodeDiff,
  VaCommandMenu,
  VaCommentThread,
  VaDropzone,
  VaEmailDraft,
  VaFileTree,
  VaTerminalLog,
  VaUsageMeter,
  buildFileTree,
} from "../src";

const OLD = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n");
const NEW = OLD.split("\n")
  .map((l, i) => (i === 19 ? "line 20 CHANGED" : l))
  .join("\n");

async function ssr(component: Component, props: Record<string, unknown> = {}) {
  const warn: string[] = [];
  const app = createSSRApp({ render: () => h(component, props) });
  app.config.warnHandler = (msg) => warn.push(msg);
  const html = await renderToString(app);
  return { html, warn };
}

describe("M5 SSR 渲染", () => {
  it("VaCodeDiff：hunk 折叠 + 统计 + 词级高亮", async () => {
    const { html, warn } = await ssr(VaCodeDiff, { oldText: OLD, newText: NEW, fileName: "a.ts" });
    expect(warn).toEqual([]);
    expect(html).toContain("va-cdiff__expand"); // 有折叠段
    expect(html).toContain("+1 −1");
    expect(html).toContain("line 20 CHANGED");
    // wordLevel 默认开启（布尔 cast 回归锁定）：配对行有词级片段
    expect(html).toContain('class="va-cdiff__seg"');
  });

  it("VaCodeDiff：无变更空态", async () => {
    const { html } = await ssr(VaCodeDiff, { oldText: "a", newText: "a" });
    expect(html).toContain("两个版本内容一致");
  });

  it("VaFileTree：树渲染 + 状态徽章 + 选中", async () => {
    const tree = buildFileTree([
      { path: "src/ui/button.tsx", status: "modified" },
      { path: "src/hooks/use-form.ts", status: "added" },
      { path: "app/main.py", status: "deleted" },
    ]);
    // depth=1：一级目录展开、二级目录折叠（文件不可见但计数在）
    const top = await ssr(VaFileTree, { tree, selected: "src/ui/button.tsx", title: "变更" });
    expect(top.html).toContain("role=\"tree\"");
    expect(top.html).toContain("aria-expanded=\"false\""); // src/ui 折叠
    expect(top.html).toContain("va-ftree__count");
    // depth=2：文件可见，选中与徽章生效
    const deep = await ssr(VaFileTree, {
      tree,
      selected: "src/ui/button.tsx",
      defaultExpandDepth: 2,
    });
    expect(deep.html).toContain("button.tsx");
    expect(deep.html).toContain("aria-selected=\"true\"");
    expect(deep.html).toMatch(/data-status="modified"/);
    expect(deep.html).toMatch(/data-status="deleted"/);
  });

  it("VaTerminalLog：ANSI 行解析 + 语义行 + 行号", async () => {
    const { html } = await ssr(VaTerminalLog, {
      title: "bash",
      showLineNumbers: true,
      lines: [
        { text: "pnpm test", kind: "cmd" },
        "\u001b[32m✓ all passed\u001b[0m",
        { text: "1 failed", kind: "err" },
      ],
    });
    expect(html).toContain("va-term__row");
    expect(html).toContain("color:#98c379"); // ANSI 绿已解析为内联色
    expect(html).toContain("data-kind=\"err\"");
    expect(html).toContain("3 行");
  });

  it("VaTerminalLog：maxLines 环形裁剪 + 空态", async () => {
    const { html } = await ssr(VaTerminalLog, { lines: [], maxLines: 2 });
    expect(html).toContain("等待输出");
    const capped = await ssr(VaTerminalLog, {
      lines: ["a", "b", "c", "d"],
      maxLines: 2,
    });
    expect(capped.html).toContain("d");
    expect(capped.html).not.toContain(">a<");
  });

  it("VaCheckpointList：当前标记 + 摘要合成 + 空态", async () => {
    const { html } = await ssr(VaCheckpointList, {
      checkpoints: [
        { id: "2", label: "引入 AbortController", current: true, files: 3, additions: 12, deletions: 4, createdAt: Date.now() - 60_000 },
        { id: "1", label: "初始快照", createdAt: Date.now() - 3600_000 },
      ],
    });
    expect(html).toContain("当前");
    expect(html).toContain("3 个文件");
    expect(html).toContain("1 分钟前");
    expect(html).toContain("恢复");
    const empty = await ssr(VaCheckpointList, { checkpoints: [] });
    expect(empty.html).toContain("还没有检查点");
  });

  it("VaCommentThread：草稿操作条 + 头像首字母", async () => {
    const { html } = await ssr(VaCommentThread, {
      comments: [
        { id: "1", author: "Agent", role: "Agent", text: "要不要换成 React Query？", pending: true },
        { id: "2", author: "张北", role: "工程师", text: "可以，明天做" },
      ],
    });
    expect(html).toContain("以此发布");
    expect(html).toContain("让 agent 重写");
    expect(html).toContain(">A</span>"); // 首字母头像
    expect(html).toContain("va-cmt__composer"); // composer 默认开启（布尔 cast 回归锁定）
    expect(html).toContain("发布");
  });

  it("VaEmailDraft：受控字段渲染 + 语气 chips", async () => {
    const { html } = await ssr(VaEmailDraft, {
      to: "ops@x.com",
      subject: "审阅",
      body: "正文",
      tone: "formal",
      tones: [
        { value: "concise", label: "简洁" },
        { value: "formal", label: "正式" },
      ],
    });
    expect(html).toContain("ops@x.com");
    expect(html).toContain("aria-checked=\"true\""); // formal 选中
    expect(html).toContain("发送");
  });

  it("VaUsageMeter：堆叠段 + 图例 + 预警态", async () => {
    const ok = await ssr(VaUsageMeter, {
      segments: [
        { label: "Fast", used: 400 },
        { label: "Slow", used: 100 },
      ],
      limit: 1000,
      unit: "tokens",
    });
    expect(ok.html).toContain("500");
    expect(ok.html).toContain("40%");
    const warn = await ssr(VaUsageMeter, {
      segments: [{ label: "Fast", used: 850 }],
      limit: 1000,
    });
    expect(warn.html).toContain("接近本期限额");
    const over = await ssr(VaUsageMeter, {
      segments: [{ label: "Fast", used: 1200 }],
      limit: 1000,
    });
    expect(over.html).toContain("已超出限额");
  });

  it("VaCommandMenu：关闭态只渲染触发器（Teleport 不入流）", async () => {
    const { html } = await ssr(VaCommandMenu, {
      commands: [
        { id: "a", label: "运行测试", group: "常用" },
        { id: "b", label: "回滚", danger: true },
      ],
    });
    expect(html).toContain("aria-haspopup=\"dialog\"");
    expect(html).not.toContain("va-cmd__panel"); // 未打开不渲染面板
  });

  it("VaDropzone：文件列表 + 进度 + 错误态", async () => {
    const { html } = await ssr(VaDropzone, {
      files: [
        { id: "1", name: "report.pdf", size: 1024 * 512, progress: 42 },
        { id: "2", name: "big.zip", size: 1024 ** 3, status: "error", error: "超过 10MB" },
      ],
      multiple: true,
      maxSizeMb: 10,
    });
    expect(html).toContain("report.pdf");
    expect(html).toContain("42%");
    expect(html).toContain("512 KB");
    expect(html).toContain("超过 10MB");
    expect(html).toContain("≤ 10MB"); // hint
  });
});
