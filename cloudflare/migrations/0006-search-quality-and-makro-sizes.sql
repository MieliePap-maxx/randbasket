UPDATE search_profiles
SET exclude_terms_json = '["choc","cocoa","latte","coffee","flavour","flavor","shake","caramilk","candy","sweets","chew","lollipop","bar"]'
WHERE term = 'milk';

UPDATE search_profiles
SET exclude_terms_json = '["pizza","pasta","macaroni","sandwich","burger","sauce","chips","snack","noodles","roll","biscuit","puff","popcorn","seasoning","dressing","cheesecake","roastie","muffin","pancake","dessert","bakers","mini cheddar","cheeselet","cheezy","nacho","russian","croissant"]'
WHERE term = 'cheese';

UPDATE search_profiles
SET exclude_terms_json = '["smoothie","dessert","rice","cake","biscuit","coated","dipped","chicken","candy","sweets","lollipop","energy bar","cookie"]'
WHERE term = 'yoghurt';

UPDATE catalogue_offers
SET size_label = NULL
WHERE retailer_id = 'makro'
  AND size_label IN ('6 x 6 L', '6 x 5700 ml', '30 x 1.44 kg');
