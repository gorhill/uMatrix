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

/* global chrome, µMatrix, punycode, publicSuffixList */

/******************************************************************************/

µMatrix.getBytesInUse = function() {
    var getBytesInUseHandler = function(bytesInUse) {
        µMatrix.storageUsed = bytesInUse;
    };
    chrome.storage.local.getBytesInUse(null, getBytesInUseHandler);
};

/******************************************************************************/

µMatrix.saveUserSettings = function() {
    chrome.storage.local.set(this.userSettings, function() {
        µMatrix.getBytesInUse();
    });
};

/******************************************************************************/

µMatrix.loadUserSettings = function() {
    var settingsLoaded = function(store) {
        // console.log('storage.js > loaded user settings');

        // Ensure backward-compatibility
        // https://github.com/gorhill/httpswitchboard/issues/229
        if ( store.smartAutoReload === true ) {
            store.smartAutoReload = 'all';
        } else if ( store.smartAutoReload === false ) {
            store.smartAutoReload = 'none';
        }
        // https://github.com/gorhill/httpswitchboard/issues/250
        if ( typeof store.autoCreateSiteScope === 'boolean' ) {
            store.autoCreateScope = store.autoCreateSiteScope ? 'site' : '';
            delete store.autoCreateSiteScope;
        }
        // https://github.com/gorhill/httpswitchboard/issues/299
        // No longer needed.
        delete store.subframeFgColor;

        µMatrix.userSettings = store;

        // https://github.com/gorhill/httpswitchboard/issues/344
        µMatrix.userAgentSpoofer.shuffle();
    };

    chrome.storage.local.get(this.userSettings, settingsLoaded);
};

/******************************************************************************/

// save white/blacklist
µMatrix.saveMatrix = function() {
    µMatrix.XAL.keyvalSetOne('userMatrix', this.pMatrix.toString());
};

/******************************************************************************/

µMatrix.loadMatrix = function() {
    var µm = this;
    var onLoaded = function(bin) {
        if ( bin.hasOwnProperty('userMatrix') ) {
            µm.pMatrix.fromString(bin.userMatrix);
            µm.tMatrix.assign(µm.pMatrix);
        }
    };
    this.XAL.keyvalGetOne('userMatrix', onLoaded);
};

/******************************************************************************/

µMatrix.loadUbiquitousBlacklists = function() {
    var µm = µMatrix;
    var blacklists;
    var blacklistLoadCount;
    var obsoleteBlacklists = [];

    var removeObsoleteBlacklistsHandler = function(store) {
        if ( !store.remoteBlacklists ) {
            return;
        }
        var location;
        while ( location = obsoleteBlacklists.pop() ) {
            delete store.remoteBlacklists[location];
        }
        chrome.storage.local.set(store);
    };

    var removeObsoleteBlacklists = function() {
        if ( obsoleteBlacklists.length === 0 ) {
            return;
        }
        chrome.storage.local.get(
            { 'remoteBlacklists': µm.remoteBlacklists },
            removeObsoleteBlacklistsHandler
        );
    };

    var mergeBlacklist = function(details) {
        µm.mergeUbiquitousBlacklist(details);
        blacklistLoadCount -= 1;
        if ( blacklistLoadCount === 0 ) {
            loadBlacklistsEnd();
        }
    };

    var loadBlacklistsEnd = function() {
        µm.ubiquitousBlacklist.freeze();
        removeObsoleteBlacklists();
        µm.messaging.announce({ what: 'loadUbiquitousBlacklistCompleted' });
    };

    var loadBlacklistsStart = function(store) {
        // rhill 2013-12-10: set all existing entries to `false`.
        µm.ubiquitousBlacklist.reset();
        blacklists = store.remoteBlacklists;
        var blacklistLocations = Object.keys(store.remoteBlacklists);

        blacklistLoadCount = blacklistLocations.length;
        if ( blacklistLoadCount === 0 ) {
            loadBlacklistsEnd();
            return;
        }

        // Load each preset blacklist which is not disabled.
        var location;
        while ( location = blacklistLocations.pop() ) {
            // If loaded list location is not part of default list locations,
            // remove its entry from local storage.
            if ( !µm.remoteBlacklists[location] ) {
                obsoleteBlacklists.push(location);
                blacklistLoadCount -= 1;
                continue;
            }
            // https://github.com/gorhill/httpswitchboard/issues/218
            // Transfer potentially existing list title into restored list data.
            if ( store.remoteBlacklists[location].title !== µm.remoteBlacklists[location].title ) {
                store.remoteBlacklists[location].title = µm.remoteBlacklists[location].title;
            }
            // Store details of this preset blacklist
            µm.remoteBlacklists[location] = store.remoteBlacklists[location];
            // rhill 2013-12-09:
            // Ignore list if disabled
            // https://github.com/gorhill/httpswitchboard/issues/78
            if ( store.remoteBlacklists[location].off ) {
                blacklistLoadCount -= 1;
                continue;
            }
            µm.assets.get(location, mergeBlacklist);
        }
    };

    var onListOfBlockListsLoaded = function(details) {
        // Initialize built-in list of 3rd-party block lists.
        var lists = JSON.parse(details.content);
        for ( var location in lists ) {
            if ( lists.hasOwnProperty(location) === false ) {
                continue;
            }
            µm.remoteBlacklists['assets/thirdparties/' + location] = lists[location];
        }
        // Now get user's selection of list of block lists.
        chrome.storage.local.get(
            { 'remoteBlacklists': µm.remoteBlacklists },
            loadBlacklistsStart
        );
    };

    // Reset list of 3rd-party block lists.
    for ( var location in this.remoteBlacklists ) {
        if ( location.indexOf('assets/thirdparties/') === 0 ) {
            delete this.remoteBlacklists[location];
        }
    }

    // Get new list of 3rd-party block lists.
    this.assets.get('assets/umatrix/ubiquitous-block-lists.json', onListOfBlockListsLoaded);
};

/******************************************************************************/

µMatrix.mergeUbiquitousBlacklist = function(details) {
    // console.log('storage.js > mergeUbiquitousBlacklist from "%s": "%s..."', details.path, details.content.slice(0, 40));

    var rawText = details.content;
    var rawEnd = rawText.length;

    // rhill 2013-10-21: No need to prefix with '* ', the hostname is just what
    // we need for preset blacklists. The prefix '* ' is ONLY needed when
    // used as a filter in temporary blacklist.

    var ubiquitousBlacklist = this.ubiquitousBlacklist;
    var thisListCount = 0;
    var thisListUsedCount = 0;
    var reLocalhost = /(^|\s)(localhost\.localdomain|localhost|local|broadcasthost|0\.0\.0\.0|127\.0\.0\.1|::1|fe80::1%lo0)(?=\s|$)/g;
    var reAsciiSegment = /^[\x21-\x7e]+$/;
    var matches;
    var lineBeg = 0, lineEnd;
    var line, c;

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

        // Strip comments
        c = line.charAt(0);
        if ( c === '!' || c === '[' ) {
            continue;
        }

        if ( c === '#' ) {
            continue;
        }

        // https://github.com/gorhill/httpswitchboard/issues/15
        // Ensure localhost et al. don't end up in the ubiquitous blacklist.
        line = line
            .replace(/\s+#.*$/, '')
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
            // console.error('"%s": "%s" !== "%s"', details.path, matches[0], line);
            continue;
        }

        line = matches[0];
        if ( line === '' ) {
            continue;
        }

        thisListCount++;
        if ( ubiquitousBlacklist.add(line) ) {
            thisListUsedCount++;
        }
    }

    // For convenience, store the number of entries for this
    // blacklist, user might be happy to know this information.
    this.remoteBlacklists[details.path].entryCount = thisListCount;
    this.remoteBlacklists[details.path].entryUsedCount = thisListUsedCount;
};

/******************************************************************************/

// `switches` contains the preset blacklists for which the switch must be
// revisited.

µMatrix.reloadPresetBlacklists = function(switches) {
    var presetBlacklists = this.remoteBlacklists;

    // Toggle switches
    var i = switches.length;
    while ( i-- ) {
        if ( !presetBlacklists[switches[i].location] ) {
            continue;
        }
        presetBlacklists[switches[i].location].off = !!switches[i].off;
    }

    // Save switch states
    chrome.storage.local.set(
        { 'remoteBlacklists': presetBlacklists },
        this.getBytesInUse.bind(this)
    );

    // Now force reload
    this.loadUbiquitousBlacklists();
};

/******************************************************************************/

µMatrix.loadPublicSuffixList = function() {
    var applyPublicSuffixList = function(details) {
        // TODO: Not getting proper suffix list is a bit serious, I think
        // the extension should be force-restarted if it occurs..
        if ( !details.error ) {
            publicSuffixList.parse(details.content, punycode.toASCII);
        }
    };
    this.assets.get(
        'assets/thirdparties/publicsuffix.org/list/effective_tld_names.dat',
        applyPublicSuffixList
    );
};

/******************************************************************************/

// Load updatable assets

µMatrix.loadUpdatableAssets = function() {
    this.loadUbiquitousBlacklists();
    this.loadPublicSuffixList();
};

/******************************************************************************/

// Load all

µMatrix.load = function() {
    // user
    this.loadUserSettings();
    this.loadMatrix();

    // load updatable assets -- after updating them if needed
    this.assetUpdater.update(null, this.loadUpdatableAssets.bind(this));

    this.getBytesInUse();
};

