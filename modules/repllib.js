/* A replacement for a few bits of code that is commonly used and easily reimplemented */

var Components = {
  Exception: function Components_Exception(message, result) {
    return new _Components_Exception(message, result);
  }
};

function _Components_Exception(message, result) {
  this.message = this.name = message;
  this.result = result;
}

_Components_Exception.prototype.toString = function toString() {
  var e = '[Exception: ' + this.message;
  if (this.result) {
    e += ' ' + this.result;
  }
  return e + ']';
};

var Utils = {
  exceptionStr: function (ex) {
    return ex + '';
  }
};
