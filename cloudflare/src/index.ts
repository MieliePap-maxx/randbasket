export interface Env {
  APP_ORIGIN: string;
  DB: D1Database;
  CATALOGUE: R2Bucket;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/v1/health") {
      return json({ ok: true, service: "sa-grocery-price-checker-api", now: new Date().toISOString() });
    }

    if (request.method === "GET" && url.pathname === "/v1/catalogue") {
      const query = (url.searchParams.get("q") || "").trim();
      if (!query) return json({ ok: true, query, products: [] });
      const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 1);
      const like = `%${terms.join("%")}%`;
      const { results } = await env.DB.prepare(
        `SELECT id, retailer_id, retailer_name, product_name, brand, category, size_label,
                price_cents, regular_price_cents, promo_text, image_url, product_url, last_seen_at
         FROM catalogue_products
         WHERE lower(product_name) LIKE ?1
         ORDER BY last_seen_at DESC
         LIMIT 30`,
      ).bind(like).all();
      return json({ ok: true, query, products: results });
    }

    return json({ ok: false, error: "Not found" }, 404);
  },
};
