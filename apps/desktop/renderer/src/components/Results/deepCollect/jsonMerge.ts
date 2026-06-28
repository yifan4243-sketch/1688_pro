export function mergeDeepCollectData(
  baseData: Record<string, unknown> | undefined,
  deepJsonByOfferId: Record<string, Record<string, unknown>>,
  deepFailuresByOfferId: Record<string, Record<string, unknown>>,
): Record<string, unknown> | undefined {
  if (!baseData) return undefined;

  const baseOffers = (Array.isArray(baseData.offers) ? baseData.offers : []) as Array<Record<string, unknown>>;

  const offers = baseOffers.map((offer) => {
    if (!offer || typeof offer !== 'object') return offer;

    const offerId = String(offer.offerId || offer.offer_id || offer.id || '');
    const deep = deepJsonByOfferId[offerId];
    const failure = deepFailuresByOfferId[offerId];

    if (deep) {
      const imgs = Array.isArray(deep.images) ? deep.images as string[] : [];

      return {
        ...offer,
        title: deep.title || offer.title,
        image: deep.mainImage || imgs[0] || offer.image,
        priceRange: deep.priceRange || offer.priceRange,
        deepCollected: true,
        deepCollectStatus: 'success',
        deepOffer: deep,
        deepCollectMeta: deep._deepCollectMeta,
      };
    }

    if (failure) {
      return {
        ...offer,
        deepCollected: false,
        deepCollectStatus: 'failed',
        deepCollectFailure: failure,
      };
    }

    return offer;
  });

  const deepOffers = Object.values(deepJsonByOfferId);
  const failures = Object.values(deepFailuresByOfferId);
  const hasManualDeep = deepOffers.length > 0 || failures.length > 0;

  if (!hasManualDeep) {
    return {
      ...baseData,
      offers,
    };
  }

  return {
    ...baseData,
    offers,
    deeppro: {
      ...(baseData.deeppro && typeof baseData.deeppro === 'object'
        ? baseData.deeppro as Record<string, unknown>
        : {}),
      enabled: true,
      mode: 'manual-per-card',
      success: deepOffers.length,
      failed: failures.length,
      offers: deepOffers,
      failures,
    },
  };
}
