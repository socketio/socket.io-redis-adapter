
/**
 * Module dependencies.
 */

var uid2 = require('uid2');
var redis = require('redis').createClient;
var msgpack = require('msgpack-js');
var Adapter = require('socket.io-adapter');
var Emitter = require('events').EventEmitter;
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
  var pubsub = opts.pubsubClient;
  var prefix = opts.key || 'socket.io';

  // init clients if needed
  if (!pub) pub = socket ? redis(socket) : redis(port, host);
  if (!sub) sub = socket
    ? redis(socket, { detect_buffers: true })
    : redis(port, host, {detect_buffers: true});
  if (!pubsub) pubsub = socket ? redis(socket) : redis(port, host);

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

    var self = this;
    sub.subscribe(prefix + '#clientrequest', function(err){
      if (err) self.emit('error', err);
    });
    sub.on('message', this.onclientrequestmessage.bind(this));

    sub.psubscribe(prefix + '#*', function(err){
      if (err) self.emit('error', err);
    });
    sub.on('pmessage', this.onbroadcastmessage.bind(this));

  }

  /**
   * Inherits from `Adapter`.
   */

  Redis.prototype.__proto__ = Adapter.prototype;

  /**
   * Called with a broadcast message
   *
   * @api private
   */

  Redis.prototype.onbroadcastmessage = function(pattern, channel, msg){
    if (!channel.match(/#broadcast$/)) return;
    var pieces = channel.split('#');
    if (uid == pieces[1]) return debug('ignore same uid');

    var args = msgpack.decode(msg);

    if (args[0] && args[0].nsp === undefined) {
      args[0].nsp = '/';
    }

    if (!args[0] || args[0].nsp != this.nsp.name) {
      return debug('ignore different namespace');
    }

    args.push(true);

    this.broadcast.apply(this, args);
  };

  /**
   * Called with a clientrequest message
   *
   * @api private
   */

  Redis.prototype.onclientrequestmessage = function(channel, msg){
    var args = msgpack.decode(msg);
    if (this.nsp.name != args.shift()) return debug("ignore different namespace");
    if (uid == args.shift()) return debug('ignore same uid');

    args.push(null, prefix + '#' + args.shift() + '#clientresponse', true);

    this.clients.apply(this, args);
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
    if (!remote) pub.publish(key + '#broadcast', msgpack.encode([packet, opts]));
  };

  /**
   * Gets a list of clients by sid.
   *
   * @param {Array} explicit set of rooms to check.
   * @api public
   */

  Redis.prototype.clients = function(rooms, fn, channel, remote){
    var self = this;

    Adapter.prototype.clients.call(this, rooms, function(err, sids) {
      if (err) return fn && fn(err);

      sids = sids || [];
      if (remote) {
        pub.publish(channel, msgpack.encode([sids]));
      } else {
        pubsub.pubsub('NUMSUB', prefix + '#clientrequest', function (err, subs) {
          if (err) return fn && fn(err);

          var handle = setTimeout(finish, 10);
          var remaining = subs.pop() - 1;
          var muid = uid2(6);
          var packet = [self.nsp.name, uid, muid, rooms];

          pub.publish(prefix + '#clientrequest', msgpack.encode(packet));
          sub.on('pmessage', onclientresponsemessage);

          function onclientresponsemessage(pattern, channel, message) {
            if (!channel.match(/#clientresponse$/)) return;
            var pieces = channel.split('#');
            if (muid != pieces[1]) return debug('ignore different client request');
            var response = msgpack.decode(message);
            sids.push.apply(sids, response[0]);
            --remaining || finish();
          }

          function finish(){
            sub.removeListener('pmessage', onclientresponsemessage);
            clearTimeout(handle);
            fn && fn(null, sids);
          }
        });
      }
    });
  };

  return Redis;

}
