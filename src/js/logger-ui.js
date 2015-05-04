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
var firstVarDataCol = 1;
var lastVarDataCol = 3;

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

var createCell = function() {
    var td = tdJunkyard.pop();
    if ( td ) {
        return td;
    }
    return doc.createElement('td');
};

/******************************************************************************/

var createRow = function(entry) {
    var tr = trJunkyard.pop();
    if ( tr ) {
        tr.className = '';
    } else {
        tr = doc.createElement('tr');
    }
    var td;
    for ( var index = 0; index < firstVarDataCol; index++ ) {
        td = tr.cells[index];
        if ( td === undefined ) {
            td = createCell();
            tr.appendChild(td);
        }
        td.removeAttribute('colspan');
    }
    var i = 1, span = 1;
    for (;;) {
        td = tr.cells[index];
        if ( td === undefined ) {
            td = createCell();
            tr.appendChild(td);
        }
        if ( i === lastVarDataCol ) {
            break;
        }
        if ( entry['d' + i] === undefined ) {
            span += 1;
        } else {
            if ( span !== 1 ) {
                td.setAttribute('colspan', span);
            } else {
                td.removeAttribute('colspan');
            }
            index += 1;
            span = 1;
        }
        i += 1;
    }
    if ( span !== 1 ) {
        td.setAttribute('colspan', span);
    } else {
        td.removeAttribute('colspan');
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
    var tr = createRow(entry);

    tr.classList.add('tab_' + entry.tab);
    tr.classList.add('cat_' + entry.cat);

    var time = new Date(entry.tstamp);
    tr.cells[0].textContent = time.toLocaleString('fullwide', timeOptions);

    switch ( entry.cat ) {
    case 'info':
        tr.cells[firstVarDataCol].textContent = entry.d0;
        break;

    case 'net':
        // If the request is that of a root frame, insert a gap in the table
        // in order to visually separate entries for different documents. 
        if ( entry.d1 === 'doc' ) {
            createGap(entry.d2);
        }
        if ( entry.d0 ) {
            tr.classList.add('blocked');
            tr.cells[1].textContent = '---';
        } else {
            tr.cells[1].textContent = '';
        }
        tr.cells[2].textContent = (prettyRequestTypes[entry.d1] || entry.d1) + '\t';
        tr.cells[3].textContent = entry.d2 + '\t';
        break;

    default:
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
