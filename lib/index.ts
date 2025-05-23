import uid2 = require("uid2");
import msgpack = require("notepack.io");
import { Adapter, BroadcastOptions, Room } from "socket.io-adapter";
import { PUBSUB } from "./util";

// Hazelcast Adapter imports
import { 
  createAdapter as createHazelcastAdapterFactory, // Alias at import
  HazelcastAdapter as HazelcastAdapterClass, 
  HazelcastAdapterOptions as HazelcastAdapterOptionsType 
} from "./hazelcast-adapter";

const debug = require("debug")("socket.io-redis");

// Note: The original module.exports = exports = createAdapter; is removed.

/**
 * Request types, for messages between nodes (used by RedisAdapter)
 */
enum RedisRequestType { // Renamed to avoid conflict if HazelcastAdapter has its own
  SOCKETS = 0,
  ALL_ROOMS = 1,
  REMOTE_JOIN = 2,
  REMOTE_LEAVE = 3,
  REMOTE_DISCONNECT = 4,
  REMOTE_FETCH = 5,
  SERVER_SIDE_EMIT = 6,
  BROADCAST,
  BROADCAST_CLIENT_COUNT,
  BROADCAST_ACK,
}

interface RedisRequest { // Renamed
  type: RedisRequestType;
  resolve: Function;
  timeout: NodeJS.Timeout;
  numSub?: number;
  msgCount?: number;
  [other: string]: any;
}

interface RedisAckRequest { // Renamed
  clientCountCallback: (clientCount: number) => void;
  ack: (...args: any[]) => void;
}

interface Parser {
  decode: (msg: any) => any;
  encode: (msg: any) => any;
}

const isNumeric = (str) => !isNaN(str) && !isNaN(parseFloat(str));

export interface RedisAdapterOptions {
  /**
   * the name of the key to pub/sub events on as prefix
   * @default socket.io
   */
  key: string;
  /**
   * after this timeout the adapter will stop waiting from responses to request
   * @default 5000
   */
  requestsTimeout: number;
  /**
   * Whether to publish a response to the channel specific to the requesting node.
   * @default false
   */
  publishOnSpecificResponseChannel: boolean;
  /**
   * The parser to use for encoding and decoding messages sent to Redis.
   * @default notepack.io
   */
  parser: Parser;
}

/**
 * Returns a function that will create a RedisAdapter instance.
 * (Previously createAdapter, now createRedisAdapter)
 */
export function createRedisAdapter( // Renamed
  pubClient: any,
  subClient: any,
  opts?: Partial<RedisAdapterOptions>
) {
  return function (nsp) {
    return new RedisAdapter(nsp, pubClient, subClient, opts);
  };
}

export class RedisAdapter extends Adapter {
  public readonly uid;
  public readonly requestsTimeout: number;
  public readonly publishOnSpecificResponseChannel: boolean;
  public readonly parser: Parser;

  private readonly channel: string;
  private readonly requestChannel: string;
  private readonly responseChannel: string;
  private readonly specificResponseChannel: string;
  private requests: Map<string, RedisRequest> = new Map(); // Updated type
  private ackRequests: Map<string, RedisAckRequest> = new Map(); // Updated type
  private redisListeners: Map<string, Function> = new Map();
  private readonly friendlyErrorHandler: () => void;

  constructor(
    nsp: any,
    readonly pubClient: any,
    readonly subClient: any,
    opts: Partial<RedisAdapterOptions> = {}
  ) {
    super(nsp);

    this.uid = uid2(6);
    this.requestsTimeout = opts.requestsTimeout || 5000;
    this.publishOnSpecificResponseChannel =
      !!opts.publishOnSpecificResponseChannel;
    this.parser = opts.parser || msgpack;

    const prefix = opts.key || "socket.io";

    this.channel = prefix + "#" + nsp.name + "#";
    this.requestChannel = prefix + "-request#" + this.nsp.name + "#";
    this.responseChannel = prefix + "-response#" + this.nsp.name + "#";
    this.specificResponseChannel = this.responseChannel + this.uid + "#";

    const isRedisV4 = typeof this.pubClient.pSubscribe === "function";
    if (isRedisV4) {
      this.redisListeners.set("psub", (msg, channel) => {
        this.onmessage(null, channel, msg);
      });

      this.redisListeners.set("sub", (msg, channel) => {
        this.onrequest(channel, msg);
      });

      this.subClient.pSubscribe(
        this.channel + "*",
        this.redisListeners.get("psub"),
        true
      );
      this.subClient.subscribe(
        [
          this.requestChannel,
          this.responseChannel,
          this.specificResponseChannel,
        ],
        this.redisListeners.get("sub"),
        true
      );
    } else {
      this.redisListeners.set("pmessageBuffer", this.onmessage.bind(this));
      this.redisListeners.set("messageBuffer", this.onrequest.bind(this));

      this.subClient.psubscribe(this.channel + "*");
      this.subClient.on(
        "pmessageBuffer",
        this.redisListeners.get("pmessageBuffer")
      );

      this.subClient.subscribe([
        this.requestChannel,
        this.responseChannel,
        this.specificResponseChannel,
      ]);
      this.subClient.on(
        "messageBuffer",
        this.redisListeners.get("messageBuffer")
      );
    }

    this.friendlyErrorHandler = function () {
      if (this.listenerCount("error") === 1) {
        console.warn("missing 'error' handler on this Redis client");
      }
    };
    this.pubClient.on("error", this.friendlyErrorHandler);
    this.subClient.on("error", this.friendlyErrorHandler);
  }

  private onmessage(pattern, channel, msg) {
    channel = channel.toString();

    const channelMatches = channel.startsWith(this.channel);
    if (!channelMatches) {
      return debug("ignore different channel");
    }

    const room = channel.slice(this.channel.length, -1);
    if (room !== "" && !this.hasRoom(room)) {
      return debug("ignore unknown room %s", room);
    }

    const args = this.parser.decode(msg);

    const [uid, packet, opts] = args;
    if (this.uid === uid) return debug("ignore same uid");

    if (packet && packet.nsp === undefined) {
      packet.nsp = "/";
    }

    if (!packet || packet.nsp !== this.nsp.name) {
      return debug("ignore different namespace");
    }
    opts.rooms = new Set(opts.rooms);
    opts.except = new Set(opts.except);

    super.broadcast(packet, opts);
  }

  private hasRoom(room): boolean {
    // @ts-ignore
    const hasNumericRoom = isNumeric(room) && this.rooms.has(parseFloat(room));
    return hasNumericRoom || this.rooms.has(room);
  }

  private async onrequest(channel, msg) {
    channel = channel.toString();

    if (channel.startsWith(this.responseChannel)) {
      return this.onresponse(channel, msg);
    } else if (!channel.startsWith(this.requestChannel)) {
      return debug("ignore different channel");
    }

    let request;

    try {
      if (msg[0] === 0x7b) {
        request = JSON.parse(msg.toString());
      } else {
        request = this.parser.decode(msg);
      }
    } catch (err) {
      debug("ignoring malformed request");
      return;
    }

    debug("received request %j", request);

    let response, socket;

    switch (request.type) {
      case RedisRequestType.SOCKETS: // Updated type
        if (this.requests.has(request.requestId)) {
          return;
        }
        const sockets = await super.sockets(new Set(request.rooms));
        response = JSON.stringify({
          requestId: request.requestId,
          sockets: [...sockets],
        });
        this.publishResponse(request, response);
        break;

      case RedisRequestType.ALL_ROOMS: // Updated type
        if (this.requests.has(request.requestId)) {
          return;
        }
        response = JSON.stringify({
          requestId: request.requestId,
          rooms: [...this.rooms.keys()],
        });
        this.publishResponse(request, response);
        break;

      case RedisRequestType.REMOTE_JOIN: // Updated type
        if (request.opts) {
          const opts = {
            rooms: new Set<Room>(request.opts.rooms),
            except: new Set<Room>(request.opts.except),
          };
          return super.addSockets(opts, request.rooms);
        }
        socket = this.nsp.sockets.get(request.sid);
        if (!socket) return;
        socket.join(request.room);
        response = JSON.stringify({ requestId: request.requestId });
        this.publishResponse(request, response);
        break;

      case RedisRequestType.REMOTE_LEAVE: // Updated type
        if (request.opts) {
          const opts = {
            rooms: new Set<Room>(request.opts.rooms),
            except: new Set<Room>(request.opts.except),
          };
          return super.delSockets(opts, request.rooms);
        }
        socket = this.nsp.sockets.get(request.sid);
        if (!socket) return;
        socket.leave(request.room);
        response = JSON.stringify({ requestId: request.requestId });
        this.publishResponse(request, response);
        break;

      case RedisRequestType.REMOTE_DISCONNECT: // Updated type
        if (request.opts) {
          const opts = {
            rooms: new Set<Room>(request.opts.rooms),
            except: new Set<Room>(request.opts.except),
          };
          return super.disconnectSockets(opts, request.close);
        }
        socket = this.nsp.sockets.get(request.sid);
        if (!socket) return;
        socket.disconnect(request.close);
        response = JSON.stringify({ requestId: request.requestId });
        this.publishResponse(request, response);
        break;

      case RedisRequestType.REMOTE_FETCH: // Updated type
        if (this.requests.has(request.requestId)) return;
        const opts = {
          rooms: new Set<Room>(request.opts.rooms),
          except: new Set<Room>(request.opts.except),
        };
        const localSockets = await super.fetchSockets(opts);
        response = JSON.stringify({
          requestId: request.requestId,
          sockets: localSockets.map((socket) => {
            const { sessionStore, ...handshake } = socket.handshake;
            return {
              id: socket.id,
              handshake,
              rooms: [...socket.rooms],
              data: socket.data,
            };
          }),
        });
        this.publishResponse(request, response);
        break;

      case RedisRequestType.SERVER_SIDE_EMIT: // Updated type
        if (request.uid === this.uid) return debug("ignore same uid");
        const withAck = request.requestId !== undefined;
        if (!withAck) {
          this.nsp._onServerSideEmit(request.data);
          return;
        }
        let called = false;
        const callback = (arg) => {
          if (called) return;
          called = true;
          debug("calling acknowledgement with %j", arg);
          this.pubClient.publish(
            this.responseChannel,
            JSON.stringify({
              type: RedisRequestType.SERVER_SIDE_EMIT, // Updated type
              requestId: request.requestId,
              data: arg,
            })
          );
        };
        request.data.push(callback);
        this.nsp._onServerSideEmit(request.data);
        break;

      case RedisRequestType.BROADCAST: { // Updated type
        if (this.ackRequests.has(request.requestId)) return;
        const opts = {
          rooms: new Set<Room>(request.opts.rooms),
          except: new Set<Room>(request.opts.except),
        };
        super.broadcastWithAck(
          request.packet,
          opts,
          (clientCount) => {
            debug("waiting for %d client acknowledgements", clientCount);
            this.publishResponse(
              request,
              JSON.stringify({
                type: RedisRequestType.BROADCAST_CLIENT_COUNT, // Updated type
                requestId: request.requestId,
                clientCount,
              })
            );
          },
          (arg) => {
            debug("received acknowledgement with value %j", arg);
            this.publishResponse(
              request,
              this.parser.encode({
                type: RedisRequestType.BROADCAST_ACK, // Updated type
                requestId: request.requestId,
                packet: arg,
              })
            );
          }
        );
        break;
      }
      default:
        debug("ignoring unknown request type: %s", request.type);
    }
  }

  private publishResponse(request, response) {
    const responseChannel = this.publishOnSpecificResponseChannel
      ? `${this.responseChannel}${request.uid}#`
      : this.responseChannel;
    debug("publishing response to channel %s", responseChannel);
    this.pubClient.publish(responseChannel, response);
  }

  private onresponse(channel, msg) {
    let response;
    try {
      if (msg[0] === 0x7b) {
        response = JSON.parse(msg.toString());
      } else {
        response = this.parser.decode(msg);
      }
    } catch (err) {
      debug("ignoring malformed response");
      return;
    }

    const requestId = response.requestId;
    if (this.ackRequests.has(requestId)) {
      const ackRequest = this.ackRequests.get(requestId);
      switch (response.type) {
        case RedisRequestType.BROADCAST_CLIENT_COUNT: { // Updated type
          ackRequest?.clientCountCallback(response.clientCount);
          break;
        }
        case RedisRequestType.BROADCAST_ACK: { // Updated type
          ackRequest?.ack(response.packet);
          break;
        }
      }
      return;
    }

    if (!requestId || !this.requests.has(requestId)) {
      debug("ignoring unknown request");
      return;
    }

    debug("received response %j", response);
    const request = this.requests.get(requestId);

    switch (request.type) {
      case RedisRequestType.SOCKETS: // Updated type
      case RedisRequestType.REMOTE_FETCH: // Updated type
        request.msgCount++;
        if (!response.sockets || !Array.isArray(response.sockets)) return;
        if (request.type === RedisRequestType.SOCKETS) { // Updated type
          response.sockets.forEach((s) => request.sockets.add(s));
        } else {
          response.sockets.forEach((s) => request.sockets.push(s));
        }
        if (request.msgCount === request.numSub) {
          clearTimeout(request.timeout);
          if (request.resolve) request.resolve(request.sockets);
          this.requests.delete(requestId);
        }
        break;

      case RedisRequestType.ALL_ROOMS: // Updated type
        request.msgCount++;
        if (!response.rooms || !Array.isArray(response.rooms)) return;
        response.rooms.forEach((s) => request.rooms.add(s));
        if (request.msgCount === request.numSub) {
          clearTimeout(request.timeout);
          if (request.resolve) request.resolve(request.rooms);
          this.requests.delete(requestId);
        }
        break;

      case RedisRequestType.REMOTE_JOIN: // Updated type
      case RedisRequestType.REMOTE_LEAVE: // Updated type
      case RedisRequestType.REMOTE_DISCONNECT: // Updated type
        clearTimeout(request.timeout);
        if (request.resolve) request.resolve();
        this.requests.delete(requestId);
        break;

      case RedisRequestType.SERVER_SIDE_EMIT: // Updated type
        request.responses.push(response.data);
        debug("serverSideEmit: got %d responses out of %d", request.responses.length, request.numSub);
        if (request.responses.length === request.numSub) {
          clearTimeout(request.timeout);
          if (request.resolve) request.resolve(null, request.responses);
          this.requests.delete(requestId);
        }
        break;

      default:
        debug("ignoring unknown request type: %s", request.type);
    }
  }

  public broadcast(packet: any, opts: BroadcastOptions) {
    packet.nsp = this.nsp.name;
    const onlyLocal = opts && opts.flags && opts.flags.local;
    if (!onlyLocal) {
      const rawOpts = {
        rooms: [...opts.rooms],
        except: [...new Set(opts.except)],
        flags: opts.flags,
      };
      const msg = this.parser.encode([this.uid, packet, rawOpts]);
      let channel = this.channel;
      if (opts.rooms && opts.rooms.size === 1) {
        channel += opts.rooms.keys().next().value + "#";
      }
      debug("publishing message to channel %s", channel);
      this.pubClient.publish(channel, msg);
    }
    super.broadcast(packet, opts);
  }

  public broadcastWithAck(
    packet: any,
    opts: BroadcastOptions,
    clientCountCallback: (clientCount: number) => void,
    ack: (...args: any[]) => void
  ) {
    packet.nsp = this.nsp.name;
    const onlyLocal = opts?.flags?.local;
    if (!onlyLocal) {
      const requestId = uid2(6);
      const rawOpts = {
        rooms: [...opts.rooms],
        except: [...new Set(opts.except)],
        flags: opts.flags,
      };
      const request = this.parser.encode({
        uid: this.uid,
        requestId,
        type: RedisRequestType.BROADCAST, // Updated type
        packet,
        opts: rawOpts,
      });
      this.pubClient.publish(this.requestChannel, request);
      this.ackRequests.set(requestId, { clientCountCallback, ack });
      setTimeout(() => {
        this.ackRequests.delete(requestId);
      }, opts.flags!.timeout);
    }
    super.broadcastWithAck(packet, opts, clientCountCallback, ack);
  }

  public async allRooms(): Promise<Set<Room>> {
    const localRooms = new Set(this.rooms.keys());
    const numSub = await this.serverCount();
    debug('waiting for %d responses to "allRooms" request', numSub);
    if (numSub <= 1) return localRooms;
    const requestId = uid2(6);
    const request = JSON.stringify({
      uid: this.uid,
      requestId,
      type: RedisRequestType.ALL_ROOMS, // Updated type
    });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.requests.has(requestId)) {
          reject(new Error("timeout reached while waiting for allRooms response"));
          this.requests.delete(requestId);
        }
      }, this.requestsTimeout);
      this.requests.set(requestId, {
        type: RedisRequestType.ALL_ROOMS, // Updated type
        numSub, resolve, timeout, msgCount: 1, rooms: localRooms,
      });
      this.pubClient.publish(this.requestChannel, request);
    });
  }

  public async fetchSockets(opts: BroadcastOptions): Promise<any[]> {
    const localSockets = await super.fetchSockets(opts);
    if (opts.flags?.local) return localSockets;
    const numSub = await this.serverCount();
    debug('waiting for %d responses to "fetchSockets" request', numSub);
    if (numSub <= 1) return localSockets;
    const requestId = uid2(6);
    const request = JSON.stringify({
      uid: this.uid,
      requestId,
      type: RedisRequestType.REMOTE_FETCH, // Updated type
      opts: { rooms: [...opts.rooms], except: [...opts.except] },
    });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.requests.has(requestId)) {
          reject(new Error("timeout reached while waiting for fetchSockets response"));
          this.requests.delete(requestId);
        }
      }, this.requestsTimeout);
      this.requests.set(requestId, {
        type: RedisRequestType.REMOTE_FETCH, // Updated type
        numSub, resolve, timeout, msgCount: 1, sockets: localSockets,
      });
      this.pubClient.publish(this.requestChannel, request);
    });
  }

  public addSockets(opts: BroadcastOptions, rooms: Room[]) {
    if (opts.flags?.local) return super.addSockets(opts, rooms);
    const request = JSON.stringify({
      uid: this.uid,
      type: RedisRequestType.REMOTE_JOIN, // Updated type
      opts: { rooms: [...opts.rooms], except: [...opts.except] },
      rooms: [...rooms],
    });
    this.pubClient.publish(this.requestChannel, request);
  }

  public delSockets(opts: BroadcastOptions, rooms: Room[]) {
    if (opts.flags?.local) return super.delSockets(opts, rooms);
    const request = JSON.stringify({
      uid: this.uid,
      type: RedisRequestType.REMOTE_LEAVE, // Updated type
      opts: { rooms: [...opts.rooms], except: [...opts.except] },
      rooms: [...rooms],
    });
    this.pubClient.publish(this.requestChannel, request);
  }

  public disconnectSockets(opts: BroadcastOptions, close: boolean) {
    if (opts.flags?.local) return super.disconnectSockets(opts, close);
    const request = JSON.stringify({
      uid: this.uid,
      type: RedisRequestType.REMOTE_DISCONNECT, // Updated type
      opts: { rooms: [...opts.rooms], except: [...opts.except] },
      close,
    });
    this.pubClient.publish(this.requestChannel, request);
  }

  public serverSideEmit(packet: any[]): void {
    const withAck = typeof packet[packet.length - 1] === "function";
    if (withAck) {
      this.serverSideEmitWithAck(packet).catch(() => {});
      return;
    }
    const request = JSON.stringify({
      uid: this.uid,
      type: RedisRequestType.SERVER_SIDE_EMIT, // Updated type
      data: packet,
    });
    this.pubClient.publish(this.requestChannel, request);
  }

  private async serverSideEmitWithAck(packet: any[]) {
    const ack = packet.pop();
    const numSub = (await this.serverCount()) - 1;
    debug('waiting for %d responses to "serverSideEmit" request', numSub);
    if (numSub <= 0) return ack(null, []);
    const requestId = uid2(6);
    const request = JSON.stringify({
      uid: this.uid,
      requestId,
      type: RedisRequestType.SERVER_SIDE_EMIT, // Updated type
      data: packet,
    });
    const timeout = setTimeout(() => {
      const storedRequest = this.requests.get(requestId);
      if (storedRequest) {
        ack(
          new Error(`timeout reached: only ${storedRequest.responses.length} responses received out of ${storedRequest.numSub}`),
          storedRequest.responses
        );
        this.requests.delete(requestId);
      }
    }, this.requestsTimeout);
    this.requests.set(requestId, {
      type: RedisRequestType.SERVER_SIDE_EMIT, // Updated type
      numSub, timeout, resolve: ack, responses: [],
    });
    this.pubClient.publish(this.requestChannel, request);
  }

  override serverCount(): Promise<number> {
    return PUBSUB(this.pubClient, "NUMSUB", this.requestChannel);
  }

  close(): Promise<void> | void {
    const isRedisV4 = typeof this.pubClient.pSubscribe === "function";
    if (isRedisV4) {
      this.subClient.pUnsubscribe(this.channel + "*", this.redisListeners.get("psub"), true);
      this.subClient.unsubscribe(this.requestChannel, this.redisListeners.get("sub"), true);
      this.subClient.unsubscribe(this.responseChannel, this.redisListeners.get("sub"), true);
      this.subClient.unsubscribe(this.specificResponseChannel, this.redisListeners.get("sub"), true);
    } else {
      this.subClient.punsubscribe(this.channel + "*");
      this.subClient.off("pmessageBuffer", this.redisListeners.get("pmessageBuffer"));
      this.subClient.unsubscribe([this.requestChannel, this.responseChannel, this.specificResponseChannel]);
      this.subClient.off("messageBuffer", this.redisListeners.get("messageBuffer"));
    }
    this.pubClient.off("error", this.friendlyErrorHandler);
    this.subClient.off("error", this.friendlyErrorHandler);
  }
}

// Import for Redis Sharded Adapter
import { createShardedAdapter as createRedisShardedAdapterFactory } from "./sharded-adapter"; // Alias at import

// Named exports
export {
  RedisAdapter,
  RedisAdapterOptions,
  createRedisAdapter, // Export renamed Redis factory
  createRedisShardedAdapterFactory as createRedisShardedAdapter, // Re-export sharded adapter factory
  createHazelcastAdapterFactory as createHazelcastAdapter, // Export aliased Hazelcast factory
  HazelcastAdapterClass as HazelcastAdapter, // Export Hazelcast adapter class
  HazelcastAdapterOptionsType as HazelcastAdapterOptions // Export Hazelcast options type
};
// Also exporting Redis-specific internal types for potential advanced usage or testing, though not strictly public API
export type { RedisRequest, RedisAckRequest, Parser as RedisParser };
export { RedisRequestType };
