const args = new Set(process.argv.slice(2));
const apiBaseUrl = String(
  process.env.RANDBASKET_API_URL || "https://api.randbasket.co.za",
).replace(/\/+$/, "");
const token = process.env.RANDBASKET_VECTOR_INDEX_TOKEN;
const force = args.has("--force");
const limitArgument = process.argv.find((value) => value.startsWith("--limit="));
const limit = Math.min(32, Math.max(1, Number(limitArgument?.split("=")[1]) || 32));

if (!token) {
  throw new Error(
    "Set RANDBASKET_VECTOR_INDEX_TOKEN to the same value stored in the Worker VECTOR_INDEX_TOKEN secret.",
  );
}

async function wait(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function postBatch(cursor, attempt = 1) {
  try {
    const response = await fetch(`${apiBaseUrl}/v1/admin/vector-index`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ cursor, force, limit }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `Vector indexing failed with HTTP ${response.status}`);
    }
    return payload;
  } catch (error) {
    if (attempt >= 3) throw error;
    await wait(attempt * 1000);
    return postBatch(cursor, attempt + 1);
  }
}

let cursor = "";
let batches = 0;
let processed = 0;
let indexed = 0;
let skipped = 0;
let failed = 0;

for (;;) {
  const result = await postBatch(cursor);
  batches += 1;
  processed += Number(result.processed || 0);
  indexed += Number(result.indexed || 0);
  skipped += Number(result.skipped || 0);
  failed += Number(result.failed || 0);
  console.log(
    `Batch ${batches}: processed=${result.processed} indexed=${result.indexed} skipped=${result.skipped} failed=${result.failed}`,
  );
  if (result.done || !result.nextCursor) break;
  cursor = result.nextCursor;
  await wait(250);
}

console.log(
  `Vector indexing complete: batches=${batches} processed=${processed} indexed=${indexed} skipped=${skipped} failed=${failed}`,
);
if (failed) process.exitCode = 1;
