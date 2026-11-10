import { ref, type Ref } from "vue";
import type { DropzoneProps } from "./types";
import { formatBytes } from "./formatSize";

/**
 * VaDropzone 的拖放状态机 + 文件选择。
 * 组件不持有文件列表（受控 files），只发出 add/remove/reject；inputEl 由组件 useTemplateRef 传入。
 */
export function useDropzone(
  props: DropzoneProps,
  inputEl: Ref<HTMLInputElement | null>,
  emit: {
    add: (files: File[]) => void;
    reject: (files: File[], reason: "too-large") => void;
  },
) {
  const dragging = ref(false);
  /** dragenter/leave 计数（子元素会交替触发成对事件） */
  let depth = 0;

  function onDragenter(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    dragging.value = true;
  }

  function onDragover(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault(); // 允许 drop
  }

  function onDragleave() {
    depth = Math.max(0, depth - 1);
    if (depth === 0) dragging.value = false;
  }

  function onDrop(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    dragging.value = false;
    ingest(Array.from(e.dataTransfer?.files ?? []));
  }

  function openPicker() {
    if (props.busy) return;
    inputEl.value?.click();
  }

  function onInputChange(e: Event) {
    const input = e.target as HTMLInputElement;
    ingest(Array.from(input.files ?? []));
    input.value = ""; // 允许重复选同一文件
  }

  function ingest(files: File[]) {
    if (!files.length || props.busy) return;
    if (!props.multiple) files = files.slice(0, 1);
    const limit = props.maxSizeMb ? props.maxSizeMb * 1024 * 1024 : Infinity;
    const ok = files.filter((f) => f.size <= limit);
    const bad = files.filter((f) => f.size > limit);
    if (ok.length) emit.add(ok);
    if (bad.length) emit.reject(bad, "too-large");
  }

  return { dragging, inputEl, onDragenter, onDragover, onDragleave, onDrop, openPicker, onInputChange, formatBytes };
}

function hasFiles(e: DragEvent) {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}
