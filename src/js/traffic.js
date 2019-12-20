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

µMatrix.webRequest = (( ) => {

/******************************************************************************/

// Intercept and filter web requests according to white and black lists.

const onBeforeRootFrameRequestHandler = function(fctxt) {
    const µm = µMatrix;
    const desURL = fctxt.url;
    const desHn = fctxt.getHostname();
    const type = fctxt.type;
    const tabId = fctxt.tabId;
    const srcHn = fctxt.getTabHostname();

    // Disallow request as per matrix?
    const blocked = µm.mustBlock(srcHn, desHn, type);

    const pageStore = µm.bindTabToPageStats(tabId);
    if ( pageStore !== null ) {
        pageStore.recordRequest(type, desURL, blocked);
        pageStore.perLoadAllowedRequestCount = 0;
        pageStore.perLoadBlockedRequestCount = 0;
        pageStore.perLoadBlockedReferrerCount = 0;
        if ( blocked !== true ) {
            µm.cookieHunter.recordPageCookies(pageStore);
        }
        if ( fctxt.aliasURL !== undefined ) {
            pageStore.hasHostnameAliases = true;
        }
    }
    if ( µm.logger.enabled ) {
        fctxt.setRealm('network').setFilter(blocked).toLogger();
    }

    // Not blocked
    if ( blocked !== true ) {
        const redirectUrl = maybeRedirectRootFrame(desHn, desURL);
        if ( redirectUrl !== desURL ) {
            return { redirectUrl };
        }
        if ( µm.tMatrix.evaluateSwitchZ('cname-reveal', srcHn) === false ) {
            return { cancel: false };
        }
        return;
    }

    // Blocked
    const query = encodeURIComponent(
        JSON.stringify({ url: desURL, hn: desHn, type, why: '?' })
    );

    vAPI.tabs.replace(tabId, vAPI.getURL('main-blocked.html?details=') + query);

    return { cancel: true };
};

/******************************************************************************/

// https://twitter.com/thatcks/status/958776519765225473

const maybeRedirectRootFrame = function(hostname, url) {
    const µm = µMatrix;
    if ( µm.rawSettings.enforceEscapedFragment !== true ) { return url; }
    const block1pScripts = µm.mustBlock(hostname, hostname, 'script');
    const reEscapedFragment = /[?&]_escaped_fragment_=/;
    if ( reEscapedFragment.test(url) ) {
        return block1pScripts ? url : url.replace(reEscapedFragment, '#!') ;
    }
    if ( block1pScripts === false ) { return url; }
    const pos = url.indexOf('#!');
    if ( pos === -1 ) { return url; }
    const separator = url.lastIndexOf('?', pos) === -1 ? '?' : '&';
    return url.slice(0, pos) +
           separator + '_escaped_fragment_=' +
           url.slice(pos + 2);
};

/******************************************************************************/

// Intercept and filter web requests according to white and black lists.

const onBeforeRequestHandler = function(details) {
    const µm = µMatrix;
    const fctxt = µm.filteringContext.fromWebrequestDetails(details);
    const µmuri = µm.URI;
    const desURL = fctxt.url;
    const desScheme = µmuri.schemeFromURI(desURL);

    if ( µmuri.isNetworkScheme(desScheme) === false ) {
        return { cancel: false };
    }

    const type = fctxt.type;

    // https://github.com/gorhill/httpswitchboard/issues/303
    // Wherever the main doc comes from, create a receiver page URL: synthetize
    // one if needed.
    if ( type === 'doc' && details.parentFrameId === -1 ) {
        return onBeforeRootFrameRequestHandler(fctxt);
    }

    // Re-classify orphan HTTP requests as behind-the-scene requests. There is
    // not much else which can be done, because there are URLs
    // which cannot be handled by µMatrix, i.e. `opera://startpage`,
    // as this would lead to complications with no obvious solution, like how
    // to scope on unknown scheme? Etc.
    // https://github.com/gorhill/httpswitchboard/issues/191
    // https://github.com/gorhill/httpswitchboard/issues/91#issuecomment-37180275
    const tabContext = µm.tabContextManager.mustLookup(details.tabId);
    const tabId = fctxt.tabId;
    const srcHn = fctxt.getTabHostname();
    const desHn = fctxt.getHostname();
    let specificity = 0;

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
    const pageStore = µm.mustPageStoreFromTabId(tabId);

    // Enforce strict secure connection?
    if ( tabContext.secure && µmuri.isSecureScheme(desScheme) === false ) {
        pageStore.hasMixedContent = true;
        if ( blocked === false ) {
            blocked = µm.tMatrix.evaluateSwitchZ('https-strict', srcHn);
        }
    }

    if ( fctxt.aliasURL !== undefined ) {
        pageStore.hasHostnameAliases = true;
    }

    pageStore.recordRequest(type, desURL, blocked);
    if ( µm.logger.enabled ) {
        fctxt.setRealm('network').setFilter(blocked).toLogger();
    }

    if ( blocked ) {
        pageStore.cacheBlockedCollapsible(type, desURL, specificity);
        return { cancel: true };
    }

    if ( µm.tMatrix.evaluateSwitchZ('cname-reveal', srcHn) === false ) {
        return { cancel: false };
    }
};

/******************************************************************************/

// Sanitize outgoing headers as per user settings.

const onBeforeSendHeadersHandler = function(details) {
    const µm = µMatrix;
    const µmuri = µm.URI;
    const fctxt = µm.filteringContext.fromWebrequestDetails(details);

    // Ignore non-network schemes
    if ( µmuri.isNetworkScheme(µmuri.schemeFromURI(fctxt.url)) === false ) {
        return;
    }

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

    if ( onBeforeSendPing(fctxt, details) ) {
        return { cancel: true };
    }

    // If we reach this point, request is not blocked, so what is left to do
    // is to sanitize headers.

    let modified = false;

    // Process `Cookie` header.

    if ( onBeforeSendCookie(fctxt, details) ) {
        modified = true;
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

    if ( onBeforeSendReferrer(fctxt, details) ) {
        modified = true;
    }

    if ( modified !== true ) { return; }

    µm.updateToolbarIcon(fctxt.tabId);

    return { requestHeaders: details.requestHeaders };
};

/******************************************************************************/

const onBeforeSendPing = function(fctxt, details) {
    const requestHeaders = details.requestHeaders;
    const iHeader = headerIndexFromName('ping-to', requestHeaders);
    if ( iHeader === -1 ) { return false; }

    const headerValue = requestHeaders[iHeader].value;
    if ( headerValue === '' ) { return false; }

    const µm = µMatrix;
    const blocked = µm.userSettings.processHyperlinkAuditing;

    const pageStore = µm.mustPageStoreFromTabId(fctxt.tabId);
    pageStore.recordRequest(
        'other',
        fctxt.url + '{Ping-To:' + headerValue + '}',
        blocked
    );

    if ( µm.logger.enabled ) {
        fctxt.setRealm('network')
             .setType('ping')
             .setFilter(blocked)
             .toLogger();
    }

    if ( blocked === false ) { return false; }

    µm.hyperlinkAuditingFoiledCounter += 1;
    return true;
};

/******************************************************************************/

const onBeforeSendCookie = function(fctxt, details) {
    const requestHeaders = details.requestHeaders;
    const iHeader = headerIndexFromName('cookie', requestHeaders);
    if ( iHeader === -1 ) { return false; }

    const µm = µMatrix;
    const blocked = µm.mustBlock(
        fctxt.getTabHostname(),
        fctxt.getHostname(),
        'cookie'
    );
    if ( blocked === false ) { return false; }

    const headerValue = requestHeaders[iHeader].value;
    requestHeaders.splice(iHeader, 1);
    µm.cookieHeaderFoiledCounter++;

    if ( fctxt.type === 'doc' ) {
        const pageStore = µm.mustPageStoreFromTabId(fctxt.tabId);
        pageStore.perLoadBlockedRequestCount++;
        if ( µm.logger.enabled ) {
            fctxt.setRealm('network')
                 .setType('COOKIE')
                 .setFilter({ value: headerValue, change: -1 })
                 .toLogger();
        }
    }

    return true;
};

/******************************************************************************/

const onBeforeSendReferrer = function(fctxt, details) {
    const requestHeaders = details.requestHeaders;
    const iHeader = headerIndexFromName('referer', requestHeaders);
    if ( iHeader === -1 ) { return false; }

    const referrer = requestHeaders[iHeader].value;
    if ( referrer === '' ) { return false; }

    const toDomain = vAPI.domainFromHostname(fctxt.getHostname());
    if ( toDomain === '' || toDomain === vAPI.domainFromURI(referrer) ) {
        return false;
    }

    const µm = µMatrix;
    const pageStore = µm.mustPageStoreFromTabId(fctxt.tabId);
    pageStore.has3pReferrer = true;

    const mustSpoof =
        µm.tMatrix.evaluateSwitchZ('referrer-spoof', fctxt.getTabHostname());
    if ( mustSpoof === false ) { return false; }

    let spoofedReferrer;
    if ( details.method === 'GET' ) {
        spoofedReferrer = requestHeaders[iHeader].value =
            fctxt.originFromURI(fctxt.url) + '/';
    } else {
        requestHeaders.splice(iHeader, 1);
    }

    if ( pageStore.perLoadBlockedReferrerCount === 0 ) {
        pageStore.perLoadBlockedRequestCount += 1;
        if ( µm.logger.enabled ) {
            fctxt.setRealm('network')
                 .setType('REFERER')
                 .setFilter({ value: referrer, change: -1 })
                 .toLogger();
            if ( spoofedReferrer !== undefined ) {
                fctxt.setRealm('network')
                     .setType('REFERER')
                     .setFilter({ value: spoofedReferrer, change: +1 })
                     .toLogger();
            }
        }
    }
    pageStore.perLoadBlockedReferrerCount += 1;

    return true;
};

/******************************************************************************/

// To prevent inline javascript from being executed.

// Prevent inline scripting using `Content-Security-Policy`:
// https://dvcs.w3.org/hg/content-security-policy/raw-file/tip/csp-specification.dev.html

// This fixes:
// https://github.com/gorhill/httpswitchboard/issues/35

const onHeadersReceivedHandler = function(details) {
    const µm = µMatrix;
    const fctxt = µm.filteringContext.fromWebrequestDetails(details);
    const requestType = fctxt.type;
    const headers = details.responseHeaders;

    // https://github.com/gorhill/uMatrix/issues/145
    // Check if the main_frame is a download
    if ( requestType === 'doc' ) {
        const contentType = typeFromHeaders(headers);
        if ( contentType !== undefined ) {
            details.type = contentType;
            return onBeforeRootFrameRequestHandler(fctxt);
        }
    }

    const csp = [];
    const cspReport = [];
    const srcHn = fctxt.getTabHostname();
    const desHn = fctxt.getHostname();

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
        const cspRight = csp.join(', ');
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
        if ( µm.logger.enabled && requestType === 'doc' ) {
            fctxt.setRealm('network')
                 .setType('CSP')
                 .setFilter({ value: cspRight, change: +1 })
                 .toLogger();
        }
    }

    if ( cspReport.length !== 0 ) {
        const cspRight = cspReport.join(', ');
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

const headerIndexFromName = function(headerName, headers) {
    let i = headers.length;
    while ( i-- ) {
        if ( headers[i].name.toLowerCase() === headerName ) {
            return i;
        }
    }
    return -1;
};

/******************************************************************************/

// Extract request type from content headers.

const typeFromHeaders = function(headers) {
    const i = headerIndexFromName('content-type', headers);
    if ( i === -1 ) { return; }
    const mime = headers[i].value.toLowerCase();
    if ( mime.startsWith('image/') ) { return 'image'; }
    if ( mime.startsWith('video/') || mime.startsWith('audio/') ) {
        return 'media';
    }
};

/*******************************************************************************

 Use a `http-equiv` `meta` tag to enforce CSP directives for documents
 which protocol is `file:` (which do not cause our webRequest.onHeadersReceived
 handler to be called).

 Idea borrowed from NoScript:
 https://github.com/hackademix/noscript/commit/6e80d3f13077

**/

(( ) => {
    if (
        typeof self.browser !== 'object' ||
        typeof browser.contentScripts !== 'object'
    ) {
        return;
    }

    const csRules = [
        {
            name: 'script',
            file: '/js/contentscript-no-inline-script.js',
            pending: undefined,
            registered: undefined,
            mustRegister: false
        },
    ];

    const csSwitches = [
        {
            name: 'no-workers',
            file: '/js/contentscript-no-workers.js',
            pending: undefined,
            registered: undefined,
            mustRegister: false
        },
    ];

    const register = function(entry) {
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

    const unregister = function(entry) {
        if ( entry.registered === undefined ) { return; }
        entry.registered.unregister();
        entry.registered = undefined;
    };

    const handler = function(ev) {
        const matrix = ev && ev.detail;
        if ( matrix !== µMatrix.tMatrix ) { return; }
        for ( const cs of csRules ) {
            cs.mustRegister = matrix.mustBlock('file-scheme', 'file-scheme', cs.name);
            if ( cs.mustRegister === (cs.registered !== undefined) ) { continue; }
            if ( cs.mustRegister ) {
                register(cs);
            } else {
                unregister(cs);
            }
        }
        for ( const cs of csSwitches ) {
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

return {
    start: (( ) => {
        vAPI.net = new vAPI.Net();

        if (
            vAPI.net.canSuspend() &&
            µMatrix.rawSettings.suspendTabsUntilReady !== 'no' ||
            vAPI.net.canSuspend() !== true &&
            µMatrix.rawSettings.suspendTabsUntilReady === 'yes'
        ) {
            vAPI.net.suspend(true);
        }

        return function() {
            vAPI.net.setSuspendableListener(onBeforeRequestHandler);
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
                {
                    types: [ 'main_frame', 'sub_frame' ],
                    urls: [ 'http://*/*', 'https://*/*' ],
                },
                [ 'blocking', 'responseHeaders' ]
            );
            vAPI.net.unsuspend(true);
        };
    })(),
};

/******************************************************************************/

})();

/******************************************************************************/

