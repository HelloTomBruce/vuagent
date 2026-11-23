<script setup lang="ts">
/**
 * 推理档位菜单（能力运行时 P1）：composer 座位区的档位选择 Popover。
 * 仅当模型声明 supportedEfforts 时由父级渲染（v-if 在父级）；选中经
 * select 事件上抛，会话级隔离与读取侧兜底在 useModelProfiles（TASK-052/081）。
 */
import { Check, ChevronDown, Sparkles } from "lucide-vue-next";
import { VaPopover } from "@vuagent/ui";

defineProps<{
  /** 可选档位（来自模型能力声明 supportedEfforts） */
  options: string[];
  /** 当前生效档位（读取侧兜底后的值，未必是用户显式选择） */
  modelValue: string;
}>();

const emit = defineEmits<{
  (e: "select", effort: string): void;
}>();
</script>

<template>
  <VaPopover placement="top-start" :offset="8">
    <template #trigger>
      <button class="va-console__seat-btn" type="button" :aria-label="`推理档位（当前 ${modelValue}）`">
        <Sparkles :size="12" aria-hidden="true" />
        <span class="va-console__seat-text">思考: {{ modelValue }}</span>
        <ChevronDown :size="11" aria-hidden="true" />
      </button>
    </template>
    <template #default="{ close }">
      <div class="va-console__effort-menu" role="menu" aria-label="推理档位">
        <button
          v-for="opt in options"
          :key="opt"
          class="va-console__effort-item"
          type="button"
          role="menuitem"
          :data-active="opt === modelValue || undefined"
          @click="emit('select', opt); close()"
        >
          <Check v-if="opt === modelValue" :size="13" aria-hidden="true" />
          <span v-else class="va-console__effort-gap" aria-hidden="true" />
          <span>{{ opt }}</span>
        </button>
      </div>
    </template>
  </VaPopover>
</template>
