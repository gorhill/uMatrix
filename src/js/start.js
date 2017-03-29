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
    // data-URI background courtesy of https://github.com/dev-random
    // https://github.com/gorhill/uMatrix/issues/429#issuecomment-194548243
    placeholderBackground: [
            'url("data:image/png;base64,',
                'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAK',
                'CAAAAACoWZBhAAAABGdBTUEAALGPC/xh',
                'BQAAAAJiS0dEAP+Hj8y/AAAAB3RJTUUH',
                '3wwIAAgyL/YaPAAAACJJREFUCFtjfMbO',
                'AAQ/gZiFnQPEBAEmGIMIJgtIL8QEgtoA',
                'In4D/96X1KAAAAAldEVYdGRhdGU6Y3Jl',
                'YXRlADIwMTUtMTItMDhUMDA6MDg6NTAr',
                'MDM6MDAasuuJAAAAJXRFWHRkYXRlOm1v',
                'ZGlmeQAyMDE1LTEyLTA4VDAwOjA4OjUw',
                'KzAzOjAwa+9TNQAAAABJRU5ErkJggg==',
            '") ',
            'repeat scroll #fff'
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
    placeholderImage: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='
};

var rwLocalUserSettings = {
    placeholderBackground: true,
    placeholderBorder: true,
    placeholderImage: true
};

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

    for ( var key in defaultLocalUserSettings ) {
        if ( defaultLocalUserSettings.hasOwnProperty(key) === false ) {
            continue;
        }
        if (
            vAPI.localStorage.getItem(key) === null ||
            rwLocalUserSettings.hasOwnProperty(key) === false
        ) {
            vAPI.localStorage.setItem(key, defaultLocalUserSettings[key]);
        }
    }

    vAPI.cloud.start([ 'myRulesPane' ]);
};

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

    µm.loadHostsFiles();
};

var onPSLReady = function() {
    µm.loadUserSettings(onUserSettingsLoaded);
    µm.loadMatrix();

    // rhill 2013-11-24: bind behind-the-scene virtual tab/url manually, since the
    // normal way forbid binding behind the scene tab.
    // https://github.com/gorhill/httpswitchboard/issues/67
    µm.pageStores[vAPI.noTabId] = µm.PageStore.factory(µm.tabContextManager.mustLookup(vAPI.noTabId));
    µm.pageStores[vAPI.noTabId].title = vAPI.i18n('statsPageDetailedBehindTheScenePage');

    vAPI.tabs.getAll(onTabsReady);
};

processCallbackQueue(µm.onBeforeStartQueue, function() {
    µm.loadPublicSuffixList(onPSLReady);
});

/******************************************************************************/

})();

/******************************************************************************/
