
var http = require('http').Server;
var io = require('socket.io');
var ioc = require('socket.io-client');
var expect = require('expect.js');
var redis = require('ioredis').createClient;
var adapter = require('../');

describe('socket.io-redis with ioredis', function(){

  it('broadcasts', function(done){
    create(function(server1, client1){
      create(function(server2, client2){
        client1.on('woot', function(a, b, c){
          expect(a).to.eql([]);
          expect(b).to.eql({ a: 'b' });
          expect(Buffer.isBuffer(c)).to.be(true);
          client1.disconnect();
          client2.disconnect();
          done();
        });
        server2.on('connection', function(c2){
          setTimeout(function(){
            var buf = new Buffer('asdfasdf', 'utf8');
            c2.broadcast.emit('woot', [], { a: 'b' }, buf);
          }, 100);
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
            client1.disconnect();
            client2.disconnect();
            client3.disconnect();
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

  it('doesn\'t broadcast to left rooms', function(done){
    create(function(server1, client1){
      create(function(server2, client2){
        create(function(server3, client3){
          server1.on('connection', function(c1){
            c1.join('woot');
            c1.leave('woot');
          });

          server2.on('connection', function(c2){
            c2.on('do broadcast', function(){
              c2.broadcast.to('woot').emit('broadcast');

              setTimeout(function() {
                client1.disconnect();
                client2.disconnect();
                client3.disconnect();
                done();
              }, 100);
            });
          });

          server3.on('connection', function(c3){
            client2.emit('do broadcast');
          });

          client1.on('broadcast', function(){
            throw new Error('Not in room');
          });
        });
      });
    });
  });

  it('deletes rooms upon disconnection', function(done){
    create(function(server, client){
      server.on('connection', function(c){
        c.join('woot');
        c.on('disconnect', function() {
          expect(c.adapter.sids[c.id]).to.be.empty();
          expect(c.adapter.rooms).to.be.empty();
          client.disconnect();
          done();
        });
        c.disconnect();
      });
    });
  });

  it('returns clients in the same room', function(done){
    create(function(server1, client1){
      create(function(server2, client2){
        create(function(server3, client3){
          var ready = 0;

          server1.on('connection', function(c1){
            c1.join('woot');
            ready++;
            if(ready === 3){
              test();
            }
          });

          server2.on('connection', function(c1){
            c1.join('woot');
            ready++;
            if(ready === 3){
              test();
            }
          });

          server3.on('connection', function(c3){
            ready++;
            if(ready === 3){
              test();
            }
          });

          function test(){
            setTimeout(function(){
              server1.adapter.clients(['woot'], function(err, clients){
                expect(clients.length).to.eql(2);
                client1.disconnect();
                client2.disconnect();
                client3.disconnect();
                done();
              });
            }, 100);
          }

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
      subClient: redis(null, null, { return_buffers: true }),
      subEvent: 'messageBuffer'
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
