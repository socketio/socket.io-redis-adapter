import { createServer } from "http";
import { Server, Socket as ServerSocket } from "socket.io";
import { io as ioc, Socket as ClientSocket } from "socket.io-client";
import { createAdapter } from "../lib";
import { createClient } from "redis";
import { AddressInfo } from "net";
import { times } from "./util";
import expect = require("expect.js");

const NODES_COUNT = 3;

describe("custom parser", () => {
  let servers: Server[] = [],
    serverSockets: ServerSocket[] = [],
    clientSockets: ClientSocket[] = [],
    redisClients: any[] = [];

  beforeEach(async () => {
    for (let i = 1; i <= NODES_COUNT; i++) {
      const httpServer = createServer();
      const pubClient = createClient();
      const subClient = createClient();

      await Promise.all([pubClient.connect(), subClient.connect()]);

      redisClients.push(pubClient, subClient);

      const io = new Server(httpServer, {
        adapter: createAdapter(pubClient, subClient, {
          parser: {
            decode(msg) {
              return JSON.parse(msg);
            },
            encode(msg) {
              return JSON.stringify(msg);
            },
          },
        }),
      });

      await new Promise((resolve) => {
        httpServer.listen(() => {
          const port = (httpServer.address() as AddressInfo).port;
          const clientSocket = ioc(`http://localhost:${port}`);

          io.on("connection", async (socket) => {
            clientSockets.push(clientSocket);
            serverSockets.push(socket);
            servers.push(io);
            resolve();
          });
        });
      });
    }
  });

  afterEach(() => {
    servers.forEach((server) => {
      // @ts-ignore
      server.httpServer.close();
      server.of("/").adapter.close();
    });
    clientSockets.forEach((socket) => {
      socket.disconnect();
    });
    redisClients.forEach((redisClient) => {
      redisClient.disconnect();
    });
  });

  it("broadcasts", (done) => {
    const partialDone = times(3, done);

    clientSockets.forEach((clientSocket) => {
      clientSocket.on("test", (arg1, arg2, arg3) => {
        expect(arg1).to.eql(1);
        expect(arg2).to.eql("2");
        expect(arg3).to.eql([3]);
        partialDone();
      });
    });

    servers[0].emit("test", 1, "2", [3]);
  });
});
