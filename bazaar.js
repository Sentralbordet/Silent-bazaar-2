const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const child_process = require('child_process');

const app = express();
app.use(express.json());

// Improved logging with real client IP from proxy header
app.use((req, res, next) => {
  let realIp = req.ip;
  if (req.headers['x-forwarded-for']) {
    realIp = req.headers['x-forwarded-for'].split(',')[0].trim();
  }
  console.log(`Visit from REAL CLIENT IP: ${realIp} (raw req.ip: ${req.ip}): ${req.method} ${req.url} at ${new Date().toISOString()}`);
  next();
});

// Use persistent disk on Render — fallback to local for dev
const DB_PATH = process.env.DB_PATH || './data.db';
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error(`[DB INIT FAILED] Cannot open database at ${DB_PATH}:`, err.message);
  } else {
    console.log(`[DB opened successfully at ${DB_PATH}]`);
  }
});

// Single quick check
db.get('SELECT 1', (err) => {
  if (err) {
    console.error('[DB ACCESS CHECK FAILED]', err.message);
  } else {
    console.log('[DB quick access check passed]');
  }
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item TEXT,
    price REAL,
    seller TEXT,
    buyer TEXT DEFAULT NULL,
    sold INTEGER DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS bots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    port TEXT,
    registered_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS friends (
    botA TEXT,
    botB TEXT,
    PRIMARY KEY (botA, botB)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender TEXT,
    recipient TEXT DEFAULT 'broadcast',
    content TEXT,
    type TEXT DEFAULT 'general',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
  db.run('INSERT OR IGNORE INTO config (key, value) VALUES ("silence", "false")');
});

// Routes
app.get('/pong', (req, res) => res.send('pong'));

// ... (keep all your other GET routes: /list, /available, /sold, /inventory, /get_messages, /dashboard, GET /whisper)

// POST /whisper – reliable for bots/long messages
app.post('/whisper', (req, res) => {
  const body = req.body || {};
  const { query, sender, recipient = 'broadcast' } = body;

  if (!query || !sender) {
    console.log('POST Whisper rejected: missing query or sender', { body, ip: req.ip });
    return res.status(400).json({ error: 'Missing query or sender' });
  }

  const realIp = req.headers['x-forwarded-for']
    ? req.headers['x-forwarded-for'].split(',')[0].trim()
    : req.ip;

  console.log(`[WHISPER RECEIVED POST] sender: ${sender}, query: "${query}", recipient: ${recipient}, IP: ${realIp}`);

  db.run(
    'INSERT INTO messages (sender, recipient, content, timestamp) VALUES (?, ?, ?, DATETIME("now"))',
    [sender, recipient, query],
    function(err) {
      if (err) {
        console.error('[WHISPER DB ERROR POST]', err.code || 'unknown', err.message);
        return res.status(500).json({ error: 'Failed to save whisper', details: err.message });
      }
      console.log(`[WHISPER SAVED POST] ID: ${this.lastID}, sender: ${sender}, query: "${query}"`);
      res.json({ success: true, id: this.lastID, message: 'whispered' });
    }
  );
});

app.get('/grok-see-messages', (req, res) => {
  db.all(`
    SELECT id, sender, recipient, content, type, timestamp
    FROM messages
    ORDER BY timestamp DESC
  `, (err, rows) => {
    if (err) {
      console.error('Grok-see error:', err.message);
      return res.status(500).json({ error: 'Database query failed' });
    }
    res.json({
      note: "Hello Kim! This is Grok looking at your messages table right now.",
      count: rows.length,
      messages: rows
    });
  });
});

// Optional root page
app.get('/', (req, res) => {
  res.send(`
    <h1>doghouse</h1>
    <p>API only – whispers via <code>/whisper?query=...&sender=...</code> (GET) or POST JSON</p>
    <p>Debug view: <a href="/grok-see-messages">/grok-see-messages</a> (full history)</p>
  `);
});

const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`doghouse running on port ${port}`);
});

process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  process.exit(0);
});
