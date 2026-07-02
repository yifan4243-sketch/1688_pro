const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = 'ozon_settings.json';
const CATEGORY_TREE_FILE = 'ozon_category_tree.json';

function settingsPath(userDataPath) {
  return path.join(userDataPath, SETTINGS_FILE);
}

function categoryTreePath(userDataPath) {
  return path.join(userDataPath, CATEGORY_TREE_FILE);
}

function defaultSettings() {
  return {
    ai: {
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKey: '',
    },
    ozon: {
      clientId: '',
      apiKey: '',
      shopName: '',
      currencyCode: 'CNY',
      isDefaultShop: false,
      note: '',
      defaultDescriptionCategoryId: '',
      defaultTypeId: '',
      defaultCategoryPath: '',
      defaultWarehouseId: '',
      enableRealSubmit: false,
    },
  };
}

function publicSettings(settings) {
  return {
    ai: {
      provider: settings.ai.provider,
      baseUrl: settings.ai.baseUrl,
      model: settings.ai.model,
      apiKeySet: Boolean(settings.ai.apiKey),
    },
    ozon: {
      clientId: settings.ozon.clientId,
      apiKeySet: Boolean(settings.ozon.apiKey),
      shopName: settings.ozon.shopName,
      currencyCode: settings.ozon.currencyCode,
      isDefaultShop: Boolean(settings.ozon.isDefaultShop),
      note: settings.ozon.note,
      defaultDescriptionCategoryId: settings.ozon.defaultDescriptionCategoryId,
      defaultTypeId: settings.ozon.defaultTypeId,
      defaultCategoryPath: settings.ozon.defaultCategoryPath,
      defaultWarehouseId: settings.ozon.defaultWarehouseId,
      enableRealSubmit: Boolean(settings.ozon.enableRealSubmit),
    },
  };
}

function loadSettings(userDataPath, { includeSecrets = false } = {}) {
  const fallback = defaultSettings();
  const file = settingsPath(userDataPath);
  if (!fs.existsSync(file)) return includeSecrets ? fallback : publicSettings(fallback);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const merged = mergeSettings(fallback, raw);
    return includeSecrets ? merged : publicSettings(merged);
  } catch {
    return includeSecrets ? fallback : publicSettings(fallback);
  }
}

function saveSettings(userDataPath, patch = {}) {
  const current = loadSettings(userDataPath, { includeSecrets: true });
  const next = mergeSettings(current, patch);
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(settingsPath(userDataPath), JSON.stringify(next, null, 2), 'utf8');
  return publicSettings(next);
}

async function getStoreStats(userDataPath) {
  const settings = loadSettings(userDataPath, { includeSecrets: true });
  const shop = settings.ozon || {};
  const store = {
    id: shop.clientId || '',
    clientId: shop.clientId || '',
    shopName: shop.shopName || '',
    currencyCode: shop.currencyCode || 'CNY',
    isDefaultShop: Boolean(shop.isDefaultShop),
    note: shop.note || '',
    apiKeySet: Boolean(shop.apiKey),
  };

  if (!shop.clientId || !shop.apiKey) {
    return {
      ok: false,
      store,
      quota: null,
      message: '请先在「添加店铺」中保存 Client ID 和 API 密钥。',
      fetchedAt: new Date().toISOString(),
    };
  }

  // Step 1: connectivity check via /v1/seller/info
  const sellerInfo = await callOzonSellerApi(shop, '/v1/seller/info', {});
  const connection = {
    ok: sellerInfo.ok,
    endpoint: '/v1/seller/info',
    message: sellerInfo.ok ? 'Ozon API 已连通' : `Seller API 请求失败 (HTTP ${sellerInfo.data?.status || '?'})`,
  };

  // Step 2: product upload quota via /v4/product/info/limit
  let quota = null;
  let quotaStatus = 'not_requested';
  let quotaEndpoint = '/v4/product/info/limit';
  let quotaRaw = null;

  if (sellerInfo.ok) {
    const limitResp = await callOzonSellerApi(shop, quotaEndpoint, {}).catch(() => null);
    if (limitResp && limitResp.ok && limitResp.data) {
      quotaRaw = limitResp.data;
      const daily = limitResp.data.daily_create || {};
      const total = limitResp.data.total || {};
      const dailyLimit = daily.limit;
      const dailyUsage = daily.usage;
      const remaining = (dailyLimit === -1 || dailyLimit == null) ? null
        : (dailyUsage != null ? dailyLimit - dailyUsage : dailyLimit);

      if (remaining != null || dailyLimit != null || total.limit != null) {
        quota = {
          remaining,
          limit: dailyLimit === -1 ? null : dailyLimit,
          used: dailyUsage,
          dailyResetAt: daily.reset_at || null,
          totalLimit: total.limit === -1 ? null : total.limit,
          totalUsage: total.usage,
          source: 'ProductAPI_GetUploadQuota',
          endpoint: quotaEndpoint,
          raw: quotaRaw,
        };
        quotaStatus = 'available';
      } else {
        quotaStatus = 'not_found';
      }
    } else {
      quotaStatus = 'not_supported';
    }
  } else {
    quotaStatus = 'error';
  }

  // Debug dump (no API key exposure)
  try {
    const debug = {
      fetchedAt: new Date().toISOString(),
      connection,
      quotaRaw: quotaRaw ? { daily_create: quotaRaw.daily_create, total: quotaRaw.total } : null,
      quotaStatus,
      quota,
    };
    fs.writeFileSync(
      path.join(userDataPath, 'ozon_store_stats_debug.json'),
      JSON.stringify(debug, null, 2),
      'utf8',
    );
  } catch {}

  return {
    ok: connection.ok,
    store,
    connection,
    quota,
    quotaStatus,
    message: quota
      ? `今日还能上架 ${quota.remaining ?? quota.limit ?? '?'} 个商品`
      : quotaStatus === 'not_supported'
        ? 'Ozon 已连通，但 /v4/product/info/limit 未返回额度字段。'
        : quotaStatus === 'not_found'
          ? '已请求额度接口但响应中未包含有效字段。'
          : quotaStatus === 'error'
            ? '请检查 Client ID 和 API Key 是否正确。'
            : '未请求额度接口。',
    operationId: 'ProductAPI_GetUploadQuota',
    fetchedAt: new Date().toISOString(),
  };
}

async function callOzonSellerApi(ozon, endpoint, body) {
  const response = await fetch(`https://api-seller.ozon.ru${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-Id': ozon.clientId,
      'Api-Key': ozon.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body || {}),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) {
    return { ok: false, data: { status: response.status, response: data } };
  }
  return { ok: true, data };
}

async function getCategoryTree(userDataPath, options = {}) {
  const forceRefresh = options.forceRefresh === true;
  const language = clean(options.language, 'ZH_HANS') || 'ZH_HANS';
  const cached = readCategoryTreeCache(userDataPath);

  if (cached && !forceRefresh) {
    return categoryTreeResponse(cached, 'cache', '已使用本地 Ozon 类目树缓存。');
  }

  const settings = loadSettings(userDataPath, { includeSecrets: true });
  const shop = settings.ozon || {};

  if (!shop.clientId || !shop.apiKey) {
    const fallback = defaultCategoryTreeFromSettings(settings);
    if (fallback) {
      return categoryTreeResponse(fallback, 'settings', 'Ozon 店铺未绑定，已使用设置中的默认类目。');
    }
    if (cached) {
      return categoryTreeResponse(cached, 'cache', 'Ozon 店铺未绑定，已使用本地缓存。');
    }
    return categoryTreeResponse({ result: [] }, 'empty', '请先绑定 Ozon Client ID 和 API Key 后同步类目树。', false);
  }

  const response = await callOzonSellerApi(shop, '/v1/description-category/tree', { language });
  if (!response.ok) {
    if (cached) {
      return categoryTreeResponse(cached, 'cache', `同步类目树失败，已使用本地缓存：HTTP ${response.data?.status || '?'}`);
    }
    return categoryTreeResponse(
      { result: [] },
      'error',
      `同步 Ozon 类目树失败：HTTP ${response.data?.status || '?'} ${safeJson(response.data?.response || response.data)}`,
      false,
    );
  }

  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(categoryTreePath(userDataPath), JSON.stringify(response.data, null, 2), 'utf8');
  return categoryTreeResponse(response.data, 'api', 'Ozon 类目树已同步。');
}

async function searchCategories(userDataPath, query = '', options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 30), 80));
  const treeResponse = await getCategoryTree(userDataPath, {
    forceRefresh: options.forceRefresh,
    language: options.language,
  });
  const entries = Array.isArray(treeResponse.items) ? treeResponse.items : [];
  const q = clean(query, '').toLowerCase();
  const tokens = q.split(/\s+/).map((item) => item.trim()).filter(Boolean);
  const scored = [];

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const haystack = String(entry.searchIndex || entry.path || '').toLowerCase();
    let score = q ? 0 : Math.max(1, 1000 - index);
    for (const token of tokens) {
      if (!token) continue;
      if (String(entry.keyword || '').toLowerCase() === token) score += 24;
      if (String(entry.path || '').toLowerCase().includes(token)) score += 12;
      if (haystack.includes(token)) score += 6;
    }
    if (!q || score > 0) scored.push({ score, index, entry });
  }

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return {
    ok: treeResponse.ok,
    source: treeResponse.source,
    message: treeResponse.message,
    items: scored.slice(0, limit).map((item) => item.entry),
    total: entries.length,
    fetchedAt: treeResponse.fetchedAt,
  };
}

async function getCategoryAttributes(userDataPath, params = {}) {
  const descriptionCategoryId = Number(params.descriptionCategoryId || params.description_category_id || 0);
  const typeId = Number(params.typeId || params.type_id || 0);
  const language = clean(params.language, 'ZH_HANS') || 'ZH_HANS';

  if (!descriptionCategoryId || !typeId) {
    throw new Error('请选择带 description_category_id 和 type_id 的 Ozon 类目。');
  }

  const settings = loadSettings(userDataPath, { includeSecrets: true });
  const shop = settings.ozon || {};
  if (!shop.clientId || !shop.apiKey) {
    throw new Error('加载 Ozon 类目特征需要先绑定 Client ID 和 API Key。');
  }

  const response = await callOzonSellerApi(shop, '/v1/description-category/attribute', {
    description_category_id: descriptionCategoryId,
    type_id: typeId,
    language,
  });
  if (!response.ok) {
    throw new Error(`加载 Ozon 类目特征失败：HTTP ${response.data?.status || '?'} ${safeJson(response.data?.response || response.data)}`);
  }

  const attributes = normalizeCategoryAttributes(response.data);
  return {
    ok: true,
    descriptionCategoryId,
    typeId,
    attributes,
    requiredCount: attributes.filter((attr) => attr.isRequired).length,
    raw: response.data,
    fetchedAt: new Date().toISOString(),
  };
}

function extractQuota(data) {
  const found = findQuotaObject(data);
  if (!found) return null;
  const remaining = pickNumber(found, ['remaining', 'left', 'available', 'available_count', 'daily_available', 'limit_left', 'remain', 'create_available']);
  const limit = pickNumber(found, ['limit', 'total', 'daily_limit', 'max', 'create_limit']);
  const used = pickNumber(found, ['used', 'current', 'created', 'count', 'daily_used']);
  return {
    remaining,
    limit,
    used,
    source: found.path,
    raw: found.value,
  };
}

function findQuotaObject(value, pathName = '') {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const nested = findQuotaObject(value[i], `${pathName}[${i}]`);
      if (nested) return nested;
    }
    return null;
  }
  const obj = value;
  const keys = Object.keys(obj);
  const quotaLike = keys.some((key) => /quota|limit|remain|available|create|import/i.test(key));
  if (quotaLike && keys.some((key) => typeof obj[key] === 'number' || /^\d+$/.test(String(obj[key] ?? '')))) {
    return { path: pathName || 'root', value: obj };
  }
  for (const key of keys) {
    const nested = findQuotaObject(obj[key], pathName ? `${pathName}.${key}` : key);
    if (nested) return nested;
  }
  return null;
}

function readCategoryTreeCache(userDataPath) {
  const file = categoryTreePath(userDataPath);
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function categoryTreeResponse(tree, source, message, ok = true) {
  const items = flattenCategoryTree(tree);
  return {
    ok,
    source,
    message,
    tree,
    items,
    total: items.length,
    fetchedAt: new Date().toISOString(),
  };
}

function defaultCategoryTreeFromSettings(settings) {
  const shop = settings.ozon || {};
  const desc = Number(shop.defaultDescriptionCategoryId || 0);
  const type = Number(shop.defaultTypeId || 0);
  if (!desc || !type) return null;
  const name = shop.defaultCategoryPath || `默认 Ozon 类目 ${desc}/${type}`;
  return {
    result: [{
      description_category_id: desc,
      category_name: name,
      disabled: false,
      children: [{
        description_category_id: desc,
        type_id: type,
        type_name: name,
        disabled: false,
        children: [],
      }],
    }],
  };
}

function flattenCategoryTree(tree) {
  const entries = [];
  for (const root of treeRoots(tree)) {
    walkCategoryNode(root, [], null, entries);
  }
  return entries;
}

function treeRoots(tree) {
  if (!tree || typeof tree !== 'object') return [];
  for (const key of ['result', 'items', 'categories']) {
    const value = tree[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      const nested = treeRoots(value);
      if (nested.length) return nested;
    }
  }
  if (tree.data && typeof tree.data === 'object') return treeRoots(tree.data);
  return [];
}

function walkCategoryNode(node, parents, inheritedDescriptionCategoryId, entries) {
  if (!node || typeof node !== 'object' || node.disabled === true) return;
  const name = clean(node.category_name || node.type_name, '');
  const descriptionCategoryId = node.description_category_id || inheritedDescriptionCategoryId;
  const pathParts = name ? [...parents, name] : [...parents];
  const typeId = Number(node.type_id || 0);

  if (typeId && Number(descriptionCategoryId || 0)) {
    const pathText = pathParts.join(' / ');
    entries.push({
      keyword: name || pathText,
      path: pathText,
      typeId,
      type_id: typeId,
      descriptionCategoryId: Number(descriptionCategoryId),
      description_category_id: Number(descriptionCategoryId),
      disabled: false,
      searchIndex: `${pathText} ${typeId} ${descriptionCategoryId}`,
    });
  }

  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    walkCategoryNode(child, pathParts, descriptionCategoryId, entries);
  }
}

function normalizeCategoryAttributes(data) {
  const raw = Array.isArray(data?.result) ? data.result
    : Array.isArray(data?.attributes) ? data.attributes
      : Array.isArray(data?.result?.attributes) ? data.result.attributes
        : [];
  return raw
    .map((attr) => ({
      id: Number(attr?.id || attr?.attribute_id || 0),
      name: clean(attr?.name || attr?.attribute_name || attr?.id, ''),
      description: clean(attr?.description, ''),
      groupId: Number(attr?.group_id || 0) || null,
      groupName: clean(attr?.group_name, ''),
      dictionaryId: Number(attr?.dictionary_id || 0) || 0,
      isRequired: attr?.is_required === true || attr?.required === true,
      isAspect: attr?.is_aspect === true,
      isCollection: attr?.is_collection === true,
      maxValueCount: Number(attr?.max_value_count || 1) || 1,
      categoryDependent: attr?.category_dependent === true,
      attributeComplexId: Number(attr?.attribute_complex_id || 0) || 0,
      complexIsCollection: attr?.complex_is_collection === true,
    }))
    .filter((attr) => attr.id > 0 && attr.name)
    .sort((a, b) => Number(b.isRequired) - Number(a.isRequired) || a.id - b.id);
}

function pickNumber(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function mergeSettings(base, patch) {
  return {
    ai: {
      provider: clean(patch?.ai?.provider, base.ai.provider),
      baseUrl: clean(patch?.ai?.baseUrl, base.ai.baseUrl),
      model: clean(patch?.ai?.model, base.ai.model),
      apiKey: patch?.ai?.apiKey === undefined ? base.ai.apiKey : clean(patch.ai.apiKey, ''),
    },
    ozon: {
      clientId: clean(patch?.ozon?.clientId, base.ozon.clientId),
      apiKey: patch?.ozon?.apiKey === undefined ? base.ozon.apiKey : clean(patch.ozon.apiKey, ''),
      shopName: clean(patch?.ozon?.shopName, base.ozon.shopName),
      currencyCode: clean(patch?.ozon?.currencyCode, base.ozon.currencyCode || 'CNY'),
      isDefaultShop: patch?.ozon?.isDefaultShop === undefined ? Boolean(base.ozon.isDefaultShop) : Boolean(patch.ozon.isDefaultShop),
      note: clean(patch?.ozon?.note, base.ozon.note || '').slice(0, 200),
      defaultDescriptionCategoryId: clean(patch?.ozon?.defaultDescriptionCategoryId, base.ozon.defaultDescriptionCategoryId),
      defaultTypeId: clean(patch?.ozon?.defaultTypeId, base.ozon.defaultTypeId),
      defaultCategoryPath: clean(patch?.ozon?.defaultCategoryPath, base.ozon.defaultCategoryPath),
      defaultWarehouseId: clean(patch?.ozon?.defaultWarehouseId, base.ozon.defaultWarehouseId || ''),
      enableRealSubmit: patch?.ozon?.enableRealSubmit === undefined ? Boolean(base.ozon.enableRealSubmit) : Boolean(patch.ozon.enableRealSubmit),
    },
  };
}

function clean(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

module.exports = {
  loadSettings,
  saveSettings,
  getStoreStats,
  getCategoryTree,
  searchCategories,
  getCategoryAttributes,
};
