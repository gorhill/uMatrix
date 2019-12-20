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

/* global CodeMirror, uDom, uBlockDashboard */

'use strict';

/******************************************************************************/

{
// >>>>> start of local scope

/******************************************************************************/

const cmEditor = new CodeMirror(
    document.getElementById('rawSettings'),
    {
        autofocus: true,
        lineNumbers: true,
        lineWrapping: true,
        styleActiveLine: true
    }
);

uBlockDashboard.patchCodeMirrorEditor(cmEditor);

let cachedData = '';

/******************************************************************************/

const hashFromRawSettings = function(raw) {
    return raw.trim().replace(/\s+/g, '|');
};

/******************************************************************************/

// This is to give a visual hint that the content of user blacklist has changed.

const rawSettingsChanged = (( ) => {
    let timer;

    const handler = function() {
        timer = undefined;
        const changed =
            hashFromRawSettings(cmEditor.getValue()) !== cachedData;
        uDom.nodeFromId('rawSettingsApply').disabled = changed === false;
        CodeMirror.commands.save = changed ? applyChanges : function(){};
    };

    return function() {
        if ( timer !== undefined ) {
            clearTimeout(timer);
        }
        timer = vAPI.setTimeout(handler, 100);
    };
})();

cmEditor.on('changes', rawSettingsChanged);

/******************************************************************************/

const renderRawSettings = async function(first) {
    const raw = await vAPI.messaging.send('dashboard', {
        what: 'readRawSettings'
    });
    cachedData = hashFromRawSettings(raw);
    const lines = raw.split('\n');
    const n = lines.length;
    let max = 0;
    for ( let i = 0; i < n; i++ ) {
        const pos = lines[i].indexOf(' ');
        if ( pos > max ) { max = pos; }
    }
    const pretty = [];
    for ( let i = 0; i < n; i++ ) {
        const pos = lines[i].indexOf(' ');
        pretty.push(' '.repeat(max - pos) + lines[i]);
    }
    pretty.push('');
    cmEditor.setValue(pretty.join('\n'));
    if ( first ) {
        cmEditor.clearHistory();
    }
    rawSettingsChanged();
    cmEditor.focus();
};

/******************************************************************************/

const applyChanges = async function() {
    await vAPI.messaging.send('dashboard', {
        what: 'writeRawSettings',
        content: cmEditor.getValue(),
    });
    renderRawSettings();
};

/******************************************************************************/

// Handle user interaction
uDom('#rawSettings').on('input', rawSettingsChanged);
uDom('#rawSettingsApply').on('click', applyChanges);

renderRawSettings(true);

/******************************************************************************/

// <<<<< end of local scope
}
