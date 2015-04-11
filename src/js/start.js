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
    var pageStore = µm.createPageStore(µm.behindTheSceneURL);
    µm.pageUrlToTabId[µm.behindTheSceneURL] = µm.behindTheSceneTabId;
    µm.tabIdToPageUrl[µm.behindTheSceneTabId] = µm.behindTheSceneURL;
    pageStore.boundCount += 1;
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

    var jobDone = function(details) {
        if ( details.changedCount === 0 ) {
            return;
        }
        µm.loadUpdatableAssets();
    };

    var jobCallback = function() {
        µm.assetUpdater.update(null, jobDone);
    };

    µm.asyncJobs.add('autoUpdateAssets', null, jobCallback, µm.updateAssetsEvery, true);
})();

/******************************************************************************/

// Load everything

(function() {
    var µm = µMatrix;

    // This needs to be done when the PSL is loaded
    var bindTabs = function(tabs) {
        var i = tabs.length;
        // console.debug('start.js > binding %d tabs', i);
        while ( i-- ) {
            µm.tabContextManager.commit(tabs[i].id, tabs[i].url);
            µm.bindTabToPageStats(tabs[i].id, tabs[i].url);
        }
        µm.webRequest.start();
    };

    var queryTabs = function() {
        vAPI.tabs.getAll(bindTabs);
    };

    µm.load(queryTabs);
})();

/******************************************************************************/
