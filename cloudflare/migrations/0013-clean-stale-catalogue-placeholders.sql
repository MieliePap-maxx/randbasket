-- Remove three retired Pick n Pay milk placeholders that have no usable price,
-- image, or observation timestamp. Current priced products remain untouched.
DELETE FROM catalogue_offers
WHERE retailer_id = 'pick-n-pay'
  AND product_id IN (
    'bosparadys-milk-full-cream-2l',
    'crickley-full-cream-milk-2l',
    'dewfresh-full-cream-milk-2l'
  )
  AND COALESCE(price_cents, 0) <= 0
  AND COALESCE(image_url, '') = '';

DELETE FROM catalogue_products
WHERE id IN (
    'bosparadys-milk-full-cream-2l',
    'crickley-full-cream-milk-2l',
    'dewfresh-full-cream-milk-2l'
  )
  AND NOT EXISTS (
    SELECT 1 FROM catalogue_offers WHERE catalogue_offers.product_id = catalogue_products.id
  );

-- Repair the concrete produce records exposed by the egg-comparison report.
UPDATE catalogue_products
SET category = 'Fresh Fruit & Vegetables',
    search_text = TRIM(REPLACE(' ' || search_text || ' ', ' dairy ', ' produce ')),
    updated_at = CURRENT_TIMESTAMP
WHERE id IN ('butternut-2-pk', 'butternut-2-5-kg', 'pnp-baking-butternut-2-pack');
