/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const EXPORTED_SYMBOLS = [
  "BulkKeyBundle",
  "SyncKeyBundle"
];

const {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;

Cu.import("resource://services-sync/constants.js");
Cu.import("resource://services-sync/log4moz.js");
Cu.import("resource://services-sync/util.js");

/**
 * Abuse Identity: store the collection name (or default) in the
 * username field, and the keyStr in the password field.
 *
 * We very rarely want to override the realm, so pass null and
 * it'll default to PWDMGR_KEYBUNDLE_REALM.
 *
 * KeyBundle is the base class for two similar classes:
 *
 * SyncKeyBundle:
 *
 *   A key string is provided, and it must be hashed to derive two different
 *   keys (one HMAC, one AES).
 *
 * BulkKeyBundle:
 *
 *   Two independent keys are provided, or randomly generated on request.
 *
 */
function KeyBundle(realm, collectionName, keyStr) {
  var realm = realm || PWDMGR_KEYBUNDLE_REALM;

  if (keyStr && !keyStr.charAt) {
    // Ensure it's valid.
    throw "KeyBundle given non-string key.";
  }

  this.realm = realm;
  this.username = collectionName;
  this._password = keyStr;
}
KeyBundle.prototype = {
  realm: null,
  username: null,

  _encrypt: null,
  _hmac: null,
  _hmacObj: null,
  _sha256HMACHasher: null,

  equals: function equals(bundle) {
    return bundle &&
           (bundle.hmacKey == this.hmacKey) &&
           (bundle.encryptionKey == this.encryptionKey);
  },

  get password() {
    if (this._password == null) {
      var logins = Services.logins.findLogins({}, PWDMGR_HOST, null,
                                              this.realm);
      for each (var login in logins) {
        if (login.username.toLowerCase() == this.username) {
          this._password = login.password;
        }
      }
    }

    return this._password;
  },

  set password(value) {
    this._password = value;
  },

  /*
   * Accessors for the two keys.
   */
  get encryptionKey() {
    return this._encrypt;
  },

  set encryptionKey(value) {
    this._encrypt = value;
  },

  get hmacKey() {
    return this._hmac;
  },

  set hmacKey(value) {
    this._hmac = value;
    this._hmacObj = value ? Utils.makeHMACKey(value) : null;
    this._sha256HMACHasher = value ? Utils.makeHMACHasher(
      Ci.nsICryptoHMAC.SHA256, this._hmacObj) : null;
  },

  get hmacKeyObject() {
    return this._hmacObj;
  },

  get sha256HMACHasher() {
    return this._sha256HMACHasher;
  }
};

function BulkKeyBundle(realm, collectionName) {
  var log = Log4Moz.repository.getLogger("Sync.BulkKeyBundle");
  log.info("BulkKeyBundle being created for " + collectionName);
  KeyBundle.call(this, realm, collectionName);
}

BulkKeyBundle.prototype = {
  __proto__: KeyBundle.prototype,

  generateRandom: function generateRandom() {
    var generatedHMAC = Svc.Crypto.generateRandomKey();
    var generatedEncr = Svc.Crypto.generateRandomKey();
    this.keyPair = [generatedEncr, generatedHMAC];
  },

  get keyPair() {
    return [this._encrypt, btoa(this._hmac)];
  },

  /*
   * Use keyPair = [enc, hmac], or generateRandom(), when
   * you want to manage the two individual keys.
   */
  set keyPair(value) {
    if (value.length && (value.length == 2)) {
      var json = JSON.stringify(value);
      var en = value[0];
      var hm = value[1];

      this.password = json;
      this.hmacKey  = Utils.safeAtoB(hm);
      this._encrypt = en;          // Store in base64.
    }
    else {
      throw "Invalid keypair";
    }
  }
};

function SyncKeyBundle(realm, collectionName, syncKey) {
  var log = Log4Moz.repository.getLogger("Sync.SyncKeyBundle");
  log.info("SyncKeyBundle being created for " + collectionName);
  KeyBundle.call(this, realm, collectionName, syncKey);
  if (syncKey)
    this.keyStr = syncKey;      // Accessor sets up keys.
}

SyncKeyBundle.prototype = {
  __proto__: KeyBundle.prototype,

  /*
   * Use keyStr when you want to work with a key string that's
   * hashed into individual keys.
   */
  get keyStr() {
    return this.password;
  },

  set keyStr(value) {
    this.password = value;
    this._hmac    = null;
    this._hmacObj = null;
    this._encrypt = null;
    this._sha256HMACHasher = null;
  },

  /*
   * Can't rely on password being set through any of our setters:
   * Identity does work under the hood.
   *
   * Consequently, make sure we derive keys if that work hasn't already been
   * done.
   */
  get encryptionKey() {
    if (!this._encrypt)
      this.generateEntry();
    return this._encrypt;
  },

  get hmacKey() {
    if (!this._hmac)
      this.generateEntry();
    return this._hmac;
  },

  get hmacKeyObject() {
    if (!this._hmacObj)
      this.generateEntry();
    return this._hmacObj;
  },

  get sha256HMACHasher() {
    if (!this._sha256HMACHasher)
      this.generateEntry();
    return this._sha256HMACHasher;
  },

  /*
   * If we've got a string, hash it into keys and store them.
   */
  generateEntry: function generateEntry() {
    var syncKey = this.keyStr;
    if (!syncKey)
      return;

    // Expand the base32 Sync Key to an AES 256 and 256 bit HMAC key.
    var prk = Utils.decodeKeyBase32(syncKey);
    var info = HMAC_INPUT + this.username;
    var okm = Utils.hkdfExpand(prk, info, 32 * 2);
    var enc = okm.slice(0, 32);
    var hmac = okm.slice(32, 64);

    // Save them.
    this._encrypt = btoa(enc);
    // Individual sets: cheaper than calling parent setter.
    this._hmac = hmac;
    this._hmacObj = Utils.makeHMACKey(hmac);
    this._sha256HMACHasher = Utils.makeHMACHasher(
      Ci.nsICryptoHMAC.SHA256, this._hmacObj);
  }
};

