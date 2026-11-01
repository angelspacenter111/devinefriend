const { withGradleProperties } = require('@expo/config-plugins');

/**
 * Expo Config Plugin to guarantee newArchEnabled=false in android/gradle.properties
 * This ensures react-native-webrtc runs reliably without native TurboModule/Fabric crashes.
 */
module.exports = function withDisableNewArch(config) {
  return withGradleProperties(config, (config) => {
    let found = false;
    config.modResults = config.modResults.map((item) => {
      if (item.type === 'property' && item.key === 'newArchEnabled') {
        found = true;
        return { ...item, value: 'false' };
      }
      return item;
    });

    if (!found) {
      config.modResults.push({
        type: 'property',
        key: 'newArchEnabled',
        value: 'false'
      });
    }

    return config;
  });
};
