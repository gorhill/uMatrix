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

'use strict';

/******************************************************************************/

µMatrix.gotoURL = function(details) {
    vAPI.tabs.open(details);
};

/******************************************************************************/

µMatrix.gotoExtensionURL = function(details) {
    if ( details.url.startsWith('logger-ui.html') ) {
        if ( details.shiftKey ) {
            this.changeUserSettings(
                'alwaysDetachLogger',
                !this.userSettings.alwaysDetachLogger
            );
        }
        details.popup = this.userSettings.alwaysDetachLogger;
    }
    details.select = true;
    vAPI.tabs.open(details);
};

/******************************************************************************/

µMatrix.LineIterator = function(text, offset) {
    this.text = text;
    this.textLen = this.text.length;
    this.offset = offset || 0;
};

µMatrix.LineIterator.prototype = {
    next: function() {
        var lineEnd = this.text.indexOf('\n', this.offset);
        if ( lineEnd === -1 ) {
            lineEnd = this.text.indexOf('\r', this.offset);
            if ( lineEnd === -1 ) {
                lineEnd = this.textLen;
            }
        }
        var line = this.text.slice(this.offset, lineEnd);
        this.offset = lineEnd + 1;
        return line;
    },
    rewind: function() {
        if ( this.offset <= 1 ) {
            this.offset = 0;
            return;
        }
        var lineEnd = this.text.lastIndexOf('\n', this.offset - 2);
        if ( lineEnd !== -1 ) {
            this.offset = lineEnd + 1;
        } else {
            lineEnd = this.text.lastIndexOf('\r', this.offset - 2);
            this.offset = lineEnd !== -1 ? lineEnd + 1 : 0;
        }
    },
    eot: function() {
        return this.offset >= this.textLen;
    }
};

/******************************************************************************/

µMatrix.setToArray = typeof Array.from === 'function' ?
    Array.from :
    function(dict) {
        var out = [],
            entries = dict.values(),
            entry;
        for (;;) {
            entry = entries.next();
            if ( entry.done ) { break; }
            out.push(entry.value);
        }
        return out;
    };

µMatrix.setFromArray = function(arr) {
    return new Set(arr);
};

/******************************************************************************/
