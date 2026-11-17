/**
 * Markdown 渲染（TASK-004）
 * html:false —— 模型输出的原始 HTML 一律转义，杜绝注入
 * linkify/breaks 提升对话可读性；流式半截语法（未闭合 ** 等）由 markdown-it 容错为字面文本
 */
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

export function renderMarkdown(source: string): string {
  return md.render(source || "");
}
