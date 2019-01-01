/*******************************************************************************

    uMatrix - a browser extension to black/white list requests.
    Copyright (C) 2014-present Raymond Hill

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

    µm.loadRecipes();

    // https://github.com/uBlockOrigin/uMatrix-issues/issues/63
    //   Ensure user settings are fully loaded before launching the
    //   asset updater.
    µm.assets.addObserver(µm.assetObserver.bind(µm));
    µm.scheduleAssetUpdater(µm.userSettings.autoUpdate ? 7 * 60 * 1000 : 0);

    vAPI.cloud.start([ 'myRulesPane' ]);
};

/******************************************************************************/

var onPSLReady = function() {
    // TODO: Promisify
    let count = 4;
    const countdown = ( ) => {
        count -= 1;
        if ( count !== 0 ) { return; }
        onAllDone();
    };

    µm.loadRawSettings(countdown);
    µm.loadMatrix(countdown);
    µm.loadHostsFiles(countdown);

    vAPI.tabs.getAll(tabs => {
        const pageStore =
            µm.pageStoreFactory(µm.tabContextManager.mustLookup(vAPI.noTabId));
        pageStore.title = vAPI.i18n('statsPageDetailedBehindTheScenePage');
        µm.pageStores.set(vAPI.noTabId, pageStore);

        if ( Array.isArray(tabs) ) {
            for ( const tab of tabs ) {
                µm.tabContextManager.push(tab.id, tab.url, 'newURL');
            }
        }
        countdown();
    });
};

/******************************************************************************/

processCallbackQueue(µm.onBeforeStartQueue, function() {
    // TODO: Promisify
    let count = 2;
    const countdown = ( ) => {
        count -= 1;
        if ( count !== 0 ) { return; }
        onPSLReady();
    };

    µm.publicSuffixList.load(countdown);
    µm.loadUserSettings(countdown);
});

/******************************************************************************/

})();

/******************************************************************************/
