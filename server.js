const express = require('express');
const axios = require('axios');
const pLimit = require('p-limit');
require('dotenv').config();

const app = express();
app.use(express.json());  // To parse JSON body

const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN;
const SHOPIFY_GRAPHQL_ENDPOINT = `https://${SHOPIFY_SHOP_DOMAIN}.myshopify.com/admin/api/2025-04/graphql.json`;

const limit = pLimit(2); // Limit to 2 concurrent requests to Shopify API

// Webhook handler for inventory level updates
app.post('/webhook', async (req, res) => {
  try {
    const { inventory_item_id, location_id, available } = req.body;

    if (!inventory_item_id || !location_id || available === undefined) {
      console.error("Invalid webhook data:", req.body);
      return res.sendStatus(400); // Bad Request
    }

    console.log(`Received webhook for inventory update:`, req.body);

    // Fetch product variants using the inventory_item_id
    const variants = await getAllInventoryItemIds(inventory_item_id);
    console.log('Variants Data:', variants);
    
//     if (variants.length === 0) {
//       console.error("No variants found for inventory_item_id:", inventory_item_id);
//       return res.sendStatus(404); // Not Found
//     }

//     // Update inventory for each variant in the specified location
//     await Promise.all(
//       variants.map(variant => 
//         limit(() => syncInventoryLevel(variant.id, location_id, available))
//       )
//     );

    console.log(`Inventory levels updated for variants of product ${inventoryItemId}`);
    return res.sendStatus(200); // OK
  } catch (error) {
    console.error("Error syncing inventory:", error);
    return res.sendStatus(500); // Internal Server Error
  }
});



// // Fetch all variants for a given inventory_item_id
// async function getVariantsByInventoryItemId(inventory_item_id) {
//   try {
//     const response = await axios.get(`${SHOPIFY_API_URL}/variants.json`, {
//       headers: {
//         'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
//       }
//     });

//     return response.data.variants.filter(variant => variant.inventory_item_id === inventory_item_id);
//   } catch (error) {
//     console.error("Error fetching variants:", error);
//     throw new Error("Failed to fetch variants.");
//   }
// }

async function getAllInventoryItemIds(inventoryItemId) {
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
  console.log('Inventory Item ID: ', variables1);

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
    console.log('Product ID: ', productId);

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
      variantId: variant.node.id,
      inventoryItemId: variant.node.inventoryItem.id,
    }));

    console.log('Inventory Item IDs:', inventoryItemIds);
  } catch (error) {
    console.error('Error fetching inventory item IDs:', error.response?.data || error.message);
  }
}

// Update the inventory level for a specific variant and location
async function syncInventoryLevel(variant_id, location_id, available) {
  try {
    const response = await axios.post(`${SHOPIFY_API_URL}/inventory_levels/set.json`, {
      location_id,
      inventory_item_id: variant_id,
      available
    }, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
      }
    });

    console.log(`Inventory updated for variant ID: ${variant_id} at location ID: ${location_id} with available stock: ${available}`);
  } catch (error) {
    console.error(`Error updating inventory for variant ID: ${variant_id}`, error);
    throw new Error(`Failed to sync inventory for variant ID: ${variant_id}`);
  }
}

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
