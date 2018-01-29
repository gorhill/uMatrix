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

// ORDER IS IMPORTANT

/******************************************************************************/

// Load everything

(function() {

'use strict';

/******************************************************************************/

var µm = µMatrix;

/******************************************************************************/

var processCallbackQueue = function(queue, callback) {
    var processOne = function() {
        var fn = queue.pop();
        if ( fn ) {
            fn(processOne);
        } else if ( typeof callback === 'function' ) {
            callback();
        }
    };
    processOne();
};

/******************************************************************************/

var onAllDone = function() {
    µm.webRequest.start();

    µm.assets.addObserver(µm.assetObserver.bind(µm));
    µm.scheduleAssetUpdater(µm.userSettings.autoUpdate ? 7 * 60 * 1000 : 0);

    vAPI.cloud.start([ 'myRulesPane' ]);
};

/******************************************************************************/

var onTabsReady = function(tabs) {
    var tab;
    var i = tabs.length;
    // console.debug('start.js > binding %d tabs', i);
    while ( i-- ) {
        tab = tabs[i];
        µm.tabContextManager.push(tab.id, tab.url, 'newURL');
    }

    onAllDone();
};

/******************************************************************************/

var onUserSettingsLoaded = function() {
    µm.loadHostsFiles();
    µm.loadRecipes();
};

/******************************************************************************/

var onPSLReady = function() {
    µm.loadUserSettings(onUserSettingsLoaded);
    µm.loadRawSettings();
    µm.loadMatrix();

    // rhill 2013-11-24: bind behind-the-scene virtual tab/url manually, since the
    // normal way forbid binding behind the scene tab.
    // https://github.com/gorhill/httpswitchboard/issues/67
    µm.pageStores[vAPI.noTabId] = µm.pageStoreFactory(µm.tabContextManager.mustLookup(vAPI.noTabId));
    µm.pageStores[vAPI.noTabId].title = vAPI.i18n('statsPageDetailedBehindTheScenePage');

    vAPI.tabs.getAll(onTabsReady);
};

/******************************************************************************/

processCallbackQueue(µm.onBeforeStartQueue, function() {
    µm.loadPublicSuffixList(onPSLReady);
});

/******************************************************************************/

})();

/******************************************************************************/
