# Socket.IO Redis adapter

The `@socket.io/redis-adapter` package allows broadcasting packets between multiple Socket.IO servers.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/adapter_dark.png">
  <img alt="Diagram of Socket.IO packets forwarded through Redis" src="./assets/adapter.png">
</picture>

**Table of contents**

- [Supported features](#supported-features)
- [Installation](#installation)
- [Compatibility table](#compatibility-table)
- [Usage](#usage)
  - [With the `redis` package](#with-the-redis-package)
  - [With the `redis` package and a Redis cluster](#with-the-redis-package-and-a-redis-cluster)
  - [With the `ioredis` package](#with-the-ioredis-package)
  - [With the `ioredis` package and a Redis cluster](#with-the-ioredis-package-and-a-redis-cluster)
  - [With Redis sharded Pub/Sub](#with-redis-sharded-pubsub)
- [Options](#options)
  - [Default adapter](#default-adapter)
  - [Sharded adapter](#sharded-adapter)
- [License](#license)

## Supported features

| Feature                         | `socket.io` version | Support                                        |
|---------------------------------|---------------------|------------------------------------------------|
| Socket management               | `4.0.0`             | :white_check_mark: YES (since version `6.1.0`) |
| Inter-server communication      | `4.1.0`             | :white_check_mark: YES (since version `7.0.0`) |
| Broadcast with acknowledgements | `4.5.0`             | :white_check_mark: YES (since version `7.2.0`) |
| Connection state recovery       | `4.6.0`             | :x: NO                                         |

## Installation

```
npm install @socket.io/redis-adapter
```

## Compatibility table

| Redis Adapter version | Socket.IO server version |
|-----------------------|--------------------------|
| 4.x                   | 1.x                      |
| 5.x                   | 2.x                      |
| 6.0.x                 | 3.x                      |
| 6.1.x                 | 4.x                      |
| 7.x and above         | 4.3.1 and above          |

## Usage

### With the `redis` package

```js
import { createClient } from "redis";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";

const pubClient = createClient({ url: "redis://localhost:6379" });
const subClient = pubClient.duplicate();

await Promise.all([
  pubClient.connect(),
  subClient.connect()
]);

const io = new Server({
  adapter: createAdapter(pubClient, subClient)
});

io.listen(3000);
```

### With the `redis` package and a Redis cluster

```js
import { createCluster } from "redis";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";

const pubClient = createCluster({
  rootNodes: [
    {
      url: "redis://localhost:7000",
    },
    {
      url: "redis://localhost:7001",
    },
    {
      url: "redis://localhost:7002",
    },
  ],
});
const subClient = pubClient.duplicate();

await Promise.all([
  pubClient.connect(),
  subClient.connect()
]);

const io = new Server({
  adapter: createAdapter(pubClient, subClient)
});

io.listen(3000);
```

### With the `ioredis` package

```js
import { Redis } from "ioredis";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";

const pubClient = new Redis();
const subClient = pubClient.duplicate();

const io = new Server({
  adapter: createAdapter(pubClient, subClient)
});

io.listen(3000);
```

### With the `ioredis` package and a Redis cluster

```js
import { Cluster } from "ioredis";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";

const pubClient = new Cluster([
  {
    host: "localhost",
    port: 7000,
  },
  {
    host: "localhost",
    port: 7001,
  },
  {
    host: "localhost",
    port: 7002,
  },
]);
const subClient = pubClient.duplicate();

const io = new Server({
  adapter: createAdapter(pubClient, subClient)
});

io.listen(3000);
```

### With Redis sharded Pub/Sub

Sharded Pub/Sub was introduced in Redis 7.0 in order to help scaling the usage of Pub/Sub in cluster mode.

Reference: https://redis.io/docs/interact/pubsub/#sharded-pubsub

A dedicated adapter can be created with the `createShardedAdapter()` method:

```js
import { Server } from "socket.io";
import { createClient } from "redis";
import { createShardedAdapter } from "@socket.io/redis-adapter";

const pubClient = createClient({ host: "localhost", port: 6379 });
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

Note: it is not currently possible to use the sharded adapter with the `ioredis` package and a Redis cluster ([reference](https://github.com/luin/ioredis/issues/1759)).

## Options

### Default adapter

| Name                               | Description                                                                   | Default value |
|------------------------------------|-------------------------------------------------------------------------------|---------------|
| `key`                              | The prefix for the Redis Pub/Sub channels.                                    | `socket.io`   |
| `requestsTimeout`                  | After this timeout the adapter will stop waiting from responses to request.   | `5_000`       |
| `publishOnSpecificResponseChannel` | Whether to publish a response to the channel specific to the requesting node. | `false`       |
| `parser`                           | The parser to use for encoding and decoding messages sent to Redis.           | `-`           |

### Sharded adapter

| Name               | Description                                                                             | Default value |
|--------------------|-----------------------------------------------------------------------------------------|---------------|
| `channelPrefix`    | The prefix for the Redis Pub/Sub channels.                                              | `socket.io`   |
| `subscriptionMode` | The subscription mode impacts the number of Redis Pub/Sub channels used by the adapter. | `dynamic`     |

## License

[MIT](LICENSE)
