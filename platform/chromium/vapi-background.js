/*******************************************************************************

    uMatrix - a browser extension to block requests.
    Copyright (C) 2014-2018 The uBlock Origin authors
    Copyright (C) 2017-present Raymond Hill

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

// For background page

'use strict';

/******************************************************************************/

(function() {

/******************************************************************************/

var vAPI = self.vAPI = self.vAPI || {};

var chrome = self.chrome;
var manifest = chrome.runtime.getManifest();

var noopFunc = function(){};

// https://code.google.com/p/chromium/issues/detail?id=410868#c8
var resetLastError = function() {
    void chrome.runtime.lastError;
};

/******************************************************************************/

// https://github.com/gorhill/uMatrix/issues/234
// https://developer.chrome.com/extensions/privacy#property-network
chrome.privacy.network.networkPredictionEnabled.set({ value: false });

/******************************************************************************/

vAPI.app = {
    name: manifest.name,
    version: manifest.version
};

/******************************************************************************/

vAPI.app.start = function() {
};

/******************************************************************************/

vAPI.app.stop = function() {
};

/******************************************************************************/

vAPI.app.restart = function() {
    chrome.runtime.reload();
};

/******************************************************************************/

// chrome.storage.local.get(null, function(bin){ console.debug('%o', bin); });

vAPI.storage = chrome.storage.local;
vAPI.cacheStorage = chrome.storage.local;

/******************************************************************************/

vAPI.tabs = {};

/******************************************************************************/

vAPI.isBehindTheSceneTabId = function(tabId) {
    if ( typeof tabId === 'string' ) { debugger; }
    return tabId < 0;
};

vAPI.unsetTabId = 0;
vAPI.noTabId = -1;      // definitely not any existing tab
vAPI.anyTabId = -2;     // one of the existing tab

/******************************************************************************/

vAPI.tabs.registerListeners = function() {
    var onNavigationClient = this.onNavigation || noopFunc;
    var onUpdatedClient = this.onUpdated || noopFunc;
    var onClosedClient = this.onClosed || noopFunc;

    // https://developer.chrome.com/extensions/webNavigation
    // [onCreatedNavigationTarget ->]
    //  onBeforeNavigate ->
    //  onCommitted ->
    //  onDOMContentLoaded ->
    //  onCompleted

    // The chrome.webRequest.onBeforeRequest() won't be called for everything
    // else than `http`/`https`. Thus, in such case, we will bind the tab as
    // early as possible in order to increase the likelihood of a context
    // properly setup if network requests are fired from within the tab.
    // Example: Chromium + case #6 at
    //          http://raymondhill.net/ublock/popup.html
    var reGoodForWebRequestAPI = /^https?:\/\//;

    var onCreatedNavigationTarget = function(details) {
        //console.debug('onCreatedNavigationTarget: tab id %d = "%s"', details.tabId, details.url);
        if ( reGoodForWebRequestAPI.test(details.url) ) { return; }
        onNavigationClient(details);
    };

    var onUpdated = function(tabId, changeInfo, tab) {
        onUpdatedClient(tabId, changeInfo, tab);
    };

    var onCommitted = function(details) {
        // Important: do not call client if not top frame.
        if ( details.frameId !== 0 ) {
            return;
        }
        onNavigationClient(details);
        //console.debug('onCommitted: tab id %d = "%s"', details.tabId, details.url);
    };

    var onClosed = function(tabId) {
        onClosedClient(tabId);
    };

    chrome.webNavigation.onCreatedNavigationTarget.addListener(onCreatedNavigationTarget);
    chrome.webNavigation.onCommitted.addListener(onCommitted);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onClosed);
};

/******************************************************************************/

// tabId: null, // active tab

vAPI.tabs.get = function(tabId, callback) {
    var onTabReady = function(tab) {
        resetLastError();
        callback(tab);
    };
    if ( tabId !== null ) {
        chrome.tabs.get(tabId, onTabReady);
        return;
    }
    var onTabReceived = function(tabs) {
        resetLastError();
        var tab = null;
        if ( Array.isArray(tabs) && tabs.length !== 0 ) {
            tab = tabs[0];
        }
        callback(tab);
    };
    chrome.tabs.query({ active: true, currentWindow: true }, onTabReceived);
};

/******************************************************************************/

// https://github.com/uBlockOrigin/uMatrix-issues/issues/9

vAPI.tabs.getAll = function(callback) {
    chrome.tabs.query({}, callback);
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
            chrome.tabs.update(details.tabId, _details, function(tab) {
                // if the tab doesn't exist
                if ( vAPI.lastError() ) {
                    chrome.tabs.create(_details, focusWindow);
                } else if ( details.index !== undefined ) {
                    chrome.tabs.move(tab.id, {index: details.index});
                }
            });
        };

        // Open in a standalone window
        if ( details.popup === true ) {
            chrome.windows.create({ url: details.url, type: 'popup' });
            return;
        }

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
        resetLastError();
        var tab = Array.isArray(tabs) && tabs[0];
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

    if ( typeof tabId !== 'number' || tabId < 0 ) { return; }

    chrome.tabs.update(tabId, { url: targetURL }, resetLastError);
};

/******************************************************************************/

vAPI.tabs.reload = function(tabId, bypassCache) {
    if ( typeof tabId !== 'number' || tabId < 0 ) { return; }
    chrome.tabs.reload(tabId, { bypassCache: bypassCache === true });
};

/******************************************************************************/

// Must read: https://code.google.com/p/chromium/issues/detail?id=410868#c8

// https://github.com/chrisaljoudi/uBlock/issues/19
// https://github.com/chrisaljoudi/uBlock/issues/207
// Since we may be called asynchronously, the tab id may not exist
// anymore, so this ensures it does still exist.

vAPI.setIcon = (function() {
    let onIconReady = function(tabId, badgeDetails) {
        if ( vAPI.lastError() ) { return; }
        if ( badgeDetails.text !== undefined ) {
            chrome.browserAction.setBadgeText({
                tabId: tabId,
                text: badgeDetails.text
            });
        }
        if ( badgeDetails.color !== undefined ) {
            chrome.browserAction.setBadgeBackgroundColor({
                tabId: tabId,
                color: badgeDetails.color
            });
        }
    };

    return function(tabId, iconDetails, badgeDetails) {
        if ( typeof tabId !== 'number' || tabId < 0 ) { return; }
        chrome.browserAction.setIcon(
            { tabId: tabId, path: iconDetails },
            function() { onIconReady(tabId, badgeDetails); }
        );
    };
})();

/******************************************************************************/
/******************************************************************************/

vAPI.messaging = {
    ports: new Map(),
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

vAPI.messaging.onPortMessage = (function() {
    var messaging = vAPI.messaging;

    // Use a wrapper to avoid closure and to allow reuse.
    var CallbackWrapper = function(port, request) {
        this.callback = this.proxy.bind(this); // bind once
        this.init(port, request);
    };

    CallbackWrapper.prototype = {
        init: function(port, request) {
            this.port = port;
            this.request = request;
            return this;
        },
        proxy: function(response) {
            // https://github.com/chrisaljoudi/uBlock/issues/383
            if ( messaging.ports.has(this.port.name) ) {
                this.port.postMessage({
                    auxProcessId: this.request.auxProcessId,
                    channelName: this.request.channelName,
                    msg: response !== undefined ? response : null
                });
            }
            // Mark for reuse
            this.port = this.request = null;
            callbackWrapperJunkyard.push(this);
        }
    };

    var callbackWrapperJunkyard = [];

    var callbackWrapperFactory = function(port, request) {
        var wrapper = callbackWrapperJunkyard.pop();
        if ( wrapper ) {
            return wrapper.init(port, request);
        }
        return new CallbackWrapper(port, request);
    };

    // https://bugzilla.mozilla.org/show_bug.cgi?id=1392067
    //   Workaround: manually remove ports matching removed tab.
    chrome.tabs.onRemoved.addListener(function(tabId) {
        for ( var port of messaging.ports.values() ) {
            var tab = port.sender && port.sender.tab;
            if ( !tab ) { continue; }
            if ( tab.id === tabId ) {
                vAPI.messaging.onPortDisconnect(port);
            }
        }
    });

    return function(request, port) {
        // prepare response
        var callback = this.NOOPFUNC;
        if ( request.auxProcessId !== undefined ) {
            callback = callbackWrapperFactory(port, request).callback;
        }

        // Auxiliary process to main process: specific handler
        var r = this.UNHANDLED,
            listener = this.listeners[request.channelName];
        if ( typeof listener === 'function' ) {
            r = listener(request.msg, port.sender, callback);
        }
        if ( r !== this.UNHANDLED ) { return; }

        // Auxiliary process to main process: default handler
        r = this.defaultHandler(request.msg, port.sender, callback);
        if ( r !== this.UNHANDLED ) { return; }

        // Auxiliary process to main process: no handler
        console.error(
            'vAPI.messaging.onPortMessage > unhandled request: %o',
            request
        );

        // Need to callback anyways in case caller expected an answer, or
        // else there is a memory leak on caller's side
        callback();
    }.bind(vAPI.messaging);
})();

/******************************************************************************/

vAPI.messaging.onPortDisconnect = function(port) {
    port.onDisconnect.removeListener(this.onPortDisconnect);
    port.onMessage.removeListener(this.onPortMessage);
    this.ports.delete(port.name);
}.bind(vAPI.messaging);

/******************************************************************************/

vAPI.messaging.onPortConnect = function(port) {
    port.onDisconnect.addListener(this.onPortDisconnect);
    port.onMessage.addListener(this.onPortMessage);
    this.ports.set(port.name, port);
}.bind(vAPI.messaging);

/******************************************************************************/

vAPI.messaging.setup = function(defaultHandler) {
    if ( this.defaultHandler !== null ) { return; }

    if ( typeof defaultHandler !== 'function' ) {
        defaultHandler = function(){
            return vAPI.messaging.UNHANDLED;
        };
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
    for ( var port of this.ports.values() ) {
        port.postMessage(messageWrapper);
    }
};

/******************************************************************************/
/******************************************************************************/

vAPI.net = {
    listenerMap: new WeakMap(),
    // legacy Chromium understands only these network request types.
    validTypes: (function() {
        let types = new Set([
            'main_frame',
            'sub_frame',
            'stylesheet',
            'script',
            'image',
            'object',
            'xmlhttprequest',
            'other'
        ]);
        let wrrt = browser.webRequest.ResourceType;
        if ( wrrt instanceof Object ) {
            for ( let typeKey in wrrt ) {
                if ( wrrt.hasOwnProperty(typeKey) ) {
                    types.add(wrrt[typeKey]);
                }
            }
        }
        return types;
    })(),
    denormalizeFilters: null,
    normalizeDetails: null,
    addListener: function(which, clientListener, filters, options) {
        if ( typeof this.denormalizeFilters === 'function' ) {
            filters = this.denormalizeFilters(filters);
        }
        let actualListener;
        if ( typeof this.normalizeDetails === 'function' ) {
            actualListener = function(details) {
                vAPI.net.normalizeDetails(details);
                return clientListener(details);
            };
            this.listenerMap.set(clientListener, actualListener);
        }
        browser.webRequest[which].addListener(
            actualListener || clientListener,
            filters,
            options
        );
    },
    removeListener: function(which, clientListener) {
        let actualListener = this.listenerMap.get(clientListener);
        if ( actualListener !== undefined ) {
            this.listenerMap.delete(clientListener);
        }
        browser.webRequest[which].removeListener(
            actualListener || clientListener
        );
    },
};

/******************************************************************************/
/******************************************************************************/

vAPI.lastError = function() {
    return chrome.runtime.lastError;
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
/******************************************************************************/

// https://developer.chrome.com/extensions/cookies

vAPI.cookies = {};

/******************************************************************************/

vAPI.cookies.start = function() {
    var reallyRemoved = {
        'evicted': true,
        'expired': true,
        'explicit': true
    };

    var onChanged = function(changeInfo) {
        if ( changeInfo.removed ) {
            if ( reallyRemoved[changeInfo.cause] && typeof this.onRemoved === 'function' ) {
                this.onRemoved(changeInfo.cookie);
            }
            return;
        }
        if ( typeof this.onChanged === 'function' ) {
            this.onChanged(changeInfo.cookie);
        }
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

vAPI.cloud = (function() {
    // Not all platforms support `chrome.storage.sync`.
    if ( chrome.storage.sync instanceof Object === false ) {
        return;
    }

    var chunkCountPerFetch = 16; // Must be a power of 2

    // Mind chrome.storage.sync.MAX_ITEMS (512 at time of writing)
    var maxChunkCountPerItem = Math.floor(512 * 0.75) & ~(chunkCountPerFetch - 1);

    // Mind chrome.storage.sync.QUOTA_BYTES_PER_ITEM (8192 at time of writing)
    // https://github.com/gorhill/uBlock/issues/3006
    //  For Firefox, we will use a lower ratio to allow for more overhead for
    //  the infrastructure. Unfortunately this leads to less usable space for
    //  actual data, but all of this is provided for free by browser vendors,
    //  so we need to accept and deal with these limitations.
    var evalMaxChunkSize = function() {
        return Math.floor(
            (chrome.storage.sync.QUOTA_BYTES_PER_ITEM || 8192) *
            (vAPI.webextFlavor.soup.has('firefox') ? 0.6 : 0.75)
        );
    };

    var maxChunkSize = evalMaxChunkSize();

    // The real actual webextFlavor value may not be set in stone, so listen
    // for possible future changes.
    window.addEventListener('webextFlavor', function() {
        maxChunkSize = evalMaxChunkSize();
    }, { once: true });

    // Mind chrome.storage.sync.QUOTA_BYTES (128 kB at time of writing)
    // Firefox:
    // https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/storage/sync
    // > You can store up to 100KB of data using this API/
    var maxStorageSize = chrome.storage.sync.QUOTA_BYTES || 102400;

    var options = {
        defaultDeviceName: window.navigator.platform,
        deviceName: vAPI.localStorage.getItem('deviceName') || ''
    };

    // This is used to find out a rough count of how many chunks exists:
    // We "poll" at specific index in order to get a rough idea of how
    // large is the stored string.
    // This allows reading a single item with only 2 sync operations -- a
    // good thing given chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_MINUTE
    // and chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_HOUR.

    var getCoarseChunkCount = function(dataKey, callback) {
        let bin = {};
        for ( let i = 0; i < maxChunkCountPerItem; i += 16 ) {
            bin[dataKey + i.toString()] = '';
        }

        chrome.storage.sync.get(bin, function(bin) {
            if ( chrome.runtime.lastError ) {
                callback(0, chrome.runtime.lastError.message);
                return;
            }

            var chunkCount = 0;
            for ( let i = 0; i < maxChunkCountPerItem; i += 16 ) {
                if ( bin[dataKey + i.toString()] === '' ) { break; }
                chunkCount = i + 16;
            }

            callback(chunkCount);
        });
    };

    var deleteChunks = function(dataKey, start) {
        var keys = [];

        // No point in deleting more than:
        // - The max number of chunks per item
        // - The max number of chunks per storage limit
        var n = Math.min(
            maxChunkCountPerItem,
            Math.ceil(maxStorageSize / maxChunkSize)
        );
        for ( var i = start; i < n; i++ ) {
            keys.push(dataKey + i.toString());
        }
        chrome.storage.sync.remove(keys);
    };

    var start = function(/* dataKeys */) {
    };

    var push = function(dataKey, data, callback) {

        var bin = {
            'source': options.deviceName || options.defaultDeviceName,
            'tstamp': Date.now(),
            'data': data,
            'size': 0
        };
        bin.size = JSON.stringify(bin).length;
        var item = JSON.stringify(bin);

        // Chunkify taking into account QUOTA_BYTES_PER_ITEM:
        //   https://developer.chrome.com/extensions/storage#property-sync
        //   "The maximum size (in bytes) of each individual item in sync
        //   "storage, as measured by the JSON stringification of its value
        //   "plus its key length."
        bin = {};
        var chunkCount = Math.ceil(item.length / maxChunkSize);
        for ( var i = 0; i < chunkCount; i++ ) {
            bin[dataKey + i.toString()] = item.substr(i * maxChunkSize, maxChunkSize);
        }
        bin[dataKey + i.toString()] = ''; // Sentinel

        chrome.storage.sync.set(bin, function() {
            var errorStr;
            if ( chrome.runtime.lastError ) {
                errorStr = chrome.runtime.lastError.message;
                // https://github.com/gorhill/uBlock/issues/3006#issuecomment-332597677
                // - Delete all that was pushed in case of failure.
                chunkCount = 0;
            }
            callback(errorStr);

            // Remove potentially unused trailing chunks
            deleteChunks(dataKey, chunkCount);
        });
    };

    var pull = function(dataKey, callback) {

        var assembleChunks = function(bin) {
            if ( chrome.runtime.lastError ) {
                callback(null, chrome.runtime.lastError.message);
                return;
            }

            // Assemble chunks into a single string.
            let json = [], jsonSlice;
            let i = 0;
            for (;;) {
                jsonSlice = bin[dataKey + i.toString()];
                if ( jsonSlice === '' || jsonSlice === undefined ) { break; }
                json.push(jsonSlice);
                i += 1;
            }

            let entry = null;
            try {
                entry = JSON.parse(json.join(''));
            } catch(ex) {
            }
            callback(entry);
        };

        var fetchChunks = function(coarseCount, errorStr) {
            if ( coarseCount === 0 || typeof errorStr === 'string' ) {
                callback(null, errorStr);
                return;
            }

            var bin = {};
            for ( var i = 0; i < coarseCount; i++ ) {
                bin[dataKey + i.toString()] = '';
            }

            chrome.storage.sync.get(bin, assembleChunks);
        };

        getCoarseChunkCount(dataKey, fetchChunks);
    };

    var getOptions = function(callback) {
        if ( typeof callback !== 'function' ) {
            return;
        }
        callback(options);
    };

    var setOptions = function(details, callback) {
        if ( typeof details !== 'object' || details === null ) {
            return;
        }

        if ( typeof details.deviceName === 'string' ) {
            vAPI.localStorage.setItem('deviceName', details.deviceName);
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

})();

/******************************************************************************/
