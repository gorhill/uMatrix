/*******************************************************************************

    uMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2014-2018 Raymond Hill

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

/* global objectAssign, punycode, publicSuffixList */

'use strict';

/******************************************************************************/

µMatrix.getBytesInUse = function() {
    var µm = this;
    var getBytesInUseHandler = function(bytesInUse) {
        µm.storageUsed = bytesInUse;
    };
    // Not all WebExtension implementations support getBytesInUse().
    if ( typeof vAPI.storage.getBytesInUse === 'function' ) {
        vAPI.storage.getBytesInUse(null, getBytesInUseHandler);
    } else {
        µm.storageUsed = undefined;
    }
};

/******************************************************************************/

µMatrix.saveUserSettings = function() {
    this.XAL.keyvalSetMany(
        this.userSettings,
        this.getBytesInUse.bind(this)
    );
};

µMatrix.loadUserSettings = function(callback) {
    var µm = this;

    if ( typeof callback !== 'function' ) {
        callback = this.noopFunc;
    }

    var settingsLoaded = function(store) {
        // console.log('storage.js > loaded user settings');

        µm.userSettings = store;

        callback(µm.userSettings);
    };

    vAPI.storage.get(this.userSettings, settingsLoaded);
};

/******************************************************************************/

µMatrix.loadRawSettings = function() {
    var µm = this;

    var onLoaded = function(bin) {
        if ( !bin || bin.rawSettings instanceof Object === false ) { return; }
        for ( var key of Object.keys(bin.rawSettings) ) {
            if (
                µm.rawSettings.hasOwnProperty(key) === false ||
                typeof bin.rawSettings[key] !== typeof µm.rawSettings[key]
            ) {
                continue;
            }
            µm.rawSettings[key] = bin.rawSettings[key];
        }
        µm.rawSettingsWriteTime = Date.now();
    };

    vAPI.storage.get('rawSettings', onLoaded);
};

µMatrix.saveRawSettings = function(rawSettings, callback) {
    var keys = Object.keys(rawSettings);
    if ( keys.length === 0 ) {
        if ( typeof callback === 'function' ) {
            callback();
        }
        return;
    }
    for ( var key of keys ) {
        if (
            this.rawSettingsDefault.hasOwnProperty(key) &&
            typeof rawSettings[key] === typeof this.rawSettingsDefault[key]
        ) {
            this.rawSettings[key] = rawSettings[key];
        }
    }
    vAPI.storage.set({ rawSettings: this.rawSettings }, callback);
    this.rawSettingsWriteTime = Date.now();
};

µMatrix.rawSettingsFromString = function(raw) {
    var result = {},
        lineIter = new this.LineIterator(raw),
        line, matches, name, value;
    while ( lineIter.eot() === false ) {
        line = lineIter.next().trim();
        matches = /^(\S+)(\s+(.+))?$/.exec(line);
        if ( matches === null ) { continue; }
        name = matches[1];
        if ( this.rawSettingsDefault.hasOwnProperty(name) === false ) {
            continue;
        }
        value = (matches[2] || '').trim();
        switch ( typeof this.rawSettingsDefault[name] ) {
        case 'boolean':
            if ( value === 'true' ) {
                value = true;
            } else if ( value === 'false' ) {
                value = false;
            } else {
                value = this.rawSettingsDefault[name];
            }
            break;
        case 'string':
            if ( value === '' ) {
                value = this.rawSettingsDefault[name];
            }
            break;
        case 'number':
            value = parseInt(value, 10);
            if ( isNaN(value) ) {
                value = this.rawSettingsDefault[name];
            }
            break;
        default:
            break;
        }
        if ( this.rawSettings[name] !== value ) {
            result[name] = value;
        }
    }
    this.saveRawSettings(result);
};

µMatrix.stringFromRawSettings = function() {
    var out = [];
    for ( var key of Object.keys(this.rawSettings).sort() ) {
        out.push(key + ' ' + this.rawSettings[key]);
    }
    return out.join('\n');
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

µMatrix.listKeysFromCustomHostsFiles = function(raw) {
    var out = new Set(),
        reIgnore = /^[!#]/,
        reValid = /^[a-z-]+:\/\/\S+/,
        lineIter = new this.LineIterator(raw),
        location;
    while ( lineIter.eot() === false ) {
        location = lineIter.next().trim();
        if ( reIgnore.test(location) || !reValid.test(location) ) { continue; }
        out.add(location);
    }
    return this.setToArray(out);
};

/******************************************************************************/

µMatrix.getAvailableHostsFiles = function(callback) {
    var µm = this,
        availableHostsFiles = {};

    // Custom filter lists.
    var importedListKeys = this.listKeysFromCustomHostsFiles(µm.userSettings.externalHostsFiles),
        i = importedListKeys.length,
        listKey, entry;
    while ( i-- ) {
        listKey = importedListKeys[i];
        entry = {
            content: 'filters',
            contentURL: listKey,
            external: true,
            submitter: 'user',
            title: listKey
        };
        availableHostsFiles[listKey] = entry;
        this.assets.registerAssetSource(listKey, entry);
    }

    // selected lists
    var onSelectedHostsFilesLoaded = function(bin) {
        // Now get user's selection of lists
        for ( var assetKey in bin.liveHostsFiles ) {
            var availableEntry = availableHostsFiles[assetKey];
            if ( availableEntry === undefined ) { continue; }
            var liveEntry = bin.liveHostsFiles[assetKey];
            availableEntry.off = liveEntry.off || false;
            if ( liveEntry.entryCount !== undefined ) {
                availableEntry.entryCount = liveEntry.entryCount;
            }
            if ( liveEntry.entryUsedCount !== undefined ) {
                availableEntry.entryUsedCount = liveEntry.entryUsedCount;
            }
            // This may happen if the list name was pulled from the list content
            if ( availableEntry.title === '' && liveEntry.title !== undefined ) {
                availableEntry.title = liveEntry.title;
            }
        }

        // Remove unreferenced imported filter lists.
        var dict = new Set(importedListKeys);
        for ( assetKey in availableHostsFiles ) {
            var entry = availableHostsFiles[assetKey];
            if ( entry.submitter !== 'user' ) { continue; }
            if ( dict.has(assetKey) ) { continue; }
            delete availableHostsFiles[assetKey];
            µm.assets.unregisterAssetSource(assetKey);
            µm.assets.remove(assetKey);
        }

        callback(availableHostsFiles);
    };

    // built-in lists
    var onBuiltinHostsFilesLoaded = function(entries) {
        for ( var assetKey in entries ) {
            if ( entries.hasOwnProperty(assetKey) === false ) { continue; }
            entry = entries[assetKey];
            if ( entry.content !== 'filters' ) { continue; }
            availableHostsFiles[assetKey] = objectAssign({}, entry);
        }

        // Now get user's selection of lists
        vAPI.storage.get(
            { 'liveHostsFiles': availableHostsFiles },
            onSelectedHostsFilesLoaded   
        );
    };

    this.assets.metadata(onBuiltinHostsFilesLoaded);
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
        µm.getBytesInUse();
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
        while ( (location = locations.pop()) ) {
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
    var usedCount = this.ubiquitousBlacklist.count;
    var duplicateCount = this.ubiquitousBlacklist.duplicateCount;

    this.mergeHostsFileContent(details.content);

    usedCount = this.ubiquitousBlacklist.count - usedCount;
    duplicateCount = this.ubiquitousBlacklist.duplicateCount - duplicateCount;

    var hostsFilesMeta = this.liveHostsFiles[details.assetKey];
    hostsFilesMeta.entryCount = usedCount + duplicateCount;
    hostsFilesMeta.entryUsedCount = usedCount;
};

/******************************************************************************/

µMatrix.mergeHostsFileContent = function(rawText) {
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

µMatrix.selectHostsFiles = function(details, callback) {
    var µm = this,
        externalHostsFiles = this.userSettings.externalHostsFiles,
        i, n, assetKey;

    // Hosts file to select
    if ( Array.isArray(details.toSelect) ) {
        for ( assetKey in this.liveHostsFiles ) {
            if ( this.liveHostsFiles.hasOwnProperty(assetKey) === false ) {
                continue;
            }
            if ( details.toSelect.indexOf(assetKey) !== -1 ) {
                this.liveHostsFiles[assetKey].off = false;
            } else if ( details.merge !== true ) {
                this.liveHostsFiles[assetKey].off = true;
            }
        }
    }

    // Imported hosts files to remove
    if ( Array.isArray(details.toRemove) ) {
        var removeURLFromHaystack = function(haystack, needle) {
            return haystack.replace(
                new RegExp(
                    '(^|\\n)' +
                    needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
                    '(\\n|$)', 'g'),
                '\n'
            ).trim();
        };
        for ( i = 0, n = details.toRemove.length; i < n; i++ ) {
            assetKey = details.toRemove[i];
            delete this.liveHostsFiles[assetKey];
            externalHostsFiles = removeURLFromHaystack(externalHostsFiles, assetKey);
            this.assets.remove(assetKey);
        }
    }

    // Hosts file to import
    if ( typeof details.toImport === 'string' ) {
        // https://github.com/gorhill/uBlock/issues/1181
        //   Try mapping the URL of an imported filter list to the assetKey of an
        //   existing stock list.
        var assetKeyFromURL = function(url) {
            var needle = url.replace(/^https?:/, '');
            var assets = µm.liveHostsFiles, asset;
            for ( var assetKey in assets ) {
                asset = assets[assetKey];
                if ( asset.content !== 'filters' ) { continue; }
                if ( typeof asset.contentURL === 'string' ) {
                    if ( asset.contentURL.endsWith(needle) ) { return assetKey; }
                    continue;
                }
                if ( Array.isArray(asset.contentURL) === false ) { continue; }
                for ( i = 0, n = asset.contentURL.length; i < n; i++ ) {
                    if ( asset.contentURL[i].endsWith(needle) ) {
                        return assetKey;
                    }
                }
            }
            return url;
        };
        var importedSet = new Set(this.listKeysFromCustomHostsFiles(externalHostsFiles)),
            toImportSet = new Set(this.listKeysFromCustomHostsFiles(details.toImport)),
            iter = toImportSet.values();
        for (;;) {
            var entry = iter.next();
            if ( entry.done ) { break; }
            if ( importedSet.has(entry.value) ) { continue; }
            assetKey = assetKeyFromURL(entry.value);
            if ( assetKey === entry.value ) {
                importedSet.add(entry.value);
            }
            this.liveHostsFiles[assetKey] = {
                content: 'filters',
                contentURL: [ assetKey ],
                title: assetKey
            };
        }
        externalHostsFiles = this.setToArray(importedSet).sort().join('\n');
    }

    if ( externalHostsFiles !== this.userSettings.externalHostsFiles ) {
        this.userSettings.externalHostsFiles = externalHostsFiles;
        vAPI.storage.set({ externalHostsFiles: externalHostsFiles });
    }
    vAPI.storage.set({ 'liveHostsFiles': this.liveHostsFiles });

    if ( typeof callback === 'function' ) {
        callback();
    }
};

/******************************************************************************/

// `switches` contains the preset blacklists for which the switch must be
// revisited.

µMatrix.reloadHostsFiles = function() {
    this.loadHostsFiles();
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

    this.assets.get(this.pslAssetKey, applyPublicSuffixList);
};

/******************************************************************************/

µMatrix.scheduleAssetUpdater = (function() {
    var timer, next = 0;
    return function(updateDelay) {
        if ( timer ) {
            clearTimeout(timer);
            timer = undefined;
        }
        if ( updateDelay === 0 ) {
            next = 0;
            return;
        }
        var now = Date.now();
        // Use the new schedule if and only if it is earlier than the previous
        // one.
        if ( next !== 0 ) {
            updateDelay = Math.min(updateDelay, Math.max(next - now, 0));
        }
        next = now + updateDelay;
        timer = vAPI.setTimeout(function() {
            timer = undefined;
            next = 0;
            µMatrix.assets.updateStart({ delay: 120000 });
        }, updateDelay);
    };
})();

/******************************************************************************/

µMatrix.assetObserver = function(topic, details) {
    // Do not update filter list if not in use.
    if ( topic === 'before-asset-updated' ) {
        if (
            this.liveHostsFiles.hasOwnProperty(details.assetKey) === false ||
            this.liveHostsFiles[details.assetKey].off === true
        ) {
            return false;
        }
        return;
    }

    if ( topic === 'after-asset-updated' ) {
        vAPI.messaging.broadcast({
            what: 'assetUpdated',
            key: details.assetKey,
            cached: true
        });
        return;
    }

    // Update failed.
    if ( topic === 'asset-update-failed' ) {
        vAPI.messaging.broadcast({
            what: 'assetUpdated',
            key: details.assetKey,
            failed: true
        });
        return;
    }

    // Reload all filter lists if needed.
    if ( topic === 'after-assets-updated' ) {
        if ( details.assetKeys.length !== 0 ) {
            this.loadHostsFiles();
        }
        if ( this.userSettings.autoUpdate ) {
            this.scheduleAssetUpdater(25200000);
        } else {
            this.scheduleAssetUpdater(0);
        }
        vAPI.messaging.broadcast({
            what: 'assetsUpdated',
            assetKeys: details.assetKeys
        });
        return;
    }

    // New asset source became available, if it's a filter list, should we
    // auto-select it?
    if ( topic === 'builtin-asset-source-added' ) {
        if ( details.entry.content === 'filters' ) {
            if ( details.entry.off !== true ) {
                this.saveSelectedFilterLists([ details.assetKey ], true);
            }
        }
        return;
    }
};
