/*******************************************************************************

    uMatrix - a browser extension to black/white list requests.
    Copyright (C) 2014-2018 Raymond Hill

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

    case 'selectAssets':
        µm.selectAssets(request, callback);
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
        response = {
            userSettings: µm.userSettings,
            matrixSwitches: {
                'https-strict': µm.pMatrix.evaluateSwitch('https-strict', '*') === 1,
                'referrer-spoof': µm.pMatrix.evaluateSwitch('referrer-spoof', '*') === 1,
                'noscript-spoof': µm.pMatrix.evaluateSwitch('noscript-spoof', '*') === 1
            }
        };
        break;

    case 'gotoExtensionURL':
        µm.gotoExtensionURL(request);
        break;

    case 'gotoURL':
        µm.gotoURL(request);
        break;

    case 'mustBlock':
        response = µm.mustBlock(
            request.scope,
            request.hostname,
            request.type
        );
        break;

    case 'readRawSettings':
        response = µm.stringFromRawSettings();
        break;

    case 'reloadHostsFiles':
        µm.reloadHostsFiles();
        break;

    case 'reloadRecipeFiles':
        µm.loadRecipes(true);
        break;

    case 'setMatrixSwitch':
        µm.tMatrix.setSwitch(request.switchName, '*', request.state);
        if ( µm.pMatrix.setSwitch(request.switchName, '*', request.state) ) {
            µm.saveMatrix();
        }
        break;

    case 'userSettings':
        if ( request.hasOwnProperty('value') === false ) {
            request.value = undefined;
        }
        response = µm.changeUserSettings(request.name, request.value);
        break;

    case 'writeRawSettings':
        µm.rawSettingsFromString(request.content);
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
    var aa = [];
    for ( var i = 0, n = µm.Matrix.columnHeaderIndices.size; i < n; i++ ) {
        aa[i] = 0;
    }
    return aa;
})();

/******************************************************************************/

var matrixSnapshot = function(pageStore, details) {
    var µmuser = µm.userSettings;
    var headerIndices = µm.Matrix.columnHeaderIndices;

    var r = {
        appVersion: vAPI.app.version,
        blockedCount: pageStore.perLoadBlockedRequestCount,
        collapseAllDomains: µmuser.popupCollapseAllDomains,
        collapseBlacklistedDomains: µmuser.popupCollapseBlacklistedDomains,
        diff: [],
        domain: pageStore.pageDomain,
        has3pReferrer: pageStore.has3pReferrer,
        hasMixedContent: pageStore.hasMixedContent,
        hasNoscriptTags: pageStore.hasNoscriptTags,
        hasWebWorkers: pageStore.hasWebWorkers,
        headerIndices: Array.from(headerIndices),
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
            displayTextSize: µmuser.displayTextSize,
            noTooltips: µmuser.noTooltips,
            popupScopeLevel: µmuser.popupScopeLevel
        }
    };

    if ( typeof details.scope === 'string' ) {
        r.scope = details.scope;
    } else if ( µmuser.popupScopeLevel === 'site' ) {
        r.scope = r.hostname;
    } else if ( µmuser.popupScopeLevel === 'domain' ) {
        r.scope = r.domain;
    }

    for ( var switchName of µm.Matrix.switchNames ) {
        r.tSwitches[switchName] = µm.tMatrix.evaluateSwitchZ(switchName, r.scope);
        r.pSwitches[switchName] = µm.pMatrix.evaluateSwitchZ(switchName, r.scope);
    }

    // These rows always exist
    r.rows['*'] = new RowSnapshot(r.scope, '*', '*');
    r.rows['1st-party'] = new RowSnapshot(r.scope, '1st-party', '1st-party');
    r.rowCount += 1;

    var µmuri = µm.URI;
    var reqType, reqHostname, reqDomain;
    var desHostname;
    var row, typeIndex;
    var anyIndex = headerIndices.get('*');
    var pos, count;

    for ( var entry of pageStore.hostnameTypeCells ) {
        pos = entry[0].indexOf(' ');
        reqHostname = entry[0].slice(0, pos);
        reqType = entry[0].slice(pos + 1);
        // rhill 2013-10-23: hostname can be empty if the request is a data url
        // https://github.com/gorhill/httpswitchboard/issues/26
        if ( reqHostname === '' ) {
            reqHostname = pageStore.pageHostname;
        }
        reqDomain = µmuri.domainFromHostname(reqHostname) || reqHostname;

        // We want rows of self and ancestors
        desHostname = reqHostname;
        for (;;) {
            // If row exists, ancestors exist
            if ( r.rows.hasOwnProperty(desHostname) !== false ) { break; }
            r.rows[desHostname] = new RowSnapshot(r.scope, desHostname, reqDomain);
            r.rowCount += 1;
            if ( desHostname === reqDomain ) { break; }
            pos = desHostname.indexOf('.');
            if ( pos === -1 ) { break; }
            desHostname = desHostname.slice(pos + 1);
        }

        count = entry[1].size;
        typeIndex = headerIndices.get(reqType);
        row = r.rows[reqHostname];
        row.counts[typeIndex] += count;
        row.counts[anyIndex] += count;
        row = r.rows[reqDomain];
        row.totals[typeIndex] += count;
        row.totals[anyIndex] += count;
        row = r.rows['*'];
        row.totals[typeIndex] += count;
        row.totals[anyIndex] += count;
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
        if ( tab instanceof Object === false ) {
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
    case 'fetchRecipes':
        µm.recipeManager.fetch(
            request.srcHostname,
            request.desHostnames,
            callback
        );
        return;

    case 'matrixSnapshot':
        matrixSnapshotFromTabId(request, callback);
        return;

    default:
        break;
    }

    // Sync
    var response;

    switch ( request.what ) {
    case 'applyRecipe':
        µm.recipeManager.apply(request);
        break;

    case 'fetchRecipeCommitStatuses':
        response = µm.recipeManager.statuses(request);
        break;

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

var foundInlineCode = function(tabId, pageStore, details, type) {
    if ( pageStore === null ) { return; }

    var pageHostname = pageStore.pageHostname,
        µmuri = µm.URI.set(details.documentURI),
        frameURL = µmuri.normalizedURI();

    var blocked = details.blocked;
    if ( blocked === undefined ) {
        blocked = µm.mustBlock(pageHostname, µmuri.hostname, type);
    }

    var mapTo = {
        css: 'style',
        script: 'script'
    };

    // https://github.com/gorhill/httpswitchboard/issues/333
    // Look-up here whether inline scripting is blocked for the frame.
    var url = frameURL + '{inline_' + mapTo[type] + '}';
    pageStore.recordRequest(type, url, blocked);
    µm.logger.writeOne(tabId, 'net', pageHostname, url, type, blocked);
};

/******************************************************************************/

var contentScriptLocalStorageHandler = function(tabId, originURL) {
    var tabContext = µm.tabContextManager.lookup(tabId);
    if ( tabContext === null ) { return; }

    var blocked = µm.mustBlock(
        tabContext.rootHostname,
        µm.URI.hostnameFromURI(originURL),
        'cookie'
    );

    var pageStore = µm.pageStoreFromTabId(tabId);
    if ( pageStore !== null ) {
        var requestURL = originURL + '/{localStorage}';
        pageStore.recordRequest('cookie', requestURL, blocked);
        µm.logger.writeOne(tabId, 'net', tabContext.rootHostname, requestURL, 'cookie', blocked);
    }

    var removeStorage = blocked && µm.userSettings.deleteLocalStorage;
    if ( removeStorage ) {
        µm.localStorageRemovedCounter++;
    }

    return removeStorage;
};

/******************************************************************************/

// Evaluate many URLs against the matrix.

var lookupBlockedCollapsibles = function(tabId, requests) {
    if ( placeholdersReadTime < µm.rawSettingsWriteTime ) {
        placeholders = undefined;
    }

    if ( placeholders === undefined ) {
        placeholders = {
            frame: µm.rawSettings.framePlaceholder,
            image: µm.rawSettings.imagePlaceholder
        };
        if ( placeholders.frame ) {
            placeholders.frameDocument =
                µm.rawSettings.framePlaceholderDocument.replace(
                    '{{bg}}',
                    µm.rawSettings.framePlaceholderBackground !== 'default' ?
                        µm.rawSettings.framePlaceholderBackground :
                        µm.rawSettings.placeholderBackground
                );
        }
        if ( placeholders.image ) {
            placeholders.imageBorder =
                µm.rawSettings.imagePlaceholderBorder !== 'default' ?
                    µm.rawSettings.imagePlaceholderBorder :
                    µm.rawSettings.placeholderBorder;
            placeholders.imageBackground =
                µm.rawSettings.imagePlaceholderBackground !== 'default' ?
                    µm.rawSettings.imagePlaceholderBackground :
                    µm.rawSettings.placeholderBackground;
        }
        placeholdersReadTime = Date.now();
    }

    var response = {
        blockedResources: [],
        hash: requests.hash,
        id: requests.id,
        placeholders: placeholders
    };

    var tabContext = µm.tabContextManager.lookup(tabId);
    if ( tabContext === null ) {
        return response;
    }

    var pageStore = µm.pageStoreFromTabId(tabId);
    if ( pageStore !== null ) {
        pageStore.lookupBlockedCollapsibles(requests, response);
    }

    return response;
};

var placeholders,
    placeholdersReadTime = 0;

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    default:
        break;
    }

    var tabId = sender && sender.tab ? sender.tab.id || 0 : 0,
        tabContext = µm.tabContextManager.lookup(tabId),
        rootHostname = tabContext && tabContext.rootHostname,
        pageStore = µm.pageStoreFromTabId(tabId);

    // Sync
    var response;

    switch ( request.what ) {
    case 'contentScriptHasLocalStorage':
        response = contentScriptLocalStorageHandler(tabId, request.originURL);
        break;

    case 'lookupBlockedCollapsibles':
        response = lookupBlockedCollapsibles(tabId, request);
        break;

    case 'mustRenderNoscriptTags?':
        if ( tabContext === null ) { break; }
        response =
            µm.tMatrix.mustBlock(rootHostname, rootHostname, 'script') &&
            µm.tMatrix.evaluateSwitchZ('noscript-spoof', rootHostname);
        if ( pageStore !== null ) {
            pageStore.hasNoscriptTags = true;
        }
        // https://github.com/gorhill/uMatrix/issues/225
        //   A good place to force an update of the page title, as at
        //   this point the DOM has been loaded.
        µm.updateTitle(tabId);
        break;

    case 'securityPolicyViolation':
        if ( request.directive === 'worker-src' ) {
            var url = µm.URI.hostnameFromURI(request.blockedURI) !== '' ?
                request.blockedURI :
                request.documentURI;
            if ( pageStore !== null ) {
                pageStore.hasWebWorkers = true;
                pageStore.recordRequest('script', url, request.blocked);
            }
            if ( tabContext !== null ) {
                µm.logger.writeOne(tabId, 'net', rootHostname, url, 'worker', request.blocked);
            }
        } else if ( request.directive === 'script-src' ) {
            foundInlineCode(tabId, pageStore, request, 'script');
        } else if ( request.directive === 'style-src' ) {
            foundInlineCode(tabId, pageStore, request, 'css');
        }
        break;

    case 'shutdown?':
        if ( tabContext !== null ) {
            response = µm.tMatrix.evaluateSwitchZ('matrix-off', rootHostname);
        }
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('contentscript.js', onMessage);

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

// user-rules.js

(function() {

var µm = µMatrix;

var modifyRuleset = function(details) {
    let ruleset = details.permanent ? µm.pMatrix : µm.tMatrix,
        modifiedTime = ruleset.modifiedTime;
    let toRemove = new Set(details.toRemove.trim().split(/\s*[\n\r]+\s*/));
    for ( let rule of toRemove ) {
        ruleset.removeFromLine(rule);
    }
    let toAdd = new Set(details.toAdd.trim().split(/\s*[\n\r]+\s*/));
    for ( let rule of toAdd ) {
        ruleset.addFromLine(rule);
    }
    if ( details.permanent && ruleset.modifiedTime !== modifiedTime ) {
        µm.saveMatrix();
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
    case 'modifyRuleset':
        modifyRuleset(request);
        /* falls through */

    case 'getRuleset':
        response = {
            temporaryRules: µm.tMatrix.toArray(),
            permanentRules: µm.pMatrix.toArray()
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

var getAssets = function(callback) {
    var r = {
        autoUpdate: µm.userSettings.autoUpdate,
        blockedHostnameCount: µm.ubiquitousBlacklist.count,
        hosts: null,
        recipes: null,
        userRecipes: µm.userSettings.userRecipes,
        cache: null,
        contributor: µm.rawSettings.contributorMode
    };
    var onMetadataReady = function(entries) {
        r.cache = entries;
        callback(r);
    };
    var onAvailableRecipeFilesReady = function(collection) {
        r.recipes = Array.from(collection);
        µm.assets.metadata(onMetadataReady);
    };
    var onAvailableHostsFilesReady = function(collection) {
        r.hosts = Array.from(collection);
        µm.getAvailableRecipeFiles(onAvailableRecipeFilesReady);
    };
    µm.getAvailableHostsFiles(onAvailableHostsFilesReady);
};

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    var µm = µMatrix;

    // Async
    switch ( request.what ) {
    case 'getAssets':
        return getAssets(callback);

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
    var countdown = 0;
    var onCountdown = function() {
        countdown -= 1;
        if ( countdown === 0 ) {
            vAPI.app.restart();
        }
    };

    var onAllRemoved = function() {
        let µm = µMatrix;
        countdown += 1;
        vAPI.storage.set(userData.settings, onCountdown);
        countdown += 1;
        let bin = { userMatrix: userData.rules };
        if ( userData.hostsFiles instanceof Object ) {
            bin.liveHostsFiles = userData.hostsFiles;
        }
        vAPI.storage.set(bin, onCountdown);
        if ( userData.rawSettings instanceof Object ) {
            countdown += 1;
            µm.saveRawSettings(userData.rawSettings, onCountdown);
        }
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
            rules: µm.pMatrix.toArray().sort(),
            rawSettings: µm.rawSettings
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

var µm = µMatrix,
    loggerURL = vAPI.getURL('logger-ui.html');

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
        if (
            µm.logger.ownerId !== undefined &&
            request.ownerId !== µm.logger.ownerId
        ) {
            response = { unavailable: true };
            break;
        }
        let pageStores;
        if ( request.pageStoresToken !== µm.pageStoresToken ) {
            pageStores = [];
            for ( let entry of µm.pageStores ) {
                let tabId = entry[0];
                let pageStore = entry[1];
                if ( pageStore.rawURL.startsWith(loggerURL) ) { continue; }
                pageStores.push([ tabId, pageStore.title || pageStore.rawURL ]);
            }
        }
        response = {
            colorBlind: false,
            entries: µm.logger.readAll(request.ownerId),
            maxLoggedRequests: µm.userSettings.maxLoggedRequests,
            noTabId: vAPI.noTabId,
            pageStores: pageStores,
            pageStoresToken: µm.pageStoresToken
        };
        break;

    case 'releaseView':
        if ( request.ownerId === µm.logger.ownerId ) {
            µm.logger.ownerId = undefined;
        }
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
