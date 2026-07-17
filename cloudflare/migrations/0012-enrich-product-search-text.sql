-- Add reviewed retailer wording to existing canonical search documents.
-- Product grouping is intentionally unchanged: this only improves discovery.
UPDATE catalogue_products AS product
SET search_text = LOWER(TRIM(
  product.search_text || ' ' || COALESCE((
    SELECT GROUP_CONCAT(offer_text, ' ')
    FROM (
      SELECT DISTINCT
        offer.product_name || ' ' || COALESCE(offer.brand, '') || ' ' || COALESCE(offer.size_label, '') AS offer_text
      FROM catalogue_offers AS offer
      WHERE offer.product_id = product.id
      LIMIT 25
    )
  ), '')
));
