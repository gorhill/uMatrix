/*******************************************************************************

    uMatrix - a browser extension to black/white list requests.
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

var µMatrix = (function() { // jshint ignore:line

/******************************************************************************/

var oneSecond = 1000;
var oneMinute = 60 * oneSecond;
var oneHour = 60 * oneMinute;
var oneDay = 24 * oneHour;

/******************************************************************************/
/******************************************************************************/

var defaultUserAgentStrings = [
    '# http://techblog.willshouse.com/2012/01/03/most-common-user-agents/',
    '# using ua string which are same browser as real one may work better overall',
    'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2311.90 Safari/537.36',
    'Mozilla/5.0 (Windows NT 6.1; WOW64; rv:37.0) Gecko/20100101 Firefox/37.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_3) AppleWebKit/600.5.17 (KHTML, like Gecko) Version/8.0.5 Safari/600.5.17',
    'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/41.0.2272.118 Safari/537.36',
    'Mozilla/5.0 (Windows NT 6.3; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2311.90 Safari/537.36',
    'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2311.135 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2311.90 Safari/537.36',
    'Mozilla/5.0 (Windows NT 6.3; WOW64; rv:37.0) Gecko/20100101 Firefox/37.0',
    ''
].join('\n').trim();

/******************************************************************************/
/******************************************************************************/

var _RequestStats = function() {
    this.reset();
};

_RequestStats.prototype.reset = function() {
    this.all = 
    this.doc =
    this.frame =
    this.script =
    this.css =
    this.image =
    this.media =
    this.xhr =
    this.other =
    this.cookie = 0;
};

/******************************************************************************/

var RequestStats = function() {
    this.allowed = new _RequestStats();
    this.blocked = new _RequestStats();
};

RequestStats.prototype.reset = function() {
    this.blocked.reset();
    this.allowed.reset();
};

RequestStats.prototype.record = function(type, blocked) {
    // Remember: always test against **false**
    if ( blocked !== false ) {
        this.blocked[type] += 1;
        this.blocked.all += 1;
    } else {
        this.allowed[type] += 1;
        this.allowed.all += 1;
    }
};

var requestStatsFactory = function() {
    return new RequestStats();
};

/******************************************************************************/
/******************************************************************************/

return {
    onBeforeStartQueue: [],

    userSettings: {
        autoUpdate: false,
        clearBrowserCache: true,
        clearBrowserCacheAfter: 60,
        cloudStorageEnabled: false,
        collapseBlocked: false,
        colorBlindFriendly: false,
        deleteCookies: false,
        deleteUnusedSessionCookies: false,
        deleteUnusedSessionCookiesAfter: 60,
        deleteLocalStorage: false,
        displayTextSize: '13px',
        externalHostsFiles: '',
        iconBadgeEnabled: false,
        maxLoggedRequests: 1000,
        popupScopeLevel: 'domain',
        processHyperlinkAuditing: true,
        processReferer: false,
        showApplyButton: true,
        spoofUserAgent: false,
        spoofUserAgentEvery: 5,
        spoofUserAgentWith: defaultUserAgentStrings
    },

    clearBrowserCacheCycle: 0,
    updateAssetsEvery: 11 * oneDay + 1 * oneHour + 1 * oneMinute + 1 * oneSecond,
    firstUpdateAfter: 11 * oneMinute,
    nextUpdateAfter: 11 * oneHour,
    assetsBootstrapLocation: 'assets/assets.json',
    pslAssetKey: 'public_suffix_list.dat',

    // list of live hosts files
    liveHostsFiles: {
    },

    // urls stats are kept on the back burner while waiting to be reactivated
    // in a tab or another.
    pageStores: {},
    pageStoresToken: 0,
    pageStoreCemetery: {},

    // page url => permission scope
    tMatrix: null,
    pMatrix: null,

    ubiquitousBlacklist: null,

    // various stats
    requestStatsFactory: requestStatsFactory,
    requestStats: requestStatsFactory(),
    cookieRemovedCounter: 0,
    localStorageRemovedCounter: 0,
    cookieHeaderFoiledCounter: 0,
    refererHeaderFoiledCounter: 0,
    hyperlinkAuditingFoiledCounter: 0,
    browserCacheClearedCounter: 0,
    storageUsed: 0,
    userAgentReplaceStr: '',
    userAgentReplaceStrBirth: 0,

    // record what the browser is doing behind the scene
    behindTheSceneScope: 'behind-the-scene',

    noopFunc: function(){},

    // so that I don't have to care for last comma
    dummy: 0
};

/******************************************************************************/

})();

/******************************************************************************/

