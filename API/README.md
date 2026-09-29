# Friend REST API Documentation

This module provides RESTful APIs for the **Friend Emotional Support** mobile and web clients.

---

## 🔒 Authentication

All protected endpoints require an `Authorization` header containing the JWT token received during login or registration:

```http
Authorization: Bearer <your_jwt_token>
```

---

## 📌 API Endpoints Summary

### 1. System & Presence
- **`GET /api/health`**: Health check and server status.
- **`GET /api/advisor-status`**: Real-time advisor online presence state.

### 2. Authentication (`/api/auth`)
- **`POST /api/auth/register`**:
  - Body: `{ "name": "...", "mobile": "...", "password": "..." }`
  - Creates user, automatically adds 25 welcome credits, returns user & JWT token.
- **`POST /api/auth/login`**:
  - Body: `{ "mobile": "...", "password": "..." }`
  - Validates credentials, returns user profile & JWT token.
- **`GET /api/auth/me`** (Protected):
  - Returns current logged-in user profile & live credit balance.
- **`POST /api/auth/forgot-password`**:
  - Body: `{ "mobile": "...", "newPassword": "..." }`
  - Resets password for user account.

### 3. User Dashboard & Profile (`/api/user`)
- **`GET /api/user/dashboard`** (Protected):
  - Returns user stats (total calls, total minutes), advisor online presence, and 5 recent calls.
- **`GET /api/user/profile`** (Protected):
  - Returns user account info.
- **`PUT /api/user/profile`** (Protected):
  - Body: `{ "name": "..." }`
  - Updates display name.
- **`POST /api/user/change-password`** (Protected):
  - Body: `{ "currentPassword": "...", "newPassword": "..." }`

### 4. Voice Calls (`/api/calls`)
- **`GET /api/calls/advisor-status`**:
  - Check advisor online status.
- **`POST /api/calls/initiate`** (Protected):
  - Body: `{ "callType": "Voice" }`
  - Verifies minimum 1 credit balance, initiates call session, returns `callId` and room details.
- **`POST /api/calls/end`** (Protected):
  - Body: `{ "callId": "...", "reason": "Completed" }`
  - Computes duration, deducts credits, updates call record and returns remaining credits.
- **`GET /api/calls/history`** (Protected):
  - Query params: `?page=1&limit=15&status=Completed&q=searchQuery`
  - Returns paginated call records.
- **`GET /api/calls/:callId`** (Protected):
  - Details for a specific call.

### 5. Wallet & Recharge (`/api/wallet`)
- **`GET /api/wallet/plans`**:
  - Returns active voice credit recharge packs.
- **`GET /api/wallet/balance`** (Protected):
  - Returns user's current credits, total purchased, and total used.
- **`GET /api/wallet/transactions`** (Protected):
  - Query params: `?page=1&limit=15&type=credit`
  - Returns transaction logs (credits added, call debits).
- **`POST /api/wallet/create-order`** (Protected):
  - Body: `{ "planId": "PLAN-5503" }`
  - Generates Razorpay payment order.
- **`POST /api/wallet/verify-payment`** (Protected):
  - Body: `{ "razorpay_order_id": "...", "razorpay_payment_id": "...", "razorpay_signature": "..." }`
  - Validates HMAC signature and credits user balance.
