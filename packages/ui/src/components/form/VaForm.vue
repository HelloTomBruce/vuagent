<script setup lang="ts">
import { ref, watch } from "vue";
import { VaButton } from "../button";
import { VaSelect } from "../select";
import type { FormFieldItem, VaFormProps } from "./types";

const props = withDefaults(defineProps<VaFormProps>(), {
  title: undefined,
  description: undefined,
  submitLabel: "提交",
  cancelLabel: "取消",
  disabled: false,
  loading: false,
  fieldErrors: undefined,
});

const emit = defineEmits<{
  (e: "submit", values: Record<string, unknown>, editedFields: string[]): void;
  (e: "cancel"): void;
}>();

/** 类型化初值：default 优先，按字段类型兜底（args 为不可信输入，default 需类型核验） */
function typedInitial(field: FormFieldItem): unknown {
  const d = field.default;
  switch (field.type) {
    case "number":
      return typeof d === "number" && Number.isFinite(d) ? d : undefined;
    case "boolean":
      return typeof d === "boolean" ? d : false;
    case "select":
      return typeof d === "string" ? d : "";
    default:
      // text / textarea / date：字符串类，default 允许 string，其余不透传脏值
      return typeof d === "string" ? d : "";
  }
}

const values = ref<Record<string, unknown>>({});
const editedKeys = ref<Record<string, true>>({});
/** 用户提交后的本地校验错误（required/类型收敛）；server fieldErrors 走 props */
const localErrors = ref<Record<string, string>>({});
/** 用户在提交后修改过的字段：其 server 错误视为已过期，就地隐藏 */
const editedSinceSubmit = ref<Record<string, true>>({});

const reset = () => {
  const next: Record<string, unknown> = {};
  // 保留键防御（评审 N-12）：字段 key 来自模型 args，过滤原型污染键
  const safe = props.fields.filter((f) => !/^(?:__proto__|constructor|prototype)$/.test(f.key));
  for (const field of safe) next[field.key] = typedInitial(field);
  values.value = next;
  editedKeys.value = {};
  localErrors.value = {};
  editedSinceSubmit.value = {};
};

// 按字段集**结构签名**监听（评审 C-2 修复）：propAdapter 每次 recompute 产出新数组
// 引用（如 422 回填 formFieldErrors 触发 computed 重算），按引用比较会 reset() 清空
// 用户全部已填值——击穿 §4.2「校验失败是重填的新输入」承诺。仅当字段集真正变化
// （key+type 序列化）才重置。
const fieldsSignature = () => props.fields.map((f) => `${f.key}:${f.type}`).join("|");
watch(fieldsSignature, reset, { immediate: true });

const markEdited = (key: string) => {
  editedKeys.value[key] = true;
  editedSinceSubmit.value[key] = true;
  if (localErrors.value[key]) {
    const { [key]: _dropped, ...rest } = localErrors.value;
    localErrors.value = rest;
  }
};

/** 展示错误优先级：本地即时校验 > server 回填（用户已改过的 server 错误就地隐藏） */
const errorOf = (key: string): string | undefined => {
  if (localErrors.value[key]) return localErrors.value[key];
  if (editedSinceSubmit.value[key]) return undefined;
  return props.fieldErrors?.[key];
};

const secretVisible = ref<Record<string, boolean>>({});
const inputTypeOf = (field: FormFieldItem): string => {
  if (field.type === "number") return "number";
  if (field.type === "date") return "date";
  if (field.secret) return secretVisible.value[field.key] ? "text" : "password";
  return "text";
};

const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/** 提交前类型收敛 + required 校验（UX 层；权威校验在 server 边界，设计文档 §8） */
const converge = (): { values: Record<string, unknown>; errors: Record<string, string> } => {
  const out: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const field of props.fields) {
    // 保留键防御（与 reset 同口径）
    if (/^(?:__proto__|constructor|prototype)$/.test(field.key)) continue;
    const raw = values.value[field.key];
    if (field.type === "boolean") {
      out[field.key] = raw === true;
      continue;
    }
    if (isEmpty(raw)) {
      if (field.required) errors[field.key] = "必填项";
      out[field.key] = field.type === "number" ? undefined : "";
      continue;
    }
    if (field.type === "number") {
      const n = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n)) {
        errors[field.key] = "必须是数字";
        out[field.key] = undefined;
        continue;
      }
      out[field.key] = n;
      continue;
    }
    out[field.key] = String(raw).trim();
  }
  return { values: out, errors };
};

const onSubmit = () => {
  if (props.disabled || props.loading) return;
  const { values: converged, errors } = converge();
  if (Object.keys(errors).length > 0) {
    localErrors.value = errors;
    return;
  }
  localErrors.value = {};
  editedSinceSubmit.value = {};
  emit("submit", converged, Object.keys(editedKeys.value));
};
</script>

<template>
  <section class="va-form" :class="{ 'va-form--disabled': disabled }">
    <header v-if="title || description" class="va-form__head">
      <h4 v-if="title" class="va-form__title">{{ title }}</h4>
      <p v-if="description" class="va-form__desc">{{ description }}</p>
    </header>

    <div class="va-form__fields">
      <div
        v-for="field in fields"
        :key="field.key"
        class="va-form__field"
      >
        <label
          v-if="field.type !== 'select'"
          :for="`va-form-${field.key}`"
          class="va-form__label"
        >
          {{ field.label }}
          <span v-if="field.required" class="va-form__req" aria-hidden="true">*</span>
          <span v-if="field.secret" class="va-form__badge">敏感</span>
        </label>
        <span v-else :id="`va-form-lbl-${field.key}`" class="va-form__label">
          {{ field.label }}
          <span v-if="field.required" class="va-form__req" aria-hidden="true">*</span>
          <span v-if="field.secret" class="va-form__badge">敏感</span>
        </span>

        <div class="va-form__control-row">
          <textarea
            v-if="field.type === 'textarea'"
            :id="`va-form-${field.key}`"
            v-model="values[field.key] as string"
            class="va-form__control va-form__control--area"
            :class="{ 'va-form__control--error': errorOf(field.key) }"
            :placeholder="field.placeholder"
            :disabled="disabled"
            rows="3"
            maxlength="2000"
            :aria-invalid="errorOf(field.key) ? 'true' : undefined"
            :aria-describedby="errorOf(field.key) ? `va-form-err-${field.key}` : undefined"
            @input="markEdited(field.key)"
          ></textarea>

          <!-- TASK-092 方案 A：select 组合库内 VaSelect（combobox 触发器 + 弹层，
               可搜索/键盘导航与全库交互一致）；label 转 aria（触发器是 button 形态） -->
          <VaSelect
            v-else-if="field.type === 'select'"
            class="va-form__select"
            :model-value="(values[field.key] as string) || ''"
            :options="field.options || []"
            :disabled="disabled"
            :invalid="!!errorOf(field.key)"
            :placeholder="field.placeholder || '请选择'"
            :label="field.label"
            @update:model-value="(v) => { values[field.key] = v; markEdited(field.key); }"
          />

          <template v-else-if="field.type === 'boolean'">
            <label class="va-form__switch">
              <input
                :id="`va-form-${field.key}`"
                type="checkbox"
                :checked="values[field.key] === true"
                :disabled="disabled"
                @change="values[field.key] = ($event.target as HTMLInputElement).checked; markEdited(field.key)"
              />
              <span>{{ values[field.key] === true ? "是" : "否" }}</span>
            </label>
          </template>

          <template v-else>
            <input
              :id="`va-form-${field.key}`"
              v-model="values[field.key] as string"
              class="va-form__control"
              :class="{ 'va-form__control--error': errorOf(field.key) }"
              :type="inputTypeOf(field)"
              :placeholder="field.placeholder"
              :disabled="disabled"
              :step="field.type === 'number' ? 'any' : undefined"
              maxlength="2000"
              :aria-invalid="errorOf(field.key) ? 'true' : undefined"
              :aria-describedby="errorOf(field.key) ? `va-form-err-${field.key}` : undefined"
              @input="markEdited(field.key)"
            />
            <VaButton
              v-if="field.secret"
              variant="ghost"
              size="sm"
              :disabled="disabled"
              @click="secretVisible[field.key] = !secretVisible[field.key]"
            >
              {{ secretVisible[field.key] ? "隐藏" : "显示" }}
            </VaButton>
            <span v-if="field.unit" class="va-form__unit">{{ field.unit }}</span>
          </template>
        </div>

        <p v-if="errorOf(field.key)" :id="`va-form-err-${field.key}`" class="va-form__error">
          {{ errorOf(field.key) }}
        </p>
        <p v-else-if="field.description" class="va-form__hint">{{ field.description }}</p>
      </div>
    </div>

    <footer class="va-form__actions">
      <VaButton variant="primary" :disabled="disabled || loading" @click="onSubmit">
        {{ submitLabel }}
      </VaButton>
      <VaButton variant="secondary" :disabled="disabled" @click="emit('cancel')">
        {{ cancelLabel }}
      </VaButton>
    </footer>

    <!-- 收口/附加信息插槽（如「已提交」「已超时关闭」回执说明） -->
    <slot name="after-actions" />
  </section>
</template>

<style src="./VaForm.css"></style>
