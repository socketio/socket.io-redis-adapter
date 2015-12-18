var assert = require('assert');
var channels = require('../lib/channels')({
  prefix: 'prefix'
});

describe('socket.io-redis:channels', function(){

  it('concats full channel', function(done){
    var chn = channels.str('namespace', 'room');
    assert.equal(chn, 'prefix/namespace/room');
    done();
  });

  it('parses delims properly', function(done){
    var chn = channels.str('/namespace', '/room');
    assert.equal(chn, 'prefix/namespace/room');
    done();
  });

  it('handles empty namespace', function(done){
    var chn = channels.str(null, '/room');
    assert.equal(chn, 'prefix//room');
    done();
  });

  it('handles empty room', function(done){
    var chn = channels.str('namespace', null);
    assert.equal(chn, 'prefix/namespace');
    done();
  });

  it('serializes full channel', function(done){
    var chn = channels.serialize({
      namespace: 'namespace',
      room: 'room'
    });
    assert.equal(chn, 'prefix/namespace/room');
    done();
  });

  it('deserializes full channel', function(done){
    var chn = channels.deserialize('prefix/namespace/room');
    assert.deepEqual(chn, {
      prefix: 'prefix',
      namespace: 'namespace',
      room: 'room'
    });
    done();
  });

});
