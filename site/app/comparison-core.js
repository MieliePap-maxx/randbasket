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

  function availableProductDetails(product = {}, store = {}, comparison = null) {
    return {
      name: store.productName || product.canonicalName || "Product",
      retailer: store.storeName || "",
      imageUrl: store.imageUrl || "",
      description: store.description || product.description || "",
      price: store.price ?? null,
      productUrl: store.url || "",
      facts: [
        store.brand && ["Brand", store.brand],
        (store.size || product.targetSize) && ["Package size", store.size || product.targetSize],
        store.unit && ["Package unit", store.unit],
        product.category && ["Category", product.category],
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
    matchingBasketItem,
    nextQuantity,
    sameCatalogueProduct,
    wholeQuantity,
  };
})(typeof globalThis === "undefined" ? window : globalThis);
