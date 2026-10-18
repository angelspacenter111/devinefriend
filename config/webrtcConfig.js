/**
 * WebRTC ICE Configuration (STUN & TURNS)
 * Engineered for UAE / Middle East DPI & VoIP Telecom Firewall Bypass
 * 
 * Etisalat & du in UAE block plain UDP STUN/TURN on port 19302/3478.
 * Secure TURNS over TCP on Port 443 encapsulates WebRTC media inside standard
 * TLS encryption, matching standard HTTPS traffic that DPI firewalls allow.
 */

function getIceServers() {
  const iceServers = [];

  // 1. Dedicated custom TURN / TURNS servers from environment variables if configured
  if (process.env.TURN_URLS || process.env.TURN_URL) {
    const rawUrls = (process.env.TURN_URLS || process.env.TURN_URL)
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const customConfig = {
      urls: rawUrls
    };
    if (process.env.TURN_USERNAME) {
      customConfig.username = process.env.TURN_USERNAME;
    }
    if (process.env.TURN_CREDENTIAL || process.env.TURN_PASSWORD) {
      customConfig.credential = process.env.TURN_CREDENTIAL || process.env.TURN_PASSWORD;
    }
    iceServers.push(customConfig);
  }

  // 2. High-priority TLS TURNS relays (Port 443 with TCP & TLS for UAE / strict firewall bypass)
  iceServers.push({
    urls: [
      'turns:openrelay.metered.ca:443?transport=tcp',
      'turns:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:80'
    ],
    username: process.env.OPENRELAY_USERNAME || 'openrelay',
    credential: process.env.OPENRELAY_CREDENTIAL || 'openrelay'
  });

  // 3. Fallback STUN servers (for non-restricted networks)
  iceServers.push(
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.relay.metered.ca:80' }
  );

  return iceServers;
}

const RTC_CONFIG = {
  iceServers: getIceServers(),
  iceCandidatePoolSize: 10
};

module.exports = {
  getIceServers,
  RTC_CONFIG
};
