function dump(message) {
  console.log(message.replace(/\n+$/, ""));
}

var Components = {
  Exception: function Exception(message, result, stack, data) {
    return new ComponentsException(message, result, stack, data);
  },
  classes: {
    getClass: function getClass(name) {
      if (! (name in this)) {
        this[name] = new ComponentClassRegistry(name);
      }
      return this[name];
    }
  },
  interfaces: {
  },
  results: {
    NS_ERROR_UNEXPECTED: "NS_ERROR_UNEXPECTED"
  },
  utils: {
    reportError: dump
  }
};

function ComponentClassRegistry(name) {
  this.name = name;
  this._registeredFactories = {};
  this._interfaces = {};
  this._registered = {};
}

ComponentClassRegistry.prototype = {
  registerService: function registerService(iface, factory) {
    var ifaceName = this._makeIfaceName(iface);
    if (typeof iface == "string") {
      if (! (iface in Components.interfaces)) {
        Components.interfaces[iface] = iface;
      }
    }
    if (typeof factory == "function") {
      this._registeredFactories[ifaceName] = factory;
    } else {
      this._registered[ifaceName] = factory;
    }
    this._interfaces[ifaceName] = iface;
  },
  _makeIfaceName: function _makeIfaceName(iface) {
    if (typeof iface == "string") {
      return iface;
    }
    if (iface.__ClassRegistryName__) {
      throw 'Component already registered: ' + i;
    }
    var n = 0;
    var name = iface.toString();
    while (iface in this._registered) {
      n++;
      name = iface.toString() + '_' + n;
    }
    iface.__ClassRegistryName__ = name;
    return name;
  },
  getService: function getService(iface) {
    if (typeof iface == "string") {
      var name = iface;
    } else if (! iface.__ClassRegistryName__) {
      throw 'Component not registered: ' + iface;
    } else {
      var name = iface.__ClassRegistryName__;
    }
    if (name in this._registeredFactories) {
      var obj = new this._registeredFactories[name]();
      delete this._registeredFactories[name];
      this._registered = obj;
      return obj;
    } else {
      return this._registered[name];
    }
  }
};



// Implements both pref service and content pref service
function BrowserPrefService(options) {
  options = options || {};
  this._prefix = options.prefix || "";
  var storageHandler = options.storage || new TypedStorage();
  this.storage = storageHandler.open("prefs");
  this._defaults = options.defaults || {};
  this._locks = {};
}

BrowserPrefService.prototype = {
  _siteName: function _siteName(site, prefName) {
    if (typeof site !== "string") {
      // FIXME: Should be normalized
      site = site.spec;
    }
    return 'site:' + site + '+' + prefName;
  },
  getPrefType: function getPrefType(name) {
    var value = this.getPrefValue(name);
    return typeof value;
  },
  getPrefValue: function getPrefValue(name) {
    var value = this.storage.get(this._prefix + name);
    if (value === undefined) {
      value = this._defaults[value];
    }
    return value;
  },
  setPrefValue: function setPrefValue(name, value) {
    if (name in this._locks) {
      // FIXME: better error:
      throw 'Pref locked';
    }
    this.storage.put(this._prefix + name, value);
  },
  prefHasUserValue: function prefHasUserValue(name) {
    return this.storage.get(name) !== undefined;
  },
  // Content pref
  setPref: function setPref(site, fullName, value) {
    this.setPrefValue(this._siteName(site, fullName), value);
  },
  hasPref: function hasPref(site, fullName, value) {
    return this.getPref(site, fullName, value) !== undefined;
  },
  clearUserPref: function clearUserPref(name) {
    var value = this.storage.get(name);
    if (value === undefined) {
      throw {result: NS_ERROR_UNEXPECTED};
    }
    this.storage.remove(name);
  },
  removePrefValue: function (name) {
    this.storage.remove(name);
  },
  removePref: function (site, fullName) {
    this.removePrefValue(this._siteName(site, fullName));
  },
  lockPref: function (name) {
    this._locks[name] = true;
  },
  unlockPref: function (name) {
    delete this._locks[name];
  },
  prefIsLocked: function (name) {
    return name in this._locks;
  },
  addObserver: function addObserver(fullPrefName, observer, ownsWeak) {
    throw 'addObserver not implemented';
  },
  removeObserver: function removeObserver(fullPrefName, observer) {
    throw 'removeObserver not implemented';
  },
  resetBranch: function (prefBranch) {
    throw {result: NS_ERROR_NOT_IMPLEMENTED};
  },
  getChildList: function (prefBranch, childArray) {
    // FIXME: doesn't handle site lists
    var result = this.storage.keys();
    // FIXME: filter on prefBranch?
    for (var i=0; i<result.length; i++) {
      childArray.push(result[i]);
    }
    return childArray;
  },
  getDefaultBranch: function getDefaultBranch(prefBranch) {
    return this;
  },
  getBranch: function getBranch(prefBranch) {
    return new BrowserPrefService({prefix: this._prefix + "-" + prefBranch});
  }

};

Components.classes.getClass('@mozilla.org/preferences-service;1').registerService(
  "nsiPrefService", function () {return new BrowserPrefService();});

Components.classes.getClass("@mozilla.org/content-pref/service;1").registerService(
  "nsIContentPrefService", function () {return new ContentPrefService();});

BrowserPrefService.prototype.getComplexValue =
  BrowserPrefService.prototype.getIntPref =
  BrowserPrefService.prototype.getBoolPref =
  BrowserPrefService.prototype.getPrefValue;
BrowserPrefService.prototype.setComplexValue =
  BrowserPrefService.prototype.setIntPref =
  BrowserPrefService.prototype.setBoolPref =
  BrowserPrefService.prototype.setPrefValue;

var NS_ERROR_UNEXPECTED = "NS_ERROR_UNEXPECTED";
var NS_ERROR_NOT_IMPLEMENTED = "NS_ERROR_NOT_IMPLEMENTED";

Components.interfaces.nsIPrefBranch = {
  PREF_STRING: "string",
  PREF_INT: "number",
  PREF_BOOL: "boolean",
  PREF_INVALID: "undefined"
};

function LocalPrefStorage(prefix, storage) {
  this.prefix = prefix || "";
  this.storage = storage || localStorage;
}

// URI service:

function newURI(aSpec, aOriginCharset, aBaseURI) {
  return new nsIURI(aSpec, aOriginCharset, aBaseURI);
}

function nsIURI(aSpec, aOriginCharset, aBaseURI) {
  this.spec = aSpec;
  this.originCharset = aOriginCharset;
  this.baseURI = aBaseURI;
}

nsIURI.prototype = {
  get asciiHost () {
    throw 'asciiHost not implemented';
  },
  get asciiSpec() {
    throw 'asciiSpec not implemented';
  },
  get host() {
    throw 'asciiSpec not implemented';
  },
  get hostPort() {
    throw 'hostPort not implemented';
  },
  get password() {
    throw 'password not implemented';
  },
  get path() {
    throw 'path not implemented';
  },
  get port() {
    throw 'port not implemented';
  },
  get prePath() {
    // Returns everything before the path starts
    throw 'prePath not implemented';
  },
  get ref() {
    // Returns the fragment (excluding #)
    throw 'ref not implemented';
  },
  get scheme() {
    throw 'scheme not implemented';
  },
  get username() {
    throw 'username not implemented';
  },
  get userPass() {
    throw 'userPass not implemented';
  },
  // FIXME: also support setters
  clone: function clone() {
    return new nsIURI(this.spec, this.originCharset, this.baseURI);
  },
  cloneIgnoringRef: function cloneIgnoringRef() {
    throw 'cloneIgnoringRef not implemented';
  },
  equals: function equals(other) {
    // Does semantic comparison
    throw 'equals not implemented';
  },
  equalsExceptRef: function equalsExceptRef(other) {
    throw 'equalsExceptRef not implemented';
  },
  resolve: function resolve(relativePath) {
    throw 'resolve not implemented';
  },
  schemeIs: function schemeIs(scheme) {
    return this.scheme.toLowerCase() == scheme.toLowerCase();
  }
};

Components.classes.getClass("@mozilla.org/network/io-service;1").registerService(
  "nsIIOService", {nsIURI: nsIURI, newURI: newURI});

Components.interfaces.nsIURI = nsIURI;

function ComponentsException(message, result, stack, data) {
  this.message = message;
  this.result = result;
  this.stack = stack;
  this.data = data;
}

ComponentsException.prototype = {
  toString: function () {
    return '[Exception ' + this.message + ' code: ' + this.result + ']';
  }
};

var Services = {
  io: {
    newURI: newURI
  }
};


Components.classes.getClass("@mozilla.org/consoleservice;1").registerService(
  "nsIConsoleService", {
  logStringMessage: function logStringMessage(message) {
    if (window.console && console.log) {
      console.log(message);
    }
  }
  // Missing: getMessageArray, logMessage(messageObject), registerListener, reset, unregisterListener
});
