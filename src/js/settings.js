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

/* global messaging, uDom */
/* jshint multistr: true */

/******************************************************************************/

(function() {

/******************************************************************************/

messaging.start('settings.js');

var cachedUserSettings = {};

/******************************************************************************/

var subframeDemoBackgroundImage = 'repeating-linear-gradient(\
-45deg,\
{{color}},{{color}} 24%,\
transparent 26%,transparent 49%,\
{{color}} 51%,{{color}} 74%,\
transparent 76%,transparent\
)';

var updateSubframeDemo = function() {
    var demo = uDom('#subframe-color-demo');
    var color = uDom('#subframe-color').val();
    demo.css('border-color', color);
    var re = new RegExp('\{\{color\}\}', 'g');
    demo.css('background-image', subframeDemoBackgroundImage.replace(re, color));
    demo.css('opacity', (parseInt(uDom('#subframe-opacity').val(), 10) / 100).toFixed(1));
};

var onSubframeColorChanged = function() {
    var color = uDom('#subframe-color').val();
    if ( color === '' ) {
        uDom('#subframe-color').val(color);
    }
    changeUserSettings('subframeColor', color);
    var opacity = parseInt(uDom('#subframe-opacity').val(), 10);
    if ( Number.isNaN(opacity) ) {
        opacity = 100;
    }
    changeUserSettings('subframeOpacity', opacity);
    updateSubframeDemo();
};

/******************************************************************************/

function changeUserSettings(name, value) {
    messaging.tell({
        what: 'userSettings',
        name: name,
        value: value
    });
}

/******************************************************************************/

function prepareToDie() {
    onSubframeColorChanged();
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
    uDom('#subframe-color').on('change', function(){ onSubframeColorChanged(); });
    uDom('#subframe-opacity').on('change', function(){ onSubframeColorChanged(); });

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
        uDom('#subframe-color').val(userSettings.subframeColor);
        uDom('#subframe-opacity').val(userSettings.subframeOpacity);
        updateSubframeDemo();

        installEventHandlers();
    };
    messaging.ask({ what: 'getUserSettings' }, onUserSettingsReceived);
});

/******************************************************************************/

})();
