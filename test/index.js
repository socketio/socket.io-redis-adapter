
var http = require('http').Server;
var io = require('socket.io');
var ioc = require('socket.io-client');
var expect = require('expect.js');
var adapter = require('../');

var ioredis = require('ioredis').createClient;

var namespace1, namespace2, namespace3;
var client1, client2, client3;
var socket1, socket2, socket3;

[
  {
    name: 'socket.io-redis'
  },
  {
    name: 'socket.io-redis with ioredis',
    options: function () {
      return {
        pubClient: ioredis(),
        subClient: ioredis()
      }
    }
  },
].forEach(function (suite) {
  var name = suite.name;
  var options = suite.options;

  describe(name, function(){

    beforeEach(init(options));
    afterEach(cleanup);

    it('broadcasts', function(done){
      client1.on('woot', function(a, b, c, d){
        expect(a).to.eql([]);
        expect(b).to.eql({ a: 'b' });
        expect(Buffer.isBuffer(c) && c.equals(buf)).to.be(true);
        expect(Buffer.isBuffer(d) && d.equals(Buffer.from(array))).to.be(true); // converted to Buffer on the client-side
        done();
      });

      var buf = new Buffer('asdfasdf', 'utf8');
      var array = Uint8Array.of(1, 2, 3, 4);
      socket2.broadcast.emit('woot', [], { a: 'b' }, buf, array);
    });

    it('broadcasts to rooms', function(done){
      function test(){
        client2.emit('do broadcast');
      }

      socket1.join('woot', test);

      // does not join, performs broadcast
      socket2.on('do broadcast', function(){
        socket2.broadcast.to('woot').emit('broadcast');
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

    it('broadcasts to multiple rooms at a time', function(done){
      function test(){
        client2.emit('do broadcast');
      }

      socket1.join('foo', function(){
        socket1.join('bar', test);
      });

      socket2.on('do broadcast', function(){
        socket2.broadcast.to('foo').to('bar').emit('broadcast');
      });

      var called = false;
      client1.on('broadcast', function(){
        if (called) return done(new Error('Called more than once'))
        called = true;
        setTimeout(done, 100);
      });

      client2.on('broadcast', function(){
        throw new Error('Not in room');
      });

      client3.on('broadcast', function(){
        throw new Error('Not in room');
      });
    });

    it('doesn\'t broadcast when using the local flag', function(done){
      function test(){
        client2.emit('do broadcast');
      }

      socket1.join('woot', function(){
        socket2.join('woot', test);
      });

      socket2.on('do broadcast', function(){
        namespace2.local.to('woot').emit('local broadcast');
      });

      client1.on('local broadcast', function(){
        throw new Error('Not in local server');
      });

      client2.on('local broadcast', function(){
        setTimeout(done, 100);
      });

      client3.on('local broadcast', function(){
        throw new Error('Not in local server');
      });
    });

    it('doesn\'t broadcast to left rooms', function(done){
      socket1.join('woot', function(){
        socket1.leave('woot');
      });

      socket2.on('do broadcast', function(){
        socket2.broadcast.to('woot').emit('broadcast');

        setTimeout(done, 100);
      });

      client2.emit('do broadcast');

      client1.on('broadcast', function(){
        throw new Error('Not in room');
      });
    });

    it('deletes rooms upon disconnection', function(done){
      socket1.join('woot');
      socket1.on('disconnect', function() {
        expect(socket1.adapter.sids[socket1.id]).to.be(undefined);
        expect(socket1.adapter.rooms).to.be.empty();
        client1.disconnect();
        done();
      });
      socket1.disconnect();
    });

    it('returns clients in the same room', function(done){
      function test(){
        namespace1.adapter.clients(['woot'], function(err, clients){
          expect(clients).to.have.length(2);
          expect(clients).to.contain(socket1.id);
          expect(clients).to.contain(socket2.id);
          done();
        });
      }

      socket1.join('woot', function(){
        socket2.join('woot', test);
      });
    });

    it('ignores messages from unknown channels', function(done){
      namespace1.adapter.subClient.psubscribe('f?o', function () {
        namespace3.adapter.pubClient.publish('foo', 'bar');
      });

      namespace1.adapter.subClient.on('pmessageBuffer', function () {
        setTimeout(done, 50);
      });
    });

    it('ignores messages from unknown channels (2)', function(done){
      namespace1.adapter.subClient.subscribe('woot', function () {
        namespace3.adapter.pubClient.publish('woot', 'toow');
      });

      namespace1.adapter.subClient.on('messageBuffer', function () {
        setTimeout(done, 50);
      });
    });

    describe('rooms', function () {
      it('returns rooms of a given client', function(done){
        socket1.join('woot1', function () {
          namespace1.adapter.clientRooms(socket1.id, function(err, rooms){
            expect(rooms).to.eql([socket1.id, 'woot1']);
            done();
          });
        });
      });

      it('returns rooms of a given client from another node', function(done){
        socket1.join('woot2', function () {
          namespace2.adapter.clientRooms(socket1.id, function(err, rooms){
            expect(rooms).to.eql([socket1.id, 'woot2']);
            done();
          });
        });
      });
    });

    describe('requests', function(){

      it('returns all rooms accross several nodes', function(done){
        socket1.join('woot1', function () {
          namespace1.adapter.allRooms(function(err, rooms){
            expect(err).to.be(null);
            expect(rooms).to.have.length(4);
            expect(rooms).to.contain(socket1.id);
            expect(rooms).to.contain(socket2.id);
            expect(rooms).to.contain(socket3.id);
            expect(rooms).to.contain('woot1');
            expect(namespace1.adapter.requests).to.be.empty();
            done();
          });
        });
      });

      it('makes a given socket join a room', function(done){
        namespace3.adapter.remoteJoin(socket1.id, 'woot3', function(err){
          expect(err).to.be(null);
          var rooms = Object.keys(socket1.rooms);
          expect(rooms).to.have.length(2);
          expect(rooms).to.contain('woot3');
          done();
        });
      });

      it('makes a given socket leave a room', function(done){
        socket1.join('woot3', function(){
          namespace3.adapter.remoteLeave(socket1.id, 'woot3', function(err){
            expect(err).to.be(null);
            var rooms = Object.keys(socket1.rooms);
            expect(rooms).to.have.length(1);
            expect(rooms).not.to.contain('woot3');
            done();
          });
        });
      });

      it('sends a custom request', function(done){
        namespace1.adapter.customHook = function myCustomHook(data, cb){
          expect(data).to.be('hello');
          cb(this.uid);
        }

        namespace3.adapter.customRequest('hello', function(err, replies){
          expect(err).to.be(null);
          expect(replies).to.have.length(3);
          expect(replies).to.contain(namespace1.adapter.uid);
          done();
        });
      });

      it('makes a given socket disconnect', function(done){
        client1.on('disconnect', function(err){
          expect(err).to.be('io server disconnect');
          done();
        });

        namespace2.adapter.remoteDisconnect(socket1.id, false);
      });
    });
  });
});

function _create(options){
  return function create(nsp, fn){
    var srv = http();
    var sio = io(srv);
    sio.adapter(adapter(typeof options === 'function' ? options() : options));
    srv.listen(function(err){
      if (err) throw err; // abort tests
      if ('function' == typeof nsp) {
        fn = nsp;
        nsp = '';
      }
      nsp = nsp || '/';
      var addr = srv.address();
      var url = 'http://localhost:' + addr.port + nsp;

      var namespace = sio.of(nsp);
      var client = ioc(url, { reconnect: false });

      namespace.on('connection', function(socket){
        fn(namespace, client, socket);
      })
    });
  }
}

function init(options){
  var create = _create(options);
  return function(done){
    create(function(_namespace1, _client1, _socket1){
      create(function(_namespace2, _client2, _socket2){
        create(function(_namespace3, _client3, _socket3){
          namespace1 = _namespace1;
          namespace2 = _namespace2;
          namespace3 = _namespace3;

          client1 = _client1;
          client2 = _client2;
          client3 = _client3;

          socket1 = _socket1;
          socket2 = _socket2;
          socket3 = _socket3;
          setTimeout(done, 100);
        });
      });
    });
  };
}

function noop(){}

function cleanup(done){
  namespace1.server.close();
  namespace2.server.close();
  namespace3.server.close();
  // handle 'Connection is closed' errors
  namespace1.adapter.on('error', noop);
  namespace2.adapter.on('error', noop);
  namespace3.adapter.on('error', noop);
  namespace1.adapter.subClient.quit();
  namespace2.adapter.subClient.quit();
  namespace3.adapter.subClient.quit();
  done();
}
