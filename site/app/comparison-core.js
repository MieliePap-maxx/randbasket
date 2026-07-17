(function attachRandBasketCore(globalScope) {
  function wholeQuantity(value) {
    const quantity = Number(value);
    return Number.isFinite(quantity) ? Math.max(1, Math.round(quantity)) : 1;
  }

  function nextQuantity(current, delta) {
    const change = Number(delta);
    const currentValue = Number(current);
    const quantity = Number.isFinite(currentValue) ? Math.max(0, Math.round(currentValue)) : 0;
    if (!Number.isFinite(change)) return quantity;
    return Math.max(0, quantity + Math.trunc(change));
  }

  function sameCatalogueProduct(item, product, store) {
    if (!item || !store) return false;
    if (store.url && item.links?.[store.storeId] === store.url) return true;
    return Boolean(
      product?.id
      && item.selectedStoreId === store.storeId
      && item.selectedProductId === product.id,
    );
  }

  function matchingBasketItem(items, product, store) {
    return (Array.isArray(items) ? items : []).find((item) => sameCatalogueProduct(item, product, store));
  }

  function detailText(value) {
    if (Array.isArray(value)) return value.filter(Boolean).join("\n");
    return typeof value === "string" ? value.trim() : "";
  }

  function firstDetailText(...values) {
    return values.map(detailText).find(Boolean) || "";
  }

  function availableProductDetails(product = {}, store = {}, comparison = null) {
    const sections = [
      ["How to use", firstDetailText(store.howToUse, product.howToUse)],
      ["Product information", firstDetailText(store.productDetails, store.thisProduct, product.productDetails)],
      ["Ingredients", firstDetailText(store.ingredients, product.ingredients)],
      ["Product highlights", firstDetailText(store.highlights, store.features, product.highlights, product.features)],
      ["More from the retailer", firstDetailText(store.ourDifference, product.ourDifference)],
      ["Disclaimer", firstDetailText(store.disclaimer, product.disclaimer)],
    ].filter(([, value]) => value);
    return {
      name: store.productName || product.canonicalName || "Product",
      retailer: store.storeName || "",
      imageUrl: store.imageUrl || "",
      description: firstDetailText(store.description, product.description),
      price: store.price ?? null,
      regularPrice: store.regularPrice ?? null,
      promoText: firstDetailText(store.promoText),
      productUrl: store.url || "",
      lastSeenAt: store.lastSeenAt || "",
      matchReasons: Array.isArray(store.matchReasons) ? store.matchReasons.filter(Boolean) : [],
      alternativeReason: firstDetailText(store.alternativeReason),
      sections,
      facts: [
        store.brand && ["Brand", store.brand],
        (store.size || product.targetSize) && ["Package size", store.size || product.targetSize],
        store.unit && ["Package unit", store.unit],
        product.category && ["Category", product.category],
        store.productCode && ["Product code", store.productCode],
        store.barcode && ["Barcode", store.barcode],
        store.sku && ["SKU", store.sku],
        store.retailerProductId && ["Retailer product ID", store.retailerProductId],
        product.id && ["Catalogue product ID", product.id],
        comparison && ["Unit price", comparison],
      ].filter(Boolean),
    };
  }

  globalScope.RandBasketCore = {
    availableProductDetails,
    detailText,
    matchingBasketItem,
    nextQuantity,
    sameCatalogueProduct,
    wholeQuantity,
  };
})(typeof globalThis === "undefined" ? window : globalThis);
