const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const pdfSessions = new Map();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') return cb(new Error('Only PDF files are allowed'));
    cb(null, true);
  },
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Words too common to be useful for matching
const STOP_WORDS = new Set([
  'a','an','the','is','it','in','on','at','to','of','and','or','but','for',
  'with','this','that','are','was','were','be','been','being','have','has',
  'had','do','does','did','will','would','could','should','may','might','can',
  'i','you','he','she','we','they','my','your','his','her','our','its','what',
  'which','who','how','when','where','why','not','no','so','if','as','by','from',
]);

function keywords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

function searchPDF(text, question, topN = 5) {
  const qWords = keywords(question);
  if (!qWords.length) return [];

  // Split into paragraphs (blank-line separated), fallback to sentences
  let chunks = text.split(/\n\s*\n/).map(c => c.replace(/\s+/g, ' ').trim()).filter(c => c.length > 20);
  if (chunks.length < 3) {
    chunks = text.match(/[^.!?]+[.!?]+/g) || [text];
    chunks = chunks.map(c => c.trim()).filter(c => c.length > 20);
  }

  const scored = chunks.map(chunk => {
    const chunkWords = keywords(chunk);
    const chunkSet = new Set(chunkWords);

    // Count how many distinct query keywords appear in this chunk
    const hits = qWords.filter(w => chunkSet.has(w) || chunkWords.some(cw => cw.startsWith(w) || w.startsWith(cw))).length;

    // Boost shorter chunks slightly (more focused)
    const score = hits / Math.sqrt(Math.max(chunkWords.length, 1));
    return { chunk, score, hits };
  });

  return scored
    .filter(s => s.hits > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(s => s.chunk);
}

// Upload and parse PDF
app.post('/api/upload', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF file provided' });

    const data = await pdfParse(req.file.buffer);
    const text = data.text.trim();

    if (!text) return res.status(422).json({ error: 'No readable text found in this PDF' });

    const sessionId = req.headers['x-session-id'] || Date.now().toString();
    pdfSessions.set(sessionId, { text, filename: req.file.originalname, pages: data.numpages });

    res.json({
      sessionId,
      filename: req.file.originalname,
      pages: data.numpages,
      charCount: text.length,
    });
  } catch (err) {
    console.error('Upload error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to process PDF' });
  }
});

// Answer a question using local keyword search
app.post('/api/ask', (req, res) => {
  const { sessionId, question } = req.body;
  if (!sessionId || !question) return res.status(400).json({ error: 'sessionId and question are required' });

  const session = pdfSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'PDF session not found. Please re-upload your PDF.' });

  const results = searchPDF(session.text, question);

  if (!results.length) {
    return res.json({ answer: 'No matching content found in the PDF for that question. Try different keywords.' });
  }

  res.json({ answer: results.join('\n\n---\n\n') });
});

app.listen(PORT, () => console.log(`PDF Handler running at http://localhost:${PORT}`));
