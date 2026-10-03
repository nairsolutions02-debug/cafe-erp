import type { CapacitorConfig } from '@capacitor/cli';

// Android app for staff (check-in, alerts, counter). It opens the cafe's live website, so website
// updates reach the app without a new APK. CAFE_APP_URL / CAFE_APP_ID / CAFE_APP_NAME are set in
// the GitHub Actions build (repository variables) — see RELEASES.md, Phase 5.
const config: CapacitorConfig = {
  appId: process.env.CAFE_APP_ID || 'in.nairsolutions.cafe',
  appName: process.env.CAFE_APP_NAME || 'Cafe Staff',
  webDir: 'dist',
  server: process.env.CAFE_APP_URL ? { url: `${process.env.CAFE_APP_URL.replace(/\/$/, '')}/admin/me`, cleartext: false } : undefined,
  plugins: {
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
};

export default config;
