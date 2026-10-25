// CI 用：把 playwright-core 自带的 Chromium 路径写进 GITHUB_ENV，供 tools/chrome-path.mjs 读。
// 本机不需要跑它（chrome-path.mjs 会自己按平台猜），只给 .github/workflows/ci.yml 用。
import { appendFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const path = chromium.executablePath();
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, 'CHROME_PATH=' + path + '\n');
console.log('CHROME_PATH=' + path);
