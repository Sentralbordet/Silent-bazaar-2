const http = require('http');
const server = http.createServer((req, res) => {
  res.end('heartbeat');
});
server.listen(5000);
