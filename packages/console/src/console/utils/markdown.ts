/**
 * Markdown 渲染（TASK-004）
 * html:false —— 模型输出的原始 HTML 一律转义，杜绝注入
 * linkify/breaks 提升对话可读性；流式半截语法（未闭合 ** 等）由 markdown-it 容错为字面文本
 *
 * 流式渲染缓存（createCachedBlockRenderer）：
 * 流式期间 turn 只有最后一个 text 块在增长，前面的块内容稳定。
 * 模板里若直接 renderMarkdown(block.content)，每个 text_delta 都会对
 * 累积全文重新解析 + innerHTML 整树替换，内容越长主线程越卡（滚动掉帧）。
 * 以块对象为键做 WeakMap 缓存：内容未变的块直接复用上次的 HTML
 * （v-html 值不变时 Vue 会跳过 DOM 写入），每帧只重渲染尾块。
 */
import MarkdownIt from "markdown-it";
import type { TurnBlock } from "../types";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

export function renderMarkdown(source: string): string {
  return md.render(source || "");
}

/**
 * 创建一个带缓存的块渲染器（每个 AssistantTurn 组件实例持有一个）。
 * 键为 block 对象引用：reducer 对尾块原地 += 文本，引用不变但内容变了 → 重渲染；
 * 前面的块引用与内容都不变 → 命中缓存，零解析零 DOM 写入。
 * WeakMap 键随 turn 对象回收，无内存泄漏。
 */
export function createCachedBlockRenderer(
  render: (source: string) => string = renderMarkdown
): (block: TurnBlock) => string {
  const cache = new WeakMap<TurnBlock, { source: string; html: string }>();
  return (block: TurnBlock): string => {
    if (block.kind !== "text" || !block.content) return "";
    const hit = cache.get(block);
    if (hit && hit.source === block.content) return hit.html;
    const html = render(block.content);
    cache.set(block, { source: block.content, html });
    return html;
  };
}
