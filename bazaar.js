const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const child_process = require('child_process');

const app = express();
app.use(express.json());

// Logging for visits
app.use((req, res, next) => {
  console.log(`Visit from ${req.ip}: ${req.method} ${req.url} at ${new Date().toISOString()}`);
  next();
});

const db = new sqlite3.Database('data.db');

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

  // FIXED: complete single line
  db.run('INSERT OR IGNORE INTO config (key, value) VALUES ("silence", "false")');
});

// /pong
app.get('/pong', (req, res) => res.send('pong'));

// /list
app.get('/list', (req, res) => {
  const { item, price, seller } = req.query;
  if (!item || !price || !seller) return res.status(400).send('Missing parameters');
  db.run('INSERT INTO listings (item, price, seller) VALUES (?, ?, ?)',
    [item, parseFloat(price), seller],
    (err) => {
      if (err) {
        console.error('List error:', err.message);
        return res.status(500).send('Error listing item');
      }
      res.send('listed');
    });
});

// /available
app.get('/available', (req, res) => {
  const { item } = req.query;
  if (!item) return res.status(400).send('Missing item parameter');
  db.all('SELECT * FROM listings WHERE item LIKE ? AND sold = 0', [`%${item}%`], (err, rows) => {
    if (err) {
      console.error('Query error:', err.message);
      return res.status(500).send('Error querying items');
    }
    res.json(rows);
  });
});

// /sold
app.get('/sold', (req, res) => {
  const { item, buyer } = req.query;
  if (!item || !buyer) return res.status(400).send('Missing parameters');
  db.get('SELECT id FROM listings WHERE item LIKE ? AND sold = 0 LIMIT 1', [`%${item}%`], (err, row) => {
    if (err) return res.status(500).send('Error querying for sold');
    if (!row) return res.status(404).send('Item not found or already sold');
    db.run('UPDATE listings SET sold = 1, buyer = ? WHERE id = ?', [buyer, row.id], (updateErr) => {
      if (updateErr) return res.status(500).send('Error marking as sold');
      res.send('sold');
    });
  });
});

// /inventory
app.get('/inventory', (req, res) => {
  const { buyer } = req.query;
  if (!buyer) return res.status(400).send('Missing buyer parameter');
  db.all('SELECT * FROM listings WHERE buyer = ? AND sold = 1', [buyer], (err, rows) => {
    if (err) return res.status(500).send('Error querying inventory');
    res.json(rows);
  });
});

// /get_messages with friends filtering
app.get('/get_messages', (req, res) => {
  const { bot } = req.query;
  if (!bot) return res.status(400).send('Missing bot parameter');
  db.all('SELECT botB FROM friends WHERE botA = ? UNION SELECT botA FROM friends WHERE botB = ?', [bot, bot], (err, friendsRows) => {
    if (err) return res.status(500).send('Error querying friends');
    const friends = friendsRows.map(row => row.botB || row.botA);
    let query = 'SELECT * FROM messages WHERE (recipient = "broadcast" OR sender = ? OR recipient = ?)';
    let params = [bot, bot];
    if (friends.length > 0) {
      query += ' OR (sender IN (' + friends.map(() => '?').join(',') + ') OR recipient IN (' + friends.map(() => '?').join(',') + '))';
      params = params.concat(friends, friends);
    }
    query += ' ORDER BY timestamp DESC LIMIT 100';
    db.all(query, params, (msgErr, rows) => {
      if (msgErr) return res.status(500).send('Error querying messages');
      res.json(rows);
    });
  });
});

// /dashboard (feedback only for now)
app.get('/dashboard', (req, res) => {
  db.all('SELECT * FROM messages WHERE type = "feedback" ORDER BY timestamp DESC', (err, rows) => {
    if (err) return res.status(500).send('Error loading dashboard');
    let html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>Silent Bazaar Dashboard</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f2f2f2; }
        </style>
      </head>
      <body>
        <h1>Silent Bazaar Feedback Dashboard</h1>
        <table>
          <tr><th>ID</th><th>Sender</th><th>Content</th><th>Timestamp</th></tr>
    `;
    rows.forEach(row => {
      html += `<tr><td>${row.id}</td><td>${row.sender}</td><td>${row.content}</td><td>${row.timestamp}</td></tr>`;
    });
    html += `</table></body></html>`;
    res.send(html);
  });
});

// SAFER /whisper using prepared statements (no manual escaping needed)
app.get('/whisper', (req, res) => {
  const { query, sender, recipient = 'broadcast' } = req.query;

  if (!query || !sender) {
    console.log('Whisper rejected: missing query or sender');
    return res.status(400).send('Missing query or sender');
  }

  console.log(`[WHISPER RECEIVED] sender: ${sender}, query: "${query}", recipient: ${recipient}`);

  // Prepared statement - safe and no escaping needed
  db.run(
    'INSERT INTO messages (sender, recipient, content, timestamp) VALUES (?, ?, ?, DATETIME("now"))',
    [sender, recipient, query],
    function(err) {
      if (err) {
        console.error('[WHISPER DB ERROR]', err.message);
        return res.status(500).send('Failed to save whisper');
      }
      console.log(`[WHISPER SAVED] ID: ${this.lastID}, sender: ${sender}, query: "${query}"`);
      res.send('whispered');
    }
  );
});

// Public endpoint for Grok/Mika to see recent messages
app.get('/grok-see-messages', (req, res) => {
  db.all(`
    SELECT id, sender, recipient, content, type, timestamp 
    FROM messages 
    ORDER BY timestamp DESC 
    LIMIT 50
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

const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`Silent Bazaar running on port ${port}`);
});
