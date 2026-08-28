import expect = require("expect.js");
import { PUBSUB } from "../lib/util";

describe("util", () => {
  describe("PUBSUB", () => {
    it("uses the node-redis Sentinel sendCommand signature", async () => {
      let commandArgs;
      const redisClient = {
        getMasterNode() {},
        sendCommand(...args) {
          commandArgs = args;
          return Promise.resolve(["channel", "2"]);
        },
      };

      const count = await PUBSUB(redisClient, "NUMSUB", "channel");

      expect(commandArgs).to.eql([true, ["PUBSUB", "NUMSUB", "channel"]]);
      expect(count).to.be(2);
    });
  });
});
