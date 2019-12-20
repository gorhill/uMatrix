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

/* global uDom */

'use strict';

/******************************************************************************/

{
// >>>>> start of local scope

/******************************************************************************/

const backupUserDataToFile = function() {
    vAPI.messaging.send('dashboard', {
        what: 'getAllUserData',
    }).then(userData => {
        vAPI.download({
            url: 'data:text/plain,' + encodeURIComponent(
                JSON.stringify(userData, null, 2)
            ),
            filename:
                uDom.nodeFromSelector('[data-i18n="aboutBackupFilename"]')
                    .textContent
        });
    });
};

/******************************************************************************/

const restoreUserDataFromFile = function() {
    const validateBackup = function(s) {
        let userData;
        try {
            userData = JSON.parse(s);
        }
        catch (ex) {
        }
        if ( userData === undefined ) { return; }
        if (
            typeof userData !== 'object' ||
            typeof userData.app !== 'string' ||
            typeof userData.version !== 'string' ||
            typeof userData.when !== 'number' ||
            typeof userData.settings !== 'object' ||
            typeof userData.rules !== 'string' &&
                Array.isArray(userData.rules) === false
        ) {
            return;
        }
        return userData;
    };

    const fileReaderOnLoadHandler = function() {
        const userData = validateBackup(this.result);
        if ( userData instanceof Object === false ) {
            window.alert(uDom('[data-i18n="aboutRestoreError"]').text());
            return;
        }
        const time = new Date(userData.when);
        const msg = uDom.nodeFromSelector('[data-i18n="aboutRestoreConfirm"]')
                        .textContent
                        .replace('{{time}}', time.toLocaleString());
        const proceed = window.confirm(msg);
        if ( proceed ) {
            vAPI.messaging.send('dashboard', {
                what: 'restoreAllUserData',
                userData
            });
        }
    };

    const file = this.files[0];
    if ( file === undefined || file.name === '' ) { return; }
    if ( file.type.indexOf('text') !== 0 ) { return; }
    const fr = new FileReader();
    fr.onload = fileReaderOnLoadHandler;
    fr.readAsText(file);
};

/******************************************************************************/

const startRestoreFilePicker = function() {
    const input = document.getElementById('restoreFilePicker');
    // Reset to empty string, this will ensure an change event is properly
    // triggered if the user pick a file, even if it is the same as the last
    // one picked.
    input.value = '';
    input.click();
};

/******************************************************************************/

const resetUserData = function() {
    const msg = uDom.nodeFromSelector('[data-i18n="aboutResetConfirm"]')
                    .textContent;
    const proceed = window.confirm(msg);
    if ( proceed !== true ) { return; }
    vAPI.messaging.send('dashboard', {
        what: 'resetAllUserData',
    });
};

/******************************************************************************/

vAPI.messaging.send('dashboard', {
    what: 'getSomeStats',
}).then(details => {
    document.getElementById('aboutVersion').textContent = details.version;
    const template = uDom('[data-i18n="aboutStorageUsed"]').text();
    let storageUsed = '?';
    if ( typeof details.storageUsed === 'number' ) {
        storageUsed = details.storageUsed.toLocaleString();
    }
    document.getElementById('aboutStorageUsed').textContent =
        template.replace('{{storageUsed}}', storageUsed);
});

/******************************************************************************/

uDom('#backupUserDataButton').on('click', backupUserDataToFile);
uDom('#restoreUserDataButton').on('click', startRestoreFilePicker);
uDom('#restoreFilePicker').on('change', restoreUserDataFromFile);
uDom('#resetUserDataButton').on('click', resetUserData);

/******************************************************************************/

// <<<<< end of local scope
}
