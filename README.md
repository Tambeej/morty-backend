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
| GET | /profile/financials | ✓ | Get financial profile |
| PUT | /profile/financials | ✓ | Upsert financial profile |
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
- **Database**: MongoDB Atlas via Mongoose
- **Auth**: JWT (access 24h + refresh 7d) + bcryptjs
- **Validation**: Joi
- **File Upload**: Multer → Cloudinary
- **AI**: OpenAI GPT-4o Vision
- **Logging**: Winston
- **Security**: Helmet, CORS, express-rate-limit
