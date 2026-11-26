/** VaDecisionInbox 的类型定义 */

export type DecisionAnswer = "primary" | "secondary";

export interface Decision {
  id: string;
  title: string;
  /** 标题下的一句背景说明 */
  detail?: string;
  /** 主答案（墨色实心按钮），如"立即发布"；缺省则不渲染该按钮——
   *  用于非决策型挂起（如 L2 表单待填写：回传通道在表单卡本身，收件箱只做提示，TASK-092 尾巴 1） */
  primary?: string;
  /** 次答案（描边按钮），如"再等等"；缺省则不渲染 */
  secondary?: string;
  /** 初始折叠为一行弱化文本，点击展开 */
  collapsed?: boolean;
}

export interface DecisionInboxProps {
  decisions: Decision[];
}

export interface DecisionInboxEvents {
  decide: [decision: Decision, answer: DecisionAnswer];
}
