// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import VaMarkdown from "../src/components/markdown/VaMarkdown.vue";

describe("VaMarkdown", () => {
  it("渲染加粗、行内代码与段落", () => {
    const wrapper = mount(VaMarkdown, {
      props: {
        content: "这是一段 **加粗文字** 和 `const a = 1;` 行内代码",
      },
    });

    expect(wrapper.find("strong").text()).toBe("加粗文字");
    expect(wrapper.find("code").text()).toBe("const a = 1;");
  });

  it("渲染列表与标题", () => {
    const wrapper = mount(VaMarkdown, {
      props: {
        content: "## 服务监控清单\n- 实例 1\n- 实例 2",
      },
    });

    expect(wrapper.find("h2").text()).toBe("服务监控清单");
    const lis = wrapper.findAll("li");
    expect(lis.length).toBe(2);
    expect(lis[0].text()).toBe("实例 1");
  });

  it("渲染表格与代码块", () => {
    const tableMd = `| 服务 | 状态 |
| --- | --- |
| Redis | 正常 |

\`\`\`bash
kubectl get pods
\`\`\``;
    const wrapper = mount(VaMarkdown, {
      props: {
        content: tableMd,
      },
    });

    expect(wrapper.find("table").exists()).toBe(true);
    expect(wrapper.find("th").text()).toBe("服务");
    expect(wrapper.find("pre code").text()).toContain("kubectl get pods");
  });

  it("支持流式状态光标", () => {
    const wrapper = mount(VaMarkdown, {
      props: {
        content: "思考中",
        streaming: true,
      },
    });

    expect(wrapper.find(".va-md__caret").exists()).toBe(true);
  });

  it("默认开启 XSS 转义防御 (html: false)", () => {
    const wrapper = mount(VaMarkdown, {
      props: {
        content: `<script>alert("xss")</script><img src="x" onerror="alert(1)">`,
      },
    });

    expect(wrapper.find("script").exists()).toBe(false);
    expect(wrapper.html()).toContain("&lt;script&gt;");
  });
});
