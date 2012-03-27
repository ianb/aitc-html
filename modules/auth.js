/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const EXPORTED_SYMBOLS = [
  "TokenServerClient",
  "TokenServerClientError",
  "TokenServerClientNetworkError",
  "TokenServerClientServerError"
];

const {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;

Cu.import("resource://services-sync/log4moz.js");
Cu.import("resource://services-sync/rest.js");
Cu.import("resource://services-sync/util.js");

/**
 * Represents a TokenServerClient error that occurred on the client.
 *
 * @param message
 *        (string) Error message.
 */
function TokenServerClientError(message) {
  this.name = "TokenServerClientError";
  this.message = message || "Client error.";
}
TokenServerClientError.prototype = new Error();
TokenServerClientError.prototype.constructor = TokenServerClientError;

/**
 * Represents a TokenServerClient error that occurred in the network layer.
 *
 * @param error
 *        The underlying error thrown by the network layer.
 */
function TokenServerClientNetworkError(error) {
  this.name = "TokenServerClientNetworkError";
  this.error = error;
}
TokenServerClientNetworkError.prototype = new TokenServerClientError();
TokenServerClientNetworkError.prototype.constructor =
  TokenServerClientNetworkError;

/**
 * Represents a TokenServerClient error that occurred on the server.
 *
 * @param message
 *        (string) Error message.
 */
function TokenServerClientServerError(message) {
  this.name = "TokenServerClientServerError";
  this.message = message || "Server error.";
}
TokenServerClientServerError.prototype = new TokenServerClientError();
TokenServerClientServerError.prototype.constructor =
  TokenServerClientServerError;

/**
 * Represents a client to the Token Server.
 *
 * https://wiki.mozilla.org/Services/Sagrada/TokenServer
 *
 * This class will likely be used by multiple clients outside of Sync. It
 * should ideally be implemented such that it can be extracted some day.
 *
 * The Token Server supports obtaining tokens for arbitrary apps by
 * constructing URI paths of the form <version>/<app>/<app_version>. However,
 * the service discovery mechanism emphasizes the use of full URIs and tries to
 * not force the client to manipulate URIs. This type currently enforces this
 * practice by not implementing an API which would perform URI manipulation.
 * If you are tempted to implement this API in the future, consider this your
 * warning that you may be doing it wrong and that you should store full URIs
 * instead.
 */
function TokenServerClient() {
  this._log = Log4Moz.repository.getLogger("Sync.TokenServerClient");
  this._log.level =
    Log4Moz.Level[Svc.Prefs.get("log.logger.auth.tokenserver")];
}
TokenServerClient.prototype = {
  /**
   * Logger instance.
   */
  _log: null,

  /**
   * Obtain a token from a BrowserID assertion against a specific URL.
   *
   * This asynchronously obtains the token. The callback receives 2 arguments.
   * The first signifies an error and is an Error-derived type when an error
   * occurs. If an HTTP response was seen, a RESTResponse instance will be
   * stored in the "response" property of this object.
   *
   * The second argument to the callback is a map containing the results from
   * the server. This map has the following keys:
   *
   *   id - HTTP MAC public key identifier
   *   key - HTTP MAC private key
   *   serviceEntry - string URL where service can be connected to.
   *
   * @param  url
   *         (string) URL to fetch token from.
   * @param  assertion
   *         (string) BrowserID assertion to exchange token for.
   * @param  cb
   *         (function) Callback to be invoked with result of operation.
   */
  getTokenFromBrowserIDAssertion:
    function getTokenFromBrowserIDAssertion(url, assertion, cb) {
    if (!url) {
      throw new TokenServerClientError("url argument is not valid.");
    }

    if (!assertion) {
      throw new TokenServerClientError("assertion argument is not valid.");
    }

    if (!cb) {
      throw new TokenServerClientError("cb argument is not valid.");
    }

    this._log.debug("Beginning BID assertion exchange: " + url);

    var req = new RESTRequest(url);
    req.setHeader("accept", "application/json");
    req.setHeader("authorization", "Browser-ID " + assertion);
    var client = this;
    req.get(function onResponse(error) {
      if (error) {
        cb(new TokenServerClientNetworkError(error), null);
        return;
      }

      try {
        client._processTokenResponse(this.response, cb);
      } catch (ex) {
        var error = new TokenServerClientError(ex);
        error.response = this.response;
        cb(error, null);
        return;
      }
    });
  },

  /**
   * Handler to process token request responses.
   *
   * @param response
   *        RESTResponse from token HTTP request.
   * @param cb
   *        The original callback passed to the public API.
   */
  _processTokenResponse: function processTokenResponse(response, cb) {
    this._log.debug("Got token response.");

    if (!response.success) {
      this._log.info("Non-200 response code to token request: " +
                     response.status);
      var error = new TokenServerClientServerError("Non 2xx response code: " +
                                                   response.status);
      error.response = response;
      cb(error, null);
      return;
    }

    var ct = response.headers["content-type"];
    if (ct != "application/json" && ct.indexOf("application/json;") != 0) {
      var error =  new TokenServerClientError("Unsupported media type: " + ct);
      error.response = response;
      cb(error, null);
      return;
    }

    var result;
    try {
      result = JSON.parse(response.body);
    } catch (ex) {
      var error = new TokenServerClientServerError("Invalid JSON returned " +
                                                   "from server.");
      error.response = response;
      cb(error, null);
      return;
    }

    for each (var k in ["id", "key", "service_entry"]) {
      if (!(k in result)) {
        var error = new TokenServerClientServerError("Expected key not " +
                                                     " present in result: " +
                                                     k);
        error.response = response;
        cb(error, null);
        return;
      }
    }

    this._log.debug("Successful token response: " + result.id);
    cb(null, {
      id:           result.id,
      key:          result.key,
      serviceEntry: result.service_entry
    });
  }
};
