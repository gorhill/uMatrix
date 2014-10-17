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

(function() {

// popup.js

/******************************************************************************/

var smartReload = function(tabs) {
    var µm = µMatrix;
    var i = tabs.length;
    while ( i-- ) {
        µm.smartReloadTabs(µm.userSettings.smartAutoReload, tabs[i].id);
    }
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
            if ( µMatrix.userSettings.smartAutoReload ) {
                chrome.tabs.query({ active: true }, smartReload);
            }
            break;

        default:
            return µMatrix.messaging.defaultHandler(request, sender, callback);
    }

    callback(response);
};

µMatrix.messaging.listen('popup.js', onMessage);

})();

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

// info.js

(function() {

// map(pageURL) => array of request log entries
var getRequestLog = function(pageURL) {
    var requestLogs = {};
    var pageStores = µMatrix.pageStats;
    var pageURLs = pageURL ? [pageURL] : Object.keys(pageStores);
    var pageRequestLog, logEntries, i, j, logEntry;

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
