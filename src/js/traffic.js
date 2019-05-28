/*******************************************************************************

    uMatrix - a browser extension to black/white list requests.
    Copyright (C) 2014-present Raymond Hill

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
    let µm = µMatrix;
    let desURL = details.url;
    let desHn = µm.URI.hostnameFromURI(desURL);
    let type = requestTypeNormalizer[details.type] || 'other';
    let tabId = details.tabId;

    µm.tabContextManager.push(tabId, desURL);

    let tabContext = µm.tabContextManager.mustLookup(tabId);
    let srcHn = tabContext.rootHostname;

    // Disallow request as per matrix?
    let blocked = µm.mustBlock(srcHn, desHn, type);

    let pageStore = µm.pageStoreFromTabId(tabId);
    pageStore.recordRequest(type, desURL, blocked);
    pageStore.perLoadAllowedRequestCount = 0;
    pageStore.perLoadBlockedRequestCount = 0;
    µm.logger.writeOne({ tabId, srcHn, desHn, desURL, type, blocked });

    // Not blocked
    if ( !blocked ) {
        let redirectURL = maybeRedirectRootFrame(desHn, desURL);
        if ( redirectURL !== desURL ) {
            return { redirectUrl: redirectURL };
        }
        µm.cookieHunter.recordPageCookies(pageStore);
        return;
    }

    // Blocked
    let query = btoa(JSON.stringify({ url: desURL, hn: desHn, type, why: '?' }));

    vAPI.tabs.replace(tabId, vAPI.getURL('main-blocked.html?details=') + query);

    return { cancel: true };
};

/******************************************************************************/

// https://twitter.com/thatcks/status/958776519765225473

var maybeRedirectRootFrame = function(hostname, url) {
    let µm = µMatrix;
    if ( µm.rawSettings.enforceEscapedFragment !== true ) { return url; }
    let block1pScripts = µm.mustBlock(hostname, hostname, 'script');
    let reEscapedFragment = /[?&]_escaped_fragment_=/;
    if ( reEscapedFragment.test(url) ) {
        return block1pScripts ? url : url.replace(reEscapedFragment, '#!') ;
    }
    if ( block1pScripts === false ) { return url; }
    let pos = url.indexOf('#!');
    if ( pos === -1 ) { return url; }
    let separator = url.lastIndexOf('?', pos) === -1 ? '?' : '&';
    return url.slice(0, pos) +
           separator + '_escaped_fragment_=' +
           url.slice(pos + 2);
};

/******************************************************************************/

// Intercept and filter web requests according to white and black lists.

var onBeforeRequestHandler = function(details) {
    let µm = µMatrix,
        µmuri = µm.URI,
        desURL = details.url,
        desScheme = µmuri.schemeFromURI(desURL);

    if ( µmuri.isNetworkScheme(desScheme) === false ) { return; }

    let type = requestTypeNormalizer[details.type] || 'other';

    // https://github.com/gorhill/httpswitchboard/issues/303
    // Wherever the main doc comes from, create a receiver page URL: synthetize
    // one if needed.
    if ( type === 'doc' && details.parentFrameId === -1 ) {
        return onBeforeRootFrameRequestHandler(details);
    }

    // Re-classify orphan HTTP requests as behind-the-scene requests. There is
    // not much else which can be done, because there are URLs
    // which cannot be handled by µMatrix, i.e. `opera://startpage`,
    // as this would lead to complications with no obvious solution, like how
    // to scope on unknown scheme? Etc.
    // https://github.com/gorhill/httpswitchboard/issues/191
    // https://github.com/gorhill/httpswitchboard/issues/91#issuecomment-37180275
    let tabContext = µm.tabContextManager.mustLookup(details.tabId),
        tabId = tabContext.tabId,
        srcHn = tabContext.rootHostname,
        desHn = µmuri.hostnameFromURI(desURL),
        docURL = details.documentUrl,
        specificity = 0;

    if ( docURL !== undefined ) {
        // Extract context from initiator for behind-the-scene requests.
        if ( tabId < 0 ) {
            srcHn = µmuri.hostnameFromURI(µm.normalizePageURL(0, docURL));
        }
        // https://github.com/uBlockOrigin/uMatrix-issues/issues/72
        //   Workaround of weird Firefox behavior: when a service worker exists
        //   for a site, the `doc` requests when loading a page from that site
        //   are not being made: this potentially prevents uMatrix to properly
        //   keep track of the context in which requests are made.
        else if (
            details.parentFrameId === -1 &&
            docURL !== tabContext.rawURL
        ) {
            srcHn = µmuri.hostnameFromURI(µm.normalizePageURL(0, docURL));
        }
    }

    let blocked = µm.tMatrix.mustBlock(srcHn, desHn, type);
    if ( blocked ) {
        specificity = µm.tMatrix.specificityRegister;
    }

    // Record request.
    // https://github.com/gorhill/httpswitchboard/issues/342
    // The way requests are handled now, it may happen at this point some
    // processing has already been performed, and that a synthetic URL has
    // been constructed for logging purpose. Use this synthetic URL if
    // it is available.
    let pageStore = µm.mustPageStoreFromTabId(tabId);

    // Enforce strict secure connection?
    if ( tabContext.secure && µmuri.isSecureScheme(desScheme) === false ) {
        pageStore.hasMixedContent = true;
        if ( blocked === false ) {
            blocked = µm.tMatrix.evaluateSwitchZ('https-strict', srcHn);
        }
    }

    pageStore.recordRequest(type, desURL, blocked);
    if ( µm.logger.enabled ) {
        µm.logger.writeOne({ tabId, srcHn, desHn, desURL, type, blocked });
    }

    if ( blocked ) {
        pageStore.cacheBlockedCollapsible(type, desURL, specificity);
        return { 'cancel': true };
    }
};

/******************************************************************************/

// Sanitize outgoing headers as per user settings.

var onBeforeSendHeadersHandler = function(details) {
    let µm = µMatrix,
        µmuri = µm.URI,
        desURL = details.url,
        desScheme = µmuri.schemeFromURI(desURL);

    // Ignore non-network schemes
    if ( µmuri.isNetworkScheme(desScheme) === false ) { return; }

    // Re-classify orphan HTTP requests as behind-the-scene requests. There is
    // not much else which can be done, because there are URLs
    // which cannot be handled by HTTP Switchboard, i.e. `opera://startpage`,
    // as this would lead to complications with no obvious solution, like how
    // to scope on unknown scheme? Etc.
    // https://github.com/gorhill/httpswitchboard/issues/191
    // https://github.com/gorhill/httpswitchboard/issues/91#issuecomment-37180275
    const tabId = details.tabId;
    const pageStore = µm.mustPageStoreFromTabId(tabId);
    const desHn = µmuri.hostnameFromURI(desURL);
    const requestType = requestTypeNormalizer[details.type] || 'other';
    const requestHeaders = details.requestHeaders;

    // https://github.com/uBlockOrigin/uMatrix-issues/issues/155
    // https://github.com/uBlockOrigin/uMatrix-issues/issues/159
    //   TODO: import all filtering context improvements from uBO.
    const srcHn = tabId < 0 ||
          details.parentFrameId < 0 ||
          details.parentFrameId === 0 && details.type === 'sub_frame'
        ? µmuri.hostnameFromURI(details.documentUrl) || pageStore.pageHostname
        : pageStore.pageHostname;

    // https://github.com/gorhill/httpswitchboard/issues/342
    // Is this hyperlink auditing?
    // If yes, create a synthetic URL for reporting hyperlink auditing
    // in request log. This way the user is better informed of what went
    // on.

    // https://html.spec.whatwg.org/multipage/links.html#hyperlink-auditing
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

    let headerIndex = headerIndexFromName('ping-to', requestHeaders);
    if ( headerIndex !== -1 ) {
        let headerValue = requestHeaders[headerIndex].value;
        if ( headerValue !== '' ) {
            let blocked = µm.userSettings.processHyperlinkAuditing;
            pageStore.recordRequest('other', desURL + '{Ping-To:' + headerValue + '}', blocked);
            µm.logger.writeOne({ tabId, srcHn, desHn, desURL, type: 'ping', blocked });
            if ( blocked ) {
                µm.hyperlinkAuditingFoiledCounter += 1;
                return { 'cancel': true };
            }
        }
    }

    // If we reach this point, request is not blocked, so what is left to do
    // is to sanitize headers.

    let modified = false;
        
    // Process `Cookie` header.

    headerIndex = headerIndexFromName('cookie', requestHeaders);
    if (
        headerIndex !== -1 &&
        µm.mustBlock(srcHn, desHn, 'cookie')
    ) {
        modified = true;
        let headerValue = requestHeaders[headerIndex].value;
        requestHeaders.splice(headerIndex, 1);
        µm.cookieHeaderFoiledCounter++;
        if ( requestType === 'doc' ) {
            pageStore.perLoadBlockedRequestCount++;
            µm.logger.writeOne({
                tabId,
                srcHn,
                header: { name: 'COOKIE', value: headerValue },
                change: -1
            });
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
        let headerValue = requestHeaders[headerIndex].value;
        if ( headerValue !== '' ) {
            let toDomain = µmuri.domainFromHostname(desHn);
            if ( toDomain !== '' && toDomain !== µmuri.domainFromURI(headerValue) ) {
                pageStore.has3pReferrer = true;
                if ( µm.tMatrix.evaluateSwitchZ('referrer-spoof', srcHn) ) {
                    modified = true;
                    let newValue;
                    if ( details.method === 'GET' ) {
                        newValue = requestHeaders[headerIndex].value =
                            desScheme + '://' + desHn + '/';
                    } else {
                        requestHeaders.splice(headerIndex, 1);
                    }
                    if ( pageStore.perLoadBlockedReferrerCount === 0 ) {
                        pageStore.perLoadBlockedRequestCount += 1;
                        µm.logger.writeOne({
                            tabId,
                            srcHn,
                            header: { name: 'REFERER', value: headerValue },
                            change: -1
                        });
                        if ( newValue !== undefined ) {
                            µm.logger.writeOne({
                                tabId,
                                srcHn,
                                header: { name: 'REFERER', value: newValue },
                                change: +1
                            });
                        }
                    }
                    pageStore.perLoadBlockedReferrerCount += 1;
                }
            }
        }
    }

    if ( modified !== true ) { return; }

    µm.updateBadgeAsync(tabId);

    return { requestHeaders: requestHeaders };
};

/******************************************************************************/

// To prevent inline javascript from being executed.

// Prevent inline scripting using `Content-Security-Policy`:
// https://dvcs.w3.org/hg/content-security-policy/raw-file/tip/csp-specification.dev.html

// This fixes:
// https://github.com/gorhill/httpswitchboard/issues/35

var onHeadersReceivedHandler = function(details) {
    // Ignore schemes other than 'http...'
    let µm = µMatrix,
        tabId = details.tabId,
        requestURL = details.url,
        requestType = requestTypeNormalizer[details.type] || 'other',
        headers = details.responseHeaders;

    // https://github.com/gorhill/uMatrix/issues/145
    // Check if the main_frame is a download
    if ( requestType === 'doc' ) {
        µm.tabContextManager.push(tabId, requestURL);
        let contentType = typeFromHeaders(headers);
        if ( contentType !== undefined ) {
            details.type = contentType;
            return onBeforeRootFrameRequestHandler(details);
        }
    }

    let tabContext = µm.tabContextManager.lookup(tabId);
    if ( tabContext === null ) { return; }

    let csp = [],
        cspReport = [],
        srcHn = tabContext.rootHostname,
        desHn = µm.URI.hostnameFromURI(requestURL);

    // Inline script tags.
    if ( µm.mustBlock(srcHn, desHn, 'script' ) ) {
        csp.push(µm.cspNoInlineScript);
    }

    // Inline style tags.
    if ( µm.mustBlock(srcHn, desHn, 'css' ) ) {
        csp.push(µm.cspNoInlineStyle);
    }

    if ( µm.tMatrix.evaluateSwitchZ('no-workers', srcHn) ) {
        csp.push(µm.cspNoWorker);
    } else if ( µm.rawSettings.disableCSPReportInjection === false ) {
        cspReport.push(µm.cspNoWorker);
    }

    if ( csp.length === 0 && cspReport.length === 0 ) { return; }

    // https://github.com/gorhill/uMatrix/issues/967
    //   Inject a new CSP header rather than modify an existing one, except
    //   if the current environment does not support merging headers:
    //   Firefox 58/webext and less can't merge CSP headers, so we will merge
    //   them here.

    if ( csp.length !== 0 ) {
        let cspRight = csp.join(', ');
        let cspTotal = cspRight;
        if ( µm.cantMergeCSPHeaders ) {
            let i = headerIndexFromName(
                'content-security-policy',
                headers
            );
            if ( i !== -1 ) {
                cspTotal = headers[i].value.trim() + ', ' + cspTotal;
                headers.splice(i, 1);
            }
        }
        headers.push({
            name: 'Content-Security-Policy',
            value: cspTotal
        });
        if ( requestType === 'doc' ) {
            µm.logger.writeOne({
                tabId,
                srcHn,
                header: { name: 'CSP', value: cspRight },
                change: +1
            });
        }
    }

    if ( cspReport.length !== 0 ) {
        let cspRight = cspReport.join(', ');
        let cspTotal = cspRight;
        if ( µm.cantMergeCSPHeaders ) {
            let i = headerIndexFromName(
                'content-security-policy-report-only',
                headers
            );
            if ( i !== -1 ) {
                cspTotal = headers[i].value.trim() + ', ' + cspTotal;
                headers.splice(i, 1);
            }
        }
        headers.push({
            name: 'Content-Security-Policy-Report-Only',
            value: cspTotal
        });
    }

    return { responseHeaders: headers };
};

/******************************************************************************/

// https://bugzilla.mozilla.org/show_bug.cgi?id=1302667
// https://github.com/gorhill/uMatrix/issues/967#issuecomment-373002011

window.addEventListener('webextFlavor', function() {
    if ( vAPI.webextFlavor.soup.has('firefox') === false ) { return; }
    if ( vAPI.webextFlavor.major <= 57 ) {
        µMatrix.cspNoWorker =
            "child-src 'none'; frame-src data: blob: *; report-uri about:blank";
    }
    if ( vAPI.webextFlavor.major <= 58 ) {
        µMatrix.cantMergeCSPHeaders = true;
    }
}, { once: true });

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

// Extract request type from content headers.

let typeFromHeaders = function(headers) {
    let i = headerIndexFromName('content-type', headers);
    if ( i === -1 ) { return; }
    let mime = headers[i].value.toLowerCase();
    if ( mime.startsWith('image/') ) { return 'image'; }
    if ( mime.startsWith('video/') || mime.startsWith('audio/') ) {
        return 'media';
    }
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

/*******************************************************************************

 Use a `http-equiv` `meta` tag to enforce CSP directives for documents
 which protocol is `file:` (which do not cause our webRequest.onHeadersReceived
 handler to be called).

 Idea borrowed from NoScript:
 https://github.com/hackademix/noscript/commit/6e80d3f130773fc9a9123c5c4c2e97d63e90fa2a

**/

(function() {
    if (
        typeof self.browser !== 'object' ||
        typeof browser.contentScripts !== 'object'
    ) {
        return;
    }

    let csRules = [
        {
            name: 'script',
            file: '/js/contentscript-no-inline-script.js',
            pending: undefined,
            registered: undefined,
            mustRegister: false
        },
    ];

    let csSwitches = [
        {
            name: 'no-workers',
            file: '/js/contentscript-no-workers.js',
            pending: undefined,
            registered: undefined,
            mustRegister: false
        },
    ];

    let register = function(entry) {
        if ( entry.pending !== undefined ) { return; }
        entry.pending = browser.contentScripts.register({
            js: [ { file: entry.file } ],
            matches: [ 'file:///*' ],
            runAt: 'document_start'
        }).then(
            result => {
                if ( entry.mustRegister ) {
                    entry.registered = result;
                }
                entry.pending = undefined;
            },
            ( ) => {
                entry.registered = undefined;
                entry.pending = undefined;
            }
        );
    };

    let unregister = function(entry) {
        if ( entry.registered === undefined ) { return; }
        entry.registered.unregister();
        entry.registered = undefined;
    };

    let handler = function(ev) {
        let matrix = ev && ev.detail;
        if ( matrix !== µMatrix.tMatrix ) { return; }
        for ( let cs of csRules ) {
            cs.mustRegister = matrix.mustBlock('file-scheme', 'file-scheme', cs.name);
            if ( cs.mustRegister === (cs.registered !== undefined) ) { continue; }
            if ( cs.mustRegister ) {
                register(cs);
            } else {
                unregister(cs);
            }
        }
        for ( let cs of csSwitches ) {
            cs.mustRegister = matrix.evaluateSwitchZ(cs.name, 'file-scheme');
            if ( cs.mustRegister === (cs.registered !== undefined) ) { continue; }
            if ( cs.mustRegister ) {
                register(cs);
            } else {
                unregister(cs);
            }
        }
    };

    window.addEventListener('matrixRulesetChange', handler);
})();

/******************************************************************************/

const start = (function() {
    if (
        vAPI.net.onBeforeReady instanceof Object &&
        (
            vAPI.net.onBeforeReady.experimental !== true ||
            µMatrix.rawSettings.suspendTabsUntilReady
        )
    ) {
        vAPI.net.onBeforeReady.start();
    }

    return function() {
        vAPI.net.addListener(
            'onBeforeRequest',
            onBeforeRequestHandler,
            { },
            [ 'blocking' ]
        );

        // https://github.com/uBlockOrigin/uMatrix-issues/issues/74#issuecomment-450687707
        // https://groups.google.com/a/chromium.org/forum/#!topic/chromium-extensions/vYIaeezZwfQ
        //   Chromium 72+: use `extraHeaders` to keep the ability to access
        //   the `Cookie`, `Referer` headers.
        const beforeSendHeadersExtra = [ 'blocking', 'requestHeaders' ];
        const wrObsho = browser.webRequest.OnBeforeSendHeadersOptions;
        if (
            wrObsho instanceof Object &&
            wrObsho.hasOwnProperty('EXTRA_HEADERS')
        ) {
            beforeSendHeadersExtra.push(wrObsho.EXTRA_HEADERS);
        }
        vAPI.net.addListener(
            'onBeforeSendHeaders',
            onBeforeSendHeadersHandler,
            { },
            beforeSendHeadersExtra
        );

        vAPI.net.addListener(
            'onHeadersReceived',
            onHeadersReceivedHandler,
            { types: [ 'main_frame', 'sub_frame' ] },
            [ 'blocking', 'responseHeaders' ]
        );

        if ( vAPI.net.onBeforeReady instanceof Object ) {
            vAPI.net.onBeforeReady.stop(onBeforeRequestHandler);
        }
    };
})();

return { start };

/******************************************************************************/

})();

/******************************************************************************/

