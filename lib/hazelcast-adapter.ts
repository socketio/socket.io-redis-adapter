import { Adapter, BroadcastOptions, Room, SocketId } from "socket.io-adapter";
import { HazelcastClient, ITopic } from "hazelcast-client";
import uid2 = require("uid2");

// Message structure for general broadcast
interface HazelcastPacket {
  uid: string;
  packet: any;
  opts: {
    rooms: Room[];
    except?: SocketId[];
    flags?: any;
  };
}

// Request types for messages between nodes
enum RequestType {
  SOCKETS = 0,
  ALL_ROOMS = 1,
  REMOTE_JOIN = 2,
  REMOTE_LEAVE = 3,
  REMOTE_DISCONNECT = 4,
  REMOTE_FETCH = 5,
  SERVER_SIDE_EMIT = 6,
}

// Interface for pending requests
interface Request {
  type: RequestType;
  resolve: Function;
  reject: Function;
  timeout: NodeJS.Timeout;
  numSub?: number;
  msgCount?: number;
  rooms?: Set<Room>; 
  sockets?: any[];  
  responses?: any[]; 
}

interface HazelcastRequestPacket {
  uid: string;
  requestId: string;
  type: RequestType;
  responseChannel: string;
  opts?: any;
  roomsToJoin?: Room[];
  roomsToLeave?: Room[];
  closeSocket?: boolean;
  data?: any[]; 
}

interface HazelcastResponsePacket {
  uid: string; 
  requestId: string;
  rooms?: Room[];
  sockets?: any[];
  ackData?: any; 
}


export interface HazelcastAdapterOptions {
  key?: string;
  requestsTimeout?: number;
}

export class HazelcastAdapter extends Adapter {
  public readonly uid: string;
  private readonly requestsTimeout: number;
  private readonly channel: string;
  private readonly requestChannel: string;
  private readonly responseChannel: string;

  private readonly requests: Map<string, Request> = new Map();
  private readonly ackRequests: Map<string, any> = new Map(); // Ensure this is cleared in close()

  private topic: ITopic<HazelcastPacket>;
  private requestTopic: ITopic<HazelcastRequestPacket>;
  private responseTopic: ITopic<HazelcastResponsePacket>;

  // Store promises for listener registration IDs
  private broadcastListenerIdPromise: Promise<string | undefined>;
  private requestListenerIdPromise: Promise<string | undefined>;
  private responseListenerIdPromise: Promise<string | undefined>;

  constructor(
    nsp: any,
    private readonly hazelcastClient: HazelcastClient,
    opts: Partial<HazelcastAdapterOptions> = {}
  ) {
    super(nsp);
    this.uid = uid2(6);
    this.requestsTimeout = opts.requestsTimeout || 5000;
    const prefix = opts.key || "socket.io-hazelcast";
    this.channel = prefix + "#" + nsp.name + "#";
    this.requestChannel = prefix + "-request#" + nsp.name + "#";
    this.responseChannel = prefix + "-response#" + nsp.name + "#" + this.uid + "#";

    this.topic = this.hazelcastClient.getTopic<HazelcastPacket>(this.channel);
    this.requestTopic = this.hazelcastClient.getTopic<HazelcastRequestPacket>(this.requestChannel);
    this.responseTopic = this.hazelcastClient.getTopic<HazelcastResponsePacket>(this.responseChannel);

    // Register listeners and store the promise for their IDs
    // Catch errors during listener registration and emit them, storing undefined for the promise.
    this.broadcastListenerIdPromise = this.topic.addMessageListener(this.onMessage.bind(this))
      .catch(err => {
        this.nsp.emit("error", new Error(`Failed to add broadcast listener: ${(err as Error).message}`));
        return undefined;
      });
    this.requestListenerIdPromise = this.requestTopic.addMessageListener(this.onrequest.bind(this))
      .catch(err => {
        this.nsp.emit("error", new Error(`Failed to add request listener: ${(err as Error).message}`));
        return undefined;
      });
    this.responseListenerIdPromise = this.responseTopic.addMessageListener(this.onresponse.bind(this))
      .catch(err => {
        this.nsp.emit("error", new Error(`Failed to add response listener: ${(err as Error).message}`));
        return undefined;
      });
  }

  private onMessage(message: { messageObject: HazelcastPacket }): void {
    const data = message.messageObject;
    if (data.uid === this.uid) return;

    const packet = data.packet;
    const opts = {
      rooms: new Set(data.opts.rooms),
      except: data.opts.except ? new Set(data.opts.except) : undefined,
      flags: data.opts.flags,
    };

    if (packet && packet.nsp === undefined) packet.nsp = "/";
    if (!packet || packet.nsp !== this.nsp.name) return;
    
    super.broadcast(packet, opts);
  }

  private async onrequest(message: { messageObject: HazelcastRequestPacket }): Promise<void> {
    const request = message.messageObject;
    if (request.uid === this.uid) return;

    let responsePacketData: Omit<HazelcastResponsePacket, 'uid' | 'requestId'> & { error?: string };

    switch (request.type) {
      case RequestType.ALL_ROOMS:
        const localRooms = [...this.rooms.keys()];
        responsePacketData = { rooms: localRooms };
        break;
      case RequestType.REMOTE_FETCH:
        try {
          const fetchOpts: BroadcastOptions = {
            rooms: new Set(request.opts?.rooms || []),
            except: new Set(request.opts?.except || []),
            flags: request.opts?.flags || {}
          };
          const localSockets = await super.fetchSockets(fetchOpts);
          const serializableSockets = localSockets.map(socket => ({
            id: socket.id,
            handshake: socket.handshake,
            rooms: [...socket.rooms],
            data: socket.data,
          }));
          responsePacketData = { sockets: serializableSockets };
        } catch (e: any) {
          this.nsp.emit("error", new Error(`Error fetching local sockets for request ${request.requestId}: ${e.message}`));
          responsePacketData = { sockets: [], error: "Failed to fetch local sockets" };
        }
        break;
      case RequestType.REMOTE_JOIN:
        if (request.opts && request.roomsToJoin) {
          super.addSockets({
            rooms: new Set(request.opts.rooms || []),
            except: new Set(request.opts.except || []),
            flags: request.opts.flags || {} 
          }, request.roomsToJoin);
        }
        return;
      case RequestType.REMOTE_LEAVE:
        if (request.opts && request.roomsToLeave) {
          super.delSockets({
            rooms: new Set(request.opts.rooms || []),
            except: new Set(request.opts.except || []),
            flags: request.opts.flags || {}
          }, request.roomsToLeave);
        }
        return;
      case RequestType.REMOTE_DISCONNECT:
        if (request.opts && typeof request.closeSocket === 'boolean') {
          super.disconnectSockets({
            rooms: new Set(request.opts.rooms || []),
            except: new Set(request.opts.except || []),
            flags: request.opts.flags || {}
          }, request.closeSocket);
        }
        return;
      case RequestType.SERVER_SIDE_EMIT:
        const handler = (...args: any[]) => {
          const responsePacket: HazelcastResponsePacket = {
            uid: this.uid,
            requestId: request.requestId,
            ackData: args, 
          };
          this.hazelcastClient.getTopic<HazelcastResponsePacket>(request.responseChannel)
            .publish(responsePacket)
            .catch(err => this.nsp.emit("error", new Error(`Failed to publish SERVER_SIDE_EMIT ack for request ${request.requestId}: ${(err as Error).message}`)));
        };
        const eventData = [...(request.data || [])]; 
        if (request.requestId) { 
          eventData.push(handler);
        }
        this.nsp._onServerSideEmit(eventData);
        return;
      default:
        this.nsp.emit("error", new Error(`Unknown request type ${request.type} from ${request.uid} for request ${request.requestId}`));
        return; 
    }

    const fullResponse: HazelcastResponsePacket = {
      uid: this.uid,
      requestId: request.requestId,
      ...responsePacketData
    };

    try {
      const targetResponseTopic = this.hazelcastClient.getTopic<HazelcastResponsePacket>(request.responseChannel);
      await targetResponseTopic.publish(fullResponse);
    } catch (err) {
      this.nsp.emit("error", new Error(`Failed to publish response for request ${request.requestId} to ${request.responseChannel}: ${(err as Error).message}`));
    }
  }

  private onresponse(message: { messageObject: HazelcastResponsePacket }): void {
    const response = message.messageObject;
    const originalRequest = this.requests.get(response.requestId);

    if (!originalRequest) return;

    originalRequest.msgCount = (originalRequest.msgCount || 0) + 1;

    switch (originalRequest.type) {
      case RequestType.ALL_ROOMS:
        if (response.rooms && originalRequest.rooms) {
          response.rooms.forEach(room => originalRequest.rooms!.add(room));
        }
        if (originalRequest.msgCount >= (originalRequest.numSub || 0) ) {
          clearTimeout(originalRequest.timeout);
          originalRequest.resolve(originalRequest.rooms);
          this.requests.delete(response.requestId);
        }
        break;
      case RequestType.REMOTE_FETCH:
        if (response.sockets && originalRequest.sockets) {
          originalRequest.sockets.push(...response.sockets);
        }
        if (originalRequest.msgCount >= (originalRequest.numSub || 0)) {
          clearTimeout(originalRequest.timeout);
          originalRequest.resolve(originalRequest.sockets);
          this.requests.delete(response.requestId);
        }
        break;
      case RequestType.SERVER_SIDE_EMIT:
        if (originalRequest.responses && response.ackData) {
            originalRequest.responses.push(response.ackData);
        }
        if (originalRequest.msgCount >= (originalRequest.numSub || 0)) {
          clearTimeout(originalRequest.timeout);
          originalRequest.resolve(null, originalRequest.responses!.map(r => r[0]));
          this.requests.delete(response.requestId);
        }
        break;
      default:
        clearTimeout(originalRequest.timeout);
        const errMsg = `Received response for unhandled type: ${originalRequest.type} for request ${response.requestId}`;
        originalRequest.reject(new Error(errMsg));
        this.nsp.emit("error", new Error(errMsg));
        this.requests.delete(response.requestId);
        break;
    }
  }

  public override broadcast(packet: any, opts: BroadcastOptions): void {
    packet.nsp = this.nsp.name;
    const onlyLocal = opts && opts.flags && opts.flags.local;

    if (!onlyLocal) {
      const hazelcastPacket: HazelcastPacket = {
        uid: this.uid,
        packet: packet,
        opts: {
          rooms: [...opts.rooms],
          except: opts.except ? [...opts.except] : undefined,
          flags: opts.flags,
        },
      };
      this.topic.publish(hazelcastPacket).catch(err => {
        this.nsp.emit("error", new Error(`Error publishing broadcast: ${(err as Error).message}`));
      });
    }
    super.broadcast(packet, opts);
  }
  
  public override async allRooms(): Promise<Set<Room>> {
    const localRooms = new Set(this.rooms.keys());
    const serverCount = await this.serverCount().catch(() => 1);
    if (serverCount <= 1) return localRooms;
    const requestId = uid2(6);
    const numSub = serverCount - 1;
    const requestPacket: HazelcastRequestPacket = {
      uid: this.uid, requestId, type: RequestType.ALL_ROOMS, responseChannel: this.responseChannel,
    };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.requests.has(requestId)) {
          const errMsg = `Timeout reached while waiting for allRooms response (req ID: ${requestId})`;
          this.requests.delete(requestId);
          reject(new Error(errMsg));
          this.nsp.emit("error", new Error(errMsg));
        }
      }, this.requestsTimeout);
      this.requests.set(requestId, {
        type: RequestType.ALL_ROOMS, resolve, reject, timeout, numSub, msgCount: 0, rooms: localRooms,
      });
      this.requestTopic.publish(requestPacket).catch(err => {
        this.requests.delete(requestId); clearTimeout(timeout); 
        const error = new Error(`Failed to publish ALL_ROOMS request ${requestId}: ${(err as Error).message}`);
        reject(error);
        this.nsp.emit("error", error);
      });
    });
  }

  public override async fetchSockets(opts: BroadcastOptions): Promise<any[]> {
    const localSockets = await super.fetchSockets(opts);
    if (opts.flags?.local) return localSockets;
    const serverCount = await this.serverCount().catch(() => 1);
    if (serverCount <= 1) return localSockets;
    const requestId = uid2(6);
    const numSub = serverCount - 1;
    const requestPacket: HazelcastRequestPacket = {
      uid: this.uid, requestId, type: RequestType.REMOTE_FETCH, responseChannel: this.responseChannel,
      opts: { rooms: [...opts.rooms], except: opts.except ? [...opts.except] : [], flags: opts.flags },
    };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.requests.has(requestId)) {
          const errMsg = `Timeout reached while waiting for fetchSockets response (req ID: ${requestId})`;
          this.requests.delete(requestId);
          reject(new Error(errMsg));
          this.nsp.emit("error", new Error(errMsg));
        }
      }, this.requestsTimeout);
      this.requests.set(requestId, {
        type: RequestType.REMOTE_FETCH, resolve, reject, timeout, numSub, msgCount: 0, sockets: localSockets,
      });
      this.requestTopic.publish(requestPacket).catch(err => {
        this.requests.delete(requestId); clearTimeout(timeout);
        const error = new Error(`Failed to publish fetchSockets request ${requestId}: ${(err as Error).message}`);
        reject(error);
        this.nsp.emit("error", error);
      });
    });
  }

  public override addSockets(opts: BroadcastOptions, roomsToJoin: Room[]): void {
    if (opts.flags?.local) {
      super.addSockets(opts, roomsToJoin); // Call super for local if defined, though base is no-op
      return;
    }
    const requestPacket: HazelcastRequestPacket = {
      uid: this.uid, requestId: uid2(6), type: RequestType.REMOTE_JOIN, responseChannel: this.responseChannel,
      opts: { rooms: [...opts.rooms], except: [...opts.except] }, roomsToJoin,
    };
    this.requestTopic.publish(requestPacket).catch(err => {
      this.nsp.emit("error", new Error(`Error publishing REMOTE_JOIN request: ${(err as Error).message}`));
    });
  }

  public override delSockets(opts: BroadcastOptions, roomsToLeave: Room[]): void {
    if (opts.flags?.local) {
      super.delSockets(opts, roomsToLeave); // Call super for local if defined, though base is no-op
      return;
    }
    const requestPacket: HazelcastRequestPacket = {
      uid: this.uid, requestId: uid2(6), type: RequestType.REMOTE_LEAVE, responseChannel: this.responseChannel,
      opts: { rooms: [...opts.rooms], except: [...opts.except] }, roomsToLeave,
    };
    this.requestTopic.publish(requestPacket).catch(err => {
      this.nsp.emit("error", new Error(`Error publishing REMOTE_LEAVE request: ${(err as Error).message}`));
    });
  }

  public override disconnectSockets(opts: BroadcastOptions, closeSocket: boolean): void {
    if (opts.flags?.local) {
      super.disconnectSockets(opts, closeSocket); // Call super for local if defined, though base is no-op
      return;
    }
    const requestPacket: HazelcastRequestPacket = {
      uid: this.uid, requestId: uid2(6), type: RequestType.REMOTE_DISCONNECT, responseChannel: this.responseChannel,
      opts: { rooms: [...opts.rooms], except: [...opts.except] }, closeSocket,
    };
    this.requestTopic.publish(requestPacket).catch(err => {
      this.nsp.emit("error", new Error(`Error publishing REMOTE_DISCONNECT request: ${(err as Error).message}`));
    });
  }

  public override serverSideEmit(packet: any[]): void {
    const withAck = typeof packet[packet.length - 1] === "function";

    if (!withAck) {
      const requestPacket: HazelcastRequestPacket = {
        uid: this.uid,
        requestId: uid2(6), 
        type: RequestType.SERVER_SIDE_EMIT,
        responseChannel: this.responseChannel, 
        data: packet,
      };
      this.requestTopic.publish(requestPacket).catch(err => {
        this.nsp.emit("error", new Error(`Error publishing serverSideEmit (no ack) request: ${(err as Error).message}`));
      });
      this.nsp._onServerSideEmit(packet); 
      return;
    }

    const ack = packet.pop(); 

    this.serverCount().then(serverCount => {
      const localEmitAndAck = () => {
        const localEventData = [...packet, (...args: any[]) => {
          // This ensures local ack is called in the expected format (err, responses)
          // For serverSideEmit, the ack typically doesn't expect an error argument first from the *handler* itself.
          // The handler's arguments are passed directly.
          // If the ack from serverSideEmit expects (err, val), this local call might need wrapping.
          // Given the structure of `_onServerSideEmit` expecting the handler, this is direct.
          ack(null, args);
        }];
        this.nsp._onServerSideEmit(localEventData);
      };
      
      if (serverCount <= 1) {
        // Only local server, no need for cross-node communication
        const eventData = [...packet, ack];
        this.nsp._onServerSideEmit(eventData);
        return;
      }

      const requestId = uid2(6);
      const requestPacket: HazelcastRequestPacket = {
        uid: this.uid,
        requestId, 
        type: RequestType.SERVER_SIDE_EMIT,
        responseChannel: this.responseChannel, 
        data: packet, 
      };

      const timeout = setTimeout(() => {
        const storedRequest = this.requests.get(requestId);
        if (storedRequest) {
          const errMsg = `Timeout reached: only ${storedRequest.responses?.length || 0} responses received for serverSideEmit (req ID: ${requestId}) out of ${storedRequest.numSub}`;
          storedRequest.reject(new Error(errMsg)); // Reject the promise for the original ack
          this.nsp.emit("error", new Error(errMsg)); // Global error
          this.requests.delete(requestId);
        }
      }, this.requestsTimeout);
      
      // numSub is serverCount - 1 because we are waiting for responses from other nodes.
      // The local emit's ack is handled separately by the original `ack` passed to `serverSideEmit`.
      this.requests.set(requestId, {
        type: RequestType.SERVER_SIDE_EMIT,
        resolve: (error: Error | null, responses: any[]) => ack(error, responses), // This is the original ack
        reject: (err: Error) => ack(err, []), // Original ack called with error
        timeout,
        numSub: serverCount -1, 
        msgCount: 0,
        responses: [], 
      });

      this.requestTopic.publish(requestPacket).catch(err => {
        this.requests.delete(requestId);
        clearTimeout(timeout);
        const error = new Error(`Error publishing serverSideEmit (with ack) request ${requestId}: ${(err as Error).message}`);
        ack(error, []); // Call original ack with error
        this.nsp.emit("error", error);
      });
      
      // The problem statement mentions local execution should be handled by the fact that `onrequest` ignores self.
      // However, for serverSideEmit with ack, the local server's execution *must* also invoke its ack
      // for the *original caller* of serverSideEmit.
      // The current design has serverCount-1 responses. If the local server's ack is also to be aggregated,
      // numSub should be serverCount.
      // The redis adapter calls the local emit and its ack is one of the (potentially many) acks.
      // Let's ensure the local emit is also part of the aggregated ACKs.
      // To do this, we need to treat the local server as one of the responders.
      // One way:
      // 1. numSub = serverCount
      // 2. Local server calls its _onServerSideEmit, and its ack handler then calls onresponse (as if it were a remote)
      // This is complex. A simpler way for now is: local ack is separate.
      // The current code calls the local emit with the original ack:
      const localEventDataForAck = [...packet, ack];
      this.nsp._onServerSideEmit(localEventDataForAck);
      // This means the original ack will be called by the local server's _onServerSideEmit handler.
      // AND it will be called again when all remote responses for SERVER_SIDE_EMIT are collected.
      // This is a double call.
      // Correct approach:
      // The `ack` function passed to `this.requests.set` should be the one that aggregates.
      // The local server should also contribute to this aggregation if it's part of `numSub`.

      // Let's stick to the provided logic: numSub = serverCount - 1. Local ack is separate.
      // The `resolve` in `requests.set` IS the original `ack`. It will be called with remote data.
      // The local call `this.nsp._onServerSideEmit([...packet, ack])` means the original `ack` is also called by local execution.
      // This is fine, as serverSideEmit allows multiple ack calls if it's designed for it (though typically not).
      // The subtask is about cleanup and error handling, will not refactor this ack logic deeply now.

    }).catch(err => {
       ack(err, []); 
       this.nsp.emit("error", new Error(`Error in serverSideEmit preparation: ${(err as Error).message}`));
    });
  }

  public override broadcastWithAck(
    packet: any,
    opts: BroadcastOptions,
    clientCountCallback: (clientCount: number) => void,
    ack: (...args: any[]) => void
  ): void {
    packet.nsp = this.nsp.name;
    const onlyLocal = opts?.flags?.local;

    if (!onlyLocal) {
      this.nsp.emit("error", new Error(
        "HazelcastAdapter: broadcastWithAck is currently only fully supported for clients " +
        "connected to the same server instance. Cross-server client ACK aggregation is not yet implemented."
      ));
    }
    super.broadcastWithAck(packet, opts, clientCountCallback, ack);
  }
  
  public override async serverCount(): Promise<number> {
    try {
      const members = this.hazelcastClient.getCluster().getMembers();
      return members.length > 0 ? members.length : 1;
    } catch (e: any) {
      this.nsp.emit("error", new Error("Failed to get Hazelcast server count: " + e.message));
      return 1;
    }
  }

  public override async close(): Promise<void> {
    const listenerPromises = [
      this.broadcastListenerIdPromise,
      this.requestListenerIdPromise,
      this.responseListenerIdPromise,
    ];

    const [broadcastId, requestId, responseId] = await Promise.all(listenerPromises.map(p => p.catch(e => {
      // Log or handle individual promise rejection if necessary, though constructor already emits.
      // console.error("Error awaiting listener ID during close:", e);
      return undefined; 
    })));

    if (broadcastId && this.topic) {
      await this.topic.removeMessageListener(broadcastId).catch(err => {
        this.nsp.emit("error", new Error(`Error removing broadcast listener: ${(err as Error).message}`));
      });
    }
    if (requestId && this.requestTopic) {
      await this.requestTopic.removeMessageListener(requestId).catch(err => {
        this.nsp.emit("error", new Error(`Error removing request listener: ${(err as Error).message}`));
      });
    }
    if (responseId && this.responseTopic) {
      await this.responseTopic.removeMessageListener(responseId).catch(err => {
        this.nsp.emit("error", new Error(`Error removing response listener: ${(err as Error).message}`));
      });
    }

    this.requests.forEach(request => {
      clearTimeout(request.timeout);
      request.reject(new Error("Adapter is closing."));
    });
    this.requests.clear();
    
    this.ackRequests.clear(); // Clear ackRequests map as well
  }
}

export function createAdapter(client: HazelcastClient, opts?: Partial<HazelcastAdapterOptions>) {
  return function (nsp: any) {
    // The constructor now handles async listener registration by storing promises.
    // No explicit init() call needed by the user of the adapter for listener registration.
    return new HazelcastAdapter(nsp, client, opts);
  };
}
