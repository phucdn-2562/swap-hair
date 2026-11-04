# Hairstyle Gemini API (Standalone NestJS)

A minimal standalone NestJS project that contains only the hairstyle try-on function extracted from the Meal Planner project.

## What it does

- Accepts two images:
  - `sourceImage`: original person. Keep this person's face and identity.
  - `referenceImage`: reference hairstyle. Transfer only the hair from this image.
- Calls Gemini Image generation/editing API.
- Returns the generated image as a binary image response (not a JSON Data URL).
- No authentication, database, Redis, queue, quota, subscription, or R2 dependency.

## Requirements

- Node.js 20+ (Node.js 22 recommended)
- A Gemini API key with access to the configured image model

## Setup

```bash
npm install
cp .env.example .env
```

Set `GEMINI_API_KEY` in `.env`.

Optional:

```env
GEMINI_IMAGE_MODEL=gemini-2.5-flash-image
PORT=3000
MAX_IMAGE_SIZE_MB=10
```

## Run

```bash
npm run start:dev
```

Endpoint:

```http
POST http://localhost:3000/api/hairstyles/try-on
Content-Type: multipart/form-data
```

Form-data fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `sourceImage` | File | Yes | Original person/face to preserve |
| `referenceImage` | File | Yes | Image containing the desired hairstyle |

No Authorization header is required.

## cURL test

```bash
curl -X POST "http://localhost:3000/api/hairstyles/try-on" \
  -F "sourceImage=@./person.webp;type=image/webp" \
  -F "referenceImage=@./hairstyle.jpg;type=image/jpeg" \
  --output hairstyle-result.png
```

The output file extension in the command is illustrative. Check the response `Content-Type` if the model returns JPEG or WebP.

To inspect headers:

```bash
curl -i -X POST "http://localhost:3000/api/hairstyles/try-on" \
  -F "sourceImage=@./person.webp" \
  -F "referenceImage=@./hairstyle.jpg"
```

## Postman

1. Method: `POST`
2. URL: `http://localhost:3000/api/hairstyles/try-on`
3. Body → `form-data`
4. Add `sourceImage` as File.
5. Add `referenceImage` as File.
6. No Authorization header is needed.
7. Use **Send and Download** to save the binary image response.

## Response

Successful response is the image bytes directly, with headers:

- `Content-Type: image/png` (or JPEG/WebP according to Gemini output)
- `Content-Disposition: inline; filename="hairstyle-result.png"`
- `X-AI-Model: <model-name>`

Errors are standard NestJS JSON error responses.

## Important

The prompt instructs Gemini to preserve the source person's face and transfer only the hairstyle from the reference image. Generative image models may still alter facial details or fail to reproduce the hairstyle exactly. Validate output quality with representative images before production use.

The API is intentionally unauthenticated for local testing. Add rate limiting, request limits, and authentication before exposing it publicly.
