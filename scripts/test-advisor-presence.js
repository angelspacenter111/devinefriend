/**
 * Test script to verify real-time Admin Online/Offline presence broadcast to users.
 */
require('dotenv').config();
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { io: ioClient } = require('socket.io-client');
const callService = require('../services/callService');

async function testAdvisorPresence() {
  console.log('=== STARTING ADVISOR PRESENCE VERIFICATION TEST ===\n');

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);

  app.get('/api/advisor-status', (req, res) => {
    res.json({
      success: true,
      ...callService.getAdvisorPresenceInfo()
    });
  });

  io.on('connection', (socket) => {
    // Send immediate status
    socket.emit('advisor-status', callService.getAdvisorPresenceInfo());

    socket.on('get-advisor-status', (callback) => {
      const info = callService.getAdvisorPresenceInfo();
      if (typeof callback === 'function') callback(info);
      else socket.emit('advisor-status', info);
    });

    socket.on('admin-join', (data) => {
      socket.join('admins');
      socket.isAdmin = true;
      const presence = callService.registerAdminPresence(socket.id, data || {});
      io.emit('advisor-status', presence);
    });

    socket.on('disconnect', () => {
      if (socket.isAdmin) {
        const presence = callService.unregisterAdminPresence(socket.id);
        io.emit('advisor-status', presence);
      }
    });
  });

  const TEST_PORT = 3105;
  await new Promise((res) => server.listen(TEST_PORT, res));
  console.log(`✓ Test server running on port ${TEST_PORT}`);

  // Test 1: Initial state - no admins online
  console.log('\n--- 1. Testing Initial State (No Admins) ---');
  let status = callService.getAdvisorPresenceInfo();
  console.log(`Initial Status: isOnline = ${status.isOnline}, count = ${status.count}`);
  if (status.isOnline !== false || status.count !== 0) throw new Error('Expected initial state to be offline');
  console.log('✓ 1. Initial server state is correctly Offline');

  // Test 2: User connects and receives initial offline status immediately
  console.log('\n--- 2. Testing User Connection (Receives Offline) ---');
  const user1 = ioClient(`http://localhost:${TEST_PORT}`);
  const userInitialStatus = await new Promise((resolve) => {
    user1.on('advisor-status', (data) => resolve(data));
  });
  console.log(`User1 received status on connect: isOnline = ${userInitialStatus.isOnline}`);
  if (userInitialStatus.isOnline !== false) throw new Error('Expected user to receive isOnline: false');
  console.log('✓ 2. User client immediately received Offline status');

  // Test 3: Admin connects and emits admin-join -> User receives online broadcast
  console.log('\n--- 3. Testing Admin Connect & admin-join (User Receives Online) ---');
  const userReceivedOnlinePromise = new Promise((resolve) => {
    user1.on('advisor-status', (data) => {
      if (data.isOnline === true) resolve(data);
    });
  });

  const admin1 = ioClient(`http://localhost:${TEST_PORT}`);
  await new Promise((r) => admin1.on('connect', r));
  admin1.emit('admin-join', { adminId: 'admin_123', name: 'Support Person 1' });

  const onlineData = await userReceivedOnlinePromise;
  console.log(`User1 received live status update: isOnline = ${onlineData.isOnline}, count = ${onlineData.count}`);
  if (onlineData.isOnline !== true || onlineData.count !== 1) throw new Error('Expected user to receive isOnline: true');
  console.log('✓ 3. User client received real-time broadcast: Admin is ONLINE!');

  // Test 4: Second Admin joins (multi-admin presence)
  console.log('\n--- 4. Testing Second Admin Join ---');
  const userReceivedAdmin2Promise = new Promise((resolve) => {
    user1.on('advisor-status', (data) => {
      if (data.count === 2) resolve(data);
    });
  });

  const admin2 = ioClient(`http://localhost:${TEST_PORT}`);
  await new Promise((r) => admin2.on('connect', r));
  admin2.emit('admin-join', { adminId: 'admin_456', name: 'Support Person 2' });

  const admin2Data = await userReceivedAdmin2Promise;
  console.log(`User1 received status: count = ${admin2Data.count}, isOnline = ${admin2Data.isOnline}`);
  if (admin2Data.count !== 2 || admin2Data.isOnline !== true) throw new Error('Expected count 2');
  console.log('✓ 4. Multi-admin count tracked accurately (2 active advisors)');

  // Test 5: First Admin disconnects (status remains online because 1 admin still active)
  console.log('\n--- 5. Testing One Admin Disconnects (Remains Online) ---');
  const userReceivedDecPromise = new Promise((resolve) => {
    user1.on('advisor-status', (data) => {
      if (data.count === 1) resolve(data);
    });
  });

  admin1.disconnect();
  const decData = await userReceivedDecPromise;
  console.log(`User1 received status: count = ${decData.count}, isOnline = ${decData.isOnline}`);
  if (decData.count !== 1 || decData.isOnline !== true) throw new Error('Expected count 1, isOnline true');
  console.log('✓ 5. System correctly remains Online while at least 1 admin is connected');

  // Test 6: Final Admin disconnects -> User receives Offline broadcast
  console.log('\n--- 6. Testing Final Admin Disconnects (User Receives Offline) ---');
  const userReceivedOfflinePromise = new Promise((resolve) => {
    user1.on('advisor-status', (data) => {
      if (data.isOnline === false) resolve(data);
    });
  });

  admin2.disconnect();
  const offlineData = await userReceivedOfflinePromise;
  console.log(`User1 received status: count = ${offlineData.count}, isOnline = ${offlineData.isOnline}`);
  if (offlineData.count !== 0 || offlineData.isOnline !== false) throw new Error('Expected count 0, isOnline false');
  console.log('✓ 6. User client received real-time broadcast: Admin is OFFLINE!');

  // Cleanup
  user1.disconnect();
  server.close();
  console.log('\n=== ALL ADVISOR PRESENCE TESTS PASSED (6/6) ===');
}

testAdvisorPresence().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
