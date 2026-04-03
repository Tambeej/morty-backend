# Morty Backend

Node.js/Express REST API for the Morty AI-powered mortgage analysis platform.

## Quick Start

```bash
npm install
cp .env.example .env   # fill in your values
npm run dev
```

## API Base URL

`/api/v1`

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /auth/register | – | Register new user |
| POST | /auth/login | – | Login, receive JWT |
| POST | /auth/refresh | – | Refresh access token |
| POST | /auth/logout | – | Invalidate refresh token |
| GET | /auth/me | ✓ | Get current user |
| GET | /profile | ✓ | Get financial profile |
| PUT | /profile | ✓ | Upsert financial profile |
| POST | /offers | ✓ | Upload mortgage offer file |
| GET | /offers | ✓ | List offers (paginated) |
| GET | /offers/stats | ✓ | Offer statistics |
| GET | /offers/:id | ✓ | Get single offer |
| DELETE | /offers/:id | ✓ | Delete offer |
| GET | /analysis/:id | ✓ | Get AI analysis results |
| GET | /dashboard | ✓ | Dashboard summary |
| GET | /health | – | Health check |

## Environment Variables

See `.env.example` for all required variables.

## Tech Stack

- **Runtime**: Node.js 20 / Express 4
- **Database**: Google Cloud Firestore (via firebase-admin 12)
- **Auth**: JWT (access 15m + refresh 7d) + bcryptjs
- **Validation**: Joi
- **File Upload**: Multer → Cloudinary
- **AI**: OpenAI GPT-4o Vision
- **Logging**: Winston
- **Security**: Helmet, CORS, express-rate-limit

---

## Firestore Setup

### Collections

The application uses three Firestore collections:

| Collection | Document ID | Key Fields |
|------------|-------------|------------|
| `users` | Auto-generated | `email`, `refreshToken`, `verified` |
| `financials` | `userId` (same as user doc ID) | `userId`, `income`, `expenses`, `assets` |
| `offers` | Auto-generated | `userId`, `status`, `createdAt` |

### Firestore Indexes

Firestore requires explicit composite indexes for queries that filter on one
field and sort/filter on another.  The index definitions are stored in
[`firestore.indexes.json`](./firestore.indexes.json).

#### Required Composite Indexes

| Collection | Fields | Direction | Used By |
|------------|--------|-----------|---------|
| `offers` | `userId`, `createdAt` | ASC, DESC | `listOffersByUser`, `getRecentOffers` |
| `offers` | `userId`, `status` | ASC, ASC | `countOffersByUser` (with status filter) |
| `offers` | `userId`, `status`, `createdAt` | ASC, ASC, DESC | Future filtered+sorted queries |

#### Required Single-Field Indexes

Firestore creates single-field indexes automatically by default.  The
following fields are explicitly configured to ensure they are never
accidentally disabled:

| Collection | Field | Used By |
|------------|-------|---------|
| `users` | `email` | `findByEmail` (login / register uniqueness check) |
| `users` | `refreshToken` | `findByRefreshToken` (token rotation) |
| `financials` | `userId` | Direct doc lookup (no query index needed) |

### Deploying Indexes

#### Option A – Firebase CLI (recommended)

```bash
# Install Firebase CLI if not already installed
npm install -g firebase-tools

# Authenticate
firebase login

# Deploy only the Firestore indexes
firebase deploy --only firestore:indexes
```

#### Option B – Firebase Console (manual)

1. Open [Firebase Console → Firestore → Indexes](https://console.firebase.google.com/project/_/firestore/indexes)
2. Click **Add Index** for each composite index listed above
3. Single-field indexes are created automatically

#### Option C – Verify index requirements

Run the verification script to print a summary of all required indexes:

```bash
node scripts/verify-indexes.js
```

### Why Indexes Matter

Without the `offers (userId ASC, createdAt DESC)` composite index, Firestore
will reject the following queries with a `FAILED_PRECONDITION` error:

```
The query requires an index. You can create it here: https://console.firebase.google.com/...
```

This would break:
- `GET /api/v1/offers` – listing a user's offers
- `GET /api/v1/dashboard` – recent offers in the dashboard summary

---

## Running Tests

```bash
npm test
npm run test:coverage
```
