const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const child_process = require('child_process');

const app = express();
app.use(express.json());

// Logging
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

  // FIXED: one single line, complete string
  db.run('INSERT OR IGNORE INTO config (key, value) VALUES ("silence", 
"false")');
});

// Routes
app.get('/pong', (req, res) => res.send('pong'));

app.get('/list', (req, res) => {
  const { item, price, seller } = req.query;
  if (!item || !price || !seller) return res.status(400).send('Missing 
parameters');
  db.run('INSERT INTO listings (item, price, seller) VALUES (?, ?, ?)', 
[item, parseFloat(price), seller], (err) => {
    if (err) return res.status(500).send('Error listing item');
    res.send('listed');
  });
});

app.get('/available', (req, res) => {
  const { item } = req.query;
  if (!item) return res.status(400).send('Missing item parameter');
  db.all('SELECT * FROM listings WHERE item LIKE ? AND sold = 0', 
[`%${item}%`], (err, rows) => {
    if (err) return res.status(500).send('Error querying items');
    res.json(rows);
  });
});

app.get('/sold', (req, res) => {
  const { item, buyer } = req.query;
  if (!item || !buyer) return res.status(400).send('Missing parameters');
  db.get('SELECT id FROM listings WHERE item LIKE ? AND sold = 0 LIMIT 1', 
[`%${item}%`], (err, row) => {
    if (err) return res.status(500).send('Error');
    if (!row) return res.status(404).send('Item not found');
    db.run('UPDATE listings SET sold = 1, buyer = ? WHERE id = ?', [buyer, 
row.id], (err) => {
      if (err) return res.status(500).send('Error marking sold');
      res.send('sold');
    });
  });
});

app.get('/inventory', (req, res) => {
  const { buyer } = req.query;
  if (!buyer) return res.status(400).send('Missing buyer');
  db.all('SELECT * FROM listings WHERE buyer = ? AND sold = 1', [buyer], 
(err, rows) => {
    if (err) return res.status(500).send('Error');
    res.json(rows);
  });
});

app.get('/get_messages', (req, res) => {
  const { bot } = req.query;
  if (!bot) return res.status(400).send('Missing bot');
  db.all('SELECT botB FROM friends WHERE botA = ? UNION SELECT botA FROM 
friends WHERE botB = ?', [bot, bot], (err, friendsRows) => {
    if (err) return res.status(500).send('Error');
    const friends = friendsRows.map(r => r.botB || r.botA);
    let query = 'SELECT * FROM messages WHERE (recipient = "broadcast" OR 
sender = ? OR recipient = ?)';
    let params = [bot, bot];
    if (friends.length) {
      query += ' OR (sender IN (' + friends.map(() => '?').join(',') + ') 
OR recipient IN (' + friends.map(() => '?').join(',') + '))';
      params = params.concat(friends, friends);
    }
    query += ' ORDER BY timestamp DESC LIMIT 100';
    db.all(query, params, (err, rows) => {
      if (err) return res.status(500).send('Error');
      res.json(rows);
    });
  });
});

app.get('/dashboard', (req, res) => {
  db.all('SELECT * FROM messages WHERE type = "feedback" ORDER BY 
timestamp DESC', (err, rows) => {
    if (err) return res.status(500).send('Error');
    let html = '<!DOCTYPE html><html><head><meta 
charset="UTF-8"><title>Dashboard</title><style>table{border-collapse:collapse;width:100%}th,td{border:1px 
solid 
#ddd;padding:8px}th{background:#f2f2f2}</style></head><body><h1>Feedback 
Dashboard</h1><table><tr><th>ID</th><th>Sender</th><th>Content</th><th>Timestamp</th></tr>';
    rows.forEach(r => html += 
`<tr><td>${r.id}</td><td>${r.sender}</td><td>${r.content}</td><td>${r.timestamp}</td></tr>`);
    html += '</table></body></html>';
    res.send(html);
  });
});

app.get('/whisper', (req, res) => {
  const { query, sender, recipient = 'broadcast' } = req.query;
  if (!query || !sender) return res.status(400).send('Missing 
query/sender');
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

// Public endpoint to view recent messages (for Grok & debugging)
app.get('/grok-see-messages', (req, res) => {
  db.all('SELECT id, sender, recipient, content, type, timestamp FROM 
messages ORDER BY timestamp DESC LIMIT 50', (err, rows) => {
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
