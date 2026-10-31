import { registerRootComponent } from 'expo';
import { LogBox } from 'react-native';
import App from './App';

// Ignore all log notifications in release build
LogBox.ignoreAllLogs(true);

// Global Uncaught Exception Protection: prevent native crash from unhandled JS errors
if (typeof global !== 'undefined' && global.ErrorUtils) {
  try {
    const defaultHandler = global.ErrorUtils.getGlobalHandler && global.ErrorUtils.getGlobalHandler();
    global.ErrorUtils.setGlobalHandler((error, isFatal) => {
      console.warn('[Global JS Exception Shielded]', error?.message || error, 'isFatal:', isFatal);
      if (!isFatal && defaultHandler) {
        defaultHandler(error, isFatal);
      }
    });
  } catch (e) {
    console.warn('[Index] Could not attach global error handler:', e.message);
  }
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
registerRootComponent(App);
