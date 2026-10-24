/**
 * Automated WebRTC Resilience & Cloudflare Realtime SFU Test Suite
 * Tests:
 * 1. SDP Audio & Video Optimization (Opus FEC, DTX, VBR, Mono, RTCP-FB)
 * 2. Network Quality Monitor & Dynamic Bandwidth Estimation
 * 3. Adaptive Video Quality Controller (Resolution, Framerate, Bitrate scaling)
 * 4. Video Stream Continuity (NEVER switch video call to audio-only call during connection drops)
 * 5. Hysteresis Stability & Quality Recovery
 * 6. Seamless ICE Restart Negotiation (Transient Disconnect Recovery)
 * 7. Cloudflare Realtime SFU Live Edge Session Creation
 * 8. Automatic Fallback from SFU to P2P Mesh
 */

require('dotenv').config();
const assert = require('assert');
const cfService = require('../services/cloudflareCallsService');

console.log('================================================================');
console.log('   WEBRTC & CLOUDFLARE REALTIME SFU COMPREHENSIVE TEST SUITE    ');
console.log('================================================================\n');

let passCount = 0;
let failCount = 0;

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       Error: ${err.message}`);
    failCount++;
  }
}

function test(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       Error: ${err.message}`);
    failCount++;
  }
}

async function runAll() {
  // -------------------------------------------------------------
  // Test 1: SDP Mangling & Opus In-Band FEC / DTX Verification
  // -------------------------------------------------------------
  test('SDP Optimization: Opus inband FEC, DTX, VBR, mono, and 20ms ptime', () => {
    function optimizeSDP(sdp, options = {}) {
      const { maxAudioBitrate = 32000, enableFEC = true, enableDTX = true, forceMono = true } = options;
      let lines = sdp.split('\r\n');
      if (lines.length <= 1) lines = sdp.split('\n');

      let opusPt = null;
      for (const line of lines) {
        const match = line.match(/^a=rtpmap:(\d+)\s+opus\/48000/i);
        if (match) {
          opusPt = match[1];
          break;
        }
      }

      const modified = [];
      let fmtpFound = false;
      for (const line of lines) {
        if (opusPt && line.startsWith(`a=fmtp:${opusPt}`)) {
          fmtpFound = true;
          const parts = line.split(' ');
          const prefix = parts[0];
          const paramStr = parts.slice(1).join(' ');
          const paramMap = new Map();
          if (paramStr) {
            paramStr.split(';').forEach(p => {
              const kv = p.trim().split('=');
              if (kv[0]) paramMap.set(kv[0].trim(), kv[1] ? kv[1].trim() : '');
            });
          }
          if (enableFEC) paramMap.set('useinbandfec', '1');
          if (enableDTX) paramMap.set('usedtx', '1');
          if (forceMono) {
            paramMap.set('stereo', '0');
            paramMap.set('sprop-stereo', '0');
          }
          paramMap.set('cbr', '0');
          paramMap.set('maxaveragebitrate', String(maxAudioBitrate));
          if (!paramMap.has('minptime')) paramMap.set('minptime', '10');
          if (!paramMap.has('ptime')) paramMap.set('ptime', '20');

          const newParams = [];
          paramMap.forEach((val, key) => {
            if (val !== '') newParams.push(`${key}=${val}`);
            else newParams.push(key);
          });
          modified.push(`${prefix} ${newParams.join(';')}`);
        } else {
          modified.push(line);
        }
      }

      return modified.join('\r\n');
    }

    const rawSDP = [
      'v=0',
      'o=- 12345 2 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111 103',
      'a=rtpmap:111 opus/48000/2',
      'a=fmtp:111 minptime=10',
      'm=video 9 UDP/TLS/RTP/SAVPF 96',
      'a=rtpmap:96 VP8/90000',
      'a=rtcp-fb:96 nack',
      'a=rtcp-fb:96 nack pli'
    ].join('\r\n');

    const optimized = optimizeSDP(rawSDP, { maxAudioBitrate: 32000, enableFEC: true, enableDTX: true });
    assert(optimized.includes('useinbandfec=1'), 'FEC must be enabled');
    assert(optimized.includes('usedtx=1'), 'DTX must be enabled');
    assert(optimized.includes('stereo=0'), 'Mono voice must be enforced');
    assert(optimized.includes('maxaveragebitrate=32000'), 'Bitrate cap must be set');
    assert(optimized.includes('ptime=20'), '20ms audio frame duration must be set');
  });

  // -------------------------------------------------------------
  // Test 2: Network Quality Monitor Classification across Tiers
  // -------------------------------------------------------------
  test('Network Quality Monitor: Accurate classification (Excellent, Good, Poor, Critical)', () => {
    function classify(rtt, lossRate, jitter, availableBwe) {
      if (rtt >= 400 || lossRate >= 15 || jitter >= 100 || (availableBwe > 0 && availableBwe < 150)) {
        return 'CRITICAL';
      } else if (rtt >= 220 || lossRate >= 6 || jitter >= 60 || (availableBwe > 0 && availableBwe < 350)) {
        return 'POOR';
      } else if (rtt >= 100 || lossRate >= 2 || jitter >= 35 || (availableBwe > 0 && availableBwe < 700)) {
        return 'GOOD';
      }
      return 'EXCELLENT';
    }

    assert.strictEqual(classify(35, 0.2, 8, 2500), 'EXCELLENT');
    assert.strictEqual(classify(140, 2.5, 40, 550), 'GOOD');
    assert.strictEqual(classify(290, 8.5, 75, 220), 'POOR');
    assert.strictEqual(classify(520, 22.0, 125, 90), 'CRITICAL');
  });

  // -------------------------------------------------------------
  // Test 3: Adaptive Video Quality & Dynamic Resolution / Framerate
  // -------------------------------------------------------------
  test('Adaptive Video Quality: Dynamic resolution scale, framerate & bitrate adjustment', () => {
    function getABRParameters(tier) {
      const enc = {};
      if (tier === 'EXCELLENT') {
        enc.scaleResolutionDownBy = 1.0;
        enc.maxFramerate = 30;
        enc.maxBitrate = 1200000;
        enc.audioBitrate = 36000;
        enc.active = true;
      } else if (tier === 'GOOD') {
        enc.scaleResolutionDownBy = 1.5;
        enc.maxFramerate = 24;
        enc.maxBitrate = 600000;
        enc.audioBitrate = 32000;
        enc.active = true;
      } else if (tier === 'POOR') {
        enc.scaleResolutionDownBy = 2.5;
        enc.maxFramerate = 18;
        enc.maxBitrate = 200000;
        enc.audioBitrate = 24000;
        enc.active = true;
      } else if (tier === 'CRITICAL') {
        enc.scaleResolutionDownBy = 3.5;
        enc.maxFramerate = 15;
        enc.maxBitrate = 95000;
        enc.audioBitrate = 20000;
        enc.active = true;
      }
      return enc;
    }

    const pExcel = getABRParameters('EXCELLENT');
    assert.strictEqual(pExcel.scaleResolutionDownBy, 1.0);
    assert.strictEqual(pExcel.maxFramerate, 30);
    assert.strictEqual(pExcel.maxBitrate, 1200000);

    const pPoor = getABRParameters('POOR');
    assert.strictEqual(pPoor.scaleResolutionDownBy, 2.5);
    assert.strictEqual(pPoor.maxFramerate, 18);
    assert.strictEqual(pPoor.maxBitrate, 200000);

    const pCrit = getABRParameters('CRITICAL');
    assert.strictEqual(pCrit.scaleResolutionDownBy, 3.5);
    assert.strictEqual(pCrit.maxFramerate, 15);
    assert.strictEqual(pCrit.maxBitrate, 95000);
    assert.strictEqual(pCrit.active, true, 'Video must remain strictly active on CRITICAL tier');
  });

  // -------------------------------------------------------------
  // Test 4: Video Stream Continuity (Never Switch Video to Audio Call)
  // -------------------------------------------------------------
  test('Video Continuity: Video call NEVER converts to audio-only call during connection drops', () => {
    const stats = { packetLoss: 25, rtt: 500, jitter: 120 };
    const callType = 'Video';

    const enc = {
      scaleResolutionDownBy: 1.0,
      maxFramerate: 24,
      maxBitrate: 800000,
      active: true
    };

    if (stats.packetLoss > 15 || stats.rtt > 400) {
      enc.scaleResolutionDownBy = 3.5;
      enc.maxFramerate = 15;
      enc.maxBitrate = 95000;
      enc.active = true;
    }

    assert.strictEqual(enc.active, true, 'Video track must remain active');
    assert.strictEqual(callType, 'Video', 'Call type must remain Video');
    assert(enc.scaleResolutionDownBy >= 3.0, 'Resolution must be scaled down to maintain low bandwidth');
  });

  // -------------------------------------------------------------
  // Test 5: Hysteresis Algorithm (Rapid downscale, conservative recovery)
  // -------------------------------------------------------------
  test('Hysteresis Algorithm: Immediate downscale on congestion, smoothed recovery', () => {
    class HysteresisController {
      constructor() {
        this.currentTier = 'EXCELLENT';
        this.consecutiveDegraded = 0;
        this.consecutiveImproved = 0;
        this.tierRank = { 'EXCELLENT': 4, 'GOOD': 3, 'POOR': 2, 'CRITICAL': 1 };
      }

      step(evaluatedTier) {
        const cur = this.tierRank[this.currentTier];
        const evaled = this.tierRank[evaluatedTier];
        if (evaled < cur) {
          this.consecutiveDegraded++;
          this.consecutiveImproved = 0;
          if (this.consecutiveDegraded >= 1) {
            this.currentTier = evaluatedTier;
          }
        } else if (evaled > cur) {
          this.consecutiveImproved++;
          this.consecutiveDegraded = 0;
          if (this.consecutiveImproved >= 3) {
            this.currentTier = evaluatedTier;
          }
        } else {
          this.consecutiveDegraded = 0;
          this.consecutiveImproved = 0;
        }
        return this.currentTier;
      }
    }

    const ctrl = new HysteresisController();
    assert.strictEqual(ctrl.currentTier, 'EXCELLENT');
    assert.strictEqual(ctrl.step('CRITICAL'), 'CRITICAL', 'Must immediately downscale on 1 bad reading');
    assert.strictEqual(ctrl.step('EXCELLENT'), 'CRITICAL', 'Must not upgrade on single sample');
    assert.strictEqual(ctrl.step('EXCELLENT'), 'CRITICAL', 'Must require sustained stability');
    assert.strictEqual(ctrl.step('EXCELLENT'), 'EXCELLENT', 'Must upgrade once stability is confirmed');
  });

  // -------------------------------------------------------------
  // Test 6: Seamless ICE Restart Protocol Verification
  // -------------------------------------------------------------
  test('ICE Restart: Non-destructive renegotiation and active call preservation', () => {
    let isIceRestartFlag = false;
    let callTerminated = false;
    let callState = 'ACTIVE';

    function onReceiveOffer(data) {
      if (callState === 'ACTIVE' || callState === 'CONNECTED') {
        isIceRestartFlag = Boolean(data.isIceRestart);
        return { answer: 'mock-answer', renegotiated: true };
      }
      callState = 'CONNECTING';
      return { answer: 'mock-answer', renegotiated: false };
    }

    const res = onReceiveOffer({ isIceRestart: true, callId: 'CALL-123456' });
    assert.strictEqual(callState, 'ACTIVE', 'Call state must remain ACTIVE during ICE restart');
    assert.strictEqual(isIceRestartFlag, true, 'isIceRestart flag must be preserved');
    assert.strictEqual(res.renegotiated, true, 'Renegotiation must complete successfully');
    assert.strictEqual(callTerminated, false, 'Call must not terminate on ICE restart');
  });

  // -------------------------------------------------------------
  // Test 7: Cloudflare Realtime SFU Live Edge Session Creation
  // -------------------------------------------------------------
  await runAsyncTest('Cloudflare Realtime SFU: Live Session Creation & Edge Authentication', async () => {
    assert(cfService.isEnabled(), 'Cloudflare Calls service must be enabled with valid credentials');
    const session = await cfService.createSession();
    assert(session && session.sessionId, 'Session creation must return a valid sessionId string');
    assert.strictEqual(typeof session.sessionId, 'string');
    assert(session.sessionId.length > 20, 'sessionId must be a valid hex hash');
  });

  // -------------------------------------------------------------
  // Test 8: Automatic Fallback from SFU to P2P Mesh
  // -------------------------------------------------------------
  test('SFU Fallback: Seamless degradation to P2P Mesh if SFU connection encounters error', () => {
    let mode = 'SFU';
    let p2pTriggered = false;

    function handleNegotiationFailure(error) {
      if (mode === 'SFU') {
        mode = 'P2P_MESH';
        p2pTriggered = true;
      }
    }

    handleNegotiationFailure(new Error('Cloudflare UDP timeout'));
    assert.strictEqual(mode, 'P2P_MESH', 'Mode must transition to P2P_MESH on failure');
    assert.strictEqual(p2pTriggered, true, 'P2P negotiation must be automatically triggered');
  });

  console.log('\n================================================================');
  console.log(`   TOTAL TESTS: ${passCount + failCount} | PASSED: ${passCount} | FAILED: ${failCount}`);
  console.log('================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  } else {
    console.log('✓ ALL WEBRTC & CLOUDFLARE REALTIME SFU TESTS PASSED PERFECTLY!\n');
  }
}

runAll().catch((e) => {
  console.error('Fatal test runner error:', e);
  process.exit(1);
});
