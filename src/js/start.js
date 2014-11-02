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

function onTabCreated(tab) {
    // Can this happen?
    if ( tab.id < 0 || !tab.url || tab.url === '' ) {
        return;
    }

    // https://github.com/gorhill/httpswitchboard/issues/303
    // This takes care of rebinding the tab to the proper page store
    // when the user navigate back in his history.
    µMatrix.bindTabToPageStats(tab.id, tab.url);
}

chrome.tabs.onCreated.addListener(onTabCreated);

/******************************************************************************/

function onTabUpdated(tabId, changeInfo, tab) {
    // Can this happen?
    if ( !tab.url || tab.url === '' ) {
        return;
    }

    // https://github.com/gorhill/httpswitchboard/issues/303
    // This takes care of rebinding the tab to the proper page store
    // when the user navigate back in his history.
    if ( changeInfo.url ) {
        µMatrix.bindTabToPageStats(tabId, tab.url, 'pageUpdated');
    }

    // rhill 2013-12-23: Compute state after whole page is loaded. This is
    // better than building a state snapshot dynamically when requests are
    // recorded, because here we are not afflicted by the browser cache
    // mechanism.

    // rhill 2014-03-05: Use tab id instead of page URL: this allows a
    // blocked page using µMatrix internal data URI-based page to be properly
    // unblocked when user un-blacklist the hostname.
    // https://github.com/gorhill/httpswitchboard/issues/198
    if ( changeInfo.status === 'complete' ) {
        var pageStats = µMatrix.pageStatsFromTabId(tabId);
        if ( pageStats ) {
            pageStats.state = µMatrix.computeTabState(tabId);
        }
    }
}

chrome.tabs.onUpdated.addListener(onTabUpdated);

/******************************************************************************/

function onTabRemoved(tabId) {
    // Can this happen?
    if ( tabId < 0 ) {
        return;
    }

    µMatrix.unbindTabFromPageStats(tabId);
}

chrome.tabs.onRemoved.addListener(onTabRemoved);

/******************************************************************************/

// Bind a top URL to a specific tab

function onBeforeNavigateCallback(details) {
    // Don't bind to a subframe
    if ( details.frameId > 0 ) {
        return;
    }
    // console.debug('onBeforeNavigateCallback() > "%s" = %o', details.url, details);

    µMatrix.bindTabToPageStats(details.tabId, details.url);
}

chrome.webNavigation.onBeforeNavigate.addListener(onBeforeNavigateCallback);

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
        chrome.browsingData.removeCache({ since: 0 });
        // console.debug('clearBrowserCacheCallback()> chrome.browsingData.removeCache() called');
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
            µm.bindTabToPageStats(tabs[i].id, tabs[i].url);
        }
        µm.webRequest.start();
    };

    var queryTabs = function() {
        chrome.tabs.query({ url: '<all_urls>' }, bindTabs);
    };

    µm.load(queryTabs);
})();

/******************************************************************************/
