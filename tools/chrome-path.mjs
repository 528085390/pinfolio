// 浏览器可执行文件在哪：先看 CHROME_PATH，再按平台猜 Playwright 自带的 chromium，
// 最后退到系统装的 Chrome。e2e 与截图脚本都用它，别在脚本里写死家目录。
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.CHROME_PATH || '',
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1217', 'chrome-win64', 'chrome.exe') : '',
  process.env.HOME ? join(process.env.HOME, '.cache', 'ms-playwright', 'chromium-1217', 'chrome-linux64', 'chrome') : '',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

export const CHROME = CANDIDATES.find((p) => !!p && existsSync(p)) || process.env.CHROME_PATH || '';
