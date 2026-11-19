/**
 * @vuagent/protocol
 * 系统工具入参 Schema（TASK-055 工具契约收口）：
 * fs/bash/search/web 内置工具的 TypeBox 规范从 server tools/*.ts 收口至本包——
 * 兼做大模型 Tool Parameters 与 ToolRegistry 执行前运行时校验的单一事实来源。
 *
 * 与 tools.ts 的 ui_* 工具规范分表：VuagentToolName（ui 子集）保持「UI 组件名」
 * 语义不被系统工具名污染；全量工具聚合见 AllToolSchemas / VuagentAllToolName。
 */

import { Type, type Static } from "@sinclair/typebox";

// ==========================================
// 1. fs_read
// ==========================================
export const FsReadParamsSchema = Type.Object(
  {
    filePath: Type.String({ description: "工作区相对路径或文件名" }),
    offset: Type.Optional(
      Type.Number({ description: "1-based 起始行号；缺省从第 1 行读全量" })
    ),
    limit: Type.Optional(
      Type.Number({ description: "最多读取行数（仅 offset 给出时生效，缺省 2000）" })
    ),
  },
  { $id: "fs_read" }
);

export type FsReadParams = Static<typeof FsReadParamsSchema>;

// ==========================================
// 2. fs_write
// ==========================================
export const FsWriteParamsSchema = Type.Object(
  {
    filePath: Type.String({ description: "工作区相对路径或文件名" }),
    content: Type.String({ description: "要写入的文件完整文本内容" }),
  },
  { $id: "fs_write" }
);

export type FsWriteParams = Static<typeof FsWriteParamsSchema>;

// ==========================================
// 3. fs_edit
// ==========================================
export const FsEditParamsSchema = Type.Object(
  {
    filePath: Type.String({ description: "工作区相对路径（文件必须已存在）" }),
    oldString: Type.String({ description: "要替换的精确原文（字面文本，含缩进换行）" }),
    newString: Type.String({ description: "替换后的文本" }),
    replaceAll: Type.Optional(
      Type.Boolean({ description: "oldString 多次出现时是否全部替换；默认 false（仅唯一匹配可替换）" })
    ),
  },
  { $id: "fs_edit" }
);

export type FsEditParams = Static<typeof FsEditParamsSchema>;

// ==========================================
// 4. bash_run
// ==========================================
export const BashRunParamsSchema = Type.Object(
  {
    command: Type.String({ description: "要执行的 Shell 命令（可用 &&、;、管道组合）" }),
    timeoutMs: Type.Optional(Type.Number({ description: "执行超时毫秒数，默认 30000；超时进程被杀死" })),
  },
  { $id: "bash_run" }
);

export type BashRunParams = Static<typeof BashRunParamsSchema>;

// ==========================================
// 5. glob（文件模式搜索）
// ==========================================
export const GlobParamsSchema = Type.Object(
  {
    pattern: Type.String({ description: "glob 模式，相对工作区根，如 src/**/*.ts" }),
  },
  { $id: "glob" }
);

export type GlobParams = Static<typeof GlobParamsSchema>;

// ==========================================
// 6. grep（内容搜索）
// ==========================================
export const GrepParamsSchema = Type.Object(
  {
    pattern: Type.String({ description: "正则表达式源（不带分隔符），如 function\\s+\\w+" }),
    flags: Type.Optional(Type.String({ description: "正则 flags，如 'i' 忽略大小写；g 自动附加" })),
    include: Type.Optional(Type.String({ description: "文件名 glob 过滤，如 *.ts" })),
  },
  { $id: "grep" }
);

export type GrepParams = Static<typeof GrepParamsSchema>;

// ==========================================
// 7. web_fetch
// ==========================================
export const WebFetchParamsSchema = Type.Object(
  {
    url: Type.String({ description: "要抓取的完整 http(s) URL（含协议）" }),
  },
  { $id: "web_fetch" }
);

export type WebFetchParams = Static<typeof WebFetchParamsSchema>;

// ==========================================
// 系统工具 Schema 汇总表
// ==========================================
export const VuagentSystemToolSchemas = {
  fs_read: FsReadParamsSchema,
  fs_write: FsWriteParamsSchema,
  fs_edit: FsEditParamsSchema,
  bash_run: BashRunParamsSchema,
  glob: GlobParamsSchema,
  grep: GrepParamsSchema,
  web_fetch: WebFetchParamsSchema,
} as const;

export type VuagentSystemToolName = keyof typeof VuagentSystemToolSchemas;
