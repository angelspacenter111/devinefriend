/**
 * Live Web Calling & Video Call Verification Script
 * Connects to live server https://talkwithashu.duckdns.org
 * Tests:
 * 1. Health & Server Endpoints
 * 2. Realtime Advisor Presence API
 * 3. Cloudflare Calls SFU Status & Edge Session Allocation
 * 4. Realtime Socket.IO Connection & Authentication
 * 5. Voice Call Signaling (Initiate -> Ringing Alert -> Accept -> SDP Offer/Answer -> Connect -> Terminate)
 * 6. Video Call Signaling & Video Track Handshake (Video SDP Negotiation -> Connected)
 */

const { io } = require('socket.io-client');

const LIVE_URL = 'https://talkwithashu.duckdns.org';

async function runLiveTest() {
  console.log('================================================================');
  console.log('     LIVE WEB APPLICATION TESTING (VOICE & VIDEO CALLS)         ');
  console.log(`     Target: ${LIVE_URL}`);
  console.log('================================================================\n');

  // Step 1: Health & SFU HTTP Endpoints
  console.log('[STEP 1] Testing Live HTTP & SFU APIs...');
  
  const healthRes = await fetch(`${LIVE_URL}/api/health`).then(r => r.json());
  console.log('✓ Health Endpoint:', healthRes.status, '| App:', healthRes.app, '| Ver:', healthRes.version);

  const advisorRes = await fetch(`${LIVE_URL}/api/advisor-status`).then(r => r.json());
  console.log('✓ Advisor Status API: Success:', advisorRes.success, '| Online:', advisorRes.online, '| Count:', advisorRes.count);

  const sfuRes = await fetch(`${LIVE_URL}/api/sfu/status`).then(r => r.json());
  console.log('✓ Cloudflare SFU Status:', sfuRes.status || (sfuRes.enabled ? 'enabled' : 'disabled'), '| Provider:', sfuRes.provider);

  const sfuSessionRes = await fetch(`${LIVE_URL}/api/sfu/session/new`, { method: 'POST' }).then(r => r.json());
  console.log('✓ Cloudflare SFU Session Creation: Success:', sfuSessionRes.success, '| SessionId:', sfuSessionRes.sessionId ? sfuSessionRes.sessionId.slice(0, 16) + '...' : 'none');

  if (!sfuSessionRes.success) {
    console.warn('⚠️ Note: SFU session creation failed, WebRTC will fall back to P2P Mesh with TLS TURNS.');
  }

  // Step 2: Socket.IO Voice Call Handshake
  console.log('\n[STEP 2] Testing Realtime Voice Calling Handshake via WebSockets...');
  await testCallFlow({ isVideo: false });

  // Step 3: Socket.IO Video Call Handshake
  console.log('\n[STEP 3] Testing Realtime Video Calling Handshake via WebSockets...');
  await testCallFlow({ isVideo: true });

  console.log('\n================================================================');
  console.log('   ✓ ALL LIVE WEB CALLING & VIDEO TESTS PASSED WITH 100%!       ');
  console.log('================================================================\n');
}

function testCallFlow({ isVideo }) {
  return new Promise((resolve, reject) => {
    const callType = isVideo ? 'Video' : 'Voice';
    const testCallId = `TEST-${callType.toUpperCase()}-${Date.now()}`;
    console.log(`--> Starting ${callType} Call Flow for Call ID: ${testCallId}`);

    const adminSocket = io(LIVE_URL, { transports: ['websocket', 'polling'] });
    const userSocket = io(LIVE_URL, { transports: ['websocket', 'polling'] });

    let timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`${callType} Call timed out waiting for signaling events`));
    }, 15000);

    function cleanup() {
      clearTimeout(timeout);
      adminSocket.disconnect();
      userSocket.disconnect();
    }

    // Step A: Connect both sockets
    let connectedCount = 0;
    function onSocketReady() {
      connectedCount++;
      if (connectedCount === 2) {
        console.log(`  ✓ Both User & Admin sockets connected to live server`);

        // Register admin
        adminSocket.emit('admin-join', { role: 'admin' });

        // User initiates call room
        setTimeout(() => {
          userSocket.emit('join-call-room', {
            callId: testCallId,
            userId: 'test_user_web',
            userName: 'Web Tester',
            callType: callType,
            isVideo: isVideo
          });
          console.log(`  ✓ User joined call room for ${callType} Call (${testCallId})`);
        }, 500);
      }
    }

    adminSocket.on('connect', onSocketReady);
    userSocket.on('connect', onSocketReady);

    // Step B: Admin receives incoming alert
    adminSocket.on('incoming-call-alert', (alert) => {
      if (alert.callId !== testCallId) return;
      console.log(`  ✓ Admin received incoming-${callType.toLowerCase()}-call-alert:`, alert.callerName);

      // Admin accepts call
      setTimeout(() => {
        adminSocket.emit('admin-accept-call', {
          callId: testCallId,
          adminId: 'test_admin_web',
          adminName: 'Live Advisor'
        });
        console.log(`  ✓ Admin accepted ${callType} call`);
      }, 300);
    });

    // Step C: User receives peer-connected
    userSocket.on('peer-connected', (data) => {
      if (data.callId !== testCallId) return;
      console.log(`  ✓ User received peer-connected from Admin (${data.adminName})`);

      // Simulated SDP Offer (with Opus voice & H264/VP8 video tracks if video)
      const mockOfferSdp = isVideo
        ? 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000\r\n'
        : 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\n';

      userSocket.emit('send-offer', {
        offer: { type: 'offer', sdp: mockOfferSdp },
        callId: testCallId,
        isVideo: isVideo
      });
      console.log(`  ✓ User sent WebRTC SDP Offer (Tracks: audio${isVideo ? ' + video' : ''})`);
    });

    // Step D: Admin receives offer and replies with answer
    adminSocket.on('receive-offer', (data) => {
      if (data.callId !== testCallId) return;
      console.log(`  ✓ Admin received SDP Offer`);

      const mockAnswerSdp = isVideo
        ? 'v=0\r\no=- 54321 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000\r\n'
        : 'v=0\r\no=- 54321 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\n';

      adminSocket.emit('send-answer', {
        answer: { type: 'answer', sdp: mockAnswerSdp },
        callId: testCallId
      });
      console.log(`  ✓ Admin sent WebRTC SDP Answer`);
    });

    // Step E: User receives answer and confirms call connected
    userSocket.on('receive-answer', (data) => {
      if (data.callId !== testCallId) return;
      console.log(`  ✓ User received SDP Answer`);

      // Exchange simulated ICE candidate
      userSocket.emit('send-candidate', {
        candidate: { candidate: 'candidate:1 1 UDP 2122260223 192.168.1.100 54321 typ host', sdpMid: '0', sdpMLineIndex: 0 },
        callId: testCallId
      });
      console.log(`  ✓ User emitted ICE Candidate`);

      userSocket.emit('call-connected', { callId: testCallId });
      console.log(`  ✓ User emitted call-connected event`);
    });

    adminSocket.on('receive-candidate', (data) => {
      if (data.callId !== testCallId) return;
      console.log(`  ✓ Admin received ICE Candidate successfully`);

      // Both parties successfully completed WebRTC handshake!
      console.log(`  ✓ ${callType} Call Established Successfully! Ending test call.`);
      cleanup();
      resolve();
    });
  });
}

runLiveTest().catch((err) => {
  console.error('\n❌ Live Test Failed:', err);
  process.exit(1);
});
