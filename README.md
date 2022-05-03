# socket.io-redis

[![Build Status](https://github.com/socketio/socket.io-redis/workflows/CI/badge.svg?branch=main)](https://github.com/socketio/socket.io-redis/actions)
[![npm version](https://badge.fury.io/js/%40socket.io%2Fredis-adapter.svg)](https://badge.fury.io/js/%40socket.io%2Fredis-adapter)

## Table of contents

- [How to use](#how-to-use)
  - [CommonJS](#commonjs)
  - [ES6 module](#es6-modules)
  - [TypeScript](#typescript)
- [Compatibility table](#compatibility-table)
- [How does it work under the hood?](#how-does-it-work-under-the-hood)
- [API](#api)
  - [adapter(uri[, opts])](#adapteruri-opts)
  - [adapter(opts)](#adapteropts)
  - [RedisAdapter](#redisadapter)
    - [RedisAdapter#sockets(rooms: Set<String>)](#redisadaptersocketsrooms-setstring)
    - [RedisAdapter#allRooms()](#redisadapterallrooms)
    - [RedisAdapter#remoteJoin(id:String, room:String)](#redisadapterremotejoinidstring-roomstring)
    - [RedisAdapter#remoteLeave(id:String, room:String)](#redisadapterremoteleaveidstring-roomstring)
    - [RedisAdapter#remoteDisconnect(id:String, close:Boolean)](#redisadapterremotedisconnectidstring-closeboolean)
- [Client error handling](#client-error-handling)
- [Custom client (eg: with authentication)](#custom-client-eg-with-authentication)
- [With ioredis client](#with-ioredishttpsgithubcomluinioredis-client)
  - [Cluster example](#cluster-example)
  - [Sentinel Example](#sentinel-example)
- [Protocol](#protocol)
- [Migrating from `socket.io-redis`](#migrating-from-socketio-redis)
- [License](#license)

## How to use

Installation:

```
$ npm install @socket.io/redis-adapter redis
```

### CommonJS

```js
const { Server } = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');

const io = new Server();
const pubClient = createClient({ host: 'localhost', port: 6379 });
const subClient = pubClient.duplicate();

Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
  io.adapter(createAdapter(pubClient, subClient));
  io.listen(3000);
});
```

With `redis@3`, calling `connect()` on the Redis clients is not needed:

```js
const { Server } = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');

const io = new Server();
const pubClient = createClient({ host: 'localhost', port: 6379 });
const subClient = pubClient.duplicate();

io.adapter(createAdapter(pubClient, subClient));

io.listen(3000);
```

### ES6 modules

```js
import { Server } from 'socket.io';
import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';

const io = new Server();
const pubClient = createClient({ host: 'localhost', port: 6379 });
const subClient = pubClient.duplicate();

Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
  io.adapter(createAdapter(pubClient, subClient));
  io.listen(3000);
});
```

### TypeScript

```ts
import { Server } from 'socket.io';
import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';

const io = new Server();
const pubClient = createClient({ host: 'localhost', port: 6379 });
const subClient = pubClient.duplicate();

Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
  io.adapter(createAdapter(pubClient, subClient));
  io.listen(3000);
});
```

By running Socket.IO with the `@socket.io/redis-adapter` adapter you can run
multiple Socket.IO instances in different processes or servers that can
all broadcast and emit events to and from each other.

So any of the following commands:

```js
io.emit('hello', 'to all clients');
io.to('room42').emit('hello', "to all clients in 'room42' room");

io.on('connection', (socket) => {
  socket.broadcast.emit('hello', 'to all clients except sender');
  socket.to('room42').emit('hello', "to all clients in 'room42' room except sender");
});
```

will properly be broadcast to the clients through the Redis [Pub/Sub mechanism](https://redis.io/topics/pubsub).

If you need to emit events to socket.io instances from a non-socket.io
process, you should use [socket.io-emitter](https://github.com/socketio/socket.io-emitter).

## Compatibility table

| Redis Adapter version | Socket.IO server version |
|-----------------------| ------------------------ |
| 4.x                   | 1.x                      |
| 5.x                   | 2.x                      |
| 6.0.x                 | 3.x                      |
| 6.1.x and above       | 4.x                      |

## How does it work under the hood?

This adapter extends the [in-memory adapter](https://github.com/socketio/socket.io-adapter/) that is included by default with the Socket.IO server.

The in-memory adapter stores the relationships between Sockets and Rooms in two Maps.

When you run `socket.join("room21")`, here's what happens:

```
console.log(adapter.rooms); // Map { "room21" => Set { "mdpk4kxF5CmhwfCdAHD8" } }
console.log(adapter.sids); // Map { "mdpk4kxF5CmhwfCdAHD8" => Set { "mdpk4kxF5CmhwfCdAHD8", "room21" } }
// "mdpk4kxF5CmhwfCdAHD8" being the ID of the given socket
```

Those two Maps are then used when broadcasting:

- a broadcast to all sockets (`io.emit()`) loops through the `sids` Map, and send the packet to all sockets
- a broadcast to a given room (`io.to("room21").emit()`) loops through the Set in the `rooms` Map, and sends the packet to all matching sockets

The Redis adapter extends the broadcast function of the in-memory adapter: the packet is also [published](https://redis.io/topics/pubsub) to a Redis channel (see [below](#protocol) for the format of the channel name).

Each Socket.IO server receives this packet and broadcasts it to its own list of connected sockets.

To check what's happening on your Redis instance:

```
$ redis-cli
127.0.0.1:6379> PSUBSCRIBE *
Reading messages... (press Ctrl-C to quit)
1) "psubscribe"
2) "*"
3) (integer) 1

1) "pmessage"
2) "*"
3) "socket.io#/#" (a broadcast to all sockets or to a list of rooms)
4) <the packet content>

1) "pmessage"
2) "*"
3) "socket.io#/#room21#" (a broadcast to a single room)
4) <the packet content>
```

Note: **no data** is stored in Redis itself

There are 3 Redis subscriptions per namespace:

- main channel: `<prefix>#<namespace>#*` (glob)
- request channel: `<prefix>-request#<namespace>#`
- response channel: `<prefix>-response#<namespace>#`

The request and response channels are used in the additional methods exposed by the Redis adapter, like [RedisAdapter#allRooms()](#redisadapterallrooms).


## API

### adapter(pubClient, subClient[, opts])

The following options are allowed:

- `key`: the name of the key to pub/sub events on as prefix (`socket.io`)
- `requestsTimeout`: optional, after this timeout the adapter will stop waiting from responses to request (`5000ms`)

### RedisAdapter

The redis adapter instances expose the following properties
that a regular `Adapter` does not

- `uid`
- `prefix`
- `pubClient`
- `subClient`
- `requestsTimeout`

### RedisAdapter#sockets(rooms: Set<String>)

Returns the list of socket IDs connected to `rooms` across all nodes. See [Namespace#allSockets()](https://socket.io/docs/v3/server-api/#namespace-allSockets)

```js
const sockets = await io.of('/').adapter.sockets(new Set());
console.log(sockets); // a Set containing all the connected socket ids

const sockets = await io.of('/').adapter.sockets(new Set(['room1', 'room2']));
console.log(sockets); // a Set containing the socket ids in 'room1' or in 'room2'

// this method is also exposed by the Server instance
const sockets = await io.in('room3').allSockets();
console.log(sockets); // a Set containing the socket ids in 'room3'
```

### RedisAdapter#allRooms()

Returns the list of all rooms.

```js
const rooms = await io.of('/').adapter.allRooms();
console.log(rooms); // a Set containing all rooms (across every node)
```

### RedisAdapter#remoteJoin(id:String, room:String)

Makes the socket with the given id join the room.

```js
try {
  await io.of('/').adapter.remoteJoin('<my-id>', 'room1');
} catch (e) {
  // the socket was not found
}
```

### RedisAdapter#remoteLeave(id:String, room:String)

Makes the socket with the given id leave the room.

```js
try {
  await io.of('/').adapter.remoteLeave('<my-id>', 'room1');
} catch (e) {
  // the socket was not found
}
```

### RedisAdapter#remoteDisconnect(id:String, close:Boolean)

Makes the socket with the given id to get disconnected. If `close` is set to true, it also closes the underlying socket.

```js
try {
  await io.of('/').adapter.remoteDisconnect('<my-id>', true);
} catch (e) {
  // the socket was not found
}
```

## With ioredis client

### Cluster example

```js
const io = require('socket.io')(3000);
const redisAdapter = require('@socket.io/redis-adapter');
const Redis = require('ioredis');

const startupNodes = [
  {
    port: 6380,
    host: '127.0.0.1'
  },
  {
    port: 6381,
    host: '127.0.0.1'
  }
];

const pubClient = new Redis.Cluster(startupNodes);
const subClient = pubClient.duplicate();

io.adapter(redisAdapter(pubClient, subClient));
```

### Sentinel Example

```js
const io = require('socket.io')(3000);
const redisAdapter = require('@socket.io/redis-adapter');
const Redis = require('ioredis');

const options = {
  sentinels: [
    { host: 'somehost1', port: 26379 },
    { host: 'somehost2', port: 26379 }
  ],
  name: 'master01'
};

const pubClient = new Redis(options);
const subClient = pubClient.duplicate();

io.adapter(redisAdapter(pubClient, subClient));
```

## Protocol

The `@socket.io/redis-adapter` adapter broadcasts and receives messages on particularly named Redis channels. For global broadcasts the channel name is:
```
prefix + '#' + namespace + '#'
```

In broadcasting to a single room the channel name is:
```
prefix + '#' + namespace + '#' + room + '#'
```


- `prefix`: The base channel name. Default value is `socket.io`. Changed by setting `opts.key` in `adapter(opts)` constructor
- `namespace`: See https://github.com/socketio/socket.io#namespace.
- `room` : Used if targeting a specific room.

A number of other libraries adopt this protocol including:

- [socket.io-redis-emitter](https://github.com/socketio/socket.io-redis-emitter)
- [socket.io-python-emitter](https://github.com/GameXG/socket.io-python-emitter)
- [socket.io-emitter-go](https://github.com/stackcats/socket.io-emitter-go)

## Migrating from `socket.io-redis`

The package was renamed from `socket.io-redis` to `@socket.io/redis-adapter` in [v7](https://github.com/socketio/socket.io-redis-adapter/releases/tag/7.0.0), in order to match the name of the Redis emitter (`@socket.io/redis-emitter`).

To migrate to the new package, you'll need to make sure to provide your own Redis clients, as the package will no longer create Redis clients on behalf of the user.

Before:

```js
const redisAdapter = require("socket.io-redis");

io.adapter(redisAdapter({ host: "localhost", port: 6379 }));
```

After:

```js
const { createClient } = require("redis");
const { createAdapter } = require("@socket.io/redis-adapter");

const pubClient = createClient({ host: "localhost", port: 6379 });
const subClient = pubClient.duplicate();

io.adapter(createAdapter(pubClient, subClient));
```

Please note that the communication protocol between the Socket.IO servers has not been updated, so you can have some servers with `socket.io-redis` and some others with `@socket.io/redis-adapter` at the same time.

## License

MIT
