
4.0.1 / 2017-05-11
===================

  * [docs] Add link to Go implementation of socket.io-emitter (#199)
  * [fix] Fix duplicate identifier declaration (#213)

4.0.0 / 2017-02-15
===================

  * [fix] Fix remoteJoin/remoteLeave methods (#201)
  * [docs] Update code examples in the Readme (#194)
  * [docs] Update History.md regarding the `return_buffers` option (#189)
  * [feature] Make customHook async (#181)

The major bump is due to #181, which is an API breaking change.

3.1.0 / 2017-01-16
===================

  * [docs] Document remoteDisconnect method (#179)
  * [feature] Implement remoteDisconnect method (#177)
  * [fix] Subscribe only once per room (#175)
  * [test] Fix 'Connection is closed' errors when cleaning up tests (#178)
  * [test] Use quit() instead of end() to close Redis connection (#176)

3.0.0 / 2017-01-08
===================

  * [feature] Add some helper methods (#168)
  * [test] Add newer nodejs versions in Travis (#167)
  * [test] simplify tests by using beforeEach/afterEach methods (#166)
  * [perf] Micro-optimisations (#163)
  * [feature] Forward errors from pub/sub clients to the adapter (#160)
  * [chore] Replace msgpack with msgpack-lite (#156)
  * [feature] Make subEvent default to `messageBuffer` (#157)

The major bump is due to #156.

**Important note:** thanks to #157 the `return_buffers` option for the Redis client should not be needed anymore, in fact it might even lead to errors if it is still used (related: https://github.com/socketio/socket.io-redis/issues/185)

2.0.1 / 2016-12-08
===================

  * [fix] Make sure numsub is an integer (#155)

2.0.0 / 2016-11-28
===================

  * [chore] Bump socket.io-adapter to version 0.5.0 (#145)
  * [chore] Bump debug to version 2.3.3 (#147)
  * [chore] Bump redis to version 2.6.3 (#148)
  * [chore] Bump async library to 2.1.4 (#62)
  * [feature] Add a `local` flag (#119)
  * [feature] Refactor requests between nodes and add `clientRooms` method (#146)
  * [feature] Add an option to disable channel multiplexing (#140)
  * [fix] receive a message only once per-emit (not per-joined rooms) (#151)
  * [chore] Bump mocha to 3.2.0 (#152)

1.1.1 / 2016-09-26
==================

 * [refactor] Use this.channel to construct the name of a channel (#129)
 * [test] Add tests with ioredis client (#128)
 * [chore] Restrict files included in npm package (#130)

1.1.0 / 2016-09-24
==================

 * [feature] Get all clients in a room across all nodes (#109)
 * [feature] Added option subEvent (#95)
 * [fix] Fix an issue when broadcasting binary data between nodes. (#122)
 * [fix] Fixes #93 by passing full URI to redis.createClient when specified (#94)
 * [docs] add license info (#114)
 * [docs] Notes regarding protocol for Redis messages (rebased 3 commits) (#86)
 * [perf] Return early when channels mismatch to skip expensive msgpack decoding (#107)
 * [refactor] Remove unused import (#123)
 * [chore] Updated node-redis dependency to 2.4.2, which matches socket.io-emitter (#84)

1.0.0 / 2015-12-10
==================

  * adapted to match new `-adapter` `Room` class [nkzawa]

0.2.0 / 2015-12-03
==================

  * package: bump `debug`
  * replace `detect_buffers` with `return_buffers`, update redis
  * remove duplicated `#`
  * remove redundancy and minor performance optimization
  * better instrumentation
  * fire `del` callback when unsubscribing
  * improve error handling
  * expose constructor properties in resulting adapter
  * remove `socket` option, as we would need two sockets anyways
  * listen for separate channels for namespaces and rooms

0.1.4 / 2014-11-25
==================

 * increased socket.io-adapter version to 0.3.1
 * syntax
 * readme: Update badges
 * added Makefile

0.1.3 / 2014-05-30
==================

 * package: bump `socket.io-adapter`

0.1.2 / 2014-05-17
==================

 * check for default namespace before ignoring one

0.1.1 / 2014-03-18
==================

 * ignore different namespace

0.1.0 / 2014-03-12
==================

 * initial release
