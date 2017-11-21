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
/******************************************************************************/

// Default handler

(function() {

var µm = µMatrix;

/******************************************************************************/

// Default is for commonly used message.

function onMessage(request, sender, callback) {
    // Async
    switch ( request.what ) {
    case 'getAssetContent':
        µm.assets.get(request.url, { dontCache: true }, callback);
        return;

    case 'selectHostsFiles':
        µm.selectHostsFiles(request, callback);
        return;

    default:
        break;
    }

    // Sync
    var response;

    switch ( request.what ) {
    case 'forceReloadTab':
        µm.forceReload(request.tabId, request.bypassCache);
        break;

    case 'forceUpdateAssets':
        µm.scheduleAssetUpdater(0);
        µm.assets.updateStart({ delay: 2000 });
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

    case 'userSettings':
        if ( request.hasOwnProperty('value') === false ) {
            request.value = undefined;
        }
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

var matrixSnapshot = function(pageStore, details) {
    var µmuser = µm.userSettings;
    var r = {
        appVersion: vAPI.app.version,
        blockedCount: pageStore.requestStats.blocked.all,
        diff: [],
        domain: pageStore.pageDomain,
        headers: µm.Matrix.getColumnHeaders(),
        hostname: pageStore.pageHostname,
        mtxContentModified: pageStore.mtxContentModifiedTime !== details.mtxContentModifiedTime,
        mtxCountModified: pageStore.mtxCountModifiedTime !== details.mtxCountModifiedTime,
        mtxContentModifiedTime: pageStore.mtxContentModifiedTime,
        mtxCountModifiedTime: pageStore.mtxCountModifiedTime,
        pMatrixModified: µm.pMatrix.modifiedTime !== details.pMatrixModifiedTime,
        pMatrixModifiedTime: µm.pMatrix.modifiedTime,
        pSwitches: {},
        rows: {},
        rowCount: 0,
        scope: '*',
        tabId: pageStore.tabId,
        tMatrixModified: µm.tMatrix.modifiedTime !== details.tMatrixModifiedTime,
        tMatrixModifiedTime: µm.tMatrix.modifiedTime,
        tSwitches: {},
        url: pageStore.pageUrl,
        userSettings: {
            colorBlindFriendly: µmuser.colorBlindFriendly,
            showApplyButton: µmuser.showApplyButton,
            displayTextSize: µmuser.displayTextSize,
            popupScopeLevel: µmuser.popupScopeLevel
        }
    };

    var headers = r.headers;

    if ( typeof details.scope === 'string' ) {
        r.scope = details.scope;
    } else if ( µmuser.popupScopeLevel === 'site' ) {
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
    var matrixSnapshotIf = function(tabId, details) {
        var pageStore = µm.pageStoreFromTabId(tabId);
        if ( pageStore === null ) {
            callback('ENOTFOUND');
            return;
        }

        // First verify whether we must return data or not.
        if (
            µm.tMatrix.modifiedTime === details.tMatrixModifiedTime &&
            µm.pMatrix.modifiedTime === details.pMatrixModifiedTime &&
            pageStore.mtxContentModifiedTime === details.mtxContentModifiedTime &&
            pageStore.mtxCountModifiedTime === details.mtxCountModifiedTime
        ) {
            callback('ENOCHANGE');
            return ;
        }

        callback(matrixSnapshot(pageStore, details));
    };

    // Specific tab id requested?
    if ( details.tabId ) {
        matrixSnapshotIf(details.tabId, details);
        return;
    }

    // Fall back to currently active tab
    var onTabReady = function(tab) {
        if ( typeof tab !== 'object' ) {
            callback('ENOTFOUND');
            return;
        }

        // Allow examination of behind-the-scene requests
        var tabId = tab.url.lastIndexOf(vAPI.getURL('dashboard.html'), 0) !== 0 ?
            tab.id :
            vAPI.noTabId;
        matrixSnapshotIf(tabId, details);
    };

    vAPI.tabs.get(null, onTabReady);
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

    // scripts
    if ( details.inlineScript !== true ) {
        return;
    }

    // https://github.com/gorhill/httpswitchboard/issues/25
    var pageStore = µm.pageStoreFromTabId(tabId);
    if ( pageStore === null ) {
        return;
    }

    var pageHostname = pageStore.pageHostname;
    var µmuri = µm.URI.set(details.locationURL);
    var frameURL = µmuri.normalizedURI();
    var frameHostname = µmuri.hostname;

    // https://github.com/gorhill/httpswitchboard/issues/333
    // Look-up here whether inline scripting is blocked for the frame.
    var inlineScriptBlocked = µm.mustBlock(pageHostname, frameHostname, 'script');
    var url = frameURL + '{inline_script}';
    pageStore.recordRequest('script', url, inlineScriptBlocked);
    µm.logger.writeOne(tabId, 'net', pageHostname, url, 'script', inlineScriptBlocked);

    // https://github.com/gorhill/uMatrix/issues/225
    // A good place to force an update of the page title, as at this point
    // the DOM has been loaded.
    µm.updateTitle(tabId);
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

    var pageStore = µm.pageStoreFromTabId(tabId);
    var µmuri = µm.URI;
    var typeMap = tagNameToRequestTypeMap;
    var request, type;
    var i = requests.length;
    while ( i-- ) {
        request = requests[i];
        type = typeMap[request.tagName];
        request.blocked = µm.mustBlock(
            rootHostname,
            µmuri.hostnameFromURI(request.url),
            type
        );
        // https://github.com/gorhill/uMatrix/issues/205
        // If blocked, the URL must be recorded by the page store, so as to ensure
        // they are properly reflected in the matrix.
        if ( request.blocked && pageStore ) {
            pageStore.recordRequest(type, request.url, true);
        }
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
    'iframe': 'frame',
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

// cloud-ui.js

(function() {

/******************************************************************************/

var µm = µMatrix;

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    case 'cloudGetOptions':
        vAPI.cloud.getOptions(function(options) {
            options.enabled = µm.userSettings.cloudStorageEnabled === true;
            callback(options);
        });
        return;

    case 'cloudSetOptions':
        vAPI.cloud.setOptions(request.options, callback);
        return;

    case 'cloudPull':
        return vAPI.cloud.pull(request.datakey, callback);

    case 'cloudPush':
        return vAPI.cloud.push(request.datakey, request.data, callback);

    default:
        break;
    }

    // Sync
    var response;

    switch ( request.what ) {
    // For when cloud storage is disabled.
    case 'cloudPull':
        // fallthrough
    case 'cloudPush':
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

/******************************************************************************/

vAPI.messaging.listen('cloud-ui.js', onMessage);

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

    default:
        break;
    }

    // Sync
    var response;

    switch ( request.what ) {
    case 'purgeCache':
        µm.assets.purge(request.assetKey);
        µm.assets.remove('compiled/' + request.assetKey);
        break;

    case 'purgeAllCaches':
        if ( request.hard ) {
            µm.assets.remove(/./);
        } else {
            µm.assets.purge(/./, 'public_suffix_list.dat');
        }
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
            app: vAPI.app.name,
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

// logger-ui.js

(function() {

/******************************************************************************/

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
    case 'readMany':
        var tabIds = {};
        var loggerURL = vAPI.getURL('logger-ui.html');
        var pageStore;
        for ( var tabId in µm.pageStores ) {
            pageStore = µm.pageStoreFromTabId(tabId);
            if ( pageStore === null ) {
                continue;
            }
            if ( pageStore.rawUrl.lastIndexOf(loggerURL, 0) === 0 ) {
                continue;
            }
            tabIds[tabId] = pageStore.title || pageStore.rawUrl;
        }
        response = {
            colorBlind: false,
            entries: µm.logger.readAll(),
            maxLoggedRequests: µm.userSettings.maxLoggedRequests,
            noTabId: vAPI.noTabId,
            tabIds: tabIds,
            tabIdsToken: µm.pageStoresToken
        };
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('logger-ui.js', onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

})();

/******************************************************************************/
