/**
 * Cloudflare Realtime SFU (Cloudflare Calls) Service
 * Manages low-latency WebRTC media sessions, publishing, and subscribing
 * across Cloudflare's global Anycast edge network.
 */

const https = require('https');

class CloudflareCallsService {
  constructor() {
    this.appId = process.env.CLOUDFLARE_CALLS_APP_ID || '';
    this.apiToken = process.env.CLOUDFLARE_CALLS_APP_TOKEN || '';
    this.apiHost = 'rtc.live.cloudflare.com';
    this.basePath = '/v1/apps';
  }

  isEnabled() {
    return Boolean(this.appId && this.apiToken && this.appId.trim() && this.apiToken.trim());
  }

  /**
   * Helper to execute authenticated HTTPS requests to Cloudflare Calls API
   */
  request(path, method = 'GET', data = null) {
    if (!this.isEnabled()) {
      return Promise.reject(new Error('Cloudflare Calls is not configured. Missing APP_ID or APP_TOKEN.'));
    }

    return new Promise((resolve, reject) => {
      const fullPath = `${this.basePath}/${this.appId}${path}`;
      const postData = data ? JSON.stringify(data) : '';

      const options = {
        hostname: this.apiHost,
        path: fullPath,
        method: method,
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'DevineFriend-WebRTC-SFU/1.0'
        }
      };

      if (postData) {
        options.headers['Content-Length'] = Buffer.byteLength(postData);
      }

      const req = https.request(options, (res) => {
        let responseBody = '';
        res.on('data', chunk => responseBody += chunk);
        res.on('end', () => {
          let parsed;
          try {
            parsed = responseBody ? JSON.parse(responseBody) : {};
          } catch (e) {
            parsed = { raw: responseBody };
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              status: res.statusCode,
              data: parsed
            });
          } else {
            const errMsg = (parsed && (parsed.errorDescription || parsed.message || parsed.errorCode)) || `HTTP ${res.statusCode}`;
            const err = new Error(`Cloudflare Calls API error (${res.statusCode}): ${errMsg}`);
            err.status = res.statusCode;
            err.details = parsed;
            reject(err);
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Cloudflare Calls network error: ${err.message}`));
      });

      req.setTimeout(12000, () => {
        req.destroy();
        reject(new Error('Cloudflare Calls API request timed out (12s)'));
      });

      if (postData) {
        req.write(postData);
      }
      req.end();
    });
  }

  /**
   * Initialize a new WebRTC session on Cloudflare Realtime SFU
   * Returns: { sessionId }
   */
  async createSession() {
    const res = await this.request('/sessions/new', 'POST');
    return res.data;
  }

  /**
   * Publish local tracks from a client's session to the SFU
   * @param {string} sessionId - Publisher's session ID
   * @param {object} payload - { sessionDescription: { type: 'offer', sdp }, tracks: [{ location: 'local', mid, trackName }] }
   */
  async publishTracks(sessionId, { sessionDescription, tracks }) {
    if (!sessionId) throw new Error('sessionId is required to publish tracks');
    const res = await this.request(`/sessions/${sessionId}/tracks/new`, 'POST', {
      sessionDescription,
      tracks
    });
    return res.data;
  }

  /**
   * Subscribe to remote tracks from another session (pull tracks)
   * @param {string} subscriberSessionId - The receiving client's session ID
   * @param {Array} tracks - [{ location: 'remote', sessionId: publisherSessionId, trackName }]
   */
  async subscribeTracks(subscriberSessionId, { tracks }) {
    if (!subscriberSessionId) throw new Error('subscriberSessionId is required to subscribe to tracks');
    const res = await this.request(`/sessions/${subscriberSessionId}/tracks/new`, 'POST', {
      tracks
    });
    return res.data;
  }

  /**
   * Complete renegotiation on a session with a client's answer
   * @param {string} sessionId - The session ID requiring renegotiation
   * @param {object} payload - { sessionDescription: { type: 'answer', sdp } }
   */
  async renegotiate(sessionId, { sessionDescription }) {
    if (!sessionId) throw new Error('sessionId is required for renegotiation');
    const res = await this.request(`/sessions/${sessionId}/renegotiate`, 'PUT', {
      sessionDescription
    });
    return res.data;
  }

  /**
   * Close a specific track when muted or stopped
   */
  async closeTrack(sessionId, trackName) {
    if (!sessionId || !trackName) return null;
    try {
      const res = await this.request(`/sessions/${sessionId}/tracks/close`, 'PUT', {
        tracks: [{ trackName }]
      });
      return res.data;
    } catch (e) {
      console.warn(`[Cloudflare Calls] Error closing track ${trackName}:`, e.message);
      return null;
    }
  }
}

module.exports = new CloudflareCallsService();
