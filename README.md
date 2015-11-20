# socket.io-redis

[![Build Status](https://travis-ci.org/socketio/socket.io-redis.svg?branch=master)](https://travis-ci.org/socketio/socket.io-redis)
[![NPM version](https://badge.fury.io/js/socket.io-redis.svg)](http://badge.fury.io/js/socket.io-redis)

## How to use

```js
var io = require('socket.io')(3000);
var redis = require('socket.io-redis');
io.adapter(redis({ host: 'localhost', port: 6379 }));
```

By running socket.io with the `socket.io-redis` adapter you can run
multiple socket.io instances in different processes or servers that can
all broadcast and emit events to and from each other.

If you need to emit events to socket.io instances from a non-socket.io
process, you should use [socket.io-emitter](https:///github.com/Automattic/socket.io-emitter).

## API

### adapter(uri[, opts])

`uri` is a string like `localhost:6379` where your redis server
is located. For a list of options see below.

### adapter(opts)

The following options are allowed:

- `key`: the name of the key to pub/sub events on as prefix (`socket.io`)
- `host`: host to connect to redis on (`localhost`)
- `port`: port to connect to redis on (`6379`)
- `pubClient`: optional, the redis client to publish events on
- `subClient`: optional, the redis client to subscribe to events on

If you decide to supply `pubClient` and `subClient`, make sure you use
[node_redis](https://github.com/mranney/node_redis) as a client or one
with an equivalent API.

If you supply clients, make sure you initialized them with 
the `return_buffers` option set to `true`.

### RedisAdapter

The redis adapter instances expose the following properties
that a regular `Adapter` does not

- `uid`
- `prefix`
- `pubClient`
- `subClient`

## Client error handling

Access the `pubClient` and `subClient` properties of the
Redis Adapter instance to subscribe to its `error` event:

```js
var redis = require('socket.io-redis');
var adapter = redis('localhost:6379');
adapter.pubClient.on('error', function(){});
adapter.subClient.on('error', function(){});
```

## Custom client (eg: with authentication)

If you need to create a redisAdapter to a redis instance
that has a password, use pub/sub options instead of passing
a connection string.

```js
var redis = require('redis').createClient;
var adapter = require('socket.io-redis');
var pub = redis(port, host, { auth_pass: "pwd" });
var sub = redis(port, host, { return_buffers: true, auth_pass: "pwd" });
io.adapter(adapter({ pubClient: pub, subClient: sub }));
```

Make sure the `return_buffers` option is set to `true` for the sub client.

## License

MIT
