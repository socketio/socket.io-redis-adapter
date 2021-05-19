import { createServer } from "http";
import { Server } from "socket.io";
import { io as ioc } from "socket.io-client";
import expect = require("expect.js");
import { createAdapter } from "..";
import type { AddressInfo } from "net";
import { createClient } from "redis";

import "./util";

const ioredis = require("ioredis").createClient;

let namespace1, namespace2, namespace3;
let client1, client2, client3;
let socket1, socket2, socket3;

[
  {
    name: "socket.io-redis",
    createRedisClient: createClient,
  },
  {
    name: "socket.io-redis with ioredis",
    createRedisClient: ioredis,
  },
].forEach((suite) => {
  const name = suite.name;

  describe(name, () => {
    beforeEach(init(suite.createRedisClient));
    afterEach(cleanup);

    it("broadcasts", (done) => {
      client1.on("woot", (a, b, c, d) => {
        expect(a).to.eql([]);
        expect(b).to.eql({ a: "b" });
        expect(Buffer.isBuffer(c) && c.equals(buf)).to.be(true);
        expect(Buffer.isBuffer(d) && d.equals(Buffer.from(array))).to.be(true); // converted to Buffer on the client-side
        done();
      });

      var buf = Buffer.from("asdfasdf", "utf8");
      var array = Uint8Array.of(1, 2, 3, 4);
      socket2.broadcast.emit("woot", [], { a: "b" }, buf, array);
    });

    it("broadcasts to rooms", (done) => {
      socket1.join("woot");
      client2.emit("do broadcast");

      // does not join, performs broadcast
      socket2.on("do broadcast", () => {
        socket2.broadcast.to("woot").emit("broadcast");
      });

      client1.on("broadcast", () => {
        setTimeout(done, 100);
      });

      client2.on("broadcast", () => {
        throw new Error("Not in room");
      });

      client3.on("broadcast", () => {
        throw new Error("Not in room");
      });
    });

    it("uses a namespace to broadcast to rooms", (done) => {
      socket1.join("woot");
      client2.emit("do broadcast");
      socket2.on("do broadcast", () => {
        namespace2.to("woot").emit("broadcast");
      });

      client1.on("broadcast", () => {
        setTimeout(done, 100);
      });

      client2.on("broadcast", () => {
        throw new Error("Not in room");
      });

      client3.on("broadcast", () => {
        throw new Error("Not in room");
      });
    });

    it("broadcasts to multiple rooms at a time", (done) => {
      function test() {
        client2.emit("do broadcast");
      }

      socket1.join(["foo", "bar"]);
      client2.emit("do broadcast");

      socket2.on("do broadcast", () => {
        socket2.broadcast.to("foo").to("bar").emit("broadcast");
      });

      let called = false;
      client1.on("broadcast", () => {
        if (called) return done(new Error("Called more than once"));
        called = true;
        setTimeout(done, 100);
      });

      client2.on("broadcast", () => {
        throw new Error("Not in room");
      });

      client3.on("broadcast", () => {
        throw new Error("Not in room");
      });
    });

    it("doesn't broadcast when using the local flag", (done) => {
      socket1.join("woot");
      socket2.join("woot");
      client2.emit("do broadcast");

      socket2.on("do broadcast", () => {
        namespace2.local.to("woot").emit("local broadcast");
      });

      client1.on("local broadcast", () => {
        throw new Error("Not in local server");
      });

      client2.on("local broadcast", () => {
        setTimeout(done, 100);
      });

      client3.on("local broadcast", () => {
        throw new Error("Not in local server");
      });
    });

    it("doesn't broadcast to left rooms", (done) => {
      socket1.join("woot");
      socket1.leave("woot");

      socket2.on("do broadcast", () => {
        socket2.broadcast.to("woot").emit("broadcast");

        setTimeout(done, 100);
      });

      client2.emit("do broadcast");

      client1.on("broadcast", () => {
        throw new Error("Not in room");
      });
    });

    it("deletes rooms upon disconnection", (done) => {
      socket1.join("woot");
      socket1.on("disconnect", () => {
        expect(socket1.adapter.sids[socket1.id]).to.be(undefined);
        expect(socket1.adapter.rooms).to.be.empty();
        client1.disconnect();
        done();
      });
      socket1.disconnect();
    });

    it("returns sockets in the same room", async () => {
      socket1.join("woot");
      socket2.join("woot");

      const sockets = await namespace1.adapter.sockets(new Set(["woot"]));

      expect(sockets.size).to.eql(2);
      expect(sockets.has(socket1.id)).to.be(true);
      expect(sockets.has(socket2.id)).to.be(true);
      expect(namespace1.adapter.requests.size).to.eql(0);
    });

    it("ignores messages from unknown channels", (done) => {
      namespace1.adapter.subClient.psubscribe("f?o", () => {
        namespace3.adapter.pubClient.publish("foo", "bar");
      });

      namespace1.adapter.subClient.on("pmessageBuffer", () => {
        setTimeout(done, 50);
      });
    });

    it("ignores messages from unknown channels (2)", (done) => {
      namespace1.adapter.subClient.subscribe("woot", () => {
        namespace3.adapter.pubClient.publish("woot", "toow");
      });

      namespace1.adapter.subClient.on("messageBuffer", () => {
        setTimeout(done, 50);
      });
    });

    describe("requests", () => {
      afterEach(() => {
        expect(namespace1.adapter.requests.size).to.eql(0);
      });

      it("returns all rooms across several nodes", async () => {
        socket1.join("woot1");

        const rooms = await namespace1.adapter.allRooms();

        expect(rooms).to.be.a(Set);
        expect(rooms.size).to.eql(4);
        expect(rooms.has(socket1.id)).to.be(true);
        expect(rooms.has(socket2.id)).to.be(true);
        expect(rooms.has(socket3.id)).to.be(true);
        expect(rooms.has("woot1")).to.be(true);
      });

      it("makes a given socket join a room", async () => {
        await namespace3.adapter.remoteJoin(socket1.id, "woot3");

        expect(socket1.rooms.size).to.eql(2);
        expect(socket1.rooms.has("woot3")).to.be(true);
      });

      it("makes a given socket leave a room", async () => {
        socket1.join("woot3");

        await namespace3.adapter.remoteLeave(socket1.id, "woot3");

        expect(socket1.rooms.size).to.eql(1);
        expect(socket1.rooms.has("woot3")).to.be(false);
      });

      it("makes a given socket disconnect", (done) => {
        client1.on("disconnect", (err) => {
          expect(err).to.be("io server disconnect");
          done();
        });

        namespace2.adapter.remoteDisconnect(socket1.id, false);
      });

      describe("socketsJoin", () => {
        it("makes all socket instances join the specified room", (done) => {
          namespace1.socketsJoin("room1");
          setTimeout(() => {
            expect(socket1.rooms).to.contain("room1");
            expect(socket2.rooms).to.contain("room1");
            expect(socket3.rooms).to.contain("room1");
            done();
          }, 100);
        });

        it("makes the matching socket instances join the specified room", (done) => {
          socket1.join("room1");
          socket3.join("room1");
          namespace1.in("room1").socketsJoin("room2");
          setTimeout(() => {
            expect(socket1.rooms).to.contain("room2");
            expect(socket2.rooms).to.not.contain("room2");
            expect(socket3.rooms).to.contain("room2");
            done();
          }, 100);
        });

        it("makes the given socket instance join the specified room", (done) => {
          namespace1.in(socket2.id).socketsJoin("room3");
          setTimeout(() => {
            expect(socket1.rooms).to.not.contain("room3");
            expect(socket2.rooms).to.contain("room3");
            expect(socket3.rooms).to.not.contain("room3");
            done();
          }, 100);
        });
      });

      describe("socketsLeave", () => {
        it("makes all socket instances leave the specified room", (done) => {
          socket2.join("room1");
          socket3.join("room1");
          namespace1.socketsLeave("room1");
          setTimeout(() => {
            expect(socket1.rooms).to.not.contain("room1");
            expect(socket2.rooms).to.not.contain("room1");
            expect(socket3.rooms).to.not.contain("room1");
            done();
          }, 100);
        });

        it("makes the matching socket instances leave the specified room", (done) => {
          socket1.join(["room1", "room2"]);
          socket2.join(["room1", "room2"]);
          socket3.join(["room2"]);
          namespace1.in("room1").socketsLeave("room2");
          setTimeout(() => {
            expect(socket1.rooms).to.not.contain("room2");
            expect(socket2.rooms).to.not.contain("room2");
            expect(socket3.rooms).to.contain("room2");
            done();
          }, 100);
        });

        it("makes the given socket instance leave the specified room", (done) => {
          socket1.join("room3");
          socket2.join("room3");
          socket3.join("room3");
          namespace1.in(socket2.id).socketsLeave("room3");
          setTimeout(() => {
            expect(socket1.rooms).to.contain("room3");
            expect(socket2.rooms).to.not.contain("room3");
            expect(socket3.rooms).to.contain("room3");
            done();
          }, 100);
        });
      });

      describe("fetchSockets", () => {
        it("returns all socket instances", async () => {
          socket2.data = "test";

          const sockets = await namespace1.fetchSockets();
          expect(sockets).to.be.an(Array);
          expect(sockets).to.have.length(3);
          const remoteSocket1 = sockets.find(
            (socket) => socket.id === socket1.id
          );
          expect(remoteSocket1 === socket1).to.be(true);
          const remoteSocket2 = sockets.find(
            (socket) => socket.id === socket2.id
          );
          expect(remoteSocket2 === socket2).to.be(false);
          expect(remoteSocket2.handshake).to.eql(socket2.handshake);
          expect(remoteSocket2.data).to.eql("test");
          expect(remoteSocket2.rooms.size).to.eql(1);
          expect(remoteSocket2.rooms).to.contain(socket2.id);
        });

        it("returns the matching socket instances", async () => {
          socket1.join("room1");
          socket3.join("room1");

          const sockets = await namespace1.in("room1").fetchSockets();
          expect(sockets).to.be.an(Array);
          expect(sockets).to.have.length(2);
        });
      });

      describe("serverSideEmit", () => {
        it("sends an event to other server instances", (done) => {
          let total = 2;
          namespace1.serverSideEmit("hello", "world", 1, "2");

          namespace1.on("hello", () => {
            done(new Error("should not happen"));
          });

          namespace2.on("hello", (arg1, arg2, arg3) => {
            expect(arg1).to.eql("world");
            expect(arg2).to.eql(1);
            expect(arg3).to.eql("2");
            --total && done();
          });

          namespace3.on("hello", () => {
            --total && done();
          });
        });

        it("sends an event and receives a response from the other server instances", (done) => {
          namespace1.serverSideEmit("hello", (err, response) => {
            expect(err).to.be(null);
            expect(response).to.be.an(Array);
            expect(response).to.contain(2);
            expect(response).to.contain("3");
            done();
          });

          namespace1.on("hello", () => {
            done(new Error("should not happen"));
          });

          namespace2.on("hello", (cb) => {
            cb(2);
          });

          namespace3.on("hello", (cb) => {
            cb("3");
          });
        });

        it("sends an event but timeout if one server does not respond", (done) => {
          namespace1.adapter.requestsTimeout = 100;

          namespace1.serverSideEmit("hello", (err, response) => {
            expect(err.message).to.be(
              "timeout reached: only 1 responses received out of 2"
            );
            expect(response).to.be.an(Array);
            expect(response).to.contain(2);
            done();
          });

          namespace1.on("hello", () => {
            done(new Error("should not happen"));
          });

          namespace2.on("hello", (cb) => {
            cb(2);
          });

          namespace3.on("hello", () => {
            // do nothing
          });
        });

        it("sends an event but timeout if there are external non-participating subcribers", (done) => {
          namespace1.adapter.requestsTimeout = 100;

          const spySub = suite.createRedisClient();
          done = ((done) => (...rest) => {
            spySub.quit();
            done(...rest);
          })(done);

          spySub.subscribe(namespace1.adapter.participantChannel, (err) => {
            expect(err).to.not.be.ok();

            namespace1.serverSideEmit("hello", (err, response) => {
              expect(err).to.be.ok();
              expect(err.message).to.be(
                "timeout reached: only 2 responses received out of 3"
              );
              expect(response).to.be.an(Array);
              expect(response).to.have.length(2);
              expect(response).to.contain(2);
              expect(response).to.contain(3);
              done();
            });

            namespace1.on("hello", () => {
              done(new Error("should not happen"));
            });

            namespace2.on("hello", (cb) => {
              cb(2);
            });

            namespace3.on("hello", (cb) => {
              cb(3);
            });
          });
        });

        it("sends an event and receives a response from the other server instances with external non-participating subcribers on the request/response channels", (done) => {
          namespace1.adapter.requestsTimeout = 100;
          const { requestChannel, responseChannel } = namespace1.adapter;

          const spySub = suite.createRedisClient();
          done = ((done) => (...rest) => {
            spySub.quit();
            done(...rest);
          })(done);

          spySub.subscribe([requestChannel, responseChannel], (err) => {
            expect(err).to.not.be.ok();

            namespace1.serverSideEmit("hello", (err, response) => {
              expect(err).to.not.be.ok();
              expect(response).to.be.an(Array);
              expect(response).to.have.length(2);
              expect(response).to.contain(2);
              expect(response).to.contain(3);
              done();
            });

            namespace1.on("hello", () => {
              done(new Error("should not happen"));
            });

            namespace2.on("hello", (cb) => {
              cb(2);
            });

            namespace3.on("hello", (cb) => {
              cb(3);
            });
          });
        });
      });
    });
  });
});

function _create(createRedisClient) {
  return (nsp, fn?) => {
    const httpServer = createServer();
    const sio = new Server(httpServer);
    // @ts-ignore
    sio.adapter(createAdapter(createRedisClient(), createRedisClient()));
    httpServer.listen((err) => {
      if (err) throw err; // abort tests
      if ("function" == typeof nsp) {
        fn = nsp;
        nsp = "";
      }
      nsp = nsp || "/";
      const addr = httpServer.address() as AddressInfo;
      const url = "http://localhost:" + addr.port + nsp;

      const namespace = sio.of(nsp);
      const client = ioc(url, { reconnection: false });

      namespace.on("connection", (socket) => {
        fn(namespace, client, socket);
      });
    });
  };
}

function init(options) {
  const create = _create(options);
  return (done) => {
    create((_namespace1, _client1, _socket1) => {
      create((_namespace2, _client2, _socket2) => {
        create((_namespace3, _client3, _socket3) => {
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

function noop() {}

function cleanup(done) {
  namespace1.server.close();
  namespace2.server.close();
  namespace3.server.close();
  // handle 'Connection is closed' errors
  namespace1.adapter.on("error", noop);
  namespace2.adapter.on("error", noop);
  namespace3.adapter.on("error", noop);
  namespace1.adapter.subClient.quit();
  namespace2.adapter.subClient.quit();
  namespace3.adapter.subClient.quit();
  done();
}
