let registry = { groups: [], commands: {} };
let activeGroup = 'sourcing';
let activeCommandId = 'search';
let lastCheckoutPrepareRunId = '';
let pendingPayload = null;

const $ = (selector) => document.querySelector(selector);
const api = window.desktopApi || {
  async getCommandRegistry() {
    return {
      groups: [
        { id: 'sourcing', label: '采集/找货' },
        { id: 'supplier', label: '供应商' },
        { id: 'communication', label: '沟通' },
        { id: 'orders', label: '购物车/订单' },
        { id: 'account', label: '账号/诊断' },
      ],
      commands: {
        search: {
          id: 'search',
          group: 'sourcing',
          label: '商品搜索',
          argvPreview: 'search',
          write: false,
          resultType: 'products',
          positional: [{ name: 'keyword', label: '关键词', required: true }],
          options: [
            { name: 'max', flag: '--max', label: '最大数量', type: 'number', default: 20 },
            { name: 'excludeAds', flag: '--exclude-ads', label: '排除广告', type: 'boolean', default: true },
            { name: 'deeppro', flag: '--deeppro', label: '深采详情', type: 'boolean', default: true },
          ],
        },
        supplierSearch: {
          id: 'supplierSearch',
          group: 'supplier',
          label: '供应商搜索',
          argvPreview: 'supplier search',
          write: false,
          resultType: 'suppliers',
          positional: [{ name: 'keywords', label: '关键词（一行一个）', required: true, array: true }],
          options: [{ name: 'factoryOnly', flag: '--factory-only', label: '只看工厂', type: 'boolean' }],
        },
        sellerInquire: {
          id: 'sellerInquire',
          group: 'communication',
          label: '售前询盘',
          argvPreview: 'seller inquire',
          write: true,
          resultType: 'generic',
          positional: [
            { name: 'offerId', label: 'Offer ID', required: true },
            { name: 'message', label: '询盘内容', required: true, multiline: true },
          ],
          options: [],
        },
        orderList: {
          id: 'orderList',
          group: 'orders',
          label: '订单列表',
          argvPreview: 'order list',
          write: false,
          resultType: 'table',
          positional: [],
          options: [
            {
              name: 'status',
              flag: '--status',
              label: '状态',
              type: 'select',
              default: 'all',
              values: [
                { value: 'all', label: '全部' },
                { value: 'waitsellersend', label: '待发货' },
              ],
            },
          ],
        },
        doctor: {
          id: 'doctor',
          group: 'account',
          label: '环境检查',
          argvPreview: 'doctor',
          write: false,
          resultType: 'diagnostics',
          positional: [],
          options: [{ name: 'noLaunch', flag: '--no-launch', label: '不启动浏览器', type: 'boolean', default: true }],
        },
      },
    };
  },
  async runCommand(payload) {
    return {
      runId: 'mock',
      commandId: payload.commandId,
      status: 'success',
      argv: ['search', '修枝剪', '--json'],
      startedAt: new Date().toISOString(),
      stdoutJson: {
        offers: [
          {
            offerId: '670053756107',
            title: '园林工具SK5修枝剪盆景园艺剪修剪树枝剪刀花艺剪刀省力大粗枝剪',
            image: 'https://cbu01.alicdn.com/img/ibank/O1CN01WEljil2JPCuWkjLE5_!!947099413-0-cib.jpg',
            price: { text: '¥3.77', min: 3.77, max: 3.77 },
            supplier: { name: '永康市富邦园林工具厂' },
            location: { province: '浙江', city: '永康市' },
            skus: [{ specs: '颜色:橙色; 规格:SK5省力款', price: 3.77, stock: 5200 }],
          },
        ],
      },
    };
  },
  async getHistory() {
    return [];
  },
  async getRuntimeStatus() {
    return { daemon: { stdoutJson: { running: false } } };
  },
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number') return new Intl.NumberFormat('zh-CN').format(value);
  return String(value);
}

function commandLabel(id) {
  return registry.commands[id]?.label || id;
}

async function init() {
  registry = await api.getCommandRegistry();
  renderGroupNav();
  renderCommandList();
  selectCommand(activeCommandId);
  bindEvents();
  await refreshRuntime();
  await renderHistory();
}

function bindEvents() {
  $('#runCommand').addEventListener('click', () => runActiveCommand(false));
  $('#copyCommand').addEventListener('click', copyCommandPreview);
  $('#refreshRuntime').addEventListener('click', refreshRuntime);
  $('#loadHistory').addEventListener('click', renderHistory);
  $('#cancelConfirm').addEventListener('click', closeConfirm);
  $('#approveConfirm').addEventListener('click', approveConfirm);
  $('#profileInput').addEventListener('input', updatePreview);
}

function renderGroupNav() {
  $('#groupNav').innerHTML = registry.groups
    .map(
      (group) => `
        <button class="nav-item ${group.id === activeGroup ? 'active' : ''}" type="button" data-group="${group.id}">
          ${escapeHtml(group.label)}
        </button>
      `,
    )
    .join('');
  document.querySelectorAll('[data-group]').forEach((button) => {
    button.addEventListener('click', () => {
      activeGroup = button.dataset.group;
      const first = Object.values(registry.commands).find((cmd) => cmd.group === activeGroup);
      activeCommandId = first?.id || activeCommandId;
      renderGroupNav();
      renderCommandList();
      selectCommand(activeCommandId);
    });
  });
}

function renderCommandList() {
  const commands = Object.values(registry.commands).filter((cmd) => cmd.group === activeGroup);
  $('#commandList').innerHTML = commands
    .map(
      (cmd) => `
        <button class="command-item ${cmd.id === activeCommandId ? 'active' : ''}" type="button" data-command="${cmd.id}">
          <strong>${escapeHtml(cmd.label)}</strong>
          <span>${escapeHtml(cmd.argvPreview)}</span>
          ${cmd.write ? '<em>写操作</em>' : ''}
        </button>
      `,
    )
    .join('');
  document.querySelectorAll('[data-command]').forEach((button) => {
    button.addEventListener('click', () => selectCommand(button.dataset.command));
  });
}

function selectCommand(commandId) {
  activeCommandId = commandId;
  const command = registry.commands[commandId];
  const group = registry.groups.find((item) => item.id === command.group);
  $('#workspaceTitle').textContent = group?.label || '1688 CLI';
  $('#commandTitle').textContent = command.label;
  renderCommandList();
  renderForm(command);
  updatePreview();
}

function renderForm(command) {
  const fields = [];
  for (const field of command.positional || []) {
    fields.push(renderInput(field, 'arg'));
  }
  for (const option of command.options || []) {
    fields.push(renderInput(option, 'option'));
  }
  if (!fields.length) fields.push('<p class="empty-state">该命令无需额外参数。</p>');
  $('#commandForm').innerHTML = fields.join('');
  $('#commandForm').querySelectorAll('input, textarea, select').forEach((input) => {
    input.addEventListener('input', updatePreview);
    input.addEventListener('change', updatePreview);
  });
}

function renderInput(field, scope) {
  const key = `${scope}:${field.name}`;
  const label = escapeHtml(field.label || field.name);
  const required = field.required ? ' <b>*</b>' : '';
  const value = escapeHtml(field.default ?? '');
  if (field.type === 'boolean') {
    return `
      <label class="toggle-row">
        <input data-scope="${scope}" data-name="${field.name}" type="checkbox" ${field.default ? 'checked' : ''} />
        <span>${label}${required}</span>
      </label>
    `;
  }
  if (field.type === 'select') {
    return `
      <label class="field">
        <span>${label}${required}</span>
        <select data-scope="${scope}" data-name="${field.name}">
          ${(field.values || [])
            .map((item) => {
              const value = typeof item === 'object' && item !== null ? item.value : item;
              const text = typeof item === 'object' && item !== null ? item.label : item;
              return `<option value="${escapeHtml(value)}" ${value === field.default ? 'selected' : ''}>${escapeHtml(text)}</option>`;
            })
            .join('')}
        </select>
      </label>
    `;
  }
  if (field.multiline || field.array) {
    return `
      <label class="field">
        <span>${label}${required}</span>
        <textarea data-scope="${scope}" data-name="${field.name}" rows="${field.array ? 4 : 5}">${value}</textarea>
      </label>
    `;
  }
  return `
    <label class="field">
      <span>${label}${required}</span>
      <input data-scope="${scope}" data-name="${field.name}" type="${field.type === 'number' ? 'number' : 'text'}" value="${value}" />
    </label>
  `;
}

function collectPayload(extra = {}) {
  const args = {};
  const options = {};
  $('#commandForm').querySelectorAll('[data-scope]').forEach((input) => {
    const target = input.dataset.scope === 'arg' ? args : options;
    target[input.dataset.name] = input.type === 'checkbox' ? input.checked : input.value;
  });
  return {
    commandId: activeCommandId,
    args,
    options,
    profile: $('#profileInput').value.trim() || 'default',
    ...extra,
  };
}

function previewArgv(payload = collectPayload()) {
  const command = registry.commands[payload.commandId];
  const parts = ['1688', ...command.argvPreview.split(' ').filter(Boolean)];
  for (const field of command.positional || []) {
    const value = payload.args[field.name] || field.default || '';
    const items = field.array ? splitList(value) : [String(value).trim()];
    parts.push(...items.filter(Boolean).map(shellQuote));
  }
  for (const option of command.options || []) {
    const value = payload.options[option.name];
    if (option.type === 'boolean') {
      if (value) parts.push(option.flag);
    } else if (String(value ?? '').trim()) {
      parts.push(option.flag, shellQuote(value));
    }
  }
  if (payload.profile) parts.push('--profile', shellQuote(payload.profile));
  parts.push('--json', '--pretty');
  return parts.join(' ');
}

function splitList(value) {
  return String(value || '')
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function shellQuote(value) {
  const text = String(value ?? '').trim();
  return /\s/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
}

function updatePreview() {
  $('#argvPreview').textContent = previewArgv();
}

async function copyCommandPreview() {
  await navigator.clipboard.writeText($('#argvPreview').textContent);
  showAlert('已复制 CLI 命令。', 'success');
}

async function runActiveCommand(confirmed) {
  const command = registry.commands[activeCommandId];
  const payload = collectPayload({ confirmed });
  if (command.checkoutConfirm) payload.prepareRunId = lastCheckoutPrepareRunId;

  if (command.write && !confirmed) {
    pendingPayload = payload;
    openConfirm(command, payload);
    return;
  }
  await executePayload(payload);
}

function openConfirm(command, payload) {
  $('#confirmText').textContent = command.checkoutConfirm
    ? '确认下单会提交真实 1688 订单。请确认你已经查看过 checkout prepare 预览。'
    : '该命令会修改账号状态、发送消息或变更购物车。请确认目标和参数。';
  $('#confirmCommand').textContent = previewArgv(payload);
  $('#confirmModal').hidden = false;
}

function closeConfirm() {
  pendingPayload = null;
  $('#confirmModal').hidden = true;
}

async function approveConfirm() {
  const payload = { ...pendingPayload, confirmed: true };
  const command = registry.commands[payload.commandId];
  if (command.checkoutConfirm) payload.prepareRunId = lastCheckoutPrepareRunId;
  closeConfirm();
  await executePayload(payload);
}

async function executePayload(payload) {
  showAlert('命令执行中...', 'info');
  $('#runCommand').disabled = true;
  try {
    const record = await api.runCommand(payload);
    if (record.commandId === 'checkoutPrepare' && record.status === 'success') {
      lastCheckoutPrepareRunId = record.runId;
    }
    renderRecord(record);
    await renderHistory();
  } catch (error) {
    showAlert(error.message || String(error), 'error');
  } finally {
    $('#runCommand').disabled = false;
  }
}

function renderRecord(record) {
  const title = `${commandLabel(record.commandId)}：${statusText(record.status)}`;
  $('#resultCount').textContent = title;
  if (record.status !== 'success') {
    showAlert(errorHint(record), 'error');
  } else {
    showAlert(`执行成功：${record.argv.join(' ')}`, 'success');
  }

  const data = record.stdoutJson;
  const command = registry.commands[record.commandId];
  if (command.resultType === 'products' || command.resultType === 'offers' || command.resultType === 'research' || command.resultType === 'comparison') {
    renderProductResults(record);
  } else if (command.resultType === 'suppliers' || command.resultType === 'supplierInspect') {
    renderSupplierResults(record);
  } else {
    renderGenericResult(record, data);
  }
}

function statusText(status) {
  const map = {
    success: '成功',
    not_logged_in: '未登录',
    risk_control: '风控',
    profile_busy: 'Profile 忙',
    network_error: '网络错误',
    cancelled: '已取消',
    failed: '失败',
  };
  return map[status] || status;
}

function errorHint(record) {
  const hints = {
    not_logged_in: '未登录或登录已过期，请运行“登录”。',
    risk_control: '触发风控，请勾选 headed 后重试，并在浏览器中手动完成验证。',
    profile_busy: '当前 profile 有其他命令运行，请稍后再试。',
    network_error: '网络错误，请检查代理或稍后重试。',
    cancelled: '任务已取消。',
  };
  return record.error?.message || hints[record.status] || '命令执行失败，请查看日志。';
}

function showAlert(message, kind = 'info') {
  const node = $('#statusAlert');
  node.hidden = false;
  node.className = `alert ${kind}`;
  node.textContent = message;
}

function renderProductResults(record) {
  const products = extractProducts(record.stdoutJson, record.commandId);
  $('#resultHost').innerHTML = products.length
    ? products.map((product, index) => productCard(product, index)).join('')
    : `<pre class="json-output">${escapeHtml(JSON.stringify(record.stdoutJson, null, 2))}</pre>`;
  $('#resultCount').textContent = products.length ? `${products.length} 个商品` : '无商品结果';
}

function extractProducts(data, commandId) {
  if (!data) return [];
  if (Array.isArray(data)) return data.flatMap((item) => extractProducts(item, commandId));
  if (data.offers && Array.isArray(data.offers)) return data.offers.map(normalizeProduct);
  if (data.items && Array.isArray(data.items)) {
    return data.items
      .map((item) => item.offer || item.summary || item.enriched || item)
      .filter(Boolean)
      .map(normalizeProduct);
  }
  if (data.offerId || data.title || data.skus) return [normalizeProduct(data)];
  return [];
}

function normalizeProduct(raw) {
  const offer = raw.summary || raw;
  const skus = Array.isArray(offer.skus) ? offer.skus : [];
  const packageInfo = Array.isArray(offer.packageInfo) ? offer.packageInfo : [];
  const firstPkg = packageInfo[0] || {};
  return {
    offerId: offer.offerId || raw.offerId || '',
    title: offer.title || offer.name || raw.title || '未识别商品',
    image: normalizeUrl(offer.mainImage || offer.image || (offer.images || [])[0]),
    supplier: offer.supplier?.name || offer.supplierName || raw.supplier?.name || '-',
    location: [offer.location?.province || offer.freight?.province, offer.location?.city || offer.freight?.city].filter(Boolean).join(' / ') || '-',
    priceRange: offer.priceRange || offer.price?.text || priceText(offer),
    stock: sum(skus.map((sku) => sku.stock)),
    attrCount: Array.isArray(offer.attributes) ? offer.attributes.length : 0,
    category: offer.categoryId ? `1688类目 ${offer.categoryId}` : offer.bizType || '-',
    dimensions: {
      length: firstPkg.length ?? '-',
      width: firstPkg.width ?? '-',
      height: firstPkg.height ?? '-',
      weight: firstPkg.weight ?? '-',
    },
    missing: missingFields(offer, firstPkg),
    skus: skus.length
      ? skus.map((sku) => ({
          name: sku.specs || sku.skuId || '默认 SKU',
          price: sku.price ?? sku.multiPrice ?? '-',
          stock: sku.stock ?? '-',
          ozon: '待生成',
        }))
      : [{ name: '默认商品', price: priceText(offer), stock: '-', ozon: '待生成' }],
  };
}

function priceText(offer) {
  if (offer.priceMin !== undefined || offer.priceMax !== undefined) {
    const min = offer.priceMin ?? offer.priceMax;
    const max = offer.priceMax ?? offer.priceMin;
    return min === max ? `¥${min}` : `¥${min} - ¥${max}`;
  }
  return '-';
}

function missingFields(offer, pkg) {
  const missing = [];
  if (!offer.mainImage && !offer.image && !(offer.images || []).length) missing.push('图片');
  for (const [key, label] of [
    ['length', '长(cm)'],
    ['width', '宽(cm)'],
    ['height', '高(cm)'],
    ['weight', '重量(g)'],
  ]) {
    if (!pkg || pkg[key] === null || pkg[key] === undefined || pkg[key] === '') missing.push(label);
  }
  return missing;
}

function normalizeUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  if (value.startsWith('//')) return `https:${value}`;
  return value;
}

function sum(values) {
  const nums = values.map(Number).filter((value) => Number.isFinite(value));
  return nums.length ? nums.reduce((a, b) => a + b, 0) : '-';
}

function productCard(product, index) {
  const missing = product.missing.length ? `<div class="missing-row">缺失字段：${product.missing.join('、')}</div>` : '';
  return `
    <article class="product-card ${index === 0 ? 'selected' : ''}">
      <div class="card-main">
        <div class="image-frame">${product.image ? `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.title)}" />` : '未采到主图'}</div>
        <div>
          <div class="card-title-row">
            <span class="index-badge">#${index + 1}</span>
            <h4 class="product-title">${escapeHtml(product.title)}</h4>
            <span class="status-badge ${product.missing.length ? 'partial' : 'ok'}">${product.missing.length ? '部分字段' : '完整'}</span>
          </div>
          <div class="meta-line">
            <span>Offer ID：${escapeHtml(product.offerId)}</span>
            <span>供应商：${escapeHtml(product.supplier)}</span>
            <span>${escapeHtml(product.location)}</span>
            <span>${escapeHtml(product.category)}</span>
          </div>
          <div class="metric-grid">
            ${metric('SKU 数', product.skus.length)}
            ${metric('价格', product.priceRange, 'hot')}
            ${metric('库存', formatNumber(product.stock))}
            ${metric('属性数', product.attrCount)}
            ${metric('长(cm)', product.dimensions.length)}
            ${metric('宽(cm)', product.dimensions.width)}
            ${metric('高(cm)', product.dimensions.height)}
            ${metric('重量(g)', product.dimensions.weight)}
          </div>
          ${missing}
        </div>
      </div>
      <div class="sku-panel">
        ${product.skus
          .map(
            (sku) => `
              <div class="sku-row">
                <div class="sku-name">${escapeHtml(sku.name)}</div>
                <div class="sku-muted">¥${escapeHtml(sku.price)}</div>
                <div class="sku-muted">库存 ${formatNumber(sku.stock)}</div>
                <div class="sku-muted">Ozon：${escapeHtml(sku.ozon)}</div>
              </div>
            `,
          )
          .join('')}
      </div>
    </article>
  `;
}

function metric(label, value, variant = '') {
  return `<div class="metric ${variant}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(formatNumber(value))}</strong></div>`;
}

function renderSupplierResults(record) {
  const suppliers = extractSuppliers(record.stdoutJson);
  $('#resultHost').innerHTML = suppliers.length
    ? suppliers.map((supplier, index) => supplierCard(supplier, index)).join('')
    : `<pre class="json-output">${escapeHtml(JSON.stringify(record.stdoutJson, null, 2))}</pre>`;
  $('#resultCount').textContent = suppliers.length ? `${suppliers.length} 个供应商` : '无供应商结果';
}

function extractSuppliers(data) {
  if (!data) return [];
  if (data.items && Array.isArray(data.items)) return data.items.map((item) => item.supplier || item.inspect?.supplier || item).map(normalizeSupplier);
  if (data.supplier) return [normalizeSupplier({ ...data.supplier, factory: data.factory, trust: data.trust, offers: data.offers })];
  return [];
}

function normalizeSupplier(raw) {
  return {
    name: raw.companyName || raw.name || '未识别供应商',
    loginId: raw.loginId || '-',
    location: [raw.location?.province, raw.location?.city || raw.factory?.location].filter(Boolean).join(' / ') || '-',
    years: raw.tp?.serviceYears ?? raw.factory?.tpYears ?? '-',
    factory: raw.factory?.isFactory || raw.factory?.shiliFactory || raw.factory?.superFactory ? '工厂' : '未确认',
    repeatRate: raw.service?.repeatRate ?? raw.trust?.retentionRate ?? '-',
    responseRate: raw.service?.wwResponseRate ?? '-',
    tags: raw.tags || raw.factory?.tags || [],
    offers: raw.offersPreview || [],
  };
}

function supplierCard(supplier, index) {
  return `
    <article class="supplier-card">
      <div class="card-title-row">
        <span class="index-badge">#${index + 1}</span>
        <h4 class="product-title">${escapeHtml(supplier.name)}</h4>
        <span class="status-badge ${supplier.factory === '工厂' ? 'ok' : 'partial'}">${escapeHtml(supplier.factory)}</span>
      </div>
      <div class="metric-grid">
        ${metric('Login ID', supplier.loginId)}
        ${metric('地区', supplier.location)}
        ${metric('服务年限', supplier.years)}
        ${metric('复购率', supplier.repeatRate)}
        ${metric('响应率', supplier.responseRate)}
        ${metric('标签', supplier.tags.slice(0, 3).join('、') || '-')}
      </div>
      <div class="sku-panel">
        ${(supplier.offers || [])
          .slice(0, 4)
          .map(
            (offer) => `
              <div class="sku-row">
                <div class="sku-name">${escapeHtml(offer.title || '-')}</div>
                <div class="sku-muted">${escapeHtml(offer.price?.text || '-')}</div>
                <div class="sku-muted">${escapeHtml(offer.offerId || '-')}</div>
                <div class="sku-muted">${escapeHtml(offer.brief || '')}</div>
              </div>
            `,
          )
          .join('')}
      </div>
    </article>
  `;
}

function renderGenericResult(record, data) {
  if (Array.isArray(data)) {
    $('#resultHost').innerHTML = renderTable(data);
  } else if (data && typeof data === 'object') {
    const array = firstArray(data);
    $('#resultHost').innerHTML = array ? renderTable(array) : `<pre class="json-output">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  } else {
    $('#resultHost').innerHTML = `<pre class="json-output">${escapeHtml(data || record.stderrText || '无输出')}</pre>`;
  }
}

function firstArray(data) {
  for (const value of Object.values(data || {})) {
    if (Array.isArray(value)) return value;
  }
  return null;
}

function renderTable(items) {
  if (!items.length) return '<p class="empty-state">没有结果。</p>';
  const keys = [...new Set(items.flatMap((item) => Object.keys(item || {}).slice(0, 8)))].slice(0, 8);
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${keys.map((key) => `<th>${escapeHtml(key)}</th>`).join('')}</tr></thead>
        <tbody>
          ${items
            .map(
              (item) => `
                <tr>${keys
                  .map((key) => `<td>${escapeHtml(formatCell(item?.[key]))}</td>`)
                  .join('')}</tr>
              `,
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function formatCell(value) {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

async function renderHistory() {
  const history = await api.getHistory({ limit: 12 });
  $('#historyList').innerHTML = history.length
    ? history
        .map(
          (item) => `
            <button class="history-item" type="button" data-run-id="${item.runId}">
              <strong>${escapeHtml(commandLabel(item.commandId))}</strong>
              <span>${escapeHtml(statusText(item.status))} · ${escapeHtml(new Date(item.startedAt).toLocaleString())}</span>
            </button>
          `,
        )
        .join('')
    : '<span class="muted-text">暂无历史。</span>';
  document.querySelectorAll('[data-run-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const items = await api.getHistory({ limit: 100 });
      const record = items.find((item) => item.runId === button.dataset.runId);
      if (record) renderRecord(record);
    });
  });
}

async function refreshRuntime() {
  const profile = $('#profileInput').value.trim() || 'default';
  $('#profileState').textContent = profile;
  $('#cliState').textContent = '检测中';
  $('#cliState').className = 'muted';
  $('#daemonState').textContent = '检测中';
  $('#daemonState').className = 'muted';
  try {
    const status = await api.getRuntimeStatus(profile);
    $('#cliState').textContent = status.account?.status === 'not_logged_in' ? '未登录' : '已连接';
    $('#cliState').className = status.account?.status === 'not_logged_in' ? 'warn' : '';
    const daemonRecord = status.daemon;
    const daemonData = daemonRecord?.stdoutJson;
    if (daemonRecord?.status === 'timeout') {
      $('#daemonState').textContent = '检测超时';
      $('#daemonState').className = 'warn';
      return;
    }
    $('#daemonState').textContent = daemonData?.running ? '运行中' : '未运行';
    $('#daemonState').className = daemonData?.running ? '' : 'warn';
  } catch (error) {
    $('#cliState').textContent = '异常';
    $('#cliState').className = 'warn';
    $('#daemonState').textContent = '待检查';
    $('#daemonState').className = 'warn';
  }
}

init().catch((error) => {
  showAlert(error.stack || error.message || String(error), 'error');
});
