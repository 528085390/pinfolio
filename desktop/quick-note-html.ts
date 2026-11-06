/**
 * 桌面端全局随手记浮窗独立页面（数据 URL 形式）。
 *
 * 极简、独立、无第三方运行时依赖：
 * 1. 采用与 Pinfolio 主题一致的深色底（#111315），配合精致边框与卡片质感；
 * 2. 具备自动对焦的多行输入框、输入时实时提取 #标签 并渲染微型标签胶囊；
 * 3. 底部包含「置顶」勾选框、状态反馈信息以及「保存便签」操作按钮；
 * 4. 键盘事件监听：
 *    - Ctrl+Enter / Cmd+Enter：立即发起保存
 *    - Esc：关闭/隐藏浮窗
 * 5. 提交至 ${targetUrl}/api/notes，采用 credentials: 'include' 携带桌面端会话 Cookie；
 * 6. 保存成功后展示绿勾提示，并在 350ms 后清空内容并调用 window.close() 触发隐藏。
 */

export function getQuickNoteHtml(targetUrl: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>随手记便签</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #111315;
      color: #e6e6e6;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      user-select: none;
    }
    .container {
      display: flex;
      flex-direction: column;
      height: 100%;
      padding: 12px 14px;
      gap: 8px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      line-height: 1;
    }
    .title {
      font-size: 13px;
      font-weight: 600;
      color: #f0f0f0;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .title .icon {
      color: #d97757;
      font-size: 14px;
    }
    .shortcut-tip {
      font-size: 11px;
      color: #7d8590;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    }
    .input-wrapper {
      flex: 1;
      display: flex;
      flex-direction: column;
      position: relative;
    }
    textarea {
      flex: 1;
      width: 100%;
      background: #181b1e;
      border: 1px solid #2d3135;
      border-radius: 6px;
      padding: 8px 10px;
      color: #e6e6e6;
      font-size: 13px;
      line-height: 1.5;
      font-family: inherit;
      resize: none;
      outline: none;
      transition: border-color 0.15s;
    }
    textarea:focus {
      border-color: #d97757;
    }
    .tag-bar {
      min-height: 20px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      padding: 2px 0;
    }
    .tag-chip {
      font-size: 11px;
      background: rgba(217, 119, 87, 0.15);
      color: #d97757;
      padding: 1px 6px;
      border-radius: 4px;
      border: 1px solid rgba(217, 119, 87, 0.3);
      line-height: 1.4;
    }
    .footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 2px;
    }
    .pin-label {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
      color: #8b949e;
      cursor: pointer;
    }
    .pin-label input[type="checkbox"] {
      accent-color: #d97757;
      cursor: pointer;
      margin: 0;
    }
    .status-feedback {
      font-size: 12px;
      color: #7d8590;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .status-feedback.success {
      color: #3fb950;
      font-weight: 500;
    }
    .status-feedback.error {
      color: #f85149;
    }
    .save-btn {
      background: #d97757;
      color: #fff;
      border: none;
      border-radius: 5px;
      padding: 6px 16px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }
    .save-btn:hover:not(:disabled) {
      background: #e08365;
    }
    .save-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="title"><span class="icon">📌</span>随手记便签</div>
      <div class="shortcut-tip">Ctrl+Enter 保存 · Esc 关闭</div>
    </div>
    <div class="input-wrapper">
      <textarea id="noteInput" autofocus placeholder="随时记一笔... 支持 #标签"></textarea>
    </div>
    <div id="tagPreview" class="tag-bar"></div>
    <div class="footer">
      <label class="pin-label">
        <input type="checkbox" id="pinnedCheckbox">
        <span>置顶</span>
      </label>
      <div id="statusFeedback" class="status-feedback"></div>
      <button id="saveBtn" class="save-btn">保存便签</button>
    </div>
  </div>

  <script>
    const TARGET_URL = ${JSON.stringify(targetUrl).replace(/</g, '\\u003c')};
    const noteInput = document.getElementById('noteInput');
    const tagPreview = document.getElementById('tagPreview');
    const pinnedCheckbox = document.getElementById('pinnedCheckbox');
    const statusFeedback = document.getElementById('statusFeedback');
    const saveBtn = document.getElementById('saveBtn');

    // 标签解析正则：行首或空格标点前导的 #标签
    const TAG_RE = /(?:^|[\\s(（\\[【,，、。．！!？?；;：:>"'“”‘’《》「」『』])#([\\p{L}\\p{N}_\\-\\/]+)/gu;

    function extractTags(text) {
      const out = new Set();
      for (const m of text.matchAll(TAG_RE)) {
        const t = m[1].replace(/[.,;:!?]+$/, '');
        if (t) out.add(t);
      }
      return Array.from(out);
    }

    function updateTagPreview() {
      const tags = extractTags(noteInput.value);
      tagPreview.innerHTML = tags.map(t => '<span class="tag-chip">#' + escapeHtml(t) + '</span>').join('');
    }

    function escapeHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    noteInput.addEventListener('input', updateTagPreview);

    window.addEventListener('focus', () => {
      noteInput.focus();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        window.close();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        submitNote();
      }
    });

    saveBtn.addEventListener('click', () => {
      submitNote();
    });

    let isSubmitting = false;

    async function submitNote() {
      if (isSubmitting) return;
      const content = noteInput.value.trim();
      if (!content) {
        statusFeedback.className = 'status-feedback error';
        statusFeedback.innerText = '便签内容不能为空';
        noteInput.focus();
        return;
      }

      isSubmitting = true;
      saveBtn.disabled = true;
      statusFeedback.className = 'status-feedback';
      statusFeedback.innerText = '正在保存...';

      try {
        const cleanBase = TARGET_URL.replace(/\\/+$/, '');
        const res = await fetch(cleanBase + '/api/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            content,
            pinned: pinnedCheckbox.checked
          })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || ('HTTP ' + res.status));
        }

        statusFeedback.className = 'status-feedback success';
        statusFeedback.innerText = '✓ 便签已保存';

        setTimeout(() => {
          noteInput.value = '';
          updateTagPreview();
          pinnedCheckbox.checked = false;
          statusFeedback.className = 'status-feedback';
          statusFeedback.innerText = '';
          saveBtn.disabled = false;
          isSubmitting = false;
          window.close();
        }, 350);
      } catch (err) {
        statusFeedback.className = 'status-feedback error';
        statusFeedback.innerText = '保存失败：' + (err.message || String(err));
        saveBtn.disabled = false;
        isSubmitting = false;
      }
    }
  </script>
</body>
</html>`
}

export function getQuickNoteDataUrl(targetUrl: string): string {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(getQuickNoteHtml(targetUrl))
}
