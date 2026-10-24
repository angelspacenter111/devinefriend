require('dotenv').config();
const express = require('express');
const http = require('http');
const sfuRoutes = require('../routes/sfuRoutes');

const app = express();
app.use(express.json());
app.use('/api/sfu', sfuRoutes);

const server = app.listen(3088, async () => {
  console.log('Test SFU Server running on 3088');
  try {
    // 1. Status
    const statusData = await new Promise((resolve, reject) => {
      http.get('http://localhost:3088/api/sfu/status', (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => resolve(JSON.parse(body)));
      }).on('error', reject);
    });
    console.log('Status Route Response:', statusData);

    // 2. New Session
    const sessData = await new Promise((resolve, reject) => {
      const req = http.request('http://localhost:3088/api/sfu/session/new', { method: 'POST' }, (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => resolve(JSON.parse(body)));
      });
      req.on('error', reject);
      req.end();
    });
    console.log('New Session Route Response:', sessData);

    if (sessData.success && sessData.sessionId) {
      console.log('✓ SFU Routes working perfectly!');
    } else {
      console.error('✗ SFU Routes failed');
    }
  } catch (err) {
    console.error('Test error:', err);
  } finally {
    server.close();
  }
});
