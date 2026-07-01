# PDFHandler

A web app that lets users upload a PDF, type a question, and instantly see relevant passages extracted from the document — no API key required.

## How to run

```bash
npm install   # first time only
npm start     # starts server at http://localhost:3000
```

## Project structure

```
PDFHandler/
├── server.js          # Express backend
├── public/
│   └── index.html     # Single-page frontend (vanilla JS, dark theme)
├── package.json
└── CLAUDE.md
```

## How it works

1. User uploads a PDF via the drag-and-drop zone
2. `pdf-parse` extracts all text from the PDF on the server
3. The extracted text is stored in memory keyed by a session ID
4. User types a question; the server scores every paragraph by keyword overlap with the question (stop words removed) and returns the top 5 matching paragraphs
5. Results are displayed as highlighted blocks in the answer box; previous Q&A pairs accumulate in a history panel below

## Key endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/upload` | Accepts a PDF (multipart), extracts text, returns `sessionId` |
| POST | `/api/ask` | Accepts `{ sessionId, question }`, returns `{ answer }` (plain text passages) |

## Tech stack

- **Runtime**: Node.js
- **Framework**: Express
- **PDF parsing**: `pdf-parse`
- **File upload**: `multer` (memory storage, 20 MB limit)
- **Frontend**: Vanilla HTML/CSS/JS — no build step

## No API key needed

The Q&A is handled entirely locally via keyword scoring — no external AI calls. If you want to switch to Claude for smarter answers, add `@anthropic-ai/sdk` back and set `ANTHROPIC_API_KEY`.
