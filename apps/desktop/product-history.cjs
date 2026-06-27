const fs = require('fs');
const path = require('path');

const HISTORY_FILE = 'product_history.json';
const MAX_ITEMS = 50;

function historyPath(userDataPath) {
  return path.join(userDataPath, HISTORY_FILE);
}

function loadHistory(userDataPath) {
  const file = historyPath(userDataPath);
  if (!fs.existsSync(file)) return { items: [] };
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { items: Array.isArray(data.items) ? data.items : [] };
  } catch {
    return { items: [] };
  }
}

function saveHistory(userDataPath, data) {
  fs.mkdirSync(path.dirname(historyPath(userDataPath)), { recursive: true });
  fs.writeFileSync(historyPath(userDataPath), JSON.stringify(data, null, 2), 'utf8');
}

function listProductHistory(userDataPath, limit = MAX_ITEMS) {
  const data = loadHistory(userDataPath);
  return data.items.slice(0, limit);
}

function addProductsToHistory(userDataPath, products, meta = {}) {
  const data = loadHistory(userDataPath);
  const now = new Date().toISOString();
  const seen = new Set(data.items.map((p) => p.offerId));

  for (const product of products) {
    const offerId = String(product.offerId || '').trim();
    if (!offerId) continue;
    // Require image
    if (!product.image && !product.mainImage && !(product.images?.length > 0)) continue;

    const image = String(product.image || product.mainImage || (product.images?.[0]) || '');
    if (!image) continue;

    if (seen.has(offerId)) {
      // Update existing entry
      const idx = data.items.findIndex((p) => p.offerId === offerId);
      if (idx >= 0) {
        data.items[idx] = {
          ...data.items[idx],
          title: String(product.title || data.items[idx].title || ''),
          price: String(product.price || product.priceRange || product.priceText || data.items[idx].price || ''),
          image,
          url: String(product.url || data.items[idx].url || ''),
          raw: product.raw || product,
          collectedAt: now,
        };
      }
    } else {
      seen.add(offerId);
      data.items.unshift({
        offerId,
        title: String(product.title || ''),
        price: String(product.price || product.priceRange || product.priceText || ''),
        image,
        url: String(product.url || `https://detail.1688.com/offer/${offerId}.html`),
        sourceCommand: meta.sourceCommand || 'search',
        profile: meta.profile || 'default',
        collectedAt: now,
        raw: product.raw || product,
      });
    }
  }

  // Trim to MAX_ITEMS
  data.items = data.items.slice(0, MAX_ITEMS);
  saveHistory(userDataPath, data);
  return data.items;
}

function clearProductHistory(userDataPath) {
  saveHistory(userDataPath, { items: [] });
  return [];
}

module.exports = { listProductHistory, addProductsToHistory, clearProductHistory, MAX_ITEMS };
