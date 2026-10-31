import { Audio } from 'expo-av';
import { Platform } from 'react-native';

class RingtoneService {
  constructor() {
    this.soundObject = null;
    this.isPlaying = false;
    this.loadingPromise = null;
  }

  /**
   * Start looping telephone ringtone sound
   */
  async startRingtone() {
    if (this.isPlaying) return;
    this.isPlaying = true;

    try {
      console.log('[RingtoneService] 🔔 Starting audible incoming call ringtone...');

      // Configure system audio session for ringtone
      try {
        await Audio.setAudioModeAsync({
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
      const ringtoneSource = require('../assets/sounds/ringtone.wav');
      const { sound } = await Audio.Sound.createAsync(
        ringtoneSource,
        {
          isLooping: true,
          volume: 1.0,
          shouldPlay: true
        }
      );

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
