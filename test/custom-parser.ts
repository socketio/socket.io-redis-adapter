import type { Server } from "socket.io";
import type { Socket as ClientSocket } from "socket.io-client";
import { setup, times } from "./util";
import expect = require("expect.js");

describe("custom parser", () => {
  let servers: Server[];
  let clientSockets: ClientSocket[];
  let cleanup: () => void;

  beforeEach(async () => {
    const testContext = await setup({
      parser: {
        decode(msg) {
          return JSON.parse(msg);
        },
        encode(msg) {
          return JSON.stringify(msg);
        },
      },
    });
    servers = testContext.servers;
    clientSockets = testContext.clientSockets;
    cleanup = testContext.cleanup;
  });

  afterEach(() => cleanup());

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
