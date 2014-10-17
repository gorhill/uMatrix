/*******************************************************************************

    µMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2013  Raymond Hill

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

/* global chrome, µMatrix */

/******************************************************************************/

// Low-level asset files manager

µMatrix.assets = (function() {

/******************************************************************************/

var remoteRoot = µMatrix.projectServerRoot;
var nullFunc = function() {};

/******************************************************************************/

var cachedAssetsManager = (function() {
    var entries = null;
    var exports = {};
    var cachedAssetPathPrefix = 'cached_asset_content://';

    var getEntries = function(callback) {
        if ( entries !== null ) {
            callback(entries);
            return;
        }
        var onLoaded = function(bin) {
            if ( chrome.runtime.lastError ) {
                console.error(
                    'assets.js > cachedAssetsManager> getEntries():',
                    chrome.runtime.lastError.message
                );
            }
            entries = bin.cached_asset_entries || {};
            callback(entries);
        };
        chrome.storage.local.get('cached_asset_entries', onLoaded);
    };

    exports.load = function(path, cbSuccess, cbError) {
        cbSuccess = cbSuccess || nullFunc;
        cbError = cbError || nullFunc;
        var details = {
            'path': path,
            'content': ''
        };
        var cachedContentPath = cachedAssetPathPrefix + path;
        var onLoaded = function(bin) {
            if ( chrome.runtime.lastError ) {
                console.error(
                    'assets.js > cachedAssetsManager.load():',
                    chrome.runtime.lastError.message
                );
                details.error = 'Error: ' + chrome.runtime.lastError.message;
                cbError(details);
                return;
            }
            details.content = bin[cachedContentPath];
            cbSuccess(details);
        };
        var onEntries = function(entries) {
            if ( entries[path] === undefined ) {
                details.error = 'Error: not found'
                cbError(details);
                return;
            }
            chrome.storage.local.get(cachedContentPath, onLoaded);
        };
        getEntries(onEntries);
    };

    exports.save = function(path, content, cbSuccess, cbError) {
        cbSuccess = cbSuccess || nullFunc;
        cbError = cbError || nullFunc;
        var cachedContentPath = cachedAssetPathPrefix + path;
        var bin = {};
        bin[cachedContentPath] = content;
        var onSaved = function() {
            if ( chrome.runtime.lastError ) {
                console.error(
                    'assets.js > cachedAssetsManager.save():',
                    chrome.runtime.lastError.message
                );
                cbError(chrome.runtime.lastError.message);
            } else {
                cbSuccess();
            }
        };
        var onEntries = function(entries) {
            if ( entries[path] === undefined ) {
                entries[path] = true;
                bin.cached_asset_entries = entries;
            }
            chrome.storage.local.set(bin, onSaved);
        };
        getEntries(onEntries);
    };

    exports.remove = function(pattern) {
        var onEntries = function(entries) {
            var mustSave = false;
            var pathstoRemove = [];
            var paths = Object.keys(entries);
            var i = paths.length;
            var path;
            while ( i-- ) {
                if ( typeof pattern === 'string' && path !== pattern ) {
                    continue;
                }
                if ( pattern instanceof RegExp && !pattern.test(path) ) {
                    continue;
                }
                pathstoRemove.push(cachedAssetPathPrefix + path);
                delete entries[path];
                mustSave = true;
            }
            if ( mustSave ) {
                chrome.storage.local.remove(pathstoRemove);
                chrome.storage.local.set({ 'cached_asset_entries': entries });
            }
        };
        getEntries(onEntries);
    };

    return exports;
})();

/******************************************************************************/

var getTextFileFromURL = function(url, onLoad, onError) {
    // console.log('assets.js > getTextFileFromURL("%s"):', url);
    var xhr = new XMLHttpRequest();
    xhr.responseType = 'text';
    xhr.onload = onLoad;
    xhr.onerror = onError;
    xhr.ontimeout = onError;
    xhr.open('get', url, true);
    xhr.send();
};

/******************************************************************************/

// Flush cached non-user assets if these are from a prior version.
// https://github.com/gorhill/httpswitchboard/issues/212

var cacheSynchronized = false;

var synchronizeCache = function() {
    if ( cacheSynchronized ) {
        return;
    }
    cacheSynchronized = true;

    var onLastVersionRead = function(store) {
        var currentVersion = chrome.runtime.getManifest().version;
        var lastVersion = store.extensionLastVersion || '0.0.0.0';
        if ( currentVersion === lastVersion ) {
            return;
        }
        chrome.storage.local.set({ 'extensionLastVersion': currentVersion });
        cachedAssetsManager.remove(/assets\/(umatrix|thirdparties)\//);
    };

    chrome.storage.local.get('extensionLastVersion', onLastVersionRead);
};

/******************************************************************************/

var readLocalFile = function(path, callback) {
    var reportBack = function(content, err) {
        var details = {
            'path': path,
            'content': content,
            'error': err
        };
        callback(details);
    };

    var onLocalFileLoaded = function() {
        // console.log('assets.js > onLocalFileLoaded()');
        reportBack(this.responseText);
        this.onload = this.onerror = null;
    };

    var onLocalFileError = function(ev) {
        console.error('assets.js > readLocalFile() / onLocalFileError("%s")', path);
        reportBack('', 'Error');
        this.onload = this.onerror = null;
    };

    var onCacheFileLoaded = function(details) {
        // console.log('assets.js > readLocalFile() / onCacheFileLoaded()');
        reportBack(details.content);
    };

    var onCacheFileError = function(details) {
        // This handler may be called under normal circumstances: it appears
        // the entry may still be present even after the file was removed.
        console.error('assets.js > readLocalFile() / onCacheFileError("%s")', details.path);
        getTextFileFromURL(chrome.runtime.getURL(details.path), onLocalFileLoaded, onLocalFileError);
    };

    cachedAssetsManager.load(path, onCacheFileLoaded, onCacheFileError);
};

/******************************************************************************/

var readRemoteFile = function(path, callback) {
    var reportBack = function(content, err) {
        var details = {
            'path': path,
            'content': content,
            'error': err
        };
        callback(details);
    };

    var onRemoteFileLoaded = function() {
        // console.log('assets.js > readRemoteFile() / onRemoteFileLoaded()');
        // https://github.com/gorhill/httpswitchboard/issues/263
        if ( this.status === 200 ) {
            reportBack(this.responseText);
        } else {
            reportBack('', 'Error ' + this.statusText);
        }
        this.onload = this.onerror = null;
    };

    var onRemoteFileError = function(ev) {
        console.error('assets.js > readRemoteFile() / onRemoteFileError("%s")', path);
        reportBack('', 'Error');
        this.onload = this.onerror = null;
    };

    // 'umatrix=...' is to skip browser cache
    getTextFileFromURL(
        remoteRoot + path + '?umatrix=' + Date.now(),
        onRemoteFileLoaded,
        onRemoteFileError
    );
};

/******************************************************************************/

var writeLocalFile = function(path, content, callback) {
    var reportBack = function(err) {
        var details = {
            'path': path,
            'content': content,
            'error': err
        };
        callback(details);
    };

    var onFileWriteSuccess = function() {
        console.log('assets.js > writeLocalFile() / onFileWriteSuccess("%s")', path);
        reportBack();
    };

    var onFileWriteError = function(err) {
        console.error('assets.js > writeLocalFile() / onFileWriteError("%s"):', path, err);
        reportBack(err);
    };

    cachedAssetsManager.save(path, content, onFileWriteSuccess, onFileWriteError);
};

/******************************************************************************/

var updateFromRemote = function(details, callback) {
    // 'umatrix=...' is to skip browser cache
    var remoteURL = remoteRoot + details.path + '?umatrix=' + Date.now();
    var targetPath = details.path;
    var targetMd5 = details.md5 || '';

    var reportBackError = function() {
        callback({
            'path': targetPath,
            'error': 'Error'
        });
    };

    var onRemoteFileLoaded = function() {
        this.onload = this.onerror = null;
        if ( typeof this.responseText !== 'string' ) {
            console.error('assets.js > updateFromRemote("%s") / onRemoteFileLoaded(): no response', remoteURL);
            reportBackError();
            return;
        }
        if ( YaMD5.hashStr(this.responseText) !== targetMd5 ) {
            console.error('assets.js > updateFromRemote("%s") / onRemoteFileLoaded(): bad md5 checksum', remoteURL);
            reportBackError();
            return;
        }
        // console.debug('assets.js > updateFromRemote("%s") / onRemoteFileLoaded()', remoteURL);
        writeLocalFile(targetPath, this.responseText, callback);
    };

    var onRemoteFileError = function(ev) {
        this.onload = this.onerror = null;
        console.error('assets.js > updateFromRemote() / onRemoteFileError("%s"):', remoteURL, this.statusText);
        reportBackError();
    };

    getTextFileFromURL(
        remoteURL,
        onRemoteFileLoaded,
        onRemoteFileError
    );
};

/******************************************************************************/

// Flush cached assets if cache content is from an older version: the extension
// always ships with the most up-to-date assets.

synchronizeCache();

/******************************************************************************/

// Export API

return {
    'get': readLocalFile,
    'getRemote': readRemoteFile,
    'put': writeLocalFile,
    'update': updateFromRemote
};

/******************************************************************************/

})();

/******************************************************************************/
