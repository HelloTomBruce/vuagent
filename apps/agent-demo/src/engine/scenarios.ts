/** 三个剧本 + 兜底话术（关键词路由见 useAgentEngine.matchScenario） */
import type { Scenario } from "./types";

const COMMON_DIFF = {
  file: "src/hooks/useUsers.ts",
  oldText: `export function useUsers() {
  const [users, setUsers] = useState([]);
  useEffect(() => {
    fetch("/api/users")
      .then((r) => r.json())
      .then(setUsers);
  }, []);
  return { users };
}`,
  newText: `export function useUsers(page = 1) {
  const [users, setUsers] = useState([]);
  useEffect(() => {
    const ac = new AbortController();
    fetch(\`/api/users?page=\${page}\`, { signal: ac.signal })
      .then((r) => r.json())
      .then(setUsers);
    return () => ac.abort();
  }, [page]);
  return { users };
}`,
} as const;

export const SCENARIOS: Scenario[] = [
  /* ---------- ① 周报生成：tools → 流式回答（引用）→ 建议 ---------- */
  {
    id: "weekly-report",
    keywords: ["周报", "总结", "weekly"],
    events: [
      { t: "thinking", label: "正在汇总本周提交与 PR…", ms: 1200 },
      {
        t: "tool",
        name: "read_commits",
        summary: "读取本周 47 个提交",
        ms: 1400,
        result: { count: 47, authors: ["zhangbei", "agent"], span: "11-04 ~ 11-10" },
      },
      {
        t: "tool",
        name: "stat_prs",
        summary: "统计 12 个 PR 的通过率",
        ms: 1100,
        result: { merged: 11, rejected: 1, avgReviewHours: 3.2 },
      },
      { t: "usage", segment: "Fast tokens", add: 42_000 },
      { t: "kpi", key: "runs", push: 3, bumpValue: 1287, delta: 0.13 },
      {
        t: "answer",
        text: "本周战报已生成[1]：47 个提交（agent 参与率 38%），12 个 PR 合并 11 个，平均审查时长 3.2 小时[2]。最显著的改进是用户列表页重构落地，失败率降至 2.1%。",
        sources: [
          { id: "s1", title: "本周提交记录 · git log 汇总", origin: "repo:vuagent" },
          { id: "s2", title: "PR 审查统计 · 11-04 起", origin: "repo:vuagent" },
        ],
      },
      {
        t: "recommend",
        title: "开启每周自动周报",
        description: "每周五 18:00 自动汇总并生成草稿，周一早上提醒你审阅后发送。",
        impact: "每周省 40 分钟",
      },
      { t: "notify", item: { title: "周报已生成", body: "可在对话中查看，或到洞察页看数据", kind: "agent" } },
    ],
  },

  /* ---------- ② 代码修改：plan → tools → 审批门 → diff/terminal/checkpoint ---------- */
  {
    id: "refactor-users",
    keywords: ["重构", "修改代码", "改代码", "修复", "refactor"],
    events: [
      { t: "thinking", label: "分析用户列表模块…", ms: 900 },
      {
        t: "plan",
        steps: [
          { id: "p1", title: "读取 useUsers.ts 与调用方" },
          { id: "p2", title: "加入分页参数与请求取消" },
          { id: "p3", title: "运行测试验证" },
        ],
      },
      { t: "tool", name: "read_file", summary: "读取 src/hooks/useUsers.ts", ms: 1000, result: { lines: 14, callers: 2 } },
      {
        t: "approval",
        title: "修改 src/hooks/useUsers.ts",
        preview: "useUsers(page = 1) + AbortController 取消\n+18 −6 行，影响 2 个调用方",
        risk: "medium",
        countdown: 30,
      },
      { t: "tool", name: "edit_file", summary: "写入分页与取消逻辑", ms: 1300, result: { additions: 18, deletions: 6 } },
      { t: "tree", changes: [
        { path: "src/hooks/useUsers.ts", status: "modified" },
        { path: "src/components/UserList.tsx", status: "modified" },
        { path: "src/hooks/useForm.ts", status: "added" },
        { path: "package.json", status: "modified" },
      ] },
      { t: "diff", file: COMMON_DIFF.file, oldText: COMMON_DIFF.oldText, newText: COMMON_DIFF.newText },
      { t: "terminal", lines: [
        { text: "pnpm test src/hooks", kind: "cmd" },
        "\u001b[32m✓ 18 passed\u001b[0m",
        { text: "\u001b[32m✓ done in 1.4s\u001b[0m", kind: "ok" },
      ] },
      { t: "tool", name: "run_tests", summary: "运行相关测试 18 个", ms: 1500, result: { passed: 18, failed: 0 } },
      { t: "checkpoint", label: "重构用户列表页", files: 4, additions: 24, deletions: 8 },
      {
        t: "summary",
        files: [
          { path: "src/hooks/useUsers.ts", status: "modified", additions: 18, deletions: 6 },
          { path: "src/components/UserList.tsx", status: "modified", additions: 4, deletions: 2 },
          { path: "src/hooks/useForm.ts", status: "added", additions: 22 },
          { path: "package.json", status: "modified", additions: 2 },
        ],
        durationMs: 46_200,
        toolCalls: 4,
      },
      { t: "usage", segment: "Slow tokens", add: 31_000 },
      { t: "kpi", key: "done", push: 2, bumpValue: 965 },
      {
        t: "answer",
        text: "重构完成[1]：分页 + 请求取消已落地，18 个测试全绿。已存检查点，可随时回滚。变更明细见「任务」页。",
        sources: [{ id: "s1", title: "测试报告 · vitest 18 passed", origin: "terminal" }],
      },
      { t: "notify", item: { title: "重构完成", body: "4 个文件 · +24 −8 · 检查点已存", kind: "success" } },
    ],
  },

  /* ---------- ③ 数据分析：tools → 图表更新 → 实验结论 ---------- */
  {
    id: "data-analysis",
    keywords: ["分析", "对比", "数据", "experiment"],
    events: [
      { t: "thinking", label: "拉取近 14 天任务数据…", ms: 1000 },
      { t: "tool", name: "query_metrics", summary: "查询任务完成率（分提示词版本）", ms: 1400, result: { rows: 1864, groupBy: "prompt_version" } },
      { t: "usage", segment: "Fast tokens", add: 28_000 },
      { t: "kpi", key: "runs", push: 5, bumpValue: 1289 },
      {
        t: "experiment",
        title: "系统提示词 v2 实验",
        confidence: 0.97,
        a: { value: 0.62 },
        b: { value: 0.71, delta: 0.145 },
      },
      { t: "kpi", key: "done", push: 4, bumpValue: 968, delta: 0.09 },
      {
        t: "answer",
        text: "对比结论[1]：v2 提示词的任务完成率 71%，比 v1 高 14.5 个百分点（置信度 97%）。建议全量切换——已把实验卡与图表更新到「洞察」页。",
        sources: [{ id: "s1", title: "14 天任务数据 · 1864 条", origin: "metrics" }],
      },
      { t: "notify", item: { title: "实验结论：v2 胜出", body: "完成率 +14.5pp，置信度 97%", kind: "agent" } },
    ],
  },
];

/** 未命中任何剧本的兜底 */
export const FALLBACK_SCENARIO: Scenario = {
  id: "fallback",
  keywords: [],
  events: [
    { t: "thinking", label: "思考中…", ms: 800 },
    {
      t: "stream",
      text: "这个 demo 有三个剧本可演示：发「生成周报」「重构用户列表页」或「分析任务数据」试试；也可以在设置页连接集成、管理订阅。",
      cps: 46,
    },
  ],
};
