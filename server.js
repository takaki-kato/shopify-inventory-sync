const express = require("express");
const axios = require("axios");
const pLimit = require("p-limit");  // Using the latest version of p-limit
require("dotenv").config();

const app = express();
app.use(express.json());

const SHOP = process.env.SHOPIFY_STORE;
const TOKEN = process.env.ADMIN_API_TOKEN;
const API_VERSION = "2023-10";
const limit = pLimit(2); // Limit concurrency to 2 requests

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

// 📦 Set inventory level at a specific location
async function setInventoryLevel(locationId, inventoryItemId, available) {
  return shopifyApi.post(`/inventory_levels/set.json`, {
    location_id: locationId,
    inventory_item_id: inventoryItemId,
    available,
  });
}

// 🚀 Webhook listener for inventory level updates
app.post("/webhook", async (req, res) => {
  try {
    const { inventory_item_id, location_id, available } = req.body;

    // Fetch related variants of the product using the inventory_item_id
    const variants = await getSiblingVariants(inventory_item_id);

    const tasks = [];

    for (const variant of variants) {
      // Skip the current variant that triggered the webhook
      if (variant.inventory_item_id === inventory_item_id) continue;

      // Add the task of updating the inventory to the list of tasks
      tasks.push(() => setInventoryLevel(location_id, variant.inventory_item_id, available));
    }

    // Execute all tasks with limited concurrency (max 2 at a time)
    await Promise.all(tasks.map(fn => limit(fn)));

    res.sendStatus(200);  // Respond to Shopify that the webhook was handled successfully
  } catch (err) {
    console.error("Sync error:", err.message);
    res.sendStatus(500);  // Internal server error
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Listening for inventory updates on port ${PORT}`);
});