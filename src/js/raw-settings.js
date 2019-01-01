/*******************************************************************************

    uMatrix - a browser extension to black/white list requests.
    Copyright (C) 2018-present Raymond Hill

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

    Home: https://github.com/gorhill/uBlock
*/

/* global uDom */

'use strict';

/******************************************************************************/

(function() {

/******************************************************************************/

var messaging = vAPI.messaging;
var cachedData = '';
var rawSettingsInput = uDom.nodeFromId('rawSettings');

/******************************************************************************/

var hashFromRawSettings = function(raw) {
    return raw.trim().replace(/\s+/g, '|');
};

/******************************************************************************/

// This is to give a visual hint that the content of user blacklist has changed.

var rawSettingsChanged = (function () {
    var timer = null;

    var handler = function() {
        timer = null;
        var changed =
            hashFromRawSettings(rawSettingsInput.value) !== cachedData;
        uDom.nodeFromId('rawSettingsApply').disabled = !changed;
    };

    return function() {
        if ( timer !== null ) {
            clearTimeout(timer);
        }
        timer = vAPI.setTimeout(handler, 100);
    };
})();

/******************************************************************************/

function renderRawSettings() {
    var onRead = function(raw) {
        cachedData = hashFromRawSettings(raw);
        var pretty = [],
            whitespaces = '                                ',
            lines = raw.split('\n'),
            max = 0,
            pos,
            i, n = lines.length;
        for ( i = 0; i < n; i++ ) {
            pos = lines[i].indexOf(' ');
            if ( pos > max ) {
                max = pos;
            }
        }
        for ( i = 0; i < n; i++ ) {
            pos = lines[i].indexOf(' ');
            pretty.push(whitespaces.slice(0, max - pos) + lines[i]);
        }
        rawSettingsInput.value = pretty.join('\n') + '\n';
        rawSettingsChanged();
        rawSettingsInput.focus();
    };
    messaging.send('dashboard', { what: 'readRawSettings' }, onRead);
}

/******************************************************************************/

var applyChanges = function() {
    messaging.send(
        'dashboard',
        {
            what: 'writeRawSettings',
            content: rawSettingsInput.value
        },
        renderRawSettings
    );
};

/******************************************************************************/

// Handle user interaction
uDom('#rawSettings').on('input', rawSettingsChanged);
uDom('#rawSettingsApply').on('click', applyChanges);

renderRawSettings();

/******************************************************************************/

})();
