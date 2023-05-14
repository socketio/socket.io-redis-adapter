import { randomBytes } from "crypto";

export function hasBinary(obj: any, toJSON?: boolean): boolean {
  if (!obj || typeof obj !== "object") {
    return false;
  }

  if (obj instanceof ArrayBuffer || ArrayBuffer.isView(obj)) {
    return true;
  }

  if (Array.isArray(obj)) {
    for (let i = 0, l = obj.length; i < l; i++) {
      if (hasBinary(obj[i])) {
        return true;
      }
    }
    return false;
  }

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key) && hasBinary(obj[key])) {
      return true;
    }
  }

  if (obj.toJSON && typeof obj.toJSON === "function" && !toJSON) {
    return hasBinary(obj.toJSON(), true);
  }

  return false;
}

export function randomId() {
  return randomBytes(8).toString("hex");
}

export function parseNumSubResponse(res) {
  return parseInt(res[1], 10);
}

export function sumValues(values) {
  return values.reduce((acc, val) => {
    return acc + val;
  }, 0);
}

const RETURN_BUFFERS = true;

/**
 * Whether the client comes from the `redis` package
 *
 * @param redisClient
 *
 * @see https://github.com/redis/node-redis
 */
function isRedisV4Client(redisClient: any) {
  return typeof redisClient.sSubscribe === "function";
}

export function SSUBSCRIBE(
  redisClient: any,
  channel: string,
  handler: (rawMessage: Buffer, channel: Buffer) => void
) {
  if (isRedisV4Client(redisClient)) {
    redisClient.sSubscribe(channel, handler, RETURN_BUFFERS);
  } else {
    redisClient.ssubscribe(channel);

    redisClient.on("smessageBuffer", (rawChannel, message) => {
      if (rawChannel.toString() === channel) {
        handler(message, rawChannel);
      }
    });
  }
}

export function SUNSUBSCRIBE(redisClient: any, channel: string | string[]) {
  if (isRedisV4Client(redisClient)) {
    redisClient.sUnsubscribe(channel);
  } else {
    redisClient.sunsubscribe(channel);
  }
}

export function SPUBLISH(
  redisClient: any,
  channel: string,
  payload: string | Uint8Array
) {
  if (isRedisV4Client(redisClient)) {
    redisClient.sPublish(channel, payload);
  } else {
    redisClient.spublish(channel, payload);
  }
}

export function PUBSUB(redisClient: any, arg: string, channel: string) {
  if (redisClient.constructor.name === "Cluster" || redisClient.isCluster) {
    // ioredis cluster
    return Promise.all(
      redisClient.nodes().map((node) => {
        return node
          .send_command("PUBSUB", [arg, channel])
          .then(parseNumSubResponse);
      })
    ).then(sumValues);
  } else if (isRedisV4Client(redisClient)) {
    const isCluster = Array.isArray(redisClient.masters);
    if (isCluster) {
      // redis@4 cluster
      const nodes = redisClient.masters;
      return Promise.all(
        nodes.map((node) => {
          return node.client
            .sendCommand(["PUBSUB", arg, channel])
            .then(parseNumSubResponse);
        })
      ).then(sumValues);
    } else {
      // redis@4 standalone
      return redisClient
        .sendCommand(["PUBSUB", arg, channel])
        .then(parseNumSubResponse);
    }
  } else {
    // ioredis / redis@3 standalone
    return new Promise((resolve, reject) => {
      redisClient.send_command("PUBSUB", [arg, channel], (err, numSub) => {
        if (err) return reject(err);
        resolve(parseNumSubResponse(numSub));
      });
    });
  }
}
