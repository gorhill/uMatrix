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

/* global chrome, messaging, uDom */

/******************************************************************************/

uDom.onLoad(function() {

/******************************************************************************/

var backupUserDataToFile = function() {
    var userDataReady = function(userData) {
        chrome.downloads.download({
            'url': 'data:text/plain,' + encodeURIComponent(JSON.stringify(userData)),
            'filename': uDom('[data-i18n="aboutBackupFilename"]').text(),
            'saveAs': true
        });
    };

    messaging.ask({ what: 'getAllUserData' }, userDataReady);
};

/******************************************************************************/

function restoreUserDataFromFile() {
    var validateBackup = function(s) {
        var userData = null;
        try {
            userData = JSON.parse(s);
        }
        catch (e) {
            userData = null;
        }
        if ( userData === null ) {
            return null;
        }
        if ( typeof userData !== 'object' ||
             typeof userData.version !== 'string' ||
             typeof userData.when !== 'number' ||
             typeof userData.settings !== 'object' ||
             typeof userData.rules !== 'string' ||
             typeof userData.hostsFiles !== 'object' ) {
            return null;
        }
        return userData;
    };

    var fileReaderOnLoadHandler = function() {
        var userData = validateBackup(this.result);
        if ( !userData ) {
            window.alert(uDom('[data-i18n="aboutRestoreError"]').text());
            return;
        }
        var time = new Date(userData.when);
        var msg = uDom('[data-i18n="aboutRestoreConfirm"]').text()
            .replace('{{time}}', time.toLocaleString());
        var proceed = window.confirm(msg);
        if ( proceed ) {
            messaging.tell({ what: 'restoreAllUserData', userData: userData });
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
    var proceed = window.confirm(uDom('[data-i18n="aboutResetConfirm"]').text());
    if ( proceed ) {
        messaging.tell({ what: 'resetAllUserData' });
    }
};

/******************************************************************************/

(function() {
    var renderStats = function(details) {
        uDom('#aboutVersion').html(details.version);
        var template = uDom('[data-i18n="aboutStorageUsed"]').text();
        var storageUsed = '?';
        if ( typeof details.storageUsed === 'number' ) {
            storageUsed = details.storageUsed.toLocaleString();
        }
        uDom('#aboutStorageUsed').html(template.replace('{{storageUsed}}', storageUsed));
    };
    messaging.start('about.js');
    messaging.ask({ what: 'getSomeStats' }, renderStats);
})();

/******************************************************************************/

uDom('#backupUserDataButton').on('click', backupUserDataToFile);
uDom('#restoreUserDataButton').on('click', startRestoreFilePicker);
uDom('#restoreFilePicker').on('change', restoreUserDataFromFile);
uDom('#resetUserDataButton').on('click', resetUserData);

/******************************************************************************/

});
