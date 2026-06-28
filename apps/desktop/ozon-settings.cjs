const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = 'ozon_settings.json';

function settingsPath(userDataPath) {
  return path.join(userDataPath, SETTINGS_FILE);
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
    },
  };
}

function clean(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

module.exports = { loadSettings, saveSettings, getStoreStats };
