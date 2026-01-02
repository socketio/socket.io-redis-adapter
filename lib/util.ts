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

const kHandlers = Symbol("handlers");
const kListener = Symbol("listener");
const kPendingUnsubscribes = Symbol("pendingUnsubscribes");

export function SSUBSCRIBE(
  redisClient: any,
  channel: string,
  handler: (rawMessage: Buffer, channel: Buffer) => void
): Promise<void> {
  if (isRedisV4Client(redisClient)) {
    return redisClient.sSubscribe(channel, handler, RETURN_BUFFERS);
  } else {
    const doSubscribe = (): Promise<void> => {
      if (!redisClient[kHandlers]) {
        redisClient[kHandlers] = new Map<string, typeof handler>();
        redisClient[kPendingUnsubscribes] = new Map<string, Promise<void>>();
        redisClient[kListener] = (rawChannel: Buffer, message: Buffer) => {
          redisClient[kHandlers].get(rawChannel.toString())?.(
            message,
            rawChannel
          );
        };
        redisClient.on("smessageBuffer", redisClient[kListener]);
      }
      redisClient[kHandlers].set(channel, handler);
      return redisClient.ssubscribe(channel);
    };

    // Wait for any pending unsubscribe on this channel to complete first
    const pendingUnsubscribe = redisClient[kPendingUnsubscribes]?.get(channel);
    if (pendingUnsubscribe) {
      return pendingUnsubscribe.then(doSubscribe);
    }
    return doSubscribe();
  }
}

export function SUNSUBSCRIBE(
  redisClient: any,
  channel: string | string[]
): Promise<void> {
  if (isRedisV4Client(redisClient)) {
    return redisClient.sUnsubscribe(channel);
  } else {
    const channels = Array.isArray(channel) ? channel : [channel];

    // Remove handlers immediately to stop processing messages
    channels.forEach((c) => redisClient[kHandlers]?.delete(c));

    // Perform the unsubscribe and track as pending
    const unsubscribePromise = redisClient.sunsubscribe(channel).then(() => {
      // Remove from pending tracking
      channels.forEach((c) => redisClient[kPendingUnsubscribes]?.delete(c));

      // Clean up the global listener when no more handlers exist
      if (redisClient[kHandlers]?.size === 0 && redisClient[kListener]) {
        redisClient.off("smessageBuffer", redisClient[kListener]);
        delete redisClient[kHandlers];
        delete redisClient[kListener];
        delete redisClient[kPendingUnsubscribes];
      }
    });

    // Track pending unsubscribe for each channel
    channels.forEach((c) =>
      redisClient[kPendingUnsubscribes]?.set(c, unsubscribePromise)
    );

    return unsubscribePromise;
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
