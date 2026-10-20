/*
 * Friend Express MVC Web Server App
 * Entry Point (WebRTC and Socket.io enabled)
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const connectDB = require('./config/db');
const callService = require('./services/callService');
const pushNotificationService = require('./services/pushNotificationService');
const apiRoutes = require('./API');

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // 1. Connect to MongoDB Atlas (blocks until successful or fails/exits)
    await connectDB();

    const app = express();
    // Enable trust proxy so req.protocol and cookies work reliably behind Nginx / reverse proxies
    app.set('trust proxy', 1);
    const server = http.createServer(app);
    const io = new Server(server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
      },
      pingTimeout: 30000,
      pingInterval: 15000,
      transports: ['websocket', 'polling']
    });

    // Enable Cross-Origin Resource Sharing (for React Native and Mobile apps)
    app.use(cors());

    // Set EJS as View Engine
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));

    // Parse incoming request JSON / bodies (preserve rawBody for webhook HMAC verification)
    app.use(express.json({
      verify: (req, res, buf) => {
        req.rawBody = buf;
      }
    }));
    app.use(express.urlencoded({ extended: true }));

    // Express Session Middleware with Mongo Session Store (reusing Mongoose connection)
    app.use(session({
      secret: process.env.SESSION_SECRET || 'friend-support-calling-app-secret-123',
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({
        client: mongoose.connection.getClient(),
        collectionName: 'sessions',
        ttl: 14 * 24 * 60 * 60 // 14 days
      }),
      cookie: {
        maxAge: 1000 * 60 * 60 * 24, // 24 hours
        secure: 'auto', // Automatically secure on HTTPS
        sameSite: 'lax' // Preserves session on top-level GET return from Stripe
      }
    }));

    // Make session variables and live advisor presence available in all EJS templates
    app.use((req, res, next) => {
      res.locals.session = req.session;
      res.locals.isAdvisorOnline = callService.isAdvisorOnline();
      next();
    });

    // Real-time Advisor Online Status API
    app.get('/api/advisor-status', (req, res) => {
      res.json({
        success: true,
        ...callService.getAdvisorPresenceInfo()
      });
    });

    // Serve Static Assets from Public folder
    app.use(express.static(path.join(__dirname, 'public')));

    // Import MVC Routers (controllers will load and seed admin only after DB connection is ready)
    const publicRoutes = require('./routes/publicRoutes');
    const authRoutes = require('./routes/authRoutes');
    const userRoutes = require('./routes/userRoutes');
    const adminRoutes = require('./routes/adminRoutes');
    const paymentRoutes = require('./routes/paymentRoutes');

    // Mount API Routes for React Native Mobile Application
    app.use('/api', apiRoutes);

    // Mount MVC Routers
    app.use('/', publicRoutes);
    app.use('/', authRoutes);
    app.use('/user', userRoutes);
    app.use('/admin', adminRoutes);
    app.use('/api/payments', paymentRoutes);
    app.use('/api/credits', paymentRoutes);
    app.use('/api/calls', paymentRoutes);

    // 404 Fallback - redirect to home page
    app.use((req, res) => {
      res.status(404).redirect('/');
    });

    // Disconnect grace tracking map to prevent premature call drops on socket transport switches or brief network glitches
    const callDisconnectTimers = new Map();
    const CALL_DISCONNECT_GRACE_MS = 35000; // 35s grace period before considering call disconnected

    // Socket.io Signaling Logic for WebRTC & Live Presence
    const webrtcConfig = require('./config/webrtcConfig');
    webrtcConfig.fetchMeteredIceServers().catch(() => {});

    io.on('connection', (socket) => {
      console.log(`[Socket] Client connected: ${socket.id}`);

      // Emit immediate current advisor presence state to newly connected client
      socket.emit('advisor-status', callService.getAdvisorPresenceInfo());

      // Query current advisor presence status on demand
      socket.on('get-advisor-status', (callback) => {
        const info = callService.getAdvisorPresenceInfo();
        if (typeof callback === 'function') callback(info);
        else socket.emit('advisor-status', info);
      });

      // When admin mounts (dashboard, console, or active call), register admin presence
      socket.on('admin-join', (data) => {
        socket.join('admins');
        socket.isAdmin = true;
        const presence = callService.registerAdminPresence(socket.id, data || {});
        io.emit('advisor-status', presence);
        console.log(`[Socket] Admin registered: ${socket.id}, Total online admins: ${presence.count}`);
      });

      // When user joins calling screen
      socket.on('join-call-room', async (data) => {
        const roomId = data.callId || 'call_room';
        socket.join(roomId);
        socket.callId = data.callId;
        socket.userId = data.userId;
        socket.callType = data.callType || 'Voice';
        socket.role = data.role || 'user';

        // Clear disconnect grace timer if client reconnected
        if (data.callId && callDisconnectTimers.has(data.callId)) {
          console.log(`[Socket Grace] Client reconnected for call ${data.callId}. Clearing disconnect grace timer.`);
          clearTimeout(callDisconnectTimers.get(data.callId));
          callDisconnectTimers.delete(data.callId);
        }

        // 1. Resolve real caller name with 100% database accuracy
        let callerName = data.userName;
        let callerMobile = '';
        let isAlreadyActive = false;
        try {
          const Call = require('./models/Call');
          const User = require('./models/User');
          const callDoc = await Call.findOne({ callId: data.callId }).populate('user');
          if (callDoc) {
            callerName = (callDoc.user && callDoc.user.name) || callDoc.callerName || callerName;
            callerMobile = (callDoc.user && callDoc.user.mobile) || '';
            if (callDoc.status === 'In Progress' || callDoc.status === 'Connected') {
              isAlreadyActive = true;
            }
          } else if (data.userId) {
            const userDoc = await User.findById(data.userId);
            if (userDoc) {
              callerName = userDoc.name || callerName;
              callerMobile = userDoc.mobile || '';
            }
          }
        } catch (dbErr) {
          console.error('[join-call-room] DB lookup error:', dbErr.message);
        }

        if (!callerName || callerName === 'Caller' || callerName.trim() === '') {
          callerName = 'Client Member';
        }
        socket.userName = callerName;

        callService.logStructured('CALL_INCOMING', {
          callId: data.callId,
          userId: data.userId,
          userName: callerName,
          callType: socket.callType,
          socketId: socket.id,
          roomId: roomId
        });

        // If call is already actively in progress (e.g. transport upgrade / socket reconnect), sync without ringing alerts
        if (isAlreadyActive) {
          console.log(`[Socket] Re-joining actively connected call ${data.callId}. Emitting call-active sync.`);
          socket.emit('call-active', { callId: data.callId });
          return;
        }

        // Notify caller that call has been initiated and device is being rung
        socket.emit('call-placed', { callId: data.callId });
        socket.emit('call-ringing', { callId: data.callId });

        const incomingAlertData = {
          callId: data.callId,
          callerId: socket.id,
          callerName: callerName,
          callerMobile: callerMobile,
          callType: socket.callType,
          userId: data.userId,
          roomId: roomId
        };

        // Notify all active admin monitors of incoming call request
        io.to('admins').emit('incoming-call-alert', incomingAlertData);

        // Trigger High-Priority Call Push Notification to wake up closed/background mobile devices
        pushNotificationService.sendIncomingCallAlert(incomingAlertData);
      });

      // Acknowledge incoming call is ringing on client device (WhatsApp style ringback)
      socket.on('client-ringing', (data) => {
        const roomId = (data && data.callId) || socket.callId || 'call_room';
        socket.to(roomId).emit('call-ringing', { callId: data && data.callId });
      });

      // When admin accepts call
      socket.on('admin-accept-call', async (data) => {
        const roomId = data.callId || 'call_room';
        socket.join(roomId);
        socket.callId = data.callId;
        socket.role = 'admin';

        // Clear disconnect grace timer if admin joined
        if (data.callId && callDisconnectTimers.has(data.callId)) {
          console.log(`[Socket Grace] Admin joined call ${data.callId}. Clearing disconnect grace timer.`);
          clearTimeout(callDisconnectTimers.get(data.callId));
          callDisconnectTimers.delete(data.callId);
        }

        // Fetch verified caller details from database
        let callerName = '';
        let callerMobile = '';
        try {
          const Call = require('./models/Call');
          const callDoc = await Call.findOne({ callId: data.callId }).populate('user');
          if (callDoc) {
            callerName = (callDoc.user && callDoc.user.name) || callDoc.callerName || '';
            callerMobile = (callDoc.user && callDoc.user.mobile) || '';
          }
        } catch (e) {}

        callService.logStructured('CALL_ACCEPTED', {
          callId: data.callId,
          adminId: data.adminId,
          adminName: data.adminName,
          callerName: callerName,
          callType: data.callType || socket.callType,
          socketId: socket.id
        });

        if (data.callId) {
          try {
            await callService.acceptCall({
              callId: data.callId,
              admin: { _id: data.adminId, name: data.adminName }
            });
          } catch (e) {
            console.error('[Socket Error] acceptCall failed:', e);
            socket.emit('call-accept-error', {
              callId: data.callId,
              reason: e.message || 'Call could not be accepted'
            });
            return;
          }
        }

        // Notify caller client that peer has connected, trigger WebRTC PeerConnection handshake
        const peerConnectedData = {
          callId: data.callId,
          adminId: socket.id,
          adminName: data.adminName || 'Ashu',
          callerName: callerName,
          callerMobile: callerMobile,
          callType: data.callType || socket.callType || 'Voice'
        };

        if (data.callerId && io.sockets.sockets.has(data.callerId)) {
          io.to(data.callerId).emit('peer-connected', peerConnectedData);
        }
        socket.to(roomId).emit('peer-connected', peerConnectedData);

        // Acknowledge back to accepting admin socket with verified caller details
        socket.emit('call-accepted-ack', {
          callId: data.callId,
          callerName: callerName,
          callerMobile: callerMobile,
          roomId: roomId
        });
      });

      // When admin rejects/declines call
      socket.on('admin-reject-call', async (data) => {
        const callId = data.callId || socket.callId;
        const roomId = callId || 'call_room';

        callService.logStructured('CALL_REJECTED', {
          callId,
          callerId: data.callerId,
          socketId: socket.id
        });

        if (callId) {
          try {
            await callService.finalizeCall(callId, { reason: 'Rejected' });
          } catch (e) {
            console.error('[Socket Error] finalizeCall (reject) failed:', e);
          }
        }

        socket.to(roomId).emit('call-rejected', { callId, reason: 'Declined by Ashu' });
        io.to('admins').emit('call-dismissed', { callId });
        socket.leave(roomId);
      });

      // When WebRTC peer connection is established
      socket.on('call-connected', async (data) => {
        const callId = data.callId || socket.callId;
        const roomId = callId || 'call_room';

        callService.logStructured('CALL_CONNECTED', {
          callId,
          socketId: socket.id
        });

        if (callId) {
          try {
            await callService.connectCall({ callId });
          } catch (e) {
            console.error('[Socket Error] connectCall failed:', e);
          }
        }

        io.to(roomId).emit('call-active', { callId, connectedAt: new Date() });
      });

      // Forward WebRTC SDP Offer (Direct socket addressing with room fallback)
      socket.on('send-offer', (data) => {
        const roomId = data.callId || 'call_room';
        const payload = {
          offer: data.offer,
          senderId: socket.id,
          callId: data.callId
        };
        let delivered = false;
        if (data.targetId && io.sockets.sockets.has(data.targetId)) {
          io.to(data.targetId).emit('receive-offer', payload);
          delivered = true;
        }
        if (!delivered && roomId) {
          socket.to(roomId).emit('receive-offer', payload);
        }
      });

      // Forward WebRTC SDP Answer (Direct socket addressing with room fallback)
      socket.on('send-answer', (data) => {
        const roomId = data.callId || 'call_room';
        const payload = {
          answer: data.answer,
          senderId: socket.id,
          callId: data.callId
        };
        let delivered = false;
        if (data.targetId && io.sockets.sockets.has(data.targetId)) {
          io.to(data.targetId).emit('receive-answer', payload);
          delivered = true;
        }
        if (!delivered && roomId) {
          socket.to(roomId).emit('receive-answer', payload);
        }
      });

      // Forward WebRTC ICE Candidates (Direct socket addressing with room fallback)
      socket.on('send-candidate', (data) => {
        const roomId = data.callId || 'call_room';
        const payload = {
          candidate: data.candidate,
          senderId: socket.id,
          callId: data.callId
        };
        let delivered = false;
        if (data.targetId && io.sockets.sockets.has(data.targetId)) {
          io.to(data.targetId).emit('receive-candidate', payload);
          delivered = true;
        }
        if (!delivered && roomId) {
          socket.to(roomId).emit('receive-candidate', payload);
        }
      });

      // Hangup call (explicit user or admin hangup action)
      socket.on('hangup', async (data) => {
        const callId = (data && data.callId) || socket.callId;
        const reason = (data && data.reason) || 'Completed';
        const failureReason = (data && data.failureReason) || '';
        const errorCode = (data && data.errorCode) || '';
        const failedAtStage = (data && data.failedAtStage) || '';
        const errorDetails = (data && data.errorDetails) || '';
        const roomId = callId || 'call_room';

        // Clear any pending disconnect grace timer immediately on explicit hangup
        if (callId && callDisconnectTimers.has(callId)) {
          console.log(`[Socket Hangup] Clearing disconnect grace timer for call ${callId}`);
          clearTimeout(callDisconnectTimers.get(callId));
          callDisconnectTimers.delete(callId);
        }

        callService.logStructured('CALL_ENDED', {
          callId,
          reason,
          failureReason,
          errorCode,
          failedAtStage,
          socketId: socket.id
        });

        if (callId) {
          try {
            const final = await callService.finalizeCall(callId, {
              reason,
              failureReason,
              errorCode,
              failedAtStage,
              errorDetails
            });
            if (final && final.call) {
              io.to(roomId).emit('call-finalized', {
                callId,
                duration: final.call.duration,
                credits: final.call.credits,
                status: final.call.status,
                remainingCredits: final.remainingCredits
              });
            }
          } catch (e) {
            console.error('[Socket Error] finalizeCall on hangup failed:', e);
          }
        }

        // Notify admins if call was cancelled or missed before answer
        if (reason === 'Cancelled' || reason === 'Missed') {
          io.to('admins').emit('call-cancelled', { callId, reason });
          if (callId) pushNotificationService.sendCallCancelledAlert(callId);
        }

        socket.to(roomId).emit('peer-disconnected', { callId, reason, explicit: true });
        socket.leave(roomId);
      });

      // Real-time call connection issue / diagnostic logger
      socket.on('call-issue-log', async (data) => {
        try {
          const callId = (data && data.callId) || socket.callId;
          const role = socket.isAdmin ? 'admin' : (socket.role || 'user');
          await callService.recordCallLog({
            callId,
            userId: socket.userId || (data && data.userId) || null,
            adminId: socket.isAdmin ? socket.id : null,
            role,
            eventType: (data && data.eventType) || 'CONNECTION_ISSUE',
            severity: (data && data.severity) || 'info',
            stage: (data && data.stage) || 'general',
            errorName: (data && data.errorName) || '',
            errorMessage: (data && data.errorMessage) || '',
            details: (data && data.details) || {},
            markCallFailed: Boolean(data && data.markCallFailed)
          });
        } catch (logErr) {
          console.error('[Socket Diagnostic Log Error]', logErr);
        }
      });

      // Connection drop / Browser Refresh / Tab Close
      socket.on('disconnect', async () => {
        const callId = socket.callId;
        const socketRole = socket.role || (socket.isAdmin ? 'admin' : 'user');

        callService.logStructured('SOCKET_DISCONNECTED', {
          socketId: socket.id,
          callId: callId || null,
          role: socketRole
        });

        // If disconnected socket was an admin, update presence and broadcast live status
        if (socket.isAdmin) {
          const presence = callService.unregisterAdminPresence(socket.id);
          io.emit('advisor-status', presence);
          console.log(`[Socket] Admin disconnected: ${socket.id}, Remaining online admins: ${presence.count}`);
        }

        // Resilient disconnect handling: DO NOT kill active call immediately on a socket disconnect!
        // Start a 35s grace timer for the client/admin to reconnect (e.g. transport upgrade or page transition).
        if (callId) {
          const roomId = callId;
          try {
            const Call = require('./models/Call');
            const activeCallDoc = await Call.findOne({ callId });

            const terminalStates = ['Completed', 'Cancelled', 'Failed', 'Rejected', 'Missed'];
            if (!activeCallDoc || terminalStates.includes(activeCallDoc.status)) {
              return;
            }

            console.log(`[Socket Grace] Socket ${socket.id} (${socketRole}) disconnected for call ${callId}. Starting ${CALL_DISCONNECT_GRACE_MS / 1000}s grace timer...`);

            if (callDisconnectTimers.has(callId)) {
              clearTimeout(callDisconnectTimers.get(callId));
            }

            const graceTimer = setTimeout(async () => {
              callDisconnectTimers.delete(callId);
              console.warn(`[Socket Grace Expired] Grace period expired for call ${callId}. Finalizing call session.`);

              try {
                const currentDoc = await Call.findOne({ callId });
                if (currentDoc && !terminalStates.includes(currentDoc.status)) {
                  const final = await callService.finalizeCall(callId, {
                    reason: currentDoc.status === 'In Progress' ? 'Completed' : 'Cancelled',
                    failureReason: 'Connection lost (socket disconnected without reconnect)',
                    errorCode: 'SOCKET_DISCONNECT_TIMEOUT'
                  });

                  if (final && final.call) {
                    io.to(roomId).emit('call-finalized', {
                      callId,
                      duration: final.call.duration,
                      credits: final.call.credits,
                      status: final.call.status,
                      remainingCredits: final.remainingCredits
                    });
                  }
                  io.to(roomId).emit('peer-disconnected', { callId, reason: 'Disconnected', explicit: true });
                  io.to('admins').emit('call-cancelled', { callId, reason: 'Timeout' });
                }
              } catch (finErr) {
                console.error('[Socket Grace Finalize Error]', finErr);
              }
            }, CALL_DISCONNECT_GRACE_MS);

            callDisconnectTimers.set(callId, graceTimer);
          } catch (dbErr) {
            console.error('[Socket Disconnect DB Error]', dbErr);
          }
        }
      });
    });

    // Start Server Listen (bind to 0.0.0.0 to accept LAN connections from mobile devices)
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`[Talk With Ashu Server] WebRTC enabled server running successfully:`);
      console.log(`  - Local:   http://localhost:${PORT}`);
      console.log(`  - Network: http://192.168.0.102:${PORT}`);
      console.log(`[Talk With Ashu Status] Press CTRL+C to stop the process.`);
    });
  } catch (error) {
    console.error(`[Fatal Startup Error] Server failed to start:`, error);
    process.exit(1);
  }
}

startServer();
