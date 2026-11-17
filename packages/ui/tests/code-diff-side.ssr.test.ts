/** VaCodeDiff 并排布局（layout="side"）SSR smoke：del/add 配对双列。 */
import { describe, expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import { VaCodeDiff } from "../src";

const OLD = "const a = 1;\nconst b = 2;\nconst keep = 3;\n";
const NEW = "const a = 1;\nconst b = 42;\nconst c = 4;\nconst keep = 3;\n";

describe("VaCodeDiff SSR · side", () => {
  it("side 布局渲染双列配对；unified 不渲染 side 容器", async () => {
    const warn: string[] = [];
    const html = await renderToString(
      createSSRApp({ render: () => h(VaCodeDiff, { oldText: OLD, newText: NEW, layout: "side", fileName: "x.ts" }) }),
    );
    expect(warn).toEqual([]);
    expect(html).toContain("va-cdiff__side");
    expect(html).toContain('data-type="pair"'); // b→c 配对
    expect(html).toContain("42"); // 新值在列
    expect(html).not.toContain("va-cdiff__expand"); // 并排无折叠

    const unified = await renderToString(
      createSSRApp({ render: () => h(VaCodeDiff, { oldText: OLD, newText: NEW }) }),
    );
    expect(unified).not.toContain("va-cdiff__side");
    expect(unified).toContain("va-cdiff__row"); // 统一行仍在
  });

  it("相同内容：side 也显示无变更", async () => {
    const html = await renderToString(
      createSSRApp({ render: () => h(VaCodeDiff, { oldText: "same", newText: "same", layout: "side" }) }),
    );
    expect(html).toContain("两个版本内容一致");
  });
});
