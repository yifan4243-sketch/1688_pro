const celData = require('./pricing-data/cel-shipping-2026-07-21.json');
const commissionData = require('./pricing-data/ozon-rfbs-commission-2026-08-28.json');

const PLATFORM_SERVICE_RATE = 0.01;
const DEFAULT_PRICING_SETTINGS = Object.freeze({
  otherFeeRate: 0.10,
  targetProfitRate: 0.20,
  labelFeeCny: 2,
  shippingSpeed: 'economy',
  handoffMode: 'pickup',
});
const SHIPPING_SPEEDS = new Set(['express', 'standard', 'economy']);
const HANDOFF_MODES = new Set(['pickup', 'door']);

const commissionByPath = new Map(commissionData.rows.map((row) => [row.match_key, row]));
const groupByName = new Map(celData.groups.map((group) => [group.group, group]));
const rateByGroupAndSpeed = new Map(
  celData.rates.map((rate) => [`${rate.group}|${rate.speed}`, rate]),
);

function normalizeCategoryPart(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function categoryPathParts(value) {
  return String(value || '')
    .split(/\s*(?:\/|>|→)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizePricingSettings(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const speed = String(source.shippingSpeed || DEFAULT_PRICING_SETTINGS.shippingSpeed).toLowerCase();
  const handoff = String(source.handoffMode || DEFAULT_PRICING_SETTINGS.handoffMode).toLowerCase();
  return {
    otherFeeRate: finiteNumber(source.otherFeeRate, DEFAULT_PRICING_SETTINGS.otherFeeRate),
    targetProfitRate: finiteNumber(source.targetProfitRate, DEFAULT_PRICING_SETTINGS.targetProfitRate),
    labelFeeCny: finiteNumber(source.labelFeeCny, DEFAULT_PRICING_SETTINGS.labelFeeCny),
    shippingSpeed: SHIPPING_SPEEDS.has(speed) ? speed : DEFAULT_PRICING_SETTINGS.shippingSpeed,
    handoffMode: HANDOFF_MODES.has(handoff) ? handoff : DEFAULT_PRICING_SETTINGS.handoffMode,
  };
}

function validatePricingSettings(settings) {
  const errors = [];
  if (settings.otherFeeRate < 0 || settings.otherFeeRate >= 1) errors.push('其他费用率必须大于等于 0 且小于 100%。');
  if (settings.targetProfitRate < 0) errors.push('期望利润率不能小于 0。');
  if (settings.labelFeeCny < 0) errors.push('贴单费不能小于 0。');
  if (!SHIPPING_SPEEDS.has(settings.shippingSpeed)) errors.push('CEL 运输速度无效。');
  if (!HANDOFF_MODES.has(settings.handoffMode)) errors.push('CEL 交接方式无效。');
  return errors;
}

function publicPricingSettings(value = {}) {
  const settings = normalizePricingSettings(value);
  return {
    ...settings,
    platformServiceRate: PLATFORM_SERVICE_RATE,
    currencyCode: 'CNY',
    commissionMode: 'RFBS',
    commissionDataVersion: commissionData.version,
    shippingDataVersion: celData.version,
  };
}

function resolveRfbsCommission(russianCategoryPath) {
  const parts = categoryPathParts(russianCategoryPath);
  if (parts.length < 3) {
    return {
      ok: false,
      code: 'commission_category_path_incomplete',
      reason: 'Ozon 俄文类目路径不足三级，无法匹配 RFBS 佣金。',
      pathParts: parts,
    };
  }
  const tuple = parts.slice(-3);
  const matchKey = tuple.map(normalizeCategoryPart).join('|');
  const row = commissionByPath.get(matchKey);
  if (!row) {
    return {
      ok: false,
      code: 'commission_category_not_found',
      reason: `最新 RFBS 佣金表中没有匹配类目：${tuple.join(' / ')}`,
      pathParts: tuple,
      matchKey,
    };
  }
  return {
    ok: true,
    rate: row.rfbs_rate,
    sourceRow: row.source_row,
    pathParts: tuple,
    matchKey,
    row: {
      mainCategoryRu: row.main_category_ru,
      categoryRu: row.category_ru,
      productTypeRu: row.product_type_ru,
    },
  };
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function ceilMoney(value) {
  return Math.ceil((Number(value) - Number.EPSILON) * 100) / 100;
}

function priceBandForGroup(group) {
  if (group.max_value_rub <= 1500) return celData.cny_price_bands.low;
  if (group.max_value_rub <= 7000) return celData.cny_price_bands.middle;
  return celData.cny_price_bands.high;
}

function priceFitsBand(price, band) {
  if (Number.isFinite(band.min_inclusive) && price < band.min_inclusive) return false;
  if (Number.isFinite(band.min_exclusive) && price <= band.min_exclusive) return false;
  return price <= band.max_inclusive;
}

function dimensionsFitGroup(group, lengthCm, widthCm, heightCm) {
  const longest = Math.max(lengthCm, widthCm, heightCm);
  const sideSum = lengthCm + widthCm + heightCm;
  return longest <= group.max_longest_side_cm && sideSum <= group.max_side_sum_cm;
}

function calculateSkuPrice(input) {
  const settings = normalizePricingSettings(input.settings);
  const settingsErrors = validatePricingSettings(settings);
  if (settingsErrors.length) {
    return { ok: false, code: 'invalid_pricing_settings', reason: settingsErrors.join(' ') };
  }

  const purchaseCostCny = finiteNumber(input.purchaseCostCny, 0);
  const weightG = finiteNumber(input.weightG, 0);
  const lengthCm = finiteNumber(input.lengthCm, 0);
  const widthCm = finiteNumber(input.widthCm, 0);
  const heightCm = finiteNumber(input.heightCm, 0);
  const commissionRate = finiteNumber(input.commissionRate, -1);

  if (purchaseCostCny <= 0) return { ok: false, code: 'invalid_purchase_price', reason: '1688 SKU 采购价必须大于 0。' };
  if (weightG <= 0 || lengthCm <= 0 || widthCm <= 0 || heightCm <= 0) {
    return { ok: false, code: 'missing_package_data', reason: '自动定价需要有效的包装重量和长宽高。' };
  }
  if (commissionRate < 0 || commissionRate >= 1) {
    return { ok: false, code: 'invalid_commission_rate', reason: 'RFBS 佣金率无效。' };
  }

  const variableRate = commissionRate + PLATFORM_SERVICE_RATE + settings.otherFeeRate;
  if (variableRate >= 1) {
    return { ok: false, code: 'invalid_variable_rate', reason: 'RFBS 佣金、平台费和其他费用率之和必须小于 100%。' };
  }

  const weightCandidates = celData.groups.filter((group) => (
    weightG >= group.min_weight_g
    && weightG <= group.max_weight_g
    && dimensionsFitGroup(group, lengthCm, widthCm, heightCm)
  ));
  if (!weightCandidates.length) {
    return { ok: false, code: 'shipping_group_not_found', reason: '商品重量或尺寸不在最新 CEL 货件分组范围内。' };
  }

  const targetProfitCny = purchaseCostCny * settings.targetProfitRate;
  const solutions = [];
  const unavailableRates = [];

  for (const group of weightCandidates) {
    const rate = rateByGroupAndSpeed.get(`${group.group}|${settings.shippingSpeed}`);
    const handoffRate = rate && rate[settings.handoffMode];
    if (!handoffRate) {
      unavailableRates.push(group.group);
      continue;
    }
    const shippingCny = handoffRate.fixed_cny + handoffRate.per_gram_cny * weightG;
    const rawPriceCny = (
      purchaseCostCny + shippingCny + settings.labelFeeCny + targetProfitCny
    ) / (1 - variableRate);
    const finalPriceCny = ceilMoney(rawPriceCny);
    const band = priceBandForGroup(group);
    if (!priceFitsBand(finalPriceCny, band)) continue;

    const commissionCny = finalPriceCny * commissionRate;
    const platformServiceFeeCny = finalPriceCny * PLATFORM_SERVICE_RATE;
    const otherFeesCny = finalPriceCny * settings.otherFeeRate;
    const achievedProfitCny = finalPriceCny
      - purchaseCostCny
      - shippingCny
      - settings.labelFeeCny
      - commissionCny
      - platformServiceFeeCny
      - otherFeesCny;

    solutions.push({
      group: group.group,
      groupSourceRow: group.source_row,
      shippingRateSourceRow: rate.source_row,
      priceBandCny: band,
      purchaseCostCny: roundMoney(purchaseCostCny),
      weightG: roundMoney(weightG),
      dimensionsCm: {
        length: roundMoney(lengthCm),
        width: roundMoney(widthCm),
        height: roundMoney(heightCm),
      },
      shippingCny: roundMoney(shippingCny),
      commissionRate,
      commissionCny: roundMoney(commissionCny),
      platformServiceRate: PLATFORM_SERVICE_RATE,
      platformServiceFeeCny: roundMoney(platformServiceFeeCny),
      otherFeeRate: settings.otherFeeRate,
      otherFeesCny: roundMoney(otherFeesCny),
      labelFeeCny: roundMoney(settings.labelFeeCny),
      targetProfitRate: settings.targetProfitRate,
      targetProfitCny: roundMoney(targetProfitCny),
      achievedProfitCny: roundMoney(achievedProfitCny),
      achievedProfitRate: achievedProfitCny / purchaseCostCny,
      rawPriceCny,
      finalPriceCny,
    });
  }

  if (!solutions.length) {
    const missingRateBlocksConsistentGroup = weightCandidates.some((group) => {
      if (!unavailableRates.includes(group.group)) return false;
      const rate = rateByGroupAndSpeed.get(`${group.group}|${settings.shippingSpeed}`);
      const referenceRate = rate?.pickup || rate?.door;
      if (!referenceRate) return false;
      const referenceShippingCny = referenceRate.fixed_cny + referenceRate.per_gram_cny * weightG;
      const referencePriceCny = ceilMoney((
        purchaseCostCny + referenceShippingCny + settings.labelFeeCny + targetProfitCny
      ) / (1 - variableRate));
      return priceFitsBand(referencePriceCny, priceBandForGroup(group));
    });
    if (unavailableRates.length === weightCandidates.length || missingRateBlocksConsistentGroup) {
      return {
        ok: false,
        code: 'shipping_rate_unavailable',
        reason: `${settings.handoffMode === 'door' ? '上门' : '揽收点'}方式没有适用于当前货件分组的 CEL 费率。`,
      };
    }
    return { ok: false, code: 'price_band_unresolved', reason: '计算售价无法与 CEL 货值分组形成一致结果。' };
  }

  solutions.sort((a, b) => a.finalPriceCny - b.finalPriceCny);
  return { ok: true, ...solutions[0] };
}

function buildPricingSummary({ settings, currencyCode, category, russianCategoryPath, categoryPathError, rows, items }) {
  const normalizedSettings = normalizePricingSettings(settings);
  const summary = {
    status: 'unresolved',
    currencyCode: String(currencyCode || 'CNY').toUpperCase(),
    settings: publicPricingSettings(normalizedSettings),
    data: {
      commissionVersion: commissionData.version,
      commissionSourceSha256: commissionData.source.sha256,
      shippingVersion: celData.version,
      shippingSourceSha256: celData.source.sha256,
    },
    category: {
      descriptionCategoryId: Number(category?.description_category_id || category?.descriptionCategoryId || 0),
      typeId: Number(category?.type_id || category?.typeId || 0),
      pathZh: String(category?.path || ''),
      pathRu: String(russianCategoryPath || ''),
      commissionMode: 'RFBS',
    },
    items: [],
    errors: [],
  };

  if (summary.currencyCode !== 'CNY') {
    summary.errors.push({ code: 'unsupported_currency', reason: '自动定价当前仅支持 CNY 店铺，不执行隐式汇率换算。' });
  }

  const commission = categoryPathError
    ? { ok: false, code: categoryPathError.code, reason: categoryPathError.reason }
    : resolveRfbsCommission(russianCategoryPath);
  if (!commission.ok) {
    if (!summary.errors.some((error) => error.code === commission.code)) {
      summary.errors.push({ code: commission.code, reason: commission.reason });
    }
  } else {
    Object.assign(summary.category, {
      commissionRate: commission.rate,
      commissionSourceRow: commission.sourceRow,
      commissionPath: commission.pathParts,
    });
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] || {};
    const row = rows[index] || {};
    const base = {
      itemIndex: index,
      offerId: String(item.offer_id || ''),
      sourceSkuId: String(row.sku_id || row.skuId || ''),
      sourceSkuOrdinal: Number(row.source_sku_ordinal || index + 1),
    };
    if (summary.errors.length) {
      item.price = '0';
      summary.items.push({ ...base, status: 'unresolved', reason: summary.errors[0].reason });
      continue;
    }
    const result = calculateSkuPrice({
      settings: normalizedSettings,
      purchaseCostCny: row.sku_price,
      weightG: item.weight,
      lengthCm: Number(item.depth || 0) / 10,
      widthCm: Number(item.width || 0) / 10,
      heightCm: Number(item.height || 0) / 10,
      commissionRate: commission.rate,
    });
    if (!result.ok) {
      item.price = '0';
      summary.errors.push({ itemIndex: index, offerId: base.offerId, code: result.code, reason: result.reason });
      summary.items.push({ ...base, status: 'unresolved', reason: result.reason });
      continue;
    }
    item.price = result.finalPriceCny.toFixed(2);
    summary.items.push({ ...base, status: 'priced', ...result });
  }

  summary.status = summary.errors.length ? 'unresolved' : 'priced';
  return summary;
}

module.exports = {
  PLATFORM_SERVICE_RATE,
  DEFAULT_PRICING_SETTINGS,
  normalizePricingSettings,
  validatePricingSettings,
  publicPricingSettings,
  resolveRfbsCommission,
  calculateSkuPrice,
  buildPricingSummary,
  pricingData: { cel: celData, commission: commissionData },
};
