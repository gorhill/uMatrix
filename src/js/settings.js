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

/* global vAPI, uDom */
/* jshint multistr: true */

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

var messager = vAPI.messaging.channel('settings.js');

var cachedUserSettings = {};

/******************************************************************************/

function changeUserSettings(name, value) {
    messager.send({
        what: 'userSettings',
        name: name,
        value: value
    });
}

/******************************************************************************/

function prepareToDie() {
}

/******************************************************************************/

var installEventHandlers = function() {
    // `data-range` allows to add/remove bool properties without 
    // changing code.
    uDom('input[data-range="bool"]').on('change', function() {
        changeUserSettings(this.id, this.checked);
    });

    uDom('input[name="displayTextSize"]').on('change', function(){
        changeUserSettings('displayTextSize', this.value);
    });
    uDom('#smart-auto-reload').on('change', function(){
        changeUserSettings('smartAutoReload', this.value);
    });

    // https://github.com/gorhill/httpswitchboard/issues/197
    uDom(window).on('beforeunload', prepareToDie);
};

/******************************************************************************/

uDom.onLoad(function() {
    var onUserSettingsReceived = function(userSettings) {
        // Cache copy
        cachedUserSettings = userSettings;

        // `data-range` allows to add/remove bool properties without 
        // changing code.
        uDom('input[data-range="bool"]').forEach(function(elem) {
            elem.prop('checked', userSettings[elem.attr('id')] === true);
        });

        uDom('input[name="displayTextSize"]').forEach(function(elem) {
            elem.prop('checked', elem.val() === userSettings.displayTextSize);
        });
        uDom('#smart-auto-reload').val(userSettings.smartAutoReload);

        installEventHandlers();
    };
    messager.send({ what: 'getUserSettings' }, onUserSettingsReceived);
});

/******************************************************************************/

})();
