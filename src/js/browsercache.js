/*******************************************************************************

    uMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2015 Raymond Hill

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

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

// Browser data jobs

var clearCache = function() {
    vAPI.setTimeout(clearCache, 1 * 60 * 1000);

    var µm = µMatrix;
    if ( !µm.userSettings.clearBrowserCache ) {
        return;
    }

    µm.clearBrowserCacheCycle -= 1;
    if ( µm.clearBrowserCacheCycle > 0 ) {
        return;
    }

    vAPI.browserData.clearCache();

    µm.clearBrowserCacheCycle = µm.userSettings.clearBrowserCacheAfter;
    µm.browserCacheClearedCounter++;

    // TODO: i18n
    µm.logger.writeOne('', 'info', vAPI.i18n('loggerEntryBrowserCacheCleared'));

    //console.debug('clearBrowserCacheCallback()> vAPI.browserData.clearCache() called');
};

vAPI.setTimeout(clearCache, 1 * 60 * 1000);

/******************************************************************************/

})();

/******************************************************************************/
