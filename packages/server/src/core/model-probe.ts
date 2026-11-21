/**
 * 模型列表能力探测（从 provider 的 GET /models 响应中提取能力元数据）
 *
 * 背景：不同供应商的模型列表接口信息量差异极大——
 *   · 智谱 / OpenAI 标准格式：只有 { id, object, created, owned_by }，没有任何能力信息
 *   · Moonshot / Kimi 扩展：带 supports_reasoning / modalities / think_efforts / limit.context
 *   · OpenRouter：带 context_length / architecture.input_modalities / supported_parameters / reasoning
 *   · models.dev 格式：带 reasoning_options / modalities / limit / tool_call
 *   · Ollama：details.{family,parameter_size,quantization}
 *
 * 本模块把这些方言统一映射成 ModelCapabilities，取不到就留空，
 * 由 source 字段标明「探测得到」还是「用户声明」，避免把猜测当事实。
 *
 * 设计原则：**保守**。只在字段语义明确时才写入，绝不根据模型名猜能力
 *（模型名猜不出来是否支持视觉，猜错会让用户传图后收到 400）。
 */
import type { InputModality, ModelCapabilities } from "../storage/interfaces.js";

export interface DetectedModel {
  id: string;
  /** 供应商给的友好名（如 Kimi 的 display_name），没有则缺省 */
  displayName?: string;
  /** 探测到的能力；完全没有能力信息时不返回该字段 */
  capabilities?: ModelCapabilities;
}

/** 供应商原始条目——用宽松索引签名容纳各地方言 */
type RawModel = Record<string, unknown>;

function num(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function strArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((x) => String(x)).filter((x) => x.length > 0);
  return out.length > 0 ? out : undefined;
}

function obj(v: unknown): RawModel | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as RawModel) : undefined;
}

/** 归一化模态名（各家的写法略有差异） */
function normalizeModalities(list: string[] | undefined): InputModality[] | undefined {
  if (!list) return undefined;
  const out = new Set<InputModality>();
  for (const raw of list) {
    const m = raw.toLowerCase().trim();
    if (m === "text") out.add("text");
    else if (m === "image" || m === "img" || m === "vision") out.add("image");
    else if (m === "audio") out.add("audio");
    else if (m === "video") out.add("video");
    else if (m === "pdf" || m === "file" || m === "document") out.add("pdf");
  }
  if (out.size === 0) return undefined;
  out.add("text"); // 对话模型文本恒可用
  return Array.from(out);
}


/** 合并模态集合（保持 InputModality 类型） */
function mergeModalities(base: InputModality[] | undefined, ...add: InputModality[]): InputModality[] {
  const set = new Set<InputModality>(base ?? ["text"]);
  for (const m of add) set.add(m);
  set.add("text");
  return Array.from(set);
}

/**
 * 把单个原始模型条目探测成 DetectedModel。
 * 字段探测顺序：OpenAI 标准 → Kimi 扩展 → OpenRouter → models.dev → Ollama
 */
export function detectModel(raw: RawModel): DetectedModel | null {
  const id = str(raw.id) ?? str(raw.model) ?? str(raw.name);
  if (!id) return null;

  const displayName = str(raw.display_name) ?? str(raw.displayName) ?? str(raw.name);

  const cap: ModelCapabilities = {};

  /* ---------- 上下文窗口 ---------- */
  const limit = obj(raw.limit);
  cap.contextWindow =
    num(raw.context_length) ??
    num(raw.contextWindow) ??
    num(raw.max_input_tokens) ??
    num(limit?.context) ??
    num(limit?.input);

  /* ---------- 最大输出 ---------- */
  const topProvider = obj(raw.top_provider);
  cap.maxOutputTokens =
    num(raw.max_output_tokens) ??
    num(topProvider?.max_completion_tokens) ??
    num(limit?.output);

  /* ---------- 输入模态 ---------- */
  const modalities = obj(raw.modalities);
  const architecture = obj(raw.architecture);
  const modalityList =
    strArray(modalities?.input) ??
    strArray(architecture?.input_modalities) ??
    strArray(raw.input_modalities);
  let inputModalities = normalizeModalities(modalityList);

  // Kimi 风格的布尔位：逐个合并
  const flagToModality: Array<[string, InputModality]> = [
    ["supports_image_in", "image"],
    ["supports_vision", "image"],
    ["supports_video_in", "video"],
    ["supports_audio_in", "audio"],
    ["supports_pdf_in", "pdf"],
  ];
  for (const [flag, mod] of flagToModality) {
    if (raw[flag] === true) {
      inputModalities = mergeModalities(inputModalities, mod);
    }
  }
  if (raw.attachment === true) {
    inputModalities = mergeModalities(inputModalities, "image");
  }
  cap.inputModalities = inputModalities;

  /* ---------- 推理能力（三段式） ---------- */
  const reasoningRaw = raw.reasoning;
  const thinkEfforts = obj(raw.think_efforts);
  const reasoningObj = obj(reasoningRaw);

  let supported: boolean | undefined;
  if (typeof raw.supports_reasoning === "boolean") supported = raw.supports_reasoning;
  else if (typeof reasoningRaw === "boolean") supported = reasoningRaw;
  else if (typeof raw.reasoning === "object" && raw.reasoning !== null) supported = true;
  else if (typeof raw.supports_thinking_type === "string") supported = true;

  if (supported !== undefined) {
    const efforts =
      strArray(reasoningObj?.supported_efforts) ??
      strArray(thinkEfforts?.valid_efforts) ??
      strArray(obj(reasoningObj?.effort)?.valid) ??
      strArray(raw.reasoning_efforts) ??
      // models.dev: reasoning_options: [{type:"effort", values:[...]}]
      (Array.isArray(raw.reasoning_options)
        ? strArray(
            (raw.reasoning_options as RawModel[]).find(
              (o) => obj(o)?.type === "effort"
            )?.values
          )
        : undefined);

    const defaultEffort =
      str(reasoningObj?.default_effort) ??
      str(thinkEfforts?.default_effort) ??
      str(obj(reasoningObj?.effort)?.default) ??
      str(raw.default_reasoning_effort);

    cap.reasoning = {
      supported,
      ...(efforts ? { supportedEfforts: efforts } : {}),
      ...(defaultEffort ? { defaultEffort } : {}),
    };
  }

  /* ---------- 支持的请求参数 ---------- */
  const params = new Set<string>();
  const declared = strArray(raw.supported_parameters);
  if (declared) for (const p of declared) params.add(p);
  // OpenRouter 把 tools 放在 supported_parameters；Kimi 用布尔位
  if (raw.supports_dynamic_tools === true || obj(raw.tools)?.dynamic_load === true) params.add("tools");
  if (raw.tool_call === true) params.add("tools");
  if (typeof raw.temperature === "boolean" && raw.temperature === false) {
    params.delete("temperature"); // models.dev 用 temperature:false 表示不支持采样
  } else if (typeof raw.temperature === "boolean" && raw.temperature === true) {
    params.add("temperature");
  }
  if (cap.reasoning?.supported) params.add("reasoning");
  if (params.size > 0) cap.supportedParameters = [...params];

  /* ---------- 来源标记 ---------- */
  const hasAny = Object.values(cap).some((v) => v !== undefined);
  if (!hasAny) return { id, displayName };

  cap.source = "detected";
  return { id, displayName, capabilities: cap };
}

/** 批量探测；兼容 data[]（OpenAI 系）与 models[]（Ollama 系）两种外壳 */
export function detectModels(json: unknown): DetectedModel[] {
  const shell = obj(json);
  if (!shell) return [];
  const rows = Array.isArray(shell.data)
    ? (shell.data as RawModel[])
    : Array.isArray(shell.models)
    ? (shell.models as RawModel[])
    : [];
  const out: DetectedModel[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    const item = detectModel(obj(raw) ?? {});
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
