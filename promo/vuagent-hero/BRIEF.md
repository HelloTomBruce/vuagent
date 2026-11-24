# BRIEF — vuagent Hero 总宣传片

## 模式
collaborative（用户已拍板关键决策，制作过程自主执行，重大风格转向才回头确认）

## 交付物
- 1 支 Hero 总宣传片：MP4（H.264），**1920×1080**（16:9，落地页嵌入）
- 目标时长：**~55s**（±5s）
- 无旁白；**中文字幕点题**（kinetic captions）；motion-first 风格

## 产品
vuagent — Vue 生态 Agent Ops 工具箱（协议契约 + Harness 服务端 + 79 组件）。
产品站：https://hellotombruce.github.io/vuagent/ ；npm 三包已发布 @0.3.0。

## 素材（真实案例页，非假 UI）
- 三个业务宿主页（云运维大盘 / BI 分析台 / 任务调度中心）——已截帧
- 真模型对话产生的 Generative UI 卡片（巡检趋势卡 / 审批卡 / KPI 报告卡 / 明细表 / 收件箱 / ANSI 终端）——部分已截帧，缺帧随浏览器空闲补采
- 品牌资产：logo/vuagent-mark.svg、vuagent-lockup.svg（仓库内）

## 叙事节拍（draft）
1. **痛点**（~8s）：黑场文案——「你的 Agent，还在用文本流面对用户？」
2. **品牌 sting**（~5s）：vuagent mark 落定 + lockup
3. **三包架构**（~8s）：protocol → server → ui 三卡链路依次点亮
4. **场景蒙太奇 ①运维**（~10s）：大盘推近 → 巡检卡展开 → 审批卡挂起 → 批准 → 扩容卡
5. **场景蒙太奇 ②分析**（~9s）：计划卡打勾 → KPI 图表生长 → 下钻明细表滑入
6. **场景蒙太奇 ③任务**（~9s）：收件箱状态演进 → 终端日志滚动（绿色 ANSI 高亮）
7. **CTA 收尾**（~6s）：npm i @vuagent/ui 命令行卡 + 文档站 URL + lockup

## 风格
- 暖色调对齐 ui 设计令牌：ground #f7f6f2 / ink #1a1917 / accent #c2410c（可加暗场段落用 #141311）
- 展示字体：系统中文黑体优先（PingFang SC），数字等宽（ui-monospace）
- 动效尊重 resolve：全部有限次数动画；节拍利落，克制的 enterprise 质感（不要 SaaS 花活）
- 截图素材统一加设备框/投影 + 缓动推近（Ken Burns），避免生硬跳切

## 约束
- 确定性渲染：无时钟/无未播种随机/无 repeat:-1（契约红线）
- 单一 paused GSAP timeline @ window.__timelines["vuagent-hero"]
- 渲染前必须过 `npx hyperframes check` 0 findings；渲染动作在用户验收 preview 后执行
