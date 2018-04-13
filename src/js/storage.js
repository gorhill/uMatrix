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

    var onAvailableRulesetFilesReady = function(availableRulesetFiles) {
        let selectedAssetKeys = new Set();
        for ( let entry of availableRulesetFiles ) {
            let assetKey = entry[0];
            let assetLang = entry[1].lang;
            if ( assetLang === undefined ) {
                selectedAssetKeys.add(assetKey);
                continue;
            }
            for ( let lang of navigator.languages ) {
                if ( assetLang.indexOf(lang) !== -1 ) {
                    selectedAssetKeys.add(assetKey);
                    break;
                }
            }
        }
        µm.userSettings.selectedRecipeFiles = Array.from(selectedAssetKeys);
        vAPI.storage.set({
            selectedRecipeFiles: µm.userSettings.selectedRecipeFiles
        });
        callback(µm.userSettings);
    };

    var initializeSelectedRulesetFiles = function() {
        if (
            µm.userSettings.selectedRecipeFiles.length === 1 &&
            µm.userSettings.selectedRecipeFiles[0] === ''
        ) {
            µm.getAvailableRecipeFiles(onAvailableRulesetFilesReady);
            return;
        }
        callback(µm.userSettings);
    };

    var onAvailableHostsFilesReady = function(availableHostFiles) {
        µm.userSettings.selectedHostsFiles =
            Array.from(availableHostFiles.keys());
        vAPI.storage.set({
            selectedHostsFiles: µm.userSettings.selectedHostsFiles
        });
        initializeSelectedRulesetFiles();
    };

    var migrateSelectedHostsFiles = function(bin) {
        if (
            bin instanceof Object === false ||
            bin.liveHostsFiles instanceof Object === false
        ) {
            µm.getAvailableHostsFiles(onAvailableHostsFilesReady);
            return;
        }
        let selectedHostsFiles = new Set();
        for ( let entry of µm.toMap(bin.liveHostsFiles) ) {
            if ( entry[1].off !== true ) {
                selectedHostsFiles.add(entry[0]);
            }
        }
        µm.userSettings.selectedHostsFiles = Array.from(selectedHostsFiles);
        vAPI.storage.set({
            selectedHostsFiles: µm.userSettings.selectedHostsFiles
        });
        initializeSelectedRulesetFiles();
    };

    var initializeSelectedHostsFiles = function() {
        // Backward-compatibility: populate the new list selection array with
        // existing data.
        if (
            µm.userSettings.selectedHostsFiles.length === 1 &&
            µm.userSettings.selectedHostsFiles[0] === ''
        ) {
            vAPI.storage.get('liveHostsFiles', migrateSelectedHostsFiles);
            return;
        }
        initializeSelectedRulesetFiles();
    };

    var settingsLoaded = function(store) {
        µm.userSettings = store;
        if ( typeof µm.userSettings.externalHostsFiles === 'string' ) {
            µm.userSettings.externalHostsFiles =
                µm.userSettings.externalHostsFiles.length !== 0 ?
                    µm.userSettings.externalHostsFiles.split('\n') :
                    [];
        }
        initializeSelectedHostsFiles();
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

µMatrix.saveMatrix = function() {
    vAPI.storage.set({ userMatrix: this.pMatrix.toArray() });
};

µMatrix.loadMatrix = function(callback) {
    if ( typeof callback !== 'function' ) {
        callback = this.noopFunc;
    }
    let µm = this;
    let onLoaded = function(bin) {
        if ( bin instanceof Object === false ) {
            return callback();
        }
        if ( typeof bin.userMatrix === 'string' ) {
            µm.pMatrix.fromString(bin.userMatrix);
        } else if ( Array.isArray(bin.userMatrix) ) {
            µm.pMatrix.fromArray(bin.userMatrix);
        }
        µm.tMatrix.assign(µm.pMatrix);
        callback();
    };
    vAPI.storage.get('userMatrix', onLoaded);
};

/******************************************************************************/

µMatrix.loadRecipes = function(reset, callback) {
    if ( typeof callback !== 'function' ) {
        callback = this.noopFunc;
    }

    let µm = this,
        countdownCount = µm.userSettings.selectedRecipeFiles.length;

    if ( reset ) {
        µm.recipeManager.reset();
    }

    var onLoaded = function(details) {
        if ( details.content ) {
            µm.recipeManager.fromString(details.content);
        }
        countdownCount -= 1;
        if ( countdownCount === 0 ) {
            callback();
        }
    };

    for ( let assetKey of µm.userSettings.selectedRecipeFiles ) {
        this.assets.get(assetKey, onLoaded);
    }

    let userRecipes = µm.userSettings.userRecipes;
    if ( userRecipes.enabled ) {
        µm.recipeManager.fromString(
            '! uMatrix: Ruleset recipes 1.0\n' + userRecipes.content
        );
    }

};

/******************************************************************************/

µMatrix.assetKeysFromImportedAssets = function(raw) {
    var out = new Set(),
        reIgnore = /^[!#]/,
        reValid = /^[a-z-]+:\/\/\S+\/./,
        lineIter = new this.LineIterator(raw);
    while ( lineIter.eot() === false ) {
        let location = lineIter.next().trim();
        if ( reIgnore.test(location) || !reValid.test(location) ) { continue; }
        out.add(location);
    }
    return out;
};

/******************************************************************************/

µMatrix.getAvailableHostsFiles = function(callback) {
    var µm = this,
        availableHostsFiles = new Map();

    // Custom filter lists.
    var importedListKeys = new Set(µm.userSettings.externalHostsFiles);

    for ( let assetKey of importedListKeys ) {
        let entry = {
            type: 'filters',
            contentURL: assetKey,
            external: true,
            submitter: 'user',
            title: assetKey
        };
        this.assets.registerAssetSource(assetKey, entry);
        availableHostsFiles.set(assetKey, entry);
    }

    // Populate available lists with useful data.
    var onHostsFilesDataReady = function(bin) {
        if ( bin && bin.liveHostsFiles ) {
            for ( let entry of µm.toMap(bin.liveHostsFiles) ) {
                let assetKey = entry[0];
                let availableAsset = availableHostsFiles.get(assetKey);
                if ( availableAsset === undefined ) { continue; }
                let liveAsset = entry[1];
                if ( liveAsset.entryCount !== undefined ) {
                    availableAsset.entryCount = liveAsset.entryCount;
                }
                if ( liveAsset.entryUsedCount !== undefined ) {
                    availableAsset.entryUsedCount = liveAsset.entryUsedCount;
                }
                // This may happen if the list name was pulled from the list content
                if ( availableAsset.title === '' && liveAsset.title !== undefined ) {
                    availableAsset.title = liveAsset.title;
                }
            }
        }

        for ( let asseyKey of µm.userSettings.selectedHostsFiles ) {
            let asset = availableHostsFiles.get(asseyKey);
            if ( asset !== undefined ) {
                asset.selected = true;
            }
        }

        callback(availableHostsFiles);
    };

    // built-in lists
    var onBuiltinHostsFilesLoaded = function(entries) {
        for ( let assetKey in entries ) {
            if ( entries.hasOwnProperty(assetKey) === false ) { continue; }
            let entry = entries[assetKey];
            if ( entry.type !== 'filters' ) { continue; }
            if (
                entry.submitter === 'user' &&
                importedListKeys.has(assetKey) === false
            ) {
                µm.assets.unregisterAssetSource(assetKey);
                µm.assets.remove(assetKey);
                continue;
            }
            availableHostsFiles.set(assetKey, objectAssign({}, entry));
        }

        vAPI.storage.get('liveHostsFiles', onHostsFilesDataReady);
    };

    this.assets.metadata(onBuiltinHostsFilesLoaded);
};

/******************************************************************************/

µMatrix.getAvailableRecipeFiles = function(callback) {
    var µm = this,
        availableRecipeFiles = new Map();

    // Imported recipe resources.
    var importedResourceKeys = new Set(µm.userSettings.externalRecipeFiles);

    for ( let assetKey of importedResourceKeys ) {
        let entry = {
            type: 'recipes',
            contentURL: assetKey,
            external: true,
            submitter: 'user',
            title: assetKey
        };
        this.assets.registerAssetSource(assetKey, entry);
        availableRecipeFiles.set(assetKey, entry);
    }

    var onBuiltinRecipeFilesLoaded = function(entries) {
        for ( let assetKey in entries ) {
            if ( entries.hasOwnProperty(assetKey) === false ) { continue; }
            let entry = entries[assetKey];
            if ( entry.type !== 'recipes' ) { continue; }
            if (
                entry.submitter === 'user' &&
                importedResourceKeys.has(assetKey) === false
            ) {
                µm.assets.unregisterAssetSource(assetKey);
                µm.assets.remove(assetKey);
                continue;
            }
            availableRecipeFiles.set(assetKey, objectAssign({}, entry));
        }

        for ( let asseyKey of µm.userSettings.selectedRecipeFiles ) {
            let asset = availableRecipeFiles.get(asseyKey);
            if ( asset !== undefined ) {
                asset.selected = true;
            }
        }

        callback(availableRecipeFiles);
    };

    this.assets.metadata(onBuiltinRecipeFilesLoaded);
};

/******************************************************************************/

µMatrix.loadHostsFiles = function(callback) {
    var µm = µMatrix;
    var hostsFileLoadCount;

    if ( typeof callback !== 'function' ) {
        callback = this.noopFunc;
    }

    var loadHostsFilesEnd = function(fromSelfie) {
        if ( fromSelfie !== true ) {
            µm.ubiquitousBlacklist.freeze();
            vAPI.storage.set({ liveHostsFiles: Array.from(µm.liveHostsFiles) });
            µm.hostsFilesSelfie.create();
        }
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
        hostsFileLoadCount = µm.userSettings.selectedHostsFiles.length;

        // Load all hosts file which are not disabled.
        for ( let assetKey of µm.userSettings.selectedHostsFiles ) {
            µm.assets.get(assetKey, mergeHostsFile);
        }

        // https://github.com/gorhill/uMatrix/issues/2
        if ( hostsFileLoadCount === 0 ) {
            loadHostsFilesEnd();
            return;
        }
    };

    var onSelfieReady = function(status) {
        if ( status === true ) {
            return loadHostsFilesEnd(true);
        }
        µm.getAvailableHostsFiles(loadHostsFilesStart);
    };

    this.hostsFilesSelfie.load(onSelfieReady);
};

/******************************************************************************/

µMatrix.mergeHostsFile = function(details) {
    var usedCount = this.ubiquitousBlacklist.count;
    var duplicateCount = this.ubiquitousBlacklist.duplicateCount;

    this.mergeHostsFileContent(details.content);

    usedCount = this.ubiquitousBlacklist.count - usedCount;
    duplicateCount = this.ubiquitousBlacklist.duplicateCount - duplicateCount;

    let hostsFileMeta = this.liveHostsFiles.get(details.assetKey);
    hostsFileMeta.entryCount = usedCount + duplicateCount;
    hostsFileMeta.entryUsedCount = usedCount;
};

/******************************************************************************/

µMatrix.mergeHostsFileContent = function(rawText) {
    var rawEnd = rawText.length;
    var ubiquitousBlacklist = this.ubiquitousBlacklist;
    var reLocalhost = new RegExp(
        [
        '(?:^|\\s+)(?:',
            [
            'broadcasthost',
            'ip6-allnodes',
            'ip6-allrouters',
            'ip6-localhost',
            'ip6-loopback',
            'localhost\\.localdomain',
            'localhost',
            'local',
            '0\\.0\\.0\\.0',
            '127\\.0\\.0\\.1',
            '255\\.255\\.255\\.255',
            '::1',
            'ff02::1',
            'ff02::2',
            'fe80::1%lo0',
            ].join('|'),
        ')(?=\\s+|$)'
        ].join(''),
        'g'
    );
    var reAsciiSegment = /^[\x21-\x7e]+$/;
    var lineBeg = 0, lineEnd;

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
        let line = rawText.slice(lineBeg, lineEnd).trim();
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
        let matches = reAsciiSegment.exec(line);
        if ( matches === null ) { continue; }

        // Bypass anomalies
        // For example, when a filter contains whitespace characters, or
        // whatever else outside the range of printable ascii characters.
        if ( matches[0] !== line ) { continue; }
        line = matches[0];
        if ( line === '' ) { continue; }

        ubiquitousBlacklist.add(line);
    }
};

/******************************************************************************/

µMatrix.selectAssets = function(details, callback) {
    var µm = this;

    var applyAssetSelection = function(
        metadata,
        details,
        propSelectedAssetKeys,
        propImportedAssetKeys,
        propInlineAsset
    ) {
        let µmus = µm.userSettings;
        let selectedAssetKeys = new Set();
        let importedAssetKeys = new Set(µmus[propImportedAssetKeys]);

        if ( Array.isArray(details.toSelect) ) {
            for ( let assetKey of details.toSelect ) {
                if ( metadata.has(assetKey) ) {
                    selectedAssetKeys.add(assetKey);
                }
            }
        }

        if ( Array.isArray(details.toRemove) ) {
            for ( let assetKey of details.toRemove ) {
                importedAssetKeys.delete(assetKey);
                µm.assets.remove(assetKey);
            }
        }

        // Hosts file to import
        // https://github.com/gorhill/uBlock/issues/1181
        //   Try mapping the URL of an imported filter list to the assetKey of
        //   an existing stock list.
        if ( typeof details.toImport === 'string' ) {
            var assetKeyFromURL = function(url) {
                var needle = url.replace(/^https?:/, '');
                for ( let entry of metadata ) {
                    let asset = entry[1];
                    if ( asset.type === 'internal' ) { continue; }
                    let assetKey = entry[0];
                    if ( typeof asset.contentURL === 'string' ) {
                        if ( asset.contentURL.endsWith(needle) ) { return assetKey; }
                        continue;
                    }
                    if ( Array.isArray(asset.contentURL) === false ) { continue; }
                    for ( let i = 0, n = asset.contentURL.length; i < n; i++ ) {
                        if ( asset.contentURL[i].endsWith(needle) ) {
                            return assetKey;
                        }
                    }
                }
                return url;
            };
            var toImport = µm.assetKeysFromImportedAssets(details.toImport);
            for ( let url of toImport ) {
                if ( importedAssetKeys.has(url) ) { continue; }
                let assetKey = assetKeyFromURL(url);
                if ( assetKey === url ) {
                    importedAssetKeys.add(assetKey);
                }
                selectedAssetKeys.add(assetKey);
            }
        }

        let bin = {},
            needReload = false;

        if ( details.toInline instanceof Object ) {
            let newInline = details.toInline;
            let oldInline = µmus[propInlineAsset];
            newInline.content = newInline.content.trim();
            if ( newInline.content.length !== 0 ) {
                newInline.content += '\n';
            }
            let newContent = newInline.enabled ? newInline.content : '';
            let oldContent = oldInline.enabled ? oldInline.content : '';
            if ( newContent !== oldContent ) {
                needReload = true;
            }
            if (
                newInline.enabled !== oldInline.enabled ||
                newInline.content !== oldInline.content
            ) {
                µmus[propInlineAsset] = newInline;
                bin[propInlineAsset] = newInline;
            }
        }
    
        selectedAssetKeys = Array.from(selectedAssetKeys).sort();
        µmus[propSelectedAssetKeys].sort();
        if ( selectedAssetKeys.join() !== µmus[propSelectedAssetKeys].join() ) {
            µmus[propSelectedAssetKeys] = selectedAssetKeys;
            bin[propSelectedAssetKeys] = selectedAssetKeys;
            needReload = true;
        }

        importedAssetKeys = Array.from(importedAssetKeys).sort();
        µmus[propImportedAssetKeys].sort();
        if ( importedAssetKeys.join() !== µmus[propImportedAssetKeys].join() ) {
            µmus[propImportedAssetKeys] = importedAssetKeys;
            bin[propImportedAssetKeys] = importedAssetKeys;
            needReload = true;
        }

        if ( Object.keys(bin).length !== 0 ) {
            vAPI.storage.set(bin);
        }

        return needReload;
    };

    var onMetadataReady = function(response) {
        let metadata = µm.toMap(response);
        let hostsChanged = applyAssetSelection(
            metadata,
            details.hosts,
            'selectedHostsFiles',
            'externalHostsFiles',
            'userHosts'
        );
        if ( hostsChanged ) {
            µm.hostsFilesSelfie.destroy();
        }
        let recipesChanged = applyAssetSelection(
            metadata,
            details.recipes,
            'selectedRecipeFiles',
            'externalRecipeFiles',
            'userRecipes'
        );
        if ( recipesChanged ) {
            µm.recipeManager.reset();
        }
        if ( typeof callback === 'function' ) {
            callback({
                hostsChanged: hostsChanged,
                recipesChanged: recipesChanged
            });
        }
    };

    this.assets.metadata(onMetadataReady);
};

/******************************************************************************/

// `switches` contains the preset blacklists for which the switch must be
// revisited.

µMatrix.reloadHostsFiles = function() {
    this.loadHostsFiles();
};

/******************************************************************************/

µMatrix.hostsFilesSelfie = (function() {
    let timer;

    return {
        create: function() {
            this.cancel();
            timer = vAPI.setTimeout(
                function() {
                    timer = undefined;
                    vAPI.cacheStorage.set({
                        hostsFilesSelfie: µMatrix.ubiquitousBlacklist.toSelfie()
                    });
                },
                120000
            );
        },
        destroy: function() {
            this.cancel();
            vAPI.cacheStorage.remove('hostsFilesSelfie');
        },
        load: function(callback) {
            this.cancel();
            vAPI.cacheStorage.get('hostsFilesSelfie', function(bin) {
                callback(
                    bin instanceof Object &&
                    bin.hostsFilesSelfie instanceof Object &&
                    µMatrix.ubiquitousBlacklist.fromSelfie(bin.hostsFilesSelfie)
                );
            });
        },
        cancel: function() {
            if ( timer !== undefined ) {
                clearTimeout(timer);
            }
            timer = undefined;
        }
    };
})();

/******************************************************************************/

µMatrix.publicSuffixList = (function() {
    let µm = µMatrix;

    var onPSLReady = function(details, callback) {
        if (
            !details.error &&
            typeof details.content === 'string' &&
            details.content.length !== 0
        ) {
            publicSuffixList.parse(details.content, punycode.toASCII);
            vAPI.cacheStorage.set({
                publicSuffixListSelfie: publicSuffixList.toSelfie()
            });
        }
        callback();
    };

    let onSelfieReady = function(bin, callback) {
        if (
            bin instanceof Object &&
            bin.publicSuffixListSelfie instanceof Object &&
            publicSuffixList.fromSelfie(bin.publicSuffixListSelfie)
        ) {
            return callback();
        }
        µm.assets.get(µm.pslAssetKey, function(details) {
            onPSLReady(details, callback);
        });
    };

    return {
        update: function(details) {
            onPSLReady(details, µm.noopFunc);
        },
        load: function(callback) {
            if ( typeof callback !== 'function' ) {
                callback = µm.noopFunc;
            }
            vAPI.cacheStorage.get('publicSuffixListSelfie', function(bin) {
                onSelfieReady(bin, callback);
            });
        }
    };
})();

/******************************************************************************/

µMatrix.scheduleAssetUpdater = (function() {
    var timer, next = 0;
    return function(updateDelay) {
        if ( timer ) {
            clearTimeout(timer);
            timer = undefined;
        }
        if ( updateDelay === 0 ) {
            this.assets.updateStop();
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
    let µmus = this.userSettings;

    // Do not update filter list if not in use.
    if ( topic === 'before-asset-updated' ) {
        if (
            details.type === 'internal' ||
            details.type === 'filters' &&
                µmus.selectedHostsFiles.indexOf(details.assetKey) !== -1 ||
            details.type === 'recipes' &&
                µmus.selectedRecipeFiles.indexOf(details.assetKey) !== -1
        ) {
            return true;
        }
        return;
    }

    if ( topic === 'after-asset-updated' ) {
        if (
            details.type === 'filters' &&
            µmus.selectedHostsFiles.indexOf(details.assetKey) !== -1
        ) {
            this.hostsFilesSelfie.destroy();
        } else if ( details.assetKey === this.pslAssetKey ) {
            this.publicSuffixList.update(details);
        }
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
        if (
            this.arraysIntersect(
                details.assetKeys,
                µmus.selectedRecipeFiles
            )
        ) {
            this.loadRecipes(true);
        }
        if (
            this.arraysIntersect(
                details.assetKeys,
                µmus.selectedHostsFiles
            )
        ) {
            this.hostsFilesSelfie.destroy();
            this.loadHostsFiles();
        }
        if ( µmus.autoUpdate ) {
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
};
