/** VaStepperForm 的类型定义 */

export interface StepperStep {
  id: string;
  title: string;
  /** 步骤简述（步骤条下的小字） */
  description?: string;
}

export interface StepperFormProps {
  steps: StepperStep[];
  /** 受控当前步下标（配合 @update:step 实现 v-model:step） */
  step?: number;
  /** 非受控初始步 */
  defaultStep?: number;
  /** 禁用"下一步/提交"（宿主校验未通过时） */
  nextDisabled?: boolean;
  /** 提交进行中（最后一步按钮转"提交中…"） */
  submitting?: boolean;
  /** 上一步按钮文案 */
  backLabel?: string;
  nextLabel?: string;
  /** 最后一步按钮文案，默认"提交" */
  finishLabel?: string;
}

export interface StepperFormEvents {
  "update:step": [index: number];
  /** 进入下一步前（prev 为离开的步下标；可在此做校验副作用） */
  next: [prev: number];
  back: [prev: number];
  /** 最后一步点提交（携带当前步下标） */
  submit: [current: number];
}
