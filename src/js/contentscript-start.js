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

// OK, I keep changing my mind whether a closure should be used or not. This
// will be the rule: if there are any variables directly accessed on a regular
// basis, use a closure so that they are cached. Otherwise I don't think the
// overhead of a closure is worth it. That's my understanding.

(function() {

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
})('contentscript-start.js');

/******************************************************************************/
/******************************************************************************/

// If you play with this code, mind:
//   https://github.com/gorhill/httpswitchboard/issues/261
//   https://github.com/gorhill/httpswitchboard/issues/252

var navigatorSpoofer = " \
;(function() { \
    try { \
        var spoofedUserAgent = {{ua-json}}; \
        if ( spoofedUserAgent === navigator.userAgent ) { \
            return; \
        } \
        var realNavigator = navigator; \
        var SpoofedNavigator = function(ua) { \
            this.navigator = navigator; \
        }; \
        var spoofedNavigator = new SpoofedNavigator(spoofedUserAgent); \
        var makeFunction = function(n, k) { \
            n[k] = function() { \
                return this.navigator[k].apply(this.navigator, arguments); }; \
        }; \
        for ( var k in realNavigator ) { \
            if ( typeof realNavigator[k] === 'function' ) { \
                makeFunction(spoofedNavigator, k); \
            } else { \
                spoofedNavigator[k] = realNavigator[k]; \
            } \
        } \
        spoofedNavigator.userAgent = spoofedUserAgent; \
        var pos = spoofedUserAgent.indexOf('/'); \
        spoofedNavigator.appName = pos < 0 ? '' : spoofedUserAgent.slice(0, pos); \
        spoofedNavigator.appVersion = pos < 0 ? spoofedUserAgent : spoofedUserAgent.slice(pos + 1); \
        navigator = window.navigator = spoofedNavigator; \
    } catch (e) { \
    } \
})();";

/******************************************************************************/

// Because window.userAgent is read-only, we need to create a fake Navigator
// object to contain our fake user-agent string.
// Because objects created by a content script are local to the content script
// and not visible to the web page itself (and vice versa), we need the context
// of the web page to create the fake Navigator object directly, and the only
// way to do this is to inject appropriate javascript code into the web page.

var injectNavigatorSpoofer = function(spoofedUserAgent) {
    if ( typeof spoofedUserAgent !== 'string' ) {
        return;
    }
    if ( spoofedUserAgent === navigator.userAgent ) {
        return;
    }
    var script = document.createElement('script');
    script.type = 'text/javascript';
    script.id = 'umatrix-ua-spoofer';
    var js = document.createTextNode(navigatorSpoofer.replace('{{ua-json}}', JSON.stringify(spoofedUserAgent)));
    script.appendChild(js);

    try {
        var parent = document.head || document.documentElement;
        parent.appendChild(script);
    }
    catch (e) {
    }
};

var requestDetails = {
    what: 'getUserAgentReplaceStr',
    hostname: window.location.hostname
};
messaging.ask(requestDetails, injectNavigatorSpoofer);

/******************************************************************************/
/******************************************************************************/

// The port will never be used again at this point, disconnecting allows
// to browser to flush this script from memory.

messaging.stop();

/******************************************************************************/
/******************************************************************************/

})();

/******************************************************************************/
