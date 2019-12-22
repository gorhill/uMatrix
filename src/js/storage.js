/*******************************************************************************

    uMatrix - a Chromium browser extension to black/white list requests.
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

/* global punycode, publicSuffixList */

'use strict';

/******************************************************************************/

µMatrix.getBytesInUse = async function() {
    const promises = [];
    let bytesInUse;

    // Not all platforms implement this method.
    promises.push(
        vAPI.storage.getBytesInUse instanceof Function
            ? vAPI.storage.getBytesInUse(null)
            : undefined
    );

    if (
        navigator.storage instanceof Object &&
        navigator.storage.estimate instanceof Function
    ) {
        promises.push(navigator.storage.estimate());
    }

    const results = await Promise.all(promises);

    const processCount = count => {
        if ( typeof count !== 'number' ) { return; }
        if ( bytesInUse === undefined ) { bytesInUse = 0; }
        bytesInUse += count;
        return bytesInUse;
    };

    processCount(results[0]);
    if ( results.length > 1 && results[1] instanceof Object ) {
        processCount(results[1].usage);
    }
    return bytesInUse;
};

/******************************************************************************/

µMatrix.saveUserSettings = function() {
    return vAPI.storage.set(this.userSettings);
};

µMatrix.loadUserSettings = async function() {
    this.userSettings = await vAPI.storage.get(this.userSettings);

    if ( typeof this.userSettings.externalHostsFiles === 'string' ) {
        this.userSettings.externalHostsFiles =
            this.userSettings.externalHostsFiles.length !== 0 ?
                this.userSettings.externalHostsFiles.split('\n') :
                [];
    }
    // Backward-compatibility: populate the new list selection array with
    // existing data.
    if (
        this.userSettings.selectedHostsFiles.length === 1 &&
        this.userSettings.selectedHostsFiles[0] === ''
    ) {
        const bin = await vAPI.storage.get('liveHostsFiles');

        if (
            bin instanceof Object === false ||
            bin.liveHostsFiles instanceof Object === false
        ) {
            const availableHostFiles = await this.getAvailableHostsFiles();
            this.userSettings.selectedHostsFiles =
                Array.from(availableHostFiles.keys());
        } else {
            const selectedHostsFiles = new Set();
            for ( const entry of this.toMap(bin.liveHostsFiles) ) {
                if ( entry[1].off !== true ) {
                    selectedHostsFiles.add(entry[0]);
                }
            }
            this.userSettings.selectedHostsFiles = Array.from(selectedHostsFiles);
        }
        vAPI.storage.set({
            selectedHostsFiles: this.userSettings.selectedHostsFiles
        });
    }

    if (
        this.userSettings.selectedRecipeFiles.length !== 1 ||
        this.userSettings.selectedRecipeFiles[0] !== ''
    ) {
        return this.userSettings;
    }

    const availableRulesetFiles = await this.getAvailableRecipeFiles();
    const selectedRulesetKeys = new Set();
    for ( const entry of availableRulesetFiles ) {
        const assetKey = entry[0];
        const assetLang = entry[1].lang;
        if ( assetLang === undefined ) {
            selectedRulesetKeys.add(assetKey);
            continue;
        }
        for ( const lang of navigator.languages ) {
            if ( assetLang.indexOf(lang) !== -1 ) {
                selectedRulesetKeys.add(assetKey);
                break;
            }
        }
    }

    this.userSettings.selectedRecipeFiles = Array.from(selectedRulesetKeys);
    vAPI.storage.set({
        selectedRecipeFiles: this.userSettings.selectedRecipeFiles
    });

    return this.userSettings;
};

/******************************************************************************/

µMatrix.loadRawSettings = async function() {
    const bin = await vAPI.storage.get('rawSettings');
    if ( bin instanceof Object === false ) { return; }

    const hs = bin.rawSettings;
    if ( hs instanceof Object ) {
        const hsDefault = this.rawSettingsDefault;
        for ( const key in hsDefault ) {
            if (
                hsDefault.hasOwnProperty(key) &&
                hs.hasOwnProperty(key) &&
                typeof hs[key] === typeof hsDefault[key]
            ) {
                this.rawSettings[key] = hs[key];
            }
        }
        if ( typeof this.rawSettings.suspendTabsUntilReady === 'boolean' ) {
            this.rawSettings.suspendTabsUntilReady =
                this.rawSettings.suspendTabsUntilReady ? 'yes' : 'unset';
        }
    }
    this.fireDOMEvent('rawSettingsChanged');
};

// Note: Save only the settings which values differ from the default ones.
// This way the new default values in the future will properly apply for those
// which were not modified by the user.

µMatrix.saveRawSettings = function() {
    const bin = { rawSettings: {} };
    for ( const prop in this.rawSettings ) {
        if (
            this.rawSettings.hasOwnProperty(prop) &&
            this.rawSettings[prop] !== this.rawSettingsDefault[prop]
        ) {
            bin.rawSettings[prop] = this.rawSettings[prop];
        }
    }
    this.saveImmediateHiddenSettings();
    return vAPI.storage.set(bin);
};

self.addEventListener('rawSettingsChanged', ( ) => {
    const µm = µMatrix;
    self.log.verbosity = µm.rawSettings.consoleLogLevel;
    vAPI.net.setOptions({
        cnameAliasList: µm.rawSettings.cnameAliasList,
        cnameIgnoreList: µm.rawSettings.cnameIgnoreList,
        cnameIgnore1stParty: µm.rawSettings.cnameIgnore1stParty,
        cnameIgnoreRootDocument: µm.rawSettings.cnameIgnoreRootDocument,
        cnameMaxTTL: µm.rawSettings.cnameMaxTTL,
        cnameReplayFullURL: µm.rawSettings.cnameReplayFullURL,
    });
});

self.addEventListener('rawSettingsChanged', ( ) => {
    const µm = µMatrix;
    self.log.verbosity = µm.rawSettings.consoleLogLevel;
    vAPI.net.setOptions({
        cnameIgnoreList: µm.rawSettings.cnameIgnoreList,
        cnameIgnore1stParty: µm.rawSettings.cnameIgnore1stParty,
        cnameIgnoreExceptions: µm.rawSettings.cnameIgnoreExceptions,
        cnameIgnoreRootDocument: µm.rawSettings.cnameIgnoreRootDocument,
        cnameMaxTTL: µm.rawSettings.cnameMaxTTL,
        cnameReplayFullURL: µm.rawSettings.cnameReplayFullURL,
    });
});

/******************************************************************************/

µMatrix.rawSettingsFromString = function(raw) {
    const out = Object.assign({}, this.rawSettingsDefault);
    const lineIter = new this.LineIterator(raw);
    while ( lineIter.eot() === false ) {
        const line = lineIter.next();
        const matches = /^\s*(\S+)\s+(.+)$/.exec(line);
        if ( matches === null || matches.length !== 3 ) { continue; }
        const name = matches[1];
        if ( out.hasOwnProperty(name) === false ) { continue; }
        const value = matches[2].trim();
        switch ( typeof out[name] ) {
        case 'boolean':
            if ( value === 'true' ) {
                out[name] = true;
            } else if ( value === 'false' ) {
                out[name] = false;
            }
            break;
        case 'string':
            out[name] = value;
            break;
        case 'number': {
            const i = parseInt(value, 10);
            if ( isNaN(i) === false ) {
                out[name] = i;
            }
            break;
        }
        default:
            break;
        }
    }
    this.rawSettings = out;
    this.saveRawSettings();
    this.fireDOMEvent('rawSettingsChanged');
};

µMatrix.stringFromRawSettings = function() {
    const out = [];
    for ( const key of Object.keys(this.rawSettings).sort() ) {
        out.push(key + ' ' + this.rawSettings[key]);
    }
    return out.join('\n');
};

/******************************************************************************/

// These settings must be available immediately on startup, without delay
// through the vAPI.localStorage. Add/remove settings as needed.

µMatrix.saveImmediateHiddenSettings = function() {
    const props = [
        'consoleLogLevel',
        'suspendTabsUntilReady',
    ];
    const toSave = {};
    for ( const prop of props ) {
        if ( this.rawSettings[prop] !== this.rawSettingsDefault[prop] ) {
            toSave[prop] = this.rawSettings[prop];
        }
    }
    if ( Object.keys(toSave).length !== 0 ) {
        vAPI.localStorage.setItem(
            'immediateHiddenSettings',
            JSON.stringify(toSave)
        );
    } else {
        vAPI.localStorage.removeItem('immediateHiddenSettings');
    }
};

/******************************************************************************/

µMatrix.saveMatrix = function() {
    return vAPI.storage.set({ userMatrix: this.pMatrix.toArray() });
};

µMatrix.loadMatrix = async function() {
    const bin = await vAPI.storage.get('userMatrix');
    if ( bin instanceof Object === false ) { return; }
    if ( typeof bin.userMatrix === 'string' ) {
        this.pMatrix.fromString(bin.userMatrix);
    } else if ( Array.isArray(bin.userMatrix) ) {
        this.pMatrix.fromArray(bin.userMatrix);
    }
    this.tMatrix.assign(this.pMatrix);
};

/******************************************************************************/

µMatrix.loadRecipes = async function(reset) {
    if ( reset ) {
        this.recipeManager.reset();
    }

    const toLoad = [];

    const recipeMetadata = await this.getAvailableRecipeFiles();
    for ( const entry of recipeMetadata ) {
        const assetKey = entry[0];
        const recipeFile = entry[1];
        if ( recipeFile.selected !== true ) { continue; }
        toLoad.push(this.assets.get(assetKey));
    }

    if ( this.userSettings.userRecipes.enabled ) {
        this.recipeManager.fromString(
            '! uMatrix: Ruleset recipes 1.0\n' +
            this.userSettings.userRecipes.content
        );
    }

    const results = await Promise.all(toLoad);
    for ( const result of results ) {
        const content = result.content || '';
        if ( content === '' ) { continue; }
        const entry = recipeMetadata.get(result.assetKey);
        if ( entry.submitter === 'user' ) {
            const match = /^! +Title: *(.+)$/im.exec(content.slice(2048));
            if ( match !== null && match[1] !== entry.title ) {
                this.assets.registerAssetSource(
                    result.assetKey,
                    { title: match[1] }
                );
            }
        }
        this.recipeManager.fromString(content);
    }

    vAPI.messaging.broadcast({ what: 'loadRecipeFilesCompleted' });
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

µMatrix.getAvailableHostsFiles = async function() {
    const availableHostsFiles = new Map();

    // Custom lists.
    const importedListKeys = new Set(this.userSettings.externalHostsFiles);

    for ( const assetKey of importedListKeys ) {
        const entry = {
            content: 'filters',
            contentURL: assetKey,
            external: true,
            submitter: 'user',
            title: assetKey
        };
        this.assets.registerAssetSource(assetKey, entry);
        availableHostsFiles.set(assetKey, entry);
    }

    // Built-in lists
    const entries = await this.assets.metadata();
    for ( const assetKey in entries ) {
        if ( entries.hasOwnProperty(assetKey) === false ) { continue; }
        let entry = entries[assetKey];
        if ( entry.content !== 'filters' ) { continue; }
        if (
            entry.submitter === 'user' &&
            importedListKeys.has(assetKey) === false
        ) {
            this.assets.unregisterAssetSource(assetKey);
            this.assets.remove(assetKey);
            continue;
        }
        availableHostsFiles.set(assetKey, Object.assign({}, entry));
    }

    // Populate available lists with useful data.
    const bin = await vAPI.storage.get('liveHostsFiles');
    if ( bin && bin.liveHostsFiles ) {
        for ( const [ assetKey, liveAsset ] of this.toMap(bin.liveHostsFiles) ) {
            const availableAsset = availableHostsFiles.get(assetKey);
            if ( availableAsset === undefined ) { continue; }
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

    for ( const asseyKey of this.userSettings.selectedHostsFiles ) {
        const asset = availableHostsFiles.get(asseyKey);
        if ( asset !== undefined ) {
            asset.selected = true;
        }
    }

    return availableHostsFiles;
};

/******************************************************************************/

µMatrix.getAvailableRecipeFiles = async function() {
    const availableRecipeFiles = new Map();

    // Imported recipe resources.
    const importedResourceKeys = new Set(this.userSettings.externalRecipeFiles);
    for ( const assetKey of importedResourceKeys ) {
        const entry = {
            content: 'recipes',
            contentURL: assetKey,
            external: true,
            submitter: 'user'
        };
        this.assets.registerAssetSource(assetKey, entry);
        availableRecipeFiles.set(assetKey, entry);
    }

    const entries = await this.assets.metadata();

    for ( const assetKey in entries ) {
        if ( entries.hasOwnProperty(assetKey) === false ) { continue; }
        let entry = entries[assetKey];
        if ( entry.content !== 'recipes' ) { continue; }
        if (
            entry.submitter === 'user' &&
            importedResourceKeys.has(assetKey) === false
        ) {
            this.assets.unregisterAssetSource(assetKey);
            this.assets.remove(assetKey);
            continue;
        }
        availableRecipeFiles.set(assetKey, Object.assign({}, entry));
    }

    for ( const asseyKey of this.userSettings.selectedRecipeFiles ) {
        const asset = availableRecipeFiles.get(asseyKey);
        if ( asset !== undefined ) {
            asset.selected = true;
        }
    }

    return availableRecipeFiles;
};

/******************************************************************************/

µMatrix.loadHostsFiles = async function() {
    const status = await this.hostsFilesSelfie.load();
    if ( status !== true ) {
        this.liveHostsFiles = await this.getAvailableHostsFiles();
        this.ubiquitousBlacklist.reset();
        this.ubiquitousBlacklistRef = this.ubiquitousBlacklist.createOne();
        // Load all hosts file which are not disabled.
        const assetPromises = [];
        for ( const assetKey of this.userSettings.selectedHostsFiles ) {
            assetPromises.push(
                this.assets.get(assetKey).then(details => {
                    this.mergeHostsFile(details);
                })
            );
        }
        await Promise.all(assetPromises);
        vAPI.storage.set({ liveHostsFiles: Array.from(this.liveHostsFiles) });
        this.hostsFilesSelfie.create();
    }

    vAPI.messaging.broadcast({ what: 'loadHostsFilesCompleted' });
};

/******************************************************************************/

µMatrix.mergeHostsFile = function(details) {
    const addedCount = this.ubiquitousBlacklistRef.addedCount;
    const addCount = this.ubiquitousBlacklistRef.addCount;

    this.mergeHostsFileContent(details.content);

    const hostsFileMeta = this.liveHostsFiles.get(details.assetKey);
    hostsFileMeta.entryCount =
        this.ubiquitousBlacklistRef.addCount - addCount;
    hostsFileMeta.entryUsedCount =
        this.ubiquitousBlacklistRef.addedCount - addedCount;
};

/******************************************************************************/

µMatrix.mergeHostsFileContent = function(rawText) {
    const rawEnd = rawText.length;
    const ubiquitousBlacklistRef = this.ubiquitousBlacklistRef;
    const reLocalhost = new RegExp(
        [
        '(?:^|\\s+)(?:',
            [
            'localhost\\.localdomain',
            'ip6-allrouters',
            'broadcasthost',
            'ip6-localhost',
            'ip6-allnodes',
            'ip6-loopback',
            'localhost',
            'local',
            '255\\.255\\.255\\.255',
            '127\\.0\\.0\\.1',
            '0\\.0\\.0\\.0',
            'fe80::1%lo0',
            'ff02::1',
            'ff02::2',
            '::1',
            '::',
            ].join('|'),
        ')(?=\\s+|$)'
        ].join(''),
        'g'
    );
    const reAsciiSegment = /^[\x21-\x7e]+$/;
    let lineBeg = 0;

    while ( lineBeg < rawEnd ) {
        let lineEnd = rawText.indexOf('\n', lineBeg);
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
        //   Ensure localhost et al. don't end up in the ubiquitous blacklist.
        line = line
            .replace(/#.*$/, '')
            .toLowerCase()
            .replace(reLocalhost, '')
            .trim();

        // The filter is whatever sequence of printable ascii character without
        // whitespaces
        const matches = reAsciiSegment.exec(line);
        if ( matches === null ) { continue; }

        // Bypass anomalies
        // For example, when a filter contains whitespace characters, or
        // whatever else outside the range of printable ascii characters.
        if ( matches[0] !== line ) { continue; }
        line = matches[0];
        if ( line === '' ) { continue; }

        ubiquitousBlacklistRef.add(line);
    }
};

/******************************************************************************/

µMatrix.selectAssets = async function(details) {
    const applyAssetSelection = function(
        metadata,
        details,
        propSelectedAssetKeys,
        propImportedAssetKeys,
        propInlineAsset
    ) {
        const µm = µMatrix;
        const µmus = µm.userSettings;
        let selectedAssetKeys = new Set();
        let importedAssetKeys = new Set(µmus[propImportedAssetKeys]);

        if ( Array.isArray(details.toSelect) ) {
            for ( const assetKey of details.toSelect ) {
                if ( metadata.has(assetKey) ) {
                    selectedAssetKeys.add(assetKey);
                }
            }
        }

        if ( Array.isArray(details.toRemove) ) {
            for ( const assetKey of details.toRemove ) {
                importedAssetKeys.delete(assetKey);
                µm.assets.remove(assetKey);
            }
        }

        // Hosts file to import
        // https://github.com/gorhill/uBlock/issues/1181
        //   Try mapping the URL of an imported filter list to the assetKey of
        //   an existing stock list.
        if ( typeof details.toImport === 'string' ) {
            const assetKeyFromURL = function(url) {
                const needle = url.replace(/^https?:/, '');
                for ( const [ assetKey, asset ] of metadata ) {
                    if ( asset.content === 'internal' ) { continue; }
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
            const toImport = µm.assetKeysFromImportedAssets(details.toImport);
            for ( const url of toImport ) {
                if ( importedAssetKeys.has(url) ) { continue; }
                const assetKey = assetKeyFromURL(url);
                if ( assetKey === url ) {
                    importedAssetKeys.add(assetKey);
                }
                selectedAssetKeys.add(assetKey);
            }
        }

        const bin = {};
        let needReload = false;

        if ( details.toInline instanceof Object ) {
            const newInline = details.toInline;
            const oldInline = µmus[propInlineAsset];
            newInline.content = newInline.content.trim();
            if ( newInline.content.length !== 0 ) {
                newInline.content += '\n';
            }
            const newContent = newInline.enabled ? newInline.content : '';
            const oldContent = oldInline.enabled ? oldInline.content : '';
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

    const metadata = this.toMap(await this.assets.metadata());

    const hostsChanged = applyAssetSelection(
        metadata,
        details.hosts,
        'selectedHostsFiles',
        'externalHostsFiles',
        'userHosts'
    );
    if ( hostsChanged ) {
        this.hostsFilesSelfie.destroy();
    }
    const recipesChanged = applyAssetSelection(
        metadata,
        details.recipes,
        'selectedRecipeFiles',
        'externalRecipeFiles',
        'userRecipes'
    );

    return { hostsChanged, recipesChanged };
};

/******************************************************************************/

// `switches` contains the preset blacklists for which the switch must be
// revisited.

µMatrix.reloadHostsFiles = function() {
    this.loadHostsFiles();
};

/******************************************************************************/

µMatrix.hostsFilesSelfie = (( ) => {
    const µm = µMatrix;
    const magic = 1;
    let timer;

    const toSelfie = function() {
        const trieDetails = µm.ubiquitousBlacklist.optimize();
        vAPI.localStorage.setItem(
            'ubiquitousBlacklist.trieDetails',
            JSON.stringify(trieDetails)
        );
        µm.cacheStorage.set({
            hostsFilesSelfie: {
                magic,
                trie: µm.ubiquitousBlacklist.serialize(µm.base64),
                trieref: µm.ubiquitousBlacklist.compileOne(µm.ubiquitousBlacklistRef),
            }
        });
    };

    return {
        create: function() {
            this.cancel();
            timer = vAPI.setTimeout(
                ( ) => {
                    timer = undefined;
                    toSelfie();
                },
                (µm.rawSettings.autoUpdateAssetFetchPeriod + 15) * 1000
            );
        },
        destroy: function() {
            this.cancel();
            µm.cacheStorage.remove('hostsFilesSelfie');
        },
        load: async function() {
            this.cancel();
            const bin = await µm.cacheStorage.get('hostsFilesSelfie');
            if (
                bin instanceof Object === false ||
                bin.hostsFilesSelfie instanceof Object === false ||
                bin.hostsFilesSelfie.trie === undefined ||
                bin.hostsFilesSelfie.trieref === undefined ||
                bin.hostsFilesSelfie.magic !== magic
            ) {
                return false;
            }
            µm.ubiquitousBlacklist.unserialize(
                bin.hostsFilesSelfie.trie, µm.base64
            );
            µm.ubiquitousBlacklistRef =
                µm.ubiquitousBlacklist.createOne(bin.hostsFilesSelfie.trieref);
            return true;
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

µMatrix.loadPublicSuffixList = async function() {
    // TODO: remove once all users are way past 1.4.0.
    this.cacheStorage.remove('publicSuffixListSelfie');

    try {
        const result = await this.assets.get(`compiled/${this.pslAssetKey}`);
        if ( publicSuffixList.fromSelfie(result.content, this.base64) ) {
            return;
        }
    } catch (ex) {
        console.error(ex);
        return;
    }

    const result = await this.assets.get(this.pslAssetKey);
    if ( result.content !== '' ) {
        this.compilePublicSuffixList(result.content);
    }
};

µMatrix.compilePublicSuffixList = function(content) {
    publicSuffixList.parse(content, punycode.toASCII);
    this.assets.put(
        'compiled/' + this.pslAssetKey,
        publicSuffixList.toSelfie(µMatrix.base64)
    );
};

/******************************************************************************/

µMatrix.scheduleAssetUpdater = (( ) => {
    let timer, next = 0;

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
        const now = Date.now();
        // Use the new schedule if and only if it is earlier than the previous
        // one.
        if ( next !== 0 ) {
            updateDelay = Math.min(updateDelay, Math.max(next - now, 0));
        }
        next = now + updateDelay;
        timer = vAPI.setTimeout(( ) => {
            timer = undefined;
            next = 0;
            this.assets.updateStart({ delay: 120000 });
        }, updateDelay);
    };
})();

/******************************************************************************/

µMatrix.assetObserver = function(topic, details) {
    const µmus = this.userSettings;

    // Do not update filter list if not in use.
    if ( topic === 'before-asset-updated' ) {
        if (
            details.content === 'internal' ||
            details.content === 'filters' &&
                µmus.selectedHostsFiles.indexOf(details.assetKey) !== -1 ||
            details.content === 'recipes' &&
                µmus.selectedRecipeFiles.indexOf(details.assetKey) !== -1
        ) {
            return true;
        }
        return;
    }

    if ( topic === 'after-asset-updated' ) {
        if (
            details.content === 'filters' &&
            µmus.selectedHostsFiles.indexOf(details.assetKey) !== -1
        ) {
            this.hostsFilesSelfie.destroy();
        } else if ( details.assetKey === this.pslAssetKey ) {
            this.compilePublicSuffixList(details.content);
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
