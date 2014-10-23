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

/* global chrome, uDom */

/******************************************************************************/

uDom.onLoad(function() {

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

function restoreUserDataFromFile() {
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

    var file = this.files[0];
    if ( file === undefined || file.name === '' ) {
        return;
    }
    if ( file.type.indexOf('text') !== 0 ) {
        return;
    }
    var fr = new FileReader();
    fr.onload = fileReaderOnLoadHandler;
    fr.readAsText(file);
}

/******************************************************************************/

var startRestoreFilePicker = function() {
    var input = document.getElementById('restoreFilePicker');
    // Reset to empty string, this will ensure an change event is properly
    // triggered if the user pick a file, even if it is the same as the last
    // one picked.
    input.value = '';
    input.click();
};

/******************************************************************************/

var resetUserData = function() {
    messaging.tell({
        what: 'gotoExtensionURL',
        url: 'setup.html'
    });
};

/******************************************************************************/

messaging.start('about.js');

/******************************************************************************/

(function() {
    uDom('#aboutVersion').html(chrome.runtime.getManifest().version);
    var renderStats = function(details) {
        var template = chrome.i18n.getMessage('aboutStorageUsed');
        var percent = 0;
        if ( details.storageQuota ) {
            percent = (details.storageUsed / details.storageQuota * 100).toFixed(1);
        }
        uDom('#aboutStorageUsed').html(template.replace('{{storageUsed}}', percent));
    };
    messaging.ask({ what: 'getSomeStats' }, renderStats);
})();

/******************************************************************************/

uDom('#backupUserDataButton').on('click', backupUserDataToFile);
uDom('#restoreUserDataButton').on('click', startRestoreFilePicker);
uDom('#restoreFilePicker').on('change', restoreUserDataFromFile);
uDom('#resetUserDataButton').on('click', resetUserData);

/******************************************************************************/

});
