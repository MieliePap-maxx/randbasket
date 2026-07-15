UPDATE search_profiles
SET exclude_terms_json = '["soup","pie","pasta","pizza","salad","sandwich","wrap","nugget","puppy","dog","cat","polony","samoosa","snack","stock cube","stock cubes","flavour","flavored","heads","feet"]',
    preferred_terms_json = '["whole chicken","mixed portions","fillets","breast","thighs","drumsticks","wings","frozen chicken"]'
WHERE term = 'chicken';
