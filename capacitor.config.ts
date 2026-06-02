import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.cove.ios',
  appName: 'Cove',
  webDir: 'build',
  plugins: {
    // Webview shrinks when the keyboard appears, so bottom-fixed bars (Save)
    // stay above it instead of being covered.
    Keyboard: {
      resize: 'native'
    },
    CapacitorSQLite: {
      iosIsEncryption: true,
      iosKeychainPrefix: 'app.cove.ios'
    }
  }
};

export default config;
