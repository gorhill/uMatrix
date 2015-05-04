/*******************************************************************************

    uMatrix - a browser extension to benchmark browser session.
    Copyright (C) 2015 Raymond Hill

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

    Home: https://github.com/gorhill/sessbench

    TODO: cleanup/refactor
*/

/* jshint boss: true */
/* global vAPI, uDom */

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

var messager = vAPI.messaging.channel('logger-ui.js');

var inspectedTabId = '';
var maxEntries = 0;
var doc = document;
var body = doc.body;
var tbody = doc.querySelector('#content tbody');
var trJunkyard = [];
var tdJunkyard = [];
var firstVarDataCol = 2;  // currently, column 2 (0-based index)
var lastVarDataIndex = 3; // currently, d0-d3
var noTabId = '';

var prettyRequestTypes = {
    'main_frame': 'doc',
    'stylesheet': 'css',
    'sub_frame': 'frame',
    'xmlhttprequest': 'xhr'
};

var timeOptions = {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
};

/******************************************************************************/

var createCellAt = function(tr, index) {
    var td = tr.cells[index];
    var mustAppend = !td;
    if ( mustAppend ) {
        td = tdJunkyard.pop();
    }
    if ( td ) {
        td.removeAttribute('colspan');
        td.textContent = '';
    } else {
        td = doc.createElement('td');
    }
    if ( mustAppend ) {
        tr.appendChild(td);
    }
    return td;
};

/******************************************************************************/

var createRow = function(entry) {
    var tr = trJunkyard.pop();
    if ( tr ) {
        tr.className = '';
    } else {
        tr = doc.createElement('tr');
    }
    for ( var index = 0; index < firstVarDataCol; index++ ) {
        createCellAt(tr, index);
    }
    var i = 1, span = 1, td;
    for (;;) {
        td = createCellAt(tr, index);
        if ( i === lastVarDataIndex ) {
            break;
        }
        if ( entry['d' + i] === undefined ) {
            span += 1;
        } else {
            if ( span !== 1 ) {
                td.setAttribute('colspan', span);
            }
            index += 1;
            span = 1;
        }
        i += 1;
    }
    if ( span !== 1 ) {
        td.setAttribute('colspan', span);
    }
    index += 1;
    while ( td = tr.cells[index] ) {
        tdJunkyard.push(tr.removeChild(td));
    }
    return tr;
};

/******************************************************************************/

var createGap = function(url) {
    var tr = createRow({ d0: '' });
    tr.classList.add('doc');
    tr.cells[firstVarDataCol].textContent = url;
    tbody.insertBefore(tr, tbody.firstChild);
};

/******************************************************************************/

var renderLogEntry = function(entry) {
    var fvdc = firstVarDataCol;
    var tr = createRow(entry);

    if ( entry.tab === noTabId ) {
        tr.classList.add('tab_bts');
    } else if ( entry.tab !== '' ) {
        tr.classList.add('tab_' + entry.tab);
    }
    if ( entry.cat !== '' ) {
        tr.classList.add('cat_' + entry.cat);
    }

    var time = new Date(entry.tstamp);
    tr.cells[0].textContent = time.toLocaleString('fullwide', timeOptions);

    switch ( entry.cat ) {
    case 'error':
    case 'info':
        tr.cells[fvdc].textContent = entry.d0;
        break;

    case 'net':
        // If the request is that of a root frame, insert a gap in the table
        // in order to visually separate entries for different documents. 
        if ( entry.d1 === 'doc' ) {
            createGap(entry.d2);
        }
        if ( entry.d0 ) {
            tr.classList.add('blocked');
            tr.cells[fvdc].textContent = '---';
        } else {
            tr.cells[fvdc].textContent = '';
        }
        tr.cells[fvdc+1].textContent = (prettyRequestTypes[entry.d1] || entry.d1) + '\t';
        tr.cells[fvdc+2].textContent = entry.d2 + '\t';
        break;

    default:
        tr.cells[fvdc].textContent = entry.d0;
        break;
    }

    tbody.insertBefore(tr, tbody.firstChild);
};

/******************************************************************************/

var renderLogBuffer = function(response) {
    var buffer = response.entries;
    if ( buffer.length === 0 ) {
        return;
    }

    noTabId = response.noTabId;

    // Preserve scroll position
    var height = tbody.offsetHeight;

    var n = buffer.length;
    for ( var i = 0; i < n; i++ ) {
        renderLogEntry(buffer[i]);
    }

    // Prevent logger from growing infinitely and eating all memory. For
    // instance someone could forget that it is left opened for some
    // dynamically refreshed pages.
    truncateLog(maxEntries);

    var yDelta = tbody.offsetHeight - height;
    if ( yDelta === 0 ) {
        return;
    }

    // Chromium:
    //   body.scrollTop = good value
    //   body.parentNode.scrollTop = 0
    if ( body.scrollTop !== 0 ) {
        body.scrollTop += yDelta;
        return;
    }

    // Firefox:
    //   body.scrollTop = 0
    //   body.parentNode.scrollTop = good value
    var parentNode = body.parentNode;
    if ( parentNode && parentNode.scrollTop !== 0 ) {
        parentNode.scrollTop += yDelta;
    }
};

/******************************************************************************/

var truncateLog = function(size) {
    if ( size === 0 ) {
        size = 25000;
    }
    size = Math.min(size, 25000);
    var tr;
    while ( tbody.childElementCount > size ) {
        tr = tbody.lastElementChild;
        trJunkyard.push(tbody.removeChild(tr));
    }
};

/******************************************************************************/

var onBufferRead = function(response) {
    renderLogBuffer(response);
    setTimeout(readLogBuffer, 1000);
};

/******************************************************************************/

// This can be called only once, at init time. After that, this will be called
// automatically. If called after init time, this will be messy, and this would
// require a bit more code to ensure no multi time out events.

var readLogBuffer = function() {
    messager.send({ what: 'readMany', tabId: inspectedTabId }, onBufferRead);
};

/******************************************************************************/

var clearBuffer = function() {
    var tr;
    while ( tbody.firstChild !== null ) {
        tr = tbody.lastElementChild;
        trJunkyard.push(tbody.removeChild(tr));
    }
};

/******************************************************************************/

var reloadTab = function() {
    messager.send({ what: 'reloadTab', tabId: inspectedTabId });
};

/******************************************************************************/

var onMaxEntriesChanged = function() {
    var raw = uDom(this).val();
    try {
        maxEntries = parseInt(raw, 10);
        if ( isNaN(maxEntries) ) {
            maxEntries = 0;
        }
    } catch (e) {
        maxEntries = 0;
    }

    messager.send({
        what: 'userSettings',
        name: 'requestLogMaxEntries',
        value: maxEntries
    });

    truncateLog(maxEntries);
};

/******************************************************************************/

uDom.onLoad(function() {
    // Extract the tab id of the page we need to pull the log
    var matches = window.location.search.match(/[\?&]tabId=([^&]+)/);
    if ( matches && matches.length === 2 ) {
        inspectedTabId = matches[1];
    }

    var onSettingsReady = function(settings) {
        maxEntries = settings.requestLogMaxEntries || 0;
        uDom('#maxEntries').val(maxEntries || '');
    };
    messager.send({ what: 'getUserSettings' }, onSettingsReady);

    readLogBuffer();

    uDom('#reload').on('click', reloadTab);
    uDom('#clear').on('click', clearBuffer);
    uDom('#maxEntries').on('change', onMaxEntriesChanged);
});

/******************************************************************************/

})();
