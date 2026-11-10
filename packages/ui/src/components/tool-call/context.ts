import type { InjectionKey } from "vue";
import type { ToolCallMeta } from "./types";

export type ToolCallGroupApi = {
  register: (get: () => ToolCallMeta) => void;
  unregister: (get: () => ToolCallMeta) => void;
};

export const TOOL_CALL_GROUP_KEY: InjectionKey<ToolCallGroupApi> = Symbol("va-tool-call-group");
