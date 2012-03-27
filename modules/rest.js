/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Firefox Sync.
 *
 * The Initial Developer of the Original Code is
 * the Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Philipp von Weitershausen <philipp@weitershausen.de>
 *   Richard Newman <rnewman@mozilla.com>
 *   Dan Mills <thunder@mozilla.com>
 *   Anant Narayanan <anant@kix.in>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

Cu.import("resource://services-sync/log4moz.js");
Cu.import("resource://services-sync/util.js");
Cu.import("resource://services-sync/identity.js");
Cu.import("resource://services-sync/constants.js");

const EXPORTED_SYMBOLS = ["RESTRequest", "RESTResponse", "SyncStorageRequest"];

const STORAGE_REQUEST_TIMEOUT = 5 * 60; // 5 minutes

/**
 * Single use HTTP requests to RESTish resources.
 *
 * @param uri
 *        URI for the request. This can be an nsIURI object or a string
 *        that can be used to create one. An exception will be thrown if
 *        the string is not a valid URI.
 *
 * Examples:
 *
 * (1) Quick GET request:
 *
 *   new RESTRequest("http://server/rest/resource").get(function (error) {
 *     if (error) {
 *       // Deal with a network error.
 *       processNetworkErrorCode(error.result);
 *       return;
 *     }
 *     if (!this.response.success) {

 *  *       // Bail out if we're not getting an HTTP 2xx code.
 *       processHTTPError(this.response.status);
 *       return;
 *     }
 *     processData(this.response.body);
 *   });
 *
 * (2) Quick PUT request (non-string data is automatically JSONified)
 *
 *   new RESTRequest("http://server/rest/resource").put(data, function (error) {
 *     ...
 *   });
 *
 * (3) Streaming GET
 *
 *   var request = new RESTRequest("http://server/rest/resource");
 *   request.setHeader("Accept", "application/newlines");
 *   request.onComplete = function (error) {
 *     if (error) {
 *       // Deal with a network error.
 *       processNetworkErrorCode(error.result);
 *       return;
 *     }
 *     callbackAfterRequestHasCompleted()
 *   });
 *   request.onProgress = function () {
 *     if (!this.response.success) {
 *       // Bail out if we're not getting an HTTP 2xx code.
 *       return;
 *     }
 *     // Process body data and reset it so we don't process the same data twice.
 *     processIncrementalData(this.response.body);
 *     this.response.body = "";
 *   });
 *   request.get();
 */
function RESTRequest(uri) {
  this.status = this.NOT_SENT;

  // If we don't have an nsIURI object yet, make one. This will throw if
  // 'uri' isn't a valid URI string.
  if (!(uri instanceof Ci.nsIURI)) {
    uri = Services.io.newURI(uri, null, null);
  }
  this.uri = uri;

  this._headers = {};
  this._log = Log4Moz.repository.getLogger(this._logName);
  this._log.level =
    Log4Moz.Level[Svc.Prefs.get("log.logger.network.resources")];
}
RESTRequest.prototype = {

  _logName: "Sync.RESTRequest",

  /*** Public API: ***/

  /**
   * URI for the request (an nsIURI object).
   */
  uri: null,

  /**
   * HTTP method (e.g. "GET")
   */
  method: null,

  /**
   * RESTResponse object
   */
  response: null,

  /**
   * nsIHttpChannel
   */
  channel: null,

  /**
   * Flag to indicate the status of the request.
   *
   * One of NOT_SENT, SENT, IN_PROGRESS, COMPLETED, ABORTED.
   */
  status: null,

  NOT_SENT:    0,
  SENT:        1,
  IN_PROGRESS: 2,
  COMPLETED:   4,
  ABORTED:     8,

  /**
   * Request timeout (in seconds, though decimal values can be used for
   * up to millisecond granularity.)
   *
   * 0 for no timeout.
   */
  timeout: null,

  /**
   * Called when the request has been completed, including failures and
   * timeouts.
   *
   * @param error
   *        Error that occurred while making the request, null if there
   *        was no error.
   */
  onComplete: function onComplete(error) {
  },

  /**
   * Called whenever data is being received on the channel. If this throws an
   * exception, the request is aborted and the exception is passed as the
   * error to onComplete().
   */
  onProgress: function onProgress() {
  },

  /**
   * Set a request header.
   */
  setHeader: function setHeader(name, value) {
    this._headers[name.toLowerCase()] = value;
  },

  /**
   * Perform an HTTP GET.
   *
   * @param onComplete
   *        Short-circuit way to set the 'onComplete' method. Optional.
   * @param onProgress
   *        Short-circuit way to set the 'onProgress' method. Optional.
   *
   * @return the request object.
   */
  get: function get(onComplete, onProgress) {
    return this.dispatch("GET", null, onComplete, onProgress);
  },

  /**
   * Perform an HTTP PUT.
   *
   * @param data
   *        Data to be used as the request body. If this isn't a string
   *        it will be JSONified automatically.
   * @param onComplete
   *        Short-circuit way to set the 'onComplete' method. Optional.
   * @param onProgress
   *        Short-circuit way to set the 'onProgress' method. Optional.
   *
   * @return the request object.
   */
  put: function put(data, onComplete, onProgress) {
    return this.dispatch("PUT", data, onComplete, onProgress);
  },

  /**
   * Perform an HTTP POST.
   *
   * @param data
   *        Data to be used as the request body. If this isn't a string
   *        it will be JSONified automatically.
   * @param onComplete
   *        Short-circuit way to set the 'onComplete' method. Optional.
   * @param onProgress
   *        Short-circuit way to set the 'onProgress' method. Optional.
   *
   * @return the request object.
   */
  post: function post(data, onComplete, onProgress) {
    return this.dispatch("POST", data, onComplete, onProgress);
  },

  /**
   * Perform an HTTP DELETE.
   *
   * @param onComplete
   *        Short-circuit way to set the 'onComplete' method. Optional.
   * @param onProgress
   *        Short-circuit way to set the 'onProgress' method. Optional.
   *
   * @return the request object.
   */
  delete: function delete_(onComplete, onProgress) {
    return this.dispatch("DELETE", null, onComplete, onProgress);
  },

  /**
   * Abort an active request.
   */
  abort: function abort() {
    if (this.status != this.SENT && this.status != this.IN_PROGRESS) {
      throw "Can only abort a request that has been sent.";
    }

    this.status = this.ABORTED;
    this.channel.cancel(Cr.NS_BINDING_ABORTED);

    if (this.timeoutTimer) {
      // Clear the abort timer now that the channel is done.
      this.timeoutTimer.clear();
    }
  },

  /*** Implementation stuff ***/

  dispatch: function dispatch(method, data, onComplete, onProgress) {
    if (this.status != this.NOT_SENT) {
      throw "Request has already been sent!";
    }

    this.method = method;
    if (onComplete) {
      this.onComplete = onComplete;
    }
    if (onProgress) {
      this.onProgress = onProgress;
    }

    var req = new XMLHttpRequest();
    req.open(method, this.uri);
    this.xmlhttprequest = req;
    req.onreadystatechange = function () {
      this.onreadystatechange();
    };

    // Set request headers.
    var headers = this._headers;
    for (var key in headers) {
      if (key == 'authorization') {
        this._log.trace("HTTP Header " + key + ": ***** (suppressed)");
      } else {
        this._log.trace("HTTP Header " + key + ": " + headers[key]);
      }
      req.setRequestHeader(key, headers[key], false);
    }

    // Set HTTP request body.
    if (method == "PUT" || method == "POST") {
      // Convert non-string bodies into JSON.
      if (typeof data != "string") {
        data = JSON.stringify(data);
      }

      this._log.debug(method + " Length: " + data.length);
      if (this._log.level <= Log4Moz.Level.Trace) {
        this._log.trace(method + " Body: " + data);
      }

      var type = headers["content-type"] || "text/plain";
    } else {
      data = null;
    }

    // Blast off!
    req.send(data);
    this.status = this.SENT;
    this.delayTimeout();
    return this;
  },

  /**
   * Create or push back the abort timer that kills this request.
   */
  delayTimeout: function delayTimeout() {
    if (this.timeout) {
      Utils.namedTimer(this.abortTimeout, this.timeout * 1000, this,
                       "timeoutTimer");
    }
  },

  /**
   * Abort the request based on a timeout.
   */
  abortTimeout: function abortTimeout() {
    this.abort();
    var error = Components.Exception("Aborting due to channel inactivity.",
                                     Cr.NS_ERROR_NET_TIMEOUT);
    if (!this.onComplete) {
      this._log.error("Unexpected error: onComplete not defined in " +
                      "abortTimeout.");
      return;
    }
    this.onComplete(error);
  },

  /*** nsIStreamListener ***/

  onreadystatechange: function onreadystatechange() {
    var req = this.xmlhttprequest;
    if (req.readyState == 1) {
      // .send() has not yet been called
      return;
    }
    if (req.readyState == 2) {
      // headers have been received
      if (this.status == this.ABORTED) {
        this._log.trace("Not proceeding with onreadystatechange, request was aborted.");
        return;
      }
      this.status = this.IN_PROGRESS;
      var response = this.response = new RESTResponse();
      response.request = this;
      response.body = "";
      this.delayTimeout();
      return;
    }
    if (req.readyState == 3) {
      // Some content has been received in .responseText, but not complete content
      this.response.body = req.responseText;
      this.callOnProgress();
      return;
    }

    // Otherwise the request completed
    this.response.body = req.responseText;

    if (this.timeoutTimer) {
      // Clear the abort timer now that the channel is done.
      this.timeoutTimer.clear();
    }

    // We don't want to do anything for a request that's already been aborted.
    if (this.status == this.ABORTED) {
      this._log.trace("Not proceeding with onreadystatechange, request was aborted.");
      return;
    }

    this.status = this.COMPLETED;

    var statusSuccess = req.status >= 200 && req.status < 400;
    if (!this.onComplete) {
      this._log.error("Unexpected error: onComplete not defined in " +
                      "abortRequest.");
      this.onProgress = null;
      return;
    }

    // Throw the failure code and stop execution.  Use Components.Exception()
    // instead of Error() so the exception is QI-able and can be passed across
    // XPCOM borders while preserving the status code.
    if (!statusSuccess) {
      var message = Components.Exception("", statusCode).name;
      var error = Components.Exception(message, statusCode);
      this.onComplete(error);
      this.onComplete = this.onProgress = null;
      return;
    }

    this._log.debug(this.method + " " + this.uri + " " + this.response.status);

    // Additionally give the full response body when Trace logging.
    if (this._log.level <= Log4Moz.Level.Trace) {
      this._log.trace(this.method + " body: " + this.response.body);
    }

    this.onComplete(null);
    this.onComplete = this.onProgress = null;
  },

  onDataAvailable: function callOnProgress() {
    try {
      this.onProgress();
    } catch (ex) {
      this._log.warn("Got exception calling onProgress handler, aborting " +
                     this.method + " " + req.URI.spec);
      this._log.debug("Exception: " + Utils.exceptionStr(ex));
      this.abort();

      if (!this.onComplete) {
        this._log.error("Unexpected error: onComplete not defined in " +
                        "onDataAvailable.");
        this.onProgress = null;
        return;
      }

      this.onComplete(ex);
      this.onComplete = this.onProgress = null;
      return;
    }

    this.delayTimeout();
  },

  // FIXME: I don't think we can detect redirects with XMLHttpRequest
  /*** nsIChannelEventSink ***/
  asyncOnChannelRedirect:
    function asyncOnChannelRedirect(oldChannel, newChannel, flags, callback) {

    try {
      newChannel.QueryInterface(Ci.nsIHttpChannel);
    } catch (ex) {
      this._log.error("Unexpected error: channel not nsIHttpChannel!");
      callback.onRedirectVerifyCallback(Cr.NS_ERROR_NO_INTERFACE);
      return;
    }

    this.channel = newChannel;

    // We let all redirects proceed.
    callback.onRedirectVerifyCallback(Cr.NS_OK);
  }
};


/**
 * Response object for a RESTRequest. This will be created automatically by
 * the RESTRequest.
 */
function RESTResponse() {
  this._log = Log4Moz.repository.getLogger(this._logName);
  this._log.level =
    Log4Moz.Level[Svc.Prefs.get("log.logger.network.resources")];
}
RESTResponse.prototype = {

  _logName: "Sync.RESTResponse",

  /**
   * Corresponding REST request
   */
  request: null,

  /**
   * HTTP status code
   */
  get status() {
    var status;
    try {
      var req = this.request.xmlhttprequest;
      status = req.status;
    } catch (ex) {
      this._log.debug("Caught exception fetching HTTP status code:" +
                      Utils.exceptionStr(ex));
      return null;
    }
    delete this.status;
    return this.status = status;
  },

  /**
   * Boolean flag that indicates whether the HTTP status code is 2xx or not.
   */
  get success() {
    var success;
    try {
      var req = this.request.xmlhttprequest;
      success = req.status >= 200 && req.status < 400;
    } catch (ex) {
      this._log.debug("Caught exception fetching HTTP success flag:" +
                      Utils.exceptionStr(ex));
      return null;
    }
    delete this.success;
    return this.success = success;
  },

  /**
   * Object containing HTTP headers (keyed as lower case)
   */
  get headers() {
    var headers = {};
    try {
      this._log.trace("Processing response headers.");
      var req = this.request.xmlhttprequest;
      var headerText = req.getAllResponseHeaders();
      var match = true;
      while (match) {
        match = /^\s*([a-zA-Z0-9-]+):.*/.exec(headerText);
        if (match) {
          headers[match[1].toLowerCase()] = req.getResponseHeader(match[1]);
          headerText = headerText.substr(match.index + match[0].length);
        }
      }
    } catch (ex) {
      this._log.debug("Caught exception processing response headers:" +
                      Utils.exceptionStr(ex));
      return null;
    }

    delete this.headers;
    return this.headers = headers;
  },

  /**
   * HTTP body (string)
   */
  body: null

};
