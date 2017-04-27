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

/* global vAPI */
/* jshint multistr: true */

// Injected into content pages

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/464
if ( document instanceof HTMLDocument === false ) {
    //console.debug('contentscript-start.js > not a HTLMDocument');
    return;
}

// This can also happen (for example if script injected into a `data:` URI doc)
if ( !window.location ) {
    return;
}

// This can happen
if ( typeof vAPI !== 'object' ) {
    //console.debug('contentscript-start.js > vAPI not found');
    return;
}

// https://github.com/chrisaljoudi/uBlock/issues/456
// Already injected?
if ( vAPI.contentscriptStartInjected ) {
    //console.debug('contentscript-end.js > content script already injected');
    return;
}
vAPI.contentscriptStartInjected = true;

/******************************************************************************/

var localMessager = vAPI.messaging.channel('contentscript-start.js');

/******************************************************************************/

// If you play with this code, mind:
//   https://github.com/gorhill/httpswitchboard/issues/261
//   https://github.com/gorhill/httpswitchboard/issues/252

var navigatorSpoofer = " \
;(function() { \n \
    try { \n \
        /* https://github.com/gorhill/uMatrix/issues/61#issuecomment-63814351 */ \n \
        var navigator = window.navigator; \n \
        var spoofedUserAgent = {{ua-json}}; \n \
        if ( spoofedUserAgent === navigator.userAgent ) { \n \
            return; \n \
        } \n \
        var pos = spoofedUserAgent.indexOf('/'); \n \
        var appName = pos === -1 ? '' : spoofedUserAgent.slice(0, pos); \n \
        var appVersion = pos === -1 ? spoofedUserAgent : spoofedUserAgent.slice(pos + 1); \n \
        Object.defineProperty(navigator, 'userAgent', { value: spoofedUserAgent }); \n \
        Object.defineProperty(navigator, 'appName', { value: appName }); \n \
        Object.defineProperty(navigator, 'appVersion', { value: appVersion }); \n \
        var c = document.currentScript, \n \
            p = c && c.parentNode; \n \
        if ( p ) { p.removeChild(c); } \n \
    } catch (e) { \n \
    } \n \
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
    var parent = document.head || document.documentElement,
        scriptText = navigatorSpoofer.replace('{{ua-json}}', JSON.stringify(spoofedUserAgent)),
        script = document.createElement('script');
    script.setAttribute('type', 'text/javascript');
    script.appendChild(document.createTextNode(scriptText));
    try {
        parent.appendChild(script);
    }
    catch (ex) {
    }

    // https://github.com/gorhill/uMatrix/issues/771
    if ( script.parentNode !== null ) {
        script.parentNode.removeChild(script);
        script = document.createElement('script');
        script.setAttribute('type', 'text/javascript');
        script.setAttribute('src', 'data:application/javascript;base64,' + window.btoa(scriptText));
        try {
            parent.appendChild(script);
        }
        catch (ex) {
        }
        if ( script.parentNode !== null ) {
            script.parentNode.removeChild(script);
        }
    }

    // The port will never be used again at this point, disconnecting allows
    // to browser to flush this script from memory.
    localMessager.close();
};

localMessager.send({
    what: 'getUserAgentReplaceStr',
    hostname: window.location.hostname
}, injectNavigatorSpoofer);

/******************************************************************************/
/******************************************************************************/

})();

/******************************************************************************/
