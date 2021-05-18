## [6.1.1](https://github.com/socketio/socket.io-redis/compare/6.1.0...6.1.1) (2021-05-18)


# [6.1.0](https://github.com/socketio/socket.io-redis/compare/6.0.1...6.1.0) (2021-03-12)


### Features

* implement utility methods from Socket.IO v4 ([468c3c8](https://github.com/socketio/socket.io-redis/commit/468c3c8008ddd0c89b2fc2054d874e9e706f0948))


### Performance Improvements

* remove one round-trip for the requester ([6c8d770](https://github.com/socketio/socket.io-redis/commit/6c8d7701962bee4acf83568f8e998876d3549fb8))


## [6.0.1](https://github.com/socketio/socket.io-redis/compare/6.0.0...6.0.1) (2020-11-14)


### Bug Fixes

* **typings:** properly expose the createAdapter method ([0d2d69c](https://github.com/socketio/socket.io-redis/commit/0d2d69cc78aa3418a7b5a6231a13ea4028dd74a3))
* fix broadcasting ([#361](https://github.com/socketio/socket.io-redis/issues/361)) ([3334d99](https://github.com/socketio/socket.io-redis/commit/3334d99e1b6e2f80485c73133381a18798b24bc0))



# [6.0.0](https://github.com/socketio/socket.io-redis/compare/5.4.0...6.0.0) (2020-11-12)


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



# [5.4.0](https://github.com/socketio/socket.io-redis/compare/5.3.0...5.4.0) (2020-09-02)


### Features

* update node-redis version to 3.x ([5b3ed58](https://github.com/socketio/socket.io-redis/commit/5b3ed5877acfdb35e4faa2f46f06a8032ff8b574))



# [5.3.0](https://github.com/socketio/socket.io-redis/compare/5.2.0...5.3.0) (2020-06-04)


### Features

* add support for Redis Cluster ([7a19075](https://github.com/socketio/socket.io-redis/commit/7a190755c01732d1335199732e7b0eb5a1fb1f9e))



# [5.2.0](https://github.com/socketio/socket.io-redis/compare/5.1.0...5.2.0) (2017-08-24)


### Features

* increase default requestsTimeout to 5000 ms ([37e28df](https://github.com/socketio/socket.io-redis/commit/37e28df54b0b8c71b4f8ea1766e56dc63fb26ba2))



# [5.1.0](https://github.com/socketio/socket.io-redis/compare/5.0.1...5.1.0) (2017-06-04)

### Bug Fixes

* use the requestid from response when deleting requests ([4f08b1a](https://github.com/socketio/socket.io-redis/commit/4f08b1ae7b3b9ee549349f1b95f5e3f3ff69d651))


### Features

* add support for ArrayBuffer ([b3ad4ad](https://github.com/socketio/socket.io-redis/commit/b3ad4ad28b225f1999d5dd709f2ea6d5674085f6))


