# 演示视频（已就位，由 promo/ 下 HyperFrames 项目渲染）

| 文件 | 时长 | 来源项目 |
| --- | --- | --- |
| hero.mp4 | 47s | promo/vuagent-hero |
| cloudops.mp4 | 22s | promo/vuagent-scenes（index.html） |
| analysis.mp4 | 20s | promo/vuagent-scenes（compositions/analysis.html） |
| tasks.mp4 | 18s | promo/vuagent-scenes（compositions/tasks.html） |

发布后经 /vuagent/videos/ 访问；落地页 LandingDemo.vue 已接线。
重渲染：在对应项目目录 `npx hyperframes@0.9.87 render --quality high`（scenes 项目 analysis/tasks 用 `-c compositions/<name>.html`）。
