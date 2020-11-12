import uid2 = require("uid2");
import { createClient } from "redis";
import msgpack = require("notepack.io");
import { Adapter, BroadcastOptions, Room, SocketId } from "socket.io-adapter";

const debug = require("debug")("socket.io-redis");

/**
 * Request types, for messages between nodes
 */

enum RequestType {
  SOCKETS = 0,
  ALL_ROOMS = 1,
  REMOTE_JOIN = 2,
  REMOTE_LEAVE = 3,
  REMOTE_DISCONNECT = 4,
}

interface Request {
  type: RequestType;
  resolve: Function;
  timeout: NodeJS.Timeout;
  numSub?: number;
  msgCount?: number;
  [other: string]: any;
}

export interface RedisAdapterOptions {
  key: string;
  pubClient: any;
  subClient: any;
  requestsTimeout: number;
}

function createRedisClient(uri, opts) {
  if (uri) {
    // handle uri string
    return createClient(uri, opts);
  } else {
    return createClient(opts);
  }
}

/**
 * Returns a redis Adapter class.
 *
 * @param {String} uri - optional, redis uri
 * @param {String} opts - redis connection options
 * @return {RedisAdapter} adapter
 *
 * @public
 */
export function createAdapter(uri: string, opts?: Partial<RedisAdapterOptions>);
export function createAdapter(
  uri?: string,
  opts: Partial<RedisAdapterOptions> = {}
) {
  // handle options only
  if (typeof uri === "object") {
    opts = uri;
    uri = null;
  }

  return function (nsp) {
    return new RedisAdapter(nsp, uri, opts);
  };
}

export class RedisAdapter extends Adapter {
  public readonly uid;
  public readonly pubClient: any;
  public readonly subClient: any;
  public readonly requestsTimeout: number;

  private readonly channel: string;
  private readonly requestChannel: string;
  private readonly responseChannel: string;
  private requests: Map<string, Request> = new Map();

  /**
   * Adapter constructor.
   *
   * @param nsp - the namespace
   * @param uri - the url of the Redis server
   * @param opts - the options for both the Redis adapter and the Redis client
   *
   * @public
   */
  constructor(nsp, uri: string, opts: Partial<RedisAdapterOptions> = {}) {
    super(nsp);

    this.uid = uid2(6);
    this.pubClient = opts.pubClient || createRedisClient(uri, opts);
    this.subClient = opts.subClient || createRedisClient(uri, opts);
    this.requestsTimeout = opts.requestsTimeout || 5000;

    const prefix = opts.key || "socket.io";

    this.channel = prefix + "#" + nsp.name + "#";
    this.requestChannel = prefix + "-request#" + this.nsp.name + "#";
    this.responseChannel = prefix + "-response#" + this.nsp.name + "#";

    const onError = (err) => {
      if (err) {
        this.emit("error", err);
      }
    };

    this.subClient.psubscribe(this.channel + "*", onError);
    this.subClient.on("pmessageBuffer", this.onmessage.bind(this));

    this.subClient.subscribe(
      [this.requestChannel, this.responseChannel],
      onError
    );
    this.subClient.on("messageBuffer", this.onrequest.bind(this));

    this.pubClient.on("error", onError);
    this.subClient.on("error", onError);
  }

  /**
   * Called with a subscription message
   *
   * @private
   */
  private onmessage(pattern, channel, msg) {
    channel = channel.toString();

    const channelMatches = channel.startsWith(this.channel);
    if (!channelMatches) {
      return debug("ignore different channel");
    }

    const room = channel.slice(this.channel.length, -1);
    if (room !== "" && !this.rooms.has(room)) {
      return debug("ignore unknown room %s", room);
    }

    const args = msgpack.decode(msg);

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

  /**
   * Called on request from another node
   *
   * @private
   */
  private async onrequest(channel, msg) {
    channel = channel.toString();

    if (channel.startsWith(this.responseChannel)) {
      return this.onresponse(channel, msg);
    } else if (!channel.startsWith(this.requestChannel)) {
      return debug("ignore different channel");
    }

    let request;

    try {
      request = JSON.parse(msg);
    } catch (err) {
      this.emit("error", err);
      return;
    }

    debug("received request %j", request);

    let response, socket;

    switch (request.type) {
      case RequestType.SOCKETS:
        const sockets = await super.sockets(new Set(request.rooms));

        response = JSON.stringify({
          requestId: request.requestId,
          sockets: [...sockets],
        });

        this.pubClient.publish(this.responseChannel, response);
        break;

      case RequestType.ALL_ROOMS:
        response = JSON.stringify({
          requestId: request.requestId,
          rooms: [...this.rooms.keys()],
        });

        this.pubClient.publish(this.responseChannel, response);
        break;

      case RequestType.REMOTE_JOIN:
        socket = this.nsp.sockets.get(request.sid);
        if (!socket) {
          return;
        }

        socket.join(request.room);

        response = JSON.stringify({
          requestId: request.requestId,
        });

        this.pubClient.publish(this.responseChannel, response);
        break;

      case RequestType.REMOTE_LEAVE:
        socket = this.nsp.sockets.get(request.sid);
        if (!socket) {
          return;
        }

        socket.leave(request.room);

        response = JSON.stringify({
          requestId: request.requestId,
        });

        this.pubClient.publish(this.responseChannel, response);
        break;

      case RequestType.REMOTE_DISCONNECT:
        socket = this.nsp.sockets.get(request.sid);
        if (!socket) {
          return;
        }

        socket.disconnect(request.close);

        response = JSON.stringify({
          requestId: request.requestId,
        });

        this.pubClient.publish(this.responseChannel, response);
        break;

      default:
        debug("ignoring unknown request type: %s", request.type);
    }
  }

  /**
   * Called on response from another node
   *
   * @private
   */
  private onresponse(channel, msg) {
    let response;

    try {
      response = JSON.parse(msg);
    } catch (err) {
      this.emit("error", err);
      return;
    }

    const requestId = response.requestId;

    if (!requestId || !this.requests.has(requestId)) {
      debug("ignoring unknown request");
      return;
    }

    debug("received response %j", response);

    const request = this.requests.get(requestId);

    switch (request.type) {
      case RequestType.SOCKETS:
        request.msgCount++;

        // ignore if response does not contain 'sockets' key
        if (!response.sockets || !Array.isArray(response.sockets)) return;

        response.sockets.forEach((s) => request.sockets.add(s));

        if (request.msgCount === request.numSub) {
          clearTimeout(request.timeout);
          if (request.resolve) {
            request.resolve(request.sockets);
          }
          this.requests.delete(requestId);
        }
        break;

      case RequestType.ALL_ROOMS:
        request.msgCount++;

        // ignore if response does not contain 'rooms' key
        if (!response.rooms || !Array.isArray(response.rooms)) return;

        response.rooms.forEach((s) => request.rooms.add(s));

        if (request.msgCount === request.numSub) {
          clearTimeout(request.timeout);
          if (request.resolve) {
            request.resolve(request.rooms);
          }
          this.requests.delete(requestId);
        }
        break;

      case RequestType.REMOTE_JOIN:
      case RequestType.REMOTE_LEAVE:
      case RequestType.REMOTE_DISCONNECT:
        clearTimeout(request.timeout);
        if (request.resolve) {
          request.resolve();
        }
        this.requests.delete(requestId);
        break;

      default:
        debug("ignoring unknown request type: %s", request.type);
    }
  }

  /**
   * Broadcasts a packet.
   *
   * @param {Object} packet - packet to emit
   * @param {Object} opts - options
   *
   * @public
   */
  public broadcast(packet: any, opts: BroadcastOptions) {
    packet.nsp = this.nsp.name;

    const onlyLocal = opts && opts.flags && opts.flags.local;

    if (!onlyLocal) {
      const rawOpts = {
        rooms: [...opts.rooms],
        except: [...opts.except],
        flags: opts.flags,
      };
      const msg = msgpack.encode([this.uid, packet, rawOpts]);
      let channel = this.channel;
      if (opts.rooms && opts.rooms.size === 1) {
        channel += opts.rooms.keys().next().value + "#";
      }
      debug("publishing message to channel %s", channel);
      this.pubClient.publish(channel, msg);
    }
    super.broadcast(packet, opts);
  }

  /**
   * Gets a list of sockets by sid.
   *
   * @param {Set<Room>} rooms   the explicit set of rooms to check.
   */
  public async sockets(rooms: Set<Room>): Promise<Set<SocketId>> {
    const requestId = uid2(6);

    const numSub = await this.getNumSub();
    debug('waiting for %d responses to "sockets" request', numSub);

    const request = JSON.stringify({
      requestId,
      type: RequestType.SOCKETS,
      rooms: [...rooms],
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.requests.has(requestId)) {
          reject(
            new Error("timeout reached while waiting for sockets response")
          );
          this.requests.delete(requestId);
        }
      }, this.requestsTimeout);

      this.requests.set(requestId, {
        type: RequestType.SOCKETS,
        numSub,
        resolve,
        timeout,
        msgCount: 0,
        sockets: new Set(),
      });

      this.pubClient.publish(this.requestChannel, request);
    });
  }

  /**
   * Gets the list of all rooms (across every node)
   *
   * @public
   */
  public async allRooms(): Promise<Set<Room>> {
    const requestId = uid2(6);

    const numSub = await this.getNumSub();
    debug('waiting for %d responses to "allRooms" request', numSub);

    const request = JSON.stringify({
      requestId,
      type: RequestType.ALL_ROOMS,
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.requests.has(requestId)) {
          reject(
            new Error("timeout reached while waiting for allRooms response")
          );
          this.requests.delete(requestId);
        }
      }, this.requestsTimeout);

      this.requests.set(requestId, {
        type: RequestType.ALL_ROOMS,
        numSub,
        resolve,
        timeout,
        msgCount: 0,
        rooms: new Set(),
      });

      this.pubClient.publish(this.requestChannel, request);
    });
  }

  /**
   * Makes the socket with the given id join the room
   *
   * @param {String} id - socket id
   * @param {String} room - room name
   * @public
   */
  public remoteJoin(id: SocketId, room: Room): Promise<void> {
    const requestId = uid2(6);

    const socket = this.nsp.sockets.get(id);
    if (socket) {
      socket.join(room);
      return Promise.resolve();
    }

    const request = JSON.stringify({
      requestId,
      type: RequestType.REMOTE_JOIN,
      sid: id,
      room,
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.requests.has(requestId)) {
          reject(
            new Error("timeout reached while waiting for remoteJoin response")
          );
          this.requests.delete(requestId);
        }
      }, this.requestsTimeout);

      this.requests.set(requestId, {
        type: RequestType.REMOTE_JOIN,
        resolve,
        timeout,
      });

      this.pubClient.publish(this.requestChannel, request);
    });
  }

  /**
   * Makes the socket with the given id leave the room
   *
   * @param {String} id - socket id
   * @param {String} room - room name
   * @public
   */
  public remoteLeave(id: SocketId, room: Room): Promise<void> {
    const requestId = uid2(6);

    const socket = this.nsp.sockets.get(id);
    if (socket) {
      socket.leave(room);
      return Promise.resolve();
    }

    const request = JSON.stringify({
      requestId,
      type: RequestType.REMOTE_LEAVE,
      sid: id,
      room,
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.requests.has(requestId)) {
          reject(
            new Error("timeout reached while waiting for remoteLeave response")
          );
          this.requests.delete(requestId);
        }
      }, this.requestsTimeout);

      this.requests.set(requestId, {
        type: RequestType.REMOTE_LEAVE,
        resolve,
        timeout,
      });

      this.pubClient.publish(this.requestChannel, request);
    });
  }

  /**
   * Makes the socket with the given id to be forcefully disconnected
   * @param {String} id - socket id
   * @param {Boolean} close - if `true`, closes the underlying connection
   *
   * @public
   */
  public remoteDisconnect(id: SocketId, close?: boolean): Promise<void> {
    const requestId = uid2(6);

    const socket = this.nsp.sockets.get(id);
    if (socket) {
      socket.disconnect(close);
      return Promise.resolve();
    }

    const request = JSON.stringify({
      requestId,
      type: RequestType.REMOTE_DISCONNECT,
      sid: id,
      close,
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.requests.has(requestId)) {
          reject(
            new Error(
              "timeout reached while waiting for remoteDisconnect response"
            )
          );
          this.requests.delete(requestId);
        }
      }, this.requestsTimeout);

      this.requests.set(requestId, {
        type: RequestType.REMOTE_DISCONNECT,
        resolve,
        timeout,
      });

      this.pubClient.publish(this.requestChannel, request);
    });
  }

  /**
   * Get the number of subscribers of the request channel
   *
   * @private
   */

  private getNumSub(): Promise<number> {
    if (this.pubClient.constructor.name === "Cluster") {
      // Cluster
      const nodes = this.pubClient.nodes();
      return Promise.all(
        nodes.map((node) =>
          node.send_command("pubsub", ["numsub", this.requestChannel])
        )
      ).then((values) => {
        let numSub = 0;
        values.map((value) => {
          numSub += parseInt(value[1], 10);
        });
        return numSub;
      });
    } else {
      // RedisClient or Redis
      return new Promise((resolve, reject) => {
        this.pubClient.send_command(
          "pubsub",
          ["numsub", this.requestChannel],
          (err, numSub) => {
            if (err) return reject(err);
            resolve(parseInt(numSub[1], 10));
          }
        );
      });
    }
  }
}

module.exports = createAdapter;
