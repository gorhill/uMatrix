/*******************************************************************************

    µMatrix - a browser extension to black/white list requests.
    Copyright (C) 2013-2015 Raymond Hill

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

µMatrix.assets = (function() {

/******************************************************************************/

var reIsExternalPath = /^(?:[a-z-]+):\/\//,
    errorCantConnectTo = vAPI.i18n('errorCantConnectTo'),
    noopfunc = function(){};

var api = {
};

/******************************************************************************/

var observers = [];

api.addObserver = function(observer) {
    if ( observers.indexOf(observer) === -1 ) {
        observers.push(observer);
    }
};

api.removeObserver = function(observer) {
    var pos;
    while ( (pos = observers.indexOf(observer)) !== -1 ) {
        observers.splice(pos, 1);
    }
};

var fireNotification = function(topic, details) {
    var result;
    for ( var i = 0; i < observers.length; i++ ) {
        if ( observers[i](topic, details) === false ) {
            result = false;
        }
    }
    return result;
};

/******************************************************************************/

api.fetchText = function(url, onLoad, onError) {
    var actualUrl = reIsExternalPath.test(url) ? url : vAPI.getURL(url);

    if ( typeof onError !== 'function' ) {
        onError = onLoad;
    }

    // https://github.com/gorhill/uMatrix/issues/15
    var onResponseReceived = function() {
        this.onload = this.onerror = this.ontimeout = null;
        // xhr for local files gives status 0, but actually succeeds
        var details = {
            url: url,
            content: '',
            statusCode: this.status || 200,
            statusText: this.statusText || ''
        };
        if ( details.statusCode < 200 || details.statusCode >= 300 ) {
            return onError.call(null, details);
        }
        // consider an empty result to be an error
        if ( stringIsNotEmpty(this.responseText) === false ) {
            return onError.call(null, details);
        }
        // we never download anything else than plain text: discard if response
        // appears to be a HTML document: could happen when server serves
        // some kind of error page I suppose
        var text = this.responseText.trim();
        if ( text.startsWith('<') && text.endsWith('>') ) {
            return onError.call(null, details);
        }
        details.content = this.responseText;
        return onLoad.call(null, details);
    };

    var onErrorReceived = function() {
        this.onload = this.onerror = this.ontimeout = null;
        µMatrix.logger.writeOne('', 'error', errorCantConnectTo.replace('{{msg}}', actualUrl));
        onError.call(null, { url: url, content: '' });
    };

    // Be ready for thrown exceptions:
    // I am pretty sure it used to work, but now using a URL such as
    // `file:///` on Chromium 40 results in an exception being thrown.
    var xhr = new XMLHttpRequest();
    try {
        xhr.open('get', actualUrl, true);
        xhr.timeout = 30000;
        xhr.onload = onResponseReceived;
        xhr.onerror = onErrorReceived;
        xhr.ontimeout = onErrorReceived;
        xhr.responseType = 'text';
        xhr.send();
    } catch (e) {
        onErrorReceived.call(xhr);
    }
};

/*******************************************************************************

    TODO(seamless migration):
    This block of code will be removed when I am confident all users have
    moved to a version of uBO which does not require the old way of caching
    assets.

    api.listKeyAliases: a map of old asset keys to new asset keys.

    migrate(): to seamlessly migrate the old cache manager to the new one:
    - attempt to preserve and move content of cached assets to new locations;
    - removes all traces of now obsolete cache manager entries in cacheStorage.

    This code will typically execute only once, when the newer version of uBO
    is first installed and executed.

**/

api.listKeyAliases = {
    "assets/thirdparties/publicsuffix.org/list/effective_tld_names.dat": "public_suffix_list.dat",
    "assets/thirdparties/hosts-file.net/ad-servers": "hphosts",
    "assets/thirdparties/www.malwaredomainlist.com/hostslist/hosts.txt": "malware-0",
    "assets/thirdparties/mirror1.malwaredomains.com/files/justdomains": "malware-1",
    "assets/thirdparties/pgl.yoyo.org/as/serverlist": "plowe-0",
    "assets/thirdparties/someonewhocares.org/hosts/hosts": "dpollock-0",
    "assets/thirdparties/winhelp2002.mvps.org/hosts.txt": "mvps-0"
};

var migrate = function(callback) {
    var entries,
        moveCount = 0,
        toRemove = [];

    var countdown = function(change) {
        moveCount -= (change || 0);
        if ( moveCount !== 0 ) { return; }
        vAPI.cacheStorage.remove(toRemove);
        saveAssetCacheRegistry();
        callback();
    };

    var onContentRead = function(oldKey, newKey, bin) {
        var content = bin && bin['cached_asset_content://' + oldKey] || undefined;
        if ( content ) {
            assetCacheRegistry[newKey] = {
                readTime: Date.now(),
                writeTime: entries[oldKey]
            };
            if ( reIsExternalPath.test(oldKey) ) {
                assetCacheRegistry[newKey].remoteURL = oldKey;
            }
            bin = {};
            bin['cache/' + newKey] = content;
            vAPI.cacheStorage.set(bin);
        }
        countdown(1);
    };

    var onEntries = function(bin) {
        entries = bin && bin.cached_asset_entries;
        if ( !entries ) { return callback(); }
        if ( bin && bin.assetCacheRegistry ) {
            assetCacheRegistry = bin.assetCacheRegistry;
        }
        var aliases = api.listKeyAliases;
        for ( var oldKey in entries ) {
            var newKey = aliases[oldKey];
            if ( !newKey && /^https?:\/\//.test(oldKey) ) {
                newKey = oldKey;
            }
            if ( newKey ) {
                vAPI.cacheStorage.get(
                    'cached_asset_content://' + oldKey,
                    onContentRead.bind(null, oldKey, newKey)
                );
                moveCount += 1;
            }
            toRemove.push('cached_asset_content://' + oldKey);
        }
        toRemove.push('cached_asset_entries', 'extensionLastVersion');
        countdown();
    };

    vAPI.cacheStorage.get(
        [ 'cached_asset_entries', 'assetCacheRegistry' ],
        onEntries
    );
};

/*******************************************************************************

    The purpose of the asset source registry is to keep key detail information
    about an asset:
    - Where to load it from: this may consist of one or more URLs, either local
      or remote.
    - After how many days an asset should be deemed obsolete -- i.e. in need of
      an update.
    - The origin and type of an asset.
    - The last time an asset was registered.

**/

var assetSourceRegistryStatus,
    assetSourceRegistry = Object.create(null);

var registerAssetSource = function(assetKey, dict) {
    var entry = assetSourceRegistry[assetKey] || {};
    for ( var prop in dict ) {
        if ( dict.hasOwnProperty(prop) === false ) { continue; }
        if ( dict[prop] === undefined ) {
            delete entry[prop];
        } else {
            entry[prop] = dict[prop];
        }
    }
    var contentURL = dict.contentURL;
    if ( contentURL !== undefined ) {
        if ( typeof contentURL === 'string' ) {
            contentURL = entry.contentURL = [ contentURL ];
        } else if ( Array.isArray(contentURL) === false ) {
            contentURL = entry.contentURL = [];
        }
        var remoteURLCount = 0;
        for ( var i = 0; i < contentURL.length; i++ ) {
            if ( reIsExternalPath.test(contentURL[i]) ) {
                remoteURLCount += 1;
            }
        }
        entry.hasLocalURL = remoteURLCount !== contentURL.length;
        entry.hasRemoteURL = remoteURLCount !== 0;
    } else if ( entry.contentURL === undefined ) {
        entry.contentURL = [];
    }
    if ( typeof entry.updateAfter !== 'number' ) {
        entry.updateAfter = 13;
    }
    if ( entry.submitter ) {
        entry.submitTime = Date.now(); // To detect stale entries
    }
    assetSourceRegistry[assetKey] = entry;
};

var unregisterAssetSource = function(assetKey) {
    assetCacheRemove(assetKey);
    delete assetSourceRegistry[assetKey];
};

var saveAssetSourceRegistry = (function() {
    var timer;
    var save = function() {
        timer = undefined;
        vAPI.cacheStorage.set({ assetSourceRegistry: assetSourceRegistry });
    };
    return function(lazily) {
        if ( timer !== undefined ) {
            clearTimeout(timer);
        }
        if ( lazily ) {
            timer = vAPI.setTimeout(save, 500);
        } else {
            save();
        }
    };
})();

var updateAssetSourceRegistry = function(json, silent) {
    var newDict;
    try {
        newDict = JSON.parse(json);
    } catch (ex) {
    }
    if ( newDict instanceof Object === false ) { return; }

    var oldDict = assetSourceRegistry,
        assetKey;

    // Remove obsolete entries (only those which were built-in).
    for ( assetKey in oldDict ) {
        if (
            newDict[assetKey] === undefined &&
            oldDict[assetKey].submitter === undefined
        ) {
            unregisterAssetSource(assetKey);
        }
    }
    // Add/update existing entries. Notify of new asset sources.
    for ( assetKey in newDict ) {
        if ( oldDict[assetKey] === undefined && !silent ) {
            fireNotification(
                'builtin-asset-source-added',
                { assetKey: assetKey, entry: newDict[assetKey] }
            );
        }
        registerAssetSource(assetKey, newDict[assetKey]);
    }
    saveAssetSourceRegistry();
};

var getAssetSourceRegistry = function(callback) {
    // Already loaded.
    if ( assetSourceRegistryStatus === 'ready' ) {
        callback(assetSourceRegistry);
        return;
    }

    // Being loaded.
    if ( Array.isArray(assetSourceRegistryStatus) ) {
        assetSourceRegistryStatus.push(callback);
        return;
    }

    // Not loaded: load it.
    assetSourceRegistryStatus = [ callback ];

    var registryReady = function() {
        var callers = assetSourceRegistryStatus;
        assetSourceRegistryStatus = 'ready';
        var fn;
        while ( (fn = callers.shift()) ) {
            fn(assetSourceRegistry);
        }
    };

    // First-install case.
    var createRegistry = function() {
        api.fetchText(
            µMatrix.assetsBootstrapLocation || 'assets/assets.json',
            function(details) {
                updateAssetSourceRegistry(details.content, true);
                registryReady();
            }
        );
    };

    vAPI.cacheStorage.get('assetSourceRegistry', function(bin) {
        if ( !bin || !bin.assetSourceRegistry ) {
            createRegistry();
            return;
        }
        assetSourceRegistry = bin.assetSourceRegistry;
        registryReady();
    });
};

api.registerAssetSource = function(assetKey, details) {
    getAssetSourceRegistry(function() {
        registerAssetSource(assetKey, details);
        saveAssetSourceRegistry(true);
    });
};

api.unregisterAssetSource = function(assetKey) {
    getAssetSourceRegistry(function() {
        unregisterAssetSource(assetKey);
        saveAssetSourceRegistry(true);
    });
};

/*******************************************************************************

    The purpose of the asset cache registry is to keep track of all assets
    which have been persisted into the local cache.

**/

var assetCacheRegistryStatus,
    assetCacheRegistryStartTime = Date.now(),
    assetCacheRegistry = {};

var getAssetCacheRegistry = function(callback) {
    // Already loaded.
    if ( assetCacheRegistryStatus === 'ready' ) {
        callback(assetCacheRegistry);
        return;
    }

    // Being loaded.
    if ( Array.isArray(assetCacheRegistryStatus) ) {
        assetCacheRegistryStatus.push(callback);
        return;
    }

    // Not loaded: load it.
    assetCacheRegistryStatus = [ callback ];

    var registryReady = function() {
        var callers = assetCacheRegistryStatus;
        assetCacheRegistryStatus = 'ready';
        var fn;
        while ( (fn = callers.shift()) ) {
            fn(assetCacheRegistry);
        }
    };

    var migrationDone = function() {
        vAPI.cacheStorage.get('assetCacheRegistry', function(bin) {
            if ( bin && bin.assetCacheRegistry ) {
                assetCacheRegistry = bin.assetCacheRegistry;
            }
            registryReady();
        });
    };

    migrate(migrationDone);
};

var saveAssetCacheRegistry = (function() {
    var timer;
    var save = function() {
        timer = undefined;
        vAPI.cacheStorage.set({ assetCacheRegistry: assetCacheRegistry });
    };
    return function(lazily) {
        if ( timer !== undefined ) { clearTimeout(timer); }
        if ( lazily ) {
            timer = vAPI.setTimeout(save, 500);
        } else {
            save();
        }
    };
})();

var assetCacheRead = function(assetKey, callback) {
    var internalKey = 'cache/' + assetKey;

    var reportBack = function(content, err) {
        var details = { assetKey: assetKey, content: content };
        if ( err ) { details.error = err; }
        callback(details);
    };

    var onAssetRead = function(bin) {
        if ( !bin || !bin[internalKey] ) {
            return reportBack('', 'E_NOTFOUND');
        }
        var entry = assetCacheRegistry[assetKey];
        if ( entry === undefined ) {
            return reportBack('', 'E_NOTFOUND');
        }
        entry.readTime = Date.now();
        saveAssetCacheRegistry(true);
        reportBack(bin[internalKey]);
    };

    var onReady = function() {
        vAPI.cacheStorage.get(internalKey, onAssetRead);
    };

    getAssetCacheRegistry(onReady);
};

var assetCacheWrite = function(assetKey, details, callback) {
    var internalKey = 'cache/' + assetKey;
    var content = '';
    if ( typeof details === 'string' ) {
        content = details;
    } else if ( details instanceof Object ) {
        content = details.content || '';
    }

    if ( content === '' ) {
        return assetCacheRemove(assetKey, callback);
    }

    var reportBack = function(content) {
        var details = { assetKey: assetKey, content: content };
        if ( typeof callback === 'function' ) {
            callback(details);
        }
        fireNotification('after-asset-updated', details);
    };

    var onReady = function() {
        var entry = assetCacheRegistry[assetKey];
        if ( entry === undefined ) {
            entry = assetCacheRegistry[assetKey] = {};
        }
        entry.writeTime = entry.readTime = Date.now();
        if ( details instanceof Object && typeof details.url === 'string' ) {
            entry.remoteURL = details.url;
        }
        var bin = { assetCacheRegistry: assetCacheRegistry };
        bin[internalKey] = content;
        vAPI.cacheStorage.set(bin);
        reportBack(content);
    };
    getAssetCacheRegistry(onReady);
};

var assetCacheRemove = function(pattern, callback) {
    var onReady = function() {
        var cacheDict = assetCacheRegistry,
            removedEntries = [],
            removedContent = [];
        for ( var assetKey in cacheDict ) {
            if ( pattern instanceof RegExp && !pattern.test(assetKey) ) {
                continue;
            }
            if ( typeof pattern === 'string' && assetKey !== pattern ) {
                continue;
            }
            removedEntries.push(assetKey);
            removedContent.push('cache/' + assetKey);
            delete cacheDict[assetKey];
        }
        if ( removedContent.length !== 0 ) {
            vAPI.cacheStorage.remove(removedContent);
            var bin = { assetCacheRegistry: assetCacheRegistry };
            vAPI.cacheStorage.set(bin);
        }
        if ( typeof callback === 'function' ) {
            callback();
        }
        for ( var i = 0; i < removedEntries.length; i++ ) {
            fireNotification('after-asset-updated', { assetKey: removedEntries[i] });
        }
    };

    getAssetCacheRegistry(onReady);
};

var assetCacheMarkAsDirty = function(pattern, exclude, callback) {
    var onReady = function() {
        var cacheDict = assetCacheRegistry,
            cacheEntry,
            mustSave = false;
        for ( var assetKey in cacheDict ) {
            if ( pattern instanceof RegExp ) {
                if ( pattern.test(assetKey) === false ) { continue; }
            } else if ( typeof pattern === 'string' ) {
                if ( assetKey !== pattern ) { continue; }
            } else if ( Array.isArray(pattern) ) {
                if ( pattern.indexOf(assetKey) === -1 ) { continue; }
            }
            if ( exclude instanceof RegExp ) {
                if ( exclude.test(assetKey) ) { continue; }
            } else if ( typeof exclude === 'string' ) {
                if ( assetKey === exclude ) { continue; }
            } else if ( Array.isArray(exclude) ) {
                if ( exclude.indexOf(assetKey) !== -1 ) { continue; }
            }
            cacheEntry = cacheDict[assetKey];
            if ( !cacheEntry.writeTime ) { continue; }
            cacheDict[assetKey].writeTime = 0;
            mustSave = true;
        }
        if ( mustSave ) {
            var bin = { assetCacheRegistry: assetCacheRegistry };
            vAPI.cacheStorage.set(bin);
        }
        if ( typeof callback === 'function' ) {
            callback();
        }
    };
    if ( typeof exclude === 'function' ) {
        callback = exclude;
        exclude = undefined;
    }
    getAssetCacheRegistry(onReady);
};

/******************************************************************************/

var stringIsNotEmpty = function(s) {
    return typeof s === 'string' && s !== '';
};

/******************************************************************************/

api.get = function(assetKey, options, callback) {
    if ( typeof options === 'function' ) {
        callback = options;
        options = {};
    } else if ( typeof callback !== 'function' ) {
        callback = noopfunc;
    }

    var assetDetails = {},
        contentURLs,
        contentURL;

    var reportBack = function(content, err) {
        var details = { assetKey: assetKey, content: content };
        if ( err ) {
            details.error = assetDetails.lastError = err;
        } else {
            assetDetails.lastError = undefined;
        }
        callback(details);
    };

    var onContentNotLoaded = function() {
        var isExternal;
        while ( (contentURL = contentURLs.shift()) ) {
            isExternal = reIsExternalPath.test(contentURL);
            if ( isExternal === false || assetDetails.hasLocalURL !== true ) {
                break;
            }
        }
        if ( !contentURL ) {
            return reportBack('', 'E_NOTFOUND');
        }
        api.fetchText(contentURL, onContentLoaded, onContentNotLoaded);
    };

    var onContentLoaded = function(details) {
        if ( stringIsNotEmpty(details.content) === false ) {
            onContentNotLoaded();
            return;
        }
        if ( reIsExternalPath.test(contentURL) && options.dontCache !== true ) {
            assetCacheWrite(assetKey, {
                content: details.content,
                url: contentURL
            });
        }
        reportBack(details.content);
    };

    var onCachedContentLoaded = function(details) {
        if ( details.content !== '' ) {
            return reportBack(details.content);
        }
        getAssetSourceRegistry(function(registry) {
            assetDetails = registry[assetKey] || {};
            if ( typeof assetDetails.contentURL === 'string' ) {
                contentURLs = [ assetDetails.contentURL ];
            } else if ( Array.isArray(assetDetails.contentURL) ) {
                contentURLs = assetDetails.contentURL.slice(0);
            } else {
                contentURLs = [];
            }
            onContentNotLoaded();
        });
    };

    assetCacheRead(assetKey, onCachedContentLoaded);
};

/******************************************************************************/

var getRemote = function(assetKey, callback) {
   var assetDetails = {},
        contentURLs,
        contentURL;

    var reportBack = function(content, err) {
        var details = { assetKey: assetKey, content: content };
        if ( err ) {
            details.error = assetDetails.lastError = err;
        } else {
            assetDetails.lastError = undefined;
        }
        callback(details);
    };

    var onRemoteContentLoaded = function(details) {
        if ( stringIsNotEmpty(details.content) === false ) {
            registerAssetSource(assetKey, { error: { time: Date.now(), error: 'No content' } });
            tryLoading();
            return;
        }
        assetCacheWrite(assetKey, {
            content: details.content,
            url: contentURL
        });
        registerAssetSource(assetKey, { error: undefined });
        reportBack(details.content);
    };

    var onRemoteContentError = function(details) {
        var text = details.statusText;
        if ( details.statusCode === 0 ) {
            text = 'network error';
        }
        registerAssetSource(assetKey, { error: { time: Date.now(), error: text } });
        tryLoading();
    };

    var tryLoading = function() {
        while ( (contentURL = contentURLs.shift()) ) {
            if ( reIsExternalPath.test(contentURL) ) { break; }
        }
        if ( !contentURL ) {
            return reportBack('', 'E_NOTFOUND');
        }
        api.fetchText(contentURL, onRemoteContentLoaded, onRemoteContentError);
    };

    getAssetSourceRegistry(function(registry) {
        assetDetails = registry[assetKey] || {};
        if ( typeof assetDetails.contentURL === 'string' ) {
            contentURLs = [ assetDetails.contentURL ];
        } else if ( Array.isArray(assetDetails.contentURL) ) {
            contentURLs = assetDetails.contentURL.slice(0);
        } else {
            contentURLs = [];
        }
        tryLoading();
    });
};

/******************************************************************************/

api.put = function(assetKey, content, callback) {
    assetCacheWrite(assetKey, content, callback);
};

/******************************************************************************/

api.metadata = function(callback) {
    var assetRegistryReady = false,
        cacheRegistryReady = false;

    var onReady = function() {
        var assetDict = JSON.parse(JSON.stringify(assetSourceRegistry)),
            cacheDict = assetCacheRegistry,
            assetEntry, cacheEntry,
            now = Date.now(), obsoleteAfter;
        for ( var assetKey in assetDict ) {
            assetEntry = assetDict[assetKey];
            cacheEntry = cacheDict[assetKey];
            if ( cacheEntry ) {
                assetEntry.cached = true;
                assetEntry.writeTime = cacheEntry.writeTime;
                obsoleteAfter = cacheEntry.writeTime + assetEntry.updateAfter * 86400000;
                assetEntry.obsolete = obsoleteAfter < now;
                assetEntry.remoteURL = cacheEntry.remoteURL;
            } else {
                assetEntry.writeTime = 0;
                obsoleteAfter = 0;
                assetEntry.obsolete = true;
            }
        }
        callback(assetDict);
    };

    getAssetSourceRegistry(function() {
        assetRegistryReady = true;
        if ( cacheRegistryReady ) { onReady(); }
    });

    getAssetCacheRegistry(function() {
        cacheRegistryReady = true;
        if ( assetRegistryReady ) { onReady(); }
    });
};

/******************************************************************************/

api.purge = assetCacheMarkAsDirty;

api.remove = function(pattern, callback) {
    assetCacheRemove(pattern, callback);
};

api.rmrf = function() {
    assetCacheRemove(/./);
};

/******************************************************************************/

// Asset updater area.
var updaterStatus,
    updaterTimer,
    updaterAssetDelayDefault = 120000,
    updaterAssetDelay = updaterAssetDelayDefault,
    updaterUpdated = [],
    updaterFetched = new Set();

var updateFirst = function() {
    updaterStatus = 'updating';
    updaterFetched.clear();
    updaterUpdated = [];
    fireNotification('before-assets-updated');
    updateNext();
};

var updateNext = function() {
    var assetDict, cacheDict;

    // This will remove a cached asset when it's no longer in use.
    var garbageCollectOne = function(assetKey) {
        var cacheEntry = cacheDict[assetKey];
        if ( cacheEntry && cacheEntry.readTime < assetCacheRegistryStartTime ) {
            assetCacheRemove(assetKey);
        }
    };

    var findOne = function() {
        var now = Date.now(),
            assetEntry, cacheEntry;
        for ( var assetKey in assetDict ) {
            assetEntry = assetDict[assetKey];
            if ( assetEntry.hasRemoteURL !== true ) { continue; }
            if ( updaterFetched.has(assetKey) ) { continue; }
            cacheEntry = cacheDict[assetKey];
            if ( cacheEntry && (cacheEntry.writeTime + assetEntry.updateAfter * 86400000) > now ) {
                continue;
            }
            if ( fireNotification('before-asset-updated', { assetKey: assetKey }) !== false ) {
                return assetKey;
            }
            garbageCollectOne(assetKey);
        }
    };

    var updatedOne = function(details) {
        if ( details.content !== '' ) {
            updaterUpdated.push(details.assetKey);
            if ( details.assetKey === 'assets.json' ) {
                updateAssetSourceRegistry(details.content);
            }
        } else {
            fireNotification('asset-update-failed', { assetKey: details.assetKey });
        }
        if ( findOne() !== undefined ) {
            vAPI.setTimeout(updateNext, updaterAssetDelay);
        } else {
            updateDone();
        }
    };

    var updateOne = function() {
        var assetKey = findOne();
        if ( assetKey === undefined ) {
            return updateDone();
        }
        updaterFetched.add(assetKey);
        getRemote(assetKey, updatedOne);
    };

    getAssetSourceRegistry(function(dict) {
        assetDict = dict;
        if ( !cacheDict ) { return; }
        updateOne();
    });

    getAssetCacheRegistry(function(dict) {
        cacheDict = dict;
        if ( !assetDict ) { return; }
        updateOne();
    });
};

var updateDone = function() {
    var assetKeys = updaterUpdated.slice(0);
    updaterFetched.clear();
    updaterUpdated = [];
    updaterStatus = undefined;
    updaterAssetDelay = updaterAssetDelayDefault;
    fireNotification('after-assets-updated', { assetKeys: assetKeys });
};

api.updateStart = function(details) {
    var oldUpdateDelay = updaterAssetDelay,
        newUpdateDelay = details.delay || updaterAssetDelayDefault;
    updaterAssetDelay = Math.min(oldUpdateDelay, newUpdateDelay);
    if ( updaterStatus !== undefined ) {
        if ( newUpdateDelay < oldUpdateDelay ) {
            clearTimeout(updaterTimer);
            updaterTimer = vAPI.setTimeout(updateNext, updaterAssetDelay);
        }
        return;
    }
    updateFirst();
};

api.updateStop = function() {
    if ( updaterTimer ) {
        clearTimeout(updaterTimer);
        updaterTimer = undefined;
    }
    if ( updaterStatus !== undefined ) {
        updateDone();
    }
};

/******************************************************************************/

return api;

/******************************************************************************/

})();

/******************************************************************************/
