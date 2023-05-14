# History

- [8.2.1](821-2023-05-14) (May 2023)
- [8.2.0](820-2023-05-02) (May 2023)
- [8.1.0](810-2023-02-08) (Feb 2023)
- [8.0.1](801-2023-01-11) (Jan 2023)
- [**8.0.0**](#800-2022-12-07) (Dec 2022)
- [7.2.0](#720-2022-05-03) (May 2022)
- [7.1.0](#710-2021-11-29) (Nov 2021)
- [7.0.1](#701-2021-11-15) (Nov 2021)
- [**7.0.0**](#700-2021-05-11) (May 2021)
- [6.1.0](#610-2021-03-12) (Mar 2021)
- [6.0.1](#601-2020-11-14) (Nov 2020)
- [**6.0.0**](#600-2020-11-12) (Nov 2020)
- [5.4.0](#540-2020-09-02) (Sep 2020)
- [5.3.0](#530-2020-06-04) (Jun 2020)
- [5.2.0](#520-2017-08-24) (Aug 2017)
- [5.1.0](#510-2017-06-04) (Jun 2017)



# Release notes

## [8.2.1](https://github.com/socketio/socket.io-redis-adapter/compare/8.2.0...8.2.1) (2023-05-14)


### Bug Fixes

* **sharded:** ensure compatibility with ioredis ([42c8ab6](https://github.com/socketio/socket.io-redis-adapter/commit/42c8ab6764a3d4c855b27eea35b4e0cda9c34b37))
* **sharded:** properly unsubscribe when closing ([2da8d9e](https://github.com/socketio/socket.io-redis-adapter/commit/2da8d9e57afbed3201f818bca77ac17ce9636fa3))



## [8.2.0](https://github.com/socketio/socket.io-redis-adapter/compare/8.1.0...8.2.0) (2023-05-02)


### Bug Fixes

* cleanup error handler to prevent memory leak ([#490](https://github.com/socketio/socket.io-redis-adapter/issues/490)) ([b5da02d](https://github.com/socketio/socket.io-redis-adapter/commit/b5da02d779490f73c6c041999d10be1c98494f84))


### Features

#### Sharded Pub/Sub

Sharded Pub/Sub was introduced in Redis 7.0 in order to help scaling the usage of Pub/Sub in cluster mode.

Reference: https://redis.io/docs/manual/pubsub/#sharded-pubsub

A dedicated adapter can be created with the `createShardedAdapter()` method:

```js
import { Server } from 'socket.io';
import { createClient } from 'redis';
import { createShardedAdapter } from '@socket.io/redis-adapter';

const pubClient = createClient({ host: 'localhost', port: 6379 });
const subClient = pubClient.duplicate();

await Promise.all([
  pubClient.connect(),
  subClient.connect()
]);

const io = new Server({
  adapter: createShardedAdapter(pubClient, subClient)
});

io.listen(3000);
```

Minimum requirements:

- Redis 7.0
- [`redis@4.6.0`](https://github.com/redis/node-redis/commit/3b1bad229674b421b2bc6424155b20d4d3e45bd1)

Added in [e70b1bd](https://github.com/socketio/socket.io-redis-adapter/commit/e70b1bde105d88eaa43272ff094c5540981a66d3).

#### Support for node-redis cluster

The `redis` package now supports Redis cluster.

Added in [77ef42c](https://github.com/socketio/socket.io-redis-adapter/commit/77ef42c95d1ab637c33e2f69af5e0f7a12072629).

#### Subscription modes

The `subscriptionMode` option allows to configure how many Redis Pub/Sub channels are used:

- "static": 2 channels per namespace

Useful when used with dynamic namespaces.

- "dynamic": (2 + 1 per public room) channels per namespace

The default value, useful when some rooms have a low number of clients (so only a few Socket.IO servers are notified).

```js
const io = new Server({
  adapter: createShardedAdapter(pubClient, subClient, {
    subscriptionMode: "static"
  })
});
```

Added in [d3388bf](https://github.com/socketio/socket.io-redis-adapter/commit/d3388bf7b5b64ff6d2c25a874f4956273c8e3f58).

### Credits

Huge thanks to [@winchell](https://github.com/winchell) for helping!



## [8.1.0](https://github.com/socketio/socket.io-redis-adapter/compare/8.0.1...8.1.0) (2023-02-08)

The `socket.io-adapter` package was added to the list of `peerDependencies`, in order to fix sync issues with the version imported by the `socket.io` package (see [f07ff7b](https://github.com/socketio/socket.io-redis-adapter/commit/f07ff7bd33817ac14d8d87ba55225e7936469429)).

### Features

#### Automatic removal of empty child namespaces

The `close()` method was implemented, in order to be used with the new `cleanupEmptyChildNamespaces` option.

Reference: https://github.com/socketio/socket.io/releases/tag/4.6.0

Added in [fe89f7e](https://github.com/socketio/socket.io-redis-adapter/commit/fe89f7e5fe9676d0054b77de147fb244034a441e).



## [8.0.1](https://github.com/socketio/socket.io-redis-adapter/compare/8.0.0...8.0.1) (2023-01-11)

This release pins the `socket.io-adapter` package to version `~2.4.0` instead of `^2.4.0`.



## [8.0.0](https://github.com/socketio/socket.io-redis-adapter/compare/7.2.0...8.0.0) (2022-12-07)


### Dependencies

* bump notepack.io to version ~3.0.1 ([#464](https://github.com/socketio/socket.io-redis-adapter/issues/464)) ([c96b2e7](https://github.com/socketio/socket.io-redis-adapter/commit/c96b2e72b1183dce45c9d2dcb94fcdf57b1a5141))


### Features

* add option to allow usage of custom parser ([#471](https://github.com/socketio/socket.io-redis-adapter/issues/471)) ([73f6320](https://github.com/socketio/socket.io-redis-adapter/commit/73f6320006f39945c961678116ceee80f30efcf6))

Example with [msgpackr](https://github.com/kriszyp/msgpackr):

```js
import { unpack, pack } from "msgpackr";

io.adapter(createAdapter(pubClient, subClient, {
  parser: {
    encode(val) {
      return pack(val);
    },
    decode(val) {
      return unpack(val);
    }
  }
}));
```

* remove deprecated methods ([fb760d9](https://github.com/socketio/socket.io-redis-adapter/commit/fb760d9d778ed8129543bf8321d87e4fd9cca711))


### BREAKING CHANGES

* the remoteJoin(), remoteLeave(), remoteDisconnect()
  and sockets() methods are removed in favor of the official alternatives

Related: https://github.com/socketio/socket.io/commit/b25495c069031674da08e19aed68922c7c7a0e28

* the format of Date objects is modified in a non
  backward-compatible way, as notepack.io now implements the MessagePack
  Timestamp extension type.

Reference: https://github.com/msgpack/msgpack/blob/master/spec.md#timestamp-extension-type

Previous versions of the adapter will not be able to parse the Date
objects sent by newer versions.

- Reference: https://github.com/darrachequesne/notepack/releases/tag/3.0.0
- Diff: https://github.com/darrachequesne/notepack/compare/2.3.0...3.0.1



## [7.2.0](https://github.com/socketio/socket.io-redis-adapter/compare/7.1.0...7.2.0) (2022-05-03)


### Bug Fixes

* add support for ioredis v5 ([#453](https://github.com/socketio/socket.io-redis-adapter/issues/453)) ([d2faa8a](https://github.com/socketio/socket.io-redis-adapter/commit/d2faa8a55a9ef206976a1ef35041d068997324f9))


### Features

* broadcast and expect multiple acks ([e4c40cc](https://github.com/socketio/socket.io-redis-adapter/commit/e4c40cc8a9ad8803f03bcbbfd6b713f3c082ee28))

This feature was added in `socket.io@4.5.0`:

```js
io.timeout(1000).emit("some-event", (err, responses) => {
  // ...
});
```

Thanks to this change, it will now work with multiple Socket.IO servers.



## [7.1.0](https://github.com/socketio/socket.io-redis-adapter/compare/7.0.1...7.1.0) (2021-11-29)


### Features

* add support for redis v4 ([aa681b3](https://github.com/socketio/socket.io-redis-adapter/commit/aa681b3bc914358d206ab35761d291a466ac18da))
* do not emit "error" events anymore ([8e5c84f](https://github.com/socketio/socket.io-redis-adapter/commit/8e5c84f7edcda85a6f7e36c04ebd74152c1cade1))
* send response to the requesting node only ([f66de11](https://github.com/socketio/socket.io-redis-adapter/commit/f66de114a4581b692da759015def0373c619aab7))



## [7.0.1](https://github.com/socketio/socket.io-redis-adapter/compare/7.0.0...7.0.1) (2021-11-15)


### Bug Fixes

* allow numeric rooms ([214b5d1](https://github.com/socketio/socket.io-redis-adapter/commit/214b5d1a8d4f1bc037712ed53dceba7ee55ea643))
* ignore sessionStore in the fetchSockets method ([c5dce43](https://github.com/socketio/socket.io-redis-adapter/commit/c5dce438950491b608ed8ed46369b8f120fa82e4))



## [7.0.0](https://github.com/socketio/socket.io-redis-adapter/compare/6.1.0...7.0.0) (2021-05-11)


### Features

* implement the serverSideEmit functionality ([3a0f29f](https://github.com/socketio/socket.io-redis-adapter/commit/3a0f29fbe322f280f48f92b3aac0fcc94d698ee8))
* remove direct redis dependency ([c68a47c](https://github.com/socketio/socket.io-redis-adapter/commit/c68a47c4948554125dac0e317e19947a4d3d3251))
* rename the package to `@socket.io/redis-adapter` ([3cac178](https://github.com/socketio/socket.io-redis-adapter/commit/3cac1789c558a3ece5bb222d73f097952b55c340))


### BREAKING CHANGES

* the library will no longer create Redis clients on behalf of the user.

Before:

```js
io.adapter(redisAdapter({ host: "localhost", port: 6379 }));
```

After:

```js
const pubClient = createClient({ host: "localhost", port: 6379 });
const subClient = pubClient.duplicate();

io.adapter(redisAdapter(pubClient, subClient));
```


## [6.1.0](https://github.com/socketio/socket.io-redis/compare/6.0.1...6.1.0) (2021-03-12)


### Features

* implement utility methods from Socket.IO v4 ([468c3c8](https://github.com/socketio/socket.io-redis/commit/468c3c8008ddd0c89b2fc2054d874e9e706f0948))


### Performance Improvements

* remove one round-trip for the requester ([6c8d770](https://github.com/socketio/socket.io-redis/commit/6c8d7701962bee4acf83568f8e998876d3549fb8))


## [6.0.1](https://github.com/socketio/socket.io-redis/compare/6.0.0...6.0.1) (2020-11-14)


### Bug Fixes

* **typings:** properly expose the createAdapter method ([0d2d69c](https://github.com/socketio/socket.io-redis/commit/0d2d69cc78aa3418a7b5a6231a13ea4028dd74a3))
* fix broadcasting ([#361](https://github.com/socketio/socket.io-redis/issues/361)) ([3334d99](https://github.com/socketio/socket.io-redis/commit/3334d99e1b6e2f80485c73133381a18798b24bc0))



## [6.0.0](https://github.com/socketio/socket.io-redis/compare/5.4.0...6.0.0) (2020-11-12)


### Features

* add support for Socket.IO v3 ([d9bcb19](https://github.com/socketio/socket.io-redis/commit/d9bcb1935940d7ad414ba7154de51cdc4a7d45b1))

### BREAKING CHANGES:

- all the requests (for inter-node communication) now return a Promise instead of accepting a callback

Before:

```js
io.of('/').adapter.allRooms((err, rooms) => {
  console.log(rooms); // an array containing all rooms (accross every node)
});
```

After:

```js
const rooms = await io.of('/').adapter.allRooms();
console.log(rooms); // a Set containing all rooms (across every node)
```

- RedisAdapter.clients() is renamed to RedisAdapter.sockets()

See https://github.com/socketio/socket.io-adapter/commit/130f28a43c5aca924aa2c1a318422d21ba03cdac

- RedisAdapter.customHook() and RedisAdapter.customRequest() are removed

Those methods will be replaced by a more intuitive API in a future iteration.

- support for Node.js 8 is dropped

See https://github.com/nodejs/Release



## [5.4.0](https://github.com/socketio/socket.io-redis/compare/5.3.0...5.4.0) (2020-09-02)


### Features

* update node-redis version to 3.x ([5b3ed58](https://github.com/socketio/socket.io-redis/commit/5b3ed5877acfdb35e4faa2f46f06a8032ff8b574))



## [5.3.0](https://github.com/socketio/socket.io-redis/compare/5.2.0...5.3.0) (2020-06-04)


### Features

* add support for Redis Cluster ([7a19075](https://github.com/socketio/socket.io-redis/commit/7a190755c01732d1335199732e7b0eb5a1fb1f9e))



## [5.2.0](https://github.com/socketio/socket.io-redis/compare/5.1.0...5.2.0) (2017-08-24)


### Features

* increase default requestsTimeout to 5000 ms ([37e28df](https://github.com/socketio/socket.io-redis/commit/37e28df54b0b8c71b4f8ea1766e56dc63fb26ba2))



## [5.1.0](https://github.com/socketio/socket.io-redis/compare/5.0.1...5.1.0) (2017-06-04)

### Bug Fixes

* use the requestid from response when deleting requests ([4f08b1a](https://github.com/socketio/socket.io-redis/commit/4f08b1ae7b3b9ee549349f1b95f5e3f3ff69d651))


### Features

* add support for ArrayBuffer ([b3ad4ad](https://github.com/socketio/socket.io-redis/commit/b3ad4ad28b225f1999d5dd709f2ea6d5674085f6))


