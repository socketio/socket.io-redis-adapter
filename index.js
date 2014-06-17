
/**
 * Module dependencies.
 */

var uid2 = require('uid2');
var redis = require('redis').createClient;
var msgpack = require('msgpack-js');
var Adapter = require('socket.io-adapter');
var debug = require('debug')('socket.io-redis');

/**
 * Module exports.
 */

module.exports = adapter;

/**
 * Returns a redis Adapter class.
 *
 * @param {String} optional, redis uri
 * @return {RedisAdapter} adapter
 * @api public
 */

function adapter(uri, opts){
  opts = opts || {};

  // handle options only
  if ('object' == typeof uri) {
    opts = uri;
    uri = null;
  }

  // handle uri string
  if (uri) {
    uri = uri.split(':');
    opts.host = uri[0];
    opts.port = uri[1];
  }

  // opts
  var socket = opts.socket;
  var host = opts.host || '127.0.0.1';
  var port = Number(opts.port || 6379);
  var pub = opts.pubClient;
  var sub = opts.subClient;
  var data = opts.dataClient;
  var prefix = opts.key || 'socket.io';

  // init clients if needed
  if (!pub) pub = socket ? redis(socket) : redis(port, host);
  if (!sub) sub = socket
    ? redis(socket, { detect_buffers: true })
    : redis(port, host, {detect_buffers: true});
  if (!data) data = socket ? redis(socket) : redis(port, host);


  // this server's key
  var uid = uid2(6);
  var key = prefix + '#' + uid;

  var self;

  /**
   * Adapter constructor.
   *
   * @param {String} namespace name
   * @api public
   */

  function Redis(nsp){
    Adapter.call(this, nsp);

    self = this;
    sub.psubscribe(prefix + '#*', function(err){
      if (err) self.emit('error', err);
    });
    sub.on('pmessage', this.onmessage.bind(this));
  }

  /**
   * Inherits from `Adapter`.
   */

  Redis.prototype.__proto__ = Adapter.prototype;

  /**
   * Called with a subscription message
   *
   * @api private
   */

  Redis.prototype.onmessage = function(pattern, channel, msg){
    var pieces = channel.split('#');
    if (uid == pieces.pop()) return debug('ignore same uid');
    var args = msgpack.decode(msg);

    if (args[0] && args[0].nsp === undefined)
      args[0].nsp = '/'

    if (!args[0] || args[0].nsp != this.nsp.name) return debug('ignore different namespace')
    args.push(true);
    this.broadcast.apply(this, args);
  };

  /**
   * Adds a socket from a room.
   *
   * @param {String} socket id
   * @param {String} room name
   * @param {Function} callback
   * @api public
   */

  Redis.prototype.add = function(id, room, fn){
    Adapter.prototype.add.call(this, id, room, fn);
    // this.sids[id] = this.sids[id] || {};
    // this.sids[id][room] = true;
    // this.rooms[room] = this.rooms[room] || [];
    // this.rooms[room][id] = true;
    data.sadd(room, id, fn);
    data.sadd(id, room, fn);

    // if (fn) process.nextTick(fn.bind(null, null));
  };

  /**
   * Removes a socket from a room.
   *
   * @param {String} socket id
   * @param {String} room name
   * @param {Function} callback
   * @api public
   */

  Redis.prototype.del = function(id, room, fn){
    Adapter.prototype.del.call(this, room, fn);
    data.multi()
      .srem(room, id)
      .srem(id, room)
      .exec(fn);
  };


  /**
   * Removes a socket from all rooms it's joined.
   *
   * @param {String} socket id
   * @api public
   */

  Redis.prototype.delAll = function(id, fn){
    Adapter.prototype.delAll.call(this, id, fn);

    data.smembers(id, function(err, replies){
      var multi = data.multi();
      for(var i=0; i<replies.length; ++i){
        multi.srem(replies[i], id);
      }
      multi.del(id);
      multi.exec(fn);
    });
  };

  /**
   * Get all clients in room.
   *
   * @param {String} room id
   * @api public
   */
  Redis.prototype.clients = function(room, fn){
    data.smembers(room, fn);
  };

  /**
   * Broadcasts a packet.
   *
   * @param {Object} packet to emit
   * @param {Object} options
   * @param {Boolean} whether the packet came from another node
   * @api public
   */

  Redis.prototype.broadcast = function(packet, opts, remote){
    Adapter.prototype.broadcast.call(this, packet, opts);
    if (!remote) pub.publish(key, msgpack.encode([packet, opts]));
  };

  // Set up exit handlers so we can clean up this process's redis data before exiting

  process.stdin.resume(); //so the program will not close instantly
  function exitHandler(options, err){
    var i;
    var multi = data.multi();
    var execDone = false;

    var roomIds = Object.keys(self.rooms);
    var socketIds = Object.keys(self.sids);

    for(i=0; i<roomIds.length; ++i){
      multi.srem(roomIds[i], Object.keys(self.rooms[roomIds[i]]));
    }
    for(i=0; i<socketIds.length; ++i){
      multi.srem(socketIds[i], Object.keys(self.sids[socketIds[i]]));
    }
    multi.exec(function(err, replies){
      process.exit();
    });
  }

  // //do something when app is closing
  // process.on('exit', exitHandler.bind(null,{cleanup:true}));
  process.on('SIGTERM', exitHandler);
  process.on('SIGINT', exitHandler);
  process.on('uncaughtException', exitHandler);

  return Redis;

}
