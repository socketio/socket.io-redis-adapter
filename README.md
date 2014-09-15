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

## Stored schema

The module store two different entity in Redis: **socket** and **room**.
Every key is prefixed with "socket.io". Prefix is customizable with the *key* option.

### socket

The module create a new Redis SET for each new socket.

The socket SET key is defined as __PREFIX__#__SOCKET_ID__ (e.g.: *socket.io#951wMmbBjkREmCapAAAD*).
The socket SET is created with only one record: the socket ID string.

Then each time this socket join/leave a room module add/remove a Redis record in SET.

Example for a socket with the ID *951wMmbBjkREmCapAAAD* in *foo* and *bar* rooms:

```
socket.io#951wMmbBjkREmCapAAAD
  -> 951wMmbBjkREmCapAAAD
  -> foo
  -> bar
```

### room

Each time a room is needed (= a socket join a room that not already exists) the module create a new Redis SET.

The room SET key is defined as __PREFIX__#__ROOM_NAME__ (e.g.: *socket.io#foo*).
The room SET contain the socket IDs of the room sockets.

Then each time a socket join/leave the room the module add/remove the corresponding Redis record from the SET.

Example for a room *foo* with the following socket in *951wMmbBjkREmCapAAAD*, *566Mm_BjkREmRff456*:

```
socket.io#foo
  -> 951wMmbBjkREmCapAAAD
  -> 566Mm_BjkREmRff456
```

As with native adapter the not longer needed room SET are deleted automatically (except on application
exit, see below).

## Known limitation

**Warning! Current module implementation doesn't cleanup Redis storage on exit.**

Consequence is that in a multi-node/server configuration with the out-of-the-box module,
shutting down a node process will let sockets and rooms SET remain in Redis even if the
current sockets are not longer connected.

The reason is the non ability for node to execute asynchronous tasks (like Redis queries)
on exit.

So, every developer should implement his proper cleanup logic in the context of
his particular project.

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
