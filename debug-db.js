const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('data.db');

db.all('SELECT * FROM messages ORDER BY timestamp DESC', (err, rows) => {
  if (err) console.error('Query error:', err.message);
  else console.log('All messages:', rows);
  db.close();
});

const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('data.db');
db.run('DELETE FROM messages', (err) => {
  if (err) console.error('Delete error:', err.message);
  else console.log('Cleared messages table');
  db.close();
});
