/*******************************************************************************

    µBlock - a browser extension to block requests.
    Copyright (C) 2014 The µBlock authors

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uMatrix
*/

/* jshint bitwise: false, esnext: true */
/* global self, Components, punycode, µBlock */

// For background page

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

// Useful links
//
// https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Reference/Interface
// https://developer.mozilla.org/en-US/docs/Mozilla/JavaScript_code_modules/Services.jsm

/******************************************************************************/

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
const {Services} = Cu.import('resource://gre/modules/Services.jsm', null);

/******************************************************************************/

var vAPI = self.vAPI = self.vAPI || {};
vAPI.firefox = true;
vAPI.firefoxPre35 = Services.vc.compare(Services.appinfo.platformVersion, '35.0') < 0;

/******************************************************************************/

vAPI.app = {
    name: 'uMatrix',
    version: location.hash.slice(1)
};

/******************************************************************************/

vAPI.app.start = function() {
};

/******************************************************************************/

vAPI.app.stop = function() {
};

/******************************************************************************/

vAPI.app.restart = function() {
    // Listening in bootstrap.js
    Cc['@mozilla.org/childprocessmessagemanager;1']
        .getService(Ci.nsIMessageSender)
        .sendAsyncMessage(location.host + '-restart');
};

/******************************************************************************/

// https://stackoverflow.com/questions/6715571/how-to-get-result-of-console-trace-as-string-in-javascript-with-chrome-or-fire/28118170#28118170
/*
function logStackTrace(msg) {
    var stack;
    try {
        throw new Error('');
    }
    catch (error) {
        stack = error.stack || '';
    }
    stack = stack.split('\n').map(function(line) { return line.trim(); });
    stack.shift();
    if ( msg ) {
        stack.unshift(msg);
    }
    console.log(stack.join('\n'));
}
*/
/******************************************************************************/

// List of things that needs to be destroyed when disabling the extension
// Only functions should be added to it

var cleanupTasks = [];

// This must be updated manually, every time a new task is added/removed

// Fixed by github.com/AlexVallat:
//   https://github.com/AlexVallat/uBlock/commit/7b781248f00cbe3d61b1cc367c440db80fa06049
//   7 instances of cleanupTasks.push, but one is unique to fennec, and one to desktop.
var expectedNumberOfCleanups = 7;

window.addEventListener('unload', function() {
    if ( typeof vAPI.app.onShutdown === 'function' ) {
        vAPI.app.onShutdown();
    }

    for ( var cleanup of cleanupTasks ) {
        cleanup();
    }

    if ( cleanupTasks.length < expectedNumberOfCleanups ) {
        console.error(
            'uMatrix> Cleanup tasks performed: %s (out of %s)',
            cleanupTasks.length,
            expectedNumberOfCleanups
        );
    }

    // frameModule needs to be cleared too
    var frameModule = {};
    Cu.import(vAPI.getURL('frameModule.js'), frameModule);
    frameModule.contentObserver.unregister();
    Cu.unload(vAPI.getURL('frameModule.js'));
});

/******************************************************************************/

// For now, only booleans.

vAPI.browserSettings = {
    originalValues: {},

    rememberOriginalValue: function(branch, setting) {
        var key = branch + '.' + setting;
        if ( this.originalValues.hasOwnProperty(key) ) {
            return;
        }
        var hasUserValue = false;
        try {
            hasUserValue = Services.prefs.getBranch(branch + '.').prefHasUserValue(setting);
        } catch (ex) {
        }
        this.originalValues[key] = hasUserValue ? this.getBool(branch, setting) : undefined;
    },

    clear: function(branch, setting) {
        var key = branch + '.' + setting;
        // Value was not overriden -- nothing to restore
        if ( this.originalValues.hasOwnProperty(key) === false ) {
            return;
        }
        var value = this.originalValues[key];
        // https://github.com/gorhill/uBlock/issues/292#issuecomment-109621979
        // Forget the value immediately, it may change outside of
        // uBlock control.
        delete this.originalValues[key];
        // Original value was a default one
        if ( value === undefined ) {
            try {
                Services.prefs.getBranch(branch + '.').clearUserPref(setting);
            } catch (ex) {
            }
            return;
        }
        // Current value is same as original
        if ( this.getBool(branch, setting) === value ) {
            return;
        }
        // Reset to original value
        try {
            Services.prefs.getBranch(branch + '.').setBoolPref(setting, value);
        } catch (ex) {
        }
    },

    getBool: function(branch, setting) {
        try {
            return Services.prefs.getBranch(branch + '.').getBoolPref(setting);
        } catch (ex) {
        }
        return undefined;
    },

    setBool: function(branch, setting, value) {
        try {
            Services.prefs.getBranch(branch + '.').setBoolPref(setting, value);
        } catch (ex) {
        }
    },

    set: function(details) {
        var value;
        for ( var setting in details ) {
            if ( details.hasOwnProperty(setting) === false ) {
                continue;
            }
            switch ( setting ) {
            case 'prefetching':
                this.rememberOriginalValue('network', 'prefetch-next');
                value = !!details[setting];
                // https://github.com/gorhill/uBlock/issues/292
                // "true" means "do not disable", i.e. leave entry alone
                if ( value === true ) {
                    this.clear('network', 'prefetch-next');
                } else {
                    this.setBool('network', 'prefetch-next', false);
                }
                break;

            case 'hyperlinkAuditing':
                this.rememberOriginalValue('browser', 'send_pings');
                this.rememberOriginalValue('beacon', 'enabled');
                value = !!details[setting];
                // https://github.com/gorhill/uBlock/issues/292
                // "true" means "do not disable", i.e. leave entry alone
                if ( value === true ) {
                    this.clear('browser', 'send_pings');
                    this.clear('beacon', 'enabled');
                } else {
                    this.setBool('browser', 'send_pings', false);
                    this.setBool('beacon', 'enabled', false);
                }
                break;

            case 'webrtcIPAddress':
                this.rememberOriginalValue('media.peerconnection', 'enabled');
                value = !!details[setting];
                if ( value === true ) {
                    this.clear('media.peerconnection', 'enabled');
                } else {
                    this.setBool('media.peerconnection', 'enabled', false);
                }
                break;

            default:
                break;
            }
        }
    },

    restoreAll: function() {
        var pos;
        for ( var key in this.originalValues ) {
            if ( this.originalValues.hasOwnProperty(key) === false ) {
                continue;
            }
            pos = key.lastIndexOf('.');
            this.clear(key.slice(0, pos), key.slice(pos + 1));
        }
    }
};

cleanupTasks.push(vAPI.browserSettings.restoreAll.bind(vAPI.browserSettings));

/******************************************************************************/

// API matches that of chrome.storage.local:
//   https://developer.chrome.com/extensions/storage

vAPI.storage = (function() {
    var db = null;
    var vacuumTimer = null;

    var close = function() {
        if ( vacuumTimer !== null ) {
            clearTimeout(vacuumTimer);
            vacuumTimer = null;
        }
        if ( db === null ) {
            return;
        }
        db.asyncClose();
        db = null;
    };

    var open = function() {
        if ( db !== null ) {
            return db;
        }

        // Create path
        var path = Services.dirsvc.get('ProfD', Ci.nsIFile);
        path.append('extension-data');
        if ( !path.exists() ) {
            path.create(Ci.nsIFile.DIRECTORY_TYPE, parseInt('0774', 8));
        }
        if ( !path.isDirectory() ) {
            throw Error('Should be a directory...');
        }
        path.append(location.host + '.sqlite');

        // Open database
        try {
            db = Services.storage.openDatabase(path);
            if ( db.connectionReady === false ) {
                db.asyncClose();
                db = null;
            }
        } catch (ex) {
        }

        if ( db === null ) {
            return null;
        }

        // Database was opened, register cleanup task
        cleanupTasks.push(close);

        // Setup database
        db.createAsyncStatement('CREATE TABLE IF NOT EXISTS "settings" ("name" TEXT PRIMARY KEY NOT NULL, "value" TEXT);')
          .executeAsync();

        if ( vacuum !== null ) {
            vacuumTimer = vAPI.setTimeout(vacuum, 60000);
        }

        return db;
    };

    // https://developer.mozilla.org/en-US/docs/Storage/Performance#Vacuuming_and_zero-fill
    // Vacuum only once, and only while idle
    var vacuum = function() {
        vacuumTimer = null;
        if ( db === null ) {
            return;
        }
        var idleSvc = Cc['@mozilla.org/widget/idleservice;1']
                       .getService(Ci.nsIIdleService);
        if ( idleSvc.idleTime < 60000 ) {
            vacuumTimer = vAPI.setTimeout(vacuum, 60000);
            return;
        }
        db.createAsyncStatement('VACUUM').executeAsync();
        vacuum = null;
    };

    // Execute a query
    var runStatement = function(stmt, callback) {
        var result = {};

        stmt.executeAsync({
            handleResult: function(rows) {
                if ( !rows || typeof callback !== 'function' ) {
                    return;
                }

                var row;

                while ( (row = rows.getNextRow()) ) {
                    // we assume that there will be two columns, since we're
                    // using it only for preferences
                    result[row.getResultByIndex(0)] = row.getResultByIndex(1);
                }
            },
            handleCompletion: function(reason) {
                if ( typeof callback === 'function' && reason === 0 ) {
                    callback(result);
                }
            },
            handleError: function(error) {
                console.error('SQLite error ', error.result, error.message);
                // Caller expects an answer regardless of failure.
                if ( typeof callback === 'function' ) {
                    callback(null);
                }
            }
        });
    };

    var bindNames = function(stmt, names) {
        if ( Array.isArray(names) === false || names.length === 0 ) {
            return;
        }
        var params = stmt.newBindingParamsArray();
        var i = names.length, bp;
        while ( i-- ) {
            bp = params.newBindingParams();
            bp.bindByName('name', names[i]);
            params.addParams(bp);
        }
        stmt.bindParameters(params);
    };

    var clear = function(callback) {
        if ( open() === null ) {
            if ( typeof callback === 'function' ) {
                callback();
            }
            return;
        }
        runStatement(db.createAsyncStatement('DELETE FROM "settings";'), callback);
    };

    var getBytesInUse = function(keys, callback) {
        if ( typeof callback !== 'function' ) {
            return;
        }

        if ( open() === null ) {
            callback(0);
            return;
        }

        var stmt;
        if ( Array.isArray(keys) ) {
            stmt = db.createAsyncStatement('SELECT "size" AS "size", SUM(LENGTH("value")) FROM "settings" WHERE "name" = :name');
            bindNames(keys);
        } else {
            stmt = db.createAsyncStatement('SELECT "size" AS "size", SUM(LENGTH("value")) FROM "settings"');
        }

        runStatement(stmt, function(result) {
            callback(result.size);
        });
    };

    var read = function(details, callback) {
        if ( typeof callback !== 'function' ) {
            return;
        }

        var prepareResult = function(result) {
            var key;
            for ( key in result ) {
                if ( result.hasOwnProperty(key) === false ) {
                    continue;
                }
                result[key] = JSON.parse(result[key]);
            }
            if ( typeof details === 'object' && details !== null ) {
                for ( key in details ) {
                    if ( result.hasOwnProperty(key) === false ) {
                        result[key] = details[key];
                    }
                }
            }
            callback(result);
        };

        if ( open() === null ) {
            prepareResult({});
            return;
        }

        var names = [];
        if ( details !== null ) {
            if ( Array.isArray(details) ) {
                names = details;
            } else if ( typeof details === 'object' ) {
                names = Object.keys(details);
            } else {
                names = [details.toString()];
            }
        }

        var stmt;
        if ( names.length === 0 ) {
            stmt = db.createAsyncStatement('SELECT * FROM "settings"');
        } else {
            stmt = db.createAsyncStatement('SELECT * FROM "settings" WHERE "name" = :name');
            bindNames(stmt, names);
        }

        runStatement(stmt, prepareResult);
    };

    var remove = function(keys, callback) {
        if ( open() === null ) {
            if ( typeof callback === 'function' ) {
                callback();
            }
            return;
        }
        var stmt = db.createAsyncStatement('DELETE FROM "settings" WHERE "name" = :name');
        bindNames(stmt, typeof keys === 'string' ? [keys] : keys);
        runStatement(stmt, callback);
    };

    var write = function(details, callback) {
        if ( open() === null ) {
            if ( typeof callback === 'function' ) {
                callback();
            }
            return;
        }

        var stmt = db.createAsyncStatement('INSERT OR REPLACE INTO "settings" ("name", "value") VALUES(:name, :value)');
        var params = stmt.newBindingParamsArray(), bp;
        for ( var key in details ) {
            if ( details.hasOwnProperty(key) === false ) {
                continue;
            }
            bp = params.newBindingParams();
            bp.bindByName('name', key);
            bp.bindByName('value', JSON.stringify(details[key]));
            params.addParams(bp);
        }
        if ( params.length === 0 ) {
            return;
        }

        stmt.bindParameters(params);
        runStatement(stmt, callback);
    };

    // Export API
    var api = {
        QUOTA_BYTES: 100 * 1024 * 1024,
        clear: clear,
        get: read,
        getBytesInUse: getBytesInUse,
        remove: remove,
        set: write
    };
    return api;
})();

/******************************************************************************/

var getTabBrowser = function(win) {
    return win.gBrowser || null;
};

/******************************************************************************/

var getOwnerWindow = function(target) {
    if ( target.ownerDocument ) {
        return target.ownerDocument.defaultView;
    }
    return null;
};

/******************************************************************************/

vAPI.isBehindTheSceneTabId = function(tabId) {
    return tabId.toString() === '-1';
};

vAPI.noTabId = '-1';

/******************************************************************************/

vAPI.tabs = {};

/******************************************************************************/

vAPI.tabs.registerListeners = function() {
    tabWatcher.start();
};

/******************************************************************************/

vAPI.tabs.get = function(tabId, callback) {
    var browser;

    if ( tabId === null ) {
        browser = tabWatcher.currentBrowser();
        tabId = tabWatcher.tabIdFromTarget(browser);
    } else {
        browser = tabWatcher.browserFromTabId(tabId);
    }

    // For internal use
    if ( typeof callback !== 'function' ) {
        return browser;
    }

    if ( !browser ) {
        callback();
        return;
    }

    var win = getOwnerWindow(browser);
    var tabBrowser = getTabBrowser(win);
    var windows = this.getWindows();

    callback({
        id: tabId,
        index: tabWatcher.indexFromTarget(browser),
        windowId: windows.indexOf(win),
        active: browser === tabBrowser.selectedBrowser,
        url: browser.currentURI.asciiSpec,
        title: browser.contentTitle
    });
};

/******************************************************************************/

vAPI.tabs.getAllSync = function(window) {
    var win, tab;
    var tabs = [];

    for ( win of this.getWindows() ) {
        if ( window && window !== win ) {
            continue;
        }

        var tabBrowser = getTabBrowser(win);
        if ( tabBrowser === null ) {
            continue;
        }

        for ( tab of tabBrowser.tabs ) {
            tabs.push(tab);
        }
    }

    return tabs;
};

/******************************************************************************/

vAPI.tabs.getAll = function(callback) {
    var tabs = [], tab;

    for ( var browser of tabWatcher.browsers() ) {
        tab = tabWatcher.tabFromBrowser(browser);
        if ( tab === null ) {
            continue;
        }
        if ( tab.hasAttribute('pending') ) {
            continue;
        }
        tabs.push({
            id: tabWatcher.tabIdFromTarget(browser),
            url: browser.currentURI.asciiSpec
        });
    }

    callback(tabs);
};

/******************************************************************************/

vAPI.tabs.getWindows = function() {
    var winumerator = Services.wm.getEnumerator('navigator:browser');
    var windows = [];

    while ( winumerator.hasMoreElements() ) {
        var win = winumerator.getNext();

        if ( !win.closed ) {
            windows.push(win);
        }
    }

    return windows;
};

/******************************************************************************/

// properties of the details object:
//   url: 'URL', // the address that will be opened
//   tabId: 1, // the tab is used if set, instead of creating a new one
//   index: -1, // undefined: end of the list, -1: following tab, or after index
//   active: false, // opens the tab in background - true and undefined: foreground
//   select: true // if a tab is already opened with that url, then select it instead of opening a new one

vAPI.tabs.open = function(details) {
    if ( !details.url ) {
        return null;
    }
    // extension pages
    if ( /^[\w-]{2,}:/.test(details.url) === false ) {
        details.url = vAPI.getURL(details.url);
    }

    var tab;

    if ( details.select ) {
        var URI = Services.io.newURI(details.url, null, null);

        for ( tab of this.getAllSync() ) {
            var browser = tabWatcher.browserFromTarget(tab);

            // Or simply .equals if we care about the fragment
            if ( URI.equalsExceptRef(browser.currentURI) === false ) {
                continue;
            }

            this.select(tab);

            // Update URL if fragment is different
            if ( URI.equals(browser.currentURI) === false ) {
                browser.loadURI(URI.asciiSpec);
            }
            return;
        }
    }

    if ( details.active === undefined ) {
        details.active = true;
    }

    if ( details.tabId ) {
        tab = tabWatcher.browserFromTabId(details.tabId);
        if ( tab ) {
            tabWatcher.browserFromTarget(tab).loadURI(details.url);
            return;
        }
    }

    var win = Services.wm.getMostRecentWindow('navigator:browser');
    var tabBrowser = getTabBrowser(win);

    // Open in a standalone window
    if ( details.popup ) {
        Services.ww.openWindow(
            self,
            details.url,
            null,
            'menubar=no,toolbar=no,location=no,resizable=yes',
            null
        );
        return;
    }

    if ( details.index === -1 ) {
        details.index = tabBrowser.browsers.indexOf(tabBrowser.selectedBrowser) + 1;
    }

    tab = tabBrowser.loadOneTab(details.url, {inBackground: !details.active});

    if ( details.index !== undefined ) {
        tabBrowser.moveTabTo(tab, details.index);
    }
};

/******************************************************************************/

// Replace the URL of a tab. Noop if the tab does not exist.

vAPI.tabs.replace = function(tabId, url) {
    var targetURL = url;

    // extension pages
    if ( /^[\w-]{2,}:/.test(targetURL) !== true ) {
        targetURL = vAPI.getURL(targetURL);
    }

    var browser = tabWatcher.browserFromTabId(tabId);
    if ( browser ) {
        browser.loadURI(targetURL);
    }
};

/******************************************************************************/

vAPI.tabs._remove = function(tab, tabBrowser) {
    tabBrowser.removeTab(tab);
};

/******************************************************************************/

vAPI.tabs.remove = function(tabId) {
    var browser = tabWatcher.browserFromTabId(tabId);
    if ( !browser ) {
        return;
    }
    var tab = tabWatcher.tabFromBrowser(browser);
    if ( !tab ) {
        return;
    }
    this._remove(tab, getTabBrowser(getOwnerWindow(browser)));
};

/******************************************************************************/

vAPI.tabs.reload = function(tabId) {
    var browser = tabWatcher.browserFromTabId(tabId);
    if ( !browser ) {
        return;
    }

    browser.webNavigation.reload(Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_CACHE);
};

/******************************************************************************/

vAPI.tabs.select = function(tab) {
    if ( typeof tab !== 'object' ) {
        tab = tabWatcher.tabFromBrowser(tabWatcher.browserFromTabId(tab));
    }
    if ( !tab ) {
        return;
    }

    // https://github.com/gorhill/uBlock/issues/470
    var win = getOwnerWindow(tab);
    win.focus();

    var tabBrowser = getTabBrowser(win);
    tabBrowser.selectedTab = tab;
};

/******************************************************************************/

vAPI.tabs.injectScript = function(tabId, details, callback) {
    var browser = tabWatcher.browserFromTabId(tabId);
    if ( !browser ) {
        return;
    }

    if ( typeof details.file !== 'string' ) {
        return;
    }

    details.file = vAPI.getURL(details.file);
    browser.messageManager.sendAsyncMessage(
        location.host + ':broadcast',
        JSON.stringify({
            broadcast: true,
            channelName: 'vAPI',
            msg: {
                cmd: 'injectScript',
                details: details
            }
        })
    );

    if ( typeof callback === 'function' ) {
        vAPI.setTimeout(callback, 13);
    }
};

/******************************************************************************/

// Firefox:
//   https://developer.mozilla.org/en-US/Add-ons/Code_snippets/Tabbed_browser
//
// browser --> ownerDocument --> defaultView --> gBrowser --> browsers --+
//    ^                                                                  |
//    |                                                                  |
//    +-------------------------------------------------------------------
//
// browser (browser)
//   contentTitle
//   currentURI
//   ownerDocument (XULDocument)
//     defaultView (ChromeWindow)
//     gBrowser (tabbrowser OR browser)
//       browsers (browser)
//       selectedBrowser
//       selectedTab
//       tabs (tab.tabbrowser-tab)
//
// Fennec: (what I figured so far)
//
//   tab --> browser     windows --> window --> BrowserApp --> tabs --+
//    ^      window                                                   |
//    |                                                               |
//    +---------------------------------------------------------------+
//
// tab
//   browser
// [manual search to go back to tab from list of windows]

var tabWatcher = (function() {
    // TODO: find out whether we need a janitor to take care of stale entries.
    var browserToTabIdMap = new Map();
    var tabIdToBrowserMap = new Map();
    var tabIdGenerator = 1;

    var indexFromBrowser = function(browser) {
        var win = getOwnerWindow(browser);
        if ( !win ) {
            return -1;
        }
        var tabbrowser = getTabBrowser(win);
        if ( !tabbrowser ) {
            return -1;
        }
        // This can happen, for example, the `view-source:` window, there is
        // no tabbrowser object, the browser object sits directly in the
        // window.
        if ( tabbrowser === browser ) {
            return 0;
        }
        // Fennec
        // https://developer.mozilla.org/en-US/Add-ons/Firefox_for_Android/API/BrowserApp
        if ( vAPI.fennec ) {
            return tabbrowser.tabs.indexOf(tabbrowser.getTabForBrowser(browser));
        }
        return tabbrowser.browsers.indexOf(browser);
    };

    var indexFromTarget = function(target) {
        return indexFromBrowser(browserFromTarget(target));
    };

    var tabFromBrowser = function(browser) {
        var i = indexFromBrowser(browser);
        if ( i === -1 ) {
            return null;
        }
        var win = getOwnerWindow(browser);
        if ( !win ) {
            return null;
        }
        var tabbrowser = getTabBrowser(win);
        if ( !tabbrowser ) {
            return null;
        }
        if ( !tabbrowser.tabs || i >= tabbrowser.tabs.length ) {
            return null;
        }
        return tabbrowser.tabs[i];
    };

    var browserFromTarget = function(target) {
        if ( !target ) {
            return null;
        }
        if ( vAPI.fennec ) {
            if ( target.browser ) {         // target is a tab
                target = target.browser;
            }
        } else if ( target.linkedPanel ) {  // target is a tab
            target = target.linkedBrowser;
        }
        if ( target.localName !== 'browser' ) {
            return null;
        }
        return target;
    };

    var tabIdFromTarget = function(target) {
        var browser = browserFromTarget(target);
        if ( browser === null ) {
            return vAPI.noTabId;
        }
        var tabId = browserToTabIdMap.get(browser);
        if ( tabId === undefined ) {
            tabId = '' + tabIdGenerator++;
            browserToTabIdMap.set(browser, tabId);
            tabIdToBrowserMap.set(tabId, browser);
        }
        return tabId;
    };

    var browserFromTabId = function(tabId) {
        var browser = tabIdToBrowserMap.get(tabId);
        if ( browser === undefined ) {
            return null;
        }
        // Verify that the browser is still live
        if ( indexFromBrowser(browser) !== -1 ) {
            return browser;
        }
        removeBrowserEntry(tabId, browser);
        return null;
    };

    var currentBrowser = function() {
        var win = Services.wm.getMostRecentWindow('navigator:browser');
        // https://github.com/gorhill/uBlock/issues/399
        // getTabBrowser() can return null at browser launch time.
        var tabBrowser = getTabBrowser(win);
        if ( tabBrowser === null ) {
            return null;
        }
        return browserFromTarget(tabBrowser.selectedTab);
    };

    var removeBrowserEntry = function(tabId, browser) {
        if ( tabId && tabId !== vAPI.noTabId ) {
            vAPI.tabs.onClosed(tabId);
            delete vAPI.toolbarButton.tabs[tabId];
            tabIdToBrowserMap.delete(tabId);
        }
        if ( browser ) {
            browserToTabIdMap.delete(browser);
        }
    };

    // https://developer.mozilla.org/en-US/docs/Web/Events/TabOpen
    var onOpen = function({target}) {
        var tabId = tabIdFromTarget(target);
        var browser = browserFromTabId(tabId);
        vAPI.tabs.onNavigation({
            frameId: 0,
            tabId: tabId,
            url: browser.currentURI.asciiSpec,
        });
    };

    // https://developer.mozilla.org/en-US/docs/Web/Events/TabShow
    var onShow = function({target}) {
        tabIdFromTarget(target);
    };

    // https://developer.mozilla.org/en-US/docs/Web/Events/TabClose
    var onClose = function({target}) {
        // target is tab in Firefox, browser in Fennec
        var browser = browserFromTarget(target);
        var tabId = browserToTabIdMap.get(browser);
        removeBrowserEntry(tabId, browser);
    };

    // https://developer.mozilla.org/en-US/docs/Web/Events/TabSelect
    var onSelect = function({target}) {
        vAPI.setIcon(tabIdFromTarget(target), getOwnerWindow(target));
    };

    var locationChangedMessageName = location.host + ':locationChanged';

    var onLocationChanged = function(e) {
        var vapi = vAPI;
        var details = e.data;

        // Ignore notifications related to our popup
        if ( details.url.lastIndexOf(vapi.getURL('popup.html'), 0) === 0 ) {
            return;
        }

        var browser = e.target;
        var tabId = tabIdFromTarget(browser);

        if ( tabId === vapi.noTabId ) {
            return;
        }

        //console.debug("nsIWebProgressListener: onLocationChange: " + details.url + " (" + details.flags + ")");        

        // LOCATION_CHANGE_SAME_DOCUMENT = "did not load a new document"
        if ( details.flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT ) {
            vapi.tabs.onUpdated(tabId, {url: details.url}, {
                frameId: 0,
                tabId: tabId,
                url: browser.currentURI.asciiSpec
            });
            return;
        }

        // https://github.com/chrisaljoudi/uBlock/issues/105
        // Allow any kind of pages
        vapi.tabs.onNavigation({
            frameId: 0,
            tabId: tabId,
            url: details.url,
        });
    };

    var attachToTabBrowser = function(window) {
        var tabBrowser = getTabBrowser(window);
        if ( !tabBrowser ) {
            return false;
        }

        var tabContainer = tabBrowser.tabContainer;
        if ( !tabContainer ) {
            return true;
        }
        vAPI.contextMenu.register(window.document);

        if ( typeof vAPI.toolbarButton.attachToNewWindow === 'function' ) {
            vAPI.toolbarButton.attachToNewWindow(window);
        }

        tabContainer.addEventListener('TabOpen', onOpen);
        tabContainer.addEventListener('TabShow', onShow);
        tabContainer.addEventListener('TabClose', onClose);
        tabContainer.addEventListener('TabSelect', onSelect);

        return true;
    };

    var onWindowLoad = function(ev) {
        if ( ev ) {
            this.removeEventListener(ev.type, onWindowLoad);
        }

        var wintype = this.document.documentElement.getAttribute('windowtype');
        if ( wintype !== 'navigator:browser' ) {
            return;
        }

        // On some platforms, the tab browser isn't immediately available,
        // try waiting a bit if this happens.
        var win = this;
        if ( attachToTabBrowser(win) === false ) {
            vAPI.setTimeout(attachToTabBrowser.bind(null, win), 250);
        }
    };

    var onWindowUnload = function() {
        vAPI.contextMenu.unregister(this.document);
        this.removeEventListener('DOMContentLoaded', onWindowLoad);

        var tabBrowser = getTabBrowser(this);
        if ( !tabBrowser ) {
            return;
        }

        // https://github.com/gorhill/uBlock/issues/574
        // To keep in mind: not all browser windows are tab containers.
        var tabContainer = tabBrowser.tabContainer;
        if ( tabContainer ) {
            tabContainer.removeEventListener('TabOpen', onOpen);
            tabContainer.removeEventListener('TabShow', onShow);
            tabContainer.removeEventListener('TabClose', onClose);
            tabContainer.removeEventListener('TabSelect', onSelect);
        }

        // https://github.com/gorhill/uBlock/issues/574
        // To keep in mind: not all windows are tab containers,
        // sometimes the window IS the tab.
        var tabs;
        if ( tabBrowser.tabs ) {
            tabs = tabBrowser.tabs;
        } else if ( tabBrowser.localName === 'browser' ) {
            tabs = [tabBrowser];
        } else {
            tabs = [];
        }

        var browser, URI, tabId;
        for ( var tab of tabs ) {
            browser = tabWatcher.browserFromTarget(tab);
            if ( browser === null ) {
                continue;
            }
            URI = browser.currentURI;
            // Close extension tabs
            if ( URI.schemeIs('chrome') && URI.host === location.host ) {
                vAPI.tabs._remove(tab, getTabBrowser(this));
            }
            browser = browserFromTarget(tab);
            tabId = browserToTabIdMap.get(browser);
            if ( tabId !== undefined ) {
                removeBrowserEntry(tabId, browser);
                tabIdToBrowserMap.delete(tabId);
            }
            browserToTabIdMap.delete(browser);
        }
    };

    // https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Reference/Interface/nsIWindowWatcher
    var windowWatcher = {
        observe: function(win, topic) {
            if ( topic === 'domwindowopened' ) {
                win.addEventListener('DOMContentLoaded', onWindowLoad);
                return;
            }
            if ( topic === 'domwindowclosed' ) {
                onWindowUnload.call(win);
                return;
            }
        }
    };

    // Initialize map with existing active tabs
    var start = function() {
        var tabBrowser, tab;
        for ( var win of vAPI.tabs.getWindows() ) {
            onWindowLoad.call(win);
            tabBrowser = getTabBrowser(win);
            if ( tabBrowser === null ) {
                continue;
            }
            for ( tab of tabBrowser.tabs ) {
                if ( vAPI.fennec || !tab.hasAttribute('pending') ) {
                    tabIdFromTarget(tab);
                }
            }
        }

        vAPI.messaging.globalMessageManager.addMessageListener(
            locationChangedMessageName,
            onLocationChanged
        );

        Services.ww.registerNotification(windowWatcher);
    };

    var stop = function() {
        vAPI.messaging.globalMessageManager.removeMessageListener(
            locationChangedMessageName,
            onLocationChanged
        );

        Services.ww.unregisterNotification(windowWatcher);

        for ( var win of vAPI.tabs.getWindows() ) {
            onWindowUnload.call(win);
        }

        browserToTabIdMap.clear();
        tabIdToBrowserMap.clear();
    };

    cleanupTasks.push(stop);

    return {
        browsers: function() { return browserToTabIdMap.keys(); },
        browserFromTabId: browserFromTabId,
        browserFromTarget: browserFromTarget,
        currentBrowser: currentBrowser,
        indexFromTarget: indexFromTarget,
        start: start,
        tabFromBrowser: tabFromBrowser,
        tabIdFromTarget: tabIdFromTarget
    };
})();

/******************************************************************************/

vAPI.setIcon = function(tabId, iconId, badge) {
    // If badge is undefined, then setIcon was called from the TabSelect event
    var win;
    if ( badge === undefined ) {
        win = iconId;
    } else {
        win = Services.wm.getMostRecentWindow('navigator:browser');
    }
    var curTabId = tabWatcher.tabIdFromTarget(getTabBrowser(win).selectedTab);
    var tb = vAPI.toolbarButton;

    // from 'TabSelect' event
    if ( tabId === undefined ) {
        tabId = curTabId;
    } else if ( badge !== undefined ) {
        tb.tabs[tabId] = { badge: badge, img: iconId };
    }

    if ( tabId === curTabId ) {
        tb.updateState(win, tabId);
    }
};

/******************************************************************************/

vAPI.messaging = {
    get globalMessageManager() {
        return Cc['@mozilla.org/globalmessagemanager;1']
                .getService(Ci.nsIMessageListenerManager);
    },
    frameScript: vAPI.getURL('frameScript.js'),
    listeners: {},
    defaultHandler: null,
    NOOPFUNC: function(){},
    UNHANDLED: 'vAPI.messaging.notHandled'
};

/******************************************************************************/

vAPI.messaging.listen = function(listenerName, callback) {
    this.listeners[listenerName] = callback;
};

/******************************************************************************/

vAPI.messaging.onMessage = function({target, data}) {
    var messageManager = target.messageManager;

    if ( !messageManager ) {
        // Message came from a popup, and its message manager is not usable.
        // So instead we broadcast to the parent window.
        messageManager = getOwnerWindow(
            target.webNavigation.QueryInterface(Ci.nsIDocShell).chromeEventHandler
        ).messageManager;
    }

    var channelNameRaw = data.channelName;
    var pos = channelNameRaw.indexOf('|');
    var channelName = channelNameRaw.slice(pos + 1);

    var callback = vAPI.messaging.NOOPFUNC;
    if ( data.requestId !== undefined ) {
        callback = CallbackWrapper.factory(
            messageManager,
            channelName,
            channelNameRaw.slice(0, pos),
            data.requestId
        ).callback;
    }

    var sender = {
        tab: {
            id: tabWatcher.tabIdFromTarget(target)
        }
    };

    // Specific handler
    var r = vAPI.messaging.UNHANDLED;
    var listener = vAPI.messaging.listeners[channelName];
    if ( typeof listener === 'function' ) {
        r = listener(data.msg, sender, callback);
    }
    if ( r !== vAPI.messaging.UNHANDLED ) {
        return;
    }

    // Default handler
    r = vAPI.messaging.defaultHandler(data.msg, sender, callback);
    if ( r !== vAPI.messaging.UNHANDLED ) {
        return;
    }

    console.error('uMatrix> messaging > unknown request: %o', data);

    // Unhandled:
    // Need to callback anyways in case caller expected an answer, or
    // else there is a memory leak on caller's side
    callback();
};

/******************************************************************************/

vAPI.messaging.setup = function(defaultHandler) {
    // Already setup?
    if ( this.defaultHandler !== null ) {
        return;
    }

    if ( typeof defaultHandler !== 'function' ) {
        defaultHandler = function(){ return vAPI.messaging.UNHANDLED; };
    }
    this.defaultHandler = defaultHandler;

    this.globalMessageManager.addMessageListener(
        location.host + ':background',
        this.onMessage
    );

    this.globalMessageManager.loadFrameScript(this.frameScript, true);

    cleanupTasks.push(function() {
        var gmm = vAPI.messaging.globalMessageManager;

        gmm.removeDelayedFrameScript(vAPI.messaging.frameScript);
        gmm.removeMessageListener(
            location.host + ':background',
            vAPI.messaging.onMessage
        );
    });
};

/******************************************************************************/

vAPI.messaging.broadcast = function(message) {
    this.globalMessageManager.broadcastAsyncMessage(
        location.host + ':broadcast',
        JSON.stringify({broadcast: true, msg: message})
    );
};

/******************************************************************************/

// This allows to avoid creating a closure for every single message which
// expects an answer. Having a closure created each time a message is processed
// has been always bothering me. Another benefit of the implementation here
// is to reuse the callback proxy object, so less memory churning.
//
// https://developers.google.com/speed/articles/optimizing-javascript
// "Creating a closure is significantly slower then creating an inner
//  function without a closure, and much slower than reusing a static
//  function"
//
// http://hacksoflife.blogspot.ca/2015/01/the-four-horsemen-of-performance.html
// "the dreaded 'uniformly slow code' case where every function takes 1%
//  of CPU and you have to make one hundred separate performance optimizations
//  to improve performance at all"
//
// http://jsperf.com/closure-no-closure/2

var CallbackWrapper = function(messageManager, channelName, listenerId, requestId) {
    this.callback = this.proxy.bind(this); // bind once
    this.init(messageManager, channelName, listenerId, requestId);
};

CallbackWrapper.junkyard = [];

CallbackWrapper.factory = function(messageManager, channelName, listenerId, requestId) {
    var wrapper = CallbackWrapper.junkyard.pop();
    if ( wrapper ) {
        wrapper.init(messageManager, channelName, listenerId, requestId);
        return wrapper;
    }
    return new CallbackWrapper(messageManager, channelName, listenerId, requestId);
};

CallbackWrapper.prototype.init = function(messageManager, channelName, listenerId, requestId) {
    this.messageManager = messageManager;
    this.channelName = channelName;
    this.listenerId = listenerId;
    this.requestId = requestId;
};

CallbackWrapper.prototype.proxy = function(response) {
    var message = JSON.stringify({
        requestId: this.requestId,
        channelName: this.channelName,
        msg: response !== undefined ? response : null
    });

    if ( this.messageManager.sendAsyncMessage ) {
        this.messageManager.sendAsyncMessage(this.listenerId, message);
    } else {
        this.messageManager.broadcastAsyncMessage(this.listenerId, message);
    }

    // Mark for reuse
    this.messageManager =
    this.channelName =
    this.requestId =
    this.listenerId = null;
    CallbackWrapper.junkyard.push(this);
};

/******************************************************************************/

var httpRequestHeadersFactory = function(channel) {
    var entry = httpRequestHeadersFactory.junkyard.pop();
    if ( entry ) {
        return entry.init(channel);
    }
    return new HTTPRequestHeaders(channel);
};

httpRequestHeadersFactory.junkyard = [];

var HTTPRequestHeaders = function(channel) {
    this.init(channel);
};

HTTPRequestHeaders.prototype.init = function(channel) {
    this.channel = channel;
    return this;
};

HTTPRequestHeaders.prototype.dispose = function() {
    this.channel = null;
    httpRequestHeadersFactory.junkyard.push(this);
};

HTTPRequestHeaders.prototype.getHeader = function(name) {
    try {
        return this.channel.getRequestHeader(name);
    } catch (e) {
    }
    return '';
};

HTTPRequestHeaders.prototype.setHeader = function(name, newValue, create) {
    var oldValue = this.getHeader(name);
    if ( newValue === oldValue ) {
        return false;
    }
    if ( oldValue === '' && create !== true ) {
        return false;
    }
    this.channel.setRequestHeader(name, newValue, false);
    return true;
};

/******************************************************************************/

var httpObserver = {
    classDescription: 'net-channel-event-sinks for ' + location.host,
    classID: Components.ID('{5d2e2797-6d68-42e2-8aeb-81ce6ba16b95}'),
    contractID: '@' + location.host + '/net-channel-event-sinks;1',
    REQDATAKEY: location.host + 'reqdata',
    ABORT: Components.results.NS_BINDING_ABORTED,
    ACCEPT: Components.results.NS_SUCCEEDED,
    // Request types:
    // https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Reference/Interface/nsIContentPolicy#Constants
    frameTypeMap: {
        6: 'main_frame',
        7: 'sub_frame'
    },
    typeMap: {
        1: 'other',
        2: 'script',
        3: 'image',
        4: 'stylesheet',
        5: 'object',
        6: 'main_frame',
        7: 'sub_frame',
        10: 'ping',
        11: 'xmlhttprequest',
        12: 'object',
        14: 'font',
        15: 'media',
        16: 'websocket',
        21: 'image'
    },
    mimeTypeMap: {
        'audio': 15,
        'video': 15
    },

    get componentRegistrar() {
        return Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
    },

    get categoryManager() {
        return Cc['@mozilla.org/categorymanager;1']
                .getService(Ci.nsICategoryManager);
    },

    QueryInterface: (function() {
        var {XPCOMUtils} = Cu.import('resource://gre/modules/XPCOMUtils.jsm', null);

        return XPCOMUtils.generateQI([
            Ci.nsIFactory,
            Ci.nsIObserver,
            Ci.nsIChannelEventSink,
            Ci.nsISupportsWeakReference
        ]);
    })(),

    createInstance: function(outer, iid) {
        if ( outer ) {
            throw Components.results.NS_ERROR_NO_AGGREGATION;
        }

        return this.QueryInterface(iid);
    },

    register: function() {
        this.pendingRingBufferInit();

        // https://developer.mozilla.org/en/docs/Observer_Notifications#HTTP_requests
        Services.obs.addObserver(this, 'http-on-opening-request', true);
        Services.obs.addObserver(this, 'http-on-modify-request', true);
        Services.obs.addObserver(this, 'http-on-examine-response', true);
        Services.obs.addObserver(this, 'http-on-examine-cached-response', true);

        // Guard against stale instances not having been unregistered
        if ( this.componentRegistrar.isCIDRegistered(this.classID) ) {
            try {
                this.componentRegistrar.unregisterFactory(this.classID, Components.manager.getClassObject(this.classID, Ci.nsIFactory));
            } catch (ex) {
                console.error('uMatrix> httpObserver > unable to unregister stale instance: ', ex);
            }
        }

        this.componentRegistrar.registerFactory(
            this.classID,
            this.classDescription,
            this.contractID,
            this
        );
        this.categoryManager.addCategoryEntry(
            'net-channel-event-sinks',
            this.contractID,
            this.contractID,
            false,
            true
        );
    },

    unregister: function() {
        Services.obs.removeObserver(this, 'http-on-opening-request');
        Services.obs.removeObserver(this, 'http-on-modify-request');
        Services.obs.removeObserver(this, 'http-on-examine-response');
        Services.obs.removeObserver(this, 'http-on-examine-cached-response');

        this.componentRegistrar.unregisterFactory(this.classID, this);
        this.categoryManager.deleteCategoryEntry(
            'net-channel-event-sinks',
            this.contractID,
            false
        );
    },

    PendingRequest: function() {
        this.rawType = 0;
        this.tabId = 0;
        this._key = ''; // key is url, from URI.spec
    },

    // If all work fine, this map should not grow indefinitely. It can have
    // stale items in it, but these will be taken care of when entries in
    // the ring buffer are overwritten.
    pendingURLToIndex: new Map(),
    pendingWritePointer: 0,
    pendingRingBuffer: new Array(32),
    pendingRingBufferInit: function() {
        // Use and reuse pre-allocated PendingRequest objects = less memory
        // churning.
        var i = this.pendingRingBuffer.length;
        while ( i-- ) {
            this.pendingRingBuffer[i] = new this.PendingRequest();
        }
    },

    createPendingRequest: function(url) {
        var bucket;
        var i = this.pendingWritePointer;
        this.pendingWritePointer = i + 1 & 31;
        var preq = this.pendingRingBuffer[i];
        // Cleanup unserviced pending request
        if ( preq._key !== '' ) {
            bucket = this.pendingURLToIndex.get(preq._key);
            if ( Array.isArray(bucket) ) {
                // Assuming i in array
                var pos = bucket.indexOf(i);
                bucket.splice(pos, 1);
                if ( bucket.length === 1 ) {
                    this.pendingURLToIndex.set(preq._key, bucket[0]);
                }
            } else if ( typeof bucket === 'number' ) {
                // Assuming bucket === i
                this.pendingURLToIndex.delete(preq._key);
            }
        }
        // Would be much simpler if a url could not appear more than once.
        bucket = this.pendingURLToIndex.get(url);
        if ( bucket === undefined ) {
            this.pendingURLToIndex.set(url, i);
        } else if ( Array.isArray(bucket) ) {
            bucket = bucket.push(i);
        } else {
            bucket = [bucket, i];
        }
        preq._key = url;
        return preq;
    },

    lookupPendingRequest: function(url) {
        var i = this.pendingURLToIndex.get(url);
        if ( i === undefined ) {
            return null;
        }
        if ( Array.isArray(i) ) {
            var bucket = i;
            i = bucket.shift();
            if ( bucket.length === 1 ) {
                this.pendingURLToIndex.set(url, bucket[0]);
            }
        } else {
            this.pendingURLToIndex.delete(url);
        }
        var preq = this.pendingRingBuffer[i];
        preq._key = ''; // mark as "serviced"
        return preq;
    },

    handleRequest: function(channel, URI, tabId, rawType) {
        var type = this.typeMap[rawType] || 'other';
        var onBeforeRequest = vAPI.net.onBeforeRequest;
        if ( onBeforeRequest.types && onBeforeRequest.types.has(type) === false ) {
            return false;
        }

        var result = onBeforeRequest.callback({
            hostname: URI.asciiHost,
            parentFrameId: type === 'main_frame' ? -1 : 0,
            tabId: tabId,
            type: type,
            url: URI.asciiSpec
        });

        if ( typeof result !== 'object' ) {
            return false;
        }

        channel.cancel(this.ABORT);
        return true;
    },

    handleRequestHeaders: function(channel, URI, tabId, rawType) {
        var type = this.typeMap[rawType] || 'other';
        var onBeforeSendHeaders = vAPI.net.onBeforeSendHeaders;
        if ( onBeforeSendHeaders.types && onBeforeSendHeaders.types.has(type) === false ) {
            return;
        }
        var requestHeaders = httpRequestHeadersFactory(channel);
        onBeforeSendHeaders.callback({
            hostname: URI.asciiHost,
            parentFrameId: type === 'main_frame' ? -1 : 0,
            requestHeaders: requestHeaders,
            tabId: tabId,
            type: type,
            url: URI.asciiSpec
        });
        requestHeaders.dispose();
    },

    channelDataFromChannel: function(channel) {
        if ( channel instanceof Ci.nsIWritablePropertyBag ) {
            try {
                return channel.getProperty(this.REQDATAKEY);
            } catch (ex) {
            }
        }
        return null;
    },

    // https://github.com/gorhill/uMatrix/issues/165
    // https://developer.mozilla.org/en-US/Firefox/Releases/3.5/Updating_extensions#Getting_a_load_context_from_a_request
    // Not sure `umatrix:shouldLoad` is still needed, uMatrix does not
    //   care about embedded frames topography.
    // Also:
    //   https://developer.mozilla.org/en-US/Firefox/Multiprocess_Firefox/Limitations_of_chrome_scripts
    tabIdFromChannel: function(channel) {
        var aWindow;
        if ( channel.notificationCallbacks ) {
            try {
                var loadContext = channel
                        .notificationCallbacks
                        .getInterface(Ci.nsILoadContext);
                if ( loadContext.topFrameElement ) {
                    return tabWatcher.tabIdFromTarget(loadContext.topFrameElement);
                }
                aWindow = loadContext.associatedWindow;
            } catch (ex) {
                //console.error(ex);
            }
        }
        try {
            if ( !aWindow && channel.loadGroup && channel.loadGroup.notificationCallbacks ) {
                aWindow = channel
                    .loadGroup
                    .notificationCallbacks
                    .getInterface(Ci.nsILoadContext)
                    .associatedWindow;
            }
            if ( aWindow ) {
                return tabWatcher.tabIdFromTarget(
                    aWindow
                    .getInterface(Ci.nsIWebNavigation)
                    .QueryInterface(Ci.nsIDocShell)
                    .rootTreeItem
                    .QueryInterface(Ci.nsIInterfaceRequestor)
                    .getInterface(Ci.nsIDOMWindow)
                    .gBrowser
                    .getBrowserForContentWindow(aWindow)
                );
            }
        } catch (ex) {
            //console.error(ex);
        }
        return vAPI.noTabId;
    },

    rawtypeFromContentType: function(channel) {
        var mime = channel.contentType;
        if ( !mime ) {
            return 0;
        }
        var pos = mime.indexOf('/');
        if ( pos === -1 ) {
            pos = mime.length;
        }
        return this.mimeTypeMap[mime.slice(0, pos)] || 0;
    },

    observe: function(channel, topic) {
        if ( channel instanceof Ci.nsIHttpChannel === false ) {
            return;
        }

        var URI = channel.URI;
        var channelData;

        if (
            topic === 'http-on-examine-response' ||
            topic === 'http-on-examine-cached-response'
        ) {
            channelData = this.channelDataFromChannel(channel);
            if ( channelData === null ) {
                return;
            }

            var type = this.frameTypeMap[channelData[1]];
            if ( !type ) {
                return;
            }

            topic = 'Content-Security-Policy';

            var result;
            try {
                result = channel.getResponseHeader(topic);
            } catch (ex) {
                result = null;
            }

            result = vAPI.net.onHeadersReceived.callback({
                hostname: URI.asciiHost,
                parentFrameId: type === 'main_frame' ? -1 : 0,
                responseHeaders: result ? [{name: topic, value: result}] : [],
                tabId: channelData[0],
                type: type,
                url: URI.asciiSpec
            });

            if ( result ) {
                channel.setResponseHeader(
                    topic,
                    result.responseHeaders.pop().value,
                    true
                );
            }

            return;
        }

        if ( topic === 'http-on-modify-request' ) {
            channelData = this.channelDataFromChannel(channel);
            if ( channelData === null ) {
                return;
            }

            this.handleRequestHeaders(channel, URI, channelData[0], channelData[1]);

            return;
        }

        // http-on-opening-request
        var tabId;
        var pendingRequest = this.lookupPendingRequest(URI.asciiSpec);
        var rawType = channel.loadInfo && channel.loadInfo.contentPolicyType || 1;

        if ( pendingRequest !== null ) {
            tabId = pendingRequest.tabId;
            // https://github.com/gorhill/uBlock/issues/654
            // Use the request type from the HTTP observer point of view.
            if ( rawType !== 1 ) {
                pendingRequest.rawType = rawType;
            } else {
                rawType = pendingRequest.rawType;
            }
        } else {
            tabId = this.tabIdFromChannel(channel);
        }

        if ( this.handleRequest(channel, URI, tabId, rawType) ) {
            return;
        }

        if ( channel instanceof Ci.nsIWritablePropertyBag === false ) {
            return;
        }

        // Carry data for behind-the-scene redirects
        channel.setProperty(this.REQDATAKEY, [tabId, rawType]);
    },

    // contentPolicy.shouldLoad doesn't detect redirects, this needs to be used
    asyncOnChannelRedirect: function(oldChannel, newChannel, flags, callback) {
        var result = this.ACCEPT;

        // If error thrown, the redirect will fail
        try {
            var URI = newChannel.URI;

            if ( !URI.schemeIs('http') && !URI.schemeIs('https') ) {
                return;
            }

            if ( !(oldChannel instanceof Ci.nsIWritablePropertyBag) ) {
                return;
            }

            var channelData = oldChannel.getProperty(this.REQDATAKEY);

            if ( this.handleRequest(newChannel, URI, channelData[0], channelData[1]) ) {
                result = this.ABORT;
                return;
            }

            // Carry the data on in case of multiple redirects
            if ( newChannel instanceof Ci.nsIWritablePropertyBag ) {
                newChannel.setProperty(this.REQDATAKEY, channelData);
            }
        } catch (ex) {
            // console.error(ex);
        } finally {
            callback.onRedirectVerifyCallback(result);
        }
    }
};

/******************************************************************************/

vAPI.net = {};

/******************************************************************************/

vAPI.net.registerListeners = function() {
    this.onBeforeRequest.types = this.onBeforeRequest.types ?
        new Set(this.onBeforeRequest.types) :
        null;
    this.onBeforeSendHeaders.types = this.onBeforeSendHeaders.types ?
        new Set(this.onBeforeSendHeaders.types) :
        null;

    var shouldLoadListenerMessageName = location.host + ':shouldLoad';
    var shouldLoadListener = function(e) {
        var details = e.data;
        var pendingReq = httpObserver.createPendingRequest(details.url);
        pendingReq.rawType = details.rawType;
        pendingReq.tabId = tabWatcher.tabIdFromTarget(e.target);
    };

    vAPI.messaging.globalMessageManager.addMessageListener(
        shouldLoadListenerMessageName,
        shouldLoadListener
    );

    httpObserver.register();

    cleanupTasks.push(function() {
        vAPI.messaging.globalMessageManager.removeMessageListener(
            shouldLoadListenerMessageName,
            shouldLoadListener
        );
        httpObserver.unregister();
    });
};

/******************************************************************************/
/******************************************************************************/

vAPI.toolbarButton = {
    id: location.host + '-button',
    type: 'view',
    viewId: location.host + '-panel',
    label: vAPI.app.name,
    tooltiptext: vAPI.app.name,
    tabs: {/*tabId: {badge: 0, img: boolean}*/},
    init: null,
    codePath: ''
};

/******************************************************************************/

// Non-Fennec: common code paths.

(function() {
    if ( vAPI.fennec ) {
        return;
    }

    var tbb = vAPI.toolbarButton;
    var popupCommittedWidth = 0;
    var popupCommittedHeight = 0;

    tbb.onViewShowing = function({target}) {
        popupCommittedWidth = popupCommittedHeight = 0;
        target.firstChild.setAttribute('src', vAPI.getURL('popup.html'));
    };

    tbb.onViewHiding = function({target}) {
        target.parentNode.style.maxWidth = '';
        target.firstChild.setAttribute('src', 'about:blank');
    };

    tbb.updateState = function(win, tabId) {
        var button = win.document.getElementById(this.id);

        if ( !button ) {
            return;
        }

        var icon = this.tabs[tabId];
        button.setAttribute('badge', icon && icon.badge || '');
        button.classList.toggle('off', !icon || !icon.img);

        var iconId = icon && icon.img ? icon.img : 'off';
        icon = 'url(' + vAPI.getURL('img/browsericons/icon19-' + iconId + '.png') + ')';
        button.style.listStyleImage = icon;
    };

    tbb.populatePanel = function(doc, panel) {
        panel.setAttribute('id', this.viewId);

        var iframe = doc.createElement('iframe');
        iframe.setAttribute('type', 'content');

        panel.appendChild(iframe);

        var toPx = function(pixels) {
            return pixels.toString() + 'px';
        };

        var scrollBarWidth = 0;
        var resizeTimer = null;

        var resizePopupDelayed = function(attempts) {
            if ( resizeTimer !== null ) {
                return false;
            }

            // Sanity check
            attempts = (attempts || 0) + 1;
            if ( attempts > 1/*000*/ ) {
                //console.error('uMatrix> resizePopupDelayed: giving up after too many attempts');
                return false;
            }

            resizeTimer = vAPI.setTimeout(resizePopup, 10, attempts);
            return true;
        };

        var resizePopup = function(attempts) {
            resizeTimer = null;

            panel.parentNode.style.maxWidth = 'none';
            var body = iframe.contentDocument.body;

            // https://github.com/gorhill/uMatrix/issues/301
            // Don't resize if committed size did not change.
            if (
                popupCommittedWidth === body.clientWidth &&
                popupCommittedHeight === body.clientHeight
            ) {
                return;
            }

            // We set a limit for height
            var height = Math.min(body.clientHeight, 600);

            // https://github.com/chrisaljoudi/uBlock/issues/730
            // Voodoo programming: this recipe works
            panel.style.setProperty('height', toPx(height));
            iframe.style.setProperty('height', toPx(height));

            // Adjust width for presence/absence of vertical scroll bar which may
            // have appeared as a result of last operation.
            var contentWindow = iframe.contentWindow;
            var width = body.clientWidth;
            if ( contentWindow.scrollMaxY !== 0 ) {
                width += scrollBarWidth;
            }
            panel.style.setProperty('width', toPx(width));

            // scrollMaxX should always be zero once we know the scrollbar width
            if ( contentWindow.scrollMaxX !== 0 ) {
                scrollBarWidth = contentWindow.scrollMaxX;
                width += scrollBarWidth;
                panel.style.setProperty('width', toPx(width));
            }

            if ( iframe.clientHeight !== height || panel.clientWidth !== width ) {
                if ( resizePopupDelayed(attempts) ) {
                    return;
                }
                // resizePopupDelayed won't be called again, so commit
                // dimentsions.
            }

            popupCommittedWidth = body.clientWidth;
            popupCommittedHeight = body.clientHeight;
        };

        var onResizeRequested = function() {
            var body = iframe.contentDocument.body;
            if ( body.getAttribute('data-resize-popup') !== 'true' ) {
                return;
            }
            body.removeAttribute('data-resize-popup');
            resizePopupDelayed();
        };

        var onPopupReady = function() {
            var win = this.contentWindow;

            if ( !win || win.location.host !== location.host ) {
                return;
            }

            if ( typeof tbb.onBeforePopupReady === 'function' ) {
                tbb.onBeforePopupReady.call(this);
            }

            resizePopupDelayed();

            var body = win.document.body;
            body.removeAttribute('data-resize-popup');
            var mutationObserver = new win.MutationObserver(onResizeRequested);
            mutationObserver.observe(body, {
                attributes: true,
                attributeFilter: [ 'data-resize-popup' ]
            });
        };

        iframe.addEventListener('load', onPopupReady, true);
    };
})();

/******************************************************************************/

// Firefox 28 and less

(function() {
    var tbb = vAPI.toolbarButton;
    if ( tbb.init !== null ) {
        return;
    }
    var CustomizableUI = null;
    var forceLegacyToolbarButton = vAPI.localStorage.getBool('forceLegacyToolbarButton');
    if ( !forceLegacyToolbarButton ) {
        try {
            CustomizableUI = Cu.import('resource:///modules/CustomizableUI.jsm', null).CustomizableUI;
        } catch (ex) {
        }
    }
    if ( CustomizableUI !== null ) {
        return;
    }

    tbb.codePath = 'legacy';
    tbb.id = 'umatrix-legacy-button';   // NOTE: must match legacy-toolbar-button.css
    tbb.viewId = tbb.id + '-panel';

    var sss = null;
    var styleSheetUri = null;

    var addLegacyToolbarButton = function(window) {
        var document = window.document;

        var toolbox = document.getElementById('navigator-toolbox') || document.getElementById('mail-toolbox');
        if ( !toolbox ) {
            return;
        }

        // palette might take a little longer to appear on some platforms,
        // give it a small delay and try again.
        var palette = toolbox.palette;
        if ( !palette ) {
            vAPI.setTimeout(function() {
                if ( toolbox.palette ) {
                    addLegacyToolbarButton(window);
                }
            }, 250);
            return;
        }

        var toolbarButton = document.createElement('toolbarbutton');
        toolbarButton.setAttribute('id', tbb.id);
        // type = panel would be more accurate, but doesn't look as good
        toolbarButton.setAttribute('type', 'menu');
        toolbarButton.setAttribute('removable', 'true');
        toolbarButton.setAttribute('class', 'toolbarbutton-1 chromeclass-toolbar-additional');
        toolbarButton.setAttribute('label', tbb.label);
        toolbarButton.setAttribute('tooltiptext', tbb.label);

        var toolbarButtonPanel = document.createElement('panel');
        // NOTE: Setting level to parent breaks the popup for PaleMoon under
        // linux (mouse pointer misaligned with content). For some reason.
        // toolbarButtonPanel.setAttribute('level', 'parent');
        tbb.populatePanel(document, toolbarButtonPanel);
        toolbarButtonPanel.addEventListener('popupshowing', tbb.onViewShowing);
        toolbarButtonPanel.addEventListener('popuphiding', tbb.onViewHiding);
        toolbarButton.appendChild(toolbarButtonPanel);

        palette.appendChild(toolbarButton);

        tbb.closePopup = function() {
            toolbarButtonPanel.hidePopup();
        };

        // No button yet so give it a default location. If forcing the button,
        // just put in in the palette rather than on any specific toolbar (who
        // knows what toolbars will be available or visible!)
        var toolbar;
        if ( !vAPI.localStorage.getBool('legacyToolbarButtonAdded') ) {
            vAPI.localStorage.setBool('legacyToolbarButtonAdded', 'true');
            toolbar = document.getElementById('nav-bar');
            if ( toolbar === null ) {
                return;
            }
            // https://github.com/gorhill/uBlock/issues/264
            // Find a child customizable palette, if any.
            toolbar = toolbar.querySelector('.customization-target') || toolbar;
            toolbar.appendChild(toolbarButton);
            toolbar.setAttribute('currentset', toolbar.currentSet);
            document.persist(toolbar.id, 'currentset');
            return;
        }

        // Find the place to put the button
        var toolbars = toolbox.externalToolbars.slice();
        for ( var child of toolbox.children ) {
            if ( child.localName === 'toolbar' ) {
                toolbars.push(child);
            }
        }

        for ( toolbar of toolbars ) {
            var currentsetString = toolbar.getAttribute('currentset');
            if ( !currentsetString ) {
                continue;
            }
            var currentset = currentsetString.split(',');
            var index = currentset.indexOf(tbb.id);
            if ( index === -1 ) {
                continue;
            }
            // Found our button on this toolbar - but where on it?
            var before = null;
            for ( var i = index + 1; i < currentset.length; i++ ) {
                before = document.getElementById(currentset[i]);
                if ( before === null ) {
                    continue;
                }
                toolbar.insertItem(tbb.id, before);
                break;
            }
            if ( before === null ) {
                toolbar.insertItem(tbb.id);
            }
        }
    };

    var onPopupCloseRequested = function({target}) {
        if ( typeof tbb.closePopup === 'function' ) {
            tbb.closePopup(target);
        }
    };

    var shutdown = function() {
        for ( var win of vAPI.tabs.getWindows() ) {
            var toolbarButton = win.document.getElementById(tbb.id);
            if ( toolbarButton ) {
                toolbarButton.parentNode.removeChild(toolbarButton);
            }
        }
        if ( sss === null ) {
            return;
        }
        if ( sss.sheetRegistered(styleSheetUri, sss.AUTHOR_SHEET) ) {
            sss.unregisterSheet(styleSheetUri, sss.AUTHOR_SHEET);
        }
        sss = null;
        styleSheetUri = null;

        vAPI.messaging.globalMessageManager.removeMessageListener(
            location.host + ':closePopup',
            onPopupCloseRequested
        );
    };

    tbb.attachToNewWindow = function(win) {
        addLegacyToolbarButton(win);
    };

    tbb.init = function() {
        vAPI.messaging.globalMessageManager.addMessageListener(
            location.host + ':closePopup',
            onPopupCloseRequested
        );

        sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
        styleSheetUri = Services.io.newURI(vAPI.getURL("css/legacy-toolbar-button.css"), null, null);

        // Register global so it works in all windows, including palette
        if ( !sss.sheetRegistered(styleSheetUri, sss.AUTHOR_SHEET) ) {
            sss.loadAndRegisterSheet(styleSheetUri, sss.AUTHOR_SHEET);
        }

        cleanupTasks.push(shutdown);
    };
})();

/******************************************************************************/

// Firefox Australis < 36.

(function() {
    var tbb = vAPI.toolbarButton;
    if ( tbb.init !== null ) {
        return;
    }
    if ( Services.vc.compare(Services.appinfo.platformVersion, '36.0') >= 0 ) {
        return null;
    }
    if ( vAPI.localStorage.getBool('forceLegacyToolbarButton') ) {
        return null;
    }
    var CustomizableUI = null;
    try {
        CustomizableUI = Cu.import('resource:///modules/CustomizableUI.jsm', null).CustomizableUI;
    } catch (ex) {
    }
    if ( CustomizableUI === null ) {
        return;
    }
    tbb.codePath = 'australis';
    tbb.CustomizableUI = CustomizableUI;
    tbb.defaultArea = CustomizableUI.AREA_NAVBAR;

    var styleURI = null;

    var onPopupCloseRequested = function({target}) {
        if ( typeof tbb.closePopup === 'function' ) {
            tbb.closePopup(target);
        }
    };

    var shutdown = function() {
        CustomizableUI.destroyWidget(tbb.id);

        for ( var win of vAPI.tabs.getWindows() ) {
            var panel = win.document.getElementById(tbb.viewId);
            panel.parentNode.removeChild(panel);
            win.QueryInterface(Ci.nsIInterfaceRequestor)
               .getInterface(Ci.nsIDOMWindowUtils)
               .removeSheet(styleURI, 1);
        }

        vAPI.messaging.globalMessageManager.removeMessageListener(
            location.host + ':closePopup',
            onPopupCloseRequested
        );
    };

    tbb.onBeforeCreated = function(doc) {
        var panel = doc.createElement('panelview');

        this.populatePanel(doc, panel);

        doc.getElementById('PanelUI-multiView').appendChild(panel);

        doc.defaultView.QueryInterface(Ci.nsIInterfaceRequestor)
            .getInterface(Ci.nsIDOMWindowUtils)
            .loadSheet(styleURI, 1);
    };

    tbb.onBeforePopupReady = function() {
        // https://github.com/gorhill/uBlock/issues/83
        // Add `portrait` class if width is constrained.
        try {
            this.contentDocument.body.classList.toggle(
                'portrait',
                CustomizableUI.getWidget(tbb.id).areaType === CustomizableUI.TYPE_MENU_PANEL
            );
        } catch (ex) {
            /* noop */
        }
    };

    tbb.init = function() {
        vAPI.messaging.globalMessageManager.addMessageListener(
            location.host + ':closePopup',
            onPopupCloseRequested
        );

        var style = [
            '#' + this.id + '.off {',
                'list-style-image: url(',
                    vAPI.getURL('img/browsericons/icon19-off.png'),
                ');',
            '}',
            '#' + this.id + ' {',
                'list-style-image: url(',
                    vAPI.getURL('img/browsericons/icon19.png'),
                ');',
            '}',
            '#' + this.viewId + ', #' + this.viewId + ' > iframe {',
                'width: 160px;',
                'height: 290px;',
                'overflow: hidden !important;',
            '}',
            '#' + this.id + '[badge]:not([badge=""])::after {',
                'position: absolute;',
                'margin-left: -16px;',
                'margin-top: 3px;',
                'padding: 1px 2px;',
                'font-size: 9px;',
                'font-weight: bold;',
                'color: #fff;',
                'background: #000;',
                'content: attr(badge);',
            '}'
        ];

        styleURI = Services.io.newURI(
            'data:text/css,' + encodeURIComponent(style.join('')),
            null,
            null
        );

        this.closePopup = function(tabBrowser) {
            CustomizableUI.hidePanelForNode(
                tabBrowser.ownerDocument.getElementById(this.viewId)
            );
        };

        CustomizableUI.createWidget(this);

        cleanupTasks.push(shutdown);
    };
})();

/******************************************************************************/

// Firefox Australis >= 36.

(function() {
    var tbb = vAPI.toolbarButton;
    if ( tbb.init !== null ) {
        return;
    }
    if ( Services.vc.compare(Services.appinfo.platformVersion, '36.0') < 0 ) {
        return null;
    }
    if ( vAPI.localStorage.getBool('forceLegacyToolbarButton') ) {
        return null;
    }
    var CustomizableUI = null;
    try {
        CustomizableUI = Cu.import('resource:///modules/CustomizableUI.jsm', null).CustomizableUI;
    } catch (ex) {
    }
    if ( CustomizableUI === null ) {
        return null;
    }
    tbb.codePath = 'australis';
    tbb.CustomizableUI = CustomizableUI;
    tbb.defaultArea = CustomizableUI.AREA_NAVBAR;

    var CUIEvents = {};

    var badgeCSSRules = [
        'background: #000',
        'color: #fff'
    ].join(';');

    var updateBadgeStyle = function() {
        for ( var win of vAPI.tabs.getWindows() ) {
            var button = win.document.getElementById(tbb.id);
            if ( button === null ) {
                continue;
            }
            var badge = button.ownerDocument.getAnonymousElementByAttribute(
                button,
                'class',
                'toolbarbutton-badge'
            );
            if ( !badge ) {
                continue;
            }

            badge.style.cssText = badgeCSSRules;
        }
    };

    var updateBadge = function() {
        var wId = tbb.id;
        var buttonInPanel = CustomizableUI.getWidget(wId).areaType === CustomizableUI.TYPE_MENU_PANEL;

        for ( var win of vAPI.tabs.getWindows() ) {
            var button = win.document.getElementById(wId);
            if ( button === null ) {
                continue;
            }
            if ( buttonInPanel ) {
                button.classList.remove('badged-button');
                continue;
            }
            button.classList.add('badged-button');
        }

        if ( buttonInPanel ) {
            return;
        }

        // Anonymous elements need some time to be reachable
        vAPI.setTimeout(updateBadgeStyle, 250);
    }.bind(CUIEvents);

    // https://developer.mozilla.org/en-US/docs/Mozilla/JavaScript_code_modules/CustomizableUI.jsm#Listeners
    CUIEvents.onCustomizeEnd = updateBadge;
    CUIEvents.onWidgetAdded = updateBadge;
    CUIEvents.onWidgetUnderflow = updateBadge;

    var onPopupCloseRequested = function({target}) {
        if ( typeof tbb.closePopup === 'function' ) {
            tbb.closePopup(target);
        }
    };

    var shutdown = function() {
        CustomizableUI.removeListener(CUIEvents);
        CustomizableUI.destroyWidget(tbb.id);

        for ( var win of vAPI.tabs.getWindows() ) {
            var panel = win.document.getElementById(tbb.viewId);
            panel.parentNode.removeChild(panel);
            win.QueryInterface(Ci.nsIInterfaceRequestor)
                .getInterface(Ci.nsIDOMWindowUtils)
                .removeSheet(styleURI, 1);
        }


        vAPI.messaging.globalMessageManager.removeMessageListener(
            location.host + ':closePopup',
            onPopupCloseRequested
        );
    };

    var styleURI = null;

    tbb.onBeforeCreated = function(doc) {
        var panel = doc.createElement('panelview');

        this.populatePanel(doc, panel);

        doc.getElementById('PanelUI-multiView').appendChild(panel);

        doc.defaultView.QueryInterface(Ci.nsIInterfaceRequestor)
            .getInterface(Ci.nsIDOMWindowUtils)
            .loadSheet(styleURI, 1);
    };

    tbb.onCreated = function(button) {
        button.setAttribute('badge', '');
        vAPI.setTimeout(updateBadge, 250);
    };

    tbb.onBeforePopupReady = function() {
        // https://github.com/gorhill/uBlock/issues/83
        // Add `portrait` class if width is constrained.
        try {
            this.contentDocument.body.classList.toggle(
                'portrait',
                CustomizableUI.getWidget(tbb.id).areaType === CustomizableUI.TYPE_MENU_PANEL
            );
        } catch (ex) {
            /* noop */
        }
    };

    tbb.closePopup = function(tabBrowser) {
        CustomizableUI.hidePanelForNode(
            tabBrowser.ownerDocument.getElementById(tbb.viewId)
        );
    };

    tbb.init = function() {
        vAPI.messaging.globalMessageManager.addMessageListener(
            location.host + ':closePopup',
            onPopupCloseRequested
        );

        CustomizableUI.addListener(CUIEvents);

        var style = [
            '#' + this.id + '.off {',
                'list-style-image: url(',
                    vAPI.getURL('img/browsericons/icon19-off.png'),
                ');',
            '}',
            '#' + this.id + ' {',
                'list-style-image: url(',
                    vAPI.getURL('img/browsericons/icon19-19.png'),
                ');',
            '}',
            '#' + this.viewId + ', #' + this.viewId + ' > iframe {',
                'width: 160px;',
                'height: 290px;',
                'overflow: hidden !important;',
            '}'
        ];

        styleURI = Services.io.newURI(
            'data:text/css,' + encodeURIComponent(style.join('')),
            null,
            null
        );

        CustomizableUI.createWidget(this);

        cleanupTasks.push(shutdown);
    };
})();

/******************************************************************************/

// No toolbar button.

(function() {
    // Just to ensure the number of cleanup tasks is as expected: toolbar
    // button code is one single cleanup task regardless of platform.
    if ( vAPI.toolbarButton.init === null ) {
        cleanupTasks.push(function(){});
    }
})();

/******************************************************************************/

if ( vAPI.toolbarButton.init !== null ) {
    vAPI.toolbarButton.init();
}

/******************************************************************************/
/******************************************************************************/

vAPI.contextMenu = {
    contextMap: {
        frame: 'inFrame',
        link: 'onLink',
        image: 'onImage',
        audio: 'onAudio',
        video: 'onVideo',
        editable: 'onEditableArea'
    }
};

/******************************************************************************/

vAPI.contextMenu.displayMenuItem = function({target}) {
    var doc = target.ownerDocument;
    var gContextMenu = doc.defaultView.gContextMenu;

    if ( !gContextMenu.browser ) {
        return;
    }

    var menuitem = doc.getElementById(vAPI.contextMenu.menuItemId);
    var currentURI = gContextMenu.browser.currentURI;

    // https://github.com/chrisaljoudi/uBlock/issues/105
    // TODO: Should the element picker works on any kind of pages?
    if ( !currentURI.schemeIs('http') && !currentURI.schemeIs('https') ) {
        menuitem.hidden = true;
        return;
    }

    var ctx = vAPI.contextMenu.contexts;

    if ( !ctx ) {
        menuitem.hidden = false;
        return;
    }

    var ctxMap = vAPI.contextMenu.contextMap;

    for ( var context of ctx ) {
        if (
            context === 'page' &&
            !gContextMenu.onLink &&
            !gContextMenu.onImage &&
            !gContextMenu.onEditableArea &&
            !gContextMenu.inFrame &&
            !gContextMenu.onVideo &&
            !gContextMenu.onAudio
        ) {
            menuitem.hidden = false;
            return;
        }

        if ( gContextMenu[ctxMap[context]] ) {
            menuitem.hidden = false;
            return;
        }
    }

    menuitem.hidden = true;
};

/******************************************************************************/

vAPI.contextMenu.register = function(doc) {
    if ( !this.menuItemId ) {
        return;
    }

    var contextMenu = doc.getElementById('contentAreaContextMenu');
    var menuitem = doc.createElement('menuitem');
    menuitem.setAttribute('id', this.menuItemId);
    menuitem.setAttribute('label', this.menuLabel);
    menuitem.setAttribute('image', vAPI.getURL('img/browsericons/icon19-19.png'));
    menuitem.setAttribute('class', 'menuitem-iconic');
    menuitem.addEventListener('command', this.onCommand);
    contextMenu.addEventListener('popupshowing', this.displayMenuItem);
    contextMenu.insertBefore(menuitem, doc.getElementById('inspect-separator'));
};

/******************************************************************************/

vAPI.contextMenu.unregister = function(doc) {
    if ( !this.menuItemId ) {
        return;
    }

    var menuitem = doc.getElementById(this.menuItemId);
    if ( menuitem === null ) {
        return;
    }
    var contextMenu = menuitem.parentNode;
    menuitem.removeEventListener('command', this.onCommand);
    contextMenu.removeEventListener('popupshowing', this.displayMenuItem);
    contextMenu.removeChild(menuitem);
};

/******************************************************************************/

vAPI.contextMenu.create = function(details, callback) {
    this.menuItemId = details.id;
    this.menuLabel = details.title;
    this.contexts = details.contexts;

    if ( Array.isArray(this.contexts) && this.contexts.length ) {
        this.contexts = this.contexts.indexOf('all') === -1 ? this.contexts : null;
    } else {
        // default in Chrome
        this.contexts = ['page'];
    }

    this.onCommand = function() {
        var gContextMenu = getOwnerWindow(this).gContextMenu;
        var details = {
            menuItemId: this.id
        };

        if ( gContextMenu.inFrame ) {
            details.tagName = 'iframe';
            // Probably won't work with e10s
            details.frameUrl = gContextMenu.focusedWindow.location.href;
        } else if ( gContextMenu.onImage ) {
            details.tagName = 'img';
            details.srcUrl = gContextMenu.mediaURL;
        } else if ( gContextMenu.onAudio ) {
            details.tagName = 'audio';
            details.srcUrl = gContextMenu.mediaURL;
        } else if ( gContextMenu.onVideo ) {
            details.tagName = 'video';
            details.srcUrl = gContextMenu.mediaURL;
        } else if ( gContextMenu.onLink ) {
            details.tagName = 'a';
            details.linkUrl = gContextMenu.linkURL;
        }

        callback(details, {
            id: tabWatcher.tabIdFromTarget(gContextMenu.browser),
            url: gContextMenu.browser.currentURI.asciiSpec
        });
    };

    for ( var win of vAPI.tabs.getWindows() ) {
        this.register(win.document);
    }
};

/******************************************************************************/

vAPI.contextMenu.remove = function() {
    for ( var win of vAPI.tabs.getWindows() ) {
        this.unregister(win.document);
    }

    this.menuItemId = null;
    this.menuLabel = null;
    this.contexts = null;
    this.onCommand = null;
};

/******************************************************************************/
/******************************************************************************/

var optionsObserver = {
    addonId: 'uMatrix@raymondhill.net',

    register: function() {
        Services.obs.addObserver(this, 'addon-options-displayed', false);
        cleanupTasks.push(this.unregister.bind(this));

        var browser = tabWatcher.currentBrowser();
        if ( browser && browser.currentURI && browser.currentURI.spec === 'about:addons' ) {
            this.observe(browser.contentDocument, 'addon-enabled', this.addonId);
        }
    },

    unregister: function() {
        Services.obs.removeObserver(this, 'addon-options-displayed');
    },

    setupOptionsButton: function(doc, id, page) {
        var button = doc.getElementById(id);
        if ( button === null ) {
            return;
        }
        button.addEventListener('command', function() {
            vAPI.tabs.open({ url: page, index: -1 });
        });
        button.label = vAPI.i18n(id);
    },

    observe: function(doc, topic, addonId) {
        if ( addonId !== this.addonId ) {
            return;
        }

        this.setupOptionsButton(doc, 'showDashboardButton', 'dashboard.html');
        this.setupOptionsButton(doc, 'showLoggerButton', 'logger-ui.html');
    }
};

optionsObserver.register();

/******************************************************************************/
/******************************************************************************/

vAPI.lastError = function() {
    return null;
};

/******************************************************************************/
/******************************************************************************/

// This is called only once, when everything has been loaded in memory after
// the extension was launched. It can be used to inject content scripts
// in already opened web pages, to remove whatever nuisance could make it to
// the web pages before uBlock was ready.

vAPI.onLoadAllCompleted = function() {
    for ( var browser of tabWatcher.browsers() ) {
        browser.messageManager.sendAsyncMessage(
            location.host + '-load-completed'
        );
    }
};

/******************************************************************************/
/******************************************************************************/

// Likelihood is that we do not have to punycode: given punycode overhead,
// it's faster to check and skip than do it unconditionally all the time.

var punycodeHostname = punycode.toASCII;
var isNotASCII = /[^\x21-\x7F]/;

vAPI.punycodeHostname = function(hostname) {
    return isNotASCII.test(hostname) ? punycodeHostname(hostname) : hostname;
};

vAPI.punycodeURL = function(url) {
    if ( isNotASCII.test(url) ) {
        return Services.io.newURI(url, null, null).asciiSpec;
    }
    return url;
};

/******************************************************************************/
/******************************************************************************/

vAPI.cloud = (function() {
    var extensionBranchPath = 'extensions.' + location.host;
    var cloudBranchPath = extensionBranchPath + '.cloudStorage';

    // https://github.com/gorhill/uBlock/issues/80#issuecomment-132081658
    //   We must use get/setComplexValue in order to properly handle strings
    //   with unicode characters.
    var iss = Ci.nsISupportsString;
    var argstr = Components.classes['@mozilla.org/supports-string;1']
                           .createInstance(iss);

    var options = {
        defaultDeviceName: '',
        deviceName: ''
    };

    // User-supplied device name.
    try {
        options.deviceName = Services.prefs
                                     .getBranch(extensionBranchPath + '.')
                                     .getComplexValue('deviceName', iss)
                                     .data;
    } catch(ex) {
    }

    var getDefaultDeviceName = function() {
        var name = '';
        try {
            name = Services.prefs
                           .getBranch('services.sync.client.')
                           .getComplexValue('name', iss)
                           .data;
        } catch(ex) {
        }

        return name || window.navigator.platform || window.navigator.oscpu;
    };

    var start = function(dataKeys) {
        var extensionBranch = Services.prefs.getBranch(extensionBranchPath + '.');
        var syncBranch = Services.prefs.getBranch('services.sync.prefs.sync.');

        // Mark config entries as syncable
        argstr.data = '';
        var dataKey;
        for ( var i = 0; i < dataKeys.length; i++ ) {
            dataKey = dataKeys[i];
            if ( extensionBranch.prefHasUserValue('cloudStorage.' + dataKey) === false ) {
                extensionBranch.setComplexValue('cloudStorage.' + dataKey, iss, argstr);
            }
            syncBranch.setBoolPref(cloudBranchPath + '.' + dataKey, true);
        }
    };

    var push = function(datakey, data, callback) {
        var branch = Services.prefs.getBranch(cloudBranchPath + '.');
        var bin = {
            'source': options.deviceName || getDefaultDeviceName(),
            'tstamp': Date.now(),
            'data': data,
            'size': 0
        };
        bin.size = JSON.stringify(bin).length;
        argstr.data = JSON.stringify(bin);
        branch.setComplexValue(datakey, iss, argstr);
        if ( typeof callback === 'function' ) {
            callback();
        }
    };

    var pull = function(datakey, callback) {
        var result = null;
        var branch = Services.prefs.getBranch(cloudBranchPath + '.');
        try {
            var json = branch.getComplexValue(datakey, iss).data;
            if ( typeof json === 'string' ) {
                result = JSON.parse(json);
            }
        } catch(ex) {
        }
        callback(result);
    };

    var getOptions = function(callback) {
        if ( typeof callback !== 'function' ) {
            return;
        }
        options.defaultDeviceName = getDefaultDeviceName();
        callback(options);
    };

    var setOptions = function(details, callback) {
        if ( typeof details !== 'object' || details === null ) {
            return;
        }

        var branch = Services.prefs.getBranch(extensionBranchPath + '.');

        if ( typeof details.deviceName === 'string' ) {
            argstr.data = details.deviceName;
            branch.setComplexValue('deviceName', iss, argstr);
            options.deviceName = details.deviceName;
        }

        getOptions(callback);
    };

    return {
        start: start,
        push: push,
        pull: pull,
        getOptions: getOptions,
        setOptions: setOptions
    };
})();

/******************************************************************************/
/******************************************************************************/

vAPI.browserData = {};

/******************************************************************************/

// https://developer.mozilla.org/en-US/docs/HTTP_Cache

vAPI.browserData.clearCache = function(callback) {
    // PURGE_DISK_DATA_ONLY:1
    // PURGE_DISK_ALL:2
    // PURGE_EVERYTHING:3
    // However I verified that not argument does clear the cache data.
    Services.cache2.clear();
    if ( typeof callback === 'function' ) {
        callback();
    }
};

/******************************************************************************/

vAPI.browserData.clearOrigin = function(/* domain */) {
    // TODO
};

/******************************************************************************/
/******************************************************************************/

// https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Reference/Interface/nsICookieManager2
// https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Reference/Interface/nsICookie2
// https://developer.mozilla.org/en-US/docs/Observer_Notifications#Cookies

vAPI.cookies = {};

/******************************************************************************/

vAPI.cookies.CookieEntry = function(ffCookie) {
    this.domain = ffCookie.host;
    this.name = ffCookie.name;
    this.path = ffCookie.path;
    this.secure = ffCookie.isSecure === true;
    this.session = ffCookie.expires === 0;
    this.value = ffCookie.value;
};

/******************************************************************************/

vAPI.cookies.start = function() {
    Services.obs.addObserver(this, 'cookie-changed', false);
    Services.obs.addObserver(this, 'private-cookie-changed', false);
    cleanupTasks.push(this.stop.bind(this));
};

/******************************************************************************/

vAPI.cookies.stop = function() {
    Services.obs.removeObserver(this, 'cookie-changed');
    Services.obs.removeObserver(this, 'private-cookie-changed');
};

/******************************************************************************/

vAPI.cookies.observe = function(subject, topic, reason) {
    //if ( topic !== 'cookie-changed' && topic !== 'private-cookie-changed' ) {
    //    return;
    //}
    if ( reason === 'deleted' || subject instanceof Ci.nsICookie2 === false ) {
        return;
    }
    if ( typeof this.onChanged === 'function' ) {
        this.onChanged(new this.CookieEntry(subject));
    }
};

/******************************************************************************/

// Meant and expected to be asynchronous.

vAPI.cookies.getAll = function(callback) {
    if ( typeof callback !== 'function' ) {
        return;
    }
    var onAsync = function() {
        var out = [];
        var enumerator = Services.cookies.enumerator;
        var ffcookie;
        while ( enumerator.hasMoreElements() ) {
            ffcookie = enumerator.getNext();
            if ( ffcookie instanceof Ci.nsICookie ) {
                out.push(new this.CookieEntry(ffcookie));
            }
        }
        callback(out);
    };
    vAPI.setTimeout(onAsync.bind(this), 0);
};

/******************************************************************************/

vAPI.cookies.remove = function(details, callback) {
    var uri = Services.io.newURI(details.url, null, null);
    var cookies = Services.cookies;
    cookies.remove(uri.asciiHost, details.name, uri.path, false);
    cookies.remove( '.' + uri.asciiHost, details.name, uri.path, false);
    if ( typeof callback === 'function' ) {
        callback({
            domain: uri.asciiHost,
            name: details.name,
            path: uri.path
        });
    }
};

/******************************************************************************/
/******************************************************************************/

})();

/******************************************************************************/
