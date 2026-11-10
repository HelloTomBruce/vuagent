/** VaSetupGuide 的类型定义 */

export interface SetupStep {
  id: string;
  title: string;
  description?: string;
  /** 宿主维护的完成态：undefined 进行中 */
  status?: "done" | "skipped";
  /** 可跳过（显示"跳过"按钮） */
  optional?: boolean;
  /** 步骤完成动作文案，默认"完成" */
  actionLabel?: string;
}

export interface SetupGuideProps {
  steps: SetupStep[];
  /** 标题，默认"开始准备" */
  title?: string;
  /** 完成全部后展示的收尾文案 */
  finishLabel?: string;
}

export interface SetupGuideEvents {
  /** 点击步骤完成动作 */
  complete: [id: string];
  /** 点击跳过 */
  skip: [id: string];
  /** 全部处理完（无进行中步骤）时触发一次 */
  allDone: [];
}
