import { createServer } from "http";
import { Server, Socket as ServerSocket } from "socket.io";
import { io as ioc, Socket as ClientSocket } from "socket.io-client";
import expect = require("expect.js");
import { createAdapter } from "../lib";
import type { AddressInfo } from "net";

import "./util";

let namespace1, namespace2, namespace3;
let client1: ClientSocket, client2: ClientSocket, client3: ClientSocket;
let socket1: ServerSocket, socket2: ServerSocket, socket3: ServerSocket;

const shouldNotHappen = (done) => () => done(new Error("should not happen"));

describe(`socket.io-redis with ${
  process.env.REDIS_CLIENT || "redis@4"
}`, () => {
  beforeEach(init());
  afterEach(cleanup);

  it("broadcasts", (done) => {
    client1.on("woot", (a, b, c, d) => {
      expect(a).to.eql([]);
      expect(b).to.eql({ a: "b" });
      expect(Buffer.isBuffer(c) && c.equals(buf)).to.be(true);
      expect(Buffer.isBuffer(d) && d.equals(Buffer.from(array))).to.be(true); // converted to Buffer on the client-side
      done();
    });

    const buf = Buffer.from("asdfasdf", "utf8");
    const array = Uint8Array.of(1, 2, 3, 4);
    socket2.broadcast.emit("woot", [], { a: "b" }, buf, array);
  });

  it("broadcasts to a room", (done) => {
    socket1.join("woot");
    socket2.broadcast.to("woot").emit("broadcast");

    client1.on("broadcast", done);
    client2.on("broadcast", shouldNotHappen(done));
    client3.on("broadcast", shouldNotHappen(done));
  });

  it("broadcasts to a numeric room", (done) => {
    // @ts-ignore
    socket1.join(123);
    namespace2.to(123).emit("broadcast");

    client1.on("broadcast", done);
    client2.on("broadcast", shouldNotHappen(done));
    client3.on("broadcast", shouldNotHappen(done));
  });

  it("uses a namespace to broadcast to rooms", (done) => {
    socket1.join("woot");
    namespace2.to("woot").emit("broadcast");

    client1.on("broadcast", done);
    client2.on("broadcast", shouldNotHappen(done));
    client3.on("broadcast", shouldNotHappen(done));
  });

  it("broadcasts to multiple rooms at a time", (done) => {
    socket1.join(["foo", "bar"]);
    socket2.broadcast.to("foo").to("bar").emit("broadcast");

    let called = false;
    client1.on("broadcast", () => {
      if (called) return shouldNotHappen(done);
      called = true;
      done();
    });

    client2.on("broadcast", shouldNotHappen(done));
    client3.on("broadcast", shouldNotHappen(done));
  });

  it("doesn't broadcast when using the local flag", (done) => {
    socket1.join("woot");
    socket2.join("woot");
    namespace2.local.to("woot").emit("local broadcast");

    client1.on("local broadcast", shouldNotHappen(done));
    client2.on("local broadcast", done);
    client3.on("local broadcast", shouldNotHappen(done));
  });

  it("doesn't broadcast to left rooms", (done) => {
    socket1.join("woot");
    socket1.leave("woot");
    socket2.broadcast.to("woot").emit("broadcast");

    client1.on("broadcast", shouldNotHappen(done));
    done();
  });

  it("deletes rooms upon disconnection", (done) => {
    socket1.join("woot");
    socket1.on("disconnect", () => {
      // @ts-ignore
      expect(socket1.adapter.sids[socket1.id]).to.be(undefined);
      // @ts-ignore
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

  it("broadcasts with multiple acknowledgements", (done) => {
    client1.on("test", (cb) => {
      cb(1);
    });

    client2.on("test", (cb) => {
      cb(2);
    });

    client3.on("test", (cb) => {
      cb(3);
    });

    namespace1.timeout(500).emit("test", (err: Error, responses: any[]) => {
      expect(err).to.be(null);
      expect(responses).to.contain(1);
      expect(responses).to.contain(2);
      expect(responses).to.contain(3);

      setTimeout(() => {
        expect(namespace1.adapter.ackRequests.size).to.eql(0);

        done();
      }, 500);
    });
  });

  it("broadcasts with multiple acknowledgements (binary content)", (done) => {
    client1.on("test", (cb) => {
      cb(Buffer.from([1]));
    });

    client2.on("test", (cb) => {
      cb(Buffer.from([2]));
    });

    client3.on("test", (cb) => {
      cb(Buffer.from([3]));
    });

    namespace1.timeout(500).emit("test", (err: Error, responses: any[]) => {
      expect(err).to.be(null);
      responses.forEach((response) => {
        expect(Buffer.isBuffer(response)).to.be(true);
      });

      done();
    });
  });

  it("broadcasts with multiple acknowledgements (no client)", (done) => {
    namespace1
      .to("abc")
      .timeout(500)
      .emit("test", (err: Error, responses: any[]) => {
        expect(err).to.be(null);
        expect(responses).to.eql([]);

        done();
      });
  });

  it("broadcasts with multiple acknowledgements (timeout)", (done) => {
    client1.on("test", (cb) => {
      cb(1);
    });

    client2.on("test", (cb) => {
      cb(2);
    });

    client3.on("test", (cb) => {
      // do nothing
    });

    namespace1.timeout(500).emit("test", (err: Error, responses: any[]) => {
      expect(err).to.be.an(Error);
      expect(responses).to.contain(1);
      expect(responses).to.contain(2);

      done();
    });
  });

  if (process.env.REDIS_CLIENT === undefined) {
    // redis@4
    it("ignores messages from unknown channels", (done) => {
      namespace1.adapter.subClient
        .PSUBSCRIBE("f?o", () => {
          setTimeout(done, 50);
        })
        .then(() => {
          namespace3.adapter.pubClient.publish("foo", "bar");
        });
    });

    it("ignores messages from unknown channels (2)", (done) => {
      namespace1.adapter.subClient
        .PSUBSCRIBE("woot", () => {
          setTimeout(done, 50);
        })
        .then(() => {
          namespace3.adapter.pubClient.publish("woot", "toow");
        });
    });
  } else {
    // redis@3 and ioredis
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
  }

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
        socket2.data = "test" as any;
        // @ts-ignore
        socket2.handshake.sessionStore = "not included";

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
        // @ts-ignore
        delete socket2.handshake.sessionStore;
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
    });
  });
});

const createClient = (() => {
  switch (process.env.REDIS_CLIENT) {
    case "ioredis":
      return require("ioredis").createClient;
    case "redis-v3":
      return require("redis-v3").createClient;
    default:
      // redis@4
      return async () => {
        const client = require("redis").createClient();
        await client.connect();
        return client;
      };
  }
})();

function _create() {
  return async (nsp, fn?) => {
    const httpServer = createServer();
    const sio = new Server(httpServer);
    sio.adapter(
      createAdapter(await createClient(), await createClient(), {
        publishOnSpecificResponseChannel:
          process.env.SPECIFIC_CHANNEL !== undefined,
      })
    );
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

function init() {
  const create = _create();
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
  if (typeof namespace1.adapter.subClient.disconnect == "function") {
    namespace1.adapter.pubClient.disconnect();
    namespace2.adapter.pubClient.disconnect();
    namespace3.adapter.pubClient.disconnect();
    namespace1.adapter.subClient.disconnect();
    namespace2.adapter.subClient.disconnect();
    namespace3.adapter.subClient.disconnect();
  } else {
    namespace1.adapter.pubClient.quit();
    namespace2.adapter.pubClient.quit();
    namespace3.adapter.pubClient.quit();
    namespace1.adapter.subClient.quit();
    namespace2.adapter.subClient.quit();
    namespace3.adapter.subClient.quit();
  }
  done();
}

require("./custom-parser");
