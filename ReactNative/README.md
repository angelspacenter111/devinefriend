# Friend — React Native Expo Mobile App

Compassionate Emotional Support and Voice Companion Mobile Application built with React Native and Expo.

---

## 📱 App Highlights & Features

1. **Authentication & Welcome Bonus**:
   - Secure Mobile Number & Password Login / Registration
   - Automatically credits **25 Free Welcome Credits** (25 minutes talk time) upon signup
   - JWT Token based session persistence using `@react-native-async-storage/async-storage`
   - Forgot & Reset Password recovery

2. **Real-time Live Advisor Presence**:
   - WebSocket connection via `socket.io-client`
   - Live "Online / Offline" advisor presence indicator
   - Auto-refreshes state and updates presence across clients

3. **Voice Calling Experience**:
   - Real-time WebRTC socket signaling (`join-call-room`, `call-active`, `hangup`, `peer-connected`)
   - Pulsing ripple animation with live call timer
   - In-call controls: Mute/Unmute microphone, Speakerphone toggle, and End Call
   - Real-time credit deduction (1 credit = 1 minute)
   - Post-call summary receipt dialog showing talk time, credits used, and remaining balance

4. **Wallet & Recharge**:
   - Available balance counter
   - Visual pricing packs (Starter Pack, Bridge Pack, Comfort Pack, Deep Listen, Best Value)
   - Order creation and payment verification integration
   - Full transaction history (credits added and call debits)

5. **Call History**:
   - Past conversations list with status filters (All, Completed, Missed, Declined)
   - Search by Call ID
   - Duration and credits billed

6. **Profile & Account**:
   - Edit display name
   - Change password
   - Live credits summary
   - Logout

---

## 🚀 How to Run the App

### 1. Start the Backend API Server
Ensure the backend server is running from the root directory:

```bash
# In the root project directory:
npm start
```
The server will start on `http://localhost:3000` with the `/api` endpoints and WebRTC Socket.io server active.

### 2. Configure Backend Server IP for Mobile
Open [`ReactNative/src/config/api.js`](src/config/api.js):
- **Android Emulator**: Uses `http://10.0.2.2:3000` (already configured by default).
- **iOS Simulator / Web**: Uses `http://localhost:3000`.
- **Physical Phone (Expo Go)**: Change `DEFAULT_IP` in `ReactNative/src/config/api.js` to your computer's local Wi-Fi IP address (e.g. `192.168.1.15`).

### 3. Start Expo Development Server
In a new terminal window:

```bash
cd ReactNative
npx expo start
```

### 4. Open on Device:
- **Android Device**: Scan the QR code using the **Expo Go** app from the Google Play Store.
- **iOS Device**: Scan the QR code using the Camera app to open in **Expo Go**.
- **Android Emulator**: Press `a` in the Expo terminal.
- **iOS Simulator**: Press `i` in the Expo terminal.
- **Web Browser**: Press `w` in the Expo terminal.

---

## 📁 Project Architecture

```
ReactNative/
├── App.js                     # Root component with Providers
├── app.json                   # Expo configuration
├── package.json
└── src/
    ├── components/            # Reusable UI components
    │   ├── AdvisorCard.js     # Live presence & call trigger
    │   ├── BalanceCard.js     # Credits balance & quick top-up
    │   ├── CallModal.js       # Active calling screen overlay
    │   ├── CallSummaryModal.js# Post-call receipt dialog
    │   ├── Header.js          # Top bar with status indicator
    │   └── PlanCard.js        # Pricing pack card
    ├── config/
    │   └── api.js             # Server host & endpoint configuration
    ├── context/
    │   ├── AuthContext.js     # Auth state & token storage
    │   └── CallContext.js     # Call state, timer & socket signaling
    ├── navigation/
    │   └── AppNavigator.js    # Auth stack & Bottom tab navigation
    ├── screens/
    │   ├── auth/              # Login, Register, Forgot Password
    │   └── main/              # Home, Call, Wallet, History, Profile
    ├── services/              # API and Socket communication layer
    │   ├── api.js             # Axios client with interceptors
    │   ├── authService.js
    │   ├── callService.js
    │   ├── socketService.js
    │   └── walletService.js
    └── theme/
        └── colors.js          # Design system color tokens
```
