const http = require('http');

http.get('http://localhost:5000/list?item=old-laptop&price=20&seller=kim',  
  (res) => {
    res.on('data', chunk => console.log(chunk.toString()));
  });
