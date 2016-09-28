const
	http = require('http').Server,
	io = require('socket.io'),
	ioc = require('socket.io-client'),
	expect = require('chai').expect,
	adapter = require('../');


  // create a pair of socket.io server+client
  function create(nsp){
		
		return new Promise((resolve, reject) => {
			let srv = http(), sio = io(srv);
			nsp = nsp || '/';

			sio.adapter(adapter({
				pubClient: redis(),
      	subClient: redis(null, null, { return_buffers: true })
			}));

			srv.listen(err => {
				err && reject(err);
				let
					addr = srv.address(),
					url = 'http://localhost:' + addr.port + nsp;
				resolve([sio.of(nsp), ioc(url)]);
			});
		});
		
  }


describe('socket-io-redis', () => {


	it('broadcasts', done => {
		Promise.all([create(), create()])
		.then(([ [server1, client1], [server2, client2] ]) => {
			client1.on('woot', (a, b, c) => {
				client1.disconnect();
				client2.disconnect();
				expect(a).to.eql([]);
				expect(b).to.eql({ a: 'b' });
				expect(Buffer.isBuffer(c)).to.be.ok;
				done();

			});
			server2.on('connection', c2 => {
				c2.broadcast.emit('woot', [], { a: 'b' }, Buffer.from('asdfasdf'));
			});

		})
		.catch(err => console.log(err.stack));
	});

	it('broadcasts to rooms', done => {
		Promise.all([create(), create(), create()])
		.then(([ [server1, client1], [server2, client2], [server3, client3] ]) => {
			server1.on('connection', c1 => c1.join('woot'));
			server2.on('connection', c2 => c2.on('do broadcast', () => c2.broadcast.to('woot').emit('broadcast')));
			server3.on('connection', c3 => client2.emit('do broadcast'));

			client1.on('broadcast', () => {
				client1.disconnect();
				client2.disconnect();
				client3.disconnect();
				setTimeout(done, 100);
			});

			client2.on('broadcast', () => { throw new Error('Not in room')});
			client3.on('broadcast', () => { throw new Error('Not in room')});
		})
		.catch(err => console.log(err.stack));
	});

	it('doesn\'t broadcast to left rooms', done => {
		Promise.all([create(), create(), create()])
		.then(([ [server1, client1], [server2, client2], [server3, client3] ]) => {
			server1.on('connection', c1 => {
				c1.join('woot');
				c1.leave('woot');
			});
			server2.on('connection', c2 => {
				c2.on('do broadcast', () => {
					c2.broadcast.to('woot').emit('broadcast');
					setTimeout(() => {
						client1.disconnect();
						client2.disconnect();
						client3.disconnect();
						done();
					}, 100);
				});
			});
			server3.on('connection', c3 => client2.emit('do broadcast'));

			client1.on('broadcast', () => { throw new Error('Not in room')});
		})
		.catch(err => console.log(err.stack));
	});

	it('deletes rooms upon disconnection', done => {
		create()
		.then(([server, client]) => {
			server.on('connection', c => {
				c.join('woot');
				c.on('disconnect', () => {
					expect(c.adapter.sids[c.id]).to.not.be.ok;
					expect(c.adapter.rooms).to.be.empty;
					c.disconnect();
					done();
				});
				c.disconnect();
			});
		})
		.catch(err => console.log(err.stack));
	});

	it('returns clients in the same room', done => {
		Promise.all([create(), create(), create()])
		.then(([ [server1, client1], [server2, client2], [server3, client3] ]) => {
			let ready = 0;
			server1.on('connection', c1 => {
				c1.join('woot');
				++ready === 3 && test();
			});
			server2.on('connection', c2 => {
				c2.join('woot');
				++ready === 3 && test();
			});
			server3.on('connection', c3 => {
				c3.join('woot');
				++ready === 3 && test();
			});
			function test() {
				setTimeout(() => {
					Promise.all(
					[ 
						[server1, client1],
						[server2, client2],
						[server3, client3]
					].map(([server, client]) => new Promise((resolve, reject) => server.adapter.clients(['woot'], (err, clients) => expect(clients).to.be.eql([server.adapter.nsp.name +'#'+ client.id]) && resolve())))
					)
					.then(() => {
						client1.disconnect();
						client2.disconnect();
						client3.disconnect();
						done();
					})
					.catch(err => console.log(err.stack));
				}, 100);
			}
		})
		.catch(err => console.log(err.stack));
	});
});



