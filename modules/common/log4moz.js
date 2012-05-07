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
 * The Original Code is log4moz.
 *
 * The Initial Developer of the Original Code is
 * the Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2006
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Michael Johnston <special.michael@gmail.com> (Original Author)
 *   Dan Mills <thunder@mozilla.com>
 *   Philipp von Weitershausen <philipp@weitershausen.de>
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

const EXPORTED_SYMBOLS = ['Log4Moz'];



const ONE_BYTE = 1;
const ONE_KILOBYTE = 1024 * ONE_BYTE;
const ONE_MEGABYTE = 1024 * ONE_KILOBYTE;

const STREAM_SEGMENT_SIZE = 4096;
const PR_UINT32_MAX = 0xffffffff;

//Cu.import("resource://gre/modules/NetUtil.jsm");
//Cu.import("resource://gre/modules/FileUtils.jsm");

var Log4Moz = {
  Level: {
    Fatal:  70,
    Error:  60,
    Warn:   50,
    Info:   40,
    Config: 30,
    Debug:  20,
    Trace:  10,
    All:    0,
    Desc: {
      70: "FATAL",
      60: "ERROR",
      50: "WARN",
      40: "INFO",
      30: "CONFIG",
      20: "DEBUG",
      10: "TRACE",
      0:  "ALL"
    }
  },

  get repository() {
    delete Log4Moz.repository;
    Log4Moz.repository = new LoggerRepository();
    return Log4Moz.repository;
  },
  set repository(value) {
    delete Log4Moz.repository;
    Log4Moz.repository = value;
  },

  LogMessage: LogMessage,
  Logger: Logger,
  LoggerRepository: LoggerRepository,

  Formatter: Formatter,
  BasicFormatter: BasicFormatter,

  Appender: Appender,
  DumpAppender: DumpAppender,
  ConsoleAppender: ConsoleAppender,

  // Logging helper:
  // var logger = Log4Moz.repository.getLogger("foo");
  // logger.info(Log4Moz.enumerateInterfaces(someObject).join(","));
  // HTML: not applicable, changed to do nothing
  enumerateInterfaces: function Log4Moz_enumerateInterfaces(aObject) {
    return [];
  },

  // Logging helper:
  // var logger = Log4Moz.repository.getLogger("foo");
  // logger.info(Log4Moz.enumerateProperties(someObject).join(","));
  enumerateProperties: function Log4Moz_enumerateProps(aObject,
                                                       aExcludeComplexTypes) {
    var properties = [];

    for (p in aObject) {
      try {
        if (aExcludeComplexTypes &&
            (typeof aObject[p] == "object" || typeof aObject[p] == "function"))
          continue;
        properties.push(p + " = " + aObject[p]);
      }
      catch(ex) {
        properties.push(p + " = " + ex);
      }
    }

    return properties;
  }
};


/*
 * LogMessage
 * Encapsulates a single log event's data
 */
function LogMessage(loggerName, level, message){
  this.loggerName = loggerName;
  this.message = message;
  this.level = level;
  this.time = Date.now();
}
LogMessage.prototype = {
  get levelDesc() {
    if (this.level in Log4Moz.Level.Desc)
      return Log4Moz.Level.Desc[this.level];
    return "UNKNOWN";
  },

  toString: function LogMsg_toString(){
    return "LogMessage [" + this.time + " " + this.level + " " +
      this.message + "]";
  }
};

/*
 * Logger
 * Hierarchical version.  Logs to all appenders, assigned or inherited
 */

function Logger(name, repository) {
  if (!repository)
    repository = Log4Moz.repository;
  this._name = name;
  this.children = [];
  this.ownAppenders = [];
  this.appenders = [];
  this._repository = repository;
}
Logger.prototype = {
  get name() {
    return this._name;
  },

  _level: null,
  get level() {
    if (this._level != null)
      return this._level;
    if (this.parent)
      return this.parent.level;
    dump("log4moz warning: root logger configuration error: no level defined\n");
    return Log4Moz.Level.All;
  },
  set level(level) {
    this._level = level;
  },

  _parent: null,
  get parent() {return this._parent;},
  set parent(parent) {
    if (this._parent == parent) {
      return;
    }
    // Remove ourselves from parent's children
    if (this._parent) {
      var index = this._parent.children.indexOf(this);
      if (index != -1) {
        this._parent.children.splice(index, 1);
      }
    }
    this._parent = parent;
    parent.children.push(this);
    this.updateAppenders();
  },

  updateAppenders: function updateAppenders() {
    if (this._parent) {
      var notOwnAppenders = this._parent.appenders.filter(function(appender) {
        return this.ownAppenders.indexOf(appender) == -1;
      }, this);
      this.appenders = notOwnAppenders.concat(this.ownAppenders);
    } else {
      this.appenders = this.ownAppenders.slice();
    }

    // Update children's appenders.
    for (var i = 0; i < this.children.length; i++) {
      this.children[i].updateAppenders();
    }
  },

  addAppender: function Logger_addAppender(appender) {
    if (this.ownAppenders.indexOf(appender) != -1) {
      return;
    }
    this.ownAppenders.push(appender);
    this.updateAppenders();
  },

  removeAppender: function Logger_removeAppender(appender) {
    var index = this.ownAppenders.indexOf(appender);
    if (index == -1) {
      return;
    }
    this.ownAppenders.splice(index, 1);
    this.updateAppenders();
  },

  log: function Logger_log(level, string) {
    if (this.level > level)
      return;

    // Hold off on creating the message object until we actually have
    // an appender that's responsible.
    var message;
    var appenders = this.appenders;
    for (var i = 0; i < appenders.length; i++){
      var appender = appenders[i];
      if (appender.level > level)
        continue;

      if (!message)
        message = new LogMessage(this._name, level, string);

      appender.append(message);
    }
  },

  fatal: function Logger_fatal(string) {
    this.log(Log4Moz.Level.Fatal, string);
  },
  error: function Logger_error(string) {
    this.log(Log4Moz.Level.Error, string);
  },
  warn: function Logger_warn(string) {
    this.log(Log4Moz.Level.Warn, string);
  },
  info: function Logger_info(string) {
    this.log(Log4Moz.Level.Info, string);
  },
  config: function Logger_config(string) {
    this.log(Log4Moz.Level.Config, string);
  },
  debug: function Logger_debug(string) {
    this.log(Log4Moz.Level.Debug, string);
  },
  trace: function Logger_trace(string) {
    this.log(Log4Moz.Level.Trace, string);
  }
};

/*
 * LoggerRepository
 * Implements a hierarchy of Loggers
 */

function LoggerRepository() {}
LoggerRepository.prototype = {
  _loggers: {},

  _rootLogger: null,
  get rootLogger() {
    if (!this._rootLogger) {
      this._rootLogger = new Logger("root", this);
      this._rootLogger.level = Log4Moz.Level.All;
    }
    return this._rootLogger;
  },
  set rootLogger(logger) {
    throw "Cannot change the root logger";
  },

  _updateParents: function LogRep__updateParents(name) {
    var pieces = name.split('.');
    var cur, parent;

    // find the closest parent
    // don't test for the logger name itself, as there's a chance it's already
    // there in this._loggers
    for (var i = 0; i < pieces.length - 1; i++) {
      if (cur)
        cur += '.' + pieces[i];
      else
        cur = pieces[i];
      if (cur in this._loggers)
        parent = cur;
    }

    // if we didn't assign a parent above, there is no parent
    if (!parent)
      this._loggers[name].parent = this.rootLogger;
    else
      this._loggers[name].parent = this._loggers[parent];

    // trigger updates for any possible descendants of this logger
    for (var logger in this._loggers) {
      if (logger != name && logger.indexOf(name) == 0)
        this._updateParents(logger);
    }
  },

  getLogger: function LogRep_getLogger(name) {
    if (name in this._loggers)
      return this._loggers[name];
    this._loggers[name] = new Logger(name, this);
    this._updateParents(name);
    return this._loggers[name];
  }
};

/*
 * Formatters
 * These massage a LogMessage into whatever output is desired
 * Only the BasicFormatter is currently implemented
 */

// Abstract formatter
function Formatter() {}
Formatter.prototype = {
  format: function Formatter_format(message) {}
};

// Basic formatter that doesn't do anything fancy
function BasicFormatter(dateFormat) {
  if (dateFormat)
    this.dateFormat = dateFormat;
}
BasicFormatter.prototype = {
  __proto__: Formatter.prototype,

  format: function BF_format(message) {
    return message.time + "\t" + message.loggerName + "\t" + message.levelDesc
           + "\t" + message.message + "\n";
  }
};

/*
 * Appenders
 * These can be attached to Loggers to log to different places
 * Simply subclass and override doAppend to implement a new one
 */

function Appender(formatter) {
  this._name = "Appender";
  this._formatter = formatter? formatter : new BasicFormatter();
}
Appender.prototype = {
  level: Log4Moz.Level.All,

  append: function App_append(message) {
    this.doAppend(this._formatter.format(message));
  },
  toString: function App_toString() {
    return this._name + " [level=" + this._level +
      ", formatter=" + this._formatter + "]";
  },
  doAppend: function App_doAppend(message) {}
};

/*
 * DumpAppender
 * Logs to standard out
 */

function DumpAppender(formatter) {
  this._name = "DumpAppender";
  Appender.call(this, formatter);
}
DumpAppender.prototype = {
  __proto__: Appender.prototype,

  doAppend: function DApp_doAppend(message) {
    dump(message);
  }
};

/*
 * ConsoleAppender
 * Logs to the javascript console
 */

function ConsoleAppender(formatter) {
  this._name = "ConsoleAppender";
  Appender.call(this, formatter);
}
ConsoleAppender.prototype = {
  __proto__: Appender.prototype,

  doAppend: function CApp_doAppend(message) {
    if (! window.console) {
      return;
    }
    if (console.error && message.level >= Log4Moz.Level.Error) {
      console.error(message);
      return;
    }
    if (console.warn && message.level >= Log4Moz.Level.Warn) {
      console.warn(message);
      return;
    }
    if (console.info && message.level >= Log4Moz.Level.Info) {
      console.info(message);
      return;
    }
    if (console.debug && message.level <= Log4Moz.Level.Debug) {
      console.debug(message);
      return;
    }
    console.log(message);
  }
};
