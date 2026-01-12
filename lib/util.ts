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

/**
 * Whether the client is an ioredis Cluster instance
 *
 * @param redisClient
 */
export function isIoRedisCluster(redisClient: any) {
  return redisClient.constructor.name === "Cluster" || redisClient.isCluster;
}

/**
 * Whether the ioredis Cluster has shardedSubscribers enabled
 *
 * @param redisClient
 *
 * @see https://github.com/redis/ioredis/pull/1956
 */
export function hasShardedSubscribers(redisClient: any) {
  return (
    isIoRedisCluster(redisClient) &&
    redisClient.options?.shardedSubscribers === true
  );
}

const kHandlers = Symbol("handlers");

export function SSUBSCRIBE(
  redisClient: any,
  channel: string,
  handler: (rawMessage: Buffer, channel: Buffer) => void
) {
  if (isRedisV4Client(redisClient)) {
    redisClient.sSubscribe(channel, handler, RETURN_BUFFERS);
  } else {
    if (!redisClient[kHandlers]) {
      redisClient[kHandlers] = new Map();
      redisClient.on("smessageBuffer", (rawChannel, message) => {
        redisClient[kHandlers].get(rawChannel.toString())?.(
          message,
          rawChannel
        );
      });
    }
    redisClient[kHandlers].set(channel, handler);
    redisClient.ssubscribe(channel);
  }
}

export function SUNSUBSCRIBE(redisClient: any, channel: string | string[]) {
  if (isRedisV4Client(redisClient)) {
    redisClient.sUnsubscribe(channel);
  } else {
    redisClient.sunsubscribe(channel);
    if (Array.isArray(channel)) {
      channel.forEach((c) => redisClient[kHandlers].delete(c));
    } else {
      redisClient[kHandlers].delete(channel);
    }
  }
}

/**
 * @see https://redis.io/commands/spublish/
 */
export function SPUBLISH(
  redisClient: any,
  channel: string,
  payload: string | Uint8Array
) {
  if (isRedisV4Client(redisClient)) {
    return redisClient.sPublish(channel, payload);
  } else {
    return redisClient.spublish(channel, payload);
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
