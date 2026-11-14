/*
 * System Settings Service
 * Handles platform-level dynamic feature toggles (Video Calling, etc.)
 * Provides ultra-fast in-memory caching with MongoDB backing and live Socket.io broadcasting.
 */

const Setting = require('../models/Setting');

// In-memory cache for zero-latency synchronous access
const memoryCache = {
  videoCallingEnabled: true
};

let ioInstance = null;
let isInitialized = false;

function setIoInstance(io) {
  ioInstance = io;
}

async function initSettings() {
  try {
    const videoSetting = await Setting.findOne({ key: 'videoCallingEnabled' });
    if (videoSetting) {
      memoryCache.videoCallingEnabled = (videoSetting.value === true || videoSetting.value === 'true' || videoSetting.value === 1 || videoSetting.value === '1');
    } else {
      // Seed default configuration (enabled by default)
      await Setting.create({
        key: 'videoCallingEnabled',
        value: true,
        description: 'Enable or disable video calling for all users',
        updatedBy: 'Ashu'
      });
      memoryCache.videoCallingEnabled = true;
    }
    isInitialized = true;
    console.log(`[SettingService] System settings initialized. Video Calling: ${memoryCache.videoCallingEnabled ? 'ENABLED' : 'DISABLED'}`);
  } catch (err) {
    console.warn('[SettingService] Initialization error (using default memory state):', err.message);
  }
}

async function isVideoCallEnabled() {
  if (!isInitialized) {
    await initSettings();
  }
  return memoryCache.videoCallingEnabled;
}

function isVideoCallEnabledSync() {
  return memoryCache.videoCallingEnabled;
}

async function setVideoCallEnabled(enabled, updatedBy = 'Ashu') {
  const boolValue = (enabled === true || enabled === 'true' || enabled === 1 || enabled === '1' || enabled === 'on');
  memoryCache.videoCallingEnabled = boolValue;

  try {
    await Setting.findOneAndUpdate(
      { key: 'videoCallingEnabled' },
      {
        $set: {
          value: boolValue,
          description: 'Enable or disable video calling for all users',
          updatedBy: updatedBy || 'Ashu',
          updatedAt: new Date()
        }
      },
      { upsert: true, returnDocument: 'after' }
    );
  } catch (err) {
    console.error('[SettingService] Failed to persist setting in DB:', err.message);
  }

  // Real-time broadcast to all connected clients (web & mobile apps)
  if (ioInstance) {
    try {
      ioInstance.emit('video-calling-status-changed', {
        isVideoCallEnabled: boolValue,
        updatedBy: updatedBy || 'Ashu',
        updatedAt: new Date()
      });
    } catch (socketErr) {
      console.warn('[SettingService] Socket broadcast warning:', socketErr.message);
    }
  }

  console.log(`[SettingService] Video Calling setting updated by ${updatedBy}: ${boolValue ? 'ENABLED' : 'DISABLED'}`);
  return boolValue;
}

module.exports = {
  setIoInstance,
  initSettings,
  isVideoCallEnabled,
  isVideoCallEnabledSync,
  setVideoCallEnabled
};
