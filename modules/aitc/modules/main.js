/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const EXPORTED_SYMBOLS = ["Aitc"];



//Cu.import("resource://gre/modules/Webapps.jsm");
//Cu.import("resource://gre/modules/Services.jsm");
//Cu.import("resource://gre/modules/XPCOMUtils.jsm");

//Cu.import("resource://services-aitc/manager.js");
//Cu.import("resource://services-common/log4moz.js");
//Cu.import("resource://services-common/preferences.js");

function Aitc() {
  this._log = Log4Moz.repository.getLogger("Service.AITC");
  /*this._log.level = Log4Moz.Level[Preferences.get(
    "services.aitc.service.log.level"
  )];*/
  var dapp = new Log4Moz.DumpAppender();
  dapp.level = Log4Moz.Level["All"];
  this._log.addAppender(dapp);
  this._log.info("Loading AitC");

  var self = this;
  this._manager = new AitcManager(function _managerDone() {
    self._init();
  });
}
Aitc.prototype = {
  get DASHBOARD() {
    return Preferences.get("services.aitc.dashboard.url");
  },

  // The goal of the init function is to be ready to activate the AITC
  // client whenever the user is looking at the dashboard.
  _init: function init() {
    var self = this;

    // This is called iff the user is currently looking the dashboard.
    function dashboardLoaded(browser) {
      self._log.info("Dashboard was accessed " + browser.contentWindow);
      self._manager.userOnDashboard(browser.contentWindow);
    }
    // This is called when the user's attention is elsewhere.
    function dashboardUnloaded() {
      self._log.info("Dashboard closed or in background");
      self._manager.userOffDashboard();
    }

    // Called when a URI is loaded in any tab. We have to listen for this
    // because tabSelected is not called if I open a new tab which loads
    // about:home and then navigate to the dashboard, or navigation via
    // links on the currently open tab.
    var listener = {
      onLocationChange: function onLocationChange(browser, pr, req, loc, flag) {
        var win = Services.wm.getMostRecentWindow("navigator:browser");
        if (win.gBrowser.selectedBrowser == browser) {
          var uri = loc.spec.substring(0, self.DASHBOARD.length);
          if (uri == self.DASHBOARD) {
            dashboardLoaded(browser);
          }
        }
      }
    };
    // Called when the current tab selection changes.
    function tabSelected(event) {
      var browser = event.target.linkedBrowser;
      var uri = browser.currentURI.spec.substring(0, self.DASHBOARD.length);
      if (uri == self.DASHBOARD) {
        dashboardLoaded(browser);
      } else {
        dashboardUnloaded();
      }
    }

    // Add listeners for all windows opened in the future.
    function winWatcher(subject, topic) {
      if (topic != "domwindowopened") return;
      subject.addEventListener("load", function winWatcherLoad() {
        subject.removeEventListener("load", winWatcherLoad, false);
        var doc = subject.document.documentElement;
        if (doc.getAttribute("windowtype") == "navigator:browser") {
          var browser = subject.gBrowser;
          browser.addTabsProgressListener(listener);
          browser.tabContainer.addEventListener("TabSelect", tabSelected);
        }
      }, false);
    }
    Services.ww.registerNotification(winWatcher);

    // Add listeners for all current open windows.
    var enumerator = Services.wm.getEnumerator("navigator:browser");
    while (enumerator.hasMoreElements()) {
      var browser = enumerator.getNext().gBrowser;
      browser.addTabsProgressListener(listener);
      browser.tabContainer.addEventListener("TabSelect", tabSelected);

      // Also check the currently open URI.
      var uri = browser.contentDocument.location.toString().substring(
        0, self.DASHBOARD.length
      );
      if (uri == self.DASHBOARD) {
        dashboardLoaded(browser);
      }
    }

    // Add listeners for app installs/uninstall.
    Services.obs.addObserver(this, "webapps-sync-install", false);
    Services.obs.addObserver(this, "webapps-sync-uninstall", false);
  },

  observe: function(aSubject, aTopic, aData) {
    var app;
    switch (aTopic) {
      case "webapps-sync-install":
        app = JSON.parse(aData);
        this._log.info(app.origin + " was installed, initiating PUT");
        this._manager.appEvent("install", app);
        break;
      case "webapps-sync-uninstall":
        app = JSON.parse(aData);
        this._log.info(app.origin + " was uninstalled, initiating PUT");
        this._manager.appEvent("uninstall", app);
        break;
    }
  }
};