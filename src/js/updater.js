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

/* global µMatrix */

/******************************************************************************/

// Automatic update of non-user assets
// https://github.com/gorhill/httpswitchboard/issues/334

µMatrix.updater = (function() {

/******************************************************************************/

var µm = µMatrix;

var jobCallback = function() {
    // Simpler to fire restart here, and safe given how far this will happen
    // in the future.
    restart();

    // If auto-update is disabled, check again in a while.
    if ( µm.userSettings.autoUpdate !== true ) {
        return;
    }

    var onMetadataReady = function(metadata) {
        // Check PSL
        var mdEntry = metadata[µm.pslPath];
        if ( mdEntry.repoObsolete ) {
            µm.loadUpdatableAssets(true);
            return;
        }
        // Check used hosts files
        var hostsFiles = µm.liveHostsFiles;
        for ( var path in hostsFiles ) {
            if ( hostsFiles.hasOwnProperty(path) === false ) {
                continue;
            }
            if ( hostsFiles[path].off ) {
                continue;
            }
            if ( metadata.hasOwnProperty(path) === false ) {
                continue;
            }
            mdEntry = metadata[path];
            if ( mdEntry.cacheObsolete || mdEntry.repoObsolete ) {
                µm.loadUpdatableAssets(true);
                return;
            }
        }

        // console.log('updater.js > all is up to date');
    };

    µm.assets.metadata(onMetadataReady);
};

// https://www.youtube.com/watch?v=cIrGQD84F1g

/******************************************************************************/

var restart = function(after) {
    if ( after === undefined ) {
        after = µm.nextUpdateAfter;
    }

    µm.asyncJobs.add(
        'autoUpdateAssets',
        null,
        jobCallback,
        after,
        false
    );
};

/******************************************************************************/

return {
    restart: restart
};

/******************************************************************************/

})();

/******************************************************************************/
