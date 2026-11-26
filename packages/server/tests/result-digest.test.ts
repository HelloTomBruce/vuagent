/**
 * TASK-089（实施方案 TASK-B）：result-digest 语义摘要生成器测试。
 * 设计文档 docs/design/ui-llm-interaction-contract.md §4.1 规则表逐行覆盖：
 * string/number（含 unit）/ boolean 是否 / enum label 回映 / 未填标注 /
 * editedFields 尾句 / cancel·timeout 形态 / secret 内置打码 / 截断（字段 ≤500、附录 ≤4KB）。
 */
import { describe, it, expect } from "vitest";
import { Type } from "@sinclair/typebox";
import {
  digestSubmit,
  digestCancel,
  digestTimeout,
  digestApprovalDecision,
  digestApprovalGranted,
  buildResultAppendix,
  buildDualLayerContent,
  buildInteractionResultContent,
  maskSecretValue,
} from "../src/core/result-digest.js";
import {
  DIGEST_MAX_APPENDIX_CHARS,
  DIGEST_MAX_FIELD_CHARS,
} from "../src/core/action-envelope.js";

/** §7 风格「创建部署」表单的派生 resultSchema（含全部规则表题型） */
const DeployResultSchema = Type.Object({
  env: Type.String({ description: "部署环境" }),
  replicas: Type.Number({ description: "副本数", unit: "个" } as never),
  enableTls: Type.Boolean({ description: "开启 TLS" }),
  size: Type.Union(
    [
      Type.Literal("s", { description: "小（2C4G）" }),
      Type.Literal("m", { description: "中（4C8G）" }),
      Type.Literal("l", { description: "大（8C16G）" }),
    ],
    { description: "规格" }
  ),
  remark: Type.Optional(Type.String({ description: "备注" })),
  accessToken: Type.Optional(
    Type.String({ description: "访问令牌", secret: true } as never)
  ),
});

describe("digestSubmit：§4.1 规则表逐行", () => {
  it("string / number（含 unit）按 description 词汇表输出", () => {
    const digest = digestSubmit({
      title: "创建部署",
      values: { env: "production", replicas: 3 },
      resultSchema: DeployResultSchema,
    });
    expect(digest).toContain("- 部署环境: production");
    expect(digest).toContain("- 副本数: 3 个");
  });

  it("boolean 渲染为 是 / 否", () => {
    const digest = digestSubmit({
      title: "创建部署",
      values: { enableTls: true },
      resultSchema: DeployResultSchema,
    });
    expect(digest).toContain("- 开启 TLS: 是");
    const digestNo = digestSubmit({
      title: "创建部署",
      values: { enableTls: false },
      resultSchema: DeployResultSchema,
    });
    expect(digestNo).toContain("- 开启 TLS: 否");
  });

  it("enum 值回映到 option 的 label（不回显机器值）", () => {
    const digest = digestSubmit({
      title: "创建部署",
      values: { size: "l" },
      resultSchema: DeployResultSchema,
    });
    expect(digest).toContain("- 规格: 大（8C16G）");
    expect(digest).not.toContain("- 规格: l");
  });

  it("缺省未填显式标注（undefined / null / 空串同口径）", () => {
    for (const value of [undefined, null, ""]) {
      const digest = digestSubmit({
        title: "创建部署",
        values: { remark: value },
        resultSchema: DeployResultSchema,
      });
      expect(digest).toContain("- 备注: （用户未填写）");
    }
  });

  it("editedFields 尾句：区分「用户亲自修改」与「默认值透传」", () => {
    const digest = digestSubmit({
      title: "创建部署",
      values: { env: "production", replicas: 3, remark: "x" },
      resultSchema: DeployResultSchema,
      editedFields: ["replicas"],
    });
    expect(digest).toContain("其中「副本数」为用户亲自修改，其余沿用了你提供的默认值。");

    const untouched = digestSubmit({
      title: "创建部署",
      values: { env: "production" },
      resultSchema: DeployResultSchema,
      editedFields: [],
    });
    expect(untouched).toContain("用户未修改任何预填值，直接确认提交（所有字段均为默认值透传）。");

    const noMeta = digestSubmit({
      title: "创建部署",
      values: { env: "production" },
      resultSchema: DeployResultSchema,
    });
    expect(noMeta).not.toContain("默认值");
  });

  it("完整摘要模板快照（§4.1 示例形态）", () => {
    const digest = digestSubmit({
      title: "创建部署",
      values: { env: "production", replicas: 3, enableTls: true, size: "l" },
      resultSchema: DeployResultSchema,
      editedFields: ["replicas"],
    });
    expect(digest).toMatchSnapshot();
  });

  it("Schema 之外的额外键按原样 key 输出（非严格 Schema 容忍值不丢失）", () => {
    const digest = digestSubmit({
      title: "创建部署",
      values: { env: "production", extraField: "额外" },
      resultSchema: DeployResultSchema,
    });
    expect(digest).toContain("- extraField: 额外");
  });

  it("无 resultSchema 时以 values 键为词汇表（L1 兼容形态）", () => {
    const digest = digestSubmit({
      title: "审批",
      values: { approved: true, note: "LGTM" },
    });
    expect(digest).toContain("- approved: 是");
    expect(digest).toContain("- note: LGTM");
  });

  it("空 values 输出占位行", () => {
    const digest = digestSubmit({ title: "创建部署", values: {} });
    expect(digest).toContain("（用户未提交任何字段）");
  });
});

describe("digestSubmit：数组与嵌套（短则内联，长/深折叠计数）", () => {
  it("标量数组短则顿号内联", () => {
    const digest = digestSubmit({
      title: "t",
      values: { deps: ["a", "b", "c"] },
    });
    expect(digest).toContain("- deps: a、b、c");
  });

  it("长数组折叠为「N 项（详见附录）」", () => {
    const digest = digestSubmit({
      title: "t",
      values: { deps: Array.from({ length: 30 }, (_, i) => `dep-${i}`) },
    });
    expect(digest).toContain("- deps: 30 项（详见附录）");
  });

  it("非标量数组折叠计数", () => {
    const digest = digestSubmit({
      title: "t",
      values: { steps: [{ id: "1" }, { id: "2" }] },
    });
    expect(digest).toContain("- steps: 2 项（详见附录）");
  });

  it("嵌套对象短则紧凑内联、长则折叠为字段计数", () => {
    const inline = digestSubmit({
      title: "t",
      values: { meta: { a: 1 } },
    });
    expect(inline).toContain('- meta: {"a":1}');

    const folded = digestSubmit({
      title: "t",
      values: { meta: { longKey: "x".repeat(200), b: 2 } },
    });
    expect(folded).toContain("- meta: 2 个字段（详见附录）");
  });
});

describe("secret 打码：摘要与附录都不进明文（内置，不依赖调用方自觉）", () => {
  it("maskSecretValue：长串保留前 3 字符，短串/非标量全码", () => {
    expect(maskSecretValue("sk-abcdef123456")).toBe("sk-…****");
    expect(maskSecretValue("abc")).toBe("****");
    expect(maskSecretValue(12345)).toBe("****");
  });

  it("摘要中 secret 字段输出「已提供（masked）」，明文不出现", () => {
    const digest = digestSubmit({
      title: "创建部署",
      values: { accessToken: "sk-live-abcdef1234567890" },
      resultSchema: DeployResultSchema,
    });
    expect(digest).toContain("- 访问令牌: 已提供（sk-…****）");
    expect(digest).not.toContain("sk-live-abcdef1234567890");
  });

  it("secret 未填写时仍按未填标注（不误报已提供）", () => {
    const digest = digestSubmit({
      title: "创建部署",
      values: {},
      resultSchema: DeployResultSchema,
    });
    expect(digest).toContain("- 访问令牌: （用户未填写）");
  });

  it("附录中 secret 值被 masked 替换（含嵌套）", () => {
    const appendix = buildResultAppendix(
      { accessToken: "sk-live-abcdef1234567890", nested: { accessToken: "sk-nested-xyz" } },
      Type.Object({
        accessToken: Type.String({ secret: true } as never),
        nested: Type.Object({
          accessToken: Type.String({ secret: true } as never),
        }),
      })
    );
    expect(appendix).toContain("sk-…****");
    expect(appendix).not.toContain("sk-live-abcdef1234567890");
    expect(appendix).not.toContain("sk-nested-xyz");
  });
});

describe("截断（§8 注入面/上下文膨胀防线）", () => {
  it(`单字段渲染值超过 ${DIGEST_MAX_FIELD_CHARS} 字符折叠为 …[+N 字符]`, () => {
    const long = "a".repeat(DIGEST_MAX_FIELD_CHARS + 120);
    const digest = digestSubmit({
      title: "t",
      values: { note: long },
    });
    expect(digest).toContain(`- note: ${"a".repeat(DIGEST_MAX_FIELD_CHARS)}…[+120 字符]`);
    expect(digest).not.toContain(long);
  });

  it(`附录 JSON 超过 ${DIGEST_MAX_APPENDIX_CHARS} 字符整体折叠为说明行`, () => {
    const values = { blob: "x".repeat(DIGEST_MAX_APPENDIX_CHARS) };
    const appendix = buildResultAppendix(values);
    expect(appendix).toContain("已按契约折叠");
    expect(appendix).toContain("共 1 个字段");
    expect(appendix).not.toContain("```json");
  });
});

describe("cancel / timeout 摘要形态", () => {
  it("cancel：取消是一等公民而非错误", () => {
    const digest = digestCancel({ title: "创建部署", reason: "先不部署了" });
    expect(digest).toMatchSnapshot();
    expect(digest).toContain("取消了本次交互（原因：先不部署了）");
    expect(digest).toContain("非系统错误");
  });

  it("cancel 无原因时省略原因括注", () => {
    const digest = digestCancel({ title: "创建部署" });
    expect(digest).toContain("取消了本次交互。");
    expect(digest).not.toContain("原因");
  });

  it("timeout：deny / cancel 两种语义归属", () => {
    const deny = digestTimeout({ title: "执行「bash_run」的审批", meaning: "deny", timeoutMs: 180_000 });
    expect(deny).toContain("按「拒绝」处理");
    expect(deny).toContain("约 180 秒");

    const cancel = digestTimeout({ title: "创建部署", meaning: "cancel" });
    expect(cancel).toContain("按「用户放弃」处理");
    expect(cancel).not.toContain("约 ");
  });
});

describe("L1 审批决策摘要（驳回从 Error 迁移为信封摘要）", () => {
  it("批准（granted）", () => {
    expect(
      digestApprovalGranted({ toolName: "bash_run", note: "上线窗口内，放行" })
    ).toBe("用户在审批中批准了「bash_run」的执行请求（备注：上线窗口内，放行）。");
    expect(digestApprovalGranted({ toolName: "bash_run" })).toBe(
      "用户在审批中批准了「bash_run」的执行请求。"
    );
  });

  it("人工驳回：不再携带 Error 语义", () => {
    const digest = digestApprovalDecision({
      toolName: "bash_run",
      reason: "manual",
      note: "不允许执行该命令",
    });
    expect(digest).toBe(
      "用户驳回了「bash_run」的执行请求（原因：不允许执行该命令）。" +
        "这是用户的明确决定而非系统错误——不要换汤不换药地重试同一操作；" +
        "如需继续，请改用其他方案或与用户确认。"
    );
  });

  it("cancel 信封：关闭审批界面 ≠ 拒绝 ≠ 批准", () => {
    const digest = digestApprovalDecision({
      toolName: "ui_approval_card",
      envelope: { kind: "cancel", reason: "稍后处理" },
    });
    expect(digest).toContain("取消了对「ui_approval_card」的决策（关闭了审批界面）（原因：稍后处理）");
    expect(digest).toContain("不代表批准");
  });

  it("timeout：按驳回处理的超时形态", () => {
    const digest = digestApprovalDecision({
      toolName: "bash_run",
      reason: "timeout",
      timeoutMs: 180_000,
    });
    expect(digest).toContain("等待用户响应超时");
    expect(digest).toContain("按「拒绝」处理");
    expect(digest).toContain("不是系统错误");
  });

  it("aborted：中止形态", () => {
    const digest = digestApprovalDecision({
      toolName: "bash_run",
      reason: "aborted",
      note: "用户中止了会话",
    });
    expect(digest).toContain("审批已被中止（用户中止了会话）");
  });

  it("旧形态无 reason 的驳回按人工驳回处理", () => {
    const digest = digestApprovalDecision({ toolName: "fs_write" });
    expect(digest).toContain("用户驳回了「fs_write」的执行请求。");
  });
});

describe("双层 content 组装（摘要供理解、附录供引用，两者同源）", () => {
  it("buildDualLayerContent：摘要 + 空行 + json 附录", () => {
    const content = buildDualLayerContent("摘要行", "```json\n{}\n```");
    expect(content).toBe("摘要行\n\n```json\n{}\n```");
  });

  it("buildResultAppendix：标准 ```json 围栏形态", () => {
    const appendix = buildResultAppendix({ env: "production", replicas: 3 });
    expect(appendix).toBe('```json\n{\n  "env": "production",\n  "replicas": 3\n}\n```');
  });

  it("buildInteractionResultContent：submit → 摘要 + 附录双层快照", () => {
    const content = buildInteractionResultContent({
      title: "创建部署",
      envelope: {
        kind: "submit",
        values: { env: "production", replicas: 3, enableTls: true, size: "l" },
        meta: { editedFields: ["replicas"] },
      },
      interaction: { level: "L2", resultSchema: DeployResultSchema },
    });
    expect(content).toMatchSnapshot();
    expect(content).toContain("```json");
    expect(content.indexOf("```json")).toBeGreaterThan(content.indexOf("用户在「创建部署」"));
  });

  it("buildInteractionResultContent：cancel → 只有摘要（cancel 语义不读取 values）", () => {
    const content = buildInteractionResultContent({
      title: "创建部署",
      envelope: { kind: "cancel", reason: "不需要了" },
      interaction: { level: "L2", resultSchema: DeployResultSchema },
    });
    expect(content).toContain("取消了本次交互");
    expect(content).not.toContain("```json");
  });

  it("buildInteractionResultContent：patch（L3 预留）不产生 content", () => {
    const content = buildInteractionResultContent({
      title: "创建部署",
      envelope: { kind: "patch", values: { env: "x" } },
      interaction: { level: "L3", resultSchema: DeployResultSchema },
    });
    expect(content).toBe("");
  });
});
