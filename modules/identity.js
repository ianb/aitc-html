/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const EXPORTED_SYMBOLS = ["Identity"];

const {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;

Cu.import("resource://services-sync/constants.js");
Cu.import("resource://services-sync/keys.js");
Cu.import("resource://services-sync/log4moz.js");
Cu.import("resource://services-sync/util.js");

XPCOMUtils.defineLazyGetter(this, "Identity", function() {
  return new IdentityManager();
});

/**
 * Manages identity and authentication for Sync.
 *
 * The following entities are managed:
 *
 *   account - The main Sync/services account. This is typically an email
 *     address.
 *   username - A normalized version of your account. This is what's
 *     transmitted to the server.
 *   basic password - UTF-8 password used for authenticating when using HTTP
 *     basic authentication.
 *   sync key - The main encryption key used by Sync.
 *   sync key bundle - A representation of your sync key.
 *
 * An instance of this type is lazily instantiated under Weave.Identity. It is
 * and should be treated as a global variable. The reason is that saved changes
 * are stored in preferences and the password manager. So, if you created
 * multiple instances, they would just step on each other's state.
 *
 * When changes are made to entities that are stored in the password manager
 * (basic password, sync key), those changes are merely staged. To commit them
 * to the password manager, you'll need to call persistCredentials().
 *
 * This type also manages authenticating Sync's network requests. Sync's
 * network code calls into getRESTRequestAuthenticator and
 * getResourceAuthenticator (depending on the network layer being used). Each
 * returns a function which can be used to add authentication information to an
 * outgoing request.
 *
 * In theory, this type supports arbitrary identity and authentication
 * mechanisms. You can add support for them by monkeypatching the global
 * instance of this type. Specifically, you'll need to redefine the
 * aforementioned network code functions to do whatever your authentication
 * mechanism needs them to do. In addition, you may wish to install custom
 * functions to support your API. Although, that is certainly not required.
 * If you do monkeypatch, please be advised that Sync expects the core
 * attributes to have values. You will need to carry at least account and
 * username forward. If you do not wish to support one of the built-in
 * authentication mechanisms, you'll probably want to redefine currentAuthState
 * and any other function that involves the built-in functionality.
 */
function IdentityManager() {
  this._log = Log4Moz.repository.getLogger("Sync.Identity");
  this._log.Level = Log4Moz.Level[Svc.Prefs.get("log.logger.identity")];
}
IdentityManager.prototype = {
  _log: null,

  _basicPassword: null,
  _basicPasswordRetrieved: false,
  _basicPasswordUpdated: false,

  _syncKey: null,
  _syncKeyRetrieved: false,
  _syncKeySet: false,

  _syncKeyBundle: null,

  get account() {
    return Svc.Prefs.get("account", this.username);
  },

  set account(value) {
    if (value) {
      value = value.toLowerCase();
      Svc.Prefs.set("account", value);
    } else {
      Svc.Prefs.reset("account");
    }

    this.username = this.usernameFromAccount(value);
  },

  get username() {
    return Svc.Prefs.get("username", null);
  },

  set username(value) {
    if (value) {
      value = value.toLowerCase();

      if (value == this.username) {
        return;
      }

      Svc.Prefs.set("username", value);
    } else {
      Svc.Prefs.reset("username");
    }

    // If we change the username, we interpret this as a major change event
    // and wipe out the credentials.
    this._log.info("Username changed. Removing stored credentials.");
    this.basicPassword = null;
    this.syncKey = null;
    // syncKeyBundle cleared as a result of setting syncKey.
  },

  /**
   * Obtains the HTTP Basic auth password.
   *
   * Returns a string if set or null if it is not set.
   */
  get basicPassword() {
    if (!this._basicPasswordRetrieved) {
      // We need a username to find the credentials.
      var username = this.username;
      if (!username) {
        return null;
      }

      for each (var login in this._getLogins(PWDMGR_PASSWORD_REALM)) {
        if (login.username.toLowerCase() == username) {
          // It should already be UTF-8 encoded, but we don't take any chances.
          this._basicPassword = Utils.encodeUTF8(login.password);
        }
      }

      this._basicPasswordRetrieved = true;
    }

    return this._basicPassword;
  },

  set basicPassword(value) {
    // Wiping out value.
    if (!value) {
      this._log.info("Basic password has no value. Removing.");
      this._basicPassword = null;
      this._basicPasswordUpdated = true;
      return;
    }

    var username = this.username;
    if (!username) {
      throw new Error("basicPassword cannot be set before username.");
    }

    this._basicPassword = Utils.encodeUTF8(value);
    this._basicPasswordUpdated = true;
  },

  get syncKey() {
    if (!this._syncKeyRetrieved) {
      var username = this.username;
      if (!username) {
        return null;
      }

      for each (var login in this._getLogins(PWDMGR_PASSPHRASE_REALM)) {
        if (login.username.toLowerCase() == username) {
          this._syncKey = login.password;
        }
      }

      this._syncKeyRetrieved = true;
    }

    return this._syncKey;
  },

  set syncKey(value) {
    if (!value) {
      this._log.info("Sync Key has no value. Deleting.");
      this._syncKey = null;
      this._syncKeyBundle = null;
      this._syncKeyUpdated = true;
      return;
    }

    if (!this.username) {
      throw new Error("syncKey cannot be set before username.");
    }

    this._syncKey = value;

    // Calling the getter has the side-effect of populating the object, which
    // we desire.
    var bundle = this.syncKeyBundle;

    this._syncKeyUpdated = true;
  },

  get syncKeyBundle() {
    // We can't obtain a bundle without a username set.
    if (!this.username) {
      this._log.warn("Attempted to obtain Sync Key Bundle with no username set!");
      return null;
    }

    if (!this.syncKey) {
      this._log.warn("Attempted to obtain Sync Key Bundle with no Sync Key " +
                     "set!");
      return null;
    }

    if (!this._syncKeyBundle) {
      this._syncKeyBundle = new SyncKeyBundle(PWDMGR_PASSPHRASE_REALM,
                                              this.username);
    }

    this._syncKeyBundle.keyStr = this.syncKey;

    return this._syncKeyBundle;
  },

  /**
   * The current state of the auth credentials.
   *
   * This essentially validates that enough credentials are available to use
   * Sync.
   */
  get currentAuthState() {
    if (!this.username) {
      return LOGIN_FAILED_NO_USERNAME;
    }

    if (Utils.mpLocked()) {
      return STATUS_OK;
    }

    if (!this.basicPassword) {
      return LOGIN_FAILED_NO_PASSWORD;
    }

    if (!this.syncKey) {
      return LOGIN_FAILED_NO_PASSPHRASE;
    }

    return STATUS_OK;
  },

  /**
   * Persist credentials to password store.
   *
   * When credentials are updated, they are changed in memory only. This will
   * need to be called to save them to the underlying password store.
   *
   * If the password store is locked (e.g. if the master password hasn't been
   * entered), this could throw an exception.
   */
  persistCredentials: function persistCredentials() {
    if (this._basicPasswordUpdated) {
      if (this._basicPassword) {
        this._setLogin(PWDMGR_PASSWORD_REALM, this.username,
                       this._basicPassword);
      } else {
        for each (var login in this._getLogins(PWDMGR_PASSWORD_REALM)) {
          Services.logins.removeLogin(login);
        }
      }

      this._basicPasswordUpdated = false;
    }

    if (this._syncKeyUpdated) {
      if (this._syncKey) {
        this._setLogin(PWDMGR_PASSPHRASE_REALM, this.username, this._syncKey);
      } else {
        for each (var login in this._getLogins(PWDMGR_PASSPHRASE_REALM)) {
          Services.logins.removeLogin(login);
        }
      }

      this._syncKeyUpdated = false;
    }

  },

  /**
   * Deletes the Sync Key from the system.
   */
  deleteSyncKey: function deleteSyncKey() {
    this.syncKey = null;
    this.persistCredentials();
  },

  hasBasicCredentials: function hasBasicCredentials() {
    return this.username && this.basicPassword;
  },

  /**
   * Obtains the array of basic logins from nsiPasswordManager.
   */
  _getLogins: function _getLogins(realm) {
    return Services.logins.findLogins({}, PWDMGR_HOST, null, realm);
  },

  /**
   * Set a login in the password manager.
   *
   * This has the side-effect of deleting any other logins for the specified
   * realm.
   */
  _setLogin: function _setLogin(realm, username, password) {
    var exists = false;
    for each (var login in this._getLogins(realm)) {
      if (login.username == username && login.password == password) {
        exists = true;
      } else {
        this._log.debug("Pruning old login for " + username + " from " + realm);
        Services.logins.removeLogin(login);
      }
    }

    if (exists) {
      return;
    }

    this._log.debug("Updating saved password for " + username + " in " +
                    realm);

    var loginInfo = new Components.Constructor(
      "@mozilla.org/login-manager/loginInfo;1", Ci.nsILoginInfo, "init");
    var login = new loginInfo(PWDMGR_HOST, null, realm, username,
                                password, "", "");
    Services.logins.addLogin(login);
  },

  deleteSyncCredentials: function deleteSyncCredentials() {
    var logins = Services.logins.findLogins({}, PWDMGR_HOST, "", "");
    for each (var login in logins) {
      Services.logins.removeLogin(login);
    }

    // Wait until after store is updated in case it fails.
    this._basicPassword = null;
    this._basicPasswordRetrieved = false;
    this._basicPasswordUpdated = false;

    this._syncKey = null;
    // this._syncKeyBundle is nullified as part of _syncKey setter.
    this._syncKeyRetrieved = false;
    this._syncKeyUpdated = false;
  },

  usernameFromAccount: function usernameFromAccount(value) {
    // If we encounter characters not allowed by the API (as found for
    // instance in an email address), hash the value.
    if (value && value.match(/[^A-Z0-9._-]/i)) {
      return Utils.sha1Base32(value.toLowerCase()).toLowerCase();
    }

    return value ? value.toLowerCase() : value;
  },

  /**
   * Obtain a function to be used for adding auth to Resource HTTP requests.
   */
  getResourceAuthenticator: function getResourceAuthenticator() {
    if (this.hasBasicCredentials()) {
      return this._onResourceRequestBasic.bind(this);
    }

    return null;
  },

  /**
   * Helper method to return an authenticator for basic Resource requests.
   */
  getBasicResourceAuthenticator:
    function getBasicResourceAuthenticator(username, password) {

    return function basicAuthenticator(resource) {
      var value = "Basic " + btoa(username + ":" + password);
      return {headers: {authorization: value}};
    };
  },

  _onResourceRequestBasic: function _onResourceRequestBasic(resource) {
    var value = "Basic " + btoa(this.username + ":" + this.basicPassword);
    return {headers: {authorization: value}};
  },

  _onResourceRequestMAC: function _onResourceRequestMAC(resource, method) {
    // TODO Get identifier and key from somewhere.
    var identifier;
    var key;
    var result = Utils.computeHTTPMACSHA1(identifier, key, method, resource.uri);

    return {headers: {authorization: result.header}};
  },

  /**
   * Obtain a function to be used for adding auth to RESTRequest instances.
   */
  getRESTRequestAuthenticator: function getRESTRequestAuthenticator() {
    if (this.hasBasicCredentials()) {
      return this.onRESTRequestBasic.bind(this);
    }

    return null;
  },

  onRESTRequestBasic: function onRESTRequestBasic(request) {
    var up = this.username + ":" + this.basicPassword;
    request.setHeader("authorization", "Basic " + btoa(up));
  }
};
