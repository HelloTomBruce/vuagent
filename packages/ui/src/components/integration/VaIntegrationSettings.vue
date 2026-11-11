<script setup lang="ts">
import { computed, ref } from "vue";
import type { IntegrationSettingsEvents, IntegrationSettingsProps } from "./types";

const props = defineProps<IntegrationSettingsProps>();

const emit = defineEmits<IntegrationSettingsEvents>();

/* 受控（touched 哨兵回落 default*） */
const enabledTouched = ref(false);
const innerEnabled = ref(props.defaultEnabled ?? false);
const enabled = computed(() =>
  props.enabled !== undefined || enabledTouched.value ? (props.enabled ?? false) : innerEnabled.value,
);

const valuesTouched = ref(false);
const innerValues = ref(props.defaultValues ?? {});
const values = computed(() =>
  props.values !== undefined || valuesTouched.value ? (props.values ?? {}) : innerValues.value,
);

function setEnabled(v: boolean) {
  enabledTouched.value = true;
  innerEnabled.value = v;
  emit("update:enabled", v);
}

function setField(id: string, v: string) {
  const next = { ...values.value, [id]: v };
  valuesTouched.value = true;
  innerValues.value = next;
  emit("update:values", next);
}

const missingRequired = computed(() =>
  (props.fields ?? []).filter((f) => f.required && !(values.value[f.id] ?? "").trim()),
);

function save() {
  if (props.saving || missingRequired.value.length) return;
  emit("save", { enabled: enabled.value, values: values.value });
}
</script>

<template>
  <section class="va-is" :data-enabled="enabled">
    <header class="va-is__head">
      <div class="va-is__titlewrap">
        <h3 class="va-is__name">{{ props.name }}</h3>
        <p v-if="props.description" class="va-is__desc">{{ props.description }}</p>
      </div>
      <button
        class="va-is__switch"
        type="button"
        role="switch"
        :aria-checked="enabled"
        :aria-label="`启用${props.name}`"
        @click="setEnabled(!enabled)"
      >
        <span class="va-is__knob" />
      </button>
    </header>

    <div v-if="enabled && props.fields?.length" class="va-is__fields">
      <label v-for="f in props.fields" :key="f.id" class="va-is__field">
        <span class="va-is__label">
          {{ f.label }}
          <em v-if="f.required" class="va-is__req" aria-hidden="true">*</em>
        </span>
        <input
          class="va-is__input"
          :type="f.secret ? 'password' : 'text'"
          :value="values[f.id] ?? ''"
          :placeholder="f.placeholder"
          :aria-invalid="!!f.error"
          @input="setField(f.id, ($event.target as HTMLInputElement).value)"
        >
        <span v-if="f.error" class="va-is__err" role="alert">{{ f.error }}</span>
      </label>
    </div>

    <footer v-if="enabled" class="va-is__foot">
      <span v-if="props.savedLabel" class="va-is__saved" role="status">{{ props.savedLabel }}</span>
      <span class="va-is__spacer" />
      <button class="va-btn va-btn--ghost va-btn--sm va-is__disc" type="button" @click="emit('disconnect')">断开连接</button>
      <button
        class="va-btn va-btn--primary va-is__save"
        type="button"
        :disabled="props.saving || !!missingRequired.length"
        @click="save"
      >{{ props.saving ? "保存中…" : "保存" }}</button>
    </footer>
  </section>
</template>

<style src="./VaIntegrationSettings.css"></style>
