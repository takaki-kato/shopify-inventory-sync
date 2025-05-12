const express = require("express");
const axios = require("axios");
const pLimit = require("p-limit");
require("dotenv").config();

const app = express();
app.use(express.json());

const SHOP = process.env.SHOPIFY_STORE;
const TOKEN = process.env.ADMIN_API_TOKEN;
const API_VERSION = "2023-10";
const limit = pLimit(2); // For API rate limits

const shopifyApi = axios.create({
  baseURL: `https://${SHOP}/admin/api/${API_VERSION}`,
  headers: {
    "X-Shopify-Access-Token": TOKEN,
    "Content-Type": "application/json",
  },
});

// 🔎 Get product and its variants by inventory_item_id
async function getSiblingVariants(inventoryItemId) {
  const res = await shopifyApi.get(`/inventory_items/${inventoryItemId}/variant_ids.json`);
  const variantId = res.data.variant_ids[0];
  if (!variantId) throw new Error("No variant found for inventory item");

  const variantRes = await shopifyApi.get(`/variants/${variantId}.json`);
  const productId = variantRes.data.variant.product_id;

  const productRes = await shopifyApi.get(`/products/${productId}.json`);
  return productRes.data.variants;
}

// 📦 Set inventory at a specific location
async function setInventoryLevel(locationId, inventoryItemId, available) {
  return shopifyApi.post(`/inventory_levels/set.json`, {
    location_id: locationId,
    inventory_item_id: inventoryItemId,
    available,
  });
}

// 🚀 Webhook listener
app.post("/webhook", async (req, res) => {
  try {
    const { inventory_item_id, location_id, available } = req.body;

    const variants = await getSiblingVariants(inventory_item_id);

    const tasks = [];

    for (const variant of variants) {
      if (variant.inventory_item_id === inventory_item_id) continue;

      tasks.push(() =>
        setInventoryLevel(location_id, variant.inventory_item_id, available)
      );
    }

    await Promise.all(tasks.map(fn => limit(fn)));
    res.sendStatus(200);
  } catch (err) {
    console.error("Sync error:", err.message);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Listening for inventory updates on port ${PORT}`);
});
