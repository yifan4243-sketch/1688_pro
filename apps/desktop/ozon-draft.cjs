const crypto = require('crypto');

const ATTR_MODEL_NAME = 9048;
const ATTR_DESCRIPTION = 4191;
const ATTR_TAGS = 23171;

async function generateOzonDraft(settings, rows = []) {
  const sourceRows = Array.isArray(rows) ? rows.filter((row) => row && typeof row === 'object') : [];
  if (!sourceRows.length) throw new Error('没有可生成 Ozon 草稿的 1688 SKU 数据。');
  if (!settings.ai.apiKey) throw new Error('DeepSeek API Key 未配置。');

  const candidates = defaultCategoryCandidates(settings);
  const generated = await callAi(settings.ai, buildMessages(sourceRows, candidates));
  const normalized = normalizeGenerated(generated, candidates);
  const items = sourceRows.map((row, index) => buildOzonItem(row, normalized, settings, index));
  const missing = collectDraftMissing(items);

  return {
    draftId: `ozon-draft-${Date.now()}`,
    status: missing.length ? 'needs_review' : 'ready',
    sourceRows,
    generated: normalized,
    items,
    missing,
    createdAt: new Date().toISOString(),
  };
}

async function submitOzonDraft(settings, draft) {
  if (!settings.ozon.clientId || !settings.ozon.apiKey) {
    throw new Error('Ozon Client-Id 或 API-Key 未配置。');
  }
  const items = Array.isArray(draft?.items) ? draft.items : [];
  if (!items.length) throw new Error('草稿中没有可提交的 Ozon 商品。');
  const missing = collectDraftMissing(items);
  if (missing.length) throw new Error(`草稿缺少必填项：${missing.join('、')}`);

  const response = await fetch('https://api-seller.ozon.ru/v3/product/import', {
    method: 'POST',
    headers: {
      'Client-Id': settings.ozon.clientId,
      'Api-Key': settings.ozon.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ items }),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) {
    throw new Error(`Ozon 上架失败：HTTP ${response.status} ${JSON.stringify(data)}`);
  }
  return {
    ok: true,
    transport: 'ozon_seller_api',
    operationId: 'ProductAPI_ImportProductsV3',
    result: data,
    submittedAt: new Date().toISOString(),
  };
}

function defaultCategoryCandidates(settings) {
  const desc = toInt(settings.ozon.defaultDescriptionCategoryId);
  const type = toInt(settings.ozon.defaultTypeId);
  if (!desc || !type) return [];
  return [{
    candidate_index: 0,
    description_category_id: desc,
    type_id: type,
    path: settings.ozon.defaultCategoryPath || '默认 Ozon 类目',
  }];
}

function buildMessages(rows, candidates) {
  const payload = {
    task: 'generate_ozon_listing_from_1688_desktop',
    required_schema: {
      title_ru: 'string, 45-90 chars',
      model_name: 'string',
      description_ru: 'string, Russian, 4 paragraphs',
      tags: ['20 Russian search phrases'],
      matched_category: {
        candidate_index: 'integer if candidates are provided',
        description_category_id: 'integer',
        type_id: 'integer',
        path: 'string',
      },
      estimated_dimensions: {
        length_cm: 'number',
        width_cm: 'number',
        height_cm: 'number',
        weight_g: 'number',
      },
    },
    rules: [
      'Return JSON only. No Markdown.',
      'Write natural Russian Ozon listing content from the provided 1688 facts.',
      'Do not keep Chinese text in title_ru, description_ru, or tags.',
      'Do not invent brand, certification, warranty, or exact materials if not present.',
      'If source dimensions are missing, estimate reasonable packed dimensions.',
      'If category candidates are provided, choose one of them.',
    ],
    source_rows: rows.slice(0, 8),
    category_candidates: candidates,
  };
  return [
    {
      role: 'system',
      content: 'You are a Russian Ozon marketplace product card editor. Generate compliant JSON only.',
    },
    { role: 'user', content: JSON.stringify(payload) },
  ];
}

async function callAi(ai, messages) {
  const endpoint = chatEndpoint(ai.baseUrl);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ai.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ai.model || 'deepseek-chat',
      messages,
      temperature: 0.35,
      response_format: { type: 'json_object' },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`AI 生成失败：HTTP ${response.status} ${JSON.stringify(data)}`);
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI 响应为空。');
  return parseJsonObject(content);
}

function chatEndpoint(baseUrl) {
  const url = String(baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  if (url.endsWith('/chat/completions')) return url;
  if (url.endsWith('/v1')) return `${url}/chat/completions`;
  return `${url}/chat/completions`;
}

function parseJsonObject(text) {
  const raw = String(text || '').trim();
  try { return JSON.parse(raw); } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 未返回 JSON 对象。');
  return JSON.parse(match[0]);
}

function normalizeGenerated(data, candidates) {
  const matched = data?.matched_category && typeof data.matched_category === 'object'
    ? data.matched_category
    : {};
  const candidateIndex = toInt(matched.candidate_index);
  const candidate = candidateIndex !== null && candidates[candidateIndex] ? candidates[candidateIndex] : null;
  const tags = Array.isArray(data?.tags) ? data.tags.map((item) => String(item).trim()).filter(Boolean) : [];
  return {
    title_ru: String(data?.title_ru || '').trim().slice(0, 500),
    model_name: String(data?.model_name || '').trim().slice(0, 200),
    description_ru: String(data?.description_ru || '').trim().slice(0, 4000),
    tags: tags.slice(0, 20),
    matched_category: {
      description_category_id: toInt(matched.description_category_id) || candidate?.description_category_id || 0,
      type_id: toInt(matched.type_id) || candidate?.type_id || 0,
      path: String(matched.path || candidate?.path || '').trim(),
    },
    estimated_dimensions: {
      length_cm: positiveNumber(data?.estimated_dimensions?.length_cm),
      width_cm: positiveNumber(data?.estimated_dimensions?.width_cm),
      height_cm: positiveNumber(data?.estimated_dimensions?.height_cm),
      weight_g: positiveNumber(data?.estimated_dimensions?.weight_g),
    },
  };
}

function buildOzonItem(row, generated, settings, index) {
  const images = imageUrls(row);
  const category = generated.matched_category || {};
  const dims = generated.estimated_dimensions || {};
  const depth = positiveNumber(row.length_cm) || positiveNumber(dims.length_cm) || 0;
  const width = positiveNumber(row.width_cm) || positiveNumber(dims.width_cm) || 0;
  const height = positiveNumber(row.height_cm) || positiveNumber(dims.height_cm) || 0;
  const weight = positiveNumber(row.weight_g) || positiveNumber(dims.weight_g) || 0;
  const attrs = [];
  addAttribute(attrs, ATTR_MODEL_NAME, generated.model_name || generated.title_ru);
  addAttribute(attrs, ATTR_DESCRIPTION, generated.description_ru);
  addAttribute(attrs, ATTR_TAGS, generated.tags.join('\n'));
  return {
    name: generated.title_ru || String(row.product_title || row.sku_name || '').slice(0, 500),
    offer_id: stableOfferId(row, index),
    price: String(Math.max(positiveNumber(row.sku_price) || 0, 1)),
    old_price: '0',
    vat: '0',
    currency_code: settings.ozon.currencyCode || 'CNY',
    description_category_id: Number(category.description_category_id || settings.ozon.defaultDescriptionCategoryId || 0),
    type_id: Number(category.type_id || settings.ozon.defaultTypeId || 0),
    barcode: '',
    images,
    primary_image: images[0] || '',
    dimension_unit: 'cm',
    depth: numberForOzon(depth),
    width: numberForOzon(width),
    height: numberForOzon(height),
    weight_unit: 'g',
    weight: numberForOzon(weight),
    attributes: attrs,
    complex_attributes: [],
    _source: 'desktop_ai_draft',
    _category_path: category.path || settings.ozon.defaultCategoryPath || '',
  };
}

function collectDraftMissing(items) {
  const missing = new Set();
  for (const item of items) {
    if (!item.name) missing.add('俄语标题');
    if (!item.primary_image) missing.add('主图');
    if (!item.description_category_id || !item.type_id) missing.add('Ozon 类目');
    if (!Number(item.price)) missing.add('价格');
    for (const [key, label] of [['depth', '长'], ['width', '宽'], ['height', '高'], ['weight', '重量']]) {
      if (!Number(item[key])) missing.add(label);
    }
  }
  return Array.from(missing);
}

function imageUrls(row) {
  const out = [];
  for (const key of ['sku_image_url', 'main_image_url', 'default_main_image_url']) pushImage(out, row[key]);
  for (const key of ['gallery_non_video_image_urls', 'gallery_image_urls', 'additional_image_urls', 'sku_image_candidates']) {
    if (Array.isArray(row[key])) row[key].forEach((item) => pushImage(out, item));
  }
  return out.slice(0, 15);
}

function pushImage(out, value) {
  let url = String(value || '').trim();
  if (!url) return;
  if (url.startsWith('//')) url = `https:${url}`;
  if (/^https?:\/\//.test(url) && !out.includes(url)) out.push(url);
}

function addAttribute(attrs, id, value) {
  const text = String(value || '').trim();
  if (!text) return;
  attrs.push({
    id,
    complex_id: 0,
    values: text.split(/\n+/).map((line) => ({ value: line.trim() })).filter((item) => item.value),
  });
}

function stableOfferId(row, index) {
  const raw = [row.detail_url, row.product_title, row.sku_name, index].map((item) => String(item || '')).join('|');
  return `1688-${crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16)}`;
}

function positiveNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  const match = String(value || '').match(/\d+(?:\.\d+)?/);
  if (!match) return 0;
  const number = Number(match[0]);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function numberForOzon(value) {
  const number = positiveNumber(value);
  return number ? Math.max(1, Math.round(number)) : 0;
}

function toInt(value) {
  const number = Number(String(value ?? '').trim());
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

module.exports = { generateOzonDraft, submitOzonDraft, collectDraftMissing };
