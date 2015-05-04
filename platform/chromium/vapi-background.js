/*******************************************************************************

    µMatrix - a browser extension to block requests.
    Copyright (C) 2014 The uBlock authors

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

    Home: https://github.com/gorhill/uBlock
*/

/* global self, µMatrix */

// For background page

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

var vAPI = self.vAPI = self.vAPI || {};

var chrome = self.chrome;
var manifest = chrome.runtime.getManifest();

vAPI.chrome = true;

var noopFunc = function(){};

/******************************************************************************/

vAPI.app = {
    name: manifest.name,
    version: manifest.version
};

/******************************************************************************/

vAPI.app.start = function() {
    // rhill 2013-12-07:
    // Relinquish control over javascript execution to the user.
    //   https://github.com/gorhill/httpswitchboard/issues/74
    //chrome.contentSettings.javascript.clear({});
};

/******************************************************************************/

vAPI.app.stop = function() {
    chrome.contentSettings.javascript.clear({});

    // rhill 2013-12-07:
    // Tell Chromium to allow all javascript: µMatrix will control whether
    // javascript execute through `Content-Policy-Directive` and webRequest.
    //   https://github.com/gorhill/httpswitchboard/issues/74
    //chrome.contentSettings.javascript.set({
    //    primaryPattern: 'https://*/*',
    //    setting: 'allow'
    //});
    //chrome.contentSettings.javascript.set({
    //    primaryPattern: 'http://*/*',
    //    setting: 'allow'
    //});
};

/******************************************************************************/

vAPI.app.restart = function() {
    chrome.runtime.reload();
};

/******************************************************************************/

// chrome.storage.local.get(null, function(bin){ console.debug('%o', bin); });

vAPI.storage = chrome.storage.local;

/******************************************************************************/

vAPI.tabs = {};

/******************************************************************************/

vAPI.isBehindTheSceneTabId = function(tabId) {
    return tabId.toString() === '-1';
};

vAPI.noTabId = '-1';

/******************************************************************************/

vAPI.tabs.registerListeners = function() {
    var onNavigationClient = this.onNavigation || noopFunc;
    var onPopupClient = this.onPopup || noopFunc;
    var onUpdatedClient = this.onUpdated || noopFunc;
    var onClosedClient = this.onClosed || noopFunc;

    // https://developer.chrome.com/extensions/webNavigation
    // [onCreatedNavigationTarget ->]
    //  onBeforeNavigate ->
    //  onCommitted ->
    //  onDOMContentLoaded ->
    //  onCompleted

    var popupCandidates = Object.create(null);

    var PopupCandidate = function(details) {
        this.targetTabId = details.tabId;
        this.openerTabId = details.sourceTabId;
        this.targetURL = details.url;
        this.selfDestructionTimer = null;
    };

    PopupCandidate.prototype.selfDestruct = function() {
        if ( this.selfDestructionTimer !== null ) {
            clearTimeout(this.selfDestructionTimer);
        }
        delete popupCandidates[this.targetTabId];
    };

    PopupCandidate.prototype.launchSelfDestruction = function() {
        if ( this.selfDestructionTimer !== null ) {
            clearTimeout(this.selfDestructionTimer);
        }
        this.selfDestructionTimer = setTimeout(this.selfDestruct.bind(this), 10000);
    };

    var popupCandidateCreate = function(details) {
        var popup = popupCandidates[details.tabId];
        // This really should not happen...
        if ( popup !== undefined ) {
            return;
        }
        popup = popupCandidates[details.tabId] = new PopupCandidate(details);
        return popup;
    };

    var popupCandidateTest = function(details) {
        var popup = popupCandidates[details.tabId];
        if ( popup === undefined ) {
            return;
        }
        popup.targetURL = details.url;
        if ( onPopupClient(popup) !== true ) {
            return;
        }
        popup.selfDestruct();
        return true;
    };

    var popupCandidateDestroy = function(details) {
        var popup = popupCandidates[details.tabId];
        if ( popup instanceof PopupCandidate ) {
            popup.launchSelfDestruction();
        }
    };

    // The chrome.webRequest.onBeforeRequest() won't be called for everything
    // else than `http`/`https`. Thus, in such case, we will bind the tab as
    // early as possible in order to increase the likelihood of a context
    // properly setup if network requests are fired from within the tab.
    // Example: Chromium + case #6 at
    //          http://raymondhill.net/ublock/popup.html
    var reGoodForWebRequestAPI = /^https?:\/\//;

    var onCreatedNavigationTarget = function(details) {
        details.tabId = details.tabId.toString();
        //console.debug('onCreatedNavigationTarget: popup candidate tab id %d = "%s"', details.tabId, details.url);
        if ( reGoodForWebRequestAPI.test(details.url) === false ) {
            details.frameId = 0;
            onNavigationClient(details);
        }
        popupCandidateCreate(details);
        popupCandidateTest(details);
    };

    var onBeforeNavigate = function(details) {
        if ( details.frameId !== 0 ) {
            return;
        }
        //console.debug('onBeforeNavigate: popup candidate tab id %d = "%s"', details.tabId, details.url);
        details.tabId = details.tabId.toString();
        popupCandidateTest(details);
    };

    var onUpdated = function(tabId, changeInfo, tab) {
        tabId = tabId.toString();
        if ( changeInfo.url && popupCandidateTest({ tabId: tabId, url: changeInfo.url }) ) {
            return;
        }
        onUpdatedClient(tabId, changeInfo, tab);
    };

    var onCommitted = function(details) {
        if ( details.frameId !== 0 ) {
            return;
        }
        details.tabId = details.tabId.toString();
        onNavigationClient(details);
        //console.debug('onCommitted: popup candidate tab id %d = "%s"', details.tabId, details.url);
        if ( popupCandidateTest(details) === true ) {
            return;
        }
        popupCandidateDestroy(details);
    };

    var onClosed = function(tabId) {
        onClosedClient(tabId.toString());
    };

    chrome.webNavigation.onCreatedNavigationTarget.addListener(onCreatedNavigationTarget);
    chrome.webNavigation.onBeforeNavigate.addListener(onBeforeNavigate);
    chrome.webNavigation.onCommitted.addListener(onCommitted);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onClosed);
};

/******************************************************************************/

// tabId: null, // active tab

vAPI.tabs.get = function(tabId, callback) {
    var onTabReady = function(tab) {
        // https://code.google.com/p/chromium/issues/detail?id=410868#c8
        if ( chrome.runtime.lastError ) {
        }
        if ( tab instanceof Object ) {
            tab.id = tab.id.toString();
        }
        callback(tab);
    };
    if ( tabId !== null ) {
        if ( typeof tabId === 'string' ) {
            tabId = parseInt(tabId, 10);
        }
        chrome.tabs.get(tabId, onTabReady);
        return;
    }
    var onTabReceived = function(tabs) {
        // https://code.google.com/p/chromium/issues/detail?id=410868#c8
        if ( chrome.runtime.lastError ) {
        }
        var tab = null;
        if ( Array.isArray(tabs) && tabs.length !== 0 ) {
            tab = tabs[0];
            tab.id = tab.id.toString();
        }
        callback(tab);
    };
    chrome.tabs.query({ active: true, currentWindow: true }, onTabReceived);
};

/******************************************************************************/

vAPI.tabs.getAll = function(callback) {
    var onTabsReady = function(tabs) {
        if ( Array.isArray(tabs) ) {
            var i = tabs.length;
            while ( i-- ) {
                tabs[i].id = tabs[i].id.toString();
            }
        }
        callback(tabs);
    };
    chrome.tabs.query({ url: '<all_urls>' }, onTabsReady);
};

/******************************************************************************/

// properties of the details object:
//   url: 'URL', // the address that will be opened
//   tabId: 1, // the tab is used if set, instead of creating a new one
//   index: -1, // undefined: end of the list, -1: following tab, or after index
//   active: false, // opens the tab in background - true and undefined: foreground
//   select: true // if a tab is already opened with that url, then select it instead of opening a new one

vAPI.tabs.open = function(details) {
    var targetURL = details.url;
    if ( typeof targetURL !== 'string' || targetURL === '' ) {
        return null;
    }
    // extension pages
    if ( /^[\w-]{2,}:/.test(targetURL) !== true ) {
        targetURL = vAPI.getURL(targetURL);
    }

    // dealing with Chrome's asynchronous API
    var wrapper = function() {
        if ( details.active === undefined ) {
            details.active = true;
        }

        var subWrapper = function() {
            var _details = {
                url: targetURL,
                active: !!details.active
            };

            // Opening a tab from incognito window won't focus the window
            // in which the tab was opened
            var focusWindow = function(tab) {
                if ( tab.active ) {
                    chrome.windows.update(tab.windowId, { focused: true });
                }
            };

            if ( !details.tabId ) {
                if ( details.index !== undefined ) {
                    _details.index = details.index;
                }

                chrome.tabs.create(_details, focusWindow);
                return;
            }

            // update doesn't accept index, must use move
            chrome.tabs.update(parseInt(details.tabId, 10), _details, function(tab) {
                // if the tab doesn't exist
                if ( vAPI.lastError() ) {
                    chrome.tabs.create(_details, focusWindow);
                } else if ( details.index !== undefined ) {
                    chrome.tabs.move(tab.id, {index: details.index});
                }
            });
        };

        if ( details.index !== -1 ) {
            subWrapper();
            return;
        }

        vAPI.tabs.get(null, function(tab) {
            if ( tab ) {
                details.index = tab.index + 1;
            } else {
                delete details.index;
            }

            subWrapper();
        });
    };

    if ( !details.select ) {
        wrapper();
        return;
    }

    chrome.tabs.query({ url: targetURL }, function(tabs) {
        var tab = tabs[0];
        if ( tab ) {
            chrome.tabs.update(tab.id, { active: true }, function(tab) {
                chrome.windows.update(tab.windowId, { focused: true });
            });
        } else {
            wrapper();
        }
    });
};

/******************************************************************************/

// Replace the URL of a tab. Noop if the tab does not exist.

vAPI.tabs.replace = function(tabId, url) {
    var targetURL = url;

    // extension pages
    if ( /^[\w-]{2,}:/.test(targetURL) !== true ) {
        targetURL = vAPI.getURL(targetURL);
    }

    if ( typeof tabId !== 'number' ) {
        tabId = parseInt(tabId, 10);
        if ( isNaN(tabId) ) {
            return;
        }
    }

    chrome.tabs.update(tabId, { url: targetURL }, function() {
        // this prevent console error
        if ( chrome.runtime.lastError ) {
            return;
        }
    });
};

/******************************************************************************/

vAPI.tabs.remove = function(tabId) {
    var onTabRemoved = function() {
        if ( vAPI.lastError() ) {
        }
    };
    chrome.tabs.remove(parseInt(tabId, 10), onTabRemoved);
};

/******************************************************************************/

vAPI.tabs.reload = function(tabId /*, flags*/) {
    if ( typeof tabId === 'string' ) {
        tabId = parseInt(tabId, 10);
    }
    if ( isNaN(tabId) ) {
        return;
    }
    chrome.tabs.reload(tabId);
};

/******************************************************************************/

vAPI.tabs.injectScript = function(tabId, details, callback) {
    var onScriptExecuted = function() {
        // https://code.google.com/p/chromium/issues/detail?id=410868#c8
        if ( chrome.runtime.lastError ) {
        }
        if ( typeof callback === 'function' ) {
            callback();
        }
    };
    if ( tabId ) {
        tabId = parseInt(tabId, 10);
        chrome.tabs.executeScript(tabId, details, onScriptExecuted);
    } else {
        chrome.tabs.executeScript(details, onScriptExecuted);
    }
};

/******************************************************************************/

// Must read: https://code.google.com/p/chromium/issues/detail?id=410868#c8

// https://github.com/chrisaljoudi/uBlock/issues/19
// https://github.com/chrisaljoudi/uBlock/issues/207
// Since we may be called asynchronously, the tab id may not exist
// anymore, so this ensures it does still exist.

vAPI.setIcon = function(tabId, iconId, badge) {
    tabId = parseInt(tabId, 10);
    if ( isNaN(tabId) || tabId <= 0 ) {
        return;
    }
    var onIconReady = function() {
        if ( vAPI.lastError() ) {
            return;
        }
        chrome.browserAction.setBadgeText({ tabId: tabId, text: badge });
        if ( badge !== '' ) {
            chrome.browserAction.setBadgeBackgroundColor({
                tabId: tabId,
                color: '#000'
            });
        }
    };

    var iconSelector = typeof iconId === 'number' ? iconId : 'off';
    var iconPaths = {
        '19': 'img/browsericons/icon19-' + iconSelector + '.png'/* ,
        '38': 'img/browsericons/icon38-' + iconSelector + '.png' */
    };

    chrome.browserAction.setIcon({ tabId: tabId, path: iconPaths }, onIconReady);
};

/******************************************************************************/
/******************************************************************************/

vAPI.messaging = {
    ports: {},
    listeners: {},
    defaultHandler: null,
    NOOPFUNC: noopFunc,
    UNHANDLED: 'vAPI.messaging.notHandled'
};

/******************************************************************************/

vAPI.messaging.listen = function(listenerName, callback) {
    this.listeners[listenerName] = callback;
};

/******************************************************************************/

vAPI.messaging.onPortMessage = function(request, port) {
    var callback = vAPI.messaging.NOOPFUNC;
    if ( request.requestId !== undefined ) {
        callback = CallbackWrapper.factory(port, request).callback;
    }

    // Specific handler
    var r = vAPI.messaging.UNHANDLED;
    var listener = vAPI.messaging.listeners[request.channelName];
    if ( typeof listener === 'function' ) {
        r = listener(request.msg, port.sender, callback);
    }
    if ( r !== vAPI.messaging.UNHANDLED ) {
        return;
    }

    // Default handler
    r = vAPI.messaging.defaultHandler(request.msg, port.sender, callback);
    if ( r !== vAPI.messaging.UNHANDLED ) {
        return;
    }

    console.error('µMatrix> messaging > unknown request: %o', request);

    // Unhandled:
    // Need to callback anyways in case caller expected an answer, or
    // else there is a memory leak on caller's side
    callback();
};

/******************************************************************************/

vAPI.messaging.onPortDisconnect = function(port) {
    port.onDisconnect.removeListener(vAPI.messaging.onPortDisconnect);
    port.onMessage.removeListener(vAPI.messaging.onPortMessage);
    delete vAPI.messaging.ports[port.name];
};

/******************************************************************************/

vAPI.messaging.onPortConnect = function(port) {
    port.onDisconnect.addListener(vAPI.messaging.onPortDisconnect);
    port.onMessage.addListener(vAPI.messaging.onPortMessage);
    vAPI.messaging.ports[port.name] = port;
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

    chrome.runtime.onConnect.addListener(this.onPortConnect);
};

/******************************************************************************/

vAPI.messaging.broadcast = function(message) {
    var messageWrapper = {
        broadcast: true,
        msg: message
    };

    for ( var portName in this.ports ) {
        if ( this.ports.hasOwnProperty(portName) === false ) {
            continue;
        }
        this.ports[portName].postMessage(messageWrapper);
    }
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

var CallbackWrapper = function(port, request) {
    // No need to bind every single time
    this.callback = this.proxy.bind(this);
    this.messaging = vAPI.messaging;
    this.init(port, request);
};

CallbackWrapper.junkyard = [];

CallbackWrapper.factory = function(port, request) {
    var wrapper = CallbackWrapper.junkyard.pop();
    if ( wrapper ) {
        wrapper.init(port, request);
        return wrapper;
    }
    return new CallbackWrapper(port, request);
};

CallbackWrapper.prototype.init = function(port, request) {
    this.port = port;
    this.request = request;
};

CallbackWrapper.prototype.proxy = function(response) {
    // https://github.com/chrisaljoudi/uBlock/issues/383
    if ( this.messaging.ports.hasOwnProperty(this.port.name) ) {
        this.port.postMessage({
            requestId: this.request.requestId,
            channelName: this.request.channelName,
            msg: response !== undefined ? response : null
        });
    }
    // Mark for reuse
    this.port = this.request = null;
    CallbackWrapper.junkyard.push(this);
};

/******************************************************************************/
/******************************************************************************/

vAPI.net = {};

/******************************************************************************/

vAPI.net.registerListeners = function() {
    var µm = µMatrix;
    var µmuri = µm.URI;
    var httpRequestHeadersJunkyard = [];

    // Abstraction layer to deal with request headers
    // >>>>>>>>
    var httpRequestHeadersFactory = function(headers) {
        var entry = httpRequestHeadersJunkyard.pop();
        if ( entry ) {
            return entry.init(headers);
        }
        return new HTTPRequestHeaders(headers);
    };

    var HTTPRequestHeaders = function(headers) {
        this.init(headers);
    };

    HTTPRequestHeaders.prototype.init = function(headers) {
        this.modified = false;
        this.headers = headers;
        return this;
    };

    HTTPRequestHeaders.prototype.dispose = function() {
        var r = this.modified ? this.headers : null;
        this.headers = null;
        httpRequestHeadersJunkyard.push(this);
        return r;
    };

    HTTPRequestHeaders.prototype.getHeader = function(target) {
        var headers = this.headers;
        var header, name;
        var i = headers.length;
        while ( i-- ) {
            header = headers[i];
            name = header.name.toLowerCase();
            if ( name === target ) {
                return header.value;
            }
        }
        return '';
    };

    HTTPRequestHeaders.prototype.setHeader = function(target, value, create) {
        var headers = this.headers;
        var header, name;
        var i = headers.length;
        while ( i-- ) {
            header = headers[i];
            name = header.name.toLowerCase();
            if ( name === target ) {
                break;
            }
        }
        if ( i < 0 && !create ) {       // Header not found, don't add it
            return false;
        }
        if ( i < 0 ) {                  // Header not found, add it
            headers.push({ name: target, value: value });
        } else if ( value === '' ) {    // Header found, remove it
            headers.splice(i, 1);
        } else {                        // Header found, modify it
            header.value = value;
        }
        this.modified = true;
        return true;
    };
    // <<<<<<<<
    // End of: Abstraction layer to deal with request headers


    // Normalizing request types
    // >>>>>>>>
    var normalizeRequestDetails = function(details) {
        µmuri.set(details.url);

        details.tabId = details.tabId.toString();
        details.hostname = µmuri.hostnameFromURI(details.url);

        // The rest of the function code is to normalize request type
        if ( details.type !== 'other' ) {
            return;
        }

        if ( details.requestHeaders instanceof HTTPRequestHeaders ) {
            if ( details.requestHeaders.getHeader('ping-to') !== '' ) {
                details.type = 'ping';
                return;
            }
        }

        var tail = µmuri.path.slice(-6);
        var pos = tail.lastIndexOf('.');

        // https://github.com/chrisaljoudi/uBlock/issues/862
        // If no transposition possible, transpose to `object` as per
        // Chromium bug 410382 (see below)
        if ( pos === -1 ) {
            return;
        }

        var ext = tail.slice(pos) + '.';
        if ( '.eot.ttf.otf.svg.woff.woff2.'.indexOf(ext) !== -1 ) {
            details.type = 'font';
            return;
        }
        // Still need this because often behind-the-scene requests are wrongly
        // categorized as 'other'
        if ( '.ico.png.gif.jpg.jpeg.webp.'.indexOf(ext) !== -1 ) {
            details.type = 'image';
            return;
        }
    };
    // <<<<<<<<
    // End of: Normalizing request types


    // Network event handlers
    // >>>>>>>>
    var onBeforeRequestClient = this.onBeforeRequest.callback;
    var onBeforeRequest = function(details) {
        normalizeRequestDetails(details);
        return onBeforeRequestClient(details);
    };
    chrome.webRequest.onBeforeRequest.addListener(
        onBeforeRequest,
        //function(details) {
        //    quickProfiler.start('onBeforeRequest');
        //    var r = onBeforeRequest(details);
        //    quickProfiler.stop();
        //    return r;
        //},
        {
            'urls': this.onBeforeRequest.urls || ['<all_urls>'],
            'types': this.onBeforeRequest.types || []
        },
        this.onBeforeRequest.extra
    );

    var onBeforeSendHeadersClient = this.onBeforeSendHeaders.callback;
    var onBeforeSendHeaders = function(details) {
        details.requestHeaders = httpRequestHeadersFactory(details.requestHeaders);
        normalizeRequestDetails(details);
        var result = onBeforeSendHeadersClient(details);
        if ( typeof result === 'object' ) {
            return result;
        }
        var modifiedHeaders = details.requestHeaders.dispose();
        if ( modifiedHeaders !== null ) {
            return { requestHeaders: modifiedHeaders };
        }
    };
    chrome.webRequest.onBeforeSendHeaders.addListener(
        onBeforeSendHeaders,
        {
            'urls': this.onBeforeSendHeaders.urls || ['<all_urls>'],
            'types': this.onBeforeSendHeaders.types || []
        },
        this.onBeforeSendHeaders.extra
    );

    var onHeadersReceivedClient = this.onHeadersReceived.callback;
    var onHeadersReceived = function(details) {
        normalizeRequestDetails(details);
        return onHeadersReceivedClient(details);
    };
    chrome.webRequest.onHeadersReceived.addListener(
        onHeadersReceived,
        {
            'urls': this.onHeadersReceived.urls || ['<all_urls>'],
            'types': this.onHeadersReceived.types || []
        },
        this.onHeadersReceived.extra
    );
    // <<<<<<<<
    // End of: Network event handlers
};

/******************************************************************************/
/******************************************************************************/

vAPI.contextMenu = {
    create: function(details, callback) {
        this.menuId = details.id;
        this.callback = callback;
        chrome.contextMenus.create(details);
        chrome.contextMenus.onClicked.addListener(this.callback);
    },
    remove: function() {
        chrome.contextMenus.onClicked.removeListener(this.callback);
        chrome.contextMenus.remove(this.menuId);
    }
};

/******************************************************************************/

vAPI.lastError = function() {
    return chrome.runtime.lastError;
};

/******************************************************************************/
/******************************************************************************/

// This is called only once, when everything has been loaded in memory after
// the extension was launched. It can be used to inject content scripts
// in already opened web pages, to remove whatever nuisance could make it to
// the web pages before uBlock was ready.

vAPI.onLoadAllCompleted = function() {
};

/******************************************************************************/
/******************************************************************************/

vAPI.punycodeHostname = function(hostname) {
    return hostname;
};

vAPI.punycodeURL = function(url) {
    return url;
};

/******************************************************************************/
/******************************************************************************/

vAPI.browserData = {};

/******************************************************************************/

// https://developer.chrome.com/extensions/browsingData

vAPI.browserData.clearCache = function(callback) {
    chrome.browsingData.removeCache({ since: 0 }, callback);
};

/******************************************************************************/

// Not supported on Chromium

vAPI.browserData.clearOrigin = function(domain, callback) {
    // unsupported on Chromium
    if ( typeof callback === 'function' ) {
        callback(undefined);
    }
};

/******************************************************************************/
/******************************************************************************/

// https://developer.chrome.com/extensions/cookies

vAPI.cookies = {};

/******************************************************************************/

vAPI.cookies.start = function() {
    var onChanged = function(changeInfo) {
        var handler = changeInfo.removed ? this.onRemoved : this.onChanged;
        if ( typeof handler !== 'function' ) {
            return;
        }
        handler(changeInfo.cookie);
    };
    chrome.cookies.onChanged.addListener(onChanged.bind(this));
};

/******************************************************************************/

vAPI.cookies.getAll = function(callback) {
    chrome.cookies.getAll({}, callback);
};

/******************************************************************************/

vAPI.cookies.remove = function(details, callback) {
    chrome.cookies.remove(details, callback || noopFunc);
};

/******************************************************************************/
/******************************************************************************/

})();

/******************************************************************************/
