import { Platform } from 'react-native';

let AudioModule = null;
try {
  const ExpoAv = require('expo-av');
  AudioModule = ExpoAv.Audio;
} catch (e) {
  console.warn('[RingtoneService] expo-av not available:', e.message);
}

class RingtoneService {
  constructor() {
    this.soundObject = null;
    this.isPlaying = false;
  }

  /**
   * Start looping telephone ringtone sound
   */
  async startRingtone() {
    if (this.isPlaying) return;
    this.isPlaying = true;

    try {
      console.log('[RingtoneService] 🔔 Starting audible incoming call ringtone...');

      if (!AudioModule) {
        console.warn('[RingtoneService] Audio module not initialized, skipping audio playback');
        return;
      }

      // Configure system audio session for ringtone
      try {
        await AudioModule.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false
        });
      } catch (modeErr) {
        console.warn('[RingtoneService] Warning setting audio mode:', modeErr.message);
      }

      // If previous sound exists, cleanup first
      if (this.soundObject) {
        try {
          await this.soundObject.stopAsync();
          await this.soundObject.unloadAsync();
        } catch (e) {}
        this.soundObject = null;
      }

      // Load bundled high-quality ringtone WAV
      let sound = null;
      try {
        const ringtoneSource = require('../assets/sounds/ringtone.wav');
        const res = await AudioModule.Sound.createAsync(
          ringtoneSource,
          {
            isLooping: true,
            volume: 1.0,
            shouldPlay: true
          }
        );
        sound = res.sound;
      } catch (assetErr) {
        console.warn('[RingtoneService] Asset require error, trying android raw resource:', assetErr.message);
        if (Platform.OS === 'android') {
          const res = await AudioModule.Sound.createAsync(
            { uri: 'android.resource://com.dhyey.ReactNative/raw/ringtone' },
            {
              isLooping: true,
              volume: 1.0,
              shouldPlay: true
            }
          );
          sound = res.sound;
        }
      }

      this.soundObject = sound;
      console.log('[RingtoneService] ✅ Incoming call ringtone is now actively playing');
    } catch (err) {
      console.warn('[RingtoneService] Could not play ringtone audio:', err.message);
      this.isPlaying = false;
    }
  }

  /**
   * Stop ringtone immediately when call is answered, rejected, or cancelled
   */
  async stopRingtone() {
    console.log('[RingtoneService] ⏹️ Stopping incoming call ringtone...');
    this.isPlaying = false;

    if (this.soundObject) {
      const currentSound = this.soundObject;
      this.soundObject = null;
      try {
        await currentSound.stopAsync();
        await currentSound.unloadAsync();
        console.log('[RingtoneService] Ringtone audio unloaded successfully');
      } catch (err) {
        console.warn('[RingtoneService] Error stopping ringtone:', err.message);
      }
    }
  }
}

export const ringtoneService = new RingtoneService();
export default ringtoneService;
