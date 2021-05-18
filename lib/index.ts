import uid2 = require("uid2");
import msgpack = require("notepack.io");
import { Adapter, BroadcastOptions, Room, SocketId } from "socket.io-adapter";

const debug = require("debug")("socket.io-redis");

module.exports = exports = createAdapter;

/**
 * Request types, for messages between nodes
 */

enum RequestType {
  SOCKETS = 0,
  ALL_ROOMS = 1,
  REMOTE_JOIN = 2,
  REMOTE_LEAVE = 3,
  REMOTE_DISCONNECT = 4,
  REMOTE_FETCH = 5,
  SERVER_SIDE_EMIT = 6,
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
}

/**
 * Returns a function that will create a RedisAdapter instance.
 *
 * @param pubClient - a Redis client that will be used to publish messages
 * @param subClient - a Redis client that will be used to receive messages (put in subscribed state)
 * @param opts - additional options
 *
 * @public
 */
export function createAdapter(
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

  private readonly channel: string;
  private readonly participantChannel: string;
  private readonly requestChannel: string;
  private readonly responseChannel: string;
  private requests: Map<string, Request> = new Map();

  /**
   * Adapter constructor.
   *
   * @param nsp - the namespace
   * @param pubClient - a Redis client that will be used to publish messages
   * @param subClient - a Redis client that will be used to receive messages (put in subscribed state)
   * @param opts - additional options
   *
   * @public
   */
  constructor(
    nsp: any,
    readonly pubClient: any,
    readonly subClient: any,
    opts: Partial<RedisAdapterOptions> = {}
  ) {
    super(nsp);

    this.uid = uid2(6);
    this.requestsTimeout = opts.requestsTimeout || 5000;

    const prefix = opts.key || "socket.io";

    this.channel = prefix + "#" + nsp.name + "#";
    this.participantChannel = prefix + "-participant#" + this.nsp.name + "#";
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
      [this.participantChannel, this.requestChannel, this.responseChannel],
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
        if (this.requests.has(request.requestId)) {
          return;
        }

        const sockets = await super.sockets(new Set(request.rooms));

        response = JSON.stringify({
          requestId: request.requestId,
          sockets: [...sockets],
        });

        this.pubClient.publish(this.responseChannel, response);
        break;

      case RequestType.ALL_ROOMS:
        if (this.requests.has(request.requestId)) {
          return;
        }

        response = JSON.stringify({
          requestId: request.requestId,
          rooms: [...this.rooms.keys()],
        });

        this.pubClient.publish(this.responseChannel, response);
        break;

      case RequestType.REMOTE_JOIN:
        if (request.opts) {
          const opts = {
            rooms: new Set<Room>(request.opts.rooms),
            except: new Set<Room>(request.opts.except),
          };
          return super.addSockets(opts, request.rooms);
        }

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
        if (request.opts) {
          const opts = {
            rooms: new Set<Room>(request.opts.rooms),
            except: new Set<Room>(request.opts.except),
          };
          return super.delSockets(opts, request.rooms);
        }

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
        if (request.opts) {
          const opts = {
            rooms: new Set<Room>(request.opts.rooms),
            except: new Set<Room>(request.opts.except),
          };
          return super.disconnectSockets(opts, request.close);
        }

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

      case RequestType.REMOTE_FETCH:
        if (this.requests.has(request.requestId)) {
          return;
        }

        const opts = {
          rooms: new Set<Room>(request.opts.rooms),
          except: new Set<Room>(request.opts.except),
        };
        const localSockets = await super.fetchSockets(opts);

        response = JSON.stringify({
          requestId: request.requestId,
          sockets: localSockets.map((socket) => ({
            id: socket.id,
            handshake: socket.handshake,
            rooms: [...socket.rooms],
            data: socket.data,
          })),
        });

        this.pubClient.publish(this.responseChannel, response);
        break;

      case RequestType.SERVER_SIDE_EMIT:
        if (request.uid === this.uid) {
          debug("ignore same uid");
          return;
        }
        const withAck = request.requestId !== undefined;
        if (!withAck) {
          this.nsp._onServerSideEmit(request.data);
          return;
        }
        let called = false;
        const callback = (arg) => {
          // only one argument is expected
          if (called) {
            return;
          }
          called = true;
          debug("calling acknowledgement with %j", arg);
          this.pubClient.publish(
            this.responseChannel,
            JSON.stringify({
              type: RequestType.SERVER_SIDE_EMIT,
              requestId: request.requestId,
              data: arg,
            })
          );
        };
        request.data.push(callback);
        this.nsp._onServerSideEmit(request.data);
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
      case RequestType.REMOTE_FETCH:
        request.msgCount++;

        // ignore if response does not contain 'sockets' key
        if (!response.sockets || !Array.isArray(response.sockets)) return;

        if (request.type === RequestType.SOCKETS) {
          response.sockets.forEach((s) => request.sockets.add(s));
        } else {
          response.sockets.forEach((s) => request.sockets.push(s));
        }

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

      case RequestType.SERVER_SIDE_EMIT:
        request.responses.push(response.data);

        debug(
          "serverSideEmit: got %d responses out of %d",
          request.responses.length,
          request.numSub
        );
        if (request.responses.length === request.numSub) {
          clearTimeout(request.timeout);
          if (request.resolve) {
            request.resolve(null, request.responses);
          }
          this.requests.delete(requestId);
        }
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
        except: [...new Set(opts.except)],
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
    const localSockets = await super.sockets(rooms);
    const numSub = await this.getNumSub();
    debug('waiting for %d responses to "sockets" request', numSub);

    if (numSub <= 1) {
      return Promise.resolve(localSockets);
    }

    const requestId = uid2(6);
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
        msgCount: 1,
        sockets: localSockets,
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
    const localRooms = new Set(this.rooms.keys());
    const numSub = await this.getNumSub();
    debug('waiting for %d responses to "allRooms" request', numSub);

    if (numSub <= 1) {
      return localRooms;
    }

    const requestId = uid2(6);
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
        msgCount: 1,
        rooms: localRooms,
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

  public async fetchSockets(opts: BroadcastOptions): Promise<any[]> {
    const localSockets = await super.fetchSockets(opts);

    if (opts.flags?.local) {
      return localSockets;
    }

    const numSub = await this.getNumSub();
    debug('waiting for %d responses to "fetchSockets" request', numSub);

    if (numSub <= 1) {
      return localSockets;
    }

    const requestId = uid2(6);

    const request = JSON.stringify({
      requestId,
      type: RequestType.REMOTE_FETCH,
      opts: {
        rooms: [...opts.rooms],
        except: [...opts.except],
      },
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.requests.has(requestId)) {
          reject(
            new Error("timeout reached while waiting for fetchSockets response")
          );
          this.requests.delete(requestId);
        }
      }, this.requestsTimeout);

      this.requests.set(requestId, {
        type: RequestType.REMOTE_FETCH,
        numSub,
        resolve,
        timeout,
        msgCount: 1,
        sockets: localSockets,
      });

      this.pubClient.publish(this.requestChannel, request);
    });
  }

  public addSockets(opts: BroadcastOptions, rooms: Room[]) {
    if (opts.flags?.local) {
      return super.addSockets(opts, rooms);
    }

    const request = JSON.stringify({
      type: RequestType.REMOTE_JOIN,
      opts: {
        rooms: [...opts.rooms],
        except: [...opts.except],
      },
      rooms: [...rooms],
    });

    this.pubClient.publish(this.requestChannel, request);
  }

  public delSockets(opts: BroadcastOptions, rooms: Room[]) {
    if (opts.flags?.local) {
      return super.delSockets(opts, rooms);
    }

    const request = JSON.stringify({
      type: RequestType.REMOTE_LEAVE,
      opts: {
        rooms: [...opts.rooms],
        except: [...opts.except],
      },
      rooms: [...rooms],
    });

    this.pubClient.publish(this.requestChannel, request);
  }

  public disconnectSockets(opts: BroadcastOptions, close: boolean) {
    if (opts.flags?.local) {
      return super.disconnectSockets(opts, close);
    }

    const request = JSON.stringify({
      type: RequestType.REMOTE_DISCONNECT,
      opts: {
        rooms: [...opts.rooms],
        except: [...opts.except],
      },
      close,
    });

    this.pubClient.publish(this.requestChannel, request);
  }

  public serverSideEmit(packet: any[]): void {
    const withAck = typeof packet[packet.length - 1] === "function";

    if (withAck) {
      this.serverSideEmitWithAck(packet).catch(() => {
        // ignore errors
      });
      return;
    }

    const request = JSON.stringify({
      uid: this.uid,
      type: RequestType.SERVER_SIDE_EMIT,
      data: packet,
    });

    this.pubClient.publish(this.requestChannel, request);
  }

  private async serverSideEmitWithAck(packet: any[]) {
    const ack = packet.pop();
    const numSub = (await this.getNumSub()) - 1; // ignore self

    debug('waiting for %d responses to "serverSideEmit" request', numSub);

    if (numSub <= 0) {
      return ack(null, []);
    }

    const requestId = uid2(6);
    const request = JSON.stringify({
      uid: this.uid,
      requestId, // the presence of this attribute defines whether an acknowledgement is needed
      type: RequestType.SERVER_SIDE_EMIT,
      data: packet,
    });

    const timeout = setTimeout(() => {
      const storedRequest = this.requests.get(requestId);
      if (storedRequest) {
        ack(
          new Error(
            `timeout reached: only ${storedRequest.responses.length} responses received out of ${storedRequest.numSub}`
          ),
          storedRequest.responses
        );
        this.requests.delete(requestId);
      }
    }, this.requestsTimeout);

    this.requests.set(requestId, {
      type: RequestType.SERVER_SIDE_EMIT,
      numSub,
      timeout,
      resolve: ack,
      responses: [],
    });

    this.pubClient.publish(this.requestChannel, request);
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
          node.send_command("pubsub", [
            "numsub",
            this.requestChannel,
            this.participantChannel,
          ])
        )
      ).then((values) => {
        let numSub = 0;
        values.map((value) => {
          // Fall back to requestChannel for backwards compatibility
          numSub += parseInt(value[3] || value[1], 10);
        });
        return numSub;
      });
    } else {
      // RedisClient or Redis
      return new Promise((resolve, reject) => {
        this.pubClient.send_command(
          "pubsub",
          ["numsub", this.requestChannel, this.participantChannel],
          (err, numSub) => {
            if (err) return reject(err);
            // Fall back to requestChannel for backwards compatibility
            resolve(parseInt(numSub[3] || numSub[1], 10));
          }
        );
      });
    }
  }
}
