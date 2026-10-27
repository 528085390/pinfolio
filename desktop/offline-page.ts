/**
 * 离线 / 等待连接网页端服务的提示页（数据 URL 形式）。
 *
 * 当本地 7788 网页端服务尚未启动（或启动较慢、临时维护）时，
 * 窗口展示优雅的深色主题等待页，每 3 秒自动轮询重试，也可点击立即重试。
 * 纯函数，不依赖 Electron 运行时，单测可直接覆盖。
 */

export function getOfflineHtml(targetUrl: string): string {
  const safeTarget = targetUrl.replace(/"/g, '&quot;')
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>pinfolio</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 20px;
      background: #111315;
      color: #e6e6e6;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      user-select: none;
    }
    .card {
      background: #1a1d20;
      border: 1px solid #2d3135;
      border-radius: 12px;
      padding: 32px 36px;
      max-width: 460px;
      width: 100%;
      text-align: center;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    }
    .icon {
      font-size: 38px;
      margin-bottom: 12px;
      line-height: 1;
    }
    h1 {
      font-size: 19px;
      margin: 0 0 12px 0;
      color: #f0f0f0;
      font-weight: 600;
    }
    p {
      font-size: 13px;
      color: #99a1a8;
      line-height: 1.6;
      margin: 0 0 16px 0;
    }
    .url {
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      background: #111315;
      padding: 3px 8px;
      border-radius: 4px;
      color: #d97757;
      word-break: break-all;
    }
    .tip-box {
      text-align: left;
      font-size: 12px;
      color: #8b949e;
      background: #141618;
      padding: 12px 14px;
      border-radius: 6px;
      border: 1px solid #23272b;
      margin-bottom: 20px;
      line-height: 1.6;
    }
    .tip-box code {
      background: #202428;
      padding: 2px 5px;
      border-radius: 3px;
      color: #e6edf3;
      font-family: monospace;
    }
    .btn {
      background: #d97757;
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 9px 24px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn:hover { background: #e08365; }
    .btn:active { background: #c66647; }
    .status {
      margin-top: 14px;
      font-size: 12px;
      color: #6c757d;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">📌</div>
    <h1>等待连接网页端服务</h1>
    <p>正在尝试连接服务地址：<br><span class="url">${safeTarget}</span></p>
    <div class="tip-box">
      <div>💡 <b>提示</b>：</div>
      <div>• 本地服务：请确保已运行 <code>start.cmd</code> 启动网页端。</div>
      <div>• 远程服务：可通过环境变量 <code>PINBOARD_WEB_URL</code> 指定服务地址。</div>
    </div>
    <button class="btn" id="retryBtn">立即重试</button>
    <div class="status" id="statusText">3 秒后自动重试...</div>
  </div>
  <script>
    const target = ${JSON.stringify(targetUrl)};
    let countdown = 3;
    const statusText = document.getElementById('statusText');
    const retryBtn = document.getElementById('retryBtn');

    function tryConnect() {
      statusText.innerText = '正在连接...';
      window.location.href = target;
    }

    retryBtn.addEventListener('click', tryConnect);

    setInterval(() => {
      countdown--;
      if (countdown <= 0) {
        countdown = 3;
        tryConnect();
      } else {
        statusText.innerText = countdown + ' 秒后自动重试...';
      }
    }, 1000);
  </script>
</body>
</html>`
}

export function getOfflineDataUrl(targetUrl: string): string {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(getOfflineHtml(targetUrl))
}
