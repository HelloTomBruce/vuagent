/// <reference types="vite/client" />

/** vite.config.ts define 注入:monorepo 根 package.json 的产品版本 */
declare const __APP_VERSION__: string;

/** vite.config.ts define 注入：--mode console（CLI 发布产物）时为 true */
declare const __CONSOLE_ONLY__: boolean;
