export type FriendlyError = {
  title: string;
  summary: string;
  reason: string;
  advice: string[];
  level: 'info' | 'warn' | 'error';
  technicalCode?: string;
  exitCode?: number | string;
};

export function formatCommandError(input: {
  status?: unknown;
  code?: unknown;
  message?: unknown;
  stderr?: unknown;
  stdout?: unknown;
  exitCode?: unknown;
  command?: unknown;
  context?: 'search' | 'offer' | 'ozon' | 'unknown';
}): FriendlyError {
  const status = String(input.status ?? '').toLowerCase().trim();
  const code = String(input.code ?? '').trim();
  const message = String(input.message ?? '').trim();
  const stderrText = typeof input.stderr === 'string' ? input.stderr : JSON.stringify(input.stderr ?? '');
  const exitCode = input.exitCode != null ? Number(input.exitCode) : undefined;
  const joined = `${status} ${code} ${message} ${stderrText}`;

  // ── Browser context broken (headless daemon crash) ──
  if (
    /browser.?closed|browser context|BROWSER_CONTEXT_BROKEN|context.*(?:closed|broken|crash)/i.test(joined)
  ) {
    return {
      title: '浏览器会话中断',
      summary: '无头采集的浏览器会话意外崩溃或断开，无法继续访问 1688 页面。',
      reason: '后台浏览器进程（Chromium）异常退出，或持久化会话数据损坏。',
      advice: [
        '系统会自动尝试重新创建浏览器会话，稍后重试即可。',
        '如果连续出现，可尝试重启应用。',
        '也可开启"可视化打开浏览器"临时绕过。',
      ],
      level: 'warn',
      technicalCode: 'BROWSER_CONTEXT_BROKEN',
      exitCode,
    };
  }

  // ── User cancelled / browser closed ──
  if (
    status === 'cancelled' ||
    status === 'canceled' ||
    exitCode === 130 ||
    code === 'CANCELED'
  ) {
    return {
      title: '任务已取消',
      summary: '采集任务已停止，可能是浏览器窗口被关闭、页面上下文崩溃，或任务被手动取消。',
      reason: '浏览器会话已断开，当前采集流程无法继续读取 1688 页面数据。',
      advice: [
        '如果是你手动关闭了浏览器，可以重新执行任务。',
        '如果不是手动关闭，建议重新执行一次。',
        '如果连续出现，请关闭所有旧的采集浏览器窗口后再启动。',
        '可尝试开启"可视化打开浏览器"，观察是否被 1688 风控或验证码拦截。',
      ],
      level: 'warn',
      technicalCode: 'BROWSER_CONTEXT_BROKEN',
      exitCode,
    };
  }

  // ── Captcha / risk control ──
  if (
    /CAPTCHA_|captcha|滑块|验证码|x5sec|punish|RISK_OR_CAPTCHA|风控|risk.?control/i.test(joined)
  ) {
    return {
      title: '遇到验证码或风控拦截',
      summary: '1688 页面触发了验证码、滑块或风控校验，系统暂时无法继续自动采集。',
      reason: '当前账号、网络环境或访问频率触发了 1688 的安全校验。',
      advice: [
        '勾选"验证码自动开浏览器"后重试。',
        '或勾选"可视化打开浏览器"，手动完成验证。',
        '降低采集频率，减少连续搜索次数。',
        '尝试切换 1688 账号或网络环境。',
      ],
      level: 'error',
      technicalCode: code || 'RISK_CONTROL',
      exitCode,
    };
  }

  // ── Login expired ──
  if (
    /login|登录|auth|unauthorized|session.?expired/i.test(joined)
  ) {
    return {
      title: '1688 登录状态失效',
      summary: '当前 1688 账号登录状态可能已经失效，需要重新登录后再采集。',
      reason: '1688 的会话 Cookie 已过期或被服务端清除。',
      advice: [
        '打开 1688 账号设置。',
        '重新登录当前账号。',
        '登录完成后重新执行采集任务。',
      ],
      level: 'warn',
      technicalCode: code || 'NOT_LOGGED_IN',
      exitCode,
    };
  }

  // ── Network error / timeout ──
  if (
    /NETWORK_ERROR|timeout|Timeout|net::|ERR_|Failed to load|navigation.?timeout/i.test(joined)
  ) {
    return {
      title: '页面加载失败',
      summary: '1688 页面或接口加载超时，当前采集任务没有完成。',
      reason: '网络连接不稳定、代理配置异常，或 1688 服务端响应过慢。',
      advice: [
        '检查网络连接。',
        '稍后重新执行。',
        '如果使用代理或 VPN，尝试切换线路。',
        '可开启可视化浏览器观察页面是否正常打开。',
      ],
      level: 'error',
      technicalCode: code || 'NETWORK_ERROR',
      exitCode,
    };
  }

  // ── No offers ──
  if (
    /EMPTY|no.?offers|0.*商品|未返回商品/i.test(joined) ||
    /MISSING_OFFER_RESULT/i.test(joined)
  ) {
    return {
      title: '未采集到商品',
      summary: '本次搜索没有返回可用商品，可能是关键词过窄、筛选条件过严，或页面数据没有正常返回。',
      reason: '搜索条件匹配不到足够商品，或页面结构变化导致数据提取失败。',
      advice: [
        '放宽价格、地区、认证等筛选条件。',
        '换一个关键词重试。',
        '如果持续为 0，开启可视化浏览器检查页面是否正常。',
      ],
      level: 'warn',
      technicalCode: code || 'EMPTY_RESULT',
      exitCode,
    };
  }

  // ── AI / Ozon draft generation ──
  if (
    /generateOzonDraft|generateDraft|DeepSeek|api.?key|API.?Key|model|AI/i.test(joined)
  ) {
    const isKeyMissing = /api.?key|API.?Key|未配置|缺少/i.test(joined);
    return {
      title: '生成 Ozon 草稿失败',
      summary: isKeyMissing
        ? '未配置可用的 AI 服务，请先到 AI 设置中完成配置。'
        : '系统未能生成 Ozon 草稿，可能是 AI 配置缺失、模型调用失败，或商品数据不完整。',
      reason: isKeyMissing
        ? '缺少有效的 API Key，无法调用 AI 模型生成草稿。'
        : 'AI 模型调用失败或商品数据不足以生成完整草稿。',
      advice: isKeyMissing
        ? [
          '打开 AI 设置，填入有效的 API Key。',
          '确认 API Key 有可用余额。',
          '保存设置后重新生成草稿。',
        ]
        : [
          '检查 AI 设置是否已保存 API Key。',
          '检查商品是否已完成深度采集。',
          '如果缺少长、宽、高、重量等字段，请先人工补充。',
        ],
      level: 'error',
      technicalCode: code || 'OZON_DRAFT_FAILED',
      exitCode,
    };
  }

  // ── Daemon paused ──
  if (/DAEMON_PAUSED|daemon.*paus/i.test(joined)) {
    return {
      title: '采集守护进程已暂停',
      summary: '本地 daemon 处于暂停保护状态，本次采集未真正访问 1688。',
      reason: 'daemon 因为连续失败触发了保护性暂停，避免触发更严厉的风控。',
      advice: [
        '等待 daemon 自动恢复后重试。',
        '或在运行状态面板中手动恢复 daemon。',
        '降低采集频率后再继续。',
      ],
      level: 'warn',
      technicalCode: code || 'DAEMON_PAUSED',
      exitCode,
    };
  }

  // ── Generic success ──
  if (status === 'success' || (!status && !code && !message && !stderrText)) {
    return {
      title: '任务完成',
      summary: '任务已成功执行。',
      reason: '',
      advice: [],
      level: 'info',
      exitCode,
    };
  }

  // ── Generic failure (fallback) ──
  return {
    title: '任务执行失败',
    summary: '任务执行过程中发生异常，系统没有识别出具体原因。',
    reason: message || code || status || '未知错误。',
    advice: [
      '重新执行一次任务。',
      '如果连续失败，请复制技术详情发给开发者排查。',
      '尝试关闭旧浏览器窗口后重新启动应用。',
    ],
    level: 'error',
    technicalCode: code || 'UNKNOWN_ERROR',
    exitCode,
  };
}
