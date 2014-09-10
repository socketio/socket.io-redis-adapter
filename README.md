# socket.io-redis

[![Build Status](https://secure.travis-ci.org/Automattic/socket.io-redis.png)](http://travis-ci.org/Automattic/socket.io-redis)
[![NPM version](https://badge.fury.io/js/socket.io-redis.png)](http://badge.fury.io/js/socket.io-redis)

## How to use

```js
var io = require('socket.io')(3000);
var redis = require('socket.io-redis');
io.adapter(redis({ host: 'localhost', port: 6379 }));
```

By running socket.io with the `socket.io-redis` adapter you can run
multiple socket.io instances in different processes or servers that can
all broadcast and emit events to and from each other.

`socket.io-redis` use Redis pub/sub mechanism to route events to different nodes/servers and
store rooms and sockets ids in Redis sets.

If you need to emit events to socket.io instances from a non-socket.io
process, you should use [socket.io-emitter](http:///github.com/Automattic/socket.io-emitter).

## Known limitation

**Warning! Current module implementation doesn't cleanup Redis storage on exit.**

Consequence is that in a multi-node/server configuration with the out-of-the-box module, 
shutting down a node process will let sockets and rooms data remain in Redis even if the
current sockets are now probably not longer connected.

The reason of this limitation is the non ability for node to execute asynchronous tasks (like 
Redis queries) on exit.

**It is strongely adviced to implement your proper cleanup on exit or to take this point in consideration in your implementation**.

## Stored schema

Every new keys in Redis are created with "socket.io" prefix (customizable with the *key* option).

For each new socket connected to a node a SET is created with the key: socket.io#{{socket uid}}. On creation the set contain only a record, the socket uid String.

For each new room created by socket.io (generally when a user enter in) a SET is created with the key: socket.io#{{room id}}

Then each time a socket join a room the room id string is added to user Redis SET **and** socket uid is added to room Redis SET.
Also when a socket leave a room the corresponding record (socket uid) is removed from the room Redis SET and the room id is removed from socket SET.

On disconnect corresponding user socket SET is automatically removed and corresponding record also removed from rooms SET.
Room SET are removed automatically when no more socket remain inside.

## API

### adapter(uri[, opts])

`uri` is a string like `localhost:6379` where your redis server
is located. For a list of options see below.

### adapter(opts)

The following options are allowed:

- `key`: the name of the key to pub/sub events on as prefix (`socket.io`)
- `host`: host to connect to redis on (`localhost`)
- `port`: port to connect to redis on (`6379`)
- `socket`: unix domain socket to connect to redis (`"/tmp/redis.sock"`). Will
  be used instead of the host and port options if specified.
- `pubClient`: optional, the redis client to publish events on
- `subClient`: optional, the redis client to subscribe to events on
- `dataClient`: optional, the redis client used to store and read socket.io 
  sockets/rooms data

If you decide to supply `pubClient`, `subClient` or `dataClient` make sure you use
[node_redis](https://github.com/mranney/node_redis) as a client or one
with an equivalent API.

If you supply clients, make sure you initialized them with 
the `return_buffers` option set to `true`.

## License

MIT
