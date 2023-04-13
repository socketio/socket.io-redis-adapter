import type { Server, Socket as ServerSocket } from "socket.io";
import type { Socket as ClientSocket } from "socket.io-client";
import expect = require("expect.js");
import { shouldNotHappen, setup } from "./util";
import type { RedisAdapter } from "../lib";

describe("specifics", () => {
  let servers: Server[];
  let serverSockets: ServerSocket[];
  let clientSockets: ClientSocket[];
  let cleanup: () => void;

  beforeEach(async () => {
    const testContext = await setup({
      requestsTimeout: 1000,
    });
    servers = testContext.servers;
    serverSockets = testContext.serverSockets;
    clientSockets = testContext.clientSockets;
    cleanup = testContext.cleanup;
  });

  afterEach(() => cleanup());

  describe("broadcast", function () {
    it("broadcasts to a numeric room", (done) => {
      // @ts-ignore
      serverSockets[0].join(123);

      clientSockets[0].on("test", () => done());
      clientSockets[1].on("test", shouldNotHappen(done));
      clientSockets[2].on("test", shouldNotHappen(done));

      // @ts-ignore
      servers[1].to(123).emit("test");
    });
  });

  it("unsubscribes when close is called", async function () {
    if (process.env.SHARDED === "1") {
      return this.skip();
    }
    const parseInfo = (rawInfo: string) => {
      const info = {};

      rawInfo.split("\r\n").forEach((line) => {
        if (line.length > 0 && !line.startsWith("#")) {
          const fieldVal = line.split(":");
          info[fieldVal[0]] = fieldVal[1];
        }
      });

      return info;
    };

    const getInfo = async (): Promise<any> => {
      if (process.env.REDIS_CLIENT === undefined) {
        return parseInfo(
          await (
            servers[2].of("/").adapter as RedisAdapter
          ).pubClient.sendCommand(["info"])
        );
      } else if (process.env.REDIS_CLIENT === "ioredis") {
        // @ts-ignore
        return parseInfo(
          await (servers[2].of("/").adapter as RedisAdapter).pubClient.call(
            "info"
          )
        );
      } else {
        return await new Promise((resolve, reject) => {
          (servers[2].of("/").adapter as RedisAdapter).pubClient.sendCommand(
            "info",
            [],
            (err, result) => {
              if (err) {
                reject(err);
              }
              resolve(parseInfo(result));
            }
          );
        });
      }
    };

    return new Promise(async (resolve, reject) => {
      // Give it a moment to subscribe to all the channels
      setTimeout(async () => {
        try {
          const info = await getInfo();

          // Depending on the version of redis this may be 3 (redis < v5) or 1 (redis > v4)
          // Older versions subscribed multiple times on the same pattern. Newer versions only sub once.
          expect(info.pubsub_patterns).to.be.greaterThan(0);
          expect(info.pubsub_channels).to.eql(5); // 2 shared (request/response) + 3 unique for each namespace

          servers[0].of("/").adapter.close();
          servers[1].of("/").adapter.close();
          servers[2].of("/").adapter.close();

          // Give it a moment to unsubscribe
          setTimeout(async () => {
            try {
              const info = await getInfo();

              expect(info.pubsub_patterns).to.eql(0); // All patterns subscriptions should be unsubscribed
              expect(info.pubsub_channels).to.eql(0); // All subscriptions should be unsubscribed
              resolve();
            } catch (error) {
              reject(error);
            }
          }, 100);
        } catch (error) {
          reject(error);
        }
      }, 100);
    });
  });

  if (process.env.REDIS_CLIENT === undefined) {
    // redis@4
    it("ignores messages from unknown channels", (done) => {
      (servers[0].of("/").adapter as RedisAdapter).subClient
        .PSUBSCRIBE("f?o", () => {
          setTimeout(done, 50);
        })
        .then(() => {
          (servers[2].of("/").adapter as RedisAdapter).pubClient.publish(
            "foo",
            "bar"
          );
        });
    });

    it("ignores messages from unknown channels (2)", (done) => {
      (servers[0].of("/").adapter as RedisAdapter).subClient
        .PSUBSCRIBE("woot", () => {
          setTimeout(done, 50);
        })
        .then(() => {
          (servers[2].of("/").adapter as RedisAdapter).pubClient.publish(
            "woot",
            "toow"
          );
        });
    });
  } else {
    // redis@3 and ioredis
    it("ignores messages from unknown channels", (done) => {
      (servers[0].of("/").adapter as RedisAdapter).subClient.psubscribe(
        "f?o",
        () => {
          (servers[2].of("/").adapter as RedisAdapter).pubClient.publish(
            "foo",
            "bar"
          );
        }
      );

      (servers[0].of("/").adapter as RedisAdapter).subClient.on(
        "pmessageBuffer",
        () => {
          setTimeout(done, 50);
        }
      );
    });

    it("ignores messages from unknown channels (2)", (done) => {
      (servers[0].of("/").adapter as RedisAdapter).subClient.subscribe(
        "woot",
        () => {
          (servers[2].of("/").adapter as RedisAdapter).pubClient.publish(
            "woot",
            "toow"
          );
        }
      );

      (servers[0].of("/").adapter as RedisAdapter).subClient.on(
        "messageBuffer",
        () => {
          setTimeout(done, 50);
        }
      );
    });
  }

  describe("allRooms", () => {
    afterEach(() => {
      // @ts-ignore
      expect(servers[0].of("/").adapter.requests.size).to.eql(0);
    });

    it("returns all rooms across several nodes", async function () {
      if (process.env.SHARDED === "1") {
        return this.skip();
      }
      serverSockets[0].join("woot1");

      const rooms = await (
        servers[0].of("/").adapter as RedisAdapter
      ).allRooms();

      expect(rooms).to.be.a(Set);
      expect(rooms.size).to.eql(4);
      expect(rooms.has(serverSockets[0].id)).to.be(true);
      expect(rooms.has(serverSockets[1].id)).to.be(true);
      expect(rooms.has(serverSockets[2].id)).to.be(true);
      expect(rooms.has("woot1")).to.be(true);
    });
  });
});
