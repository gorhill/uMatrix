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

function onChangeValueHandler(uelem, setting, min, max) {
    var oldVal = cachedSettings.userSettings[setting];
    var newVal = Math.round(parseFloat(uelem.val()));
    if ( typeof newVal !== 'number' ) {
        newVal = oldVal;
    } else {
        newVal = Math.max(newVal, min);
        newVal = Math.min(newVal, max);
    }
    uelem.val(newVal);
    if ( newVal !== oldVal ) {
        changeUserSettings(setting, newVal);
    }
}

/******************************************************************************/

function prepareToDie() {
    onChangeValueHandler(uDom('#delete-unused-session-cookies-after'), 'deleteUnusedSessionCookiesAfter', 15, 1440);
    onChangeValueHandler(uDom('#clear-browser-cache-after'), 'clearBrowserCacheAfter', 15, 1440);
}

/******************************************************************************/

var installEventHandlers = function() {
    uDom('input[name="displayTextSize"]').on('change', function(){
        changeUserSettings('displayTextSize', this.value);
    });

    uDom('#popupScopeLevel').on('change', function(){
        changeUserSettings('popupScopeLevel', this.value);
    });

    uDom('[data-setting-bool]').on('change', function(){
        var settingName = this.getAttribute('data-setting-bool');
        if ( typeof settingName === 'string' && settingName !== '' ) {
            changeUserSettings(settingName, this.checked);
        }
    });

    uDom('[data-matrix-switch]').on('change', function(){
        var switchName = this.getAttribute('data-matrix-switch');
        if ( typeof switchName === 'string' && switchName !== '' ) {
            changeMatrixSwitch(switchName, this.checked);
        }
    });

    uDom('#delete-unused-session-cookies-after').on('change', function(){
        onChangeValueHandler(uDom(this), 'deleteUnusedSessionCookiesAfter', 15, 1440);
    });
    uDom('#clear-browser-cache-after').on('change', function(){
        onChangeValueHandler(uDom(this), 'clearBrowserCacheAfter', 15, 1440);
    });

    // https://github.com/gorhill/httpswitchboard/issues/197
    uDom(window).on('beforeunload', prepareToDie);
};

/******************************************************************************/

uDom.onLoad(function() {
    var onSettingsReceived = function(settings) {
        // Cache copy
        cachedSettings = settings;

        var userSettings = settings.userSettings;
        var matrixSwitches = settings.matrixSwitches;

        uDom('[data-setting-bool]').forEach(function(elem){
            var settingName = elem.attr('data-setting-bool');
            if ( typeof settingName === 'string' && settingName !== '' ) {
                elem.prop('checked', userSettings[settingName] === true);
            }
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

        uDom('#delete-unused-session-cookies-after').val(userSettings.deleteUnusedSessionCookiesAfter);
        uDom('#clear-browser-cache-after').val(userSettings.clearBrowserCacheAfter);

        installEventHandlers();
    };
    vAPI.messaging.send(
        'settings.js',
        { what: 'getUserSettings' },
        onSettingsReceived
    );
});

/******************************************************************************/

})();
