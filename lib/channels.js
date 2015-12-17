module.exports = Channels;

const DELIM = '/';
const VALID = /^[^\s\/*]*$/;

function Channels(opts) {

  opts = opts || {};

  var prefix = validatePrefix(opts.prefix);

  function trimSlash(str) {
    if (str.startsWith(DELIM)) {
      if (str.length == 1) {
        return '';
      }
      if (str.endsWith(DELIM)) {
        return str.substring(1, str.length - 1);
      }
      return str.substring(1);
    }
    if (str.endsWith(DELIM)) {
      return str.substring(0, str.length - 1);
    }
    return str;
  }

  function validatePrefix(prefix) {
    if (!prefix) {
      throw 'Null prefix';
    }
    return validatePart(prefix, 'prefix');
  }

  function validateNamespace(namespace) {
    if (namespace === undefined || namespace === null) {
      return '';
    }
    return validatePart(namespace, 'namespace');
  }

  function validateRoom(room) {
    if (room === undefined || room === null) {
      return '';
    }
    return validatePart(room, 'room');
  }

  function validatePart(part, partName) {
    var trimmed = trimSlash(part);
    if (!VALID.test(trimmed)) {
      throw 'Invalid ' + partName + ': ' + trimmed;
    }
    return trimmed;
  }

  function serialize(channel) {
    return str(channel.namespace, channel.room);
  }

  function str(namespace, room) {
    namespace = validateNamespace(namespace);
    room = validateRoom(room);
    if (room) {
        return prefix + DELIM
          + validateNamespace(namespace) + DELIM
          + validateRoom(room);
    }
    return prefix + DELIM + validateNamespace(namespace);
  }

  function deserialize(channel) {
    var parts = channel.split(DELIM, 4);
    if (parts.length > 3) {
      throw 'Invalid channel: ' + channel;
    }
    return {
      prefix: validatePrefix(parts[0]),
      namespace: validateNamespace(parts[1]),
      room: (parts.length > 2 ? validateRoom(parts[2]) : null)
    };
  }

  return {
    str: str,
    serialize: serialize,
    deserialize: deserialize
  };

}
