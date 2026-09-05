/*
 * Friend Express MVC Web Server App
 * Entry Point (WebRTC and Socket.io enabled)
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const http = require('http');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const connectDB = require('./config/db');

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // 1. Connect to MongoDB Atlas (blocks until successful or fails/exits)
    await connectDB();

    const app = express();
    const server = http.createServer(app);
    const io = new Server(server);

    // Set EJS as View Engine
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));

    // Parse incoming request JSON / bodies
    app.use(express.json());
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
        secure: false // Set to true if running over HTTPS
      }
    }));

    // Make session variables available in EJS templates
    app.use((req, res, next) => {
      res.locals.session = req.session;
      next();
    });

    // Serve Static Assets from Public folder
    app.use(express.static(path.join(__dirname, 'public')));

    // Import MVC Routers (controllers will load and seed admin only after DB connection is ready)
    const publicRoutes = require('./routes/publicRoutes');
    const authRoutes = require('./routes/authRoutes');
    const userRoutes = require('./routes/userRoutes');
    const adminRoutes = require('./routes/adminRoutes');

    // Mount MVC Routers
    app.use('/', publicRoutes);
    app.use('/', authRoutes);
    app.use('/user', userRoutes);
    app.use('/admin', adminRoutes);

    // 404 Fallback - redirect to home page
    app.use((req, res) => {
      res.status(404).redirect('/');
    });

    const callService = require('./services/callService');

    // Socket.io Signaling Logic for WebRTC
    io.on('connection', (socket) => {
      console.log(`[Socket] Client connected: ${socket.id}`);

      // When admin dashboard mounts, register admin channel
      socket.on('admin-join', () => {
        socket.join('admins');
        console.log(`[Socket] Admin registered: ${socket.id}`);
      });

      // When user joins calling screen
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

        // Notify all active admin monitors of incoming call request
        io.to('admins').emit('incoming-call-alert', {
          callId: data.callId,
          callerId: socket.id,
          callerName: data.userName,
          userId: data.userId,
          roomId: roomId
        });
      });

      // When admin accepts call
      socket.on('admin-accept-call', async (data) => {
        const roomId = data.callId || 'call_room';
        socket.join(roomId);
        socket.callId = data.callId;
        socket.role = 'admin';

        callService.logStructured('CALL_ACCEPTED', {
          callId: data.callId,
          adminId: data.adminId,
          adminName: data.adminName,
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
          }
        }

        // Notify caller client that peer has connected, trigger WebRTC PeerConnection handshake
        socket.to(roomId).emit('peer-connected', {
          callId: data.callId,
          adminId: socket.id,
          adminName: data.adminName || 'Support Partner'
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

        socket.to(roomId).emit('call-rejected', { callId, reason: 'Declined by Advisor' });
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

      // Forward WebRTC SDP Offer
      socket.on('send-offer', (data) => {
        socket.to(data.targetId).emit('receive-offer', {
          offer: data.offer,
          senderId: socket.id
        });
      });

      // Forward WebRTC SDP Answer
      socket.on('send-answer', (data) => {
        socket.to(data.targetId).emit('receive-answer', {
          answer: data.answer,
          senderId: socket.id
        });
      });

      // Forward WebRTC ICE Candidates
      socket.on('send-candidate', (data) => {
        socket.to(data.targetId).emit('receive-candidate', {
          candidate: data.candidate,
          senderId: socket.id
        });
      });

      // Hangup call
      socket.on('hangup', async (data) => {
        const callId = (data && data.callId) || socket.callId;
        const reason = (data && data.reason) || 'Completed';
        const roomId = callId || 'call_room';

        callService.logStructured('CALL_ENDED', {
          callId,
          reason,
          socketId: socket.id
        });

        if (callId) {
          try {
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
          } catch (e) {
            console.error('[Socket Error] finalizeCall on hangup failed:', e);
          }
        }

        // Notify admins if call was cancelled or missed before answer
        if (reason === 'Cancelled' || reason === 'Missed') {
          io.to('admins').emit('call-cancelled', { callId, reason });
        }

        socket.to(roomId).emit('peer-disconnected', { callId, reason });
        socket.leave(roomId);
      });

      // Connection drop / Browser Refresh / Tab Close
      socket.on('disconnect', async () => {
        const callId = socket.callId;
        callService.logStructured('SOCKET_DISCONNECTED', {
          socketId: socket.id,
          callId: callId || null
        });

        if (callId) {
          const roomId = callId;
          // Notify any pending admin monitor
          io.to('admins').emit('call-cancelled', { callId, reason: 'Disconnected' });
          socket.to(roomId).emit('peer-disconnected', { callId, reason: 'Disconnected' });
          try {
            await callService.finalizeCall(callId, { reason: 'Completed' });
          } catch (e) {
            console.error('[Socket Error] finalizeCall on disconnect failed:', e);
          }
        } else {
          socket.to('call_room').emit('peer-disconnected');
        }
      });
    });

    // Start Server Listen
    server.listen(PORT, () => {
      console.log(`[Friend Server] WebRTC enabled server running successfully at http://localhost:${PORT}`);
      console.log(`[Friend Status] Press CTRL+C to stop the process.`);
    });
  } catch (error) {
    console.error(`[Fatal Startup Error] Server failed to start:`, error);
    process.exit(1);
  }
}

startServer();
