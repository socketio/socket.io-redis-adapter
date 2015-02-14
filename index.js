
/**
 * Module dependencies.
 */

var uid2 = require('uid2');
var redis = require('redis').createClient;
var msgpack = require('msgpack-js');
var Adapter = require('socket.io-adapter');
var Emitter = require('events').EventEmitter;
var debug = require('debug')('socket.io-redis');
var async = require('async');

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
  var host = opts.host || '127.0.0.1';
  var port = Number(opts.port || 6379);
  var pub = opts.pubClient;
  var sub = opts.subClient;
  var prefix = opts.key || 'socket.io';

  // init clients if needed
  if (!pub) pub = redis(port, host);
  if (!sub) sub = redis(port, host, { detect_buffers: true });

  // this server's key
  var uid = uid2(6);
  var key = prefix + '#' + uid;

  /**
   * Adapter constructor.
   *
   * @param {String} namespace name
   * @api public
   */

  function Redis(nsp){
    Adapter.call(this, nsp);

    this.uid = uid;
    this.prefix = prefix;
    this.pubClient = pub;
    this.subClient = sub;

    var self = this;
    sub.subscribe(prefix + '#' + nsp.name + '#', function(err){
      if (err) self.emit('error', err);
    });
    sub.on('message', this.onmessage.bind(this));
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

  Redis.prototype.onmessage = function(channel, msg){
    var pieces = channel.split('#');
    var args = msgpack.decode(msg);
    var packet;

    if (uid == args.shift()) return debug('ignore same uid');

    packet = args[0];

    if (packet && packet.nsp === undefined) {
      packet.nsp = '/';
    }

    if (!packet || packet.nsp != this.nsp.name) {
      return debug('ignore different namespace');
    }

    args.push(true);

    this.broadcast.apply(this, args);
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
    if (!remote) {
      if (opts.rooms) {
        opts.rooms.forEach(function(room) {
          var packet = msgpack.encode([uid, packet, opts]);
          var channel = prefix + '#' + packet.nsp + '#' + room + '#';
          pub.publish(channel, packet);
        });
      } else {
        var packet = msgpack.encode([uid, packet, opts]);
        pub.publish(prefix + '#' + packet.nsp + '#');
      }
    }
  };

  /**
   * Subscribe client to room messages.
   *
   * @param {String} client id
   * @param {String} room
   * @param {Function} callback (optional)
   * @api public
   */

  Redis.prototype.add = function(id, room, fn){
    debug('adding %s to %s ', id, room);
    var self = this;
    this.sids[id] = this.sids[id] || {};
    this.sids[id][room] = true;
    this.rooms[room] = this.rooms[room] || {};
    this.rooms[room][id] = true;
    var channel = prefix + '#' + this.nsp.name + '#' + room + '#';
    sub.subscribe(channel, function(err){
      if (err) {
        self.emit('error', err);
        if (fn) fn(err);
        return;
      }
      if (fn) fn(null);
    });
  };

  Redis.prototype.del = function(id, room, fn){
    var self = this;

    debug('removing ', id, ' from ', room);

    this.sids[id] = this.sids[id] || {};
    this.rooms[room] = this.rooms[room] || {};
    delete this.sids[id][room];
    delete this.rooms[room][id];

    if (this.rooms.hasOwnProperty(room) && !Object.keys(this.rooms[room]).length) {
      delete this.rooms[room];

      return sub.unsubscribe(prefix + '#' + this.nsp.name + '#' + room + '#', function(err){
        if (err) self.emit('error', err);

        if (fn) process.nextTick(fn.bind(null, null));
      });
    }

    if (fn) process.nextTick(fn.bind(null, null));
  };

  Redis.prototype.delAll = function(id, fn){
    var self = this,
        rooms = this.sids[id];

    debug('removing ', id, ' from all rooms');

    if (!rooms) return process.nextTick(fn.bind(null, null));

    async.forEach(Object.keys(rooms), function (room, next) {
      if (rooms.hasOwnProperty(room)) {
        delete self.rooms[room][id];
      }

      if (self.rooms.hasOwnProperty(room) && !Object.keys(self.rooms[room]).length) {
        delete self.rooms[room];

        return sub.unsubscribe(prefix + '#' + self.nsp.name + '#' + room + '#', function(err){
          if (err) self.emit('error', err);
          next();
        });
      }

      next();
    }, function(err) {
      if (err) self.emit('error', err);

      delete self.sids[id];

      if (fn) process.nextTick(fn.bind(null, null));
    });
  };

  return Redis;

}
