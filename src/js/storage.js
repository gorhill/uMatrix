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

/* jshint boss: true */
/* global chrome, µMatrix, punycode, publicSuffixList */

/******************************************************************************/

µMatrix.getBytesInUse = function() {
    var µm = this;
    var getBytesInUseHandler = function(bytesInUse) {
        µm.storageUsed = bytesInUse;
    };
    vAPI.storage.getBytesInUse(null, getBytesInUseHandler);
};

/******************************************************************************/

µMatrix.saveUserSettings = function() {
    this.XAL.keyvalSetMany(
        this.userSettings,
        this.getBytesInUse.bind(this)
    );
};

/******************************************************************************/

µMatrix.loadUserSettings = function(callback) {
    var µm = this;

    if ( typeof callback !== 'function' ) {
        callback = this.noopFunc;
    }

    var settingsLoaded = function(store) {
        // console.log('storage.js > loaded user settings');

        µm.userSettings = store;

        // https://github.com/gorhill/httpswitchboard/issues/344
        µm.userAgentSpoofer.shuffle();

        callback(µm.userSettings);
    };

    vAPI.storage.get(this.userSettings, settingsLoaded);
};

/******************************************************************************/

// save white/blacklist
µMatrix.saveMatrix = function() {
    µMatrix.XAL.keyvalSetOne('userMatrix', this.pMatrix.toString());
};

/******************************************************************************/

µMatrix.loadMatrix = function(callback) {
    if ( typeof callback !== 'function' ) {
        callback = this.noopFunc;
    }
    var µm = this;
    var onLoaded = function(bin) {
        if ( bin.hasOwnProperty('userMatrix') ) {
            µm.pMatrix.fromString(bin.userMatrix);
            µm.tMatrix.assign(µm.pMatrix);
            callback();
        }
    };
    this.XAL.keyvalGetOne('userMatrix', onLoaded);
};

/******************************************************************************/

µMatrix.getAvailableHostsFiles = function(callback) {
    var availableHostsFiles = {};
    var redirections = {};
    var µm = this;

    // selected lists
    var onSelectedHostsFilesLoaded = function(store) {
        var lists = store.liveHostsFiles;
        var locations = Object.keys(lists);
        var oldLocation, newLocation;
        var availableEntry, storedEntry;

        while ( oldLocation = locations.pop() ) {
            newLocation = redirections[oldLocation] || oldLocation;
            availableEntry = availableHostsFiles[newLocation];
            if ( availableEntry === undefined ) {
                continue;
            }
            storedEntry = lists[oldLocation];
            availableEntry.off = storedEntry.off || false;
            µm.assets.setHomeURL(newLocation, availableEntry.homeURL);
            if ( storedEntry.entryCount !== undefined ) {
                availableEntry.entryCount = storedEntry.entryCount;
            }
            if ( storedEntry.entryUsedCount !== undefined ) {
                availableEntry.entryUsedCount = storedEntry.entryUsedCount;
            }
            // This may happen if the list name was pulled from the list content
            if ( availableEntry.title === '' && storedEntry.title !== '' ) {
                availableEntry.title = storedEntry.title;
            }
        }
        callback(availableHostsFiles);
    };

    // built-in lists
    var onBuiltinHostsFilesLoaded = function(details) {
        var location, locations;
        try {
            locations = JSON.parse(details.content);
        } catch (e) {
            locations = {};
        }
        var hostsFileEntry;
        for ( location in locations ) {
            if ( locations.hasOwnProperty(location) === false ) {
                continue;
            }
            hostsFileEntry = locations[location];
            availableHostsFiles['assets/thirdparties/' + location] = hostsFileEntry;
            if ( hostsFileEntry.old !== undefined ) {
                redirections[hostsFileEntry.old] = location;
                delete hostsFileEntry.old;
            }
        }

        // Now get user's selection of lists
        vAPI.storage.get(
            { 'liveHostsFiles': availableHostsFiles },
            onSelectedHostsFilesLoaded   
        );
    };

    // permanent hosts files
    var location;
    var lists = this.permanentHostsFiles;
    for ( location in lists ) {
        if ( lists.hasOwnProperty(location) === false ) {
            continue;
        }
        availableHostsFiles[location] = lists[location];
    }

    // custom lists
    var c;
    var locations = this.userSettings.externalHostsFiles.split('\n');
    for ( var i = 0; i < locations.length; i++ ) {
        location = locations[i].trim();
        c = location.charAt(0);
        if ( location === '' || c === '!' || c === '#' ) {
            continue;
        }
        // Coarse validation
        if ( /[^0-9A-Za-z!*'();:@&=+$,\/?%#\[\]_.~-]/.test(location) ) {
            continue;
        }
        availableHostsFiles[location] = {
            title: '',
            external: true
        };
    }

    // get built-in block lists.
    this.assets.get('assets/umatrix/hosts-files.json', onBuiltinHostsFilesLoaded);
};

/******************************************************************************/

µMatrix.loadHostsFiles = function(callback) {
    var µm = µMatrix;
    var hostsFileLoadCount;

    if ( typeof callback !== 'function' ) {
        callback = this.noopFunc;
    }

    var loadHostsFilesEnd = function() {
        µm.ubiquitousBlacklist.freeze();
        vAPI.storage.set({ 'liveHostsFiles': µm.liveHostsFiles });
        vAPI.messaging.broadcast({ what: 'loadHostsFilesCompleted' });
        callback();
    };

    var mergeHostsFile = function(details) {
        µm.mergeHostsFile(details);
        hostsFileLoadCount -= 1;
        if ( hostsFileLoadCount === 0 ) {
            loadHostsFilesEnd();
        }
    };

    var loadHostsFilesStart = function(hostsFiles) {
        µm.liveHostsFiles = hostsFiles;
        µm.ubiquitousBlacklist.reset();
        var locations = Object.keys(hostsFiles);
        hostsFileLoadCount = locations.length;

        // Load all hosts file which are not disabled.
        var location;
        while ( location = locations.pop() ) {
            if ( hostsFiles[location].off ) {
                hostsFileLoadCount -= 1;
                continue;
            }
            µm.assets.get(location, mergeHostsFile);
        }

        // https://github.com/gorhill/uMatrix/issues/2
        if ( hostsFileLoadCount === 0 ) {
            loadHostsFilesEnd();
            return;
        }
    };

    this.getAvailableHostsFiles(loadHostsFilesStart);
};

/******************************************************************************/

µMatrix.mergeHostsFile = function(details) {
    //console.log('storage.js > mergeHostsFile from "%s": "%s..."', details.path, details.content.slice(0, 40));

    var usedCount = this.ubiquitousBlacklist.count;
    var duplicateCount = this.ubiquitousBlacklist.duplicateCount;

    this.mergeHostsFileContent(details.content);

    usedCount = this.ubiquitousBlacklist.count - usedCount;
    duplicateCount = this.ubiquitousBlacklist.duplicateCount - duplicateCount;

    var hostsFilesMeta = this.liveHostsFiles[details.path];
    hostsFilesMeta.entryCount = usedCount + duplicateCount;
    hostsFilesMeta.entryUsedCount = usedCount;
};

/******************************************************************************/

µMatrix.mergeHostsFileContent = function(rawText) {
    //console.log('storage.js > mergeHostsFileContent from "%s": "%s..."', details.path, details.content.slice(0, 40));

    var rawEnd = rawText.length;
    var ubiquitousBlacklist = this.ubiquitousBlacklist;
    var reLocalhost = /(^|\s)(localhost\.localdomain|localhost|local|broadcasthost|0\.0\.0\.0|127\.0\.0\.1|::1|fe80::1%lo0)(?=\s|$)/g;
    var reAsciiSegment = /^[\x21-\x7e]+$/;
    var matches;
    var lineBeg = 0, lineEnd;
    var line;

    while ( lineBeg < rawEnd ) {
        lineEnd = rawText.indexOf('\n', lineBeg);
        if ( lineEnd < 0 ) {
            lineEnd = rawText.indexOf('\r', lineBeg);
            if ( lineEnd < 0 ) {
                lineEnd = rawEnd;
            }
        }

        // rhill 2014-04-18: The trim is important here, as without it there
        // could be a lingering `\r` which would cause problems in the
        // following parsing code.
        line = rawText.slice(lineBeg, lineEnd).trim();
        lineBeg = lineEnd + 1;

        // https://github.com/gorhill/httpswitchboard/issues/15
        // Ensure localhost et al. don't end up in the ubiquitous blacklist.
        line = line
            .replace(/#.*$/, '')
            .toLowerCase()
            .replace(reLocalhost, '')
            .trim();

        // The filter is whatever sequence of printable ascii character without
        // whitespaces
        matches = reAsciiSegment.exec(line);
        if ( !matches || matches.length === 0 ) {
            continue;
        }

        // Bypass anomalies
        // For example, when a filter contains whitespace characters, or
        // whatever else outside the range of printable ascii characters.
        if ( matches[0] !== line ) {
            //console.error('"%s": "%s" !== "%s"', details.path, matches[0], line);
            continue;
        }

        line = matches[0];
        if ( line === '' ) {
            continue;
        }

        ubiquitousBlacklist.add(line);
    }
};

/******************************************************************************/

// `switches` contains the filter lists for which the switch must be revisited.

µMatrix.selectHostsFiles = function(switches) {
    switches = switches || {};

    // Only the lists referenced by the switches are touched.
    var liveHostsFiles = this.liveHostsFiles;
    var entry, state, location;
    var i = switches.length;
    while ( i-- ) {
        entry = switches[i];
        state = entry.off === true;
        location = entry.location;
        if ( liveHostsFiles.hasOwnProperty(location) === false ) {
            if ( state !== true ) {
                liveHostsFiles[location] = { off: state };
            }
            continue;
        }
        if ( liveHostsFiles[location].off === state ) {
            continue;
        }
        liveHostsFiles[location].off = state;
    }

    vAPI.storage.set({ 'liveHostsFiles': liveHostsFiles });
};

/******************************************************************************/

// `switches` contains the preset blacklists for which the switch must be
// revisited.

µMatrix.reloadHostsFiles = function() {
    var µm = this;

    // We are just reloading the filter lists: we do not want assets to update.
    this.assets.autoUpdate = false;

    var onHostsFilesReady = function() {
        µm.assets.autoUpdate = µm.userSettings.autoUpdate;
    };

    this.loadHostsFiles(onHostsFilesReady);
};

/******************************************************************************/

µMatrix.loadPublicSuffixList = function(callback) {
    if ( typeof callback !== 'function' ) {
        callback = this.noopFunc;
    }

    var applyPublicSuffixList = function(details) {
        if ( !details.error ) {
            publicSuffixList.parse(details.content, punycode.toASCII);
        }
        callback();
    };

    this.assets.get(this.pslPath, applyPublicSuffixList);
};

/******************************************************************************/

µMatrix.updateStartHandler = function(callback) {
    var µm = this;
    var onListsReady = function(lists) {
        var assets = {};
        for ( var location in lists ) {
            if ( lists.hasOwnProperty(location) === false ) {
                continue;
            }
            if ( lists[location].off ) {
                continue;
            }
            assets[location] = true;
        }
        assets[µm.pslPath] = true;
        callback(assets);
    };

    this.getAvailableHostsFiles(onListsReady);
};

/******************************************************************************/

µMatrix.assetUpdatedHandler = function(details) {
    var path = details.path || '';
    if ( this.liveHostsFiles.hasOwnProperty(path) === false ) {
        return;
    }
    var entry = this.liveHostsFiles[path];
    if ( entry.off ) {
        return;
    }
    // Compile the list while we have the raw version in memory
    //console.debug('µMatrix.getCompiledFilterList/onRawListLoaded: compiling "%s"', path);
    //this.assets.put(
    //    this.getCompiledFilterListPath(path),
    //    this.compileFilters(details.content)
    //);
};

/******************************************************************************/

µMatrix.updateCompleteHandler = function(details) {
    var µm = this;

    var updatedCount = details.updatedCount;
    if ( updatedCount === 0 ) {
        return;
    }

    // Assets are supposed to have been all updated, prevent fetching from
    // remote servers.
    µm.assets.remoteFetchBarrier += 1;

    var onFiltersReady = function() {
        µm.assets.remoteFetchBarrier -= 1;
    };

    var onPSLReady = function() {
        if ( updatedCount !== 0 ) {
            //console.debug('storage.js > µMatrix.updateCompleteHandler: reloading filter lists');
            µm.loadHostsFiles(onFiltersReady);
        } else {
            onFiltersReady();
        }
    };

    if ( details.hasOwnProperty(this.pslPath) ) {
        //console.debug('storage.js > µMatrix.updateCompleteHandler: reloading PSL');
        this.loadPublicSuffixList(onPSLReady);
        updatedCount -= 1;
    } else {
        onPSLReady();
    }
};

/******************************************************************************/

µMatrix.assetCacheRemovedHandler = (function() {
    var barrier = false;

    var handler = function(paths) {
        if ( barrier ) {
            return;
        }
        barrier = true;
        var i = paths.length;
        var path;
        while ( i-- ) {
            path = paths[i];
            if ( this.liveHostsFiles.hasOwnProperty(path) ) {
                //console.debug('µMatrix.assetCacheRemovedHandler: decompiling "%s"', path);
                //this.purgeCompiledFilterList(path);
                continue;
            }
            if ( path === this.pslPath ) {
                //console.debug('µMatrix.assetCacheRemovedHandler: decompiling "%s"', path);
                //this.assets.purge('cache://compiled-publicsuffixlist');
                continue;
            }
        }
        //this.destroySelfie();
        barrier = false;
    };

    return handler;
})();
