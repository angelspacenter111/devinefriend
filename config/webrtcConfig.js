/**
 * WebRTC ICE Configuration (STUN & TURNS)
 * Engineered for UAE (Dubai) / Middle East DPI & VoIP Telecom Firewall Bypass
 * 
 * Etisalat & du in UAE block plain UDP STUN/TURN on port 19302/3478.
 * Secure TURNS over TCP on Port 443 encapsulates WebRTC media inside standard
 * TLS encryption, matching standard HTTPS traffic that DPI firewalls allow.
 */
const https = require('https');

let cachedMeteredServers = null;
let lastMeteredFetch = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Asynchronously fetch fresh TURN credentials from Metered if API key is provided
async function fetchMeteredIceServers() {
  if (!process.env.METERED_DOMAIN || !process.env.METERED_API_KEY) {
    return null;
  }
  const now = Date.now();
  if (cachedMeteredServers && (now - lastMeteredFetch < CACHE_TTL_MS)) {
    return cachedMeteredServers;
  }

  const domain = process.env.METERED_DOMAIN.trim().replace(/^https?:\/\//, '');
  const apiKey = process.env.METERED_API_KEY.trim();
  const url = `https://${domain}/api/v1/turn/credentials?apiKey=${apiKey}`;

  return new Promise((resolve) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed) && parsed.length > 0) {
              cachedMeteredServers = parsed;
              lastMeteredFetch = Date.now();
              console.log('[WebRTC Config] Successfully loaded dynamic Metered ICE servers:', parsed.length);
              return resolve(parsed);
            }
          }
        } catch (e) {}
        resolve(null);
      });
    }).on('error', (err) => {
      console.warn('[WebRTC Config] Error fetching Metered ICE servers:', err.message);
      resolve(null);
    });
  });
}

// Auto-trigger fetch if credentials exist at startup
if (process.env.METERED_DOMAIN && process.env.METERED_API_KEY) {
  fetchMeteredIceServers().catch(() => {});
}

function getIceServers() {
  const iceServers = [];

  // 1. Dynamic Metered API credentials if already cached
  if (cachedMeteredServers && Array.isArray(cachedMeteredServers)) {
    cachedMeteredServers.forEach(s => iceServers.push(s));
  }

  // 2. Dedicated custom TURN / TURNS servers from environment variables if configured
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

  // 3. Static Metered domain & credentials if configured in environment
  if (process.env.METERED_DOMAIN && !cachedMeteredServers) {
    const domain = process.env.METERED_DOMAIN.trim().replace(/^https?:\/\//, '');
    iceServers.push({
      urls: [
        `turns:${domain}:443?transport=tcp`,
        `turns:${domain}:443`,
        `turn:${domain}:443?transport=tcp`,
        `turn:${domain}:443`,
        `turn:${domain}:80`
      ],
      username: process.env.METERED_USERNAME || process.env.TURN_USERNAME || '',
      credential: process.env.METERED_CREDENTIAL || process.env.METERED_API_KEY || process.env.TURN_CREDENTIAL || ''
    });
  }

  // 4. High-priority TLS TURNS relays (Port 443 with TCP & TLS for UAE / strict firewall bypass)
  const turnUser = process.env.TURN_USERNAME || process.env.OPENRELAY_USERNAME || 'openrelay';
  const turnCred = process.env.TURN_CREDENTIAL || process.env.OPENRELAY_CREDENTIAL || 'openrelay';

  iceServers.push({
    urls: [
      'turns:global.relay.metered.ca:443?transport=tcp',
      'turns:global.relay.metered.ca:443',
      'turn:global.relay.metered.ca:443?transport=tcp',
      'turn:global.relay.metered.ca:443',
      'turn:global.relay.metered.ca:80'
    ],
    username: turnUser,
    credential: turnCred
  });

  // 5. Reliable STUN servers (Google & Cloudflare STUN)
  iceServers.push(
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  );

  return iceServers;
}

const RTC_CONFIG = {
  iceServers: getIceServers(),
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
  iceTransportPolicy: 'all'
};

module.exports = {
  getIceServers,
  fetchMeteredIceServers,
  RTC_CONFIG
};
