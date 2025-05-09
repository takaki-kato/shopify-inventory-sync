 
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;

app.post('/webhook/inventory', async (req, res) => {
  try {
    const { inventory_item_id, available, location_id } = req.body;

    const { data } = await axios.get(
      `https://${SHOPIFY_STORE}/admin/api/2023-10/inventory_levels.json?inventory_item_ids=${inventory_item_id}`,
      {
        headers: {
          'X-Shopify-Access-Token': ADMIN_API_TOKEN
        }
      }
    );

    for (const level of data.inventory_levels) {
      if (level.location_id !== location_id) {
        await axios.post(
          `https://${SHOPIFY_STORE}/admin/api/2023-10/inventory_levels/set.json`,
          {
            location_id: level.location_id,
            inventory_item_id,
            available
          },
          {
            headers: {
              'X-Shopify-Access-Token': ADMIN_API_TOKEN
            }
          }
        );
      }
    }

    res.status(200).send('Inventory synced.');
  } catch (err) {
    console.error('Sync error:', err.message);
    res.status(500).send('Error syncing inventory');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
