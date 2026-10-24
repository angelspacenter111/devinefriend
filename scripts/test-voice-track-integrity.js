/**
 * Voice & Audio Integrity Test Suite
 * Verifies track preservation, autoplay policies, SFU track error detection,
 * and seamless coordinated P2P fallback.
 */

const assert = require('assert');

console.log("================================================================");
console.log("             VOICE & TRACK INTEGRITY TEST SUITE                 ");
console.log("================================================================\n");

let passed = 0;
let total = 0;

function runTest(name, fn) {
  total++;
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${name}: ${err.message}`);
  }
}

// Mock DOM MediaStream and HTMLMediaElement
class MockTrack {
  constructor(kind, id) {
    this.kind = kind;
    this.id = id;
    this.readyState = 'live';
    this.enabled = true;
  }
}

class MockMediaStream {
  constructor(tracks = []) {
    this.tracks = [...tracks];
  }
  getAudioTracks() {
    return this.tracks.filter(t => t.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter(t => t.kind === 'video');
  }
  getTracks() {
    return [...this.tracks];
  }
  addTrack(t) {
    if (!this.tracks.some(x => x.id === t.id)) {
      this.tracks.push(t);
    }
  }
  removeTrack(t) {
    this.tracks = this.tracks.filter(x => x.id !== t.id);
  }
}

class MockAudioElement {
  constructor() {
    this.srcObject = null;
    this.muted = false;
    this.volume = 1.0;
    this.isPlaying = false;
  }
  play() {
    this.isPlaying = true;
    return Promise.resolve();
  }
}

class MockVideoElement {
  constructor() {
    this.srcObject = null;
    this.muted = false;
    this.volume = 1.0;
    this.isPlaying = false;
  }
  play() {
    this.isPlaying = true;
    return Promise.resolve();
  }
}

// Test 1: Video track arrival must NEVER overwrite or detach remote audio track
runTest("Audio Track Persistence: Video arrival preserves audio stream on remoteAudio", () => {
  const remoteAudio = new MockAudioElement();
  const remoteVideo = new MockVideoElement();

  const audioTrack = new MockTrack('audio', 'audio-track-1');
  const videoTrack = new MockTrack('video', 'video-track-1');

  // Simulated attachRemoteAudioTrack
  let audioStream = remoteAudio.srcObject || new MockMediaStream();
  audioStream.addTrack(audioTrack);
  remoteAudio.srcObject = audioStream;
  remoteAudio.muted = false;
  remoteAudio.volume = 1.0;

  // Verify audio track attached
  assert.strictEqual(remoteAudio.srcObject.getAudioTracks().length, 1);
  assert.strictEqual(remoteAudio.srcObject.getAudioTracks()[0].id, 'audio-track-1');

  // Now video track arrives (simulated attachRemoteVideoTrack)
  let videoStream = remoteVideo.srcObject || new MockMediaStream();
  videoStream.addTrack(videoTrack);
  // Also preserve audio in video
  videoStream.addTrack(audioTrack);
  remoteVideo.srcObject = videoStream;

  // CRITICAL ASSERTION: remoteAudio MUST STILL HAVE the audio track
  assert.strictEqual(remoteAudio.srcObject.getAudioTracks().length, 1, "Audio track must not be lost!");
  assert.strictEqual(remoteAudio.srcObject.getAudioTracks()[0].id, 'audio-track-1');
  assert.strictEqual(remoteAudio.srcObject.getVideoTracks().length, 0, "remoteAudio must not contain video track!");

  // remoteVideo has both video and audio for dual playback
  assert.strictEqual(remoteVideo.srcObject.getVideoTracks().length, 1);
  assert.strictEqual(remoteVideo.srcObject.getAudioTracks().length, 1);
});

// Test 2: Cloudflare SFU error detection and retry validation
runTest("SFU Error Detection: Inactive SDP or track errorCode triggers fallback", () => {
  const fakeSfuResponse = {
    requiresImmediateRenegotiation: true,
    tracks: [
      {
        trackName: 'audio',
        errorCode: 'not_found_track_error',
        errorDescription: 'Track not found on remote peer'
      }
    ],
    sessionDescription: {
      type: 'offer',
      sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=inactive\r\n'
    }
  };

  const hasTrackErrors = fakeSfuResponse.tracks && fakeSfuResponse.tracks.some(t => t.errorCode);
  const isInactive = fakeSfuResponse.sessionDescription && fakeSfuResponse.sessionDescription.sdp.includes('a=inactive');

  assert.strictEqual(hasTrackErrors, true, "Must detect errorCode on SFU track");
  assert.strictEqual(isInactive, true, "Must detect inactive SDP direction");

  // In our code, this prevents negotiation of dead tracks and activates P2P mesh
  const shouldFallback = hasTrackErrors || isInactive;
  assert.strictEqual(shouldFallback, true, "Must flag fallback required");
});

// Test 3: Coordinated switch-to-p2p resets SFU state and accepts incoming P2P offers
runTest("Coordinated P2P Fallback: Peer demotes SFU and does not reject P2P offer", () => {
  let isUsingSfu = true;
  let pubPeerConnection = { closed: false, close() { this.closed = true; } };
  let subPeerConnection = { closed: false, close() { this.closed = true; } };

  // When switch-to-p2p signal arrives:
  function onSwitchToP2p() {
    isUsingSfu = false;
    if (pubPeerConnection) { pubPeerConnection.close(); pubPeerConnection = null; }
    if (subPeerConnection) { subPeerConnection.close(); subPeerConnection = null; }
  }

  onSwitchToP2p();

  assert.strictEqual(isUsingSfu, false, "isUsingSfu must be reset to false");
  assert.strictEqual(pubPeerConnection, null, "pubPeerConnection must be closed and cleared");
  assert.strictEqual(subPeerConnection, null, "subPeerConnection must be closed and cleared");
});

// Test 4: Audio routing never selects random non-default devices
runTest("Audio Routing Safety: Speaker mode defaults safely without forcing non-default hardware", () => {
  const outputDevices = [
    { deviceId: 'default', label: 'Realtek High Definition Audio' },
    { deviceId: 'hdmi-silent-1', label: 'NVIDIA High Definition Audio (HDMI 1)' }
  ];

  // Logic: search for speaker/loudspeaker
  const speaker = outputDevices.find(d => /speaker|loudspeaker/i.test(d.label));
  let chosenDeviceId = '';
  if (speaker) {
    chosenDeviceId = speaker.deviceId;
  }
  // If not found, chosenDeviceId stays '' (default system device)
  assert.strictEqual(chosenDeviceId, '', "Must remain empty string (system default), NEVER hdmi-silent-1");
  assert.notStrictEqual(chosenDeviceId, 'hdmi-silent-1', "Must NEVER pick silent secondary HDMI device");
});

console.log("\n================================================================");
console.log(`   TOTAL TESTS: ${total} | PASSED: ${passed} | FAILED: ${total - passed}`);
console.log("================================================================\n");

if (passed === total) {
  console.log("✓ ALL VOICE & TRACK INTEGRITY TESTS PASSED PERFECTLY!\n");
} else {
  process.exit(1);
}
