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

/* global µMatrix */

// ORDER IS IMPORTANT

/******************************************************************************/

// rhill 2013-11-24: bind behind-the-scene virtual tab/url manually, since the
// normal way forbid binding behind the scene tab.
// https://github.com/gorhill/httpswitchboard/issues/67

(function() {
    var µm = µMatrix;
    var tabContext = µm.tabContextManager.mustLookup(vAPI.noTabId);
    µm.pageStores[vAPI.noTabId] = µm.PageStore.factory(tabContext);
})();

/******************************************************************************/

µMatrix.turnOn();

/******************************************************************************/

// Browser data jobs

(function() {
    var jobCallback = function() {
        var µm = µMatrix;
        if ( !µm.userSettings.clearBrowserCache ) {
            return;
        }
        µm.clearBrowserCacheCycle -= 15;
        if ( µm.clearBrowserCacheCycle > 0 ) {
            return;
        }
        µm.clearBrowserCacheCycle = µm.userSettings.clearBrowserCacheAfter;
        µm.browserCacheClearedCounter++;
        vAPI.browserCache.clearByTime(0);
        // console.debug('clearBrowserCacheCallback()> vAPI.browserCache.clearByTime() called');
    };

    µMatrix.asyncJobs.add('clearBrowserCache', null, jobCallback, 15 * 60 * 1000, true);
})();

/******************************************************************************/

// Automatic update of non-user assets
// https://github.com/gorhill/httpswitchboard/issues/334

(function() {
    var µm = µMatrix;

    // https://github.com/chrisaljoudi/uBlock/issues/184
    // Check for updates not too far in the future.
    µm.assetUpdater.onStart.addListener(µm.updateStartHandler.bind(µm));
    µm.assetUpdater.onCompleted.addListener(µm.updateCompleteHandler.bind(µm));
    µm.assetUpdater.onAssetUpdated.addListener(µm.assetUpdatedHandler.bind(µm));
    µm.assets.onAssetCacheRemoved.addListener(µm.assetCacheRemovedHandler.bind(µm));
})();

/******************************************************************************/

// Load everything

(function() {
    var µm = µMatrix;

    µm.assets.remoteFetchBarrier += 1;

    // This needs to be done when the PSL is loaded
    var bindTabs = function(tabs) {
        var tab;
        var i = tabs.length;
        // console.debug('start.js > binding %d tabs', i);
        while ( i-- ) {
            tab = tabs[i];
            µm.tabContextManager.commit(tab.id, tab.url);
            µm.bindTabToPageStats(tab.id);
        }
        µm.webRequest.start();

        // Important: remove barrier to remote fetching, this was useful only
        // for launch time.
        µm.assets.remoteFetchBarrier -= 1;
    };

    var queryTabs = function() {
        vAPI.tabs.getAll(bindTabs);
    };

    var onSettingsReady = function(settings) {
        µm.loadPublicSuffixList(queryTabs);
        µm.loadHostsFiles();
    };

    var onMatrixReady = function() {
    };

    µm.loadUserSettings(onSettingsReady);
    µm.loadMatrix(onMatrixReady);

})();

/******************************************************************************/
