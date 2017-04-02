/*******************************************************************************

    uMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2014-2017 Raymond Hill

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

/* global chrome, µMatrix */
/* jshint boss: true */

'use strict';

/******************************************************************************/

// Start isolation from global scope

µMatrix.webRequest = (function() {

/******************************************************************************/

// Intercept and filter web requests according to white and black lists.

var onBeforeRootFrameRequestHandler = function(details) {
    var µm = µMatrix;
    var requestURL = details.url;
    var requestHostname = µm.URI.hostnameFromURI(requestURL);
    var tabId = details.tabId;

    µm.tabContextManager.push(tabId, requestURL);

    var tabContext = µm.tabContextManager.mustLookup(tabId);
    var rootHostname = tabContext.rootHostname;

    // Disallow request as per matrix?
    var block = µm.mustBlock(rootHostname, requestHostname, 'doc');

    var pageStore = µm.pageStoreFromTabId(tabId);
    pageStore.recordRequest('doc', requestURL, block);
    µm.logger.writeOne(tabId, 'net', rootHostname, requestURL, 'doc', block);

    // Not blocked
    if ( !block ) {
        // rhill 2013-11-07: Senseless to do this for behind-the-scene requests.
        µm.cookieHunter.recordPageCookies(pageStore);
        return;
    }

    // Blocked
    var query = btoa(JSON.stringify({
        url: requestURL,
        hn: requestHostname,
        why: '?'
    }));

    vAPI.tabs.replace(tabId, vAPI.getURL('main-blocked.html?details=') + query);

    return { cancel: true };
};

/******************************************************************************/

// Intercept and filter web requests according to white and black lists.

var onBeforeRequestHandler = function(details) {
    var µm = µMatrix,
        µmuri = µm.URI;

    // rhill 2014-02-17: Ignore 'filesystem:': this can happen when listening
    // to 'chrome-extension://'.
    var requestScheme = µmuri.schemeFromURI(details.url);
    if ( requestScheme === 'filesystem' ) {
        return;
    }

    var requestType = requestTypeNormalizer[details.type] || 'other';

    // https://github.com/gorhill/httpswitchboard/issues/303
    // Wherever the main doc comes from, create a receiver page URL: synthetize
    // one if needed.
    if ( requestType === 'doc' && details.parentFrameId < 0 ) {
        return onBeforeRootFrameRequestHandler(details);
    }

    var requestURL = details.url;

    // Ignore non-network schemes
    if ( µmuri.isNetworkScheme(requestScheme) === false ) {
        µm.logger.writeOne('', 'info', 'request not processed: ' + requestURL);
        return;
    }

    // Re-classify orphan HTTP requests as behind-the-scene requests. There is
    // not much else which can be done, because there are URLs
    // which cannot be handled by µMatrix, i.e. `opera://startpage`,
    // as this would lead to complications with no obvious solution, like how
    // to scope on unknown scheme? Etc.
    // https://github.com/gorhill/httpswitchboard/issues/191
    // https://github.com/gorhill/httpswitchboard/issues/91#issuecomment-37180275
    var tabContext = µm.tabContextManager.mustLookup(details.tabId);
    var tabId = tabContext.tabId;
    var rootHostname = tabContext.rootHostname;

    // Enforce strict secure connection?
    var block = false;
    if (
        tabContext.secure &&
        µmuri.isSecureScheme(requestScheme) === false &&
        µm.tMatrix.evaluateSwitchZ('https-strict', rootHostname)
    ) {
        block = true;
    }

    // Disallow request as per temporary matrix?
    if ( block === false ) {
        block = µm.mustBlock(rootHostname, µmuri.hostnameFromURI(requestURL), requestType);
    }

    // Record request.
    // https://github.com/gorhill/httpswitchboard/issues/342
    // The way requests are handled now, it may happen at this point some
    // processing has already been performed, and that a synthetic URL has
    // been constructed for logging purpose. Use this synthetic URL if
    // it is available.
    var pageStore = µm.mustPageStoreFromTabId(tabId);
    pageStore.recordRequest(requestType, requestURL, block);
    µm.logger.writeOne(tabId, 'net', rootHostname, requestURL, details.type, block);

    // Allowed?
    if ( !block ) {
        // console.debug('onBeforeRequestHandler()> ALLOW "%s": %o', details.url, details);
        return;
    }

    // Blocked
    // console.debug('onBeforeRequestHandler()> BLOCK "%s": %o', details.url, details);

    return { 'cancel': true };
};

/******************************************************************************/

// Sanitize outgoing headers as per user settings.

var onBeforeSendHeadersHandler = function(details) {
    var µm = µMatrix;

    // Ignore non-network schemes
    if ( µm.URI.isNetworkScheme(details.url) === false ) {
        return;
    }

    // Re-classify orphan HTTP requests as behind-the-scene requests. There is
    // not much else which can be done, because there are URLs
    // which cannot be handled by HTTP Switchboard, i.e. `opera://startpage`,
    // as this would lead to complications with no obvious solution, like how
    // to scope on unknown scheme? Etc.
    // https://github.com/gorhill/httpswitchboard/issues/191
    // https://github.com/gorhill/httpswitchboard/issues/91#issuecomment-37180275
    var pageStore = µm.mustPageStoreFromTabId(details.tabId);
    var tabId = pageStore.tabId;

    // https://github.com/gorhill/httpswitchboard/issues/342
    // Is this hyperlink auditing?
    // If yes, create a synthetic URL for reporting hyperlink auditing
    // in request log. This way the user is better informed of what went
    // on.

    // https://html.spec.whatwg.org/multipage/semantics.html#hyperlink-auditing
    //
    // Target URL = the href of the link
    // Doc URL = URL of the document containing the target URL
    // Ping URLs = servers which will be told that user clicked target URL
    //
    // `Content-Type` = `text/ping` (always present)
    // `Ping-To` = target URL (always present)
    // `Ping-From` = doc URL
    // `Referer` = doc URL
    // request URL = URL which will receive the information
    //
    // With hyperlink-auditing, removing header(s) is pointless, the whole
    // request must be cancelled.

    var requestURL = details.url;
    var requestType = requestTypeNormalizer[details.type] || 'other';
    if ( requestType === 'ping' ) {
        var linkAuditor = details.requestHeaders.getHeader('ping-to');
        if ( linkAuditor !== '' ) {
            var block = µm.userSettings.processHyperlinkAuditing;
            pageStore.recordRequest('other', requestURL + '{Ping-To:' + linkAuditor + '}', block);
            µm.logger.writeOne(tabId, 'net', '', requestURL, 'ping', block);
            if ( block ) {
                µm.hyperlinkAuditingFoiledCounter += 1;
                return { 'cancel': true };
            }
        }
    }

    // If we reach this point, request is not blocked, so what is left to do
    // is to sanitize headers.
    var requestHostname = µm.URI.hostnameFromURI(requestURL);

    if ( µm.mustBlock(pageStore.pageHostname, requestHostname, 'cookie') ) {
        if ( details.requestHeaders.setHeader('cookie', '') ) {
            µm.cookieHeaderFoiledCounter++;
        }
    }

    if ( µm.tMatrix.evaluateSwitchZ('referrer-spoof', pageStore.pageHostname) ) {
        foilRefererHeaders(µm, requestHostname, details);
    }

    if ( µm.tMatrix.evaluateSwitchZ('ua-spoof', pageStore.pageHostname) ) {
        details.requestHeaders.setHeader('user-agent', µm.userAgentReplaceStr);
    }
};

/******************************************************************************/

var foilRefererHeaders = function(µm, toHostname, details) {
    var foiled = false;
    var µmuri = µm.URI;
    var scheme = '';
    var toDomain = '';

    var referer = details.requestHeaders.getHeader('referer');
    if ( referer !== '' ) {
        toDomain = toDomain || µmuri.domainFromHostname(toHostname);
        if ( toDomain !== µmuri.domainFromURI(referer) ) {
            scheme = scheme || µmuri.schemeFromURI(details.url);
            //console.debug('foilRefererHeaders()> foiled referer for "%s"', details.url);
            //console.debug('\treferrer "%s"', header.value);
            // https://github.com/gorhill/httpswitchboard/issues/222#issuecomment-44828402
            details.requestHeaders.setHeader(
                'referer',
                scheme + '://' + toHostname + '/'
            );
            foiled = true;
        }
    }

    // https://github.com/gorhill/uMatrix/issues/320
    // http://tools.ietf.org/html/rfc6454#section-7.3
    //   "The user agent MAY include an Origin header field in any HTTP
    //   "request.
    //   "The user agent MUST NOT include more than one Origin header field in
    //   "any HTTP request.
    //   "Whenever a user agent issues an HTTP request from a "privacy-
    //   "sensitive" context, the user agent MUST send the value "null" in the
    //   "Origin header field."

    // https://github.com/gorhill/uMatrix/issues/358
    // Do not spoof `Origin` header for the time being. This will be revisited.

    //var origin = details.requestHeaders.getHeader('origin');
    //if ( origin !== '' && origin !== 'null' ) {
    //    toDomain = toDomain || µmuri.domainFromHostname(toHostname);
    //    if ( toDomain !== µmuri.domainFromURI(origin) ) {
    //        scheme = scheme || µmuri.schemeFromURI(details.url);
    //        //console.debug('foilRefererHeaders()> foiled origin for "%s"', details.url);
    //        //console.debug('\torigin "%s"', header.value);
    //        details.requestHeaders.setHeader(
    //            'origin',
    //            scheme + '://' + toHostname
    //        );
    //        foiled = true;
    //    }
    //}

    if ( foiled ) {
        µm.refererHeaderFoiledCounter++;
    }
};

/******************************************************************************/

// To prevent inline javascript from being executed.

// Prevent inline scripting using `Content-Security-Policy`:
// https://dvcs.w3.org/hg/content-security-policy/raw-file/tip/csp-specification.dev.html

// This fixes:
// https://github.com/gorhill/httpswitchboard/issues/35

var onHeadersReceived = function(details) {
    // console.debug('onHeadersReceived()> "%s": %o', details.url, details);

    // Ignore schemes other than 'http...'
    var requestURL = details.url;
    if ( requestURL.lastIndexOf('http', 0) !== 0 ) {
        return;
    }

    var µm = µMatrix;
    var tabId = details.tabId;
    var requestType = requestTypeNormalizer[details.type] || 'other';

    // https://github.com/gorhill/uMatrix/issues/145
    // Check if the main_frame is a download
    if ( requestType === 'doc' ) {
        µm.tabContextManager.push(tabId, requestURL);
    }

    var tabContext = µm.tabContextManager.lookup(tabId);
    if ( tabContext === null ) {
        return;
    }

    if ( µm.mustAllow(tabContext.rootHostname, µm.URI.hostnameFromURI(requestURL), 'script') ) {
        return;
    }

    // If javascript is not allowed, say so through a `Content-Security-Policy`
    // directive.
    // We block only inline-script tags, all the external javascript will be
    // blocked by our request handler.

    // https://github.com/gorhill/uMatrix/issues/129
    // https://github.com/gorhill/uMatrix/issues/320
    //   Modernize CSP injection:
    //   - Do not overwrite blindly possibly already present CSP header
    //   - Add CSP directive to block inline script ONLY if needed
    //   - If we end up modifying the an existing CSP, strip out `report-uri`
    //     to prevent spurious CSP violations.

    var headers = details.responseHeaders;

    // Is there a CSP header present?
    // If not, inject a script-src CSP directive to prevent inline javascript
    // from executing.
    var i = headerIndexFromName('content-security-policy', headers);
    if ( i === -1 ) {
        headers.push({
            'name': 'Content-Security-Policy',
            'value': "script-src 'unsafe-eval' *"
        });
        return { responseHeaders: headers };
    }

    // A CSP header is already present.
    // Remove the CSP header, we will re-inject it after processing it.
    // TODO: We are currently forced to add the CSP header at the end of the
    //       headers array, because this is what the platform specific code
    //       expect (Firefox).
    var csp = headers.splice(i, 1)[0].value.trim();

    // Is there a script-src directive in the CSP header?
    // If not, we simply need to append our script-src directive.
    // https://github.com/gorhill/uMatrix/issues/320
    //   Since we are modifying an existing CSP header, we need to strip out
    //   'report-uri' if it is present, to prevent spurious reporting of CSP
    //   violation, and thus the leakage of information to the remote site.
    var matches = reScriptsrc.exec(csp);
    if ( matches === null ) {
        headers.push({
            'name': 'Content-Security-Policy',
            'value': cspStripReporturi(csp + "; script-src 'unsafe-eval' *")
        });
        return { responseHeaders: headers };
    }

    // A `script-src' directive is already present. Extract it.
    var scriptsrc = matches[0];

    // Is there at least one 'unsafe-inline' or 'nonce-' token in the
    // script-src?
    // If not we have no further processing to perform: inline scripts are
    // already forbidden by the site.
    if ( reUnsafeinline.test(scriptsrc) === false ) {
        headers.push({
            'name': 'Content-Security-Policy',
            'value': csp
        });
        return { responseHeaders: headers };
    }

    // There are tokens enabling inline script tags in the script-src
    // directive, so we have to strip them out.
    // Strip out whole script-src directive, remove the offending tokens
    // from it, then append the resulting script-src directive to the original
    // CSP header.
    // https://github.com/gorhill/uMatrix/issues/320
    //   Since we are modifying an existing CSP header, we need to strip out
    //   'report-uri' if it is present, to prevent spurious reporting of CSP
    //   violation, and thus the leakage of information to the remote site.

    // https://github.com/gorhill/uMatrix/issues/538
    // We will replace in-place the script-src directive with our own.
    headers.push({
        'name': 'Content-Security-Policy',
        'value': cspStripReporturi(
                    csp.slice(0, matches.index) +
                    scriptsrc.replace(reUnsafeinline, '') +
                    csp.slice(matches.index + scriptsrc.length)
                )
    });
    return { responseHeaders: headers };
};

var cspStripReporturi = function(csp) {
    return csp.replace(reReporturi, '');
};

var reReporturi = /report-uri[^;]*;?\s*/;
var reScriptsrc = /script-src[^;]*;?\s*/;
var reUnsafeinline = /'unsafe-inline'\s*|'nonce-[^']+'\s*/g;

/******************************************************************************/

var headerValue = function(headers, name) {
    var i = headers.length;
    while ( i-- ) {
        if ( headers[i].name.toLowerCase() === name ) {
            return headers[i].value.trim();
        }
    }
    return '';
};

/******************************************************************************/

// Caller must ensure headerName is normalized to lower case.

var headerIndexFromName = function(headerName, headers) {
    var i = headers.length;
    while ( i-- ) {
        if ( headers[i].name.toLowerCase() === headerName ) {
            return i;
        }
    }
    return -1;
};

/******************************************************************************/

var requestTypeNormalizer = {
    'font'          : 'css',
    'image'         : 'image',
    'imageset'      : 'image',
    'main_frame'    : 'doc',
    'media'         : 'plugin',
    'object'        : 'plugin',
    'other'         : 'other',
    'ping'          : 'ping',
    'script'        : 'script',
    'stylesheet'    : 'css',
    'sub_frame'     : 'frame',
    'websocket'     : 'xhr',
    'xmlhttprequest': 'xhr'
};

/******************************************************************************/

vAPI.net.onBeforeRequest = {
    extra: [ 'blocking' ],
    callback: onBeforeRequestHandler
};

vAPI.net.onBeforeSendHeaders = {
    extra: [ 'blocking', 'requestHeaders' ],
    callback: onBeforeSendHeadersHandler
};

vAPI.net.onHeadersReceived = {
    urls: [ 'http://*/*', 'https://*/*' ],
    types: [ 'main_frame', 'sub_frame' ],
    extra: [ 'blocking', 'responseHeaders' ],
    callback: onHeadersReceived
};

/******************************************************************************/

var start = function() {
    vAPI.net.registerListeners();
};

/******************************************************************************/

return {
    start: start
};

/******************************************************************************/

})();

/******************************************************************************/

