import { createServer } from "http";
import { AddressInfo } from "net";
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

export function setup(createAdapter: any) {
  const servers = [];
  const serverSockets = [];
  const clientSockets = [];
  const redisCleanupFunctions = [];

  return new Promise<TestContext>(async (resolve) => {
    for (let i = 1; i <= NODES_COUNT; i++) {
      const [adapter, redisCleanup] = await createAdapter();

      const httpServer = createServer();
      const io = new Server(httpServer, {
        adapter,
      });
      httpServer.listen(() => {
        const port = (httpServer.address() as AddressInfo).port;
        const clientSocket = ioc(`http://localhost:${port}`);

        io.on("connection", async (socket) => {
          clientSockets.push(clientSocket);
          serverSockets.push(socket);
          servers.push(io);
          redisCleanupFunctions.push(redisCleanup);
          if (servers.length === NODES_COUNT) {
            await sleep(200);

            resolve({
              servers,
              serverSockets,
              clientSockets,
              cleanup: () => {
                servers.forEach((server) => server.close());
                clientSockets.forEach((socket) => socket.disconnect());
                redisCleanupFunctions.forEach((fn) => fn());
              },
            });
          }
        });
      });
    }
  });
}
