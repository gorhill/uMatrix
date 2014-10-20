/*******************************************************************************

    µMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2014 Raymond Hill

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

/******************************************************************************/
/******************************************************************************/

(function() {

// popup.js

var µm = µMatrix;

/******************************************************************************/

var smartReload = function(tabs) {
    var i = tabs.length;
    while ( i-- ) {
        µm.smartReloadTabs(µm.userSettings.smartAutoReload, tabs[i].id);
    }
};

/******************************************************************************/

// Constructor is faster than object literal

var RowSnapshot = function(srcHostname, desHostname, desDomain) {
    this.domain = desDomain;
    this.temporary = µm.tMatrix.evaluateRowZXY(srcHostname, desHostname);
    this.permanent = µm.pMatrix.evaluateRowZXY(srcHostname, desHostname);
    this.counts = RowSnapshot.counts.slice();
    this.totals = RowSnapshot.counts.slice();
};

RowSnapshot.counts = (function() {
    var i = Object.keys(µm.Matrix.getColumnHeaders()).length;
    var aa = new Array(i);
    while ( i-- ) {
        aa[i] = 0;
    }
    return aa;
})();

/******************************************************************************/

var matrixSnapshot = function(details) {
    var r = {
        tabId: details.tabId,
        url: '',
        hostname: '',
        domain: '',
        scopeLevel: µm.userSettings.scopeLevel,
        scope: '*',
        headers: µm.Matrix.getColumnHeaders(),
        tSwitch: false,
        pSwitch: false,
        rows: {},
        rowCount: 0,
        diff: []
    };
/*
    // Allow to scope on behind-the-scene virtual tab
    if ( tab.url.indexOf('chrome-extension://' + chrome.runtime.id + '/') === 0 ) {
        targetTabId = µm.behindTheSceneTabId;
        targetPageURL = µm.behindTheSceneURL;
    } else {
        targetTabId = tab.id;
        targetPageURL = µm.pageUrlFromTabId(targetTabId);
    }
*/
    var pageStore = µm.pageStatsFromTabId(details.tabId);
    if ( !pageStore ) {
        return r;
    }

    var headers = r.headers;

    r.url = pageStore.pageUrl;
    r.hostname = pageStore.pageHostname;
    r.domain = pageStore.pageDomain;

    if ( r.scopeLevel === 'site' ) {
        r.scope = r.hostname;
    } else if ( r.scopeLevel === 'domain' ) {
        r.scope = r.domain;
    }

    r.tSwitch = µm.tMatrix.evaluateSwitchZ(r.scope);
    r.pSwitch = µm.pMatrix.evaluateSwitchZ(r.scope);

    // This one always exist
    r.rows['*'] = new RowSnapshot(r.scope, '*', '*');
    r.rowCount += 1;

    var µmuri = µm.URI;
    var reqKey, reqType, reqHostname, reqDomain;
    var desHostname;
    var row, typeIndex;
    var anyIndex = headers['*'];

    var pageRequests = pageStore.requests;
    var reqKeys = pageRequests.getRequestKeys();
    var iReqKey = reqKeys.length;
    var pos;

    while ( iReqKey-- ) {
        reqKey = reqKeys[iReqKey];
        reqType = pageRequests.typeFromRequestKey(reqKey);
        reqHostname = pageRequests.hostnameFromRequestKey(reqKey);
        // rhill 2013-10-23: hostname can be empty if the request is a data url
        // https://github.com/gorhill/httpswitchboard/issues/26
        if ( reqHostname === '' ) {
            reqHostname = pageStore.pageHostname;
        }
        reqDomain = µmuri.domainFromHostname(reqHostname) || reqHostname;

        // We want rows of self and ancestors
        desHostname = reqHostname;
        for ( ;; ) {
            // If row exists, ancestors exist
            if ( r.rows.hasOwnProperty(desHostname) !== false ) {
                break;
            }
            r.rows[desHostname] = new RowSnapshot(r.scope, desHostname, reqDomain);
            r.rowCount += 1;
            if ( desHostname === reqDomain ) {
                break;
            }
            pos = desHostname.indexOf('.');
            if ( pos === -1 ) {
                break;
            }
            desHostname = desHostname.slice(pos + 1);
        }

        typeIndex = headers[reqType];

        row = r.rows[reqHostname];
        row.counts[typeIndex] += 1;
        row.counts[anyIndex] += 1;

        if ( reqDomain !== reqHostname ) {
            row = r.rows[reqDomain];
            row.totals[typeIndex] += 1;
            row.totals[anyIndex] += 1;
        }

        row = r.rows['*'];
        row.totals[typeIndex] += 1;
        row.totals[anyIndex] += 1;
    }

    r.diff = µm.tMatrix.diff(µm.pMatrix, r.hostname, Object.keys(r.rows));

    return r;
};

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
        default:
            break;
    }

    // Sync
    var response;

    switch ( request.what ) {
        case 'disconnected':
            // https://github.com/gorhill/httpswitchboard/issues/94
            if ( µm.userSettings.smartAutoReload ) {
                chrome.tabs.query({ active: true }, smartReload);
            }
            break;

        case 'matrixSnapshot':
            response = matrixSnapshot(request);
            break;

        case 'applyDiffToPermanentMatrix': // aka "persist"
            if ( µm.pMatrix.applyDiff(request.diff, µm.tMatrix) ) {
                µm.saveMatrix();
            }
            break;

        case 'applyDiffToTemporaryMatrix': // aka "revert"
            µm.tMatrix.applyDiff(request.diff, µm.pMatrix);
            break;

        case 'revertTemporaryMatrix':
            µm.tMatrix.assign(µm.pMatrix);
            break;

        default:
            return µm.messaging.defaultHandler(request, sender, callback);
    }

    callback(response);
};

µm.messaging.listen('popup.js', onMessage);

})();

/******************************************************************************/
/******************************************************************************/

// content scripts

(function() {

var contentScriptSummaryHandler = function(details, sender) {
    // TODO: Investigate "Error in response to tabs.executeScript: TypeError:
    // Cannot read property 'locationURL' of null" (2013-11-12). When can this
    // happens? 
    if ( !details || !details.locationURL ) {
        return;
    }
    var µm = µMatrix;
    var pageURL = µm.pageUrlFromTabId(sender.tab.id);
    var pageStats = µm.pageStatsFromPageUrl(pageURL);
    var µmuri = µm.URI.set(details.locationURL);
    var frameURL = µmuri.normalizedURI();
    var frameHostname = µmuri.hostname;
    var urls, url, r;

    // https://github.com/gorhill/httpswitchboard/issues/333
    // Look-up here whether inline scripting is blocked for the frame.
    var inlineScriptBlocked = µm.mustBlock(µm.scopeFromURL(pageURL), frameHostname, 'script');

    // scripts
    // https://github.com/gorhill/httpswitchboard/issues/25
    if ( pageStats && inlineScriptBlocked ) {
        urls = details.scriptSources;
        for ( url in urls ) {
            if ( !urls.hasOwnProperty(url) ) {
                continue;
            }
            if ( url === '{inline_script}' ) {
                url = frameURL + '{inline_script}';
            }
            r = µm.filterRequest(pageURL, 'script', url);
            pageStats.recordRequest('script', url, r !== false, r);
        }
    }

    // TODO: as of 2014-05-26, not sure this is needed anymore, since µMatrix
    // no longer uses chrome.contentSettings API (I think that was the reason
    // this code was put in).
    // plugins
    // https://github.com/gorhill/httpswitchboard/issues/25
    if ( pageStats ) {
        urls = details.pluginSources;
        for ( url in urls ) {
            if ( !urls.hasOwnProperty(url) ) {
                continue;
            }
            r = µm.filterRequest(pageURL, 'plugin', url);
            pageStats.recordRequest('plugin', url, r !== false, r);
        }
    }

    // https://github.com/gorhill/httpswitchboard/issues/181
    µm.onPageLoadCompleted(pageURL);
};

var contentScriptLocalStorageHandler = function(pageURL) {
    var µm = µMatrix;
    var µmuri = µm.URI.set(pageURL);
    var response = µm.mustBlock(µm.scopeFromURL(pageURL), µmuri.hostname, 'cookie');
    µm.recordFromPageUrl(
        pageURL,
        'cookie',
        µmuri.rootURL() + '/{localStorage}',
        response
    );
    response = response && µm.userSettings.deleteLocalStorage;
    if ( response ) {
        µm.localStorageRemovedCounter++;
    }
    return response;
};

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
        default:
            break;
    }

    // Sync
    var response;

    switch ( request.what ) {
        case 'contentScriptHasLocalStorage':
            response = contentScriptLocalStorageHandler(request.url);
            break;

        case 'contentScriptSummary':
            contentScriptSummaryHandler(request, sender);
            break;

        case 'checkScriptBlacklisted':
            response = {
                scriptBlacklisted: µMatrix.mustBlock(
                    µMatrix.scopeFromURL(request.url),
                    µMatrix.hostnameFromURL(request.url),
                    'script'
                    )
                };
            break;

        case 'getUserAgentReplaceStr':
            response = µMatrix.userSettings.spoofUserAgent ? µMatrix.userAgentReplaceStr : undefined;
            break;


        case 'retrieveDomainCosmeticSelectors':
            response = µMatrix.abpHideFilters.retrieveDomainSelectors(request);
            break;

        case 'retrieveGenericCosmeticSelectors':
            response = µMatrix.abpHideFilters.retrieveGenericSelectors(request);
            break;

        default:
            return µMatrix.messaging.defaultHandler(request, sender, callback);
    }

    callback(response);
};

µMatrix.messaging.listen('contentscript-start.js', onMessage);
µMatrix.messaging.listen('contentscript-end.js', onMessage);

})();

/******************************************************************************/
/******************************************************************************/

// settings.js

(function() {

var onMessage = function(request, sender, callback) {
    var µm = µMatrix;

    // Async
    switch ( request.what ) {
        default:
            break;
    }

    // Sync
    var response;

    switch ( request.what ) {
        default:
            return µm.messaging.defaultHandler(request, sender, callback);
    }

    callback(response);
};

µMatrix.messaging.listen('settings.js', onMessage);

})();

/******************************************************************************/
/******************************************************************************/

// info.js

(function() {

// map(pageURL) => array of request log entries
var getRequestLog = function(pageURL) {
    var requestLogs = {};
    var pageStores = µMatrix.pageStats;
    var pageURLs = pageURL ? [pageURL] : Object.keys(pageStores);
    var pageStore, pageRequestLog, logEntries, j, logEntry;

    for ( var i = 0; i < pageURLs.length; i++ ) {
        pageURL = pageURLs[i];
        pageStore = pageStores[pageURL];
        if ( !pageStore ) {
            continue;
        }
        pageRequestLog = [];
        logEntries = pageStore.requests.getLoggedRequests();
        j = logEntries.length;
        while ( j-- ) {
            // rhill 2013-12-04: `logEntry` can be null since a ring buffer is
            // now used, and it might not have been filled yet.
            if ( logEntry = logEntries[j] ) {
                pageRequestLog.push(logEntry);
            }
        }
        requestLogs[pageURL] = pageRequestLog;
    }

    return requestLogs;
};

var onMessage = function(request, sender, callback) {
    var µm = µMatrix;

    // Async
    switch ( request.what ) {
        default:
            break;
    }

    // Sync
    var response;

    switch ( request.what ) {
        case 'getPageURLs':
            response = {
                pageURLs: Object.keys(µm.pageUrlToTabId),
                behindTheSceneURL: µm.behindTheSceneURL
            };
            break;

        case 'getStats':
            var pageStore = µm.pageStats[request.pageURL];
            response = {
                globalNetStats: µm.requestStats,
                pageNetStats: pageStore ? pageStore.requestStats : null,
                cookieHeaderFoiledCounter: µm.cookieHeaderFoiledCounter,
                refererHeaderFoiledCounter: µm.refererHeaderFoiledCounter,
                hyperlinkAuditingFoiledCounter: µm.hyperlinkAuditingFoiledCounter,
                cookieRemovedCounter: µm.cookieRemovedCounter,
                localStorageRemovedCounter: µm.localStorageRemovedCounter,
                browserCacheClearedCounter: µm.browserCacheClearedCounter,
                abpBlockCount: µm.abpBlockCount
            };
            break;

        case 'getRequestLogs':
            response = getRequestLog(request.pageURL);
            break;

        default:
            return µm.messaging.defaultHandler(request, sender, callback);
    }

    callback(response);
};

µMatrix.messaging.listen('info.js', onMessage);

})();

/******************************************************************************/
/******************************************************************************/

// ubiquitous-rules.js

(function() {

var onMessage = function(request, sender, callback) {
    var µm = µMatrix;

    // Async
    switch ( request.what ) {
        default:
            break;
    }

    // Sync
    var response;

    switch ( request.what ) {
        default:
            return µm.messaging.defaultHandler(request, sender, callback);
    }

    callback(response);
};

µMatrix.messaging.listen('ubiquitous-rules.js', onMessage);

})();

/******************************************************************************/
/******************************************************************************/

// about.js

(function() {

var onMessage = function(request, sender, callback) {
    var µm = µMatrix;

    // Async
    switch ( request.what ) {
        case 'getAssetUpdaterList':
            return µm.assetUpdater.getList(callback);

        case 'launchAssetUpdater':
            return µm.assetUpdater.update(request.list, callback);

        case 'readUserSettings':
            return chrome.storage.local.get(µm.userSettings, callback);

        default:
            break;
    }

    // Sync
    var response;

    switch ( request.what ) {
        case 'loadUpdatableAssets':
            response = µm.loadUpdatableAssets();
            break;

        case 'getSomeStats':
            response = {
                storageQuota: µm.storageQuota,
                storageUsed: µm.storageUsed
            };
            break;

        default:
            return µm.messaging.defaultHandler(request, sender, callback);
    }

    callback(response);
};

µMatrix.messaging.listen('about.js', onMessage);

})();

/******************************************************************************/
