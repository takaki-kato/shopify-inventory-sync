const express = require('express');
const axios = require('axios');
// const pLimit = require('p-limit');
require('dotenv').config();

const app = express();
app.use(express.json());  // To parse JSON body

const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN;
const SHOPIFY_GRAPHQL_ENDPOINT = `https://${SHOPIFY_SHOP_DOMAIN}.myshopify.com/admin/api/2025-04/graphql.json`;

// const limit = pLimit(2); // Limit to 2 concurrent requests to Shopify API
// 🧠 Simple in-memory cache to avoid reprocessing
const recentlyUpdated = new Map();
const CACHE_TTL_MS = 30 * 1000; // 30 seconds

function wasRecentlyUpdated(id) {
  const timestamp = recentlyUpdated.get(id);
  if (!timestamp) return false;
  return Date.now() - timestamp < CACHE_TTL_MS;
}

function markAsUpdated(id) {
  recentlyUpdated.set(id, Date.now());
}

// Webhook handler for inventory level updates
app.post('/webhook', async (req, res) => {
  try {
    const { inventory_item_id, location_id, available } = req.body;

    if (!inventory_item_id || !location_id || available === undefined) {
      console.error("Invalid webhook data:", req.body);
      return res.sendStatus(400); // Bad Request
    }
    if (wasRecentlyUpdated(inventory_item_id)) {
      console.log(`Skipping update for recently updated item: ${inventory_item_id}`);
      return res.sendStatus(200);
    }

    console.log(`Received webhook for inventory update:`, req.body);
    console.log(`Syncing variants for ${inventory_item_id} at location ${location_id} to quantity ${available}`);

    // Fetch product variants using the inventory_item_id
    const inventoryItemIds = await getInventoryItemIdsForAllVariants(inventory_item_id);
    if (!inventoryItemIds || inventoryItemIds.length === 0) {
      return res.sendStatus(500);
    }
    // Update invetory for all variants  
    await updateInventoryForAllVariants(inventoryItemIds, location_id, available);

    // Mark all affected items as recently updated
    inventoryItemIds.forEach(({ inventoryItemId }) => markAsUpdated(inventoryItemId));
    return res.sendStatus(200); // OK

  } catch (error) {
    console.error("Error syncing inventory:", error);
    return res.sendStatus(500); // Internal Server Error
  }
});

// Get inventory item IDs of all variants
async function getInventoryItemIdsForAllVariants(inventoryItemId) {
  // Step 1: Fetch the product ID from the inventory item
  const query1 = `
    query GetProductFromInventoryItem($id: ID!) {
      inventoryItem(id: $id) {
        variant {
          product {
            id
            title
          }
        }
      }
    }
  `;

  const variables1 = {
    id: `gid://shopify/InventoryItem/${inventoryItemId}`,
  };

  try {
    const response1 = await axios.post(
      SHOPIFY_GRAPHQL_ENDPOINT,
      { query: query1, variables: variables1 },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        },
      }
    );

    const productId = response1.data.data.inventoryItem.variant.product.id;

    // Step 2: Fetch all variants of the product
    const query2 = `
      query GetAllVariantsInventoryItemIds($id: ID!) {
        product(id: $id) {
          variants(first: 50) {
            edges {
              node {
                id
                inventoryItem {
                  id
                }
              }
            }
          }
        }
      }
    `;

    const response2 = await axios.post(
      SHOPIFY_GRAPHQL_ENDPOINT,
      { query: query2, variables: { id: productId } },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        },
      }
    );

    const variants = response2.data.data.product.variants.edges;
    const inventoryItemIds = variants.map(variant => ({
      // variantId: variant.node.id,
      inventoryItemId: variant.node.inventoryItem.id,
    }));

    return inventoryItemIds;
  } catch (error) {
    console.error('Error fetching inventory item IDs:', error.response?.data || error.message);
  }
}

// Update the inventory level for all variants in specific location
async function updateInventoryForAllVariants(inventoryItemIds, locationId, available) {
  const query = `
    mutation SetInventoryQuantities($input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) {
        inventoryAdjustmentGroup {
          createdAt
          reason
          changes {
            name
            quantityAfterChange
          }
        }      
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    input: {
      name: 'available',
      reason: 'correction',
      ignoreCompareQuantity: true,
      quantities: inventoryItemIds.map(item => ({
        inventoryItemId: item.inventoryItemId,
        locationId: `gid://shopify/Location/${locationId}`,
        quantity: available
      }))
    }
  };

  // console.log(JSON.stringify(variables, null, 2));

  try {
    const response = await axios.post(
      SHOPIFY_GRAPHQL_ENDPOINT,
      { query: query, variables: variables },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        },
      }
    );

    const data = response.data.data.inventorySetQuantities;
    if (data.userErrors.length > 0) {
      console.error('Errors:', data.userErrors);
    } 
    // else {
    //   console.log('Inventory updated successfully:', data.inventoryAdjustmentGroup.changes);
    // }
  } catch (error) {
  console.error('Error fetching inventory item IDs:', error.response?.data || error.message);
  // return []; // return empty array or throw error
  }
}

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
