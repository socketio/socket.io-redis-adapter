import { createServer } from "http";
import { AddressInfo } from "net";
import {
  createAdapter,
  createShardedAdapter,
  RedisAdapterOptions,
} from "../lib";
import { Server, Socket as ServerSocket } from "socket.io";
import { io as ioc, Socket as ClientSocket } from "socket.io-client";

export function times(count: number, fn: () => void) {
  let i = 0;
  return () => {
    i++;
    if (i === count) {
      fn();
    } else if (i > count) {
      throw new Error(`too many calls: ${i} instead of ${count}`);
    }
  };
}

export function sleep(duration: number) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

export function shouldNotHappen(done) {
  return () => done(new Error("should not happen"));
}

const NODES_COUNT = 3;

interface TestContext {
  servers: Server[];
  serverSockets: ServerSocket[];
  clientSockets: ClientSocket[];
  cleanup: () => void;
}

async function createRedisClient() {
  switch (process.env.REDIS_CLIENT) {
    case "ioredis":
      return require("ioredis").createClient();
    case "redis-v3":
      return require("redis-v3").createClient();
    default:
      // redis@4
      const client = require("redis").createClient();
      await client.connect();
      return client;
  }
}

export function setup(adapterOptions: Partial<RedisAdapterOptions> = {}) {
  const servers = [];
  const serverSockets = [];
  const clientSockets = [];
  const redisClients = [];

  return new Promise<TestContext>(async (resolve) => {
    for (let i = 1; i <= NODES_COUNT; i++) {
      const [pubClient, subClient] = await Promise.all([
        createRedisClient(),
        createRedisClient(),
      ]);

      adapterOptions.publishOnSpecificResponseChannel =
        process.env.SPECIFIC_CHANNEL !== undefined;

      const httpServer = createServer();
      const io = new Server(httpServer, {
        adapter:
          process.env.SHARDED === "1"
            ? createShardedAdapter(pubClient, subClient)
            : createAdapter(pubClient, subClient, adapterOptions),
      });
      httpServer.listen(() => {
        const port = (httpServer.address() as AddressInfo).port;
        const clientSocket = ioc(`http://localhost:${port}`);

        io.on("connection", async (socket) => {
          clientSockets.push(clientSocket);
          serverSockets.push(socket);
          servers.push(io);
          redisClients.push(pubClient, subClient);
          if (servers.length === NODES_COUNT) {
            await sleep(200);

            resolve({
              servers,
              serverSockets,
              clientSockets,
              cleanup: () => {
                servers.forEach((server) => {
                  // @ts-ignore
                  server.httpServer.close();
                  server.of("/").adapter.close();
                });
                clientSockets.forEach((socket) => {
                  socket.disconnect();
                });
                redisClients.forEach((redisClient) => {
                  if (process.env.REDIS_CLIENT === "redis-v3") {
                    redisClient.quit();
                  } else {
                    redisClient.disconnect();
                  }
                });
              },
            });
          }
        });
      });
    }
  });
}
