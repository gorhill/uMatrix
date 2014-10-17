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

/* global chrome, $ */

/******************************************************************************/

$(function() {

/******************************************************************************/

var updateList = {};
var assetListSwitches = ['o', 'o', 'o'];
var commitHistoryURLPrefix = 'https://github.com/gorhill/httpswitchboard/commits/master/';

/******************************************************************************/

var backupUserDataToFile = function() {
    var allUserData = {
        timeStamp: Date.now(),
        version: '',
        userSettings: {},
        scopes: '',
        remoteBlacklists: {},
        ubiquitousBlacklist: '',
        ubiquitousWhitelist: ''
    };

    var userWhitelistReady = function(details) {
        allUserData.ubiquitousWhitelist = details.content;
        chrome.downloads.download({
            'url': 'data:text/plain,' + encodeURIComponent(JSON.stringify(allUserData)),
            'filename': 'umatrix-alluserdata-backup.txt',
            'saveAs': true
        });
    };

    var userBlacklistReady = function(details) {
        allUserData.ubiquitousBlacklist = details.content;
        messaging.ask({ what: 'readUserUbiquitousAllowRules' }, userWhitelistReady);
    };

    var ruleDataReady = function(store) {
        allUserData.version = store.version;
        allUserData.scopes = store.scopes;
        allUserData.remoteBlacklists = store.remoteBlacklists;
        messaging.ask({ what: 'readUserUbiquitousBlockRules' }, userBlacklistReady);
    };

    var userSettingsReady = function(store) {
        allUserData.userSettings = store;
        chrome.storage.local.get(['version', 'scopes', 'remoteBlacklists'], ruleDataReady);
    };

    messaging.ask({ what: 'readUserSettings' }, userSettingsReady);
};

/******************************************************************************/

var restoreUserDataFromFile = function() {
    var input = $('<input />').attr({
        type: 'file',
        accept: 'text/plain'
    });

    var restartCountdown = 4;
    var doCountdown = function() {
        restartCountdown -= 1;
        if ( restartCountdown > 0 ) {
            return;
        }
        chrome.runtime.reload();
    };

    var restoreBackup = function(data) {
        chrome.storage.local.set(data.userSettings, doCountdown);
        var store = {
            'version': data.version,
            'scopes': data.scopes
        };
        // This case may happen if data was backed up without the user having
        // changed default selection of lists.
        if ( data.remoteBlacklists !== undefined ) {
            store.remoteBlacklists = data.remoteBlacklists;
        }
        chrome.storage.local.set(store, doCountdown);
        messaging.ask({
                what: 'writeUserUbiquitousBlockRules',
                content: data.ubiquitousBlacklist
            },
            doCountdown
        );
        messaging.ask({
                what: 'writeUserUbiquitousAllowRules',
                content: data.ubiquitousWhitelist
            },
            doCountdown
        );
    };

    var validateBackup = function(s) {
        var data;
        try {
            data = JSON.parse(s);
        }
        catch (e) {
            data = undefined;
        }
        if ( typeof data !== 'object' ||
             typeof data.timeStamp !== 'number' ||
             typeof data.version !== 'string' ||
             typeof data.userSettings !== 'object' ||
             typeof data.scopes !== 'string' ||
             typeof data.ubiquitousBlacklist !== 'string' ||
             typeof data.ubiquitousWhitelist !== 'string' ) {
            alert('File content is not valid backed up data.');
        }
        return data;
    };

    var fileReaderOnLoadHandler = function() {
        var data = validateBackup(this.result);
        if ( !data ) {
            return;
        }
        var time = new Date(data.timeStamp);
        var msg = chrome.i18n
            .getMessage('aboutUserDataRestoreConfirm')
            .replace('{{time}}', time.toLocaleString());
        var proceed = window.confirm(msg);
        if ( proceed ) {
            restoreBackup(data);
        }
    };

    var filePickerOnChangeHandler = function() {
        $(this).off('change', filePickerOnChangeHandler);
        var file = this.files[0];
        if ( !file ) {
            return;
        }
        if ( file.type.indexOf('text') !== 0 ) {
            return;
        }
        var fr = new FileReader();
        fr.onload = fileReaderOnLoadHandler;
        fr.readAsText(file);
        input.off('change', filePickerOnChangeHandler);
    };

    input.on('change', filePickerOnChangeHandler);
    input.trigger('click');
};

/******************************************************************************/

var resetUserData = function() {
    messaging.tell({
        what: 'gotoExtensionURL',
        url: 'setup.html'
    });
};

/******************************************************************************/

var setAssetListClassBit = function(bit, state) {
    assetListSwitches[assetListSwitches.length-1-bit] = !state ? 'o' : 'x';
    $('#assetList')
        .removeClass()
        .addClass(assetListSwitches.join(''));
};

/******************************************************************************/

var renderAssetList = function(details) {
    var dirty = false;
    var paths = Object.keys(details.list).sort();
    if ( paths.length > 0 ) {
        $('#assetList .assetEntry').remove();
        var assetTable = $('#assetList table');
        var i = 0;
        var path, status, html;
        while ( path = paths[i++] ) {
            status = details.list[path].status;
            dirty = dirty || status !== 'Unchanged';
            html = [];
            html.push('<tr class="assetEntry ' + status.toLowerCase().replace(/ +/g, '-') + '">');
            html.push('<td>');
            html.push('<a href="' + commitHistoryURLPrefix + path + '">');
            html.push(path.replace(/^(assets\/[^/]+\/)(.+)$/, '$1<b>$2</b>'));
            html.push('</a>');
            html.push('<td>');
            html.push(chrome.i18n.getMessage('aboutAssetsUpdateStatus' + status));
            assetTable.append(html.join(''));
        }
        $('#assetList a').attr('target', '_blank');
        updateList = details.list;
    }
    setAssetListClassBit(0, paths.length !== 0);
    setAssetListClassBit(1, dirty);
    setAssetListClassBit(2, false);
};

/******************************************************************************/

var updateAssets = function() {
    setAssetListClassBit(2, true);
    var onDone = function(details) {
        if ( details.changedCount !== 0 ) {
            messaging.tell({ what: 'loadUpdatableAssets' });
        }
    };
    messaging.ask({ what: 'launchAssetUpdater', list: updateList }, onDone);
};

/******************************************************************************/

var updateAssetsList = function() {
    messaging.ask({ what: 'getAssetUpdaterList' }, renderAssetList);
};

/******************************************************************************/

// Updating all assets could be done from elsewhere and if so the
// list here needs to be updated.

var onAnnounce = function(msg) {
    switch ( msg.what ) {
        case 'allLocalAssetsUpdated':
            updateAssetsList();
            break;

        default:
            break;
    }
};

messaging.start('about.js');
messaging.listen(onAnnounce);

/******************************************************************************/

(function() {
    $('#aboutVersion').html(chrome.runtime.getManifest().version);
    var renderStats = function(details) {
        var template = chrome.i18n.getMessage('aboutStorageUsed');
        var percent = 0;
        if ( details.storageQuota ) {
            percent = (details.storageUsed / details.storageQuota * 100).toFixed(1);
        }
        $('#aboutStorageUsed').html(template.replace('{{storageUsed}}', percent));
    };
    messaging.ask({ what: 'getSomeStats' }, renderStats);
})();

/******************************************************************************/

$('#aboutAssetsUpdateButton').on('click', updateAssets);
$('#backupUserDataButton').on('click', backupUserDataToFile);
$('#restoreUserDataButton').on('click', restoreUserDataFromFile);
$('#resetUserDataButton').on('click', resetUserData);

/******************************************************************************/

updateAssetsList();

/******************************************************************************/

});
