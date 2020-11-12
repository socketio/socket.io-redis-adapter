const http = require("http").Server;
const io = require("socket.io");
const ioc = require("socket.io-client");
const expect = require("expect.js");
const adapter = require("..");

const ioredis = require("ioredis").createClient;

let namespace1, namespace2, namespace3;
let client1, client2, client3;
let socket1, socket2, socket3;

[
  {
    name: "socket.io-redis",
  },
  {
    name: "socket.io-redis with ioredis",
    options: () => ({
      pubClient: ioredis(),
      subClient: ioredis(),
    }),
  },
].forEach((suite) => {
  const name = suite.name;
  const options = suite.options;

  describe(name, () => {
    beforeEach(init(options));
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
    });
  });
});

function _create(options) {
  return (nsp, fn) => {
    const srv = http();
    const sio = io(srv);
    sio.adapter(adapter(typeof options === "function" ? options() : options));
    srv.listen((err) => {
      if (err) throw err; // abort tests
      if ("function" == typeof nsp) {
        fn = nsp;
        nsp = "";
      }
      nsp = nsp || "/";
      const addr = srv.address();
      const url = "http://localhost:" + addr.port + nsp;

      const namespace = sio.of(nsp);
      const client = ioc(url, { reconnect: false });

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
