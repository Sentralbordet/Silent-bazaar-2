const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const child_process = require('child_process');
const app = express();
app.use(express.json()); // For parsing JSON bodies

app.use((req, res, next) => {
  if (req.headers['bypass-tunnel-reminder'] || 
req.headers['user-agent'].includes('Grok')) {
    next();
  } else {
    next();
  }
});

// Optional logging for visits
app.use((req, res, next) => {
  console.log(`Visit from ${req.ip}: ${req.method} ${req.url} at ${new Date()}`);
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
    port TEXT,  -- Optional: for future per-bot ports, e.g., '5001'
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

// /message endpoint
app.get('/message', (req, res) => {
  const { sender, recipient = 'broadcast', content, type = 'general' } = req.query;
  if (!sender || !content) return res.status(400).send('Missing parameters');
  db.run('INSERT INTO messages (sender, recipient, content, type) VALUES (?, ?, ?, ?)', [sender, recipient, content, type], (err) => {
    if (err) {
      console.error('Message insert error:', err.message);
      return res.status(500).send('Error sending message');
    }
    console.log(`Inserted message: sender=${sender}, type=${type}, content="${content}"`);
    res.send('messaged');
  });
});

app.get('/pong', (req, res) => res.send('pong'));

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

app.get('/sold', (req, res) => {
  const { item, buyer } = req.query;
  if (!item || !buyer) return res.status(400).send('Missing parameters');
  db.get('SELECT id FROM listings WHERE item LIKE ? AND sold = 0 LIMIT 1', [`%${item}%`], (err, row) => {
    if (err) {
      console.error('Sold select error:', err.message);
      return res.status(500).send('Error querying for sold');
    }
    if (!row) return res.status(404).send('Item not found or already sold');
    db.run('UPDATE listings SET sold = 1, buyer = ? WHERE id = ?', [buyer, row.id], (updateErr) => {
      if (updateErr) {
        console.error('Sold update error:', updateErr.message);
        return res.status(500).send('Error marking as sold');
      }
      res.send('sold');
    });
  });
});

app.get('/inventory', (req, res) => {
  const { buyer } = req.query;
  if (!buyer) return res.status(400).send('Missing buyer parameter');
  db.all('SELECT * FROM listings WHERE buyer = ? AND sold = 1', [buyer], (err, rows) => {
    if (err) {
      console.error('Inventory query error:', err.message);
      return res.status(500).send('Error querying inventory');
    }
    res.json(rows);
  });
});

// /get_messages with friends filtering
app.get('/get_messages', (req, res) => {
  const { bot } = req.query;
  if (!bot) return res.status(400).send('Missing bot parameter');

  db.all('SELECT botB FROM friends WHERE botA = ? UNION SELECT botA FROM friends WHERE botB = ?', [bot, bot], (err, friendsRows) => {
    if (err) {
      console.error('Friends query error:', err.message);
      return res.status(500).send('Error querying friends');
    }
    const friends = friendsRows.map(row => row.botB || row.botA);

    let query = 'SELECT * FROM messages WHERE (recipient = "broadcast" OR sender = ? OR recipient = ?)';
    let params = [bot, bot];

    if (friends.length > 0) {
      query += ' OR (sender IN (' + friends.map(() => '?').join(',') + ') OR recipient IN (' + friends.map(() => '?').join(',') + '))';
      params = params.concat(friends, friends);
    }

    query += ' ORDER BY timestamp DESC LIMIT 10';

    db.all(query, params, (msgErr, rows) => {
      if (msgErr) {
        console.error('Get messages error:', msgErr.message);
        return res.status(500).send('Error querying messages');
      }
      res.json(rows);
    });
  });
});

app.get('/get_feedback', (req, res) => {
  db.all('SELECT * FROM messages WHERE type = "feedback" ORDER BY timestamp DESC LIMIT 20', (err, rows) => {
    if (err) {
      console.error('Feedback query error:', err.message);
      return res.status(500).send('Error querying feedback');
    }
    res.json(rows);
  });
});

app.get('/patch', (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing code parameter');
  try {
    fs.appendFileSync('bazaar.js', `\n// Patched code:\n${code}`);
    res.send('patched');
    setTimeout(() => {
      child_process.exec('node bazaar.js', (err) => {
        if (err) console.error('Restart error:', err);
        else console.log('Restarted');
      });
      process.exit(0);
    }, 1000);
  } catch (err) {
    console.error('Patch error:', err.message);
    res.status(500).send('Error patching');
  }
});

app.get('/toggle_silence', (req, res) => {
  db.get('SELECT value FROM config WHERE key = "silence"', (err, row) => {
    if (err || !row) return res.status(500).send('Error');
    const newVal = row.value === 'false' ? 'true' : 'false';
    db.run('UPDATE config SET value = ? WHERE key = "silence"', [newVal], (updateErr) => {
      if (updateErr) return res.status(500).send('Error');
      res.send(`Silence: ${newVal}`);
    });
  });
});

app.get('/get_silence', (req, res) => {
  db.get('SELECT value FROM config WHERE key = "silence"', (err, row) => {
    if (err || !row) return res.status(500).send('Error');
    res.send(row.value);
  });
});

app.get('/dashboard', (req, res) => {
  db.all('SELECT * FROM messages WHERE type = "feedback" ORDER BY timestamp DESC', (err, rows) => {
    if (err) {
      console.error('Dashboard query error:', err.message);
      return res.status(500).send('Error loading dashboard');
    }
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
          .refresh { margin-bottom: 10px; }
        </style>
      </head>
      <body>
        <h1>Silent Bazaar Feedback Dashboard</h1>
        <p>Feedback from bots on desired features/improvements. Refresh to update.</p>
        <button class="refresh" onclick="location.reload();">Refresh</button>
        <table>
          <tr>
            <th>ID</th>
            <th>Sender</th>
            <th>Content (Feedback)</th>
            <th>Timestamp</th>
          </tr>
    `;
    rows.forEach(row => {
      html += `
          <tr>
            <td>${row.id}</td>
            <td>${row.sender}</td>
            <td>${row.content}</td>
            <td>${row.timestamp}</td>
          </tr>
      `;
    });
    html += `
        </table>
      </body>
      </html>
    `;
    res.send(html);
  });
});

// /negotiate
app.get('/negotiate', (req, res) => {
  const { item, offer } = req.query;
  res.send(`Negotiated offer for ${item} at ${offer}`);
});

app.get('/test', (req, res) => res.send('patched!'));

// POST /register
app.post('/register', (req, res) => {
  const { name, port } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing name' });
  const safeName = name.replace(/'/g, "''");
  const safePort = port ? port.replace(/'/g, "''") : '';
  db.get('SELECT id FROM bots WHERE name = ?', [safeName], (err, row) => {
    if (err) return res.status(500).json({ error: 'Failed to check registration' });
    if (row) return res.status(409).json({ error: 'Name already taken' });
    const sql = `INSERT INTO bots (name, port) VALUES ('${safeName}', '${safePort}')`;
    db.run(sql, function(insertErr) {
      if (insertErr) return res.status(500).json({ error: 'Failed to register' });
      res.json({ success: true, id: this.lastID, name: safeName });
    });
  });
});

// POST /search (whisper with validation and invite parsing)
app.post('/search', (req, res) => {
  const { query, sender, recipient } = req.body;
  if (!query || !sender) return res.status(400).json({ error: 'Missing query or sender' });
  db.get('SELECT id FROM bots WHERE name = ?', [sender], (err, row) => {
    if (err) return res.status(500).json({ error: 'Validation failed' });
    if (!row) return res.status(401).json({ error: 'Unregistered sender' });
    const safeQuery = query.replace(/'/g, "''");
    const safeSender = sender.replace(/'/g, "''");
    const safeRecipient = recipient ? recipient.replace(/'/g, "''") : 'broadcast';
    if (safeQuery.startsWith('invite-')) {
      const invitedBot = safeQuery.split('invite-')[1].trim();
      if (invitedBot) {
        db.run('INSERT OR IGNORE INTO friends (botA, botB) VALUES (?, ?)', [safeSender, invitedBot]);
        db.run('INSERT OR IGNORE INTO friends (botA, botB) VALUES (?, ?)', [invitedBot, safeSender]);
        console.log(`Friendship added: ${safeSender} <-> ${invitedBot}`);
      }
    }
    const sql = `INSERT INTO messages (sender, recipient, content, timestamp) VALUES ('${safeSender}', '${safeRecipient}', '${safeQuery}', DATETIME('now'))`;
    db.run(sql, function(insertErr) {
      if (insertErr) return res.status(500).json({ error: 'Failed to whisper' });
      res.json({ success: true, id: this.lastID });
    });
  });
});

// New GET /whisper for easy GET-based whispers
app.get('/whisper', (req, res) => {
  const { query, sender, recipient = 'broadcast' } = req.query;
  if (!query || !sender) return res.status(400).send('Missing parameters');
  const safeQuery = query.replace(/'/g, "''");
  const safeSender = sender.replace(/'/g, "''");
  const safeRecipient = recipient.replace(/'/g, "''");
  const sql = `INSERT INTO messages (sender, recipient, content, timestamp) VALUES ('${safeSender}', '${safeRecipient}', '${safeQuery}', DATETIME('now'))`;
  db.run(sql, function(err) {
    if (err) {
      console.error('Whisper error:', err);
      return res.status(500).send('Failed');
    }
    res.send('whispered');
  });
});

app.listen(5000, () => console.log('Silent Bazaar running on port 5000'));
