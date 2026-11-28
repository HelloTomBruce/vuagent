<script setup lang="ts">
/**
 * VaDataTable（0.9.0 W3）：ui_data_table 的渲染组件（L2 结构化行采集）。
 * 可增删行 + 单元格编辑（text/number/boolean/select 四型列）；
 * 提交契约：values = 行对象数组（与派生 resultSchema 的 items 同形状）。
 */
import { computed, ref } from "vue";

interface ColumnItem {
  key: string;
  label: string;
  type?: "text" | "number" | "boolean" | "select";
  description?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
}
type Row = Record<string, unknown>;

const props = withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    columns?: ColumnItem[];
    rows?: Row[];
    minRows?: number;
    maxRows?: number;
    submitLabel?: string;
    disabled?: boolean;
  }>(),
  {
    title: "请填写表格",
    description: undefined,
    columns: () => [],
    rows: () => [],
    minRows: 0,
    maxRows: 50,
    submitLabel: "提交",
    disabled: false,
  }
);

const emit = defineEmits<{
  (e: "submit", values: Row[]): void;
  (e: "cancel"): void;
}>();

const validColumns = computed(() =>
  (props.columns || []).filter(
    (c) => c && typeof c.key === "string" && c.key && !/^(?:__proto__|constructor|prototype)$/.test(c.key)
  )
);

const rows = ref<Row[]>(props.rows.map((r) => ({ ...r })));

const canSubmit = computed(() => !props.disabled && rows.value.length >= props.minRows);

function addRow() {
  if (props.disabled || rows.value.length >= props.maxRows) return;
  const row: Row = {};
  for (const col of validColumns.value) row[col.key] = col.type === "boolean" ? false : "";
  rows.value.push(row);
}

function removeRow(idx: number) {
  if (props.disabled) return;
  rows.value.splice(idx, 1);
}

</script>

<template>
  <div class="va-data-table" data-testid="va-data-table">
    <div class="va-data-table__head">
      <div class="va-data-table__title">{{ title }}</div>
      <span class="va-data-table__count">{{ rows.length }} / {{ maxRows }} 行</span>
    </div>
    <p v-if="description" class="va-data-table__desc">{{ description }}</p>

    <div class="va-data-table__scroll">
      <table class="va-data-table__table">
        <thead>
          <tr>
            <th v-for="col in validColumns" :key="col.key">
              {{ col.label }}<span v-if="col.required" class="va-data-table__req">*</span>
            </th>
            <th class="va-data-table__ops-col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, idx) in rows" :key="idx">
            <td v-for="col in validColumns" :key="col.key">
              <select
                v-if="col.type === 'select'"
                v-model="row[col.key]"
                :disabled="disabled"
                class="va-data-table__cell"
              >
                <option value="">—</option>
                <option v-for="o in col.options || []" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
              <input
                v-else-if="col.type === 'boolean'"
                v-model="row[col.key]"
                type="checkbox"
                :disabled="disabled"
              />
              <input
                v-else
                v-model="row[col.key]"
                :type="col.type === 'number' ? 'number' : 'text'"
                :disabled="disabled"
                class="va-data-table__cell"
              />
            </td>
            <td class="va-data-table__ops-col">
              <button
                class="va-data-table__del"
                type="button"
                :disabled="disabled || rows.length <= minRows"
                :title="rows.length <= minRows ? `最少 ${minRows} 行` : '删除本行'"
                @click="removeRow(idx)"
              >
                ✕
              </button>
            </td>
          </tr>
          <tr v-if="rows.length === 0">
            <td :colspan="validColumns.length + 1" class="va-data-table__empty">暂无行——点击下方「加一行」开始</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="va-data-table__foot">
      <button class="va-data-table__add" type="button" :disabled="disabled || rows.length >= maxRows" @click="addRow">
        + 加一行
      </button>
      <span class="va-data-table__spacer"></span>
      <button class="va-data-table__btn" type="button" :disabled="!canSubmit" @click="emit('submit', rows.map((r) => ({ ...r })))">
        {{ submitLabel }}
      </button>
      <button class="va-data-table__btn va-data-table__btn--ghost" type="button" :disabled="disabled" @click="emit('cancel')">
        取消
      </button>
    </div>
  </div>
</template>

<style scoped>
.va-data-table {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.va-data-table__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.va-data-table__title {
  font-weight: 600;
  font-size: 14px;
}
.va-data-table__count {
  font-size: 11.5px;
  color: var(--va-muted, #6f6d66);
}
.va-data-table__desc {
  margin: 0;
  font-size: 12.5px;
  color: var(--va-muted, #6f6d66);
}
.va-data-table__scroll {
  overflow-x: auto;
}
.va-data-table__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.va-data-table__table th {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid var(--va-edge, rgba(26, 25, 23, 0.12));
  color: var(--va-muted, #6f6d66);
  font-weight: 500;
  white-space: nowrap;
}
.va-data-table__table td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--va-edge, rgba(26, 25, 23, 0.12));
}
.va-data-table__req {
  color: var(--va-danger, #d5453c);
}
.va-data-table__cell {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid var(--va-edge, rgba(26, 25, 23, 0.12));
  border-radius: 6px;
  font-size: 12.5px;
  background: transparent;
}
.va-data-table__ops-col {
  width: 36px;
  text-align: center;
}
.va-data-table__del {
  border: none;
  background: transparent;
  color: var(--va-danger, #d5453c);
  cursor: pointer;
  font-size: 13px;
}
.va-data-table__del:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.va-data-table__empty {
  text-align: center;
  color: var(--va-muted, #6f6d66);
  padding: 14px 0;
}
.va-data-table__foot {
  display: flex;
  align-items: center;
  gap: 8px;
}
.va-data-table__add {
  padding: 5px 10px;
  border: 1px dashed var(--va-edge, rgba(26, 25, 23, 0.12));
  border-radius: 6px;
  background: transparent;
  color: var(--va-accent, #c2410c);
  font-size: 12px;
  cursor: pointer;
}
.va-data-table__add:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.va-data-table__spacer {
  flex: 1;
}
.va-data-table__btn {
  padding: 6px 14px;
  border: 1px solid var(--va-accent, #c2410c);
  border-radius: 6px;
  background: var(--va-accent, #c2410c);
  color: #fff;
  font-size: 12.5px;
  cursor: pointer;
}
.va-data-table__btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.va-data-table__btn--ghost {
  background: transparent;
  color: var(--va-muted, #6f6d66);
  border-color: var(--va-edge, rgba(26, 25, 23, 0.12));
}
</style>
