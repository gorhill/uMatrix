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

'use strict';

/******************************************************************************/

const µMatrix = (( ) => { // jshint ignore:line

/******************************************************************************/

const oneSecond = 1000;
const oneMinute = 60 * oneSecond;
const oneHour = 60 * oneMinute;
const oneDay = 24 * oneHour;

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

const rawSettingsDefault = {
    assetFetchBypassBrowserCache: false,
    assetFetchTimeout: 30,
    autoUpdateAssetFetchPeriod: 120,
    cnameIgnoreList: 'unset',
    cnameIgnore1stParty: true,
    cnameIgnoreExceptions: true,
    cnameIgnoreRootDocument: true,
    cnameMaxTTL: 60,
    cnameReplayFullURL: false,
    consoleLogLevel: 'unset',
    contributorMode: false,
    disableCSPReportInjection: false,
    disableWebAssembly: false,
    enforceEscapedFragment: true,
    loggerPopupType: 'popup',
    manualUpdateAssetFetchPeriod: 500,
    placeholderBackground:
        [
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
    placeholderBorder: '1px solid rgba(0, 0, 0, 0.1)',
    imagePlaceholder: true,
    imagePlaceholderBackground: 'default',
    imagePlaceholderBorder: 'default',
    framePlaceholder: true,
    framePlaceholderDocument:
        [
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
    framePlaceholderBackground: 'default',
    suspendTabsUntilReady: false
};

/******************************************************************************/

return {
    onBeforeStartQueue: [],

    userSettings: {
        alwaysDetachLogger: false,
        autoUpdate: true,
        clearBrowserCache: true,
        clearBrowserCacheAfter: 60,
        cloudStorageEnabled: false,
        collapseBlacklisted: true,
        collapseBlocked: false,
        colorBlindFriendly: false,
        deleteCookies: false,
        deleteUnusedSessionCookies: false,
        deleteUnusedSessionCookiesAfter: 60,
        deleteLocalStorage: false,
        displayTextSize: '14px',
        externalHostsFiles: [],
        externalRecipeFiles: [],
        iconBadgeEnabled: true,
        noTooltips: false,
        popupCollapseAllDomains: false,
        popupCollapseBlacklistedDomains: false,
        popupScopeLevel: 'domain',
        processHyperlinkAuditing: true,
        selectedHostsFiles: [ '' ],
        selectedRecipeFiles: [ '' ],
        userHosts: {
            enabled: false,
            content: ''
        },
        userRecipes: {
            enabled: false,
            content: ''
        }
    },

    rawSettingsDefault,
    rawSettings: (( ) => {
        const out = Object.assign({}, rawSettingsDefault);
        const json = vAPI.localStorage.getItem('immediateRawSettings');
        if ( typeof json !== 'string' ) { return out; }
        try {
            const o = JSON.parse(json);
            if ( o instanceof Object ) {
                for ( const k in o ) {
                    if ( out.hasOwnProperty(k) ) { out[k] = o[k]; }
                }
                self.log.verbosity = out.consoleLogLevel;
                if ( typeof out.suspendTabsUntilReady === 'boolean' ) {
                    out.suspendTabsUntilReady = out.suspendTabsUntilReady
                        ? 'yes'
                        : 'unset';
                }
            }
        }
        catch(ex) {
        }
        return out;
    })(),
    rawSettingsWriteTime: 0,

    clearBrowserCacheCycle: 0,
    cspNoInlineScript: "script-src 'unsafe-eval' blob: *",
    cspNoInlineStyle: "style-src blob: *",
    cspNoWorker: "worker-src 'none'; report-uri about:blank",
    cantMergeCSPHeaders: false,
    updateAssetsEvery: 11 * oneDay + 1 * oneHour + 1 * oneMinute + 1 * oneSecond,
    firstUpdateAfter: 11 * oneMinute,
    nextUpdateAfter: 11 * oneHour,
    assetsBootstrapLocation: 'assets/assets.json',
    pslAssetKey: 'public_suffix_list.dat',

    // list of live hosts files
    liveHostsFiles: new Map(),

    // urls stats are kept on the back burner while waiting to be reactivated
    // in a tab or another.
    pageStores: new Map(),
    pageStoresToken: 0,
    pageStoreCemetery: new Map(),

    // page url => permission scope
    tMatrix: null,
    pMatrix: null,

    ubiquitousBlacklist: null,
    ubiquitousBlacklistRef: null,

    // various stats
    cookieRemovedCounter: 0,
    localStorageRemovedCounter: 0,
    cookieHeaderFoiledCounter: 0,
    hyperlinkAuditingFoiledCounter: 0,
    browserCacheClearedCounter: 0,

    // record what the browser is doing behind the scene
    behindTheSceneScope: 'behind-the-scene',

    noopFunc: function(){},

    // so that I don't have to care for last comma
    dummy: 0
};

/******************************************************************************/

})();

/******************************************************************************/

