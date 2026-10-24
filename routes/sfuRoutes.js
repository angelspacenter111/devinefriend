/**
 * Cloudflare Realtime SFU API Router
 * Secure backend proxy for WebRTC sessions, tracks publication, and subscriptions.
 * Keeps Cloudflare API Token strictly hidden on the server.
 */

const express = require('express');
const router = express.Router();
const cfService = require('../services/cloudflareCallsService');

// Query SFU status
router.get('/status', (req, res) => {
  res.json({
    success: true,
    enabled: cfService.isEnabled(),
    provider: 'cloudflare-realtime-sfu'
  });
});

// Create new SFU session
router.post('/session/new', async (req, res) => {
  try {
    if (!cfService.isEnabled()) {
      return res.status(503).json({
        success: false,
        error: 'Cloudflare Realtime SFU is not enabled or credentials are missing'
      });
    }
    const session = await cfService.createSession();
    res.status(201).json({
      success: true,
      sessionId: session.sessionId
    });
  } catch (err) {
    console.error('[SFU Route Error] createSession failed:', err.message);
    res.status(err.status || 500).json({
      success: false,
      error: err.message,
      details: err.details || null
    });
  }
});

// Publish tracks on a session (Local Offer -> SFU Answer)
router.post('/sessions/:sessionId/publish', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { sessionDescription, tracks } = req.body;

    if (!sessionDescription || !tracks) {
      return res.status(400).json({
        success: false,
        error: 'sessionDescription and tracks are required'
      });
    }

    const result = await cfService.publishTracks(sessionId, { sessionDescription, tracks });
    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error(`[SFU Route Error] publishTracks for session ${req.params.sessionId} failed:`, err.message);
    res.status(err.status || 500).json({
      success: false,
      error: err.message,
      details: err.details || null
    });
  }
});

// Subscribe to remote tracks (Pull remote publisher tracks into subscriber session)
router.post('/sessions/:sessionId/subscribe', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { tracks } = req.body;

    if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'tracks array is required'
      });
    }

    const result = await cfService.subscribeTracks(sessionId, { tracks });
    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error(`[SFU Route Error] subscribeTracks for session ${req.params.sessionId} failed:`, err.message);
    res.status(err.status || 500).json({
      success: false,
      error: err.message,
      details: err.details || null
    });
  }
});

// Renegotiate session (Subscriber Answer -> SFU)
router.put('/sessions/:sessionId/renegotiate', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { sessionDescription } = req.body;

    if (!sessionDescription) {
      return res.status(400).json({
        success: false,
        error: 'sessionDescription is required for renegotiation'
      });
    }

    const result = await cfService.renegotiate(sessionId, { sessionDescription });
    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error(`[SFU Route Error] renegotiate for session ${req.params.sessionId} failed:`, err.message);
    res.status(err.status || 500).json({
      success: false,
      error: err.message,
      details: err.details || null
    });
  }
});

module.exports = router;
