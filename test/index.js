
var http = require('http').Server;
var io = require('socket.io');
var ioc = require('socket.io-client');
var expect = require('expect.js');
var redis = require('redis').createClient;
var adapter = require('../');

describe('socket.io-redis', function(){

  it('broadcasts', function(done){
    create(function(server1, client1){
      create(function(server2, client2){
        client1.on('woot', function(a, b){
          expect(a).to.eql([]);
          expect(b).to.eql({ a: 'b' });
          done();
        });
        server2.on('connection', function(c2){
          c2.broadcast.emit('woot', [], { a: 'b' });
        });
      });
    });
  });

  it('broadcasts to rooms', function(done){
    create(function(server1, client1){
      create(function(server2, client2){
        create(function(server3, client3){
          server1.on('connection', function(c1){
            c1.join('woot');
          });

          server2.on('connection', function(c2){
            // does not join, performs broadcast
            c2.on('do broadcast', function(){
              c2.broadcast.to('woot').emit('broadcast');
            });
          });

          server3.on('connection', function(c3){
            // does not join, signals broadcast
            client2.emit('do broadcast');
          });

          client1.on('broadcast', function(){
            setTimeout(done, 100);
          });

          client2.on('broadcast', function(){
            throw new Error('Not in room');
          });

          client3.on('broadcast', function(){
            throw new Error('Not in room');
          });
        });
      });
    });
  });

  // create a pair of socket.io server+client
  function create(nsp, fn){
    var srv = http();
    var sio = io(srv);
    sio.adapter(adapter({
      pubClient: redis(),
      subClient: redis(null, null, { detect_buffers: true })
    }));
    srv.listen(function(err){
      if (err) throw err; // abort tests
      if ('function' == typeof nsp) {
        fn = nsp;
        nsp = '';
      }
      nsp = nsp || '/';
      var addr = srv.address();
      var url = 'http://localhost:' + addr.port + nsp;
      fn(sio.of(nsp), ioc(url));
    });
  }

});
