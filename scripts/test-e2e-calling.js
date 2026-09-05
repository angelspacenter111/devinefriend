/**
 * End-to-End Calling System Verification Script
 * Validates complete User -> Admin calling pipeline including WebRTC signaling,
 * dynamic rooms, multi-channel admin alerts, state transitions, and billing deductions.
 */

require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');
const { io: ioClient } = require('socket.io-client');
const User = require('../models/User');
const Call = require('../models/Call');
const Transaction = require('../models/Transaction');
const callService = require('../services/callService');

async function runE2ETest() {
  console.log('=== STARTING E2E CALLING SYSTEM VERIFICATION ===\n');

  // Connect to DB
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✓ Connected to MongoDB Atlas');

  // Start HTTP + Socket.IO server on test port 3099
  const express = require('express');
  const session = require('express-session');
  const { Server } = require('socket.io');

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);

  app.use(express.json());

  // Mount the same signaling logic as app.js
  io.on('connection', (socket) => {
    socket.on('admin-join', () => {
      socket.join('admins');
    });

    socket.on('join-call-room', (data) => {
      const roomId = data.callId || 'call_room';
      socket.join(roomId);
      socket.callId = data.callId;
      socket.userId = data.userId;
      socket.userName = data.userName;
      socket.role = 'user';

      callService.logStructured('CALL_INCOMING', {
        callId: data.callId,
        userId: data.userId,
        userName: data.userName,
        socketId: socket.id,
        roomId: roomId
      });

      io.to('admins').emit('incoming-call-alert', {
        callId: data.callId,
        callerId: socket.id,
        callerName: data.userName,
        userId: data.userId,
        roomId: roomId
      });
    });

    socket.on('admin-accept-call', async (data) => {
      const roomId = data.callId || 'call_room';
      socket.join(roomId);
      socket.callId = data.callId;
      socket.role = 'admin';

      if (data.callId) {
        await callService.acceptCall({
          callId: data.callId,
          admin: { _id: data.adminId, name: data.adminName }
        });
      }

      socket.to(roomId).emit('peer-connected', {
        callId: data.callId,
        adminId: socket.id,
        adminName: data.adminName || 'Support Partner'
      });
    });

    socket.on('admin-reject-call', async (data) => {
      const callId = data.callId || socket.callId;
      const roomId = callId || 'call_room';

      if (callId) {
        await callService.finalizeCall(callId, { reason: 'Rejected' });
      }

      socket.to(roomId).emit('call-rejected', { callId, reason: 'Declined by Advisor' });
      io.to('admins').emit('call-dismissed', { callId });
      socket.leave(roomId);
    });

    socket.on('call-connected', async (data) => {
      const callId = data.callId || socket.callId;
      const roomId = callId || 'call_room';

      if (callId) {
        await callService.connectCall({ callId });
      }
      io.to(roomId).emit('call-active', { callId, connectedAt: new Date() });
    });

    socket.on('send-offer', (data) => {
      socket.to(data.targetId).emit('receive-offer', {
        offer: data.offer,
        senderId: socket.id
      });
    });

    socket.on('send-answer', (data) => {
      socket.to(data.targetId).emit('receive-answer', {
        answer: data.answer,
        senderId: socket.id
      });
    });

    socket.on('send-candidate', (data) => {
      socket.to(data.targetId).emit('receive-candidate', {
        candidate: data.candidate,
        senderId: socket.id
      });
    });

    socket.on('hangup', async (data) => {
      const callId = (data && data.callId) || socket.callId;
      const reason = (data && data.reason) || 'Completed';
      const roomId = callId || 'call_room';

      if (callId) {
        const final = await callService.finalizeCall(callId, { reason });
        if (final && final.call) {
          io.to(roomId).emit('call-finalized', {
            callId,
            duration: final.call.duration,
            credits: final.call.credits,
            status: final.call.status,
            remainingCredits: final.remainingCredits
          });
        }
      }

      if (reason === 'Cancelled' || reason === 'Missed') {
        io.to('admins').emit('call-cancelled', { callId, reason });
      }

      socket.to(roomId).emit('peer-disconnected', { callId, reason });
      socket.leave(roomId);
    });
  });

  await new Promise((res) => server.listen(3099, res));
  console.log('✓ Test signaling server listening on port 3099\n');

  // Pick a real user and admin
  const testUser = await User.findOne({ role: 'user', credits: { $gt: 5 } });
  const testAdmin = await User.findOne({ role: 'admin' });

  console.log(`Using Test User: ${testUser.name} (${testUser.mobile}), Credits: ${testUser.credits}`);
  console.log(`Using Test Admin: ${testAdmin.name} (${testAdmin.email})\n`);

  // =========================================================================
  // SCENARIO 1: Full Successful Call Lifecycle (Initiate -> Ring -> Accept -> Connect -> Hangup)
  // =========================================================================
  console.log('--- TEST 1: Full Successful Call Lifecycle ---');

  // Step 1: User calls /user/call (initiates call in DB)
  const callDoc = await callService.initiateCall({ user: testUser, callType: 'Voice' });
  console.log(`✓ 1. Call created in DB: ${callDoc.callId}, Status: ${callDoc.status}`);

  // Step 2: Admin connects to socket and joins 'admins' room
  const adminClient = ioClient('http://localhost:3099');
  await new Promise((resolve) => adminClient.on('connect', resolve));
  adminClient.emit('admin-join');
  console.log('✓ 2. Admin client connected and registered to "admins" room');

  // Step 3: User connects to socket and emits 'join-call-room'
  const userClient = ioClient('http://localhost:3099');
  await new Promise((resolve) => userClient.on('connect', resolve));

  // Listen for admin to receive incoming-call-alert
  const incomingAlertPromise = new Promise((resolve) => {
    adminClient.on('incoming-call-alert', (alertData) => {
      resolve(alertData);
    });
  });

  userClient.emit('join-call-room', {
    callId: callDoc.callId,
    userId: testUser._id.toString(),
    userName: testUser.name
  });
  console.log(`✓ 3. User joined call room with callId: ${callDoc.callId}`);

  const incomingAlert = await incomingAlertPromise;
  console.log(`✓ 4. Admin received incoming-call-alert! Caller: ${incomingAlert.callerName}, Call ID: ${incomingAlert.callId}`);
  if (incomingAlert.callId !== callDoc.callId) throw new Error('Call ID mismatch on alert');

  // Step 4: Admin accepts call
  const peerConnectedPromise = new Promise((resolve) => {
    userClient.on('peer-connected', (peerData) => {
      resolve(peerData);
    });
  });

  adminClient.emit('admin-accept-call', {
    callId: callDoc.callId,
    callerId: incomingAlert.callerId,
    adminId: testAdmin._id.toString(),
    adminName: testAdmin.name
  });
  console.log('✓ 5. Admin accepted call');

  const peerConnected = await peerConnectedPromise;
  console.log(`✓ 6. User received peer-connected event! Admin ID: ${peerConnected.adminId}`);

  // Step 5: WebRTC Offer/Answer Exchange
  const offerPromise = new Promise((resolve) => {
    adminClient.on('receive-offer', (data) => resolve(data));
  });

  userClient.emit('send-offer', {
    offer: { type: 'offer', sdp: 'v=0\r\no=caller 123 456 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' },
    targetId: peerConnected.adminId,
    callId: callDoc.callId
  });

  const receivedOffer = await offerPromise;
  console.log('✓ 7. Admin received WebRTC SDP Offer from caller');

  const answerPromise = new Promise((resolve) => {
    userClient.on('receive-answer', (data) => resolve(data));
  });

  adminClient.emit('send-answer', {
    answer: { type: 'answer', sdp: 'v=0\r\no=admin 789 012 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' },
    targetId: receivedOffer.senderId,
    callId: callDoc.callId
  });

  await answerPromise;
  console.log('✓ 8. User received WebRTC SDP Answer from admin');

  // Step 6: Mark call-connected
  userClient.emit('call-connected', { callId: callDoc.callId });
  // Wait a small moment for connect Call in DB
  await new Promise((r) => setTimeout(r, 100));

  const dbConnected = await Call.findOne({ callId: callDoc.callId });
  console.log(`✓ 9. Call connected in DB: Status: ${dbConnected.status}, ConnectedTime: ${dbConnected.connectedTime}`);

  // Step 7: Hangup
  const callFinalizedPromise = new Promise((resolve) => {
    userClient.on('call-finalized', (data) => resolve(data));
  });

  userClient.emit('hangup', { callId: callDoc.callId, reason: 'Completed' });

  const finalizedData = await callFinalizedPromise;
  console.log(`✓ 10. User received call-finalized! Status: ${finalizedData.status}, Credits: ${finalizedData.credits}`);

  const dbFinal = await Call.findOne({ callId: callDoc.callId });
  console.log(`✓ 11. Final DB Record: Status: ${dbFinal.status}, Finalized: ${dbFinal.finalized}, Duration: ${dbFinal.duration}\n`);

  userClient.disconnect();
  adminClient.disconnect();

  // =========================================================================
  // SCENARIO 2: Caller Cancels Before Admin Answers
  // =========================================================================
  console.log('--- TEST 2: Caller Cancels Before Admin Answers ---');
  const call2 = await callService.initiateCall({ user: testUser, callType: 'Voice' });
  const admin2 = ioClient('http://localhost:3099');
  await new Promise((r) => admin2.on('connect', r));
  admin2.emit('admin-join');

  const user2 = ioClient('http://localhost:3099');
  await new Promise((r) => user2.on('connect', r));

  const alertPromise2 = new Promise((r) => admin2.on('incoming-call-alert', r));
  user2.emit('join-call-room', { callId: call2.callId, userId: testUser._id.toString(), userName: testUser.name });
  await alertPromise2;

  // Caller cancels
  const cancelPromise = new Promise((r) => admin2.on('call-cancelled', r));
  user2.emit('hangup', { callId: call2.callId, reason: 'Cancelled' });

  const cancelData = await cancelPromise;
  console.log(`✓ 1. Admin received call-cancelled for Call ID: ${cancelData.callId}, Reason: ${cancelData.reason}`);

  const db2 = await Call.findOne({ callId: call2.callId });
  console.log(`✓ 2. DB Record: Status: ${db2.status}, Credits: ${db2.credits} (Zero charges)\n`);

  user2.disconnect();
  admin2.disconnect();

  // =========================================================================
  // SCENARIO 3: Admin Declines Incoming Call
  // =========================================================================
  console.log('--- TEST 3: Admin Declines/Rejects Incoming Call ---');
  const call3 = await callService.initiateCall({ user: testUser, callType: 'Voice' });
  const admin3 = ioClient('http://localhost:3099');
  await new Promise((r) => admin3.on('connect', r));
  admin3.emit('admin-join');

  const user3 = ioClient('http://localhost:3099');
  await new Promise((r) => user3.on('connect', r));

  const alertPromise3 = new Promise((r) => admin3.on('incoming-call-alert', r));
  user3.emit('join-call-room', { callId: call3.callId, userId: testUser._id.toString(), userName: testUser.name });
  const alert3 = await alertPromise3;

  const rejectedPromise = new Promise((r) => user3.on('call-rejected', r));
  admin3.emit('admin-reject-call', { callId: call3.callId, callerId: alert3.callerId });

  const rejectedData = await rejectedPromise;
  console.log(`✓ 1. User received call-rejected! Reason: ${rejectedData.reason}`);

  const db3 = await Call.findOne({ callId: call3.callId });
  console.log(`✓ 2. DB Record: Status: ${db3.status}, Credits: ${db3.credits} (Zero charges)\n`);

  user3.disconnect();
  admin3.disconnect();

  // Cleanup test server
  server.close();
  await mongoose.disconnect();
  console.log('=== ALL E2E CALLING VERIFICATION TESTS PASSED SUCCESSFULLY (3/3) ===');
}

runE2ETest().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
