const apiBaseUrl = String(
  process.env.RANDBASKET_API_URL || "https://api.randbasket.co.za",
).replace(/\/+$/, "");
const queries = process.argv.slice(2).filter((value) => !value.startsWith("--"));
const evaluationQueries = queries.length
  ? queries
  : [
    "whole milk",
    "food for a braai",
    "kids breakfast cereal",
    "bread for toast",
    "washing powder for sensitive skin",
    "Clover full cream milk 2L",
    "Albany brown bread 700g",
    "large eggs 18 pack",
    "beef mince 1kg",
  ];

for (const query of evaluationQueries) {
  const url = new URL(`${apiBaseUrl}/v1/catalogue`);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "8");
  url.searchParams.set("debug", "1");
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    console.error(`\n${query}: HTTP ${response.status} ${payload.error || ""}`);
    continue;
  }
  console.log(`\n${query}`);
  if (payload.correctionApplied) {
    console.log(`  corrected: ${payload.correctedQuery}`);
  }
  console.log(
    `  semantic candidates: ${payload.semanticSearchApplied ? payload.semanticCandidateCount : 0}`,
  );
  const products = payload.retailerMatches || payload.products || [];
  if (!products.length) {
    console.log("  no valid catalogue matches");
    continue;
  }
  products.slice(0, 8).forEach((product, index) => {
    const store = product.stores?.[0];
    console.log(
      `  ${index + 1}. ${store?.storeName || "Unknown retailer"} | ${store?.productName || product.canonicalName} | ${store?.price ?? "price unavailable"}`,
    );
  });
}
