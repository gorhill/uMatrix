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

/* global µMatrix, vAPI */
/* jshint boss: true */

/******************************************************************************/
/******************************************************************************/

// Default handler

(function() {

'use strict';

var µm = µMatrix;

/******************************************************************************/

// Default is for commonly used message.

function onMessage(request, sender, callback) {
    // Async
    switch ( request.what ) {
    case 'getAssetContent':
        return µm.assets.getLocal(request.url, callback);

    default:
        break;
    }

    // Sync
    var response;

    switch ( request.what ) {
    case 'forceReloadTab':
        µm.forceReload(request.tabId);
        break;

    case 'forceUpdateAssets':
        µm.assetUpdater.force();
        break;

    case 'getUserSettings':
        response = µm.userSettings;
        break;

    case 'gotoExtensionURL':
        µm.utils.gotoExtensionURL(request.url);
        break;

    case 'gotoURL':
        µm.utils.gotoURL(request);
        break;

    case 'mustBlock':
        response = µm.mustBlock(
            request.scope,
            request.hostname,
            request.type
        );
        break;

    case 'reloadHostsFiles':
        µm.reloadHostsFiles();
        break;

    case 'selectHostsFiles':
        µm.selectHostsFiles(request.switches);
        break;

    case 'userSettings':
        response = µm.changeUserSettings(request.name, request.value);
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
}

/******************************************************************************/

vAPI.messaging.setup(onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

(function() {

// popup.js

var µm = µMatrix;

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

var matrixSnapshot = function(tabId, details) {
    var µmuser = µm.userSettings;
    var r = {
        tabId: tabId,
        url: '',
        hostname: '',
        domain: '',
        blockedCount: 0,
        scope: '*',
        headers: µm.Matrix.getColumnHeaders(),
        tSwitches: {},
        pSwitches: {},
        rows: {},
        rowCount: 0,
        diff: [],
        userSettings: {
            colorBlindFriendly: µmuser.colorBlindFriendly,
            displayTextSize: µmuser.displayTextSize,
            popupCollapseDomains: µmuser.popupCollapseDomains,
            popupCollapseSpecificDomains: µmuser.popupCollapseSpecificDomains,
            popupHideBlacklisted: µmuser.popupHideBlacklisted,
            popupScopeLevel: µmuser.popupScopeLevel
        }
    };

    var tabContext = µm.tabContextManager.lookup(tabId);

    // Allow examination of behind-the-scene requests
    if (
        tabContext.rawURL.lastIndexOf(vAPI.getURL('dashboard.html'), 0) === 0 ||
        tabContext.rawURL === µm.behindTheSceneURL
    ) {
        tabId = µm.behindTheSceneTabId;
    }

    var pageStore = µm.pageStoreFromTabId(tabId);
    if ( pageStore === null ) {
        return r;
    }

    var headers = r.headers;

    r.url = pageStore.pageUrl;
    r.hostname = pageStore.pageHostname;
    r.domain = pageStore.pageDomain;
    r.blockedCount = pageStore.requestStats.blocked.all;

    if ( µmuser.popupScopeLevel === 'site' ) {
        r.scope = r.hostname;
    } else if ( µmuser.popupScopeLevel === 'domain' ) {
        r.scope = r.domain;
    }

    var switchNames = µm.Matrix.getSwitchNames();
    for ( var switchName in switchNames ) {
        if ( switchNames.hasOwnProperty(switchName) === false ) {
            continue;
        }
        r.tSwitches[switchName] = µm.tMatrix.evaluateSwitchZ(switchName, r.scope);
        r.pSwitches[switchName] = µm.pMatrix.evaluateSwitchZ(switchName, r.scope);
    }

    // These rows always exist
    r.rows['*'] = new RowSnapshot(r.scope, '*', '*');
    r.rows['1st-party'] = new RowSnapshot(r.scope, '1st-party', '1st-party');
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

        row = r.rows[reqDomain];
        row.totals[typeIndex] += 1;
        row.totals[anyIndex] += 1;

        row = r.rows['*'];
        row.totals[typeIndex] += 1;
        row.totals[anyIndex] += 1;
    }

    r.diff = µm.tMatrix.diff(µm.pMatrix, r.hostname, Object.keys(r.rows));

    return r;
};

/******************************************************************************/

var matrixSnapshotFromTabId = function(details, callback) {
    if ( details.tabId ) {
        callback(matrixSnapshot(details.tabId, details));
        return;
    }

    vAPI.tabs.get(null, function(tab) {
        callback(matrixSnapshot(tab.id, details));
    });
};

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    case 'matrixSnapshot':
        matrixSnapshotFromTabId(request, callback);
        return;

    default:
        break;
    }

    // Sync
    var response;

    switch ( request.what ) {
    case 'toggleMatrixSwitch':
        µm.tMatrix.setSwitchZ(
            request.switchName,
            request.srcHostname,
            µm.tMatrix.evaluateSwitchZ(request.switchName, request.srcHostname) === false
        );
        break;

    case 'blacklistMatrixCell':
        µm.tMatrix.blacklistCell(
            request.srcHostname,
            request.desHostname,
            request.type
        );
        break;

    case 'whitelistMatrixCell':
        µm.tMatrix.whitelistCell(
            request.srcHostname,
            request.desHostname,
            request.type
        );
        break;

    case 'graylistMatrixCell':
        µm.tMatrix.graylistCell(
            request.srcHostname,
            request.desHostname,
            request.type
        );
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
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('popup.js', onMessage);

})();

/******************************************************************************/
/******************************************************************************/

// content scripts

(function() {

var µm = µMatrix;

/******************************************************************************/

var contentScriptSummaryHandler = function(tabId, details) {
    // TODO: Investigate "Error in response to tabs.executeScript: TypeError:
    // Cannot read property 'locationURL' of null" (2013-11-12). When can this
    // happens? 
    if ( !details || !details.locationURL ) {
        return;
    }
    var pageStore = µm.pageStoreFromTabId(tabId);
    var pageURL = pageStore.pageUrl;
    var µmuri = µm.URI.set(details.locationURL);
    var frameURL = µmuri.normalizedURI();
    var frameHostname = µmuri.hostname;
    var urls, url, r;

    // https://github.com/gorhill/httpswitchboard/issues/333
    // Look-up here whether inline scripting is blocked for the frame.
    var inlineScriptBlocked = µm.mustBlock(µm.scopeFromURL(pageURL), frameHostname, 'script');

    // scripts
    // https://github.com/gorhill/httpswitchboard/issues/25
    if ( pageStore && inlineScriptBlocked ) {
        urls = details.scriptSources;
        for ( url in urls ) {
            if ( !urls.hasOwnProperty(url) ) {
                continue;
            }
            if ( url === '{inline_script}' ) {
                url = frameURL + '{inline_script}';
            }
            r = µm.filterRequest(pageURL, 'script', url);
            pageStore.recordRequest('script', url, r !== false, r);
        }
    }

    // TODO: as of 2014-05-26, not sure this is needed anymore, since µMatrix
    // no longer uses chrome.contentSettings API (I think that was the reason
    // this code was put in).
    // plugins
    // https://github.com/gorhill/httpswitchboard/issues/25
    if ( pageStore ) {
        urls = details.pluginSources;
        for ( url in urls ) {
            if ( !urls.hasOwnProperty(url) ) {
                continue;
            }
            r = µm.filterRequest(pageURL, 'plugin', url);
            pageStore.recordRequest('plugin', url, r !== false, r);
        }
    }

    // https://github.com/gorhill/httpswitchboard/issues/181
    µm.onPageLoadCompleted(tabId);
};

/******************************************************************************/

var contentScriptLocalStorageHandler = function(tabId, pageURL) {
    var µmuri = µm.URI.set(pageURL);
    var response = µm.mustBlock(µm.scopeFromURL(pageURL), µmuri.hostname, 'cookie');
    µm.recordFromTabId(
        tabId,
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

/******************************************************************************/

// Evaluate many URLs against the matrix.

var evaluateURLs = function(tabId, requests) {
    var collapse = µm.userSettings.collapseBlocked;
    var response = {
        collapse: collapse,
        requests: requests
    };

    // Create evaluation context
    var tabContext = µm.tabContextManager.lookup(tabId);
    if ( tabContext === null ) {
        return response;
    }
    var rootHostname = tabContext.rootHostname;

    //console.debug('messaging.js/contentscript-end.js: processing %d requests', requests.length);

    var µmuri = µm.URI;
    var typeMap = tagNameToRequestTypeMap;
    var request;
    var i = requests.length;
    while ( i-- ) {
        request = requests[i];
        request.blocked = µm.mustBlock(
            rootHostname,
            µmuri.hostnameFromURI(request.url),
            typeMap[request.tagName]
        );
    }

    if ( collapse ) {
        placeholders = null;
        return response;
    }

    if ( placeholders === null ) {
        var bg = vAPI.localStorage.getItem('placeholderBackground');
        placeholders = {
            background: bg,
            border: vAPI.localStorage.getItem('placeholderBorder'),
            iframe: vAPI.localStorage.getItem('placeholderDocument').replace('{{bg}}', bg),
            img: vAPI.localStorage.getItem('placeholderImage')
        };
    }
    response.placeholders = placeholders;

    return response;
};

/******************************************************************************/

var tagNameToRequestTypeMap = {
    'iframe': 'sub_frame',
       'img': 'image'
};

var placeholders = null;

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    default:
        break;
    }

    var tabId = sender && sender.tab ? sender.tab.id || 0 : 0;

    // Sync
    var response;

    switch ( request.what ) {
    case 'checkScriptBlacklisted':
        response = {
            scriptBlacklisted: µm.mustBlock(
                µm.scopeFromURL(request.url),
                µm.hostnameFromURL(request.url),
                'script'
            )
        };
        break;

    case 'contentScriptHasLocalStorage':
        response = contentScriptLocalStorageHandler(tabId, request.url);
        break;

    case 'contentScriptSummary':
        contentScriptSummaryHandler(tabId, request);
        break;

    case 'evaluateURLs':
        response = evaluateURLs(tabId, request.requests);
        break;

    case 'getUserAgentReplaceStr':
        response = µm.tMatrix.evaluateSwitchZ('ua-spoof', request.hostname) ?
            µm.userAgentReplaceStr : 
            undefined;
        break;

    case 'shutdown?':
        var tabContext = µm.tabContextManager.lookup(tabId);
        if ( tabContext !== null ) {
            response = µm.tMatrix.evaluateSwitchZ('matrix-off', tabContext.rootHostname);
        }
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('contentscript-start.js', onMessage);
vAPI.messaging.listen('contentscript-end.js', onMessage);

/******************************************************************************/

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
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('settings.js', onMessage);

})();

/******************************************************************************/
/******************************************************************************/

// privacy.js

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
    case 'getPrivacySettings':
        response = {
            userSettings: µm.userSettings,
            matrixSwitches: {
                'https-strict': µm.pMatrix.evaluateSwitch('https-strict', '*') === 1,
                'ua-spoof': µm.pMatrix.evaluateSwitch('ua-spoof', '*') === 1,
                'referrer-spoof': µm.pMatrix.evaluateSwitch('referrer-spoof', '*') === 1
            }
        };
        break;

    case 'setMatrixSwitch':
        µm.tMatrix.setSwitch(request.switchName, '*', request.state);
        if ( µm.pMatrix.setSwitch(request.switchName, '*', request.state) ) {
            µm.saveMatrix();
        }
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('privacy.js', onMessage);

})();

/******************************************************************************/
/******************************************************************************/

// user-rules.js

(function() {

var µm = µMatrix;

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
    case 'getUserRules':
        response = {
            temporaryRules: µm.tMatrix.toString(),
            permanentRules: µm.pMatrix.toString()
        };
        break;

    case 'setUserRules':
        if ( typeof request.temporaryRules === 'string' ) {
            µm.tMatrix.fromString(request.temporaryRules);
        }
        if ( typeof request.permanentRules === 'string' ) {
            µm.pMatrix.fromString(request.permanentRules);
            µm.saveMatrix();
        }
        response = {
            temporaryRules: µm.tMatrix.toString(),
            permanentRules: µm.pMatrix.toString()
        };
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('user-rules.js', onMessage);

})();

/******************************************************************************/
/******************************************************************************/

// hosts-files.js

(function() {

var µm = µMatrix;

/******************************************************************************/

var prepEntries = function(entries) {
    var µmuri = µm.URI;
    var entry;
    for ( var k in entries ) {
        if ( entries.hasOwnProperty(k) === false ) {
            continue;
        }
        entry = entries[k];
        if ( typeof entry.homeURL === 'string' ) {
            entry.homeHostname = µmuri.hostnameFromURI(entry.homeURL);
            entry.homeDomain = µmuri.domainFromHostname(entry.homeHostname);
        }
    }
};

/******************************************************************************/

var getLists = function(callback) {
    var r = {
        autoUpdate: µm.userSettings.autoUpdate,
        available: null,
        cache: null,
        current: µm.liveHostsFiles,
        blockedHostnameCount: µm.ubiquitousBlacklist.count
    };
    var onMetadataReady = function(entries) {
        r.cache = entries;
        prepEntries(r.cache);
        r.manualUpdate = µm.assetUpdater.manualUpdate;
        r.manualUpdateProgress = µm.assetUpdater.manualUpdateProgress;
        callback(r);
    };
    var onAvailableHostsFilesReady = function(lists) {
        r.available = lists;
        prepEntries(r.available);
        µm.assets.metadata(onMetadataReady);
    };
    µm.getAvailableHostsFiles(onAvailableHostsFilesReady);
};

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    var µm = µMatrix;

    // Async
    switch ( request.what ) {
    case 'getLists':
        return getLists(callback);

    case 'purgeAllCaches':
        return µm.assets.purgeAll(callback);

    default:
        break;
    }

    // Sync
    var response;

    switch ( request.what ) {
    case 'purgeCache':
        µm.assets.purge(request.path);
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('hosts-files.js', onMessage);

})();

/******************************************************************************/
/******************************************************************************/

// info.js

(function() {

var µm = µMatrix;

/******************************************************************************/

var getTabURLs = function() {
    var pageURLs = [];
    var pageStores = µm.pageStores;

    for ( var tabId in pageStores ) {
        if ( pageStores.hasOwnProperty(tabId) === false ) {
            continue;
        }
        pageURLs.push({
            tabId: tabId,
            pageURL: pageStores[tabId].pageUrl
        });
    }

    return {
        pageURLs: pageURLs,
        behindTheSceneURL: µm.behindTheSceneURL
    };
};

/******************************************************************************/

// map(pageURL) => array of request log entries

var getRequestLog = function(tabId) {
    var requestLogs = {};
    var pageStores = µm.pageStores;
    var tabIds = tabId ? [tabId] : Object.keys(pageStores);
    var pageStore, pageURL, pageRequestLog, logEntries, j, logEntry;

    for ( var i = 0; i < tabIds.length; i++ ) {
        pageStore = pageStores[tabIds[i]];
        if ( !pageStore ) {
            continue;
        }
        pageURL = pageStore.pageUrl;
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

/******************************************************************************/

var clearRequestLog = function(tabId) {
    var pageStores = µm.pageStores;
    var tabIds = tabId ? [tabId] : Object.keys(pageStores);
    var pageStore;

    for ( var i = 0; i < tabIds.length; i++ ) {
        pageStore = pageStores[tabIds[i]];
        if ( !pageStore ) {
            continue;
        }
        pageStore.requests.clearLogBuffer();
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
    case 'getPageURLs':
        response = getTabURLs();
        break;

    case 'getStats':
        var pageStore = µm.pageStores[request.tabId];
        response = {
            globalNetStats: µm.requestStats,
            pageNetStats: pageStore ? pageStore.requestStats : null,
            cookieHeaderFoiledCounter: µm.cookieHeaderFoiledCounter,
            refererHeaderFoiledCounter: µm.refererHeaderFoiledCounter,
            hyperlinkAuditingFoiledCounter: µm.hyperlinkAuditingFoiledCounter,
            cookieRemovedCounter: µm.cookieRemovedCounter,
            localStorageRemovedCounter: µm.localStorageRemovedCounter,
            browserCacheClearedCounter: µm.browserCacheClearedCounter
        };
        break;

    case 'getRequestLogs':
        response = getRequestLog(request.tabId);
        break;

    case 'clearRequestLogs':
        clearRequestLog(request.tabId);
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('info.js', onMessage);

})();

/******************************************************************************/
/******************************************************************************/

// about.js

(function() {

var µm = µMatrix;

/******************************************************************************/

var restoreUserData = function(userData) {
    var countdown = 3;
    var onCountdown = function() {
        countdown -= 1;
        if ( countdown === 0 ) {
            vAPI.app.restart();
        }
    };

    var onAllRemoved = function() {
        // Be sure to adjust `countdown` if adding/removing anything below
        µm.XAL.keyvalSetMany(userData.settings, onCountdown);
        µm.XAL.keyvalSetOne('userMatrix', userData.rules, onCountdown);
        µm.XAL.keyvalSetOne('liveHostsFiles', userData.hostsFiles, onCountdown);
    };

    // If we are going to restore all, might as well wipe out clean local
    // storage
    µm.XAL.keyvalRemoveAll(onAllRemoved);
};

/******************************************************************************/

var resetUserData = function() {
    var onAllRemoved = function() {
        vAPI.app.restart();
    };
    µm.XAL.keyvalRemoveAll(onAllRemoved);
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
    case 'getAllUserData':
        response = {
            app: 'µMatrix',
            version: vAPI.app.version,
            when: Date.now(),
            settings: µm.userSettings,
            rules: µm.pMatrix.toString(),
            hostsFiles: µm.liveHostsFiles
        };
        break;

    case 'getSomeStats':
        response = {
            version: vAPI.app.version,
            storageUsed: µm.storageUsed
        };
        break;

    case 'restoreAllUserData':
        restoreUserData(request.userData);
        break;

    case 'resetAllUserData':
        resetUserData();
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('about.js', onMessage);

/******************************************************************************/
/******************************************************************************/

})();

/******************************************************************************/
