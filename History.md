
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
