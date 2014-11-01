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

/* global chrome */

/******************************************************************************/

var µMatrix = (function() {

/******************************************************************************/

var oneSecond = 1000;
var oneMinute = 60 * oneSecond;
var oneHour = 60 * oneMinute;
var oneDay = 24 * oneHour;

/******************************************************************************/

var defaultUserAgentStrings = [
    '# http://www.useragentstring.com/pages/Chrome/',
    '# http://techblog.willshouse.com/2012/01/03/most-common-user-agents/',
    'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/37.0.2062.124 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_9_5) AppleWebKit/600.1.17 (KHTML, like Gecko) Version/7.1 Safari/537.85.10',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10) AppleWebKit/600.1.25 (KHTML, like Gecko) Version/8.0 Safari/600.1.25',
    'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/38.0.2125.104 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_9_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/37.0.2062.124 Safari/537.36',
    'Mozilla/5.0 (Windows NT 6.3; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/37.0.2062.124 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/38.0.2125.104 Safari/537.36'
].join('\n');

/******************************************************************************/

return {
    manifest: chrome.runtime.getManifest(),

    userSettings: {
        autoUpdate: false,
        clearBrowserCache: true,
        clearBrowserCacheAfter: 60,
        colorBlindFriendly: false,
        deleteCookies: false,
        deleteUnusedSessionCookies: false,
        deleteUnusedSessionCookiesAfter: 60,
        deleteLocalStorage: false,
        displayTextSize: '13px',
        externalHostsFiles: '',
        maxLoggedRequests: 50,
        popupCollapseDomains: false,
        popupCollapseSpecificDomains: {},
        popupHideBlacklisted: false,
        popupScopeLevel: 'domain',
        processBehindTheSceneRequests: false,
        processHyperlinkAuditing: true,
        processReferer: false,
        smartAutoReload: 'current',
        spoofUserAgent: false,
        spoofUserAgentEvery: 5,
        spoofUserAgentWith: defaultUserAgentStrings,
        statsFilters: {},
        subframeColor: '#cc0000',
        subframeOpacity: 100
    },

    clearBrowserCacheCycle: 0,
    updateAssetsEvery: 11 * oneDay + 1 * oneHour + 1 * oneMinute + 1 * oneSecond,
    firstUpdateAfter: 11 * oneMinute,
    nextUpdateAfter: 11 * oneHour,
    projectServerRoot: 'https://raw.githubusercontent.com/gorhill/umatrix/master/',
    pslPath: 'assets/thirdparties/publicsuffix.org/list/effective_tld_names.dat',

    // permanent hosts files
    permanentHostsFiles: {
        // µMatrix
        'assets/umatrix/blacklist.txt': {
            title: 'µMatrix hosts file'
        }
    },

    // list of live hosts files
    liveHostsFiles: {
    },

    // urls stats are kept on the back burner while waiting to be reactivated
    // in a tab or another.
    pageStats: {}, // TODO: rename

    // A map of redirects, to allow reverse lookup of redirects from landing
    // page, so that redirection can be reported to the user.
    redirectRequests: {}, 

    // tabs are used to redirect stats collection to a specific url stats
    // structure.
    pageUrlToTabId: {},
    tabIdToPageUrl: {},

    // page url => permission scope
    tMatrix: null,
    pMatrix: null,

    ubiquitousBlacklist: null,

    // various stats
    requestStats: new WebRequestStats(),
    cookieRemovedCounter: 0,
    localStorageRemovedCounter: 0,
    cookieHeaderFoiledCounter: 0,
    refererHeaderFoiledCounter: 0,
    hyperlinkAuditingFoiledCounter: 0,
    browserCacheClearedCounter: 0,
    storageQuota: chrome.storage.local.QUOTA_BYTES,
    storageUsed: 0,
    userAgentReplaceStr: '',
    userAgentReplaceStrBirth: 0,

    // record what chromium is doing behind the scene
    behindTheSceneURL: 'http://chromium-behind-the-scene/',
    behindTheSceneTabId: 0x7FFFFFFF,
    behindTheSceneMaxReq: 250,
    behindTheSceneScope: 'chromium-behind-the-scene',

    // Commonly encountered strings
    chromeExtensionURLPrefix: 'chrome-extension://',
    noopCSSURL: chrome.runtime.getURL('css/noop.css'),
    fontCSSURL: chrome.runtime.getURL('css/fonts/Roboto_Condensed/RobotoCondensed-Regular.ttf'),

    noopFunc: function(){},

    // so that I don't have to care for last comma
    dummy: 0
};

/******************************************************************************/

})();

/******************************************************************************/

