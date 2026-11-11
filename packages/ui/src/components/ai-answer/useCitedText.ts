import { computed, h, type VNode } from "vue";

/**
 * 回答正文解析：把 [1] / [2] 引用标记替换为可点击上标角标 VNode。
 * 角标序号即 sources 下标 + 1；无对应来源的标记按原文保留。
 */
export function useCitedText(
  getText: () => string,
  getSources: () => Array<{ id: string }>,
  onCite: (index: number) => void,
) {
  const nodes = computed<VNode[]>(() => {
    const text = getText();
    const sources = getSources();
    const out: VNode[] = [];
    const re = /\[(\d+)\]/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push(m[0] ? h("span", text.slice(last, m.index)) : h("span"));
      const idx = Number(m[1]) - 1;
      if (sources[idx]) {
        out.push(
          h(
            "button",
            {
              class: "va-ans__cite",
              type: "button",
              "aria-label": `查看来源 ${m[1]}`,
              onClick: () => onCite(idx),
            },
            m[1],
          ),
        );
      } else {
        out.push(h("span", m[0])); // 无对应来源：原样保留
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(h("span", text.slice(last)));
    return out;
  });

  return { nodes };
}
