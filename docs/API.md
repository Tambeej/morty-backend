# Morty Backend — API Reference

> **Base URL:** `https://morty-backend-h9sb.onrender.com/api/v1`  
> **Local dev:** `http://localhost:5000/api/v1`  
> Configurable via the `VITE_API_URL` environment variable on the frontend.

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Response Envelope](#response-envelope)
4. [Error Codes](#error-codes)
5. [Rate Limiting](#rate-limiting)
6. [Data Shapes](#data-shapes)
7. [Endpoints](#endpoints)
   - [Auth](#auth-endpoints)
   - [Profile](#profile-endpoints)
   - [Offers](#offers-endpoints)
   - [Analysis](#analysis-endpoints)
   - [Dashboard](#dashboard-endpoints)
   - [Health](#health-endpoint)
8. [Migration Notes (MongoDB → Firestore)](#migration-notes)
9. [Frontend Integration Guide](#frontend-integration-guide)

---

## Overview

Morty is an AI-powered mortgage analysis platform. The backend exposes a REST API
built with **Node.js 20 / Express 4**, backed by **Google Cloud Firestore** (via
`firebase-admin` 12). All endpoints return JSON.

| Property | Value |
|----------|-------|
| Protocol | HTTPS (HTTP in local dev) |
| Format | JSON (`Content-Type: application/json`) |
| Auth | JWT Bearer token (access token, 15 min expiry) |
| Versioning | URL prefix `/api/v1` |

---

## Authentication

Protected endpoints require a valid **JWT access token** in the `Authorization` header:

```
Authorization: Bearer <access_token>
```

### Token Lifecycle

| Token | Expiry | Storage recommendation |
|-------|--------|------------------------|
| Access token | 15 minutes | Memory / React state |
| Refresh token | 7 days | `localStorage` (or `httpOnly` cookie) |

### Token Refresh Flow

1. Make an API request → receive `401 Unauthorized`
2. Call `POST /auth/refresh` with the stored `refreshToken`
3. Store the new `token` and `refreshToken` returned
4. Retry the original request with the new access token

The backend implements **refresh token rotation**: each call to `/auth/refresh`
invalidates the old refresh token and issues a new one.

---

## Response Envelope

All responses (success and error) use a consistent JSON envelope:

### Success

```json
{
  "success": true,
  "data": { ... },
  "message": "Human-readable description"
}
```

> `data` may be `null` when there is nothing to return (e.g., logout, delete).

### Error

```json
{
  "success": false,
  "message": "Human-readable error description"
}
```

### Validation Error (422)

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      { "field": "email", "message": "\"email\" must be a valid email" }
    ],
    "timestamp": "2026-04-03T02:16:00.000Z"
  }
}
```

---

## Error Codes

| HTTP Status | `error.code` / context | Meaning |
|-------------|------------------------|---------|
| 400 | — | Bad request (missing required field, invalid param) |
| 401 | `INVALID_CREDENTIALS` | Wrong email or password |
| 401 | `GOOGLE_ACCOUNT` | Account uses Google sign-in; email/password login rejected |
| 401 | `INVALID_FIREBASE_TOKEN` | Firebase ID token is expired, malformed, or invalid |
| 401 | `INVALID_REFRESH_TOKEN` | Refresh token is expired or malformed |
| 401 | `REFRESH_TOKEN_MISMATCH` | Refresh token does not match stored value |
| 401 | `UNAUTHORIZED` | Missing or invalid access token |
| 403 | `FORBIDDEN` | Authenticated but not authorised for this resource |
| 404 | — | Resource not found |
| 409 | `CONFLICT_ERROR` | Email already registered or linked to a different Google account |
| 422 | `VALIDATION_ERROR` | Request body failed Joi validation |
| 422 | `MISSING_EMAIL` | Firebase token verified but contains no email claim |
| 429 | — | Rate limit exceeded |
| 500 | — | Internal server error |
| 500 | `GOOGLE_AUTH_ERROR` | Unexpected server-side failure during Google sign-in |
| 502 | — | Upstream service error (e.g., Cloudinary upload failed) |

---

## Rate Limiting

| Endpoint group | Window | Max requests |
|----------------|--------|--------------|
| `/auth/*` | 15 min | 20 |
| All other `/api/v1/*` | 15 min | 100 |

Rate limit headers are returned on every response:
- `RateLimit-Limit`
- `RateLimit-Remaining`
- `RateLimit-Reset`

---

## Data Shapes

### UserShape

Returned by auth endpoints and `GET /auth/me`.

```ts
interface UserShape {
  id: string;          // Firestore document ID (string, NOT ObjectId)
  email: string;       // Lowercase email address
  phone: string;       // Phone number (default: '')
  verified: boolean;   // Email verification status (default: false)
  createdAt: string;   // ISO 8601 timestamp
  updatedAt: string;   // ISO 8601 timestamp
}
```

> **Migration note:** `id` replaces the legacy `_id` (MongoDB ObjectId). Always
> use `user.id` — never `user._id`.

### FinancialShape

Returned by `/profile` endpoints.

```ts
interface FinancialShape {
  id: string;              // == userId (Firestore doc ID)
  userId: string;          // Owner's Firestore user ID
  income: number;          // Monthly income (>= 0)
  additionalIncome: number; // Additional monthly income (default: 0)
  expenses: {
    housing: number;       // Housing costs (default: 0)
    loans: number;         // Loan repayments (default: 0)
    other: number;         // Other expenses (default: 0)
  };
  assets: {
    savings: number;       // Savings balance (default: 0)
    investments: number;   // Investment value (default: 0)
  };
  debts: Array<{
    type: string;          // Debt type description
    amount: number;        // Debt amount (>= 0)
  }>;
  updatedAt: string;       // ISO 8601 timestamp
}
```

### OfferShape

Returned by `/offers` and `/analysis` endpoints.

```ts
interface OfferShape {
  id: string;              // Firestore document ID (string)
  userId: string;          // Owner's Firestore user ID
  originalFile: {
    url: string;           // Cloudinary secure URL
    mimetype: string;      // e.g., 'application/pdf', 'image/jpeg'
  };
  extractedData: {
    bank: string;          // Bank name (default: '')
    amount: number | null; // Loan amount in ILS
    rate: number | null;   // Interest rate (%)
    term: number | null;   // Loan term in months
  };
  analysis: {
    recommendedRate: number | null; // AI-recommended rate (%)
    savings: number | null;         // Estimated savings in ILS
    aiReasoning: string;            // AI explanation (default: '')
  };
  status: 'pending' | 'analyzed' | 'error';
  createdAt: string;       // ISO 8601 timestamp
  updatedAt: string;       // ISO 8601 timestamp
}
```

> **Note:** `analysis` fields may be `null` when `status === 'pending'`.
> Always use optional chaining: `offer.analysis?.savings ?? 0`.

### DashboardShape

Returned by `GET /dashboard`.

```ts
interface DashboardShape {
  financials: FinancialShape | null;  // null if profile not set up yet
  recentOffers: OfferShape[];         // Up to 5 most recent offers
  stats: {
    totalOffers: number;              // Total offer count
    savingsTotal: number;             // Sum of all analysis.savings
    pending: number;                  // Count of pending offers
    analyzed: number;                 // Count of analyzed offers
    error: number;                    // Count of errored offers
  };
}
```

### PaginationMeta

Included in paginated list responses.

```ts
interface PaginationMeta {
  page: number;    // Current page (1-based)
  limit: number;   // Items per page
  total: number;   // Total item count
  pages: number;   // Total page count
}
```

---

## Endpoints

### Auth Endpoints

#### `POST /auth/register`

Create a new user account and receive JWT tokens.

**Access:** Public  
**Rate limit:** Auth limiter (20 req / 15 min)

**Request body:**

```json
{
  "email": "user@example.com",
  "password": "securepassword123",
  "phone": "050-1234567"
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `email` | string | ✅ | Valid email, lowercased |
| `password` | string | ✅ | Min 8 characters |
| `phone` | string | ❌ | Israeli format: `+972XXXXXXXXX` or `0XXXXXXXXX` |

**Response: `201 Created`**

```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "firestore-uid-abc123",
      "email": "user@example.com",
      "phone": "050-1234567",
      "verified": false
    }
  },
  "message": "User registered successfully"
}
```

**Error responses:**

| Status | Condition |
|--------|-----------|
| 409 | Email already registered |
| 422 | Validation failed (invalid email, short password, etc.) |
| 500 | Internal server error |

---

#### `POST /auth/login`

Authenticate with email and password.

**Access:** Public  
**Rate limit:** Auth limiter (20 req / 15 min)

**Request body:**

```json
{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

**Response: `200 OK`**

```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "firestore-uid-abc123",
      "email": "user@example.com",
      "phone": "050-1234567",
      "verified": false
    }
  },
  "message": "Login successful"
}
```

**Error responses:**

| Status | Condition |
|--------|-----------|
| 401 | Invalid email or password |
| 401 | Account uses Google sign-in (`GOOGLE_ACCOUNT`) |
| 422 | Validation failed |
| 500 | Internal server error |

---

#### `POST /auth/refresh`

Rotate the refresh token and receive a new access token.

**Access:** Public  
**Rate limit:** Auth limiter (20 req / 15 min)

**Request body:**

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response: `200 OK`**

```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  },
  "message": "Token refreshed successfully"
}
```

> **Important:** Both the old `token` and `refreshToken` are invalidated. Store
> the new values immediately.

**Error responses:**

| Status | Condition |
|--------|-----------|
| 401 | Refresh token expired, malformed, or does not match stored value |
| 422 | Missing `refreshToken` field |
| 500 | Internal server error |

---

#### `POST /auth/logout`

Invalidate the refresh token (server-side logout).

**Access:** Public (optionally authenticated)  
**Rate limit:** Auth limiter (20 req / 15 min)

**Request body (optional):**

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

> If `refreshToken` is omitted and the request is authenticated (valid
> `Authorization` header), the token is cleared by `userId` instead.

**Response: `200 OK`**

```json
{
  "success": true,
  "data": null,
  "message": "Logged out successfully"
}
```

---

#### `GET /auth/me`

Get the currently authenticated user's public profile.

**Access:** 🔒 Protected  
**Rate limit:** API limiter (100 req / 15 min)

**Response: `200 OK`**

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "firestore-uid-abc123",
      "email": "user@example.com",
      "phone": "050-1234567",
      "verified": false,
      "createdAt": "2026-04-03T02:16:00.000Z",
      "updatedAt": "2026-04-03T02:16:00.000Z"
    }
  },
  "message": "User profile retrieved"
}
```

**Error responses:**

| Status | Condition |
|--------|-----------|
| 401 | Missing or invalid access token |
| 404 | User not found (token valid but user deleted) |
| 500 | Internal server error |

---

#### `POST /auth/google`

Verify a Firebase ID token obtained from Google sign-in on the client and
issue custom JWT tokens. This endpoint is the backend counterpart to the
frontend `signInWithPopup(GoogleAuthProvider)` flow.

**Access:** Public  
**Rate limit:** Auth limiter (20 req / 15 min)

**Flow:**
1. Frontend calls `firebase.auth().signInWithPopup(GoogleAuthProvider)`
2. Frontend calls `firebaseUser.getIdToken()` to obtain the Firebase ID token
3. Frontend sends `POST /auth/google { idToken }` to this endpoint
4. Backend verifies the token via Firebase Admin SDK (`admin.auth().verifyIdToken()`)
5. Backend finds or creates the Firestore user document (handles account linking)
6. Backend issues custom access + refresh tokens and returns the standard auth payload

**Request body:**

```json
{
  "idToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6..."
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `idToken` | string | ✅ | Non-empty Firebase ID token from `firebaseUser.getIdToken()` |

**Response: `200 OK`**

```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "firestore-doc-id-google",
      "email": "googleuser@gmail.com",
      "phone": "",
      "verified": true
    }
  },
  "message": "Google sign-in successful"
}
```

> The response shape is **identical** to `POST /auth/login` — the frontend
> `authService.googleLogin()` can use the same token storage and `AUTH_SUCCESS`
> dispatch as the regular login flow.

**Account linking behaviour:**

| Scenario | Behaviour |
|----------|-----------|
| Returning Google user (firebaseUid match) | Fast path: update `updatedAt`, return existing user |
| Existing email/password user + first Google sign-in | Link: add `firebaseUid` to existing document |
| Brand-new Google user | Create passwordless document (`password: null`) |
| Email already linked to a **different** Google account | `409 CONFLICT_ERROR` |
| Google-only user attempts email/password login | `401 GOOGLE_ACCOUNT` (from `POST /auth/login`) |

**Error responses:**

| Status | `error.code` | Condition |
|--------|-------------|----------|
| 401 | `INVALID_FIREBASE_TOKEN` | Token expired, malformed, wrong audience, or tampered |
| 409 | `CONFLICT_ERROR` | Email already linked to a different Google account |
| 422 | `VALIDATION_ERROR` | `idToken` field missing or empty |
| 422 | `MISSING_EMAIL` | Firebase token verified but contains no email claim |
| 500 | `GOOGLE_AUTH_ERROR` | Unexpected server-side failure |

**Frontend integration example:**

```js
// src/services/authService.js
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import api from './api';

export const googleLogin = async () => {
  const auth = getAuth();
  const provider = new GoogleAuthProvider();

  // Step 1: Firebase popup sign-in
  const result = await signInWithPopup(auth, provider);
  const idToken = await result.user.getIdToken();

  // Step 2: Exchange Firebase ID token for custom JWTs
  const { data } = await api.post('/auth/google', { idToken });

  // data.data has the same shape as login: { token, refreshToken, user }
  return data.data;
};
```

---

### Profile Endpoints

All profile endpoints require authentication.

#### `GET /profile`

Retrieve the authenticated user's financial profile.

**Access:** 🔒 Protected

**Response: `200 OK`** (profile exists)

```json
{
  "success": true,
  "data": {
    "id": "firestore-uid-abc123",
    "userId": "firestore-uid-abc123",
    "income": 15000,
    "additionalIncome": 2000,
    "expenses": {
      "housing": 4000,
      "loans": 1500,
      "other": 800
    },
    "assets": {
      "savings": 200000,
      "investments": 50000
    },
    "debts": [
      { "type": "רכב", "amount": 80000 }
    ],
    "updatedAt": "2026-04-03T02:16:00.000Z"
  },
  "message": "Financial profile retrieved"
}
```

**Response: `200 OK`** (no profile yet)

```json
{
  "success": true,
  "data": null,
  "message": "No financial profile found"
}
```

> **Frontend note:** Always handle `data === null` — show an empty form or
> prompt the user to fill in their profile.

---

#### `PUT /profile`

Create or fully replace the authenticated user's financial profile (upsert).

**Access:** 🔒 Protected

**Request body** (all fields optional; missing fields default to `0` / `[]`):

```json
{
  "income": 15000,
  "additionalIncome": 2000,
  "expenses": {
    "housing": 4000,
    "loans": 1500,
    "other": 800
  },
  "assets": {
    "savings": 200000,
    "investments": 50000
  },
  "debts": [
    { "type": "רכב", "amount": 80000 }
  ]
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `income` | number | ❌ | >= 0, default 0 |
| `additionalIncome` | number | ❌ | >= 0, default 0 |
| `expenses.housing` | number | ❌ | >= 0, default 0 |
| `expenses.loans` | number | ❌ | >= 0, default 0 |
| `expenses.other` | number | ❌ | >= 0, default 0 |
| `assets.savings` | number | ❌ | >= 0, default 0 |
| `assets.investments` | number | ❌ | >= 0, default 0 |
| `debts` | array | ❌ | Max 20 items, each `{ type: string, amount: number }` |

**Response: `200 OK`**

```json
{
  "success": true,
  "data": { /* FinancialShape */ },
  "message": "Financial profile updated successfully"
}
```

---

#### `PATCH /profile`

Partially update specific fields of the financial profile.
Only the provided fields are written; existing fields are preserved.

**Access:** 🔒 Protected

**Request body** (at least one field required):

```json
{
  "income": 18000
}
```

**Response: `200 OK`**

```json
{
  "success": true,
  "data": { /* FinancialShape with updated fields */ },
  "message": "Financial profile partially updated"
}
```

**Error responses:**

| Status | Condition |
|--------|-----------|
| 400 | Empty request body |
| 422 | Validation failed (negative number, invalid debt item, etc.) |

---

### Offers Endpoints

All offers endpoints require authentication.

#### `POST /offers`

Upload a mortgage offer file. The file is stored in Cloudinary and AI analysis
is triggered asynchronously.

**Access:** 🔒 Protected  
**Content-Type:** `multipart/form-data`

**Form fields:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `file` | File | ✅ | PDF, PNG, or JPG; max 10 MB |
| `bankName` | string | ❌ | Optional bank name hint for AI |

**Response: `201 Created`**

```json
{
  "success": true,
  "data": {
    "id": "offer-id-xyz789",
    "status": "pending"
  }
}
```

> **Frontend note:** After upload, poll `GET /offers/:id` or `GET /offers` to
> check when `status` changes from `'pending'` to `'analyzed'` or `'error'`.

**Error responses:**

| Status | Condition |
|--------|-----------|
| 400 | No file uploaded |
| 502 | Cloudinary upload failed |
| 500 | Internal server error |

---

#### `GET /offers`

List all offers for the authenticated user, sorted by `createdAt` descending.

**Access:** 🔒 Protected

**Query parameters:**

| Param | Type | Default | Max | Description |
|-------|------|---------|-----|-------------|
| `page` | number | 1 | — | Page number (1-based) |
| `limit` | number | 10 | 50 | Items per page |

**Response: `200 OK`**

```json
{
  "success": true,
  "data": [
    {
      "id": "offer-id-xyz789",
      "userId": "firestore-uid-abc123",
      "originalFile": {
        "url": "https://res.cloudinary.com/morty/raw/upload/v1234/morty/offers/file.pdf",
        "mimetype": "application/pdf"
      },
      "extractedData": {
        "bank": "הפועלים",
        "amount": 1200000,
        "rate": 3.5,
        "term": 240
      },
      "analysis": {
        "recommendedRate": 3.1,
        "savings": 45000,
        "aiReasoning": "שיעור טוב יותר זמין בשוק."
      },
      "status": "analyzed",
      "createdAt": "2026-04-03T02:16:00.000Z",
      "updatedAt": "2026-04-03T02:20:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "pages": 1
  }
}
```

---

#### `GET /offers/stats`

Get aggregate offer statistics for the authenticated user.

**Access:** 🔒 Protected

**Response: `200 OK`**

```json
{
  "success": true,
  "data": {
    "total": 5,
    "pending": 1,
    "analyzed": 3,
    "error": 1,
    "savingsTotal": 135000
  }
}
```

---

#### `GET /offers/:id`

Get a single offer by ID. The offer must belong to the authenticated user.

**Access:** 🔒 Protected

**Path parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Firestore offer document ID |

**Response: `200 OK`**

```json
{
  "success": true,
  "data": { /* OfferShape */ }
}
```

**Error responses:**

| Status | Condition |
|--------|-----------|
| 404 | Offer not found or does not belong to the user |

---

#### `DELETE /offers/:id`

Delete an offer by ID. Also removes the associated Cloudinary file.
The offer must belong to the authenticated user.

**Access:** 🔒 Protected

**Response: `200 OK`**

```json
{
  "success": true,
  "message": "Offer deleted"
}
```

**Error responses:**

| Status | Condition |
|--------|-----------|
| 404 | Offer not found or does not belong to the user |

---

### Analysis Endpoints

#### `GET /analysis/:offerId`

Get the full offer document including AI analysis results.
The offer must belong to the authenticated user.

**Access:** 🔒 Protected

**Path parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `offerId` | string | Firestore offer document ID |

**Response: `200 OK`**

```json
{
  "success": true,
  "data": {
    "id": "offer-id-xyz789",
    "userId": "firestore-uid-abc123",
    "originalFile": {
      "url": "https://res.cloudinary.com/morty/raw/upload/v1234/morty/offers/file.pdf",
      "mimetype": "application/pdf"
    },
    "extractedData": {
      "bank": "הפועלים",
      "amount": 1200000,
      "rate": 3.5,
      "term": 240
    },
    "analysis": {
      "recommendedRate": 3.1,
      "savings": 45000,
      "aiReasoning": "שיעור טוב יותר זמין בשוק."
    },
    "status": "analyzed",
    "createdAt": "2026-04-03T02:16:00.000Z",
    "updatedAt": "2026-04-03T02:20:00.000Z"
  }
}
```

**Handling offer status in the UI:**

| `status` | UI behaviour |
|----------|--------------|
| `pending` | Show spinner + "הניתוח מתבצע..." |
| `analyzed` | Show `PaymentComparisonChart` + `RecommendationCard` |
| `error` | Show error state + retry option |

**Error responses:**

| Status | Condition |
|--------|-----------|
| 400 | Missing offer ID |
| 404 | Offer not found or does not belong to the user |

---

### Dashboard Endpoints

#### `GET /dashboard`

Get an aggregated summary of the user's financial profile and recent offers.
All three Firestore queries run in parallel for minimal latency.

**Access:** 🔒 Protected

**Response: `200 OK`**

```json
{
  "success": true,
  "data": {
    "financials": {
      "id": "firestore-uid-abc123",
      "userId": "firestore-uid-abc123",
      "income": 15000,
      "additionalIncome": 2000,
      "expenses": { "housing": 4000, "loans": 1500, "other": 800 },
      "assets": { "savings": 200000, "investments": 50000 },
      "debts": [],
      "updatedAt": "2026-04-03T02:16:00.000Z"
    },
    "recentOffers": [
      { /* OfferShape */ }
    ],
    "stats": {
      "totalOffers": 5,
      "savingsTotal": 135000,
      "pending": 1,
      "analyzed": 3,
      "error": 1
    }
  },
  "message": "Dashboard data retrieved successfully"
}
```

> **Note:** `financials` is `null` if the user has not set up their profile yet.
> `recentOffers` contains at most **5** offers, sorted by `createdAt` descending.

---

### Health Endpoint

#### `GET /health`

Health check endpoint. Does not require authentication.

**Access:** Public

**Response: `200 OK`**

```json
{
  "status": "ok",
  "timestamp": "2026-04-03T02:16:00.000Z"
}
```

---

## Migration Notes

### MongoDB → Firestore

The backend was migrated from MongoDB/Mongoose to Google Cloud Firestore.
Frontend code must be updated to handle the following changes:

#### ID Field

| Before (MongoDB) | After (Firestore) |
|------------------|-------------------|
| `user._id` (ObjectId string) | `user.id` (Firestore string ID) |
| `offer._id` | `offer.id` |

**Action required:** Replace all `._id` references with `.id` in frontend code.

```js
// ❌ Old
const userId = user._id;
const key = offer._id;

// ✅ New
const userId = user.id;
const key = offer.id;
```

#### Timestamps

| Before (MongoDB) | After (Firestore) |
|------------------|-------------------|
| `Date` object (Mongoose) | ISO 8601 string |

**Action required:** Parse timestamps with `new Date(isoString)` before formatting.

```js
// ✅ Correct
const formatted = new Date(offer.createdAt).toLocaleDateString('he-IL');
```

#### Response Envelope

All responses now use `{ success, data, message }`. Previously some endpoints
returned data directly.

```js
// ✅ Correct
const { data } = await axios.post('/auth/login', credentials);
const { token, refreshToken, user } = data.data;
```

#### Null Analysis Fields

When `offer.status === 'pending'`, the `analysis` sub-object exists but its
fields are `null`. Always use optional chaining:

```js
// ✅ Correct
const savings = offer.analysis?.savings ?? 0;
const reasoning = offer.analysis?.aiReasoning || 'אין נימוק זמין';
```

---

## Frontend Integration Guide

### Axios Setup

```js
// src/services/api.js
import axios from 'axios';
import { getStoredToken, getStoredRefreshToken, setStoredToken, setStoredRefreshToken, clearStorage } from '../utils/storage';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

// Attach access token to every request
api.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-refresh on 401
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const refreshToken = getStoredRefreshToken();
        const { data } = await axios.post(
          `${import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1'}/auth/refresh`,
          { refreshToken }
        );
        setStoredToken(data.data.token);
        setStoredRefreshToken(data.data.refreshToken);
        original.headers.Authorization = `Bearer ${data.data.token}`;
        return api(original);
      } catch {
        clearStorage();
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
```

### Auth Service

```js
// src/services/authService.js
import api from './api';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';

export const login = async ({ email, password }) => {
  const { data } = await api.post('/auth/login', { email, password });
  // data.data contains { token, refreshToken, user }
  // user.id is a Firestore string ID (not _id)
  return data.data;
};

export const register = async ({ email, password, phone }) => {
  const { data } = await api.post('/auth/register', { email, password, phone });
  return data.data;
};

/**
 * Google sign-in via Firebase popup.
 * Returns the same { token, refreshToken, user } shape as login/register.
 */
export const googleLogin = async () => {
  const auth = getAuth();
  const provider = new GoogleAuthProvider();

  // Step 1: Firebase popup — obtains Google credentials
  const result = await signInWithPopup(auth, provider);
  const idToken = await result.user.getIdToken();

  // Step 2: Exchange Firebase ID token for custom JWTs
  const { data } = await api.post('/auth/google', { idToken });
  return data.data; // { token, refreshToken, user }
};

export const refreshToken = async (refreshToken) => {
  const { data } = await api.post('/auth/refresh', { refreshToken });
  return data.data; // { token, refreshToken }
};

export const logout = async (refreshToken) => {
  await api.post('/auth/logout', { refreshToken });
};

export const getMe = async () => {
  const { data } = await api.get('/auth/me');
  return data.data.user;
};
```

### Normalise User Shape

For backward compatibility during migration, use a normaliser:

```js
// src/utils/normalizers.js
export const normalizeUser = (user) => ({
  id: user.id || user._id,   // backward-compat shim
  email: user.email,
  phone: user.phone || '',
  verified: user.verified || false,
});
```

### Date Formatting

```js
// src/utils/formatters.js
export const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('he-IL') : '—';

export const formatCurrency = (amount) =>
  amount != null
    ? new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(amount)
    : '—';
```

### Mock Data for Tests

```js
// Use in all test files
export const mockUser = {
  id: 'firestore-uid-abc123',   // string, NOT ObjectId
  email: 'test@morty.co.il',
  phone: '050-0000000',
  verified: true,
  createdAt: '2026-04-03T02:16:00.000Z',
  updatedAt: '2026-04-03T02:16:00.000Z',
};

export const mockFinancials = {
  id: 'firestore-uid-abc123',
  userId: 'firestore-uid-abc123',
  income: 15000,
  additionalIncome: 2000,
  expenses: { housing: 4000, loans: 1500, other: 800 },
  assets: { savings: 200000, investments: 50000 },
  debts: [],
  updatedAt: '2026-04-03T02:16:00.000Z',
};

export const mockOffer = {
  id: 'offer-id-xyz789',         // string, NOT ObjectId
  userId: 'firestore-uid-abc123',
  originalFile: {
    url: 'https://res.cloudinary.com/morty/raw/upload/v1234/morty/offers/file.pdf',
    mimetype: 'application/pdf',
  },
  extractedData: {
    bank: 'הפועלים',
    amount: 1200000,
    rate: 3.5,
    term: 240,
  },
  analysis: {
    recommendedRate: 3.1,
    savings: 45000,
    aiReasoning: 'שיעור טוב יותר זמין בשוק.',
  },
  status: 'analyzed',
  createdAt: '2026-04-03T02:16:00.000Z',
  updatedAt: '2026-04-03T02:20:00.000Z',
};

export const mockPendingOffer = {
  ...mockOffer,
  id: 'offer-id-pending',
  extractedData: { bank: '', amount: null, rate: null, term: null },
  analysis: { recommendedRate: null, savings: null, aiReasoning: '' },
  status: 'pending',
};

export const mockDashboard = {
  financials: mockFinancials,
  recentOffers: [mockOffer],
  stats: {
    totalOffers: 1,
    savingsTotal: 45000,
    pending: 0,
    analyzed: 1,
    error: 0,
  },
};
```

---

## Environment Variables

### Backend (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | ✅ | `development` \| `production` |
| `PORT` | ✅ | Server port (default: 5000) |
| `JWT_SECRET` | ✅ | HS256 secret for access tokens (min 32 chars) |
| `JWT_REFRESH_SECRET` | ✅ | HS256 secret for refresh tokens (min 32 chars) |
| `FIREBASE_PROJECT_ID` | ✅ | GCP project ID |
| `FIREBASE_CLIENT_EMAIL` | ✅ | Firebase Admin SDK service account email |
| `FIREBASE_PRIVATE_KEY` | ✅ | Firebase Admin SDK private key (with `\n` newlines) |
| `CLOUDINARY_CLOUD_NAME` | ✅ | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | ✅ | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | ✅ | Cloudinary API secret |
| `OPENAI_API_KEY` | ✅ | OpenAI API key for GPT-4o Vision |
| `CORS_ORIGIN` | ✅ | Frontend origin (e.g., `https://morty.app`) |
| `GOOGLE_APPLICATION_CREDENTIALS` | ❌ | Path to service account JSON (local dev alternative) |
| `LOG_LEVEL` | ❌ | Winston log level (default: `info`) |

### Frontend (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_URL` | ✅ | Backend API base URL (e.g., `https://morty-backend-h9sb.onrender.com/api/v1`) |
| `VITE_FIREBASE_API_KEY` | ✅ | Firebase web app API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | ✅ | Firebase Auth domain (e.g., `myproject.firebaseapp.com`) |
| `VITE_FIREBASE_PROJECT_ID` | ✅ | Firebase GCP project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | ❌ | Firebase Storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | ❌ | Firebase Cloud Messaging sender ID |
| `VITE_FIREBASE_APP_ID` | ✅ | Firebase web app ID |
