# Morty Backend

Node.js/Express REST API for the Morty AI-powered mortgage analysis platform.

## Tech Stack

- **Runtime**: Node.js 20
- **Framework**: Express 4
- **Database**: MongoDB (Mongoose ODM)
- **Auth**: JWT (access + refresh tokens)
- **Validation**: Joi
- **File Uploads**: Multer + Cloudinary
- **AI Analysis**: OpenAI API
- **Logging**: Winston
- **Security**: Helmet, CORS, express-rate-limit

## Getting Started

### Prerequisites

- Node.js >= 20
- MongoDB Atlas account (or local MongoDB)
- Cloudinary account
- OpenAI API key

### Installation

```bash
# Clone the repository
git clone https://github.com/Tambeej/morty-backend.git
cd morty-backend

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your actual values

# Start development server
npm run dev
```

### Environment Variables

See [.env.example](.env.example) for all required variables.

## API Reference

Base URL: `/api/v1`

### Health Check

```
GET /health
```

Returns server status, version, and environment.

### Authentication (`/api/v1/auth`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Register a new user |
| POST | `/auth/login` | Login and receive JWT tokens |
| POST | `/auth/refresh` | Refresh access token |
| POST | `/auth/logout` | Invalidate refresh token |

### Profile (`/api/v1/profile`) — JWT required

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/profile` | Get user financial profile |
| PUT | `/profile` | Update financial data |

### Offers (`/api/v1/offers`) — JWT required

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/offers` | Upload mortgage offer (multipart/form-data) |
| GET | `/offers` | List user's offers |
| GET | `/offers/:id` | Get single offer |

### Analysis (`/api/v1/analysis`) — JWT required

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/analysis/:id` | Get analysis results for an offer |

### Dashboard (`/api/v1/dashboard`) — JWT required

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/dashboard` | Get summary stats and recent offers |

## Response Format

All responses follow this structure:

```json
// Success
{
  "success": true,
  "data": { ... }
}

// Error
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": [ ... ]  // optional, for validation errors
  }
}
```

## Security

- JWT access tokens expire in 24 hours; refresh tokens in 7 days
- Passwords hashed with bcryptjs (salt rounds: 12)
- Rate limiting: 100 req/15min (general), 10 req/15min (auth)
- File uploads: max 5MB, PDF/PNG/JPG only
- All inputs validated with Joi and sanitised with xss
- CORS restricted to configured frontend origins

## Project Structure

```
src/
├── index.js              # Server entry point
├── config/
│   ├── db.js             # MongoDB connection
│   └── cloudinary.js     # Cloudinary setup
├── middleware/
│   ├── auth.js           # JWT guard
│   ├── validate.js       # Joi validation factory
│   └── rateLimit.js      # Rate limiters
├── models/
│   ├── User.js
│   ├── Financial.js
│   └── Offer.js
├── routes/
│   ├── auth.js
│   ├── profile.js
│   ├── offers.js
│   ├── analysis.js
│   └── dashboard.js
├── controllers/
│   ├── authController.js
│   ├── profileController.js
│   ├── offersController.js
│   └── analysisController.js
├── services/
│   ├── aiService.js      # OpenAI integration
│   └── email.js          # Nodemailer
└── utils/
    ├── logger.js          # Winston logger
    └── errors.js          # Custom error classes
```

## Running Tests

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

## Deployment (Render)

1. Connect the GitHub repository to Render
2. Set environment variables in Render dashboard
3. Build command: `npm install`
4. Start command: `npm start`

## License

MIT
