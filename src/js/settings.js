/*******************************************************************************

    uMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2014-2017 Raymond Hill

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

(function() {

/******************************************************************************/

var cachedSettings = {};

/******************************************************************************/

function changeUserSettings(name, value) {
    vAPI.messaging.send('settings.js', {
        what: 'userSettings',
        name: name,
        value: value
    });
}

/******************************************************************************/

function changeMatrixSwitch(name, state) {
    vAPI.messaging.send('settings.js', {
        what: 'setMatrixSwitch',
        switchName: name,
        state: state
    });
}

/******************************************************************************/

function onChangeValueHandler(elem, setting, min, max) {
    var oldVal = cachedSettings.userSettings[setting];
    var newVal = Math.round(parseFloat(elem.value));
    if ( typeof newVal !== 'number' ) {
        newVal = oldVal;
    } else {
        newVal = Math.max(newVal, min);
        newVal = Math.min(newVal, max);
    }
    elem.value = newVal;
    if ( newVal !== oldVal ) {
        changeUserSettings(setting, newVal);
    }
}

/******************************************************************************/

function prepareToDie() {
    onChangeValueHandler(
        uDom.nodeFromId('deleteUnusedSessionCookiesAfter'),
        'deleteUnusedSessionCookiesAfter',
        15, 1440
    );
    onChangeValueHandler(
        uDom.nodeFromId('clearBrowserCacheAfter'),
        'clearBrowserCacheAfter',
        15, 1440
    );
}

/******************************************************************************/

function onInputChanged(ev) {
    var target = ev.target;

    switch ( target.id ) {
    case 'displayTextSizeNormal':
    case 'displayTextSizeLarge':
        changeUserSettings('displayTextSize', target.value);
        break;
    case 'clearBrowserCache':
    case 'cloudStorageEnabled':
    case 'collapseBlacklisted':
    case 'collapseBlocked':
    case 'colorBlindFriendly':
    case 'deleteCookies':
    case 'deleteLocalStorage':
    case 'deleteUnusedSessionCookies':
    case 'iconBadgeEnabled':
    case 'processHyperlinkAuditing':
        changeUserSettings(target.id, target.checked);
        break;
    case 'noMixedContent':
    case 'processReferer':
        changeMatrixSwitch(
            target.getAttribute('data-matrix-switch'),
            target.checked
        );
        break;
    case 'deleteUnusedSessionCookiesAfter':
        onChangeValueHandler(target, 'deleteUnusedSessionCookiesAfter', 15, 1440);
        break;
    case 'clearBrowserCacheAfter':
        onChangeValueHandler(target, 'clearBrowserCacheAfter', 15, 1440);
        break;
    case 'popupScopeLevel':
        changeUserSettings('popupScopeLevel', target.value);
        break;
    default:
        break;
    }

    switch ( target.id ) {
    case 'collapseBlocked':
        synchronizeWidgets();
        break;
    default:
        break;
    }
}

/******************************************************************************/

function synchronizeWidgets() {
    var e1, e2;

    e1 = uDom.nodeFromId('collapseBlocked');
    e2 = uDom.nodeFromId('collapseBlacklisted');
    if ( e1.checked ) {
        e2.setAttribute('disabled', '');
    } else {
        e2.removeAttribute('disabled');
    }
}

/******************************************************************************/

vAPI.messaging.send(
    'settings.js',
    { what: 'getUserSettings' },
    function onSettingsReceived(settings) {
        // Cache copy
        cachedSettings = settings;

        var userSettings = settings.userSettings;
        var matrixSwitches = settings.matrixSwitches;

        uDom('[data-setting-bool]').forEach(function(elem){
            elem.prop('checked', userSettings[elem.prop('id')] === true);
        });

        uDom('[data-matrix-switch]').forEach(function(elem){
            var switchName = elem.attr('data-matrix-switch');
            if ( typeof switchName === 'string' && switchName !== '' ) {
                elem.prop('checked', matrixSwitches[switchName] === true);
            }
        });

        uDom('input[name="displayTextSize"]').forEach(function(elem) {
            elem.prop('checked', elem.val() === userSettings.displayTextSize);
        });

        uDom.nodeFromId('popupScopeLevel').value = userSettings.popupScopeLevel;
        uDom.nodeFromId('deleteUnusedSessionCookiesAfter').value =
            userSettings.deleteUnusedSessionCookiesAfter;
        uDom.nodeFromId('clearBrowserCacheAfter').value =
            userSettings.clearBrowserCacheAfter;

        synchronizeWidgets();

        document.addEventListener('change', onInputChanged);

        // https://github.com/gorhill/httpswitchboard/issues/197
        uDom(window).on('beforeunload', prepareToDie);
    }
);

/******************************************************************************/

})();
