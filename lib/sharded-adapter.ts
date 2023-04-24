import { ClusterAdapter, ClusterMessage, MessageType } from "./cluster-adapter";
import { decode, encode } from "notepack.io";
import { hasBinary } from "./util";
import debugModule from "debug";

const debug = debugModule("socket.io-redis");

const RETURN_BUFFERS = true;

export interface ShardedRedisAdapterOptions {
  channelPrefix?: string;
}

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
  private readonly cleanup: () => void;

  constructor(nsp, pubClient, subClient, opts: ShardedRedisAdapterOptions) {
    super(nsp);
    this.pubClient = pubClient;
    this.subClient = subClient;
    this.opts = Object.assign(
      {
        channelPrefix: "socket.io",
      },
      opts
    );

    this.channel = `${this.opts.channelPrefix}#${nsp.name}#`;
    this.responseChannel = `${this.opts.channelPrefix}#${nsp.name}#${this.uid}#`;

    const handler = (message, channel) => this.onRawMessage(message, channel);

    this.subClient.sSubscribe(this.channel, handler, RETURN_BUFFERS);
    this.subClient.sSubscribe(this.responseChannel, handler, RETURN_BUFFERS);

    this.cleanup = () => {
      return Promise.all([
        this.subClient.sUnsubscribe(this.channel, handler),
        this.subClient.sUnsubscribe(this.responseChannel, handler),
      ]);
    };
  }

  override close(): Promise<void> | void {
    this.cleanup();
  }

  override publishMessage(message) {
    debug("publishing message of type %s to %s", message.type, this.channel);
    this.pubClient.sPublish(this.channel, this.encode(message));

    return Promise.resolve("");
  }

  override publishResponse(requesterUid, response) {
    debug("publishing response of type %s to %s", response.type, requesterUid);

    this.pubClient.sPublish(
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

    if (channel.toString() === this.channel) {
      this.onMessage(message, "");
    } else {
      this.onResponse(message);
    }
  }

  override serverCount(): Promise<number> {
    if (
      this.pubClient.constructor.name === "Cluster" ||
      this.pubClient.isCluster
    ) {
      return Promise.all(
        this.pubClient.nodes().map((node) => {
          return node.sendCommand(["PUBSUB", "SHARDNUMSUB", this.channel]);
        })
      ).then((values) => {
        let numSub = 0;
        values.map((value) => {
          numSub += parseInt(value[1], 10);
        });
        return numSub;
      });
    } else {
      return this.pubClient
        .sendCommand(["PUBSUB", "SHARDNUMSUB", this.channel])
        .then((res) => parseInt(res[1], 10));
    }
  }
}
