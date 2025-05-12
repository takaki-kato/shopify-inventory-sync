const express = require('express');
const app = express();
app.use(express.json()); // This is crucial!

app.post('/webhook', (req, res) => {
  try {
    console.log('✅ Webhook received:', req.body);
    res.status(200).send('Received');
  } catch (err) {
    console.error('❌ Error in webhook handler:', err);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
