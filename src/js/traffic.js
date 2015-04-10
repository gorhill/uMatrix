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

/* global chrome, µMatrix */
/* jshint boss: true */

/******************************************************************************/

// Start isolation from global scope

µMatrix.webRequest = (function() {

/******************************************************************************/

// The `id='uMatrix'` is important, it allows µMatrix to detect whether a
// specific data URI originates from itself.

var rootFrameReplacement = [
    '<!DOCTYPE html><html id="uMatrix">',
    '<head>',
    '<meta charset="utf-8" />',
    '<style>',
    '@font-face {',
    'font-family:httpsb;',
    'font-style:normal;',
    'font-weight:400;',
    'src: local("httpsb"),url("',
    µMatrix.fontCSSURL,
    '") format("truetype");',
    '}',
    'body {',
    'margin:0;',
    'border:0;',
    'padding:0;',
    'font:15px httpsb,sans-serif;',
    'width:100%;',
    'height:100%;',
    'background-color:transparent;',
    'background-size:10px 10px;',
    'background-image:',
    'repeating-linear-gradient(',
    '-45deg,',
    'rgba(204,0,0,0.5),rgba(204,0,0,0.5) 24%,',
    'transparent 26%,transparent 49%,',
    'rgba(204,0,0,0.5) 51%,rgba(204,0,0,0.5) 74%,',
    'transparent 76%,transparent',
    ');',
    'text-align: center;',
    '}',
    '#p {',
    'margin:8px;',
    'padding:4px;',
    'display:inline-block;',
    'background-color:white;',
    '}',
    '#t {',
    'margin:2px;',
    'border:0;',
    'padding:0 2px;',
    'display:inline-block;',
    '}',
    '#t b {',
    'padding:0 4px;',
    'background-color:#eee;',
    'font-weight:normal;',
    '}',
    '</style>',
    '<link href="{{cssURL}}?url={{originalURL}}&hostname={{hostname}}&t={{now}}" rel="stylesheet" type="text/css">',
    '<title>Blocked by &mu;Matrix</title>',
    '</head>',
    '<body>',
    '<div id="p">',
    '<div id="t"><b>{{hostname}}</b> blocked by &mu;Matrix</div>',
    '</div>',
    '</body>',
    '</html>'
].join('');

var subFrameReplacement = [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8" />',
    '<style>',
    '@font-face{',
    'font-family:httpsb;',
    'font-style:normal;',
    'font-weight:400;',
    'src:local("httpsb"),url("',
    µMatrix.fontCSSURL,
    '") format("truetype");',
    '}',
    'body{',
    'margin:0;',
    'border:0;',
    'padding:0;',
    'font:13px httpsb,sans-serif;',
    '}',
    '#bg{',
    'border:1px dotted {{subframeColor}};',
    'position:absolute;',
    'top:0;',
    'right:0;',
    'bottom:0;',
    'left:0;',
    'background-color:transparent;',
    'background-size:10px 10px;',
    'background-image:',
    'repeating-linear-gradient(',
    '-45deg,',
    '{{subframeColor}},{{subframeColor}} 24%,',
    'transparent 25%,transparent 49%,',
    '{{subframeColor}} 50%,{{subframeColor}} 74%,',
    'transparent 75%,transparent',
    ');',
    'opacity:{{subframeOpacity}};',
    'text-align:center;',
    '}',
    '#bg > div{',
    'display:inline-block;',
    'background-color:rgba(255,255,255,1);',
    '}',
    '#bg > div > a {',
    'padding:0 2px;',
    'display:inline-block;',
    'color:white;',
    'background-color:{{subframeColor}};',
    'text-decoration:none;',
    '}',
    '</style>',
    '<title>Blocked by &mu;Matrix</title>',
    '</head>',
    '<body title="&ldquo;{{hostname}}&rdquo; frame\nblocked by &mu;Matrix">',
    '<div id="bg"><div><a href="{{frameSrc}}" target="_blank">{{hostname}}</a></div></div>',
    '</body>',
    '</html>'
].join('');

/******************************************************************************/

// If it is HTTP Switchboard's root frame replacement URL, verify that
// the page that was blacklisted is still blacklisted, and if not,
// redirect to the previously blacklisted page.

var onBeforeChromeExtensionRequestHandler = function(details) {
    var requestURL = details.url;

    // console.debug('onBeforeChromeExtensionRequestHandler()> "%s": %o', details.url, details);

    // rhill 2013-12-10: Avoid regex whenever a faster indexOf() can be used:
    // here we can use fast indexOf() as a first filter -- which is executed
    // for every single request (so speed matters).
    var matches = requestURL.match(/url=([^&]+)&hostname=([^&]+)/);
    if ( !matches ) {
        return;
    }

    var µm = µMatrix;
    var pageURL = decodeURIComponent(matches[1]);
    var pageHostname = decodeURIComponent(matches[2]);

    // Blacklisted as per matrix?
    if ( µm.mustBlock(µm.scopeFromURL(pageURL), pageHostname, 'doc') ) {
        return;
    }

    µMatrix.asyncJobs.add(
        'gotoURL-' + details.tabId,
        { tabId: details.tabId, url: pageURL },
        µm.utils.gotoURL,
        200,
        false
    );
};

/******************************************************************************/

// Intercept and filter web requests according to white and black lists.

var onBeforeRootFrameRequestHandler = function(details) {
    var µm = µMatrix;

    // Do not ignore traffic outside tabs
    var tabId = details.tabId;
    if ( tabId < 0 ) {
        tabId = µm.behindTheSceneTabId;
    }
    // It's a root frame, bind to a new page store
    else {
        µm.bindTabToPageStats(tabId, details.url);
    }

    var uri = µm.URI.set(details.url);
    if ( uri.scheme.indexOf('http') === -1 ) {
        return;
    }

    var requestURL = uri.normalizedURI();
    var requestHostname = uri.hostname;
    var pageStore = µm.pageStatsFromTabId(tabId);

    // Disallow request as per matrix?
    var block = µm.mustBlock(pageStore.pageHostname, requestHostname, 'doc');

    // console.debug('onBeforeRequestHandler()> block=%s "%s": %o', block, details.url, details);

    // whitelisted?
    if ( !block ) {
        // rhill 2013-11-07: Senseless to do this for behind-the-scene requests.
        // rhill 2013-12-03: Do this here only for root frames.
        if ( tabId !== µm.behindTheSceneTabId ) {
            µm.cookieHunter.recordPageCookies(pageStore);
        }
        return;
    }

    // blacklisted

    // rhill 2014-01-15: Delay logging of non-blocked top `main_frame`
    // requests, in order to ensure any potential redirects is reported
    // in proper chronological order.
    // https://github.com/gorhill/httpswitchboard/issues/112
    pageStore.recordRequest('doc', requestURL, block);

    µm.updateBadgeAsync(tabId);

    // If it's a blacklisted frame, redirect to frame.html
    // rhill 2013-11-05: The root frame contains a link to noop.css, this
    // allows to later check whether the root frame has been unblocked by the
    // user, in which case we are able to force a reload using a redirect.
    var html = rootFrameReplacement;
    html = html.replace('{{cssURL}}', µm.noopCSSURL);
    html = html.replace(/{{hostname}}/g, encodeURIComponent(requestHostname));
    html = html.replace('{{originalURL}}', encodeURIComponent(requestURL));
    html = html.replace('{{now}}', String(Date.now()));
    var dataURI = 'data:text/html;base64,' + btoa(html);

    return { 'redirectUrl': dataURI };
};

/******************************************************************************/

// Intercept and filter web requests according to white and black lists.

var onBeforeRequestHandler = function(details) {
    var µm = µMatrix;
    var µmuri = µm.URI.set(details.url);
    var requestScheme = µmuri.scheme;

    // rhill 2014-02-17: Ignore 'filesystem:': this can happen when listening
    // to 'chrome-extension://'.
    if ( requestScheme === 'filesystem' ) {
        return;
    }

    // console.debug('onBeforeRequestHandler()> "%s": %o', details.url, details);

    var requestType = requestTypeNormalizer[details.type];

    // https://github.com/gorhill/httpswitchboard/issues/303
    // Wherever the main doc comes from, create a receiver page URL: synthetize
    // one if needed.
    if ( requestType === 'doc' && details.parentFrameId < 0 ) {
        return onBeforeRootFrameRequestHandler(details);
    }

    var requestURL = details.url;

    // Is it µMatrix's noop css file?
    if ( requestType === 'css' && requestURL.slice(0, µm.noopCSSURL.length) === µm.noopCSSURL ) {
        return onBeforeChromeExtensionRequestHandler(details);
    }

    // Ignore non-http schemes
    if ( requestScheme.indexOf('http') !== 0 ) {
        return;
    }

    // Do not block myself from updating assets
    // https://github.com/gorhill/httpswitchboard/issues/202
    if ( requestType === 'xhr' && requestURL.slice(0, µm.projectServerRoot.length) === µm.projectServerRoot ) {
        return;
    }

    var requestHostname = µmuri.hostname;

    // rhill 2013-12-15:
    // Try to transpose generic `other` category into something more
    // meaningful.
    if ( requestType === 'other' ) {
        requestType = µm.transposeType(requestType, µmuri.path);
    }

    // Re-classify orphan HTTP requests as behind-the-scene requests. There is
    // not much else which can be done, because there are URLs
    // which cannot be handled by µMatrix, i.e. `opera://startpage`,
    // as this would lead to complications with no obvious solution, like how
    // to scope on unknown scheme? Etc.
    // https://github.com/gorhill/httpswitchboard/issues/191
    // https://github.com/gorhill/httpswitchboard/issues/91#issuecomment-37180275
    var tabId = details.tabId;
    var pageStore = µm.pageStatsFromTabId(tabId);
    if ( !pageStore ) {
        pageStore = µm.pageStatsFromTabId(µm.behindTheSceneTabId);
    }

    // Disallow request as per temporary matrix?
    var block = µm.mustBlock(pageStore.pageHostname, requestHostname, requestType);

    // Record request.
    // https://github.com/gorhill/httpswitchboard/issues/342
    // The way requests are handled now, it may happen at this point some
    // processing has already been performed, and that a synthetic URL has
    // been constructed for logging purpose. Use this synthetic URL if
    // it is available.
    pageStore.recordRequest(requestType, requestURL, block);

    µm.updateBadgeAsync(tabId);

    // whitelisted?
    if ( !block ) {
        // console.debug('onBeforeRequestHandler()> ALLOW "%s": %o', details.url, details);
        return;
    }

    // blacklisted
    // console.debug('onBeforeRequestHandler()> BLOCK "%s": %o', details.url, details);

    // If it's a blacklisted frame, redirect to frame.html
    // rhill 2013-11-05: The root frame contains a link to noop.css, this
    // allows to later check whether the root frame has been unblocked by the
    // user, in which case we are able to force a reload using a redirect.
    if ( requestType === 'frame' ) {
        var html = subFrameReplacement
            .replace(/{{hostname}}/g, requestHostname)
            .replace('{{frameSrc}}', requestURL)
            .replace(/{{subframeColor}}/g, µm.userSettings.subframeColor)
            .replace('{{subframeOpacity}}', (µm.userSettings.subframeOpacity / 100).toFixed(1));
        return { 'redirectUrl': 'data:text/html,' + encodeURIComponent(html) };
    }

    return { 'cancel': true };
};

/******************************************************************************/

// This is where tabless requests are processed, as here there may be a chance
// we can bind a request to a specific tab, as headers may contain useful
// information to accomplish this.
//
// Also we sanitize outgoing headers as per user settings.

var onBeforeSendHeadersHandler = function(details) {

    var µm = µMatrix;

    // console.debug('onBeforeSendHeadersHandler()> "%s": %o', details.url, details);

    // Re-classify orphan HTTP requests as behind-the-scene requests. There is
    // not much else which can be done, because there are URLs
    // which cannot be handled by HTTP Switchboard, i.e. `opera://startpage`,
    // as this would lead to complications with no obvious solution, like how
    // to scope on unknown scheme? Etc.
    // https://github.com/gorhill/httpswitchboard/issues/191
    // https://github.com/gorhill/httpswitchboard/issues/91#issuecomment-37180275
    var tabId = details.tabId;
    var pageStore = µm.pageStatsFromTabId(tabId);
    if ( !pageStore ) {
        tabId = µm.behindTheSceneTabId;
        pageStore = µm.pageStatsFromTabId(tabId);
    }

    // https://github.com/gorhill/httpswitchboard/issues/342
    // Is this hyperlink auditing?
    // If yes, create a synthetic URL for reporting hyperlink auditing
    // in request log. This way the user is better informed of what went
    // on.
    var requestURL = details.url;
    var requestType = requestTypeNormalizer[details.type];
    if ( requestType === 'other' ) {
        var linkAuditor = hyperlinkAuditorFromHeaders(details.requestHeaders);
        if ( linkAuditor ) {
            var block = µm.userSettings.processHyperlinkAuditing;
            pageStore.recordRequest('other', requestURL + '{Ping-To:' + linkAuditor + '}', block);
            µm.updateBadgeAsync(tabId);
            if ( block ) {
                µm.hyperlinkAuditingFoiledCounter += 1;
                return { 'cancel': true };
            }
        }
    }

    // If we reach this point, request is not blocked, so what is left to do
    // is to sanitize headers.

    var reqHostname = µm.hostnameFromURL(requestURL);
    var changed = false;

    if ( µm.mustBlock(pageStore.pageHostname, reqHostname, 'cookie') ) {
        changed = foilCookieHeaders(µm, details) || changed;
    }

    if ( µm.tMatrix.evaluateSwitchZ('referrer-spoof', pageStore.pageHostname) ) {
        changed = foilRefererHeaders(µm, reqHostname, details) || changed;
    }

    if ( µm.tMatrix.evaluateSwitchZ('ua-spoof', pageStore.pageHostname) ) {
        changed = foilUserAgent(µm, details) || changed;
        // https://github.com/gorhill/httpswitchboard/issues/252
        // To avoid potential mismatch between the user agent from HTTP headers
        // and the user agent from subrequests and the window.navigator object,
        // I could always store here the effective user agent, but I am really
        // not convinced it is worth the added overhead given the low
        // probability and the benign consequence if it ever happen. Can always
        // be revised if ever I become aware a mismatch is a terrible thing
    }

    if ( changed ) {
        // console.debug('onBeforeSendHeadersHandler()> CHANGED "%s": %o', requestURL, details);
        return { requestHeaders: details.requestHeaders };
    }
};

/******************************************************************************/

// http://www.whatwg.org/specs/web-apps/current-work/multipage/links.html#hyperlink-auditing
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

var hyperlinkAuditorFromHeaders = function(headers) {
    var i = headers.length;
    while ( i-- ) {
        if ( headers[i].name.toLowerCase() === 'ping-to' ) {
            return headers[i].value;
        }
    }
    return;
};

/******************************************************************************/

var foilCookieHeaders = function(µm, details) {
    var changed = false;
    var headers = details.requestHeaders;
    var header;
    var i = headers.length;
    while ( i-- ) {
        header = headers[i];
        if ( header.name.toLowerCase() !== 'cookie' ) {
            continue;
        }
        // console.debug('foilCookieHeaders()> foiled browser attempt to send cookie(s) to "%s"', details.url);
        headers.splice(i, 1);
        µm.cookieHeaderFoiledCounter++;
        changed = true;
    }
    return changed;
};

/******************************************************************************/

var foilRefererHeaders = function(µm, toHostname, details) {
    var headers = details.requestHeaders;
    var i = headers.length, header;
    while ( i-- ) {
        header = headers[i];
        if ( header.name.toLowerCase() === 'referer' ) {
            break;
        }
    }
    if ( i === -1 ) {
        return false;
    }
    var µmuri = µm.URI;
    var fromDomain = µmuri.domainFromURI(header.value);
    var toDomain = µmuri.domainFromHostname(toHostname);
    if ( toDomain === fromDomain ) {
        return false;
    }
    //console.debug('foilRefererHeaders()> foiled referer for "%s"', details.url);
    //console.debug('\treferrer "%s"', header.value);
    // https://github.com/gorhill/httpswitchboard/issues/222#issuecomment-44828402
    header.value = µmuri.schemeFromURI(details.url) + '://' + toHostname + '/';
    //console.debug('\treplaced with "%s"', header.value);
    µm.refererHeaderFoiledCounter++;
    return true;
};

/******************************************************************************/

var foilUserAgent = function(µm, details) {
    var headers = details.requestHeaders;
    var header;
    var i = 0;
    while ( header = headers[i] ) {
        if ( header.name.toLowerCase() === 'user-agent' ) {
            header.value = µm.userAgentReplaceStr;
            return true; // Assuming only one `user-agent` entry
        }
        i += 1;
    }
    return false;
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
    if ( details.url.slice(0, 4) !== 'http' ) {
        return;
    }

    var requestType = requestTypeNormalizer[details.type];
    if ( requestType === 'frame' ) {
        return onSubDocHeadersReceived(details);
    }
    if ( requestType === 'doc' ) {
        return onMainDocHeadersReceived(details);
    }
};

/******************************************************************************/

var onMainDocHeadersReceived = function(details) {

    // console.debug('onMainDocHeadersReceived()> "%s": %o', details.url, details);

    var µm = µMatrix;

    // Do not ignore traffic outside tabs.
    // https://github.com/gorhill/httpswitchboard/issues/91#issuecomment-37180275
    var tabId = details.tabId;
    if ( tabId < 0 ) {
        tabId = µm.behindTheSceneTabId;
    }

    var µmuri = µm.URI.set(details.url);
    var requestURL = µmuri.normalizedURI();
    var requestScheme = µmuri.scheme;
    var requestHostname = µmuri.hostname;

    // rhill 2013-12-07:
    // Apparently in Opera, onBeforeRequest() is triggered while the
    // URL is not yet bound to a tab (-1), which caused the code here
    // to not be able to lookup the pageStats. So let the code here bind
    // the page to a tab if not done yet.
    // https://github.com/gorhill/httpswitchboard/issues/75
    µm.bindTabToPageStats(tabId, requestURL);

    // Re-classify orphan HTTP requests as behind-the-scene requests. There is
    // not much else which can be done, because there are URLs
    // which cannot be handled by HTTP Switchboard, i.e. `opera://startpage`,
    // as this would lead to complications with no obvious solution, like how
    // to scope on unknown scheme? Etc.
    // https://github.com/gorhill/httpswitchboard/issues/191
    // https://github.com/gorhill/httpswitchboard/issues/91#issuecomment-37180275
    var pageStats = µm.pageStatsFromTabId(tabId);
    if ( !pageStats ) {
        tabId = µm.behindTheSceneTabId;
        pageStats = µm.pageStatsFromTabId(tabId);
    }

    var headers = details.responseHeaders;

    // Simplify code paths by splitting func in two different handlers, one
    // for main docs, one for sub docs.
    // rhill 2014-01-15: Report redirects.
    // https://github.com/gorhill/httpswitchboard/issues/112
    // rhill 2014-02-10: Handle all redirects.
    // https://github.com/gorhill/httpswitchboard/issues/188
    if ( /\s+30[12378]\s+/.test(details.statusLine) ) {
        var i = headerIndexFromName('location', headers);
        if ( i >= 0 ) {
            // rhill 2014-01-20: Be ready to handle relative URLs.
            // https://github.com/gorhill/httpswitchboard/issues/162
            var locationURL = µmuri.set(headers[i].value.trim()).normalizedURI();
            if ( µmuri.authority === '' ) {
                locationURL = requestScheme + '://' + requestHostname + µmuri.path;
            }
            µm.redirectRequests[locationURL] = requestURL;
        }
        // console.debug('onMainDocHeadersReceived()> redirect "%s" to "%s"', requestURL, headers[i].value);
    }

    // rhill 2014-01-15: Report redirects if any.
    // https://github.com/gorhill/httpswitchboard/issues/112
    if ( details.statusLine.indexOf(' 200') > 0 ) {
        var mainFrameStack = [requestURL];
        var destinationURL = requestURL;
        var sourceURL;
        while ( sourceURL = µm.redirectRequests[destinationURL] ) {
            mainFrameStack.push(sourceURL);
            delete µm.redirectRequests[destinationURL];
            destinationURL = sourceURL;
        }

        while ( destinationURL = mainFrameStack.pop() ) {
            pageStats.recordRequest('doc', destinationURL, false);
        }
        µm.updateBadgeAsync(tabId);
    }

    // Maybe modify inbound headers
    var csp = '';

    // Enforce strict HTTPS?
    if ( requestScheme === 'https' && µm.tMatrix.evaluateSwitchZ('https-strict', pageStats.pageHostname) ) {
        csp += "default-src chrome-search: data: https: wss: 'unsafe-eval' 'unsafe-inline';";
    }

    // https://github.com/gorhill/httpswitchboard/issues/181
    pageStats.pageScriptBlocked = µm.mustBlock(pageStats.pageHostname, requestHostname, 'script');
    if ( pageStats.pageScriptBlocked ) {
        // If javascript not allowed, say so through a `Content-Security-Policy` directive.
        // console.debug('onMainDocHeadersReceived()> PAGE CSP "%s": %o', details.url, details);
        csp += " script-src 'none'";
    }

    // https://github.com/gorhill/httpswitchboard/issues/181
    if ( csp !== '' ) {
        headers.push({
            'name': 'Content-Security-Policy',
            'value': csp.trim()
        });
        return { responseHeaders: headers };
    }
};

/******************************************************************************/

var onSubDocHeadersReceived = function(details) {

    // console.debug('onSubDocHeadersReceived()> "%s": %o', details.url, details);

    var µm = µMatrix;

    // Do not ignore traffic outside tabs.
    // https://github.com/gorhill/httpswitchboard/issues/91#issuecomment-37180275
    var tabId = details.tabId;
    if ( tabId < 0 ) {
        tabId = µm.behindTheSceneTabId;
    }

    // Re-classify orphan HTTP requests as behind-the-scene requests. There is
    // not much else which can be done, because there are URLs
    // which cannot be handled by HTTP Switchboard, i.e. `opera://startpage`,
    // as this would lead to complications with no obvious solution, like how
    // to scope on unknown scheme? Etc.
    // https://github.com/gorhill/httpswitchboard/issues/191
    // https://github.com/gorhill/httpswitchboard/issues/91#issuecomment-37180275
    var pageStats = µm.pageStatsFromTabId(tabId);
    if ( !pageStats ) {
        tabId = µm.behindTheSceneTabId;
        pageStats = µm.pageStatsFromTabId(tabId);
    }

    // Evaluate
    if ( µm.mustAllow(pageStats.pageHostname, µm.hostnameFromURL(details.url), 'script') ) {
        return;
    }

    // If javascript not allowed, say so through a `Content-Security-Policy`
    // directive.

    // For inline javascript within iframes, we need to sandbox.

    // https://github.com/gorhill/httpswitchboard/issues/73
    // Now because sandbox cancels all permissions, this means
    // not just javascript is disabled. To avoid negative side
    // effects, I allow some other permissions, but...

    // https://github.com/gorhill/uMatrix/issues/27
    // Need to add `allow-popups` to prevent completely breaking links on
    // some sites old style sites.

    // TODO: Reuse CSP `sandbox` directive if it's already in the
    // headers (strip out `allow-scripts` if present),
    // and find out if the `sandbox` in the header interfere with a
    // `sandbox` attribute which might be present on the iframe.

    // console.debug('onSubDocHeadersReceived()> FRAME CSP "%s": %o, scope="%s"', details.url, details, pageURL);

    details.responseHeaders.push({
        'name': 'Content-Security-Policy',
        'value': 'sandbox allow-forms allow-same-origin allow-popups allow-top-navigation'
    });

    return { responseHeaders: details.responseHeaders };
};

/******************************************************************************/

// As per Chrome API doc, webRequest.onErrorOccurred event is the last
// one called in the sequence of webRequest events.
// http://developer.chrome.com/extensions/webRequest.html

var onErrorOccurredHandler = function(details) {
    // console.debug('onErrorOccurred()> "%s": %o', details.url, details);
    var requestType = requestTypeNormalizer[details.type];

    // Ignore all that is not a main document
    if ( requestType !== 'doc'|| details.parentFrameId >= 0 ) {
        return;
    }

    var µm = µMatrix;
    var pageStats = µm.pageStatsFromPageUrl(details.url);
    if ( !pageStats ) {
        return;
    }

    // rhill 2014-01-28: Unwind the stack of redirects if any. Chromium will
    // emit an error when a web page redirects apparently endlessly, so
    //  we need to unravel and report all these redirects upon error.
    // https://github.com/gorhill/httpswitchboard/issues/171
    var requestURL = µm.URI.set(details.url).normalizedURI();
    var mainFrameStack = [requestURL];
    var destinationURL = requestURL;
    var sourceURL;
    while ( sourceURL = µm.redirectRequests[destinationURL] ) {
        mainFrameStack.push(sourceURL);
        delete µm.redirectRequests[destinationURL];
        destinationURL = sourceURL;
    }

    while ( destinationURL = mainFrameStack.pop() ) {
        pageStats.recordRequest('doc', destinationURL, false);
    }
    µm.updateBadgeAsync(details.tabId);
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
    'main_frame'    : 'doc',
    'sub_frame'     : 'frame',
    'stylesheet'    : 'css',
    'script'        : 'script',
    'image'         : 'image',
    'object'        : 'plugin',
    'xmlhttprequest': 'xhr',
    'other'         : 'other'
};

/******************************************************************************/

var start = function() {
    chrome.webRequest.onBeforeRequest.addListener(
        //function(details) {
        //    quickProfiler.start('onBeforeRequest');
        //    var r = onBeforeRequestHandler(details);
        //    quickProfiler.stop();
        //    return r;
        //},
        onBeforeRequestHandler,
        {
            "urls": [
                "http://*/*",
                "https://*/*",
                "chrome-extension://*/*"
            ],
            "types": [
                "main_frame",
                "sub_frame",
                'stylesheet',
                "script",
                "image",
                "object",
                "xmlhttprequest",
                "other"
            ]
        },
        [ "blocking" ]
    );

    //console.log('µMatrix > Beginning to intercept net requests at %s', (new Date()).toISOString());

    chrome.webRequest.onBeforeSendHeaders.addListener(
        onBeforeSendHeadersHandler,
        {
            'urls': [
                "http://*/*",
                "https://*/*"
            ]
        },
        ['blocking', 'requestHeaders']
    );

    chrome.webRequest.onHeadersReceived.addListener(
        onHeadersReceived,
        {
            'urls': [
                "http://*/*",
                "https://*/*"
            ]
        },
        ['blocking', 'responseHeaders']
    );

    chrome.webRequest.onErrorOccurred.addListener(
        onErrorOccurredHandler,
        {
            'urls': [
                "http://*/*",
                "https://*/*"
            ]
        }
    );
};

/******************************************************************************/

return {
    blockedRootFramePrefix: 'data:text/html;base64,' + btoa(rootFrameReplacement).slice(0, 80),
    start: start
};

/******************************************************************************/

})();

/******************************************************************************/

