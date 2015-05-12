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

// Load everything

(function() {

'use strict';

/******************************************************************************/

var µm = µMatrix;

/******************************************************************************/

var defaultLocalUserSettings = {
    placeholderBackground: [
            'linear-gradient(0deg,',
                'rgba(0,0,0,0.02) 25%,',
                'rgba(0,0,0,0.05) 25%,',
                'rgba(0,0,0,0.05) 75%,',
                'rgba(0,0,0,0.02) 75%,',
                'rgba(0,0,0,0.02)',
            ') center center / 10px 10px repeat scroll,',
            'linear-gradient(',
                '90deg,',
                'rgba(0,0,0,0.02) 25%,',
                'rgba(0,0,0,0.05) 25%,',
                'rgba(0,0,0,0.05) 75%,',
                'rgba(0,0,0,0.02) 75%,',
                'rgba(0,0,0,0.02)',
            ') center center / 10px 10px repeat scroll #fff'
        ].join(''),
    placeholderBorder: '1px solid rgba(0, 0, 0, 0.05)',
    placeholderDocument: [
            '<html><head>',
            '<meta charset="utf-8">',
            '<style>',
            'body { ',
                'background: {{bg}};',
                'color: gray;',
                'font: 12px sans-serif;',
                'margin: 0;',
                'overflow: hidden;',
                'padding: 2px;',
                'white-space: nowrap;',
            '}',
            'a { ',
                'color: inherit;',
                'padding: 0 3px;',
                'text-decoration: none;',
            '}',
            '</style></head><body>',
            '<a href="{{url}}" title="{{url}}" target="_blank">&#x2191;</a>{{url}}',
            '</body></html>'
        ].join(''),
    placeholderImage: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
};

/******************************************************************************/

// Important: raise barrier to remote fetching: we do not want resources to
// be pulled from remote server at start up time.

µm.assets.remoteFetchBarrier += 1;

/******************************************************************************/

var onAllDone = function() {
    µm.webRequest.start();

    // https://github.com/chrisaljoudi/uBlock/issues/184
    // Check for updates not too far in the future.
    µm.assetUpdater.onStart.addListener(µm.updateStartHandler.bind(µm));
    µm.assetUpdater.onCompleted.addListener(µm.updateCompleteHandler.bind(µm));
    µm.assetUpdater.onAssetUpdated.addListener(µm.assetUpdatedHandler.bind(µm));
    µm.assets.onAssetCacheRemoved.addListener(µm.assetCacheRemovedHandler.bind(µm));

    for ( var key in defaultLocalUserSettings ) {
        if ( defaultLocalUserSettings.hasOwnProperty(key) === false ) {
            continue;
        }
        //if ( vAPI.localStorage.getItem(key) === null ) {
            vAPI.localStorage.setItem(key, defaultLocalUserSettings[key]);
        //}
    }
};

var onTabsReady = function(tabs) {
    var tab;
    var i = tabs.length;
    // console.debug('start.js > binding %d tabs', i);
    while ( i-- ) {
        tab = tabs[i];
        µm.tabContextManager.commit(tab.id, tab.url);
        // https://github.com/gorhill/uMatrix/issues/56
        // We must unbind first to flush out potentially bad domain names.
        µm.unbindTabFromPageStats(tab.id);
        µm.bindTabToPageStats(tab.id);
    }

    onAllDone();
};

var onHostsFilesLoaded = function() {
    // Important: remove barrier to remote fetching, this was useful only
    // for launch time.
    µm.assets.remoteFetchBarrier -= 1;
};

var onUserSettingsLoaded = function() {
    // Version 0.9.0.0
    // Remove obsolete user settings which may have been loaded.
    // These are now stored as local settings:
    delete µm.userSettings.popupCollapseDomains;
    delete µm.userSettings.popupCollapseSpecificDomains;
    delete µm.userSettings.popupHideBlacklisted;
    // These do not exist anymore:
    delete µm.smartAutoReload;
    delete µm.userSettings.statsFilters;
    delete µm.userSettings.subframeColor;
    delete µm.userSettings.subframeOpacity;

    µm.loadHostsFiles(onHostsFilesLoaded);
};

var onPSLReady = function() {
    µm.loadUserSettings(onUserSettingsLoaded);
    µm.loadMatrix();

    // rhill 2013-11-24: bind behind-the-scene virtual tab/url manually, since the
    // normal way forbid binding behind the scene tab.
    // https://github.com/gorhill/httpswitchboard/issues/67
    µm.pageStores[vAPI.noTabId] = µm.PageStore.factory(
        µm.tabContextManager.mustLookup(vAPI.noTabId)
    );

    vAPI.tabs.getAll(onTabsReady);
};

// Must be done ASAP
µm.loadPublicSuffixList(onPSLReady);

/******************************************************************************/

})();

/******************************************************************************/
