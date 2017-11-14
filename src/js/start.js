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

/*******************************************************************************

    SVG-based icons below were extracted from
    fontawesome-webfont.svg v4.7. Excerpt of copyright notice at
    the top of the file:

    > Created by FontForge 20120731 at Mon Oct 24 17:37:40 2016
    > By ,,,
    > Copyright Dave Gandy 2016. All rights reserved.

    Excerpt of the license information in the fontawesome CSS
    file bundled with the package:

    > Font Awesome 4.7.0 by @davegandy - http://fontawesome.io - @fontawesome
    > License - http://fontawesome.io/license (Font: SIL OFL 1.1, CSS: MIT License)

    Font icons:
    - glyph-name: "external_link"

*/

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
            'svg {',
                'display: inline-block;',
                'fill: gray;',
                'height: 12px;',
                'vertical-align: bottom;',
                'width: 12px;',
            '}',
            '</style></head><body>',
            '<span><a href="{{url}}" title="{{url}}" target="_blank">',
            '<svg viewBox="0 0 1792 1792"><path transform="scale(1,-1) translate(0,-1536)" d="M1408 608v-320q0 -119 -84.5 -203.5t-203.5 -84.5h-832q-119 0 -203.5 84.5t-84.5 203.5v832q0 119 84.5 203.5t203.5 84.5h704q14 0 23 -9t9 -23v-64q0 -14 -9 -23t-23 -9h-704q-66 0 -113 -47t-47 -113v-832q0 -66 47 -113t113 -47h832q66 0 113 47t47 113v320q0 14 9 23t23 9h64q14 0 23 -9t9 -23zM1792 1472v-512q0 -26 -19 -45t-45 -19t-45 19l-176 176l-652 -652q-10 -10 -23 -10t-23 10l-114 114q-10 10 -10 23t10 23l652 652l-176 176q-19 19 -19 45t19 45t45 19h512q26 0 45 -19t19 -45z" /></svg>',
            '</a>{{url}}</span>',
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
