/*******************************************************************************

    µMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2014  Raymond Hill

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

/* jshint multistr: true */
/* global chrome */

// Injected into content pages

/******************************************************************************/
/******************************************************************************/

// https://github.com/gorhill/httpswitchboard/issues/345

var messaging = (function(name){
    var port = null;
    var requestId = 1;
    var requestIdToCallbackMap = {};
    var listenCallback = null;

    var onPortMessage = function(details) {
        if ( typeof details.id !== 'number' ) {
            return;
        }
        // Announcement?
        if ( details.id < 0 ) {
            if ( listenCallback ) {
                listenCallback(details.msg);
            }
            return;
        }
        var callback = requestIdToCallbackMap[details.id];
        if ( !callback ) {
            return;
        }
        // Must be removed before calling client to be sure to not execute
        // callback again if the client stops the messaging service.
        delete requestIdToCallbackMap[details.id];
        callback(details.msg);
    };

    var start = function(name) {
        port = chrome.runtime.connect({ name: name });
        port.onMessage.addListener(onPortMessage);

        // https://github.com/gorhill/uBlock/issues/193
        port.onDisconnect.addListener(stop);
    };

    var stop = function() {
        listenCallback = null;
        port.disconnect();
        port = null;
        flushCallbacks();
    };

    if ( typeof name === 'string' && name !== '' ) {
        start(name);
    }

    var ask = function(msg, callback) {
        if ( port === null ) {
            if ( typeof callback === 'function' ) {
                callback();
            }
            return;
        }
        if ( callback === undefined ) {
            tell(msg);
            return;
        }
        var id = requestId++;
        port.postMessage({ id: id, msg: msg });
        requestIdToCallbackMap[id] = callback;
    };

    var tell = function(msg) {
        if ( port !== null ) {
            port.postMessage({ id: 0, msg: msg });
        }
    };

    var listen = function(callback) {
        listenCallback = callback;
    };

    var flushCallbacks = function() {
        var callback;
        for ( var id in requestIdToCallbackMap ) {
            if ( requestIdToCallbackMap.hasOwnProperty(id) === false ) {
                continue;
            }
            callback = requestIdToCallbackMap[id];
            if ( !callback ) {
                continue;
            }
            // Must be removed before calling client to be sure to not execute
            // callback again if the client stops the messaging service.
            delete requestIdToCallbackMap[id];
            callback();
        }
    };

    return {
        start: start,
        stop: stop,
        ask: ask,
        tell: tell,
        listen: listen
    };
})('contentscript-end.js');

/******************************************************************************/
/******************************************************************************/

// This is to be executed only once: putting this code in its own closure
// means the code will be flushed from memory once executed.

(function() {

/******************************************************************************/

/*------------[ Unrendered Noscript (because CSP) Workaround ]----------------*/

var checkScriptBlacklistedHandler = function(response) {
    if ( !response.scriptBlacklisted ) {
        return;
    }
    var scripts = document.querySelectorAll('noscript');
    var i = scripts.length;
    var realNoscript, fakeNoscript;
    while ( i-- ) {
        realNoscript = scripts[i];
        fakeNoscript = document.createElement('div');
        fakeNoscript.innerHTML = '<!-- uMatrix NOSCRIPT tag replacement: see <https://github.com/gorhill/httpswitchboard/issues/177> -->\n' + realNoscript.textContent;
        realNoscript.parentNode.replaceChild(fakeNoscript, realNoscript);
    }
};

messaging.ask({
        what: 'checkScriptBlacklisted',
        url: window.location.href
    },
    checkScriptBlacklistedHandler
);

/******************************************************************************/

var localStorageHandler = function(mustRemove) {
    if ( mustRemove ) {
        window.localStorage.clear();
        window.sessionStorage.clear();
        // console.debug('HTTP Switchboard > found and removed non-empty localStorage');
    }
};

// Check with extension whether local storage must be emptied
// rhill 2014-03-28: we need an exception handler in case 3rd-party access
// to site data is disabled.
// https://github.com/gorhill/httpswitchboard/issues/215
try {
    var hasLocalStorage = window.localStorage && window.localStorage.length;
    var hasSessionStorage = window.sessionStorage && window.sessionStorage.length;
    if ( hasLocalStorage || hasSessionStorage ) {
        messaging.ask({
                what: 'contentScriptHasLocalStorage',
                url: window.location.href
            },
            localStorageHandler
        );
    }

    // TODO: indexedDB
    if ( window.indexedDB && !!window.indexedDB.webkitGetDatabaseNames ) {
        // var db = window.indexedDB.webkitGetDatabaseNames().onsuccess = function(sender) {
        //    console.debug('webkitGetDatabaseNames(): result=%o', sender.target.result);
        // };
    }

    // TODO: Web SQL
    if ( window.openDatabase ) {
        // Sad:
        // "There is no way to enumerate or delete the databases available for an origin from this API."
        // Ref.: http://www.w3.org/TR/webdatabase/#databases
    }
}
catch (e) {
}

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

(function() {

/******************************************************************************/

var nodesAddedHandler = function(nodeList, summary) {
    var i = 0;
    var node, src, text;
    while ( node = nodeList.item(i++) ) {
        if ( !node.tagName ) {
            continue;
        }

        switch ( node.tagName.toUpperCase() ) {

        case 'SCRIPT':
            // https://github.com/gorhill/httpswitchboard/issues/252
            // Do not count µMatrix's own script tags, they are not required
            // to "unbreak" a web page
            if ( node.id && node.id.indexOf('uMatrix-') === 0 ) {
                break;
            }
            text = node.textContent.trim();
            if ( text !== '' ) {
                summary.scriptSources['{inline_script}'] = true;
                summary.mustReport = true;
            }
            src = (node.src || '').trim();
            if ( src !== '' ) {
                summary.scriptSources[src] = true;
                summary.mustReport = true;
            }
            break;

        case 'A':
            if ( node.href.indexOf('javascript:') === 0 ) {
                summary.scriptSources['{inline_script}'] = true;
                summary.mustReport = true;
            }
            break;

        case 'OBJECT':
            src = (node.data || '').trim();
            if ( src !== '' ) {
                summary.pluginSources[src] = true;
                summary.mustReport = true;
            }
            break;

        case 'EMBED':
            src = (node.src || '').trim();
            if ( src !== '' ) {
                summary.pluginSources[src] = true;
                summary.mustReport = true;
            }
            break;
        }
    }
};

/******************************************************************************/

var nodeListsAddedHandler = function(nodeLists) {
    var summary = {
        what: 'contentScriptSummary',
        locationURL: window.location.href,
        scriptSources: {}, // to avoid duplicates
        pluginSources: {}, // to avoid duplicates
        mustReport: false
    };
    var i = nodeLists.length;
    while ( i-- ) {
        nodesAddedHandler(nodeLists[i], summary);
    }
    if ( summary.mustReport ) {
        messaging.tell(summary);
    }
};

/******************************************************************************/

// rhill 2013-11-09: Weird... This code is executed from HTTP Switchboard
// context first time extension is launched. Avoid this.
// TODO: Investigate if this was a fluke or if it can really happen.
// I suspect this could only happen when I was using chrome.tabs.executeScript(),
// because now a delarative content script is used, along with "http{s}" URL
// pattern matching.

// console.debug('contentscript-end.js > window.location.href = "%s"', window.location.href);

if ( /^https?:\/\/./.test(window.location.href) === false ) {
    console.debug("Huh?");
    return;
}

/******************************************************************************/

(function() {
    var summary = {
        what: 'contentScriptSummary',
        locationURL: window.location.href,
        scriptSources: {}, // to avoid duplicates
        pluginSources: {}, // to avoid duplicates
        mustReport: true
    };
    // https://github.com/gorhill/httpswitchboard/issues/25
    // &
    // Looks for inline javascript also in at least one a[href] element.
    // https://github.com/gorhill/httpswitchboard/issues/131
    nodesAddedHandler(document.querySelectorAll('script, a[href^="javascript:"], object, embed'), summary);

    //console.debug('contentscript-end.js > firstObservationHandler(): found %d script tags in "%s"', Object.keys(summary.scriptSources).length, window.location.href);

    messaging.tell(summary);
})();

/******************************************************************************/

// Observe changes in the DOM

var mutationObservedHandler = function(mutations) {
    var i = mutations.length;
    var nodeLists = [], nodeList;
    while ( i-- ) {
        nodeList = mutations[i].addedNodes;
        if ( nodeList && nodeList.length ) {
            nodeLists.push(nodeList);
        }
    }
    if ( nodeLists.length ) {
        nodeListsAddedHandler(nodeLists);
    }
};

// This fixes http://acid3.acidtests.org/
if ( document.body ) {
    // https://github.com/gorhill/httpswitchboard/issues/176
    var observer = new MutationObserver(mutationObservedHandler);
    observer.observe(document.body, {
        attributes: false,
        childList: true,
        characterData: false,
        subtree: true
    });
}

/******************************************************************************/

})();
