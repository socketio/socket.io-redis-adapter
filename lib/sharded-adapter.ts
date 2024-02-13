import { ClusterAdapter, ClusterMessage, MessageType } from "./cluster-adapter";
import { decode, encode } from "notepack.io";
import { hasBinary, PUBSUB, SPUBLISH, SSUBSCRIBE, SUNSUBSCRIBE } from "./util";
import debugModule from "debug";

const debug = debugModule("socket.io-redis");

export interface ShardedRedisAdapterOptions {
  /**
   * The prefix for the Redis Pub/Sub channels.
   *
   * @default "socket.io"
   */
  channelPrefix?: string;
  /**
   * The subscription mode impacts the number of Redis Pub/Sub channels:
   *
   * - "static": 2 channels per namespace
   *
   * Useful when used with dynamic namespaces.
   *
   * - "dynamic": (2 + 1 per public room) channels per namespace
   *
   * The default value, useful when some rooms have a low number of clients (so only a few Socket.IO servers are notified).
   *
   * Only public rooms (i.e. not related to a particular Socket ID) are taken in account, because:
   *
   * - a lot of connected clients would mean a lot of subscription/unsubscription
   * - the Socket ID attribute is ephemeral
   *
   * @default "dynamic"
   */
  subscriptionMode?: "static" | "dynamic";
}

/**
 * Create a new Adapter based on Redis sharded Pub/Sub introduced in Redis 7.0.
 *
 * @see https://redis.io/docs/manual/pubsub/#sharded-pubsub
 *
 * @param pubClient - the Redis client used to publish (from the `redis` package)
 * @param subClient - the Redis client used to subscribe (from the `redis` package)
 * @param opts - some additional options
 */
export function createShardedAdapter(
  pubClient: any,
  subClient: any,
  opts?: ShardedRedisAdapterOptions
) {
  return function (nsp) {
    return new ShardedRedisAdapter(nsp, pubClient, subClient, opts);
  };
}

class ShardedRedisAdapter extends ClusterAdapter {
  private readonly pubClient: any;
  private readonly subClient: any;
  private readonly opts: Required<ShardedRedisAdapterOptions>;
  private readonly channel: string;
  private readonly responseChannel: string;

  constructor(nsp, pubClient, subClient, opts: ShardedRedisAdapterOptions) {
    super(nsp);
    this.pubClient = pubClient;
    this.subClient = subClient;
    this.opts = Object.assign(
      {
        channelPrefix: "socket.io",
        subscriptionMode: "dynamic",
      },
      opts
    );

    this.channel = `${this.opts.channelPrefix}#${nsp.name}#`;
    this.responseChannel = `${this.opts.channelPrefix}#${nsp.name}#${this.uid}#`;

    const handler = (message, channel) => this.onRawMessage(message, channel);

    SSUBSCRIBE(this.subClient, this.channel, handler);
    SSUBSCRIBE(this.subClient, this.responseChannel, handler);

    if (this.opts.subscriptionMode === "dynamic") {
      this.on("create-room", (room) => {
        const isPublicRoom = !this.sids.has(room);
        if (isPublicRoom) {
          SSUBSCRIBE(this.subClient, this.dynamicChannel(room), handler);
        }
      });

      this.on("delete-room", (room) => {
        const isPublicRoom = !this.sids.has(room);
        if (isPublicRoom) {
          SUNSUBSCRIBE(this.subClient, this.dynamicChannel(room));
        }
      });
    }
  }

  override close(): Promise<void> | void {
    const channels = [this.channel, this.responseChannel];

    if (this.opts.subscriptionMode === "dynamic") {
      this.rooms.forEach((_sids, room) => {
        const isPublicRoom = !this.sids.has(room);
        if (isPublicRoom) {
          channels.push(this.dynamicChannel(room));
        }
      });
    }

    return Promise.all(
      channels.map((channel) => SUNSUBSCRIBE(this.subClient, channel))
    ).then();
  }

  override publishMessage(message) {
    const channel = this.computeChannel(message);
    debug("publishing message of type %s to %s", message.type, channel);
    SPUBLISH(this.pubClient, channel, this.encode(message));

    return Promise.resolve("");
  }

  private computeChannel(message) {
    // broadcast with ack can not use a dynamic channel, because the serverCount() method return the number of all
    // servers, not only the ones where the given room exists
    const useDynamicChannel =
      this.opts.subscriptionMode === "dynamic" &&
      message.type === MessageType.BROADCAST &&
      message.data.requestId === undefined &&
      message.data.opts.rooms.length === 1 &&
      !message.data.opts.flags.expectSingleResponse;
    if (useDynamicChannel) {
      return this.dynamicChannel(message.data.opts.rooms[0]);
    } else {
      return this.channel;
    }
  }

  private dynamicChannel(room) {
    return this.channel + room + "#";
  }

  override publishResponse(requesterUid, response) {
    debug("publishing response of type %s to %s", response.type, requesterUid);

    SPUBLISH(
      this.pubClient,
      `${this.channel}${requesterUid}#`,
      this.encode(response)
    );
  }

  private encode(message: ClusterMessage) {
    const mayContainBinary = [
      MessageType.BROADCAST,
      MessageType.BROADCAST_ACK,
      MessageType.FETCH_SOCKETS_RESPONSE,
      MessageType.SERVER_SIDE_EMIT,
      MessageType.SERVER_SIDE_EMIT_RESPONSE,
    ].includes(message.type);

    if (mayContainBinary && hasBinary(message.data)) {
      return encode(message);
    } else {
      return JSON.stringify(message);
    }
  }

  private onRawMessage(rawMessage: Buffer, channel: Buffer) {
    let message;
    try {
      if (rawMessage[0] === 0x7b) {
        message = JSON.parse(rawMessage.toString());
      } else {
        message = decode(rawMessage);
      }
    } catch (e) {
      return debug("invalid format: %s", e.message);
    }

    if (channel.toString() === this.responseChannel) {
      this.onResponse(message);
    } else {
      this.onMessage(message);
    }
  }

  override serverCount(): Promise<number> {
    return PUBSUB(this.pubClient, "SHARDNUMSUB", this.channel);
  }
}
