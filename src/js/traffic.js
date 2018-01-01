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
        µmuri = µm.URI,
        requestURL = details.url,
        requestScheme = µmuri.schemeFromURI(requestURL);

    if ( µmuri.isNetworkScheme(requestScheme) === false ) { return; }

    var requestType = requestTypeNormalizer[details.type] || 'other';

    // https://github.com/gorhill/httpswitchboard/issues/303
    // Wherever the main doc comes from, create a receiver page URL: synthetize
    // one if needed.
    if ( requestType === 'doc' && details.parentFrameId === -1 ) {
        return onBeforeRootFrameRequestHandler(details);
    }

    // Re-classify orphan HTTP requests as behind-the-scene requests. There is
    // not much else which can be done, because there are URLs
    // which cannot be handled by µMatrix, i.e. `opera://startpage`,
    // as this would lead to complications with no obvious solution, like how
    // to scope on unknown scheme? Etc.
    // https://github.com/gorhill/httpswitchboard/issues/191
    // https://github.com/gorhill/httpswitchboard/issues/91#issuecomment-37180275
    var tabContext = µm.tabContextManager.mustLookup(details.tabId),
        tabId = tabContext.tabId,
        rootHostname = tabContext.rootHostname,
        specificity = 0;

    // Filter through matrix
    var block = µm.tMatrix.mustBlock(
        rootHostname,
        µmuri.hostnameFromURI(requestURL),
        requestType
    );
    if ( block ) {
        specificity = µm.tMatrix.specificityRegister;
    }

    // Record request.
    // https://github.com/gorhill/httpswitchboard/issues/342
    // The way requests are handled now, it may happen at this point some
    // processing has already been performed, and that a synthetic URL has
    // been constructed for logging purpose. Use this synthetic URL if
    // it is available.
    var pageStore = µm.mustPageStoreFromTabId(tabId);

    // Enforce strict secure connection?
    if ( tabContext.secure && µmuri.isSecureScheme(requestScheme) === false ) {
        pageStore.hasMixedContent = true;
        if ( block === false ) {
            block = µm.tMatrix.evaluateSwitchZ('https-strict', rootHostname);
        }
    }

    pageStore.recordRequest(requestType, requestURL, block);
    µm.logger.writeOne(tabId, 'net', rootHostname, requestURL, details.type, block);

    if ( block ) {
        pageStore.cacheBlockedCollapsible(requestType, requestURL, specificity);
        return { 'cancel': true };
    }
};

/******************************************************************************/

// Sanitize outgoing headers as per user settings.

var onBeforeSendHeadersHandler = function(details) {
    var µm = µMatrix,
        µmuri = µm.URI,
        requestURL = details.url,
        requestScheme = µmuri.schemeFromURI(requestURL);

    // Ignore non-network schemes
    if ( µmuri.isNetworkScheme(requestScheme) === false ) { return; }

    // Re-classify orphan HTTP requests as behind-the-scene requests. There is
    // not much else which can be done, because there are URLs
    // which cannot be handled by HTTP Switchboard, i.e. `opera://startpage`,
    // as this would lead to complications with no obvious solution, like how
    // to scope on unknown scheme? Etc.
    // https://github.com/gorhill/httpswitchboard/issues/191
    // https://github.com/gorhill/httpswitchboard/issues/91#issuecomment-37180275
    var tabId = details.tabId,
        pageStore = µm.mustPageStoreFromTabId(tabId),
        requestType = requestTypeNormalizer[details.type] || 'other',
        requestHeaders = details.requestHeaders,
        headerIndex, headerValue;

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

    headerIndex = headerIndexFromName('ping-to', requestHeaders);
    if ( headerIndex !== -1 ) {
        headerValue = requestHeaders[headerIndex].value;
        if ( headerValue !== '' ) {
            var block = µm.userSettings.processHyperlinkAuditing;
            pageStore.recordRequest('other', requestURL + '{Ping-To:' + headerValue + '}', block);
            µm.logger.writeOne(tabId, 'net', '', requestURL, 'ping', block);
            if ( block ) {
                µm.hyperlinkAuditingFoiledCounter += 1;
                return { 'cancel': true };
            }
        }
    }

    // If we reach this point, request is not blocked, so what is left to do
    // is to sanitize headers.

    var rootHostname = pageStore.pageHostname,
        requestHostname = µmuri.hostnameFromURI(requestURL),
        modified = false;
        
    // Process `Cookie` header.

    headerIndex = headerIndexFromName('cookie', requestHeaders);
    if (
        headerIndex !== -1 &&
        µm.mustBlock(rootHostname, requestHostname, 'cookie')
    ) {
        modified = true;
        headerValue = requestHeaders[headerIndex].value;
        requestHeaders.splice(headerIndex, 1);
        µm.cookieHeaderFoiledCounter++;
        if ( requestType === 'doc' ) {
            µm.logger.writeOne(tabId, 'net', '', headerValue, 'COOKIE', true);
        }
    }

    // Process `Referer` header.

    // https://github.com/gorhill/httpswitchboard/issues/222#issuecomment-44828402

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
    //   Do not spoof `Origin` header for the time being.

    // https://github.com/gorhill/uMatrix/issues/773
    //   For non-GET requests, remove `Referer` header instead of spoofing it.

    headerIndex = headerIndexFromName('referer', requestHeaders);
    if ( headerIndex !== -1 ) {
        headerValue = requestHeaders[headerIndex].value;
        if ( headerValue !== '' ) {
            var toDomain = µmuri.domainFromHostname(requestHostname);
            if ( toDomain !== '' && toDomain !== µmuri.domainFromURI(headerValue) ) {
                pageStore.has3pReferrer = true;
                if ( µm.tMatrix.evaluateSwitchZ('referrer-spoof', rootHostname) ) {
                    modified = true;
                    var newValue;
                    if ( details.method === 'GET' ) {
                        newValue = requestHeaders[headerIndex].value =
                            requestScheme + '://' + requestHostname + '/';
                    } else {
                        requestHeaders.splice(headerIndex, 1);
                    }
                    µm.refererHeaderFoiledCounter++;
                    if ( requestType === 'doc' ) {
                        µm.logger.writeOne(tabId, 'net', '', headerValue, 'REFERER', true);
                        if ( newValue !== undefined ) {
                            µm.logger.writeOne(tabId, 'net', '', newValue, 'REFERER', false);
                        }
                    }
                }
            }
        }
    }

    if ( modified ) {
        return { requestHeaders: requestHeaders };
    }
};

/******************************************************************************/

// To prevent inline javascript from being executed.

// Prevent inline scripting using `Content-Security-Policy`:
// https://dvcs.w3.org/hg/content-security-policy/raw-file/tip/csp-specification.dev.html

// This fixes:
// https://github.com/gorhill/httpswitchboard/issues/35

var onHeadersReceived = function(details) {
    // Ignore schemes other than 'http...'
    var µm = µMatrix,
        tabId = details.tabId,
        requestURL = details.url,
        requestType = requestTypeNormalizer[details.type] || 'other';

    // https://github.com/gorhill/uMatrix/issues/145
    // Check if the main_frame is a download
    if ( requestType === 'doc' ) {
        µm.tabContextManager.push(tabId, requestURL);
    }

    var tabContext = µm.tabContextManager.lookup(tabId);
    if ( tabContext === null ) { return; }

    var csp = [],
        cspReport = [],
        rootHostname = tabContext.rootHostname,
        requestHostname = µm.URI.hostnameFromURI(requestURL);

    // If javascript is not allowed, say so through a `Content-Security-Policy`
    // directive.
    // We block only inline-script tags, all the external javascript will be
    // blocked by our request handler.
    if ( µm.mustAllow(rootHostname, requestHostname, 'script' ) !== true ) {
        csp.push(µm.cspNoInlineScript);
    } else {
        cspReport.push(µm.cspNoInlineScript);
    }

    // TODO: Firefox will eventually support `worker-src`:
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1231788
    if ( µm.cspNoWorker === undefined ) {
        µm.cspNoWorker = vAPI.webextFlavor.startsWith('Mozilla-') ?
            "child-src 'none'; frame-src data: blob: *; report-uri about:blank" :
            "worker-src 'none'; report-uri about:blank" ;
    }

    if ( µm.tMatrix.evaluateSwitchZ('no-workers', rootHostname) ) {
        csp.push(µm.cspNoWorker);
    } else {
        cspReport.push(µm.cspNoWorker);
    }

    var headers = details.responseHeaders,
        cspDirectives, i;

    if ( csp.length !== 0 ) {
        cspDirectives = csp.join(',');
        i = headerIndexFromName('content-security-policy', headers);
        if ( i !== -1 ) {
            headers[i].value += ',' + cspDirectives;
        } else {
            headers.push({
                name: 'Content-Security-Policy',
                value: cspDirectives
            });
        }
        if ( requestType === 'doc' ) {
            µm.logger.writeOne(tabId, 'net', '', cspDirectives, 'CSP', false);
        }
    }

    if ( cspReport.length !== 0 ) {
        cspDirectives = cspReport.join(',');
        i = headerIndexFromName('content-security-policy-report-only', headers);
        if ( i !== -1 ) {
            headers[i].value += ',' + cspDirectives;
        } else {
            headers.push({
                name: 'Content-Security-Policy-Report-Only',
                value: cspDirectives
            });
        }
    }

    return { responseHeaders: headers };
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
    'media'         : 'media',
    'object'        : 'media',
    'other'         : 'other',
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

