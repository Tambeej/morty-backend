# Morty Backend API Documentation

## Base URL

```
https://api.morty.app/api/v1
```

## Authentication

All protected endpoints require a Firebase ID token in the `Authorization` header:

```
Authorization: Bearer <firebase-id-token>
```

---

## Analysis Endpoints

### POST /api/v1/analysis/:offerId/enhanced

Generate an AI-powered enhanced mortgage analysis report for a paid user.

**Authentication**: Required (Firebase ID token)  
**Authorization**: Requires `paidAnalyses = true` on user document  
**Rate Limit**: 5 requests per minute per user

#### URL Parameters

| Parameter | Type   | Required | Description                    |
|-----------|--------|----------|--------------------------------|
| offerId   | string | Yes      | Firestore document ID of offer |

#### Request Headers

```
Authorization: Bearer <firebase-id-token>
Content-Type: application/json
```

#### Success Response (201 — First Generation)

```json
{
  "success": true,
  "message": "Enhanced report generated successfully",
  "data": {
    "tricks": [
      {
        "nameHe": "מסלול פיתיון",
        "nameEn": "Enticement Track",
        "descriptionHe": "קחו מסלול בריבית גבוהה...",
        "descriptionEn": "Take a high-interest track...",
        "applicability": "high",
        "riskLevel": "medium",
        "potentialSavings": 22000
      }
    ],
    "negotiationScript": "שלום, שמי [שם]. אני מעוניין/ת במשכנתא...",
    "insights": [
      {
        "titleHe": "ניתוח הריבית",
        "titleEn": "Rate Analysis",
        "bodyHe": "הריבית המוצעת גבוהה מהממוצע...",
        "bodyEn": "The offered rate is above average...",
        "icon": "trending-down"
      }
    ],
    "comparison": {
      "rateDelta": 0.45,
      "monthlySaving": 412,
      "totalSaving": 123600,
      "loanAmount": 1500000,
      "termYears": 25,
      "bankRate": 5.2,
      "portfolioRate": 4.75,
      "trackComparison": [
        {
          "name": "קל\"צ",
          "bankRate": 5.2,
          "portfolioRate": 4.75,
          "delta": 0.45
        }
      ]
    },
    "generatedAt": "2026-05-07T12:00:00.000Z",
    "generatedBy": "ai",
    "processingTimeMs": 1500
  }
}
```

#### Success Response (200 — Cached Report)

Same structure as above, returned when the enhanced report already exists.

```json
{
  "success": true,
  "message": "Enhanced report retrieved from cache",
  "data": { ... }
}
```

#### Error Responses

| Status | Code              | Description                                    |
|--------|-------------------|------------------------------------------------|
| 400    | VALIDATION_ERROR  | Invalid offerId format                         |
| 401    | UNAUTHORIZED      | Missing or invalid Firebase token              |
| 403    | FORBIDDEN         | User has not paid (paidAnalyses = false)       |
| 403    | FORBIDDEN         | Offer belongs to a different user              |
| 404    | NOT_FOUND         | Offer not found                                |
| 429    | RATE_LIMIT_EXCEEDED | Too many requests (5/min limit)              |
| 500    | INTERNAL_ERROR    | Unexpected server error                        |

#### Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "This feature requires a paid subscription."
  }
}
```

---

## Data Models

### EnhancedReport

```typescript
interface EnhancedReport {
  tricks: MortgageTrick[];
  negotiationScript: string;  // Hebrew RTL script
  insights: StrategicInsight[];
  comparison: Comparison;
  generatedAt: string;        // ISO 8601
  generatedBy: 'ai' | 'rule-based-fallback';
  processingTimeMs: number;
}

interface MortgageTrick {
  nameHe: string;
  nameEn: string;
  descriptionHe: string;
  descriptionEn: string;
  applicability: 'high' | 'medium' | 'low';
  riskLevel: 'low' | 'medium' | 'high';
  potentialSavings: number | null;  // ILS
}

interface StrategicInsight {
  titleHe: string;
  titleEn: string;
  bodyHe: string;
  bodyEn: string;
  icon: 'trending-down' | 'check-circle' | 'target' | 'calendar' | 'shield' | 'info';
}

interface Comparison {
  rateDelta: number | null;       // bank - portfolio (percentage points)
  monthlySaving: number | null;   // ILS/month
  totalSaving: number | null;     // ILS over full term
  loanAmount: number;             // ILS
  termYears: number;
  bankRate: number | null;        // %
  portfolioRate: number | null;   // %
  trackComparison: TrackComparison[];
}

interface TrackComparison {
  name: string;
  bankRate: number | null;
  portfolioRate: number | null;
  delta: number | null;
}
```

---

## Security

- All endpoints require Firebase ID token authentication
- Ownership validation: users can only access their own offers
- Paid access enforced server-side (not just client-side)
- Rate limiting: 5 requests/minute for enhanced endpoint
- Input validation on all parameters
- AI outputs sanitised before storage and response
