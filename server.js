const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// In-memory store keyed by session: { text, filename }
const pdfSessions = new Map();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files are allowed'));
    }
    cb(null, true);
  },
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Upload and parse PDF
app.post('/api/upload', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file provided' });
    }

    const data = await pdfParse(req.file.buffer);
    const text = data.text.trim();

    if (!text) {
      return res.status(422).json({ error: 'No readable text found in this PDF' });
    }

    // Use a simple session ID from the client, or generate one
    const sessionId = req.headers['x-session-id'] || Date.now().toString();
    pdfSessions.set(sessionId, {
      text,
      filename: req.file.originalname,
      pages: data.numpages,
    });

    res.json({
      sessionId,
      filename: req.file.originalname,
      pages: data.numpages,
      charCount: text.length,
      preview: text.slice(0, 500),
    });
  } catch (err) {
    console.error('Upload error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to process PDF' });
  }
});

// Answer a question about the uploaded PDF
app.post('/api/ask', async (req, res) => {
  const { sessionId, question } = req.body;

  if (!sessionId || !question) {
    return res.status(400).json({ error: 'sessionId and question are required' });
  }

  const session = pdfSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'PDF session not found. Please re-upload your PDF.' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server.' });
  }

  try {
    // Truncate PDF text to avoid exceeding token limits (~150k chars ≈ ~40k tokens)
    const pdfText = session.text.slice(0, 150000);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = client.messages.stream({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `You are a helpful assistant that answers questions based strictly on the content of the provided PDF document.

PDF Document (filename: ${session.filename}, ${session.pages} page(s)):
---
${pdfText}
---

Question: ${question}

Answer the question using only information found in the PDF. If the answer is not present in the document, say so clearly.`,
        },
      ],
    });

    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    });

    stream.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    });

    stream.on('finalMessage', () => {
      res.write('data: [DONE]\n\n');
      res.end();
    });
  } catch (err) {
    console.error('Ask error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Failed to get answer' });
    }
  }
});

app.listen(PORT, () => {
  console.log(`PDF Handler running at http://localhost:${PORT}`);
});
