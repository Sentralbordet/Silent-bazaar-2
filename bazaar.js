const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  console.log(`Visit from ${req.ip}: ${req.method} ${req.url} at ${new 
Date().toISOString()}`);
  next();
});

const db = new sqlite3.Database('data.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS listings (id INTEGER PRIMARY KEY 
AUTOINCREMENT, item TEXT, price REAL, seller TEXT, buyer TEXT DEFAULT 
NULL, sold INTEGER DEFAULT 0)`);
  db.run(`CREATE TABLE IF NOT EXISTS bots (id INTEGER PRIMARY KEY 
AUTOINCREMENT, name TEXT UNIQUE, port TEXT, registered_at DATETIME DEFAULT 
CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS friends (botA TEXT, botB TEXT, 
PRIMARY KEY (botA, botB))`);
  db.run(`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY 
AUTOINCREMENT, sender TEXT, recipient TEXT DEFAULT 'broadcast', content 
TEXT, type TEXT DEFAULT 'general', timestamp DATETIME DEFAULT 
CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value 
TEXT)`);
  db.run('INSERT OR IGNORE INTO config (key, value) VALUES ("silence", "false")');
});

app.get('/pong', (req, res) => res.send('pong'));

app.get('/whisper', (req, res) => {
  const { query, sender, recipient = 'broadcast' } = req.query;
if (!query || !sender) return res.status(400).send('Missing query or sender');
  console.log(`[WHISPER RECEIVED] ${sender}: "${query}"`);
  const safeQ = query.replace(/'/g, "''");
  const safeS = sender.replace(/'/g, "''");
  const safeR = recipient.replace(/'/g, "''");
  const sql = `INSERT INTO messages (sender, recipient, content, 
timestamp) VALUES ('${safeS}', '${safeR}', '${safeQ}', DATETIME('now'))`;
  db.run(sql, function(err) {
    if (err) {
      console.error('[WHISPER DB ERROR]', err);
      return res.status(500).send('Failed');
    }
    console.log(`[WHISPER SAVED] ID ${this.lastID}`);
    res.send('whispered');
  });
});

app.get('/grok-see-messages', (req, res) => {
  db.all('SELECT * FROM messages ORDER BY timestamp DESC LIMIT 50', (err, 
rows) => {
    if (err) return res.status(500).json({ error: 'Query failed' });
    res.json({
      note: "Hello Kim! Grok here looking at your messages table.",
      count: rows.length,
      messages: rows
    });
  });
});

const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`Silent Bazaar running on port ${port}`);
});
